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
import { detectMonteCarloLanguage, MonteCarloLanguage } from '../util/detectLanguage';
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
