import * as vscode from 'vscode';
import { parseMcnpGeometry } from '../preview/mcnpGeometry';
import { preflightMcnp, preflightPanel, volumeReport } from '../mc/preflight';
import { hitArea, rayGrid, renderOrthographic } from '../mc/raycast';

function nonce(): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < 16; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    return out;
}

function revealCell(editor: vscode.TextEditor, cellId: number): void {
    if (cellId <= 0) return;
    const lines = editor.document.getText().split(/\r?\n/);
    const pattern = new RegExp(`^\\s*${cellId}\\s+\\d+\\b`);
    const index = lines.findIndex((line) => pattern.test(line) && !/^\s*c(\s|$)/i.test(line));
    if (index < 0) return;
    const position = new vscode.Position(index, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position));
}

export function registerRenderCsg(): vscode.Disposable {
    return vscode.commands.registerCommand('owen.renderCsg', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('OWEN: open an MCNP deck, then render the geometry.');
            return;
        }
        const text = editor.document.getText();
        let model;
        try {
            model = parseMcnpGeometry(text);
        } catch (err) {
            vscode.window.showErrorMessage(`OWEN: ${err instanceof Error ? err.message : String(err)}`);
            return;
        }
        const view = renderOrthographic(model, {
            origin: [0, 0, 30],
            viewDir: [0, 0, -1],
            uDir: [1, 0, 0],
            vDir: [0, 1, 0],
            halfU: 16,
            halfV: 16,
            width: 64,
            height: 64,
            stepCm: 0.35,
            maxDistanceCm: 70,
        });
        const fuel = hitArea(view, 1);
        const issues = preflightMcnp(text, 600);
        const volumes = volumeReport(model, 2000, 5);
        const token = nonce();
        const panel = vscode.window.createWebviewPanel('owen.renderCsg', 'OWEN: CSG view', vscode.ViewColumn.Beside, { enableScripts: true });
        panel.webview.onDidReceiveMessage((message: { cell?: number }) => {
            if (message && typeof message.cell === 'number') revealCell(editor, message.cell);
        });
        panel.webview.html = `<!DOCTYPE html>
<html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${token}';">
<style>
  body { font-family: sans-serif; padding: 12px; }
  .row { line-height: 0; }
  i { display: inline-block; width: 7px; height: 7px; cursor: pointer; }
  pre { white-space: pre-wrap; }
</style>
</head><body>
<pre>${preflightPanel(issues).replace(/[&<>]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : '&gt;'))}</pre>
<pre>${volumes.replace(/[&<>]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : '&gt;'))}</pre>
<p>Looking down z. Cell 1 silhouette ${fuel.toFixed(1)} cm2. Click a pixel to jump to that cell.</p>
${rayGrid(view)}
<script nonce="${token}">
const vscode = acquireVsCodeApi();
document.body.addEventListener('click', (event) => {
  const node = event.target.closest('[data-cell]');
  if (!node) return;
  vscode.postMessage({ cell: Number(node.dataset.cell) });
});
</script>
</body></html>`;
    });
}
