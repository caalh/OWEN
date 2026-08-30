import * as vscode from 'vscode';
import { detectMonteCarloLanguage } from '../util/detectLanguage';
import { buildScene, CylinderSpec } from './extractor';
import { GeometryScene, FidelityOptions } from './types';
import { distance3, deltas, angleDeg, diameter, fmtLen } from './measure';
import { McnpGeometryModel } from './mcnpGeometry';
import { parseDeckToModel, sliceSupportNote } from './engineDispatch';
import { worldBounds } from './mcnpEvaluate';
import { looksLikeOpenmcXml, openmcMaterialLookup, parseOpenmcGeometryXml } from './openmcGeometry';
import { isCaptureNoise } from './openmcNative/captureNoise';
import { exportOpenmcGeometryXml } from './openmcNative/exportGeometry';
import {
    axisPlane, beginSlice, defaultWindow, hexToRgb, identifyAt, sliceRowsToRgba,
    SliceAxis, SliceJob, SliceRequest,
} from './slice';
import { mcnpMaterialLookup } from './codes/mcnp';
import { componentColor, materialColor } from './palette';

/**
 * Measurement math (`measure.ts`) is pure + unit-tested. We inject its source
 * straight into the webview module via `toString()` so the live preview runs
 * the EXACT functions the tests assert against — no duplicated math. Each
 * function is self-contained (only args + JS built-ins), so the injected copy
 * survives esbuild's production minification (same pattern as the lattice
 * codegen in `panels/latticeBuilder.ts`).
 */
function injectMeasure(): string {
    return [
        'const distance3 = ' + distance3.toString() + ';',
        'const deltas = ' + deltas.toString() + ';',
        'const angleDeg = ' + angleDeg.toString() + ';',
        'const diameter = ' + diameter.toString() + ';',
        'const fmtLen = ' + fmtLen.toString() + ';',
    ].join('\n');
}

let currentPanel: vscode.WebviewPanel | undefined;
let webviewReady = false;
let lastScene: GeometryScene | undefined;
let lastText = '';
let lastLanguage = 'mcnp';
let lastDeckPath = '';
let fidelity: FidelityOptions = { detail: 'auto', axial: false };

// Exact-engine model cache for the 2D slice view (plan Stage 3). Parsing a
// full-core deck costs real time, so one model is kept per deck text.
let sliceCache: { text: string; language: string; model: McnpGeometryModel | null } | null = null;
/** Live OpenMC Geometry captured by running the Python deck (or XML on disk). */
let lastOpenmcModel: McnpGeometryModel | null = null;
let lastOpenmcXml = '';
let openmcExportGen = 0;

function sliceModelFor(text: string, language: string): McnpGeometryModel | null {
    if (language === 'openmc' && lastOpenmcModel && text === lastText) {
        return lastOpenmcModel;
    }
    if (sliceCache && sliceCache.text === text && sliceCache.language === language) {
        return sliceCache.model;
    }
    let model: McnpGeometryModel | null = null;
    try {
        model = parseDeckToModel(text, language);
    } catch {
        model = null;
    }
    if (language === 'openmc' && lastOpenmcModel && text === lastText) {
        model = lastOpenmcModel;
    }
    // A render still streaming rows belongs to the previous model.
    cancelSliceJob();
    sliceCache = { text, language, model };
    return model;
}

/** View state the webview owns: which plane, how far in, and how it is sampled. */
interface SliceViewMsg {
    axis: SliceAxis;
    offset: number;
    res: number;
    colorBy: 'cell' | 'material';
    /** Scale relative to the fitted window (1 = fit, 0.1 = 10× in, 2 = 2× out). */
    zoom?: number;
    /** Window center in plane coordinates (cm). */
    centerU?: number;
    centerV?: number;
    samples?: number;
    edges?: boolean;
}

const SLICE_MIN_RES = 64;
const SLICE_MAX_RES = 1536;
/**
 * Ceiling on total point-membership evaluations for one slice. Supersampling
 * multiplies res² by samples², so 1536² at 3× would be 21 M findCell calls on
 * the extension host; the factor is reduced instead of freezing the editor.
 */
const SLICE_MAX_SAMPLES_TOTAL = 4_500_000;

function clampRes(res: number): number {
    return Math.max(SLICE_MIN_RES, Math.min(SLICE_MAX_RES, Math.floor(res) || 384));
}

/** Highest supersample factor that keeps the render inside the sample budget. */
function budgetedSamples(res: number, requested: number): number {
    let s = Math.max(1, Math.min(3, Math.floor(requested) || 1));
    while (s > 1 && res * res * s * s > SLICE_MAX_SAMPLES_TOTAL) s--;
    return s;
}

/** Material names/colors for the legend; empty for languages without a lookup. */
function sliceMaterialNames(): Map<number, { name: string; component: string }> {
    if (lastLanguage === 'openmc' && lastOpenmcXml) {
        try {
            const out = new Map<number, { name: string; component: string }>();
            for (const [id, info] of openmcMaterialLookup(lastOpenmcXml)) {
                out.set(id, { name: info.name, component: info.component });
            }
            return out;
        } catch {
            return new Map();
        }
    }
    if (lastLanguage !== 'mcnp') return new Map();
    try {
        return mcnpMaterialLookup(lastText);
    } catch {
        return new Map();
    }
}

function sliceRequestFor(model: McnpGeometryModel, msg: SliceViewMsg): SliceRequest {
    const plane = axisPlane(msg.axis, msg.offset);
    const fit = defaultWindow(model, plane);
    const zoom = Math.max(0.002, Math.min(8, msg.zoom ?? 1));
    const res = clampRes(msg.res);
    const mats = msg.colorBy === 'material' ? sliceMaterialNames() : null;
    return {
        plane,
        halfU: fit.halfU * zoom,
        halfV: fit.halfV * zoom,
        centerU: Number.isFinite(msg.centerU as number) ? (msg.centerU as number) : fit.centerU,
        centerV: Number.isFinite(msg.centerV as number) ? (msg.centerV as number) : fit.centerV,
        width: res,
        height: res,
        colorBy: msg.colorBy,
        samples: budgetedSamples(res, msg.samples ?? 1),
        labelFor: (key) => {
            if (msg.colorBy === 'cell') return `cell ${key}`;
            if (key === 0) return 'void';
            return mats?.get(key)?.name ?? `m${key}`;
        },
    };
}

/**
 * The slice render currently in flight. Classification of a full core is
 * seconds of arithmetic and the extension host is single-threaded, so a job is
 * advanced in short bands between macrotasks: the editor stays responsive, the
 * image fills in progressively, and a newer request cancels the old one
 * instead of queueing behind it.
 */
let sliceJob: { id: number; job: SliceJob; cancelled: boolean } | null = null;
let sliceJobSeq = 0;

/**
 * Milliseconds of classification per band. The check happens between steps, so
 * a band overruns by at most one step's cost — hence the small step size
 * below: on a full core a single row can cost several milliseconds.
 */
const SLICE_BAND_BUDGET_MS = 30;
const SLICE_ROWS_PER_STEP = 2;

function cancelSliceJob(): void {
    if (sliceJob) sliceJob.cancelled = true;
    sliceJob = null;
}

/** Classify one slice on the host and stream the colored image to the webview. */
function handleSliceRequest(msg: SliceViewMsg): void {
    if (!currentPanel) return;
    const model = sliceModelFor(lastText, lastLanguage);
    if (!model || model.cells.size === 0) {
        currentPanel.webview.postMessage({
            type: 'sliceUnavailable',
            reason: sliceSupportNote(lastLanguage),
        });
        return;
    }
    cancelSliceJob();

    const req = sliceRequestFor(model, msg);
    const job = beginSlice(model, req);
    const id = ++sliceJobSeq;
    const entry = { id, job, cancelled: false };
    sliceJob = entry;

    const b = worldBounds(model);
    const perp = msg.axis === 'xy' ? 2 : msg.axis === 'xz' ? 1 : 0;
    const fit = defaultWindow(model, axisPlane(msg.axis, msg.offset));
    // Color by the same palette the 3D view uses, so a fuel pin is gold in
    // both places; unknown materials keep the hash palette.
    const mats = msg.colorBy === 'material' ? sliceMaterialNames() : null;
    const colorFor = (key: number): [number, number, number] | undefined => {
        const info = mats?.get(key);
        if (!info) return undefined;
        return hexToRgb(materialColor(info.name)) ?? hexToRgb(componentColor(info.component)) ?? undefined;
    };

    currentPanel.webview.postMessage({
        type: 'sliceBegin',
        id,
        axis: msg.axis,
        offset: msg.offset,
        width: job.result.width,
        height: job.result.height,
        offsetLo: b.min[perp],
        offsetHi: b.max[perp],
        window: job.result.window,
        samples: job.result.samples,
        cmPerPixel: job.result.cmPerPixel,
        centerU: req.centerU,
        centerV: req.centerV,
        fitHalfU: fit.halfU,
        fitHalfV: fit.halfV,
        fitCenterU: fit.centerU,
        fitCenterV: fit.centerV,
        warnings: model.warnings,
    });

    const pump = (): void => {
        if (entry.cancelled || !currentPanel) return;
        const started = Date.now();
        const y0 = job.rowsDone;
        // Rows cost wildly different amounts (void vs deep in a lattice), so
        // measure instead of assuming a fixed band height.
        do {
            job.step(SLICE_ROWS_PER_STEP);
        } while (!job.done && Date.now() - started < SLICE_BAND_BUDGET_MS);
        const y1 = job.rowsDone;

        if (y1 > y0) {
            const colors = job.result.legend.map((e) => colorFor(e.key));
            const band = sliceRowsToRgba(job.result, y0, y1, {
                colors: colors as [number, number, number][],
                edges: msg.edges !== false,
            });
            currentPanel.webview.postMessage({
                type: 'sliceBand',
                id,
                y0,
                y1,
                rgbaB64: Buffer.from(band.buffer, band.byteOffset, band.byteLength).toString('base64'),
                progress: job.rowsDone / job.result.height,
            });
        }

        if (job.done) {
            const colors = job.result.legend.map((e) => colorFor(e.key));
            currentPanel.webview.postMessage({
                type: 'sliceDone',
                id,
                legend: job.result.legend,
                colors,
                lostCount: job.result.lostCount,
                overlapCount: job.result.overlapCount,
                warnings: model.warnings,
            });
            if (sliceJob === entry) sliceJob = null;
            return;
        }
        setTimeout(pump, 0);
    };
    setTimeout(pump, 0);
}

function handleSliceIdentify(msg: SliceViewMsg & { px: number; py: number }): void {
    if (!currentPanel) return;
    const model = sliceModelFor(lastText, lastLanguage);
    if (!model) return;
    const req = sliceRequestFor(model, msg);
    const who = identifyAt(model, req, msg.px, msg.py);
    const mats = sliceMaterialNames();
    currentPanel.webview.postMessage({
        type: 'sliceIdentifyResult',
        ...who,
        materialName: who.material !== null ? mats.get(who.material)?.name : undefined,
    });
}

async function handleSliceSavePng(msg: { dataUrl: string; axis: string; offset: number }): Promise<void> {
    const m = /^data:image\/png;base64,(.+)$/.exec(msg.dataUrl ?? '');
    if (!m) return;
    const uri = await vscode.window.showSaveDialog({
        filters: { 'PNG image': ['png'] },
        defaultUri: vscode.Uri.file(`slice-${msg.axis}-${Number(msg.offset).toFixed(2)}cm.png`),
    });
    if (!uri) return;
    await vscode.workspace.fs.writeFile(uri, Buffer.from(m[1], 'base64'));
    vscode.window.setStatusBarMessage(`OWEN: slice saved to ${uri.fsPath}`, 5000);
}

function postScene(): void {
    if (currentPanel && webviewReady && lastScene) {
        currentPanel.webview.postMessage({ type: 'scene', scene: lastScene });
    }
}

