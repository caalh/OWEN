import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { deckSourceOf } from '../util/deckSource';
import { detectOpenmcXmlKind } from '../language/openmcXml';
import { validateWorkspace, WorkspaceInput, WorkspaceLanguage, WorkspaceReport } from './core';

const VIEW = 'owen.workspaceReport';
const SEVERITY: Record<string, vscode.DiagnosticSeverity> = {
    error: vscode.DiagnosticSeverity.Error,
    warning: vscode.DiagnosticSeverity.Warning,
    information: vscode.DiagnosticSeverity.Information,
    hint: vscode.DiagnosticSeverity.Hint,
};

const nodeFs = {
    exists: (p: string) => fs.existsSync(p),
    read: (p: string) => fs.readFileSync(p, 'utf8'),
    list: (d: string) => { try { return fs.readdirSync(d); } catch { return []; } },
    mtime: (p: string) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } },
};

/** Which workspace validator applies to a document, if any. */
export function workspaceLanguageOf(doc: vscode.TextDocument): WorkspaceLanguage | null {
    if (doc.uri.scheme !== 'file') return null;
    if (doc.languageId === 'xml') return detectOpenmcXmlKind(doc.getText()) ? 'openmc-xml' : null;
    const src = deckSourceOf(doc);
    if (!src || src.fromNotebook) return null;
    return src.language;
}

function inputFor(doc: vscode.TextDocument, language: WorkspaceLanguage): WorkspaceInput {
    // Unsaved buffers win over disk for every open file in the project's directory tree.
    const overrides = new Map<string, string>();
    for (const d of vscode.workspace.textDocuments) {
        if (d.uri.scheme === 'file' && d.isDirty) overrides.set(path.resolve(d.uri.fsPath), d.getText());
    }
    return { language, rootPath: doc.uri.fsPath, overrides, fs: nodeFs };
}

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

