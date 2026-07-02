import * as vscode from 'vscode';
import { findOverlengthLines, MCNP_DEFAULT_LINE_LIMIT } from './lineLength';

// Visibly flag MCNP card images that exceed the column limit (default 80).
// Two reinforcing signals:
//   1. A language-scoped editor ruler at the limit ([mcnp].editor.rulers), so
//      the user sees the boundary while typing.
//   2. A background decoration on the overflowing tail, because past-limit
//      characters are silently ignored by MCNP — a classic invisible bug.
// The Problems-panel diagnostic for the same condition is published by the MC
// language server (code `mcnp.line-length`, same findOverlengthLines math), so
// this module no longer keeps its own DiagnosticCollection.

function lineLimit(): number {
    const n = vscode.workspace
        .getConfiguration('owen')
        .get<number>('mcnp.lineLengthLimit', MCNP_DEFAULT_LINE_LIMIT);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : MCNP_DEFAULT_LINE_LIMIT;
}

/**
 * Set [mcnp].editor.rulers to [limit] once, without clobbering a ruler the user
 * already configured for MCNP. Writes to the Global target as a language
 * override so it only affects MCNP files.
 */
async function ensureMcnpRuler(): Promise<void> {
    const limit = lineLimit();
    const editorCfg = vscode.workspace.getConfiguration('editor', { languageId: 'mcnp' });
    const inspected = editorCfg.inspect<number[]>('rulers');
    const existing = inspected?.globalLanguageValue;
    if (Array.isArray(existing) && existing.length > 0) {
        return; // respect the user's own MCNP ruler(s)
    }
    try {
        await editorCfg.update('rulers', [limit], vscode.ConfigurationTarget.Global, true);
    } catch {
        // Non-fatal: a missing/readonly settings target shouldn't break activation.
    }
}

function refreshDecorations(
    editor: vscode.TextEditor,
    decoration: vscode.TextEditorDecorationType,
): void {
    if (editor.document.languageId !== 'mcnp') {
        editor.setDecorations(decoration, []);
        return;
    }
    const limit = lineLimit();
    const ranges = findOverlengthLines(editor.document.getText(), limit).map((o) => {
        const lineText = editor.document.lineAt(o.line).text;
        return new vscode.Range(o.line, Math.min(o.startCol, lineText.length), o.line, lineText.length);
    });
    editor.setDecorations(decoration, ranges);
}

/**
 * Register the MCNP card-image line-length guard: the language-scoped ruler
 * and a tail decoration, kept in sync with edits and the active editor.
 */
export function registerMcnpLineGuard(context: vscode.ExtensionContext): void {
    void ensureMcnpRuler();

    const decoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editorError.background'),
        border: '1px solid',
        borderColor: new vscode.ThemeColor('editorWarning.foreground'),
        overviewRulerColor: new vscode.ThemeColor('editorWarning.foreground'),
        overviewRulerLane: vscode.OverviewRulerLane.Right,
    });

    context.subscriptions.push(decoration);

    const refreshEditor = (editor: vscode.TextEditor | undefined) => {
        if (!editor) return;
        refreshDecorations(editor, decoration);
    };

    // Seed any already-open MCNP editors.
    for (const editor of vscode.window.visibleTextEditors) {
        refreshEditor(editor);
    }

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => refreshEditor(editor)),
        vscode.workspace.onDidChangeTextDocument((e) => {
            const editor = vscode.window.activeTextEditor;
            if (editor && e.document === editor.document) {
                refreshEditor(editor);
            }
        }),
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('owen.mcnp.lineLengthLimit')) {
                void ensureMcnpRuler();
                for (const editor of vscode.window.visibleTextEditors) {
                    refreshEditor(editor);
                }
            }
        }),
    );
}
