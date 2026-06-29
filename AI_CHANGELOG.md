# OWEN — AI Changelog

Engineering changelog for the **OWEN** VS Code / Cursor extension, in reverse
chronological order. Each entry records **what** changed, **why**, and any caveats future
maintainers (human or AI) should know.

This is the engineering-level log. User-facing release notes live in `CHANGELOG.md`. The
division-wide changelog is `AI_CHANGELOG.md` in the BelvoirDynamics monorepo root.

> OWEN is mirrored between the monorepo (`BelvoirDynamics/owen/`) and the public repo
> (`caalh/owen`). Changes are applied to both copies — see `AI_MAINTAINER_GUIDE.md` §9.

---

## 2026-06-28 — v0.4.2 — Fix the badly-rendered ALLEN σ(E) log-log plot

**AI Agent:** claude-opus-4-8-thinking-high (Cursor IDE)

**Root cause:** The ALLEN webview (`src/allen/panel.ts` `buildPlot`) plotted on **linear** uPlot scales
over data that was only *partially* log-transformed, with a `10^exponent` axis formatter. Six defects
followed:

1. **Garbled x labels** (`10^5000000…`): the x-series was **raw energy** (1e-5 … 2e7 eV), but the axis
   formatter did `'10^' + v.toFixed(0)` — i.e. it treated raw eV as a log10 exponent. Linear ticks like
   5e6, 1e7 became `10^5000000`, `10^10000000`, overlapping into one run-on string.
2. **Malformed y labels** (`0^-5`, `0^-10`): y data *was* log10(σ), so ticks were −5, −10, −15…; the
   `10^…` text overflowed the narrow default axis gutter and clipped the leading `1`.
3. **Cluttered legend:** uPlot's built-in legend (`legend.show` defaulted on) rendered a stacked
   `Value: --` row per series under the custom HTML legend.
4. **Header readout `E = Infinity eV`:** the readout did `Math.pow(10, u.data[0][idx])`, but `u.data[0]`
   was raw energy, so `pow(10, 2e7) = Infinity`. It also concatenated every series with no wrapping.
5. **Right-edge cliff to ~1e-30:** every curve was resampled onto the **longest** energy grid; out-of-range
   points were extrapolated and σ floored to `1e-30` (→ log10 = −30), producing a vertical drop at the edge.
6. **No axis titles / weak polish.**

**Fix (`src/allen/panel.ts`, `src/allen/plotConfig.ts`):**

- Native uPlot **log scales** (`scales.{x,y}.distr = 3`); plot real eV / barns, not pre-logged values.
- **Power-of-ten decade formatter** (`logTickLabel`) renders `10⁻⁵ … 10⁷` via Unicode superscripts and
  blanks minor splits. Widened the y-axis `size` so labels don't clip; added axis titles + label fonts.
- **Compact legend:** `legend: { show: false }` disables uPlot's block; the custom one-swatch-per-series
  legend stays.
- **Readout:** uses real `u.data[0][idx]` energy (no more `Infinity`), lists only series with data at the
  cursor, wraps, and resets to the placeholder when the cursor leaves.
- **No edge cliff:** new `unifiedGrid` builds one sorted, de-duped, positive energy grid (union of all
  curves keeps native points); `interpLogLog` interpolates in log-log space and returns `null` outside a
  curve's own `[Emin, Emax]` (no `1e-30` floor), so lines end cleanly.

