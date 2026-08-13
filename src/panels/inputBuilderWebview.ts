/**
 * Webview markup for the OWEN Input Builder.
 *
 * Split screen by design: sections on the left, the deck the sections produce
 * on the right, checks underneath it. The webview owns no code generation —
 * every keystroke posts the section model to the extension host, which runs
 * `buildDeckDocument` + `checkDeck` and posts back the text, the per-line
 * section provenance, and the check list. That keeps one implementation of the
 * card syntax (the headless, unit-tested one) instead of a second copy inlined
 * here, which is what the old `Function.prototype.toString()` injection was
 * working around.
 */

export function inputBuilderWebviewHtml(injectedScript: string, materialCount: number): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>OWEN Input Builder</title>
<style>
  :root { --gap: 10px; }
  * { box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    margin: 0; padding: 0; height: 100vh; overflow: hidden;
  }
  .app { display: flex; flex-direction: column; height: 100vh; }
  header.bar {
    display: flex; align-items: center; gap: var(--gap);
    padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border);
    flex-wrap: wrap;
  }
  header.bar h1 { font-size: 1.05em; margin: 0 8px 0 0; font-weight: 600; }
  .grow { flex: 1 1 auto; }
  select, input[type=text], input[type=number], textarea {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px; padding: 3px 6px; font-family: inherit; font-size: inherit;
  }
  textarea { font-family: var(--vscode-editor-font-family); width: 100%; }
  button {
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #fff);
    border: none; border-radius: 2px; padding: 4px 10px; cursor: pointer;
    font-family: inherit; font-size: inherit;
  }
  button:hover { background: var(--vscode-button-secondaryHoverBackground, #45494e); }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  button.icon { padding: 2px 6px; background: transparent; color: var(--vscode-descriptionForeground); }
  button.icon:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,.1)); }

  .split { display: flex; flex: 1 1 auto; min-height: 0; }
  .pane-left {
    width: 46%; min-width: 330px; max-width: 60%;
    border-right: 1px solid var(--vscode-panel-border);
    display: flex; flex-direction: column; min-height: 0;
  }
  .pane-right { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; }
  .scroll { overflow: auto; flex: 1 1 auto; padding: 10px 12px; }

  .section {
    border: 1px solid var(--vscode-panel-border); border-radius: 4px;
    margin-bottom: 8px; background: var(--vscode-editorWidget-background, rgba(255,255,255,.02));
  }
  .section.selected { border-color: var(--vscode-focusBorder); }
  .section.disabled { opacity: .55; }
  .section > .head {
    display: flex; align-items: center; gap: 6px; padding: 6px 8px; cursor: pointer;
  }
  .section > .head .name { font-weight: 600; flex: 1 1 auto; }
  .section > .head .kind {
    font-size: .85em; color: var(--vscode-descriptionForeground);
    text-transform: uppercase; letter-spacing: .04em;
  }
  .section > .body { padding: 4px 10px 10px; border-top: 1px solid var(--vscode-panel-border); }

  .row { display: flex; gap: 8px; align-items: center; margin: 5px 0; flex-wrap: wrap; }
  .row label { min-width: 116px; color: var(--vscode-descriptionForeground); }
  .row input[type=number] { width: 92px; }
  .row input[type=text] { flex: 1 1 140px; }
  .hint { color: var(--vscode-descriptionForeground); font-size: .9em; margin: 4px 0 6px; }
  .mono { font-family: var(--vscode-editor-font-family); }

  table.layers { width: 100%; border-collapse: collapse; margin: 4px 0; }
  table.layers th { text-align: left; font-weight: 500; color: var(--vscode-descriptionForeground); font-size: .9em; }
  table.layers td, table.layers th { padding: 2px 4px; }
  table.layers input[type=number] { width: 86px; }

  .deck {
    flex: 1 1 auto; overflow: auto; margin: 0; padding: 8px 0 8px 0;
    font-family: var(--vscode-editor-font-family);
    font-size: var(--vscode-editor-font-size, 12px);
    line-height: 1.45; white-space: pre; tab-size: 4;
  }
  .deck .ln { display: flex; }
  .deck .ln:hover { background: var(--vscode-list-hoverBackground); }
  .deck .ln.hl { background: var(--vscode-editor-selectionHighlightBackground, rgba(90,150,255,.16)); }
  .deck .ln.err { box-shadow: inset 2px 0 0 var(--vscode-editorError-foreground, #f14c4c); }
  .deck .n {
    flex: 0 0 auto; width: 44px; text-align: right; padding-right: 10px;
    color: var(--vscode-editorLineNumber-foreground); user-select: none;
  }
  .deck .t { flex: 1 1 auto; padding-right: 12px; }
  .deck .t.over { color: var(--vscode-editorError-foreground, #f14c4c); }

  .checks { border-top: 1px solid var(--vscode-panel-border); max-height: 34%; display: flex; flex-direction: column; }
  .checks .chead { display: flex; align-items: center; gap: 8px; padding: 6px 12px; }
  .checks .clist { overflow: auto; padding: 0 6px 8px; }
  .check { display: flex; gap: 8px; padding: 3px 6px; border-radius: 3px; cursor: pointer; align-items: flex-start; }
  .check:hover { background: var(--vscode-list-hoverBackground); }
  .check .dot { flex: 0 0 auto; margin-top: .35em; width: 8px; height: 8px; border-radius: 50%; }
  .check.error .dot { background: var(--vscode-editorError-foreground, #f14c4c); }
  .check.warning .dot { background: var(--vscode-editorWarning-foreground, #cca700); }
  .check.info .dot { background: var(--vscode-editorInfo-foreground, #3794ff); }
  .check .where { color: var(--vscode-descriptionForeground); }
  .ok { color: var(--vscode-testing-iconPassed, #73c991); }

  .pill {
    border-radius: 10px; padding: 1px 8px; font-size: .85em;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
  }

  .lat { margin-top: 6px; }
  .lat .palette { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 6px; }
  .lat .swatch {
    display: flex; align-items: center; gap: 5px; padding: 2px 7px; border-radius: 3px;
    border: 1px solid transparent; cursor: pointer;
  }
  .lat .swatch.active { border-color: var(--vscode-focusBorder); }
  .lat .swatch i { width: 11px; height: 11px; border-radius: 2px; display: inline-block; }
  .lat .grid { display: grid; gap: 1px; width: max-content; user-select: none; }
  .lat .cell { width: 15px; height: 15px; border-radius: 1px; cursor: crosshair; }
  .empty { color: var(--vscode-descriptionForeground); padding: 16px 4px; }
</style>
</head>
<body>
<div class="app">
  <header class="bar">
    <h1>Input Builder</h1>
    <label class="hint" for="code">Code</label>
    <select id="code">
      <option value="mcnp">MCNP</option>
      <option value="openmc">OpenMC (Python)</option>
      <option value="serpent">Serpent 2</option>
      <option value="scone">SCONE</option>
    </select>
    <input type="text" id="title" placeholder="Deck title" style="flex:0 1 240px" />
    <select id="dialect" title="MCNP card-image width used by the checks">
      <option value="80">80 columns</option>
      <option value="128">128 columns</option>
    </select>
    <span class="grow"></span>
    <span id="counts" class="hint"></span>
    <button id="copy">Copy</button>
    <button id="newFile">New file</button>
    <button id="insert" class="primary">Insert at cursor</button>
  </header>

  <div class="split">
    <div class="pane-left">
      <div class="row" style="padding: 8px 12px 0; margin: 0">
        <select id="addKind">
          <option value="materials">Materials</option>
          <option value="pincell">Pin cell</option>
          <option value="lattice">Lattice</option>
          <option value="boundary">Boundary / graveyard</option>
          <option value="run">Run settings + source</option>
          <option value="tally">Tally</option>
          <option value="surface">Single surface</option>
          <option value="cell">Single cell</option>
          <option value="custom">Custom text</option>
        </select>
        <button id="add">Add section</button>
        <span class="grow"></span>
        <button id="reset" class="icon" title="Start from the default pin-cell deck">Reset</button>
      </div>
      <div class="scroll" id="sections"></div>
    </div>

    <div class="pane-right">
      <div class="deck" id="deck"></div>
      <div class="checks">
        <div class="chead">
          <strong>Final checks</strong>
          <span id="checkSummary" class="hint"></span>
          <span class="grow"></span>
          <span id="checkPills"></span>
        </div>
        <div class="clist" id="checkList"></div>
      </div>
    </div>
  </div>
</div>

<script>
const vscodeApi = acquireVsCodeApi();
const MATERIAL_COUNT = ${materialCount};
${injectedScript}

const PALETTE = ['#e06c75', '#61afef', '#98c379', '#e5c07b', '#c678dd', '#56b6c2', '#d19a66', '#abb2bf'];
const KIND_LABELS = {
  materials: 'materials', pincell: 'pin cell', lattice: 'lattice', boundary: 'boundary',
  run: 'run', tally: 'tally', surface: 'surface', cell: 'cell', custom: 'custom',
};

let uid = 1;
function nextId(prefix) { return prefix + '_' + (uid++) + '_' + Math.random().toString(36).slice(2, 6); }

// --------------------------------------------------------------- default deck
function defaultModel(code) {
  const mats = {
    id: nextId('mat'), kind: 'materials', entries: [
      { key: 'fuel', source: 'library', libraryId: 'uo2-3pct', temperature: 900 },
      { key: 'clad', source: 'library', libraryId: 'zirc4', temperature: 600 },
      { key: 'water', source: 'library', libraryId: 'light-water', temperature: 600 },
    ],
  };
  const pin = {
    id: nextId('pin'), kind: 'pincell', name: 'fuel pin', universe: 1,
    layers: [{ material: 'fuel', outerRadius: 0.39218 }, { material: 'clad', outerRadius: 0.4572 }],
    outerMaterial: 'water', pitch: 1.26, zMin: 0, zMax: 365.76,
  };
  const run = {
    id: nextId('run'), kind: 'run', mode: 'eigenvalue', particles: 10000,
    inactive: 50, active: 150, keffGuess: 1.0, source: [0, 0, 182.88],
  };
  const bound = {
    id: nextId('bnd'), kind: 'boundary', shape: 'box', size: 0.63,
    zMin: 0, zMax: 365.76, bc: 'reflective', fillUniverse: 1,
  };
  return { code: code || 'mcnp', title: 'OWEN Input Builder deck', lineLimit: 80, sections: [mats, pin, bound, run] };
}

function newSection(kind) {
  const firstMat = () => {
    for (const s of model.sections) if (s.kind === 'materials' && s.entries.length) return s.entries[0].key;
    return 'fuel';
  };
  if (kind === 'materials') return { id: nextId('mat'), kind: 'materials', entries: [] };
  if (kind === 'pincell') return {
    id: nextId('pin'), kind: 'pincell', name: 'pin ' + (countKind('pincell') + 1),
    universe: 1 + countKind('pincell'),
    layers: [{ material: firstMat(), outerRadius: 0.39218 }],
    outerMaterial: firstMat(), pitch: 1.26, zMin: 0, zMax: 365.76,
  };
  if (kind === 'lattice') {
    const n = 17;
    const pins = [];
    const pinSections = model.sections.filter((s) => s.kind === 'pincell');
    pinSections.slice(0, 6).forEach((p, i) => pins.push({
      id: i + 1, label: p.name, universe: p.universe || (i + 1), pincellId: p.id,
    }));
    if (pins.length === 0) pins.push({ id: 1, label: 'fuel', universe: 1 });
    const grid = [];
    for (let r = 0; r < n; r++) { const row = []; for (let c = 0; c < n; c++) row.push(pins[0].id); grid.push(row); }
    return {
      id: nextId('lat'), kind: 'lattice', nx: n, ny: n, pitch: 1.26, grid, pins,
      latticeCell: 900 + countKind('lattice') * 20, latticeUniverse: 10 + countKind('lattice'),
    };
  }
  if (kind === 'boundary') return {
    id: nextId('bnd'), kind: 'boundary', shape: 'box', size: 10.71,
    zMin: 0, zMax: 365.76, bc: 'reflective',
  };
  if (kind === 'run') return {
    id: nextId('run'), kind: 'run', mode: 'eigenvalue', particles: 10000,
    inactive: 50, active: 150, keffGuess: 1.0, source: [0, 0, 0],
  };
  if (kind === 'tally') return {
    id: nextId('tly'), kind: 'tally', quantity: 'flux', cells: [], energyBins: 0,
  };
  if (kind === 'surface') return {
    id: nextId('srf'), kind: 'surface',
    spec: { surfaceNumber: 500 + countKind('surface'), template: 'rcc-pin', comment: '',
      rcc: { x: 0, y: 0, z: 0, height: 10, radius: 1 } },
  };
  if (kind === 'cell') return {
    id: nextId('cel'), kind: 'cell',
    spec: { cellNumber: 700 + countKind('cell'), material: 'void', density: 0,
      surfaces: [{ id: 1, sense: '-' }], operator: 'intersection', imp: 1, comment: '' },
  };
  return { id: nextId('raw'), kind: 'custom', region: 'trailer', text: '' };
}

function countKind(kind) { return model.sections.filter((s) => s.kind === kind).length; }

// ------------------------------------------------------------------ app state
const saved = vscodeApi.getState();
let model = (saved && saved.model && saved.model.sections) ? saved.model : defaultModel('mcnp');
let doc = null;
let checks = [];
let selectedId = model.sections.length ? model.sections[0].id : null;
let expanded = new Set(selectedId ? [selectedId] : []);
let paintId = 1;

function save() { vscodeApi.setState({ model }); }

let postTimer = null;
function post() {
  save();
  if (postTimer) clearTimeout(postTimer);
  postTimer = setTimeout(() => {
    vscodeApi.postMessage({ command: 'model', model });
  }, 90);
}

// -------------------------------------------------------------- path helpers
function getPath(obj, path) {
  let cur = obj;
  for (const key of path.split('.')) {
    if (cur === undefined || cur === null) return undefined;
    cur = cur[Array.isArray(cur) ? Number(key) : key];
  }
  return cur;
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = Array.isArray(cur) ? Number(keys[i]) : keys[i];
    if (cur[k] === undefined || cur[k] === null) cur[k] = /^\\d+$/.test(keys[i + 1]) ? [] : {};
    cur = cur[k];
  }
  const last = keys[keys.length - 1];
  cur[Array.isArray(cur) ? Number(last) : last] = value;
}

function esc(text) {
  return String(text === undefined || text === null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function num(sid, path, label, opts) {
  const o = opts || {};
  const v = getPath(sectionById(sid), path);
  return '<div class="row"><label>' + esc(label) + '</label>'
    + '<input type="number" data-sid="' + sid + '" data-path="' + path + '" data-type="number"'
    + (o.step ? ' step="' + o.step + '"' : ' step="any"')
    + (o.min !== undefined ? ' min="' + o.min + '"' : '')
    + ' value="' + esc(v === undefined ? '' : v) + '" />'
    + (o.suffix ? '<span class="hint">' + esc(o.suffix) + '</span>' : '')
    + '</div>';
}

function text(sid, path, label, placeholder) {
  const v = getPath(sectionById(sid), path);
  return '<div class="row"><label>' + esc(label) + '</label>'
    + '<input type="text" data-sid="' + sid + '" data-path="' + path + '" data-type="text"'
    + ' placeholder="' + esc(placeholder || '') + '" value="' + esc(v === undefined ? '' : v) + '" /></div>';
}

function choice(sid, path, label, options) {
  const v = String(getPath(sectionById(sid), path));
  const opts = options.map((o) =>
    '<option value="' + esc(o[0]) + '"' + (String(o[0]) === v ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('');
  return '<div class="row"><label>' + esc(label) + '</label>'
    + '<select data-sid="' + sid + '" data-path="' + path + '" data-type="text">' + opts + '</select></div>';
}

function materialOptions() {
  const out = [];
  for (const s of model.sections) {
    if (s.kind !== 'materials') continue;
    for (const e of s.entries) out.push([e.key, e.key]);
  }
  if (out.length === 0) out.push(['', '(no materials defined)']);
  return out;
}

function sectionById(id) { return model.sections.find((s) => s.id === id); }

// ------------------------------------------------------------ section bodies
function bodyMaterials(s) {
  let html = '<div class="hint">Library of ' + MATERIAL_COUNT + ' curated materials plus the PNNL-15870 compendium. '
    + 'The key is how geometry sections refer to the material.</div>';
  html += '<table class="layers"><tr><th>Key</th><th>Source</th><th>T (K)</th><th>m#</th><th></th></tr>';
  s.entries.forEach((e, i) => {
    const src = e.source === 'library'
      ? '<select data-sid="' + s.id + '" data-path="entries.' + i + '.libraryId" data-type="text">'
        + MATERIAL_LIBRARY.map((m) => '<option value="' + m.id + '"' + (m.id === e.libraryId ? ' selected' : '') + '>' + esc(m.name) + '</option>').join('')
        + '</select>'
      : e.source === 'pnnl'
        ? '<span class="mono">' + esc(e.pnnl ? e.pnnl.name : '(PNNL)') + '</span>'
        : '<span class="mono">custom composition</span>';
    html += '<tr>'
      + '<td><input type="text" style="width:90px" data-sid="' + s.id + '" data-path="entries.' + i + '.key" data-type="text" value="' + esc(e.key) + '" /></td>'
      + '<td>' + src + '</td>'
      + '<td><input type="number" style="width:70px" data-sid="' + s.id + '" data-path="entries.' + i + '.temperature" data-type="number" value="' + esc(e.temperature || '') + '" /></td>'
      + '<td><input type="number" style="width:60px" data-sid="' + s.id + '" data-path="entries.' + i + '.mcnpNumber" data-type="number" value="' + esc(e.mcnpNumber || '') + '" placeholder="auto" /></td>'
      + '<td><button class="icon" data-act="delEntry" data-sid="' + s.id + '" data-idx="' + i + '" title="Remove">✕</button></td>'
      + '</tr>';
  });
  html += '</table>';
  html += '<div class="row"><button data-act="addLib" data-sid="' + s.id + '">Add from library</button>'
    + '<button data-act="addCustom" data-sid="' + s.id + '">Add custom composition</button>'
    + '<input type="text" id="pnnlQ_' + s.id + '" placeholder="Search PNNL compendium…" style="flex:1 1 150px" />'
    + '<button data-act="pnnlSearch" data-sid="' + s.id + '">Search</button></div>';
  html += '<div id="pnnlResults_' + s.id + '"></div>';
  s.entries.forEach((e, i) => {
    if (e.source !== 'custom' || !e.custom) return;
    html += '<div class="hint" style="margin-top:8px">Custom composition — ' + esc(e.key) + '</div>';
    html += text(s.id, 'entries.' + i + '.custom.name', 'Name', 'My material');
    html += num(s.id, 'entries.' + i + '.custom.density', 'Density', { suffix: 'g/cm³ (weight) or atoms/b·cm' });
    html += choice(s.id, 'entries.' + i + '.custom.densityMode', 'Density unit', [['weight', 'g/cm³'], ['atom', 'atoms/b·cm']]);
    html += choice(s.id, 'entries.' + i + '.custom.fractionMode', 'Fractions', [['atom', 'atom'], ['weight', 'weight']]);
    html += '<div class="row"><label>Components</label></div>';
    html += '<textarea rows="4" data-sid="' + s.id + '" data-path="entries.' + i + '.custom.__zaids" data-type="zaids" '
      + 'placeholder="92235.80c 0.04&#10;92238.80c 0.96&#10;8016.80c 2.0">'
      + esc((e.custom.components || []).map((c) => c.zaid + ' ' + c.fraction).join('\\n')) + '</textarea>';
    html += '<div class="hint">One ZAID and fraction per line. Sign convention follows the fraction mode; '
      + 'MCNP reads a negative entry as a weight fraction.</div>';
  });
  return html;
}

function bodyPinCell(s) {
  let html = text(s.id, 'name', 'Name', 'fuel pin');
  html += '<table class="layers"><tr><th>Material</th><th>Outer radius (cm)</th><th></th></tr>';
  s.layers.forEach((l, i) => {
    html += '<tr><td><select data-sid="' + s.id + '" data-path="layers.' + i + '.material" data-type="text">'
      + materialOptions().map((o) => '<option value="' + esc(o[0]) + '"' + (o[0] === l.material ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('')
      + '</select></td>'
      + '<td><input type="number" step="any" data-sid="' + s.id + '" data-path="layers.' + i + '.outerRadius" data-type="number" value="' + esc(l.outerRadius) + '" /></td>'
      + '<td><button class="icon" data-act="delLayer" data-sid="' + s.id + '" data-idx="' + i + '">✕</button></td></tr>';
  });
  html += '</table>';
  html += '<div class="row"><button data-act="addLayer" data-sid="' + s.id + '">Add layer</button></div>';
  html += choice(s.id, 'outerMaterial', 'Outside layers', materialOptions());
  html += num(s.id, 'pitch', 'Cell pitch', { suffix: 'cm (square cell)' });
  html += num(s.id, 'zMin', 'z min', { suffix: 'cm' });
  html += num(s.id, 'zMax', 'z max', { suffix: 'cm' });
  html += num(s.id, 'universe', 'Universe', { suffix: 'blank = standalone deck', min: 0 });
  html += '<div class="row"><label>Reflective faces</label>'
    + '<input type="checkbox" data-sid="' + s.id + '" data-path="reflective" data-type="bool"' + (s.reflective ? ' checked' : '') + ' />'
    + '<span class="hint">Infinite-lattice k∞ model</span></div>';
  return html;
}

function bodyLattice(s) {
  let html = '<div class="row"><label>Grid</label>'
    + '<input type="number" min="1" style="width:70px" data-sid="' + s.id + '" data-path="nx" data-type="gridsize" value="' + s.nx + '" />'
    + '<span>×</span>'
    + '<input type="number" min="1" style="width:70px" data-sid="' + s.id + '" data-path="ny" data-type="gridsize" value="' + s.ny + '" /></div>';
  html += num(s.id, 'pitch', 'Pitch', { suffix: 'cm' });
  html += num(s.id, 'latticeUniverse', 'Lattice universe', {});
  if (model.code === 'mcnp') html += num(s.id, 'latticeCell', 'Lattice cell', {});
  html += '<div class="lat">';
  html += '<div class="palette">';
  s.pins.forEach((p) => {
    html += '<span class="swatch' + (p.id === paintId ? ' active' : '') + '" data-act="paint" data-sid="' + s.id + '" data-pid="' + p.id + '">'
      + '<i style="background:' + PALETTE[(p.id - 1) % PALETTE.length] + '"></i>' + esc(p.label) + '</span>';
  });
  html += '<button class="icon" data-act="addPin" data-sid="' + s.id + '">+ type</button>';
  html += '</div>';
  html += '<div class="grid" data-grid="' + s.id + '" style="grid-template-columns:repeat(' + s.nx + ',15px)">';
  for (let r = 0; r < s.ny; r++) {
    for (let c = 0; c < s.nx; c++) {
      const v = (s.grid[r] && s.grid[r][c]) || 0;
      html += '<div class="cell" data-r="' + r + '" data-c="' + c + '" style="background:'
        + (v ? PALETTE[(v - 1) % PALETTE.length] : 'var(--vscode-input-background)') + '"></div>';
    }
  }
  html += '</div>';
  html += '<div class="hint">Click or drag to paint the selected type. Presets: '
    + '<button class="icon" data-act="preset" data-sid="' + s.id + '" data-preset="all">uniform</button>'
    + '<button class="icon" data-act="preset" data-sid="' + s.id + '" data-preset="w17">W 17×17 guide tubes</button>'
    + '<button class="icon" data-act="preset" data-sid="' + s.id + '" data-preset="checker">checkerboard</button>'
    + '</div>';
  html += '<table class="layers"><tr><th>Type</th><th>Universe</th><th>From pin cell</th><th></th></tr>';
  s.pins.forEach((p, i) => {
    const pinOpts = [['', '(none)']].concat(model.sections.filter((x) => x.kind === 'pincell').map((x) => [x.id, x.name]));
    html += '<tr>'
      + '<td><input type="text" style="width:96px" data-sid="' + s.id + '" data-path="pins.' + i + '.label" data-type="text" value="' + esc(p.label) + '" /></td>'
      + '<td><input type="number" style="width:70px" data-sid="' + s.id + '" data-path="pins.' + i + '.universe" data-type="number" value="' + esc(p.universe) + '" /></td>'
      + '<td><select data-sid="' + s.id + '" data-path="pins.' + i + '.pincellId" data-type="text">'
      + pinOpts.map((o) => '<option value="' + esc(o[0]) + '"' + (o[0] === (p.pincellId || '') ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('')
      + '</select></td>'
      + '<td><button class="icon" data-act="delPin" data-sid="' + s.id + '" data-idx="' + i + '">✕</button></td></tr>';
  });
  html += '</table></div>';
  return html;
}

function bodyBoundary(s) {
  let html = choice(s.id, 'shape', 'Shape', [['box', 'box (rpp)'], ['cylinder', 'cylinder'], ['sphere', 'sphere']]);
  html += num(s.id, 'size', s.shape === 'box' ? 'Half-width' : 'Radius', { suffix: 'cm' });
  html += num(s.id, 'zMin', 'z min', { suffix: 'cm' });
  html += num(s.id, 'zMax', 'z max', { suffix: 'cm' });
  html += choice(s.id, 'bc', 'Boundary', [['vacuum', 'vacuum'], ['reflective', 'reflective (*)'], ['white', 'white / cosine (+)']]);
  const latOpts = [['', '(nothing)']].concat(model.sections.filter((x) => x.kind === 'lattice').map((x) => [x.id, x.label || ('lattice ' + x.nx + '×' + x.ny)]));
  html += choice(s.id, 'fillLatticeId', 'Fill with lattice', latOpts);
  html += num(s.id, 'fillUniverse', 'or fill universe', {});
  html += '<div class="hint">A graveyard cell (imp:n=0 on MCNP, outside on Serpent) is written automatically.</div>';
  return html;
}

function bodyRun(s) {
  let html = choice(s.id, 'mode', 'Mode', [['eigenvalue', 'eigenvalue (k)'], ['fixed', 'fixed source']]);
  html += num(s.id, 'particles', s.mode === 'eigenvalue' ? 'Per cycle' : 'Histories', { min: 1 });
  if (s.mode === 'eigenvalue') {
    html += num(s.id, 'inactive', 'Inactive cycles', { min: 0 });
    html += num(s.id, 'active', 'Active cycles', { min: 1 });
    html += num(s.id, 'keffGuess', 'k guess', {});
  } else {
    html += num(s.id, 'active', 'Batches', { min: 1 });
  }
  html += '<div class="row"><label>Source point</label>'
    + '<input type="number" step="any" style="width:78px" data-sid="' + s.id + '" data-path="source.0" data-type="number" value="' + esc(s.source[0]) + '" />'
    + '<input type="number" step="any" style="width:78px" data-sid="' + s.id + '" data-path="source.1" data-type="number" value="' + esc(s.source[1]) + '" />'
    + '<input type="number" step="any" style="width:78px" data-sid="' + s.id + '" data-path="source.2" data-type="number" value="' + esc(s.source[2]) + '" />'
    + '<span class="hint">cm — must sit inside a cell</span></div>';
  html += num(s.id, 'seed', 'Random seed', {});
  return html;
}

function bodyTally(s) {
  let html = choice(s.id, 'quantity', 'Quantity', [['flux', 'flux'], ['fission', 'fission rate'], ['spectrum', 'flux spectrum'], ['heating', 'energy deposition']]);
  html += text(s.id, '__cells', 'Cells', '10 11 12');
  html += num(s.id, 'energyBins', 'Energy bins', { min: 0 });
  html += num(s.id, 'sd', 'sd divisor', { suffix: 'required inside a lattice' });
  return html;
}

function bodySurface(s) {
  let html = num(s.id, 'spec.surfaceNumber', 'Surface number', { min: 1 });
  html += choice(s.id, 'spec.template', 'Template', SURFACE_TEMPLATES.map((t) => [t.id, t.label]));
  const t = s.spec.template;
  if (t === 'rcc-pin') {
    html += num(s.id, 'spec.rcc.x', 'base x', {}) + num(s.id, 'spec.rcc.y', 'base y', {}) + num(s.id, 'spec.rcc.z', 'base z', {});
    html += num(s.id, 'spec.rcc.height', 'height', { suffix: 'cm' }) + num(s.id, 'spec.rcc.radius', 'radius', { suffix: 'cm' });
  } else if (t === 'rpp-box') {
    ['xmin', 'xmax', 'ymin', 'ymax', 'zmin', 'zmax'].forEach((k) => { html += num(s.id, 'spec.rpp.' + k, k, {}); });
  } else {
    html += num(s.id, 'spec.sphere.x', 'x', {}) + num(s.id, 'spec.sphere.y', 'y', {})
      + num(s.id, 'spec.sphere.z', 'z', {}) + num(s.id, 'spec.sphere.radius', 'radius', { suffix: 'cm' });
  }
  html += text(s.id, 'spec.comment', 'Comment', '');
  return html;
}

function bodyCell(s) {
  let html = num(s.id, 'spec.cellNumber', 'Cell number', { min: 1 });
  html += text(s.id, 'spec.material', 'Material', 'void or m-number');
  html += num(s.id, 'spec.density', 'Density', { suffix: 'negative = g/cm³' });
  html += text(s.id, '__surfaces', 'Region', '-1 2 -3');
  html += choice(s.id, 'spec.operator', 'Operator', [['intersection', 'intersection'], ['union', 'union']]);
  html += num(s.id, 'spec.imp', 'imp:n', {});
  html += num(s.id, 'spec.universe', 'Universe', {});
  html += text(s.id, 'spec.comment', 'Comment', '');
  return html;
}

function bodyCustom(s) {
  let html = choice(s.id, 'region', 'Goes in', [
    ['title', 'header / title'], ['materials', 'materials'], ['surfaces', 'surfaces'],
    ['cells', 'cells'], ['universes', 'universes / lattices'], ['settings', 'settings'],
    ['tallies', 'tallies'], ['trailer', 'end of deck'],
  ]);
  html += '<textarea rows="6" data-sid="' + s.id + '" data-path="text" data-type="text">' + esc(s.text) + '</textarea>';
  return html;
}

function sectionBody(s) {
  switch (s.kind) {
    case 'materials': return bodyMaterials(s);
    case 'pincell': return bodyPinCell(s);
    case 'lattice': return bodyLattice(s);
    case 'boundary': return bodyBoundary(s);
    case 'run': return bodyRun(s);
    case 'tally': return bodyTally(s);
    case 'surface': return bodySurface(s);
    case 'cell': return bodyCell(s);
    default: return bodyCustom(s);
  }
}

function labelFor(s) {
  const span = doc && doc.sections ? doc.sections.find((x) => x.id === s.id) : null;
  if (span && span.label) return span.label;
  return KIND_LABELS[s.kind] || s.kind;
}

function renderSections() {
  const host = document.getElementById('sections');
  if (model.sections.length === 0) {
    host.innerHTML = '<div class="empty">No sections yet. Add one above, or press Reset for a working pin-cell deck.</div>';
    return;
  }
  const errBySection = {};
  for (const c of checks) {
    if (!c.sectionId) continue;
    if (c.severity === 'error') errBySection[c.sectionId] = (errBySection[c.sectionId] || 0) + 1;
  }
  host.innerHTML = model.sections.map((s, i) => {
    const open = expanded.has(s.id);
    const errs = errBySection[s.id];
    return '<div class="section' + (s.id === selectedId ? ' selected' : '') + (s.enabled === false ? ' disabled' : '') + '" data-sid="' + s.id + '">'
      + '<div class="head" data-act="toggle" data-sid="' + s.id + '">'
      + '<span class="kind">' + esc(KIND_LABELS[s.kind] || s.kind) + '</span>'
      + '<span class="name">' + esc(labelFor(s)) + '</span>'
      + (errs ? '<span class="pill" title="problems in this section">' + errs + '</span>' : '')
      + '<button class="icon" data-act="up" data-sid="' + s.id + '" title="Move up"' + (i === 0 ? ' disabled' : '') + '>▲</button>'
      + '<button class="icon" data-act="down" data-sid="' + s.id + '" title="Move down"' + (i === model.sections.length - 1 ? ' disabled' : '') + '>▼</button>'
      + '<button class="icon" data-act="dup" data-sid="' + s.id + '" title="Duplicate">⧉</button>'
      + '<button class="icon" data-act="mute" data-sid="' + s.id + '" title="Enable / disable">' + (s.enabled === false ? '○' : '●') + '</button>'
      + '<button class="icon" data-act="del" data-sid="' + s.id + '" title="Delete">✕</button>'
      + '<span class="kind">' + (open ? '▾' : '▸') + '</span>'
      + '</div>'
      + (open ? '<div class="body">' + sectionBody(s)
        + '<div class="row"><button data-act="insertSection" data-sid="' + s.id + '">Insert only this section</button></div></div>' : '')
      + '</div>';
  }).join('');
}

function renderDeck() {
  const host = document.getElementById('deck');
  if (!doc) { host.textContent = ''; return; }
  const hl = new Set();
  if (selectedId) {
    const span = doc.sections.find((s) => s.id === selectedId);
    if (span) for (const i of span.lines) hl.add(i);
  }
  const errLines = new Set(checks.filter((c) => c.severity === 'error' && c.line !== undefined).map((c) => c.line));
  const limit = model.code === 'mcnp' ? (model.lineLimit || 80) : 0;
  host.innerHTML = doc.lines.map((line, i) => {
    const over = limit && line.length > limit;
    return '<div class="ln' + (hl.has(i) ? ' hl' : '') + (errLines.has(i) ? ' err' : '') + '" data-line="' + i + '">'
      + '<span class="n">' + (i + 1) + '</span>'
      + '<span class="t' + (over ? ' over' : '') + '">' + esc(line) + '</span></div>';
  }).join('');
  const c = doc.counts;
  document.getElementById('counts').textContent =
    c.materials + ' materials · ' + c.cells + ' cell lines · ' + c.surfaces + ' surface lines'
    + (c.lattices ? ' · ' + c.lattices + ' lattice' + (c.lattices > 1 ? 's' : '') : '')
    + (c.tallies ? ' · ' + c.tallies + ' tally' + (c.tallies > 1 ? 's' : '') : '');
}

function renderChecks() {
  const errors = checks.filter((c) => c.severity === 'error').length;
  const warnings = checks.filter((c) => c.severity === 'warning').length;
  const infos = checks.filter((c) => c.severity === 'info').length;
  document.getElementById('checkPills').innerHTML =
    (errors ? '<span class="pill">' + errors + ' error' + (errors > 1 ? 's' : '') + '</span> ' : '')
    + (warnings ? '<span class="pill">' + warnings + ' warning' + (warnings > 1 ? 's' : '') + '</span> ' : '')
    + (infos ? '<span class="pill">' + infos + ' note' + (infos > 1 ? 's' : '') + '</span>' : '');
  const sum = document.getElementById('checkSummary');
  if (!errors && !warnings) { sum.innerHTML = '<span class="ok">no problems found</span>'; }
  else { sum.textContent = errors ? 'fix these before running' : 'runs, but check the intent'; }

  const order = { error: 0, warning: 1, info: 2 };
  const list = checks.slice().sort((a, b) => (order[a.severity] - order[b.severity]) || ((a.line || 0) - (b.line || 0)));
  document.getElementById('checkList').innerHTML = list.length === 0
    ? '<div class="hint" style="padding:4px 6px">The deck assembles cleanly and the language rules are quiet.</div>'
    : list.map((c, i) => '<div class="check ' + c.severity + '" data-check="' + i + '">'
      + '<span class="dot"></span><span>' + esc(c.message)
      + (c.line !== undefined ? ' <span class="where">line ' + (c.line + 1) + '</span>' : '')
      + (c.origin === 'rules' && c.code ? ' <span class="where">' + esc(c.code) + '</span>' : '')
      + '</span></div>').join('');
  window.__checkOrder = list;
}

function renderAll() { renderSections(); renderDeck(); renderChecks(); }

// ------------------------------------------------------------------- events
document.getElementById('code').addEventListener('change', (e) => {
  model.code = e.target.value;
  document.getElementById('dialect').style.display = model.code === 'mcnp' ? '' : 'none';
  post();
});
document.getElementById('title').addEventListener('input', (e) => { model.title = e.target.value; post(); });
document.getElementById('dialect').addEventListener('change', (e) => { model.lineLimit = Number(e.target.value); post(); });
document.getElementById('add').addEventListener('click', () => {
  const s = newSection(document.getElementById('addKind').value);
  model.sections.push(s);
  selectedId = s.id;
  expanded.add(s.id);
  renderSections();
  post();
});
document.getElementById('reset').addEventListener('click', () => {
  model = defaultModel(model.code);
  selectedId = model.sections[0].id;
  expanded = new Set([selectedId]);
  renderSections();
  post();
});
/** Nothing to hand over until the host has answered with a deck. */
function deckText() { return doc && doc.text ? doc.text : null; }

document.getElementById('insert').addEventListener('click', () => {
  const text = deckText();
  if (!text) return;
  const errors = checks.filter((c) => c.severity === 'error').length;
  if (errors > 0) {
    vscodeApi.postMessage({ command: 'insertWithErrors', text, errors, codeLang: model.code });
    return;
  }
  vscodeApi.postMessage({ command: 'insert', text });
});
document.getElementById('newFile').addEventListener('click', () => {
  const text = deckText();
  if (text) vscodeApi.postMessage({ command: 'newFile', text, codeLang: model.code });
});
document.getElementById('copy').addEventListener('click', () => {
  const text = deckText();
  if (text) vscodeApi.postMessage({ command: 'copy', text });
});

document.getElementById('sections').addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.getAttribute('data-act');
  const sid = btn.getAttribute('data-sid');
  const s = sectionById(sid);
  const idx = model.sections.findIndex((x) => x.id === sid);
  if (act !== 'toggle') ev.stopPropagation();
  if (act === 'toggle') {
    selectedId = sid;
    if (expanded.has(sid)) expanded.delete(sid); else expanded.add(sid);
    renderSections(); renderDeck();
    return;
  }
  if (act === 'up' && idx > 0) { model.sections.splice(idx - 1, 0, model.sections.splice(idx, 1)[0]); }
  else if (act === 'down' && idx < model.sections.length - 1) { model.sections.splice(idx + 1, 0, model.sections.splice(idx, 1)[0]); }
  else if (act === 'dup') {
    const copy = JSON.parse(JSON.stringify(s));
    copy.id = nextId(s.kind.slice(0, 3));
    if (copy.kind === 'lattice') {
      copy.latticeUniverse = (copy.latticeUniverse || 10) + 1;
      copy.latticeCell = (copy.latticeCell || 900) + 20;
    }
    if (copy.kind === 'pincell') { copy.name = copy.name + ' copy'; copy.universe = (copy.universe || 1) + 1; }
    model.sections.splice(idx + 1, 0, copy);
    selectedId = copy.id; expanded.add(copy.id);
  }
  else if (act === 'mute') { s.enabled = s.enabled === false; }
  else if (act === 'del') { model.sections.splice(idx, 1); expanded.delete(sid); if (selectedId === sid) selectedId = null; }
  else if (act === 'addLayer') { s.layers.push({ material: s.outerMaterial, outerRadius: (s.layers.length ? s.layers[s.layers.length - 1].outerRadius + 0.05 : 0.4) }); }
  else if (act === 'delLayer') { s.layers.splice(Number(btn.getAttribute('data-idx')), 1); }
  else if (act === 'addLib') { s.entries.push({ key: 'mat' + (s.entries.length + 1), source: 'library', libraryId: MATERIAL_LIBRARY[0].id }); }
  else if (act === 'addCustom') {
    s.entries.push({
      key: 'custom' + (s.entries.length + 1), source: 'custom',
      custom: { name: 'Custom material', density: 1, densityMode: 'weight', fractionMode: 'atom', components: [] },
    });
  }
  else if (act === 'delEntry') { s.entries.splice(Number(btn.getAttribute('data-idx')), 1); }
  else if (act === 'addPin') {
    const id = s.pins.reduce((m, p) => Math.max(m, p.id), 0) + 1;
    s.pins.push({ id, label: 'type ' + id, universe: id });
  }
  else if (act === 'delPin') { s.pins.splice(Number(btn.getAttribute('data-idx')), 1); }
  else if (act === 'paint') { paintId = Number(btn.getAttribute('data-pid')); }
  else if (act === 'preset') {
    const preset = btn.getAttribute('data-preset');
    const first = s.pins[0] ? s.pins[0].id : 1;
    const second = s.pins[1] ? s.pins[1].id : first;
    for (let r = 0; r < s.ny; r++) {
      for (let c = 0; c < s.nx; c++) {
        if (preset === 'all') s.grid[r][c] = first;
        else if (preset === 'checker') s.grid[r][c] = (r + c) % 2 === 0 ? first : second;
        else s.grid[r][c] = w17(r, c, s.nx, s.ny) ? second : first;
      }
    }
  }
  else if (act === 'insertSection') {
    const span = doc ? doc.sections.find((x) => x.id === sid) : null;
    vscodeApi.postMessage({ command: 'insert', text: span ? span.text + '\\n' : '' });
    return;
  }
  else if (act === 'pnnlSearch') {
    const q = document.getElementById('pnnlQ_' + sid);
    vscodeApi.postMessage({ command: 'pnnlSearch', query: q ? q.value : '', sectionId: sid });
    return;
  }
  else if (act === 'pnnlPick') {
    vscodeApi.postMessage({ command: 'pnnlAdd', id: btn.getAttribute('data-pid'), sectionId: sid });
    return;
  }
  renderSections();
  post();
});

/** Westinghouse 17×17: 24 guide-tube positions plus the central instrument tube. */
function w17(r, c, nx, ny) {
  if (nx !== 17 || ny !== 17) return false;
  const gt = [[2, 5], [2, 8], [2, 11], [3, 3], [3, 13], [5, 2], [5, 5], [5, 8], [5, 11], [5, 14],
    [8, 2], [8, 5], [8, 8], [8, 11], [8, 14], [11, 2], [11, 5], [11, 8], [11, 11], [11, 14],
    [13, 3], [13, 13], [14, 5], [14, 8], [14, 11]];
  return gt.some((p) => p[0] === r && p[1] === c);
}

document.getElementById('sections').addEventListener('input', (ev) => {
  const el = ev.target.closest('[data-sid][data-path]');
  if (!el) return;
  const s = sectionById(el.getAttribute('data-sid'));
  if (!s) return;
  const path = el.getAttribute('data-path');
  const type = el.getAttribute('data-type');
  if (type === 'number') {
    const raw = el.value.trim();
    setPath(s, path, raw === '' ? undefined : Number(raw));
  } else if (type === 'bool') {
    setPath(s, path, el.checked);
  } else if (type === 'gridsize') {
    const n = Math.max(1, Math.min(200, Number(el.value) || 1));
    setPath(s, path, n);
    resizeGrid(s);
    renderSections();
  } else if (type === 'zaids') {
    const comps = el.value.split('\\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const parts = line.split(/\\s+/);
      return { zaid: parts[0], label: parts[0], fraction: Number(parts[1] || 0) };
    });
    setPath(s, path.replace('.__zaids', '.components'), comps);
  } else if (path === '__cells') {
    s.cells = el.value.split(/[\\s,]+/).filter(Boolean).map(Number).filter((n) => Number.isFinite(n));
  } else if (path === '__surfaces') {
    s.spec.surfaces = el.value.split(/[\\s,]+/).filter(Boolean).map((tok) => ({
      id: Math.abs(Number(tok.replace(/[-+]/, ''))) || 1,
      sense: tok.trim().startsWith('-') ? '-' : '+',
    }));
  } else {
    setPath(s, path, el.value);
  }
  post();
});

document.getElementById('sections').addEventListener('change', (ev) => {
  const el = ev.target.closest('[data-sid][data-path]');
  if (!el || el.tagName !== 'SELECT') return;
  // Shape / template / mode switches change which fields exist.
  const path = el.getAttribute('data-path');
  if (path === 'shape' || path === 'mode' || path === 'spec.template' || path === 'quantity' || path.endsWith('libraryId')) {
    renderSections();
  }
});

function resizeGrid(s) {
  const fill = s.pins[0] ? s.pins[0].id : 1;
  const grid = [];
  for (let r = 0; r < s.ny; r++) {
    const row = [];
    for (let c = 0; c < s.nx; c++) row.push((s.grid[r] && s.grid[r][c]) || fill);
    grid.push(row);
  }
  s.grid = grid;
}

// Grid painting: pointerdown starts, pointerenter continues while held.
let painting = false;
document.getElementById('sections').addEventListener('pointerdown', (ev) => {
  const cell = ev.target.closest('.cell');
  if (!cell) return;
  painting = true;
  paintCell(cell);
  ev.preventDefault();
});
document.getElementById('sections').addEventListener('pointerover', (ev) => {
  if (!painting) return;
  const cell = ev.target.closest('.cell');
  if (cell) paintCell(cell);
});
window.addEventListener('pointerup', () => { if (painting) { painting = false; post(); } });

function paintCell(cell) {
  const grid = cell.closest('[data-grid]');
  if (!grid) return;
  const s = sectionById(grid.getAttribute('data-grid'));
  if (!s) return;
  const r = Number(cell.getAttribute('data-r'));
  const c = Number(cell.getAttribute('data-c'));
  if (!s.grid[r]) return;
  s.grid[r][c] = paintId;
  cell.style.background = PALETTE[(paintId - 1) % PALETTE.length];
}

document.getElementById('deck').addEventListener('click', (ev) => {
  const ln = ev.target.closest('.ln');
  if (!ln || !doc) return;
  const owner = doc.owners[Number(ln.getAttribute('data-line'))];
  if (!owner) return;
  selectedId = owner;
  expanded.add(owner);
  renderSections();
  renderDeck();
  const card = document.querySelector('.section[data-sid="' + owner + '"]');
  if (card) card.scrollIntoView({ block: 'nearest' });
});

document.getElementById('checkList').addEventListener('click', (ev) => {
  const row = ev.target.closest('[data-check]');
  if (!row) return;
  const c = (window.__checkOrder || [])[Number(row.getAttribute('data-check'))];
  if (!c) return;
  if (c.sectionId) {
    selectedId = c.sectionId;
    expanded.add(c.sectionId);
    renderSections();
  }
  renderDeck();
  if (c.line !== undefined) {
    const el = document.querySelector('.ln[data-line="' + c.line + '"]');
    if (el) el.scrollIntoView({ block: 'center' });
  }
});

// A webview exception otherwise dies silently and the panel just stops
// updating, which is impossible to diagnose from a bug report.
window.addEventListener('error', (e) => {
  vscodeApi.postMessage({
    command: 'clientError',
    message: String((e && e.message) || 'unknown error'),
    line: (e && e.lineno) || 0,
  });
});
window.addEventListener('unhandledrejection', (e) => {
  vscodeApi.postMessage({
    command: 'clientError',
    message: 'unhandled rejection: ' + String((e && e.reason && e.reason.message) || e.reason || ''),
    line: 0,
  });
});

// ------------------------------------------------------------- host messages
window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.command === 'document') {
    doc = { text: msg.text, lines: msg.lines, owners: msg.owners, sections: msg.sections, counts: msg.counts };
    checks = msg.checks || [];
    renderAll();
  } else if (msg.command === 'pnnlResults') {
    const host = document.getElementById('pnnlResults_' + msg.sectionId);
    if (!host) return;
    host.innerHTML = (msg.results || []).slice(0, 25).map((m) =>
      '<div class="check" data-act="pnnlPick" data-sid="' + msg.sectionId + '" data-pid="' + esc(m.id) + '">'
      + '<span>' + esc(m.name) + ' <span class="where">' + esc(m.density) + ' g/cm³</span></span></div>').join('')
      + '<div class="hint">' + (msg.total || 0) + ' compendium materials searched.</div>';
  } else if (msg.command === 'pnnlMaterial') {
    const s = sectionById(msg.sectionId) || model.sections.find((x) => x.kind === 'materials');
    if (!s) return;
    s.entries.push({
      key: (msg.material.name || 'pnnl').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 18),
      source: 'pnnl', pnnl: msg.material,
    });
    renderSections();
    post();
  } else if (msg.command === 'focusSection') {
    // "Open Input Builder (Lattice tab)" — select a lattice, adding one if the
    // deck has none yet.
    let lat = model.sections.find((s) => s.kind === 'lattice');
    if (!lat) { lat = newSection('lattice'); model.sections.push(lat); }
    selectedId = lat.id;
    expanded.add(lat.id);
    renderSections();
    post();
    vscodeApi.postMessage({ command: 'focusAck' });
  }
});

// ------------------------------------------------------------------ start up
document.getElementById('code').value = model.code;
document.getElementById('title').value = model.title || '';
document.getElementById('dialect').value = String(model.lineLimit || 80);
document.getElementById('dialect').style.display = model.code === 'mcnp' ? '' : 'none';
renderSections();
post();
vscodeApi.postMessage({ command: 'ready' });
</script>
</body>
</html>`;
}
