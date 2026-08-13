import * as vscode from 'vscode';
import {
    describeLineLimit,
    findOverlengthLines,
    LineLimitSettings,
    McnpDialect,
    MCNP_LEGACY_LINE_LIMIT,
    MCNP_MODERN_LINE_LIMIT,
    ResolvedLineLimit,
    resolveLineLimit,
} from './lineLength';

// Visibly flag MCNP card images that exceed the column limit (default 80).
// Three reinforcing signals:
//   1. A language-scoped editor ruler at the limit ([mcnp].editor.rulers), so
//      the user sees the boundary while typing.
//   2. A background decoration on the overflowing tail, because past-limit
//      characters are silently ignored by MCNP — a classic invisible bug.
//   3. A status-bar item (`MCNP 80` / `MCNP 128`) that shows the effective
//      limit for the active deck and toggles the dialect on click.
// The Problems-panel diagnostic for the same condition is published by the MC
// language server (code `mcnp.line-length`, same resolveLineLimit math), so
// this module keeps no DiagnosticCollection.
//
// Limit resolution (shared with the server via decorations/lineLength.ts):
// file directive `c owen: line-limit=N` > owen.mcnp.dialect > custom number >
// 80. The 128-column figure for MCNP 6.2+ is LA-UR-24-24602 Rev. 1 §3.2.2 +
// Table 4.1.

/** globalState key remembering the ruler value OWEN last wrote, so a dialect
 *  toggle can update it without clobbering a ruler the user set themselves. */
const RULER_MEMO_KEY = 'owen.mcnpRulerWritten';

export function lineLimitSettings(): LineLimitSettings {
    const cfg = vscode.workspace.getConfiguration('owen');
    const n = cfg.get<number>('mcnp.lineLengthLimit');
    const inspected = cfg.inspect<McnpDialect>('mcnp.dialect');
    const dialect =
        inspected?.workspaceFolderValue ?? inspected?.workspaceValue ?? inspected?.globalValue;
    return {
        dialect,
        customLimit: typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined,
    };
}

function resolveForDocument(document: vscode.TextDocument): ResolvedLineLimit {
    return resolveLineLimit(document.getText(), lineLimitSettings());
}

/**
 * Keep [mcnp].editor.rulers at the effective limit without clobbering a ruler
 * the user configured themselves: we remember the value we last wrote in
 * globalState and only overwrite when the current value is ours (or absent).
 */
async function ensureMcnpRuler(context: vscode.ExtensionContext, limit: number): Promise<void> {
    const editorCfg = vscode.workspace.getConfiguration('editor', { languageId: 'mcnp' });
    const inspected = editorCfg.inspect<number[]>('rulers');
    const existing = inspected?.globalLanguageValue;
    const memo = context.globalState.get<number>(RULER_MEMO_KEY);
    if (Array.isArray(existing) && existing.length > 0) {
        const ours = existing.length === 1 && memo !== undefined && existing[0] === memo;
        if (!ours) return; // respect the user's own MCNP ruler(s)
        if (existing[0] === limit) return; // already correct
    }
    try {
        await editorCfg.update('rulers', [limit], vscode.ConfigurationTarget.Global, true);
        await context.globalState.update(RULER_MEMO_KEY, limit);
    } catch {
        // Non-fatal: a missing/readonly settings target shouldn't break activation.
    }
}

function refreshDecorations(
    editor: vscode.TextEditor,
    decoration: vscode.TextEditorDecorationType,
): ResolvedLineLimit | undefined {
    if (editor.document.languageId !== 'mcnp') {
        editor.setDecorations(decoration, []);
        return undefined;
    }
    const resolved = resolveForDocument(editor.document);
    const ranges = findOverlengthLines(editor.document.getText(), resolved.limit).map((o) => {
        const lineText = editor.document.lineAt(o.line).text;
        return new vscode.Range(o.line, Math.min(o.startCol, lineText.length), o.line, lineText.length);
    });
    editor.setDecorations(decoration, ranges);
    return resolved;
}

function refreshStatusBar(item: vscode.StatusBarItem, resolved: ResolvedLineLimit | undefined): void {
    if (!resolved) {
        item.hide();
        return;
    }
    item.text = `MCNP ${resolved.limit}`;
    item.tooltip =
        `MCNP card-image column limit: ${resolved.limit} (${describeLineLimit(resolved)}). ` +
        'Click to toggle 80 (MCNP \u22646.1) \u2194 128 (MCNP 6.2+).';
    item.show();
}

