/**
 * "OWEN: Render with OpenMC (authoritative)" — shells out to the user's real
 * OpenMC installation and displays its native slice plots in a webview.
 *
 * Unlike the built-in 3D Geometry Preview (OWEN's own approximate engine),
 * every image here comes straight from OpenMC's geometry kernel, so it is
 * the ground truth for verifying OWEN's render or debugging geometry.
 * Each control change is a full round-trip through OpenMC (not real-time);
 * the webview shows a spinner while a render is in flight.
 */
import * as vscode from 'vscode';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectMonteCarloLanguage } from '../../util/detectLanguage';
import {
    buildHelperScript,
    buildRenderRequest,
    parseRenderResult,
    PlotSpec,
    RenderResult,
    SliceBasis,
} from './core';
import { resolveOpenmcInterpreter, ResolvedInterpreter, translatePathForCandidate } from './detect';

const RENDER_TIMEOUT_MS = 180000;

let channel: vscode.OutputChannel | undefined;
function log(line: string): void {
    if (!channel) channel = vscode.window.createOutputChannel('OWEN: OpenMC Render');
    channel.appendLine(line);
}

interface RenderView {
    basis: SliceBasis;
    origin: [number, number, number] | null;
    width: [number, number] | null;
    pixels: [number, number];
    colorBy: 'material' | 'cell';
    rayTrace: boolean;
}

const DEFAULT_VIEW: RenderView = {
    basis: 'xy',
    origin: null,
    width: null,
    pixels: [800, 800],
    colorBy: 'material',
    rayTrace: false,
};

class OpenmcRenderPanel {
    static current: OpenmcRenderPanel | undefined;

    private readonly panel: vscode.WebviewPanel;
    private readonly sessionDir: string;
    private readonly deckPath: string;
    private readonly interpreter: ResolvedInterpreter;
    private renderSeq = 0;
    private rendering = false;
    private pendingView: RenderView | null = null;
    private disposables: vscode.Disposable[] = [];

