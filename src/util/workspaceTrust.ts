import * as vscode from 'vscode';

/**
 * Commands that spawn a Monte Carlo code or a Python interpreter need a
 * trusted workspace. Cursor/VS Code's "Do you trust the authors of the files
 * in this folder?" dialog is workspace trust — not a Marketplace warning that
 * OWEN itself is unsafe.
 */
export async function requireTrustedWorkspace(feature: string): Promise<boolean> {
    if (vscode.workspace.isTrusted) return true;
    const pick = await vscode.window.showWarningMessage(
        `OWEN needs a trusted workspace to ${feature}. ` +
            'This is VS Code / Cursor workspace trust (the files in this folder), ' +
            'not a warning that the OWEN extension is malicious. ' +
            'Click Trust Workspace & Install if that dialog is still open, or Trust from the Restricted Mode banner.',
        'Manage Workspace Trust',
    );
    if (pick) {
        await vscode.commands.executeCommand('workbench.trust.manage');
    }
    return vscode.workspace.isTrusted;
}
