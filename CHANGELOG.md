# Changelog

All notable changes to the OWEN VS Code extension are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.4.4] - 2026-08-29

### Added

- **Cell Map for OpenMC, Serpent, and SCONE**, not only MCNP. The same flowchart
  now reads those decks from the exact-geometry model (OpenMC Python decks use
  the live `geometry.xml` the same way Render with OpenMC does). Depth runs
  left to right.

### Changed

- **`OWEN: Input from Community Library`** is the new title for
  `owen.searchReactorLibrary` (command id unchanged).
- **Report a problem** asks for plain text only — do not attach files. Paste a
  short excerpt of the deck in the email instead.

### Fixed

- **OpenMC geometry capture** no longer raises `FileNotFoundError` on
  `owen_skipped_statepoint.h5` when a deck does `StatePoint(model.run())`, and
  no longer paints "OPENMC_CROSS_SECTIONS was not set" as a defect when a
  library was found. Concatenated `materials.xml` + `geometry.xml` is recognized
  as OpenMC XML so spherical / CSG models draw instead of an empty axis overlay.
- **2D slice zoom** can go past the fitted window (up to 8× out) so vacuum
  around a tight model is visible. Fit still frames with a 12% margin.
- **MCNP lattice fill numbers highlight on double-click**, not only when the
  caret sits on the digit after a right-to-left drag.
- **Cell Map click-to-reveal** on OpenMC / Serpent no longer jumps to the first
  `id=2` in the file or to `surf s12` when you clicked surface 2.

## [1.4.3] - 2026-08-29

### Added

- **MCNP Cell Map** (beaker menu → *Show MCNP Cell Map*, MCNP files only). A
  deck is written as a flat list of cells, but it describes a tree: universe 0
  holds the real world, a cell with `fill=` hands its interior to another
  universe, and a `lat=` cell tiles one. The Cell Map draws that tree. Cells are
  cards grouped inside their universe; an arrow runs from the cell that fills to
  the universe it fills with, labelled with the placement count decoded from the
  `fill` array — on the bundled 17×17 assembly, `×264` to the fuel-pin universe,
  `×24` to the guide tubes, `×1` to the instrument tube. Each card shows its
  material and density (with the sign read the way MCNP means it: negative is
  g/cm³, positive is atoms/b·cm), its region, and a chip per bounding surface
  carrying the sense. Click a cell or a surface chip to jump to that card in the
  editor; the side panel adds the surface definitions, the cells subtracted with
  `#`, and what sits across each shared surface. Pan, zoom, search, and collapse
  a universe to a single bar; decks over 300 cells open collapsed.
- **Cell Map reads the deck for input errors that geometry checks miss** and
  lists them above the map: a universe that nothing fills, a `fill=` pointing at
  a universe no cell declares, a `#` complement of a cell that does not exist, a
  surface with no surface card, a universe fill cycle, and a deck with no
  `imp:n=0` cell to terminate histories.
- **Reference Documentation** in the beaker menu opens upstream's own manual for
  whatever you have open — the LANL manual index for MCNP, docs.openmc.org for
  OpenMC, VTT's documentation for Serpent, Read the Docs for SCONE — with the
  nuclear-data services (NNDC, IAEA, JANIS) and ReactorMC below. The active
  file's code sorts to the top with its manual first. Serpent's primary entry is
  the maintained documentation at `serpent.vtt.fi/docs/`; the wiki is still
  listed, labelled legacy, because VTT no longer updates it.

### Fixed

- **`verify:openmc-tokens` had been failing since 1.1.4 and nobody was reading
  it.** That release taught the scanner the Python layer around the openmc
  symbols — comments, strings, numbers, keywords, `def` names — so it emits
  more than the injection grammar declares. The guard compared the whole token
  stream against the grammar's four patterns and went red, which is a different
  question from the one it exists to ask. It now compares the openmc symbols to
  the grammar and pins the Python layer separately, including the gate that
  makes a file whose only mention of openmc is inside a comment cost nothing.

## [1.4.2] - 2026-08-29

### Added

- **Report a problem** in the OWEN beaker menu (and the editor context menu)
  opens a note to email [help@reactormc.net](mailto:help@reactormc.net) with the
  deck, the code, and what you expected to see.
- **MCNP `fill=0:N 0:M 0:0` on a large lattice.** Element (0,0,0) is the
  lattice cell as written (§5.5.5), so that range only indexes +i/+j from
  the origin window. A centered 17×17 `rpp` then shows about a quarter of
  the pins on an exact 2D slice — 1.4.1 was drawing MCNP, not cutting the
  lattice off. The Problems panel, 2D slice, and 3D notes now say so and
  name `fill=-8:8 -8:8 0:0`. The 3D view still centers the map for display;
  2D still follows MCNP.
- **MCNP References paints every use of an entity, not just its definition.**
  Selecting Material 2 (or clicking `m2`) highlights every cell that uses
  `m2` — not the `2`s in a fill map, which are universe ids. Putting the
  caret on a fill-array number highlights every other copy of that universe
  in the lattice (guide tubes light up as a pattern). Bare integers are not
  editor words in MCNP, so this is a decoration, not VS Code's word highlighter.

### Fixed

- **Workspace trust is not a warning that OWEN is unsafe.** Cursor/VS Code
  shows "Do you trust the authors of the files in this folder?" when an
  extension would run code in an untrusted folder. OWEN now declares limited
  Restricted Mode support so you can install it without that blocking the
  enable; running a code, Render/Verify with OpenMC, and loading a live OpenMC
  model still ask you to trust the folder. Click **Trust Workspace & Install**
  if you see the dialog — that trusts *this folder*, not a Marketplace verdict
  on the extension.
- **MCNP 3D no longer fills the hole in nested finite RCCs.** `3 -4` on two
  RCCs of different height (a salt annulus with end-cap disks, the HYLIFE
  chamber) used to drop "outside the inner body" and draw a solid cylinder.
  Whole-body outside is now expanded to a union of outside facets.
- **OpenMC 3D/2D use the live geometry, not a Python guess.** The in-editor
  preview runs the deck the same way Render with OpenMC does, reads
  `geometry.xml`, and builds the exact CSG. Lattice decks keep the 3D fast
  path and still get exact 2D slices from the live model. `geometry.xml` /
  `model.xml` on disk parse without running Python.
- **Input Builder: adding a lattice now fills it.** The pin-cell starter
  left `fill=1` inside a 0.63 cm reflecting square, so a 17×17 map was
  written and never transported. Adding a lattice (or opening the Lattice
  tab) points the boundary at that lattice and grows the box. An unfilled
  lattice is a blocking check; New File / Copy now use the same error gate
  as Insert.
- **MCNP no longer underlines a comment that runs past the column limit.**
  Truncating a `c` comment card, or text after a `$` that itself sits before
  the limit, does not change the problem. A `$` past the limit is still
  flagged: MCNP never sees it.

- **"Render with OpenMC" and "Verify Geometry with OpenMC" could not open a deck
  that gates on `OPENMC_CROSS_SECTIONS`.** That variable is normally exported
  from a shell profile or by `conda activate`, and OWEN starts the interpreter
  without a login shell (`wsl --exec python3`), so the variable was absent and
  such a deck exited before building anything — reported as the misleading "No
  OpenMC model found". OWEN now looks for a library (the new
  `owen.openmc.crossSections` setting, the environment, the `openmc` config
  file, then the usual install locations) and lends it to the deck. Geometry
  plotting needs no nuclear data at all, so when there is no library the deck
  gets an empty stand-in for the length of the run, withdrawn before OpenMC is
  invoked.
- **A model built inside a function was invisible.** Both commands only scanned
  the module globals after running the deck, so the extremely common
  `def main(): model = build_model(...)` never yielded anything. Models and
  geometries are now captured as they are constructed, run, or exported; failing
  that, OWEN retries with the deck's own export-only flag (`--no-run` and
  friends) and finally calls a zero-argument builder it defines. When all of
  that fails, the error says what was tried instead of only what was missing.
- **A deck's `export_to_xml()` can no longer overwrite files next to the deck.**
  It is intercepted, and OWEN exports the captured model into its own throwaway
  directory. XML a deck wrote into a subdirectory is still picked up.
- **Automatic framing no longer renders the model as a dot.** A geometry wrapped
  in a large vacuum boundary (a 2000 cm sphere around a 218 cm chamber) filled
  1/9 of the frame. Automatic views now frame the material-filled cells, with
  "whole geometry" one control away, and say when the two differ by a lot.
- **The lost-particle probe uses the deck's own source** rather than a default
  point source at the origin, and is skipped only when no library really exists
  (it used to test the environment variable, which OWEN itself now sets).
- **The 3D preview no longer draws a PWR fuel pin for decks that are not pin
  lattices.** A fusion chamber, a sphere benchmark or a tank produced a
  fabricated 0.41 cm pin labelled as a representative pin cell. OWEN now rebuilds
  the shells such a deck states outright — `Sphere`, `{X,Y,Z}Cylinder`,
  `{X,Y,Z}Plane`, `RightCircularCylinder`, `RectangularParallelepiped` and cells
  whose region intersects them — and reports the cells it could not size because
  their dimensions come from a function argument or dataclass field. When nothing
  is recognizable it says the pin is a placeholder, not your model.
