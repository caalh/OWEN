import * as vscode from 'vscode';
import { LatticeBuilderPanel } from './panels/latticeBuilder';
import { validateInputFile } from './validation/validator';
import { runSimulation } from './workflows/runner';
import { registerRunSweep } from './workflows/sweep';
import { registerInsertMaterial } from './commands/insertMaterial';
import { registerOpenPrebuiltModel } from './commands/openPrebuiltModel';
import { registerOpenTutorial } from './commands/openTutorial';
import { registerSearchReactorLibrary } from './community/browser';
import { registerGeometryPreview } from './preview/webview';
import { registerSnippetCompletions } from './completions/snippets';
import { registerHighlightPalettes } from './highlight';
import { registerDecorations } from './decorations';
import { registerMcnpReferenceProviders } from './references/providers';
import { registerMcnpReferencesView } from './references/referencesView';
import { openAllenCrossSections } from './allen/panel';

export function activate(context: vscode.ExtensionContext) {
    console.log('OWEN extension activated');

    registerSnippetCompletions(context);
    registerHighlightPalettes(context);
    registerDecorations(context);
    registerMcnpReferenceProviders(context);
    registerMcnpReferencesView(context);

    context.subscriptions.push(
        vscode.commands.registerCommand('owen.openLatticeBuilder', () => {
            LatticeBuilderPanel.createOrShow(context.extensionUri);
        }),

        vscode.commands.registerCommand('owen.openAllen', () => {
            openAllenCrossSections(context.extensionUri);
        }),

        vscode.commands.registerCommand('owen.validateInput', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                validateInputFile(editor.document);
            }
        }),

        vscode.commands.registerCommand('owen.runSimulation', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                runSimulation(editor.document);
            }
        }),

        registerGeometryPreview(context),
        registerSearchReactorLibrary(),
        registerInsertMaterial(context),
        registerOpenPrebuiltModel(context),
        registerOpenTutorial(context),
        registerRunSweep(context),
    );
}

export function deactivate() {}
