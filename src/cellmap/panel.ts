import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { detectMonteCarloLanguage, type MonteCarloLanguage } from '../util/detectLanguage';
import { deckSourceOf, notebookOfCell } from '../util/deckSource';
import { parseDeckToModel } from '../preview/engineDispatch';
import { looksLikeOpenmcXml, parseOpenmcGeometryXml } from '../preview/openmcGeometry';
import { exportOpenmcGeometryXml } from '../preview/openmcNative/exportGeometry';
import { isCaptureNoise } from '../preview/openmcNative/captureNoise';
import { buildCellMapFromGeometry } from './fromGeometry';
import { buildCellMap, type CellMapModel } from './model';
import { pickDeck } from './pickDeck';
import { revealDeckTarget } from './revealInEditor';
import { buildCellMapHtml } from './webview';

type CellMapLocation = 'newWindow' | 'beside' | 'activeGroup';

function configuredLocation(): CellMapLocation | 'ask' {
    const raw = vscode.workspace.getConfiguration('owen').get<string>('cellMap.openIn');
    return raw === 'beside' || raw === 'activeGroup' || raw === 'newWindow' ? raw : 'ask';
}

/**
 * Where should the map go this time? Asked on every open unless
 * `owen.cellMap.openIn` pins an answer; the last item in the pick offers to
 * pin it. Returns undefined when the pick is dismissed.
 */
export async function pickLocation(): Promise<CellMapLocation | undefined> {
    const configured = configuredLocation();
    if (configured !== 'ask') return configured;
    type Item = vscode.QuickPickItem & { location: CellMapLocation; remember?: boolean };
    const items: Item[] = [
        { label: '$(multiple-windows) New window', description: 'floating window you can drag to a second monitor', location: 'newWindow' },
        { label: '$(split-horizontal) Tab beside the deck', description: 'split editor in this window', location: 'beside' },
        { label: '$(window) Tab in this group', description: 'replaces the deck in view; switch tabs to go back', location: 'activeGroup' },
        { label: '', kind: vscode.QuickPickItemKind.Separator, location: 'beside' },
        { label: '$(pin) Always use a new window', description: 'sets owen.cellMap.openIn', location: 'newWindow', remember: true },
        { label: '$(pin) Always open beside the deck', description: 'sets owen.cellMap.openIn', location: 'beside', remember: true },
    ];
    const pick = await vscode.window.showQuickPick(items, {
        title: 'OWEN Cell Map',
        placeHolder: 'Open the Cell Map where?',
    });
    if (!pick) return undefined;
    if (pick.remember) {
        await vscode.workspace.getConfiguration('owen').update(
            'cellMap.openIn', pick.location, vscode.ConfigurationTarget.Global,
        );
    }
    return pick.location;
}

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
    return deckSourceOf(doc) !== null;
}

