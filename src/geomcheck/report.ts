// HTML for the Geometry Check and Cell Volumes panels. Pure functions of the
// result so the tests can assert on them; the panel wires the messages.

import type { GeometryCheckResult, VolumeResult } from './core';
import type { GeometryNames } from '../preview/mcnpGeometry';

export interface ReportContext {
    fileName: string;
    language: string;
    origin: string;
    names?: GeometryNames;
    /** Cell id → g/cm³ (already made positive) for the mass column. */
    massDensity?: Map<number, number>;
    /** Cards ready to insert (MCNP only). */
    cards?: { vol: string; sd: string[] };
}

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

const num = (v: number, digits = 4): string => {
    if (!Number.isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e6 || a < 1e-3)) return v.toExponential(3);
    return Number(v.toPrecision(digits)).toLocaleString(undefined, { maximumFractionDigits: 6 });
};

const pt = (p: readonly number[] | null | undefined): string =>
    p ? `(${p.map((v) => num(v, 5)).join(', ')})` : '';

function cellLink(id: number, names?: GeometryNames): string {
    const n = names?.cells.get(id);
    return `<a class="cell" data-cell="${id}" data-name="${esc(n ?? '')}" href="#">${esc(n ?? id)}</a>`;
}

function uniLabel(id: number, names?: GeometryNames): string {
    const n = names?.universes.get(id);
    return n ? esc(n) : `u=${id}`;
}

