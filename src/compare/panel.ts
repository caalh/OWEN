import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { activeDeckSource, deckSourceOf, DeckSource } from '../util/deckSource';
import { detectMonteCarloLanguageFromText, MonteCarloLanguage } from '../util/detectLanguage';
import { isLoaded, loadGeometryModel } from '../util/loadModel';
import { canonicalDeck } from './canonical';
import { classifyModel, classLabel, compareGeometry, GeometryComparison } from './geometry';

const SCHEME = 'owen-canonical';

/** Content provider for the two canonical listings behind `vscode.diff`. */
class CanonicalProvider implements vscode.TextDocumentContentProvider {
    private readonly docs = new Map<string, string>();
    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;
    set(key: string, text: string): vscode.Uri {
        this.docs.set(key, text);
        const uri = vscode.Uri.parse(`${SCHEME}:/${key}`);
        this._onDidChange.fire(uri);
        return uri;
    }
    provideTextDocumentContent(uri: vscode.Uri): string {
        return this.docs.get(uri.path.replace(/^\//, '')) ?? '';
    }
}

const LANG_EXT: Record<string, string[]> = {
    mcnp: ['i', 'inp', 'mcnp'], serpent: ['serp', 'sss'], scone: ['scone'], openmc: ['py', 'xml'],
};

/**
 * The other deck: an open Monte Carlo document, or a file from disk. Reads
 * the file straight from disk when it is not open, so comparing against a
 * reference deck does not require opening it first.
 */
async function pickOtherDeck(current: DeckSource, title: string): Promise<DeckSource | null> {
    type Item = vscode.QuickPickItem & { doc?: vscode.TextDocument; browse?: boolean };
    const items: Item[] = [];
    for (const doc of vscode.workspace.textDocuments) {
        if (doc.uri.toString() === current.uri.toString()) continue;
        const src = deckSourceOf(doc);
        if (!src) continue;
        items.push({ label: path.basename(doc.uri.fsPath || doc.uri.path), description: src.language.toUpperCase(), detail: doc.uri.fsPath, doc });
    }
    items.push({ label: '$(folder-opened) Browse for a deck…', browse: true, alwaysShow: true });
    const pick = await vscode.window.showQuickPick(items, { title, placeHolder: 'Compare the active deck with…' });
    if (!pick) return null;
    if (pick.doc) return deckSourceOf(pick.doc);
    const files = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Compare',
        filters: { 'Monte Carlo decks': Object.values(LANG_EXT).flat(), 'All files': ['*'] },
        defaultUri: current.uri.scheme === 'file' ? vscode.Uri.file(path.dirname(current.uri.fsPath)) : undefined,
    });
    if (!files?.length) return null;
    const uri = files[0];
    const text = fs.readFileSync(uri.fsPath, 'utf8');
    const ext = path.extname(uri.fsPath).slice(1).toLowerCase();
    const langId = ext === 'py' ? 'python' : ext === 'xml' ? 'xml' : (Object.entries(LANG_EXT).find(([, exts]) => exts.includes(ext))?.[0] ?? 'mcnp');
    const language: MonteCarloLanguage | null = detectMonteCarloLanguageFromText(text, langId) ?? (langId === 'python' || langId === 'xml' ? null : langId as MonteCarloLanguage);
    if (!language) {
        vscode.window.showWarningMessage(`OWEN: ${path.basename(uri.fsPath)} does not look like an MCNP, OpenMC, Serpent or SCONE deck.`);
        return null;
    }
    return { text, language, uri, fromNotebook: false };
}

function baseName(src: DeckSource): string {
    return src.uri.path.split('/').pop() ?? 'deck';
}

// ---------------------------------------------------------------------------
// Semantic diff
// ---------------------------------------------------------------------------

async function semanticDiff(provider: CanonicalProvider): Promise<void> {
    const a = activeDeckSource();
    if (!a) { vscode.window.showInformationMessage('OWEN: open a Monte Carlo deck first.'); return; }
    const b = await pickOtherDeck(a, 'OWEN: Semantic Diff');
    if (!b) return;
    const [la, lb] = await Promise.all([loadGeometryModel(a), loadGeometryModel(b)]);
    if (!isLoaded(la)) { vscode.window.showWarningMessage(`OWEN: ${baseName(a)}: ${la.reason}`); return; }
    if (!isLoaded(lb)) { vscode.window.showWarningMessage(`OWEN: ${baseName(b)}: ${lb.reason}`); return; }
    const ta = canonicalDeck(la.model, a.language, a.text);
    const tb = canonicalDeck(lb.model, b.language, b.text);
    const stamp = Date.now().toString(36);
    const ua = provider.set(`${stamp}-a/${baseName(a)}.canonical`, ta);
    const ub = provider.set(`${stamp}-b/${baseName(b)}.canonical`, tb);
    await vscode.commands.executeCommand('vscode.diff', ua, ub, `OWEN semantic diff: ${baseName(a)} ↔ ${baseName(b)}`);
    if (ta === tb) vscode.window.setStatusBarMessage('OWEN: the two decks describe the same model (canonical forms are identical).', 6000);
}

