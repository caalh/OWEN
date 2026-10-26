import * as vscode from 'vscode';
import { certifyPanel } from '../converter/certifyDeck';

export function registerCertifyDeck(): vscode.Disposable {
    return vscode.commands.registerCommand('owen.certifyDeck', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('OWEN: open an MCNP deck, then certify the conversion.');
            return;
        }
        let body: string;
        try {
            body = certifyPanel(editor.document.getText());
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`OWEN: ${message}`);
            return;
        }
        const panel = vscode.window.createWebviewPanel('owen.certifyDeck', 'OWEN: certify', vscode.ViewColumn.Beside, {});
        const escaped = body.replace(/[&<>]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : '&gt;'));
        panel.webview.html = `<!DOCTYPE html><html><body style="font-family: sans-serif; padding: 16px; white-space: pre-wrap;">${escaped}</body></html>`;
    });
}
