// Rosetta diff view: source deck and converted target side-by-side with
// aligned sections (cells / surfaces / materials / settings) and highlighted
// unconvertible constructs (issue source lines on the left, TODO(owen-convert)
// markers on the right).

import * as vscode from 'vscode';
import type { ConversionResult, TargetLanguage, SourceLanguage } from './index';
import { TODO_MARK } from './types';
import { parseMcnpDeck } from './mcnpModel';

interface SectionAnchor {
    name: string;
    sourceLine: number;
    targetLine: number;
}

function findTargetLine(outputLines: string[], patterns: RegExp[]): number {
    for (let i = 0; i < outputLines.length; i++) {
        if (patterns.some((p) => p.test(outputLines[i]))) return i;
    }
    return 0;
}

function computeAnchors(
    sourceText: string,
    source: SourceLanguage,
    outputLines: string[],
): SectionAnchor[] {
    if (source !== 'mcnp') {
        // OpenMC scripts have no fixed section order; anchor on the MCNP output side.
        return [
            { name: 'Cells', sourceLine: 0, targetLine: findTargetLine(outputLines, [/^c Cell Cards/i]) },
            { name: 'Surfaces', sourceLine: 0, targetLine: findTargetLine(outputLines, [/^c Surface Cards/i]) },
            { name: 'Materials / data', sourceLine: 0, targetLine: findTargetLine(outputLines, [/^c Data Cards/i]) },
        ];
    }
    const deck = parseMcnpDeck(sourceText);
    return [
        {
            name: 'Cells',
            sourceLine: deck.sections.cells[0],
            targetLine: findTargetLine(outputLines, [/# Geometry|--- Cells ---|^\s*cells \{/i, /openmc\.Cell\(/]),
        },
        {
            name: 'Surfaces',
            sourceLine: deck.sections.surfaces[0],
            targetLine: findTargetLine(outputLines, [/--- Surfaces ---|^\s*surfaces \{/i, /openmc\.(Z|X|Y)?(Cylinder|Plane|Sphere)/]),
        },
        {
            name: 'Materials',
            sourceLine: deck.sections.data[0],
            targetLine: findTargetLine(outputLines, [/# Materials|--- Materials ---|^\s*materials \{/i]),
        },
        {
            name: 'Settings',
            sourceLine: deck.sections.data[0],
            targetLine: findTargetLine(outputLines, [/# Settings|--- Settings ---|^pop /i]),
        },
    ];
}

export function showRosettaDiff(
    sourceText: string,
    source: SourceLanguage,
    result: ConversionResult,
    target: TargetLanguage,
): void {
    const panel = vscode.window.createWebviewPanel(
        'owen.rosettaDiff',
        `OWEN Rosetta: ${source.toUpperCase()} → ${target.toUpperCase()}`,
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true },
    );

    const outputLines = result.output.split('\n');
    const anchors = computeAnchors(sourceText, source, outputLines);
    const issueLines = new Set(result.issues.map((i) => i.sourceLine).filter((l) => l >= 0));

    const csp = [
        "default-src 'none'",
        `style-src ${panel.webview.cspSource} 'unsafe-inline'`,
        `script-src ${panel.webview.cspSource} 'unsafe-inline'`,
    ].join('; ');

    panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <style>
    :root { --bg: #0b1020; --card: #121a2e; --text: #e2e8f0; --muted: #94a3b8; --accent: #38bdf8; --border: rgba(255,255,255,0.08); --warn: rgba(249,115,22,0.22); --warnBorder: #f97316; }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: system-ui, sans-serif; font-size: 13px; height: 100vh; display: flex; flex-direction: column; }
    header { padding: 10px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .badge { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; color: var(--accent); border: 1px solid rgba(56,189,248,0.35); padding: 2px 8px; border-radius: 4px; }
    .badge.exp { color: #f97316; border-color: rgba(249,115,22,0.4); }
    h1 { margin: 0; font-size: 14px; }
    .anchors { display: flex; gap: 6px; }
    .anchor { padding: 4px 10px; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; font-size: 11px; color: var(--muted); background: var(--card); }
    .anchor:hover { border-color: var(--accent); color: var(--text); }
    label { font-size: 11px; color: var(--muted); display: flex; align-items: center; gap: 4px; }
    .cols { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--border); min-height: 0; }
    .col { background: var(--bg); display: flex; flex-direction: column; min-height: 0; }
    .col h2 { margin: 0; padding: 6px 12px; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; border-bottom: 1px solid var(--border); }
    .pane { flex: 1; overflow: auto; font-family: 'Cascadia Code', Consolas, monospace; font-size: 12px; line-height: 1.45; }
    .ln { display: flex; white-space: pre; }
    .ln .no { width: 46px; flex: none; text-align: right; padding-right: 10px; color: rgba(148,163,184,0.5); user-select: none; }
    .ln.issue { background: var(--warn); border-left: 2px solid var(--warnBorder); }
    .footer { padding: 8px 16px; border-top: 1px solid var(--border); font-size: 11px; color: var(--muted); max-height: 120px; overflow: auto; }
    .footer .issue-item { color: #fdba74; }
  </style>
</head>
<body>
  <header>
    <span class="badge">ROSETTA</span>
    <span class="badge exp">EXPERIMENTAL</span>
    <h1>${source.toUpperCase()} → ${target.toUpperCase()}</h1>
    <div class="anchors" id="anchors"></div>
    <label><input type="checkbox" id="sync" checked /> sync scroll</label>
  </header>
  <div class="cols">
    <div class="col">
      <h2>Source (${source.toUpperCase()})</h2>
      <div class="pane" id="left"></div>
    </div>
    <div class="col">
      <h2>Converted (${target.toUpperCase()}) — highlighted lines need manual attention</h2>
      <div class="pane" id="right"></div>
    </div>
  </div>
  <div class="footer" id="footer"></div>
  <script>
    const SOURCE = ${JSON.stringify(sourceText.split(/\r?\n/))};
    const TARGET = ${JSON.stringify(outputLines)};
    const ANCHORS = ${JSON.stringify(anchors)};
    const ISSUE_LINES = new Set(${JSON.stringify([...issueLines])});
    const ISSUES = ${JSON.stringify(result.issues)};
    const TODO_MARK = ${JSON.stringify(TODO_MARK)};

    function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

    function render(host, lines, isIssueLine) {
      host.innerHTML = lines.map((l, i) =>
        '<div class="ln' + (isIssueLine(l, i) ? ' issue' : '') + '" data-line="' + i + '">' +
        '<span class="no">' + (i + 1) + '</span><span>' + (esc(l) || ' ') + '</span></div>'
      ).join('');
    }

    const left = document.getElementById('left');
    const right = document.getElementById('right');
    render(left, SOURCE, (l, i) => ISSUE_LINES.has(i));
    render(right, TARGET, (l) => l.includes(TODO_MARK) || /WARNING/.test(l));

    const anchorsEl = document.getElementById('anchors');
    for (const a of ANCHORS) {
      const btn = document.createElement('span');
      btn.className = 'anchor';
      btn.textContent = a.name;
      btn.onclick = () => {
        const lEl = left.querySelector('[data-line="' + a.sourceLine + '"]');
        const rEl = right.querySelector('[data-line="' + a.targetLine + '"]');
        if (lEl) left.scrollTop = lEl.offsetTop - 8;
        if (rEl) right.scrollTop = rEl.offsetTop - 8;
      };
      anchorsEl.appendChild(btn);
    }

    // proportional synchronized scrolling
    let lock = false;
    function syncFrom(src, dst) {
      if (!document.getElementById('sync').checked || lock) return;
      lock = true;
      const ratio = src.scrollTop / Math.max(1, src.scrollHeight - src.clientHeight);
      dst.scrollTop = ratio * (dst.scrollHeight - dst.clientHeight);
      requestAnimationFrame(() => { lock = false; });
    }
    left.addEventListener('scroll', () => syncFrom(left, right));
    right.addEventListener('scroll', () => syncFrom(right, left));

    const footer = document.getElementById('footer');
    if (ISSUES.length === 0) {
      footer.textContent = 'No unconvertible constructs detected — still review the output before use.';
    } else {
      footer.innerHTML = '<b>' + ISSUES.length + ' construct(s) need manual attention:</b><br/>' +
        ISSUES.map(i => '<span class="issue-item">' +
          (i.sourceLine >= 0 ? 'line ' + (i.sourceLine + 1) + ': ' : '') + esc(i.message) + '</span>').join('<br/>');
    }
  </script>
</body>
</html>`;
}
