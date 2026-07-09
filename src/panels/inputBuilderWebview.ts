/** Webview HTML/JS for the OWEN Input Builder panel (kept separate for maintainability). */

import { latticeEditorScript, latticeExtraStyles, latticePanelHtml } from './latticeWebviewContent';

export function inputBuilderWebviewHtml(injectedScript: string, materialCount: number): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 12px; margin: 0; font-size: 12px; }
h2 { margin: 0 0 6px; font-size: 15px; }
.mode-tabs, .tabs { display: flex; gap: 4px; margin-bottom: 10px; flex-wrap: wrap; }
.tab, .mode-tab { padding: 5px 10px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-button-secondaryBackground); cursor: pointer; border-radius: 3px; }
.tab.active, .mode-tab.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.panel { display: none; }
.panel.active { display: block; }
label { display: block; margin: 6px 0 3px; }
input, select, textarea { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 4px 8px; border-radius: 3px; width: 100%; box-sizing: border-box; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.mat-list, .tpl-list { max-height: 160px; overflow-y: auto; border: 1px solid var(--vscode-panel-border); padding: 4px; }
.mat-row, .tpl-row { padding: 3px 0; cursor: pointer; }
.mat-row:hover, .tpl-row:hover { background: var(--vscode-list-hoverBackground); }
.chosen span { display: inline-block; background: var(--vscode-badge-background); padding: 2px 8px; margin: 2px; border-radius: 10px; cursor: pointer; }
pre#preview { background: var(--vscode-textCodeBlock-background); padding: 8px; font-size: 11px; white-space: pre; overflow: auto; max-height: 200px; border-radius: 4px; }
#validation { font-size: 11px; margin: 6px 0; min-height: 16px; }
.actions { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 14px; border-radius: 4px; cursor: pointer; font-weight: 600; }
.btn.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
.hint { font-size: 11px; opacity: 0.8; margin: 3px 0; }
.wizard-only { display: none; }
body.wizard-mode .deck-only { display: none; }
body.wizard-mode .wizard-only { display: block; }
${latticeExtraStyles()}
</style>
</head>
<body>
<h2>Input Builder</h2>
<div class="mode-tabs">
  <button class="mode-tab active" data-mode="deck">Full Deck</button>
  <button class="mode-tab" data-mode="wizard">Snippet Wizards</button>
</div>

<div id="deck-section" class="deck-only">
<div class="tabs">
  <button class="tab active" data-step="0">Code</button>
  <button class="tab" data-step="1">Materials</button>
  <button class="tab" data-step="2">Geometry</button>
  <button class="tab" data-step="3">Settings</button>
  <button class="tab" data-step="4">Preview</button>
</div>
<div class="panel active" id="step0">
  <label>Target code</label>
  <select id="code"><option value="mcnp">MCNP</option><option value="openmc">OpenMC</option><option value="serpent">Serpent 2</option><option value="scone">SCONE</option></select>
  <label>Deck title</label>
  <input id="title" value="PWR pin-cell starter">
</div>
<div class="panel" id="step1">
  <label>Featured library (${materialCount} materials)</label>
  <div class="mat-list" id="mat-lib"></div>
  <label>PNNL Compendium (411 materials)</label>
  <input id="pnnl-search" placeholder="Search name, formula, acronym…">
  <div class="mat-list" id="pnnl-lib"></div>
  <p class="hint" id="pnnl-count"></p>
  <div class="chosen" id="chosen-mats"></div>
</div>
<div class="panel" id="step2">
  <label>Geometry mode</label>
  <select id="geom-mode"><option value="pin-cell">Simple pin cell</option><option value="lattice">Lattice assembly</option></select>
  <p class="hint" id="deck-lattice-hint" style="display:none">Lattice map is configured in Snippet Wizards → Lattice tab (shared state).</p>
</div>
<div class="panel" id="step3">
  <div class="grid2">
    <div><label>Particles</label><input type="number" id="particles" value="10000"></div>
    <div><label>Inactive</label><input type="number" id="inactive" value="50"></div>
    <div><label>Active</label><input type="number" id="cycles" value="200"></div>
    <div><label>k-eff guess</label><input type="number" id="keff" step="0.001" value="1.0"></div>
  </div>
</div>
<div class="panel" id="step4"></div>
</div>

<div id="wizard-section" class="wizard-only">
  <label>Search template library</label>
  <input id="tpl-search" placeholder="PWR pin, material, kcode…">
  <div class="tpl-list" id="tpl-lib"></div>
  <div class="tabs" style="margin-top:10px">
    <button class="tab wiz-tab active" data-wiz="material">Material</button>
    <button class="tab wiz-tab" data-wiz="surface">Surface</button>
    <button class="tab wiz-tab" data-wiz="cell">Cell</button>
    <button class="tab wiz-tab" data-wiz="lattice">Lattice</button>
    <button class="tab wiz-tab" data-wiz="source">Source</button>
    <button class="tab wiz-tab" data-wiz="settings">Settings</button>
  </div>
  <div class="panel wiz-panel active" id="wiz-material">
    <div class="grid2">
      <div><label>Name</label><input id="w-mat-name" value="UO2 fuel"></div>
      <div><label>m-number</label><input type="number" id="w-mat-num" value="1"></div>
      <div><label>Density mode</label><select id="w-dens-mode"><option value="weight">Weight (g/cm³)</option><option value="atom">Atom (atoms/b·cm)</option></select></div>
      <div><label>Density</label><input type="number" id="w-dens" step="0.01" value="10.97"></div>
      <div><label>Fraction mode</label><select id="w-frac-mode"><option value="weight">Weight</option><option value="atom">Atom</option></select></div>
      <div><label>S(α,β)</label><select id="w-sab"><option value="">(none)</option></select></div>
    </div>
    <label>Components (ZAID fraction label per line)</label>
    <textarea id="w-comps" rows="4">92235 0.01 U235
92238 0.323 U238
8016 0.667 O16</textarea>
    <p class="hint">lwtr.20t attaches only to hydrogen-bearing moderators — never UO₂.</p>
  </div>
  <div class="panel wiz-panel" id="wiz-surface">
    <div class="grid2">
      <div><label>Surface #</label><input type="number" id="w-surf-num" value="1"></div>
      <div><label>Template</label><select id="w-surf-tpl"></select></div>
    </div>
    <p class="hint" id="w-surf-hint"></p>
    <div class="grid2" id="w-surf-params"></div>
    <label>Comment</label><input id="w-surf-cmt" value="fuel pin">
  </div>
  <div class="panel wiz-panel" id="wiz-cell">
    <div class="grid2">
      <div><label>Cell #</label><input type="number" id="w-cell-num" value="10"></div>
      <div><label>Material (0=void)</label><input type="number" id="w-cell-mat" value="1"></div>
      <div><label>Density (neg=g/cm³)</label><input type="number" id="w-cell-dens" step="0.01" value="-10.44"></div>
      <div><label>imp:n</label><input type="number" id="w-cell-imp" value="1"></div>
    </div>
    <label>Surfaces (e.g. -1 4 -5)</label><input id="w-cell-surfs" value="-1 4 -5">
    <label>Operator</label><select id="w-cell-op"><option value="intersection">Intersection</option><option value="union">Union</option></select>
    <label>Comment</label><input id="w-cell-cmt" value="fuel">
  </div>
  <div class="panel wiz-panel" id="wiz-lattice">
    ${latticePanelHtml()}
  </div>
  <div class="panel wiz-panel" id="wiz-source">
    <div class="grid2">
      <div><label>Particles</label><input type="number" id="w-src-n" value="10000"></div>
      <div><label>Inactive</label><input type="number" id="w-src-inact" value="50"></div>
      <div><label>Active</label><input type="number" id="w-src-act" value="200"></div>
      <div><label>k-eff guess</label><input type="number" id="w-src-keff" step="0.001" value="1.0"></div>
      <div><label>ksrc X</label><input type="number" id="w-src-x" value="0"></div>
      <div><label>ksrc Y</label><input type="number" id="w-src-y" value="0"></div>
      <div><label>ksrc Z</label><input type="number" id="w-src-z" value="182.88"></div>
    </div>
  </div>
  <div class="panel wiz-panel" id="wiz-settings">
    <div class="grid2">
      <div><label>Particles</label><input type="number" id="w-set-n" value="10000"></div>
      <div><label>Inactive</label><input type="number" id="w-set-inact" value="50"></div>
      <div><label>Active/batches</label><input type="number" id="w-set-act" value="200"></div>
      <div><label>k-eff guess</label><input type="number" id="w-set-keff" value="1.0"></div>
      <div><label>OpenMC threads</label><input type="number" id="w-set-threads" value="0"></div>
    </div>
  </div>
</div>

<p id="validation"></p>
<pre id="preview"></pre>
<div class="actions">
  <button class="btn" id="btn-insert">Insert at Cursor</button>
  <button class="btn secondary" id="btn-new">New File</button>
</div>

<script>
const vscode = acquireVsCodeApi();
${injectedScript}

let mode = 'deck';
let deckStep = 0;
let wizKind = 'material';
let previewCode = '';
let recentTemplates = JSON.parse(localStorage.getItem('owen-ib-recent') || '[]');

let chosen = [
  { ...MATERIAL_LIBRARY.find(m => m.id === 'uo2-3pct'), mcnpNumber: 1 },
  { ...MATERIAL_LIBRARY.find(m => m.id === 'zirc4'), mcnpNumber: 2 },
  { ...MATERIAL_LIBRARY.find(m => m.id === 'light-water'), mcnpNumber: 3 },
];

function getCode() {
  return document.getElementById('code').value;
}

function defaultLatticeSpec() {
  if (typeof buildLatticeSpec === 'function') return buildLatticeSpec();
  const n = 17, pitch = 1.26;
  const grid = Array.from({length:n}, () => Array(n).fill(1));
  [[2,5],[2,8],[8,8],[8,5]].forEach(([r,c]) => { grid[r][c] = 2; });
  grid[8][8] = 3;
  return { gridSize: n, pitch, grid, pins: JSON.parse(JSON.stringify(DEFAULT_PINS)), structural: JSON.parse(JSON.stringify(DEFAULT_STRUCT)) };
}

function buildDeckState() {
  return {
    code: getCode(),
    title: document.getElementById('title').value,
    materials: chosen.map((m, i) => ({ ...m, mcnpNumber: m.mcnpNumber || (i + 1) })),
    geometryMode: document.getElementById('geom-mode').value,
    lattice: document.getElementById('geom-mode').value === 'lattice' ? defaultLatticeSpec() : null,
    settings: {
      particles: parseInt(document.getElementById('particles').value) || 10000,
      inactive: parseInt(document.getElementById('inactive').value) || 50,
      cycles: parseInt(document.getElementById('cycles').value) || 200,
      keffGuess: parseFloat(document.getElementById('keff').value) || 1.0,
    },
  };
}

function parseComponents(text) {
  return text.trim().split('\\n').map(line => {
    const p = line.trim().split(/\\s+/);
    if (p.length < 2) return null;
    return { zaid: p[0], fraction: parseFloat(p[1]), label: p[2] || p[0] };
  }).filter(Boolean);
}

function parseSurfaces(text) {
  return text.trim().split(/\\s+/).map(tok => {
    let sense = '-', rest = tok;
    if (tok[0] === '-' || tok[0] === '+') { sense = tok[0]; rest = tok.slice(1); }
    return { id: parseInt(rest), sense };
  }).filter(s => !isNaN(s.id));
}

function buildWizardState(kind) {
  const code = getCode();
  if (kind === 'material') return {
    code, matNumber: parseInt(document.getElementById('w-mat-num').value) || 1,
    name: document.getElementById('w-mat-name').value,
    densityMode: document.getElementById('w-dens-mode').value,
    density: parseFloat(document.getElementById('w-dens').value) || 1,
    fractionMode: document.getElementById('w-frac-mode').value,
    components: parseComponents(document.getElementById('w-comps').value),
    sab: document.getElementById('w-sab').value || undefined,
  };
  if (kind === 'surface') {
    const tpl = document.getElementById('w-surf-tpl').value;
    const st = { code, surfaceNumber: parseInt(document.getElementById('w-surf-num').value) || 1, template: tpl, comment: document.getElementById('w-surf-cmt').value };
    const g = id => parseFloat(document.getElementById(id)?.value || '0');
    if (tpl === 'rcc-pin') st.rcc = { x: g('w-rcc-x'), y: g('w-rcc-y'), z: g('w-rcc-z'), height: g('w-rcc-h'), radius: g('w-rcc-r') };
    if (tpl === 'rpp-box') st.rpp = { xmin: g('w-rpp-xmin'), xmax: g('w-rpp-xmax'), ymin: g('w-rpp-ymin'), ymax: g('w-rpp-ymax'), zmin: g('w-rpp-zmin'), zmax: g('w-rpp-zmax') };
    if (tpl === 'sphere') st.sphere = { x: g('w-sph-x'), y: g('w-sph-y'), z: g('w-sph-z'), radius: g('w-sph-r') };
    return st;
  }
  if (kind === 'cell') return {
    code, cellNumber: parseInt(document.getElementById('w-cell-num').value) || 10,
    material: parseInt(document.getElementById('w-cell-mat').value) === 0 ? 'void' : parseInt(document.getElementById('w-cell-mat').value),
    density: parseFloat(document.getElementById('w-cell-dens').value),
    surfaces: parseSurfaces(document.getElementById('w-cell-surfs').value),
    operator: document.getElementById('w-cell-op').value,
    imp: parseInt(document.getElementById('w-cell-imp').value),
    comment: document.getElementById('w-cell-cmt').value,
  };
  if (kind === 'lattice') return buildLatticeSpec();
  if (kind === 'source') return {
    code, particles: parseInt(document.getElementById('w-src-n').value) || 10000,
    inactive: parseInt(document.getElementById('w-src-inact').value) || 50,
    active: parseInt(document.getElementById('w-src-act').value) || 200,
    keffGuess: parseFloat(document.getElementById('w-src-keff').value) || 1,
    x: parseFloat(document.getElementById('w-src-x').value) || 0,
    y: parseFloat(document.getElementById('w-src-y').value) || 0,
    z: parseFloat(document.getElementById('w-src-z').value) || 0,
  };
  return {
    code, particles: parseInt(document.getElementById('w-set-n').value) || 10000,
    inactive: parseInt(document.getElementById('w-set-inact').value) || 50,
    active: parseInt(document.getElementById('w-set-act').value) || 200,
    keffGuess: parseFloat(document.getElementById('w-set-keff').value) || 1,
    threads: parseInt(document.getElementById('w-set-threads').value) || undefined,
  };
}

function refreshPreview() {
  if (mode === 'deck') {
    vscode.postMessage({ command: 'preview', state: buildDeckState() });
  } else if (wizKind === 'lattice') {
    const spec = buildLatticeSpec();
    vscode.postMessage({ command: 'latticePreview', spec, code: getCode() });
  } else {
    vscode.postMessage({ command: 'wizardPreview', wizard: wizKind, state: buildWizardState(wizKind) });
  }
}

function showValidation(summary, issues) {
  const el = document.getElementById('validation');
  el.textContent = summary || '';
  el.style.color = issues && issues.some(i => i.severity === 'error') ? 'var(--vscode-errorForeground)' :
    (issues && issues.length ? 'var(--vscode-editorWarning-foreground)' : 'var(--vscode-testing-iconPassed)');
}

window.addEventListener('message', e => {
  if (e.data.command === 'previewResult' || e.data.command === 'wizardPreviewResult') {
    previewCode = e.data.code;
    document.getElementById('preview').textContent = previewCode;
    showValidation(e.data.validationSummary, e.data.validation);
  } else if (e.data.command === 'pnnlResults') {
    renderPnnlResults(e.data.results, e.data.total);
  } else if (e.data.command === 'focusTab') {
    if (e.data.tab === 'lattice') {
      document.querySelector('[data-mode="wizard"]')?.click();
      document.querySelector('[data-wiz="lattice"]')?.click();
    }
    vscode.postMessage({ command: 'focusAck' });
  } else if (e.data.command === 'pnnlMaterial') {
    addPnnlMaterial(e.data.material);
  }
});

function renderPnnlResults(results, total) {
  const el = document.getElementById('pnnl-lib');
  el.innerHTML = '';
  results.forEach(m => {
    const row = document.createElement('div');
    row.className = 'mat-row';
    row.textContent = m.name + ' — ρ=' + m.density;
    row.onclick = () => vscode.postMessage({ command: 'pnnlAdd', id: m.id });
    el.appendChild(row);
  });
  document.getElementById('pnnl-count').textContent = results.length + ' of ' + total;
}

function addPnnlMaterial(mat) {
  if (chosen.some(c => c.id === mat.id)) return;
  chosen.push({ id: mat.id, name: mat.name, category: 'PNNL', density: mat.density, densityUnit: 'g/cm3', description: 'PNNL-15870', pnnl: mat, mcnpNumber: chosen.length + 1 });
  renderChosen();
  refreshPreview();
}

function renderLib() {
  const el = document.getElementById('mat-lib');
  el.innerHTML = '';
  MATERIAL_LIBRARY.forEach(m => {
    const row = document.createElement('div');
    row.className = 'mat-row';
    row.textContent = m.name;
    row.onclick = () => {
      if (!chosen.some(c => c.id === m.id)) {
        chosen.push({ ...m, mcnpNumber: chosen.length + 1 });
        renderChosen();
        refreshPreview();
      }
    };
    el.appendChild(row);
  });
}

function renderChosen() {
  const el = document.getElementById('chosen-mats');
  el.innerHTML = '';
  chosen.forEach((m, i) => {
    const chip = document.createElement('span');
    chip.textContent = 'm' + (m.mcnpNumber || i+1) + ' ' + m.name + ' ×';
    chip.onclick = () => { chosen = chosen.filter((_, j) => j !== i); renderChosen(); refreshPreview(); };
    el.appendChild(chip);
  });
}

function renderTemplates() {
  const q = (document.getElementById('tpl-search').value || '').toLowerCase();
  const el = document.getElementById('tpl-lib');
  el.innerHTML = '';
  const show = t => !q || t.label.toLowerCase().includes(q) || t.category.toLowerCase().includes(q);
  recentTemplates.forEach(id => {
    const t = INPUT_BUILDER_TEMPLATES.find(x => x.id === id);
    if (t && show(t)) {
      const row = document.createElement('div');
      row.className = 'tpl-row';
      row.textContent = '★ ' + t.label;
      row.onclick = () => jumpTemplate(t);
      el.appendChild(row);
    }
  });
  INPUT_BUILDER_TEMPLATES.forEach(t => {
    if (!show(t) || recentTemplates.includes(t.id)) return;
    const row = document.createElement('div');
    row.className = 'tpl-row';
    row.textContent = t.label + ' [' + t.category + ']';
    row.onclick = () => jumpTemplate(t);
    el.appendChild(row);
  });
}

function jumpTemplate(t) {
  recentTemplates = [t.id, ...recentTemplates.filter(x => x !== t.id)].slice(0, 8);
  localStorage.setItem('owen-ib-recent', JSON.stringify(recentTemplates));
  if (t.wizard === 'deck') {
    document.querySelector('[data-mode="deck"]').click();
  } else {
    document.querySelector('[data-mode="wizard"]').click();
    document.querySelector('[data-wiz="' + t.wizard + '"]')?.click();
  }
  renderTemplates();
  refreshPreview();
}

function initSab() {
  const sel = document.getElementById('w-sab');
  SAB_OPTIONS.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.label;
    sel.appendChild(opt);
  });
}

