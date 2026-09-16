import * as vscode from 'vscode';
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
import { registerOpenCommunityLibrary } from './community/openWeb';
import { registerGeometryPreview } from './preview/webview';
import { registerOpenmcNativeRender } from './preview/openmcNative/panel';
import { registerVerifyGeometry } from './verify/panel';
import { registerSnippetCompletions } from './completions/snippets';
import { registerHighlightPalettes } from './highlight';
import { registerDecorations } from './decorations';
import { registerMcnpIndexCache } from './references/providers';
import { registerMcnpReferencesView } from './references/referencesView';
import { startLanguageClient, stopLanguageClient } from './lsp/client';
import { registerOpenmcXmlDiagnostics } from './language/openmcXmlHost';
import { registerOpenmcHover } from './language/openmcHover';
import { registerConvertDeckAdapter } from './converter/adapterCommand';
import { openAllenCrossSections } from './allen/panel';
import { openResultsViewer } from './results/panel';
import { setMcnpProjectRoot } from './commands/setMcnpProjectRoot';
import { registerReportProblem } from './commands/reportProblem';
import { registerOpenReference } from './commands/openReference';
import { registerCellMap } from './cellmap/panel';
import { registerGeometryTools } from './geomcheck/panel';
import { registerCompareTools } from './compare/panel';
import { registerWorkspaceValidation } from './workspace/panel';

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

    // OpenMC XML (materials/geometry/settings/tallies/model.xml) carries
    // languageId "xml", so it bypasses the LSP; the host validates it directly.
    registerOpenmcXmlDiagnostics(context);
    // Nuclide hover for OpenMC Python decks (the LSP covers mcnp/serpent/scone).
    registerOpenmcHover(context);

    context.subscriptions.push(
        vscode.commands.registerCommand('owen.openLatticeBuilder', () => {
            InputBuilderPanel.createOrShow(context.extensionUri, { focusTab: 'lattice' });
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

        // Explorer / editor right-click on a run output (mctal, outp, statepoint
        // .h5, Serpent _res.m/_his.m/_det.m, SCONE .out): open it directly.
        vscode.commands.registerCommand('owen.openResultsFile', async (uri?: vscode.Uri) => {
            const target = uri instanceof vscode.Uri && uri.scheme === 'file'
                ? uri
                : vscode.window.activeTextEditor?.document.uri;
            try {
                await openResultsViewer(
                    context.extensionUri,
                    target?.scheme === 'file' ? { filePath: target.fsPath } : undefined,
                );
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                vscode.window.showErrorMessage(`OWEN Results: ${message}`);
            }
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

        vscode.commands.registerCommand('owen.runSimulation', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                await runSimulation(editor.document);
            }
        }),
        registerReportProblem(context),
        registerOpenReference(context),
        registerCellMap(context),
        ...registerGeometryTools(),
        ...registerCompareTools(),
        ...registerWorkspaceValidation(context),

        registerGeometryPreview(context),
        registerOpenmcNativeRender(context),
        registerVerifyGeometry(context),
        registerSearchReactorLibrary(),
        registerOpenCommunityLibrary(),
        registerInsertMaterial(context),
        registerOpenPrebuiltModel(context),
        registerOpenTutorial(context),
        registerRunSweep(context),
        registerViewSweepResults(context),
        registerConvertDeck(context),
        registerConvertDeckAdapter(context),
    );
}

export function deactivate(): Promise<void> {
    return stopLanguageClient();
}