**Single source of truth + tests:** the pure helpers live in `src/allen/plotConfig.ts` (`unifiedGrid`,
`interpLogLog`, `logTickLabel`, `supExp`, `buildPlotData`) and are unit-tested in
`src/test/suite/allenPlot.test.ts`. The webview embeds equivalent inline copies (it can't import modules;
kept as a plain string so esbuild minification can't break it). **The rendered webview still needs human
eyes** — headless tests cover the config/algorithm, not the canvas.

**Website check:** `reactor-monte-carlo-guide` `XSPlot.tsx` is a *separate, internally-consistent*
implementation (both axes log-transformed consistently, real-eV readout, built-in live legend) and does
**not** exhibit these defects, so it was left unchanged.

**Version:** `0.4.2`. VSIX built locally; Marketplace/Open VSX publish deferred to the maintainer.

---

## 2026-06-28 — v0.4.1 — MCNP references: fix Ctrl+F-style false highlights

**AI Agent:** Claude (Cursor IDE)

**Root cause:** The role-aware index (`mcnpReferences.ts`) was already correct — occurrences are
stored as `{kind, id, span}` and queried by `(kind, id)`. The user-visible “highlights every matching
digit” symptom came from VS Code’s **built-in word-occurrence highlighter** (`editor.occurrencesHighlight`)
and provider fallbacks, not from naive indexing:

1. `DocumentHighlightProvider.provideDocumentHighlights` returned `undefined` when the cursor was not
   on an indexed entity → VS Code treated that as “no provider result” and ran word-based highlighting
   for the digit under the cursor (every `3` in the file lights up).
2. `ReferenceProvider.provideReferences` had the same `undefined` fallback → Shift+F12 could degrade
   to a text search for the bare number.
3. **`editor.occurrencesHighlight: "off"`** (v0.4.1 attempt) disabled *all* occurrence
   highlighting, including the custom `DocumentHighlightProvider`, while **`editor.selectionHighlight`**
   (default on) still painted every matching digit. Fix: `"singleFile"` + `"selectionHighlight": false`.
4. MCNP **`wordPattern`** treated bare integers as editor “words”, feeding the fallback highlighter.
   Tightened to decimals / letter-led tokens / `m|mt|mx|tr` cards only.

**Fix (`providers.ts`, `package.json`):**

- Document highlight provider always returns an array; uses new `getHighlightOccurrences()`.
- Reference provider returns `[]` instead of `undefined` when nothing is referenceable.
- `contributes.configurationDefaults`: `"[mcnp]": { "editor.occurrencesHighlight": "singleFile", "editor.selectionHighlight": false }`.
- MCNP `wordPattern` no longer treats bare integers as words (stops Ctrl+F-style fallback).
- Exported `entityAtPosition` (alias for `resolveAt`) and `getHighlightOccurrences`.
- Tests: disambiguation deck highlight counts, lattice fill universe IDs, non-entity `imp:n=` digits.

**Coordination:** Ships on top of **Input Builder v0.4.0** (same release train; version bumped to
**0.4.1** for the MCNP reference fix).

---

## 2026-06-28 — v0.4.0 — Input Builder wizard

**AI Agent:** Claude (`claude-opus-4-8-thinking-high`, Cursor IDE)

Version bumped `0.3.1` → `0.4.0` in `package.json` / `package-lock.json`. Adds an integrated
**Input Builder** webview to assemble starter decks without hand-typing boilerplate.

- **`owen.openInputBuilder`** — five-step wizard (code, materials, geometry, settings, preview) with
  **Insert at Cursor** / **New File** actions.
- **`src/inputBuilder/materials.ts`** — 18 NRDP-aligned reactor materials with per-code renderers
  (MCNP `m`/`mt`, OpenMC `Material`, Serpent `mat`, SCONE blocks).
- **`src/inputBuilder/deckBuilder.ts`** — pin-cell or 17×17 lattice starter decks; lattice mode
  reuses `latticeCodegen.ts`.
- **`src/panels/inputBuilder.ts`** — webview panel wiring; editor title / context menus list Input
  Builder ahead of Lattice Builder.
- **Tests:** `inputBuilder.test.ts` (8 unit tests); BEAVRS MCNP extractor asserts baffle **box**
  count > 0.

---

## 2026-06-28 — v0.3.1 — BEAVRS radial structure in 3D preview

**AI Agent:** Claude (`claude-opus-4-8-thinking-high`, Cursor IDE)

Version bumped `0.3.0` → `0.3.1` in `package.json` / `package-lock.json`. Adds the BEAVRS
**radial structure** outside the fuel lattice to the Three.js 3D preview across all four codes.

- **`src/preview/radialStructure.ts` (new).** Shared annular/box/wedge emitters consumed by each
  code parser (`codes/mcnp.ts`, `openmc.ts`, `serpent.ts`, `scone.ts`).
- **MCNP:** baffle universes (`px`/`py` SS304 plates) render as thin box prisms at peripheral
  lattice positions; vessel `cz` pairs become annular shells (inner/outer radius), not full-disc
  overlays.
- **OpenMC:** `BAF["…"]` structure entries resolve to drawn nodes instead of silent skips.
- **Serpent / SCONE:** matching barrel, neutron-shield octant pads, downcomer, RPV liner/RPV rings.
- **Tests:** `extractor.test.ts` asserts BEAVRS MCNP/OpenMC extracts include non-zero radial
  structure primitive counts.

---

## 2026-06-28 — v0.3.0 — ALLEN cross-section webview (NRDP ENDF/B-VIII.0)

**AI Agent:** Claude (`claude-opus-4-8-thinking-high`, Cursor IDE)

Version bumped `0.2.9` → `0.3.0`. Ships **ALLEN** (Atomic Library Linking Evaluated Nuclear-data)
as a first-class OWEN feature, coordinated with the NRDP rebrand (`/nrdp/allen`,
`public/data/allen/` on reactormc.net).

- **`owen.openAllen`** — uPlot webview panel fetching pre-computed σ(E) curves from
  `owen.allen.dataBaseUrl` (default `https://reactormc.net/data/allen`).
- **`src/allen/`** — `detectNuclides.ts` (context-aware ZAID/nuclide harvest from active deck),
  `fetch.ts` (manifest + curve JSON), `panel.ts` (webview UI: nuclide/reaction/temperature
  pickers, log-log plot, hover readout, coverage notices).
- **Menus:** command palette, editor title OWEN submenu, and right-click context menu entries.
- **Tests:** `allenDetect.test.ts` for nuclide detection from sample MCNP/OpenMC decks.
- **VSIX:** `owen-neutronics-0.3.0.vsix` built locally; Marketplace publish deferred to user.

---

## 2026-06-27 — v0.2.9 — OpenMC 3D preview: per-pin axial column reconstruction (BEAVRS fidelity)

**AI Agent:** Claude (`claude-opus-4-8-thinking-high`, Cursor IDE)

Version bumped `0.2.8` → `0.2.9` in `package.json` / `package-lock.json`. Fixes a user-reported 3D
preview defect: the OpenMC BEAVRS full core rendered much shorter than the MCNP/Serpent/SCONE cores
and was missing components. 113 headless tests pass (106 prior + 7 new). OWEN never executes Python.

### Diagnosis (headless, all four prebuilt BEAVRS decks)

Ran `buildScene` on each deck at `detail:disc` with axial off/on and compared drawn z-extent, band
count, and per-band materials/components:

| code | axial-off extent | axial-on extent | bands | axial-on components |
|---|---|---|---|---|
| MCNP | 0→460 | 0→431.9 | 36 | fuel, moderator, guide, instrument |
| Serpent | 0→460 | 0→431.9 | 36 | fuel, guide, instrument |
| SCONE | 0→460 | 20→431.9 | 36 | fuel, clad, guide, instrument, absorber, structure, plenum, end_plug |
| **OpenMC (before)** | **−20→20 (40 cm slab)** | **−20→20 (axial never engaged)** | **0** | fuel, guide, instrument (default 2-shell pin) |

Two root causes:
1. **Radii unreadable.** The radial shells live in the `_SHELLS = { key: [(mat, r), …] }` dict
   literal (and `make_pin` builds `ZCylinder(r=r)` inline from it), so `collectRadii`'s
   `name = number` / `name = ZCylinder(r=…)` scan found nothing → OpenMC fell back to
   `defaultTemplate('fuel')` (a 2-shell `[0.41, 0.475]` pin at the 40 cm `findHeight` default,
   centred at z=0).
2. **Axial silently dropped.** v0.2.8 recovered only the *union* of z-boundaries (~36 bands) and
   applied it uniformly to every pin. The budget estimate `totalPins × axialSegments`
   (55 777 × 36 ≈ 2.0 M) exceeded the 1.5 M ceiling, so `planRender` turned axial off — the deck has
   `hasAxial=true` but rendered collapsed. (MCNP/Serpent build per-pin stacks with the real,
   smaller per-pin cell counts, so they fit.)

### Fix — `codes/openmc.ts`: `buildColumnModel()` + column-aware placement

- New static resolver reconstructs each pin's **axial column** without executing Python:
  - `parseMaterialNames` — `var = openmc.Material(name="…")` → friendly material names (UO2-16,
    Inconel, StainlessSteel304, …).
  - `parseShellsDict` — the `_SHELLS` dict → `key → [(material, r|None)]` (the `None` outer fill is
    the infinite coolant, dropped from drawn radii).
  - `parseStackFns` + `parseStacksDict` + `resolveKeyExpr` — the `STACKS` dict, expanding
    `_fuel_stack(e)`-style builder calls (substituting the param into `e` / `e + "g"`) and literal
    `(z_bottom, z_top, key)` tables into concrete per-column segment lists.
  - `templateFromShells` + `shellComponent` — each segment's `R[key]` → concentric shells with
    components classified by material **and** column context (fuel/gap/clad; guide vs instrument
    thimble; Inconel→plenum spring; `…g` grid suffix→Inconel grid sleeve; `zr`→end plug; `ss` top
    nozzle→end plug; support steel→structure; pyrex→absorber).
- The programmatic-core resolver now threads the universe key onto each pin
  (`ResolvedPin.colKey = keyOf(cellExpr)` — e.g. `f31`, `gt`, `ba`, `it`), so placement maps a pin to
  its own column (correct per-pin **enrichment zone**: f16/f24/f31). Falls back to a role-matched
  column, then to the legacy role template, for non-BEAVRS decks.
- `placeColumnPin` / `emitSegment`: axial-on draws every band at its real `(zmin, zmax)`; disc mode
  picks the band's signature shell (fuel/absorber first, else innermost solid; grid bands as an
  Inconel sleeve); layers mode draws full concentric shells plus the grid ring. Axial-off draws one
  representative band over the **full** column extent (collapsed height/centre = real 0→460 cm, not
  the 40 cm default). Vessel/barrel shells span and centre on the full extent.
- Budget now uses the column model's `maxSegments` (~26) and mean shell count, so axial detail engages
  within the 1.5 M ceiling exactly like the other codes (~1.22 M instances). The generic ZP/stack-
  table band path (`findAxialBands`) is retained for decks without `_SHELLS`.

### Result (after, prebuilt OpenMC BEAVRS)

- axial-off: drawn z **0→460 cm** (was −20→20); materials UO2-16/24/31, Zircaloy, BorosilicateGlass.
- axial-on: drawn z **0→431.876 cm** (matches MCNP/Serpent to the cm), **36** axial bands; components
  fuel, guide_tube, instrument_tube, absorber, **structure, grid, plenum, end_plug**; materials add
  Inconel, StainlessSteel304, SupportPlateSS/BW. The richest of the four (only OpenMC surfaces a
  distinct grid-spacer component). No change to MCNP/Serpent/SCONE extents or band counts.

### Tests (+7)

- `extractor.test.ts` (+2): a compact `_SHELLS`/`STACKS`/`COL`/`_assembly` deck — asserts collapsed
  pins span 0→460, axial drawn top ≈ 431.876, and bands carry UO2-31 / Inconel (grid+plenum) /
  Zircaloy (clad+end plug) / StainlessSteel304 (nozzle) with fuel/grid/plenum/end_plug/guide_tube
  components.
