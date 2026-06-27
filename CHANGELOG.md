# Changelog

All notable changes to the OWEN VS Code extension are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.8] — 2026-06-27

Bundle the complete BEAVRS full core for every code, make the MCNP reference tracker role-aware,
and recover the OpenMC axial stack.

### Added

- **Complete BEAVRS full-core prebuilt models for all four codes.** `OWEN: Open Prebuilt Model…`
  now lists a **BEAVRS Full Core** entry for **MCNP, OpenMC, Serpent, and SCONE** — the axially- and
  radially-complete Cycle-1 core (193 assemblies, full axial pin stacks with grid spacers / plena /
  end plugs, Pyrex burnable-poison clusters, SS304 baffle / barrel / neutron-shield pads, downcomer,
  RPV). The SCONE deck is the author-verified source of truth; the MCNP / OpenMC / Serpent decks are
  geometry/materials-faithful translations of it (community example decks, not benchmark-validated).
  The earlier partial "BEAVRS Core" MCNP/Serpent fixtures are superseded by these; the 17×17 PWR
  assembly starters are kept.
- **Role- and position-aware occurrence highlighting in MCNP files.** Putting the cursor on a number
  now highlights only the other occurrences of *that entity* (e.g. surface 3), instead of VS Code's
  default behavior of lighting up every matching digit in the file.
- **Transform (`tr`) and material-data (`mt`/`mx`) cross-references for MCNP.** The reference tracker
  now understands coordinate-transform numbers (`trcl=`/`*trcl` on a cell, the transform field on a
  surface card, and the `tr{n}`/`*tr{n}` definition card) and the `mt{n}`/`mx{n}` data cards (which
  reference an existing material). They appear in hover, Go-to-Definition, Find-References, and the
  References tree like cells / surfaces / materials / universes.

### Changed

- **3D preview: OpenMC now shows the axial stack.** OpenMC BEAVRS-style decks that store their
  z-planes in a `ZP[z]` dict and build columns from `(z_bottom, z_top, key)` stack tables (which the
  v0.2.7 name-based scan could not read) now have their axial bands recovered, so OpenMC renders the
  layered z-stack like MCNP / Serpent / SCONE instead of full-height pins. (Per-band radial material
  swaps — e.g. distinct grid-spacer cross-sections — are not yet reconstructed for OpenMC.)

### Fixed

- **MCNP reference tracker no longer confuses numbers across roles.** Resolution is keyed by entity
  role *and* card position, so clicking surface `3` returns only references to surface 3 — never
  material 3, cell 3, or the digit `3` inside a `fill=` index. (The core index was already role-keyed;
  this hardens it with transform/`mt` coverage, role-aware highlighting, and disambiguation tests.)

## [0.2.7] — 2026-06-27

Expand and render the full axially- and radially-complete BEAVRS decks across codes.

### Fixed

- **OpenMC: full multi-assembly cores now expand instead of collapsing to a single pin.** Decks
  that build their lattices programmatically — the BEAVRS full-core port included — were falling
  back to one representative pin with *"its universe map could not be expanded"*. OWEN now
  statically resolves (without executing any Python) the two idioms these decks use:
  the assembly comprehension `lat.universes = [[pick.get(ch, F) for ch in row] for row in template]`
  (a literal char `template`, a `{char: universe}` `pick` dict, and a default `F`), and the core
  lattice literal whose entries are *references* (`ASM_U["A31"]`, `BAF["sq_br"]`, `W`) to universes
  built by an assembly-builder function. The BEAVRS OpenMC deck now renders all **193 assemblies /
  55,777 pins** (was 1), at distinct positions, with fuel / guide-tube / instrument-tube layers.
  Genuinely opaque runtime construction still degrades gracefully to the representative-pin fallback.
- **OpenMC: nested sub-lattices are now offset by their parent core cell.** A sub-lattice's absolute
  `lower_left` was applied without adding the core-cell centre, so every assembly stacked on the
  origin; assemblies now land in their correct core positions.

### Verified

- **MCNP** already resolves the deep BEAVRS chain (radial pin → pz-bounded axial column universe →
  17×17 assembly lattice → core lattice); confirmed it expands the full **55,777-pin** core and
  added a regression test pinning the four-level resolution. **Serpent** and **SCONE** BEAVRS decks
  are unchanged (both expand the full 193-assembly core as before).

