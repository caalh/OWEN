import * as vscode from 'vscode';
import { conversionTodos } from '../converter/conversionReport';

export function registerConvertAndCompare(): vscode.Disposable {
    return vscode.commands.registerCommand('owen.convertAndCompare', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('OWEN: open an MCNP deck, then compare the conversion.');
            return;
        }
        const todos = conversionTodos(editor.document.getText());
        const detail = todos.length
            ? `${todos.length} construct(s) were not converted: ${todos[0].replace(/^#\s*/, '')}`
            : 'No TODO marks. This command does not run OpenMC; the site gate verify:convert-openmc does, on the Godiva sphere.';
        vscode.window.showInformationMessage(`OWEN: ${detail}`);
    });
}
