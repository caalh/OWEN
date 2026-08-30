import * as vscode from 'vscode';
import { buildCellMap, type CellMapModel } from './model';
import { buildCellMapHtml } from './webview';
import { buildMcnpReferenceIndex, getDefinition } from '../references/mcnpReferences';

const RETHROTTLE_MS = 350;

function makeNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}

function isMcnp(doc: vscode.TextDocument | undefined): doc is vscode.TextDocument {
    return !!doc && doc.languageId === 'mcnp';
}

/**
 * OWEN: MCNP Cell Map — a flowchart of the cells in the active deck, grouped by
 * universe and wired by `fill=`. Follows the active editor and re-reads on
 * edit, so it behaves like a view of the deck rather than a snapshot of it.
 */
export class CellMapPanel {
    public static current: CellMapPanel | undefined;
    private static readonly viewType = 'owen.cellMap';

    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _ready = false;
    private _uri: vscode.Uri | undefined;
    private _pending: NodeJS.Timeout | undefined;

    public static show(): void {
        const column = vscode.window.activeTextEditor
            ? vscode.ViewColumn.Beside
            : vscode.ViewColumn.One;

        if (CellMapPanel.current) {
            CellMapPanel.current._panel.reveal(column, true);
            CellMapPanel.current._sync();
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            CellMapPanel.viewType,
            'OWEN: MCNP Cell Map',
            { viewColumn: column, preserveFocus: true },
            { enableScripts: true, retainContextWhenHidden: true },
        );
        CellMapPanel.current = new CellMapPanel(panel);
    }

    private constructor(panel: vscode.WebviewPanel) {
        this._panel = panel;
        this._panel.webview.html = buildCellMapHtml(this._panel.webview.cspSource, makeNonce());

        this._panel.webview.onDidReceiveMessage(
            (msg) => this._onMessage(msg),
            null,
            this._disposables,
        );
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Follow the active MCNP editor, but hold the last deck when focus moves
        // to the panel itself or to an unrelated file — otherwise clicking a
        // cell would blank the map that was just clicked.
        vscode.window.onDidChangeActiveTextEditor(
            (ed) => { if (isMcnp(ed?.document)) this._sync(); },
            null,
            this._disposables,
        );
        vscode.workspace.onDidChangeTextDocument(
            (ev) => { if (this._uri && ev.document.uri.toString() === this._uri.toString()) this._schedule(); },
            null,
            this._disposables,
        );
    }

    private _onMessage(msg: { command?: string; id?: number }): void {
        if (msg?.command === 'ready') {
            this._ready = true;
            this._sync();
            return;
        }
        if (msg?.command === 'revealCell' && typeof msg.id === 'number') {
            void this._reveal('cell', msg.id);
        } else if (msg?.command === 'revealSurface' && typeof msg.id === 'number') {
            void this._reveal('surface', msg.id);
        }
    }

    private async _reveal(kind: 'cell' | 'surface', id: number): Promise<void> {
        if (!this._uri) return;
        const doc = await vscode.workspace.openTextDocument(this._uri);
        const def = getDefinition(buildMcnpReferenceIndex(doc.getText()), kind, id);
        if (!def) {
            vscode.window.setStatusBarMessage(`OWEN: no ${kind} ${id} card in this deck`, 3000);
            return;
        }
        const editor = await vscode.window.showTextDocument(doc, {
            preview: false,
            preserveFocus: false,
            viewColumn: vscode.ViewColumn.One,
        });
        const range = new vscode.Range(def.line, def.startCol, def.line, def.endCol);
        editor.selection = new vscode.Selection(range.start, range.end);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }

    private _schedule(): void {
        if (this._pending) clearTimeout(this._pending);
        this._pending = setTimeout(() => { this._pending = undefined; this._sync(); }, RETHROTTLE_MS);
    }

    private _sync(): void {
        if (!this._ready) return;
        const active = vscode.window.activeTextEditor?.document;
        const doc = isMcnp(active)
            ? active
            : vscode.workspace.textDocuments.find((d) => this._uri && d.uri.toString() === this._uri.toString());
        if (!doc) {
            this._post(emptyModel(), 'open an MCNP deck');
            return;
        }
        this._uri = doc.uri;
        let model: CellMapModel;
        try {
            model = buildCellMap(doc.getText());
        } catch (err) {
            model = emptyModel();
            model.warnings.push(
                `Could not read this deck: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
        this._post(model, doc.uri.path.split('/').pop() ?? '');
    }

    private _post(model: CellMapModel, fileName: string): void {
        void this._panel.webview.postMessage({ type: 'model', model, fileName });
    }

    public dispose(): void {
        CellMapPanel.current = undefined;
        if (this._pending) clearTimeout(this._pending);
        this._panel.dispose();
        while (this._disposables.length) this._disposables.pop()?.dispose();
    }
}

function emptyModel(): CellMapModel {
    return {
        cells: [],
        universes: [],
        edges: [],
        warnings: [],
        stats: { cells: 0, universes: 0, maxDepth: 0, graveyards: 0 },
    };
}

export function registerCellMap(_context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand('owen.showMcnpCellMap', () => {
        const doc = vscode.window.activeTextEditor?.document;
        if (!isMcnp(doc)) {
            vscode.window.showInformationMessage(
                'OWEN: the Cell Map reads MCNP cell cards — open an MCNP deck first.',
            );
            return;
        }
        CellMapPanel.show();
    });
}