    static async createOrShow(deckPath: string, interpreter: ResolvedInterpreter): Promise<void> {
        if (OpenmcRenderPanel.current) {
            OpenmcRenderPanel.current.dispose();
        }
        const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'owen-openmc-'));
        const panel = vscode.window.createWebviewPanel(
            'owenOpenmcRender',
            'OWEN: OpenMC Render (authoritative)',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.file(sessionDir)],
            },
        );
        OpenmcRenderPanel.current = new OpenmcRenderPanel(panel, sessionDir, deckPath, interpreter);
        await OpenmcRenderPanel.current.render(DEFAULT_VIEW);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        sessionDir: string,
        deckPath: string,
        interpreter: ResolvedInterpreter,
    ) {
        this.panel = panel;
        this.sessionDir = sessionDir;
        this.deckPath = deckPath;
        this.interpreter = interpreter;
        this.panel.webview.html = buildHtml(this.panel.webview, {
            deckName: path.basename(deckPath),
            version: interpreter.openmcVersion,
            interpreterLabel: interpreter.candidate.label,
        });
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage(
            (msg) => {
                if (msg?.type === 'render') {
                    const view = sanitizeView(msg.view);
                    void this.render(view);
                }
            },
            null,
            this.disposables,
        );
    }

    dispose(): void {
        if (OpenmcRenderPanel.current === this) OpenmcRenderPanel.current = undefined;
        for (const d of this.disposables) d.dispose();
        this.disposables = [];
        try {
            fs.rmSync(this.sessionDir, { recursive: true, force: true });
        } catch {
            // temp dir cleanup is best-effort
        }
        try {
            this.panel.dispose();
        } catch {
            // already disposed
        }
    }

    private async render(view: RenderView): Promise<void> {
        if (this.rendering) {
            // A render is in flight; remember the newest request and run it after.
            this.pendingView = view;
            return;
        }
        this.rendering = true;
        this.panel.webview.postMessage({ type: 'busy' });
        const seq = ++this.renderSeq;
        const outDir = path.join(this.sessionDir, `render_${String(seq).padStart(3, '0')}`);
        fs.mkdirSync(outDir, { recursive: true });
        try {
            const result = await runOpenmcRender(this.interpreter, this.deckPath, outDir, view);
            const images = result.images.map((im) => ({
                ...im,
                src: this.panel.webview.asWebviewUri(vscode.Uri.file(path.join(outDir, im.file))).toString(),
            }));
            this.panel.webview.postMessage({
                type: 'result',
                ok: result.ok,
                images,
                warnings: result.warnings,
                error: result.error,
                rayTraceAvailable: !!result.capabilities.rayTrace,
                modelSource: result.modelSource,
                version: result.version ?? this.interpreter.openmcVersion,
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log(`Render failed: ${message}`);
            this.panel.webview.postMessage({ type: 'result', ok: false, images: [], warnings: [], error: message });
        } finally {
            this.rendering = false;
            if (this.pendingView) {
                const next = this.pendingView;
                this.pendingView = null;
                void this.render(next);
            }
        }
    }
}

function sanitizeView(raw: unknown): RenderView {
    const v = (raw ?? {}) as Partial<RenderView> & { origin?: unknown; width?: unknown };
    const basis: SliceBasis = v.basis === 'xz' || v.basis === 'yz' ? v.basis : 'xy';
    const num = (x: unknown): number | null => {
        const n = typeof x === 'string' ? parseFloat(x) : typeof x === 'number' ? x : NaN;
        return Number.isFinite(n) ? n : null;
    };
    let origin: [number, number, number] | null = null;
    if (Array.isArray(v.origin) && v.origin.length === 3) {
        const parts = v.origin.map(num);
        if (parts.every((p): p is number => p !== null)) origin = [parts[0]!, parts[1]!, parts[2]!];
    }
    let width: [number, number] | null = null;
    if (Array.isArray(v.width) && v.width.length === 2) {
        const parts = v.width.map(num);
        if (parts.every((p): p is number => p !== null && p > 0)) width = [parts[0]!, parts[1]!];
    }
    let pixels: [number, number] = [800, 800];
    if (Array.isArray(v.pixels) && v.pixels.length === 2) {
        const px = v.pixels.map(num);
        if (px.every((p): p is number => p !== null && p >= 50 && p <= 4000)) {
            pixels = [Math.round(px[0]!), Math.round(px[1]!)];
        }
    }
    return {
        basis,
        origin,
        width,
        pixels,
        colorBy: v.colorBy === 'cell' ? 'cell' : 'material',
        rayTrace: !!v.rayTrace,
    };
}

async function runOpenmcRender(
    interpreter: ResolvedInterpreter,
    deckPath: string,
    outDir: string,
    view: RenderView,
): Promise<RenderResult> {
    const candidate = interpreter.candidate;
    const scriptPath = path.join(outDir, 'owen_openmc_render.py');
    fs.writeFileSync(scriptPath, buildHelperScript(), 'utf8');

    const plots: PlotSpec[] = [
        {
            id: 'main',
            kind: view.rayTrace ? 'raytrace' : 'slice',
            basis: view.basis,
            origin: view.origin,
            width: view.width,
            pixels: view.pixels,
            colorBy: view.colorBy,
        },
    ];
    const request = buildRenderRequest(
        await translatePathForCandidate(candidate, deckPath),
        await translatePathForCandidate(candidate, outDir),
        plots,
    );
    const requestPath = path.join(outDir, 'owen_request.json');
    fs.writeFileSync(requestPath, JSON.stringify(request, null, 1), 'utf8');

    const args = [
        ...candidate.argsPrefix,
        await translatePathForCandidate(candidate, scriptPath),
        await translatePathForCandidate(candidate, requestPath),
    ];
    log(`Running: ${candidate.command} ${args.join(' ')}`);
    await new Promise<void>((resolve, reject) => {
        execFile(
            candidate.command,
            args,
            { timeout: RENDER_TIMEOUT_MS, windowsHide: true, maxBuffer: 32 * 1024 * 1024, cwd: path.dirname(deckPath) },
            (err, stdout, stderr) => {
                if (stdout) log(String(stdout));
                if (stderr) log(String(stderr));
                // The helper exits non-zero when it produced no images but
                // still writes owen_result.json with the real error — prefer
                // that over a generic exec failure.
                if (err && !fs.existsSync(path.join(outDir, 'owen_result.json'))) {
                    reject(new Error(`OpenMC render process failed: ${err.message}`));
                } else {
                    resolve();
                }
            },
        );
    });

    const resultPath = path.join(outDir, 'owen_result.json');
    if (!fs.existsSync(resultPath)) {
        throw new Error('OpenMC render produced no result file (see "OWEN: OpenMC Render" output).');
    }
    return parseRenderResult(fs.readFileSync(resultPath, 'utf8'));
}

export function registerOpenmcNativeRender(_context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand('owen.renderWithOpenmc', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('OWEN: open an OpenMC Python model first.');
            return;
        }
        const language = detectMonteCarloLanguage(editor.document);
        if (language !== 'openmc') {
            vscode.window.showWarningMessage(
                'OWEN: "Render with OpenMC" works on OpenMC Python models (a .py file importing openmc). '
                + 'For other codes use the built-in 3D Geometry Preview.',
            );
            return;
        }
        if (editor.document.isDirty) {
            await editor.document.save();
        }
        const deckPath = editor.document.uri.fsPath;

        const interpreter = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'OWEN: locating an OpenMC-capable Python…',
            },
            () => resolveOpenmcInterpreter(editor.document.uri, log),
        );

        if (!interpreter) {
            vscode.window.showInformationMessage(
                "OWEN: OpenMC not detected in the active environment — showing OWEN's render instead. "
                + '(Set owen.openmc.pythonExecutable to a Python with OpenMC installed to enable native renders.)',
            );
            await vscode.commands.executeCommand('owen.openGeometryPreview');
            return;
        }

        log(`Using ${interpreter.candidate.label} (OpenMC ${interpreter.openmcVersion})`);
        await OpenmcRenderPanel.createOrShow(deckPath, interpreter);
    });
}

