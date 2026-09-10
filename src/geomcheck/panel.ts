import * as vscode from 'vscode';
import { parseMcnpDeck } from '../converter/mcnpModel';
import { locateDeckTarget, revealDeckTarget } from '../cellmap/revealInEditor';
import { activeDeckSource, DeckSource } from '../util/deckSource';
import { isLoaded, loadGeometryModel } from '../util/loadModel';
import { McnpGeometryModel } from '../preview/mcnpGeometry';
import { checkGeometry, estimateVolumes, sdCards, volCard, GeometryCheckResult, VolumeResult } from './core';
import { geometryCheckHtml, ReportContext, volumesHtml } from './report';

const CHECK_VIEW = 'owen.geometryCheck';
const VOLUME_VIEW = 'owen.cellVolumes';

function makeNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}

/**
 * Mass density per cell, g/cm³, for the mass column. MCNP: the cell card's
 * density when negative (positive is atoms/b·cm, which needs the composition
 * to become a mass). Serpent: `mat <name> <dens>` with the same sign rule.
 */
export function massDensities(src: DeckSource, model: McnpGeometryModel): Map<number, number> {
    const out = new Map<number, number>();
    if (src.language === 'mcnp') {
        for (const c of parseMcnpDeck(src.text).cells) {
            if (c.density !== null && c.density < 0) out.set(c.id, -c.density);
        }
        return out;
    }
    if (src.language === 'serpent' && model.names) {
        const byName = new Map<string, number>();
        for (const m of src.text.matchAll(/^\s*mat\s+(\S+)\s+(-?[\d.]+(?:[eE][-+]?\d+)?)/gm)) {
            const d = parseFloat(m[2]);
            if (Number.isFinite(d) && d < 0) byName.set(m[1], -d);
        }
        for (const cell of model.cells.values()) {
            const name = model.names.materials.get(cell.material);
            const d = name ? byName.get(name) : undefined;
            if (d !== undefined) out.set(cell.id, d);
        }
    }
    return out;
}

/** Insert text as new lines at the end of the MCNP data block. */
async function insertIntoDataBlock(uri: vscode.Uri, text: string): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(uri);
    const deck = parseMcnpDeck(doc.getText());
    // sections.data is [start, endExclusive] in 0-based lines; append just
    // before any trailing blank lines so the card stays inside the block.
    let line = Math.min(deck.sections.data[1], doc.lineCount);
    while (line > deck.sections.data[0] && doc.lineAt(line - 1).text.trim() === '') line--;
    const edit = new vscode.WorkspaceEdit();
    const insertAt = new vscode.Position(line, 0);
    const needsLeadingNewline = line > 0 && !doc.lineAt(line - 1).text.endsWith('\n') && line === doc.lineCount;
    edit.insert(uri, insertAt, (needsLeadingNewline ? '\n' : '') + text + '\n');
    await vscode.workspace.applyEdit(edit);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    const end = new vscode.Position(line + text.split('\n').length, 0);
    editor.revealRange(new vscode.Range(insertAt, end), vscode.TextEditorRevealType.InCenter);
}

abstract class ReportPanel<R> {
    protected panel: vscode.WebviewPanel | undefined;
    protected src: DeckSource | undefined;
    protected model: McnpGeometryModel | undefined;
    protected origin = '';
    protected samples: number | undefined;
    protected result: R | undefined;

    constructor(private readonly viewType: string, private readonly title: string) {}

    async run(src: DeckSource, samples?: number): Promise<void> {
        this.src = src;
        this.samples = samples;
        const loaded = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `OWEN: ${this.title}…`, cancellable: false },
            async (progress) => {
                progress.report({ message: 'reading geometry' });
                const l = await loadGeometryModel(src);
                if (!isLoaded(l)) return l;
                this.model = l.model;
                this.origin = l.origin === 'deck' ? 'the deck' : l.origin === 'openmc-export' ? 'OpenMC export' : 'sibling geometry.xml';
                progress.report({ message: `sampling ${l.model.universes.size} universes` });
                // Yield once so the notification paints before the CPU-bound pass.
                await new Promise((r) => setTimeout(r, 30));
                this.result = this.compute(l.model, samples);
                return l;
            },
        );
        if (!isLoaded(loaded)) {
            vscode.window.showWarningMessage(`OWEN: ${loaded.reason}`);
            return;
        }
        this.show();
    }

    protected abstract compute(model: McnpGeometryModel, samples?: number): R;
    protected abstract html(cspSource: string, nonce: string): string;
    protected abstract onMessage(msg: { command?: string; which?: string }): Promise<void>;

    protected context(): ReportContext {
        const src = this.src!;
        return {
            fileName: src.uri.path.split('/').pop() ?? '',
            language: src.language,
            origin: this.origin,
            names: this.model?.names,
        };
    }

    private show(): void {
        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                this.viewType, `OWEN: ${this.title}`, vscode.ViewColumn.Beside,
                { enableScripts: true, retainContextWhenHidden: true },
            );
            this.panel.onDidDispose(() => { this.panel = undefined; });
            this.panel.webview.onDidReceiveMessage(async (msg) => {
                if (msg?.command === 'reveal' && typeof msg.id === 'number' && this.src) {
                    await revealDeckTarget(this.src.uri, 'cell', msg.id, msg.name || undefined, this.viewType);
                } else if (msg?.command === 'rerun' && this.src) {
                    const base = this.samples ?? this.defaultSamples();
                    await this.run(this.src, msg.which === 'more' ? base * 10 : base);
                } else {
                    await this.onMessage(msg);
                }
            });
        } else {
            this.panel.reveal(undefined, true);
        }
        this.panel.webview.html = this.html(this.panel.webview.cspSource, makeNonce());
    }

    protected abstract defaultSamples(): number;
}