- `beavrsAxial.test.ts` (new, +5): real-deck cross-code parity on the four bundled BEAVRS decks —
  OpenMC collapsed 0→460; OpenMC axial extent within 1 cm of MCNP/Serpent (and span > 400 cm, not a
  40 cm slab); ≥20 axial bands; distinct grid/plenum/nozzle/end-plug materials + all three enrichment
  zones; and a regression guard that MCNP/Serpent/SCONE extents are unchanged (0→460 collapsed,
  ≈431.876 axial).

### Build / test

- `node node_modules/typescript/bin/tsc --noEmit` clean; `node esbuild.js --production` clean; `out/`
  ships only `extension.js` (verified `vsce ls`); webview-injected functions remain minification-safe
  (no webview changes this release — the fix is entirely in the parser). 113 headless tests pass.
  Packaged `owen-neutronics-0.2.9.vsix`.

---

## 2026-06-27 — v0.2.8 — BEAVRS prebuilts for all codes + role-aware MCNP references + OpenMC axial recovery

**AI Agent:** Claude (`claude-opus-4-8-thinking-high`, Cursor IDE)

Version bumped `0.2.7` → `0.2.8` in `package.json` / `package-lock.json`. Three shipped items plus
the (completed) OpenMC axial stretch. 106 headless tests pass (98 prior + 8 new). OWEN never executes
Python.

### 1 — Bundle all four complete BEAVRS full-core decks

- Copied the axially+radially-complete decks from `reactor-monte-carlo-guide/` into
  `prebuilt-models/` with code-labeled names: `beavrs_fullcore_mcnp.i` (54 KB), `…_openmc.py`
  (41 KB), `…_serpent.sss` (67 KB), `…_scone.scone` (71 KB). The SCONE deck is the author-verified
  source of truth; the other three are geometry/materials-faithful translations of it (community
  example decks — honest provenance label, not "verified").
- `prebuilt-models/index.json`: added four `full-core` BEAVRS entries (one per code), removed the
  superseded partial `mcnp-beavrs-core` / `serpent-beavrs-core` fixtures and the old
  `beavrs_scone_fullcore.scone`, kept the three 17×17 assembly starters. Schema unchanged
  (`{id, name, code, scale, provenance, description, filename}`), matching `openPrebuiltModel.ts`
  (reads via `context.extensionUri` + `vscode.workspace.fs`) and `prebuiltModels.test.ts` (which
  still asserts a `verified` SCONE full-core entry).
- `.vscodeignore` already had `!prebuilt-models/**`; verified the seven decks + `index.json` ship via
  `vsce ls`.

### 2 — Role-aware MCNP cross-reference tracker

**Audit finding:** the core index (`mcnpReferences.ts`) was **already role-keyed** — occurrences are
stored as `{kind, id, span}` and queried by `defKey(kind, id)`, so `getReferences('surface', 3)`
never returned material/cell/universe 3. The "it just finds all the 1s" symptom came from two real
gaps, both fixed:

- **No `DocumentHighlightProvider`** → VS Code fell back to its default word-occurrence highlighter,
  which highlights *every* matching digit when the cursor sits on a number. Added
  `McnpDocumentHighlightProvider` (`providers.ts`) backed by the index: highlights only the
  occurrences of that entity/kind (definition = Write, refs = Read).
- **Unmodeled roles** (`trcl`/`tr` transforms, the surface-card transform field, `mt`/`mx` data
  cards) resolved to nothing → naive fallback. Extended `mcnpReferences.ts`:
  - New `McnpEntityKind` `'transform'`. `classify()` recognizes `tr{n}`/`*tr{n}` (definition) and
    `mt{n}`/`mx{n}` (material reference) cards.
  - Cell `trcl=N`/`*trcl=N` (bare-integer form only — the inline `trcl=(…)` array defines a transform
    in place and references nothing) → transform reference. The surface-card transform field
    (`3 1 cz 0.5` → surface 3 uses transform 1) → transform reference. `tr{n}` card → transform def.
  - `mt{n}`/`mx{n}` → a *reference* to material n (the digits only), so it shows in hover /
    find-refs / the References tree alongside the cell uses.
  - `KIND_LABEL`/`KIND_ICON`/`KIND_PLURAL` + the tree-view entity loop gained `transform`.
- Lattice `fill`-array universe decoding (a 0.2.3 feature) verified still role-correct (the `trcl`
  number is excluded from the geometry surface scan, so it is never double-counted as a surface).
- **Tests (`mcnpReferences.test.ts`, +7):** a disambiguation deck where the digit **3** is at once a
  cell id, material number, surface id, and universe — asserts four *distinct* reference-set sizes
  (1 / 4 / 3 / 1), per-column `resolveAt` role resolution, "surface 3 returns only surfaces", and
  `mt3` → material 3. A transform deck asserts `trcl=` + surface transform field + `tr5` all resolve
  to transform 5, that a surface transform field is not mistaken for a surface id (no "surface 5"),
  and that the `trcl` arg is not double-counted as a geometry surface. These would all fail under
  naive numeric matching.

### 4 (stretch) — OpenMC axial band recovery — DONE

- Root cause (v0.2.7 residual): the BEAVRS OpenMC deck stores z-planes in a `ZP[z]` **dict** and
  builds columns from `(z_bottom, z_top, key)` **stack tables** (`region=+ZP[zb] & -ZP[zt]`,
  `fill=R[key]`), so the name-based `findAxialBands` (`name = openmc.ZPlane`) found nothing →
  `hasAxial=false` → full-height pins.
- Fix (`codes/openmc.ts`): when the named-ZPlane scan yields < 2 bands **and** the deck uses the
  `ZP[` dict idiom in cell regions, `findAxialBandsFromStackTables()` harvests every `(num, num, key)`
  stack tuple (skipping all-numeric third fields = colors/coords), takes the **union** of their
  z-boundaries as the global band grid, and tags each band with the spanning key (preferring a
  fuel-bearing key). On the real prebuilt deck: `hasAxial` **false → true**, **30 axial bands**
  recovered, distinct z-elevations 1 → 31; gated behind the user's "Axial segments" toggle and the
  instance budget, so default rendering is unchanged.
- **Residual (documented):** per-band *radial* material swaps for OpenMC (e.g. Inconel grid-spacer
  sleeves, plenum/end-plug cross-sections) are not reconstructed — every band reuses the pin's radial
  template, so the axial stack is z-segmented but radially uniform. MCNP/Serpent/SCONE still do full
  per-band material differentiation. Fixing this needs `R[key]`→`make_pin` shell resolution.
- Test (`extractor.test.ts`, +1): a compact `ZP[z]` + stack-table deck → 3 recovered bands, 3
  distinct z-elevations with axial on, 1 with axial off.

### 3 — Changelog backfill

- Audit: `AI_CHANGELOG.md` (root), `owen/AI_CHANGELOG.md`, and `owen/CHANGELOG.md` already had
  complete, correctly-ordered entries for 0.2.4 / 0.2.5 / 0.2.6 / 0.2.7 (no gaps, newest-first). Only
  the 0.2.8 entry was missing — added to all three.

### Build / test

- `node node_modules/typescript/bin/tsc --noEmit` clean; `node esbuild.js --production` clean; `out/`
  ships only `extension.js` (verified `vsce ls`); webview-injected functions remain minification-safe.
  106 headless tests pass. Packaged `owen-neutronics-0.2.8.vsix`.

---

## 2026-06-27 — v0.2.7 — 3D preview: expand the full BEAVRS decks (OpenMC programmatic core)

**AI Agent:** Claude (`claude-opus-4-8-thinking-high`, Cursor IDE)

Version bumped `0.2.6` → `0.2.7` in `package.json` / `package-lock.json`. Makes the 3D preview
expand and render the now-complex, axially+radially-complete BEAVRS decks across all four codes.
No geometry IR change; 95 prior tests untouched, 98 total (3 new). OWEN never executes Python.

