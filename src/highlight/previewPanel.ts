import * as vscode from 'vscode';
import {
    Language,
    LANGUAGE_LABELS,
    PALETTE_IDS,
    PALETTE_LABELS,
    PALETTE_DESCRIPTIONS,
    PaletteId,
    styleForScope,
} from './palettes';

// A single fragment of a sample line. `scope` (when present) is one of the
// TextMate scope keys our grammars emit and our palettes target — the preview
// asks palettes.ts for that scope's color so the rendering is accurate. Tokens
// with no scope render in the default editor foreground.
interface SampleToken {
    text: string;
    scope?: string;
}
type SampleLine = SampleToken[];

/** Terse token constructor to keep the sample tables readable. */
function tk(text: string, scope?: string): SampleToken {
    return { text, scope };
}

// Representative, domain-correct samples per language. Each token is tagged with
// the same scope the grammar would assign, so every palette recolors the
// identical text exactly as the editor would. Kept short (~6–12 lines).
const SAMPLES: Record<Language, SampleLine[]> = {
    mcnp: [
        [tk('c Cell cards', 'comment.line.mcnp')],
        [tk('100', 'entity.name.cell.mcnp'), tk(' 2 '), tk('-7.86', 'constant.numeric.mcnp'), tk(' -8 9 '), tk('imp', 'keyword.control.mcnp'), tk(':n', 'keyword.other.particle.mcnp'), tk('='), tk('1', 'constant.numeric.mcnp')],
        [tk('c Surface cards', 'comment.line.mcnp')],
        [tk('21 ', 'entity.name.surface-id.mcnp'), tk('rpp', 'storage.type.surface.mcnp'), tk(' -25 25 -60 60 0 300', 'constant.numeric.mcnp')],
        [tk('23 ', 'entity.name.surface-id.mcnp'), tk('c/z', 'storage.type.surface.mcnp'), tk(' 0 0 0.4096', 'constant.numeric.mcnp')],
        [tk('c Material cards', 'comment.line.mcnp')],
        [tk('m100', 'entity.name.material.mcnp'), tk(' '), tk('08016.31c', 'constant.other.zaid.mcnp'), tk(' -2.75'), tk(' 26000.31c', 'constant.other.zaid.mcnp'), tk(' -0.00225')],
        [tk('mt100', 'entity.name.mt-card.mcnp'), tk(' '), tk('lwtr.20t', 'constant.other.library.mcnp')],
        [tk('mode', 'keyword.control.mcnp'), tk(' n p')],
        [tk('f4', 'support.function.tally.mcnp'), tk(':n', 'keyword.other.particle.mcnp'), tk(' 1')],
    ],
    openmc: [
        [tk('import '), tk('openmc', 'variable.language.openmc')],
        [tk('')],
        [tk('fuel = '), tk('openmc', 'variable.language.openmc'), tk('.'), tk('Material', 'support.class.openmc'), tk("(name='UO2')")],
        [tk('fuel.'), tk('add_nuclide', 'support.function.openmc'), tk("('U235', 0.045)")],
        [tk('fuel.'), tk('set_density', 'support.function.openmc'), tk("('g/cm3', 10.4)")],
        [tk('src = '), tk('openmc', 'variable.language.openmc'), tk('.'), tk('IndependentSource', 'support.class.openmc'), tk('()')],
        [tk('src.'), tk('space', 'support.variable.openmc'), tk(' = '), tk('openmc', 'variable.language.openmc'), tk('.'), tk('stats', 'support.type.openmc'), tk('.'), tk('Box', 'support.class.openmc'), tk('((-1, -1, -1), (1, 1, 1))')],
        [tk('pin = '), tk('openmc', 'variable.language.openmc'), tk('.'), tk('model', 'support.type.openmc'), tk('.'), tk('RectangularPrism', 'support.class.openmc'), tk('(1.26, 1.26)')],
        [tk('cell.'), tk('fill', 'support.variable.openmc'), tk(' = fuel')],
        [tk('cell.'), tk('temperature', 'support.variable.openmc'), tk(' = 900.0')],
        [tk('settings.'), tk('batches', 'support.variable.openmc'), tk(' = 150')],
        [tk('mats.'), tk('export_to_xml', 'support.function.openmc'), tk('()')],
        [tk('openmc', 'variable.language.openmc'), tk('.'), tk('run', 'support.function.openmc'), tk('(threads=4)')],
    ],
    serpent: [
        [tk('/* PWR pin cell (Serpent) */', 'comment.line.serpent')],
        [tk('mat', 'keyword.control.serpent'), tk(' '), tk('fuel', 'entity.name.material.serpent'), tk(' '), tk('-10.42', 'constant.numeric.serpent')],
        [tk('92235.80c', 'constant.other.zaid.serpent'), tk(' '), tk('-0.0485', 'constant.numeric.serpent')],
        [tk('92238.80c', 'constant.other.zaid.serpent'), tk(' '), tk('-0.9515', 'constant.numeric.serpent')],
        [tk('surf', 'keyword.control.serpent'), tk(' '), tk('s1', 'entity.name.type.serpent'), tk(' cyl '), tk('0.0 0.0 0.4096', 'constant.numeric.serpent')],
        [tk('cell', 'keyword.control.serpent'), tk(' '), tk('c1', 'entity.name.type.serpent'), tk(' '), tk('0', 'constant.numeric.serpent'), tk(' fuel -s1')],
        [tk('set', 'keyword.control.serpent'), tk(' pop '), tk('5000 100 20', 'constant.numeric.serpent')],
        [tk('set', 'keyword.control.serpent'), tk(' title '), tk('"PWR pin cell"', 'string.quoted.serpent')],
    ],
    scone: [
        [tk('! SCONE eigenvalue pin-cell', 'comment.line.scone')],
        [tk('type', 'keyword.control.scone'), tk(' eigenPhysicsPackage;')],
        [tk('pop', 'keyword.control.scone'), tk(' '), tk('10000', 'constant.numeric.scone'), tk(';')],
        [tk('active', 'keyword.control.scone'), tk(' '), tk('100', 'constant.numeric.scone'), tk(';')],
        [tk('inactive', 'keyword.control.scone'), tk(' '), tk('20', 'constant.numeric.scone'), tk(';')],
        [tk('XSdata', 'keyword.control.scone'), tk(' '), tk('"./JEFF311.xsdata"', 'string.quoted.scone'), tk(';')],
        [tk('geometry', 'entity.name.section.scone'), tk(' {')],
        [tk('  '), tk('type', 'keyword.control.scone'), tk(' geometryStd;')],
        [tk('  '), tk('boundary', 'keyword.control.scone'), tk(' ('), tk('1 1 1 1 0 0', 'constant.numeric.scone'), tk(');')],
        [tk('}')],
    ],
};