function languageOf(doc: vscode.TextDocument): MonteCarloLanguage {
    return deckSourceOf(doc)?.language ?? detectMonteCarloLanguage(doc) ?? 'mcnp';
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
    /** Public for the tab-group scan in `deckColumn`. */
    public static get viewTypeId(): string { return CellMapPanel.viewType; }

    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _ready = false;
    private _uri: vscode.Uri | undefined;
    private _pending: NodeJS.Timeout | undefined;
    private _openmcGen = 0;
    private _floated = false;
    private readonly _location: CellMapLocation;

    public static async show(deck?: vscode.Uri): Promise<void> {
        const target = deck ?? vscode.window.activeTextEditor?.document.uri;
        if (CellMapPanel.current) {
            if (target) CellMapPanel.current._uri = target;
            await CellMapPanel.current._place();
            CellMapPanel.current._sync();
            return;
        }
        const location = await pickLocation();
        if (!location) return;
        // newWindow needs focus on the webview so _place moves the map and not
        // the deck; the in-window locations leave focus in the editor.
        const column = location === 'beside' ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
        const panel = vscode.window.createWebviewPanel(
            CellMapPanel.viewType,
            'OWEN: Cell Map',
            { viewColumn: column, preserveFocus: location !== 'newWindow' },
            { enableScripts: true, retainContextWhenHidden: true },
        );
        CellMapPanel.current = new CellMapPanel(panel, target, location);
        await CellMapPanel.current._place();
    }

    /**
     * Put the flowchart where `owen.cellMap.openIn` asks for. VS Code owns the
     * bounds of floating windows — an extension cannot pass them — so the
     * escape hatch for a window that lands somewhere unwanted is `beside`.
     * Auxiliary windows report no viewColumn once the panel is already there;
     * `_floated` distinguishes that from "just created, not yet shown".
     */
    private async _place(): Promise<void> {
        if (this._location !== 'newWindow') {
            const column = this._location === 'beside' ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
            this._panel.reveal(this._panel.viewColumn ?? column, true);
            return;
        }
        if (this._floated && this._panel.viewColumn === undefined) {
            this._panel.reveal(undefined, false);
            return;
        }
        this._panel.reveal(this._panel.viewColumn ?? vscode.ViewColumn.Active, false);
        // The webview tab has to be the active editor or this command moves
        // the deck instead. A tick is enough for createWebviewPanel to focus.
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        try {
            await vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');
            this._floated = true;
        } catch {
            this._panel.reveal(vscode.ViewColumn.Beside, true);
        }
    }

    private constructor(panel: vscode.WebviewPanel, deck?: vscode.Uri, location: CellMapLocation = 'newWindow') {
        this._panel = panel;
        // Remember the deck before the panel can be floated: an auxiliary
        // window has no active text editor, so this is all _sync has to go on.
        this._uri = deck;
        this._location = location;
        this._panel.webview.html = buildCellMapHtml(this._panel.webview.cspSource, makeNonce());

        this._panel.webview.onDidReceiveMessage(
            (msg) => this._onMessage(msg),
            null,
            this._disposables,
        );
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        // Moving the tab to another window reloads the webview and drops any
        // model posted before the move.
        this._panel.onDidChangeViewState(
            () => { if (this._panel.visible) this._sync(); },
            null,
            this._disposables,
        );

        vscode.window.onDidChangeActiveTextEditor(
            (ed) => { if (isMapped(ed?.document)) this._sync(); },
            null,
            this._disposables,
        );
        vscode.workspace.onDidChangeTextDocument(
            (ev) => {
                if (!this._uri) return;
                const key = notebookOfCell(ev.document)?.uri.toString() ?? ev.document.uri.toString();
                if (key === this._uri.toString()) this._schedule();
            },
            null,
            this._disposables,
        );
    }

    private _onMessage(msg: { command?: string; id?: number; name?: string }): void {
        if (msg?.command === 'ready') {
            this._ready = true;
            this._sync();
            return;
        }
        const name = typeof msg.name === 'string' && msg.name ? msg.name : undefined;
        if (msg?.command === 'revealCell' && typeof msg.id === 'number') {
            void this._reveal('cell', msg.id, name);
        } else if (msg?.command === 'revealSurface' && typeof msg.id === 'number') {
            void this._reveal('surface', msg.id, name);
        }
    }

    private async _reveal(kind: 'cell' | 'surface', id: number, name?: string): Promise<void> {
        if (!this._uri) return;
        await revealDeckTarget(this._uri, kind, id, name, CellMapPanel.viewTypeId);
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
        const doc = this._deck();
        const src = doc ? deckSourceOf(doc) : null;
        if (!doc || !src) {
            this._post(emptyModel(), 'open a Monte Carlo deck');
            return;
        }
        // A notebook cell maps the whole notebook; remember the notebook.
        this._uri = src.uri;
        const lang = src.language;
        const text = src.text;
        let model: CellMapModel;
        try {
            model = parseCellMap(text, lang);
        } catch (err) {
            model = emptyModel(lang);
            model.warnings.push(
                `Could not read this deck: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
        this._post(model, src.uri.path.split('/').pop() ?? '');

        if (lang === 'openmc' && !looksLikeOpenmcXml(text) && model.cells.length === 0 && !src.fromNotebook) {
            void this._loadOpenmcXml(doc);
        }
    }

    /** The deck this map is showing. See `pickDeck` for why focus is not enough. */
    private _deck(): vscode.TextDocument | undefined {
        // Notebook cells share their notebook's key so the remembered deck
        // (the notebook URI) still resolves to one of its cell documents.
        const keyOf = (doc: vscode.TextDocument) => notebookOfCell(doc)?.uri.toString() ?? doc.uri.toString();
        const wrap = (doc: vscode.TextDocument) => ({ key: keyOf(doc), mapped: isMapped(doc), doc });
        const active = vscode.window.activeTextEditor?.document;
        return pickDeck({
            active: active ? wrap(active) : undefined,
            remembered: this._uri?.toString(),
            visible: vscode.window.visibleTextEditors.map((ed) => wrap(ed.document)),
            open: vscode.workspace.textDocuments.map(wrap),
        })?.doc;
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
        void CellMapPanel.show(deckSourceOf(doc)?.uri ?? doc.uri);
    });
}