/**
 * Toggle the MCNP dialect between 80 and 128 columns. Persists to the
 * workspace when one is open (per-workspace decks usually target one MCNP
 * version), else globally. A file directive still wins over the setting; say
 * so instead of silently doing nothing.
 */
async function toggleLineLimit(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const settings = lineLimitSettings();
    const text = editor?.document.languageId === 'mcnp' ? editor.document.getText() : '';
    const resolved = resolveLineLimit(text, settings);

    const next: McnpDialect =
        resolved.limit === MCNP_LEGACY_LINE_LIMIT ? 'mcnp6.2+' : 'mcnp6.1-and-earlier';
    const nextLimit = next === 'mcnp6.2+' ? MCNP_MODERN_LINE_LIMIT : MCNP_LEGACY_LINE_LIMIT;

    const target = vscode.workspace.workspaceFolders?.length
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
    await vscode.workspace.getConfiguration('owen').update('mcnp.dialect', next, target);

    if (resolved.source === 'file-directive') {
        void vscode.window.showInformationMessage(
            `OWEN: dialect set to ${nextLimit} columns, but this file pins its own limit ` +
            `('c owen: line-limit=${resolved.limit}' on line ${(resolved.directiveLine ?? 0) + 1}), ` +
            'which always wins. Remove the directive to follow the setting.',
        );
    } else {
        void vscode.window.showInformationMessage(
            `OWEN: MCNP line limit is now ${nextLimit} columns ` +
            `(${next === 'mcnp6.2+' ? 'MCNP 6.2+' : 'MCNP 6.1 and earlier'}).`,
        );
    }
}

/**
 * Register the MCNP card-image line-length guard: the language-scoped ruler,
 * a tail decoration, the status-bar limit indicator, and the
 * `owen.toggleMcnpLineLimit` command — kept in sync with edits, the active
 * editor, and the owen.mcnp.dialect / owen.mcnp.lineLengthLimit settings.
 */
export function registerMcnpLineGuard(context: vscode.ExtensionContext): void {
    const decoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editorError.background'),
        border: '1px solid',
        borderColor: new vscode.ThemeColor('editorWarning.foreground'),
        overviewRulerColor: new vscode.ThemeColor('editorWarning.foreground'),
        overviewRulerLane: vscode.OverviewRulerLane.Right,
    });

    const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    statusItem.command = 'owen.toggleMcnpLineLimit';
    statusItem.name = 'OWEN MCNP Line Limit';

    context.subscriptions.push(decoration, statusItem);

    const refreshEditor = (editor: vscode.TextEditor | undefined) => {
        if (!editor) {
            refreshStatusBar(statusItem, undefined);
            return;
        }
        const resolved = refreshDecorations(editor, decoration);
        refreshStatusBar(statusItem, resolved);
        if (resolved) void ensureMcnpRuler(context, resolved.limit);
    };

    // Seed any already-open MCNP editors.
    for (const editor of vscode.window.visibleTextEditors) {
        const resolved = refreshDecorations(editor, decoration);
        if (editor === vscode.window.activeTextEditor) refreshStatusBar(statusItem, resolved);
        if (resolved) void ensureMcnpRuler(context, resolved.limit);
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('owen.toggleMcnpLineLimit', () => toggleLineLimit()),
        vscode.window.onDidChangeActiveTextEditor((editor) => refreshEditor(editor)),
        vscode.workspace.onDidChangeTextDocument((e) => {
            const editor = vscode.window.activeTextEditor;
            if (editor && e.document === editor.document) {
                refreshEditor(editor);
            }
        }),
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (
                e.affectsConfiguration('owen.mcnp.lineLengthLimit')
                || e.affectsConfiguration('owen.mcnp.dialect')
            ) {
                for (const editor of vscode.window.visibleTextEditors) {
                    const resolved = refreshDecorations(editor, decoration);
                    if (editor === vscode.window.activeTextEditor) {
                        refreshStatusBar(statusItem, resolved);
                    }
                    if (resolved) void ensureMcnpRuler(context, resolved.limit);
                }
            }
        }),
    );
}