### Root cause (per code)

- **OpenMC — single representative pin.** The BEAVRS OpenMC deck builds its lattices
  programmatically, so neither the literal-nested-list finder nor the NumPy `np.full` finder could
  read a grid:
  - Assemblies come from a comprehension `lat.universes = [[pick.get(ch, F) for ch in row] for row
    in template]` — not a literal list. The old `parseRows` produced junk (`["pick.get(ch", "F) for
    ch in row"]`).
  - The core lattice is a literal nested list, but its entries are Python *references*
    (`ASM_U["A31"]`, `BAF["sq_br"]`, `W`). Each row contains `[` from the dict subscripts, which the
    old row parser rejected outright.
  Result: `grid` was null → single-pin fallback + *"universe map could not be expanded"*.
- **MCNP — already correct.** Investigated the reported "expands ZERO cylinders": on current `main`
  the MCNP parser already resolves the full chain (radial pin `cz` → pz-bounded axial **column**
  universe → 17×17 assembly `lat=1` → core `lat=1`, `fill=-8:8 -8:8 0:0`) and skips the
  general-plane / `#`-complement baffle/RPV cells without aborting. Measured **55,777 pins** (193 ×
  289) at distinct positions on the current deck. The original report predates the v0.2.x
  column-universe + lenient-continuation work now on `main`. Locked in with a new four-level test.

### Fix (OpenMC)

New static resolver in `codes/openmc.ts` (no Python execution): builds a small symbol table —
dict literals, list literals (incl. multi-line char templates), simple `name = …` assignments,
`RectLattice` vars + their `.universes`, and assembly-builder `def`s — then resolves the core
lattice into a tree of nested lattices / pin roles:

- `parseComprehension` + `buildGridFromTemplate` expand `[[pick.get(ch, F) for ch in row] for row
  in template]` to a 2D grid by mapping each template char through `pick` (char → universe-expr)
  with the `F` default; `classifyKey`/`keyOf` turn `COL["gt"]`/`"f31"` into fuel/guide/instrument
  roles.
- `resolveExpr` follows dict subscripts (`ASM_U["A31"]`), variables (`asm_a31_u`), and
  assembly-builder calls (`_assembly("asm_a31","f31",ASM_TEMPLATES["A31"])`); unmodelled calls
  (`_baffle(...)`) and water universes resolve to `skip` (rendered as nothing, like a baffle).
- `resolveCoreTree` picks the bracketed-`.universes` RectLattice with the most pins as the root
  (a core of assemblies outweighs any single assembly), so the per-call inner `lat` (which
  references unresolvable params → 0 pins) self-eliminates.
- Only attempted on the existing single-pin fallback path, so the literal / nested-literal /
  NumPy single-assembly paths (and their tests) are untouched.
- Also fixed nested placement: a sub-lattice's absolute `lower_left` is now offset by the parent
  cell centre `(cx, cy)` in both `placeTree` and `placeGrid` (previously every assembly stacked on
  the origin → `distinctXY` collapsed to 289).

### Before → after (BEAVRS, `detail: layers`, default ceiling)

| Code    | before pins | after pins | distinct positions | assemblies |
|---------|------------:|-----------:|-------------------:|-----------:|
| MCNP    | 55,777      | 55,777     | 55,777             | 193 (16 lat) |
| OpenMC  | **1**       | **55,777** | **55,777**         | **193**    |
| Serpent | 55,777      | 55,777     | 55,777             | 193        |
| SCONE   | 55,777      | 55,777     | 55,777             | 193        |

OpenMC components after: fuel 52,204 / clad 52,204 / guide_tube 3,380 / instrument_tube 193 /
moderator 3,573 (Pyrex BA rods render as pins via the fuel template — a documented approximation;
their `absorber` material tag is not reconstructed for OpenMC).

### Caveats

- OpenMC axial recovery is unchanged (best-effort): the BEAVRS columns use `ZP[z]` (subscript) +
  `R[key]` fills, which `findAxialBands` (name-based `ZPlane`/`Cell` scan) does not pick up, so
  OpenMC renders full-height pins. MCNP/Serpent/SCONE still expand their pz/ZPlane axial stacks.
- Needs a human eye in the live webview: actual on-screen rendering, hover-inspect, measurement
  tools, and the layer/axial/fidelity toggles (verified only programmatically here).

### Build/test

`tsc --noEmit` clean; `esbuild --production` clean; `.vscodeignore` ships only `out/extension.js`
(verified via `vsce ls`); webview-injected functions remain minification-safe (`toString()` +
esbuild production). 98 headless tests pass. Packaged `owen-neutronics-0.2.7.vsix`.

---

## 2026-06-27 — v0.2.6 — 3D preview: render a full BEAVRS core (instance budget + auto-LOD)

**AI Agent:** Claude (`claude-opus-4-8-thinking-high`, Cursor IDE)

Version bumped `0.2.5` → `0.2.6` in `package.json`. Removes the fixed 500,000-primitive truncation
that hid pins from full-core decks (BEAVRS) once axial segments were on, replacing it with a
configurable instance ceiling plus graceful auto-LOD. No geometry IR shape change beyond two new
optional fields; all 85 existing tests untouched and still green (95 total with the 10 new ones).

### Root cause

The webview already batches every cylinder into `THREE.InstancedMesh` groups keyed by geometry
signature, so **draw calls are tiny** (10–142 for a full BEAVRS core regardless of pin count). The
explosion was purely the **parser-side** `const MAX_CYLINDERS = 500000` in each of `codes/{mcnp,
openmc,serpent,scone}.ts`: it counted emitted *cylinders* (= GPU instances) and hard-truncated the
list. Measured BEAVRS full-core instance counts (≈56k pin positions):

| fidelity | instances | draw calls | old behavior |
|---|---|---|---|
| layers (radially complete, no axial) | ~170,411 | ~21 | rendered fine (under 500k) |
| disc + full axial | ~1,222,266 | ~40 | **truncated at 500k** |
| layers + full axial | ~3.27M (MCNP/SCONE), ~4.17M (Serpent) | ~130–142 | **truncated at 500k** |

So the user hit truncation specifically when enabling axial.

### New module — `src/preview/budget.ts` (pure, vscode-free, headlessly tested)

- `DEFAULT_MAX_INSTANCES = 1_500_000`.
- `estimatePrimitives({totalPins, avgLayers, axialSegments, detail, axial, context})` — `pins ×
  (1 | avgLayers) × (1 | axialSegments) + context`.
- `planRender(...)` — predictive degrade: requested → drop **layers→disc** first (preserves the
  axial structure the user explicitly enabled) → then **collapse axial**. Never reduces the pin
  factor, so "all pins visible" holds. Returns effective `{detail, axial}` + `droppedToDisc` /
  `droppedAxial` flags.
- `simplificationNote(...)` / `truncationWarning(...)` — user-facing messaging.

### Per-code parsers (`codes/*.ts`)

- Replaced the fixed `MAX_CYLINDERS` with `opts.maxInstances ?? DEFAULT_MAX_INSTANCES`.
- After `resolveDetail`, each parser computes `avgLayers` (mean positive-radius shell count across
  pin universes) and `axialSegments` (tallest axial stack), calls `planRender`, and renders at the
  effective `{detail, axial}`. The hard cap remains as a final safety net (sets a new `capped` flag
  on `ParseResult`); the alarming warning text was removed from the parsers.

### Dispatch retry safety net (`extractor.ts`)

