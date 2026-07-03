import * as vscode from 'vscode';
import {
    buildDeck,
    DEFAULT_SETTINGS,
    type InputBuilderState,
} from '../inputBuilder/deckBuilder';
import { MATERIAL_LIBRARY } from '../inputBuilder/materials';
import { searchPnnlMaterials, findPnnlMaterial, loadPnnlDataset } from '../inputBuilder/pnnlData';
import {
    defaultPinTypes,
    defaultStructuralIds,
    type LatticeSpec,
} from './latticeCodegen';

export class InputBuilderPanel {
    public static currentPanel: InputBuilderPanel | undefined;
    private static readonly viewType = 'owen.inputBuilder';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _targetEditor: vscode.TextEditor | undefined;

    public static createOrShow(extensionUri: vscode.Uri) {
        const activeEditor = vscode.window.activeTextEditor;
        const column = activeEditor ? activeEditor.viewColumn : undefined;

        if (InputBuilderPanel.currentPanel) {
            if (activeEditor) {
                InputBuilderPanel.currentPanel._targetEditor = activeEditor;
            }
            InputBuilderPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            InputBuilderPanel.viewType,
            'OWEN Input Builder',
            column || vscode.ViewColumn.Beside,
            { enableScripts: true, retainContextWhenHidden: true },
        );

        InputBuilderPanel.currentPanel = new InputBuilderPanel(panel, extensionUri);
        InputBuilderPanel.currentPanel._targetEditor = activeEditor;
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._panel.webview.html = this._getHtml();

        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor) this._targetEditor = editor;
        }, null, this._disposables);

        this._panel.webview.onDidReceiveMessage(async (msg) => {
            if (msg.command === 'preview') {
                const code = buildDeck(msg.state as InputBuilderState);
                this._panel.webview.postMessage({ command: 'previewResult', code });
            } else if (msg.command === 'insertCode') {
                const code = msg.code || buildDeck(msg.state as InputBuilderState);
                await this._insertCode(code);
            } else if (msg.command === 'newFile') {
                const code = msg.code || buildDeck(msg.state as InputBuilderState);
                await this._newFile(code, msg.codeLang);
            } else if (msg.command === 'openLattice') {
                vscode.commands.executeCommand('owen.openLatticeBuilder');
            } else if (msg.command === 'pnnlSearch') {
                const results = searchPnnlMaterials(String(msg.query ?? ''), 50);
                const total = loadPnnlDataset()?.materials.length ?? 0;
                this._panel.webview.postMessage({ command: 'pnnlResults', results, total });
            } else if (msg.command === 'pnnlAdd') {
                const mat = findPnnlMaterial(String(msg.id ?? ''));
                if (mat) {
                    this._panel.webview.postMessage({ command: 'pnnlMaterial', material: mat });
                }
            }
        }, null, this._disposables);

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    private async _insertCode(code: string) {
        let editor = vscode.window.activeTextEditor ?? await this._reopenTargetEditor();
        if (!editor) {
            const doc = await vscode.workspace.openTextDocument({ content: '' });
            editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
        }
        this._targetEditor = editor;
        const pos = editor.selection.active;
        await editor.edit((eb) => eb.insert(pos, code));
    }

    private async _newFile(code: string, codeLang: string) {
        const extMap: Record<string, string> = {
            mcnp: 'i', openmc: 'py', serpent: 'sss', scone: 'scone',
        };
        const ext = extMap[codeLang] || 'txt';
        const doc = await vscode.workspace.openTextDocument({
            content: code,
            language: codeLang === 'openmc' ? 'python' : codeLang,
        });
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    }

    private async _reopenTargetEditor(): Promise<vscode.TextEditor | undefined> {
        const doc = this._targetEditor?.document;
        if (!doc || doc.isClosed) return undefined;
        return vscode.window.showTextDocument(doc, this._targetEditor?.viewColumn, false);
    }

    public dispose() {
        InputBuilderPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) d.dispose();
        }
    }

    private _injectedScript(): string {
        return [
            'const MATERIAL_LIBRARY = ' + JSON.stringify(MATERIAL_LIBRARY) + ';',
            'const DEFAULT_SETTINGS = ' + JSON.stringify(DEFAULT_SETTINGS) + ';',
            'const DEFAULT_PINS = ' + JSON.stringify(defaultPinTypes()) + ';',
            'const DEFAULT_STRUCT = ' + JSON.stringify(defaultStructuralIds()) + ';',
        ].join('\n');
    }

    private _getHtml(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 14px; margin: 0; }