- **Run results were largely invented.** Every one of the four readers behind
  "Show Run Results" was a small set of regular expressions written against a
  guess at the output format, and each was checked only against a fixture written
  from the same guess. Validating them against real files — an OpenMC statepoint,
  `tallies.out` and log generated here, MCNP output from a production study, and
  the formats as the MCNP manual, the Serpent wiki and SCONE's own
  `asciiMATLAB_class.f90` define them — found that all four reported numbers that
  were not in the file:
  - MCNP: the reader only ever looked for `mctal`, and its idea of `mctal` was
    wrong (it read one number per bin where the file stores mean/error pairs, and
    it had no notion of the `f`/`d`/`u`/`s`/`m`/`c`/`e`/`t` bin structure, so bins
    were misaligned). The far more common plain text output was not supported at
    all: pointed at one, the reader turned any two numbers on a line into a flux
    spectrum, so a cross-section table listing became a tally result. There is now
    a reader per format — text output and `mctal` — chosen by inspecting the file.
    The text reader reports tally results with their energy bins, the verdict of
    the 10 statistical checks, the tally fluctuation chart, and the warnings and
    fatal errors MCNP printed.
  - OpenMC: the statepoint reader could never have worked. It destructured
    `h5wasm`'s emscripten filesystem off the module namespace instead of the
    resolved instance, so it threw on every file and fell back to an empty
    result; and even had that worked, `h5wasm` is ESM-only and the extension is
    bundled to CommonJS, so the import itself would have failed in the packaged
    VSIX. Statepoints are now read directly off disk through `h5wasm/node`, means
    and relative errors are reconstructed from the sums of scores and squares the
    way OpenMC's own Python API does it (they are not stored), and filters and
    meshes are read so that bins carry the labels OpenMC gives them. `tallies.out`
    is supported as well, and the log reader now follows the real batch table
    instead of one line of it.
  - Serpent and SCONE: both read a simplified form of the file. The Serpent
    reader now parses the MATLAB assignments in `_res.m` (including the
    `(idx, [1: n])` form), takes k-eff from the estimator the file actually
    reports, treats burnup steps as a series, and reads `_det.m` detectors from
    the documented 12-column layout with their energy grid. The SCONE reader
    follows `asciiMATLAB` output, prefers the active-cycle k-eff over the
    inactive one, and reconstructs bin labels from the map arrays.
  - Output files are identified by their contents rather than their names, which
    matters because OpenMC's `tallies.out` was being handed to the SCONE reader on
    the strength of its extension, and MCNP output can be named anything at all.
  The results panel shows what the readers now recover — per-bin values and
  errors, statistical checks, figure of merit, run metadata — and states plainly
  what it could not read instead of showing an empty table.
- **The MCNP-to-OpenMC converter mirrored lattices.** MCNP fixes a lattice's
  index directions from the order its bounding surfaces are listed — §3.3.1.5.2:
  "beyond the first surface listed is the (1,0,0) element, beyond the second
  surface listed is the (-1,0,0) element" — so a deck that lists `-51 50` runs
  its `i` index toward −x. The converter assumed +x/+y/+z always, and OpenMC's
  `RectLattice` has no way to express anything else, so such a lattice came out
  reflected. Symmetric fill maps hid it completely; the tell was an asymmetric
  one, where the converted core put the baffle plates on the wrong side. The
  converter now derives each index direction from the surface order and reorders
  the fill array (and `lower_left`) into OpenMC's fixed axes.
- **Cross-section discovery took the first library it found, not the best.** A
  machine set up for OpenMC usually has more than one `cross_sections.xml`: a
  slim test or depletion library beside the full evaluation. Discovery walked a
  fixed list of paths and stopped at the first hit, which on a normal
  `openmc-data` layout meant a 26-nuclide library won over ENDF/B-VIII.0 and
  every transport run died on the first nuclide the slim one lacked. A library
  the user *names* (the `owen.openmc.crossSections` setting, the environment, the
  `openmc` config file) is still authoritative; among libraries OWEN merely
  finds, the one listing the most nuclides now wins. The search also reaches two
  directories deep, which is where the openmc-data scripts actually put it
  (`~/openmc-data-endfb80/endfb-viii.0-hdf5/cross_sections.xml`).
- **The 3D preview drew a rod of coolant wherever a deck used a homogeneous
  universe.** `-3:3` — the union of both senses of one surface, i.e. all space —
  is how a deck writes a universe that is nothing but water, for the gap between
  assemblies or the unloaded ring of a core lattice. The pin extractor reads a
  flat list of signed surfaces, so it took the `-3` for a bounding cylinder and
  invented a 0.46 cm water rod at every such position: 14,000 of them in the
  full-core deck, enough instance budget to silently drop axial expansion and
  render the core as a flat slab. Both senses of one surface are now understood
  to mean the surface does not bound the cell.
- **Two bundled MCNP decks had regions with no universe under them.** A 17×17
  lattice of 1.26 cm pins spans 21.42 cm, but the assembly window is 21.50364 cm,
  so a 0.042 cm sliver ran around every assembly with nothing in it; the same
  thing happened between the 17×17 assembly grid and the barrel it sits in. MCNP
  loses particles there. Both lattice levels in `beavrs_fullcore_mcnp.i` now
  carry a ring of water elements, which is the inter-assembly gap BEAVRS actually
  has, and `assembly_17x17_mcnp.i` has its fill indices centred (`-8:8` rather
  than `0:16`) so the lattice sits where its bounding surfaces say it does.

### Added

- `owen.openmc.crossSections` — the `cross_sections.xml` to use when rendering or
  verifying, as the interpreter sees it (a WSL path when OpenMC lives in WSL).
- `owen.openmc.deckArgs` plus a **Deck arguments** field in the render panel, so a
  deck with presets can be rendered as `--preset seventy_thirty_base` instead of
  only in its default configuration.
- **Auto fit** control in the render panel: filled cells (default) or whole
  geometry.
- `npm run verify:openmc-native` — a standing end-to-end check that runs the real
  helper scripts through a real OpenMC against five fixture decks (model inside
  `main()`, module-level geometry, builder-only, no model, deliberate overlap),
  asserting non-blank images, framing, argument pass-through, error text, and
  that the overlap scan sees a real overlap. `--deck <path>` renders one real
  deck for debugging.
- `npm run verify:results` — a standing check of all six result readers against
  real-format fixtures, asserting the numbers match the values OpenMC's own API
  reports for the same statepoint, that MCNP tally parts sum to the total in a
  real production output, and that a mismatch is reported rather than smoothed
  over. `src/test/fixtures/README.md` records where each fixture came from.
- `npm run verify:h5-bundle` — bundles the statepoint reader to CommonJS exactly
  as the extension is bundled and reads a real statepoint through it, so the
  ESM-only `h5wasm` import cannot break in the packaged VSIX while continuing to
  pass in tests.
