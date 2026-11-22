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
//      canvas replaces the dead one and geometry is back on screen;
//   6. per-cell controls: hiding the cell under the cursor lets the pick reach
//      the one behind it, see-through draws it in a ghost mesh that cannot be
//      picked, focus and the filter work, and a click opens the action bar.
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
const { buildScene } = require(join(repo, 'out', 'src', 'preview', 'extractor.js'));

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
// The assembly with deck cells stamped on it, plus a can no cell owns.
function cellScene() {
  const sc = assemblyScene();
  const cellOf = { fuel: '1', gap: '2', clad: '3', guide_tube: '10' };
  for (const c of sc.cylinders) { c.cell = cellOf[c.component]; c.universe = c.component === 'guide_tube' ? '2' : '1'; }
  sc.cylinders.push({ x: 0, y: 0, z: 0, radius: 12, innerRadius: 11.5, height: 380, component: 'vessel', material: 'SS304', color: '#6c7086', opacity: 0.3 });
  return wrap(sc.cylinders, 'mcnp', 'layers', 289);
}
// A 1737.5 km moon, a 1 km world sphere on its pole, and a 10 m boulder 50 m
// up: seven decades between the scene and the thing being looked at. Stands
// in for Frank Helk's lunar-crater deck (Nov 2026), whose 30 m crater went
// black on zoom and swung by kilometres on a one-pixel drag.
const MOON_DECK = `moon-scale preview check
1  1 -1.5  -10 -11      imp:p=1  $ ground inside the 1 km world
2  1 -1.5  -12          imp:p=1  $ 10 m boulder, 50 m above the pole
3  0       10 -11 12    imp:p=1  $ space inside the world
4  1 -1.5  -10 11       imp:p=1  $ the rest of the moon
5  0       11 10        imp:p=0  $ graveyard

10 sz -173750000 173750000
11 so 100000
12 sz 5000 1000

mode p
m1 8016 -0.46 14000 -0.54
sdef pos 0 0 20000 par=p erg=1
nps 10
`;
function wrap(cyls, language, detail, pins) {
  const comps = new Map(), mats = new Map(), cells = new Map();
  for (const c of cyls) {
    comps.set(c.component, (comps.get(c.component) || 0) + 1);
    mats.set(c.material, (mats.get(c.material) || 0) + 1);
    if (c.cell) {
      const e = cells.get(c.cell) || { id: c.cell, universe: c.universe, material: c.material, color: c.color, count: 0 };
      e.count++;
      cells.set(c.cell, e);
    }
  }
  return {
    language, cylinders: cyls,
    components: [...comps].map(([id, count]) => ({ id, label: id, color: '#ffffff', count })),
    materials: [...mats].map(([name, count]) => ({ name, color: '#ffffff', count })),
    cells: [...cells.values()],
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

  console.log('\n[6] per-cell solid / see-through / hidden');
  const errs6 = pageErrors.length;
  await post(cellScene());
  await sleep(800);
  const cells = () => page.evaluate(() => window.__owenPreviewCells());
  const setCell = (id, st) => page.evaluate((a, b) => window.__owenPreviewSetCell(a, b), id, st);
  const rc = await canvasRect();
  const cx = rc.x + rc.w * 0.5, cy = rc.y + rc.h * 0.5;
  const pickCell = () => page.evaluate((x, y) => window.__owenPreviewPickCell(x, y), cx, cy);
  let cs = await cells();
  const ids = cs.rows.map((x) => x.id).sort();
  const sectionShown = await page.evaluate(() => getComputedStyle(document.getElementById('cellsSection')).display !== 'none');
  check(sectionShown, 'Cells section shown for a scene with cells');
  check(['', '1', '10', '2', '3'].every((id) => ids.includes(id)), `cell rows ${JSON.stringify(ids)} include 1 2 3 10 and the unowned bucket`);
  check(cs.listed === cs.rows.length, `every cell listed (${cs.listed})`);
  check(cs.ghost === 0 && cs.off === 0, 'everything starts solid');

  const front = await pickCell();
  check(typeof front === 'string' && front !== '', `a cell is under the screen centre (${front})`);
  // Clad hidden over gap covers the same pixels, so compare colour, not coverage.
  const centreShot = async () => { await sample(); return page.screenshot({ clip: { x: cx - 30, y: cy - 30, width: 60, height: 60 } }); };
  const shotBefore = await centreShot();
  await setCell(front, 'hidden');
  await sleep(200);
  const behind = await pickCell();
  cs = await cells();
  const hiddenCount = cs.rows.find((x) => x.id === front).count;
  check(behind !== front, `hiding cell ${front} lets the pick reach what is behind it (${behind})`);
  check(cs.off === hiddenCount, `hidden cell switched off (${cs.off} == ${hiddenCount})`);
  const shotHidden = await centreShot();
  check(!shotBefore.equals(shotHidden), 'the picture at the screen centre changed when the cell was hidden');

  await setCell(front, 'ghost');
  await sleep(200);
  cs = await cells();
  check(cs.ghost === hiddenCount && cs.ghostMeshes > 0, `see-through cell drawn in a ghost mesh (${cs.ghost} instances, ${cs.ghostMeshes} mesh)`);
  check((await pickCell()) !== front, 'a see-through cell cannot be picked');
  check((await sample()).lit > 0, 'geometry still on screen with a see-through cell');

  await setCell(front, 'solid');
  await sleep(200);
  cs = await cells();
  check(cs.ghost === 0 && cs.off === 0 && cs.ghostMeshes === 0, 'solid again: no ghosts, nothing off');
  check((await pickCell()) === front, `cell ${front} pickable again`);

  await page.evaluate(() => window.__owenPreviewFocusCell('1', false));
  cs = await cells();
  const fuel = cs.rows.find((x) => x.id === '1').count;
  check(cs.solid === fuel && cs.off === 0, `focus on cell 1: only its ${fuel} pins solid, the rest see-through (${cs.solid} solid, ${cs.ghost} ghost)`);
  await page.evaluate(() => window.__owenPreviewFocusCell('1', true));
  cs = await cells();
  check(cs.ghost === 0 && cs.off === 0, 'focus again undoes it');

  await page.type('#cellSearch', 'zircaloy');
  cs = await cells();
  check(cs.listed === 2, `filter "zircaloy" lists cells 3 and 10 (${cs.listed})`);
  await page.click('#cellHide');
  cs = await cells();
  check(cs.rows.filter((x) => x.state === 'hidden').map((x) => x.id).sort().join(',') === '10,3', 'Hide applies to the listed cells only');
  await page.click('#cellSolid');
  await page.evaluate(() => { const s = document.getElementById('cellSearch'); s.value = ''; s.dispatchEvent(new Event('input')); });

  await page.mouse.click(cx, cy);
  await sleep(200);
  const bar = await page.evaluate(() => {
    const b = document.getElementById('cellActions');
    return { shown: getComputedStyle(b).display !== 'none', text: b.textContent };
  });
  check(bar.shown && bar.text.includes('Cell ' + front), `click opens the action bar for cell ${front} ("${bar.text.slice(0, 40)}…")`);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#cellActions button')].find((x) => x.textContent === 'Hide');
    if (b) b.click();
  });
  cs = await cells();
  check(cs.rows.find((x) => x.id === front).state === 'hidden', 'the action bar Hide button hides that cell');
  const barAfter = await page.evaluate(() => document.getElementById('cellActions').textContent);
  check(barAfter.includes('Solid'), 'the bar stays up with a Solid button to bring the cell back');
  const cellErrs = pageErrors.slice(errs6);
  check(cellErrs.length === 0, `no page errors in the per-cell section${cellErrs.length ? ': ' + cellErrs.join(' | ') : ''}`);

  console.log('\n[7] moon-scale scene: zoom to a 10 m boulder, orbit, visible volume');
  const errs7 = pageErrors.length;
  await post(buildScene(MOON_DECK, 'mcnp'));
  await sleep(800);
  const BOULDER = [0, 0, 5000], BOULDER_R = 1000;
  const project = (p) => page.evaluate((x, y, z) => window.__owenPreviewProject(x, y, z), p[0], p[1], p[2]);
  const camToBoulder = (dd) => Math.hypot(dd.cam[0] - BOULDER[0], dd.cam[1] - BOULDER[2], dd.cam[2] - BOULDER[1]);
  d = await dbg();
  const startDist = camToBoulder(d);
  check(d.viewRadius > 1e8, `auto bounds frame the whole moon (radius ${d.viewRadius.toExponential(2)} cm)`);
  // Keep the cursor on the boulder, as a user would. Before zoom-to-cursor
  // the view re-aimed at the moon's centre every tick and the boulder left
  // the canvas within two. Translucent shells on the way (the world sphere)
  // decelerate the zoom on purpose, so allow plenty of ticks.
  let worstDrift = 0, offCanvas = false;
  for (let i = 0; i < 160; i++) {
    const at = await project(BOULDER);
    if (!at.inFront || at.x < r.x || at.x > r.x + r.w || at.y < r.y || at.y > r.y + r.h) { offCanvas = true; break; }
    await page.mouse.move(at.x, at.y);
    await page.mouse.wheel({ deltaY: -1000 });
    await sleep(40);
    const after = await project(BOULDER);
    worstDrift = Math.max(worstDrift, Math.hypot(after.x - at.x, after.y - at.y));
    if (camToBoulder(await dbg()) < 8 * BOULDER_R) break;
  }
  await sleep(500);
  d = await dbg(); s = await sample();
  const near7 = camToBoulder(d);
  check(!offCanvas, `the boulder never leaves the canvas while zooming at it (worst one-tick drift ${worstDrift.toFixed(1)} px)`);
  check(near7 < 20 * BOULDER_R, `wheel reaches the boulder from orbit (${startDist.toExponential(2)} -> ${near7.toFixed(0)} cm)`);
  check(d.near < (near7 - BOULDER_R) / 10, `near plane sits well inside the gap to the boulder (near ${d.near.toFixed(2)} cm, gap ${(near7 - BOULDER_R).toFixed(0)} cm)`);
  check(s.lit > 0, `boulder close-up is not a black screen (${s.lit}/${s.total} lit)`);
  const atB = await project(BOULDER);
  const pickB = await page.evaluate((x, y) => window.__owenPreviewPickCell(x, y), atB.x, atB.y);
  check(pickB === '2', `the boulder (cell 2) is under the cursor after the zoom (${pickB})`);
  const pivotDist = d.distance;
  check(pivotDist < 20 * near7, `orbit pivot followed the zoom (camera-to-target ${pivotDist.toFixed(0)} cm, not the moon's centre)`);
  const camBefore = d.cam;
  await page.mouse.move(atB.x, atB.y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(atB.x + i * 2, atB.y);
  await page.mouse.up();
  await sleep(600);
  d = await dbg();
  const swing = Math.hypot(d.cam[0] - camBefore[0], d.cam[1] - camBefore[1], d.cam[2] - camBefore[2]);
  check(swing < 0.5 * near7, `a 10 px orbit drag moves the camera ${swing.toFixed(0)} cm, not kilometres`);
  const atAfter = await project(BOULDER);
  check(atAfter.inFront && atAfter.x > r.x && atAfter.x < r.x + r.w && atAfter.y > r.y && atAfter.y < r.y + r.h,
    'the boulder is still on screen after the drag');
  const beforeVoid = camToBoulder(d);
  await page.mouse.move(r.x + 4, r.y + 4);
  await page.mouse.wheel({ deltaY: -100 });
  await sleep(300);
  d = await dbg(); s = await sample();
  const voidMove = Math.abs(camToBoulder(d) - beforeVoid);
  check(voidMove < 0.5 * beforeVoid, `a wheel tick at the screen corner stays local (moved ${voidMove.toFixed(0)} cm of ${beforeVoid.toFixed(0)})`);
  check(s.lit > 0, `still not black after the corner tick (${s.lit}/${s.total} lit)`);

  const setBox = (vals) => page.evaluate((v) => {
    const ids = ['boxXlo', 'boxXhi', 'boxYlo', 'boxYhi', 'boxZlo', 'boxZhi'];
    ids.forEach((id, i) => { document.getElementById(id).value = String(v[i]); });
    document.getElementById(ids[5]).dispatchEvent(new Event('change'));
  }, vals);
  await page.click('#boxAuto');
  await setBox([-20000, 20000, -20000, 20000, -1000, 7000]);
  await sleep(400);
  d = await dbg(); s = await sample();
  check(d.box && d.globalPlanes === 6, `visible volume applied as six renderer clip planes (${d.globalPlanes})`);
  check(d.viewRadius === 20000, `camera framed the volume, not the moon (radius ${d.viewRadius} cm)`);
  check(d.distance < 1e5, `camera sits near the volume (${d.distance.toFixed(0)} cm from its centre)`);
  const clipped = (p) => page.evaluate((x, y, z) => window.__owenPreviewClipped(x, y, z), p[0], p[1], p[2]);
  check(await clipped([0, 0, -50000]) === true, 'a point below the volume is cut away');
  check(await clipped(BOULDER) === false, 'the boulder inside the volume is kept');
  check(s.lit > 0, `the framed volume draws (${s.lit}/${s.total} lit)`);
  const badBefore = d.box;
  await setBox([-20000, 20000, 500, -500, -1000, 7000]);
  const note = await page.evaluate(() => document.getElementById('boxNote').textContent);
  d = await dbg();
  check(/lower Y/.test(note) && d.box && d.box.minZ === badBefore.minZ, `an inverted Y range is refused with a message ("${note}")`);
  await page.click('#boxAuto');
  await sleep(300);
  d = await dbg();
  check(d.box === null && d.globalPlanes === 0 && d.viewRadius > 1e8, 'ticking Auto removes the limits and frames everything again');
  const moonErrs = pageErrors.slice(errs7);
  check(moonErrs.length === 0, `no page errors in the moon-scale section${moonErrs.length ? ': ' + moonErrs.join(' | ') : ''}`);

  console.log('\n[8] 3D slices: reverse, exact position, tilt, wedge cutaway');
  const errs8 = pageErrors.length;
  await post(assemblyScene());
  await sleep(600);
  const clipState = () => page.evaluate(() => window.__owenPreviewClipState());
  const typeInto = (id, v) => page.evaluate((i, val) => {
    const el = document.getElementById(i);
    el.value = String(val);
    el.dispatchEvent(new Event('change'));
  }, id, v);
  await page.click('#clipOn');
  let cl = await clipState();
  check(cl.axes[0].enabled && cl.materialPlanes === 1, 'Slice (X) adds one clip plane');
  check(Math.abs(cl.axes[0].offset) < 1e-9, `X slice starts at the centre (${cl.axes[0].offset})`);
  check(await clipped([5, 0, 0]) === true && await clipped([-5, 0, 0]) === false, 'default X slice removes the +x side');
  check(await page.evaluate(() => getComputedStyle(document.getElementById('clipXMore')).display !== 'none'),
    'position and tilt fields appear once the slice is on');
  await page.click('#clipXRev');
  check(await clipped([5, 0, 0]) === false && await clipped([-5, 0, 0]) === true, 'reverse removes the -x side instead');
  await typeInto('clipXNum', 3.25);
  cl = await clipState();
  check(cl.axes[0].offset === 3.25, `a typed position is used exactly (${cl.axes[0].offset})`);
  check(await clipped([3.2, 0, 0]) === true && await clipped([3.3, 0, 0]) === false, 'the cut sits at x = 3.25 cm');
  await typeInto('clipXTiltBNum', 120);
  cl = await clipState();
  const nrm = cl.axes[0].normal;
  check(cl.axes[0].tiltB === 90, `tilt is limited to ±90° (${cl.axes[0].tiltB})`);
  check(Math.abs(nrm[0]) < 1e-9 && Math.abs(nrm[1] - 1) < 1e-9 && Math.abs(nrm[2]) < 1e-9,
    `a reversed X slice tilted 90° about Z faces +y (${nrm.map((v) => v.toFixed(3)).join(', ')})`);
  await typeInto('clipXTiltBNum', 0);
  await typeInto('clipXNum', 0);
  await page.click('#clipXRev');
  await page.click('#clipYOn');
  cl = await clipState();
  check(cl.materialPlanes === 2 && cl.materialIntersection === false, 'two slices, union mode');
  check(await clipped([5, -5, 0]) === true, 'union: the X slice alone removes (5, -5)');
  await page.click('#clipWedge');
  cl = await clipState();
  check(cl.materialIntersection === true, 'wedge mode switches the materials to clipIntersection');
  check(await clipped([5, 5, 0]) === true && await clipped([5, -5, 0]) === false && await clipped([-5, 5, 0]) === false,
    'wedge: only the +x +y quarter is cut away');
  await typeInto('clipXTiltBNum', -70);
  const polar = (deg) => [5 * Math.cos(deg * Math.PI / 180), 5 * Math.sin(deg * Math.PI / 180), 0];
  check(await clipped(polar(10)) === true && await clipped(polar(30)) === false && await clipped(polar(-10)) === false,
    'tilting X by -70° about Z narrows the cutaway to a 20° wedge');
  s = await sample();
  check(s.lit > 0, `the wedge-cut assembly still draws (${s.lit}/${s.total} lit)`);
  const sliceErrs = pageErrors.slice(errs8);
  check(sliceErrs.length === 0, `no page errors in the slice section${sliceErrs.length ? ': ' + sliceErrs.join(' | ') : ''}`);

  // Until 1.5.1 deck (x, y, z) went to three (x, z, y), a reflection: every
  // view was a mirror image, and Frank Helk's C-ring opened the wrong way.
  console.log('\n[9] handedness: the view is the deck, not its mirror image');
  const errs9 = pageErrors.length;
  for (const id of ['clipWedge', 'clipOn', 'clipYOn', 'clipZOn']) {
    if (await page.evaluate((i) => document.getElementById(i).checked, id)) await page.click('#' + id);
  }
  // Cube vertices sit at deck y in [-25, -15] while the item's own origin is
  // (0, 0, 0), so a wrong sign on the vertex offset puts it at +y.
  const cubeV = [];
  for (const z of [-5, 5]) for (const y of [-25, -15]) for (const x of [-5, 5]) cubeV.push(x, y, z);
  const cubeF = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  await post(wrap([
    { x: 20, y: 0, z: 0, radius: 3, height: 6, component: 'px', material: 'A', color: '#f38ba8', opacity: 1, cell: '91' },
    { x: 0, y: 0, z: 20, radius: 3, height: 6, component: 'pz', material: 'B', color: '#a6e3a1', opacity: 1, cell: '92' },
    { shape: 'arc', x: 0, y: 0, z: 0, radius: 20, innerRadius: 15, thetaStart: 80, thetaLength: 20, height: 6, component: 'arc', material: 'C', color: '#89b4fa', opacity: 1, cell: '93' },
    { shape: 'polyhedron', x: 0, y: 0, z: 0, radius: 10, height: 10, verts: cubeV, faces: cubeF, component: 'poly', material: 'D', color: '#f9e2af', opacity: 1, cell: '94' },
  ], 'mcnp', 'layers', 4));
  await sleep(600);
  const lookAt = (e, t) => page.evaluate((a, b) => window.__owenPreviewLookAt(a[0], a[1], a[2], b[0], b[1], b[2]), e, t);
  const pickCellAt = (p) => page.evaluate((x, y) => window.__owenPreviewPickCell(x, y), p.x, p.y);
  await lookAt([0, -150, 0], [0, 0, 0]);
  await sleep(200);
  const o9 = await project([0, 0, 0]), px9 = await project([20, 0, 0]), pz9 = await project([0, 0, 20]);
  check(px9.x > o9.x + 20, `seen from -y with z up, +x is on the right (origin ${o9.x.toFixed(0)} px, +x ${px9.x.toFixed(0)} px)`);
  check(pz9.y < o9.y - 20, `and +z is up (origin ${o9.y.toFixed(0)} px, +z ${pz9.y.toFixed(0)} px)`);
  check(await pickCellAt(px9) === '91' && await pickCellAt(pz9) === '92', 'the +x and +z cylinders are drawn where the deck puts them');
  await lookAt([150, 0, 0], [0, 0, 0]);
  await sleep(200);
  const o9b = await project([0, 0, 0]), py9 = await project([0, 17.5, 0]), my9 = await project([0, -20, 0]);
  check(py9.x > o9b.x + 20, `seen from +x with z up, +y is on the right (origin ${o9b.x.toFixed(0)} px, +y ${py9.x.toFixed(0)} px)`);
  check(await pickCellAt(py9) === '93', 'an arc centred on 90° sits at +y');
  check(await pickCellAt(my9) === '94', 'a polyhedron with vertices at -y sits at -y');
  const handErrs = pageErrors.slice(errs9);
  check(handErrs.length === 0, `no page errors in the handedness section${handErrs.length ? ': ' + handErrs.join(' | ') : ''}`);
} catch (err) {
  failures.push(`harness error: ${err && err.message || err}`);
  console.error(err);
} finally {
  await browser.close();
  server.close();
}

console.log(failures.length ? `\n${failures.length} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
