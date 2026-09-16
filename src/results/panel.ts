import * as vscode from 'vscode';
import { vendorUri } from '../util/vendor';
import type { RunResults } from './types';
import { detectOutputsInDir, guessWorkDir, pickPrimaryOutput, staleOutputNote } from './detectOutputs';
import { parseOutput, parseOutputFile } from './index';
import { postMeshOverlay } from '../preview/webview';

export class ResultsPanel {
    public static currentPanel: ResultsPanel | undefined;
    private static readonly viewType = 'owen.results';

    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _results: RunResults | undefined;

    public static async createOrShow(
        extensionUri: vscode.Uri,
        results?: RunResults,
        workDir?: string,
    ) {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Beside;

        if (ResultsPanel.currentPanel) {
            ResultsPanel.currentPanel._panel.reveal(column);
            if (results) ResultsPanel.currentPanel._showResults(results);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            ResultsPanel.viewType,
            'OWEN: Results Viewer',
            column,
            { enableScripts: true, retainContextWhenHidden: true },
        );

        ResultsPanel.currentPanel = new ResultsPanel(panel, extensionUri, results, workDir);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        initial?: RunResults,
        workDir?: string,
    ) {
        this._panel = panel;
        this._panel.webview.html = this._getHtml(vendorUri(panel.webview, extensionUri, 'uplot'));

        this._panel.webview.onDidReceiveMessage(
            async (msg) => {
                if (msg?.command === 'overlayMesh' && this._results?.meshTallies?.length) {
                    postMeshOverlay(this._results.meshTallies[0]);
                } else if (msg?.command === 'pickFile') {
                    const uris = await vscode.window.showOpenDialog({
                        canSelectMany: false,
                        filters: {
                            'Run outputs': ['h5', 'mctal', 'm', 'out', 'outp', 'log', 'txt', 'o'],
                            'All files': ['*'],
                        },
                    });
                    if (uris?.[0]) {
                        await this._loadFile(uris[0].fsPath);
                    }
                }
            },
            null,
            this._disposables,
        );

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        if (initial) {
            this._showResults(initial);
        } else if (workDir) {
            this._autoDetect(workDir).catch(() => undefined);
        }
    }

    private async _autoDetect(workDir: string) {
        const outputs = detectOutputsInDir(workDir);
        const primary = pickPrimaryOutput(outputs);
        if (!primary) {
            this._panel.webview.postMessage({
                type: 'error',
                message: `No recognized output files in ${workDir}`,
            });
            return;
        }
        await this._loadDetected(primary, staleOutputNote(outputs, primary));
    }

