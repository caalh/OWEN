import * as vscode from 'vscode';
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
        _extensionUri: vscode.Uri,
        initial?: RunResults,
        workDir?: string,
    ) {
        this._panel = panel;
        this._panel.webview.html = this._getHtml();

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

    private _getHtml(): string {
        const csp = [
            "default-src 'none'",
            `style-src ${this._panel.webview.cspSource} 'unsafe-inline' https://unpkg.com`,
            `script-src ${this._panel.webview.cspSource} 'unsafe-inline' https://unpkg.com`,
        ].join('; ');

        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <link rel="stylesheet" href="https://unpkg.com/uplot@1.6.30/dist/uPlot.min.css" />
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
    .chart { width: 100%; height: 280px; background: var(--card); border-radius: 8px; border: 1px solid var(--border); margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 6px 8px; border-bottom: 1px solid var(--border); text-align: left; }
    th { color: var(--muted); font-weight: 600; }
    .meta { font-size: 11px; color: var(--muted); margin-bottom: 12px; }
    .empty { color: var(--muted); padding: 24px; text-align: center; }
    .keff-banner { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
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
      <div id="keffChart" class="chart"></div>
    </div>
    <div id="spectrumTab" style="display:none">
      <div id="specChart" class="chart"></div>
    </div>
    <div id="talliesTab" style="display:none">
      <table><thead><tr><th>ID</th><th>Tally</th><th>Value</th><th>Rel. error</th><th>Checks</th></tr></thead><tbody id="tallyBody"></tbody></table>
    </div>
    <div id="meshTab" style="display:none">
      <canvas id="meshCanvas" width="600" height="400" style="max-width:100%;background:var(--card);border-radius:8px"></canvas>
    </div>
  </main>
  <script src="https://unpkg.com/uplot@1.6.30/dist/uPlot.iife.min.js"></script>
  <script>
    const vscode = acquireVsCodeApi();
    let keffPlot = null, specPlot = null;

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
    }
    document.querySelectorAll('.tab').forEach(t => t.onclick = () => showTab(t.dataset.tab));

    function buildKeffPlot(host, keff) {
      if (keffPlot) { keffPlot.destroy(); keffPlot = null; }
      if (!keff || !keff.mean.length) { host.innerHTML = '<div class="empty">No k-eff history</div>'; return; }
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
        width: host.clientWidth, height: 260,
        scales: { x: { time: false }, y: { auto: true } },
        axes: [
          { label: inactive ? 'Cycle / batch (' + inactive + ' discarded)' : 'Cycle / batch', stroke: '#94a3b8', grid: { stroke: 'rgba(255,255,255,0.06)' } },
          { label: 'k-eff', stroke: '#94a3b8', grid: { stroke: 'rgba(255,255,255,0.06)' } },
        ],
        series,
      }, data, host);
    }

    function buildSpecPlot(host, spectra) {
      if (specPlot) { specPlot.destroy(); specPlot = null; }
      if (!spectra.length) { host.innerHTML = '<div class="empty">No flux spectrum in this output</div>'; return; }
      host.innerHTML = '';
      const s = spectra[0];
      const E = s.E.filter(e => e > 0);
      const phi = s.phi.slice(0, E.length);
      specPlot = new uPlot({
        width: host.clientWidth, height: 260,
        scales: { x: { distr: 3 }, y: { distr: 3 } },
        axes: [
          { scale: 'x', label: 'Energy (eV)', stroke: '#94a3b8', values: (u,v) => v.map(logTick), grid: { stroke: 'rgba(255,255,255,0.06)' } },
          { scale: 'y', label: 'Flux', stroke: '#94a3b8', values: (u,v) => v.map(logTick), grid: { stroke: 'rgba(255,255,255,0.06)' } },
        ],
        series: [{}, { label: s.label, stroke: '#f97316', width: 2, points: { show: false } }],
      }, [E, phi.map(v => Math.max(v, 1e-30))], host);
    }

    function drawMeshHeatmap(mesh) {
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
      buildKeffPlot(document.getElementById('keffChart'), r.keff);
      buildSpecPlot(document.getElementById('specChart'), r.spectra || []);

      const tb = document.getElementById('tallyBody');
      tb.innerHTML = (r.tallies || []).map((t, i) => {
        const tag = t.checks && t.checks !== 'unknown'
          ? '<span class="tag ' + t.checks + '" title="' + esc(t.note || '') + '">' + t.checks + '</span>' : '';
        const bins = t.bins || [];
        const head =
          '<tr><td>' + esc(t.id) + '</td><td>' + esc(t.label) +
          (bins.length > 1 ? ' <span class="expand" data-toggle="' + i + '">' + bins.length + ' bins ▾</span>' : '') +
          (t.fom != null && isFinite(t.fom) ? ' <span class="chip">FOM ' + fmt(t.fom) + '</span>' : '') +
          '</td><td>' + fmt(t.value) + '</td><td>' + (t.error != null ? t.error.toExponential(2) : '—') +
          '</td><td>' + tag + '</td></tr>';
        const rows = bins.length > 1
          ? bins.map(b =>
              '<tr class="bin" data-parent="' + i + '" style="display:none"><td></td><td>' + esc(b.label) +
              '</td><td>' + fmt(b.value) + '</td><td>' +
              (b.error != null ? b.error.toExponential(2) : '—') + '</td><td></td></tr>').join('')
          : '';
        return head + rows;
      }).join('');
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
      if (r.meshTallies?.length) drawMeshHeatmap(r.meshTallies[0]);
    }

    window.addEventListener('message', e => {
      if (e.data.type === 'results') renderResults(e.data.results);
      if (e.data.type === 'error') document.getElementById('meta').textContent = e.data.message;
    });

    document.getElementById('pickBtn').onclick = () => vscode.postMessage({ command: 'pickFile' });
    document.getElementById('meshBtn').onclick = () => vscode.postMessage({ command: 'overlayMesh' });
    window.addEventListener('resize', () => {
      if (keffPlot) keffPlot.setSize({ width: document.getElementById('keffChart').clientWidth, height: 260 });
      if (specPlot) specPlot.setSize({ width: document.getElementById('specChart').clientWidth, height: 260 });
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