function shell(title: string, cspSource: string, nonce: string, body: string, script: string): string {
    const csp = [
        "default-src 'none'",
        `style-src ${cspSource} 'unsafe-inline'`,
        `script-src 'nonce-${nonce}'`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>${esc(title)}</title>
<style>
  body { font-family: var(--vscode-font-family); font-size: 12px; color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 12px 16px; }
  h1 { font-size: 15px; margin: 0 0 2px; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; opacity: .7; margin: 18px 0 6px; }
  .sub { opacity: .7; margin-bottom: 10px; }
  .banner { padding: 8px 10px; border-radius: 4px; margin: 10px 0; border: 1px solid transparent; }
  .ok { background: color-mix(in srgb, #3fb950 12%, transparent); border-color: #3fb95055; }
  .bad { background: var(--vscode-inputValidation-errorBackground, rgba(255,80,80,.12)); border-color: var(--vscode-inputValidation-errorBorder, #e05561); }
  .warn { background: var(--vscode-inputValidation-warningBackground, rgba(255,190,60,.12)); border-color: var(--vscode-inputValidation-warningBorder, #f2a33c); }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 3px 8px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: top; }
  th { opacity: .7; font-weight: 600; }
  td.n, th.n { text-align: right; font-family: var(--vscode-editor-font-family); white-space: nowrap; }
  a.cell { color: var(--vscode-textLink-foreground); text-decoration: none; }
  a.cell:hover { text-decoration: underline; }
  .muted { opacity: .55; }
  .tag { display: inline-block; padding: 0 6px; border-radius: 9px; font-size: 11px; font-weight: 600; color: #fff; background: #8a8f98; }
  .tag.bad { background: #e05561; } .tag.fill { background: #c58af9; } .tag.lat { background: #f2a33c; }
  details { margin: 6px 0; } summary { cursor: pointer; padding: 4px 0; }
  summary b { font-weight: 600; }
  pre { font-family: var(--vscode-editor-font-family); font-size: 11.5px; padding: 8px; border-radius: 4px; background: var(--vscode-textCodeBlock-background, rgba(127,127,127,.12)); white-space: pre-wrap; margin: 6px 0; }
  button { font: inherit; padding: 3px 10px; border: none; border-radius: 3px; cursor: pointer; margin-right: 6px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  button.sec { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  button:hover { background: var(--vscode-button-hoverBackground); }
  .notes { opacity: .7; font-size: 11.5px; margin-top: 14px; }
  .notes li { margin: 2px 0; }
</style></head><body>${body}
<script nonce="${nonce}">
(function(){
  const vscode = acquireVsCodeApi();
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest('a.cell');
    if (a) { ev.preventDefault(); vscode.postMessage({ command: 'reveal', id: Number(a.dataset.cell), name: a.dataset.name || '' }); return; }
    const b = ev.target.closest('button[data-cmd]');
    if (b) vscode.postMessage({ command: b.dataset.cmd, which: b.dataset.which || '' });
  });
  ${script}
}());
</script></body></html>`;
}

// ---------------------------------------------------------------------------
// Geometry check
// ---------------------------------------------------------------------------

export function geometryCheckHtml(r: GeometryCheckResult, ctx: ReportContext, cspSource: string, nonce: string): string {
    const names = ctx.names;
    const gaps = r.universes.filter((u) => u.gapHits > 0);
    const overlapped = r.universes.filter((u) => u.overlapHits > 0);
    const clean = gaps.length === 0 && overlapped.length === 0 && r.world.lost === 0 && r.world.rootOverlaps === 0;
    const checked = r.universes.filter((u) => !u.skipped).length;

    const firstWins = r.overlapSemantics === 'first-wins';
    const realProblems = gaps.length > 0 || r.world.lost > 0 || (!firstWins && (overlapped.length > 0 || r.world.rootOverlaps > 0));
    let banner: string;
    if (clean) {
        banner = `<div class="banner ok"><b>No overlaps or gaps found.</b> ${checked} universe${checked === 1 ? '' : 's'} sampled at ${r.universes[0]?.samples.toLocaleString() ?? 0} points each, plus ${r.world.samples.toLocaleString()} full-descent points${r.boundedDomain ? ` (${r.world.outside.toLocaleString()} beyond the boundary surfaces, not counted)` : ''}. Evidence, not proof: a sliver thinner than the sample spacing can still hide.</div>`;
    } else if (!realProblems) {
        banner = `<div class="banner warn"><b>${r.overlaps.length} overlapping cell pair${r.overlaps.length === 1 ? '' : 's'}, no gaps.</b> SCONE takes the first listed cell that contains a point, so these are legal — but the later cell's region as written is not its region as run. Worth a look if the shadowed part was meant to exist.</div>`;
    } else {
        const parts: string[] = [];
        if (r.overlaps.length) parts.push(`${r.overlaps.length} overlapping cell pair${r.overlaps.length === 1 ? '' : 's'}`);
        if (gaps.length) parts.push(`gaps in ${gaps.length} universe${gaps.length === 1 ? '' : 's'}`);
        if (r.world.lost) parts.push(`${r.world.lost} of ${r.world.samples - r.world.outside} world points claimed by no cell`);
        banner = `<div class="banner bad"><b>Problems found:</b> ${parts.join('; ')}. In MCNP these are lost particles (and a fatal error past the 10th); OpenMC and Serpent report them as overlaps or undefined regions at run time.</div>`;
    }

    const overlapRows = r.overlaps.map((o) =>
        `<tr><td>${uniLabel(o.universe, names)}</td><td>${cellLink(o.a, names)} &amp; ${cellLink(o.b, names)}</td>` +
        `<td class="n">${o.hits}</td><td class="n">${(100 * o.fraction).toFixed(2)} %</td><td class="muted">${pt(o.example)}</td></tr>`).join('');

    const gapRows = gaps.map((u) =>
        `<tr><td>${uniLabel(u.id, names)}</td><td class="n">${u.gapHits} / ${u.samples}</td><td class="muted">${pt(u.gapExample)}</td>` +
        `<td>${u.cellIds.map((id) => cellLink(id, names)).join(', ')}${u.cells > u.cellIds.length ? ` <span class="muted">+${u.cells - u.cellIds.length}</span>` : ''}</td></tr>`).join('');

    const uniRows = r.universes.map((u) => {
        const status = u.skipped ? `<span class="muted">${esc(u.skipped)}</span>`
            : u.gapHits || u.overlapHits ? `<span class="tag bad">${u.overlapHits ? 'overlap' : ''}${u.overlapHits && u.gapHits ? ' + ' : ''}${u.gapHits ? 'gap' : ''}</span>`
            : 'clean';
        return `<tr><td>${u.id === r.root ? `<b>${uniLabel(u.id, names)}</b> (root)` : uniLabel(u.id, names)}${u.lattice ? ' <span class="tag lat">lat</span>' : ''}</td>` +
            `<td class="n">${u.cells}</td><td class="n">${u.samples ? u.samples.toLocaleString() : '—'}</td>` +
            `<td class="n">${u.overlapHits}</td><td class="n">${u.lattice ? '<span class="muted">n/a</span>' : u.gapHits}</td>` +
            `<td class="muted">${pt(u.bounds.min)} – ${pt(u.bounds.max)}</td><td>${status}</td></tr>`;
    }).join('');

    const body = `
<h1>Geometry Check — ${esc(ctx.fileName)}</h1>
<div class="sub">${esc(ctx.language.toUpperCase())} · geometry from ${esc(ctx.origin)} · ${r.elapsedMs} ms</div>
${banner}
<p><button data-cmd="rerun" data-which="more">Re-run with 10× points</button><button class="sec" data-cmd="rerun" data-which="same">Re-run</button></p>
${r.overlaps.length ? `<h2>Overlapping cells</h2>
<table><thead><tr><th>Universe</th><th>Cells</th><th class="n">Points</th><th class="n">Of box</th><th>Example point (universe frame)</th></tr></thead><tbody>${overlapRows}</tbody></table>` : ''}
${gaps.length ? `<h2>Gaps — points no cell claims</h2>
<table><thead><tr><th>Universe</th><th class="n">Points</th><th>Example point</th><th>Cells in this universe</th></tr></thead><tbody>${gapRows}</tbody></table>` : ''}
<h2>World descent</h2>
<p>${r.world.samples.toLocaleString()} points traced from the root through every fill and lattice: <b>${r.world.lost}</b> lost${r.world.lostExample ? ` (e.g. ${pt(r.world.lostExample)})` : ''}, <b>${r.world.rootOverlaps}</b> claimed by more than one root cell${r.boundedDomain ? `, <b>${r.world.outside.toLocaleString()}</b> beyond the boundary surfaces (outside the problem)` : ''}.</p>
<h2>Per universe</h2>
<table><thead><tr><th>Universe</th><th class="n">Cells</th><th class="n">Points</th><th class="n">Overlap pts</th><th class="n">Gap pts</th><th>Sampling box</th><th>Result</th></tr></thead><tbody>${uniRows}</tbody></table>
<ul class="notes">${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`;
    return shell('OWEN: Geometry Check', cspSource, nonce, body, '');
}

// ---------------------------------------------------------------------------
// Volumes
// ---------------------------------------------------------------------------

export function volumesHtml(r: VolumeResult, ctx: ReportContext, cspSource: string, nonce: string): string {
    const names = ctx.names;
    const hasMass = !!ctx.massDensity && ctx.massDensity.size > 0;
    const sections = r.universes.map((u) => {
        const head = `<b>${u.id === r.root ? uniLabel(u.id, names) + ' (root)' : uniLabel(u.id, names)}</b> · ${u.cells.length || '—'} cells` +
            (u.skipped ? ` · <span class="muted">${esc(u.skipped)}</span>` : '') +
            (u.inherited.some(Boolean) ? ` · extent along ${['x', 'y', 'z'].filter((_, i) => u.inherited[i]).join(', ')} from container cell ${u.inheritedFrom ?? '?'}` +
                (u.containers > 1 ? ` (1 of ${u.containers})` : '') : '') +
            (u.extentVaries ? ' · <span class="tag bad">instances differ</span>' : '');
        if (u.skipped) return `<details><summary>${head}</summary></details>`;
        const rows = u.cells.map((c) => {
            let vol: string, err: string, mass = '';
            if (c.unbounded) { vol = '<span class="muted">unbounded</span>'; err = ''; }
            else if (c.volume === null || c.hits === 0) { vol = '<span class="muted">0 hits</span>'; err = ''; }
            else {
                vol = num(c.volume, 6);
                err = c.method === 'analytic' ? '<span class="muted">exact</span>' : c.relErr !== null ? `± ${(100 * c.relErr).toFixed(1)} %` : '';
                const rho = ctx.massDensity?.get(c.cell);
                if (rho !== undefined) mass = num(c.volume * rho, 5);
            }
            return `<tr><td>${cellLink(c.cell, names)}${c.fill ? ' <span class="tag fill">fill</span>' : ''}</td>` +
                `<td class="n">${vol}</td><td class="n muted">${err}</td>${hasMass ? `<td class="n">${mass}</td>` : ''}<td class="n muted">${c.method === 'analytic' ? '—' : c.hits.toLocaleString()}</td></tr>`;
        }).join('');
        const varyNote = u.extentVaries
            ? `<p class="banner warn">This universe is placed by ${u.containers} containers of different heights, so each instance of these cells has a different volume. The numbers below use container cell ${u.inheritedFrom}; the <code>vol</code>/<code>sd</code> cards write <code>j</code> for them.</p>`
            : '';
        return `<details${u.id === r.root ? ' open' : ''}><summary>${head}</summary>${varyNote}
<table><thead><tr><th>Cell</th><th class="n">Volume (cm³)</th><th class="n">1σ</th>${hasMass ? '<th class="n">Mass (g)</th>' : ''}<th class="n">Hits</th></tr></thead><tbody>${rows}</tbody></table>
<p class="muted">Box ${pt(u.bounds.min)} – ${pt(u.bounds.max)} = ${num(u.boxVolume, 5)} cm³ · ${u.samples.toLocaleString()} points</p></details>`;
    }).join('');

    const cards = ctx.cards
        ? `<h2>MCNP cards</h2>
<p><button data-cmd="insert" data-which="vol">Insert vol card</button><button class="sec" data-cmd="copy" data-which="vol">Copy</button></p>
<pre>${esc(ctx.cards.vol)}</pre>
${ctx.cards.sd.length ? `<p><button data-cmd="insert" data-which="sd">Insert sd cards</button><button class="sec" data-cmd="copy" data-which="sd">Copy</button></p><pre>${esc(ctx.cards.sd.join('\n'))}</pre>` : '<p class="muted">No F4/F6/F7 cell tallies in the deck, so no <code>sd</code> cards.</p>'}
<p class="muted">An F4/F6/F7 tally divides by cell volume; when MCNP cannot compute it (infinite cells, anything inside a lattice or <code>fill=</code>) the run is a fatal error until <code>vol</code> or <code>sd</code> supplies one. <code>j</code> keeps MCNP's own value.</p>`
        : '';

    const body = `
<h1>Cell Volumes — ${esc(ctx.fileName)}</h1>
<div class="sub">${esc(ctx.language.toUpperCase())} · geometry from ${esc(ctx.origin)} · ${r.elapsedMs} ms · stochastic, per universe instance</div>
<p><button data-cmd="rerun" data-which="more">Re-run with 10× points</button><button class="sec" data-cmd="rerun" data-which="same">Re-run</button></p>
${cards}
<h2>Volumes</h2>
${sections}
<ul class="notes">${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}${hasMass ? '<li>Mass uses the mass density on the cell (or Serpent material) card; atom-density cells have no mass column.</li>' : ''}</ul>`;
    return shell('OWEN: Cell Volumes', cspSource, nonce, body, '');
}
