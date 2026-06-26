import * as vscode from 'vscode';
import { detectMonteCarloLanguage } from '../util/detectLanguage';
import { buildScene, CylinderSpec } from './extractor';
import { GeometryScene, FidelityOptions } from './types';

let currentPanel: vscode.WebviewPanel | undefined;
let webviewReady = false;
let lastScene: GeometryScene | undefined;
let lastText = '';
let lastLanguage = 'mcnp';
let fidelity: FidelityOptions = { detail: 'auto', axial: false };

function postScene(): void {
    if (currentPanel && webviewReady && lastScene) {
        currentPanel.webview.postMessage({ type: 'scene', scene: lastScene });
    }
}

/** Re-extracts the current source at the requested fidelity and re-posts it. */
function rebuildScene(): void {
    if (!lastText) return;
    lastScene = buildScene(lastText, lastLanguage, fidelity);
    postScene();
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
        fidelity = { detail: 'auto', axial: false };
        lastScene = buildScene(lastText, language, fidelity);

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
            currentPanel.onDidDispose(() => { currentPanel = undefined; webviewReady = false; }, null, context.subscriptions);
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
                }
            }, null, context.subscriptions);
            currentPanel.webview.html = buildHtml(currentPanel.webview);
        }

        // When the panel already exists the webview listener is live, so send now;
        // on first open the 'ready' handshake above delivers the payload instead.
        postScene();

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
  #scroll { overflow-y: auto; padding: 8px 12px 16px; flex: 1; }
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
  #warnings { padding: 8px 12px; font-size: 11px; border-bottom: 1px solid #1f2940; }
  .warn { color: #f38ba8; margin-bottom: 4px; }
  .note { color: #a6adc8; opacity: 0.8; margin-bottom: 3px; }
  #toggle { position: absolute; top: 8px; left: 8px; z-index: 30; }
  #empty { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; flex-direction: column; gap: 10px; padding: 40px; text-align: center; z-index: 5; }
  #empty .big { font-size: 15px; color: #f38ba8; max-width: 480px; }
</style>
</head>
<body>
  <div id="stage"></div>
  <button id="toggle" title="Show/hide panel">☰ Layers</button>
  <div id="hud">drag: orbit • scroll: zoom • right-drag: pan</div>
  <div id="empty"><div class="big" id="emptyMsg"></div></div>

  <div id="panel">
    <header>
      <h1>OWEN Geometry</h1>
      <div class="sub" id="meta"></div>
    </header>
    <div id="warnings"></div>
    <div id="scroll">
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

      for (const c of cyls) {
        const r = Math.max(0.01, c.radius);
        const h = Math.max(0.01, c.height || 1);
        const inner = c.innerRadius || 0;
        const op = (typeof c.opacity === 'number') ? c.opacity : 1;
        const solid = inner <= 0.0001 && op >= 0.9;
        const shape = c.shape === 'box' ? 'box' : 'cyl';
        const segs = r > 8 ? 64 : 18;
        const key = shape + '|' + (solid ? 'S' : 'T') + '|' + r.toFixed(4) + '|' + h.toFixed(3) + '|' + (solid ? '1' : bucket(op)) + '|' + segs;
        if (!byKey.has(key)) byKey.set(key, { solid, r, h, shape, segs, op, items: [] });
        byKey.get(key).items.push(c);

        // bounds (world mapping: X=c.x, Y=c.z, Z=c.y)
        minX = Math.min(minX, c.x - r); maxX = Math.max(maxX, c.x + r);
        minZ = Math.min(minZ, c.y - r); maxZ = Math.max(maxZ, c.y + r);
        minY = Math.min(minY, (c.z || 0) - h / 2); maxY = Math.max(maxY, (c.z || 0) + h / 2);
      }
      sceneBounds = cyls.length ? { minX, maxX, minY, maxY, minZ, maxZ } : null;

      for (const grp of byKey.values()) {
        let geo;
        if (grp.shape === 'box') {
          geo = new THREE.BoxGeometry(grp.r * 2, grp.h, grp.r * 2);
        } else {
          geo = new THREE.CylinderGeometry(grp.r, grp.r, grp.h, grp.segs, 1, !grp.solid);
        }
        const mat = new THREE.MeshStandardMaterial({
          color: 0xffffff, roughness: 0.55, metalness: 0.05,
          transparent: !grp.solid,
          opacity: grp.solid ? 1 : Math.min(grp.op, shellOpacity),
          side: grp.solid ? THREE.FrontSide : THREE.DoubleSide,
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
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          color.set(c.color || '#cccccc');
          mesh.setColorAt(i, color);
          instances.push({ matrix: dummy.matrix.clone(), comp: c.component || 'other', mat: c.material || '', ax: c.axialLayer || '', zc: (typeof c.z === 'number' ? c.z : 0) });
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        root.add(mesh);
        groups.push({ mesh, instances });
      }

      applyVisibility();
      applyClipping();
      buildPanel(sc);
      resetView();
    }

    function applyVisibility() {
      for (const g of groups) {
        let changed = false;
        g.instances.forEach((inst, i) => {
          let vis = (compEnabled[inst.comp] !== false) && (inst.mat === '' || matEnabled[inst.mat] !== false);
          // Axial filters only apply to cylinders that belong to an axial layer
          // (vessel/context shells have no ax and stay visible).
          if (vis && inst.ax) {
            if (axEnabled[inst.ax] === false) vis = false;
            else if (inst.zc < axWindow.min - 1e-6 || inst.zc > axWindow.max + 1e-6) vis = false;
          }
          g.mesh.setMatrixAt(i, vis ? inst.matrix : zero);
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

    function buildPanel(sc) {
      document.getElementById('meta').textContent =
        sc.primitiveCount.toLocaleString() + ' primitives • ' + (sc.language || '').toUpperCase();

      const warn = document.getElementById('warnings');
      warn.innerHTML = '';
      for (const w of (sc.warnings || [])) { const d = document.createElement('div'); d.className = 'warn'; d.textContent = '⚠ ' + w; warn.appendChild(d); }
      for (const n of (sc.notes || [])) { const d = document.createElement('div'); d.className = 'note'; d.textContent = n; warn.appendChild(d); }
      warn.style.display = (warn.childElementCount ? 'block' : 'none');

      const emptyMsg = document.getElementById('emptyMsg');
      emptyMsg.textContent = (sc.warnings && sc.warnings[0]) ? sc.warnings[0] : 'No geometry to display.';

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
        const row = document.createElement('label'); row.className = 'row';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = enabledMap[key] !== false;
        cb.addEventListener('change', () => { enabledMap[key] = cb.checked; applyVisibility(); });
        const sw = document.createElement('span'); sw.className = 'swatch'; sw.style.background = it.color || '#888';
        const nm = document.createElement('span'); nm.className = 'name'; nm.textContent = it.label || it.name || key;
        const ct = document.createElement('span'); ct.className = 'count'; ct.textContent = it.count.toLocaleString();
        row.appendChild(cb); row.appendChild(sw); row.appendChild(nm); row.appendChild(ct);
        box.appendChild(row);
      }
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

    window.addEventListener('resize', () => {
      camera.aspect = stage.clientWidth / stage.clientHeight; camera.updateProjectionMatrix();
      renderer.setSize(stage.clientWidth, stage.clientHeight);
    });
    function animate() { requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); }
    animate();

    window.addEventListener('message', (event) => {
      const data = event.data;
      if (data && data.type === 'scene' && data.scene) render(data.scene);
    });

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
