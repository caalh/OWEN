import * as vscode from 'vscode';
import { detectNuclides } from './detectNuclides';
import {
    allenDataBaseUrl,
    ALLEN_REACTIONS,
    fetchAllenCurve,
    fetchAllenIndex,
    nuclideAvailable,
    type AllenCurve,
    type AllenIndex,
} from './fetch';

export class AllenPanel {
    public static currentPanel: AllenPanel | undefined;
    private static readonly viewType = 'owen.allen';

    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _index: AllenIndex | undefined;

    public static async createOrShow(
        extensionUri: vscode.Uri,
        initial?: { nuclides?: string[]; reactions?: string[]; temperature?: number },
    ) {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Beside;

        if (AllenPanel.currentPanel) {
            AllenPanel.currentPanel._panel.reveal(column);
            if (initial) {
                AllenPanel.currentPanel._postInit(initial);
            }
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            AllenPanel.viewType,
            'OWEN: ALLEN Cross-Sections',
            column,
            { enableScripts: true, retainContextWhenHidden: true },
        );

        AllenPanel.currentPanel = new AllenPanel(panel, extensionUri, initial);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        _extensionUri: vscode.Uri,
        initial?: { nuclides?: string[]; reactions?: string[]; temperature?: number },
    ) {
        this._panel = panel;
        this._panel.webview.html = this._placeholderHtml();

        this._panel.webview.onDidReceiveMessage(
            async (msg) => {
                if (msg?.command === 'ready') {
                    await this._bootstrap(initial);
                } else if (msg?.command === 'loadCurves') {
                    await this._loadCurves(msg.nuclides, msg.reactions, msg.temperature);
                }
            },
            null,
            this._disposables,
        );

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    private _postInit(initial: { nuclides?: string[]; reactions?: string[]; temperature?: number }) {
        this._panel.webview.postMessage({ type: 'init', ...initial });
    }

    private async _bootstrap(initial?: { nuclides?: string[]; reactions?: string[]; temperature?: number }) {
        const cfg = vscode.workspace.getConfiguration('owen');
        const baseUrl = allenDataBaseUrl(cfg);

        try {
            this._index = await fetchAllenIndex(baseUrl);
            const nuclides = Object.keys(this._index.nuclides).sort();
            this._panel.webview.html = this._getHtml(baseUrl);
            this._panel.webview.postMessage({
                type: 'index',
                index: this._index,
                nuclides,
                reactions: ALLEN_REACTIONS,
                initial: {
                    nuclides: initial?.nuclides ?? ['U235', 'U238'],
                    reactions: initial?.reactions ?? ['fission', 'capture'],
                    temperature: initial?.temperature ?? 294,
                },
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`OWEN ALLEN: ${message}`);
            this._panel.webview.html = this._errorHtml(message);
        }
    }

    private async _loadCurves(nuclides: string[], reactions: string[], temperature: number) {
        if (!this._index) return;
        const cfg = vscode.workspace.getConfiguration('owen');
        const baseUrl = allenDataBaseUrl(cfg);
        const lib = this._index.libraryKey;
        const curves: AllenCurve[] = [];

        for (const nuclide of nuclides) {
            for (const reaction of reactions) {
                if (!nuclideAvailable(this._index, nuclide, reaction, temperature)) continue;
                const c = await fetchAllenCurve(baseUrl, lib, nuclide, reaction, temperature);
                if (c) curves.push(c);
            }
        }

        this._panel.webview.postMessage({ type: 'curves', curves, temperature });
    }

    public dispose() {
        AllenPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) d.dispose();
        }
    }

    private _placeholderHtml(): string {
        return `<!DOCTYPE html><html><body style="background:#0b1020;color:#94a3b8;font-family:sans-serif;padding:2rem">
          <p>Loading ALLEN cross-section data…</p>
          <script>const vscode = acquireVsCodeApi(); vscode.postMessage({ command: 'ready' });</script>
        </body></html>`;
    }

    private _errorHtml(message: string): string {
        return `<!DOCTYPE html><html><body style="background:#0b1020;color:#fca5a5;font-family:sans-serif;padding:2rem">
          <h2>ALLEN load failed</h2><p>${message}</p>
          <p style="color:#94a3b8;font-size:0.85rem">Check owen.allen.dataBaseUrl or network connectivity.</p>
        </body></html>`;
    }

