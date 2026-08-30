import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { detectMonteCarloLanguage, type MonteCarloLanguage } from '../util/detectLanguage';
import { parseDeckToModel } from '../preview/engineDispatch';
import { looksLikeOpenmcXml, parseOpenmcGeometryXml } from '../preview/openmcGeometry';
import { exportOpenmcGeometryXml } from '../preview/openmcNative/exportGeometry';
import { buildMcnpReferenceIndex, getDefinition } from '../references/mcnpReferences';
import { isCaptureNoise } from '../preview/openmcNative/captureNoise';
import { buildCellMapFromGeometry } from './fromGeometry';
import { buildCellMap, type CellMapModel } from './model';
import { findCellMapTarget } from './reveal';
import { buildCellMapHtml } from './webview';

const RETHROTTLE_MS = 350;
const OPENMC_EXPORT_THROTTLE_MS = 2000;

function makeNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}

function isMapped(doc: vscode.TextDocument | undefined): doc is vscode.TextDocument {
    if (!doc) return false;
    return detectMonteCarloLanguage(doc) !== null;
}

function languageOf(doc: vscode.TextDocument): MonteCarloLanguage {
    return detectMonteCarloLanguage(doc) ?? 'mcnp';
}

function emptyModel(language: CellMapModel['language'] = 'mcnp'): CellMapModel {
    return {
        language,
        cells: [],
        universes: [],
        edges: [],
        warnings: [],
        stats: { cells: 0, universes: 0, maxDepth: 0, graveyards: 0 },
    };
}

function siblingOpenmcXml(fsPath: string): string | null {
    const dir = path.dirname(fsPath);
    for (const name of ['geometry.xml', 'model.xml']) {
        const p = path.join(dir, name);
        try {
            if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
        } catch { /* ignore unreadable siblings */ }
    }
    return null;
}

function parseCellMap(text: string, language: MonteCarloLanguage): CellMapModel {
    if (language === 'mcnp') return buildCellMap(text);
    if (language === 'openmc') {
        if (looksLikeOpenmcXml(text)) {
            return buildCellMapFromGeometry(parseOpenmcGeometryXml(text), 'openmc');
        }
        const geom = parseDeckToModel(text, 'openmc');
        if (geom && geom.cells.size) return buildCellMapFromGeometry(geom, 'openmc');
        const empty = emptyModel('openmc');
        empty.warnings.push(
            'OpenMC Python decks get a Cell Map from the geometry OpenMC writes. ' +
            'OWEN is loading that the same way Render with OpenMC does.',
        );
        return empty;
    }
    const geom = parseDeckToModel(text, language);
    if (!geom || geom.cells.size === 0) {
        const empty = emptyModel(language);
        empty.warnings.push(`No cells could be parsed from this ${language} deck.`);
        return empty;
    }
    return buildCellMapFromGeometry(geom, language);
}

/**
 * OWEN Cell Map — a flowchart of the cells in the active deck, grouped by
 * universe and wired by fill. Follows the active editor and re-reads on edit.
 */
export class CellMapPanel {
    public static current: CellMapPanel | undefined;
    private static readonly viewType = 'owen.cellMap';

    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _ready = false;
    private _uri: vscode.Uri | undefined;
    private _pending: NodeJS.Timeout | undefined;
    private _openmcGen = 0;

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
            'OWEN: Cell Map',
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

