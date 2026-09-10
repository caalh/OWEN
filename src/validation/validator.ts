/**
 * Manual "OWEN: Validate Input File" command — a thin wrapper over the shared
 * rules layer in src/language/rules.ts (the LSP server runs the same code in
 * real time for mcnp/serpent/scone).
 *
 * Division of labor since the LSP migration (docs/LSP_DESIGN.md):
 *  - mcnp / serpent / scone: the LSP owns the diagnostics collection; this
 *    command just reports the current issue count (it re-runs the same rules,
 *    so counts always agree with the squiggles).
 *  - OpenMC Python: unchanged pre-LSP behavior — the command runs the OpenMC
 *    gotcha rules and publishes them to its own collection (Pylance owns the
 *    rest of Python).
 */

import * as vscode from 'vscode';
import { detectMonteCarloLanguage, detectMonteCarloLanguageFromText, MonteCarloLanguage } from '../util/detectLanguage';
import { joinNotebookCode, notebookOfCell } from '../util/deckSource';
import { runLanguageRules } from '../language/rules';
import { PlainDiagnostic } from '../language/types';

const diagnosticCollection = vscode.languages.createDiagnosticCollection('owen');

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
    return diag;
}

/**
 * Entry point used by the OWEN: Validate Input File command and tests.
 * `dispatch` returns the diagnostics array so tests can introspect it directly.
 */
export function validateInputFile(document: vscode.TextDocument): Diags {
    // A notebook cell is validated as part of its notebook: every code cell
    // joined, then each diagnostic mapped back to the cell it belongs to.
    const nb = notebookOfCell(document);
    if (nb) {
        const { text, cells } = joinNotebookCode(nb);
        const lang = detectMonteCarloLanguageFromText(text, 'python');
        const all = runValidators(lang, text);
        const perCell = new Map<vscode.TextDocument, Diags>();
        for (const cell of cells) perCell.set(cell, []);
        for (const d of all) {
            // Joined text is the cells separated by one newline: walk to the owner.
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
        if (all.length === 0) vscode.window.showInformationMessage('OWEN: No issues found in this notebook\'s OpenMC model.');
        else vscode.window.showWarningMessage(`OWEN: Found ${all.length} issue(s) across the notebook's code cells.`);
        return all;
    }

    const lang = detectMonteCarloLanguage(document);
    const diagnostics = dispatch(document);

    // The LSP owns the collection for its languages; only OpenMC Python (which
    // is not routed through the server) publishes from this command.
    if (lang === 'openmc') {
        diagnosticCollection.set(document.uri, diagnostics);
    }

    if (diagnostics.length === 0) {
        vscode.window.showInformationMessage('OWEN: No issues found.');
    } else {
        vscode.window.showWarningMessage(`OWEN: Found ${diagnostics.length} issue(s).`);
    }
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
    return runLanguageRules(lang, text).map(toVscodeDiagnostic);
}
