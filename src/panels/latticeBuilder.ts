import * as vscode from 'vscode';
import {
    genMCNP,
    genOpenMC,
    genSerpent,
    genSCONE,
    defaultPinTypes,
    defaultStructuralIds,
} from './latticeCodegen';

export class LatticeBuilderPanel {
    public static currentPanel: LatticeBuilderPanel | undefined;
    private static readonly viewType = 'owen.latticeBuilder';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _targetEditor: vscode.TextEditor | undefined;

    public static createOrShow(extensionUri: vscode.Uri) {
        const activeEditor = vscode.window.activeTextEditor;
        const column = activeEditor ? activeEditor.viewColumn : undefined;

        if (LatticeBuilderPanel.currentPanel) {
            if (activeEditor) {
                LatticeBuilderPanel.currentPanel._targetEditor = activeEditor;
            }
            LatticeBuilderPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            LatticeBuilderPanel.viewType,
            'OWEN Lattice Builder',
            column || vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        LatticeBuilderPanel.currentPanel = new LatticeBuilderPanel(panel, extensionUri);
        LatticeBuilderPanel.currentPanel._targetEditor = activeEditor;
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._panel.webview.html = this._getHtml();

        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor) {
                this._targetEditor = editor;
            }
        }, null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            (message) => {
                switch (message.command) {
                    case 'insertCode':
                        this._insertCode(message.code);
                        return;
                }
            },
            null,
            this._disposables
        );

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    private async _insertCode(code: string) {
        let editor = vscode.window.activeTextEditor ?? await this._reopenTargetEditor();
        if (!editor) {
            const document = await vscode.workspace.openTextDocument({ content: '' });
            editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
        }
        this._targetEditor = editor;

        const position = editor.selection.active;
        await editor.edit((editBuilder) => {
            editBuilder.insert(position, code);
        });
    }

    private async _reopenTargetEditor(): Promise<vscode.TextEditor | undefined> {
        const document = this._targetEditor?.document;
        if (!document || document.isClosed) {
            return undefined;
        }
        return vscode.window.showTextDocument(document, this._targetEditor?.viewColumn, false);
    }

    public dispose() {
        LatticeBuilderPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) { d.dispose(); }
        }
    }

    // The four generators live in `latticeCodegen.ts` (pure, vscode-free, unit
    // tested). We inject their source straight into the webview via toString()
    // so the live preview runs the EXACT same logic the tests assert against —
    // no duplicated generator code. The generators are self-contained, so this
    // survives esbuild's production minification.
    private _injectedCodegen(): string {
        return [
            'const genMCNP = ' + genMCNP.toString() + ';',
            'const genOpenMC = ' + genOpenMC.toString() + ';',
            'const genSerpent = ' + genSerpent.toString() + ';',
            'const genSCONE = ' + genSCONE.toString() + ';',
            'const DEFAULT_PINS = ' + JSON.stringify(defaultPinTypes()) + ';',
            'const DEFAULT_STRUCT = ' + JSON.stringify(defaultStructuralIds()) + ';',
        ].join('\n');
    }

    private _getHtml(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OWEN Lattice Builder</title>
    <style>
        body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; }
        h2 { margin-top: 0; }
        h3 { margin: 14px 0 6px; font-size: 13px; opacity: 0.85; }
        .controls { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
        .controls label { font-size: 13px; }
        .controls select, .controls input { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 4px 8px; border-radius: 3px; }
        .pin-palette { display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
        .pin-btn { padding: 4px 12px; border: 2px solid transparent; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px; }
        .pin-btn.active { border-color: var(--vscode-focusBorder); }
        canvas { border: 1px solid var(--vscode-panel-border); cursor: crosshair; display: block; margin-bottom: 12px; }
        .presets { display: flex; gap: 8px; margin-bottom: 12px; }
        .presets button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 4px 12px; border-radius: 3px; cursor: pointer; }
        .presets button:hover { background: var(--vscode-button-secondaryHoverBackground); }
        details { margin-bottom: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 6px 10px; }
        summary { cursor: pointer; font-weight: bold; font-size: 13px; }
        table.ids { border-collapse: collapse; margin: 8px 0; font-size: 12px; }
        table.ids th, table.ids td { border: 1px solid var(--vscode-panel-border); padding: 3px 6px; text-align: left; }
        table.ids th { opacity: 0.8; font-weight: 600; }
        table.ids input { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 3px; padding: 2px 5px; }
        table.ids input.num { width: 52px; }
        table.ids input.name { width: 92px; }
        table.ids input.wide { width: 200px; }
        .swatch { display: inline-block; width: 11px; height: 11px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
        .struct-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px 14px; margin-top: 6px; }
        .struct-grid label { font-size: 12px; display: flex; flex-direction: column; gap: 2px; }
        .struct-grid input { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 3px; padding: 3px 6px; }
        #code-preview { background: var(--vscode-textCodeBlock-background); padding: 12px; border-radius: 4px; font-family: var(--vscode-editor-font-family); font-size: 12px; white-space: pre; overflow-x: auto; max-height: 300px; overflow-y: auto; }
        .insert-btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 24px; border-radius: 4px; cursor: pointer; font-weight: bold; margin-top: 8px; }
        .insert-btn:hover { background: var(--vscode-button-hoverBackground); }
        .hint { font-size: 11px; opacity: 0.7; margin: 2px 0 0; }
    </style>