h2 { margin: 0 0 8px; }
.tabs { display: flex; gap: 4px; margin-bottom: 12px; flex-wrap: wrap; }
.tab { padding: 6px 12px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-button-secondaryBackground); cursor: pointer; border-radius: 3px; font-size: 12px; }
.tab.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.panel { display: none; }
.panel.active { display: block; }
label { font-size: 12px; display: block; margin: 8px 0 4px; }
input, select, textarea { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 4px 8px; border-radius: 3px; width: 100%; box-sizing: border-box; }
.mat-list { max-height: 220px; overflow-y: auto; border: 1px solid var(--vscode-panel-border); padding: 6px; }
.mat-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 12px; }
.chosen { margin-top: 8px; font-size: 12px; }
.chosen span { display: inline-block; background: var(--vscode-badge-background); padding: 2px 8px; margin: 2px; border-radius: 10px; cursor: pointer; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
pre#preview { background: var(--vscode-textCodeBlock-background); padding: 10px; font-size: 11px; white-space: pre; overflow: auto; max-height: 320px; border-radius: 4px; }
.actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: 600; }
.btn.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
.hint { font-size: 11px; opacity: 0.75; margin: 4px 0; }
.stub { padding: 12px; border: 1px dashed var(--vscode-panel-border); border-radius: 4px; opacity: 0.8; font-size: 12px; }
</style>
</head>
<body>
<h2>Input Builder</h2>
<p class="hint">Build starter MCNP / OpenMC / Serpent / SCONE decks from the material library, optional lattice, and run settings.</p>
<div class="tabs">
  <button class="tab active" data-step="0">1 Code</button>
  <button class="tab" data-step="1">2 Materials</button>
  <button class="tab" data-step="2">3 Geometry</button>
  <button class="tab" data-step="3">4 Settings</button>
  <button class="tab" data-step="4">5 Preview</button>
</div>

<div class="panel active" id="step0">
  <label>Target code</label>
  <select id="code"><option value="mcnp">MCNP</option><option value="openmc">OpenMC (Python)</option><option value="serpent">Serpent 2</option><option value="scone">SCONE</option></select>
  <label>Deck title</label>
  <input id="title" value="PWR pin-cell starter">
  <div class="stub" style="margin-top:12px">Advanced: full BEAVRS wizard, covariance decks, multi-file MCNP includes — <strong>coming soon</strong>.</div>
</div>

<div class="panel" id="step1">
  <label>Featured library (${String(MATERIAL_LIBRARY.length)} curated materials)</label>
  <div class="mat-list" id="mat-lib"></div>
  <label style="margin-top:14px">PNNL Compendium — PNNL-15870 Rev. 2 (411 materials)</label>
  <input id="pnnl-search" placeholder="Search name, formula, acronym, or element symbol…">
  <div class="mat-list" id="pnnl-lib"></div>
  <p class="hint" id="pnnl-count"></p>
  <p class="hint">Compositions from PNNL-15870 Rev. 2 (April 2021), Detwiler, McConn et al., <em>Compendium of Material Composition Data for Radiation Transport Modeling</em>, PNNL — doi.org/10.2172/1782721. S(α,β) is attached only to hydrogenous moderators.</p>
  <div class="chosen" id="chosen-mats"><span class="hint">Click materials above to add. Click a chip to remove.</span></div>
</div>

<div class="panel" id="step2">
  <label>Geometry mode</label>
  <select id="geom-mode"><option value="pin-cell">Simple pin cell</option><option value="lattice">Lattice assembly (17×17 default)</option></select>
  <p class="hint" id="geom-hint">Single fuel pin with clad and moderator — good for k-eff tutorials.</p>
  <button class="btn secondary" id="open-lattice">Open Lattice Builder for custom grid…</button>
</div>

<div class="panel" id="step3">
  <div class="grid2">
    <div><label>Particles / cycle</label><input type="number" id="particles" value="10000"></div>
    <div><label>Inactive cycles</label><input type="number" id="inactive" value="50"></div>
    <div><label>Active cycles / batches</label><input type="number" id="cycles" value="200"></div>
    <div><label>k-eff guess (MCNP)</label><input type="number" id="keff" step="0.001" value="1.0"></div>
  </div>
</div>

<div class="panel" id="step4">
  <pre id="preview"></pre>
  <div class="actions">
    <button class="btn" id="btn-insert">Insert at Cursor</button>
    <button class="btn secondary" id="btn-new">New File</button>
  </div>
</div>

<script>
const vscode = acquireVsCodeApi();
${this._injectedScript()}

