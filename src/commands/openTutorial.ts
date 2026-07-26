import * as vscode from 'vscode';
import { TutorialSearchPanel } from '../tutorials/panel';

export function registerOpenTutorial(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand('owen.openTutorial', async () => {
        await TutorialSearchPanel.createOrShow(context.extensionUri);
    });
}