function buildHtml(
    webview: vscode.Webview,
    info: { deckName: string; version: string; interpreterLabel: string },
): string {
    const cspSource = webview.cspSource;
    const nonce = makeNonce();
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource}; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>OWEN: OpenMC Render</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #0b1018; color: #cdd6f4; font-family: -apple-system, "Segoe UI", sans-serif; }
  #wrap { display: flex; flex-direction: column; height: 100vh; }
  #bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; padding: 10px 12px; border-bottom: 1px solid #1f2940; background: rgba(17,24,38,0.92); }
  .ctl { display: flex; flex-direction: column; gap: 3px; font-size: 11px; }
  .ctl label { opacity: 0.65; text-transform: uppercase; letter-spacing: 0.5px; font-size: 10px; }
  .ctl input, .ctl select { background: #16203a; color: #cdd6f4; border: 1px solid #2b3a5c; border-radius: 4px; padding: 3px 6px; font-size: 12px; width: 72px; }
  .ctl select { width: auto; }
  .grp { display: flex; gap: 4px; }
  button { background: #1c2740; color: #cdd6f4; border: 1px solid #2b3a5c; border-radius: 5px; padding: 5px 12px; font-size: 12px; cursor: pointer; }
  button:hover { background: #24345a; }
  button.primary { background: #89b4fa; color: #0b1018; border-color: #89b4fa; font-weight: 600; }
  button.basis.active { background: #89b4fa; color: #0b1018; border-color: #89b4fa; font-weight: 600; }
  #stage { flex: 1; overflow: auto; display: flex; align-items: center; justify-content: center; position: relative; }
  #stage img { max-width: 96%; max-height: 96%; image-rendering: pixelated; border: 1px solid #1f2940; background: #fff; }
  #spinner { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; flex-direction: column; gap: 12px; background: rgba(11,16,24,0.78); z-index: 10; }
  #spinner.on { display: flex; }
  .ring { width: 34px; height: 34px; border: 3px solid #2b3a5c; border-top-color: #89b4fa; border-radius: 50%; animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  #spinner .msg { font-size: 12px; opacity: 0.8; }
  #msgs { padding: 6px 12px; font-size: 11px; max-height: 130px; overflow-y: auto; }
  .warn { color: #f9e2af; margin: 2px 0; }
  .err { color: #f38ba8; white-space: pre-wrap; margin: 2px 0; font-family: monospace; font-size: 10.5px; }
  #meta { font-size: 11px; opacity: 0.6; margin-left: auto; align-self: center; text-align: right; }
  #foot { padding: 6px 12px; border-top: 1px solid #1f2940; font-size: 10.5px; opacity: 0.65; }
  .rt { display: none; align-items: center; gap: 5px; font-size: 11px; align-self: center; }
  .rt.avail { display: flex; }
</style>
</head>
<body>
<div id="wrap">
  <div id="bar">
    <div class="ctl"><label>Basis</label>
      <div class="grp">
        <button class="basis active" data-basis="xy">xy</button>
        <button class="basis" data-basis="xz">xz</button>
        <button class="basis" data-basis="yz">yz</button>
      </div>
    </div>
    <div class="ctl"><label>Origin x / y / z (cm — blank = auto)</label>
      <div class="grp">
        <input id="ox" placeholder="auto" /><input id="oy" placeholder="auto" /><input id="oz" placeholder="auto" />
      </div>
    </div>
    <div class="ctl"><label>Width w1 / w2 (cm — blank = auto)</label>
      <div class="grp"><input id="w1" placeholder="auto" /><input id="w2" placeholder="auto" /></div>
    </div>
    <div class="ctl"><label>Color by</label>
      <select id="colorBy"><option value="material">material</option><option value="cell">cell</option></select>
    </div>
    <label class="rt" id="rtRow"><input type="checkbox" id="rayTrace" /> 3D ray trace</label>
    <button class="primary" id="renderBtn">Render</button>
    <div id="meta">${esc(info.deckName)} • OpenMC ${esc(info.version)}<br/>${esc(info.interpreterLabel)}</div>
  </div>
  <div id="stage">
    <img id="plot" style="display:none" />
    <div id="spinner" class="on"><div class="ring"></div><div class="msg">Rendering with OpenMC — each change is a full OpenMC run, not real-time…</div></div>
  </div>
  <div id="msgs"></div>
  <div id="foot">Native authoritative render produced by <b>OpenMC</b> (geometry kernel of the installed OpenMC, MIT License — © OpenMC contributors, openmc.org). OWEN's 3D Geometry Preview remains the default interactive view.</div>
</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  let basis = 'xy';
  let lastAuto = null;   // origin/width OpenMC actually used (for placeholders)

  function currentView() {
    const val = (id) => document.getElementById(id).value.trim();
    const o = [val('ox'), val('oy'), val('oz')];
    const w = [val('w1'), val('w2')];
    return {
      basis,
      origin: o.every((s) => s !== '') ? o : null,
      width: w.every((s) => s !== '') ? w : null,
      pixels: [800, 800],
      colorBy: document.getElementById('colorBy').value,
      rayTrace: document.getElementById('rayTrace').checked,
    };
  }
  function requestRender() {
    document.getElementById('spinner').classList.add('on');
    vscode.postMessage({ type: 'render', view: currentView() });
  }
  document.getElementById('renderBtn').addEventListener('click', requestRender);
  document.querySelectorAll('button.basis').forEach((b) => b.addEventListener('click', () => {
    basis = b.getAttribute('data-basis');
    document.querySelectorAll('button.basis').forEach((x) => x.classList.toggle('active', x === b));
    requestRender();
  }));
  document.getElementById('colorBy').addEventListener('change', requestRender);
  document.getElementById('rayTrace').addEventListener('change', requestRender);
  for (const id of ['ox', 'oy', 'oz', 'w1', 'w2']) {
    document.getElementById(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') requestRender(); });
  }

  window.addEventListener('message', (event) => {
    const m = event.data;
    if (!m) return;
    if (m.type === 'busy') { document.getElementById('spinner').classList.add('on'); return; }
    if (m.type !== 'result') return;
    document.getElementById('spinner').classList.remove('on');
    const msgs = document.getElementById('msgs');
    msgs.innerHTML = '';
    for (const w of (m.warnings || [])) {
      const d = document.createElement('div'); d.className = 'warn'; d.textContent = '⚠ ' + w; msgs.appendChild(d);
    }
    if (m.error) {
      const d = document.createElement('div'); d.className = 'err'; d.textContent = m.error; msgs.appendChild(d);
    }
    if (m.rayTraceAvailable) document.getElementById('rtRow').classList.add('avail');
    const img = document.getElementById('plot');
    if (m.images && m.images.length) {
      const im = m.images[0];
      img.src = im.src; img.style.display = 'block';
      lastAuto = im;
      const ph = (id, v) => { const el = document.getElementById(id); if (el.value.trim() === '') el.placeholder = Number(v).toPrecision(5); };
      if (im.origin) { ph('ox', im.origin[0]); ph('oy', im.origin[1]); ph('oz', im.origin[2]); }
      if (im.width) { ph('w1', im.width[0]); ph('w2', im.width[1]); }
    } else {
      img.style.display = 'none';
    }
  });
</script>
</body>
</html>`;
}

function makeNonce(): string {
    let out = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}
