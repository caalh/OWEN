/**
 * Manual "OWEN: Validate Input File" command — a thin wrapper over the shared
 * rules layer in src/language/rules.ts (the LSP server runs the same code in
 * real time for mcnp/serpent/scone).
 *
 * Division of labor since the LSP migration (docs/LSP_DESIGN.md):
 *  - mcnp / serpent / scone: the LSP owns the diagnostics collection; this
 *    command re-runs the same rules (counts always agree with the squiggles),
 *    merges same-file MCNP cross-references, and opens a report that lists
 *    every finding with a "what to do" line.
 *  - OpenMC Python: publishes to its own collection (Pylance owns the rest).
 *  - OpenMC XML: the host collection already squiggles; this command lists
 *    the same findings in the report.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { detectMonteCarloLanguage, detectMonteCarloLanguageFromText, MonteCarloLanguage } from '../util/detectLanguage';
import { joinNotebookCode, notebookOfCell } from '../util/deckSource';
import { runLanguageRules } from '../language/rules';
import { PlainDiagnostic } from '../language/types';
import { mcnpCrossReferenceDiagnostics } from '../language/crossReference';
import { detectOpenmcXmlKind, validateOpenmcXml } from '../language/openmcXml';
import { validationReportHtml, ReportFinding } from './report';

const diagnosticCollection = vscode.languages.createDiagnosticCollection('owen');
const VIEW = 'owen.validateInputReport';

type Diags = vscode.Diagnostic[];

const SEVERITY: Record<PlainDiagnostic['severity'], vscode.DiagnosticSeverity> = {
    error: vscode.DiagnosticSeverity.Error,
    warning: vscode.DiagnosticSeverity.Warning,
    information: vscode.DiagnosticSeverity.Information,
    hint: vscode.DiagnosticSeverity.Hint,
};

function toVscodeDiagnostic(d: PlainDiagnostic): vscode.Diagnostic {
    const diag = new vscode.Diagnostic(
        new vscode.Range(d.line, d.startCol, d.line, d.endCol),
        d.message,
        SEVERITY[d.severity],
    );
    diag.source = 'owen';
    diag.code = d.code;
    if (d.unnecessary) diag.tags = [vscode.DiagnosticTag.Unnecessary];
    return diag;
}

function findingOf(d: vscode.Diagnostic): ReportFinding {
    return {
        severity: d.severity === vscode.DiagnosticSeverity.Error ? 'error'
            : d.severity === vscode.DiagnosticSeverity.Warning ? 'warning'
                : d.severity === vscode.DiagnosticSeverity.Information ? 'information'
                    : 'hint',
        line: d.range.start.line,
        startCol: d.range.start.character,
        message: d.message,
        code: typeof d.code === 'string' ? d.code : String(d.code ?? ''),
    };
}

function collectPlain(lang: MonteCarloLanguage | null, text: string): PlainDiagnostic[] {
    const rules = runLanguageRules(lang, text);
    if (lang !== 'mcnp') return rules;
    return [...rules, ...mcnpCrossReferenceDiagnostics(text)];
}

let panel: vscode.WebviewPanel | undefined;
let lastDoc: vscode.TextDocument | undefined;

function showReport(document: vscode.TextDocument, langLabel: string, diags: Diags): void {
    lastDoc = document;
    const html = (webview: vscode.Webview) => {
        const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        return validationReportHtml(
            {
                fileName: path.basename(document.uri.fsPath || document.uri.path) || 'untitled',
                language: langLabel,
                findings: diags.map(findingOf),
            },
            webview.cspSource,
            nonce,
        );
    };
    if (panel) {
        panel.reveal(vscode.ViewColumn.Beside, true);
        panel.webview.html = html(panel.webview);
        return;
    }
    panel = vscode.window.createWebviewPanel(VIEW, 'OWEN: Validate Input', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true });
    panel.webview.html = html(panel.webview);
    panel.webview.onDidReceiveMessage(async (msg: { command?: string; line?: number; col?: number }) => {
        if (msg.command === 'rerun' && lastDoc) {
            validateInputFile(lastDoc);
            return;
        }
        if (msg.command === 'problems') {
            await vscode.commands.executeCommand('workbench.actions.view.problems');
            return;
        }
        if (msg.command === 'goto' && lastDoc) {
            const line = Math.max(0, Number(msg.line) || 0);
            const col = Math.max(0, Number(msg.col) || 0);
            const editor = await vscode.window.showTextDocument(lastDoc, { preview: false, preserveFocus: false });
            const pos = new vscode.Position(line, col);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        }
    });
    panel.onDidDispose(() => { panel = undefined; });
}

/**
 * Entry point used by the OWEN: Validate Input File command and tests.
 * `dispatch` returns the diagnostics array so tests can introspect it directly.
 */
export function validateInputFile(document: vscode.TextDocument): Diags {
    const nb = notebookOfCell(document);
    if (nb) {
        const { text, cells } = joinNotebookCode(nb);
        const lang = detectMonteCarloLanguageFromText(text, 'python');
        const all = runValidators(lang, text);
        const perCell = new Map<vscode.TextDocument, Diags>();
        for (const cell of cells) perCell.set(cell, []);
        for (const d of all) {
            let line = d.range.start.line;
            for (const cell of cells) {
                if (line < cell.lineCount) {
                    const moved = new vscode.Diagnostic(
                        new vscode.Range(line, d.range.start.character, line, d.range.end.character),
                        d.message, d.severity,
                    );
                    moved.source = d.source; moved.code = d.code;
                    perCell.get(cell)!.push(moved);
                    break;
                }
                line -= cell.lineCount;
            }
        }
        for (const [cell, diags] of perCell) diagnosticCollection.set(cell.uri, diags);
        showReport(document, 'OpenMC notebook', all);
        if (all.length > 0) void vscode.commands.executeCommand('workbench.actions.view.problems');
        return all;
    }

    if (document.languageId === 'xml') {
        const kind = detectOpenmcXmlKind(document.getText());
        if (kind) {
            const diagnostics = validateOpenmcXml(kind, document.getText()).map(toVscodeDiagnostic);
            showReport(document, `OpenMC ${kind}.xml`, diagnostics);
            if (diagnostics.length > 0) void vscode.commands.executeCommand('workbench.actions.view.problems');
            return diagnostics;
        }
    }

    if (document.languageId === 'phits') {
        showReport(document, 'PHITS (syntax only)', []);
        return [];
    }

    const lang = detectMonteCarloLanguage(document);
    const diagnostics = dispatch(document);

    if (lang === 'openmc') {
        diagnosticCollection.set(document.uri, diagnostics);
    }

    const label = lang ? lang.toUpperCase() : document.languageId || 'unknown';
    if (!lang) {
        vscode.window.showInformationMessage('OWEN: this file is not an MCNP, OpenMC, Serpent, or SCONE deck, so there is nothing to validate.');
        return [];
    }
    showReport(document, label, diagnostics);
    if (diagnostics.length > 0) void vscode.commands.executeCommand('workbench.actions.view.problems');
    return diagnostics;
}

export function dispatch(document: vscode.TextDocument): Diags {
    const lang = detectMonteCarloLanguage(document);
    return runValidators(lang, document.getText());
}

/**
 * Pure-rules wrapper kept API-compatible with the pre-LSP validator so the
 * existing test suite and callers keep working unchanged.
 */
export function runValidators(lang: MonteCarloLanguage | null, text: string): Diags {
    return collectPlain(lang, text).map(toVscodeDiagnostic);
}