### Added

- Headless unit tests: an OpenMC comprehension-expansion test (literal template + `pick` dict +
  default), an OpenMC core-literal-of-references test, and an MCNP multi-level universe-chain test.

## [0.2.6] — 2026-06-27

Render a full BEAVRS core without truncating pins.

### Changed

- **The 3D preview no longer drops pins from large cores.** The old fixed 500,000-primitive
  safety cap truncated full-core decks (BEAVRS and similar) the moment axial segments were
  enabled, hiding entire pins with an alarming "geometry was truncated" message. The ceiling is
  now a much higher, configurable **instance** budget (default **1,500,000**, set via the new
  `owen.preview.maxInstances` setting). A radially-complete full core (every pin, concentric
  fuel/gap/clad/coolant shells) and a one-disc-per-pin core with full axial segments both render
  comfortably within the default.
- **Graceful auto-LOD instead of silent truncation.** When the requested detail would exceed the
  ceiling, OWEN automatically simplifies *detail* rather than dropping pins — first collapsing
  concentric shells to one disc per pin (preserving the axial structure you turned on), then
  collapsing axial segments if still needed. **Every pin position stays visible.** A non-alarming
  note explains exactly what was simplified and how to override (open a single assembly, or raise
  `owen.preview.maxInstances`). The hard truncation warning now appears only in the extreme case
  where even one disc per pin overflows the ceiling.

### Added

- **`owen.preview.maxInstances` setting.** Caps the total cylinder instances the preview renders
  (default 1,500,000). Raise it (e.g. 4,000,000) to view a full BEAVRS core at concentric-shell +
  axial detail simultaneously on a powerful machine; lower it on constrained hardware. Draw calls
  stay low regardless thanks to instanced rendering — this bounds memory/CPU, not draw count.

## [0.2.5] — 2026-06-27

Precise layer inspection and interactive measurement tools in the 3D geometry preview.

### Added

- **Hover-to-inspect readout.** Move the cursor over any part of the 3D preview to see exactly
  what you're looking at — the layer/component name, material, axial layer index, radius and
  diameter (inner radius for annular shells), height, and z-range — with the hovered part outlined
  in the view. Answers "which layer / shell am I looking at?" precisely, beyond the on/off toggles.
- **Solo (isolate) a layer.** Every Components / Materials / Axial-layer row now has a **solo**
  button that hides everything else so you can focus on a single shell, material, or axial level.
  Click solo again on the isolated item to restore the full view.
- **Measurement tools.** A new **Measure** panel with three interactive tools whose results are
  drawn in the scene (lines + labels) and listed in the panel (clear individually or all at once):
  - **Distance / width** — click two points on the geometry to read the straight-line distance plus
    the axis-aligned **Δx, Δy, Δz** components, so you can read pin pitches, gaps and widths.
  - **Angle** — click three points (the 2nd is the corner) to read the included angle in degrees.
  - **Radius / diameter** — click a pin or cylindrical shell to read its exact radius and diameter.

  Orbit/zoom/pan are unchanged — a click measures, a drag still rotates the view.

## [0.2.4] — 2026-06-26

Lattice Builder enhancements: editable identifiers and a SCONE generator.

### Added

- **Editable universe identifiers in the Lattice Builder.** A new **Identifiers & numbers** panel
  lets you set, per pin type, the **MCNP universe number**, **OpenMC universe variable name**,
  **Serpent universe name**, and **SCONE universe name + id** — and the **structural** identifiers
  (MCNP lattice cell number, lattice universe, and the four unit-cell surface numbers; Serpent
  `lat` id; OpenMC lattice variable; SCONE lattice name + id). Values flow straight into the live
  preview and the **Insert at Cursor** output, so generated code drops into an existing deck
  without renumbering or universe-id collisions. Defaults match the previous hardcoded values.
- **SCONE output in the Lattice Builder.** `SCONE` is now a Format option. It emits a square
  `latUniverse` whose `map` references each painted pin type's SCONE universe id, plus a
  `pinUniverse` stub (with `radii`/`fills`) for every pin type actually used — enforcing the SCONE
  rule that `radii` length equals `fills` length with an outermost `0.0` radius. The output is
  ASCII with UNIX newlines and is commented so you know to wire the lattice universe into your
  geometry root and define the referenced materials. Radii/fills default to canonical PWR pin-cell
  values and are clearly marked as placeholders to confirm.

