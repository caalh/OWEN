import * as vscode from 'vscode';
import { preflightMcnp, preflightPanel } from '../mc/preflight';

export function registerPreflightGeometry(): vscode.Disposable {
    return vscode.commands.registerCommand('owen.preflightGeometry', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('OWEN: open an MCNP deck, then run the geometry preflight.');
            return;
        }
        let body: string;
        try {
            body = preflightPanel(preflightMcnp(editor.document.getText()));
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`OWEN: ${message}`);
            return;
        }
        const panel = vscode.window.createWebviewPanel('owen.preflightGeometry', 'OWEN: preflight', vscode.ViewColumn.Beside, {});
        const escaped = body.replace(/[&<>]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : '&gt;'));
        panel.webview.html = `<!DOCTYPE html><html><body style="font-family: sans-serif; padding: 16px; white-space: pre-wrap;">${escaped}</body></html>`;
    });
}
