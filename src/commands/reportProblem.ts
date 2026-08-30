import * as vscode from 'vscode';

const HELP_EMAIL = 'help@reactormc.net';
const MAILTO =
    'mailto:help@reactormc.net?subject=OWEN%20bug%20report&body=' +
    encodeURIComponent(
        'Describe what you expected, what happened, and which code (MCNP / OpenMC / Serpent / SCONE).\n\n' +
        'Paste the relevant cards or a short excerpt as plain text in this email. ' +
        'Do not attach files — decks, screenshots, and archives are refused so this inbox cannot be used to deliver malware.\n\n',
    );

const DIALOG =
    `Found a bug or a problem in OWEN? Email ${HELP_EMAIL} as plain text: what you expected, what happened, and which code. ` +
    'Do not attach files — paste a short excerpt of the deck instead.';

/**
 * OWEN beaker-menu / command-palette entry that points people at
 * help@reactormc.net instead of leaving them to guess where to write.
 */
export function registerReportProblem(_context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand('owen.reportProblem', async () => {
        const pick = await vscode.window.showInformationMessage(
            DIALOG,
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