### Changed

- The four lattice generators (MCNP/OpenMC/Serpent/SCONE) were extracted into a pure, vscode-free
  module (`src/panels/latticeCodegen.ts`) that the webview injects verbatim, so the live preview
  runs the exact same logic now covered by headless unit tests.

## [0.2.3] — 2026-06-26

Two-feature release: axial-layer 3D visualization and an MCNP cross-reference tracker.

### Added

- **Axial-layer 3D visualization for full-core decks.** The 3D geometry preview now renders the
  *axial build* of a deck — stacked axial segments with their own materials — instead of treating
  the axial direction as one tall extruded height. An axially-built full core shows its vertical
  structure (active fuel split by spacer grids, plenum, nozzles, end plugs, reflectors). The
  geometry IR and every per-code parser were extended to capture axial segments:
  - **SCONE** `cellUniverse` axial stacks (the verified BEAVRS prebuilt renders **36 distinct
    axial z-bands** — the ~25-cell fuel stacks plus the guide-tube / instrument-tube / burnable-
    absorber / control-rod stacks).
  - **MCNP** `pz`-plane-bounded cell stacks (a universe whose cells `fill` sub-universes between
    `pz` planes).
  - **Serpent** `pz`-bounded cell stacks.
  - **OpenMC** `ZPlane`-bounded `Cell` stacks (best-effort, since OpenMC decks are arbitrary
    Python).
  - **New webview controls:** an **Axial Layers** section with a per-layer show/hide toggle (click
    a layer to toggle it) plus **Axial slice (Z)** min/max sliders that reveal a height window —
    alongside the existing component / material / slice-plane toggles and Auto/Disc/Layers fidelity.