</head>
<body>
    <h2>Lattice Builder</h2>
    <div class="controls">
        <label>Grid: <input type="number" id="grid-size" value="17" min="3" max="25" style="width:50px"></label>
        <label>Pitch (cm): <input type="number" id="pitch" value="1.26" step="0.01" min="0.1" style="width:70px"></label>
        <label>Format:
            <select id="format">
                <option value="mcnp">MCNP</option>
                <option value="openmc">OpenMC</option>
                <option value="serpent">Serpent</option>
                <option value="scone">SCONE</option>
            </select>
        </label>
    </div>
    <div class="pin-palette" id="palette"></div>
    <div class="presets">
        <button onclick="presetW17()">W 17x17</button>
        <button onclick="presetBWR10()">BWR 10x10</button>
        <button onclick="presetAllFuel()">All Fuel</button>
    </div>
    <canvas id="grid" width="500" height="500"></canvas>

    <details open>
        <summary>Identifiers &amp; numbers</summary>
        <p class="hint">Edit these so generated code matches the universe IDs/names already in your deck. Values flow into the live preview below.</p>
        <h3>Per-pin-type universe identifiers</h3>
        <table class="ids" id="pin-id-table"></table>
        <h3>Structural identifiers</h3>
        <div class="struct-grid" id="struct-grid"></div>
        <h3>SCONE pin shells (radii / fills — outermost radius 0.0 = fills to cell edge)</h3>
        <table class="ids" id="scone-shell-table"></table>
    </details>

    <pre id="code-preview"></pre>
    <button class="insert-btn" onclick="insertCode()">Insert at Cursor</button>

    <script>
        const vscode = acquireVsCodeApi();
        ${this._injectedCodegen()}

        // Display colors (codegen does not need them).
        const COLORS = { 1: '#4287f5', 2: '#f5a742', 3: '#42f572', 4: '#42d4f5', 5: '#f54242' };

        // Editable identifier state (deep copies of the injected defaults).
        let pins = JSON.parse(JSON.stringify(DEFAULT_PINS));
        let struct = JSON.parse(JSON.stringify(DEFAULT_STRUCT));

        let gridSize = 17;
        let grid = [];
        let currentType = 1;
        let painting = false;
        const canvas = document.getElementById('grid');
        const ctx = canvas.getContext('2d');

        function pinById(id) { return pins.find(p => p.id === id); }

        function buildSpec() {
            return { gridSize: gridSize, pitch: parseFloat(document.getElementById('pitch').value), grid: grid, pins: pins, structural: struct };
        }

        function initGrid(n) {
            gridSize = n;
            grid = Array.from({ length: n }, () => Array(n).fill(1));
            render();
            refreshCode();
        }

        function cellSize() { return Math.floor(canvas.width / gridSize); }

        function render() {
            const cs = cellSize();
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            for (let r = 0; r < gridSize; r++) {
                for (let c = 0; c < gridSize; c++) {
                    ctx.fillStyle = COLORS[grid[r][c]] || '#555';
                    ctx.fillRect(c * cs, r * cs, cs, cs);
                }
            }
            ctx.strokeStyle = '#555';
            for (let i = 0; i <= gridSize; i++) {
                ctx.beginPath(); ctx.moveTo(i * cs, 0); ctx.lineTo(i * cs, gridSize * cs); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(0, i * cs); ctx.lineTo(gridSize * cs, i * cs); ctx.stroke();
            }
        }

        function cellAt(x, y) {
            const cs = cellSize();
            return [Math.min(Math.floor(y / cs), gridSize - 1), Math.min(Math.floor(x / cs), gridSize - 1)];
        }

        canvas.addEventListener('mousedown', (e) => { painting = true; const [r, c] = cellAt(e.offsetX, e.offsetY); grid[r][c] = currentType; render(); refreshCode(); });
        canvas.addEventListener('mousemove', (e) => { if (!painting) return; const [r, c] = cellAt(e.offsetX, e.offsetY); grid[r][c] = currentType; render(); refreshCode(); });
        canvas.addEventListener('mouseup', () => { painting = false; });

        function buildPalette() {
            const el = document.getElementById('palette');
            el.innerHTML = '';
            pins.forEach(p => {
                const btn = document.createElement('button');
                btn.className = 'pin-btn' + (p.id === currentType ? ' active' : '');
                btn.style.background = COLORS[p.id] || '#555';
                btn.style.color = '#111';
                btn.textContent = p.label;
                btn.onclick = () => { currentType = p.id; buildPalette(); };
                el.appendChild(btn);
            });
        }

        function makeInput(cls, value, onInput) {
            const inp = document.createElement('input');
            inp.className = cls;
            inp.value = value;
            inp.addEventListener('input', (e) => { onInput(e.target.value); refreshCode(); });
            return inp;
        }

        function buildIdentifierTable() {
            const t = document.getElementById('pin-id-table');
            t.innerHTML = '';
            const head = document.createElement('tr');
            ['Pin type', 'MCNP u', 'OpenMC name', 'Serpent name', 'SCONE name', 'SCONE id'].forEach(h => {
                const th = document.createElement('th'); th.textContent = h; head.appendChild(th);
            });
            t.appendChild(head);
            pins.forEach(p => {
                const tr = document.createElement('tr');
                const tdLabel = document.createElement('td');
                tdLabel.innerHTML = '<span class="swatch" style="background:' + (COLORS[p.id] || '#555') + '"></span>';
                tdLabel.appendChild(makeInput('name', p.label, v => p.label = v));
                tr.appendChild(tdLabel);
                tr.appendChild(cell(makeInput('num', p.mcnpUniverse, v => p.mcnpUniverse = parseInt(v) || 0)));
                tr.appendChild(cell(makeInput('name', p.openmcName, v => p.openmcName = v)));
                tr.appendChild(cell(makeInput('name', p.serpentName, v => p.serpentName = v)));
                tr.appendChild(cell(makeInput('name', p.sconeName, v => p.sconeName = v)));
                tr.appendChild(cell(makeInput('num', p.sconeId, v => p.sconeId = parseInt(v) || 0)));
                t.appendChild(tr);
            });
            buildPalette();
        }

        function cell(node) { const td = document.createElement('td'); td.appendChild(node); return td; }

        function buildSconeShellTable() {
            const t = document.getElementById('scone-shell-table');
            t.innerHTML = '';
            const head = document.createElement('tr');
            ['Pin type', 'radii (cm)', 'fills (outer last)'].forEach(h => {
                const th = document.createElement('th'); th.textContent = h; head.appendChild(th);
            });
            t.appendChild(head);
            pins.forEach(p => {
                const tr = document.createElement('tr');
                const tdLabel = document.createElement('td'); tdLabel.textContent = p.label; tr.appendChild(tdLabel);
                tr.appendChild(cell(makeInput('wide', p.sconeRadii, v => p.sconeRadii = v)));
                tr.appendChild(cell(makeInput('wide', p.sconeFills, v => p.sconeFills = v)));
                t.appendChild(tr);
            });
        }

        function buildStructGrid() {
            const g = document.getElementById('struct-grid');
            g.innerHTML = '';
            const add = (labelText, value, onInput) => {
                const lbl = document.createElement('label');
                lbl.appendChild(document.createTextNode(labelText));
                lbl.appendChild(makeInput('', value, onInput));
                g.appendChild(lbl);
            };
            add('MCNP lattice cell #', struct.mcnpCell, v => struct.mcnpCell = parseInt(v) || 0);
            add('MCNP lattice universe', struct.mcnpLatticeUniverse, v => struct.mcnpLatticeUniverse = parseInt(v) || 0);
            add('MCNP surfaces (+x -x +y -y)', struct.mcnpSurf.join(' '), v => {
                const nums = v.split(/[\\s,]+/).map(n => parseInt(n)).filter(n => !isNaN(n));
                if (nums.length === 4) struct.mcnpSurf = nums;
            });
            add('Serpent lat id', struct.serpentLatId, v => struct.serpentLatId = parseInt(v) || 0);
            add('OpenMC lattice variable', struct.openmcLatName, v => struct.openmcLatName = v);
            add('SCONE lattice name', struct.sconeLatName, v => struct.sconeLatName = v);
            add('SCONE lattice id', struct.sconeLatId, v => struct.sconeLatId = parseInt(v) || 0);
        }

        const W17_GT = [[2,5],[2,8],[2,11],[3,3],[3,13],[5,2],[5,5],[5,8],[5,11],[5,14],[8,2],[8,5],[8,11],[8,14],[11,2],[11,5],[11,8],[11,11],[11,14],[13,3],[13,13],[14,5],[14,8],[14,11]];

        function presetW17() {
            document.getElementById('grid-size').value = 17;
            initGrid(17);
            W17_GT.forEach(([r, c]) => { grid[r][c] = 2; });
            grid[8][8] = 3;
            render(); refreshCode();
        }

        function presetBWR10() {
            document.getElementById('grid-size').value = 10;
            document.getElementById('pitch').value = '1.295';
            initGrid(10);
            [[3,3],[3,6],[6,3],[6,6]].forEach(([r,c]) => { grid[r][c] = 4; });
            render(); refreshCode();
        }

        function presetAllFuel() { initGrid(gridSize); }

        function refreshCode() {
            const fmt = document.getElementById('format').value;
            const spec = buildSpec();
            let code = '';
            if (fmt === 'mcnp') code = genMCNP(spec);
            else if (fmt === 'openmc') code = genOpenMC(spec);
            else if (fmt === 'serpent') code = genSerpent(spec);
            else code = genSCONE(spec);
            document.getElementById('code-preview').textContent = code;
        }

        function insertCode() {
            const code = document.getElementById('code-preview').textContent;
            vscode.postMessage({ command: 'insertCode', code: code });
        }

        document.getElementById('grid-size').addEventListener('change', (e) => { initGrid(parseInt(e.target.value)); });
        document.getElementById('pitch').addEventListener('change', refreshCode);
        document.getElementById('format').addEventListener('change', refreshCode);

        buildIdentifierTable();
        buildSconeShellTable();
        buildStructGrid();
        initGrid(17);
    </script>
</body>
</html>`;
    }
}