// ---------------------------------------------------------------------------
// Geometry comparison
// ---------------------------------------------------------------------------

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const pct = (v: number): string => `${(100 * v).toFixed(2)} %`;
const pt = (p: readonly number[]): string => `(${p.map((v) => Number(v.toPrecision(5))).join(', ')})`;

export function comparisonHtml(r: GeometryComparison, cspSource: string, nonce: string): string {
    const csp = ["default-src 'none'", `style-src ${cspSource} 'unsafe-inline'`, `script-src 'nonce-${nonce}'`].join('; ');
    const s = r.summary;
    const g = r.mappedAgreement;
    const verdict = g > 0.995 ? ['ok', 'Same geometry — the two decks draw the same boundaries at ' + pct(g) + ' of points (material class agreement ' + pct(r.classAgreement) + ').']
        : g > 0.97 ? ['warn', 'Nearly the same geometry — ' + pct(1 - g) + ' of points fall in a different region; see below for where.']
        : ['bad', 'Different geometry — only ' + pct(g) + ' of points fall in matching regions.'];
    const mapRows = r.mapping.slice(0, 30).map((m) =>
        `<tr><td>${esc(m.a)}</td><td>${esc(m.b)}</td><td class="n ${m.share < 0.95 ? 'bad' : ''}">${pct(m.share)}</td><td class="n">${pct(m.points / Math.max(1, r.resolved))}</td></tr>`).join('');
    const classes = [...new Set([...r.classCountsA.keys(), ...r.classCountsB.keys()])].sort((x, y) => (r.classCountsA.get(y) ?? 0) - (r.classCountsA.get(x) ?? 0));
    const compRows = classes.map((c) => {
        const na = r.classCountsA.get(c) ?? 0, nb = r.classCountsB.get(c) ?? 0;
        return `<tr><td>${esc(classLabel(c))}</td><td class="n">${pct(na / Math.max(1, r.resolved))}</td><td class="n">${pct(nb / Math.max(1, r.resolved))}</td><td class="n ${Math.abs(na - nb) / Math.max(1, r.resolved) > 0.005 ? 'bad' : ''}">${((nb - na) / Math.max(1, r.resolved) * 100).toFixed(2)} pt</td></tr>`;
    }).join('');
    const disRows = (list: GeometryComparison['byClass'], label: (x: string) => string) => list.slice(0, 20).map((d) =>
        `<tr><td>${esc(label(d.a))}</td><td>${esc(label(d.b))}</td><td class="n">${d.count}</td><td class="n">${pct(d.count / Math.max(1, r.resolved))}</td><td class="muted">${pt(d.example)}</td></tr>`).join('');
    const sumRow = (m: typeof s.a) => `<tr><td><b>${esc(m.label)}</b> <span class="muted">${esc(m.language.toUpperCase())}</span></td><td class="n">${m.cells}</td><td class="n">${m.surfaces}</td><td class="n">${m.universes}</td><td class="n">${m.lattices}</td><td class="muted">${pt(m.bounds.min)} – ${pt(m.bounds.max)}</td></tr>`;
    return `<!DOCTYPE html><html><head><meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  body { font-family: var(--vscode-font-family); font-size: 12px; color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 12px 16px; }
  h1 { font-size: 15px; margin: 0 0 2px; } h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; opacity: .7; margin: 18px 0 6px; }
  .sub { opacity: .7; margin-bottom: 10px; }
  .banner { padding: 8px 10px; border-radius: 4px; margin: 10px 0; border: 1px solid transparent; }
  .ok { background: color-mix(in srgb, #3fb950 12%, transparent); border-color: #3fb95055; }
  .warn { background: var(--vscode-inputValidation-warningBackground, rgba(255,190,60,.12)); border-color: #f2a33c; }
  .bad { background: var(--vscode-inputValidation-errorBackground, rgba(255,80,80,.12)); border-color: #e05561; }
  table { border-collapse: collapse; width: 100%; } th, td { text-align: left; padding: 3px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
  th { opacity: .7; font-weight: 600; } td.n, th.n { text-align: right; font-family: var(--vscode-editor-font-family); white-space: nowrap; }
  td.bad { color: #e05561; font-weight: 600; } .muted { opacity: .55; }
  .notes { opacity: .7; font-size: 11.5px; margin-top: 14px; }
</style></head><body>
<h1>Geometry Comparison — ${esc(s.a.label)} ↔ ${esc(s.b.label)}</h1>
<div class="sub">${r.samples.toLocaleString()} points in the shared box · ${r.resolved.toLocaleString()} resolved in both · ${r.elapsedMs} ms</div>
<div class="banner ${verdict[0]}"><b>${esc(verdict[1])}</b>${r.lostA || r.lostB ? ` <span class="muted">(${r.lostA} points lost in ${esc(s.a.label)}, ${r.lostB} in ${esc(s.b.label)})</span>` : ''}</div>
<h2>Decks</h2>
<table><thead><tr><th>Deck</th><th class="n">Cells</th><th class="n">Surfaces</th><th class="n">Universes</th><th class="n">Lattices</th><th>World box</th></tr></thead><tbody>${sumRow(s.a)}${sumRow(s.b)}</tbody></table>
<h2>Material pairing (boundary agreement ${pct(g)})</h2>
<table><thead><tr><th>${esc(s.a.label)} material</th><th>usually is, in ${esc(s.b.label)}</th><th class="n">How often</th><th class="n">Share of volume</th></tr></thead><tbody>${mapRows}</tbody></table>
<h2>Composition by material class (share of sampled volume)</h2>
<table><thead><tr><th>Class</th><th class="n">${esc(s.a.label)}</th><th class="n">${esc(s.b.label)}</th><th class="n">Δ</th></tr></thead><tbody>${compRows}</tbody></table>
${r.byClass.length ? `<h2>Where they disagree (by class)</h2>
<table><thead><tr><th>${esc(s.a.label)} says</th><th>${esc(s.b.label)} says</th><th class="n">Points</th><th class="n">Share</th><th>Example (x, y, z)</th></tr></thead><tbody>${disRows(r.byClass, classLabel)}</tbody></table>` : ''}
<h2>Material names side by side <span class="muted">(${pct(r.nameAgreement)} identical)</span></h2>
${r.byName.length ? `<table><thead><tr><th>${esc(s.a.label)}</th><th>${esc(s.b.label)}</th><th class="n">Points</th><th class="n">Share</th><th>Example</th></tr></thead><tbody>${disRows(r.byName, (x) => x)}</tbody></table>` : '<p class="muted">Every sampled point had the same material name in both decks.</p>'}
<ul class="notes">${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
<script nonce="${nonce}"></script></body></html>`;
}