- **MCNP reference / cross-reference tracker.** Surfaces where MCNP entities — cell IDs, surface
  IDs, material IDs, universe IDs — are *defined* vs. *referenced*, with special handling for
  lattices:
  - **Hover** a number to resolve it (e.g. "Universe 2 — guide tube (defined at cell 4, line N)",
    "Surface 51 — px 0.63 (line N)", "Material 1 — UO2 (m1, line N)").
  - **Go-to-Definition** and **Find-All-References** on cell / surface / material / universe numbers.
  - An **MCNP References** tree view (in the OWEN activity-bar container) with a **lattice focus**:
    each `lat`/`fill` cell decodes its fill array into the universes it places (with counts and a
    jump to each universe's definition) and lists the surfaces that bound the unit cell — directly
    answering "what input is used for this lattice structure".
  - Discoverable via the right-click editor menu, the editor-title OWEN menu, and the command
    palette (gated to MCNP files).

## [0.2.2] — 2026-06-24

Documentation release — no code changes.

### Added

- **Demo recordings in the Marketplace/README overview.** A new **"See it in action"** section
  near the top of the README shows two looping screen-capture GIFs: the visual **Lattice Builder**
  generating an MCNP 17×17 PWR assembly with live syntax highlighting, and the **3D geometry
  preview** of a full Serpent core (component toggles, Disc/Layers fidelity, X/Y/Z slice planes).
  Each GIF links to a full-quality MP4 attached to the GitHub release. (GIFs are hosted via
  absolute raw URLs because the VS Code Marketplace strips `<video>` tags; they are excluded from
  the VSIX so the package stays small.)
- **Author attribution.** The README now credits **Aaron W. Calhoun** under the title, and
  `package.json` gains an `author` field (publisher remains `belvoirdynamics`).

## [0.2.1] — 2026-06-22

### Fixed

- **3D preview: hand-written MCNP lattices that were indented with tabs (or fewer than 5 spaces)
  now render as the full assembly instead of collapsing to a single pin.** A real 17×17 PWR
  assembly deck whose `fill=` line and 289-entry universe grid were tab-indented rendered as just
  one cylinder, because the MCNP card-continuation rule only recognized continuation lines with
  ≥5 leading spaces. Any indented continuation line (tab or spaces) is now joined correctly, so the
  lattice `fill` array assembles, the `fill=`-into-lattice chain resolves, and the whole 17×17
  (264 fuel pins + 25 guide/instrument positions) renders. Multi-line material (`m`) cards indented
  with fewer than 5 spaces also assemble now.

### Added

- MCNP `fill`-array shorthand now also expands `nI` (interpolate) and `nJ`/`j` (jump) in addition
  to `nR` (repeat); cell-complement operators (`#n`, `#(...)`) are tolerated without affecting the
  rendered pin geometry.

## [0.2.0] — 2026-06-22

**Major 3D visualization milestone — full cross-code geometry parity.** The 3D preview now
renders MCNP, OpenMC, Serpent, and SCONE at the same high fidelity: concentric pin layers in
the full core, enrichment-distinguished fuel bands, real axial structure, and true hex
placement.

### Added

- **Concentric pin layers in full-core view — for every code.** Previously a full core drew
  each pin as a single material disc; only a single assembly showed fuel/gap/clad/coolant
  shells. Now a **Pin detail** control (Auto / Disc / Layers) lets you render full concentric
  layers across an entire BEAVRS-scale core (~56k pins → ~170k cylinders) and it stays
  interactive — the webview draws everything with `THREE.InstancedMesh`, so hundreds of
  thousands of cylinders cost only a few dozen draw calls. **Auto** picks Disc for big cores
  and Layers for a single assembly, with one click to override.
- **Enrichment-distinguished fuel — now in MCNP too.** MCNP fuel materials used to all collapse
  to a single "UO2". The preview now reads the `92235`/`92238` fractions on each material card
  and labels distinct bands (e.g. **UO2 1.6 %**, **UO2 2.4 %**, **UO2 3.1 %**) with distinct
  colors, so enrichment zones are separately toggleable — matching SCONE (`UO2-16/24/31`) and
  Serpent (`UO2_31`), whose enrichment bands now also get distinct band colors.
- **Axial multi-segment stacks.** Decks that define real axial structure (active fuel, plenum,
  spring, grid spacers, dashpot, end plugs, reflector segments) can now be expanded with the
  **Axial segments** toggle. The SCONE BEAVRS deck's true axial stack renders as stacked
  segments with their own components (Plenum / Grid Spacers / End Plugs legend entries). A new
  **Slice (Z · axial)** plane cuts vertically through the stack.
- **Real hexagonal placement.** MCNP `lat=2` and Serpent lattice types 2/3 are now placed on
  true hex coordinates (√3⁄2 row spacing with the correct shear) instead of a rectangular
  approximation.
- **MCNP `trcl` transforms.** Cell `trcl` (translation, plus an optional rotation matrix, and
  `*trcl` angle form) is now applied to the placed core/universe.
- **OpenMC nested cores.** The OpenMC parser now expands a nested core (a core lattice whose
  entries are assembly lattices) — not just a single assembly — and recovers fuel enrichment
  from `add_nuclide('U235', …)`, draws barrel/vessel shells from large `ZCylinder` surfaces,
  and supports Disc/Layers fidelity like the other codes.

### Changed

- The geometry panel gained a **Fidelity** section (Pin detail, Axial segments) that
  re-extracts the deck on the extension host when you change it, so toggling detail never
  drops the geometry. Component/material/axial toggles and the slice planes all compose.

### Known limitations

- On a full BEAVRS-scale core, **Axial segments** combined with that many pins exceeds the
  safety cap and is truncated (with a clear warning) — axial detail is best inspected per
  assembly or with the Z slice; full-core radial layers + enrichment bands render in full.
- OpenMC nested-core detection is regex-based (decks are arbitrary Python); cores built by
  functions/comprehensions OWEN can't execute still fall back with an honest message.

## [0.1.9] — 2026-06-22

A new **prebuilt models** picker brings ready-to-open benchmark and starter decks straight into
the editor — no network, no Supabase account. The decks ship inside the extension.

### Added

- **OWEN: Open Prebuilt Model…** (`owen.openPrebuiltModel`). A Quick Pick of bundled reactor
  decks, each labeled by code, scale, and provenance. Picking one opens the deck in a new editor
  with the correct language (MCNP / Serpent / SCONE / Python for OpenMC). Available from the
  Command Palette and the right-click **OWEN** submenu as well as the editor-title **OWEN** menu,
  grouped next to *Insert Material*.
- **Bundled decks** (in `prebuilt-models/`, honest provenance labels):
  - **BEAVRS Full Core** — SCONE, full-core, *verified* (MIT BEAVRS Cycle 1 continuous-energy).
  - **17x17 PWR Assembly** — MCNP, Serpent, and OpenMC, assembly scale, *example fixture — not
    converged* (physically sane geometry/materials for visualization and as starters).
  - **BEAVRS Core** — MCNP and Serpent, full-core, *example fixture — not converged*.

### Notes

- This offline picker is separate from the Supabase-backed **Search Reactor Library** command,
  which is unchanged.

## [0.1.8] — 2026-06-22

The 3D geometry preview now expands **MCNP** and **Serpent** universe/lattice hierarchies the
same way SCONE and OpenMC already did — so a real assembly or a full core renders, instead of
a handful of bare pins.

### Added

- **MCNP lattice & universe expansion.** The preview now parses `u=` (universe), `fill=`
  (including `i1:i2 j1:j2 k1:k2` index ranges with `nR` repeats), and `lat=1` (square) /
  `lat=2` (hex) lattice cells, and resolves the full hierarchy — a root `fill` cell → a core
  lattice of assembly lattices → pin universes — exactly like the SCONE path. Pin universes
  become concentric shells from their `cz` / `c/z` cylinders (and z-aligned `rcc`), with pitch
  taken from the lattice cell's `px`/`py` planes or an `rpp`/`rhp` macrobody. Materials are
  classified by **ZAID** (92xxx/94xxx → fuel, Zr → clad, H+O → water, He → gap, B / Ag-In-Cd /
  borosilicate → absorber, Fe-Cr-Ni → steel), so fuel, guide tubes, and instrument tubes are
  tagged correctly for the layer/material toggles. A bare pin cell (no lattice) still renders
  its z-axis cylinders as before.
- **Serpent nested lattices + CSG basics.** `lat` cards now expand **nested** lattices (a core
  lattice whose entries are assembly lattices whose entries are pin universes), square (type 1)
  and hex (types 2/3, on a rectangular approximation). Added `surf` (`cyl`/`sqc`/`hexxc`/
  `hexyc`) + `cell` parsing so CSG pins (cells referencing `cyl` surfaces) and `fill`-universe
  resolution work alongside `pin` blocks. Core barrel / RPV `cyl` shells render as faint
  context, and large cores switch to one-disc-per-pin mode so they stay interactive.

### Changed

- Full cores in MCNP and Serpent (≥ ~4,000 pins) now render in **disc mode** (one disc per pin,
  colored by material, classified by component) just like SCONE; a single assembly shows full
  concentric pin layers.

### Known limitations

- MCNP/Serpent **hex** (`lat=2` / Serpent type 2/3) lattices are laid out on a rectangular
  approximation. MCNP `trcl`/transforms and off-z-axis cylinders are not applied. MCNP fuel of
  different enrichments all classify to a single "UO2" material (MCNP materials are unnamed —
  classified by ZAID); Serpent keeps distinct material names, so enrichment zones stay separately
  toggleable there.

## [0.1.7] — 2026-06-22

A ground-up rebuild of the **3D geometry preview**: it now parses real lattices and universe
hierarchies instead of guessing from a few variable names, so full assemblies and full cores
render — and you can peel them apart layer by layer.

### Added

- **Real lattice & universe parsing for all four codes.** The preview now expands lattice maps
  and resolves universe hierarchies rather than falling back to a single default pin:
  - **SCONE** — full dictionary parser: resolves `rootUniverse` → `cellUniverse` →
    `latUniverse` → `pinUniverse`, expands nested lattices (a core lattice of assembly
    lattices of pins), turns `pinUniverse` `radii`/`fills` into concentric shells, and draws
    vessel/barrel surfaces as faint shells. A real **full-core BEAVRS** deck (193 assemblies,
    ~55,800 pins) renders as a complete core.
  - **OpenMC** — expands literal nested-list lattices, symbol-grid + `universe_map` dicts, and
    **NumPy-built** maps (`np.full((17,17), F)` + `arr[i,j] = G` element/loop assignments) —
    the common style that previously rendered as one pin.
  - **Serpent** — `pin` blocks + the first `lat` card expand to a full pin lattice.
  - **MCNP** — z-axis cylinders (`cz`, `c/z x y r`) with `pz` axial bounds.
- **Layer / component toggles.** A side panel lets you show/hide geometry by **component**
  (fuel, gap, clad, moderator/coolant, guide tubes, instrument tubes, absorber/burnable
  poison, structure, vessel) and by **material**, each with a color swatch and count, plus
  **All/None** buttons — so you can strip away the outer pins to inspect inner structure.
- **Slice planes + opacity.** X and Y clipping sliders cut through the model to reveal the
  interior, and a shell-opacity slider fades the translucent layers.
- **Honest fallbacks.** When a deck can't be fully expanded (e.g. an OpenMC lattice built by a
  function OWEN can't execute), the panel says **why** instead of silently drawing one pin.

### Changed

- **Performance: instanced rendering.** Geometry is drawn with three.js `InstancedMesh`
  grouped by shape, so a ~50k-pin core stays interactive (a handful of draw calls instead of
  tens of thousands of meshes). The webview ready-handshake is preserved so geometry is never
  dropped on first open.

### Known limitations

- Full-core SCONE renders each pin as a single material-colored disc (toggle a single
  assembly to see concentric pin layers). MCNP `lat`/`fill` universe lattices are not yet
  expanded (reported, not silently dropped); non-z-axis MCNP cylinders are skipped. Hex
  lattices are laid out on a rectangular approximation.

## [0.1.6] — 2026-06-22

Catch invisible whitespace bugs, stay inside MCNP's column limit, reach OWEN from the editor
title bar, and apply a highlight palette with one click.

### Added

- **OWEN: Toggle Invisible Characters.** A new command (Command Palette, the right-click
  **OWEN** submenu, and the editor title-bar menu) flips VS Code's whitespace and
  control-character rendering on/off so you can see spaces, tabs, `¶`, and stray control
  characters — the kind of invisible difference that silently breaks column-sensitive MCNP
  decks. Toggling off restores your previous `editor.renderWhitespace` /
  `editor.renderControlCharacters` values exactly (including "no explicit value").
- **MCNP card-image line-length guard.** MCNP files now show a vertical ruler at the column
  limit, and any line that runs past it is flagged in the **Problems** panel and with an
  in-editor highlight on the overflowing tail — because characters past the limit are silently
  ignored by MCNP, a classic invisible bug. The limit defaults to the classic **80** columns
  and is configurable via **`owen.mcnp.lineLengthLimit`** (set it to `128` for MCNP6.2+). Tab
  expansion is accounted for, so an apparently-short line with a tab is still caught.
- **OWEN in the editor title bar.** A compact **OWEN** menu (beaker icon) now appears at the
  top-right of the editor when you're in an MCNP, Serpent, SCONE, or OpenMC-Python file,
  exposing Validate, Insert Material, Lattice Builder, 3D Preview, Run, Run Sweep, Toggle
  Invisibles, Choose Palette, Tutorial, and Library — the same actions as the right-click
  submenu, one click away.
- **Click-to-apply highlight palettes.** In the palette preview panel
  (**OWEN: Choose Highlight Palette**), each of the four palette cards is now clickable: click
  one (or focus it and press Enter/Space) to apply it immediately, with a hover affordance and
  a **Selected** badge marking the applied palette. The Quick Pick flow still works exactly as
  before.

### Internal

- The parameter-sweep logic (`OWEN: Run Parameter Sweep`) was refactored into a pure,
  vscode-free core (`src/workflows/sweepCore.ts`) and now has unit tests covering parameter
  expansion, regex value substitution, k-eff parsing, and manifest/summary generation. MCNP
  line-length logic is unit-tested too. See `docs/SWEEP_VALIDATION.md` and the extended sweep
  scenario in `docs/OPENMC_EVALUATION.md`.

## [0.1.5] — 2026-06-04

See your highlight colors **before** you pick them.

### Added

- **Live palette preview.** Running **OWEN: Choose Highlight Palette** (Command Palette or
  the right-click **OWEN** submenu) now opens a side panel showing a short, representative
  code sample for the language you picked, rendered in **all four palettes at once** —
  Classic, Solarized, High Contrast, and Pastel — so you can compare them directly. As you
  move through the palette Quick Pick, the matching block in the preview is outlined and
  scrolled into view; press Enter to apply. The samples are real per-language snippets (MCNP
  cells/surfaces/material with a ZAID, OpenMC `Material`/`IndependentSource`/
  `RectangularPrism`, a Serpent `mat`/`surf`/`cell`/`set` deck, and a SCONE dictionary block)
  colored from the exact same scope→color map the editor uses, so the preview matches what
  you'll get. The preview uses your editor's background and monospace font.

## [0.1.4] — 2026-06-04

The OpenMC snippets now pop up **automatically as you type** the prefix — no Ctrl+Space needed.

### Fixed

- **`omc_*` snippets auto-surface while typing.** As of 0.1.2 the snippets showed on
  **Ctrl+Space**, but typing `omc_` in a Python file did not open the suggestion widget with
  them — Pylance's as-you-type / inline suggestion took the slot, so the OWEN items only
  appeared on a manual trigger. The completion provider is now registered with
  **trigger characters** (the lowercase alphabet plus `_`) so the widget opens/refreshes on
  each prefix keystroke; each item carries the correct replacement **range** so `omc_` filters
  to (and is replaced by) the snippet; OWEN items keep a top-biased **`sortText`**; and the
  best matching prefix is **preselected** so it is highlighted ahead of language-server
  completions. Applies to MCNP, Serpent, and SCONE prefixes too. The Python provider still
  only fires in files that import OpenMC (`import openmc`, `import openmc as …`, or
  `from openmc import …`).

> Tip: if you still prefer snippets pinned above everything else, set
> `"editor.snippetSuggestions": "top"`. OWEN does not change your editor settings.

## [0.1.3] — 2026-06-04

Per-language syntax-highlighting color palettes, plus richer grammars to make them meaningful.

### Added

- **Selectable highlight palettes — 4 per language (16 total).** Each of MCNP, OpenMC,
  Serpent, and SCONE can be independently recolored with one of four palettes: **Classic**
  (VS Code dark default-style), **Solarized** (muted Solarized-inspired), **High Contrast**
  (bright/vivid), and **Pastel** (soft, low-saturation). Pick via the new settings
  `owen.highlight.mcnp.palette`, `owen.highlight.openmc.palette`,
  `owen.highlight.serpent.palette`, `owen.highlight.scone.palette`, or via the command
  **OWEN: Choose Highlight Palette** (also in the editor right-click **OWEN** submenu), which
  walks you through language → palette in a QuickPick.
- **Live recoloring.** OWEN applies the chosen palette by writing scoped
  `editor.tokenColorCustomizations` `textMateRules` that target only OWEN's namespaced scopes,
  re-applying immediately whenever an `owen.highlight.*` setting changes. It merges with — and
  never clobbers — your existing token-color customizations, other extensions' rules, or
  theme-scoped blocks, so palettes compose with your active theme.
- **OpenMC injection grammar.** OpenMC files are Python (`.py` with `import openmc`), so there
  was previously no OWEN-specific coloring. A new `openmc.injection` grammar injected into
  `source.python` scopes the `openmc` module, its classes (`support.class.openmc`), functions
  (`support.function.openmc`), and submodules like `openmc.model`/`openmc.stats`
  (`support.type.openmc`) — leaving the rest of your Python untouched.

### Changed

- **Richer MCNP / Serpent / SCONE grammars.** Scopes were expanded and renamed into clean,
  per-language namespaces (e.g. `entity.name.material.mcnp`, `storage.type.surface.mcnp`,
  `constant.other.zaid.mcnp`, `entity.name.type.serpent`, `entity.name.section.scone`) so the
  palettes have distinct token classes to target. Added more keywords/surface types, block-C
  comments for Serpent, and `!`-style comments for SCONE.

## [0.1.2] — 2026-06-04

Follow-up release: the OpenMC snippets still did not surface after the 0.1.1 underscore
rename, and the right-click menu only exposed three commands.

### Fixed

- **OpenMC snippets now reliably appear.** The 0.1.1 fix (hyphen → underscore prefixes) was
  correct but not sufficient: declarative `contributes.snippets` only show in the suggestion
  widget, where the Python language server's completions routinely out-rank or suppress them,
  so the `omc_*` prefixes still looked dead. OWEN now registers an explicit
  `CompletionItemProvider` (kind `Snippet`) for Python, MCNP, Serpent, and SCONE that loads
  the same snippet JSON and serves the prefixes directly. They now show on **Ctrl+Space** and
  as you type `omc_…`, independent of `editor.snippetSuggestions` / `editor.quickSuggestions`.
  The Python snippets are gated to files that `import openmc`.

### Added

- **Right-click context menu.** All eight OWEN commands (Validate Input File, Insert Material
  from Database, Open Lattice Builder, Open 3D Geometry Preview, Run Simulation, Run Parameter
  Sweep, Open Tutorial, Search Reactor Library) are now grouped under an **OWEN** submenu in
  the editor right-click menu, shown for `mcnp`, `serpent`, `scone`, and `python` files.

## [0.1.1] — 2026-06-02

Maintenance release with three bug fixes found during OpenMC capability testing.

### Fixed

- **OpenMC snippets now fire.** The OpenMC Python snippet prefixes were hyphenated
  (`omc-pin-script`, `omc-settings`, …), and VS Code does not trigger snippet completion on a
  hyphen in Python (where `-` is a word separator), so typing a prefix just inserted plain
  text. Prefixes are now underscore-separated: `omc_material`, `omc_pin`, `omc_lattice`,
  `omc_settings`, `omc_model`, `omc_pin_script`, `omc_assembly_script`.
- **Lattice Builder "Insert at Cursor"** no longer silently does nothing when the Lattice
  Builder panel has focus; it inserts into the last active editor (or a new untitled file).
- **3D Geometry Preview** now renders the pin geometry instead of showing only empty axes.

## [0.1.0] — 2026-05-26

Initial public release of OWEN — Open Workspace for Engineered Neutronics,
the BelvoirDynamics VS Code/Cursor extension for nuclear reactor input files.

### Added

- **Languages & syntax highlighting** for MCNP (`.i`, `.mcnp`, `.inp`), Serpent (`.serp`),
  and SCONE (`.scone`). OpenMC is detected via Python files that `import openmc`.
- **Deep validators** with diagnostic codes:
  - MCNP — ZAID format, density/material sign conventions, `mt`/S(α,β) hydrogen check,
    macrobody parameter counts, `HEX`/`CYL` keyword detection, `imp:n` missing on cells.
  - OpenMC — `Source` → `IndependentSource`, `rectangular_prism` → `RectangularPrism`,
    `Material(temperature=)` flagged, deprecated `openmc_exec_kwargs`,
    `model.run()` return-value misuse.
  - Serpent — `surf rect` → `cuboid`, `trcl` not allowed, `set omp` (use CLI),
    `set egrid` energy-unit heuristic.
  - SCONE — `aceNuclearDatabase` → `aceNeutronDatabase`, `temp` ↔ ZAID temperature
    suffix matching, `pinUniverse` radii/fills length + outer-0.0 check,
    non-ASCII detection, dictionary semicolon rule.
- **Lattice Builder** (unchanged from preview): visual grid → MCNP/OpenMC/Serpent code.
- **NRDP material insertion** — bundled snapshot in VSIX plus optional live override
  via `owen.nrdp.live` / `owen.nrdp.endpoint`. Language-aware (`mcnp` / `serpent` /
  `openmc` codes; SCONE stub generated from composition).
- **Tutorial deep-links** to https://reactormc.net via `OWEN: Open Tutorial`.
- **Parameter sweep** workflow (`OWEN: Run Parameter Sweep`) driven by JSON
  schema, with per-run input mutation, output capture, k-eff parsing
  (MCNP combined keff, OpenMC `Combined k-effective`), manifest + TSV summary.
- **3D geometry preview** webview (Three.js via importmap) — MCNP `cz`
  cylinders rendered as transparent stacked tubes. Other languages: graceful
  empty-state.
- **Community Library** (feature-flagged via `owen.community.enabled`) —
  Supabase-backed approved-model browser with insert-at-cursor or open-as-untitled.
- **Snippets** — significant expansion: full PWR pin cell, 17×17 PWR assembly,
  3×3 criticality array, shielding slab (MCNP); full OpenMC pin and assembly
  Python scripts; SCONE fuel pin, 5×5 assembly, shielding slab tutorials.
- **CI** — GitHub Actions workflow building the VSIX as a release artifact.

### Changed

- Rebranded from DynamicMC to BelvoirDynamics; publisher is now `belvoirdynamics`.
- Repository URL corrected to `https://github.com/caalh/BelvoirDynamics`.
- Removed dead `onLanguage:openmc` activation event; OpenMC routes through the
  shared `detectMonteCarloLanguage` helper.

### Known limitations

- 3D geometry preview is MCNP-only and limited to `cz` cylinders.
- SCONE runner shows guidance for WSL on Windows; no automatic WSL detection yet.
- Community Library has no in-app submission flow (UI is browse + insert only).
