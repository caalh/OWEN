import * as vscode from 'vscode';
import { KEFF_DISCLAIMER, runKeffOnText } from '../mc/runKeff';

export function registerRunKeff(): vscode.Disposable {
    return vscode.commands.registerCommand('owen.runKeff', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('OWEN: open an MCNP deck, then run k-eff.');
            return;
        }
        let result;
        try {
            result = runKeffOnText(editor.document.getText());
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`OWEN: ${message}`);
            return;
        }
        const panel = vscode.window.createWebviewPanel('owen.runKeff', 'OWEN: k-eff', vscode.ViewColumn.Beside, {});
        const k = result.k.toFixed(5);
        const sigma = result.sigma.toFixed(5);
        panel.webview.html = `<!DOCTYPE html>
<html><body style="font-family: sans-serif; padding: 16px;">
<h2 style="margin: 0 0 8px;">k-eff ${k} ± ${sigma}</h2>
<p>${result.histories.toLocaleString()} histories, seed 1.</p>
<p>${KEFF_DISCLAIMER}</p>
<p>How to read it: below 1 the shape leaks more than the material multiplies. Shrink the body and this number falls. Mirror walls and reflectors are not in this one-group run.</p>
</body></html>`;
    });
}