/** Post mesh-tally heatmap overlay to the live 3D preview (axial slice). */
export function postMeshOverlay(mesh: {
    nx: number;
    ny: number;
    nz: number;
    values: number[];
    label?: string;
}): void {
    if (currentPanel && webviewReady) {
        currentPanel.webview.postMessage({ type: 'meshOverlay', mesh });
        currentPanel.reveal();
    } else {
        vscode.window.showWarningMessage(
            'OWEN: Open the 3D Geometry Preview first, then overlay mesh tallies.',
        );
    }
}

/**
 * Folds the live `owen.preview.maxInstances` setting into the fidelity options
 * so the parsers' auto-LOD budgeting honours the user's configured ceiling.
 */
function withConfig(opts: FidelityOptions): FidelityOptions {
    const max = vscode.workspace.getConfiguration('owen').get<number>('preview.maxInstances');
    return { ...opts, maxInstances: typeof max === 'number' && max > 0 ? max : undefined };
}

/** Re-extracts the current source at the requested fidelity and re-posts it. */
function rebuildScene(): void {
    if (!lastText) return;
    if (lastLanguage === 'openmc' && lastOpenmcXml && !/RectLattice|HexLattice|\.universes\b/.test(lastText)) {
        lastScene = buildScene(lastOpenmcXml, 'openmc', withConfig(fidelity));
        postScene();
        return;
    }
    lastScene = buildScene(lastText, lastLanguage, withConfig(fidelity));
    postScene();
}

/**
 * For OpenMC Python decks, run the same loader as "Render with OpenMC" and
 * replace the guessed 3D scene (and the 2D slice model) with the live
 * geometry. Lattice decks keep the fast-path 3D so a core stays interactive.
 */
async function refreshOpenmcExact(): Promise<void> {
    if (lastLanguage !== 'openmc' || !lastText) return;
    if (looksLikeOpenmcXml(lastText)) {
        lastOpenmcXml = lastText;
        lastOpenmcModel = parseOpenmcGeometryXml(lastText);
        sliceCache = { text: lastText, language: 'openmc', model: lastOpenmcModel };
        return;
    }
    if (!lastDeckPath) return;
    if (!vscode.workspace.isTrusted) {
        if (lastScene) {
            lastScene.notes = [
                'Live OpenMC model needs a trusted workspace (Trust this folder). 3D is the text reconstruction; use Render with OpenMC after trusting.',
                ...lastScene.notes,
            ];
            postScene();
        }
        return;
    }
    const gen = ++openmcExportGen;
    const text = lastText;
    try {
        const exported = await exportOpenmcGeometryXml(lastDeckPath, vscode.Uri.file(lastDeckPath));
        if (gen !== openmcExportGen || lastText !== text) return;
        lastOpenmcXml = `${exported.geometryXml}\n${exported.materialsXml ?? ''}`;
        lastOpenmcModel = parseOpenmcGeometryXml(lastOpenmcXml);
        sliceCache = { text, language: 'openmc', model: lastOpenmcModel };
        const hasLattice = /RectLattice|HexLattice|\.universes\b/.test(text);
        if (!hasLattice) {
            lastScene = buildScene(lastOpenmcXml, 'openmc', withConfig(fidelity));
            lastScene.notes = [
                `Live OpenMC geometry loaded (${exported.source ?? 'captured'}).`,
                ...lastScene.notes,
            ];
            lastScene.warnings = [
                ...exported.warnings.filter((w) => !isCaptureNoise(w)),
                ...lastScene.warnings,
            ];
            postScene();
        } else if (lastScene) {
            lastScene.notes = [
                'Exact 2D slices use the live OpenMC model; 3D keeps the lattice fast path.',
                ...lastScene.notes,
            ];
            postScene();
        }
    } catch (err) {
        if (gen !== openmcExportGen) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (lastScene) {
            lastScene.notes = [
                `Live OpenMC model was not loaded (${msg.split('\n')[0]}). 3D is the text reconstruction; use Render with OpenMC for the native plot.`,
                ...lastScene.notes,
            ];
            postScene();
        }
    }
}

export function registerGeometryPreview(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand('owen.openGeometryPreview', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('OWEN: open an input file before launching the geometry preview.');
            return;
        }
        const language = detectMonteCarloLanguage(editor.document) ?? 'mcnp';
        lastText = editor.document.getText();
        lastLanguage = language;
        lastDeckPath = editor.document.uri.scheme === 'file' ? editor.document.uri.fsPath : '';
        lastOpenmcModel = null;
        lastOpenmcXml = '';
        openmcExportGen++;
        fidelity = { detail: 'auto', axial: false };
        lastScene = buildScene(lastText, language, withConfig(fidelity));

        if (currentPanel) {
            currentPanel.reveal(vscode.ViewColumn.Beside);
        } else {
            webviewReady = false;
            currentPanel = vscode.window.createWebviewPanel(
                'owenGeometryPreview',
                'OWEN: 3D Geometry Preview',
                vscode.ViewColumn.Beside,
                { enableScripts: true, retainContextWhenHidden: true },
            );
            currentPanel.onDidDispose(() => {
                cancelSliceJob();
                currentPanel = undefined;
                webviewReady = false;
            }, null, context.subscriptions);
            currentPanel.webview.onDidReceiveMessage((msg) => {
                if (!msg) return;
                if (msg.type === 'ready') {
                    webviewReady = true;
                    postScene();
                } else if (msg.type === 'setFidelity') {
                    fidelity = {
                        detail: msg.detail === 'disc' || msg.detail === 'layers' ? msg.detail : 'auto',
                        axial: !!msg.axial,
                    };
                    rebuildScene();
                } else if (msg.type === 'sliceRequest') {
                    handleSliceRequest(msg);
                } else if (msg.type === 'sliceIdentify') {
                    handleSliceIdentify(msg);
                } else if (msg.type === 'sliceSavePng') {
                    void handleSliceSavePng(msg);
                }
            }, null, context.subscriptions);
            currentPanel.webview.html = buildHtml(currentPanel.webview);
        }

        // When the panel already exists the webview listener is live, so send now;
        // on first open the 'ready' handshake above delivers the payload instead.
        postScene();

        void refreshOpenmcExact();

        const n = lastScene.primitiveCount;
        if (n === 0) {
            const why = lastScene.warnings[0] ?? `No geometry could be extracted from this ${language} deck.`;
            vscode.window.showWarningMessage(`OWEN: ${why}`);
        } else {
            vscode.window.setStatusBarMessage(
                `OWEN: rendered ${n.toLocaleString()} primitives (${language}). Use the panel to toggle layers.`,
                6000,
            );
        }
    });
}

/** Exported for the test that parses the injected script (see webviewHtml.test.ts). */
export function buildPreviewHtml(webview: vscode.Webview): string {
    return buildHtml(webview);
}

