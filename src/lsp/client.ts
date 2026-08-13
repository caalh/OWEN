/**
 * OWEN's LSP client: launches the bundled MC language server (out/server.js)
 * over node IPC for MCNP, Serpent and SCONE documents.
 *
 * OpenMC (.py) deliberately stays out of the selector — Pylance owns Python;
 * OWEN's OpenMC gotcha rules remain available through the manual
 * `owen.validateInput` command (see docs/LSP_DESIGN.md).
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';
import {
    mcnpProjectRoot,
    workspaceValidationEnabled,
    workspaceWarnUnused,
} from '../commands/setMcnpProjectRoot';
import { lineLimitSettings } from '../decorations/mcnpLineGuard';

let client: LanguageClient | undefined;

function mcnpLineLimit(): number | undefined {
    return lineLimitSettings().customLimit;
}

/** owen.mcnp.dialect, only when the user explicitly set it (undefined keeps
 *  the server on legacy resolution for pre-dialect configs). */
function mcnpDialect(): string | undefined {
    return lineLimitSettings().dialect;
}

function workspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function buildWorkspaceSettings() {
    return {
        owen: {
            mcnp: {
                lineLengthLimit: mcnpLineLimit(),
                // null (not undefined) so JSON keeps the key and the server can
                // tell "cleared" apart from "not mentioned".
                dialect: mcnpDialect() ?? null,
                projectRoot: mcnpProjectRoot(),
                workspaceValidation: {
                    enabled: workspaceValidationEnabled(),
                    warnUnused: workspaceWarnUnused(),
                },
            },
        },
    };
}

export async function sendWorkspaceValidationConfig(): Promise<void> {
    if (!client) return;
    await client.sendNotification('workspace/didChangeConfiguration', {
        settings: buildWorkspaceSettings(),
    });
}

export function startLanguageClient(context: vscode.ExtensionContext): void {
    const serverModule = context.asAbsolutePath(path.join('out', 'server.js'));

    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: { execArgv: ['--nolazy', '--inspect=6009'] },
        },
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [
            { language: 'mcnp' },
            { language: 'serpent' },
            { language: 'scone' },
        ],
        initializationOptions: {
            mcnpLineLimit: mcnpLineLimit(),
            mcnpDialect: mcnpDialect(),
            workspaceRoot: workspaceRoot(),
            workspaceValidation: {
                enabled: workspaceValidationEnabled(),
                projectRoot: mcnpProjectRoot(),
                warnUnused: workspaceWarnUnused(),
            },
        },
    };

    client = new LanguageClient('owenMcLanguageServer', 'OWEN MC Language Server', serverOptions, clientOptions);
    void client.start();

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (
                e.affectsConfiguration('owen.mcnp.lineLengthLimit')
                || e.affectsConfiguration('owen.mcnp.dialect')
                || e.affectsConfiguration('owen.mcnp.projectRoot')
                || e.affectsConfiguration('owen.mcnp.workspaceValidation')
            ) {
                void sendWorkspaceValidationConfig();
            }
        }),
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            void sendWorkspaceValidationConfig();
        }),
        { dispose: () => void stopLanguageClient() },
    );
}

export async function stopLanguageClient(): Promise<void> {
    if (client) {
        const c = client;
        client = undefined;
        await c.stop();
    }
}