async function compareDecks(): Promise<void> {
    const a = activeDeckSource();
    if (!a) { vscode.window.showInformationMessage('OWEN: open a Monte Carlo deck first.'); return; }
    const b = await pickOtherDeck(a, 'OWEN: Compare Geometry');
    if (!b) return;
    const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'OWEN: comparing geometry…' },
        async (progress) => {
            progress.report({ message: 'reading both decks' });
            const [la, lb] = await Promise.all([loadGeometryModel(a), loadGeometryModel(b)]);
            if (!isLoaded(la)) return { error: `${baseName(a)}: ${la.reason}` };
            if (!isLoaded(lb)) return { error: `${baseName(b)}: ${lb.reason}` };
            progress.report({ message: 'sampling' });
            await new Promise((r) => setTimeout(r, 30));
            const ca = classifyModel(la.model, a.language, a.text, baseName(a));
            const cb = classifyModel(lb.model, b.language, b.text, baseName(b));
            return { report: compareGeometry(ca, cb) };
        },
    );
    if ('error' in result) { vscode.window.showWarningMessage(`OWEN: ${result.error}`); return; }
    const panel = vscode.window.createWebviewPanel('owen.compareGeometry', `OWEN: ${baseName(a)} ↔ ${baseName(b)}`, vscode.ViewColumn.Beside, { enableScripts: false });
    const nonce = Math.random().toString(36).slice(2);
    panel.webview.html = comparisonHtml(result.report, panel.webview.cspSource, nonce);
}

export function registerCompareTools(): vscode.Disposable[] {
    const provider = new CanonicalProvider();
    return [
        vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider),
        vscode.commands.registerCommand('owen.diffDecks', () => { void semanticDiff(provider); }),
        vscode.commands.registerCommand('owen.compareGeometry', () => { void compareDecks(); }),
    ];
}