let step = 0;
let chosen = [
  { ...MATERIAL_LIBRARY.find(m => m.id === 'uo2-3pct'), mcnpNumber: 1 },
  { ...MATERIAL_LIBRARY.find(m => m.id === 'zirc4'), mcnpNumber: 2 },
  { ...MATERIAL_LIBRARY.find(m => m.id === 'light-water'), mcnpNumber: 3 },
];

function defaultLatticeSpec() {
  const n = 17, pitch = 1.26;
  const grid = Array.from({length:n}, () => Array(n).fill(1));
  [[2,5],[2,8],[8,8],[8,5]].forEach(([r,c]) => { grid[r][c] = 2; });
  grid[8][8] = 3;
  return { gridSize: n, pitch, grid, pins: JSON.parse(JSON.stringify(DEFAULT_PINS)), structural: JSON.parse(JSON.stringify(DEFAULT_STRUCT)) };
}

function buildState() {
  return {
    code: document.getElementById('code').value,
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

function refreshPreview() {
  vscode.postMessage({ command: 'preview', state: buildState() });
}

window.addEventListener('message', e => {
  if (e.data.command === 'previewResult') {
    document.getElementById('preview').textContent = e.data.code;
  } else if (e.data.command === 'pnnlResults') {
    renderPnnlResults(e.data.results, e.data.total);
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
    const btn = document.createElement('button');
    btn.textContent = '+';
    btn.className = 'btn secondary';
    btn.style.width = '28px';
    btn.onclick = () => vscode.postMessage({ command: 'pnnlAdd', id: m.id });
    row.appendChild(btn);
    const desc = m.name + ' — ρ=' + m.density + ' g/cm³' + (m.formula ? ' — ' + m.formula : '');
    row.appendChild(document.createTextNode(desc));
    row.title = m.elements;
    el.appendChild(row);
  });
  document.getElementById('pnnl-count').textContent =
    results.length + (results.length >= 50 ? '+ shown' : ' shown') + ' of ' + total + ' compendium materials';
}

function addPnnlMaterial(mat) {
  if (chosen.some(c => c.id === mat.id)) return;
  chosen.push({
    id: mat.id,
    name: mat.name,
    category: 'PNNL compendium',
    density: mat.density,
    densityUnit: 'g/cm3',
    description: 'PNNL-15870 Rev. 2',
    pnnl: mat,
    mcnpNumber: chosen.length + 1,
  });
  renderChosen();
  refreshPreview();
}

let pnnlTimer = null;
document.getElementById('pnnl-search').addEventListener('input', (e) => {
  clearTimeout(pnnlTimer);
  pnnlTimer = setTimeout(() => vscode.postMessage({ command: 'pnnlSearch', query: e.target.value }), 150);
});
vscode.postMessage({ command: 'pnnlSearch', query: '' });

function renderLib() {
  const el = document.getElementById('mat-lib');
  el.innerHTML = '';
  MATERIAL_LIBRARY.forEach(m => {
    const row = document.createElement('div');
    row.className = 'mat-row';
    const btn = document.createElement('button');
    btn.textContent = '+';
    btn.className = 'btn secondary';
    btn.style.width = '28px';
    btn.onclick = () => {
      if (chosen.some(c => c.id === m.id)) return;
      chosen.push({ ...m, mcnpNumber: chosen.length + 1 });
      renderChosen();
      refreshPreview();
    };
    row.appendChild(btn);
    row.appendChild(document.createTextNode(m.name + ' — ' + m.category));
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

document.querySelectorAll('.tab').forEach(btn => {
  btn.onclick = () => {
    step = parseInt(btn.dataset.step);
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', parseInt(t.dataset.step) === step));
    document.querySelectorAll('.panel').forEach((p, i) => p.classList.toggle('active', i === step));
    if (step === 4) refreshPreview();
  };
});

document.getElementById('geom-mode').onchange = (e) => {
  document.getElementById('geom-hint').textContent = e.target.value === 'lattice'
    ? 'Generates a 17×17 lattice block via the shared Lattice Builder engine. Customize in Lattice Builder first if needed.'
    : 'Single fuel pin with clad and moderator — good for k-eff tutorials.';
  refreshPreview();
};

document.getElementById('open-lattice').onclick = () => vscode.postMessage({ command: 'openLattice' });
document.getElementById('btn-insert').onclick = () => vscode.postMessage({ command: 'insertCode', state: buildState() });
document.getElementById('btn-new').onclick = () => vscode.postMessage({ command: 'newFile', state: buildState(), codeLang: document.getElementById('code').value });

['code','title','particles','inactive','cycles','keff'].forEach(id => {
  document.getElementById(id).addEventListener('input', refreshPreview);
});

renderLib();
renderChosen();
refreshPreview();
</script>
</body>
</html>`;
    }
}