Per-code pin counting can **under-estimate** (Serpent's nested-core `countPins` returns 193
assemblies, not ~56k pins), so the predictive estimate alone is insufficient — Serpent
layers+axial still hit the cap (1.5M, truncated). `parse()` now wraps `parseRaw()` in an auto-LOD
**retry loop**: if placement reports `capped`, re-parse at a coarser fidelity (layers→disc, then
drop axial) until it fits — reacting to the *actual* emitted count, independent of counting
accuracy. Unified messaging compares the requested fidelity to what was drawn and emits the
auto-LOD note (or, only if even the coarsest fidelity overflows, the truncation warning).

### Result (default 1.5M ceiling)

All four codes: **no truncation warnings, no dropped pins.** layers = 170k (full radial core);
disc+axial = 1.22M (all pins + full axial); layers+axial auto-degrades to disc+axial (1.22M) with
an explanatory note. Raising `owen.preview.maxInstances` to ~4M renders the full layers+axial core
(3.27M/4.17M) outright. (OpenMC's BEAVRS `.py` still only yields one representative pin — a
pre-existing limitation of expanding arbitrary-Python cores, unrelated to this change.)

### Config / tests

- `owen.preview.maxInstances` added to `package.json` `contributes.configuration`; `webview.ts`
  `withConfig()` folds the live setting into the fidelity options at both `buildScene` call sites.
- New `src/test/suite/budget.test.ts` (10 tests): pure budget math + degradation ordering, plus
  synthetic-core integration tests asserting auto-LOD drops to discs (not pins), keeps every pin
  column, and only warns when even discs overflow.
- Verified the toString-injected `measure.ts` functions still survive esbuild `--production`.

## 2026-06-27 — v0.2.5 — 3D preview: precise layer inspection + measurement tools

**AI Agent:** Claude (`claude-opus-4-8-thinking-high`, Cursor IDE)

Version bumped `0.2.4` → `0.2.5` in `package.json` and `package-lock.json`. Adds hover-pick
inspection, layer solo/isolate, and interactive distance/angle/radius measurement to the 3D
geometry preview webview. No geometry IR or per-code parser changes — everything rides on metadata
the `CylinderSpec` already carries (`label`, `radius`, `innerRadius`, `z`, `height`, `component`,
`material`, `axialIndex`), so all existing parsers/tests are untouched and GROVES parity is
unaffected. The extension↔webview message protocol is unchanged (still just `ready` / `scene` /
`setFidelity`); the new features are entirely webview-side.

### New module — `src/preview/measure.ts` (pure, vscode-free)

- `distance3(a,b)`, `deltas(a,b)` (absolute |Δx|,|Δy|,|Δz|), `angleDeg(a,vertex,b)` (clamped,
  NaN-safe), `diameter(r)`, and `fmtLen(n,digits)`. Points are deck-space `{x,y,z}` (cm).
- **Injected into the webview verbatim** via `Function.prototype.toString()` (same pattern as
  `panels/latticeCodegen.ts`): `webview.ts` `injectMeasure()` emits `const distance3 = …;` etc. into
  the module `<script>`, so the live preview runs the EXACT functions the tests assert against. Each
  function is self-contained (only its args + `Math`/`Number`), so the injected copy survives
  esbuild `--production` minification — verified `Math.acos` and the `fmtLen` regex appear in the
  minified `out/extension.js`.

### Webview (`src/preview/webview.ts`)

- **Per-instance metadata** expanded so a raycast pick can describe a part: each instance record now
  carries `r` (radius), `ri` (innerRadius), `h` (height), `shape`, `label`, and `axIndex` alongside
  the existing `comp`/`mat`/`ax`/`zc`. Each `InstancedMesh` is tagged with `userData.groupIndex` for
  O(1) group lookup from a hit.
- **Picking.** `THREE.Raycaster` against the instanced meshes; `isInstanceVisible(inst)` was factored
  out of `applyVisibility` and is the single source of truth shared by culling and picking, so a
  hidden layer is never hovered/measured. Continuous hover is skipped above 40 k instances (clicks
  still pick) to keep huge cores responsive.
- **Hover readout** (bottom-right HUD): component label (from `sc.components`), material, axial
  index + band id, radius/diameter (or half-width for boxes), inner radius, height, z-range; the
  hovered instance is outlined with an `EdgesGeometry` wireframe.
- **Solo/isolate.** `renderRows` gained a per-row `solo` button (rows tagged `data-key`);
  `soloItem()` sets only that key true (toggles back to all-on when re-clicked) and re-syncs
  checkboxes + active state. Works for Components, Materials, and Axial Layers; `setAll` clears the
  highlight.
- **Measurement tools.** A new **Measure** panel section (Distance / Angle / Radius mode buttons +
  Clear). Pointer handling distinguishes a *click* (≤4 px travel) from an *orbit-drag*, so
  OrbitControls is untouched. Picked points snap to the raycast hit; results render into an
  unclipped `overlay` group (lines via `THREE.Line`, point markers via small spheres, all
  `depthTest:false`) with HTML labels in a `#labels` layer projected to screen each frame
  (`updateLabels`). Distance shows length + Δx/Δy/Δz; angle uses point #2 as the vertex; radius reads
  `inst.r` exactly and draws a radial segment. Measurements are listed (individually removable) and
  cleared automatically when a new scene arrives. World↔deck axis mapping (`deckOf`: world XYZ →
  deck x,z,y) keeps deltas in deck axes.

### Tests — `src/test/suite/measure.test.ts` (headless, mocha `--ui tdd`)

- 10 new tests: 3-4-5 and 2-3-6 distances, symmetry, absolute deltas (pitch read), right/straight/
  equilateral angles, degenerate-ray = 0 (no NaN), diameter, and `fmtLen` trimming.
- **Results:** `tsc --noEmit` clean; `esbuild --production` clean; `out/` ships only `extension.js`;
  **69 passing** across the pure-logic suites (measure + extractor + lattice-codegen + references +
  sweep). Packaged `owen-neutronics-0.2.5.vsix` (~230 KB).

## 2026-06-26 — v0.2.4 — Lattice Builder: editable identifiers + SCONE generator

**AI Agent:** Claude (`claude-opus-4-8-thinking-high`, Cursor IDE)

Version bumped `0.2.3` → `0.2.4` in `package.json` and `package-lock.json`. Two Lattice Builder
features plus a testability refactor.

### Refactor — `src/panels/latticeCodegen.ts` (new, pure, vscode-free)

- The four `gen*` functions previously lived as inline JS strings inside the webview HTML in
  `latticeBuilder.ts` (untestable). They now live in `latticeCodegen.ts` as standalone TypeScript
  functions over a single `LatticeSpec` (`{ gridSize, pitch, grid, pins[], structural }`), with
  `defaultPinTypes()` / `defaultStructuralIds()` exposing the old hardcoded values as editable
  defaults.
- **Single source of truth for the webview.** `latticeBuilder.ts` injects each generator into the
  webview `<script>` via `Function.prototype.toString()` (plus `JSON.stringify` of the defaults),
  so the live preview runs the *exact* functions the tests assert against — no duplicated codegen.
  Each generator is deliberately self-contained (references only its `spec` argument + JS
  built-ins) so the injected copy survives esbuild's production minification. This was verified:
  a minified bundle's `genSCONE.toString()`, re-created with `new Function`, reproduces the direct
  call byte-for-byte.

### Feature 1 — Editable identifiers / numbers

- New **Identifiers & numbers** `<details>` panel in the webview:
  - **Per-pin-type table:** editable label, **MCNP universe number**, **OpenMC name**,
    **Serpent name**, **SCONE name**, **SCONE id** (swatch shows the paint color).
  - **Structural grid:** MCNP lattice **cell #**, lattice **universe**, the four unit-cell
    **surface numbers** (`+x -x +y -y`); Serpent **lat id**; OpenMC **lattice variable**; SCONE
    **lattice name** + **id**.
  - **SCONE pin shells table:** editable `radii` / `fills` per pin type.
