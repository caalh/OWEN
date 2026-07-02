// Sweep results dashboard (owen.viewSweepResults).
//
// Reads a sweep output directory (the one containing sweep-manifest.json),
// re-parses every run's outputs through src/results/ parsers, aggregates via
// sweepDashboardCore, and renders a uPlot webview: k-eff vs the swept
// parameter with error bars, per-run convergence small-multiples, and a runs
// table. Styling mirrors results/panel.ts.

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { SweepManifest } from './sweepCore';
import type { RunResults } from '../results/types';
import { detectOutputsInDir, pickPrimaryOutput } from '../results/detectOutputs';
import { parseOutput } from '../results';
import { buildDashboard, SweepDashboardData } from './sweepDashboardCore';

export async function collectSweepDashboard(sweepDir: string): Promise<SweepDashboardData> {
    const manifestPath = path.join(sweepDir, 'sweep-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as SweepManifest;

    const perRun = new Map<number, RunResults | null>();
    for (const run of manifest.runs) {
        let results: RunResults | null = null;
        try {
            const outputs = detectOutputsInDir(run.outputDir);
            const primary = pickPrimaryOutput(outputs);
            if (primary) results = await parseOutput(primary);
        } catch {
            results = null;
        }
        perRun.set(run.index, results);
    }
    return buildDashboard(manifest, perRun);
}

export class SweepDashboardPanel {
    public static currentPanel: SweepDashboardPanel | undefined;
    private static readonly viewType = 'owen.sweepDashboard';

    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    public static async createOrShow(sweepDir: string) {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Beside;

        let data: SweepDashboardData;
        try {
            data = await collectSweepDashboard(sweepDir);
        } catch (err) {
            vscode.window.showErrorMessage(
                `OWEN: cannot load sweep results from ${sweepDir}: ${(err as Error).message}`,
            );
            return;
        }

        if (SweepDashboardPanel.currentPanel) {
            SweepDashboardPanel.currentPanel._panel.reveal(column);
            SweepDashboardPanel.currentPanel._post(data, sweepDir);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            SweepDashboardPanel.viewType,
            'OWEN: Sweep Dashboard',
            column,
            { enableScripts: true, retainContextWhenHidden: true },
        );
        SweepDashboardPanel.currentPanel = new SweepDashboardPanel(panel, data, sweepDir);
    }

    private constructor(panel: vscode.WebviewPanel, data: SweepDashboardData, sweepDir: string) {
        this._panel = panel;
        this._panel.webview.html = this._getHtml();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            async (msg) => {
                if (msg?.command === 'openRunDir' && typeof msg.dir === 'string') {
                    await vscode.env.openExternal(vscode.Uri.file(msg.dir));
                }
            },
            null,
            this._disposables,
        );
        // Webview scripts may not have run yet; small delay keeps first paint reliable.
        setTimeout(() => this._post(data, sweepDir), 150);
    }

    private _post(data: SweepDashboardData, sweepDir: string) {
        this._panel.webview.postMessage({ type: 'dashboard', data, sweepDir });
    }

    public dispose() {
        SweepDashboardPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            this._disposables.pop()?.dispose();
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
    main { padding: 16px; }
    .chart { width: 100%; height: 300px; background: var(--card); border-radius: 8px; border: 1px solid var(--border); margin-bottom: 16px; }
    h2 { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; margin: 16px 0 8px; }
    .smallmultiples { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; margin-bottom: 16px; }
    .sm { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 6px; }
    .sm .title { font-size: 11px; color: var(--muted); padding: 2px 4px 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 6px 8px; border-bottom: 1px solid var(--border); text-align: left; }
    th { color: var(--muted); font-weight: 600; }
    .meta { font-size: 11px; color: var(--muted); margin-bottom: 12px; }
    .empty { color: var(--muted); padding: 24px; text-align: center; }
    .fail { color: #f87171; }
    .link { color: var(--accent); cursor: pointer; text-decoration: underline; }
  </style>
</head>
<body>
  <header>
    <span class="badge">SWEEP</span>
    <h1>Parameter Sweep Dashboard</h1>
  </header>
  <main>
    <div id="meta" class="meta">Loading sweep manifest…</div>
    <h2 id="mainTitle">k-eff vs parameter</h2>
    <div id="mainChart" class="chart"></div>
    <h2>Per-run convergence</h2>
    <div id="smGrid" class="smallmultiples"></div>
    <h2>Runs</h2>
    <table>
      <thead><tr id="runHead"></tr></thead>
      <tbody id="runBody"></tbody>
    </table>
  </main>
  <script src="https://unpkg.com/uplot@1.6.30/dist/uPlot.iife.min.js"></script>
  <script>
    const vscode = acquireVsCodeApi();
    let mainPlot = null;
    let smPlots = [];

    function errorBarsPlugin(getStd) {
      return {
        hooks: {
          draw: u => {
            const ctx = u.ctx;
            const std = getStd();
            ctx.save();
            ctx.strokeStyle = 'rgba(56,189,248,0.8)';
            ctx.lineWidth = 1;
            const xs = u.data[0], ys = u.data[1];
            for (let i = 0; i < xs.length; i++) {
              if (ys[i] == null || std[i] == null) continue;
              const x = u.valToPos(xs[i], 'x', true);
              const yTop = u.valToPos(ys[i] + std[i], 'y', true);
              const yBot = u.valToPos(ys[i] - std[i], 'y', true);
              ctx.beginPath();
              ctx.moveTo(x, yTop); ctx.lineTo(x, yBot);
              ctx.moveTo(x - 4, yTop); ctx.lineTo(x + 4, yTop);
              ctx.moveTo(x - 4, yBot); ctx.lineTo(x + 4, yBot);
              ctx.stroke();
            }
            ctx.restore();
          }
        }
      };
    }

    function buildMain(data) {
      const host = document.getElementById('mainChart');
      if (mainPlot) { mainPlot.destroy(); mainPlot = null; }
      const pts = data.x.map((x, i) => [x, data.keff[i], data.keffStd[i]]).filter(p => p[1] != null);
      if (!data.paramName || pts.length === 0) {
        host.innerHTML = '<div class="empty">No plottable k-eff points (missing or non-numeric parameter/k-eff values).</div>';
        return;
      }
      host.innerHTML = '';
      document.getElementById('mainTitle').textContent = 'k-eff vs ' + data.paramName;
      const xs = pts.map(p => p[0]);
      const ys = pts.map(p => p[1]);
      const stds = pts.map(p => p[2] == null ? 0 : p[2]);
      mainPlot = new uPlot({
        width: host.clientWidth, height: 280,
        scales: { x: { time: false }, y: { auto: true } },
        axes: [
          { label: data.paramName, stroke: '#94a3b8', grid: { stroke: 'rgba(255,255,255,0.06)' } },
          { label: 'k-eff', stroke: '#94a3b8', grid: { stroke: 'rgba(255,255,255,0.06)' } },
        ],
        series: [{}, { label: 'k-eff', stroke: '#38bdf8', width: 2, points: { show: true, size: 6 } }],
        plugins: [errorBarsPlugin(() => stds)],
      }, [xs, ys], host);
    }

    function buildSmallMultiples(data) {
      const grid = document.getElementById('smGrid');
      smPlots.forEach(p => p.destroy());
      smPlots = [];
      grid.innerHTML = '';
      const withConv = data.runs.filter(r => r.convergence);
      if (withConv.length === 0) {
        grid.innerHTML = '<div class="empty">No per-run convergence histories (outputs had only final k-eff).</div>';
        return;
      }
      for (const run of withConv) {
        const card = document.createElement('div');
        card.className = 'sm';
        const title = document.createElement('div');
        title.className = 'title';
        title.textContent = 'run_' + String(run.index).padStart(3, '0') + ' — ' +
          Object.entries(run.parameters).map(([k,v]) => k + '=' + v).join(', ');
        card.appendChild(title);
        const host = document.createElement('div');
        card.appendChild(host);
        grid.appendChild(card);
        smPlots.push(new uPlot({
          width: 210, height: 110,
          scales: { x: { time: false }, y: { auto: true } },
          axes: [
            { show: false }, { show: false },
          ],
          legend: { show: false },
          cursor: { show: false },
          series: [{}, { stroke: '#f97316', width: 1.5, points: { show: false } }],
        }, [run.convergence.cycles, run.convergence.mean], host));
      }
    }

    function buildTable(data) {
      const head = document.getElementById('runHead');
      const body = document.getElementById('runBody');
      const paramNames = data.runs.length
        ? Object.keys(data.runs[0].parameters)
        : (data.paramName ? [data.paramName] : []);
      head.innerHTML = ['run', ...paramNames, 'exit', 'k-eff', '± σ', 'output']
        .map(h => '<th>' + h + '</th>').join('');
      body.innerHTML = data.runs.map(r => {
        const cells = [
          'run_' + String(r.index).padStart(3, '0'),
          ...paramNames.map(p => r.parameters[p] ?? ''),
          r.exitCode == null ? 'n/a' : (r.exitCode === 0 ? '0' : '<span class="fail">' + r.exitCode + '</span>'),
          r.keff == null ? 'n/a' : r.keff.toFixed(5),
          r.keffStd == null ? '—' : r.keffStd.toFixed(5),
          '<span class="link" data-dir="' + r.outputDir.replace(/"/g, '&quot;') + '">open</span>',
        ];
        return '<tr>' + cells.map(c => '<td>' + c + '</td>').join('') + '</tr>';
      }).join('');
      body.querySelectorAll('.link').forEach(el => {
        el.onclick = () => vscode.postMessage({ command: 'openRunDir', dir: el.dataset.dir });
      });
    }

    window.addEventListener('message', e => {
      if (e.data.type !== 'dashboard') return;
      const { data, sweepDir } = e.data;
      document.getElementById('meta').textContent =
        sweepDir + ' · ' + data.runs.length + ' runs' +
        (data.otherParams.length ? ' · other params: ' + data.otherParams.join(', ') : '');
      buildMain(data);
      buildSmallMultiples(data);
      buildTable(data);
    });

    window.addEventListener('resize', () => {
      if (mainPlot) mainPlot.setSize({ width: document.getElementById('mainChart').clientWidth, height: 280 });
    });
  </script>
</body>
</html>`;
    }
}

export function registerViewSweepResults(_context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand('owen.viewSweepResults', async () => {
        const editor = vscode.window.activeTextEditor;
        const defaultUri = editor && editor.document.uri.scheme === 'file'
            ? vscode.Uri.file(path.dirname(editor.document.uri.fsPath))
            : undefined;
        const picks = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select sweep output folder (contains sweep-manifest.json)',
            defaultUri,
        });
        if (!picks || picks.length === 0) return;
        const dir = picks[0].fsPath;
        if (!fs.existsSync(path.join(dir, 'sweep-manifest.json'))) {
            vscode.window.showWarningMessage(
                'OWEN: selected folder has no sweep-manifest.json (pick the sweep output root).',
            );
            return;
        }
        await SweepDashboardPanel.createOrShow(dir);
    });
}