let currentPanel: vscode.WebviewPanel | undefined;
let webviewReady = false;
let pendingHighlight: PaletteId | undefined;
let selectHandler: ((palette: PaletteId) => void) | undefined;

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** Render one sample for a language under one palette as colorized HTML. */
function renderSample(language: Language, palette: PaletteId): string {
    const lines = SAMPLES[language]
        .map((line) => {
            const spans = line
                .map((token) => {
                    const text = escapeHtml(token.text);
                    if (!token.scope) return text;
                    const style = styleForScope(language, palette, token.scope);
                    if (!style) return text;
                    const fontStyle = style.fontStyle ? `font-style:${style.fontStyle};` : '';
                    return `<span style="color:${style.foreground};${fontStyle}">${text}</span>`;
                })
                .join('');
            // Keep blank lines visible.
            return `<span class="ln">${spans || '&nbsp;'}</span>`;
        })
        .join('\n');
    return lines;
}

/** Build the labeled palette blocks (one per PaletteId) for the selected language. */
function renderBlocks(language: Language, selectedId: PaletteId): string {
    return PALETTE_IDS.map((id) => {
        const sample = renderSample(language, id);
        const selectedClass = id === selectedId ? ' selected' : '';
        return `<section class="card${selectedClass}" data-palette="${id}" id="palette-${id}" role="button" tabindex="0" title="Click to apply the ${escapeHtml(PALETTE_LABELS[id])} palette">
  <header class="card-head">
    <span class="card-title">${escapeHtml(PALETTE_LABELS[id])}</span>
    <span class="card-desc">${escapeHtml(PALETTE_DESCRIPTIONS[id])}</span>
    <span class="card-badge">Selected</span>
  </header>
  <pre class="code">${sample}</pre>
</section>`;
    }).join('\n');
}

