import * as vscode from 'vscode';
import { LatticeBuilderPanel } from './panels/latticeBuilder';
import { InputBuilderPanel } from './panels/inputBuilder';
import { validateInputFile } from './validation/validator';
import { runSimulation } from './workflows/runner';
import { registerRunSweep } from './workflows/sweep';
import { registerViewSweepResults } from './workflows/sweepDashboard';
import { registerConvertDeck } from './converter/command';
import { registerInsertMaterial } from './commands/insertMaterial';
import { registerOpenPrebuiltModel } from './commands/openPrebuiltModel';
import { registerOpenTutorial } from './commands/openTutorial';
import { registerSearchReactorLibrary } from './community/browser';
import { registerGeometryPreview } from './preview/webview';
import { registerOpenmcNativeRender } from './preview/openmcNative/panel';
import { registerVerifyGeometry } from './verify/panel';
import { registerSnippetCompletions } from './completions/snippets';
import { registerHighlightPalettes } from './highlight';
import { registerDecorations } from './decorations';
import { registerMcnpIndexCache } from './references/providers';
import { registerMcnpReferencesView } from './references/referencesView';
import { startLanguageClient, stopLanguageClient } from './lsp/client';
import { openAllenCrossSections } from './allen/panel';
import { openResultsViewer } from './results/panel';
import { setMcnpProjectRoot } from './commands/setMcnpProjectRoot';

export function activate(context: vscode.ExtensionContext) {
    console.log('OWEN extension activated');

    registerSnippetCompletions(context);
    registerHighlightPalettes(context);
    registerDecorations(context);
    registerMcnpIndexCache(context);
    registerMcnpReferencesView(context);

    // Real-time diagnostics + hover/definition/references/highlight/symbols
    // for mcnp/serpent/scone come from the bundled MC language server
    // (out/server.js). The old client-side providers were removed in its
    // favor — see docs/LSP_DESIGN.md.
    startLanguageClient(context);

    context.subscriptions.push(
        vscode.commands.registerCommand('owen.openLatticeBuilder', () => {
            LatticeBuilderPanel.createOrShow(context.extensionUri);
        }),

        vscode.commands.registerCommand('owen.openInputBuilder', () => {
            InputBuilderPanel.createOrShow(context.extensionUri);
        }),

        vscode.commands.registerCommand('owen.openAllen', () => {
            openAllenCrossSections(context.extensionUri);
        }),

        vscode.commands.registerCommand('owen.openResults', () => {
            openResultsViewer(context.extensionUri);
        }),

        vscode.commands.registerCommand('owen.validateInput', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                validateInputFile(editor.document);
            }
        }),

        vscode.commands.registerCommand('owen.setMcnpProjectRoot', () => {
            void setMcnpProjectRoot();
        }),

        vscode.commands.registerCommand('owen.runSimulation', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                runSimulation(editor.document);
            }
        }),

        registerGeometryPreview(context),
        registerOpenmcNativeRender(context),
        registerVerifyGeometry(context),
        registerSearchReactorLibrary(),
        registerInsertMaterial(context),
        registerOpenPrebuiltModel(context),
        registerOpenTutorial(context),
        registerRunSweep(context),
        registerViewSweepResults(context),
        registerConvertDeck(context),
    );
}

export function deactivate(): Promise<void> {
    return stopLanguageClient();
}
