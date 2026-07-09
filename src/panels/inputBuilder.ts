import * as vscode from 'vscode';
import {
    buildDeck,
    DEFAULT_SETTINGS,
    type InputBuilderState,
} from '../inputBuilder/deckBuilder';
import { MATERIAL_LIBRARY, type MonteCarloCode } from '../inputBuilder/materials';
import { searchPnnlMaterials, findPnnlMaterial, loadPnnlDataset } from '../inputBuilder/pnnlData';
import { formatValidationSummary, validateSnippet } from '../inputBuilder/snippetValidator';
import {
    INPUT_BUILDER_TEMPLATES,
    SAB_OPTIONS,
    SURFACE_TEMPLATES,
    cellWizardCard,
    latticeWizardCard,
    materialWizardCard,
    settingsWizardCard,
    sourceWizardCard,
    surfaceWizardCard,
    type CellWizardInput,
    type LatticeWizardInput,
    type MaterialWizardInput,
    type SettingsWizardInput,
    type SourceWizardInput,
    type SurfaceWizardInput,
} from '../inputBuilder/wizards';
import {
    genMCNP,
    genOpenMC,
    genSerpent,
    genSCONE,
    defaultPinTypes,
    defaultStructuralIds,
    type LatticeSpec,
} from './latticeCodegen';
import { inputBuilderWebviewHtml } from './inputBuilderWebview';

export class InputBuilderPanel {
    public static currentPanel: InputBuilderPanel | undefined;
    private static readonly viewType = 'owen.inputBuilder';
    private static _pendingFocusTab: string | undefined;

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _targetEditor: vscode.TextEditor | undefined;

    public static createOrShow(extensionUri: vscode.Uri, options?: { focusTab?: string }) {
        const activeEditor = vscode.window.activeTextEditor;
        const column = activeEditor ? activeEditor.viewColumn : undefined;

        if (options?.focusTab) {
            InputBuilderPanel._pendingFocusTab = options.focusTab;
        }

        if (InputBuilderPanel.currentPanel) {
            if (activeEditor) {
                InputBuilderPanel.currentPanel._targetEditor = activeEditor;
            }
            InputBuilderPanel.currentPanel._panel.reveal(column);
            InputBuilderPanel.currentPanel._applyPendingFocus();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            InputBuilderPanel.viewType,
            'OWEN Input Builder',
            column || vscode.ViewColumn.Beside,
            { enableScripts: true, retainContextWhenHidden: true },
        );

        InputBuilderPanel.currentPanel = new InputBuilderPanel(panel, extensionUri);
        InputBuilderPanel.currentPanel._targetEditor = activeEditor;
        InputBuilderPanel.currentPanel._applyPendingFocus();
    }