- State lives in `pins` / `struct` JS objects (deep copies of the injected defaults); every input
  mutates them and calls `refreshCode()`. `buildSpec()` assembles the `LatticeSpec` the generators
  consume, so identifiers flow into both the live preview and **Insert at Cursor**.

### Feature 2 — SCONE generator

- `SCONE` added to the Format dropdown; `genSCONE(spec)` emits:
  - a square `latUniverse` block (`shape (n n 1)`, `pitch`, `origin`, `padMat Water`) whose `map`
    references each painted pin type's **SCONE id** (SCONE maps reference numeric universe ids —
    confirmed against the `latUniverse` parser in `preview/codes/scone.ts`);
  - a `pinUniverse` stub **only for pin types actually painted**, each with `radii`/`fills`.
- **SCONE rules enforced:** `radii.length == fills.length`, outermost radius `0.0` (fills to the
  cell edge), `key value;` / `block { … }` syntax, ASCII only, UNIX newlines. Defaults use the
  project's canonical PWR pin-cell values (fuel `0.392 0.400 0.457 0.0` / `UO2 Helium Zircaloy
  Water`; thimble `0.561 0.602 0.0` / `Water Zircaloy Water`; water rod `0.0` / `Water`) and are
  commented as placeholders. Header comment tells the user to wire `fill u<latId>;` into their
  geometry root and define the referenced materials.

### Tests — `src/test/suite/latticeCodegen.test.ts` (pure-logic, headless via mocha `--ui tdd`)

- 7 new tests: editable ids appear in MCNP/OpenMC/Serpent/SCONE output; SCONE
  `radii.length == fills.length` with outermost `0.0`; SCONE ASCII + UNIX newlines; SCONE emits
  stubs only for painted types and the root-wiring comment; a painted guide tube is referenced with
  the user's chosen id in every format.
- **Results:** `tsc --outDir out-test` + `mocha` on the four pure-logic suites = **51 passing**
  (44 prior + 7 new). `tsc --noEmit` clean; `esbuild --production` clean; `out/` ships only
  `extension.js`.

## 2026-06-26 — v0.2.3 — Axial-layer 3D viz + MCNP cross-reference tracker

**AI Agent:** Claude (`claude-opus-4-8-thinking-high`, Cursor IDE)

Version bumped `0.2.2` → `0.2.3` in `package.json` and `package-lock.json`. Two independent
features shipped together.

### Feature 1 — Axial-layer 3D visualization

- **Geometry IR (`src/preview/types.ts`).** Added `CylinderSpec.axialLayer` + `axialIndex` and a
  new `AxialLayerSummary` (`{ id, label, color, count, zmin, zmax, index }`) plus
  `GeometryScene.axialLayers`. Axial banding is computed centrally in `extractor.ts`
  (`summarizeAxialLayers`): when a scene is expanded with axial detail, every cylinder sharing a
  `(zmin, zmax)` range collapses into one bottom-to-top-ordered z-band, and each cylinder is tagged
  with its band. Vessel/context shells (full-height) are excluded from banding.
- **MCNP (`codes/mcnp.ts`).** New `buildAxialStack`: a universe whose cells single-`fill`
  sub-universes and are bounded by `pz` planes becomes an axial stack. `placeEntry` expands a stack
  into its z-segments when axial is on, else collapses to the tallest (active-fuel) segment. Wired
  through `countPins`, `placeUniverse`, and the top-universe selection.
- **Serpent (`codes/serpent.ts`).** `surf … pz <z>` → `planeZ`; cells with `fill` bounded by ≥2 pz
  planes form axial stacks. Global z-extent from the planes drives the collapsed pin height and the
  vessel shells.
- **OpenMC (`codes/openmc.ts`).** Best-effort `findAxialBands`: `ZPlane(z0=…)` surfaces bounding
  `Cell(region=+a & -b, fill=…)` stacks. `placePin` refactored to `placePinAt`; when axial is on,
  each placed pin is sliced into the deck's z-bands, with the fuel layer relabelled per band fill.
- **Webview (`preview/webview.ts`).** New **Axial Layers** panel section (per-layer checkboxes,
  All/None, click-to-toggle) + **Axial slice (Z)** min/max sliders defining a visible z-window.
  Instance metadata carries `ax` (layer id) and `zc` (z-center); `applyVisibility` ANDs in the
  axial-layer toggle and the z-window (vessel/context shells, which have no `ax`, are unaffected).
- **Verification (`scripts/viz-check.mjs`).** Rewrote the harness with inline MCNP + Serpent axial
  fixtures (3-segment end-plug/fuel/plenum stacks → 3 bands each) and pointed the SCONE case at the
  bundled BEAVRS prebuilt (**36 axial bands** with axial on; collapses to 1 when off). Disk decks
  are now optional. Tests added in `extractor.test.ts` for MCNP/Serpent axial expansion.

### Feature 2 — MCNP reference / cross-reference tracker

- **`src/references/mcnpReferences.ts`** (pure, no `vscode` import → headless-testable). A
  position-aware companion to the geometry MCNP parser. Builds logical cards with a per-character
  source-position map (handles tab/space continuations and `key = value` spacing), classifies
  cell/surface/material cards, and emits `Occurrence`s (kind + id + span + isDefinition +
  cellContext) for cell ids, the cell material field, geometry surface refs (with `#n`/`#(...)`
  complements blanked out), `u=` (first = universe definition, rest = references), single `fill=`,
  and decoded `fill` arrays. Lattice cells decode their fill array into per-universe counts +
  unit-cell bounding surfaces. Helpers: `resolveAt`, `getDefinition`, `getReferences`,
  `describeEntity`, `describeLattice`. Material names and universe roles (fuel / guide / instrument
  / absorber) are classified from ZAIDs.
- **`src/references/providers.ts`.** Hover, Definition, and Reference providers for `mcnp`, backed
  by a per-document (version-keyed) index cache.
- **`src/references/referencesView.ts`.** `owenMcnpReferences` tree view: a **Lattices** group
  (expanded; each lattice → unit-cell surfaces + universes-by-count, all clickable) plus
  Universes / Materials / Surfaces / Cells groups (each entity → its definition + every reference).
  Commands `owen.showMcnpReferences` and `owen.revealMcnpReference`.
- **`package.json`.** New command, activation events (`onCommand:owen.showMcnpReferences`,
  `onView:owenMcnpReferences`), an OWEN activity-bar `viewsContainers` + the `owenMcnpReferences`
  view, and menu entries in the editor-title submenu, the editor-context submenu, the command
  palette (gated `editorLangId == mcnp`), and the view title.
- **Tests (`test/suite/mcnpReferences.test.ts`).** 8 assertions covering the lattice fill→universe
  decode (5 fuel / 4 guide), unit-cell bounding surfaces, universe→definition-line mapping +
  role, fill-entry resolution, ZAID material classification, surface-ref resolution, and
  reference counting.

### Build / verify

- `node ./node_modules/typescript/bin/tsc --noEmit` clean; `node esbuild.js --production` clean
  (`out/` ships only `extension.js`). 39 headless tests pass (31 extractor + 8 reference).

---

## 2026-06-24 — v0.2.2 — Docs: demo screen recordings + author attribution

**AI Agent:** Claude (`claude-opus-4-8-thinking-high`, Cursor IDE)

Version bumped `0.2.1` → `0.2.2` in `package.json` and `package-lock.json`. Documentation-only
release — no extension code changed.

### What changed

- **Demo GIFs in the README overview.** Added a **"See it in action"** section near the top of
  `README.md` with two looping GIFs converted from screen recordings:
  - `media/demo-lattice-builder.gif` (900×599, ~3.3 MB) — the Lattice Builder generating an MCNP
    17×17 PWR assembly, with live MCNP syntax highlighting in the editor. Source: a 27.4 s,
    2222×1478 capture.
  - `media/demo-3d-preview.gif` (720×397, ~5.7 MB) — the 3D geometry preview of a full Serpent
    core (~56,900 pins): component toggles (Fuel / Guide Tubes / Instrument Tubes / Vessel), the
    Disc/Layers fidelity control, and the X/Y/Z slice planes. Source: a 61.7 s, 2538×1398 capture.
