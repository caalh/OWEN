/**
 * MC language server entry point, bundled by esbuild to `out/server.js`.
 *
 * `createConnection(ProposedFeatures.all)` auto-detects the transport:
 *   - node IPC when spawned by vscode-languageclient (OWEN's production path);
 *   - stdio when launched as `node out/server.js --stdio` (generic LSP
 *     clients: Sublime LSP, Neovim lspconfig, Emacs eglot, …).
 */

import { createConnection, ProposedFeatures } from 'vscode-languageserver/node';
import { startLanguageServer } from './server';

startLanguageServer(createConnection(ProposedFeatures.all));
