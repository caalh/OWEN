import * as vscode from 'vscode';
import {
    classifyMcnpRuler,
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
 * the user configured themselves. Ownership is decided by
 * {@link classifyMcnpRuler}, which also adopts the memo-less rulers written by
 * OWEN 0.1.6–1.1.x — otherwise the toggle moves the status bar and the
 * diagnostics while the visible line stays at 80.
 *
 * @returns what happened, so an explicit toggle can explain a ruler it must leave alone.
 */
async function ensureMcnpRuler(
    context: vscode.ExtensionContext,
    limit: number,
): Promise<'written' | 'unchanged' | 'user-owned'> {
    const editorCfg = vscode.workspace.getConfiguration('editor', { languageId: 'mcnp' });
    const inspected = editorCfg.inspect<number[]>('rulers');
    const existing = inspected?.globalLanguageValue;
    const memo = context.globalState.get<number>(RULER_MEMO_KEY);
    const managed = [MCNP_LEGACY_LINE_LIMIT, MCNP_MODERN_LINE_LIMIT, limit];
    const ownership = classifyMcnpRuler(existing, memo, managed);
    if (ownership === 'user') return 'user-owned';
    if (ownership === 'owen' && existing?.[0] === limit) {
        // Already correct, but claim it so a later toggle can move it.
        if (memo !== limit) await context.globalState.update(RULER_MEMO_KEY, limit);
        return 'unchanged';
    }
    try {
        await editorCfg.update('rulers', [limit], vscode.ConfigurationTarget.Global, true);
        await context.globalState.update(RULER_MEMO_KEY, limit);
        return 'written';
    } catch {
        // Non-fatal: a missing/readonly settings target shouldn't break activation.
        return 'unchanged';
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
 * Which configuration scope the dialect should be written to: the one
 * {@link lineLimitSettings} would read it back from. Writing to Workspace
 * while a workspace-folder value shadows it would move the setting without
 * moving the effective limit.
 */
function dialectWriteTarget(): vscode.ConfigurationTarget {
    const inspected = vscode.workspace.getConfiguration('owen').inspect<McnpDialect>('mcnp.dialect');
    if (inspected?.workspaceFolderValue !== undefined) return vscode.ConfigurationTarget.WorkspaceFolder;
    if (inspected?.workspaceValue !== undefined) return vscode.ConfigurationTarget.Workspace;
    if (inspected?.globalValue !== undefined) return vscode.ConfigurationTarget.Global;
    return vscode.workspace.workspaceFolders?.length
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
}

/**
 * Toggle the MCNP dialect between 80 and 128 columns, then move the ruler,
 * decorations and status bar in the same turn. A file directive still wins
 * over the setting, and a ruler the user owns is left alone — both are said
 * out loud instead of silently doing nothing.
 */
async function toggleLineLimit(
    context: vscode.ExtensionContext,
    refreshAll: () => void,
): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const settings = lineLimitSettings();
    const text = editor?.document.languageId === 'mcnp' ? editor.document.getText() : '';
    const resolved = resolveLineLimit(text, settings);

    const next: McnpDialect =
        resolved.limit === MCNP_LEGACY_LINE_LIMIT ? 'mcnp6.2+' : 'mcnp6.1-and-earlier';
    const nextLimit = next === 'mcnp6.2+' ? MCNP_MODERN_LINE_LIMIT : MCNP_LEGACY_LINE_LIMIT;

    await vscode.workspace.getConfiguration('owen').update('mcnp.dialect', next, dialectWriteTarget());

    // Don't wait for the configuration event: move everything now so the
    // visible ruler and the highlighted tails agree with the status bar.
    const rulerState = await ensureMcnpRuler(context, resolved.source === 'file-directive' ? resolved.limit : nextLimit);
    refreshAll();

    if (resolved.source === 'file-directive') {
        void vscode.window.showInformationMessage(
            `OWEN: dialect set to ${nextLimit} columns, but this file pins its own limit ` +
            `('c owen: line-limit=${resolved.limit}' on line ${(resolved.directiveLine ?? 0) + 1}), ` +
            'which always wins. Remove the directive to follow the setting.',
        );
        return;
    }

    let msg =
        `OWEN: MCNP line limit is now ${nextLimit} columns ` +
        `(${next === 'mcnp6.2+' ? 'MCNP 6.2+' : 'MCNP 6.1 and earlier'}).`;
    if (rulerState === 'user-owned') {
        msg += ` The editor ruler was left where you set it — edit "[mcnp]": { "editor.rulers": [${nextLimit}] } to move the guide line.`;
    }
    void vscode.window.showInformationMessage(msg);
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

    const refreshAllVisible = () => {
        for (const editor of vscode.window.visibleTextEditors) {
            const resolved = refreshDecorations(editor, decoration);
            if (editor === vscode.window.activeTextEditor) refreshStatusBar(statusItem, resolved);
            if (resolved) void ensureMcnpRuler(context, resolved.limit);
        }
    };

    // Seed any already-open MCNP editors.
    refreshAllVisible();

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'owen.toggleMcnpLineLimit',
            () => toggleLineLimit(context, refreshAllVisible),
        ),
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
                refreshAllVisible();
            }
        }),
    );
}