- **Why GIFs, hosted by absolute URL.** The VS Code Marketplace sanitizes README HTML and strips
  `<video>` tags, so raw `.mp4` will not play in the overview. The GIFs are referenced via absolute
  raw URLs (`https://raw.githubusercontent.com/caalh/owen/main/media/<name>.gif`) because relative
  paths don't reliably render on the Marketplace. Full-quality MP4s are attached to the
  `v0.2.2` GitHub release and linked under each GIF.
- **VSIX hygiene.** `media/**` was added to `.vscodeignore` so the GIFs do **not** ship inside the
  package (the Marketplace fetches them from the absolute URL). `out/` still ships only
  `out/extension.js`.
- **Author attribution.** Added **"Created by Aaron W. Calhoun"** under the OWEN title in the
  README and an `"author": "Aaron W. Calhoun"` field in `package.json`; `publisher` stays
  `belvoirdynamics`.

### Conversion notes (ffmpeg, two-pass palette)

- Lattice GIF: `fps=12,scale=900` two-pass palette (palettegen → paletteuse).
- 3D-preview GIF: the dense green wireframe over a dark background compressed poorly at the
  defaults (11.7 MB at fps=10/scale=820), so it was re-encoded at `fps=8,scale=720` with
  `palettegen=max_colors=128:stats_mode=diff` + `paletteuse=dither=bayer:bayer_scale=5`, landing at
  ~5.7 MB — under the ~8 MB target.

### Build / verification

- `tsc --noEmit` clean; `node esbuild.js --production` clean.
- Packaged `owen-neutronics-0.2.2.vsix`; verified `out/` ships only `extension.js` and the GIFs are
  not in the VSIX.

---

## 2026-06-22 — v0.2.1 — Fix: MCNP lattice fill grid dropped on tab / short-indent continuation lines

**AI Agent:** Claude (`claude-opus-4-8-thinking-high`, Cursor IDE)

Version bumped `0.2.0` → `0.2.1` in `package.json` and `package-lock.json`. Bug-fix release for the
3D geometry preview.

### Symptom

A real, hand-written 17×17 PWR assembly deck (`basic_mcnp_test.inp`) rendered in the OWEN 3D
preview as **a single cylinder** instead of the full 289-position lattice.

### Root cause — `src/preview/codes/mcnp.ts`, `logicalCards()` continuation rule

MCNP continues a card when the following line has columns 1–5 blank (or the previous line ends in
`&`). The parser encoded this as `/^\s{5,}\S/` — *exactly ≥5 leading spaces*. The user's deck
indented the `fill=-8:8 -8:8 0:0` line and every row of the 289-entry universe grid with a **tab**
(and some decks use 2–4 spaces). Those rows therefore did **not** match the continuation test, so
they were split off from cell 21 as their own bogus "cards" and discarded. With the `fill` array
never assembled:

- the `lat=1 u=3` lattice universe was registered without a usable fill grid,
- the container `fill=3` chain could not expand,
- the parser hit the bare-surface fallback and drew only the pin's `cz` shells at the origin — which
  reads as "one cylinder."

So of the six candidate issues, **#1 (continuation-line assembly)** was the culprit; #2–#6 already
worked once the card was joined.

### Fix

- **Continuation rule loosened to `/^\s+\S/`** — any non-blank, non-comment line that begins with
  *any* leading whitespace (tab, 1–4 spaces, or the classic ≥5) now continues the previous card, as
  before does a trailing `&`. No legitimate MCNP card starts with leading whitespace (card
  numbers/names live in columns 1–5), so this is strictly more forgiving and matches real
  hand-written decks and tab-inserting editors. (As a bonus, multi-line `m`-card ZAID lists indented
  with <5 spaces now assemble too.)
- **`expandRepeats()` now also handles `nI` (linear interpolate, rounded to integer universe ids)
  and `nJ`/`j` (jump → 0/background)** in addition to the existing `nR` repeat shorthand, per the
  fill-array spec.
- **`parseCell()` strips cell-complement operators (`#n`, `#(...)`)** before pulling signed surface
  ids, so a `#5` can't be misread as surface 5 and inject a phantom bounding cylinder.

### Tests — `src/test/suite/extractor.test.ts` (pure-logic, run headless via mocha `--ui tdd`)

Five new tests reproducing the deck's structure:

- TAB-indented 17×17 fill grid → **289 placed positions, 817 cylinders** (264 fuel × 3 shells + 25
  water columns), **no fallback warning** — the regression guard for this exact bug.
- 2-space-indented grid → identical result in disc mode (289 discs, 17 columns).
- Pitch derived from the cell's own `px`/`py` planes (±0.63 → 1.26 cm; columns span ±10.08).
- Container `fill=3` → `lat=1 u=3` → `u=1`/`u=2` chain resolves (hierarchy note, not bare fallback).
- `nR` repeat shorthand inside a tab-continued fill array.

All 29 extractor tests pass. `tsc --noEmit` clean; `node esbuild.js --production` clean (`out/` ships
only `extension.js`).

### Fixture

`C:\Users\me\reactor-test-decks\basic_mcnp_test.inp` was reconstructed (the user's file was an
unsaved editor buffer, not on disk) as a faithful, valid Westinghouse-style 17×17 deck — 264 UO2
pins + 25 guide/instrument water columns, pitch 1.26 cm, criticality `kcode`/`ksrc`, labelled as a
viz/example fixture — and added to `scripts/viz-check.mjs`. viz-check reports **817 prims / 289
pins** for it (full 17×17), with the other four decks unchanged.

> Publishing: marketplace/OVSX tokens are not present in this environment (as with 0.1.9 / 0.2.0), so
> this release is shipped via the GitHub mirror + `gh release`; the `vsce publish` / `ovsx publish`
> commands are reported for a maintainer with tokens to run.

---

## 2026-06-22 — v0.2.0 — Cross-code 3D viz parity (full-core layers, enrichment, axial, hex, trcl, nested OpenMC)

**AI Agent:** Claude (`claude-opus-4-8-thinking-high`, Cursor IDE)

Version bumped `0.1.9` → `0.2.0` in `package.json` and `package-lock.json`. Major viz milestone:
brings all four preview parsers (MCNP / OpenMC / Serpent / SCONE) to the same fidelity, with a
re-extractable fidelity model so a full BEAVRS core renders concentric layers and stays
interactive.

### Shared IR / fidelity infrastructure

- **`src/preview/types.ts`** — new `FidelityOptions` (`detail: 'auto'|'disc'|'layers'`,
  `axial: boolean`) and `FidelityState` (resolved `detail`, `axial`, `autoDetail`, `totalPins`,
  `hasAxial`), echoed back on `ParseResult`/`GeometryScene`. New components `grid`, `plenum`,
  `end_plug` + labels.
- **`src/preview/palette.ts`** — `LAYER_PIN_LIMIT = 4000` and `resolveDetail(opts, totalPins)`
  (auto = disc above the limit, else layers; explicit choice wins). `parseEnrichmentTag()` reads
  `UO2-16` / `UO2_31` (tenths-of-%) and `UO2 3.1%` forms; `fuelEnrichmentColor(pct)` ramps pale
  amber→deep red so enrichment bands separate by color; `materialColor()` now routes tagged UO2
  through it (fixes SCONE/Serpent bands all sharing one fuel color).
- **`src/preview/extractor.ts`** — `buildScene(text, lang, opts)` threads `FidelityOptions` to
  each parser and surfaces `fidelity` on the scene.