        vscode.window.onDidChangeActiveTextEditor(
            (ed) => { if (isMapped(ed?.document)) this._sync(); },
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
        const lang = languageOf(doc);
        let line = 0, startCol = 0, endCol = 1;
        if (lang === 'mcnp') {
            const def = getDefinition(buildMcnpReferenceIndex(doc.getText()), kind, id);
            if (!def) {
                vscode.window.setStatusBarMessage(`OWEN: no ${kind} ${id} card in this deck`, 3000);
                return;
            }
            line = def.line; startCol = def.startCol; endCol = def.endCol;
        } else {
            const text = doc.getText();
            const hit = findCellMapTarget(text, kind, id);
            if (!hit) {
                vscode.window.setStatusBarMessage(`OWEN: could not find ${kind} ${id} in this file`, 3000);
                return;
            }
            line = hit.line; startCol = hit.start; endCol = hit.end;
        }
        const editor = await vscode.window.showTextDocument(doc, {
            preview: false,
            preserveFocus: false,
            viewColumn: vscode.ViewColumn.One,
        });
        const range = new vscode.Range(line, startCol, line, endCol);
        editor.selection = new vscode.Selection(range.start, range.end);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }

    private _schedule(): void {
        if (this._pending) clearTimeout(this._pending);
        const ms = this._uri && languageOfWait(this._uri) === 'openmc'
            ? OPENMC_EXPORT_THROTTLE_MS
            : RETHROTTLE_MS;
        this._pending = setTimeout(() => { this._pending = undefined; this._sync(); }, ms);
    }

    private _sync(): void {
        if (!this._ready) return;
        const active = vscode.window.activeTextEditor?.document;
        const doc = isMapped(active)
            ? active
            : vscode.workspace.textDocuments.find((d) => this._uri && d.uri.toString() === this._uri.toString());
        if (!doc) {
            this._post(emptyModel(), 'open a Monte Carlo deck');
            return;
        }
        this._uri = doc.uri;
        const lang = languageOf(doc);
        const text = doc.getText();
        let model: CellMapModel;
        try {
            model = parseCellMap(text, lang);
        } catch (err) {
            model = emptyModel(lang);
            model.warnings.push(
                `Could not read this deck: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
        this._post(model, doc.uri.path.split('/').pop() ?? '');

        if (lang === 'openmc' && !looksLikeOpenmcXml(text) && model.cells.length === 0) {
            void this._loadOpenmcXml(doc);
        }
    }

    private async _loadOpenmcXml(doc: vscode.TextDocument): Promise<void> {
        const gen = ++this._openmcGen;
        const sibling = doc.uri.scheme === 'file' ? siblingOpenmcXml(doc.uri.fsPath) : null;
        if (sibling) {
            if (gen !== this._openmcGen) return;
            this._post(
                buildCellMapFromGeometry(parseOpenmcGeometryXml(sibling), 'openmc'),
                doc.uri.path.split('/').pop() ?? '',
            );
            return;
        }
        if (doc.uri.scheme !== 'file') return;
        try {
            const exported = await exportOpenmcGeometryXml(doc.uri.fsPath, doc.uri);
            if (gen !== this._openmcGen) return;
            const xml = `${exported.geometryXml}\n${exported.materialsXml ?? ''}`;
            const model = buildCellMapFromGeometry(parseOpenmcGeometryXml(xml), 'openmc');
            for (const w of exported.warnings) {
                if (isCaptureNoise(w)) continue;
                model.warnings.push(w);
            }
            this._post(model, doc.uri.path.split('/').pop() ?? '');
        } catch (err) {
            if (gen !== this._openmcGen) return;
            const model = emptyModel('openmc');
            model.warnings.push(
                `Could not load OpenMC geometry: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`,
            );
            this._post(model, doc.uri.path.split('/').pop() ?? '');
        }
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

function languageOfWait(_uri: vscode.Uri): MonteCarloLanguage | null {
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === _uri.toString());
    return doc ? languageOf(doc) : null;
}

export { isCaptureNoise } from '../preview/openmcNative/captureNoise';

export function registerCellMap(_context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand('owen.showMcnpCellMap', () => {
        const doc = vscode.window.activeTextEditor?.document;
        if (!isMapped(doc)) {
            vscode.window.showInformationMessage(
                'OWEN: the Cell Map reads MCNP, OpenMC, Serpent or SCONE — open a deck first.',
            );
            return;
        }
        CellMapPanel.show();
    });
}