function initSurfaceTpl() {
  const sel = document.getElementById('w-surf-tpl');
  SURFACE_TEMPLATES.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.label;
    sel.appendChild(opt);
  });
  sel.onchange = updateSurfaceFields;
  updateSurfaceFields();
}

function updateSurfaceFields() {
  const tpl = document.getElementById('w-surf-tpl').value;
  const meta = SURFACE_TEMPLATES.find(t => t.id === tpl);
  document.getElementById('w-surf-hint').textContent = meta ? meta.hint : '';
  const box = document.getElementById('w-surf-params');
  box.innerHTML = '';
  const defs = {
    'rcc-pin': [['w-rcc-x','x',0],['w-rcc-y','y',0],['w-rcc-z','z',0],['w-rcc-h','height',365.76],['w-rcc-r','radius',0.39218]],
    'rpp-box': [['w-rpp-xmin','xmin',-10],['w-rpp-xmax','xmax',10],['w-rpp-ymin','ymin',-10],['w-rpp-ymax','ymax',10],['w-rpp-zmin','zmin',0],['w-rpp-zmax','zmax',365.76]],
    'sphere': [['w-sph-x','x',0],['w-sph-y','y',0],['w-sph-z','z',0],['w-sph-r','radius',50]],
  };
  (defs[tpl] || []).forEach(([id, label, val]) => {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<label>' + label + '</label><input type="number" id="' + id + '" value="' + val + '">';
    box.appendChild(wrap);
    wrap.querySelector('input').addEventListener('input', refreshPreview);
  });
  refreshPreview();
}