    private _getHtml(baseUrl: string): string {
        const csp = [
            "default-src 'none'",
            `img-src ${this._panel.webview.cspSource} https: data:`,
            `style-src ${this._panel.webview.cspSource} 'unsafe-inline' https://unpkg.com`,
            `script-src ${this._panel.webview.cspSource} 'unsafe-inline' https://unpkg.com`,
            `connect-src ${this._panel.webview.cspSource} https://reactormc.net https://*.reactormc.net ${baseUrl}`,
        ].join('; ');

        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="https://unpkg.com/uplot@1.6.30/dist/uPlot.min.css" />
  <style>
    :root { --bg: #0b1020; --card: #121a2e; --text: #e2e8f0; --muted: #94a3b8; --accent: #f87171; --border: rgba(255,255,255,0.08); }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: system-ui, sans-serif; font-size: 13px; }
    header { padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .badge { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); border: 1px solid rgba(248,113,113,0.35); background: rgba(127,29,29,0.25); padding: 2px 8px; border-radius: 4px; }
    h1 { margin: 0; font-size: 14px; font-weight: 600; }
    .sub { color: var(--muted); font-size: 11px; }
    .layout { display: grid; grid-template-columns: 220px 1fr; min-height: calc(100vh - 52px); }
    aside { border-right: 1px solid var(--border); padding: 12px; overflow-y: auto; }
    main { padding: 12px 16px; min-width: 0; }
    label { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 10px 0 4px; }
    select, button { width: 100%; background: var(--card); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; font-size: 12px; }
    button { cursor: pointer; margin-top: 8px; }
    button:hover { border-color: var(--accent); }
    .chk { display: flex; align-items: center; gap: 6px; margin: 4px 0; font-size: 12px; }
    .chk input { width: auto; }
    #chart { width: 100%; height: 420px; background: var(--card); border-radius: 8px; border: 1px solid var(--border); }
    #readout { font-family: ui-monospace, monospace; font-size: 11px; color: var(--muted); min-height: 1.2em; line-height: 1.5; margin-bottom: 8px; word-break: break-word; }
    .legend { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; font-size: 11px; }
    .legend span { display: inline-flex; align-items: center; gap: 4px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; }
    .coverage { margin-top: 12px; padding: 8px; border-radius: 6px; border: 1px solid rgba(251,191,36,0.25); background: rgba(251,191,36,0.06); font-size: 11px; color: var(--muted); display: none; }
  </style>
</head>
<body>
  <header>
    <span class="badge">ALLEN</span>
    <div>
      <h1>Atomic Library Linking Evaluated Nuclear-data</h1>
      <div class="sub">σ(E) from ENDF/B-VIII.0 · log-log plot</div>
    </div>
  </header>
  <div class="layout">
    <aside>
      <label>Nuclides</label>
      <div id="nuclideList"></div>
      <label>Reactions</label>
      <div id="reactionList"></div>
      <label>Temperature</label>
      <select id="tempSelect"></select>
      <button id="reloadBtn">Update plot</button>
      <div id="coverage" class="coverage"></div>
    </aside>
    <main>
      <div id="readout">Hover chart for σ(E) readout</div>
      <div id="chart"></div>
      <div id="legend" class="legend"></div>
    </main>
  </div>
  <script src="https://unpkg.com/uplot@1.6.30/dist/uPlot.iife.min.js"></script>
  <script>
    const vscode = acquireVsCodeApi();
    const state = { nuclides: ['U235','U238'], reactions: ['fission','capture'], temperature: 294, index: null, allNuclides: [], reactionsMeta: [], plot: null, curves: [] };
    const REACTION_COLORS = { total:'#94a3b8', elastic:'#38bdf8', fission:'#f97316', capture:'#a855f7', n2n:'#22c55e', inelastic:'#eab308' };

    function fmtLabel(n) { return n.replace(/^([A-Z][a-z]?)(\\d+)$/, '$1-$2'); }

    function renderPickers() {
      const nl = document.getElementById('nuclideList');
      nl.innerHTML = '';
      state.allNuclides.forEach(n => {
        const row = document.createElement('label');
        row.className = 'chk';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = n;
        cb.checked = state.nuclides.includes(n);
        cb.onchange = () => {
          if (cb.checked) state.nuclides.push(n);
          else state.nuclides = state.nuclides.filter(x => x !== n);
        };
        row.appendChild(cb);
        row.appendChild(document.createTextNode(fmtLabel(n)));
        nl.appendChild(row);
      });

      const rl = document.getElementById('reactionList');
      rl.innerHTML = '';
      state.reactionsMeta.forEach(r => {
        const row = document.createElement('label');
        row.className = 'chk';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = r.slug;
        cb.checked = state.reactions.includes(r.slug);
        cb.onchange = () => {
          if (cb.checked) state.reactions.push(r.slug);
          else state.reactions = state.reactions.filter(x => x !== r.slug);
        };
        row.appendChild(cb);
        row.appendChild(document.createTextNode(r.label));
        rl.appendChild(row);
      });

      const ts = document.getElementById('tempSelect');
      const temps = new Set([294]);
      state.nuclides.forEach(n => {
        const m = state.index?.nuclides?.[n];
        if (m) m.temperatures.forEach(t => temps.add(t));
      });
      ts.innerHTML = '';
      [...temps].sort((a,b)=>a-b).forEach(t => {
        const o = document.createElement('option');
        o.value = t; o.textContent = t + ' K';
        if (t === state.temperature) o.selected = true;
        ts.appendChild(o);
      });
    }

    function requestCurves() {
      vscode.postMessage({ command: 'loadCurves', nuclides: state.nuclides, reactions: state.reactions, temperature: state.temperature });
    }

    function buildPlot(curves) {
      state.curves = curves;
      const host = document.getElementById('chart');
      if (state.plot) { state.plot.destroy(); state.plot = null; }
      host.innerHTML = '';
      if (!curves.length) {
        host.textContent = 'No curves available for selection.';
        document.getElementById('legend').innerHTML = '';
        return;
      }

      // Build one sorted, de-duplicated energy grid across every curve so each
      // curve keeps its native sample points. Points outside a curve's own
      // energy range become null so lines end cleanly (no vertical cliff to
      // ~0 at the edges). These helpers mirror owen/src/allen/plotConfig.ts,
      // which is unit-tested in src/test/suite/allenPlot.test.ts.
      function unifiedGrid(cs) {
        const set = new Set();
        cs.forEach(c => c.E.forEach(e => { if (e > 0) set.add(e); }));
        return [...set].sort((a, b) => a - b);
      }
      function interpLogLog(srcE, srcXs, e) {
        const n = srcE.length;
        if (n === 0 || e < srcE[0] || e > srcE[n - 1]) return null;
        let lo = 0, hi = n - 1;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (srcE[mid] <= e) lo = mid; else hi = mid; }
        const x0 = srcE[lo], x1 = srcE[hi], y0 = srcXs[lo], y1 = srcXs[hi];
        if (y0 <= 0 || y1 <= 0 || x0 <= 0 || x1 <= 0) {
          const t = (e - x0) / (x1 - x0 || 1);
          const y = y0 + (y1 - y0) * t;
          return y > 0 ? y : null;
        }
        const lx0 = Math.log10(x0), lx1 = Math.log10(x1), le = Math.log10(e);
        const t = (le - lx0) / (lx1 - lx0 || 1);
        return Math.pow(10, Math.log10(y0) * (1 - t) + Math.log10(y1) * t);
      }
      function supExp(p) {
        const m = { '-': '\u207b', '0': '\u2070', '1': '\u00b9', '2': '\u00b2', '3': '\u00b3', '4': '\u2074', '5': '\u2075', '6': '\u2076', '7': '\u2077', '8': '\u2078', '9': '\u2079' };
        return String(p).split('').map(ch => m[ch] || ch).join('');
      }
      function logTickLabel(v) {
        if (!(v > 0)) return '';
        const l = Math.log10(v);
        const r = Math.round(l);
        return Math.abs(l - r) < 1e-6 ? '10' + supExp(r) : '';
      }

      const E = unifiedGrid(curves);
      const plotData = [E];
      const colors = [];
      curves.forEach(c => {
        plotData.push(E.map(e => interpLogLog(c.E, c.xs, e)));
        colors.push(REACTION_COLORS[c.reaction] || '#e2e8f0');
      });

      const readoutEl = document.getElementById('readout');
      const defaultReadout = 'Hover chart for \u03c3(E) readout';

      state.plot = new uPlot({
        width: host.clientWidth,
        height: 420,
        legend: { show: false },
        scales: { x: { distr: 3 }, y: { distr: 3 } },
        axes: [
          {
            scale: 'x',
            stroke: '#94a3b8',
            grid: { stroke: 'rgba(255,255,255,0.06)' },
            ticks: { stroke: 'rgba(255,255,255,0.10)' },
            font: '11px system-ui, sans-serif',
            label: 'Neutron energy (eV)',
            labelFont: '12px system-ui, sans-serif',
            labelGap: 4,
            size: 44,
            values: (u, vals) => vals.map(logTickLabel),
          },
          {
            scale: 'y',
            stroke: '#94a3b8',
            grid: { stroke: 'rgba(255,255,255,0.06)' },
            ticks: { stroke: 'rgba(255,255,255,0.10)' },
            font: '11px system-ui, sans-serif',
            label: 'Cross section (barns)',
            labelFont: '12px system-ui, sans-serif',
            labelGap: 4,
            size: 62,
            values: (u, vals) => vals.map(logTickLabel),
          },
        ],
        series: [
          { label: 'E (eV)' },
          ...curves.map((c, i) => ({
            label: fmtLabel(c.nuclide) + ' ' + c.reaction,
            stroke: colors[i],
            width: 2,
            points: { show: false },
          })),
        ],
        hooks: {
          setCursor: [(u) => {
            const idx = u.cursor.idx;
            if (idx == null) { readoutEl.textContent = defaultReadout; return; }
            const e = u.data[0][idx];
            if (e == null) { readoutEl.textContent = defaultReadout; return; }
            const parts = [];
            curves.forEach((c, si) => {
              const y = u.data[si + 1][idx];
              if (y == null) return;
              parts.push(fmtLabel(c.nuclide) + ' ' + c.reaction + ': ' + Number(y).toExponential(3) + ' b');
            });
            readoutEl.textContent = 'E = ' + Number(e).toExponential(3) + ' eV'
              + (parts.length ? '    ' + parts.join('    \u00b7    ') : '');
          }],
        },
      }, plotData, host);

      const leg = document.getElementById('legend');
      leg.innerHTML = curves.map((c,i) =>
        '<span><span class="dot" style="background:'+(REACTION_COLORS[c.reaction]||'#e2e8f0')+'"></span>'+
        fmtLabel(c.nuclide)+' '+c.reaction+'</span>'
      ).join('');

      const gaps = (state.index?.gaps || []).filter(g => !g.reaction && state.nuclides.includes(g.nuclide));
      const cov = document.getElementById('coverage');
      if (gaps.length) {
        cov.style.display = 'block';
        cov.textContent = gaps.length + ' selected nuclide(s) missing from ALLEN bundle: ' + gaps.map(g=>g.nuclide).join(', ');
      } else cov.style.display = 'none';
    }

    window.addEventListener('message', e => {
      const msg = e.data;
      if (msg.type === 'index') {
        state.index = msg.index;
        state.allNuclides = msg.nuclides;
        state.reactionsMeta = msg.reactions;
        if (msg.initial) {
          state.nuclides = msg.initial.nuclides || state.nuclides;
          state.reactions = msg.initial.reactions || state.reactions;
          state.temperature = msg.initial.temperature || 294;
        }
        renderPickers();
        requestCurves();
      } else if (msg.type === 'init') {
        if (msg.nuclides) state.nuclides = msg.nuclides;
        if (msg.reactions) state.reactions = msg.reactions;
        if (msg.temperature) state.temperature = msg.temperature;
        renderPickers();
        requestCurves();
      } else if (msg.type === 'curves') {
        buildPlot(msg.curves);
      }
    });

    document.getElementById('reloadBtn').onclick = () => {
      state.temperature = parseInt(document.getElementById('tempSelect').value, 10);
      requestCurves();
    };
    document.getElementById('tempSelect').onchange = () => {
      state.temperature = parseInt(document.getElementById('tempSelect').value, 10);
    };

    window.addEventListener('resize', () => {
      if (state.plot) state.plot.setSize({ width: document.getElementById('chart').clientWidth, height: 420 });
    });

    vscode.postMessage({ command: 'ready' });
  </script>
</body>
</html>`;
    }
}

export async function openAllenCrossSections(extensionUri: vscode.Uri): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    let initial: { nuclides: string[]; reactions: string[]; temperature: number } | undefined;

    if (editor) {
        const nuclides = detectNuclides(editor.document.getText(), editor.document.languageId);
        if (nuclides.length > 0) {
            initial = {
                nuclides: nuclides.slice(0, 4),
                reactions: ['fission', 'capture', 'elastic'].filter((r) =>
                    nuclides.some((n) => r === 'fission' ? n.startsWith('U') || n.startsWith('Pu') : true),
                ).slice(0, 3),
                temperature: 294,
            };
            if (initial.reactions.length === 0) {
                initial.reactions = ['total', 'elastic'];
            }
        }
    }

    await AllenPanel.createOrShow(extensionUri, initial);
}
