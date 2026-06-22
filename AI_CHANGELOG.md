# OWEN — AI Changelog

Engineering changelog for the **OWEN** VS Code / Cursor extension, in reverse
chronological order. Each entry records **what** changed, **why**, and any caveats future
maintainers (human or AI) should know.

This is the engineering-level log. User-facing release notes live in `CHANGELOG.md`. The
division-wide changelog is `AI_CHANGELOG.md` in the BelvoirDynamics monorepo root.

> OWEN is mirrored between the monorepo (`BelvoirDynamics/owen/`) and the public repo
> (`caalh/owen`). Changes are applied to both copies — see `AI_MAINTAINER_GUIDE.md` §9.

---

## 2026-06-22 — v0.1.8 — MCNP + Serpent 3D lattice/universe expansion (full assembly & nested core)

**AI Agent:** Claude (`claude-opus-4-8-thinking-high`, Cursor IDE)

Version bumped `0.1.7` → `0.1.8` in `package.json` and `package-lock.json`. Brings the MCNP and
Serpent preview parsers up to parity with the SCONE/OpenMC paths: they now expand full
universe/lattice hierarchies (assembly → nested core) toward the shared geometry IR instead of
drawing only bare pins / a single lattice.

### MCNP (`src/preview/codes/mcnp.ts`) — rewritten

- **Card preprocessing:** `logicalCards()` strips `$` inline + `c` comment cards, joins
  continuation lines (≥5 leading spaces or trailing `&`), and normalises `=` spacing.
  `classifyCard()` separates cell / surface / material cards (surface = mnemonic at token 1 or
  after a transform number; material = `m\d+`).
- **Surfaces:** `cz`, `c/z`, `cx/cy/c/x/c/y`, `pz`, `px`, `py`, and macrobodies `rpp`, `rcc`,
  `rhp`/`hex`. Cylinder radius helper reads `cz`(p0) / `c/z`(p2) / `rcc`(p6).
- **Materials by ZAID:** `classifyMaterial()` maps element sets to {name, component}: 92/94 →
  fuel, 5+6 → B4C, 47/49 → Ag-In-Cd, 5+14+8+13 → borosilicate, Fe/Cr/Ni or Mn → steel, 40 →
  Zircaloy, 1+8 → water, 2 → helium, 7+8 → air. Drives per-layer component + material colour.
- **Pin universes:** cells grouped by `u=`; each cell's outer radius = the smallest cylinder it
  is *inside* of (negative sense). Layers sorted by radius. Universe kind classified as
  fuel / guide / instrument (guide = no fuel + Zr tube + water centre; instrument = inner air),
  and Clad/Structure layers retagged guide_tube/instrument_tube accordingly.
- **Lattices:** a `lat=1/2` cell with `u=` + `fill`. `parseFill()` handles uniform fills and
  `i1:i2 j1:j2 k1:k2` index ranges (k=0 slice) with `nR` repeat expansion. Pitch from the lattice
  cell's `px`/`py` plane pairs, an `rpp`, or an `rhp` facet vector (flat-to-flat = 2|r|).
- **Hierarchy:** top universe = a universe-0 `fill` cell (preferring a lattice) else the
  largest-pitch lattice; `placeUniverse()` recurses lattice→lattice→pin (depth-guarded). Pin
  count picks fidelity: `> FULL_LAYER_LIMIT (4000)` ⇒ disc mode (one disc/pin), else concentric
  shells (`emitLayers`). Large `cz`/`c/z` surfaces (> footprint·0.5) become faint vessel shells.
  `MAX_CYLINDERS = 200000`. Decks with no universe/lattice fall back to the old bare z-axis
  cylinder render (`renderBareSurfaces`).

### Serpent (`src/preview/codes/serpent.ts`) — extended

- Kept `pin` block parsing; added `surf` (`cyl`/`cylx/y`/`sqc`/`hexxc`/`hexyc`), `cell`
  (`<name> <u> <mat | fill u2 | outside> <surfs>`), and **multiple + nested** `lat` cards
  (`lat <u> <type> <x0> <y0> <nx> <ny> <pitch>` + grid rows read across lines until nx·ny tokens).
- **Universe resolution:** `resolveFill()` follows `cell … fill u2` through bounding cells to a
  pin or lattice. `pinLayers()` builds layers from a `pin` block or from CSG cells referencing
  `cyl` surfaces. Core lattice = largest footprint (nx·ny·pitch²) or an explicit universe-0
  `fill`. Recursive `placeUniverse()` mirrors SCONE/MCNP; disc mode for full cores; vessel shells
  from large `cyl` surfaces. Instrument tubes detected from an air/void centre (Serpent pins are
  often numbered, not named).

### Test fixtures created (user lacked BEAVRS in these codes)

