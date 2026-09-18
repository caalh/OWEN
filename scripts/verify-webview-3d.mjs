// Executes the REAL 3D preview webview in headless Chrome (software WebGL) and
// asserts on runtime behaviour the parse-only webviewHtml.test.ts cannot see:
//
//   1. the module script initialises without throwing (a TDZ / escaping bug
//      here leaves the panel controls visible and the canvas blank forever);
//   2. a posted scene renders — layer rows appear and sampled pixels differ
//      from the background;
//   3. scroll-zooming into a tall assembly never blanks the view (stock
//      OrbitControls dolly; the camera flies THROUGH solids instead of
//      rendering from inside one — insideSolid stays false, pixels lit);
//   4. a full-core-sized scene (>= HEAVY_PRIMITIVES) rebuilds without MSAA and
//      still draws;
//   5. a forced WebGL context loss (WEBGL_lose_context) is recovered: a fresh
//      canvas replaces the dead one and geometry is back on screen.
//
// Run: npm run verify:webview-3d   (tsc -p . first so out/src is current)
// Puppeteer is resolved from this repo if installed, else from the sibling
// reactor-monte-carlo-guide checkout, which already ships a Chromium.

import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Module from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const require = createRequire(import.meta.url);

// ---- vscode stub: webview.ts only touches vscode.* inside functions we never call.
const vscodeStub = new Proxy({}, {
  get: (_t, key) => {
    if (key === '__esModule') return true;
    return new Proxy(function () {}, { get: () => () => undefined, apply: () => undefined });
  },
});
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'vscode') return vscodeStub;
  return origLoad.call(this, request, ...rest);
};

const compiled = join(repo, 'out', 'src', 'preview', 'webview.js');
if (!existsSync(compiled)) {
  console.error(`missing ${compiled} — run "npx tsc -p ." first`);
  process.exit(2);
}
const { buildPreviewHtml } = require(compiled);

// ---- puppeteer
function loadPuppeteer() {
  try { return require('puppeteer'); } catch { /* fall through */ }
  const sibling = resolve(repo, '..', 'reactor-monte-carlo-guide', 'package.json');
  if (existsSync(sibling)) {
    try { return createRequire(sibling)('puppeteer'); } catch { /* fall through */ }
  }
  return null;
}
const puppeteer = loadPuppeteer();
if (!puppeteer) {
  console.error('puppeteer not found here or in ../reactor-monte-carlo-guide — install it to run this check');
  process.exit(2);
}

// ---- HTML: strip CSP, stub acquireVsCodeApi, point the import map at /three
let html = buildPreviewHtml({ cspSource: 'http://localhost' }, '/three');
html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
html = html.replace(
  '<head>',
  '<head><script>window.acquireVsCodeApi = () => ({ postMessage() {}, getState() {}, setState() {} });</script>',
);

const vendor = join(repo, 'media', 'vendor', 'three');
const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }
  if (url.startsWith('/three/')) {
    const file = join(vendor, url.slice('/three/'.length));
    if (existsSync(file)) {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      return res.end(readFileSync(file));
    }
  }
  if (url === '/favicon.ico') { res.writeHead(204); return res.end(); }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// ---- scenes
function assemblyScene() {
  const pitch = 1.26, n = 17, h = 365.76;
  const cyls = [];
  const guide = new Set(['3,5', '5,3', '13,5', '11,3', '8,8', '3,11', '5,13', '13,11', '11,13']);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = (i - (n - 1) / 2) * pitch, y = (j - (n - 1) / 2) * pitch;
    if (guide.has(`${i},${j}`)) {
      cyls.push({ x, y, z: 0, radius: 0.60198, innerRadius: 0.56134, height: h, component: 'guide_tube', material: 'Zircaloy', color: '#89b4fa', opacity: 1 });
      continue;
    }
    cyls.push({ x, y, z: 0, radius: 0.39218, height: h, component: 'fuel', material: 'UO2', color: '#f38ba8', opacity: 1 });
    cyls.push({ x, y, z: 0, radius: 0.40005, innerRadius: 0.39218, height: h, component: 'gap', material: 'He', color: '#cdd6f4', opacity: 0.4 });
    cyls.push({ x, y, z: 0, radius: 0.4572, innerRadius: 0.40005, height: h, component: 'clad', material: 'Zircaloy', color: '#a6adc8', opacity: 1 });
  }
  return wrap(cyls, 'mcnp', 'layers', n * n);
}
function heavyScene(count) {
  const side = Math.ceil(Math.sqrt(count)), pitch = 1.26, h = 365.76;
  const cyls = [];
  for (let i = 0; i < side && cyls.length < count; i++) for (let j = 0; j < side && cyls.length < count; j++) {
    cyls.push({ x: (i - side / 2) * pitch, y: (j - side / 2) * pitch, z: 0, radius: 0.41, height: h, component: 'fuel', material: 'UO2', color: '#f38ba8', opacity: 1 });
  }
  return wrap(cyls, 'openmc', 'disc', cyls.length);
}
function wrap(cyls, language, detail, pins) {
  const comps = new Map(), mats = new Map();
  for (const c of cyls) {
    comps.set(c.component, (comps.get(c.component) || 0) + 1);
    mats.set(c.material, (mats.get(c.material) || 0) + 1);
  }
  return {
    language, cylinders: cyls,
    components: [...comps].map(([id, count]) => ({ id, label: id, color: '#ffffff', count })),
    materials: [...mats].map(([name, count]) => ({ name, color: '#ffffff', count })),
    axialLayers: [], overlays: [], warnings: [], notes: [],
    primitiveCount: cyls.length,
    fidelity: { detail, axial: false, autoDetail: detail, totalPins: pins, hasAxial: true },
  };
}

