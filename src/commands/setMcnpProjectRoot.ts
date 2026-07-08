/**
 * OWEN: Set MCNP project root for cross-file workspace validation.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { sendWorkspaceValidationConfig } from '../lsp/client';

export async function setMcnpProjectRoot(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('owen').get<string>('mcnp.projectRoot') ?? '';
    const pick = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Set MCNP Project Root',
        title: 'Select MCNP project root (.inp file or directory)',
        defaultUri: cfg ? vscode.Uri.file(cfg) : vscode.window.activeTextEditor?.document.uri,
        filters: { 'MCNP': ['inp', 'i', 'mcnp'] },
    });
    if (!pick?.length) return;

    const chosen = pick[0].fsPath;
    await vscode.workspace.getConfiguration('owen').update(
        'mcnp.projectRoot',
        chosen,
        vscode.ConfigurationTarget.Workspace,
    );
    await sendWorkspaceValidationConfig();
    const label = path.basename(chosen);
    vscode.window.showInformationMessage(`OWEN: MCNP project root set to ${label}`);
}

export function mcnpProjectRoot(): string {
    return vscode.workspace.getConfiguration('owen').get<string>('mcnp.projectRoot') ?? '';
}

export function workspaceValidationEnabled(): boolean {
    return vscode.workspace.getConfiguration('owen').get<boolean>('mcnp.workspaceValidation.enabled') ?? true;
}

export function workspaceWarnUnused(): boolean {
    return vscode.workspace.getConfiguration('owen').get<boolean>('mcnp.workspaceValidation.warnUnused') ?? false;
}