    private _applyPendingFocus() {
        const tab = InputBuilderPanel._pendingFocusTab;
        if (!tab) return;
        this._panel.webview.postMessage({ command: 'focusTab', tab });
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._panel.webview.html = this._getHtml();

        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor) this._targetEditor = editor;
        }, null, this._disposables);

        this._panel.webview.onDidReceiveMessage(async (msg) => {
            if (msg.command === 'preview') {
                const code = buildDeck(msg.state as InputBuilderState);
                const issues = validateSnippet((msg.state as InputBuilderState).code, code);
                this._panel.webview.postMessage({
                    command: 'previewResult',
                    code,
                    validation: issues,
                    validationSummary: formatValidationSummary(issues),
                });
            } else if (msg.command === 'wizardPreview') {
                const code = this._buildWizardSnippet(msg.wizard, msg.state);
                const lang = String(msg.state?.code ?? 'mcnp') as MonteCarloCode;
                const issues = validateSnippet(lang, code);
                this._panel.webview.postMessage({
                    command: 'wizardPreviewResult',
                    code,
                    validation: issues,
                    validationSummary: formatValidationSummary(issues),
                });
            } else if (msg.command === 'latticePreview') {
                const spec = msg.spec as LatticeSpec;
                const lang = String(msg.code ?? 'mcnp') as MonteCarloCode;
                const code = this._latticeCode(lang, spec);
                const issues = validateSnippet(lang, code);
                this._panel.webview.postMessage({
                    command: 'wizardPreviewResult',
                    code,
                    validation: issues,
                    validationSummary: formatValidationSummary(issues),
                });
            } else if (msg.command === 'insertCode') {
                const code = msg.code || buildDeck(msg.state as InputBuilderState);
                await this._insertCode(code);
            } else if (msg.command === 'newFile') {
                const code = msg.code || buildDeck(msg.state as InputBuilderState);
                await this._newFile(code, msg.codeLang);
            } else if (msg.command === 'ready' || msg.command === 'focusAck') {
                if (msg.command === 'focusAck') {
                    InputBuilderPanel._pendingFocusTab = undefined;
                }
                this._applyPendingFocus();
            } else if (msg.command === 'pnnlSearch') {
                const results = searchPnnlMaterials(String(msg.query ?? ''), 50);
                const total = loadPnnlDataset()?.materials.length ?? 0;
                this._panel.webview.postMessage({ command: 'pnnlResults', results, total });
            } else if (msg.command === 'pnnlAdd') {
                const mat = findPnnlMaterial(String(msg.id ?? ''));
                if (mat) {
                    this._panel.webview.postMessage({ command: 'pnnlMaterial', material: mat });
                }
            }
        }, null, this._disposables);

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    private async _insertCode(code: string) {
        let editor = vscode.window.activeTextEditor ?? await this._reopenTargetEditor();
        if (!editor) {
            const doc = await vscode.workspace.openTextDocument({ content: '' });
            editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
        }
        this._targetEditor = editor;
        const pos = editor.selection.active;
        await editor.edit((eb) => eb.insert(pos, code));
    }

    private async _newFile(code: string, codeLang: string) {
        const extMap: Record<string, string> = {
            mcnp: 'i', openmc: 'py', serpent: 'sss', scone: 'scone',
        };
        const ext = extMap[codeLang] || 'txt';
        const doc = await vscode.workspace.openTextDocument({
            content: code,
            language: codeLang === 'openmc' ? 'python' : codeLang,
        });
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    }

    private async _reopenTargetEditor(): Promise<vscode.TextEditor | undefined> {
        const doc = this._targetEditor?.document;
        if (!doc || doc.isClosed) return undefined;
        return vscode.window.showTextDocument(doc, this._targetEditor?.viewColumn, false);
    }

    public dispose() {
        InputBuilderPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) d.dispose();
        }
    }

    private _latticeCode(code: MonteCarloCode, spec: LatticeSpec): string {
        switch (code) {
            case 'mcnp': return genMCNP(spec) + '\n';
            case 'openmc': return genOpenMC(spec) + '\n';
            case 'serpent': return genSerpent(spec) + '\n';
            case 'scone': return genSCONE(spec) + '\n';
            default: return genMCNP(spec) + '\n';
        }
    }

    private _buildWizardSnippet(wizard: string, state: Record<string, unknown>): string {
        switch (wizard) {
            case 'material':
                return materialWizardCard(state as unknown as MaterialWizardInput) + '\n';
            case 'surface':
                return surfaceWizardCard(state as unknown as SurfaceWizardInput) + '\n';
            case 'cell':
                return cellWizardCard(state as unknown as CellWizardInput) + '\n';
            case 'lattice':
                return latticeWizardCard(state as unknown as LatticeWizardInput) + '\n';
            case 'source':
                return sourceWizardCard(state as unknown as SourceWizardInput) + '\n';
            case 'settings':
                return settingsWizardCard(state as unknown as SettingsWizardInput) + '\n';
            default:
                return `c unknown wizard: ${wizard}\n`;
        }
    }

    private _injectedScript(): string {
        return [
            'const MATERIAL_LIBRARY = ' + JSON.stringify(MATERIAL_LIBRARY) + ';',
            'const DEFAULT_SETTINGS = ' + JSON.stringify(DEFAULT_SETTINGS) + ';',
            'const DEFAULT_PINS = ' + JSON.stringify(defaultPinTypes()) + ';',
            'const DEFAULT_STRUCT = ' + JSON.stringify(defaultStructuralIds()) + ';',
            'const genMCNP = ' + genMCNP.toString() + ';',
            'const genOpenMC = ' + genOpenMC.toString() + ';',
            'const genSerpent = ' + genSerpent.toString() + ';',
            'const genSCONE = ' + genSCONE.toString() + ';',
            'const INPUT_BUILDER_TEMPLATES = ' + JSON.stringify(INPUT_BUILDER_TEMPLATES) + ';',
            'const SAB_OPTIONS = ' + JSON.stringify(SAB_OPTIONS) + ';',
            'const SURFACE_TEMPLATES = ' + JSON.stringify(SURFACE_TEMPLATES) + ';',
        ].join('\n');
    }

    private _getHtml(): string {
        return inputBuilderWebviewHtml(this._injectedScript(), MATERIAL_LIBRARY.length);
    }
}
