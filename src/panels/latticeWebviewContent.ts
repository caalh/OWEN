/** Embedded lattice map editor HTML/CSS/JS for the OWEN Input Builder panel. */

export function latticeExtraStyles(): string {
    return `
.lattice-wrap h3 { margin: 10px 0 4px; font-size: 12px; opacity: 0.85; }
.lattice-wrap .controls { display: flex; gap: 10px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
.lattice-wrap .controls label { font-size: 12px; }
.lattice-wrap .controls input { width: auto; }
.lattice-wrap .pin-palette { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
.lattice-wrap .pin-btn { padding: 4px 10px; border: 2px solid transparent; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px; }
.lattice-wrap .pin-btn.active { border-color: var(--vscode-focusBorder); }
.lattice-wrap canvas#lat-grid { border: 1px solid var(--vscode-panel-border); cursor: crosshair; display: block; margin-bottom: 8px; max-width: 100%; }
.lattice-wrap .presets { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
.lattice-wrap .presets button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 4px 10px; border-radius: 3px; cursor: pointer; font-size: 11px; }
.lattice-wrap details { margin-bottom: 8px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 4px 8px; }
.lattice-wrap summary { cursor: pointer; font-weight: 600; font-size: 12px; }
.lattice-wrap table.ids { border-collapse: collapse; margin: 6px 0; font-size: 11px; }
.lattice-wrap table.ids th, .lattice-wrap table.ids td { border: 1px solid var(--vscode-panel-border); padding: 2px 5px; }
.lattice-wrap table.ids input { width: auto; padding: 2px 4px; font-size: 11px; }
.lattice-wrap table.ids input.num { width: 48px; }
.lattice-wrap table.ids input.name { width: 84px; }
.lattice-wrap table.ids input.wide { width: 180px; }
.lattice-wrap .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }
.lattice-wrap .struct-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 6px 10px; margin-top: 4px; }
.lattice-wrap .struct-grid label { font-size: 11px; display: flex; flex-direction: column; gap: 2px; }
`;
}

export function latticePanelHtml(): string {
    return `
<div class="lattice-wrap">
  <p class="hint">Paint pin types on the grid, pick a preset, then preview and insert below. Target code follows the selector above.</p>
  <div class="controls">
    <label>Grid: <input type="number" id="lat-grid-size" value="17" min="3" max="25" style="width:50px"></label>
    <label>Pitch (cm): <input type="number" id="lat-pitch" value="1.26" step="0.01" min="0.1" style="width:70px"></label>
  </div>
  <div class="pin-palette" id="lat-palette"></div>
  <div class="presets">
    <button type="button" id="lat-preset-w17">W 17×17</button>
    <button type="button" id="lat-preset-bwr">BWR 10×10</button>
    <button type="button" id="lat-preset-fuel">All Fuel</button>
  </div>
  <canvas id="lat-grid" width="420" height="420"></canvas>
  <details>
    <summary>Identifiers &amp; numbers</summary>
    <p class="hint">Edit universe IDs/names so generated code matches your deck.</p>
    <h3>Per-pin-type universe identifiers</h3>
    <table class="ids" id="lat-pin-id-table"></table>
    <h3>Structural identifiers</h3>
    <div class="struct-grid" id="lat-struct-grid"></div>
    <h3>SCONE pin shells (radii / fills)</h3>
    <table class="ids" id="lat-scone-shell-table"></table>
  </details>
</div>`;
}