// ---- drive the page
const failures = [];
function check(cond, msg) { if (cond) console.log(`  ok   ${msg}`); else { console.log(`  FAIL ${msg}`); failures.push(msg); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
try {
  const page = await browser.newPage();
  // Software WebGL: keep the drawing buffer small so each frame is cheap, but
  // use a non-integer DPR so "keeps native pixel ratio" is a real assertion.
  const DPR = 1.5;
  await page.setViewport({ width: 720, height: 480, deviceScaleFactor: DPR });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/favicon/.test(m.text())) return; // browser asks for /favicon.ico; irrelevant
    pageErrors.push(`console.error: ${m.text()}`);
  });

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__owenPreviewDebug === 'function', { timeout: 10000 })
    .catch(() => {});
  const booted = await page.evaluate(() => typeof window.__owenPreviewDebug === 'function');

  console.log('\n[1] module startup');
  check(booted, 'webview module initialised (debug hook present)');
  check(pageErrors.length === 0, `no page errors during startup${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);
  if (!booted) throw new Error('module did not initialise; aborting');

  const dbg = () => page.evaluate(() => window.__owenPreviewDebug());
  const sample = () => page.evaluate(() => window.__owenPreviewSample(16));
  const post = (scene) => page.evaluate((s) => window.postMessage({ type: 'scene', scene: s }, '*'), scene);

  console.log('\n[2] 17x17 assembly renders');
  await post(assemblyScene());
  await sleep(600);
  let d = await dbg(), s = await sample();
  const rows = await page.evaluate(() => document.querySelectorAll('#panel .row').length);
  const emptyHidden = await page.evaluate(() => getComputedStyle(document.getElementById('empty')).display === 'none');
  check(d.groups > 0, `instanced groups created (${d.groups})`);
  check(rows > 0, `layer rows listed in panel (${rows})`);
  check(emptyHidden, '"no geometry" overlay hidden');
  check(d.antialias === true, 'small scene keeps MSAA (antialias on)');
  check(Math.abs(d.pixelRatio - DPR) < 1e-6, `small scene keeps native pixel ratio (${d.pixelRatio} == ${DPR})`);
  check(s.lit > 0, `geometry visible on screen (${s.lit}/${s.total} sampled pixels lit)`);
  check(d.glLost === false && d.contextLost === false, 'WebGL context alive');

  console.log('\n[3] surface-relative zoom is gradual and never renders inside a solid');
  // Drag/orbit are 100% stock OrbitControls. The wheel is OWEN's own
  // surface-relative zoom: each tick covers the stock fraction of the
  // distance to the surface under the cursor (not to the orbit target,
  // which on a full core is metres past the first pin — that made one
  // flick leap from vessel view to a single cell). The camera tunnels
  // through thin solids and is never left inside an opaque one.
  const canvasRect = () => page.evaluate(() => { const r = document.querySelector('#stage canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const r = await canvasRect();
  await page.mouse.move(r.x + r.w * 0.5, r.y + r.h * 0.5);
  const before = await dbg();
  const distBefore = before.distance;
  const targetBefore = before.target;
  // One tick first: the increment must be the stock OrbitControls step
  // (0.95^(1000/100) ≈ 0.60 of the distance), not a teleport into a cell.
  await page.mouse.wheel({ deltaY: -1000 });
  await sleep(400);
  d = await dbg();
  const oneTick = d.distance / distBefore;
  check(oneTick > 0.5 && oneTick < 0.75, `single wheel tick is gradual (${distBefore.toFixed(0)} -> ${d.distance.toFixed(0)} cm, x${oneTick.toFixed(2)})`);
  for (let i = 0; i < 17; i++) { await page.mouse.wheel({ deltaY: -1000 }); }
  await sleep(700);
  d = await dbg(); s = await sample();
  check(d.enableZoom === false, 'stock wheel dolly disabled — OWEN surface-relative zoom owns the wheel');
  check(d.distance < distBefore * 0.05, `deep zoom reaches the model interior (${distBefore.toFixed(1)} -> ${d.distance.toFixed(2)} cm)`);
  check(s.lit > 0, `geometry still visible at max zoom (${s.lit}/${s.total} sampled pixels lit)`);
  check(d.insideSolid === false, 'camera is not inside an opaque solid');
  const tgt = d.target;
  const targetMoved = targetBefore && tgt
    ? Math.hypot(tgt[0] - targetBefore[0], tgt[1] - targetBefore[1], tgt[2] - targetBefore[2])
    : Infinity;
  check(targetMoved < 1e-3, `orbit target unchanged after zoom (moved ${targetMoved.toExponential(1)} cm)`);
  check(d.glLost === false && d.contextLost === false && d.canvases === 1, 'context alive after deep zoom-in, one canvas');
  // Orbit drag while deep inside the lattice: the sweep can carry the camera
  // across pins; it must pop through them, never render from inside one.
  await page.mouse.move(r.x + r.w * 0.5, r.y + r.h * 0.5);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(r.x + r.w * (0.5 + i * 0.03), r.y + r.h * 0.5); }
  await page.mouse.up();
  await sleep(500);
  d = await dbg(); s = await sample();
  check(d.insideSolid === false, 'camera not inside a solid after a deep orbit drag');
  check(s.lit > 0, `geometry visible after the deep orbit drag (${s.lit}/${s.total} lit)`);
  const distZoomed = d.distance;
  // A few real wheel ticks, not 18 — each Puppeteer deltaY=1000 is ~1.67× per
  // tick, zoom-in spent its 18 reaching the interior, so 18 outs would fling
  // the camera to the maxDistance cap with the assembly a sub-pixel speck.
  // Six is enough to prove zoom-out works.
  for (let i = 0; i < 6; i++) { await page.mouse.wheel({ deltaY: 1000 }); }
  await sleep(700);
  d = await dbg(); s = await sample();
  check(d.distance > distZoomed * 1.15, `zoom-out returns (${distZoomed.toFixed(1)} -> ${d.distance.toFixed(1)} cm)`);
  check(s.lit > 0, `geometry visible again after the zoom cycle (${s.lit}/${s.total} lit)`);
  check(pageErrors.length === 0, `no page errors during zoom${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);

  console.log('\n[4] full-core-sized scene keeps full quality');
  const HEAVY = 12500;
  await post(heavyScene(HEAVY));
  await sleep(2500);
  d = await dbg(); s = await sample();
  check(d.groups > 0 && d.instances >= HEAVY, `heavy scene built (${d.instances} instances)`);
  check(d.antialias === true, 'MSAA stays ON for heavy scene (no preemptive quality drop)');
  check(Math.abs(d.pixelRatio - DPR) < 1e-6, `pixel ratio native on heavy scene (${d.pixelRatio})`);
  check(d.canvases === 1, 'exactly one canvas');
  check(s.lit > 0, `heavy geometry visible (${s.lit}/${s.total} lit)`);
  // The regression that motivated surface-relative zoom: on a core-sized
  // scene one wheel tick used to leap metres (a stock-dolly fraction of the
  // distance to the far-away target) and land on a single random pin.
  const dh0 = d.distance;
  await page.mouse.move(r.x + r.w * 0.5, r.y + r.h * 0.5);
  await page.mouse.wheel({ deltaY: -1000 });
  await sleep(400);
  d = await dbg();
  const hTick = d.distance / dh0;
  check(hTick > 0.5 && hTick < 0.97, `single tick on a core-sized scene is gradual (${dh0.toFixed(0)} -> ${d.distance.toFixed(0)} cm, x${hTick.toFixed(2)})`);
  check(pageErrors.length === 0, `no page errors on heavy scene${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);

  console.log('\n[5] forced WebGL context loss is recovered');
  const errsBefore = pageErrors.length;
  const lost = await page.evaluate(() => {
    const c = document.querySelector('#stage canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_lose_context');
    if (!ext) return 'no WEBGL_lose_context extension';
    ext.loseContext();
    return 'lost';
  });
  check(lost === 'lost', `context loss forced (${lost})`);
  await sleep(1200);
  d = await dbg(); s = await sample();
  check(d.contextLost === false && d.replacingRenderer === false, 'recovery completed (contextLost=false)');
  check(d.canvases === 1 && d.glLost === false, 'fresh canvas with a live context');
  check(d.groups > 0, `scene rebuilt (${d.groups} groups)`);
  check(d.antialias === false, 'first real loss steps down to MSAA-off');
  check(Math.abs(d.pixelRatio - DPR) < 1e-6, `pixels stay native after first loss (${d.pixelRatio})`);
  check(s.lit > 0, `geometry visible after recovery (${s.lit}/${s.total} lit)`);
  const overlayHidden = await page.evaluate(() => document.getElementById('gpuLost').style.display === 'none');
  check(overlayHidden, 'recovery overlay hidden again');
  // three.js logs a console.error when the browser refuses a context in the
  // instant after a GPU reset; the retry/backoff path exists for exactly that,
  // so tolerate that one line here while still failing on any thrown error.
  const recoveryErrs = pageErrors.slice(errsBefore).filter((m) => !/A WebGL context could not be created/.test(m));
  check(recoveryErrs.length === 0, `no uncaught errors during recovery${recoveryErrs.length ? ': ' + recoveryErrs.join(' | ') : ''}`);
} catch (err) {
  failures.push(`harness error: ${err && err.message || err}`);
  console.error(err);
} finally {
  await browser.close();
  server.close();
}

console.log(failures.length ? `\n${failures.length} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
