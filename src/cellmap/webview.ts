// HTML for the Cell Map panel.
//
// Kept out of `panel.ts` so `buildCellMapHtml` can be asserted on headlessly
// alongside the other webview HTML tests (CSP shape, no stray CDN, script
// nonce). Everything is self-contained: no CDN, no bundler, no images.
//
// Nodes are absolutely-positioned HTML so a cell card can carry real surface
// chips you can click; edges are one SVG layer underneath. Both live in the
// same transformed wrapper, so pan and zoom is a single CSS transform.

export function buildCellMapHtml(cspSource: string, nonce: string): string {
    const csp = [
        "default-src 'none'",
        `style-src ${cspSource} 'unsafe-inline'`,
        `script-src 'nonce-${nonce}'`,
        `font-src ${cspSource}`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  :root {
    --gap: 10px;
    --role-material: #4f9cf9;
    --role-void: #8a8f98;
    --role-container: #c58af9;
    --role-lattice: #f2a33c;
    --role-graveyard: #e05561;
  }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: 12px;
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    overflow: hidden;
  }
  #shell { display: flex; flex-direction: column; height: 100%; }

  /* ---- toolbar ---- */
  #bar {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 10px; flex: 0 0 auto;
    border-bottom: 1px solid var(--vscode-panel-border);
    background: var(--vscode-editorWidget-background);
  }
  #bar input[type=search] {
    flex: 0 1 220px; padding: 3px 6px;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 3px;
  }
  button {
    font: inherit; padding: 3px 9px; border: none; border-radius: 3px; cursor: pointer;
    color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
    background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
  }
  button:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground)); }
  #stats { margin-left: auto; opacity: .7; white-space: nowrap; }

  /* ---- legend ---- */
  #legend { display: flex; gap: 10px; align-items: center; opacity: .85; }
  .key { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }

  /* ---- warnings ---- */
  #warn {
    flex: 0 0 auto; display: none; padding: 6px 10px; max-height: 116px; overflow: auto;
    border-bottom: 1px solid var(--vscode-panel-border);
    background: var(--vscode-inputValidation-warningBackground, rgba(255,190,60,.12));
    color: var(--vscode-inputValidation-warningForeground, inherit);
  }
  #warn ul { margin: 0; padding-left: 18px; }

  /* ---- main split ---- */
  #main { flex: 1 1 auto; display: flex; min-height: 0; }
  #viewport { position: relative; flex: 1 1 auto; overflow: hidden; cursor: grab; }
  #viewport.dragging { cursor: grabbing; }
  #canvas { position: absolute; top: 0; left: 0; transform-origin: 0 0; }
  #edges { position: absolute; top: 0; left: 0; overflow: visible; pointer-events: none; }

  /* ---- universe container ---- */
  .uni {
    position: absolute; box-sizing: border-box;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 8px;
    background: color-mix(in srgb, var(--vscode-editor-foreground) 4%, transparent);
  }
  .uni.root { border-style: solid; border-width: 2px; }
  .uni.orphan { border-color: var(--role-graveyard); border-style: dashed; }
  .uni > header {
    display: flex; align-items: baseline; gap: 6px;
    padding: 4px 8px; cursor: pointer; user-select: none;
    font-weight: 600; border-radius: 7px 7px 0 0;
    background: color-mix(in srgb, var(--vscode-editor-foreground) 7%, transparent);
  }
  .uni > header .sub { font-weight: 400; opacity: .65; }
  .uni > header .chev { margin-left: auto; opacity: .6; }

  /* ---- cell card ---- */
  .cell {
    position: absolute; box-sizing: border-box; overflow: hidden;
    border: 1px solid var(--vscode-panel-border); border-left-width: 3px;
    border-radius: 5px; padding: 4px 6px; cursor: pointer;
    background: var(--vscode-editor-background);
  }
  .cell:hover { border-color: var(--vscode-focusBorder); }
  .cell.sel { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .cell.dim { opacity: .25; }
  .cell.hit { box-shadow: 0 0 0 2px var(--vscode-editor-findMatchHighlightBackground, #ffd90055); }
  .cell .id { font-weight: 700; }
  .cell .tags { float: right; opacity: .7; font-size: 10px; }
  .cell .mat { opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cell .rgn {
    font-family: var(--vscode-editor-font-family); font-size: 11px; opacity: .7;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .chips { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 3px; }
  .chip {
    font-family: var(--vscode-editor-font-family); font-size: 10px;
    padding: 0 4px; border-radius: 3px; cursor: pointer;
    background: color-mix(in srgb, var(--vscode-editor-foreground) 12%, transparent);
  }
  .chip:hover { background: var(--vscode-editor-findMatchHighlightBackground, #ffd90055); }
  .chip.bad { color: var(--role-graveyard); text-decoration: underline wavy; }

  /* ---- edges ---- */
  .edge { fill: none; stroke: var(--vscode-editor-foreground); stroke-opacity: .28; stroke-width: 1.2; }
  .edge.comp { stroke-dasharray: 3 3; stroke: var(--role-graveyard); stroke-opacity: .5; }
  .edge.on { stroke-opacity: .95; stroke-width: 2; }
  .elabel { fill: var(--vscode-foreground); font-size: 10px; opacity: .6; }

  /* ---- detail pane ---- */
  #detail {
    flex: 0 0 288px; overflow: auto; padding: 10px 12px;
    border-left: 1px solid var(--vscode-panel-border);
    background: var(--vscode-editorWidget-background);
  }
  #detail h2 { margin: 0 0 2px; font-size: 14px; }
  #detail h3 { margin: 12px 0 4px; font-size: 11px; text-transform: uppercase; opacity: .6; letter-spacing: .04em; }
  #detail .empty { opacity: .6; }
  #detail pre {
    margin: 0; padding: 6px; border-radius: 4px; white-space: pre-wrap; word-break: break-all;
    font-family: var(--vscode-editor-font-family); font-size: 11px;
    background: var(--vscode-textCodeBlock-background, rgba(127,127,127,.12));
  }
  #detail dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 0; }
  #detail dt { opacity: .6; }
  #detail dd { margin: 0; }
  .link { color: var(--vscode-textLink-foreground); cursor: pointer; }
  .link:hover { text-decoration: underline; }
</style>
</head>
<body>
<div id="shell">
  <div id="bar">
    <input type="search" id="q" placeholder="Find cell, material or surface…" />
    <button id="fit">Fit</button>
    <button id="expand">Expand all</button>
    <button id="collapse">Collapse all</button>
    <div id="legend"></div>
    <div id="stats"></div>
  </div>
  <div id="warn"></div>
  <div id="main">
    <div id="viewport">
      <div id="canvas"><svg id="edges"></svg></div>
    </div>
    <div id="detail"><p class="empty">Open an MCNP deck and select a cell.</p></div>
  </div>
</div>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  const SVGNS = 'http://www.w3.org/2000/svg';

  const ROLES = {
    material:  { color: 'var(--role-material)',  label: 'material' },
    void:      { color: 'var(--role-void)',      label: 'void' },
    container: { color: 'var(--role-container)', label: 'fill' },
    lattice:   { color: 'var(--role-lattice)',   label: 'lattice' },
    graveyard: { color: 'var(--role-graveyard)', label: 'imp:n=0' },
  };

  const CELL_W = 208, PAD = 10, HEAD = 26, COL_GAP = 14, ROW_GAP = 10, UNI_GAP = 34, BAND_GAP = 56;
  const AUTO_COLLAPSE_OVER = 300;

  let model = null;
  let collapsed = new Set();
  let selected = null;
  let query = '';
  let view = { x: 20, y: 20, k: 1 };
  const layout = { cells: new Map(), unis: new Map(), w: 0, h: 0 };

  const $ = (id) => document.getElementById(id);
  const canvas = $('canvas'), edges = $('edges'), viewport = $('viewport');

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function densityText(c) {
    if (c.density == null) return '';
    const unit = c.densityUnit === 'g/cm3' ? ' g/cm\\u00B3' : ' atom/b\\u00B7cm';
    let s = Math.abs(c.density).toPrecision(4);
    // Trim padding zeros only behind a decimal point, or 1000 becomes 1.
    if (s.indexOf('.') >= 0 && s.indexOf('e') < 0) s = s.replace(/0+$/, '').replace(/\\.$/, '');
    return s + unit;
  }

  function cellHeight(c) {
    const chipRows = c.surfaces.length
      ? Math.ceil(c.surfaces.length / 5)
      : 0;
    return 20 + 16 + 15 + (chipRows ? chipRows * 15 + 3 : 0) + 8;
  }

  // ---- layout -------------------------------------------------------------
  // Universes are grouped into horizontal bands by fill depth, so an edge
  // always runs downward from the cell that fills to the universe it fills
  // with. Inside a universe, cells wrap into as square a grid as fits.
  function computeLayout() {
    layout.cells.clear();
    layout.unis.clear();
    if (!model) return;

    const bands = new Map();
    for (const u of model.universes) {
      if (!bands.has(u.depth)) bands.set(u.depth, []);
      bands.get(u.depth).push(u);
    }

    let y = 0, maxW = 0;
    for (const depth of [...bands.keys()].sort((a, b) => a - b)) {
      let x = 0, bandH = 0;
      for (const u of bands.get(depth)) {
        const isCollapsed = collapsed.has(u.id);
        let w, h;
        if (isCollapsed || u.cells.length === 0) {
          w = Math.max(180, CELL_W);
          h = HEAD + 8;
        } else {
          const cols = Math.max(1, Math.min(u.cells.length, Math.ceil(Math.sqrt(u.cells.length * 0.6))));
          const colH = new Array(cols).fill(0);
          u.cells.forEach((cid, i) => {
            const cell = model.byId[cid];
            const col = i % cols;
            const ch = cellHeight(cell);
            layout.cells.set(cid, {
              x: PAD + col * (CELL_W + COL_GAP),
              y: HEAD + PAD + colH[col],
              w: CELL_W, h: ch, uni: u.id,
            });
            colH[col] += ch + ROW_GAP;
          });
          w = PAD * 2 + cols * CELL_W + (cols - 1) * COL_GAP;
          h = HEAD + PAD * 2 + Math.max(...colH) - ROW_GAP;
        }
        layout.unis.set(u.id, { x, y, w, h, collapsed: isCollapsed });
        for (const cid of u.cells) {
          const c = layout.cells.get(cid);
          if (c) { c.ax = x + c.x; c.ay = y + c.y; }
        }
        x += w + UNI_GAP;
        bandH = Math.max(bandH, h);
      }
      maxW = Math.max(maxW, x - UNI_GAP);
      y += bandH + BAND_GAP;
    }
    layout.w = maxW;
    layout.h = y - BAND_GAP;
  }

  // ---- render -------------------------------------------------------------
  function render() {
    computeLayout();
    canvas.querySelectorAll('.uni, .cell').forEach((n) => n.remove());
    while (edges.firstChild) edges.removeChild(edges.firstChild);
    if (!model) return;

    edges.setAttribute('width', String(layout.w + 40));
    edges.setAttribute('height', String(layout.h + 40));

    for (const u of model.universes) {
      const box = layout.unis.get(u.id);
      if (!box) continue;
      const el = document.createElement('div');
      el.className = 'uni' + (u.id === 0 ? ' root' : '') + (u.orphan ? ' orphan' : '');
      el.style.cssText = 'left:' + box.x + 'px;top:' + box.y + 'px;width:' + box.w + 'px;height:' + box.h + 'px';
      const filled = u.filledBy.length
        ? 'filled by cell ' + u.filledBy.join(', ')
        : (u.id === 0 ? 'root — the real world' : 'nothing fills this');
      el.innerHTML =
        '<header data-uni="' + u.id + '">' +
          '<span>' + (u.id === 0 ? 'Universe 0' : 'u=' + u.id) + '</span>' +
          '<span class="sub">' + esc(u.summary || '') + (u.summary ? ' \\u00B7 ' : '') +
            u.cells.length + ' cell' + (u.cells.length === 1 ? '' : 's') + ' \\u00B7 ' + esc(filled) + '</span>' +
          '<span class="chev">' + (box.collapsed ? '\\u25B8' : '\\u25BE') + '</span>' +
        '</header>';
      canvas.appendChild(el);

      if (box.collapsed) continue;
      for (const cid of u.cells) canvas.appendChild(renderCell(model.byId[cid]));
    }

    drawEdges();
    applyFilter();
    highlight();
  }

  function renderCell(c) {
    const box = layout.cells.get(c.id);
    const el = document.createElement('div');
    el.className = 'cell';
    el.dataset.cell = String(c.id);
    el.style.cssText =
      'left:' + box.ax + 'px;top:' + box.ay + 'px;width:' + box.w + 'px;height:' + box.h + 'px;' +
      'border-left-color:' + ROLES[c.role].color;

    const tags = [];
    if (c.lattice) tags.push('lat=' + c.lattice);
    if (c.hasTrcl) tags.push('trcl');
    if (c.temperatureK != null) tags.push(Math.round(c.temperatureK) + 'K');
    if (c.importanceZero) tags.push('imp:n=0');

    const mat = c.material === 0
      ? 'void'
      : 'm' + c.material + ' ' + (c.materialLabel || '') + ' ' + densityText(c);

    const chips = c.surfaces.map((s) =>
      '<span class="chip' + (s.undefined ? ' bad' : '') + '" data-surf="' + s.id + '" title="' +
      esc(s.summary || 'no surface card defines ' + s.id) + '">' +
      (s.sense === '+/-' ? '\\u00B1' : s.sense) + s.id + '</span>').join('');

    el.innerHTML =
      '<div><span class="id">' + c.id + '</span>' +
        (c.summary ? ' <span class="mat">' + esc(c.summary) + '</span>' : '') +
        '<span class="tags">' + esc(tags.join(' ')) + '</span></div>' +
      '<div class="mat">' + esc(mat.trim()) + '</div>' +
      '<div class="rgn" title="' + esc(c.regionRaw) + '">' + esc(c.regionRaw || '\\u2014') + '</div>' +
      (chips ? '<div class="chips">' + chips + '</div>' : '');
    return el;
  }

  function anchor(cellId) {
    const b = layout.cells.get(cellId);
    if (!b) return null;
    const uni = layout.unis.get(b.uni);
    if (uni && collapsed.has(b.uni)) return { x: uni.x + uni.w / 2, y: uni.y + uni.h };
    return { x: b.ax + b.w / 2, y: b.ay + b.h };
  }

  function drawEdges() {
    for (const e of model.edges) {
      const from = anchor(e.from);
      if (!from) continue;
      let to;
      if (e.kind === 'fill') {
        const box = layout.unis.get(e.to);
        if (!box) continue;
        to = { x: box.x + Math.min(60, box.w / 2), y: box.y };
      } else {
        const b = layout.cells.get(e.to);
        const uni = b && layout.unis.get(b.uni);
        if (!b || !uni) continue;
        to = collapsed.has(b.uni)
          ? { x: uni.x + uni.w / 2, y: uni.y }
          : { x: b.ax + b.w / 2, y: b.ay };
      }
      const dy = Math.max(24, Math.abs(to.y - from.y) / 2);
      const path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('d',
        'M' + from.x + ',' + from.y +
        ' C' + from.x + ',' + (from.y + dy) + ' ' + to.x + ',' + (to.y - dy) + ' ' + to.x + ',' + to.y);
      path.setAttribute('class', 'edge' + (e.kind === 'complement' ? ' comp' : ''));
      path.dataset.from = String(e.from);
      path.dataset.to = String(e.to);
      path.dataset.kind = e.kind;
      edges.appendChild(path);

      if (e.count && e.count > 1) {
        const t = document.createElementNS(SVGNS, 'text');
        t.setAttribute('class', 'elabel');
        t.setAttribute('x', String((from.x + to.x) / 2 + 4));
        t.setAttribute('y', String((from.y + to.y) / 2));
        t.textContent = '\\u00D7' + e.count;
        edges.appendChild(t);
      }
    }
  }

  // ---- interaction --------------------------------------------------------
  function applyTransform() {
    canvas.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.k + ')';
  }

  function fit() {
    const r = viewport.getBoundingClientRect();
    if (!layout.w || !layout.h) { view = { x: 20, y: 20, k: 1 }; applyTransform(); return; }
    const k = Math.min((r.width - 40) / layout.w, (r.height - 40) / layout.h, 1.4);
    view.k = Math.max(0.08, k);
    view.x = (r.width - layout.w * view.k) / 2;
    view.y = 20;
    applyTransform();
  }

  function applyFilter() {
    const q = query.trim().toLowerCase();
    for (const el of canvas.querySelectorAll('.cell')) {
      const c = model.byId[Number(el.dataset.cell)];
      const hit = !q || [
        String(c.id), c.summary, c.materialLabel, c.regionRaw,
        'm' + c.material, 'u=' + c.universe,
        ...c.surfaces.map((s) => String(s.id)),
      ].join(' ').toLowerCase().includes(q);
      el.classList.toggle('dim', !!q && !hit);
      el.classList.toggle('hit', !!q && hit);
    }
  }

  function highlight() {
    for (const p of edges.querySelectorAll('.edge')) {
      const on = selected != null &&
        (Number(p.dataset.from) === selected ||
         (p.dataset.kind === 'complement' && Number(p.dataset.to) === selected) ||
         (p.dataset.kind === 'fill' && model.byId[selected] &&
          Number(p.dataset.to) === model.byId[selected].universe));
      p.classList.toggle('on', on);
    }
    for (const el of canvas.querySelectorAll('.cell')) {
      el.classList.toggle('sel', Number(el.dataset.cell) === selected);
    }
  }

  function showDetail(c) {
    const d = $('detail');
    if (!c) { d.innerHTML = '<p class="empty">Select a cell.</p>'; return; }
    const rows = [];
    rows.push(['Role', ROLES[c.role].label]);
    rows.push(['Universe', c.universe === 0 ? '0 (root)' : String(c.universe)]);
    rows.push(['Material', c.material === 0 ? 'void' : 'm' + c.material + ' \\u2014 ' + esc(c.materialLabel)]);
    if (c.density != null) {
      rows.push(['Density', densityText(c) + (c.density < 0 ? ' (mass)' : ' (atom)')]);
    }
    if (c.temperatureK != null) rows.push(['tmp', Math.round(c.temperatureK) + ' K']);
    if (c.lattice) rows.push(['Lattice', c.lattice === 2 ? 'hexagonal (lat=2)' : 'square (lat=1)']);
    if (c.hasTrcl) rows.push(['trcl', 'yes']);
    rows.push(['Line', String(c.line + 1)]);

    const fills = model.edges.filter((e) => e.kind === 'fill' && e.from === c.id);
    const linkCell = (id) => '<span class="link" data-goto-cell="' + id + '">' + id + '</span>';

    d.innerHTML =
      '<h2>Cell ' + c.id + (c.summary ? ' \\u2014 ' + esc(c.summary) : '') + '</h2>' +
      '<dl>' + rows.map((r) => '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>').join('') + '</dl>' +
      '<h3>Region</h3><pre>' + esc(c.regionRaw || '(empty)') + '</pre>' +
      (c.regionError ? '<p style="color:var(--role-graveyard)">' + esc(c.regionError) + '</p>' : '') +
      '<h3>Bounding surfaces</h3>' +
      (c.surfaces.length
        ? '<dl>' + c.surfaces.map((s) =>
            '<dt><span class="link" data-goto-surf="' + s.id + '">' +
            (s.sense === '+/-' ? '\\u00B1' : s.sense) + s.id + '</span></dt><dd>' +
            (s.undefined ? '<em>no surface card</em>' : esc(s.summary)) + '</dd>').join('') + '</dl>'
        : '<p class="empty">none</p>') +
      (fills.length
        ? '<h3>Fills with</h3><dl>' + fills.map((e) => {
            const u = model.universes.find((x) => x.id === e.to);
            return '<dt>u=' + e.to + '</dt><dd>' + esc(u ? (u.summary || (u.cells.length + ' cells')) : 'undefined') +
              (e.count && e.count > 1 ? ' \\u00D7' + e.count : '') + '</dd>';
          }).join('') + '</dl>'
        : '') +
      (c.complements.length
        ? '<h3>Subtracts (#)</h3><p>' + c.complements.map(linkCell).join(', ') + '</p>'
        : '') +
      (c.neighbors.length
        ? '<h3>Across a shared surface</h3><p>' + c.neighbors.map(linkCell).join(', ') + '</p>'
        : '');
  }

  function select(id, reveal) {
    selected = id;
    showDetail(model.byId[id] || null);
    highlight();
    if (reveal) vscode.postMessage({ command: 'revealCell', id });
  }

  canvas.addEventListener('click', (ev) => {
    const chip = ev.target.closest('.chip');
    if (chip) {
      ev.stopPropagation();
      vscode.postMessage({ command: 'revealSurface', id: Number(chip.dataset.surf) });
      return;
    }
    const head = ev.target.closest('header[data-uni]');
    if (head) {
      const uid = Number(head.dataset.uni);
      if (collapsed.has(uid)) collapsed.delete(uid); else collapsed.add(uid);
      render();
      return;
    }
    const cell = ev.target.closest('.cell');
    if (cell) select(Number(cell.dataset.cell), true);
  });

  $('detail').addEventListener('click', (ev) => {
    const c = ev.target.closest('[data-goto-cell]');
    if (c) { select(Number(c.dataset.gotoCell), true); return; }
    const s = ev.target.closest('[data-goto-surf]');
    if (s) vscode.postMessage({ command: 'revealSurface', id: Number(s.dataset.gotoSurf) });
  });

  // pan + zoom
  let drag = null;
  viewport.addEventListener('mousedown', (ev) => {
    if (ev.target.closest('.cell') || ev.target.closest('header[data-uni]')) return;
    drag = { x: ev.clientX - view.x, y: ev.clientY - view.y };
    viewport.classList.add('dragging');
  });
  window.addEventListener('mousemove', (ev) => {
    if (!drag) return;
    view.x = ev.clientX - drag.x;
    view.y = ev.clientY - drag.y;
    applyTransform();
  });
  window.addEventListener('mouseup', () => { drag = null; viewport.classList.remove('dragging'); });
  viewport.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const r = viewport.getBoundingClientRect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    const k = Math.min(3, Math.max(0.06, view.k * (ev.deltaY < 0 ? 1.12 : 1 / 1.12)));
    view.x = mx - (mx - view.x) * (k / view.k);
    view.y = my - (my - view.y) * (k / view.k);
    view.k = k;
    applyTransform();
  }, { passive: false });

  $('fit').addEventListener('click', fit);
  $('expand').addEventListener('click', () => { collapsed.clear(); render(); fit(); });
  $('collapse').addEventListener('click', () => {
    collapsed = new Set(model.universes.filter((u) => u.id !== 0).map((u) => u.id));
    render(); fit();
  });
  $('q').addEventListener('input', (ev) => { query = ev.target.value; applyFilter(); });

  $('legend').innerHTML = Object.keys(ROLES).map((k) =>
    '<span class="key"><span class="dot" style="background:' + ROLES[k].color + '"></span>' +
    ROLES[k].label + '</span>').join('');

  // ---- host messages ------------------------------------------------------
  window.addEventListener('message', (ev) => {
    const msg = ev.data;
    if (msg.type !== 'model') return;
    const first = model === null;
    const prevSelected = selected;
    model = msg.model;
    model.byId = {};
    for (const c of model.cells) model.byId[c.id] = c;

    if (first && model.cells.length > AUTO_COLLAPSE_OVER) {
      collapsed = new Set(model.universes.filter((u) => u.id !== 0).map((u) => u.id));
    }
    collapsed = new Set([...collapsed].filter((u) => model.universes.some((x) => x.id === u)));

    $('stats').textContent =
      model.stats.cells + ' cells \\u00B7 ' + model.stats.universes + ' universes \\u00B7 depth ' +
      model.stats.maxDepth + (msg.fileName ? ' \\u00B7 ' + msg.fileName : '');

    const warn = $('warn');
    if (model.warnings.length) {
      warn.style.display = 'block';
      warn.innerHTML = '<ul>' + model.warnings.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul>';
    } else {
      warn.style.display = 'none';
      warn.innerHTML = '';
    }

    render();
    if (prevSelected != null && model.byId[prevSelected]) select(prevSelected, false);
    else { selected = null; showDetail(null); }
    if (first) fit();
  });

  vscode.postMessage({ command: 'ready' });
}());
</script>
</body>
</html>`;
}