document.querySelectorAll('.mode-tab').forEach(btn => {
  btn.onclick = () => {
    mode = btn.dataset.mode;
    document.querySelectorAll('.mode-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
    document.body.classList.toggle('wizard-mode', mode === 'wizard');
    document.getElementById('deck-section').style.display = mode === 'deck' ? 'block' : 'none';
    document.getElementById('wizard-section').style.display = mode === 'wizard' ? 'block' : 'none';
    refreshPreview();
  };
});

document.querySelectorAll('.tab[data-step]').forEach(btn => {
  btn.onclick = () => {
    deckStep = parseInt(btn.dataset.step);
    document.querySelectorAll('.tab[data-step]').forEach(t => t.classList.toggle('active', parseInt(t.dataset.step) === deckStep));
    document.querySelectorAll('#deck-section .panel').forEach((p, i) => p.classList.toggle('active', i === deckStep));
    if (deckStep === 4) refreshPreview();
  };
});

document.querySelectorAll('.wiz-tab').forEach(btn => {
  btn.onclick = () => {
    wizKind = btn.dataset.wiz;
    document.querySelectorAll('.wiz-tab').forEach(t => t.classList.toggle('active', t.dataset.wiz === wizKind));
    document.querySelectorAll('.wiz-panel').forEach(p => p.classList.toggle('active', p.id === 'wiz-' + wizKind));
    refreshPreview();
  };
});

document.getElementById('open-lattice')?.remove();
document.getElementById('open-lattice2')?.remove();
document.getElementById('btn-insert').onclick = () => {
  if (mode === 'deck') vscode.postMessage({ command: 'insertCode', state: buildDeckState(), code: previewCode });
  else vscode.postMessage({ command: 'insertCode', code: previewCode, codeLang: getCode() });
};
document.getElementById('btn-new').onclick = () => {
  if (mode === 'deck') vscode.postMessage({ command: 'newFile', state: buildDeckState(), code: previewCode, codeLang: getCode() });
  else vscode.postMessage({ command: 'newFile', code: previewCode, codeLang: getCode() });
};

document.getElementById('tpl-search').addEventListener('input', renderTemplates);
document.getElementById('pnnl-search').addEventListener('input', e => {
  clearTimeout(window._pnnlT);
  window._pnnlT = setTimeout(() => vscode.postMessage({ command: 'pnnlSearch', query: e.target.value }), 150);
});

['code','title','particles','inactive','cycles','keff','geom-mode'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', refreshPreview);
  document.getElementById(id)?.addEventListener('change', () => {
    if (id === 'geom-mode') {
      const hint = document.getElementById('deck-lattice-hint');
      if (hint) hint.style.display = document.getElementById('geom-mode').value === 'lattice' ? 'block' : 'none';
    }
    refreshPreview();
  });
});
document.querySelectorAll('#wizard-section input, #wizard-section select, #wizard-section textarea').forEach(el => {
  el.addEventListener('input', refreshPreview);
  el.addEventListener('change', refreshPreview);
});

${latticeEditorScript()}
initSab();
initSurfaceTpl();
initLatticeEditor();
renderLib();
renderChosen();
renderTemplates();
vscode.postMessage({ command: 'pnnlSearch', query: '' });
refreshPreview();
vscode.postMessage({ command: 'ready' });
</script>
</body>
</html>`;
}
