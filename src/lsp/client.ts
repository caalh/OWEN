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

let client: LanguageClient | undefined;

function mcnpLineLimit(): number | undefined {
    const n = vscode.workspace.getConfiguration('owen').get<number>('mcnp.lineLengthLimit');
    return typeof n === 'number' && n > 0 ? Math.floor(n) : undefined;
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
        },
    };

    client = new LanguageClient('owenMcLanguageServer', 'OWEN MC Language Server', serverOptions, clientOptions);
    void client.start();

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('owen.mcnp.lineLengthLimit') && client) {
                void client.sendNotification('workspace/didChangeConfiguration', {
                    settings: { owen: { mcnp: { lineLengthLimit: mcnpLineLimit() } } },
                });
            }
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