/** Lattice editor bootstrap — expects genMCNP/genOpenMC/genSerpent/genSCONE/DEFAULT_PINS/DEFAULT_STRUCT injected. */
export function latticeEditorScript(): string {
    return `
const LAT_COLORS = { 1: '#4287f5', 2: '#f5a742', 3: '#42f572', 4: '#42d4f5', 5: '#f54242' };
let latPins = JSON.parse(JSON.stringify(DEFAULT_PINS));
let latStruct = JSON.parse(JSON.stringify(DEFAULT_STRUCT));
let latGridSize = 17;
let latGrid = [];
let latCurrentType = 1;
let latPainting = false;
const latCanvas = document.getElementById('lat-grid');
const latCtx = latCanvas ? latCanvas.getContext('2d') : null;

function buildLatticeSpec() {
  return { gridSize: latGridSize, pitch: parseFloat(document.getElementById('lat-pitch').value) || 1.26,
    grid: latGrid.map(r => r.slice()), pins: latPins, structural: latStruct };
}

function latticeCodeForFormat(fmt, spec) {
  if (fmt === 'mcnp') return genMCNP(spec);
  if (fmt === 'openmc') return genOpenMC(spec);
  if (fmt === 'serpent') return genSerpent(spec);
  return genSCONE(spec);
}

function latCellSize() { return Math.floor(latCanvas.width / latGridSize); }

function latRender() {
  if (!latCtx) return;
  const cs = latCellSize();
  latCtx.clearRect(0, 0, latCanvas.width, latCanvas.height);
  for (let r = 0; r < latGridSize; r++) {
    for (let c = 0; c < latGridSize; c++) {
      latCtx.fillStyle = LAT_COLORS[latGrid[r][c]] || '#555';
      latCtx.fillRect(c * cs, r * cs, cs, cs);
    }
  }
  latCtx.strokeStyle = '#555';
  for (let i = 0; i <= latGridSize; i++) {
    const pos = i * cs;
    latCtx.beginPath(); latCtx.moveTo(pos, 0); latCtx.lineTo(pos, latGridSize * cs); latCtx.stroke();
    latCtx.beginPath(); latCtx.moveTo(0, pos); latCtx.lineTo(latGridSize * cs, pos); latCtx.stroke();
  }
}

function latInitGrid(n) {
  latGridSize = n;
  latGrid = Array.from({ length: n }, () => Array(n).fill(1));
  latRender();
  onLatticeChanged();
}

function latCellAt(x, y) {
  const cs = latCellSize();
  return [Math.min(Math.floor(y / cs), latGridSize - 1), Math.min(Math.floor(x / cs), latGridSize - 1)];
}

function latMakeInput(cls, value, onInput) {
  const inp = document.createElement('input');
  inp.className = cls;
  inp.value = value;
  inp.addEventListener('input', (e) => { onInput(e.target.value); onLatticeChanged(); });
  return inp;
}

function latBuildPalette() {
  const el = document.getElementById('lat-palette');
  if (!el) return;
  el.innerHTML = '';
  latPins.forEach(p => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pin-btn' + (p.id === latCurrentType ? ' active' : '');
    btn.style.background = LAT_COLORS[p.id] || '#555';
    btn.style.color = '#111';
    btn.textContent = p.label;
    btn.onclick = () => { latCurrentType = p.id; latBuildPalette(); };
    el.appendChild(btn);
  });
}

function latCell(node) { const td = document.createElement('td'); td.appendChild(node); return td; }

function latBuildIdentifierTable() {
  const t = document.getElementById('lat-pin-id-table');
  if (!t) return;
  t.innerHTML = '';
  const head = document.createElement('tr');
  ['Pin type', 'MCNP u', 'OpenMC name', 'Serpent name', 'SCONE name', 'SCONE id'].forEach(h => {
    const th = document.createElement('th'); th.textContent = h; head.appendChild(th);
  });
  t.appendChild(head);
  latPins.forEach(p => {
    const tr = document.createElement('tr');
    const tdLabel = document.createElement('td');
    tdLabel.innerHTML = '<span class="swatch" style="background:' + (LAT_COLORS[p.id] || '#555') + '"></span>';
    tdLabel.appendChild(latMakeInput('name', p.label, v => p.label = v));
    tr.appendChild(tdLabel);
    tr.appendChild(latCell(latMakeInput('num', p.mcnpUniverse, v => p.mcnpUniverse = parseInt(v) || 0)));
    tr.appendChild(latCell(latMakeInput('name', p.openmcName, v => p.openmcName = v)));
    tr.appendChild(latCell(latMakeInput('name', p.serpentName, v => p.serpentName = v)));
    tr.appendChild(latCell(latMakeInput('name', p.sconeName, v => p.sconeName = v)));
    tr.appendChild(latCell(latMakeInput('num', p.sconeId, v => p.sconeId = parseInt(v) || 0)));
    t.appendChild(tr);
  });
  latBuildPalette();
}

function latBuildSconeShellTable() {
  const t = document.getElementById('lat-scone-shell-table');
  if (!t) return;
  t.innerHTML = '';
  const head = document.createElement('tr');
  ['Pin type', 'radii (cm)', 'fills (outer last)'].forEach(h => {
    const th = document.createElement('th'); th.textContent = h; head.appendChild(th);
  });
  t.appendChild(head);
  latPins.forEach(p => {
    const tr = document.createElement('tr');
    const tdLabel = document.createElement('td'); tdLabel.textContent = p.label; tr.appendChild(tdLabel);
    tr.appendChild(latCell(latMakeInput('wide', p.sconeRadii, v => p.sconeRadii = v)));
    tr.appendChild(latCell(latMakeInput('wide', p.sconeFills, v => p.sconeFills = v)));
    t.appendChild(tr);
  });
}

function latBuildStructGrid() {
  const g = document.getElementById('lat-struct-grid');
  if (!g) return;
  g.innerHTML = '';
  const add = (labelText, value, onInput) => {
    const lbl = document.createElement('label');
    lbl.appendChild(document.createTextNode(labelText));
    lbl.appendChild(latMakeInput('', value, onInput));
    g.appendChild(lbl);
  };
  add('MCNP lattice cell #', latStruct.mcnpCell, v => latStruct.mcnpCell = parseInt(v) || 0);
  add('MCNP lattice universe', latStruct.mcnpLatticeUniverse, v => latStruct.mcnpLatticeUniverse = parseInt(v) || 0);
  add('MCNP surfaces (+x -x +y -y)', latStruct.mcnpSurf.join(' '), v => {
    const nums = v.split(/[\\s,]+/).map(n => parseInt(n)).filter(n => !isNaN(n));
    if (nums.length === 4) latStruct.mcnpSurf = nums;
  });
  add('Serpent lat id', latStruct.serpentLatId, v => latStruct.serpentLatId = parseInt(v) || 0);
  add('OpenMC lattice variable', latStruct.openmcLatName, v => latStruct.openmcLatName = v);
  add('SCONE lattice name', latStruct.sconeLatName, v => latStruct.sconeLatName = v);
  add('SCONE lattice id', latStruct.sconeLatId, v => latStruct.sconeLatId = parseInt(v) || 0);
}

const LAT_W17_GT = [[2,5],[2,8],[2,11],[3,3],[3,13],[5,2],[5,5],[5,8],[5,11],[5,14],[8,2],[8,5],[8,11],[8,14],[11,2],[11,5],[11,8],[11,11],[11,14],[13,3],[13,13],[14,5],[14,8],[14,11]];

function latPresetW17() {
  document.getElementById('lat-grid-size').value = 17;
  latInitGrid(17);
  LAT_W17_GT.forEach(([r, c]) => { latGrid[r][c] = 2; });
  latGrid[8][8] = 3;
  latRender(); onLatticeChanged();
}

function latPresetBWR10() {
  document.getElementById('lat-grid-size').value = 10;
  document.getElementById('lat-pitch').value = '1.295';
  latInitGrid(10);
  [[3,3],[3,6],[6,3],[6,6]].forEach(([r,c]) => { latGrid[r][c] = 4; });
  latRender(); onLatticeChanged();
}

function latPresetAllFuel() { latInitGrid(latGridSize); }

function onLatticeChanged() {
  if (typeof refreshPreview === 'function') refreshPreview();
}

function initLatticeEditor() {
  if (!latCanvas) return;
  latCanvas.addEventListener('mousedown', (e) => {
    latPainting = true;
    const [r, c] = latCellAt(e.offsetX, e.offsetY);
    latGrid[r][c] = latCurrentType; latRender(); onLatticeChanged();
  });
  latCanvas.addEventListener('mousemove', (e) => {
    if (!latPainting) return;
    const [r, c] = latCellAt(e.offsetX, e.offsetY);
    latGrid[r][c] = latCurrentType; latRender(); onLatticeChanged();
  });
  latCanvas.addEventListener('mouseup', () => { latPainting = false; });
  document.getElementById('lat-grid-size')?.addEventListener('change', (e) => latInitGrid(parseInt(e.target.value)));
  document.getElementById('lat-pitch')?.addEventListener('input', onLatticeChanged);
  document.getElementById('lat-preset-w17')?.addEventListener('click', latPresetW17);
  document.getElementById('lat-preset-bwr')?.addEventListener('click', latPresetBWR10);
  document.getElementById('lat-preset-fuel')?.addEventListener('click', latPresetAllFuel);
  latBuildIdentifierTable();
  latBuildSconeShellTable();
  latBuildStructGrid();
  latInitGrid(17);
}
`;
}