### Per-code parsers

- **MCNP (`codes/mcnp.ts`)** — `resolveDetail` replaces the hard count threshold (full cores can
  now render layers). **Enrichment:** `parseMaterial` captures per-ZAID fractions;
  `uraniumEnrichment()` → name `UO2 X.X%` (else `UO2 (mN)` so distinct material numbers never
  merge). **trcl:** `parseCell` reads `trcl=(…)`/`*trcl`; `buildTransform`/`applyTransform`
  (translation + optional 3×3 cosine matrix; `*` ⇒ deg→cos) applied to the root fill cell's
  placement. **Hex:** `lat=2` placed on real hex basis `a1=(p,0)`, `a2=(p/2, p·√3/2)`.
  `MAX_CYLINDERS` 200k→500k.
- **Serpent (`codes/serpent.ts`)** — `resolveDetail`; hex types 2/3 placed on real hex coords
  (type 2 X-type, type 3 Y-type transpose) instead of the rect approximation (note updated).
  Enrichment bands distinguished via the palette change. Returns `fidelity`.
- **OpenMC (`codes/openmc.ts`)** — **nested cores:** `findNamedLattices()` parses each
  `name.universes = …` (literal grid or `buildNumpyGrid(text, arrName)`), `findNamedPitch`/
  `findNamedLowerLeft`; a top lattice that references other lattices and isn't itself referenced
  is expanded recursively (`placeGrid`). Disc/Layers fidelity (`placePin`), `findFuelName()`
  recovers enrichment from `add_nuclide('U235'…)`, `addVesselShells()` from large `ZCylinder`s.
  Returns `fidelity`. Single-assembly path preserved.
- **SCONE (`codes/scone.ts`)** — `resolveDetail`; **axial:** parses `type plane; coeffs (0 0 1 d)`
  z-planes and per-cell `surfaces (…)`; `axialStack(uid)` builds a sorted segment list for any
  `cellUniverse` whose member cells are z-plane-bounded (≥2 ⇒ a stack). `placeEntry` expands
  segments when `axial` is on (each segment resolved to its radial pin at its own z/height), else
  collapses to one representative pin over the true plane extent. `refineComponent` tags
  plenum/spring → Plenum and nozzle/support/BW → End Plug. `MAX_CYLINDERS` → 500k.

### Webview (`src/preview/webview.ts`)

- Host stores `lastText`/`lastLanguage`/`fidelity`; a `setFidelity` message re-extracts and
  re-posts (`rebuildScene`) so toggling detail/axial never drops geometry (ready-handshake kept).
- New **Fidelity** panel section: Pin detail (Auto/Disc/Layers buttons, active state + `auto →`
  hint), **Axial segments** checkbox (shown only when `hasAxial`), a busy `…` indicator, and a
  pin-count hint. New **Slice (Z · axial)** clipping plane (world-Y = deck-z). `reflectFidelity()`
  syncs the controls from `scene.fidelity`.

### Verified on the on-disk fixtures (`C:\Users\me\reactor-test-decks\`, via `scripts/viz-check.mjs`)

- assembly_17x17 **MCNP/Serpent**: 844 prims, fuel band `UO2 3.1%` / `UO2_31`.
- beavrs_core **MCNP**: auto **disc 56,938**; **layers 166,273**; bands `UO2 1.6/2.4/3.1%`.
- beavrs_core **Serpent**: auto disc 56,937; layers 166,272; bands `UO2_16/24/31`.
- beavrs_scone_fullcore **SCONE**: auto disc 55,784; **layers 170,411**; `hasAxial=true`;
  disc+axial expands plenum/end_plug/grid segments (hits the 500k cap → honest truncation warning).

### Tests

- `src/test/suite/extractor.test.ts` +8: disc-vs-layers cylinder counts; MCNP enrichment band
  separation (distinct names + colors); MCNP trcl translation; MCNP `lat=2` hex √3⁄2 row spacing;
  Serpent type-2 hex spacing; SCONE axial segment expansion (collapsed 1 level vs axial 2 levels +
  plenum); OpenMC nested core (4 columns, guide tubes, nested note). **24 extractor tests pass
  headless** (`tsc --outDir out-test` + `mocha`). The electron suite (`@vscode/test-electron`) is
  env-locked here — run locally.

### Build / verify

- `node ./node_modules/typescript/bin/tsc --noEmit` clean; `node esbuild.js --production` clean
  (`out/extension.js` ~357 KB). Per env notes, used the JS APIs / local binaries (the
  `npx esbuild/tsc/vsce` CLIs hang on this machine). `.vscodeignore` unchanged (`out/**` +
  `!out/extension.js`, `out-test/**`, `src/**`, `scripts/**` excluded). Marketplace + Open VSX
  republish need the user's tokens (not in this environment).

## 2026-06-22 — v0.1.9 — Offline prebuilt-models picker (bundled benchmark decks)

**AI Agent:** Claude (`claude-opus-4-8-thinking-high`, Cursor IDE)

Version bumped `0.1.8` → `0.1.9` in `package.json` and `package-lock.json`. Adds an offline,
bundled "prebuilt models" picker so users can open canonical/starter reactor decks from the
right-click menu without the Supabase community library (which stays a separate, creds-gated
feature, untouched).

### What changed

- **New dir `prebuilt-models/`** (shipped in the VSIX). Decks copied from
  `C:\Users\me\reactor-test-decks\`:
  - `beavrs_scone_fullcore.scone` — SCONE BEAVRS full core, provenance **verified** (OWEN had no
    bundled SCONE BEAVRS previously; website repo's `scone_beavrs_clean.inp` was deliberately not
    used per instructions).
  - `assembly_17x17_mcnp.i`, `assembly_17x17_serpent.sss`, `beavrs_core_mcnp.i`,
    `beavrs_core_serpent.sss` — provenance **example fixture — not converged** (viz/starter decks).
  - `assembly_17x17_openmc.py` — generated from the `omc_assembly_script` snippet body with
    placeholders resolved (IndependentSource / RectangularPrism class / `model.run()`), provenance
    **example fixture — not converged**.
- **Manifest `prebuilt-models/index.json`** — array of `{id, name, code, scale, provenance,
  description, filename}`.
- **Command `owen.openPrebuiltModel`** (`src/commands/openPrebuiltModel.ts`, registered in
  `extension.ts`). Loads the manifest via `context.extensionUri` + `vscode.workspace.fs`
  (NOT `__dirname`, which breaks when esbuild bundles to `out/extension.js`). Quick Pick is
  labeled `Code: Name` / `scale • provenance`. On pick, reads the deck file (again via
  `extensionUri`) and opens it as an untitled doc with language `mcnp|serpent|scone|python`
  (OpenMC → python).
- **Menus** (`package.json`): command added to `commands`, `activationEvents`
  (`onCommand:owen.openPrebuiltModel`), the `owen.contextMenu` (editor right-click) and
  `owen.editorTitleMenu` submenus at group `1_analyze@3` (next to Insert Material), and the
  Command Palette (default). Title: **"OWEN: Open Prebuilt Model…"**.
- **Packaging:** `.vscodeignore` adds `!prebuilt-models/**` (defensive; nothing excluded them but
  explicit). `out/` still ships only `extension.js`. `.gitignore` adds `out-test/`.
- **Tests:** `src/test/suite/prebuiltModels.test.ts` — pure-logic checks (manifest non-empty,
  required fields + valid code, unique ids, every referenced deck file exists & non-empty, SCONE
  BEAVRS full-core is `verified`). Runs headless via `tsc --outDir out-test` + mocha; all pass.

### Verify

- `node ./node_modules/typescript/bin/tsc --noEmit` clean; `node esbuild.js --production` clean.
- `mocha` on `prebuiltModels` + `extractor` suites: 22 passing.

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