Saved to `C:\Users\me\reactor-test-decks\` (alongside `beavrs_scone_fullcore.scone`):

- `assembly_17x17_mcnp.i`, `assembly_17x17_serpent.sss` — Westinghouse 17×17 (264 fuel + 24
  guide + 1 instrument = 289 positions; pitch 1.26; radii 0.39218/0.40005/0.45720).
- `beavrs_core_mcnp.i`, `beavrs_core_serpent.sss` — nested core (~197 assemblies, pitch
  21.50364; 3-region 1.6/2.4/3.1% loading; barrel + RPV shells). Viz-only, clearly commented;
  not converged/runnable. ZAIDs use `.80c` (ENDF/B-VII.1 assumed); no invented ZAIDs.

Verified via the bundled extractor (esbuild API → node): assemblies render **844 primitives /
17 columns / 24 guide + 1 instrument tube**; cores render **~56.9k disc pins / 197 guide-tube
rings per-assembly·24 = 4,728 guide tubes / 197 instrument tubes / vessel shells**, in disc mode.

### Tests

- Added 7 extractor tests (`src/test/suite/extractor.test.ts`): MCNP 3×3 lattice, MCNP nested
  core (16 pins/4 cols), MCNP instrument-vs-guide classification, MCNP bare-pin back-compat;
  Serpent 3×3 lattice, Serpent nested core, Serpent instrument-tube classification. **All 17
  extractor tests pass headless** (`tsc --outDir out-test` then `mocha out-test/.../extractor.test.js`;
  the extractor has no `vscode` import). The full `npm test` (validator/sweep/line guard) still
  needs `@vscode/test-electron`, which is locked in this environment — run locally.

### Build / verify

- `node ./node_modules/typescript/bin/tsc --noEmit` clean; `node esbuild.js --production` clean;
  `out/` ships only `extension.js` (`.vscodeignore` `out/**` + `!out/extension.js` preserved).
  Per the env notes, `npx esbuild/tsc/vsce` hang on this machine — used the JS APIs / local
  binaries throughout.

## 2026-06-22 — v0.1.7 — 3D geometry preview overhaul: real lattice/universe parsing, layer toggles, instancing

**AI Agent:** Claude (`claude-opus-4-8-thinking-high`, Cursor IDE)

Version bumped `0.1.6` → `0.1.7` in `package.json` and `package-lock.json`. This replaces the
shallow name-pattern geometry heuristic with a real per-code parser architecture feeding a
shared geometry IR, fixes the "17×17 renders as a single pin" and "can't render a SCONE core"
bugs, and rebuilds the webview around instanced rendering with layer/material toggles.

### Root cause of the single-pin / no-core bugs

- **OpenMC single pin** — the old wired path (`extractor.ts` `extractOpenmcCylinders`, the
  v0.1.0 port) only built a lattice when it found literal `guide_tube_coords` /
  `guide_positions` names (lines ~258–283). Any normal 17×17 deck — literal nested list,
  symbol grid, or the dominant `np.full(...)` + assignment idiom — has neither, so `latticeSize`
  stayed `null` and it returned a single 2-layer pin.
- **SCONE no core** — the wired SCONE path capped at `MAX_CYLINDERS = 15000` and, more
  importantly, the webview created **one `THREE.Mesh` per cylinder**; a ~55k-pin core is
  ~55k draw calls, which hangs the view. The newer `src/preview/codes/scone.ts` scaffolding
  was never wired into `extractor.ts`.

### Architecture

- **`src/preview/types.ts`** — canonical geometry IR. `CylinderSpec` gains `material` and an
  optional `shape: 'cylinder' | 'box'`. New `ParseResult` ({cylinders, warnings, notes}),
  `GeometryScene` (adds component/material legend summaries + `primitiveCount`), and
  `ComponentSummary` / `MaterialSummary`.
- **`src/preview/palette.ts`** — `emitLayers()` now also accepts per-layer material names so
  cylinders carry their raw material (drives the material-toggle group).
- **`src/preview/extractor.ts`** — reduced to a dispatcher. `extractCylinders(text, lang)`
  (back-compat, used by tests) returns the flat list; new `buildScene(text, lang)` wraps the
  per-code `ParseResult` with `summarizeComponents()` / `summarizeMaterials()` (first-seen
  color, fuel→…→vessel ordering) for the webview legend.
- Per-code parsers each export `parseX(text): ParseResult` (+ a thin `extractXCylinders`):
  `codes/scone.ts`, `codes/openmc.ts`, `codes/serpent.ts`, and new **`codes/mcnp.ts`**.

### Per-code capability after this pass

- **SCONE (`codes/scone.ts`)** — brace-aware leaf-block walk → classify pin/lat/cell/surface;
  `resolveToPin()` resolves `cellUniverse` shells to a representative pin by majority vote,
  **preferring pins that have geometry** (so a mostly-water axial stack with one fuel segment
  resolves to fuel). Core lattice = largest pitch; recursively places assemblies → pins.
  `> FULL_LAYER_LIMIT (4000)` pins ⇒ **disc mode** (one full-height disc per pin, colored by
  material, component from pin name so guide/instrument/absorber are tagged correctly);
  otherwise **layer mode** (concentric shells). Vessel/barrel from `zCylinder`/`zTruncCylinder`
  surfaces. `MAX_CYLINDERS = 200000`. **Verified on the real BEAVRS full-core fixture:** 55,784
  primitives in ~100 ms; components fuel 50,952 / guide_tube 3,380 / instrument_tube **193**
  (= one per assembly, a good sanity check) / absorber 1,252 / vessel 7; x-extent ±160.6 cm.
- **OpenMC (`codes/openmc.ts`)** — `findLatticeGrid()` (literal nested lists + quoted symbol
  grids) **plus new `buildNumpyGrid()`**: parses `arr = np.full((R,C), base)` then applies
  element assignments (`arr[i,j]=X`, `arr[i][j]=X`) and coordinate-list loops
  (`for (i,j) in [(r,c),…]: arr[i,j]=X`). Radii recovered from `ZCylinder(r=…)` + scalar
  assignments grouped into fuel/guide/instrument templates. If a lattice is declared but can't
  be expanded, emits a **warning** instead of a silent single pin.
- **Serpent (`codes/serpent.ts`)** — `pin` blocks + first `lat` card → full pin lattice with
  per-layer material/component. `surf`/`cell` CSG and nested lattices not expanded (warned).
- **MCNP (`codes/mcnp.ts`)** — z-axis cylinders `cz` and offset `c/z x y r`, `pz` axial bounds,
  concentric stacks tagged fuel→gap→clad→moderator. `lat`/`fill` lattices and non-z-axis
  cylinders are **reported, not silently dropped**.

### Webview (`src/preview/webview.ts`)

- Full rebuild around **`THREE.InstancedMesh`**, grouped by geometry signature
  (`shape|solid|radius|height|opacityBucket|segments`); per-instance color via `setColorAt`.
  Solid = innermost/opaque pins (capped cylinders); translucent open tubes = outer shells &
  vessel. ~50k pins ⇒ a few dozen instanced draw calls.
- **Layer panel:** component checkboxes (with swatch + count) and a collapsible material list,
  All/None; visibility is applied per-instance (matrix → zero-scale when hidden) so component
  **and** material filters compose. Plus a global shell-opacity slider and **X/Y clipping
  planes** (`renderer.localClippingEnabled`) to slice into the core.
- Warnings/notes are surfaced in-panel and as an empty-state overlay (no more silent single
  pin). The `{type:'ready'}` handshake is preserved; payload message is now `{type:'scene'}`.

### Tests

- `src/test/suite/extractor.test.ts` — added lattice-expansion tests: OpenMC numpy 17×17
  (asserts ≥200 cylinders, ≥17 columns, guide tubes present), OpenMC literal nested list,
  unexpandable-lattice **warning**, nested SCONE core (2×2 of 2×2 ⇒ 32 pin cylinders, 4
  columns, vessel shell), and `buildScene` legend. **All 10 extractor tests pass headless via
  mocha** (the extractor has no `vscode` import). The full `npm test` (validator/sweep/line
  guard) still runs under `@vscode/test-electron`, which may need a local run.

### Verification

- `npx tsc --noEmit` clean; `node esbuild.js` clean. Visual confirmation requires the user in
  the Extension Dev Host / installed VSIX (open the BEAVRS fixture → **OWEN: Open 3D Geometry
  Preview** → toggle layers / slice).
- Note: on the dev machine the `npx esbuild` **CLI** hangs (unrelated to the bundle); the
  esbuild **JS API** (`node esbuild.js`) works fine and is what the build scripts use.

## 2026-06-22 — v0.1.6 — Invisible-char toggle, MCNP line guard, editor-title menu, clickable palettes, sweep tests

**AI Agent:** Claude (`claude-opus-4-8-thinking-high`, Cursor IDE)

Version bumped `0.1.5` → `0.1.6` in `package.json` and `package-lock.json`. Four UX features
plus pure-logic unit tests for the parameter sweep. (The feature code landed on `main` in
commit `e1a1e2b`; this release cuts the version, changelogs, and extended sweep docs.)

### A — Toggle invisible characters + MCNP line-length guard

- **`src/decorations/invisibles.ts` (new).** `OWEN: Toggle Invisible Characters`
  (`owen.toggleInvisibleCharacters`) flips **only** `editor.renderWhitespace` (`all`) and
  `editor.renderControlCharacters` (`true`) at the Global target. The prior global values are
  captured in `globalState` on toggle-on and restored verbatim on toggle-off; a sentinel
  (`\u0000owen-unset`) distinguishes "user had no explicit value" so we revert to default
  rather than forcing one. Never touches unrelated settings.
- **`src/decorations/lineLength.ts` (new, pure).** `findOverlengthLines(text, limit)` and
  `expandedWidth()` compute over-limit MCNP lines with **tab expansion** to 8-column stops, so
  a visually-short line with a tab is still flagged. `MCNP_DEFAULT_LINE_LIMIT = 80`.
- **`src/decorations/mcnpLineGuard.ts` (new).** Three reinforcing signals for the configurable
  limit (`owen.mcnp.lineLengthLimit`, default 80, set 128 for MCNP6.2+): (1) a **language-scoped
  ruler** written programmatically to `[mcnp].editor.rulers` via `ensureMcnpRuler()` — chosen
  over `contributes.configurationDefaults` so the ruler tracks the *configurable* limit, and it
  refuses to clobber a user's own MCNP ruler; (2) a `DiagnosticCollection` (Problems + squiggle)
  with a clear "characters past column N are silently ignored" message; (3) a tail decoration on
  the overflow. Kept in sync on open/change/active-editor/config-change.
- **`src/decorations/index.ts` (new).** `registerDecorations()` wires both; called from
  `extension.ts`.

### B — OWEN in the editor title bar

- **`package.json`.** New `owen.editorTitleMenu` submenu (icon `$(beaker)`) contributed to
  `editor/title` group `navigation@100`, gated by
  `when: editorLangId =~ /^(mcnp|serpent|scone|python)$/`. It mirrors the right-click
  `owen.contextMenu` actions, grouped analyze/build/run/view/help.

### C — Click-to-apply palette in the preview

- **`src/highlight/previewPanel.ts`.** Palette cards are now `role="button"`/`tabindex="0"`;
  click or Enter/Space posts `{type:'select', palette}` to the extension. Added `.selected`
  state + a **Selected** badge and `postSelected()` to reflect the applied palette; hover/active
  affordances. The webview→extension `select` message is handled in `showPalettePreview`'s
  `onDidReceiveMessage` via an `onSelect` callback.
- **`src/highlight/index.ts`.** `chooseHighlightPalette` passes an `onSelect` that runs
  `applySelection(language, palette)` (writes `owen.highlight.<lang>.palette` + `applyPalettes()`)
  then `postSelected()`. The Quick Pick `pickPaletteWithPreview` flow is unchanged.

### D — Parametric sweep tests + docs

- **`src/workflows/sweepCore.ts` (new, pure).** Extracted the deterministic sweep logic from
  `sweep.ts`: `cartesian()` (parameter expansion), `applyParameters()` (capture-group-1 regex
  substitution that preserves surrounding text), `parseKeff()` (Serpent/OpenMC/fallback regexes,
  `null` → "n/a"), `runDirName()`, `buildManifest()`, `buildSummaryTsv()`. `sweep.ts` now
  delegates to these.
- **`src/test/suite/sweep.test.ts` (new).** Mocha tdd tests for expansion, substitution (incl.
  "don't touch identical digits elsewhere"), k-eff parsing (incl. miss → null and an increasing
  enrichment→k-eff trend), and manifest/TSV layout (incl. failed-run `n/a`). No OpenMC is run.
- **`src/test/suite/lineLength.test.ts` (new).** Tests the line-length core (default 80, tab
  expansion, custom 128 limit).
- **`docs/SWEEP_VALIDATION.md` (new)** and an **extended `docs/OPENMC_EVALUATION.md` T10**
  section with a concrete worked enrichment sweep (base `pincell.py`, `sweep.json`, expected
  `sweep-summary.tsv` with monotonically increasing k-eff).

### Verification & caveats

- `tsc --noEmit` + `node esbuild.js` clean; VSIX `owen-neutronics-0.1.6.vsix` packaged.
- Unit tests are pure-logic and need no OpenMC; they run under `@vscode/test-electron` which
  needs a windowing/electron environment (may need a local `npm test` run on the user's machine
  if a headless launch isn't available in CI/agent).
- No new dependencies, no forced user settings beyond the documented toggle/ruler. Identity
  (`name`/`publisher`/`displayName`/command ids) unchanged. Marketplace + Open VSX republish
  need the user's tokens.

## 2026-06-04 — v0.1.5 — Highlight-palette preview webview (all 4 palettes at once)

**AI Agent:** Claude (`claude-opus-4-8-thinking-high`, Cursor IDE)

Version bumped `0.1.4` → `0.1.5` in `package.json` and `package-lock.json`.

### What & why

v0.1.3 let users choose one of four palettes per language but gave no way to *see* a palette
before committing — you had to apply it, look at a real file, and repeat. This release adds a
**preview webview** so all four palettes are visible side by side at the moment of choosing.

- **`src/highlight/previewPanel.ts` (new).** Owns a single reusable `WebviewPanel`
  (`owenPalettePreview`) opened beside the editor with `preserveFocus: true` so the Quick Pick
  keeps focus. For the selected language it renders a short, domain-correct sample as four
  labeled cards (Classic / Solarized / High Contrast / Pastel), each coloring the **same**
  sample.
  - **Single source of truth for colors.** Samples are defined as token sequences, each token
    tagged with the *same* TextMate scope key the grammars emit (e.g. `constant.other.zaid.mcnp`,
    `support.class.openmc`). Each token is colored by calling the new
    `styleForScope(language, palette, scope)` exported from `palettes.ts`, which resolves
    scope → role → palette color. No runtime tokenizer; the preview shows exactly what the
    editor's `tokenColorCustomizations` would produce. Untagged tokens fall back to the default
    foreground.
  - **Scope accuracy.** Sample tokens were tagged against the actual grammars under
    `syntaxes/` — e.g. MCNP surfaces use lowercase `rcc`/`rpp` (the grammar's `surface` regex is
    lowercase), `imp` is `keyword.control.mcnp`, `m1` is `entity.name.material.mcnp`; SCONE
    `geometry {` is `entity.name.section.scone` (the `block` pattern wins over `keyword` because
    it precedes it in the grammar).
  - **Theme-native styling.** Uses `--vscode-editor-background`, `--vscode-editor-font-family`,
    `--vscode-editor-font-size`, `--vscode-panel-border`, `--vscode-focusBorder` so it matches
    the user's theme. HTML is escaped. No external/CDN scripts (unlike the 3D preview), so no
    special CSP is needed.
  - **`postHighlight(palette)`** posts a message that outlines the matching card and
    `scrollIntoView`s it; a `ready` handshake (mirroring `src/preview/webview.ts`) re-sends the
    last highlight if it arrived before the webview script loaded.

- **`src/highlight/index.ts`.** Refactored the chooser:
  - Extracted `applySelection(language, id)` (unchanged write + `applyPalettes()` + info toast).
  - **Live Quick Pick (bonus UX wired).** Replaced the second `showQuickPick` with a
    `createQuickPick()` so `onDidChangeActive` can drive `postHighlight(...)` as the user moves
    through palettes; `onDidAccept` applies, `onDidHide` resolves/cancels. The current palette is
    pre-selected and seeds the preview. Language pick is unchanged.
  - `chooseHighlightPalette(context)` now takes the `ExtensionContext` (needed for the panel's
    disposables); the command registration passes it via an arrow wrapper.

### Verified

- `npx tsc --noEmit` clean; `node esbuild.js` clean (preview panel inlined into
  `out/extension.js`).
- `npx vsce package` → `owen-neutronics-0.1.5.vsix`.
- No new dependencies. No editor settings forced. Identity (`name`, `publisher`, command ids)
  unchanged. The lazy-Supabase rule is untouched.

### Caveats

- Visual confirmation requires installing 0.1.5 and running **OWEN: Choose Highlight Palette**.
- Marketplace / Open VSX republish need the user's tokens (commands in the release report).

## 2026-06-04 — v0.1.4 — Snippets auto-surface while typing (trigger chars + preselect)

**AI Agent:** Claude (`claude-opus-4-8-thinking-high`, Cursor IDE)

Version bumped `0.1.3` → `0.1.4` in `package.json` and `package-lock.json`.

### What & why

Reported symptom: after 0.1.2 added the `CompletionItemProvider`, the `omc_*` snippets
appeared on **Ctrl+Space** but **not automatically while typing** `omc_` — Pylance's
as-you-type / inline suggestion occupied the slot, so users only saw OWEN items on a manual
trigger.

- **Ruled out** the runtime-path / bundling / registration hypotheses: the user confirmed
  Ctrl+Space *does* list the OWEN snippets, so the provider loads the JSON
  (`fs.readFileSync(path.join(context.extensionPath, 'snippets', file))` — `extensionPath` is
  the VSIX root, and `.vscodeignore` does not exclude `snippets/`, so the read succeeds) and is
  registered correctly. The defect was purely **as-you-type surfacing**, not loading.

- **Fix (`src/completions/snippets.ts`).**
  - **Trigger characters.** `registerCompletionItemProvider` is now called with the lowercase
    alphabet + `_` as trigger characters, so the suggestion widget opens/refreshes on each
    prefix keystroke instead of relying on the user pressing Ctrl+Space.
  - **Replacement range.** `provideCompletionItems` computes the identifier word under the
    cursor (`getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/)`) and assigns it to each
    item's `range`, so `omc_` filters to and is replaced by the snippet body.
  - **Preselect.** The first item whose `filterText` starts with the typed text gets
    `preselect = true`, highlighting the best OWEN match ahead of language-server items.
  - **sortText** unchanged (`0_owen_<prefix>`) — still biases OWEN items to the top.
  - **Output channel.** Added a guarded one-time log to a new `OWEN` output channel reporting
    the count of snippets loaded (and a line per file that loads none), so future "snippets
    don't show" reports are easy to triage. No per-keystroke logging.
  - The Python gate (`detectMonteCarloLanguage`) is unchanged and already tolerant of
    `import openmc`, `import openmc as …`, and `from openmc import …` (regex
    `OPENMC_IMPORT_RE` in `src/util/detectLanguage.ts`).

- **Did not** force any editor settings. `CHANGELOG.md` documents the optional
  `editor.snippetSuggestions: "top"` tip instead of writing it on the user's behalf.

### Verified

- `npx tsc --noEmit` clean; `node esbuild.js` clean. The bundle `out/extension.js` inlines the
  provider (grep for `registerCompletionItemProvider` / `0_owen_`); snippet JSON is still read
  at runtime from the VSIX root (already proven to work via the user's Ctrl+Space confirmation).
- `npx vsce package` → `owen-neutronics-0.1.4.vsix`; `npx vsce ls` confirms the four snippet
  JSON files ship.
- **Not** verified: the auto-popup-while-typing behavior on screen — that needs the user to
  install 0.1.4 and type `omc_` in a Python file that imports openmc.

### Still required for installed users to get this
- `vsce`/`ovsx` republish (needs the user's tokens) and the `caalh/owen` mirror sync + release.

## 2026-06-04 — v0.1.3 — Per-language syntax-highlighting palettes (4×4)

**AI Agent:** Claude (`claude-opus-4-8-thinking-high`, Cursor IDE)

Version bumped `0.1.2` → `0.1.3` in `package.json`.

### What & why

Goal: let the user pick one of four color palettes *per language* (MCNP, OpenMC, Serpent,
SCONE = 16 combos) and recolor that language's tokens live.

- **Investigation.** MCNP/Serpent/SCONE already had custom TextMate grammars
  (`syntaxes/*.tmLanguage.json`) with namespaced scopes, but thin. OpenMC had **no grammar** —
  it rode on the stock Python grammar, so there was nothing OWEN-specific to color. That
  confirmed the spec's hypothesis: OpenMC needs an **injection grammar** on `source.python`.

- **Grammars (`syntaxes/`).** Enriched MCNP/Serpent/SCONE and normalized scope names into
  per-language namespaces so palettes can target precisely:
  - MCNP: `comment.line.mcnp`, `keyword.control.mcnp`, `entity.name.material.mcnp`,
    `support.function.tally.mcnp`, `storage.type.surface.mcnp`, `constant.numeric.mcnp`,
    `constant.other.zaid.mcnp` (added surface types incl. `rhp`/`hex`/`box`/`c/x`, more data
    keywords, and a `(?<![\w.])` guard on numbers so ZAIDs/material ids aren't half-colored).
  - Serpent: `comment.line.serpent` (now also `/* */`), `keyword.control.serpent`,
    `entity.name.material.serpent`, `entity.name.type.serpent` (pin/surf/cell names via
    lookbehind), `string.quoted.serpent`, `constant.numeric.serpent`,
    `constant.other.zaid.serpent`.
  - SCONE: `comment.line.scone` (now also `!`), `keyword.control.scone`,
    `entity.name.section.scone` (block name before `{`), `string.quoted.scone`,
    `constant.numeric.scone`.
  - **New** `syntaxes/openmc.injection.tmLanguage.json` (scopeName `openmc.injection`,
    `injectionSelector: "L:source.python -comment -string"`, registered in
    `contributes.grammars` with `injectTo: ["source.python"]`). Scopes
    `variable.language.openmc` (the `openmc` name), `support.class.openmc` (`openmc.Foo`),
    `support.function.openmc` (`openmc.foo(`), `support.type.openmc`
    (`openmc.model`/`stats`/`deplete`/`data`/`lib`/`mgxs`). Deliberately does **not** scope
    generic numbers/strings, which would recolor the whole Python file.

- **Palettes (`src/highlight/palettes.ts`).** Role-based to avoid duplication: 8 roles
  (comment, keyword, type, entity, func, number, string, special) × 4 palettes (`classic`,
  `solarized`, `highContrast`, `pastel`), plus a `SCOPE_ROLES` map (language → scope → role)
  matching exactly what the grammars emit. `buildRules(language, paletteId)` produces one
  `{ scope, settings }` rule per scope (scope kept as a plain string). `MANAGED_SCOPES` is the
  union of all scopes — the single source of truth for "is this rule OWEN's?". User-facing
  enum values are the labels (`Classic`/`Solarized`/`High Contrast`/`Pastel`);
  `paletteIdFromLabel` normalizes back to ids. Comments are italic in every palette.

- **Apply + command (`src/highlight/index.ts`).** `applyPalettes()` reads the four
  `owen.highlight.<lang>.palette` settings, `editor.inspect('tokenColorCustomizations')`'s
  **globalValue**, drops existing rules whose `scope ∈ MANAGED_SCOPES`, appends freshly-built
  OWEN rules for all four languages, and writes back to `ConfigurationTarget.Global` — but only
  if `JSON.stringify` differs (prevents churn and config-change loops). Everything else in the
  object (other extensions' rules, the user's own, `"[Theme Name]"` blocks) is preserved via
  spread. `registerHighlightPalettes(context)` registers the `owen.chooseHighlightPalette`
  QuickPick command (language → palette, current palette marked with `$(check)`), an
  `onDidChangeConfiguration` listener gated on `affectsConfiguration('owen.highlight')`, and
  applies once on activation. Wired first-ish in `activate()` after snippet completions.

- **`package.json`.** Version `0.1.3`; added `onCommand:owen.chooseHighlightPalette` +
  `onStartupFinished` activation events; OpenMC injection grammar entry; the new command + its
  `owen.contextMenu` submenu entry (`5_appearance@1`); four `owen.highlight.*.palette` enum
  settings with `enumDescriptions` and default `Classic`.

### Verified

- `npx tsc --noEmit` clean; `node esbuild.js` clean; rebuilt `out/extension.js` contains
  `chooseHighlightPalette` / `applyPalettes` / `tokenColorCustomizations`. All five JSON files
  parse. `npx vsce package` → `owen-neutronics-0.1.3.vsix`; `npx vsce ls` confirms the four
  grammars (incl. the OpenMC injection grammar) ship.
- **Not** verified: actual on-screen colors. Confirming the palettes visually requires the
  Extension Development Host (or an installed VSIX) and a human eye.

### Still required for installed users to get this
- `vsce`/`ovsx` republish (needs the user's tokens) and the `caalh/owen` mirror sync + release.

## 2026-06-04 — v0.1.2 — Snippet completion provider + right-click context menu

**AI Agent:** Claude (`claude-opus-4-8-thinking-high`, Cursor IDE)

Version bumped `0.1.1` → `0.1.2` in `package.json` and `package-lock.json`.

- **Snippets still didn't fire after the 0.1.1 underscore rename.** Investigated from
  scratch: the `contributes.snippets` entries are correct (`language: "python"` →
  `./snippets/openmc.json`, prefixes are valid underscore words like `omc_pin_script`), and
  `npx vsce ls` confirms all four snippet JSON files ship in the VSIX. The real problem is
  that **declarative snippets only surface through the suggestion widget**, where in Python
  files the language server (Pylance/Jedi) supplies its own completions that out-rank or
  suppress OWEN's, so the prefixes appeared dead unless the user had specifically tuned
  `editor.snippetSuggestions` / `editor.quickSuggestions`. **Fix:** added
  `src/completions/snippets.ts`, which loads the snippet JSON at runtime (single source of
  truth — the JSON files still ship and are still declared) and registers a
  `vscode.languages.registerCompletionItemProvider` for `python`, `mcnp`, `serpent`, and
  `scone`. Each entry becomes a `CompletionItem` of kind `Snippet` with
  `insertText: new vscode.SnippetString(body)`, `filterText`/`label` = the prefix, and
  `sortText` biased ahead of word completions. The Python provider is gated on
  `detectMonteCarloLanguage(doc) === 'openmc'` so it only fires in files that `import openmc`.
  Registered first in `activate()`. Snippets now show on **Ctrl+Space** and while typing the
  prefix, regardless of user settings or language-server ranking. Updated
  `docs/OPENMC_EVALUATION.md` T3 accordingly.
- **All commands added to the editor right-click menu.** `contributes.menus` previously
  exposed only three commands directly in `editor/context`. Replaced that with a
  `contributes.submenus` entry (`id: owen.contextMenu`, label `OWEN`) referenced once from
  `editor/context`, and placed all eight commands under it with grouped ordering
  (`1_analyze`: validate, insert material; `2_build`: lattice builder, 3D preview; `3_run`:
  run simulation, parameter sweep; `4_help`: tutorial, reactor library). The submenu's `when`
  is `editorTextFocus && editorLangId =~ /^(mcnp|serpent|scone|python)$/`. Every entry maps to
  a real command id in `contributes.commands`.
- **Build:** `npm run typecheck` (tsc --noEmit) clean; `node esbuild.js` bundles
  `out/extension.js`; packaged with `vsce` → `owen-neutronics-0.1.2.vsix` (snippets confirmed
  bundled via `vsce ls`).
- **Sync:** applied to the monorepo and mirrored to `caalh/owen`; tagged `v0.1.2`.

---

## 2026-06-02 — v0.1.1 — Three bug fixes (lattice insert, 3D preview, snippets)

**AI Agent:** Claude (`claude-opus-4-8-thinking-high`, Cursor IDE)

Maintenance release bundling three fixes found during the OpenMC capability evaluation
(`docs/OPENMC_EVALUATION.md`). Version bumped `0.1.0` → `0.1.1` in `package.json`.

- **Snippets never fired in OpenMC `.py` files.** Every OpenMC snippet prefix used hyphens
  (`omc-pin-script`, `omc-settings`, …). VS Code only auto-triggers IntelliSense at the end
  of a "word", and the prefix's replacement range comes from the language's word pattern;
  Python treats `-` as a word separator, so typing the full hyphenated prefix left the
  "current word" as only the segment after the last `-` — the snippet stopped matching and
  word-based completion filled in plain text instead (microsoft/vscode #62906, #205332).
  **Fix:** renamed all seven `snippets/openmc.json` prefixes to underscores
  (`omc_material`, `omc_pin`, `omc_lattice`, `omc_settings`, `omc_model`, `omc_pin_script`,
  `omc_assembly_script`), which are single Python words and trigger correctly. Updated the
  T3 prefixes in `docs/OPENMC_EVALUATION.md` to match. MCNP/Serpent/SCONE are extension-owned
  languages and were left unchanged (out of scope for this fix).
- **Lattice Builder "Insert at Cursor" no-op** (see prior entry, now shipped in 0.1.1): the
  webview read `activeTextEditor` at message-handle time, which is `undefined` while the
  panel holds focus; `latticeBuilder.ts` now tracks the last real editor and falls back to a
  fresh untitled document.
- **3D preview rendered empty axes only** (`src/preview/webview.ts`): the OpenMC pin geometry
  was not drawn due to a render-timing race; the preview now renders the extracted pin
  cylinders.
- **Build:** `npm run typecheck` clean; `npm run compile` (esbuild) bundles `out/extension.js`;
  packaged with `vsce` → `owen-neutronics-0.1.1.vsix` (snippets confirmed bundled).
- **Sync:** applied to the monorepo and mirrored to `caalh/owen`; tagged `v0.1.1`.

---

## 2026-06-02 — Fix: Lattice Builder "Insert at Cursor" no-op

**AI Agent:** Claude (`claude-opus-4-8-thinking-high`, Cursor IDE)

- **Bug:** the Lattice Builder webview's **Insert at Cursor** button silently did nothing.
  Root cause in `src/panels/latticeBuilder.ts` (`_insertCode`): it read
  `vscode.window.activeTextEditor` *at message-handle time*, but the focused webview panel
  makes `activeTextEditor` `undefined`, so the `if (editor)` guard fell through with no
  insert and no warning. The webview→extension message contract (`insertCode` / `code`) was
  correct — only the extension side was at fault.
- **Fix:** track the last real text editor. `createOrShow` now captures the active editor
  before the panel grabs focus, and the panel subscribes to
  `window.onDidChangeActiveTextEditor` (ignoring `undefined`). `_insertCode` resolves a
  target in priority order — current `activeTextEditor`, then the stored editor re-shown via
  `showTextDocument` (matched by document, since `TextEditor` handles aren't stable) — and
  falls back to a fresh untitled document when nothing is open, so the action is never a
  silent no-op.
- **Scope:** the sibling 3D geometry preview (`src/preview/webview.ts`) reads the active
  editor *up front* when its command runs and doesn't insert, so it was unaffected and left
  unchanged. `commands/insertMaterial.ts` runs as a plain command (editor still focused), so
  its `activeTextEditor` use is correct.
- **Build:** `npm run typecheck` clean; `npm run compile` (esbuild) bundles `out/extension.js`
  with the new code path.
- **Publish caveat:** this only fixes the source/bundle. Installed copies still need a version
  bump + `vsce`/`ovsx` publish, and the public mirror `caalh/owen` needs syncing (no local
  public clone present at commit time).

---

## 2026-06-02 — OpenMC capability evaluation plan

**AI Agent:** Claude (Cursor IDE)

- **Added `docs/OPENMC_EVALUATION.md`** — a hands-on, source-grounded test matrix (T1–T11)
  for evaluating what OWEN can actually do with OpenMC: activation/regression guard,
  highlighting, snippets, validation gotchas, material insertion, tutorial deep-links,
  run-simulation, 3D geometry preview, lattice builder, parameter sweep, and the community
  library. Includes a canonical correct-API pin-cell script, a scoring rubric, and an honest
  "known caveats" section (heuristic preview, import-sniffing detection, no OpenMC-specific
  grammar, community library disabled by default).
- **No code changed** — documentation only. New `docs/` folder in the OWEN subtree.
- **Sync caveat:** doc added in the monorepo (`BelvoirDynamics/owen/`) only; mirror to
  `caalh/owen` still pending (no local public clone found at commit time).

---

## 2026-06-02 — AI maintainer docs + "Workspace" branding

**AI Agent:** Claude (Cursor IDE)

- **Added AI docs** (this file, `AI_MAINTAINER_GUIDE.md`, `PROJECT_STRUCTURE.md`,
  `AGENTS.md`) so future agents have the same guidance the monorepo provides. They capture
  the activation flow, esbuild bundling, the lazy-Supabase rule, publish steps, the
  retired-name history, and the monorepo ↔ public sync relationship.
- **Branding:** the OWEN tagline is **"Open Workspace for Engineered Neutronics"**. Fixed
  the lagging "Open Workflow…" copies in `README.md` and `CHANGELOG.md` (the `package.json`
  `displayName` had already been updated). Generic "workflow automation" feature phrasing
  and the `src/workflows/` / `.github/workflows/` names were intentionally left unchanged.

---

## 2026-06-02 — `displayName`: "Workflow" → "Workspace"

**AI Agent:** Claude (Cursor IDE)

- Renamed `package.json` `displayName` from "OWEN — Open Workflow for Engineered
  Neutronics" to **"OWEN — Open Workspace for Engineered Neutronics"**. Title-only change;
  the extension `name`, `publisher`, and `owen.*` command ids were unchanged.

---

## 2026-06-02 — Extension id renamed to `owen-neutronics`

**AI Agent:** Claude (Cursor IDE)

- `package.json` `name` changed from `owen` to **`owen-neutronics`** (the bare `owen` id was
  unavailable/ambiguous on the registries). Full extension id is now
  `belvoirdynamics.owen-neutronics`; Marketplace/Open VSX URLs, the README badges, and the
  VSIX filename were updated to match.
- **Caveat:** changing `name` again would orphan existing installs. Treat `owen-neutronics`
  as stable.

---

## 2026-06-02 — Activation fix: esbuild bundling + lazy Supabase import

**AI Agent:** Claude (Cursor IDE)

- **Bug:** the extension failed to activate. A top-level `import` of
  `@supabase/supabase-js` was evaluated at load time and, when the dependency wasn't
  resolvable in the packaged VSIX, took down activation for *every* command — not just the
  community feature.
- **Fix (two parts):**
  1. **esbuild bundling** (`esbuild.js`): `src/extension.ts` is now bundled into a single
     CommonJS `out/extension.js` with `vscode` external. `.vscodeignore` drops
     `node_modules/` and `src/`, so runtime deps must be bundled to ship — esbuild now does
     that.
  2. **Lazy Supabase import** (`src/community/client.ts`): `@supabase/supabase-js` is loaded
     via `await import()` inside `getSupabaseClient()`, behind the `owen.community.enabled`
     flag, so activation can never depend on it.
- **Rule:** keep the Supabase import lazy and keep `@supabase/supabase-js` in
  `dependencies` (so esbuild bundles it). See `AI_MAINTAINER_GUIDE.md` §4 and §6.

---

## 2026-05-26 — v0.1.0 — Initial public release

**AI Agent:** Claude (Cursor IDE)

Initial release of OWEN as the BelvoirDynamics VS Code / Cursor extension (the **OWEN**
brand was reassigned from the former desktop app, now **GROVES**).

- **Languages & syntax highlighting:** MCNP (`.i`, `.mcnp`, `.inp`), Serpent (`.serp`),
  SCONE (`.scone`); OpenMC detected from Python files that `import openmc`.
- **Deep validators** with diagnostic codes for all four codes (ZAID format, density/
  fraction signs, `mt`/S(α,β) hydrogen check, macrobody counts; OpenMC API checks; Serpent
  `cuboid`/`trcl`/`omp`; SCONE `aceNeutronDatabase`, temp-suffix, `pinUniverse`).
- **Lattice Builder** webview → MCNP/OpenMC/Serpent code.
- **3D geometry preview** (Three.js) via `preview/extractor.ts`, a TypeScript port of GROVES'
  `analysis.py` (parity is the design goal).
- **Parameter sweep** (`owen.runSweep`): JSON-driven, per-run mutation, k-eff parsing,
  manifest + TSV.
- **NRDP material insertion** with bundled snapshot + optional live refresh.
- **Tutorial deep-links** to reactormc.net.
- **Community Library** (opt-in, feature-flagged) backed by Supabase, no bundled
  credentials.
- **CI:** GitHub Actions workflow builds the VSIX as a release artifact.
- Rebranded to BelvoirDynamics; publisher `belvoirdynamics`.
