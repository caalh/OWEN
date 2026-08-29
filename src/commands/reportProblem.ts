import * as vscode from 'vscode';

const HELP_EMAIL = 'help@reactormc.net';
const MAILTO =
    'mailto:help@reactormc.net?subject=OWEN%20bug%20report&body=' +
    encodeURIComponent(
        'Describe what you expected, what happened, which code (MCNP / OpenMC / Serpent / SCONE), and attach or paste a short deck if you can.\n\n',
    );

/**
 * OWEN beaker-menu / command-palette entry that points people at
 * help@reactormc.net instead of leaving them to guess where to write.
 */
export function registerReportProblem(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand('owen.reportProblem', async () => {
        const pick = await vscode.window.showInformationMessage(
            `Found a bug or a problem in OWEN? Email ${HELP_EMAIL} with the deck, the code, and what you expected to see.`,
            'Open email',
            'Copy address',
        );
        if (pick === 'Open email') {
            await vscode.env.openExternal(vscode.Uri.parse(MAILTO));
        } else if (pick === 'Copy address') {
            await vscode.env.clipboard.writeText(HELP_EMAIL);
            vscode.window.setStatusBarMessage(`OWEN: copied ${HELP_EMAIL}`, 4000);
        }
    });
}