export function workspaceReportHtml(r: WorkspaceReport, cspSource: string, nonce: string): string {
    const csp = ["default-src 'none'", `style-src ${cspSource} 'unsafe-inline'`, `script-src 'nonce-${nonce}'`].join('; ');
    const s = r.summary;
    const banner = s.errors ? ['bad', `${s.errors} error${s.errors === 1 ? '' : 's'} — these files do not work together yet.`]
        : s.warnings ? ['warn', `No errors; ${s.warnings} warning${s.warnings === 1 ? '' : 's'} worth reading.`]
        : ['ok', 'These files work together: every cross-file reference resolves.'];
    const langLabel: Record<WorkspaceLanguage, string> = {
        mcnp: 'MCNP project', openmc: 'OpenMC Python model', 'openmc-xml': 'OpenMC XML project', serpent: 'Serpent project', scone: 'SCONE input',
    };
    const fileRows = r.files.map((f) =>
        `<li><a class="f" data-file="${esc(f.path)}" href="#">${esc(path.basename(f.path))}</a> <span class="muted">${esc(f.role)}${f.exists ? '' : ' — missing'}</span></li>`).join('');
    const inv = Object.entries(r.inventory).filter(([, v]) => v > 0).map(([k, v]) => `<span class="chip">${v} ${esc(k)}</span>`).join('');
    const order = { error: 0, warning: 1, information: 2, hint: 3 } as Record<string, number>;
    const diagRows = [...r.diagnostics].sort((a, b) => order[a.severity] - order[b.severity] || a.file.localeCompare(b.file) || a.line - b.line).map((d) =>
        `<tr class="${d.severity}"><td><span class="sev ${d.severity}">${d.severity}</span></td><td><a class="f" data-file="${esc(d.file)}" data-line="${d.line}" data-col="${d.startCol}" href="#">${esc(path.basename(d.file))}:${d.line + 1}</a></td><td>${esc(d.message)}</td></tr>`).join('');
    return `<!DOCTYPE html><html><head><meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  body { font-family: var(--vscode-font-family); font-size: 12px; color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 12px 16px; }
  h1 { font-size: 15px; margin: 0 0 2px; } h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; opacity: .7; margin: 18px 0 6px; }
  .sub { opacity: .7; margin-bottom: 10px; }
  .banner { padding: 8px 10px; border-radius: 4px; margin: 10px 0; border: 1px solid transparent; font-weight: 600; }
  .ok { background: color-mix(in srgb, #3fb950 12%, transparent); border-color: #3fb95055; }
  .warn { background: var(--vscode-inputValidation-warningBackground, rgba(255,190,60,.12)); border-color: #f2a33c; }
  .bad { background: var(--vscode-inputValidation-errorBackground, rgba(255,80,80,.12)); border-color: #e05561; }
  ul { margin: 0; padding-left: 18px; } li { margin: 2px 0; }
  ul.ok li::marker { content: '✓  '; color: #3fb950; }
  .chip { display: inline-block; padding: 1px 8px; border-radius: 9px; margin: 0 6px 6px 0; background: color-mix(in srgb, var(--vscode-editor-foreground) 10%, transparent); }
  table { border-collapse: collapse; width: 100%; } th, td { text-align: left; padding: 3px 8px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: top; }
  .sev { font-size: 11px; font-weight: 600; text-transform: uppercase; padding: 0 6px; border-radius: 9px; color: #fff; background: #8a8f98; }
  .sev.error { background: #e05561; } .sev.warning { background: #d29922; } .sev.information { background: #4f9cf9; }
  a.f { color: var(--vscode-textLink-foreground); text-decoration: none; white-space: nowrap; } a.f:hover { text-decoration: underline; }
  .muted { opacity: .6; } .notes { opacity: .7; font-size: 11.5px; margin-top: 14px; }
  button { font: inherit; padding: 3px 10px; border: none; border-radius: 3px; cursor: pointer; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
</style></head><body>
<h1>Workspace Validation — ${esc(path.basename(r.root))}</h1>
<div class="sub">${esc(langLabel[r.language])} · ${esc(path.dirname(r.root))}</div>
<div class="banner ${banner[0]}">${esc(banner[1])}</div>
<p><button data-cmd="rerun">Re-run</button></p>
<h2>Files</h2><ul>${fileRows}</ul>
${inv ? `<h2>Inventory</h2><div>${inv}</div>` : ''}
${r.verified.length ? `<h2>Verified</h2><ul class="ok">${r.verified.map((v) => `<li>${esc(v)}</li>`).join('')}</ul>` : ''}
${r.diagnostics.length ? `<h2>Findings</h2><table><thead><tr><th></th><th>Where</th><th>What</th></tr></thead><tbody>${diagRows}</tbody></table>` : ''}
${r.notes.length ? `<ul class="notes">${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
<script nonce="${nonce}">
(function(){ const vscode = acquireVsCodeApi();
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest('a.f'); if (a) { ev.preventDefault(); vscode.postMessage({ command: 'open', file: a.dataset.file, line: Number(a.dataset.line || 0), col: Number(a.dataset.col || 0) }); return; }
    const b = ev.target.closest('button[data-cmd]'); if (b) vscode.postMessage({ command: b.dataset.cmd });
  });
}());
</script></body></html>`;
}

export function registerWorkspaceValidation(_context: vscode.ExtensionContext): vscode.Disposable[] {
    const collection = vscode.languages.createDiagnosticCollection('owen-workspace');
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 40);
    status.command = 'owen.validateWorkspace';
    let panel: vscode.WebviewPanel | undefined;
    let lastDoc: vscode.TextDocument | undefined;
    const timers = new Map<string, NodeJS.Timeout>();

    // What the per-file validators already squiggle is not repeated in Problems
    // (the report still lists everything). The OpenMC XML host flags unknown
    // materials/surfaces inside a file; the LSP flags every MCNP reference in a
    // single-file deck.
    const alreadyShown = (r: WorkspaceReport, code: string): boolean => {
        if (r.language === 'openmc-xml') return code === 'workspace.unknown-material' || code === 'workspace.unknown-surface';
        if (r.language === 'mcnp' && r.files.length === 1) return true;
        return false;
    };

    const publish = (r: WorkspaceReport): void => {
        // Replace this project's diagnostics: clear every file that took part, then set.
        const byFile = new Map<string, vscode.Diagnostic[]>();
        for (const f of r.files) byFile.set(path.resolve(f.path), []);
        for (const d of r.diagnostics) {
            if (alreadyShown(r, d.code)) continue;
            const key = path.resolve(d.file);
            const list = byFile.get(key) ?? [];
            const diag = new vscode.Diagnostic(new vscode.Range(d.line, d.startCol, d.line, d.endCol), d.message, SEVERITY[d.severity]);
            diag.source = 'owen-workspace';
            diag.code = d.code;
            list.push(diag);
            byFile.set(key, list);
        }
        for (const [file, diags] of byFile) collection.set(vscode.Uri.file(file), diags);
    };

    const reflect = (r: WorkspaceReport | null): void => {
        if (!r) { status.hide(); return; }
        const s = r.summary;
        status.text = s.errors ? `$(error) OWEN workspace: ${s.errors} error${s.errors === 1 ? '' : 's'}`
            : s.warnings ? `$(warning) OWEN workspace: ${s.warnings} warning${s.warnings === 1 ? '' : 's'}`
            : `$(check) OWEN workspace: ${r.files.length} file${r.files.length === 1 ? '' : 's'} agree`;
        status.tooltip = `${r.verified.length} cross-file checks passed · click for the report`;
        status.show();
    };

    const run = (doc: vscode.TextDocument): WorkspaceReport | null => {
        const language = workspaceLanguageOf(doc);
        if (!language) return null;
        try {
            const r = validateWorkspace(inputFor(doc, language));
            publish(r);
            return r;
        } catch (err) {
            vscode.window.setStatusBarMessage(`OWEN workspace validation failed: ${err instanceof Error ? err.message : String(err)}`, 5000);
            return null;
        }
    };

    const showReport = (r: WorkspaceReport): void => {
        if (!panel) {
            panel = vscode.window.createWebviewPanel(VIEW, 'OWEN: Workspace Validation', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
            panel.onDidDispose(() => { panel = undefined; });
            panel.webview.onDidReceiveMessage(async (msg) => {
                if (msg?.command === 'open' && typeof msg.file === 'string') {
                    const uri = vscode.Uri.file(msg.file);
                    try {
                        const d = await vscode.workspace.openTextDocument(uri);
                        const ed = await vscode.window.showTextDocument(d, { preview: false, viewColumn: vscode.ViewColumn.One });
                        const pos = new vscode.Position(Math.min(msg.line ?? 0, d.lineCount - 1), msg.col ?? 0);
                        ed.selection = new vscode.Selection(pos, pos);
                        ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
                    } catch { vscode.window.setStatusBarMessage(`OWEN: cannot open ${msg.file}`, 3000); }
                } else if (msg?.command === 'rerun' && lastDoc) {
                    const rr = run(lastDoc);
                    if (rr) { reflect(rr); showReport(rr); }
                }
            });
        } else panel.reveal(undefined, true);
        panel.webview.html = workspaceReportHtml(r, panel.webview.cspSource, Math.random().toString(36).slice(2));
    };

    // Live: on open and on save, so cross-file errors appear without asking.
    const schedule = (doc: vscode.TextDocument): void => {
        if (!workspaceLanguageOf(doc)) return;
        const key = doc.uri.toString();
        const prior = timers.get(key);
        if (prior) clearTimeout(prior);
        timers.set(key, setTimeout(() => {
            timers.delete(key);
            const r = run(doc);
            if (vscode.window.activeTextEditor?.document === doc) reflect(r);
        }, 300));
    };

    const onActive = (ed: vscode.TextEditor | undefined): void => {
        if (!ed) { status.hide(); return; }
        lastDoc = ed.document;
        if (!workspaceLanguageOf(ed.document)) { status.hide(); return; }
        schedule(ed.document);
    };
    onActive(vscode.window.activeTextEditor);

    return [
        collection,
        status,
        vscode.commands.registerCommand('owen.validateWorkspace', () => {
            const doc = vscode.window.activeTextEditor?.document;
            if (!doc || !workspaceLanguageOf(doc)) {
                vscode.window.showInformationMessage('OWEN: open a saved MCNP, OpenMC (.py or XML), Serpent or SCONE deck first — the workspace check reads the files next to it.');
                return;
            }
            lastDoc = doc;
            const r = run(doc);
            if (r) { reflect(r); showReport(r); }
        }),
        vscode.window.onDidChangeActiveTextEditor(onActive),
        vscode.workspace.onDidSaveTextDocument(schedule),
        vscode.workspace.onDidOpenTextDocument(schedule),
        { dispose: () => timers.forEach((t) => clearTimeout(t)) },
    ];
}