- `npm run verify:run` — a standing check of "Run Simulation" and the parameter
  sweep: the command line OWEN types is asserted against the real shells (a
  PowerShell line is actually executed, so a quoting regression fails here rather
  than in a user's terminal), and where WSL has OpenMC the exact command line is
  run on a pin cell and the statepoint read back through OWEN's own readers.
- `npm run verify:converter` — a standing three-way agreement check on the
  converters. Each bundled MCNP deck is converted, executed by a real OpenMC, and
  then sampled: thousands of random points are looked up in both OWEN's exact
  MCNP engine and the converted OpenMC model, and every material must match.
  This is what caught the mirrored lattices; it now agrees on 23,326 of 23,326
  points inside the full BEAVRS core, and where a deck defines a source it also
  asserts that transport runs without losing a particle.

## [1.4.1] - 2026-08-13

### Fixed

- **Material cards no longer name ACE tables that do not exist.** Every oxide in
  PNNL-15870 contains 0.2 at% O-18, and ENDF/B-VII.1 has no O-18 evaluation, so
  the cards OWEN inserted for more than half the compendium named `8018.80c`.
  MCNP stops on the first table it cannot find, so those decks did not run at
  all. OWEN now knows which of the 423 ZAIDs ENDF/B-VII.1 actually ships and
  folds a nuclide the library lacks into the element's most abundant isotope,
  preserving both the mass and the atom count, or collapses to the elemental
  table where that is the only one (carbon is `6000`, and there is no `6012`).
  Every card says in a comment which of those it had to do.
- **The bundled material library was years out of date and disagreed with
  reactormc.net.** `npm run export-nrdp` resolved the site repo one directory too
  far up, found nothing, wrote empty arrays and exited successfully, so the VSIX
  shipped whatever had last been committed by hand. It now searches the plausible
  locations, honours `REACTORMC_REPO`, and fails loudly rather than quietly
  shipping stale data.
- **The runtime material fetch had never worked.** `owen.nrdp.live` pointed at
  `reactormc.net/data/nrdp-materials.json`, which the site did not publish, so
  every insert silently fell back to the bundled copy. The site publishes it now,
  which means a material correction reaches your editor without an update — and
  the reader accepts both the bare array the site serves and a payload that wraps
  it, rather than treating anything unexpected as an outage.
- **SCONE material inserts were physically meaningless.** `owen.insertMaterial`
  wrote weight fractions into a `composition { }` block, which SCONE reads as
  atom densities in atoms/barn-cm — a material roughly 10^22 times too dense,
  from a deck that parses without complaint. SCONE blocks now carry real atom
  densities with a temperature suffix that matches their `temp`.
- **Two entries built from the same material no longer collide.** A moderator and
  a reflector both filled with light water declared the same Serpent material and
  the same `therm` name, so one definition overwrote the other and geometry
  pointed at whichever survived. Names are now unique per deck.
- **Cards fit a card image and are ASCII.** Provenance and folding comments ran
  past column 80 and carried em dashes and subscript digits out of names like
  `UZrH1.6`, which the Input Builder's own pre-insert check flagged. Comments are
  wrapped and transliterated.

### Changed

- **The Input Builder's material list is generated from the ReactorMC data, not
  typed.** It used to carry its own compositions, and they had drifted: UO2 at
  10.97 g/cm3 with 3 *atom* percent U-235 under a "3 wt% enriched" label (about
  1% light on fissile, and the same at 4.5% and 5%), SS304 at a nominal
  19/10/2/69 instead of the measured composition, Zircaloy-4 naming an elemental
  zirconium table. The dropdown now offers the full curated set of 40 materials,
  each either a PNNL-15870 Rev. 2 entry verbatim or a derived recipe whose
  provenance is on the card, and every card comes from the same generator the
  website uses.
- **Thermal scattering is attached wherever ENDF/B-VII.1 has an evaluation**, not
  only to hydrogenous moderators: graphite, beryllium metal, BeO and zirconium
  hydride get theirs (both bindings, where there are two). Nothing is attached to
  a fuel or a plain metal.
- The material picker shows density and whether an entry is a compendium material
  or a derived recipe.

## [1.4.0] — 2026-08-13

### Added

- **The Input Builder is a split screen you can actually build a deck in.** The
  left pane is a list of sections — materials, pin cell, lattice, boundary, run
  settings, tally, bare surface, bare cell, free text — and any kind can be added
  more than once, reordered, duplicated, muted or deleted. The right pane is the
  deck as it stands, with the selected section's lines highlighted, so you can see
  what each control writes. Numbering is allocated centrally, so a second lattice
  cannot land on the first one's cell, surface or universe numbers.
- **Pre-insert checks.** Below the preview, a list of problems found in the
  assembled deck: a boundary that cuts through the lattice, an MCNP volume tally
  inside repeated structures with no `sd`, a tally naming a cell the deck never
  defines, a source point outside the boundary, a material referenced with no
  material section, a line over the dialect's column limit, non-ASCII in a SCONE
  deck. Each row jumps to the line and the section that produced it. Errors hold
  insertion behind a confirmation; warnings and notes do not.
- **The MCNP → OpenMC converter handles the rest of the macrobodies**
  ([#4](https://github.com/caalh/owen/issues/4)). `ELL` (both the focus form and
  the centre form) becomes an exact `openmc.Quadric` spheroid, including
  off-axis major axes; `REC` becomes an elliptical-cylinder quadric capped by two
  planes; `TRC` becomes `openmc.model.ConicalFrustum` (OpenMC 0.15.0+); `WED` and
  `ARB` become the intersection of their bounding planes. `BOX` no longer requires
  12 axis-aligned entries — an oblique box converts as six planes, and the legal
  9-entry form converts as the infinite prism it is. The point-defined `X`/`Y`/`Z`
  surfaces convert by point count: plane, cylinder, one-sided cone, or the fitted
  conic of revolution. Previously each of these stopped at "is not a supported
  surface type" and left a TODO comment.

### Fixed

- **The Layers panel could not be scrolled on a deck that produced many
  warnings** ([#3](https://github.com/caalh/owen/issues/3)). The warning block had
  no height limit, so on a deck where dozens of cells reported the same thing it
  filled the panel and pushed every control out of reach — and the list itself
  could not shrink, so nothing scrolled. Warnings now occupy at most a third of
  the panel and scroll on their own, and repeated messages collapse into one line
  per distinct reason ("14 cells: …") with the affected cell numbers listed
  underneath.
- **`#cell` complements are rendered, not replaced by a bounding box**
  ([#3](https://github.com/caalh/owen/issues/3)). The 3D builder rewrites each
  region into a union of intersections, and it used to give up the moment it met a
  `#`, which is how most people write a shell or a "everything but that" cell. The
  referenced region is now substituted under one more negation, which is an exact
  rewrite. Concentric spheres collapse to the smallest, a concentric subtraction
  becomes an annulus, and a term that contradicts itself drops out instead of
  failing. What genuinely cannot expand — a `#` cycle, a complement of a cell
  placed by its own `trcl`, a region past the union budget — now names which of
  those it hit, and the panel explains what to do about it.
- **Baffle plates no longer intersect each other.** The stepped core outline was
  drawn as full-span plates in both cardinal directions, so at every corner two
  plates passed through one another. Plates are now butt-jointed: the second
  direction's spans have the first's footprint subtracted, and stubs shorter than
  the plate thickness are dropped.
- **SCONE cores drew no baffle or vessel structure at all.** The radial-shell
  reader matched the enclosing `surfaces` block instead of the individual cylinder
  definitions, and the assembly test did not see through `cellUniverse` or axial
  stack wrappers, which is how SCONE decks are usually written. Shell names are
  now classified by role (barrel, neutron shield, liner, RPV) and wrapped
  assemblies are recognised.
- **Macrobody facet references are reported instead of silently widened.** A
  region using `-10.2` converted as though it said `-10`, quietly producing a
  different cell. The facet digit is now kept through parsing and the conversion
  says which cell used it.
- **Material library corrections** (shared with the material wizard, so these
  affect every panel that writes a material card): SCONE compositions were
  fractions where SCONE wants atom densities in atoms/barn-cm; Zircaloy-4 and
  SS304 named elemental ZAIDs (`40000.80c`, `26000.80c`, …) that ENDF/B-VII.1 does
  not ship, and are now expanded to natural isotopes; Serpent water, helium and
  air had positive densities, which Serpent reads as atom density; Serpent light
  water had `therm hwtr` and no `moder`; B₄C had no carbon in it; dry air had more
  N-15 than N-14. OpenMC material references were derived from the display label
  while the cards were named from the id, so a `fill=` could point at a name that
  was never defined, and the OpenMC root cell was emitted before the lattice it
  filled — a `NameError` at run time.
- **The MCNP 80/128 toggle now moves the guide line.** OWEN 0.1.6–1.1.x wrote
  `[mcnp].editor.rulers` without recording what it had written, and the
  "don't clobber the user's ruler" guard added in 1.2.0 keyed on that record —
  so on every pre-1.2 install the guard read OWEN's own ruler as
  user-configured and refused to move it. The status bar and the diagnostics
  followed the dialect; the vertical line stayed at column 80. A lone ruler
  sitting at a limit OWEN manages (80, 128, or the configured custom value) is
  now adopted, a deliberate layout (`[72]`, or several rulers) is still left
  alone, and when it is left alone the toggle says so instead of appearing to
  do nothing. The dialect is also written to the configuration scope it is
  read back from, and the ruler, decorations and status bar all move in the
  same turn as the click.
- **The toggle is reachable from the menus.** `OWEN: Toggle MCNP Line Limit
  (80/128)` now appears in the right-click OWEN submenu and the editor-title
  OWEN menu for MCNP files, not only in the Command Palette and status bar.

### Changed

- **2D slice view is navigable and no longer aliases a lattice into
  speckle.** A fitted whole-core view was one sample per pixel at ~1.28 cm/px
  against a 1.26 cm pin pitch — below Nyquist for the lattice. The view gains
  zoom (mouse wheel anchored under the cursor, ±, Fit), drag-to-pan,
  resolutions up to 1024², selectable 1×/2×/3× supersampling (majority vote
  per pixel; an overlap in any subsample still paints the pixel, since a
  double-claimed sliver is a modeling error, not a shading detail), and a
  one-pixel outline on region boundaries, which is what recovers the crispness
  of a vector plot in a classified raster. A cm-per-pixel readout makes the
  sampling budget visible.
- **Slice colors and labels match the 3D view.** Materials are colored by the
  shared palette and named from the deck (`UO2 3.1%`, `Water`) instead of
  hash-colored `m31`; click-to-identify reports the material name and the
  world coordinates of the point.
- **Slices render progressively and no longer freeze the editor.**
  Classification is a resumable job advanced in ~30 ms bands between
  macrotasks, streamed to the webview as they finish. On a full-core BEAVRS
  deck the first rows appear in ~46 ms and the worst host stall is ~41 ms,
  where a 768²/2× render previously blocked the extension host in one
  multi-second call. A new request cancels the one in flight; editing the deck
  or closing the panel cancels too.
- **Point membership is ~2.2× faster on lattices.** `findCell` was deriving a
  lattice cell's plane-pair basis for every sampled point. The basis is now
  memoized per model and carries a precomputed pseudo-inverse, so resolving
  fractional lattice indices is one matrix-vector product rather than a
  Gaussian elimination, and the `#cell` cycle guard allocates only when a
  complement is actually evaluated. Full-core slice: 7.3 s → 3.2 s.
- **A hollow shell is drawn see-through.** A sphere or cylinder with an inner
  radius no longer renders as a solid, which had been hiding whatever it
  contained.
- **A crash inside a panel says so.** An exception in the Input Builder webview
  used to leave the panel silently frozen with nothing in any log; it is now
  reported to the host and surfaced.
- **Panel scripts are parsed by the test suite.** Both panels ship UI JavaScript
  embedded in a TypeScript template literal, where an escaping mistake produces a
  panel that opens and does nothing. The suite now parses the emitted script of
  the Geometry Preview and the Input Builder (and the preview's import map as
  JSON), so that failure mode is a red test rather than a bug report.

## [1.3.0] — 2026-08-13

### Added

- **In-editor exact 2D slice view.** The 3D Geometry Preview gains a "2D
  slice" mode: every pixel is classified against the parsed CSG on the
  extension host (axis pick XY/XZ/YZ, plane-offset slider bound to the model
  extents, 256/384/512 resolution, color by material or cell). Click a pixel
  to identify cell / material / density, lost regions and overlaps render
  magenta (OpenMC overlap-plot convention), and "Export PNG…" saves through a
  standard save dialog. Ground-truth method — the same evaluator the MCNP
  plotter idiom trusts, no meshing anywhere in the loop.
- **Serpent and SCONE on the exact engine.** New engine parsers map both
  codes onto the shared geometry model: Serpent `surf`/`cell`/`pin`/`lat`
  cards (px/py/pz, plane, sph, cyl/cylx/cyly/cylz with truncation, sqc, cube,
  cuboid, hexxc/hexyc, cone, torx/tory/torz, inf; square + hex lattices;
  `trans s` translations) and SCONE dictionaries (sphere, x/y/zCylinder,
  zTruncCylinder, planes, box/squareCylinders; rootUniverse, cellUniverse,
  pinUniverse, latUniverse). The slice view therefore classifies MCNP,
  Serpent, and SCONE decks; OpenMC stays with the native-render path.
- **Mesh-clipped CSG for oblique cuts.** A cylinder, sphere, or one-sheet
  cone intersected only by planes is convex, so the engine now meshes it from
  midpoint-tangent half-spaces and clips exactly — watertight by
  construction (validated by an edge-use test and a 1%-tolerance volume
  check against the closed form). These cells count as rendered exactly in
  the census. A triangle budget (default 200k) coarsens tessellation under
  pressure before instanced pins ever lose layers.

### Fixed

- **Hexagonal lattice indexing beyond ring 1.** The lattice-basis math now
  drops linearly dependent window-plane pairs (a hex window has three facet
  pairs in one plane) and solves the element origin with proper normal
  equations, so far-out hex elements index correctly instead of relying on
  the nearest-neighbor rescue.

## [1.2.0] — 2026-08-12

### Added

- **MCNP line-limit dialect toggle.** New `owen.mcnp.dialect` setting picks the
  card-image column limit by MCNP version: `mcnp6.1-and-earlier` (80 columns,
  the portable default), `mcnp6.2+` (128 columns — LA-UR-24-24602 Rev. 1
  §3.2.2 and Table 4.1), or `custom` (the raw `owen.mcnp.lineLengthLimit`).
  A status-bar item shows the effective limit for the active deck and toggles
  80↔128 on click (`OWEN: Toggle MCNP Line Limit (80/128)`, persisted
  per-workspace). Mixed-version workspaces can pin a single file with a
  `c owen: line-limit=128` comment near the top — the directive beats every
  setting, and the line-length warning now names whichever dialect produced
  it. Legacy configs that only set `owen.mcnp.lineLengthLimit` keep working.
- **Exact MCNP geometry engine (first stage of the industry-viewer roadmap).**
  A full-fidelity parser (`parseMcnpGeometry`) covers every surface mnemonic
  (planes, spheres, cylinders, one/two-sheet cones, `sq`/`gq` quadrics, tori,
  point-defined `x`/`y`/`z`), every macrobody with Table 5.2 facet numbering
  and the documented short forms (`BOX` 9/12, `RHP`/`HEX` 9/15, `REC` 10/12),
  full boolean cell expressions (unions, parentheses, `#cell` and `#(expr)`
  complements, facet references, `like n but`), `TR`/`*TR` cards with
  partial-matrix completion, surface transforms, `trcl` (including generated
  1000×cell+surface numbers), and `lat=1`/`lat=2` fills with index ranges and
  per-entry transforms. A point-membership evaluator (`cellContains` /
  `findCell`) resolves the universe/fill/lattice hierarchy exactly — validated
  by Monte Carlo volume checks against closed forms and the manual's own
  §5.3.4.11.1 worked example.
- **Analytic primitives for non-lattice decks.** When a deck has no pin
  lattice to expand, the preview now renders cells through the exact engine:
  spheres, truncated cones, tori, ellipsoids, elliptic cylinders, off-axis
  (`cx`/`cy`) cylinders, annuli, and arbitrary planar solids (wedges, `arb`
  polyhedra, boxes) — with a per-deck census in the notes: *N rendered
  exactly, K approximated, F drawn as translucent bounds*. Unresolvable cells
  degrade to a translucent bounding box and a warning naming the cell — never
  a silent omission.
- **Exact 2D slice classification** (`sliceModel` / `identifyAt`): pixel-exact
  plane slices evaluated directly on the parsed CSG with magenta lost/overlap
  reporting, OpenMC-plotter style. Shipped in the shared engine and on the
  reactormc.net visualizer; an in-editor slice panel follows in a later minor.

### Changed

- **Vessel/baffle detection is no longer BEAVRS-specific.** Radial shells are
  now found from any root-level annular cell pair at vessel scale, classified
  by material (steel → vessel, water → downcomer) regardless of surface
  numbering; the BEAVRS surface-id convention (80–86) remains only as a
  gap-filler for the octant shield pads and never duplicates a detected shell.
- **Unsupported geometry is always reported.** A deck consisting only of
  surfaces the fallback path cannot draw now warns naming every skipped
  surface type and count — nothing is silently dropped.

### Fixed

- **Community Library search against a focused MCNP/OpenMC/Serpent/SCONE deck.**
  Filtering used `.ilike('code', …)` on `public.models.code`, which is a Postgres
  enum (`model_code`). Enums have no `~~*` / ILIKE operator, so every filtered
  search failed with `operator does not exist: model_code ~~* unknown`. The
  filter is now `.eq('code', detected)` — `detectMonteCarloLanguage` already
  returns the exact enum label. Guarded by a source-level regression test.

## [1.1.5] — 2026-08-06

### Added

- **`OWEN: Open Community Library on reactormc.net`** — opens the community library
  in a browser, next to the existing search commands in the OWEN menus. This is the
  submission path: OWEN browses and inserts decks but has no upload flow, so
  uploading, rating, and commenting happen on the site. Being a plain external link,
  it keeps working when the backend is unreachable and when the in-editor browser is
  turned off. A configurable `owen.community.webUrl` backs it, and only `http(s)`
  targets are honored so a bad setting cannot launch another URI scheme.

### Changed

- **The Community Library browser now works out of the box.** It shipped disabled
  with empty credentials, which meant nobody used it: `owen.community.enabled` now
  defaults to `true` and `owen.supabase.url` / `owen.supabase.anonKey` default to the
  public ReactorMC project. The bundled key is a Supabase **publishable** key — public
  by design, already served in the reactormc.net page bundle, and constrained by Row
  Level Security to reading *approved* models. The client is still built with
  `persistSession: false`, so it cannot authenticate or write. Set
  `owen.community.enabled` to `false` to stop OWEN contacting the backend entirely;
  bundled prebuilt models and snippets are unaffected.
- **Failures are now actionable instead of raw.** ReactorMC runs on Supabase's free
  tier, which pauses a project after roughly a week of inactivity, so an unreachable
  backend is routine rather than a bug — and it surfaced as
  `OWEN: community search failed: TypeError: Failed to fetch`. Network and gateway
  failures are now recognized and reported as a temporary outage that explicitly says
  nothing is wrong with the user's deck. Genuine query and permission errors still
  show their real message. Every one of these prompts, plus the empty-result case,
  now offers an **Open on reactormc.net** button.
- An empty result no longer reads as a dead end: with no approved models for the
  detected code, OWEN says yours could be the first and offers the upload page.

### Notes

- Marketplace and Open VSX remain behind pending publisher tokens; the VSIX on the
  GitHub release is the installable artifact.

### Fixed

- **The OpenMC palettes now visibly change a deck.** Switching palettes recolored
  only OpenMC API names, and in a real deck those are a small minority of what is
  on screen — so numbers, strings, comments and `def`/`import` kept the same theme
  color under every palette and the four options looked nearly identical. This was
  reported three times; the two previous attempts (per-palette hue families in
  1.1.1, method and attribute coverage in 1.1.2) both widened *which API names*
  were colored without touching the Python layer that surrounds them, which is why
  neither moved the needle.

  The palette now also claims Python comments, string literals, numeric literals,
  keywords, and the name a `def` or `class` introduces. Measured on the bundled
  decks, the share of non-whitespace characters the palette governs goes from
  20.7% to 73.2% on the pin cell and from **9.8% to 68.9%** on BEAVRS full-core.

  Plain variable names (`fuel`, `cell`) are still left alone — themes render those
  in the default foreground, and claiming them would fight the editor rather than
  decorate it.

### Added

- `owen.highlight.openmc.coverage` — `Full deck` (default) or `OpenMC API only` to
  restore the previous accent-only behaviour. Applies only to files detected as
  OpenMC decks; ordinary Python is never touched.

### Changed

- The palette preview panel tags its OpenMC sample the way the editor actually
  claims tokens, so the cards no longer under-sell the difference between
  palettes. The sample gained a comment, a `def`, and real numeric literals.

## [1.1.3] — 2026-08-02

### Fixed

- **MCNP validator corrections from a full read of the MCNP 6.3.1 manual**
  (LA-UR-24-24602 Rev. 1):
  - ZAID class letters are the 14 physics identifiers of Table B.1
    (`t c d m g p u y e h o r s a`). The rule previously accepted only
    `c n p h t` — flagging nine legal classes (`.80d` discrete, `.03e`
    electron, `.70u` photonuclear, deuteron/triton/helion/alpha tables, …) as
    invalid while accepting `n`, which is not a class at all. Library
    identifiers may be 2-**or-more**-digit integers (§1.2.3 — `1001.810h` is a
    real proton table). Plain decimals such as a `12345.6` coordinate are no
    longer mistaken for ZAIDs; inside a material card a truncated identifier
    (`92235.71`, class letter missing) is still flagged.
  - `REC` (10 or 12 entries, §5.3.4.6) and `ARB` (exactly 30, §5.3.4.10) were
    missing from the macrobody parameter-count table, so wrong counts passed
    silently. Counts are now taken across continuation lines — an `ARB`'s 30
    entries never fit on one card image, and the old per-line count would have
    flagged every correctly written `ARB`.
  - Per-cell "missing `imp:n`" warnings are suppressed when the deck carries a
    data-block `IMP:P x1 x2 … xK` card (§5.12.1) or cell-based weight windows
    (`WWN`), both of which make per-cell entries unnecessary — and any
    `imp:<particle>` on the cell now satisfies the check (a `mode p` problem
    carries `imp:p`, not `imp:n`).
- **MCNP grammar**: ZAID/thermal-library highlighting accepts all Table B.1
  class letters and 3+-digit library identifiers; particle designators now
  include `d`/`t`/`s`/`a` (deuteron, triton, helion, alpha) and comma lists.

## [1.1.2] — 2026-08-02

### Changed

- **The OpenMC palette now recolors the whole API surface, so switching palettes is
  actually visible.** Previously only `openmc.*`-anchored names were colored (module,
  submodule, class, function) — a handful of tokens per screen in a real deck, which made
  the four palettes look nearly identical in practice. The injection grammar and the
  Pylance-proof decorator now also color well-known OpenMC **method calls on any
  receiver** (`fuel.add_nuclide`, `mat.set_density`, `mats.export_to_xml`, …) and
  **attributes** (`settings.batches`, `cell.temperature`, `cell.fill`, `lat.pitch`,
  `tally.scores`, …), from curated API name lists. Attributes are a new token role with
  its own hue per palette (Classic light-blue, Solarized teal, High Contrast magenta,
  Pastel periwinkle). The palette preview cards show the richer sample.

### Fixed

- **The 3D preview now draws the core baffle as thin plates hugging the stepped core
  outline** — in all four deck languages (MCNP, OpenMC, Serpent, SCONE). Baffle universes
  at peripheral lattice positions previously rendered as full-height square posts (MCNP)
  or a belt of assembly-wide blocks at the wrong height (OpenMC), nothing like the real
  stepped SS304 plate ring OpenMC's own plotter shows. The parsers now detect which
  neighbors of each reflector cell are fuel assemblies and emit thin rectangular plates
  (plus L-shaped corner pieces on diagonal steps) on the core-facing edges, at the real
  plate band read from the deck's px/py plane offsets (BEAVRS: 8.367–10.589 cm from the
  cell centre) with a proportional fallback. Serpent and SCONE gained baffle-universe
  detection (steel cells on x/y planes, no cylinders); their baffles previously didn't
  render at all.
- **Neutron-shield pads render as arc segments on the shield ring** instead of four
  floating boxes at 45°/135°/225°/315°. New `arc` primitive (annular sector) in the
  preview IR and webview; boxes remain for grid sleeves and baffle plates, which are now
  true rectangles (`halfX`/`halfY`) rather than squares only.
- **OpenMC full-core structure height**: baffle/structure boxes in a resolved
  programmatic core used the raw text-scan height (40 cm default) instead of the
  reconstructed column extent, so they floated as a short belt at mid-plane. They now
  span the same height as the radial shells.

## [1.1.1] — 2026-08-02

### Added

- **The OWEN menu now appears on PHITS and OpenMC XML files.** The right-click and
  editor-title OWEN menus were gated to MCNP / Serpent / SCONE / Python and never showed on
  the file types added in 1.1.0. They now also appear on `phits` files and on OpenMC XML
  inputs (`materials.xml`, `geometry.xml`, `settings.xml`, `tallies.xml`, `model.xml`,
  including prefixed names like `pin_model.xml`). Deck-workflow entries (Validate, Run,
  Sweep, 3D Preview, Convert, Insert Material) stay hidden where they don't apply; the
  universal entries (ALLEN, Input Builder, Prebuilt Models, Results, Highlight Palette,
  ReactorMC search, Reactor Library) are available everywhere OWEN is.
- **Custom highlight palette.** Every `owen.highlight.<language>.palette` setting (and the
  `Choose Highlight Palette` picker) now offers **Custom**: define your own colors per token
  role in `owen.highlight.customColors` — a hex string (`"keyword": "#FF9100"`) or an object
  with a font style (`"comment": {"foreground": "#6A9955", "fontStyle": "italic"}`). Roles you
  leave out fall back to the Classic color, so a partial config renders sensibly. Edits to the
  setting re-color live, including the Pylance-proof OpenMC decorations.

### Changed

- **The OpenMC palettes are now visually distinct.** Python decks only surface four token
  roles, and the built-in palettes differed mostly by saturation within the same hue families —
  so Classic, High Contrast, and Pastel looked nearly identical on an OpenMC file. Each
  OpenMC palette now uses its own hue family (Classic blue/teal · Solarized olive/blue/magenta ·
  High Contrast orange/yellow/green/cyan · Pastel lilac/rose/mint/peach). Other languages'
  colors are unchanged.
- **README acknowledgements** now credit the optional adapter backend's upstreams
  (`openmc_mcnp_adapter`, `openmc_serpent_adapter`, both MIT © OpenMC contributors) alongside
  OpenMC itself.

## [1.1.0] — 2026-08-02

Feature release: OpenMC XML validation, PHITS language support, and the official OpenMC
adapters as an optional second-opinion convert backend. No breaking changes.

### Added

- **OpenMC XML validation.** Live diagnostics on `materials.xml`, `geometry.xml`, `settings.xml`,
  `tallies.xml`, and single-file `model.xml` (recognized by root element, so renamed exports
  validate too): duplicate ids, GNDS nuclide-name format (`U235`, not `92235.80c`), density
  units, `ao`/`wo` conflicts, MCNP-style `<sab>` names, surface and boundary types, region →
  surface references, cell → material references (cross-checked against a sibling
  `materials.xml`), `inactive < batches`, run modes, and tally → filter references.
- **PHITS language support (highlighting + snippets).** New `phits` language id (`.phits`,
  `phits.inp`) with a TextMate grammar written from the PHITS 3.36 manual — `[Section]` headers
  (tally sections styled separately), all four comment forms (`$` anywhere, `!`, `#` followed by
  whitespace, `c` in the first five columns), `#N`/`#(…)` cell complements kept distinct from
  `#` comments, `infl:`/`set:`/`qp:`/`q:` directives, `MAT[n]`/`Mn` materials, surface
  mnemonics, particle names, and `c1`–`c999` / `%var%` user variables. Snippets: starter deck,
  `[Parameters]`, `[Source]`, `[Material]`, `[T-Track]`, `infl:`. No validator claims — PHITS
  diagnostics are deliberately out of scope until they can be held to the same bar as MCNP's.
- **Official OpenMC adapter backend.** `OWEN: Convert to OpenMC XML (openmc adapters)` runs the
  OpenMC team's own MIT-licensed converters — `openmc_mcnp_adapter` for MCNP decks,
  `openmc_serpent_adapter` for Serpent decks — through your Python (same interpreter discovery
  as Render with OpenMC, WSL included) as a second opinion next to OWEN's built-in converter.
  The result message is explicit about the adapters' scope: geometry + materials only, source
  and tally definitions ignored, placeholder settings from the MCNP adapter (40 batches, point
  source at the bounding-box centre). The adapters are not bundled — when missing, OWEN offers
  the pip install command to copy. Measured comparison against OWEN's converter (pin cell,
  17×17 assembly, BEAVRS full core): `docs/ADAPTER_COMPARISON.md`.
- **OpenMC depletion snippets.** `omc_deplete` (CoupledOperator + PredictorIntegrator with
  volume/depletable reminders) and `omc_deplete_results` (k-eff history + nuclide inventories
  from `depletion_results.h5`).
- **New OpenMC rules.** `openmc.sab-name` warns when `add_s_alpha_beta()` gets an MCNP table id
  (`lwtr`) instead of a `c_` name; `openmc.density-units` catches units OpenMC rejects.
- **New MCNP rule: `mcnp.short-continuation`.** MCNP card names may start anywhere in columns
  1–5; only a line whose first five columns are all blank continues the previous card. A
  material continuation indented 1–4 spaces is therefore read by real MCNP as a new (unknown)
  card — a fatal error — and the bundled 17×17 assembly deck had exactly this (see Fixed).

### Fixed

- **Removed the false `openmc.mat-temperature` error.** `openmc.Material(temperature=…)` is a
  documented, valid signature (OpenMC's own `openmc.model.borated_water()` uses it); temperature
  precedence is cell > material > `Settings.temperature['default']`. The rule flagging it as an
  error shipped through v1.0.6 and is gone; the ReactorMC browser port never carried it.
- **Two latent bugs in the bundled prebuilt MCNP decks**, both found by running the official
  adapter over them as an independent audit (details in `docs/ADAPTER_COMPARISON.md`):
  `assembly_17x17_mcnp.i` had the `m3` continuation indented to column 5 (real MCNP reads it as
  an unknown card and fatals; the adapter silently dropped Zr94 + Zr96), and
  `beavrs_fullcore_mcnp.i` cell 61 had an empty geometry specification (only legal for
  `like n but` cells) — now the standard infinite-cell idiom `-3:3`.

## [1.0.6] — 2026-07-29

Patch release. The OpenMC palette drawn in 1.0.4 was still invisible, and both Marketplace
badges had gone dead. No breaking changes.

### Fixed

- **The OpenMC palette still did nothing, for a second and different reason.** 1.0.4 correctly
  identified that Pylance's semantic tokens outrank the injection grammar, and correctly moved to
  editor decorations to get above them. What it missed is that a decoration's color is not
  automatically stronger than a token's. VS Code emits the token color as
  `.monaco-editor .mtk7 { color: … }` and the decoration color as
  `.monaco-editor .ced-<key>-1 { color: … }` — two class selectors under one element selector, so
  identical specificity, so the winner is whichever stylesheet the browser saw last. The token
  stylesheet is rebuilt whenever `editor.tokenColorCustomizations` changes, and OWEN rewrites that
  setting on every palette change, so OWEN reliably lost the race to itself.

  The decoration now carries `color: … !important`, smuggled through `textDecoration` because that
  is the one decoration property VS Code passes to CSS verbatim. An important declaration beats a
  normal one at any specificity, which takes stylesheet ordering out of the picture entirely. The
  decorator also refreshes on a color-theme change, since that rebuilds the same stylesheet.

  Verified by inspection of the shipped bundle and by running the token scanner over a real
  40 KB full-core OpenMC deck (156 tokens, correctly scoped). Not verified visually on this
  machine: launching a second VS Code instance to screenshot the result failed because a pending
  update holds the `vscode-updating` mutex.

- **Both VS Marketplace badges rendered as "retired badge".** shields.io retired its entire
  `visual-studio-marketplace` badge family, so the version and install-count badges had become grey
  placeholders reading `retired badge` — which mattered more than it normally would, because 1.0.5
  had deleted the README's hardcoded version line on the grounds that those badges reported the
  live version. For a release and a half the listing had no working version indicator at all. Both
  now come from `vsmarketplacebadges.dev`, which returns live data; Open VSX, release and license
  badges were unaffected.

### Changed

- The listing's "See it in action" section now shows what the current build does. The superseded
  Serpent 3D clip is replaced by a full BEAVRS core from a SCONE deck expanding to 1.2 M primitives
  with its real 36-level axial stack, and two features that had no media at all are shown: geometry
  verification through a local OpenMC install (five overlap planes, magenta overlap pixels), and the
  side-by-side palette preview.

## [1.0.5] — 2026-07-27

Documentation-only release. The Marketplace and Open VSX listings render `README.md`
from the published package, so a stale line in it can only be corrected by publishing.

### Fixed

- The listing said "Current release: v1.0.3" while serving 1.0.4. The line is gone —
  the version badges at the top of the README already report the live version on each
  registry, so there is nothing left to fall out of date. The VSIX install snippet
  likewise no longer hardcodes a version number.

## [1.0.4] — 2026-07-26

Patch release — the OpenMC highlight palettes now actually take effect. No breaking changes.

### Fixed

- **OpenMC palettes had no visible effect on most machines.** OWEN colored OpenMC through an
  injection grammar into `source.python` plus `editor.tokenColorCustomizations`. VS Code resolves a
  *semantic* token's color from the scopes its **type** maps to, so with a Python language server
  installed `openmc.Material` arrives from Pylance as a `class`, resolves against
  `entity.name.type.class`, and the injection grammar's `support.class.openmc` is never consulted.
  Switching palettes changed the settings and the preview panel while the editor stayed put.

  The palette is now also drawn as editor decorations, which render above both the TextMate and
  semantic layers. The scanner behind them matches the injection grammar's four patterns and their
  precedence exactly, so a machine without Pylance sees the same colors; `npm run verify:openmc-tokens`
  keeps the two in step. Comments and strings are excluded, as the grammar's `-comment -string`
  selector already did.

- **Weight fractions printed in scientific notation.** `fmtFrac` compared the signed value against
  its `1e-3` threshold, and weight fractions are negative by MCNP convention, so every one of them
  took the branch meant for trace constituents: `-1.1100e-1` where the same atom fraction printed
  `0.111000`. Valid MCNP either way, but inconsistent and hard to read.
- **`openmc.Source()` was reported as an error saying it is "removed".** It is deprecated, not
  removed — still a working alias for `IndependentSource` — so the deck runs. Now a warning, worded
  accordingly.
- **`npm test` could not run.** Vendoring `packages/mcnp-workspace` into the repo moved tsc's
  inferred `rootDir` to the repo root, so compiled tests landed in `out/src/…` while the harness
  looked in `out/test/…`, and the `__dirname`-relative fixture paths in nine suites went stale by a
  level — in both directions, since a couple had already been rewritten for the new layout. `rootDir`
  is now pinned, the depth is resolved once in `src/test/paths.ts`, and the PNNL dataset loader walks
  up for `data/` instead of guessing two fixed offsets. 521 tests pass.

### Added

- **`owen.highlight.openmc.decorate`** (default `true`) — turn the decoration layer off to leave
  Python files entirely to the Python extension.
- **`npm run verify:openmc-tokens`** — headless check of the OpenMC token scanner, 15 cases across
  the four patterns, precedence, and comment/string masking.

## [1.0.3] — 2026-07-14

Patch release — MCNP highlighting, material auto-numbering, ReactorMC in-editor search. No breaking changes.

### Added

- **Richer MCNP syntax highlighting:** line-context rules for cell/surface/macrobody lines, material vs `mt` cards, tallies, particle suffixes (`:n`), thermal libraries, and geometry `#`; new palette roles `identifier` and `modifier` across all four highlight themes.
- **Auto-number MCNP materials on insert:** NRDP, PNNL, and Input Builder material wizards assign the next free `mN` (and `mtN`) from the open deck.
- **ReactorMC search panel:** `owen.openTutorial` opens an in-editor search webview over bundled (and optional live) ReactorMC index — tutorials, NRDP, reactors, and site tools open on reactormc.net.

### Changed

- Command title: **OWEN: Search ReactorMC (Tutorials & NRDP)** (was Open Tutorial).

### Fixed

- **`@belvoirdynamics/mcnp-workspace` paths** for standalone `caalh/owen` builds (`packages/mcnp-workspace` inside the repo, not a sibling monorepo path).

## [1.0.2] — 2026-07-08

Patch release after **1.0.1** — integrated visual lattice editor inside Input Builder. No breaking
changes.

### Changed

- **Input Builder — integrated Lattice tab:** full visual grid editor (paint pin types, W 17×17 / BWR
  presets, editable identifiers) lives inside Input Builder → Snippet Wizards → Lattice. Preview,
  validation, and insert use the same pipeline as other wizards. `owen.openLatticeBuilder` now opens
  Input Builder focused on the Lattice tab (shortcut alias; separate webview removed from command path).
- Full Deck lattice assembly uses the shared lattice map state from the integrated editor.

## [1.0.1] — 2026-07-08

Patch release after **1.0.0** — Input Builder snippet wizards and MCNP cross-file workspace
validation. No breaking changes.

### Added

- **MCNP workspace validation (v1):** shared `@belvoirdynamics/mcnp-workspace` package;
  LSP merges cross-file diagnostics when `owen.mcnp.projectRoot` is set; **Set MCNP Project
  Root** command; settings `owen.mcnp.workspaceValidation.enabled` / `.warnUnused`.
- **Tests:** `workspaceValidation.test.ts` — 2 integration tests against shared fixtures.
- **Input Builder — Snippet Wizards:** Material (atom/weight density + fraction modes, S(α,β) picker
  with hydrogen-only guard), Surface (RCC pin, RPP box, sphere), Cell (boolean intersection/union),
  Lattice (square + hex stub), Source (kcode/ksrc), Settings (per-code run blocks).
- **Input Builder UX:** searchable template library, recent templates (persisted), validation preview
  before insert/new-file, `Ctrl+Shift+I` / `Cmd+Shift+I` keybinding.
- **Tests:** `wizards.test.ts` — 12 new unit tests for wizard card generators and snippet validation.

## [1.0.0] — 2026-07-06

OWEN graduates to **1.0.0** — the first stable major release. Everything shipped across the
0.3.x line is now treated as production-ready: the Monte Carlo language server, full-core 3D
geometry preview, native OpenMC render and verify, ALLEN Doppler Studio, Results Viewer,
parametric sweep dashboard, PNNL-15870 compendium (411 materials), adversarial-hardened
validation, and bundled BEAVRS teaching models.

### Changed

- **Version bump 0.3.10 → 1.0.0** — OWEN is no longer framed as beta or early access.
- **MCNP ↔ OpenMC converter promoted to stable** — the hi-fi engine (boolean region AST,
  multi-level universes, rect/hex lattices, transforms, graveyard handling, tally/source
  mapping) passed the BEAVRS full-core gauntlet in real OpenMC. UI labels, Rosetta diff
  badge, and generated deck headers no longer say "beta". Known limitations (tally gaps,
  complex TR transforms, procedural OpenMC scripts requiring trace review) remain documented
  via `TODO(owen-convert)` markers — honest caveats, not a beta disclaimer.
- **MCNP → Serpent / SCONE** and **Community Library** (Supabase opt-in) stay
  **experimental**.

### Notes

- VSIX built locally; VS Code Marketplace / Open VSX publish deferred to the maintainer
  (live listing remains v0.3.1 until published). GitHub Release **v1.0.0** ships the VSIX.

## [0.3.10] — 2026-07-02

Marketplace metadata refresh — no code changes. The published 0.3.1 listing describes a
feature set that is now many releases stale; this release makes the `description`,
`README.md`, and keywords packaged inside the VSIX describe the current extension, so the
VS Code Marketplace and Open VSX listings will be accurate on next publish.

### Changed

- **`package.json` description** rewritten to cover the 0.3.x feature set: MC Language
  Server with real-time physics-aware diagnostics, native OpenMC rendering and geometry
  verification, cross-code converter (MCNP↔OpenMC beta), Results Viewer, parametric sweep
  dashboard, PNNL-15870 compendium (411 materials), and ALLEN Doppler Studio.
- **Keywords** expanded 9 → 16 (added `language-server`, `3d`, `pnnl`, `cross-sections`,
  `k-eff`, `criticality`, `beavrs`) — still well under the Marketplace's 30-tag cap
  including vsce auto-tags.
- **README** restructured: the flat features table is now grouped into Write / Build /
  Visualize & verify / Run & analyze sections, adding the rows that post-dated the last
  README pass — MC Language Server, Verify Geometry with OpenMC, Results Viewer, sweep
  dashboard, cross-code converter (MCNP↔OpenMC beta + Rosetta diff), Doppler Studio,
  PNNL compendium materials, and the Reflected UO2 Pin Cell prebuilt models. The commands
  table now lists all 19 commands; the install section drops the stale "(once published)"
  qualifier; the supported-languages table shows LSP real-time diagnostics; the
  acknowledgements add the PNNL-15870 Rev. 2 citation; NICHOLS joins Related. Demo
  GIFs/links unchanged.

### Notes

- Publishing this VSIX to the VS Code Marketplace and Open VSX is what actually updates
  the public listings — publish remains deferred to the maintainer.

## [0.3.9] — 2026-07-02

### Added

- **PNNL-15870 Rev. 2 materials compendium (411 materials)** as a second material source,
  alongside the curated featured set:
  - **Input Builder:** new searchable "PNNL Compendium" section in the Materials step
    (search by name, formula, acronym, or element symbol). The ~600 KB dataset ships as
    `data/pnnl-materials.json` and is read from disk on demand — it is never injected
    into the webview or the extension bundle. Selected compendium materials flow through
    `buildDeck` for all four codes.
  - **Insert Material command (`owen.insertMaterial`):** compendium entries appear in the
    QuickPick after the curated NRDP set, rendered for the detected deck language.
  - **Card generation** (`src/inputBuilder/pnnlCards.ts`, shared logic with
    reactormc.net and GROVES): MCNP/Serpent emit isotopic ZAIDs with negative weight
    fractions (carbon stays elemental `6000` — ENDF/B-VII.1 `.80c` has no isotopic C
    tables); OpenMC uses `add_element(..., percent_type='wo')` for natural elements and
    `add_nuclide(..., percent_type='wo')` for custom isotopics (enriched U/Pu/Li, D₂O);
    SCONE compositions are atom densities (atoms/barn-cm) with `.03` ↔ `temp 300`.
    S(α,β) thermal scattering is attached **only** to hydrogenous moderators
    (light/heavy water, polyethylene) — never to fuels or metals.
  - Citation shown wherever the data appears: PNNL-15870 Rev. 2 (April 2021),
    R.S. Detwiler, R.J. McConn Jr., T.F. Grimes, S.A. Upton, E.J. Engel, *Compendium of
    Material Composition Data for Radiation Transport Modeling*, PNNL.
    https://doi.org/10.2172/1782721 — dataset derived from the PyNE
    `materials-compendium` export (BSD-2-Clause) and spot-verified against the official
    PDF tables.
- 13 new tests (dataset sanity + spot checks, ZAID expansion, per-code card rules,
  S(α,β) allow-list, full-library render smoke, Input Builder integration).

### Changed

- Widened timing budgets on two load-sensitive test groups (huge-deck MCNP indexing:
  8 s → 30 s assert; BEAVRS axial-parity suite: 20 s → 120 s timeout). The indexing
  build takes ~4 s in isolation but was observed at 9.7–16.4 s when the host runs
  parallel workloads; the looser budgets still catch complexity regressions (an
  O(n²) blowup takes minutes) without flaking under contention.

## [0.3.8] — 2026-07-02

High-fidelity MCNP↔OpenMC converter: both directions rewritten from scratch and
validated against the bundled BEAVRS full core in real OpenMC. The MCNP↔OpenMC
directions graduate from **experimental** to **beta**; Serpent/SCONE targets stay
experimental.

### Changed

- **MCNP → OpenMC (rewritten):**
  - Full boolean region AST: intersections, unions, `#cell` and `#()` complements,
    arbitrarily nested parentheses (with circular-complement detection).
  - All common surface types: `p` (4-coeff + three-point), all spheres/cylinders/cones
    (one- and two-sided via `openmc.model.*ConeOneSided`), tori, `GQ`, `SQ` (expanded to
    `openmc.Quadric`), and macrobodies `RPP`/`RCC`/`BOX`/`RHP` as `openmc.model` composites
    (composites emitted after primitives so auto-assigned internal surface ids never
    collide with explicit ones).
  - Multi-level universes and lattices: `lat=1` → `RectLattice` (window derived from the
    bounding-plane pairs, MCNP bottom-up rows flipped to OpenMC top-first, `nR` repeats,
    3D arrays, self-fill universes, `outer=` edge-majority heuristic), `lat=2` →
    `HexLattice` rings (rhombus fill arrays reduced to the largest complete centered
    hexagon), topologically sorted for nesting.
  - `trcl=`/`*trcl=` and `fill=n (…)` transforms → `cell.translation`/`cell.rotation`;
    `tmp=` (MeV) → `cell.temperature` (K).
  - Graveyard elimination: `imp:n=0` root cells removed, their bounding surfaces become
    `boundary_type='vacuum'`; `*`/`+` surfaces → reflective/periodic.
  - Materials split per (material, cell density); natural ZAIDs → `add_element`; official
    OpenMC S(α,β) names (`grph` → `c_Graphite`, etc.); metastable ZAIDs (A>300) → `_m1`…
  - `kcode`/multi-point `ksrc` → `Settings`/`IndependentSource` list; `FMESH` →
    `RegularMesh` tally; `F4/F6/F7` → cell tallies. Duplicate cell ids renumbered.
- **OpenMC → MCNP (new architecture):** a static parser handles flat literal scripts
  (everything OWEN's own converter emits plus typical hand-written decks); dynamic
  scripts (loops/functions, e.g. native BEAVRS) run through a pure-Python **trace
  harness** (stub `openmc` module, no OpenMC install needed) that captures the model as
  JSON IR; one emitter turns the IR into MCNP (region normalization via De Morgan,
  lattice windows as synthesized cards with `outer` padding, vacuum boundaries →
  synthesized graveyard, S(α,β) → `mt` cards, temperatures → `tmp=`).
- Converter UI labels: MCNP↔OpenMC picks show **beta**; Rosetta view badge is BETA for
  MCNP↔OpenMC and EXPERIMENTAL for Serpent/SCONE.

### Validated (BEAVRS gauntlet)

- MCNP→OpenMC: converted full core loads in OpenMC 0.15.3 — 327 cells / 62 universes /
  16 lattices / 13 materials; `Model.from_model_xml` round-trip OK; 4 000-point material
  sampling vs the native BEAVRS deck: 0 presence mismatches; transport smoke test runs.
- OpenMC→MCNP: native (procedural) BEAVRS script traced and emitted as MCNP; OWEN's
  extractor sees 55 851 vs 55 849 instances (+0.004%), identical outer radius/height;
  validator reports **zero Errors**.
- Round-trips (pin cell, 17×17 assembly) preserve materials, S(α,β), lattice structure,
  and settings. 52 new per-construct tests; suite total 483.

### Fixed

- `beavrs_fullcore_mcnp.i`: root cells 300/303–307 reused cell numbers already taken by
  `u=150` pins (illegal in MCNP; broke any strict importer) — renumbered to 343–348.

## [0.3.7] — 2026-07-02

Hardening release: all 15 bugs found by an adversarial test audit (run against v0.3.4)
are fixed, and the audit's 180-test adversarial suite is now part of the shipped test suite.

### Fixed

- **Crash-level (extension-host OOM/hang from a single malformed deck):**
  - MCNP repeat expansion (`fill= 1 2000000000r`) is now capped at 1M entries in both the
    3D-preview extractor and the references index (which rebuilds on every edit, so this
    was reachable just by typing).
  - Self-referential and mutually-referential MCNP lattices (`u=5` whose fill contains 5,
    or 5↔6) no longer recurse exponentially: cycle detection via an ancestor set in
    `countPins`/`placeUniverse`. Same fix for Serpent lattices.
  - SCONE `shape (100000 100000 1)` and Serpent giant `lat` headers
    (`1000000000 1000000000`) no longer allocate unbounded grids: lattice size capped at
    5M cells; Serpent rows are additionally capped to the data actually present.
- **Wrong-result:**
  - `mcnp.material-sign` validator rule no longer fires false Errors on valid decks
    (including bundled BEAVRS): the fraction matcher no longer partially matches ZAIDs
    like `40000.80c`, and the active-material context is cleared when any new card starts
    (previously `fmesh4:n origin=-182.78` after an `m` card was read as a negative fraction).
  - MCNP cells with negative universe IDs (`u=-5`, valid MCNP notation) are now keyed by
    `abs(u)` so `fill=5` finds them in the 3D preview.
  - OpenMC pitch detection no longer reads `pitch = 999` out of `#` comments.
  - Results parsers (all four codes) and the sweep k-eff scrapers now require a proper
    numeric token — dots-only garbage (`KEFF = ...`, `k-eff = .`) and multi-dot strings
    (`1.2.3`) no longer surface as `k-eff = NaN` or silently truncated values; non-finite
    samples are dropped at aggregation.
  - Input Builder: generating an OpenMC deck with no materials selected no longer emits
    literal `fill=undefined` Python; custom material names containing `'` or `\` no longer
    break the generated Python string (sanitized to safe lookalikes).
- **Cosmetic:**
  - ALLEN `bondarenkoShieldingFactor` no longer returns values above 1 for tiny σ₀/σ
    (catastrophic cancellation in `log(1+t)/t`) — now `log1p(t)/t`, clamped to [0, 1].
    Fixed in both the plot config and the webview copy.
  - `src/test/fixtures/sample_openmc.log` renamed to `.log.txt` so fresh clones of the
    public repo (where `*.log` is gitignored) pass the test suite.

### Added

- **Adversarial test suite** ported from the audit into `src/test/suite/adv.*.test.ts`
  (~180 tests): extractor edge cases for all four codes, validator false-positive
  regressions (including a zero-Errors assertion over every bundled prebuilt deck),
  results-parser garbage inputs, input-builder hostile names, ALLEN plot math edge cases,
  measurement math, LOD budget, and bounded "hang bomb" repros for every crash bug above.

## [0.3.6] — 2026-07-02

Prebuilt-model quality release: every bundled deck audited for syntax/physics
correctness, and a new **Reflected UO2 Pin Cell** teaching model added in all
four codes.

### Added

- **Reflected UO2 Pin Cell** prebuilt model in MCNP, OpenMC, Serpent, and SCONE — the
  classic "hello world" geometry: one BEAVRS-spec 3.1 wt% fuel pin (pellet 0.39218 /
  clad 0.40005–0.45720 cm, pitch 1.26 cm, active height 365.76 cm) in 975 ppm borated
  water with reflective boundaries on all six faces, so the run converges to the
  infinite-lattice k-inf. All four decks model the SAME system with the verified BEAVRS
  number densities. The OpenMC twin is **run-verified**: k-inf 1.2256 ± 0.0010 (OpenMC
  0.15.3, ENDF/B-VIII.0, 600 K neutron data); the other three are spec-derived with the
  reference k-inf documented in their headers.
- Extractor regression tests: all four pin-cell decks plus the three 17×17 assembly decks
  now render headlessly in the test suite (fuel/clad shells, full lattices, guide tubes).

### Fixed

- **MCNP decks (both BEAVRS full-core and 17×17 assembly): `ksrc` sat in the instrument
  tube** — the exact core/assembly centre `(0, 0)` is air, and MCNP rejects initial source
  points in non-fissile cells, so the shipped kcode runs would die immediately. Moved one
  pin pitch off-centre into a fuel pin (`1.26 0 …`).
- **MCNP decks: lines over 80 columns** (long comments, core-lattice fill rows) reformatted
  to satisfy the fixed-format MCNP5 line limit the LSP itself enforces.
- **17×17 Serpent assembly: invalid `therm lwtr 600 lwj3.11t`** — the temperature-
  interpolation form of the `therm` card requires TWO bracketing libraries; with a single
  library Serpent errors out. Switched to the direct form (`therm lwtr lwj3.11t`), matching
  the full-core deck.
- **17×17 OpenMC assembly: only 21 of the advertised 25 guide/instrument tube positions**
  were placed (the four (3,3)/(3,13)/(13,3)/(13,13) corner guide tubes were missing), and
  guide tubes were water-only with no Zr tube wall. Both fixed (also in the
  `omc_assembly_script` snippet the deck is derived from); comment typo
  `model.model.RectangularPrism` corrected.
- **Line endings: all bundled decks normalized to LF** and pinned with a
  `prebuilt-models/.gitattributes` (`* text eol=lf`). SCONE hard-requires UNIX newlines —
  the shipped SCONE full-core deck had CRLF.
- 17×17 MCNP assembly: misleading "borated water" comment (the material is unborated
  light water) corrected.

## [0.3.5] — 2026-07-01

Four roadmap items in one release: a real **Language Server** for the Monte Carlo languages,
a promoted **cross-code converter** with a Rosetta diff view, **geometry verification** through
OpenMC, and a **sweep results dashboard**.

### Added

- **MC Language Server (LSP)** for MCNP, Serpent, and SCONE. Diagnostics are now real-time
  (on-type, debounced) instead of on-command: all previous validator rules plus MCNP
  line-length and new **cross-reference diagnostics** — a cell referencing an undefined
  surface/material/universe/transform is an error; defined-but-never-referenced entities are
  faded hints. Hover, go-to-definition, find-references, occurrence highlight, and a grouped
  document outline (Cells / Surfaces / Materials / Universes / Transforms / Tallies) are served
  over LSP. The server ships as a self-contained `out/server.js` and can be reused by other
  editors (Sublime LSP, Neovim) over stdio — see `docs/LSP_DESIGN.md`. OpenMC Python files
  keep Pylance plus OWEN's manual validate command.
- **`OWEN: Convert Deck… (Experimental)`** (`owen.convertDeck`): the previously hidden
  MCNP↔OpenMC converter is now a visible command with a source→target picker, and grows two new
  targets: **MCNP→Serpent** and **MCNP→SCONE** for the cleanly-mappable subset (cyl/plane/
  sphere/RPP/RCC surfaces, cells, materials with per-code nuclide mapping, square lattices).
  Anything that can't convert emits a clearly marked `TODO(owen-convert)` comment instead of
  being dropped. Results open in a **Rosetta diff** webview: source and converted deck
  side-by-side with aligned cells/surfaces/materials sections and TODO highlights.
- **`OWEN: Verify Geometry with OpenMC`** (`owen.verifyGeometry`): for OpenMC decks, runs the
  model through the locally installed OpenMC (reusing 0.3.4's interpreter discovery and WSL
  handling) and checks for **overlapping cells** (slice plots with `show_overlaps=True` at
  several sampled planes, red overlap pixels counted) and **lost particles** (a short capped
  probe run). Results panel shows per-plane images with overlap highlights, the lost-particle
  report, or a green all-clear with the honest caveat that sampled planes ≠ proof.
- **`OWEN: View Sweep Results`** (`owen.viewSweepResults`): dashboard for completed parameter
  sweeps — k-eff vs swept parameter with error bars (uPlot), per-run convergence
  small-multiples, and a run table, aggregated from `sweep-manifest.json` plus each run's
  outputs via the `src/results/` parsers.

### Changed

- `OWEN: Validate Input File` remains for on-demand checks (and is still the diagnostics path
  for OpenMC Python files); MCNP/Serpent/SCONE diagnostics now update live via the LSP.
- The VSIX now contains two bundles: `out/extension.js` and `out/server.js`.

### Notes

- Marketplace/Open VSX publish deferred to maintainer. VSIX: `owen-neutronics-0.3.5.vsix`.
- Converter coverage is deliberately partial (documented per-construct with TODO markers) —
  experimental labeling stays.

## [0.3.4] — 2026-07-01

**Render with OpenMC (authoritative)** — native OpenMC renders of your model, inside the editor.

### Added

- **`OWEN: Render with OpenMC (authoritative)`** (`owen.renderWithOpenmc`, editor title/context
  menus for OpenMC Python files): runs your model through the locally installed OpenMC and shows
  its native slice plots in a webview — basis (xy/xz/yz), origin, width, material/cell coloring,
  and an optional **3D ray trace** when the installed OpenMC supports it (≥ 0.15). Every image
  comes from OpenMC's own geometry kernel, so it is the ground truth for verifying OWEN's built-in
  3D preview or debugging geometry. Each control change re-runs OpenMC (spinner shown; not
  real-time). The built-in preview remains the default interactive renderer.
- **Automatic interpreter discovery**: probes, in order, an explicitly set
  `owen.openmc.pythonExecutable`, the ms-python extension's active interpreter, `python`/`python3`
  on PATH, and (on Windows) Python installs under **WSL** — including common conda locations —
  verifying each with a real `import openmc` before use. Paths are translated with `wslpath` when
  the interpreter lives in WSL.
- **Safe deck execution**: the render helper monkey-patches `openmc.run` / `Model.run` to no-ops
  before executing the deck, so models that end in `model.run()` render without starting a
  transport run; decks that only export XML (no in-memory `Model`) are rendered from the XML.
- If OpenMC is not detected anywhere, the command says so and opens the built-in 3D Geometry
  Preview instead.
- README: OpenMC (MIT) attribution in a new Acknowledgements section; panel footer carries the
  same notice.
- Unit tests: `openmcNative.test.ts` (interpreter ordering, probe protocol, WSL discovery/path
  translation, helper-script generation, result parsing); **157** total OWEN tests green.

### Fixed

- The packaged VSIX now includes `h5wasm`, so the Results Viewer's `statepoint.h5` parser works
  in installed builds (the 0.3.3 VSIX shipped without it and silently fell back to stdout
  parsing). VSIX size grows to ~4.2 MB as a result.

### Notes

- Marketplace/Open VSX publish deferred to maintainer. VSIX: `owen-neutronics-0.3.4.vsix`.
- Verified end-to-end on Windows with OpenMC 0.15.3 under WSL (conda at `/opt/miniconda3`).

## [0.3.3] — 2026-06-29

Strategy memo **Bet 1 + Bet 2**: Doppler Studio in ALLEN webview and Cross-Code Results Viewer.

### Added

- **Doppler Studio** in ALLEN panel: multi-temperature overlay (294/600/900/1200 K), resonance
  integral readout, Bondarenko σ₀ self-shielding slider, ∂σ/∂T mini-plot helpers in
  `plotConfig.ts`.
- **`OWEN: View Results`** (`owen.openResults`): webview with k-eff convergence (uPlot), flux
  spectrum (log-log), tally table, mesh heatmap; auto-detects outputs in the simulation work dir.
- **`src/results/`** parsers for OpenMC (statepoint.h5 via h5wasm + stdout fallback), MCNP mctal,
  Serpent `_res.m`, SCONE `.out`.
- **3D mesh overlay**: Results Viewer can post mesh tallies to the geometry preview as a colored
  axial slice plane.
- Unit tests: `results.test.ts` (4 parser fixtures + Doppler math); **141** total OWEN tests green.

### Notes

- Marketplace/Open VSX publish deferred to maintainer. VSIX: `owen-neutronics-0.3.3.vsix`.

## [0.3.2] — 2026-06-28

Consolidated release on top of 0.3.1, bundling the **Input Builder** wizard, a fix for MCNP
cross-reference false highlights, and a rebuilt **ALLEN σ(E)** cross-section plot. (This release was
renumbered down from the unpublished 0.4.0/0.4.1/0.4.2 dev versions — none of those reached the
Marketplace; the published timeline is 0.3.1 → 0.3.2.)

### Added

- **`OWEN: Open Input Builder`** (`owen.openInputBuilder`) — integrated five-step wizard (code,
  materials, geometry, settings, preview) that assembles starter MCNP / OpenMC / Serpent / SCONE
  decks, with **Insert at Cursor** / **New File**.
- **`src/inputBuilder/materials.ts`** — 18 NRDP-aligned reactor materials with per-code renderers
  (MCNP `m`/`mt`, OpenMC `Material`, Serpent `mat`, SCONE blocks).
- **`src/inputBuilder/deckBuilder.ts`** — assembles pin-cell or lattice starter decks; lattice mode
  reuses `latticeCodegen.ts`.
- Headless unit tests for material codegen and deck assembly (`inputBuilder.test.ts`); BEAVRS MCNP
  extractor test now asserts baffle **box** count > 0.

### Fixed

- **MCNP cross-reference highlights & Find All References** no longer fall back to matching every
  occurrence of a digit (Ctrl+F-style) instead of the role-aware entity under the cursor:
  - **`McnpDocumentHighlightProvider`** always returns a highlight array (never `undefined`) so VS
    Code does not fall through to its built-in word-occurrence highlighter.
  - **`McnpReferenceProvider`** returns `[]` instead of `undefined` when the cursor is not on a
    referenceable entity, blocking text-search fallback on Shift+F12.
  - **`configurationDefaults`** sets `"[mcnp]": { "editor.occurrencesHighlight": "singleFile", "editor.selectionHighlight": false }` so OWEN's role-aware `DocumentHighlightProvider` runs without VS Code's parallel word/selection highlighter.
  - MCNP **`wordPattern`** no longer classifies bare integers as editor words (eliminates digit fallback).
  - New **`getHighlightOccurrences`** / **`entityAtPosition`** helpers; expanded disambiguation tests
    (digit 3 as cell / material / surface / universe; lattice `fill=` universe IDs).
- **ALLEN σ(E) cross-section plot** in the OWEN webview is rebuilt — the log-log chart now uses
  native uPlot log scales with clean power-of-ten decade labels, a compact legend, a tidy hover
  readout, and curves that end at their real energy bounds instead of dropping to ~0:
  - **X-axis labels** were garbled (`10^5000000…` run-on) because the x data was raw energy fed to a
    `10^exponent` formatter. The plot now uses a native log scale (`distr: 3`) with a power-of-ten
    decade formatter, so ticks read `10⁻⁵ … 10⁰ … 10⁷ eV`.
  - **Y-axis labels** (`0^-5`, `0^-10`) lost their leading `1` and clipped. Now rendered as proper
    Unicode powers of ten (`10⁻³ … 10⁵ b`) with a wider axis gutter so nothing clips.
  - **Legend** no longer shows uPlot's stacked `Value: --` block (built-in legend disabled). A single
    compact custom legend lists one swatch + label per active series.
  - **Header readout** no longer defaults the cursor energy to `Infinity` or runs every series value
    together; it shows `E = … eV` plus only the series with data at the cursor, and resets when the
    cursor leaves the plot.
  - **Right-edge cliff** removed: curves are resampled onto a unified energy grid in log-log space and
    return `null` outside each curve's real `[Emin, Emax]` (no `1e-30` floor), so lines end cleanly.
  - Proper axis titles ("Neutron energy (eV)", "Cross section (barns)"), gridlines, and dark-theme
    margins. New unit tests (`allenPlot.test.ts`) cover the resampling and tick-label logic.

### Changed

- Editor title / context OWEN menus list Input Builder ahead of Lattice Builder.

## [0.3.1] — 2026-06-28

BEAVRS **radial structure** in the 3D preview: barrel, neutron-shield pads, downcomer, RPV liner/RPV, and peripheral baffle boxes.

### Added

- **`src/preview/radialStructure.ts`** — shared annular/box/wedge emitters for MCNP, OpenMC, Serpent, and SCONE parsers.
- MCNP baffle universes (px/py SS304 plates) render as thin **box** prisms at peripheral lattice positions.
- OpenMC `BAF["…"]` entries resolve to structure nodes instead of silent skips.
- Headless tests assert BEAVRS MCNP/OpenMC extracts include radial structure primitives.

### Changed

- Vessel shells are now **annular** (inner/outer radius) where the deck defines cz pairs, not full-disc overlays.

## [0.3.0] — 2026-06-28

First-class **ALLEN** (Atomic Library Linking Evaluated Nuclear-data) integration — in-editor σ(E) plots linked to the NRDP ENDF/B-VIII.0 bundle.

### Added

- **`OWEN: Open ALLEN Cross-Sections`** (`owen.openAllen`) — webview panel with uPlot log-log σ(E) charts, nuclide/reaction/temperature pickers, hover readout, and coverage notices for missing manifest entries.
- **Context-aware nuclide detection** from MCNP `m` cards (ZAIDs), OpenMC `add_nuclide`, Serpent/SCONE decks; defaults to U-235/U-238 teaching preset when none found.
- **Setting `owen.allen.dataBaseUrl`** (default `https://reactormc.net/data/allen`) for offline or local NRDP dev overrides.
- Command palette, editor title OWEN submenu, and right-click OWEN context menu entries for ALLEN.

## [0.2.9] — 2026-06-27

Fix the OpenMC 3D-preview axial fidelity so the BEAVRS full core renders at its true height with the
correct per-band structure, matching the MCNP / Serpent / SCONE cores.

### Fixed

- **OpenMC BEAVRS rendered much shorter than the other codes, missing components.** The OpenMC core
  collapsed to a ~40 cm fuel-only slab centred at z=0 (a default 2-shell pin) instead of the full
  0→460 cm assembly. Two causes: (1) the deck's radial shells live in a `_SHELLS` dict literal the
  parser couldn't read, so it fell back to a generic pin; (2) the v0.2.8 axial recovery applied one
  global band grid uniformly to every pin, so its instance estimate overflowed the budget and axial
  detail silently switched off. OWEN now statically reconstructs each pin's **real axial column** from
  the deck's `_SHELLS` / `STACKS` / `R[key]` / `make_pin` tables: every band renders its own
  concentric shells and materials — active fuel (per 1.6 / 2.4 / 3.1 % enrichment zone), Inconel grid
  spacers, the plenum spring, Zircaloy end plugs and the SS304 top nozzle now appear as distinct
  components, and the core stands at its true 0→460 cm height. This matches (and slightly exceeds, via
  grid-spacer bands) the MCNP / Serpent / SCONE renders. MCNP / Serpent / SCONE and the literal /
  NumPy OpenMC paths are unchanged.

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