class GeometryCheckPanel extends ReportPanel<GeometryCheckResult> {
    private readonly diagnostics = vscode.languages.createDiagnosticCollection('owen-geometry-check');
    constructor() { super(CHECK_VIEW, 'Geometry Check'); }
    protected defaultSamples(): number { return 20_000; }
    protected compute(model: McnpGeometryModel, samples?: number): GeometryCheckResult {
        return checkGeometry(model, {
            samples: samples ?? this.defaultSamples(),
            overlapSemantics: this.src?.language === 'scone' ? 'first-wins' : 'error',
        });
    }
    protected html(csp: string, nonce: string): string {
        void this.publishDiagnostics();
        return geometryCheckHtml(this.result!, this.context(), csp, nonce);
    }
    protected async onMessage(): Promise<void> { /* no extra commands */ }

    /** Overlaps and gaps as warnings on the cell cards, so they show in Problems too. */
    private async publishDiagnostics(): Promise<void> {
        const r = this.result, src = this.src;
        if (!r || !src || src.fromNotebook) return;
        const diags: vscode.Diagnostic[] = [];
        const names = this.model?.names;
        const at = (id: number): vscode.Range | null => {
            const hit = locateDeckTarget(src.text, src.language, 'cell', id, names?.cells.get(id));
            return hit ? new vscode.Range(hit.line, hit.start, hit.line, hit.end) : null;
        };
        const firstWins = r.overlapSemantics === 'first-wins';
        for (const o of r.overlaps) {
            for (const [me, other] of [[o.a, o.b], [o.b, o.a]]) {
                const range = at(me);
                if (!range) continue;
                const d = new vscode.Diagnostic(
                    range,
                    `Cell ${names?.cells.get(me) ?? me} overlaps cell ${names?.cells.get(other) ?? other} (${o.hits} sampled points, ${(100 * o.fraction).toFixed(2)} % of universe ${o.universe}'s box). ` +
                    (firstWins ? 'SCONE takes the first listed cell, so the later one is shadowed here.' : 'A particle here is lost.'),
                    firstWins ? vscode.DiagnosticSeverity.Information : vscode.DiagnosticSeverity.Warning,
                );
                d.source = 'owen-geometry';
                d.code = 'geometry.overlap';
                diags.push(d);
            }
        }
        for (const u of r.universes) {
            if (!u.gapHits) continue;
            const range = at(u.cellIds[0]);
            if (!range) continue;
            const d = new vscode.Diagnostic(
                range,
                `Universe ${u.id}: ${u.gapHits} of ${u.samples} sampled points fall in no cell (e.g. ${u.gapExample?.map((v) => v.toFixed(3)).join(', ')}). The universe must cover its container.`,
                vscode.DiagnosticSeverity.Warning,
            );
            d.source = 'owen-geometry';
            d.code = 'geometry.gap';
            diags.push(d);
        }
        this.diagnostics.set(src.uri, diags);
    }
}

class VolumesPanel extends ReportPanel<VolumeResult> {
    private cards: { vol: string; sd: string[] } | undefined;
    constructor() { super(VOLUME_VIEW, 'Cell Volumes'); }
    protected defaultSamples(): number { return 100_000; }
    protected compute(model: McnpGeometryModel, samples?: number): VolumeResult {
        return estimateVolumes(model, { samples: samples ?? this.defaultSamples() });
    }
    protected html(csp: string, nonce: string): string {
        const ctx = this.context();
        ctx.massDensity = massDensities(this.src!, this.model!);
        this.cards = undefined;
        if (this.src!.language === 'mcnp') {
            const deck = parseMcnpDeck(this.src!.text);
            this.cards = {
                vol: volCard(deck.cells.map((c) => c.id), this.result!),
                sd: sdCards(deck.settings.cellTallies, this.result!),
            };
            ctx.cards = this.cards;
        }
        return volumesHtml(this.result!, ctx, csp, nonce);
    }
    protected async onMessage(msg: { command?: string; which?: string }): Promise<void> {
        if (!this.cards || !this.src) return;
        const text = msg.which === 'sd' ? this.cards.sd.join('\n') : this.cards.vol;
        if (msg.command === 'copy') {
            await vscode.env.clipboard.writeText(text);
            vscode.window.setStatusBarMessage(`OWEN: ${msg.which} card${msg.which === 'sd' ? 's' : ''} copied`, 3000);
        } else if (msg.command === 'insert') {
            await insertIntoDataBlock(this.src.uri, text);
        }
    }
}

export function registerGeometryTools(): vscode.Disposable[] {
    const check = new GeometryCheckPanel();
    const volumes = new VolumesPanel();
    const need = (): DeckSource | null => {
        const src = activeDeckSource();
        if (!src) {
            vscode.window.showInformationMessage('OWEN: open an MCNP, OpenMC, Serpent or SCONE deck first.');
        }
        return src;
    };
    return [
        vscode.commands.registerCommand('owen.checkGeometry', () => {
            const src = need();
            if (src) void check.run(src);
        }),
        vscode.commands.registerCommand('owen.cellVolumes', () => {
            const src = need();
            if (src) void volumes.run(src);
        }),
    ];
}
