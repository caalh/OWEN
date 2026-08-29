import * as vscode from 'vscode';
import { checkDeck, summarizeChecks } from '../inputBuilder/deckChecks';
import { buildDeckDocument, type DeckModel } from '../inputBuilder/deckModel';
import { MATERIAL_LIBRARY } from '../inputBuilder/materials';
import { searchPnnlMaterials, findPnnlMaterial, loadPnnlDataset } from '../inputBuilder/pnnlData';
import { SAB_OPTIONS, SURFACE_TEMPLATES } from '../inputBuilder/wizards';
import {
    isSingleMcnpMaterialBlock,
    nextMcnpMaterialNumber,
    remapMcnpMaterialCard,
} from '../references/mcnpReferences';
import { inputBuilderWebviewHtml } from './inputBuilderWebview';

/**
 * Host side of the Input Builder.
 *
 * The webview owns the section model and the forms; this class owns code
 * generation, the checks, and everything that touches the editor. On every edit
 * the webview posts its model, and the host answers with the assembled deck,
 * the per-line provenance the split view highlights with, and the check list.
 */
export class InputBuilderPanel {
    public static currentPanel: InputBuilderPanel | undefined;
    private static readonly viewType = 'owen.inputBuilder';
    private static _pendingFocus: string | undefined;

    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _targetEditor: vscode.TextEditor | undefined;

    public static createOrShow(extensionUri: vscode.Uri, options?: { focusTab?: string }) {
        const activeEditor = vscode.window.activeTextEditor;
        const column = activeEditor ? activeEditor.viewColumn : undefined;

        if (options?.focusTab) InputBuilderPanel._pendingFocus = options.focusTab;

        if (InputBuilderPanel.currentPanel) {
            if (activeEditor) InputBuilderPanel.currentPanel._targetEditor = activeEditor;
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
        if (!InputBuilderPanel._pendingFocus) return;
        this._panel.webview.postMessage({ command: 'focusSection', tab: InputBuilderPanel._pendingFocus });
    }

    private constructor(panel: vscode.WebviewPanel, _extensionUri: vscode.Uri) {
        this._panel = panel;
        this._panel.webview.html = inputBuilderWebviewHtml(this._injectedScript(), MATERIAL_LIBRARY.length);

        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor) this._targetEditor = editor;
        }, null, this._disposables);

        this._panel.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.command) {
                case 'model':
                    this._sendDocument(msg.model as DeckModel);
                    break;
                case 'insert':
                    await this._insertCode(this._autoNumberMcnpMaterial(String(msg.text ?? '')));
                    break;
                case 'exportWithErrors': {
                    const count = Number(msg.errors ?? 0);
                    const pick = await vscode.window.showWarningMessage(
                        `The deck has ${count} problem${count === 1 ? '' : 's'} that will stop the run.`,
                        { modal: true },
                        'Continue anyway',
                    );
                    if (pick === 'Continue anyway') {
                        await this._exportDeck(String(msg.then ?? 'insert'), msg);
                    }
                    break;
                }
                case 'newFile':
                    await this._newFile(String(msg.text ?? ''), String(msg.codeLang ?? 'mcnp'));
                    break;
                case 'copy':
                    await vscode.env.clipboard.writeText(String(msg.text ?? ''));
                    vscode.window.setStatusBarMessage('OWEN: deck copied to the clipboard', 2500);
                    break;
                case 'pnnlSearch': {
                    const results = searchPnnlMaterials(String(msg.query ?? ''), 50);
                    const total = loadPnnlDataset()?.materials.length ?? 0;
                    this._panel.webview.postMessage({
                        command: 'pnnlResults', results, total, sectionId: msg.sectionId,
                    });
                    break;
                }
                case 'pnnlAdd': {
                    const material = findPnnlMaterial(String(msg.id ?? ''));
                    if (material) {
                        this._panel.webview.postMessage({
                            command: 'pnnlMaterial', material, sectionId: msg.sectionId,
                        });
                    }
                    break;
                }
                case 'clientError': {
                    const where = Number(msg.line ?? 0) > 0 ? ` (line ${msg.line})` : '';
                    vscode.window.showErrorMessage(
                        `OWEN Input Builder hit an error and may have stopped updating${where}: ${String(msg.message ?? '')}`,
                    );
                    break;
                }
                case 'ready':
                    this._applyPendingFocus();
                    break;
                case 'focusAck':
                    InputBuilderPanel._pendingFocus = undefined;
                    break;
            }
        }, null, this._disposables);

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    /** Assemble, check, and hand the whole result back for rendering. */
    private _sendDocument(model: DeckModel) {
        let doc;
        let checks;
        try {
            doc = buildDeckDocument(model);
            checks = checkDeck(model, doc);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this._panel.webview.postMessage({
                command: 'document',
                text: '', lines: [], owners: [], sections: [],
                counts: { materials: 0, surfaces: 0, cells: 0, lattices: 0, tallies: 0 },
                checks: [{ severity: 'error', origin: 'model', message: `Input Builder could not assemble the deck: ${message}` }],
            });
            return;
        }
        const summary = summarizeChecks(checks);
        this._panel.webview.postMessage({
            command: 'document',
            text: doc.text,
            lines: doc.lines,
            owners: doc.owners,
            sections: doc.sections,
            counts: doc.counts,
            checks,
            summary,
        });
    }

    private _editorTextForMaterialNumbering(): string {
        const editor = vscode.window.activeTextEditor ?? this._targetEditor;
        return editor?.document.getText() ?? '';
    }

    /** Renumber a lone MCNP material card to the next free m-id in the target deck. */
    private _autoNumberMcnpMaterial(code: string): string {
        if (!isSingleMcnpMaterialBlock(code)) return code;
        const nextNum = nextMcnpMaterialNumber(this._editorTextForMaterialNumbering());
        return remapMcnpMaterialCard(code, nextNum);
    }

    private async _exportDeck(then: string, msg: { text?: string; codeLang?: string }) {
        const text = String(msg.text ?? '');
        if (then === 'insert') await this._insertCode(this._autoNumberMcnpMaterial(text));
        else if (then === 'newFile') await this._newFile(text, String(msg.codeLang ?? 'mcnp'));
        else if (then === 'copy') {
            await vscode.env.clipboard.writeText(text);
            vscode.window.setStatusBarMessage('OWEN: deck copied to the clipboard', 2500);
        }
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

    private _injectedScript(): string {
        return [
            `const MATERIAL_LIBRARY = ${JSON.stringify(MATERIAL_LIBRARY)};`,
            `const SAB_OPTIONS = ${JSON.stringify(SAB_OPTIONS)};`,
            `const SURFACE_TEMPLATES = ${JSON.stringify(SURFACE_TEMPLATES)};`,
        ].join('\n');
    }
}