    private async _loadFile(filePath: string) {
        try {
            this._showResults(await parseOutputFile(filePath));
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`OWEN Results: ${message}`);
        }
    }

    private async _loadDetected(
        detected: { path: string; code: RunResults['code']; kind: string; label: string },
        note?: string,
    ) {
        try {
            const results = await parseOutput(detected as Parameters<typeof parseOutput>[0]);
            if (note) results.notes = [note, ...(results.notes ?? [])];
            this._showResults(results);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`OWEN Results: ${message}`);
        }
    }

    private _showResults(results: RunResults) {
        this._results = results;
        this._panel.webview.postMessage({ type: 'results', results });
        if (results.meshTallies.length > 0) {
            vscode.window.showInformationMessage(
                'OWEN: Mesh tally detected — use "Overlay on 3D Preview" in Results Viewer.',
            );
        }
    }

    public dispose() {
        ResultsPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) d.dispose();
        }
    }

    private _getHtml(uplotBase: string): string {
        const csp = [
            "default-src 'none'",
            `style-src ${this._panel.webview.cspSource} 'unsafe-inline'`,
            `script-src ${this._panel.webview.cspSource} 'unsafe-inline'`,
        ].join('; ');

        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <link rel="stylesheet" href="${uplotBase}/uPlot.min.css" />
  <style>
    :root { --bg: #0b1020; --card: #121a2e; --text: #e2e8f0; --muted: #94a3b8; --accent: #38bdf8; --border: rgba(255,255,255,0.08); }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: system-ui, sans-serif; font-size: 13px; }
    header { padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .badge { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; color: var(--accent); border: 1px solid rgba(56,189,248,0.35); padding: 2px 8px; border-radius: 4px; }
    h1 { margin: 0; font-size: 14px; }
    button { background: var(--card); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; font-size: 12px; cursor: pointer; }
    button:hover { border-color: var(--accent); }
    .tabs { display: flex; gap: 4px; padding: 8px 16px; border-bottom: 1px solid var(--border); }
    .tab { padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; color: var(--muted); }
    .tab.active { background: var(--card); color: var(--text); }
    main { padding: 16px; }
    .chart { width: 100%; height: 280px; background: var(--card); border-radius: 8px; border: 1px solid var(--border); margin-bottom: 12px; overflow: hidden; }
    .chart.placeholder { height: auto; }
    .plotcap { display: flex; flex-wrap: wrap; gap: 14px; padding: 4px 12px 6px; font-size: 11px; color: var(--muted); }
    .plotcap i { display: inline-block; width: 12px; height: 3px; margin-right: 6px; vertical-align: middle; border-radius: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 6px 8px; border-bottom: 1px solid var(--border); text-align: left; }
    th { color: var(--muted); font-weight: 600; }
    .meta { font-size: 11px; color: var(--muted); margin-bottom: 12px; }
    .empty { color: var(--muted); padding: 24px; text-align: center; }
    .keff-banner { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
    .conv { margin: 0 0 12px; padding: 10px 12px; border-radius: 8px; background: var(--card); border: 1px solid var(--border); }
    .conv .verdict { font-weight: 700; letter-spacing: .04em; text-transform: uppercase; font-size: 11px; padding: 2px 8px; border-radius: 4px; margin-right: 8px; }
    .conv .verdict.converged { background: rgba(34,197,94,.18); color: #4ade80; }
    .conv .verdict.suspect { background: rgba(245,158,11,.18); color: #fbbf24; }
    .conv .verdict.unconverged { background: rgba(239,68,68,.18); color: #f87171; }
    .conv .verdict.unknown { background: rgba(148,163,184,.18); color: var(--muted); }
    .conv ul { margin: 6px 0 0; padding-left: 18px; color: var(--muted); }
    .conv ul li { margin: 2px 0; }
    .conv .stats { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 6px; color: var(--muted); font-size: 12px; }
    .conv .stats b { color: var(--text); font-weight: 600; }
    .conv-h { font-size: 12px; color: var(--muted); margin: 10px 0 4px; }
    #estimators table { margin-top: 10px; width: auto; }
    #estimators td.spread { color: var(--muted); }
    tr.checks td { padding: 4px 8px 8px 24px; }
    .checks table { width: auto; font-size: 12px; }
    .checks td, .checks th { padding: 2px 10px; }
    .checks .no { color: #f87171; font-weight: 600; }
    .checks .ok { color: #4ade80; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
    .chip { font-size: 11px; color: var(--muted); background: var(--card); border: 1px solid var(--border); border-radius: 999px; padding: 2px 9px; }
    .chip b { color: var(--text); font-weight: 600; }
    .msgs { margin-bottom: 12px; }
    .msg { font-size: 11px; border-left: 2px solid var(--border); padding: 4px 10px; margin-bottom: 4px; color: var(--muted); }
    .msg.warn { border-left-color: #f59e0b; }
    .msg.note { border-left-color: var(--accent); }
    .msgs details summary { cursor: pointer; font-size: 11px; color: var(--muted); }
    tr.bin td { color: var(--muted); font-size: 11px; }
    tr.bin td:first-child { padding-left: 24px; }
    .tag { font-size: 10px; letter-spacing: 0.06em; border-radius: 4px; padding: 1px 6px; border: 1px solid var(--border); }
    .tag.passed { color: #34d399; border-color: rgba(52,211,153,0.4); }
    .tag.missed { color: #f59e0b; border-color: rgba(245,158,11,0.4); }
    .tag.zero { color: #f87171; border-color: rgba(248,113,113,0.4); }
    .expand { cursor: pointer; user-select: none; color: var(--accent); }
  </style>
</head>
<body>
  <header>
    <span class="badge">RESULTS</span>
    <h1>Cross-Code Results Viewer</h1>
    <button id="pickBtn">Open output file…</button>
    <button id="meshBtn" style="display:none">Overlay on 3D Preview</button>
  </header>
  <div class="tabs">
    <span class="tab active" data-tab="keff">k-eff convergence</span>
    <span class="tab" data-tab="spectrum">Flux spectrum</span>
    <span class="tab" data-tab="tallies">Tallies</span>
    <span class="tab" data-tab="mesh">Mesh heatmap</span>
  </div>
  <main>
    <div id="meta" class="meta">Load a run output or open from last simulation directory.</div>
    <div id="chips" class="chips"></div>
    <div id="msgs" class="msgs"></div>
    <div id="keffTab">
      <div id="keffBanner" class="keff-banner"></div>
      <div id="convergence" class="conv"></div>
      <div id="keffChart" class="chart"></div>
      <div id="entropyWrap" style="display:none">
        <div class="conv-h">Shannon entropy of the fission source</div>
        <div id="entropyChart" class="chart"></div>
      </div>
      <div id="estimators"></div>
    </div>
    <div id="spectrumTab" style="display:none">
      <div id="specChart" class="chart"></div>
    </div>
    <div id="talliesTab" style="display:none">
      <table><thead><tr><th>ID</th><th>Tally</th><th>Value</th><th>Rel. error</th><th>Checks</th></tr></thead><tbody id="tallyBody"></tbody></table>
    </div>
    <div id="meshTab" style="display:none">
      <div id="meshWrap"><div class="chart placeholder"><div class="empty">No mesh tally in this output.</div></div></div>
    </div>
  </main>
  <script src="${uplotBase}/uPlot.iife.min.js"></script>
  <script>
    const vscode = acquireVsCodeApi();
    let keffPlot = null, specPlot = null, entropyPlot = null;
    let lastResults = null;

    // uPlot's default legend (the "Value: --" / series checkboxes strip) is
    // built for dashboards, not this panel — it used to overflow the fixed
    // chart box onto the estimators table. Legends are off everywhere; each
    // chart carries its own caption row instead.
    function addCaption(host, parts) {
      const d = document.createElement('div');
      d.className = 'plotcap';
      d.innerHTML = parts.map(p => '<span><i style="background:' + p.color + '"></i>' + esc(p.label) + '</span>').join('');
      host.appendChild(d);
    }
    function plotWidth(host) { return host.clientWidth || host.parentElement.clientWidth || 640; }

    function supExp(p) {
      const m = { '-': '\\u207b', '0': '\\u2070', '1': '\\u00b9', '2': '\\u00b2', '3': '\\u00b3', '4': '\\u2074', '5': '\\u2075', '6': '\\u2076', '7': '\\u2077', '8': '\\u2078', '9': '\\u2079' };
      return String(p).split('').map(ch => m[ch] || ch).join('');
    }
    function logTick(v) {
      if (!(v > 0)) return '';
      const l = Math.log10(v); const r = Math.round(l);
      return Math.abs(l - r) < 1e-6 ? '10' + supExp(r) : '';
    }

    function showTab(name) {
      document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
      ['keff','spectrum','tallies','mesh'].forEach(id => {
        document.getElementById(id + 'Tab').style.display = id === name ? 'block' : 'none';
      });
      // A plot built while its tab was display:none had clientWidth 0 and
      // rendered as a blank box. Rebuild the newly visible tab's plots now.
      if (lastResults) {
        if (name === 'keff') {
          buildKeffPlot(document.getElementById('keffChart'), lastResults.keff);
          buildEntropyPlot(document.getElementById('entropyChart'), lastResults.keff);
        } else if (name === 'spectrum') {
          buildSpecPlot(document.getElementById('specChart'), lastResults.spectra || []);
        } else if (name === 'mesh') {
          renderMesh(lastResults);
        }
      }
    }
    document.querySelectorAll('.tab').forEach(t => t.onclick = () => showTab(t.dataset.tab));

    function buildKeffPlot(host, keff) {
      if (keffPlot) { keffPlot.destroy(); keffPlot = null; }
      // A single fabricated point (final-estimate-only outputs) is not a
      // history — plotting it gave a blank axis box. Say so instead.
      const realPoints = keff && keff.mean ? keff.mean.length : 0;
      if (!keff || realPoints < 2) {
        host.classList.add('placeholder');
        host.innerHTML = '<div class="empty">' + (keff && keff.final
          ? 'This output carries only the final k-eff (no cycle-by-cycle table), so there is no convergence history to plot. The banner above shows the final estimate; the estimator table below still applies.'
          : 'No k-eff history in this output.') + '</div>';
        return;
      }
      host.classList.remove('placeholder');
      host.innerHTML = '';
      const inactive = keff.inactive ?? 0;
      // Split the series so discarded settling cycles read differently.
      const settling = keff.mean.map((m, i) => (i < inactive ? m : null));
      const active = keff.mean.map((m, i) => (i >= inactive ? m : null));
      const hasSigma = keff.std.some(s => s > 0);
      const series = [{},
        { label: inactive ? 'k (settling)' : 'k', stroke: '#64748b', width: 1 },
        { label: inactive ? 'k (active)' : 'k', stroke: '#38bdf8', width: 2 }];
      const data = [keff.cycles, settling, active];
      if (hasSigma) {
        series.push({ label: '+σ', stroke: 'rgba(56,189,248,0.35)', width: 1 });
        data.push(keff.mean.map((m, i) => (keff.std[i] > 0 ? m + keff.std[i] : null)));
      }
      keffPlot = new uPlot({
        width: plotWidth(host), height: 236,
        legend: { show: false },
        scales: { x: { time: false }, y: { auto: true } },
        axes: [
          { label: inactive ? 'Cycle / batch (' + inactive + ' discarded)' : 'Cycle / batch', stroke: '#94a3b8', grid: { stroke: 'rgba(255,255,255,0.06)' } },
          { label: 'k-eff', stroke: '#94a3b8', grid: { stroke: 'rgba(255,255,255,0.06)' } },
        ],
        series,
      }, data, host);
      const cap = [];
      if (inactive) cap.push({ color: '#64748b', label: 'k (settling, discarded)' });
      cap.push({ color: '#38bdf8', label: inactive ? 'k (active)' : 'k per cycle' });
      if (hasSigma) cap.push({ color: 'rgba(56,189,248,0.55)', label: 'k + σ' });
      addCaption(host, cap);
    }

    function buildEntropyPlot(host, keff) {
      if (entropyPlot) { entropyPlot.destroy(); entropyPlot = null; }
      const wrap = document.getElementById('entropyWrap');
      const ent = keff && keff.entropy;
      if (!ent || ent.length !== keff.cycles.length) { wrap.style.display = 'none'; return; }
      wrap.style.display = 'block';
      host.innerHTML = '';
      const inactive = keff.inactive ?? 0;
      const settling = ent.map((v, i) => (i < inactive ? v : null));
      const active = ent.map((v, i) => (i >= inactive ? v : null));
      entropyPlot = new uPlot({
        width: plotWidth(host), height: 156,
        legend: { show: false },
        scales: { x: { time: false }, y: { auto: true } },
        axes: [
          { label: 'Cycle / batch', stroke: '#94a3b8', grid: { stroke: 'rgba(255,255,255,0.06)' } },
          { label: 'H (bits)', stroke: '#94a3b8', grid: { stroke: 'rgba(255,255,255,0.06)' } },
        ],
        series: [{}, { label: 'H (settling)', stroke: '#64748b', width: 1 }, { label: 'H (active)', stroke: '#a78bfa', width: 2 }],
      }, [keff.cycles, settling, active], host);
      addCaption(host, [{ color: '#64748b', label: 'H (settling)' }, { color: '#a78bfa', label: 'H (active)' }]);
    }

    function renderConvergence(r) {
      const box = document.getElementById('convergence');
      const c = r.convergence;
      if (!c) { box.style.display = 'none'; return; }
      box.style.display = 'block';
      const label = { converged: 'converged', suspect: 'check', unconverged: 'not converged', unknown: 'no verdict' }[c.verdict] || c.verdict;
      const stats = [];
      if (c.activeCycles) stats.push('<span><b>' + c.activeCycles + '</b> active cycles</span>');
      if (c.firstHalf != null) stats.push('<span>halves <b>' + c.firstHalf.toFixed(5) + '</b> / <b>' + c.secondHalf.toFixed(5) + '</b></span>');
      if (c.cycleSigma != null) stats.push('<span>per-cycle σ <b>' + c.cycleSigma.toExponential(2) + '</b></span>');
      if (c.driftZ != null) stats.push('<span>drift <b>' + c.driftZ.toFixed(1) + 'σ</b></span>');
      if (c.entropyZ != null) stats.push('<span>entropy step <b>' + c.entropyZ.toFixed(1) + 'σ</b></span>');
      if (c.lostParticles != null) stats.push('<span>lost particles <b>' + c.lostParticles + '</b></span>');
      box.innerHTML =
        '<span class="verdict ' + esc(c.verdict) + '">' + esc(label) + '</span>' +
        '<span style="color:var(--muted)">Convergence reading (heuristic — look at the plot)</span>' +
        (stats.length ? '<div class="stats">' + stats.join('') + '</div>' : '') +
        (c.reasons && c.reasons.length ? '<ul>' + c.reasons.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '');

      const est = document.getElementById('estimators');
      if (c.estimators && c.estimators.length) {
        const ref = c.estimators.find(e => e.name === 'combined') || c.estimators[c.estimators.length - 1];
        est.innerHTML = '<div class="conv-h">k-eff estimators</div><table><thead><tr><th>Estimator</th><th>k</th><th>σ</th><th>vs combined</th></tr></thead><tbody>' +
          c.estimators.map(e => {
            const d = ref && ref !== e ? (e.mean - ref.mean) : 0;
            const sig = ref && ref !== e && (e.std || ref.std) ? Math.abs(d) / Math.sqrt(e.std * e.std + ref.std * ref.std) : null;
            return '<tr><td>' + esc(e.name) + '</td><td>' + e.mean.toFixed(5) + '</td><td>' + (e.std ? e.std.toFixed(5) : '—') +
              '</td><td class="spread">' + (sig == null ? '' : (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(5) + ' (' + sig.toFixed(1) + 'σ)') + '</td></tr>';
          }).join('') + '</tbody></table>' +
          '<div class="conv-h">Estimators that disagree by more than ~2σ usually mean the fission source had not converged when the active cycles began.</div>';
      } else est.innerHTML = '';
    }

    function buildSpecPlot(host, spectra) {
      if (specPlot) { specPlot.destroy(); specPlot = null; }
      if (!spectra.length) {
        host.classList.add('placeholder');
        host.innerHTML = '<div class="empty">No flux spectrum in this output.</div>';
        return;
      }
      host.classList.remove('placeholder');
      host.innerHTML = '';
      const s = spectra[0];
      const E = s.E.filter(e => e > 0);
      const phi = s.phi.slice(0, E.length);
      specPlot = new uPlot({
        width: plotWidth(host), height: 236,
        legend: { show: false },
        scales: { x: { distr: 3, time: false }, y: { distr: 3 } },
        axes: [
          { scale: 'x', label: 'Energy (eV)', stroke: '#94a3b8', values: (u,v) => v.map(logTick), grid: { stroke: 'rgba(255,255,255,0.06)' } },
          { scale: 'y', label: 'Flux', stroke: '#94a3b8', values: (u,v) => v.map(logTick), grid: { stroke: 'rgba(255,255,255,0.06)' } },
        ],
        series: [{}, { label: s.label, stroke: '#f97316', width: 2, points: { show: false } }],
      }, [E, phi.map(v => Math.max(v, 1e-30))], host);
      addCaption(host, [{ color: '#f97316', label: s.label + (s.unit ? ' — ' + s.unit : '') }]);
    }

    function renderMesh(r) {
      const wrap = document.getElementById('meshWrap');
      const meshes = (r && r.meshTallies) || [];
      if (!meshes.length) {
        wrap.innerHTML = '<div class="chart placeholder"><div class="empty">No mesh tally in this output. MCNP: add an FMESH card; OpenMC: a MeshFilter tally; Serpent: a det with dx/dy bins.</div></div>';
        return;
      }
      wrap.innerHTML = '<canvas id="meshCanvas" width="600" height="400" style="max-width:100%;background:var(--card);border-radius:8px"></canvas><div class="plotcap" id="meshCap"></div>';
      const mesh = meshes[0];
      const c = document.getElementById('meshCanvas');
      const ctx = c.getContext('2d');
      const { nx, ny, values } = mesh;
      const nz = mesh.nz || 1;
      const slice = values.slice(0, nx * ny);
      if (!slice.length) return;
      const max = Math.max(...slice, 1e-30);
      const cw = c.width / nx, ch = c.height / ny;
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const v = slice[i + nx * j] / max;
          const hue = (1 - v) * 240;
          ctx.fillStyle = 'hsl(' + hue + ',70%,45%)';
          ctx.fillRect(i * cw, (ny - 1 - j) * ch, cw, ch);
        }
      }
      document.getElementById('meshCap').innerHTML =
        '<span><i style="background:hsl(240,70%,45%)"></i>0</span>' +
        '<span><i style="background:hsl(0,70%,45%)"></i>max ' + fmt(max) + '</span>' +
        '<span>' + nx + '\u00d7' + ny + (nz > 1 ? '\u00d7' + nz + ' (first z-slice shown)' : '') + '</span>';
    }

    function esc(s) {
      return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }
    function fmt(v) {
      if (v == null || !isFinite(v)) return '—';
      if (v === 0) return '0';
      return Math.abs(v) >= 1e-3 && Math.abs(v) < 1e5 ? v.toPrecision(6) : v.toExponential(4);
    }

    function renderResults(r) {
      lastResults = r;
      document.getElementById('meta').textContent =
        (r.code ? r.code.toUpperCase() + ' · ' : '') + (r.sourceFile || 'unknown source');

      const chips = document.getElementById('chips');
      chips.innerHTML = Object.entries(r.metadata || {})
        .map(([k, v]) => '<span class="chip">' + esc(k) + ' <b>' + esc(v) + '</b></span>').join('');

      const msgs = document.getElementById('msgs');
      const notes = (r.notes || []).map(n => '<div class="msg note">' + esc(n) + '</div>').join('');
      const warns = r.warnings && r.warnings.length
        ? '<details open><summary>' + r.warnings.length + ' warning' + (r.warnings.length === 1 ? '' : 's') +
          ' from the output file</summary>' +
          r.warnings.map(w => '<div class="msg warn">' + esc(w) + '</div>').join('') + '</details>'
        : '';
      msgs.innerHTML = notes + warns;

      const kb = document.getElementById('keffBanner');
      if (r.keff?.final) {
        const f = r.keff.final;
        kb.textContent = 'k-eff = ' + f.mean.toFixed(5) + (f.std ? ' ± ' + f.std.toFixed(5) : '');
      } else kb.textContent = '';
      renderConvergence(r);
      buildKeffPlot(document.getElementById('keffChart'), r.keff);
      buildEntropyPlot(document.getElementById('entropyChart'), r.keff);
      buildSpecPlot(document.getElementById('specChart'), r.spectra || []);

      const tb = document.getElementById('tallyBody');
      tb.innerHTML = (r.tallies || []).map((t, i) => {
        const detail = t.checkDetail || [];
        const tag = t.checks && t.checks !== 'unknown'
          ? '<span class="tag ' + t.checks + '" title="' + esc(t.note || '') + '">' + t.checks + '</span>' +
            (detail.length ? ' <span class="expand" data-checks="' + i + '">10 checks ▾</span>' : '')
          : '';
        const bins = t.bins || [];
        const head =
          '<tr><td>' + esc(t.id) + '</td><td>' + esc(t.label) +
          (bins.length > 1 ? ' <span class="expand" data-toggle="' + i + '">' + bins.length + ' bins ▾</span>' : '') +
          (t.fom != null && isFinite(t.fom) ? ' <span class="chip">FOM ' + fmt(t.fom) + '</span>' : '') +
          '</td><td>' + fmt(t.value) + '</td><td>' + (t.error != null ? t.error.toExponential(2) : '—') +
          '</td><td>' + tag + '</td></tr>';
        const checkRow = detail.length
          ? '<tr class="checks" data-checks-row="' + i + '" style="display:none"><td colspan="5"><div class="checks"><table><thead><tr><th>Check</th><th>Desired</th><th>Observed</th><th></th></tr></thead><tbody>' +
            detail.map(d => '<tr><td>' + esc(d.name) + '</td><td>' + esc(d.desired) + '</td><td>' + esc(d.observed) + '</td><td class="' + (d.passed ? 'ok' : 'no') + '">' + (d.passed ? 'passed' : 'FAILED') + '</td></tr>').join('') +
            '</tbody></table></div></td></tr>'
          : '';
        const rows = bins.length > 1
          ? bins.map(b =>
              '<tr class="bin" data-parent="' + i + '" style="display:none"><td></td><td>' + esc(b.label) +
              '</td><td>' + fmt(b.value) + '</td><td>' +
              (b.error != null ? b.error.toExponential(2) : '—') + '</td><td></td></tr>').join('')
          : '';
        return head + checkRow + rows;
      }).join('');
      tb.querySelectorAll('[data-checks]').forEach(el => {
        el.onclick = () => {
          const row = tb.querySelector('tr.checks[data-checks-row="' + el.dataset.checks + '"]');
          if (!row) return;
          const open = row.style.display !== 'none';
          row.style.display = open ? 'none' : 'table-row';
          el.textContent = '10 checks ' + (open ? '▾' : '▴');
        };
      });
      tb.querySelectorAll('[data-toggle]').forEach(el => {
        el.onclick = () => {
          const id = el.dataset.toggle;
          const rows = tb.querySelectorAll('tr.bin[data-parent="' + id + '"]');
          const open = rows.length && rows[0].style.display !== 'none';
          rows.forEach(rw => { rw.style.display = open ? 'none' : 'table-row'; });
          el.textContent = rows.length + ' bins ' + (open ? '▾' : '▴');
        };
      });

      document.getElementById('meshBtn').style.display = (r.meshTallies?.length) ? 'inline-block' : 'none';
      renderMesh(r);
    }

    window.addEventListener('message', e => {
      if (e.data.type === 'results') renderResults(e.data.results);
      if (e.data.type === 'error') document.getElementById('meta').textContent = e.data.message;
    });

    document.getElementById('pickBtn').onclick = () => vscode.postMessage({ command: 'pickFile' });
    document.getElementById('meshBtn').onclick = () => vscode.postMessage({ command: 'overlayMesh' });
    window.addEventListener('resize', () => {
      if (keffPlot) keffPlot.setSize({ width: plotWidth(document.getElementById('keffChart')), height: 236 });
      if (specPlot) specPlot.setSize({ width: plotWidth(document.getElementById('specChart')), height: 236 });
      if (entropyPlot) entropyPlot.setSize({ width: plotWidth(document.getElementById('entropyChart')), height: 156 });
    });
  </script>
</body>
</html>`;
    }
}

export async function openResultsViewer(
    extensionUri: vscode.Uri,
    opts?: { filePath?: string; workDir?: string },
): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('owen');
    const editor = vscode.window.activeTextEditor;

    let workDir = opts?.workDir;
    if (!workDir && editor) {
        workDir = guessWorkDir(
            editor.document.uri.fsPath,
            cfg.get<string>('simulation.workingDirectory'),
        );
    }

    if (opts?.filePath) {
        const results = await parseOutputFile(opts.filePath);
        await ResultsPanel.createOrShow(extensionUri, results, workDir);
        return;
    }

    await ResultsPanel.createOrShow(extensionUri, undefined, workDir);
}
