// HTML for the Cell Map panel.
//
// Kept out of `panel.ts` so `buildCellMapHtml` can be asserted on headlessly
// alongside the other webview HTML tests (CSP shape, no stray CDN, script
// nonce). Everything is self-contained: no CDN, no bundler, no images.
//
// Three panes. The Structure tree on the left is the fill hierarchy read top
// down — root, what it fills, what that fills — with placement counts, which
// is the "flow" of a deck that a flat list of 331 cells hides. The canvas in
// the middle draws universes as boxes in depth columns with the cell cards
// inside; edges are one SVG layer underneath. The detail pane on the right
// shows one cell or one universe, including the path back to the root.
//
// Nodes are absolutely-positioned HTML so a cell card can carry real surface
// chips you can click; the canvas and its SVG share one transformed wrapper,
// so pan and zoom is a single CSS transform.

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
  /* Chrome (toolbar, tree, detail) stays at editor size; only the cards on
     the canvas are set larger, because those are what you read at a glance. */
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
    padding: 5px 10px; flex: 0 0 auto;
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
  button.on { outline: 1px solid var(--vscode-focusBorder); }
  #stats { margin-left: auto; opacity: .7; white-space: nowrap; }

  /* ---- legend ---- */
  #legend { display: flex; gap: 10px; align-items: center; opacity: .85; }
  .key { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }

  /* ---- warnings ---- */
  #warn {
    flex: 0 0 auto; display: none; padding: 6px 10px; max-height: 96px; overflow: auto;
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

  /* ---- structure tree ---- */
  #tree {
    flex: 0 0 272px; overflow: auto; padding: 6px 4px 12px 6px;
    border-right: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBar-background, var(--vscode-editorWidget-background));
    user-select: none;
  }
  #tree.hidden { display: none; }
  #tree h3 { margin: 4px 6px 6px; font-size: 11px; text-transform: uppercase; opacity: .6; letter-spacing: .04em; }
  .tn { display: flex; align-items: baseline; gap: 4px; padding: 2px 4px; border-radius: 3px; cursor: pointer; white-space: nowrap; }
  .tn:hover { background: var(--vscode-list-hoverBackground); }
  .tn.cur { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .tn .tw { width: 12px; flex: 0 0 auto; opacity: .6; text-align: center; }
  .tn .tw.leaf { opacity: 0; }
  .tn .tu { font-weight: 600; }
  .tn .tk { opacity: .6; font-size: 11px; }
  .tn .tx { opacity: .8; }
  .tn .tx b { font-weight: 600; color: var(--role-lattice); }
  .tn .tref { opacity: .55; font-style: italic; }
  .tn .tbar { display: inline-block; width: 3px; height: 10px; border-radius: 1px; flex: 0 0 auto; align-self: center; }
  .tkids { margin-left: 14px; border-left: 1px dotted var(--vscode-panel-border); padding-left: 2px; }
  .tn.orphan .tu { color: var(--role-graveyard); }

  /* ---- universe container ---- */
  .uni {
    position: absolute; box-sizing: border-box;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 8px;
    background: color-mix(in srgb, var(--vscode-editor-foreground) 4%, transparent);
  }
  .uni.root { border-style: solid; border-width: 2px; }
  .uni.orphan { border-color: var(--role-graveyard); border-style: dashed; }
  .uni.focus { box-shadow: 0 0 0 2px var(--vscode-focusBorder); }
  .uni > header {
    display: flex; align-items: baseline; gap: 6px; overflow: hidden;
    padding: 4px 8px; cursor: pointer; user-select: none;
    font-size: 13px; font-weight: 600; border-radius: 7px 7px 0 0;
    background: color-mix(in srgb, var(--vscode-editor-foreground) 7%, transparent);
  }
  .uni > header .sub { font-weight: 400; opacity: .75; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .uni > header .sub b { font-weight: 600; opacity: 1; }
  .uni > header .chev { margin-left: auto; opacity: .6; flex: 0 0 auto; }

  /* ---- cell card ---- */
  .cell {
    position: absolute; box-sizing: border-box; overflow: hidden;
    border: 1px solid var(--vscode-panel-border); border-left-width: 3px;
    border-radius: 5px; padding: 5px 8px; cursor: pointer;
    font-size: 14px; line-height: 1.3;
    background: var(--vscode-editor-background);
  }
  .cell:hover { border-color: var(--vscode-focusBorder); }
  .cell.sel { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .cell.dim { opacity: .25; }
  .cell.hit { box-shadow: 0 0 0 2px var(--vscode-editor-findMatchHighlightBackground, #ffd90055); }
  .cell .hd { display: flex; align-items: baseline; gap: 6px; }
  .cell .id { font-weight: 700; font-size: 15px; }
  .cell .nm { opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .cell .badge {
    margin-left: auto; flex: 0 0 auto; font-size: 11px; font-weight: 600; letter-spacing: .02em;
    padding: 0 6px; border-radius: 9px; color: #fff;
  }
  .cell .kind { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cell .kind .dens { opacity: .7; }
  .cell .kind .tag { opacity: .7; font-size: 12px; margin-left: 6px; }
  .cell .rgn {
    font-family: var(--vscode-editor-font-family); font-size: 12.5px; opacity: .8;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
  .chip {
    font-family: var(--vscode-editor-font-family); font-size: 12px;
    padding: 0 5px; border-radius: 3px; cursor: pointer;
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
  #detail .crumbs { line-height: 1.7; }
  #detail .crumbs .sep { opacity: .45; margin: 0 3px; }
  #detail .crumbs .x { opacity: .7; }
  #detail ul.cells { margin: 0; padding-left: 0; list-style: none; }
  #detail ul.cells li { display: flex; gap: 6px; align-items: baseline; padding: 1px 0; }
  #detail ul.cells .sw { width: 3px; height: 10px; flex: 0 0 auto; border-radius: 1px; }
  #detail ul.cells .m { opacity: .75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .link { color: var(--vscode-textLink-foreground); cursor: pointer; }
  .link:hover { text-decoration: underline; }
</style>
</head>
<body>
<div id="shell">
  <div id="bar">
    <button id="treeToggle" class="on" title="Show or hide the structure tree">Structure</button>
    <input type="search" id="q" placeholder="Find cell, material or surface…" />
    <button id="fit">Fit</button>
    <button id="expand">Expand all</button>
    <button id="collapse">Collapse all</button>
    <div id="legend"></div>
    <div id="stats"></div>
  </div>
  <div id="warn"></div>
  <div id="main">
    <div id="tree"></div>
    <div id="viewport">
      <div id="canvas"><svg id="edges"></svg></div>
    </div>
    <div id="detail"><p class="empty">Open a Monte Carlo deck and select a cell.</p></div>
  </div>
</div>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  const SVGNS = 'http://www.w3.org/2000/svg';

  const ROLES = {
    lattice:   { color: 'var(--role-lattice)',   label: 'lattice' },
    container: { color: 'var(--role-container)', label: 'fill' },
    material:  { color: 'var(--role-material)',  label: 'material' },
    void:      { color: 'var(--role-void)',      label: 'void' },
    graveyard: { color: 'var(--role-graveyard)', label: 'outside' },
  };
  const ROLE_ORDER = ['lattice', 'container', 'material', 'void', 'graveyard'];

  function roleLabel(role) {
    if (role === 'graveyard' && model && model.language === 'mcnp') return 'imp:n=0';
    return ROLES[role].label;
  }

  const CELL_W = 250, PAD = 10, HEAD = 26, COL_GAP = 14, ROW_GAP = 10, UNI_GAP = 28, BAND_GAP = 72;
  const COLLAPSED_W = 330;

  let model = null;
  let collapsed = new Set();
  let treeClosed = new Set();
  let selected = null;        // cell id
  let focusedUni = null;      // universe id shown in the detail pane
  let query = '';
  let view = { x: 20, y: 20, k: 1 };
  const layout = { cells: new Map(), unis: new Map(), w: 0, h: 0 };

  const $ = (id) => document.getElementById(id);
  const canvas = $('canvas'), edges = $('edges'), viewport = $('viewport'), tree = $('tree');

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function rootUni() {
    if (!model) return 0;
    const u = model.universes.find((x) => x.depth === 0 && !x.orphan);
    return u ? u.id : 0;
  }
  const uniLabel = (u) => (u.name ? u.name : 'u=' + u.id);
  const cellLabel = (c) => (c.name ? c.name : String(c.id));

  function densityText(c) {
    if (c.density == null) return '';
    const unit = c.densityUnit === 'g/cm3' ? ' g/cm\\u00B3' : ' atom/b\\u00B7cm';
    let s = Math.abs(c.density).toPrecision(4);
    // Trim padding zeros only behind a decimal point, or 1000 becomes 1.
    if (s.indexOf('.') >= 0 && s.indexOf('e') < 0) s = s.replace(/0+$/, '').replace(/\\.$/, '');
    return s + unit;
  }

  // ---- derived structure ---------------------------------------------------
  // Per universe: what it fills (aggregated over its cells, with placement
  // counts), what materials it holds, and a one-line description. Computed
  // once per model; the tree, the headers and the detail pane all read it.
  function derive() {
    model.byId = {};
    for (const c of model.cells) model.byId[c.id] = c;
    model.uniById = {};
    for (const u of model.universes) model.uniById[u.id] = u;
    for (const u of model.universes) {
      const cells = u.cells.map((id) => model.byId[id]).filter(Boolean);
      const roles = {};
      for (const c of cells) roles[c.role] = (roles[c.role] || 0) + 1;
      const fills = new Map();
      let placements = 0;
      for (const e of model.edges) {
        if (e.kind !== 'fill') continue;
        const from = model.byId[e.from];
        if (!from || from.universe !== u.id) continue;
        const n = e.count || 1;
        fills.set(e.to, (fills.get(e.to) || 0) + n);
        placements += n;
      }
      const mats = [];
      for (const c of cells) {
        if (c.role !== 'material' || !c.materialLabel) continue;
        if (!mats.includes(c.materialLabel)) mats.push(c.materialLabel);
      }
      const kids = [...fills.entries()].sort((a, b) => b[1] - a[1]).map(([to, n]) => ({ to, n }));
      let kind;
      if (roles.lattice) kind = 'lattice';
      else if (u.id === rootUni()) kind = 'root';
      else if (kids.length && !roles.material && !roles.void) kind = 'stack';
      else if (kids.length) kind = 'mixed';
      else kind = 'pin';
      u.$ = { cells, roles, kids, placements, mats, kind };
      u.$.line = describe(u);
    }
  }

  function describe(u) {
    const d = u.$;
    const bits = [];
    const nc = u.cells.length;
    bits.push(nc + ' cell' + (nc === 1 ? '' : 's'));
    if (d.kind === 'lattice') {
      bits.push('lattice \\u2192 ' + d.kids.length + ' universe' + (d.kids.length === 1 ? '' : 's') +
        ', ' + d.placements + ' placement' + (d.placements === 1 ? '' : 's'));
    } else if (d.kids.length) {
      bits.push((d.kind === 'stack' ? 'stack' : 'fills') + ' \\u2192 ' +
        d.kids.slice(0, 4).map((k) => uniLabel(model.uniById[k.to] || { id: k.to }) + (k.n > 1 ? '\\u00D7' + k.n : '')).join(', ') +
        (d.kids.length > 4 ? ' +' + (d.kids.length - 4) : ''));
    }
    if (d.mats.length) bits.push(d.mats.slice(0, 4).join(' / ') + (d.mats.length > 4 ? ' +' + (d.mats.length - 4) : ''));
    if (d.roles.graveyard) bits.push(roleLabel('graveyard'));
    return bits.join(' \\u00B7 ');
  }

  /** Parent cells of a universe, i.e. the cells whose fill points here. */
  function parentsOf(uid) {
    const u = model.uniById[uid];
    return u ? u.filledBy.map((id) => model.byId[id]).filter(Boolean) : [];
  }

  /** [u, cell, u, cell, ..., u] from the root down to uid, shallowest parents first. */
  function pathToRoot(uid) {
    const path = [uid];
    const seen = new Set([uid]);
    let cur = uid;
    while (cur !== rootUni()) {
      const parents = parentsOf(cur).filter((c) => !seen.has(c.universe));
      if (!parents.length) break;
      parents.sort((a, b) => (model.uniById[a.universe] || {}).depth - (model.uniById[b.universe] || {}).depth);
      const p = parents[0];
      path.unshift(p.id);
      path.unshift(p.universe);
      seen.add(p.universe);
      cur = p.universe;
    }
    return path;
  }

  // ---- structure tree ------------------------------------------------------
  // The fill hierarchy read top down. A universe placed from several places
  // is expanded once, where it is first reached, and shown as a reference
  // ("\\u2191 u=30") everywhere else so the tree stays a tree.
  function renderTree() {
    tree.innerHTML = '';
    if (!model || !model.universes.length) return;
    const h = document.createElement('h3');
    h.textContent = 'Structure';
    tree.appendChild(h);
    const expandedAt = new Set();
    const walk = (uid, n, parentEl) => {
      const u = model.uniById[uid];
      if (!u) return;
      const first = !expandedAt.has(uid);
      if (first) expandedAt.add(uid);
      const row = document.createElement('div');
      row.className = 'tn' + (u.orphan ? ' orphan' : '') + (focusedUni === uid ? ' cur' : '');
      row.dataset.uni = String(uid);
      const kids = first ? u.$.kids : [];
      const open = !treeClosed.has(uid);
      const roleColor = u.$.kind === 'lattice' ? 'var(--role-lattice)' :
        (u.$.kids.length ? 'var(--role-container)' : (u.$.roles.material ? 'var(--role-material)' : 'var(--role-void)'));
      row.innerHTML =
        '<span class="tw' + (kids.length ? '' : ' leaf') + '" data-tog="' + uid + '">' + (open ? '\\u25BE' : '\\u25B8') + '</span>' +
        '<span class="tbar" style="background:' + roleColor + '"></span>' +
        (n > 1 ? '<span class="tx"><b>\\u00D7' + n + '</b></span>' : '') +
        '<span class="tu">' + esc(uid === rootUni() ? 'Universe ' + uid : uniLabel(u)) + '</span>' +
        (first
          ? '<span class="tk">' + esc(u.summary || (u.$.kind === 'lattice' ? 'lattice' : u.$.kind === 'stack' ? 'stack' : '')) +
            (u.$.kind === 'pin' && u.$.mats.length ? (u.summary ? ' \\u00B7 ' : '') + esc(u.$.mats.slice(0, 3).join('/')) : '') +
            ' \\u00B7 ' + u.cells.length + '</span>'
          : '<span class="tref">\\u2191 see above</span>');
      parentEl.appendChild(row);
      if (kids.length && open) {
        const box = document.createElement('div');
        box.className = 'tkids';
        parentEl.appendChild(box);
        for (const k of kids) walk(k.to, k.n, box);
      }
    };
    walk(rootUni(), 1, tree);
    const orphans = model.universes.filter((u) => u.orphan);
    if (orphans.length) {
      const h2 = document.createElement('h3');
      h2.textContent = 'Not placed anywhere';
      tree.appendChild(h2);
      for (const u of orphans) walk(u.id, 1, tree);
    }
  }

  tree.addEventListener('click', (ev) => {
    const tog = ev.target.closest('[data-tog]');
    if (tog) {
      ev.stopPropagation();
      const uid = Number(tog.dataset.tog);
      if (treeClosed.has(uid)) treeClosed.delete(uid); else treeClosed.add(uid);
      renderTree();
      return;
    }
    const row = ev.target.closest('.tn');
    if (row) focusUniverse(Number(row.dataset.uni), true);
  });

  function cellHeight(c) {
    const chipRows = c.surfaces.length ? Math.ceil(c.surfaces.length / 5) : 0;
    return 8 + 20 + 19 + 17 + (chipRows ? chipRows * 18 + 4 : 0) + 7;
  }

  function sortedCells(u) {
    return u.cells.slice().sort((a, b) => {
      const ca = model.byId[a], cb = model.byId[b];
      const ra = ROLE_ORDER.indexOf(ca.role), rb = ROLE_ORDER.indexOf(cb.role);
      return ra - rb || a - b;
    });
  }

  // ---- layout -------------------------------------------------------------
  // Universes are grouped into vertical columns by fill depth, so an edge
  // always runs rightward from the cell that fills to the universe it fills
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

    let x = 0, maxH = 0;
    for (const depth of [...bands.keys()].sort((a, b) => a - b)) {
      let y = 0, colW = 0;
      for (const u of bands.get(depth)) {
        const isCollapsed = collapsed.has(u.id);
        let w, h;
        if (isCollapsed || u.cells.length === 0) {
          w = COLLAPSED_W;
          h = HEAD + 6;
        } else {
          const order = sortedCells(u);
          const cols = Math.max(1, Math.min(order.length, Math.ceil(Math.sqrt(order.length * 0.6))));
          const colH = new Array(cols).fill(0);
          order.forEach((cid, i) => {
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
          w = Math.max(COLLAPSED_W, PAD * 2 + cols * CELL_W + (cols - 1) * COL_GAP);
          h = HEAD + PAD * 2 + Math.max(...colH) - ROW_GAP;
        }
        layout.unis.set(u.id, { x, y, w, h, collapsed: isCollapsed });
        for (const cid of u.cells) {
          const c = layout.cells.get(cid);
          if (c) { c.ax = x + c.x; c.ay = y + c.y; }
        }
        y += h + UNI_GAP;
        colW = Math.max(colW, w);
      }
      maxH = Math.max(maxH, y - UNI_GAP);
      x += colW + BAND_GAP;
    }
    layout.w = x - BAND_GAP;
    layout.h = maxH;
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
      el.className = 'uni' + (u.id === rootUni() ? ' root' : '') + (u.orphan ? ' orphan' : '') +
        (focusedUni === u.id ? ' focus' : '');
      el.dataset.uniBox = String(u.id);
      el.style.cssText = 'left:' + box.x + 'px;top:' + box.y + 'px;width:' + box.w + 'px;height:' + box.h + 'px';
      const filled = u.filledBy.length
        ? 'filled by cell ' + u.filledBy.slice(0, 3).join(', ') + (u.filledBy.length > 3 ? ' +' + (u.filledBy.length - 3) : '')
        : (u.id === rootUni() ? 'root \\u2014 the real world' : 'nothing fills this');
      const title = (u.summary ? u.summary + ' \\u00B7 ' : '') + u.$.line + ' \\u00B7 ' + filled;
      el.innerHTML =
        '<header data-uni="' + u.id + '" title="' + esc(title) + '">' +
          '<span>' + esc(u.id === rootUni() ? 'Universe ' + u.id : uniLabel(u)) + '</span>' +
          '<span class="sub">' + (u.summary ? '<b>' + esc(u.summary) + '</b> \\u00B7 ' : '') + esc(u.$.line) + '</span>' +
          '<span class="chev">' + (box.collapsed ? '\\u25B8' : '\\u25BE') + '</span>' +
        '</header>';
      canvas.appendChild(el);

      if (box.collapsed) continue;
      for (const cid of u.cells) canvas.appendChild(renderCell(model.byId[cid]));
    }

    drawEdges();
    applyFilter();
    highlight();
    renderTree();
  }

  function kindLine(c) {
    if (c.role === 'graveyard') return roleLabel('graveyard') + ' \\u2014 outside world';
    if (c.role === 'lattice' || c.role === 'container') {
      const fills = model.edges.filter((e) => e.kind === 'fill' && e.from === c.id);
      const parts = fills.slice(0, 3).map((e) => uniLabel(model.uniById[e.to] || { id: e.to }) + (e.count > 1 ? '\\u00D7' + e.count : ''));
      let s = (c.role === 'lattice' ? 'lat=' + c.lattice + ' \\u2192 ' : 'fill \\u2192 ') + parts.join(', ') +
        (fills.length > 3 ? ' +' + (fills.length - 3) : '');
      if (c.material) s += '<span class="tag">' + esc(c.materialLabel) + '</span>';
      return s;
    }
    if (c.role === 'void') return 'void';
    return esc(c.materialLabel) + (c.density != null ? ' <span class="dens">' + densityText(c) + '</span>' : '');
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
    if (c.hasTrcl) tags.push('trcl');
    if (c.temperatureK != null) tags.push(Math.round(c.temperatureK) + 'K');
    const nm = c.name ? c.name : (c.summary || '');

    const chips = c.surfaces.map((s) =>
      '<span class="chip' + (s.undefined ? ' bad' : '') + '" data-surf="' + s.id + '" data-sname="' + esc(s.name || '') + '" title="' +
      esc(s.summary || 'no surface card defines ' + (s.name || s.id)) + '">' +
      (s.sense === '+/-' ? '\\u00B1' : s.sense) + esc(s.name || s.id) + '</span>').join('');

    el.innerHTML =
      '<div class="hd"><span class="id">' + c.id + '</span>' +
        (nm ? '<span class="nm" title="' + esc(nm) + '">' + esc(nm) + '</span>' : '') +
        '<span class="badge" style="background:' + ROLES[c.role].color + '">' + roleLabel(c.role) + '</span></div>' +
      '<div class="kind">' + kindLine(c) + (tags.length ? '<span class="tag">' + esc(tags.join(' ')) + '</span>' : '') + '</div>' +
      '<div class="rgn" title="' + esc(c.regionRaw) + '">' + esc(c.regionRaw || '\\u2014') + '</div>' +
      (chips ? '<div class="chips">' + chips + '</div>' : '');
    return el;
  }

  function anchor(cellId) {
    const b = layout.cells.get(cellId);
    if (!b) return null;
    const uni = layout.unis.get(b.uni);
    if (uni && collapsed.has(b.uni)) return { x: uni.x + uni.w, y: uni.y + uni.h / 2 };
    return { x: b.ax + b.w, y: b.ay + b.h / 2 };
  }

  function drawEdges() {
    for (const e of model.edges) {
      const from = anchor(e.from);
      if (!from) continue;
      let to;
      if (e.kind === 'fill') {
        const box = layout.unis.get(e.to);
        if (!box) continue;
        to = { x: box.x, y: box.y + Math.min(20, box.h / 2) };
      } else {
        const b = layout.cells.get(e.to);
        const uni = b && layout.unis.get(b.uni);
        if (!b || !uni) continue;
        to = collapsed.has(b.uni)
          ? { x: uni.x, y: uni.y + uni.h / 2 }
          : { x: b.ax, y: b.ay + b.h / 2 };
      }
      const dx = Math.max(28, Math.abs(to.x - from.x) / 2);
      const path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('d',
        'M' + from.x + ',' + from.y +
        ' C' + (from.x + dx) + ',' + from.y + ' ' + (to.x - dx) + ',' + to.y + ' ' + to.x + ',' + to.y);
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

  /** Pan (and zoom in if needed) so one universe box is centred and legible. */
  function panTo(uid) {
    const box = layout.unis.get(uid);
    if (!box) return;
    const r = viewport.getBoundingClientRect();
    const k = Math.max(view.k, Math.min(1, (r.width - 60) / box.w, (r.height - 60) / box.h, 0.9));
    view.k = Math.min(1.4, Math.max(0.08, k));
    view.x = (r.width - box.w * view.k) / 2 - box.x * view.k;
    view.y = Math.min(20, (r.height - box.h * view.k) / 2) - box.y * view.k;
    applyTransform();
  }

  function focusUniverse(uid, pan) {
    focusedUni = uid;
    selected = null;
    if (collapsed.has(uid)) collapsed.delete(uid);
    render();
    if (pan) panTo(uid);
    showUniverse(model.uniById[uid]);
  }

  function applyFilter() {
    const q = query.trim().toLowerCase();
    for (const el of canvas.querySelectorAll('.cell')) {
      const c = model.byId[Number(el.dataset.cell)];
      const hit = !q || [
        String(c.id), c.name || '', c.summary, c.materialLabel, c.regionRaw,
        'm' + c.material, 'u=' + c.universe,
        ...c.surfaces.map((s) => String(s.name || s.id)),
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

  const linkCell = (id) => {
    const c = model.byId[id];
    return '<span class="link" data-goto-cell="' + id + '">' + (c ? esc(cellLabel(c)) : id) + '</span>';
  };
  const linkUni = (id) => {
    const u = model.uniById[id];
    return '<span class="link" data-goto-uni="' + id + '">' + (u ? esc(id === rootUni() ? 'Universe ' + id : uniLabel(u)) : 'u=' + id) + '</span>';
  };

  function crumbs(uid) {
    const path = pathToRoot(uid);
    const out = [];
    for (let i = 0; i < path.length; i++) {
      if (i % 2 === 0) out.push(linkUni(path[i]));
      else {
        const c = model.byId[path[i]];
        const e = model.edges.find((x) => x.kind === 'fill' && x.from === path[i] && x.to === path[i + 1]);
        out.push('cell ' + linkCell(path[i]) + (e && e.count > 1 ? ' <span class="x">\\u00D7' + e.count + '</span>' : '') +
          (c && c.role === 'lattice' ? ' <span class="x">lat</span>' : ''));
      }
    }
    return '<div class="crumbs">' + out.join('<span class="sep">\\u203A</span>') + '</div>';
  }

  function showDetail(c) {
    const d = $('detail');
    if (!c) { d.innerHTML = '<p class="empty">Select a cell, or a universe in the tree.</p>'; return; }
    const rows = [];
    rows.push(['Role', roleLabel(c.role)]);
    rows.push(['Universe', linkUni(c.universe) + (c.universe === rootUni() ? ' (root)' : '')]);
    rows.push(['Material', c.material === 0 ? 'void' : esc(c.materialLabel) + (model.language === 'mcnp' ? ' (m' + c.material + ')' : '')]);
    if (c.density != null) {
      rows.push(['Density', densityText(c) + (c.density < 0 ? ' (mass)' : ' (atom)')]);
    }
    if (c.temperatureK != null) rows.push(['tmp', Math.round(c.temperatureK) + ' K']);
    if (c.lattice) rows.push(['Lattice', c.lattice === 2 ? 'hexagonal (lat=2)' : 'square (lat=1)']);
    if (c.hasTrcl) rows.push(['trcl', 'yes']);
    if (c.line != null) rows.push(['Line', String(c.line + 1)]);

    const fills = model.edges.filter((e) => e.kind === 'fill' && e.from === c.id);

    d.innerHTML =
      '<h2>Cell ' + c.id + (c.name ? ' \\u2014 ' + esc(c.name) : (c.summary ? ' \\u2014 ' + esc(c.summary) : '')) + '</h2>' +
      '<dl>' + rows.map((r) => '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>').join('') + '</dl>' +
      '<h3>Path from root</h3>' + crumbs(c.universe) +
      '<h3>Region</h3><pre>' + esc(c.regionRaw || '(empty)') + '</pre>' +
      (c.regionError ? '<p style="color:var(--role-graveyard)">' + esc(c.regionError) + '</p>' : '') +
      '<h3>Bounding surfaces</h3>' +
      (c.surfaces.length
        ? '<dl>' + c.surfaces.map((s) =>
            '<dt><span class="link" data-goto-surf="' + s.id + '" data-sname="' + esc(s.name || '') + '">' +
            (s.sense === '+/-' ? '\\u00B1' : s.sense) + esc(s.name || s.id) + '</span></dt><dd>' +
            (s.undefined ? '<em>no surface card</em>' : esc(s.summary)) + '</dd>').join('') + '</dl>'
        : '<p class="empty">none</p>') +
      (fills.length
        ? '<h3>Fills with</h3><dl>' + fills.map((e) => {
            const u = model.uniById[e.to];
            return '<dt>' + linkUni(e.to) + '</dt><dd>' + esc(u ? (u.summary || u.$.line) : 'undefined') +
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

  function showUniverse(u) {
    const d = $('detail');
    if (!u) { showDetail(null); return; }
    const rows = [];
    rows.push(['Depth', String(u.depth)]);
    rows.push(['Cells', String(u.cells.length)]);
    if (u.filledBy.length) {
      rows.push(['Filled by', u.filledBy.slice(0, 12).map((id) => 'cell ' + linkCell(id)).join(', ') +
        (u.filledBy.length > 12 ? ' +' + (u.filledBy.length - 12) : '')]);
    } else {
      rows.push(['Filled by', u.id === rootUni() ? 'nothing \\u2014 this is the root' : '<span style="color:var(--role-graveyard)">nothing (orphan)</span>']);
    }
    if (u.$.kids.length) {
      rows.push(['Fills', u.$.kids.map((k) => linkUni(k.to) + (k.n > 1 ? ' \\u00D7' + k.n : '')).join(', ')]);
    }
    if (u.$.mats.length) rows.push(['Materials', esc(u.$.mats.join(', '))]);

    const list = sortedCells(u).map((id) => {
      const c = model.byId[id];
      const what = c.role === 'material' ? c.materialLabel + (c.density != null ? ' ' + densityText(c) : '')
        : c.role === 'void' ? 'void'
        : c.role === 'graveyard' ? roleLabel('graveyard')
        : (c.role === 'lattice' ? 'lat=' + c.lattice + ' ' : 'fill ') +
          model.edges.filter((e) => e.kind === 'fill' && e.from === id).slice(0, 3)
            .map((e) => uniLabel(model.uniById[e.to] || { id: e.to })).join(', ');
      return '<li><span class="sw" style="background:' + ROLES[c.role].color + '"></span>' +
        linkCell(id) + '<span class="m">' + esc(what) + '</span></li>';
    }).join('');

    d.innerHTML =
      '<h2>' + esc(u.id === rootUni() ? 'Universe ' + u.id : uniLabel(u)) + (u.summary ? ' \\u2014 ' + esc(u.summary) : '') + '</h2>' +
      '<p style="margin:2px 0 0;opacity:.75">' + esc(u.$.line) + '</p>' +
      '<dl style="margin-top:8px">' + rows.map((r) => '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>').join('') + '</dl>' +
      '<h3>Path from root</h3>' + crumbs(u.id) +
      '<h3>Cells</h3><ul class="cells">' + list + '</ul>';
  }

  function select(id, reveal) {
    selected = id;
    const c = model.byId[id] || null;
    if (c) focusedUni = c.universe;
    showDetail(c);
    highlight();
    renderTree();
    canvas.querySelectorAll('.uni').forEach((el) => el.classList.toggle('focus', Number(el.dataset.uniBox) === focusedUni));
    if (reveal && c) vscode.postMessage({ command: 'revealCell', id, name: c.name || '' });
  }

  function revealSurface(el) {
    vscode.postMessage({ command: 'revealSurface', id: Number(el.dataset.surf || el.dataset.gotoSurf), name: el.dataset.sname || '' });
  }

  canvas.addEventListener('click', (ev) => {
    const chip = ev.target.closest('.chip');
    if (chip) {
      ev.stopPropagation();
      revealSurface(chip);
      return;
    }
    const head = ev.target.closest('header[data-uni]');
    if (head) {
      const uid = Number(head.dataset.uni);
      if (collapsed.has(uid)) collapsed.delete(uid); else collapsed.add(uid);
      focusedUni = uid;
      render();
      showUniverse(model.uniById[uid]);
      return;
    }
    const cell = ev.target.closest('.cell');
    if (cell) select(Number(cell.dataset.cell), true);
  });

  $('detail').addEventListener('click', (ev) => {
    const c = ev.target.closest('[data-goto-cell]');
    if (c) {
      const id = Number(c.dataset.gotoCell);
      const cell = model.byId[id];
      if (cell && collapsed.has(cell.universe)) { collapsed.delete(cell.universe); render(); }
      select(id, true);
      const b = layout.cells.get(id);
      if (b) {
        const r = viewport.getBoundingClientRect();
        view.x = r.width / 2 - (b.ax + b.w / 2) * view.k;
        view.y = r.height / 2 - (b.ay + b.h / 2) * view.k;
        applyTransform();
      }
      return;
    }
    const u = ev.target.closest('[data-goto-uni]');
    if (u) { focusUniverse(Number(u.dataset.gotoUni), true); return; }
    const s = ev.target.closest('[data-goto-surf]');
    if (s) revealSurface(s);
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
    collapsed = new Set(model.universes.filter((u) => u.id !== rootUni()).map((u) => u.id));
    render(); fit();
  });
  $('treeToggle').addEventListener('click', () => {
    tree.classList.toggle('hidden');
    $('treeToggle').classList.toggle('on', !tree.classList.contains('hidden'));
  });
  $('q').addEventListener('input', (ev) => { query = ev.target.value; applyFilter(); });

  function paintLegend() {
    $('legend').innerHTML = Object.keys(ROLES).map((k) =>
      '<span class="key"><span class="dot" style="background:' + ROLES[k].color + '"></span>' +
      roleLabel(k) + '</span>').join('');
  }
  paintLegend();

  // Big decks start folded past the first levels: on a full core that leaves
  // the world and the core lattice open and 60 pin universes as one-line
  // summaries, which is the readable default; the tree opens the rest.
  function defaultCollapse() {
    const n = model.cells.length;
    const minDepth = n > 300 ? 2 : n > 120 ? 3 : Infinity;
    collapsed = new Set(model.universes.filter((u) => u.id !== rootUni() && u.depth >= minDepth).map((u) => u.id));
  }

  // ---- host messages ------------------------------------------------------
  window.addEventListener('message', (ev) => {
    const msg = ev.data;
    if (msg.type !== 'model') return;
    const first = model === null;
    const prevSelected = selected;
    model = msg.model;
    derive();
    paintLegend();

    if (first) defaultCollapse();
    collapsed = new Set([...collapsed].filter((u) => model.uniById[u]));
    if (focusedUni != null && !model.uniById[focusedUni]) focusedUni = null;

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
    else if (focusedUni != null) showUniverse(model.uniById[focusedUni]);
    else { selected = null; showDetail(null); }
    // A full core fitted to the viewport is a hairball; start on the root at
    // a readable zoom and let the tree drive the rest. Small decks fit whole.
    if (first) {
      if (model.cells.length > 120) { focusedUni = rootUni(); panTo(rootUni()); showUniverse(model.uniById[rootUni()]); renderTree(); }
      else fit();
    }
  });

  vscode.postMessage({ command: 'ready' });
}());
</script>
</body>
</html>`;
}