function buildHtml(language: Language, selectedId: PaletteId): string {
    const blocks = renderBlocks(language, selectedId);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>OWEN: Palette Preview</title>
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family, "Segoe UI", sans-serif);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background, #1e1e1e);
    padding: 16px 18px 32px;
  }
  h1 { font-size: 15px; font-weight: 600; margin: 0 0 4px; }
  p.sub { font-size: 12px; opacity: 0.7; margin: 0 0 16px; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 14px;
  }
  .card {
    border: 1px solid var(--vscode-panel-border, #333);
    border-radius: 8px;
    overflow: hidden;
    background: var(--vscode-editor-background, #1e1e1e);
    transition: box-shadow 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
    cursor: pointer;
  }
  .card:hover {
    border-color: var(--vscode-focusBorder, #4ea1ff);
    box-shadow: 0 0 0 1px var(--vscode-focusBorder, #4ea1ff);
  }
  .card:active { transform: translateY(1px); }
  .card:focus-visible {
    outline: 2px solid var(--vscode-focusBorder, #4ea1ff);
    outline-offset: 2px;
  }
  /* Quick Pick navigation highlight (hovered item in the picker). */
  .card.active {
    border-color: var(--vscode-focusBorder, #4ea1ff);
    box-shadow: 0 0 0 2px var(--vscode-focusBorder, #4ea1ff);
  }
  /* The currently-applied palette. */
  .card.selected {
    border-color: var(--vscode-charts-green, #89d185);
    box-shadow: 0 0 0 2px var(--vscode-charts-green, #89d185);
  }
  .card-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--vscode-panel-border, #333);
    background: var(--vscode-sideBar-background, rgba(255,255,255,0.03));
  }
  .card-title { font-size: 13px; font-weight: 600; }
  .card-desc { font-size: 11px; opacity: 0.65; }
  .card-badge {
    display: none;
    margin-left: auto;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--vscode-charts-green, #89d185);
    border: 1px solid var(--vscode-charts-green, #89d185);
    border-radius: 10px;
    padding: 1px 8px;
  }
  .card.selected .card-badge { display: inline-block; }
  pre.code {
    margin: 0;
    padding: 12px 14px;
    font-family: var(--vscode-editor-font-family, "Cascadia Code", Consolas, monospace);
    font-size: var(--vscode-editor-font-size, 13px);
    line-height: 1.5;
    white-space: pre;
    overflow-x: auto;
    background: var(--vscode-editor-background, #1e1e1e);
  }
  .ln { display: block; }
</style>
</head>
<body>
  <h1>${escapeHtml(LANGUAGE_LABELS[language])} highlight palettes</h1>
  <p class="sub">Click a card to apply that palette, or pick one in the Quick Pick. The applied palette is marked “Selected”; the Quick Pick’s hovered palette is outlined.</p>
  <div class="grid">
    ${blocks}
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    function setActive(palette) {
      document.querySelectorAll('.card').forEach((el) => {
        el.classList.toggle('active', el.dataset.palette === palette);
      });
      if (palette) {
        const el = document.getElementById('palette-' + palette);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
    function setSelected(palette) {
      document.querySelectorAll('.card').forEach((el) => {
        el.classList.toggle('selected', el.dataset.palette === palette);
      });
    }
    function choose(palette) {
      if (!palette) return;
      setSelected(palette);
      vscode.postMessage({ type: 'select', palette });
    }
    document.querySelectorAll('.card').forEach((el) => {
      el.addEventListener('click', () => choose(el.dataset.palette));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          choose(el.dataset.palette);
        }
      });
    });
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data) return;
      if (data.type === 'highlight') setActive(data.palette);
      else if (data.type === 'selected') setSelected(data.palette);
    });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

/**
 * Open (or reveal and re-target) the palette-preview panel for a language. The
 * panel renders every palette side by side so the user can compare before
 * choosing. Each card is clickable: clicking applies that palette via the
 * supplied `onSelect` callback. `selectedId` marks the currently-applied
 * palette. Safe to call repeatedly; reuses a single panel.
 */
export function showPalettePreview(
    context: vscode.ExtensionContext,
    language: Language,
    selectedId: PaletteId,
    onSelect: (palette: PaletteId) => void,
): void {
    webviewReady = false;
    pendingHighlight = undefined;
    selectHandler = onSelect;

    if (!currentPanel) {
        currentPanel = vscode.window.createWebviewPanel(
            'owenPalettePreview',
            'OWEN: Palette Preview',
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            { enableScripts: true, retainContextWhenHidden: true },
        );
        currentPanel.onDidDispose(
            () => {
                currentPanel = undefined;
                webviewReady = false;
                pendingHighlight = undefined;
                selectHandler = undefined;
            },
            null,
            context.subscriptions,
        );
        currentPanel.webview.onDidReceiveMessage(
            (msg) => {
                if (!msg) return;
                if (msg.type === 'ready') {
                    webviewReady = true;
                    if (pendingHighlight) postHighlight(pendingHighlight);
                } else if (msg.type === 'select' && typeof msg.palette === 'string') {
                    selectHandler?.(msg.palette as PaletteId);
                }
            },
            null,
            context.subscriptions,
        );
    } else {
        currentPanel.reveal(vscode.ViewColumn.Beside, true);
    }

    currentPanel.title = `OWEN: ${LANGUAGE_LABELS[language]} Palette Preview`;
    currentPanel.webview.html = buildHtml(language, selectedId);
}

/** Outline/scroll the preview to a palette (no-op if the panel is closed). */
export function postHighlight(palette: PaletteId): void {
    pendingHighlight = palette;
    if (currentPanel && webviewReady) {
        currentPanel.webview.postMessage({ type: 'highlight', palette });
    }
}

/** Mark a palette as the applied/"selected" one (no-op if the panel is closed). */
export function postSelected(palette: PaletteId): void {
    if (currentPanel && webviewReady) {
        currentPanel.webview.postMessage({ type: 'selected', palette });
    }
}