function buildHtml(webview: vscode.Webview): string {
    const cspSource = webview.cspSource;
    const nonce = makeNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' https://unpkg.com; connect-src https://unpkg.com;">
<title>OWEN: 3D Geometry Preview</title>
<style nonce="${nonce}">
  :root { --panel-bg: rgba(17, 24, 38, 0.92); --accent: #89b4fa; }
  html, body { margin: 0; padding: 0; height: 100%; background: #0b1018; color: #cdd6f4; font-family: -apple-system, "Segoe UI", sans-serif; overflow: hidden; }
  #stage { position: absolute; inset: 0; }
  #hud { position: absolute; top: 8px; right: 12px; z-index: 10; font-size: 11px; opacity: 0.6; text-align: right; pointer-events: none; }
  #panel {
    position: absolute; top: 0; left: 0; bottom: 0; width: 270px; z-index: 20;
    background: var(--panel-bg); backdrop-filter: blur(6px); border-right: 1px solid #1f2940;
    display: flex; flex-direction: column; box-shadow: 2px 0 14px rgba(0,0,0,0.4);
    transition: transform 0.18s ease;
  }
  #panel.collapsed { transform: translateX(-260px); }
  #panel header { padding: 10px 12px 6px; border-bottom: 1px solid #1f2940; }
  #panel h1 { font-size: 13px; margin: 0 0 2px; letter-spacing: 0.3px; }
  #panel .sub { font-size: 11px; opacity: 0.6; }
  /* min-height:0 is what actually lets this shrink inside the flex column; without
     it a tall warning block pushes the controls out of reach and nothing scrolls. */
  #scroll { overflow-y: auto; padding: 8px 12px 16px; flex: 1 1 auto; min-height: 0; }
  .section { margin-top: 12px; }
  .section > .title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; opacity: 0.6; margin-bottom: 6px; display: flex; justify-content: space-between; cursor: pointer; }
  .row { display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 12px; cursor: pointer; user-select: none; }
  .row input { accent-color: var(--accent); }
  .swatch { width: 12px; height: 12px; border-radius: 3px; flex: 0 0 auto; border: 1px solid rgba(255,255,255,0.2); }
  .row .name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .count { opacity: 0.5; font-variant-numeric: tabular-nums; font-size: 11px; }
  .btnrow { display: flex; gap: 6px; margin: 8px 0 2px; }
  button { background: #1c2740; color: #cdd6f4; border: 1px solid #2b3a5c; border-radius: 5px; padding: 4px 8px; font-size: 11px; cursor: pointer; }
  button:hover { background: #24345a; }
  button.active { background: var(--accent); color: #0b1018; border-color: var(--accent); font-weight: 600; }
  #detailBtns { width: 100%; } #detailBtns button { flex: 1; }
  .ctrl { font-size: 11px; margin-top: 8px; }
  .ctrl label { display: flex; justify-content: space-between; opacity: 0.8; }
  input[type=range] { width: 100%; accent-color: var(--accent); }
  #warnings {
    padding: 8px 12px; font-size: 11px; border-bottom: 1px solid #1f2940;
    flex: 0 1 auto; max-height: 34%; overflow-y: auto;
  }
  .warn { color: #f38ba8; margin-bottom: 4px; }
  .note { color: #a6adc8; opacity: 0.8; margin-bottom: 3px; }
  .warn .wcells { color: #a6adc8; opacity: 0.75; margin: 2px 0 0 12px; word-break: break-all; }
  .warn .wmore { color: var(--accent); cursor: pointer; text-decoration: underline dotted; }
  .warn .whelp { display: block; color: #a6adc8; opacity: 0.85; margin: 2px 0 0 12px; }
  #toggle { position: absolute; top: 8px; left: 8px; z-index: 30; }
  #empty { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; flex-direction: column; gap: 10px; padding: 40px; text-align: center; z-index: 5; }
  #empty .big { font-size: 15px; color: #f38ba8; max-width: 480px; }
  /* Hover readout (which layer is under the cursor). */
  #readout {
    position: absolute; bottom: 10px; right: 12px; z-index: 15; max-width: 280px;
    background: var(--panel-bg); border: 1px solid #2b3a5c; border-radius: 6px;
    padding: 8px 10px; font-size: 11px; line-height: 1.5; pointer-events: none;
    display: none; box-shadow: 0 2px 10px rgba(0,0,0,0.5);
  }
  #readout .rtitle { font-weight: 600; font-size: 12px; margin-bottom: 2px; display: flex; align-items: center; gap: 6px; }
  #readout .rk { opacity: 0.55; }
  #readout .rv { font-variant-numeric: tabular-nums; }
  /* Per-row "solo" (isolate) affordance. */
  .row .solo { opacity: 0; font-size: 10px; padding: 1px 5px; border-radius: 4px; border: 1px solid #2b3a5c; background: #16203a; color: #cdd6f4; cursor: pointer; flex: 0 0 auto; }
  .row:hover .solo { opacity: 0.75; }
  .row .solo:hover { opacity: 1; background: var(--accent); color: #0b1018; border-color: var(--accent); }
  .row .solo.active { opacity: 1; background: var(--accent); color: #0b1018; border-color: var(--accent); }
  /* Measurement tools. */
  #measHint { font-size: 11px; opacity: 0.7; margin: 4px 0; min-height: 14px; }
  #measList { margin-top: 6px; }
  .meas { display: flex; align-items: flex-start; gap: 6px; padding: 4px 0; border-top: 1px solid #1f2940; font-size: 11px; }
  .meas .mtxt { flex: 1; line-height: 1.45; }
  .meas .mtag { font-weight: 600; color: var(--accent); }
  .meas .mdel { cursor: pointer; opacity: 0.6; padding: 0 4px; }
  .meas .mdel:hover { opacity: 1; color: #f38ba8; }
  #measBtns button.active { background: var(--accent); color: #0b1018; border-color: var(--accent); font-weight: 600; }
  /* On-canvas measurement labels (projected from 3D). */
  #labels { position: absolute; inset: 0; z-index: 12; pointer-events: none; overflow: hidden; }
  #labels .lbl {
    position: absolute; transform: translate(-50%, -50%); white-space: nowrap;
    background: rgba(11,16,24,0.82); border: 1px solid var(--accent); color: #e8eefc;
    border-radius: 4px; padding: 1px 5px; font-size: 11px; font-variant-numeric: tabular-nums;
  }
  #labels .lbl.pt { border-color: #f9e2af; color: #f9e2af; padding: 0 4px; }
  /* Exact 2D slice view (plan Stage 3). */
  #sliceWrap { position: absolute; inset: 0; z-index: 8; display: none; align-items: center; justify-content: center; background: #0b1018; }
  #sliceWrap.active { display: flex; }
  #sliceCanvas { image-rendering: pixelated; max-width: 96%; max-height: 96%; border: 1px solid #2b3a5c; cursor: crosshair; }
  #sliceCanvas.panning { cursor: grabbing; }
  #sliceHud { position: absolute; bottom: 10px; left: 12px; z-index: 15; font-size: 11px; opacity: 0.75; background: var(--panel-bg); border: 1px solid #2b3a5c; border-radius: 5px; padding: 3px 8px; }
  #sliceStatus { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); font-size: 11px; background: var(--panel-bg); border: 1px solid #2b3a5c; border-radius: 5px; padding: 3px 10px; }
  #slicePick { position: absolute; bottom: 10px; right: 12px; z-index: 15; max-width: 300px; background: var(--panel-bg); border: 1px solid #2b3a5c; border-radius: 6px; padding: 8px 10px; font-size: 11px; line-height: 1.5; display: none; }
  #sliceLegend { margin-top: 6px; max-height: 160px; overflow-y: auto; }
  #sliceLegend .sl { display: flex; align-items: center; gap: 6px; font-size: 11px; padding: 2px 0; }
  #sliceLegend .sw { width: 10px; height: 10px; border-radius: 2px; flex: 0 0 auto; }
  #sliceProblem { color: #f5c2e7; font-size: 11px; margin-top: 4px; }
  #viewBtns button { flex: 1; }
</style>
</head>
<body>
  <div id="stage"></div>
  <div id="labels"></div>
  <div id="sliceWrap"><canvas id="sliceCanvas"></canvas><div id="sliceStatus"></div><div id="sliceHud">scroll: zoom at cursor • drag: pan • click: identify</div></div>
  <div id="slicePick"></div>
  <button id="toggle" title="Show/hide panel">☰ Layers</button>
  <div id="hud">drag: orbit • scroll: zoom • right-drag: pan • hover: inspect</div>
  <div id="readout"></div>
  <div id="empty"><div class="big" id="emptyMsg"></div></div>

  <div id="panel">
    <header>
      <h1>OWEN Geometry</h1>
      <div class="sub" id="meta"></div>
    </header>
    <div id="warnings"></div>
    <div id="scroll">
      <div class="section" id="viewModeSection">
        <div class="title"><span>View mode</span></div>
        <div class="btnrow" id="viewBtns">
          <button id="view3d" class="active">3D view</button>
          <button id="viewSlice" title="Pixel-exact CSG classification (MCNP / Serpent / SCONE)">2D slice</button>
        </div>
      </div>

      <div class="section" id="sliceSection" style="display:none">
        <div class="title"><span>2D Slice (exact)</span></div>
        <div class="btnrow" id="sliceAxisBtns">
          <button data-axis="xy" class="active">XY</button>
          <button data-axis="xz">XZ</button>
          <button data-axis="yz">YZ</button>
        </div>
        <div class="ctrl">
          <label><span>Plane offset</span><span id="sliceOffVal">0.00 cm</span></label>
          <input type="range" id="sliceOffset" min="-10" max="10" step="0.1" value="0" />
        </div>
        <div class="ctrl">
          <label><span>Zoom</span><span id="sliceZoomVal">fit</span></label>
          <div class="btnrow" id="sliceZoomBtns">
            <button data-zoom="out" title="Zoom out">−</button>
            <button data-zoom="in" title="Zoom in">+</button>
            <button data-zoom="fit" title="Frame the whole model">Fit</button>
          </div>
        </div>
        <div class="ctrl">
          <label><span>Resolution</span></label>
          <div class="btnrow" id="sliceResBtns">
            <button data-res="384">384</button>
            <button data-res="512">512</button>
            <button data-res="768" class="active">768</button>
            <button data-res="1024">1024</button>
          </div>
        </div>
        <div class="ctrl">
          <label><span>Sampling</span><span id="sliceSamplesNote"></span></label>
          <div class="btnrow" id="sliceSampleBtns">
            <button data-samples="1" title="One point per pixel — fastest, aliases on a lattice">1×</button>
            <button data-samples="2" class="active" title="2×2 subpixels, majority wins">2×</button>
            <button data-samples="3" title="3×3 subpixels — slowest, cleanest">3×</button>
          </div>
        </div>
        <div class="ctrl">
          <label><span>Color by</span></label>
          <div class="btnrow" id="sliceColorBtns">
            <button data-color="material" class="active">Material</button>
            <button data-color="cell">Cell</button>
          </div>
        </div>
        <div class="row"><label><input type="checkbox" id="sliceEdges" checked /> Outline region boundaries</label></div>
        <div class="btnrow"><button id="sliceExport">Export PNG…</button></div>
        <div id="sliceProblem"></div>
        <div id="sliceLegend"></div>
      </div>

      <div class="section" id="layersSection">
        <div class="title"><span>Layers / Components</span></div>
        <div class="btnrow">
          <button id="compAll">All</button>
          <button id="compNone">None</button>
        </div>
        <div id="components"></div>
      </div>

      <div class="section" id="materialsSection">
        <div class="title" id="matTitle"><span>Materials</span><span id="matChevron">▸</span></div>
        <div id="materials" style="display:none"></div>
      </div>

      <div class="section" id="axialSection" style="display:none">
        <div class="title"><span>Axial Layers</span><span id="axCount"></span></div>
        <div class="btnrow">
          <button id="axAll">All</button>
          <button id="axNone">None</button>
        </div>
        <div class="ctrl">
          <label><span>Axial slice (Z)</span><span id="axRangeVal"></span></label>
          <input type="range" id="axMin" min="0" max="1" step="0.01" value="0" />
          <input type="range" id="axMax" min="0" max="1" step="0.01" value="1" />
        </div>
        <div id="axialLayers"></div>
      </div>

      <div class="section" id="fidelitySection">
        <div class="title"><span>Fidelity</span><span id="fidBusy" style="display:none">…</span></div>
        <div class="ctrl">
          <label><span>Pin detail</span><span id="fidAuto"></span></label>
          <div class="btnrow" id="detailBtns">
            <button data-detail="auto" id="detAuto">Auto</button>
            <button data-detail="disc" id="detDisc">Disc</button>
            <button data-detail="layers" id="detLayers">Layers</button>
          </div>
        </div>
        <label class="row" id="axialRow" style="display:none">
          <input type="checkbox" id="axialOn" />
          <span class="name">Axial segments</span>
        </label>
        <div class="ctrl" id="fidHint" style="opacity:0.6"></div>
      </div>

      <div class="section">
        <div class="title"><span>View</span></div>
        <div class="ctrl">
          <label>Shell opacity <span id="opVal">0.45</span></label>
          <input type="range" id="opacity" min="0.05" max="1" step="0.05" value="0.45" />
        </div>
        <div class="ctrl">
          <label><span><input type="checkbox" id="clipOn" /> Slice (X)</span><span id="clipXVal"></span></label>
          <input type="range" id="clipX" min="-1" max="1" step="0.01" value="0" disabled />
        </div>
        <div class="ctrl">
          <label><span><input type="checkbox" id="clipYOn" /> Slice (Y)</span><span id="clipYVal"></span></label>
          <input type="range" id="clipY" min="-1" max="1" step="0.01" value="0" disabled />
        </div>
        <div class="ctrl">
          <label><span><input type="checkbox" id="clipZOn" /> Slice (Z · axial)</span><span id="clipZVal"></span></label>
          <input type="range" id="clipZ" min="-1" max="1" step="0.01" value="0" disabled />
        </div>
        <div class="btnrow"><button id="resetView">Reset view</button></div>
      </div>

      <div class="section" id="measureSection">
        <div class="title"><span>Measure</span><span id="measCount"></span></div>
        <div class="btnrow" id="measBtns">
          <button data-mode="distance" id="measDist" title="Click two points to read distance + Δx Δy Δz">Distance</button>
          <button data-mode="angle" id="measAngle" title="Click three points; the 2nd is the corner">Angle</button>
          <button data-mode="radius" id="measRadius" title="Click a pin/shell to read its radius + diameter">Radius</button>
        </div>
        <div id="measHint">Pick a tool, then click on the geometry.</div>
        <div class="btnrow"><button id="measClear">Clear measurements</button></div>
        <div id="measList"></div>
      </div>
    </div>
  </div>

  <script type="importmap" nonce="${nonce}">
  { "imports": {
      "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
      "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
  } }
  </script>
  <script type="module" nonce="${nonce}">
    import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

    // Injected pure measurement math (single source of truth — see measure.ts).
    ${injectMeasure()}

    const vscode = acquireVsCodeApi();
    const stage = document.getElementById('stage');

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(stage.clientWidth, stage.clientHeight);
    renderer.localClippingEnabled = true;
    stage.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1018);
    const camera = new THREE.PerspectiveCamera(45, stage.clientWidth / stage.clientHeight, 0.05, 200000);
    camera.position.set(40, 40, 40);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dl = new THREE.DirectionalLight(0xffffff, 0.85); dl.position.set(1, 1.4, 0.8); scene.add(dl);
    const dl2 = new THREE.DirectionalLight(0xffffff, 0.35); dl2.position.set(-1, -0.5, -0.8); scene.add(dl2);

    const root = new THREE.Group();
    scene.add(root);
    const axes = new THREE.AxesHelper(5);
    scene.add(axes);

    const clipX = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
    const clipY = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
    const clipZ = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0); // world Y = deck z (axial)
    let lastFidelity = null;

    let groups = [];          // { mesh, instances: [{matrix, comp, mat, ax, zc}] }
    let compEnabled = {};     // component id -> bool
    let matEnabled = {};      // material name -> bool
    let axEnabled = {};       // axial layer id -> bool
    let axWindow = { min: -Infinity, max: Infinity }; // visible axial z-window
    let shellOpacity = 0.45;
    let sceneBounds = null;
    let translucentMats = []; // materials whose opacity we scale live
    let compLabels = {};      // component id -> friendly label (for the readout)
    let totalInstances = 0;   // for hover-pick throttling on huge cores

    const zero = new THREE.Matrix4().makeScale(0, 0, 0);

    function disposeAll() {
      for (const g of groups) { g.mesh.geometry.dispose(); g.mesh.material.dispose(); root.remove(g.mesh); }
      groups = []; translucentMats = [];
    }

    function bucket(o) { return Math.round(Math.min(o, 0.85) * 20) / 20; }

    function render(sc) {
      disposeAll();
      const cyls = (sc && Array.isArray(sc.cylinders)) ? sc.cylinders : [];
      document.getElementById('empty').style.display = cyls.length ? 'none' : 'flex';

      // Reset toggle state from summaries.
      compEnabled = {}; matEnabled = {}; axEnabled = {};
      for (const c of (sc.components || [])) compEnabled[c.id] = true;
      for (const m of (sc.materials || [])) matEnabled[m.name] = true;
      for (const a of (sc.axialLayers || [])) axEnabled[a.id] = true;
      axWindow = { min: -Infinity, max: Infinity };

      // Bucket cylinders into instanced groups by geometry signature.
      const byKey = new Map();
      const dummy = new THREE.Object3D();
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;

      let polySeq = 0;
      for (const c of cyls) {
        const r = Math.max(0.01, c.radius);
        const h = Math.max(0.01, c.height || 1);
        const inner = c.innerRadius || 0;
        const op = (typeof c.opacity === 'number') ? c.opacity : 1;
        const known = ['box', 'arc', 'sphere', 'cone', 'torus', 'ellipsoid', 'ellcyl', 'polyhedron'];
        const shape = known.indexOf(c.shape) >= 0 ? c.shape : 'cyl';
        // A hollow shell has to be see-through or it hides whatever it contains.
        const solid = (shape === 'cyl' || shape === 'sphere') ? (inner <= 0.0001 && op >= 0.9) : op >= 0.9;
        const segs = r > 8 ? 64 : 18;
        const axis = c.axis === 'x' || c.axis === 'y' ? c.axis : 'z';
        // Rectangular boxes (baffle plates) carry their own half-sizes; square
        // boxes keep radius as the half-width. Arcs carry ring + span params.
        const hx = Math.max(0.01, (typeof c.halfX === 'number' ? c.halfX : r));
        const hy = Math.max(0.01, (typeof c.halfY === 'number' ? c.halfY : r));
        const hz = Math.max(0.01, (typeof c.halfZ === 'number' ? c.halfZ : h / 2));
        const topR = Math.max(0, (typeof c.topRadius === 'number' ? c.topRadius : r));
        const tube = Math.max(0.01, (typeof c.tube === 'number' ? c.tube : r * 0.25));
        const arcLen = shape === 'arc' ? Math.max(1, Math.min(360, c.thetaLength || 45)) : 0;
        let key;
        if (shape === 'box') {
          key = 'box|' + (solid ? 'S' : 'T') + '|' + hx.toFixed(4) + '|' + hy.toFixed(4) + '|' + h.toFixed(3) + '|' + (solid ? '1' : bucket(op));
        } else if (shape === 'arc') {
          key = 'arc|' + (solid ? 'S' : 'T') + '|' + inner.toFixed(3) + '|' + r.toFixed(3) + '|' + arcLen.toFixed(2) + '|' + h.toFixed(3) + '|' + (solid ? '1' : bucket(op));
        } else if (shape === 'sphere') {
          key = 'sph|' + (solid ? 'S' : 'T') + '|' + r.toFixed(4) + '|' + (solid ? '1' : bucket(op));
        } else if (shape === 'cone') {
          key = 'cone|' + (solid ? 'S' : 'T') + '|' + r.toFixed(4) + '|' + topR.toFixed(4) + '|' + h.toFixed(3) + '|' + axis + '|' + (solid ? '1' : bucket(op));
        } else if (shape === 'torus') {
          key = 'torus|' + (solid ? 'S' : 'T') + '|' + r.toFixed(4) + '|' + tube.toFixed(4) + '|' + axis + '|' + (solid ? '1' : bucket(op));
        } else if (shape === 'ellipsoid') {
          key = 'ellipsoid|' + (solid ? 'S' : 'T') + '|' + (solid ? '1' : bucket(op));
        } else if (shape === 'ellcyl') {
          key = 'ellcyl|' + (solid ? 'S' : 'T') + '|' + h.toFixed(3) + '|' + axis + '|' + (solid ? '1' : bucket(op));
        } else if (shape === 'polyhedron') {
          key = 'poly|' + (polySeq++); // unique: arbitrary vertex data can't instance
        } else {
          key = 'cyl|' + (solid ? 'S' : 'T') + '|' + r.toFixed(4) + '|' + h.toFixed(3) + '|' + (solid ? '1' : bucket(op)) + '|' + segs;
        }
        if (!byKey.has(key)) byKey.set(key, { solid, r, h, shape, segs, op, hx, hy, hz, inner, arcLen, topR, tube, axis, items: [] });
        byKey.get(key).items.push(c);

        // bounds (world mapping: X=c.x, Y=c.z, Z=c.y)
        if (shape === 'polyhedron' && Array.isArray(c.verts)) {
          for (let vi = 0; vi + 2 < c.verts.length; vi += 3) {
            minX = Math.min(minX, c.verts[vi]); maxX = Math.max(maxX, c.verts[vi]);
            minZ = Math.min(minZ, c.verts[vi + 1]); maxZ = Math.max(maxZ, c.verts[vi + 1]);
            minY = Math.min(minY, c.verts[vi + 2]); maxY = Math.max(maxY, c.verts[vi + 2]);
          }
        } else {
          const rx = shape === 'ellipsoid' ? hx : r;
          const ry = shape === 'ellipsoid' ? hy : r;
          minX = Math.min(minX, c.x - rx); maxX = Math.max(maxX, c.x + rx);
          minZ = Math.min(minZ, c.y - ry); maxZ = Math.max(maxZ, c.y + ry);
          minY = Math.min(minY, (c.z || 0) - h / 2); maxY = Math.max(maxY, (c.z || 0) + h / 2);
        }
      }
      sceneBounds = cyls.length ? { minX, maxX, minY, maxY, minZ, maxZ } : null;

      for (const grp of byKey.values()) {
        let geo;
        // Local-axis bake: cylinder-like primitives extrude along local +Y
        // (deck z). axis 'x' → three X (rotateZ −90°); 'y' → three Z
        // (rotateX +90°). Torus holes start on local +Z instead.
        const bakeAxialRot = (g) => {
          if (grp.axis === 'x') g.rotateZ(-Math.PI / 2);
          else if (grp.axis === 'y') g.rotateX(Math.PI / 2);
          return g;
        };
        if (grp.shape === 'box') {
          geo = new THREE.BoxGeometry(grp.hx * 2, grp.h, grp.hy * 2);
        } else if (grp.shape === 'arc') {
          // Annular sector centered on plan angle 0, extruded to height h; each
          // instance rotates it to its own thetaStart (see below).
          const half = (grp.arcLen * Math.PI / 180) / 2;
          const s = new THREE.Shape();
          s.absarc(0, 0, grp.r, -half, half, false);
          s.absarc(0, 0, Math.max(0.01, grp.inner), half, -half, true);
          geo = new THREE.ExtrudeGeometry(s, { depth: grp.h, bevelEnabled: false, curveSegments: 24 });
          // Shape plane (x,y) → world plan (X,Z); extrusion +z → world -Y, so
          // recenter the height range on the instance origin.
          geo.rotateX(Math.PI / 2);
          geo.translate(0, grp.h / 2, 0);
        } else if (grp.shape === 'sphere') {
          geo = new THREE.SphereGeometry(grp.r, grp.r > 8 ? 48 : 28, grp.r > 8 ? 32 : 18);
        } else if (grp.shape === 'cone') {
          // three.js CylinderGeometry(top, bottom, h): top at +Y. Our deck
          // convention: base radius at the low end of the axis.
          geo = bakeAxialRot(new THREE.CylinderGeometry(Math.max(0.001, grp.topR), grp.r, grp.h, grp.segs > 18 ? grp.segs : 36, 1, !grp.solid));
        } else if (grp.shape === 'torus') {
          geo = new THREE.TorusGeometry(grp.r, grp.tube, 14, 48);
          // Torus hole axis is local +Z; map to the deck axis.
          if (grp.axis === 'x') geo.rotateY(Math.PI / 2);
          else if (grp.axis === 'y') { /* hole axis already three Z = deck y */ }
          else geo.rotateX(-Math.PI / 2);
        } else if (grp.shape === 'ellipsoid') {
          geo = new THREE.SphereGeometry(1, 28, 18); // per-instance scale
        } else if (grp.shape === 'ellcyl') {
          geo = bakeAxialRot(new THREE.CylinderGeometry(1, 1, grp.h, 36, 1, !grp.solid)); // per-instance scale
        } else if (grp.shape === 'polyhedron') {
          // Arbitrary convex solid: fan-triangulate each face loop. Vertices
          // arrive in deck coords, absolute; recenter on the item's centroid
          // so the shared instance-positioning path applies.
          const item = grp.items[0] || {};
          const verts = Array.isArray(item.verts) ? item.verts : [];
          const faces = Array.isArray(item.faces) ? item.faces : [];
          const cx = item.x || 0, cy = item.y || 0, cz = item.z || 0;
          const pos = [];
          for (const face of faces) {
            for (let t = 1; t + 1 < face.length; t++) {
              for (const vi of [face[0], face[t], face[t + 1]]) {
                const off = vi * 3;
                // deck (x,y,z) → three (X,Y,Z) = (x, z, y)
                pos.push((verts[off] || 0) - cx, (verts[off + 2] || 0) - cz, (verts[off + 1] || 0) - cy);
              }
            }
          }
          geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
          geo.computeVertexNormals();
        } else {
          geo = new THREE.CylinderGeometry(grp.r, grp.r, grp.h, grp.segs, 1, !grp.solid);
        }
        const mat = new THREE.MeshStandardMaterial({
          color: 0xffffff, roughness: 0.55, metalness: 0.05,
          transparent: !grp.solid,
          opacity: grp.solid ? 1 : Math.min(grp.op, shellOpacity),
          // Polyhedron winding is not guaranteed by the CSG clipper — render
          // both sides so no face can vanish.
          side: (grp.solid && grp.shape !== 'polyhedron') ? THREE.FrontSide : THREE.DoubleSide,
          depthWrite: grp.solid,
          clippingPlanes: [],
        });
        if (!grp.solid) translucentMats.push({ mat, base: grp.op });
        const mesh = new THREE.InstancedMesh(geo, mat, grp.items.length);
        mesh.frustumCulled = false;
        const color = new THREE.Color();
        const instances = [];
        grp.items.forEach((c, i) => {
          dummy.position.set(c.x, c.z || 0, c.y);
          dummy.rotation.set(0, 0, 0);
          if (grp.shape === 'arc') {
            // Geometry is centered on plan angle 0; rotate to the arc's own
            // center. World Z = deck +y, so plan angle θ needs rotation.y = -θ.
            const centerDeg = (c.thetaStart || 0) + grp.arcLen / 2;
            dummy.rotation.y = -centerDeg * Math.PI / 180;
          }
          dummy.scale.set(1, 1, 1);
          if (grp.shape === 'ellipsoid') {
            // Unit sphere → semi-axes; deck (x,y,z) → three (X,Z,Y).
            dummy.scale.set(Math.max(0.01, c.halfX || c.radius), Math.max(0.01, c.halfZ || c.radius), Math.max(0.01, c.halfY || c.radius));
          } else if (grp.shape === 'ellcyl') {
            // Unit-radius cylinder → in-plane semi-axes r1 (halfX), r2 (halfY).
            const r1 = Math.max(0.01, c.halfX || c.radius);
            const r2 = Math.max(0.01, c.halfY || c.radius);
            if (grp.axis === 'x') dummy.scale.set(1, r2, r1);
            else if (grp.axis === 'y') dummy.scale.set(r1, r2, 1);
            else dummy.scale.set(r1, 1, r2);
          }
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          color.set(c.color || '#cccccc');
          mesh.setColorAt(i, color);
          instances.push({
            matrix: dummy.matrix.clone(),
            comp: c.component || 'other', mat: c.material || '', ax: c.axialLayer || '',
            zc: (typeof c.z === 'number' ? c.z : 0),
            r: c.radius, ri: c.innerRadius || 0, h: grp.h,
            hx: grp.hx || 0, hy: grp.hy || 0,
            shape: grp.shape, label: c.label || '',
            axIndex: (typeof c.axialIndex === 'number' ? c.axialIndex : null),
          });
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.userData.groupIndex = groups.length;
        root.add(mesh);
        groups.push({ mesh, instances });
      }

      totalInstances = groups.reduce((n, g) => n + g.instances.length, 0);
      clearMeasurements();   // stale geometry — drop any prior measurements/labels
      setHover(null);
      applyVisibility();
      applyClipping();
      buildPanel(sc);
      resetView();
    }

    // Single source of truth for "is this instance currently shown" — used by
    // both the instanced-matrix culling and the raycast pick (so hidden layers
    // are never selected/measured).
    function isInstanceVisible(inst) {
      if (compEnabled[inst.comp] === false) return false;
      if (inst.mat !== '' && matEnabled[inst.mat] === false) return false;
      // Axial filters only apply to cylinders in an axial layer (vessel/context
      // shells have no ax and stay visible).
      if (inst.ax) {
        if (axEnabled[inst.ax] === false) return false;
        if (inst.zc < axWindow.min - 1e-6 || inst.zc > axWindow.max + 1e-6) return false;
      }
      return true;
    }

    function applyVisibility() {
      for (const g of groups) {
        let changed = false;
        g.instances.forEach((inst, i) => {
          g.mesh.setMatrixAt(i, isInstanceVisible(inst) ? inst.matrix : zero);
          changed = true;
        });
        if (changed) g.mesh.instanceMatrix.needsUpdate = true;
      }
    }

    function applyOpacity() {
      for (const t of translucentMats) t.mat.opacity = Math.min(t.base, shellOpacity);
    }

    function applyClipping() {
      const planes = [];
      if (document.getElementById('clipOn').checked) planes.push(clipX);
      if (document.getElementById('clipYOn').checked) planes.push(clipY);
      if (document.getElementById('clipZOn').checked) planes.push(clipZ);
      for (const g of groups) g.mesh.material.clippingPlanes = planes;
    }

    /**
     * One line per distinct reason. A deck that uses the same construct in 300
     * cells produced 300 identical lines, which buried the rest of the panel.
     */
    function groupWarnings(list) {
      const byReason = new Map();
      for (const w of list) {
        const m = /^Cell (\\S+?): (.*)$/.exec(w);
        const reason = m ? m[2] : w;
        const g = byReason.get(reason) || { reason: reason, cells: [] };
        if (m) g.cells.push(m[1]);
        byReason.set(reason, g);
      }
      return Array.from(byReason.values());
    }

    /** The affected cell numbers, truncated until asked for in full. */
    function cellList(cells) {
      const wrap = document.createElement('div');
      wrap.className = 'wcells';
      const SHOWN = 8;
      const render = (all) => {
        wrap.textContent = (all ? cells : cells.slice(0, SHOWN)).join(', ');
        if (!all && cells.length > SHOWN) {
          wrap.appendChild(document.createTextNode(' '));
          const more = document.createElement('span');
          more.className = 'wmore';
          more.textContent = '+' + (cells.length - SHOWN) + ' more';
          more.onclick = () => render(true);
          wrap.appendChild(more);
        }
      };
      render(false);
      return wrap;
    }

    /** Plain-language follow-up for the warnings people actually ask about. */
    const WARN_HELP = [
      {
        match: 'already being expanded',
        text: 'Two cells name each other with #, so substituting one never terminates. '
          + 'Writing one of them out of surfaces instead of a complement clears it.',
      },
      {
        match: 'carrying a trcl',
        text: 'The cell behind the # is placed by its own trcl, so its surfaces do not sit '
          + 'where this region would read them. The bounding box avoids drawing it in the '
          + 'wrong place; the 2D slice view evaluates the real region and is unaffected.',
      },
      {
        match: 'union terms',
        text: 'Rewriting the region as a union of intersections multiplied out past the '
          + 'budget. Splitting the cell in two, or replacing a deep nest of unions with a '
          + 'macrobody, renders exactly.',
      },
      {
        match: 'outside cone',
        text: 'A cone with no sheet selector is two nappes, so the renderer cannot tell which '
          + 'half you meant. Add ±1 as the last entry on the surface card.',
      },
      {
        match: 'only indexes +i/+j',
        text: 'This is MCNP, not a cut-off render. Element (0,0,0) is the lattice cell as written, '
          + 'usually the origin window, and fill=0:N only steps one way from there. A centered '
          + 'assembly rpp then shows about a quarter of the pins. Change the range to straddle '
          + 'zero (fill=-8:8 -8:8 0:0 for a 17×17).',
      },
      {
        match: 'one quadrant',
        text: 'The 3D view centers that fill map so the assembly looks complete. The 2D slice '
          + 'follows MCNP and will not. The same fill= change fixes both pictures.',
      },
    ];

    function buildPanel(sc) {
      document.getElementById('meta').textContent =
        sc.primitiveCount.toLocaleString() + ' primitives • ' + (sc.language || '').toUpperCase();

      const warn = document.getElementById('warnings');
      warn.innerHTML = '';
      for (const g of groupWarnings(sc.warnings || [])) {
        const d = document.createElement('div');
        d.className = 'warn';
        d.textContent = '⚠ ' + (g.cells.length > 1
          ? g.cells.length + ' cells: ' + g.reason
          : (g.cells.length === 1 ? 'Cell ' + g.cells[0] + ': ' : '') + g.reason);
        if (g.cells.length > 1) d.appendChild(cellList(g.cells));
        const help = WARN_HELP.find((h) => g.reason.indexOf(h.match) !== -1);
        if (help) {
          const h = document.createElement('span');
          h.className = 'whelp';
          h.textContent = help.text;
          d.appendChild(h);
        }
        warn.appendChild(d);
      }
      for (const n of (sc.notes || [])) { const d = document.createElement('div'); d.className = 'note'; d.textContent = n; warn.appendChild(d); }
      warn.style.display = (warn.childElementCount ? 'block' : 'none');

      const emptyMsg = document.getElementById('emptyMsg');
      emptyMsg.textContent = (sc.warnings && sc.warnings[0]) ? sc.warnings[0] : 'No geometry to display.';

      compLabels = {};
      for (const c of (sc.components || [])) compLabels[c.id] = c.label || c.id;
      renderRows('components', (sc.components || []), (item) => item.id, compEnabled, true);
      renderRows('materials', (sc.materials || []), (item) => item.name, matEnabled, false);
      buildAxialPanel(sc.axialLayers || []);
      reflectFidelity(sc.fidelity || {});
    }

    function buildAxialPanel(layers) {
      const section = document.getElementById('axialSection');
      section.style.display = layers.length ? 'block' : 'none';
      document.getElementById('axCount').textContent = layers.length ? (layers.length + ' levels') : '';
      renderRows('axialLayers', layers.map((a) => ({ id: a.id, label: a.label, color: a.color, count: a.count })), (item) => item.id, axEnabled, false);
      if (!layers.length) return;
      let zmin = Infinity, zmax = -Infinity;
      for (const a of layers) { zmin = Math.min(zmin, a.zmin); zmax = Math.max(zmax, a.zmax); }
      const lo = document.getElementById('axMin'), hi = document.getElementById('axMax');
      const span = Math.max(1e-6, zmax - zmin), step = span / 200;
      for (const el of [lo, hi]) { el.min = zmin; el.max = zmax; el.step = step; }
      lo.value = zmin; hi.value = zmax;
      axWindow = { min: zmin, max: zmax };
      document.getElementById('axRangeVal').textContent = zmin.toFixed(1) + '–' + zmax.toFixed(1);
    }

    function reflectFidelity(f) {
      document.getElementById('fidBusy').style.display = 'none';
      lastFidelity = f;
      const detail = f.detail || 'layers';
      for (const id of ['detAuto', 'detDisc', 'detLayers']) {
        document.getElementById(id).classList.remove('active');
      }
      // Highlight the resolved detail; "Auto" stays highlighted only if chosen.
      const map = { disc: 'detDisc', layers: 'detLayers' };
      if (map[detail]) document.getElementById(map[detail]).classList.add('active');
      document.getElementById('fidAuto').textContent = f.autoDetail ? ('auto → ' + f.autoDetail) : '';
      const axRow = document.getElementById('axialRow');
      axRow.style.display = f.hasAxial ? 'flex' : 'none';
      document.getElementById('axialOn').checked = !!f.axial;
      const hint = document.getElementById('fidHint');
      const pins = (f.totalPins || 0).toLocaleString();
      hint.textContent = pins + ' pin positions • ' + (detail === 'disc' ? 'one disc per pin' : 'concentric layers')
        + (f.axial ? ' • axial segments' : '');
    }

    function renderRows(containerId, items, keyOf, enabledMap, isComp) {
      const box = document.getElementById(containerId);
      box.innerHTML = '';
      for (const it of items) {
        const key = keyOf(it);
        const row = document.createElement('label'); row.className = 'row'; row.dataset.key = key;
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = enabledMap[key] !== false;
        cb.addEventListener('change', () => { enabledMap[key] = cb.checked; applyVisibility(); });
        const sw = document.createElement('span'); sw.className = 'swatch'; sw.style.background = it.color || '#888';
        const nm = document.createElement('span'); nm.className = 'name'; nm.textContent = it.label || it.name || key;
        const ct = document.createElement('span'); ct.className = 'count'; ct.textContent = it.count.toLocaleString();
        // "Solo" = isolate: show only this item; clicking solo on the already-
        // isolated item restores the whole group (so it acts as a toggle).
        const solo = document.createElement('span'); solo.className = 'solo'; solo.textContent = 'solo'; solo.title = 'Show only this layer';
        solo.addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation();
          soloItem(enabledMap, containerId, key);
        });
        row.appendChild(cb); row.appendChild(sw); row.appendChild(nm); row.appendChild(ct); row.appendChild(solo);
        box.appendChild(row);
      }
    }

    function soloItem(enabledMap, containerId, key) {
      const keys = Object.keys(enabledMap);
      const alreadySolo = enabledMap[key] !== false && keys.every((k) => k === key || enabledMap[k] === false);
      for (const k of keys) enabledMap[k] = alreadySolo ? true : (k === key);
      document.querySelectorAll('#' + containerId + ' .row').forEach((row) => {
        const rk = row.dataset.key;
        const cb = row.querySelector('input');
        const solo = row.querySelector('.solo');
        if (cb) cb.checked = enabledMap[rk] !== false;
        if (solo) solo.classList.toggle('active', !alreadySolo && rk === key);
      });
      applyVisibility();
    }

    function resetView() {
      if (!sceneBounds) { camera.position.set(40, 40, 40); controls.target.set(0, 0, 0); controls.update(); return; }
      const b = sceneBounds;
      const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2, cz = (b.minZ + b.maxZ) / 2;
      const dx = b.maxX - b.minX, dy = b.maxY - b.minY, dz = b.maxZ - b.minZ;
      const radius = Math.max(dx, dy, dz, 2) * 0.5;
      const dist = radius * 2.6 + 4;
      camera.near = Math.max(0.05, radius / 1000); camera.far = radius * 40 + 1000; camera.updateProjectionMatrix();
      camera.position.set(cx + dist, cy + dist * 0.8, cz + dist);
      controls.target.set(cx, cy, cz); controls.update();
      axes.scale.setScalar(Math.max(1, radius * 0.15));
      // clip slider ranges
      const sx = document.getElementById('clipX'); sx.min = b.minX; sx.max = b.maxX; sx.value = cx; clipX.constant = cx;
      const sy = document.getElementById('clipY'); sy.min = b.minZ; sy.max = b.maxZ; sy.value = cz; clipY.constant = cz;
      const sz = document.getElementById('clipZ'); sz.min = b.minY; sz.max = b.maxY; sz.value = cy; clipZ.constant = cy;
    }

    // --- UI wiring ---
    document.getElementById('toggle').addEventListener('click', () => document.getElementById('panel').classList.toggle('collapsed'));
    document.getElementById('compAll').addEventListener('click', () => setAll(compEnabled, 'components', true));
    document.getElementById('compNone').addEventListener('click', () => setAll(compEnabled, 'components', false));
    document.getElementById('axAll').addEventListener('click', () => setAll(axEnabled, 'axialLayers', true));
    document.getElementById('axNone').addEventListener('click', () => setAll(axEnabled, 'axialLayers', false));
    const axMin = document.getElementById('axMin'), axMax = document.getElementById('axMax');
    function syncAxWindow() {
      let lo = parseFloat(axMin.value), hi = parseFloat(axMax.value);
      if (lo > hi) { const t = lo; lo = hi; hi = t; }
      axWindow = { min: lo, max: hi };
      document.getElementById('axRangeVal').textContent = lo.toFixed(1) + '–' + hi.toFixed(1);
      applyVisibility();
    }
    axMin.addEventListener('input', syncAxWindow);
    axMax.addEventListener('input', syncAxWindow);
    function setAll(map, containerId, val) {
      for (const k of Object.keys(map)) map[k] = val;
      document.querySelectorAll('#' + containerId + ' input').forEach((cb) => cb.checked = val);
      document.querySelectorAll('#' + containerId + ' .solo').forEach((s) => s.classList.remove('active'));
      applyVisibility();
    }
    document.getElementById('matTitle').addEventListener('click', () => {
      const box = document.getElementById('materials');
      const open = box.style.display !== 'none';
      box.style.display = open ? 'none' : 'block';
      document.getElementById('matChevron').textContent = open ? '▸' : '▾';
    });
    const op = document.getElementById('opacity');
    op.addEventListener('input', () => { shellOpacity = parseFloat(op.value); document.getElementById('opVal').textContent = op.value; applyOpacity(); });
    const clipOn = document.getElementById('clipOn'), clipXs = document.getElementById('clipX');
    clipOn.addEventListener('change', () => { clipXs.disabled = !clipOn.checked; applyClipping(); });
    clipXs.addEventListener('input', () => { clipX.constant = parseFloat(clipXs.value); document.getElementById('clipXVal').textContent = parseFloat(clipXs.value).toFixed(1); });
    const clipYOn = document.getElementById('clipYOn'), clipYs = document.getElementById('clipY');
    clipYOn.addEventListener('change', () => { clipYs.disabled = !clipYOn.checked; applyClipping(); });
    clipYs.addEventListener('input', () => { clipY.constant = parseFloat(clipYs.value); document.getElementById('clipYVal').textContent = parseFloat(clipYs.value).toFixed(1); });
    const clipZOn = document.getElementById('clipZOn'), clipZs = document.getElementById('clipZ');
    clipZOn.addEventListener('change', () => { clipZs.disabled = !clipZOn.checked; applyClipping(); });
    clipZs.addEventListener('input', () => { clipZ.constant = parseFloat(clipZs.value); document.getElementById('clipZVal').textContent = parseFloat(clipZs.value).toFixed(1); });
    document.getElementById('resetView').addEventListener('click', resetView);

    // --- Fidelity controls (re-extracted by the extension host) ---
    function requestFidelity(detail) {
      const axial = document.getElementById('axialOn').checked;
      const d = detail || (lastFidelity && lastFidelity.detail) || 'auto';
      document.getElementById('fidBusy').style.display = 'inline';
      vscode.postMessage({ type: 'setFidelity', detail: d, axial });
    }
    document.querySelectorAll('#detailBtns button').forEach((b) => {
      b.addEventListener('click', () => requestFidelity(b.getAttribute('data-detail')));
    });
    document.getElementById('axialOn').addEventListener('change', () => requestFidelity(null));

    // --- Picking, hover readout & measurement tools ---
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const overlay = new THREE.Group();         // measurement lines/markers (unclipped)
    scene.add(overlay);
    const labelsBox = document.getElementById('labels');

    let hoverHelper = null;                     // wireframe of the hovered instance
    let hoverKey = '';
    let measureMode = null;                     // null | 'distance' | 'angle' | 'radius'
    let pending = [];                           // accumulated click points (world+deck)
    let pendingMarkers = [];
    let measurements = [];                       // completed measurements
    let measSeq = 0;

    // World axes map to deck axes as X=deck.x, Y=deck.z (axial), Z=deck.y.
    function deckOf(world) { return { x: world.x, y: world.z, z: world.y }; }
    function meshList() { return groups.map((g) => g.mesh); }
    function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    function markerRadius() {
      if (!sceneBounds) return 0.3;
      const b = sceneBounds;
      return Math.max(0.02, Math.max(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ, 1) * 0.006);
    }
    function markerMesh(world, color) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(markerRadius(), 12, 12),
        new THREE.MeshBasicMaterial({ color, depthTest: false }));
      m.position.copy(world); m.renderOrder = 1000; return m;
    }
    function lineSeg(points, color) {
      const l = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }));
      l.renderOrder = 998; return l;
    }

    function pickAt(clientX, clientY) {
      if (!groups.length) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(meshList(), false);
      for (const h of hits) {
        const g = groups[h.object.userData.groupIndex];
        if (!g || h.instanceId == null) continue;
        const inst = g.instances[h.instanceId];
        if (!inst || !isInstanceVisible(inst)) continue;   // never pick a hidden layer
        return { inst, point: h.point, gi: h.object.userData.groupIndex, id: h.instanceId };
      }
      return null;
    }

    function setHover(pick) {
      const key = pick ? (pick.gi + ':' + pick.id) : '';
      if (key === hoverKey) { if (pick) showReadout(pick.inst); return; }
      hoverKey = key;
      if (hoverHelper) { overlay.remove(hoverHelper); hoverHelper.geometry.dispose(); hoverHelper.material.dispose(); hoverHelper = null; }
      if (!pick) { document.getElementById('readout').style.display = 'none'; return; }
      const g = groups[pick.gi];
      hoverHelper = new THREE.LineSegments(
        new THREE.EdgesGeometry(g.mesh.geometry),
        new THREE.LineBasicMaterial({ color: 0xf9e2af, depthTest: false, transparent: true, opacity: 0.9 }));
      hoverHelper.renderOrder = 999;
      const m = new THREE.Matrix4(); g.mesh.getMatrixAt(pick.id, m);
      hoverHelper.applyMatrix4(m);
      overlay.add(hoverHelper);
      showReadout(pick.inst);
    }

    function showReadout(inst) {
      const ro = document.getElementById('readout');
      const compLabel = compLabels[inst.comp] || inst.comp;
      const zmin = inst.zc - inst.h / 2, zmax = inst.zc + inst.h / 2;
      const rows = ['<div class="rtitle">' + escHtml(inst.label || compLabel) + '</div>'];
      const line = (k, v) => '<div><span class="rk">' + k + ':</span> <span class="rv">' + escHtml(v) + '</span></div>';
      rows.push(line('Component', compLabel));
      if (inst.mat) rows.push(line('Material', inst.mat));
      if (inst.axIndex != null) rows.push(line('Axial layer', '#' + inst.axIndex + (inst.ax ? ' · ' + inst.ax : '')));
      if (inst.shape === 'box') {
        if (inst.hx && inst.hy && Math.abs(inst.hx - inst.hy) > 0.001) {
          rows.push(line('Half-size', fmtLen(inst.hx) + ' × ' + fmtLen(inst.hy) + ' cm'));
        } else {
          rows.push(line('Half-width', fmtLen(inst.hx || inst.r) + ' cm'));
        }
      } else if (inst.shape === 'arc') {
        rows.push(line('Ring', fmtLen(inst.ri) + ' → ' + fmtLen(inst.r) + ' cm'));
      } else if (inst.shape === 'sphere') {
        rows.push(line('Radius', fmtLen(inst.r) + ' cm'));
        rows.push(line('Diameter', fmtLen(diameter(inst.r)) + ' cm'));
      } else if (inst.shape === 'cone') {
        rows.push(line('Base radius', fmtLen(inst.r) + ' cm'));
      } else if (inst.shape === 'torus') {
        rows.push(line('Major radius', fmtLen(inst.r) + ' cm'));
      } else if (inst.shape === 'ellipsoid' || inst.shape === 'ellcyl') {
        rows.push(line('Semi-axes', fmtLen(inst.hx) + ' × ' + fmtLen(inst.hy) + ' cm'));
      } else if (inst.shape === 'polyhedron') {
        rows.push(line('Shape', 'planar solid (CSG)'));
      } else {
        rows.push(line('Radius', fmtLen(inst.r) + ' cm'));
        rows.push(line('Diameter', fmtLen(diameter(inst.r)) + ' cm'));
        if (inst.ri > 0.0001) rows.push(line('Inner radius', fmtLen(inst.ri) + ' cm'));
      }
      rows.push(line('Height', fmtLen(inst.h) + ' cm'));
      rows.push(line('Z range', fmtLen(zmin) + ' → ' + fmtLen(zmax) + ' cm'));
      ro.innerHTML = rows.join('');
      ro.style.display = 'block';
    }

    function setMeasHint(t) { document.getElementById('measHint').textContent = t; }

    function addPointMarker(world) { const s = markerMesh(world, 0xf9e2af); overlay.add(s); pendingMarkers.push(s); }
    function clearPending() {
      for (const m of pendingMarkers) { overlay.remove(m); m.geometry.dispose(); m.material.dispose(); }
      pendingMarkers = []; pending = [];
    }

    function handleMeasureClick(pick) {
      if (measureMode === 'radius') { addRadiusMeasurement(pick); return; }
      pending.push({ p: pick.point.clone(), deck: deckOf(pick.point) });
      addPointMarker(pick.point);
      const need = measureMode === 'distance' ? 2 : 3;
      if (pending.length >= need) {
        if (measureMode === 'distance') addDistanceMeasurement(pending[0], pending[1]);
        else addAngleMeasurement(pending[0], pending[1], pending[2]);
        clearPending();
        setMeasHint(measureMode === 'distance' ? 'Click two points to measure distance.' : 'Click three points (2nd = corner).');
      } else {
        setMeasHint(measureMode === 'distance'
          ? ('Click point 2 of 2…')
          : ('Click point ' + (pending.length + 1) + ' of 3 (2nd = corner)…'));
      }
    }

    function addDistanceMeasurement(a, b) {
      const parts = [lineSeg([a.p, b.p], 0x89dceb), markerMesh(a.p, 0x89dceb), markerMesh(b.p, 0x89dceb)];
      for (const o of parts) overlay.add(o);
      const dist = distance3(a.deck, b.deck), d = deltas(a.deck, b.deck);
      const mid = a.p.clone().add(b.p).multiplyScalar(0.5);
      measurements.push({
        id: ++measSeq, type: 'distance', parts,
        labels: [{ pos: mid, text: fmtLen(dist) + ' cm', cls: '' }],
        listText: '<span class="mtag">Distance</span> ' + fmtLen(dist) + ' cm<br>Δx ' + fmtLen(d.dx) + ' · Δy ' + fmtLen(d.dy) + ' · Δz ' + fmtLen(d.dz) + ' cm',
      });
      refreshMeasList();
    }

    function addAngleMeasurement(a, vtx, b) {
      const parts = [
        lineSeg([a.p, vtx.p], 0xcba6f7), lineSeg([vtx.p, b.p], 0xcba6f7),
        markerMesh(a.p, 0xcba6f7), markerMesh(vtx.p, 0xcba6f7), markerMesh(b.p, 0xcba6f7),
      ];
      for (const o of parts) overlay.add(o);
      const ang = angleDeg(a.deck, vtx.deck, b.deck);
      measurements.push({
        id: ++measSeq, type: 'angle', parts,
        labels: [{ pos: vtx.p.clone(), text: ang.toFixed(1) + '°', cls: '' }],
        listText: '<span class="mtag">Angle</span> ' + ang.toFixed(1) + '°',
      });
      refreshMeasList();
    }

    function addRadiusMeasurement(pick) {
      const inst = pick.inst;
      if (inst.shape === 'box') { setMeasHint('That part is a box — radius applies to cylindrical shells.'); return; }
      if (inst.shape === 'arc') { setMeasHint('That part is an arc segment — its ring spans ' + fmtLen(inst.ri) + ' → ' + fmtLen(inst.r) + ' cm.'); return; }
      if (inst.shape === 'polyhedron') { setMeasHint('That part is a planar CSG solid — use the distance tool on its edges.'); return; }
      if (inst.shape === 'ellipsoid' || inst.shape === 'ellcyl') { setMeasHint('That part is elliptical — semi-axes ' + fmtLen(inst.hx) + ' × ' + fmtLen(inst.hy) + ' cm.'); return; }
      if (inst.shape === 'cone') { setMeasHint('Cone: base radius ' + fmtLen(inst.r) + ' cm.'); return; }
      if (inst.shape === 'torus') { setMeasHint('Torus: major radius ' + fmtLen(inst.r) + ' cm.'); return; }
      const m = new THREE.Matrix4(); groups[pick.gi].mesh.getMatrixAt(pick.id, m);
      const center = new THREE.Vector3().setFromMatrixPosition(m);
      center.y = pick.point.y;                          // draw the radial line at the clicked elevation
      const dir = new THREE.Vector3(pick.point.x - center.x, 0, pick.point.z - center.z);
      if (dir.lengthSq() < 1e-9) dir.set(1, 0, 0);
      const edge = center.clone().add(dir.normalize().multiplyScalar(inst.r));
      const parts = [lineSeg([center, edge], 0xa6e3a1), markerMesh(edge, 0xa6e3a1)];
      for (const o of parts) overlay.add(o);
      const mid = center.clone().add(edge).multiplyScalar(0.5);
      measurements.push({
        id: ++measSeq, type: 'radius', parts,
        labels: [{ pos: mid, text: 'r ' + fmtLen(inst.r) + ' cm', cls: '' }],
        listText: '<span class="mtag">Radius</span> ' + fmtLen(inst.r) + ' cm · ⌀ ' + fmtLen(diameter(inst.r)) + ' cm' + (inst.label ? '<br>' + escHtml(inst.label) : ''),
      });
      refreshMeasList();
    }

    function removeMeasurement(id) {
      const i = measurements.findIndex((m) => m.id === id);
      if (i < 0) return;
      for (const o of measurements[i].parts) { overlay.remove(o); o.geometry.dispose(); o.material.dispose(); }
      measurements.splice(i, 1); refreshMeasList();
    }
    function clearMeasurements() {
      for (const meas of measurements) for (const o of meas.parts) { overlay.remove(o); o.geometry.dispose(); o.material.dispose(); }
      measurements = []; clearPending(); refreshMeasList();
    }

    function refreshMeasList() {
      const list = document.getElementById('measList'); list.innerHTML = '';
      for (const meas of measurements) {
        const row = document.createElement('div'); row.className = 'meas';
        const txt = document.createElement('div'); txt.className = 'mtxt'; txt.innerHTML = meas.listText;
        const del = document.createElement('span'); del.className = 'mdel'; del.textContent = '✕'; del.title = 'Remove';
        del.addEventListener('click', () => removeMeasurement(meas.id));
        row.appendChild(txt); row.appendChild(del); list.appendChild(row);
      }
      document.getElementById('measCount').textContent = measurements.length ? String(measurements.length) : '';
      rebuildLabelEls();
    }

    function rebuildLabelEls() {
      labelsBox.innerHTML = '';
      for (const meas of measurements) {
        for (const lb of meas.labels) {
          const el = document.createElement('div'); el.className = 'lbl' + (lb.cls ? ' ' + lb.cls : '');
          el.textContent = lb.text; labelsBox.appendChild(el); lb.el = el;
        }
      }
      updateLabels();
    }

    function updateLabels() {
      const w = stage.clientWidth, h = stage.clientHeight;
      for (const meas of measurements) {
        for (const lb of meas.labels) {
          if (!lb.el) continue;
          const v = lb.pos.clone().project(camera);
          if (v.z > 1) { lb.el.style.display = 'none'; continue; }
          lb.el.style.display = 'block';
          lb.el.style.left = ((v.x * 0.5 + 0.5) * w) + 'px';
          lb.el.style.top = ((-v.y * 0.5 + 0.5) * h) + 'px';
        }
      }
    }

    function setMeasMode(mode) {
      measureMode = (measureMode === mode) ? null : mode;
      clearPending();
      for (const b of document.querySelectorAll('#measBtns button')) b.classList.toggle('active', b.getAttribute('data-mode') === measureMode);
      if (!measureMode) setMeasHint('Pick a tool, then click on the geometry.');
      else if (measureMode === 'distance') setMeasHint('Click two points to measure distance + Δx Δy Δz.');
      else if (measureMode === 'angle') setMeasHint('Click three points; the 2nd is the corner.');
      else setMeasHint('Click a pin/shell to read its radius + diameter.');
      renderer.domElement.style.cursor = measureMode ? 'crosshair' : '';
    }
    document.querySelectorAll('#measBtns button').forEach((b) => b.addEventListener('click', () => setMeasMode(b.getAttribute('data-mode'))));
    document.getElementById('measClear').addEventListener('click', clearMeasurements);

    // Pointer handling: hover inspects; a click (vs. an orbit-drag) places a
    // measurement point. We distinguish the two by total pointer travel so
    // OrbitControls keeps working unchanged.
    let downPos = null;
    renderer.domElement.addEventListener('pointerdown', (e) => { downPos = { x: e.clientX, y: e.clientY }; });
    renderer.domElement.addEventListener('pointermove', (e) => {
      if (e.buttons !== 0) return;                       // mid-drag: let OrbitControls own it
      if (totalInstances > 40000) return;                // huge cores: skip continuous hover
      setHover(pickAt(e.clientX, e.clientY));
    });
    renderer.domElement.addEventListener('pointerleave', () => setHover(null));
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (!downPos) return;
      const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      downPos = null;
      if (e.button !== 0 || moved > 4) return;           // right/middle or a drag → orbit, not a click
      if (!measureMode) return;
      const pick = pickAt(e.clientX, e.clientY);
      if (!pick) { setMeasHint('No geometry under the cursor — click on a surface.'); return; }
      handleMeasureClick(pick);
    });

    window.addEventListener('resize', () => {
      camera.aspect = stage.clientWidth / stage.clientHeight; camera.updateProjectionMatrix();
      renderer.setSize(stage.clientWidth, stage.clientHeight);
    });
    function animate() { requestAnimationFrame(animate); controls.update(); updateLabels(); renderer.render(scene, camera); }
    animate();

    window.addEventListener('message', (event) => {
      const data = event.data;
      if (data && data.type === 'scene' && data.scene) {
        render(data.scene);
        if (sliceMode) requestSlice(); // deck changed while slicing
      }
      if (data && data.type === 'meshOverlay' && data.mesh) applyMeshOverlay(data.mesh);
      if (data && data.type === 'sliceBegin') beginSliceImage(data);
      if (data && data.type === 'sliceBand') drawSliceBand(data);
      if (data && data.type === 'sliceDone') finishSliceImage(data);
      if (data && data.type === 'sliceUnavailable') {
        sliceBusy = false;
        document.getElementById('sliceStatus').textContent = data.reason || '2D slices are unavailable for this deck.';
        document.getElementById('sliceStatus').style.display = 'block';
      }
      if (data && data.type === 'sliceIdentifyResult') showSlicePick(data);
    });

    // ------- Exact 2D slice view (plan Stage 3) -------
    let sliceMode = false;
    let sliceAxis = 'xy';
    let sliceRes = 768;
    let sliceColorBy = 'material';
    let sliceOffset = 0;
    let sliceBusy = false;
    let sliceTimer = null;
    let lastSliceMeta = null; // last sliceBegin payload
    let sliceJobId = 0;       // bands from a superseded render are ignored
    // Zoom is a fraction of the fitted window; center is in plane cm. null
    // center means "let the host frame the model".
    let sliceZoom = 1;
    let sliceCenterU = null;
    let sliceCenterV = null;
    let sliceSamples = 2;
    let sliceEdges = true;

    function setActive(groupId, matchAttr, value) {
      for (const b of document.getElementById(groupId).querySelectorAll('button')) {
        b.classList.toggle('active', b.getAttribute(matchAttr) === String(value));
      }
    }

    function setViewMode(slice) {
      sliceMode = slice;
      document.getElementById('sliceWrap').classList.toggle('active', slice);
      document.getElementById('sliceSection').style.display = slice ? 'block' : 'none';
      document.getElementById('slicePick').style.display = 'none';
      document.getElementById('view3d').classList.toggle('active', !slice);
      document.getElementById('viewSlice').classList.toggle('active', slice);
      if (slice) requestSlice();
    }

    function sliceViewMsg(extra) {
      const m = {
        axis: sliceAxis, offset: sliceOffset, res: sliceRes, colorBy: sliceColorBy,
        zoom: sliceZoom, samples: sliceSamples, edges: sliceEdges,
      };
      if (sliceCenterU !== null) m.centerU = sliceCenterU;
      if (sliceCenterV !== null) m.centerV = sliceCenterV;
      return Object.assign(m, extra || {});
    }

    function requestSlice() {
      if (!sliceMode) return;
      sliceBusy = true;
      const st = document.getElementById('sliceStatus');
      st.textContent = 'classifying…';
      st.style.display = 'block';
      vscode.postMessage(sliceViewMsg({ type: 'sliceRequest' }));
    }

    function scheduleSlice() {
      if (sliceTimer) clearTimeout(sliceTimer);
      sliceTimer = setTimeout(requestSlice, 200);
    }

    /** Size the canvas for a new render and adopt the host's framing. */
    function beginSliceImage(data) {
      sliceJobId = data.id;
      sliceBusy = true;
      const canvas = document.getElementById('sliceCanvas');
      if (canvas.width !== data.width || canvas.height !== data.height) {
        canvas.width = data.width;
        canvas.height = data.height;
      } else {
        // Same size: keep the previous image visible underneath so panning
        // does not flash an empty frame while the new bands arrive.
        canvas.getContext('2d').globalAlpha = 1;
      }
      lastSliceMeta = data;

      // Offset slider range follows the model bounds along the cut axis.
      const off = document.getElementById('sliceOffset');
      if (isFinite(data.offsetLo) && isFinite(data.offsetHi) && data.offsetHi > data.offsetLo) {
        off.min = data.offsetLo;
        off.max = data.offsetHi;
        off.step = Math.max((data.offsetHi - data.offsetLo) / 200, 0.01);
      }

      // Adopt the host's framing so the first wheel/drag has a real center.
      if (isFinite(data.centerU)) sliceCenterU = data.centerU;
      if (isFinite(data.centerV)) sliceCenterV = data.centerV;

      const cmPx = (data.cmPerPixel && data.cmPerPixel[0]) || 0;
      document.getElementById('sliceZoomVal').textContent =
        zoomLabel(sliceZoom) +
        (cmPx > 0 ? ' · ' + cmPx.toFixed(3) + ' cm/px' : '');
      document.getElementById('sliceSamplesNote').textContent =
        data.samples > 1 ? data.samples + '×' + data.samples + ' subpixels' : '1 point/px';
      setSliceStatus(data, 0);
    }

    /** Blit one classified band of rows as it arrives. */
    function drawSliceBand(data) {
      if (data.id !== sliceJobId || !lastSliceMeta) return;
      const canvas = document.getElementById('sliceCanvas');
      const bin = atob(data.rgbaB64);
      const rgba = new Uint8ClampedArray(bin.length);
      for (let i = 0; i < bin.length; i++) rgba[i] = bin.charCodeAt(i);
      const rows = data.y1 - data.y0;
      canvas.getContext('2d').putImageData(new ImageData(rgba, lastSliceMeta.width, rows), 0, data.y0);
      setSliceStatus(lastSliceMeta, data.progress);
    }

    function setSliceStatus(meta, progress) {
      const st = document.getElementById('sliceStatus');
      const pct = progress > 0 && progress < 1 ? ' — ' + Math.round(progress * 100) + '%' : '';
      st.textContent = String(meta.axis).toUpperCase() + ' @ ' + Number(meta.offset).toFixed(2) + ' cm — ' +
        meta.width + '×' + meta.height + pct;
      st.style.display = 'block';
    }

    /** Final legend, counts and problem report once every row is classified. */
    function finishSliceImage(data) {
      if (data.id !== sliceJobId) return;
      sliceBusy = false;
      const problems = (data.overlapCount || 0) + (data.lostCount || 0);
      const st = document.getElementById('sliceStatus');
      st.textContent = String(lastSliceMeta.axis).toUpperCase() + ' @ ' + Number(lastSliceMeta.offset).toFixed(2) + ' cm — ' +
        lastSliceMeta.width + '×' + lastSliceMeta.height +
        (problems > 0 ? ' — ' + problems + ' problem px (magenta)' : '');
      st.style.display = 'block';

      const legend = document.getElementById('sliceLegend');
      const entries = (data.legend || []).map((l, i) => ({ l: l, i: i }))
        .sort((a, b) => b.l.count - a.l.count).slice(0, 30);
      legend.innerHTML = entries.map((e) => {
        const hostRgb = data.colors && data.colors[e.i];
        const rgb = hostRgb || sliceHashColor(e.l.key);
        return '<div class="sl"><span class="sw" style="background: rgb(' + rgb.join(',') + ')"></span>' +
          '<span>' + escHtml(e.l.label) + '</span><span style="margin-left:auto; opacity:0.5">' + e.l.count.toLocaleString() + '</span></div>';
      }).join('');
      const prob = document.getElementById('sliceProblem');
      const extras = (data.warnings || lastSliceMeta.warnings || []).filter((w) =>
        w.indexOf('only indexes') >= 0 || w.indexOf('one quadrant') >= 0);
      const bits = [];
      if (problems > 0) {
        bits.push(((data.overlapCount || 0) + ' overlap / ' + (data.lostCount || 0) +
          ' lost pixels render magenta (OpenMC overlap-plot convention).'));
      }
      for (const w of extras) bits.push(w);
      prob.textContent = bits.join(' ');
    }

    // Mirror of the host palette (slice.ts hashColor) so legend swatches match.
    function sliceHashColor(key) {
      const hue = ((key * 137.508) % 360 + 360) % 360;
      const s = 0.62, v = key === 0 ? 0.35 : 0.9;
      const c = v * s, x = c * (1 - Math.abs(((hue / 60) % 2) - 1)), m = v - c;
      let rgb;
      if (hue < 60) rgb = [c, x, 0]; else if (hue < 120) rgb = [x, c, 0]; else if (hue < 180) rgb = [0, c, x];
      else if (hue < 240) rgb = [0, x, c]; else if (hue < 300) rgb = [x, 0, c]; else rgb = [c, 0, x];
      return [Math.round((rgb[0] + m) * 255), Math.round((rgb[1] + m) * 255), Math.round((rgb[2] + m) * 255)];
    }

    function showSlicePick(data) {
      const el = document.getElementById('slicePick');
      if (data.cell === null || data.cell === undefined) {
        el.innerHTML = '<span style="color:#f5c2e7">No cell claims this point (lost region).</span>';
      } else {
        const mat = data.material === 0 ? 'void'
          : (data.materialName ? escHtml(data.materialName) + ' (m' + data.material + ')' : 'm' + data.material);
        let html = 'Cell <b>' + data.cell + '</b> · ' + mat;
        if (data.point) {
          html += '<br><span style="opacity:0.65">(' + data.point.map((c) => Number(c).toFixed(2)).join(', ') + ') cm</span>';
        }
        if (data.density !== null && data.density !== undefined) {
          html += '<br>ρ = ' + data.density + (data.density < 0 ? ' g/cm³' : ' atoms/b·cm');
        }
        if (data.overlaps && data.overlaps.length > 1) {
          html += '<br><span style="color:#f5c2e7">Overlap: cells ' + data.overlaps.join(', ') + '</span>';
        }
        el.innerHTML = html;
      }
      el.style.display = 'block';
    }

    document.getElementById('view3d').addEventListener('click', () => setViewMode(false));
    document.getElementById('viewSlice').addEventListener('click', () => setViewMode(true));
    document.getElementById('sliceAxisBtns').addEventListener('click', (e) => {
      const axis = e.target && e.target.getAttribute && e.target.getAttribute('data-axis');
      if (!axis) return;
      sliceAxis = axis;
      setActive('sliceAxisBtns', 'data-axis', axis);
      requestSlice();
    });
    document.getElementById('sliceResBtns').addEventListener('click', (e) => {
      const res = e.target && e.target.getAttribute && e.target.getAttribute('data-res');
      if (!res) return;
      sliceRes = parseInt(res, 10);
      setActive('sliceResBtns', 'data-res', res);
      requestSlice();
    });
    document.getElementById('sliceSampleBtns').addEventListener('click', (e) => {
      const s = e.target && e.target.getAttribute && e.target.getAttribute('data-samples');
      if (!s) return;
      sliceSamples = parseInt(s, 10);
      setActive('sliceSampleBtns', 'data-samples', s);
      requestSlice();
    });
    document.getElementById('sliceEdges').addEventListener('change', (e) => {
      sliceEdges = !!e.target.checked;
      requestSlice();
    });
    document.getElementById('sliceZoomBtns').addEventListener('click', (e) => {
      const z = e.target && e.target.getAttribute && e.target.getAttribute('data-zoom');
      if (!z) return;
      if (z === 'fit') {
        sliceZoom = 1;
        sliceCenterU = null;
        sliceCenterV = null;
      } else {
        setSliceZoom(sliceZoom * (z === 'in' ? 1 / 1.6 : 1.6));
      }
      requestSlice();
    });

    function setSliceZoom(next) {
      // 500× in is enough to inspect a clad gap; 8× out frames vacuum around
      // a model whose fitted window sits flush on the geometry.
      sliceZoom = Math.max(0.002, Math.min(8, next));
    }

    function zoomLabel(z) {
      if (z > 0.97 && z < 1.03) return 'fit';
      if (z < 1) return (1 / z).toFixed(1) + '\u00d7 in';
      return z.toFixed(1) + '\u00d7 out';
    }

    /** Plane-space cm under a canvas pixel, using the window the host reported. */
    function slicePlaneAt(clientX, clientY) {
      if (!lastSliceMeta || !lastSliceMeta.window) return null;
      const canvas = document.getElementById('sliceCanvas');
      const rect = canvas.getBoundingClientRect();
      const fx = (clientX - rect.left) / rect.width;
      const fy = (clientY - rect.top) / rect.height;
      const w = lastSliceMeta.window; // [uMin, uMax, vMin, vMax]
      return { u: w[0] + fx * (w[1] - w[0]), v: w[3] - fy * (w[3] - w[2]) };
    }

    document.getElementById('sliceCanvas').addEventListener('wheel', (e) => {
      if (!lastSliceMeta) return;
      e.preventDefault();
      const at = slicePlaneAt(e.clientX, e.clientY);
      const before = sliceZoom;
      setSliceZoom(sliceZoom * (e.deltaY > 0 ? 1.25 : 0.8));
      // Keep the point under the cursor fixed: shift the center by the part of
      // the offset the shrinking window no longer covers.
      if (at && sliceCenterU !== null && sliceCenterV !== null && before > 0) {
        const k = sliceZoom / before;
        sliceCenterU = at.u + (sliceCenterU - at.u) * k;
        sliceCenterV = at.v + (sliceCenterV - at.v) * k;
      }
      scheduleSlice();
    }, { passive: false });

    let slicePan = null;
    document.getElementById('sliceCanvas').addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !lastSliceMeta) return;
      const at = slicePlaneAt(e.clientX, e.clientY);
      if (!at) return;
      slicePan = { startU: at.u, startV: at.v, cu: sliceCenterU, cv: sliceCenterV, moved: false };
      e.target.setPointerCapture(e.pointerId);
    });
    document.getElementById('sliceCanvas').addEventListener('pointermove', (e) => {
      if (!slicePan || slicePan.cu === null || slicePan.cv === null) return;
      const at = slicePlaneAt(e.clientX, e.clientY);
      if (!at) return;
      const du = at.u - slicePan.startU;
      const dv = at.v - slicePan.startV;
      if (!slicePan.moved && Math.abs(du) + Math.abs(dv) < (lastSliceMeta.cmPerPixel ? lastSliceMeta.cmPerPixel[0] * 3 : 0.01)) return;
      slicePan.moved = true;
      document.getElementById('sliceCanvas').classList.add('panning');
      sliceCenterU = slicePan.cu - du;
      sliceCenterV = slicePan.cv - dv;
      scheduleSlice();
    });
    document.getElementById('sliceCanvas').addEventListener('pointerup', (e) => {
      const wasDrag = slicePan && slicePan.moved;
      slicePan = null;
      document.getElementById('sliceCanvas').classList.remove('panning');
      if (wasDrag) requestSlice();
    });
    document.getElementById('sliceColorBtns').addEventListener('click', (e) => {
      const c = e.target && e.target.getAttribute && e.target.getAttribute('data-color');
      if (!c) return;
      sliceColorBy = c;
      setActive('sliceColorBtns', 'data-color', c);
      requestSlice();
    });
    document.getElementById('sliceOffset').addEventListener('input', (e) => {
      sliceOffset = parseFloat(e.target.value);
      document.getElementById('sliceOffVal').textContent = sliceOffset.toFixed(2) + ' cm';
      scheduleSlice();
    });
    document.getElementById('sliceCanvas').addEventListener('click', (e) => {
      if (!lastSliceMeta) return;
      const canvas = document.getElementById('sliceCanvas');
      const rect = canvas.getBoundingClientRect();
      const px = Math.floor(((e.clientX - rect.left) / rect.width) * lastSliceMeta.width);
      const py = Math.floor(((e.clientY - rect.top) / rect.height) * lastSliceMeta.height);
      vscode.postMessage(sliceViewMsg({ type: 'sliceIdentify', px: px, py: py }));
    });
    document.getElementById('sliceExport').addEventListener('click', () => {
      const canvas = document.getElementById('sliceCanvas');
      if (!lastSliceMeta) return;
      vscode.postMessage({ type: 'sliceSavePng', dataUrl: canvas.toDataURL('image/png'), axis: sliceAxis, offset: sliceOffset });
    });

    let meshOverlayGroup = null;
    function applyMeshOverlay(mesh) {
      if (meshOverlayGroup) { scene.remove(meshOverlayGroup); meshOverlayGroup = null; }
      const { nx, ny, values } = mesh;
      const max = Math.max(...values.slice(0, nx * ny), 1e-30);
      const canvas = document.createElement('canvas');
      canvas.width = nx; canvas.height = ny;
      const ctx = canvas.getContext('2d');
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const v = values[i + nx * j] / max;
          const hue = (1 - v) * 240;
          ctx.fillStyle = 'hsl(' + hue + ',70%,45%)';
          ctx.fillRect(i, ny - 1 - j, 1, 1);
        }
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.magFilter = THREE.NearestFilter;
      const geo = new THREE.PlaneGeometry(Math.max(nx, ny) * 0.5, Math.max(nx, ny) * 0.5);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
      const plane = new THREE.Mesh(geo, mat);
      plane.rotation.x = -Math.PI / 2;
      plane.position.y = 0.05;
      meshOverlayGroup = new THREE.Group();
      meshOverlayGroup.add(plane);
      scene.add(meshOverlayGroup);
    }

    vscode.postMessage({ type: 'ready' });
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

export type { CylinderSpec };
