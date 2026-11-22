<h1 align="center">OWEN</h1>
<p align="center"><strong>Open Workspace for Engineered Neutronics</strong></p>
<p align="center">Created by <strong>Aaron W. Calhoun</strong></p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=belvoirdynamics.owen-neutronics"><img alt="VS Code Marketplace Version" src="https://vsmarketplacebadges.dev/version-short/belvoirdynamics.owen-neutronics.svg?style=flat&label=VS%20Marketplace&color=0b1020"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=belvoirdynamics.owen-neutronics"><img alt="VS Code Marketplace Installs" src="https://vsmarketplacebadges.dev/installs-short/belvoirdynamics.owen-neutronics.svg?style=flat&label=installs&color=f59e0b"></a>
  <a href="https://open-vsx.org/extension/belvoirdynamics/owen-neutronics"><img alt="Open VSX Version" src="https://img.shields.io/open-vsx/v/belvoirdynamics/owen-neutronics?label=Open%20VSX&color=0b1020"></a>
  <a href="https://github.com/caalh/owen/releases/latest"><img alt="GitHub release" src="https://img.shields.io/github/v/release/caalh/owen?label=release&color=f59e0b"></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-0b1020"></a>
</p>

<p align="center">A <a href="https://reactormc.net">BelvoirDynamics</a> product · part of <a href="https://reactormc.net">ReactorMC</a></p>

---

OWEN is the editor toolkit for MCNP, OpenMC, Serpent, and SCONE. Catch
cross-reference and physics mistakes as you type, hover a nuclide or an MCNP
data card for what it means, preview the geometry in 3D and show, ghost, or
hide one cell at a time, convert a deck to another code, run the solver
(including an MCNP deck through OpenMC), and read k-eff without leaving
VS Code or Cursor — and without a network connection.

## See it in action

**Cell Map of an MCNP lattice.** Root universe, the `lat=1` cell, and the three
universes it places — fuel pin, guide tube, instrument tube — with surface
senses, materials, and fill counts, so you can walk a deck the way the code
will. Click a card to jump to the card in the original file.

<p align="center">
  <img alt="OWEN Cell Map of an MCNP lattice: universe 0 fills a lattice that places 264 fuel pins, 24 guide tubes and an instrument tube" src="media/demo-cell-map.png" width="900">
</p>

**A full BEAVRS core in 3D.** OWEN draws every pin of the nested lattice. Turn
on axial segments to see fuel, plena, and grid spacers as separate layers;
peel off the vessel or slice through the core. Click a pin to hide that cell,
make it see-through, or focus it: see-through clad stays out of the way, so
the next click lands on the fuel. Scroll zooms toward whatever you point at.

Slice planes cut a wedge out of the core, and the cutaway stays in place as you orbit.

<p align="center">
  <img alt="OWEN 3D preview orbiting a BEAVRS core with slice planes cutting a wedge out of the vessel, barrel, and fuel assemblies" src="media/demo-3d-cutaway.gif" width="800">
</p>

Solo an axial layer to see one level of the core inside the vessel.

<p align="center">
  <img alt="OWEN 3D preview looking down into a BEAVRS vessel with a single axial layer of the core shown" src="media/demo-3d-inside.gif" width="800">
</p>

Set any cell solid, see-through, or hidden from the Cells list, here one fuel enrichment solid inside a see-through core.

<p align="center">
  <img alt="OWEN 3D preview of a BEAVRS core with one fuel enrichment solid and the other cells see-through" src="media/demo-3d-see-through.gif" width="800">
</p>

**Cells no primitive can draw, meshed from the exact geometry.** Three crossed
cylinders, a ball bored through on three axes, a torus cut open by a plane, a
one-sheet hyperboloid, both sheets of a cone, and a ball with six dimples, all
from one MCNP deck.

<p align="center">
  <img alt="OWEN 3D preview of six meshed MCNP cells on a plate: crossed cylinders, a drilled ball, a cut torus, a hyperboloid, a two-sheet cone, and a dimpled ball" src="media/demo-mesh-gallery.png" width="760">
</p>

**Geometry checked against your own OpenMC, not against OWEN's opinion of it.**
Overlap pixels on each sampled plane come back highlighted in magenta.

<p align="center">
  <img alt="OWEN Geometry Verification panel showing five overlap slices of a full PWR core checked through OpenMC 0.15.3 under WSL, all clear" src="https://raw.githubusercontent.com/caalh/owen/main/media/demo-verify-openmc.png" width="820">
</p>

**Five highlight palettes per code, previewed side by side before you commit.**
Click a card to apply it.

<p align="center">
  <img alt="OWEN highlight palette preview showing Classic, Solarized, High Contrast and Pastel side by side for MCNP" src="https://raw.githubusercontent.com/caalh/owen/main/media/demo-highlight-palettes.png" width="880">
</p>

**Cross sections for the nuclides in your deck.** ALLEN plots σ(E) from ENDF/B-VIII.0
on log-log axes, here U-235 and U-238 fission, capture, and elastic.

<p align="center">
  <img alt="OWEN ALLEN cross-section explorer plotting U-235 and U-238 fission, capture, and elastic cross sections from ENDF/B-VIII.0 on log-log axes" src="media/demo-allen.png" width="900">
</p>

## Features

### Write

| Feature | Description |
|---------|-------------|
| **Syntax highlighting** | Grammars for MCNP, OpenMC, Serpent, SCONE, and PHITS in five palettes (Classic, Solarized, High Contrast, Pastel, and Custom, set in `owen.highlight.customColors`). |
| **Snippets** | Ready-to-edit decks: PWR pin cell, 17×17 PWR assembly, criticality array, and shielding slab for MCNP; full OpenMC pin/assembly Python scripts plus depletion runs (`omc_deplete`, `omc_deplete_results`); SCONE fuel pin, 5×5 assembly, and shielding tutorials; PHITS starter deck, source, material, and T-Track tally blocks. |
| **MC Language Server** | A real language server for MCNP, Serpent, and SCONE: **real-time diagnostics as you type** — density-sign and fraction-sign conventions, S(α,β) thermal scattering on non-hydrogenous materials, ZAID format, macrobody parameter counts, MCNP line length, and **cross-reference errors** (a cell referencing an undefined surface/material/universe/transform is flagged; defined-but-unused entities are faded hints) — plus hover, go-to-definition, find-references, and a grouped document outline (Cells / Surfaces / Materials / Universes / Transforms / Tallies). Ships as a self-contained `out/server.js`, reusable by other editors over stdio. OpenMC Python files keep Pylance plus `OWEN: Validate Input File`. |
| **Nuclide & library hover** | Hover a ZAID and read the nuclide and what its suffix means: `92238.80c` is ENDF/B-VII.1 at 293.6 K (not VIII.0 — that is `.00c`), `.71c` is VII.0 at 600 K and wants a `TMP` card, `lwtr.20t` is H in light water from ENDF71SaB. Serpent and SCONE suffixes are explained as the temperature indices they are; OpenMC `'U235'` strings get the nuclide and the cell > material > settings temperature rule. Class letters follow Table B.1. A bare number on a `kcode` line is not read as a nuclide. |
| **MCNP card hover** | Hover `kcode`, `ksrc`, `mode`, `m`, `mt`, `tmp`, `nps`, `dbrc`, or `prdmp` for what that data card does. |
| **MCNP cross-reference tracker** | Role- and position-aware hover, Go-to-Definition, Find-All-References, occurrence highlight, and a **MCNP References** tree for MCNP decks. A number is resolved by *what it is and where it sits on the card* — cell id (1st field), material number (2nd field; `0` = void), geometry surface refs (signed entries), surface id (1st field of a surface card), `u=` universe, `fill`/`lat` (lattice fill arrays are decoded so universe references inside them resolve), `trcl`/`tr` transforms, and `mt`/`mx` material-data cards. Clicking surface `3` finds only the references to *surface 3* — never material 3, cell 3, or the digit `3` inside a `fill=` index. |
| **MCNP workspace validation** | Cross-file diagnostics when `owen.mcnp.projectRoot` is set: undefined references and duplicate IDs across included MCNP decks (`OWEN: Set MCNP Project Root`). |
| **Workspace validation (all codes)** | `OWEN: Validate Workspace` reads the files *next to* the deck and checks that they describe one model. OpenMC XML projects get the checks that matter between files — tally filter bins against the geometry's cell/material/surface/mesh ids, tally `<nuclides>` against the materials, `fill` and lattice universes, `run_mode` against source and fissile content, and `model.xml` against the separate files (OpenMC runs `model.xml` when both exist, so a stale one is an error, a newer separate file a warning). Serpent: `include` resolution, `mat`/`therm`/universe references, `set acelib`. SCONE: `aceLibrary`, materials, cells, universes. OpenMC Python: local imports and whether the exported XML is older than the script. Every language also gets a quick geometry sample (overlaps, lost points). Runs on open and save with a status-bar item; the report lists what was verified. |
| **Deep validation** | `OWEN: Validate Input File` adds code-specific checks on demand: `IndependentSource`/`RectangularPrism` API use, MCNP-style S(α,β) names, and density units (OpenMC); `cuboid` vs `rect`, `trcl`, and CLI `omp` (Serpent); `aceNeutronDatabase`, temperature-suffix matching, and `pinUniverse` radii/fills (SCONE). |
| **MCNP tally and temperature checks** | A hot-library suffix with no `TMP` card, `DBRC isos=` without `endf=`, an F4 or F7 on an unbounded cell with no `vol` or `sd`, and a tally on a universe, fill, or lattice cell without `sd`. Where the repair is unambiguous, a quick fix adds the missing graveyard or the tally `sd`. |
| **OpenMC XML validation** | Live diagnostics on `materials.xml` / `geometry.xml` / `settings.xml` / `tallies.xml` / `model.xml` (detected by root element, so renamed exports work too): duplicate ids, GNDS nuclide-name format, density units, ao/wo conflicts, MCNP-style `sab` names, surface/boundary types, region → surface and cell → material cross-references (against a sibling `materials.xml`), `inactive < batches`, run modes, tally filter references. |

### Build

| Feature | Description |
|---------|-------------|
| **Input Builder** | Snippet wizards for Material, Surface, Cell, Lattice (integrated visual grid editor with W 17×17 / BWR presets and editable identifiers), Source, and Settings — plus a searchable template library. Pick code, add materials from an 18-entry curated library or the searchable **PNNL-15870 Rev. 2 compendium (411 materials)**, pin-cell or lattice geometry, run settings, preview — then insert or open as a new file (`Ctrl+Shift+I`). The Lattice tab also opens on its own as the Lattice Builder. |
| **Materials (NRDP + PNNL)** | `OWEN: Insert Material from Database` inserts reactor materials rendered for the detected deck language — the curated Nuclear Reactor Data Project set (bundled snapshot, optional live refresh from reactormc.net) plus the full PNNL-15870 Rev. 2 compendium with correct per-code conventions (isotopic ZAIDs with weight fractions for MCNP/Serpent, `add_element`/`add_nuclide` for OpenMC, atom densities for SCONE; S(α,β) only on hydrogenous moderators). **Auto-assigns the next free `mN` (and `mtN`)** from the open deck so inserts do not collide with existing material numbers. |
| **Prebuilt models** | `OWEN: Open Prebuilt Model…` opens bundled, offline reactor decks in a new editor with the correct language. Ships the **complete BEAVRS Cycle-1 full core** (all 193 assemblies, full axial pin stacks, baffle/barrel/shields/RPV) for **all four codes** — MCNP, OpenMC, Serpent, and SCONE — plus 17×17 PWR assembly starters and a **Reflected UO2 Pin Cell** teaching model in all four codes (the OpenMC twin is run-verified: k-inf 1.2256 ± 0.0010). The SCONE full-core deck is the author-verified source of truth; the MCNP/OpenMC/Serpent decks are geometry/materials-faithful translations of it. |
| **Cross-code converter** | `OWEN: Convert Deck…` (`owen.convertDeck`) converts **MCNP ↔ OpenMC** — a high-fidelity engine with a full boolean region AST, multi-level universes and rect/hex lattices, transforms, graveyard handling, and tally/source mapping, validated against the bundled BEAVRS full core in real OpenMC — plus **MCNP → Serpent / SCONE (experimental)**. Serpent and SCONE → MCNP go through the exact-geometry model (experimental), and the remaining pairs pivot through MCNP and carry both hops' TODOs. Anything that can't be mapped emits a clearly marked `TODO(owen-convert)` comment instead of being silently dropped, and results open in a **Rosetta diff** view — source and converted deck side-by-side with aligned cells/surfaces/materials sections and TODO highlights. `OWEN: Convert to OpenMC XML (openmc adapters)` additionally drives the OpenMC team's own converters ([openmc_mcnp_adapter](https://github.com/openmc-dev/openmc_mcnp_adapter), [openmc_serpent_adapter](https://github.com/openmc-dev/openmc_serpent_adapter), both MIT) through your Python as a second opinion — they emit real `openmc.Model` XML for geometry + materials, but ignore source/tally definitions and write placeholder settings, so OWEN flags that in the result. |
| **Certify a conversion** | `OWEN: Certify MCNP conversion` goes through OpenMC, Serpent, and SCONE and says, construct by construct, whether it translated or stayed a visible TODO. `OWEN: Check MCNP to OpenMC conversion` compares the converted model with the source deck. |

### Visualize & verify

| Feature | Description |
|---------|-------------|
| **3D geometry preview** | Three.js webview (bundled, works offline) rendering of MCNP / OpenMC / Serpent / SCONE geometry with component / material / axial-layer toggles, slice planes, and a Disc/Layers fidelity control. Renders a **full BEAVRS core** (all 193 assemblies) across every code — including OpenMC cores whose lattices are built programmatically (comprehension/dict-driven assembly maps are statically expanded, no Python executed) — without dropping pins, and shows the **full axial stack** for OpenMC too — each pin is reconstructed as its real z-column from the deck's `_SHELLS`/`STACKS`/`R[key]` tables, so grid spacers, plena, end plugs and SS nozzles render with their own per-band shells/materials over the complete 0→460 cm assembly height, matching MCNP/Serpent/SCONE. Geometry is instanced (so draw calls stay low) and a configurable instance budget (`owen.preview.maxInstances`, default 1.5M) auto-simplifies detail (shells→discs, then collapses axial) instead of hiding pins when a deck is huge. **Hover** any part to read its deck cell, layer, material, axial index, radius/diameter and z-range; **solo** a layer to isolate it; make any **deck cell** solid, see-through, or hidden from the Cells list (searchable, with a per-cell focus) or by clicking it in the view; and **measure** distances (with Δx Δy Δz), included angles, and pin/shell radii directly in the view. See-through cells are skipped by hover, picking, and measuring. Slice planes can be reversed, typed to an exact position, tilted up to ±90°, and combined into a wedge cutaway; a visible-volume box limits the view on very large models; and a cell bounded by surfaces the preview cannot draw directly is meshed from the exact geometry instead of shown as a box. |
| **Ray-trace geometry** | `OWEN: Ray-trace geometry` draws an orthographic picture of the exact MCNP CSG. Click a pixel to jump to that cell card. |
| **Preflight geometry** | `OWEN: Preflight geometry` checks an MCNP deck before a run: a missing graveyard, a `ksrc` point on a surface or in the graveyard, overlaps, gaps, and stochastic cell volumes. |
| **Render with OpenMC** | `OWEN: Render with OpenMC (authoritative)` shells out to your actual OpenMC installation and shows OpenMC's own slice plots (xy/xz/yz, origin/width controls, material/cell coloring, optional 3D ray trace on OpenMC ≥ 0.15) in a panel — ground truth straight from OpenMC's geometry kernel, ideal for verifying OWEN's built-in preview or debugging geometry. Finds your interpreter automatically (settings → ms-python → PATH → WSL) and falls back to the built-in preview when OpenMC isn't installed. |
| **Verify Geometry with OpenMC** | `OWEN: Verify Geometry with OpenMC` runs an OpenMC model through your local OpenMC installation and checks for **overlapping cells** (slice plots with overlap detection at several sampled planes) and **lost particles** (a short capped probe run). The results panel shows per-plane images with overlap highlights, the lost-particle report, or a green all-clear — with the honest caveat that sampled planes are evidence, not proof. |
| **Check Geometry / Cell Volumes (built in)** | The same questions answered by OWEN's own exact-geometry engine, for all four codes and with no solver: `OWEN: Check Geometry` samples each universe in its own frame plus the full fill/lattice descent and names the overlapping cell pairs and the gaps (also published as Problems); `OWEN: Cell Volumes` gives stochastic per-instance volumes with errors, masses where a mass density is known, and — for MCNP — the `vol`/`sd` cards that keep an F4/F7 tally on a lattice or infinite cell from being a fatal error. |
| **Source & tally overlays** | The 3D preview draws the deck's `ksrc`/`sdef pos`, OpenMC `stats.Point`/`stats.Box`, Serpent `src sp`/`sx sy sz` and SCONE `pointSource` as markers, and `fmesh` / `RegularMesh` / Serpent `det dx dy dz` as wireframe boxes with their divisions, toggleable. A source point on a surface or a mesh that misses the fuel is visible at once. |
| **ALLEN σ(E) explorer + Doppler Studio** | Built-in cross-section webview: log-log σ(E) plots from ENDF/B-VIII.0, nuclide/reaction picker, multi-overlay, hover readout — with nuclides auto-detected from the active deck. **Doppler Studio** adds multi-temperature overlays (294/600/900/1200 K), a resonance-integral readout, and a Bondarenko σ₀ self-shielding slider. Cross-library comparison (e.g. ENDF/B-VIII.0 vs JEFF-3.3) lives on the companion <a href="https://reactormc.net">reactormc.net</a> ALLEN pages, one click away. |

### Run & analyze

| Feature | Description |
|---------|-------------|
| **Simulation runner** | One-command launcher that starts the right solver (MCNP / OpenMC / Serpent / SCONE) in a dedicated terminal, with per-code executable settings and WSL support for SCONE on Windows. |
| **Run reactor in OpenMC** | `OWEN: Run reactor in OpenMC` converts the open MCNP deck and runs it in WSL OpenMC, streaming batch k and source entropy. The headline k stays withheld until the entropy has settled. The run does not start on a fatal tally, a preflight finding, or a conversion TODO. |
| **One-group k-eff** | `OWEN: Run k-eff (one-group)` is a small built-in Monte Carlo for teaching. `OWEN: Find critical radius (one-group)` searches a bare-sphere radius on a fixed teaching material; it does not read the ZAIDs in the open deck, and it is not a substitute for MCNP or OpenMC. |
| **Results Viewer** | `OWEN: View Results` parses the outputs of **all four codes** (OpenMC `statepoint.h5` via h5wasm + stdout fallback, MCNP `mctal`, Serpent `_res.m`, SCONE `.out`) and shows k-eff convergence, flux spectrum (log-log), a tally table, and mesh heatmaps — mesh tallies can be overlaid on the 3D geometry preview as a colored slice plane. |
| **Parametric sweep + dashboard** | JSON-described parameter sweeps with per-run input mutation, output capture, k-eff parsing, and a manifest + TSV summary — then `OWEN: View Sweep Results` plots k-eff vs the swept parameter with error bars, per-run convergence small-multiples, and a run table. |
| **Community Library** | Browse and insert approved models shared on ReactorMC, filtered to the code you are editing. Enabled by default; disable with `owen.community.enabled`. |
| **Tutorials** | In-editor **ReactorMC search** (`OWEN: Search ReactorMC (Tutorials & NRDP)`) over bundled (and optional live) site index — tutorials, NRDP pages, reactors, and tools open on reactormc.net in one click. |

## Install

**From the VS Code Marketplace:**

1. Open the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`).
2. Search for **OWEN** and click **Install** — or install [`belvoirdynamics.owen-neutronics`](https://marketplace.visualstudio.com/items?itemName=belvoirdynamics.owen-neutronics).

**From Open VSX** (Cursor, VSCodium, etc.): install [`belvoirdynamics/owen-neutronics`](https://open-vsx.org/extension/belvoirdynamics/owen-neutronics).

**From a VSIX** ([GitHub Releases](https://github.com/caalh/owen/releases/latest)):

```bash
code --install-extension owen-neutronics-<version>.vsix
# Cursor:
cursor --install-extension owen-neutronics-<version>.vsix
```

Or in the editor: Extensions view → `...` menu → **Install from VSIX…**.

## Commands

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and type **OWEN**:

| Command | Description |
|---------|-------------|
| `OWEN: Open ALLEN Cross-Sections` | σ(E) webview — nuclide/reaction picker, log-log plot, multi-overlay, Doppler Studio |
| `OWEN: Open Input Builder` | Snippet wizards: materials (curated + PNNL), surfaces, cells, lattice, source, settings → starter deck |
| `OWEN: Open Input Builder (Lattice tab)` | Visual lattice grid editor (alias for Lattice Builder) |
| `OWEN: Validate Input File` | Deep MCNP / OpenMC / Serpent / SCONE checks on demand |
| `OWEN: Run Simulation` | Launch the appropriate solver in a dedicated terminal |
| `OWEN: Run Parameter Sweep` | Generate and run a JSON-described sweep |
| `OWEN: View Sweep Results (Dashboard)` | k-eff vs parameter, per-run convergence, run table |
| `OWEN: View Results` | k-eff convergence with a convergence reading (halves test, drift, source-entropy plateau, lost particles), the estimator table, MCNP's ten statistical checks, spectra, tallies, and mesh heatmaps |
| `OWEN: Open 3D Geometry Preview` | The 3D geometry preview described above |
| `OWEN: Ray-trace geometry` | Orthographic ray-march of the exact MCNP CSG; click a pixel to open its cell card |
| `OWEN: Preflight geometry` | Graveyard, source-point, overlap, gap, and volume checks before a run |
| `OWEN: Run reactor in OpenMC` | Convert the open MCNP deck and run it in WSL OpenMC; k is withheld until source entropy settles |
| `OWEN: Run k-eff (one-group)` | Built-in one-group Monte Carlo for a teaching-scale problem |
| `OWEN: Find critical radius (one-group)` | Critical radius of a fixed teaching sphere. Does not read the open deck |
| `OWEN: Check MCNP to OpenMC conversion` | Compare the converted OpenMC model with the source MCNP deck |
| `OWEN: Certify MCNP conversion` | Each construct is translated to OpenMC, Serpent, and SCONE, or left as a visible TODO |
| `OWEN: Render with OpenMC (authoritative)` | Native OpenMC slice plots of the active OpenMC Python model (requires OpenMC installed) |
| `OWEN: Verify Geometry with OpenMC` | Overlap + lost-particle checks through your local OpenMC |
| `OWEN: Convert Deck…` | Any of MCNP / OpenMC / Serpent / SCONE to any other, opened in a Rosetta diff |
| `OWEN: Convert to OpenMC XML (openmc adapters)` | Second-opinion MCNP/Serpent → OpenMC conversion via the OpenMC team's adapters in your Python (geometry + materials only) |
| `OWEN: Open Prebuilt Model…` | Load a bundled BEAVRS full-core, assembly, or pin-cell deck |
| `OWEN: Show MCNP References (Cross-Reference Tracker)` | Open the MCNP cross-reference tracker dock |
| `OWEN: Show Cell Map` | Structure tree of the fill hierarchy (root → lattices → pins, with placement counts) beside a flowchart of the cells by universe, a path-from-root breadcrumb for any cell, per-cell material/density and bounding surfaces, click to jump to the card. Serpent/SCONE/OpenMC names are kept. MCNP, OpenMC, Serpent, and SCONE. Opens in a new window or a tab (asked each time; `owen.cellMap.openIn` pins it). |
| `OWEN: Validate Workspace (files working together)` | Cross-file check of the whole model, for every code (see Workspace validation above) |
| `OWEN: Check Geometry (overlaps & gaps)` | Overlapping cells and points no cell claims, as a report and as Problems. All four codes |
| `OWEN: Cell Volumes (vol / sd cards)` | Per-instance cell volumes with errors; for MCNP, inserts the `vol` and `sd` cards |
| `OWEN: Compare Geometry with…` | Same model in two decks (any codes): point-sample agreement of the boundaries, material pairing, composition by class, and where they disagree. This is the test that shows whether an MCNP, Serpent, SCONE or OpenMC version of one reactor is really the same reactor. |
| `OWEN: Semantic Diff with…` | Diff two decks by *model* rather than text: both are reduced to a canonical listing (surfaces, cells per universe, fills, materials with normalised fractions) and opened in VS Code's diff viewer, so renumbering and formatting vanish and a changed radius is one line. |
| `OWEN: Set MCNP Project Root` | Root `.inp` for cross-file workspace validation |
| `OWEN: Insert Material from Database` | NRDP + PNNL-15870 material picker, language-aware (auto-numbered `mN`) |
| `OWEN: Search ReactorMC (Tutorials & NRDP)` | In-editor search over reactormc.net tutorials, NRDP, and site tools |
| `OWEN: Choose Highlight Palette` | Switch between Classic / Solarized / High Contrast / Pastel / Custom |
| `OWEN: Toggle Invisible Characters` | Reveal tabs/trailing whitespace that break fixed-format decks |
| `OWEN: Input from Community Library` | Browse approved ReactorMC community models and insert one |
| `OWEN: Open Community Library on reactormc.net` | Open the community library in a browser to upload, rate, or comment |
| `OWEN: Reference Documentation...` | Upstream manuals for the code you have open, plus NNDC / IAEA / JANIS and ReactorMC |

## Configuration

All settings live under the **OWEN** section (`Ctrl+,` → search "owen"):

| Key | Default | Notes |
|-----|---------|-------|
| `owen.mcnp.executable` | `mcnp6` | Path to the MCNP executable |
| `owen.mcnp.lineLengthLimit` | `80` | MCNP card-image column limit (set 128 for MCNP6.2+); drives diagnostics and the editor ruler |
| `owen.serpent.executable` | `sss2` | Path to the Serpent executable |
| `owen.openmc.executable` | `openmc` | Non-Python OpenMC entry point only |
| `owen.openmc.pythonExecutable` | `python` | Interpreter for OpenMC model scripts; when explicitly set it is also the first candidate for `Render with OpenMC` |
| `owen.openmc.crossSections` | *(blank)* | `cross_sections.xml` as the interpreter sees it (a WSL path when OpenMC lives in WSL). Blank means OWEN searches the environment, the openmc config, and the usual install locations |
| `owen.openmc.deckArgs` | *(blank)* | Arguments a model script is run with for `Render with OpenMC` / `Verify Geometry`, e.g. `--preset base`. Also editable in the render panel |
| `owen.scone.executable` | `scone` | On Windows, SCONE typically requires WSL |
| `owen.highlight.<lang>.palette` | `Classic` | Palette for `mcnp` / `openmc` / `serpent` / `scone`. Also settable from `OWEN: Choose Highlight Palette` |
| `owen.highlight.customColors` | `{}` | Colors for the `Custom` palette, per token role (`"keyword": "#FF9100"` or `{foreground, fontStyle}` objects). Unset roles fall back to Classic |
| `owen.highlight.openmc.decorate` | `true` | Draw the OpenMC palette on top of the Python highlighter. Set `false` to leave coloring to Pylance |
| `owen.highlight.openmc.coverage` | `Full deck` | Whether the OpenMC palette also colors Python comments, strings, numbers, keywords and `def`/`class` names, or only OpenMC API names |
| `owen.preview.maxInstances` | `1500000` | Max cylinder instances in the 3D preview; auto-simplifies detail (not pins) above this. Raise (e.g. 4000000) for full shell+axial detail on a full core |
| `owen.cellMap.openIn` | `ask` | Where the Cell Map opens: ask each time, `newWindow`, `beside`, or `activeGroup`. Clicking a cell always reveals the deck's existing tab, never a copy |
| `owen.simulation.workingDirectory` | `""` | Empty = the input file's directory |
| `owen.mcnp.projectRoot` | `""` | MCNP root `.inp` for cross-file workspace validation |
| `owen.mcnp.workspaceValidation.enabled` | `true` | Merge cross-file diagnostics into the language server |
| `owen.mcnp.workspaceValidation.warnUnused` | `true` | Hint on defined-but-unused MCNP entities |
| `owen.nrdp.live` | `true` | Live-fetch NRDP snapshots when online |
| `owen.nrdp.endpoint` | `https://reactormc.net/data` | Base URL for live NRDP JSON |
| `owen.allen.dataBaseUrl` | `https://reactormc.net/data/allen` | Base URL for ALLEN σ(E) JSON; override for offline use |
| `owen.community.enabled` | `true` | Browse the ReactorMC Community Library in the editor |
| `owen.community.webUrl` | `https://reactormc.net/community` | Page opened by `OWEN: Open Community Library on reactormc.net` |
| `owen.supabase.url` | ReactorMC project | Backend for the Community Library; override to browse a different one |
| `owen.supabase.anonKey` | ReactorMC publishable key | Public read-only credential; override alongside the URL |

> The Community Library now points at ReactorMC out of the box. The bundled key is a Supabase
> **publishable** key, which is public by design — Row Level Security restricts it to reading
> *approved* models, and OWEN's client is created with `persistSession: false`, so it cannot sign
> in or write anything. Set `owen.community.enabled` to `false` to stop OWEN contacting the
> backend at all; the bundled prebuilt models and snippets are unaffected either way.
>
> Uploading, rating, and commenting happen on the website — OWEN browses and inserts only.

## Requirements

OWEN is an editor toolkit — it does not bundle the Monte Carlo solvers. To run simulations,
render/verify with OpenMC, install and point the settings above at your own builds of:

- **MCNP** (Los Alamos National Laboratory — export-controlled, requires a license)
- **OpenMC** (open source; run via the Python interpreter you configure)
- **Serpent** (VTT — requires a license)
- **SCONE** (University of Cambridge — open source; on Windows it typically runs under **WSL**)

Syntax highlighting, snippets, the language server, validation, the lattice/input builders,
the converter, prebuilt models, ALLEN, and the built-in geometry preview all work without
any solver installed.

## Supported languages

| Language | Highlighting | Snippets | Diagnostics | Runner |
|----------|--------------|----------|------------|--------|
| MCNP | Yes | Yes | Real-time (LSP) + on-demand | `mcnp6 inp=…` |
| OpenMC (Python) | Decorations + injection grammar | Yes | On-demand (deep) + Pylance | `python <file>` |
| Serpent | Yes | Yes | Real-time (LSP) + on-demand | `sss2 <file>` |
| SCONE | Yes | Yes | Real-time (LSP) + on-demand | `scone <file>` (WSL on Windows) |
| OpenMC XML | VS Code's XML | — | Live (extension host) | — |
| PHITS | Yes | Yes | — (highlighting + snippets only) | — |

**PHITS is a syntax-only tier, by decision.** OWEN's diagnostics, 3D preview, Cell Map, geometry
tools and converter are built on a shared exact-geometry engine for MCNP, OpenMC, Serpent and
SCONE. PHITS gets the grammar and snippets (which are useful on their own) and the reference
links, and nothing that would imply a physics check has been done. That is a deliberate scope
line, not an oversight; it will move only if PHITS users ask for a specific tool.

### Notebooks

OpenMC models are often built in Jupyter. Every OWEN command that reads a deck — 3D preview,
Cell Map, Validate, Convert, Check Geometry, Cell Volumes, Compare, Semantic Diff — accepts a
notebook cell and treats **all code cells of that notebook, joined in order**, as the deck.
Click-to-reveal and diagnostics map back to the owning cell. The live OpenMC export path needs a
file, so for notebooks call `model.export_to_model_xml()` once and OWEN reads the sibling
`model.xml`.

### Offline

OWEN works with no network. Three.js (3D preview) and uPlot (Results, ALLEN, Sweep dashboard)
ship inside the VSIX under `media/vendor/`; nothing is fetched from a CDN. ALLEN's σ(E) curves
and the live NRDP/Community data are the only network features, and each has an offline fallback
or an off switch.

## Acknowledgements

OWEN integrates with **[OpenMC](https://openmc.org)** (MIT License, © OpenMC contributors) for
the `Render with OpenMC (authoritative)` and `Verify Geometry with OpenMC` features — the images
and checks in those panels are produced by your locally installed OpenMC, not by OWEN. OpenMC
itself is not bundled or redistributed.

The optional adapter convert backend (`OWEN: Convert to OpenMC XML (openmc adapters)`) drives
the OpenMC team's own converters, **[openmc_mcnp_adapter](https://github.com/openmc-dev/openmc_mcnp_adapter)**
and **[openmc_serpent_adapter](https://github.com/openmc-dev/openmc_serpent_adapter)** (both MIT
License, © OpenMC contributors), through your Python environment. Neither adapter is bundled or
redistributed — OWEN offers the pip install command when one is missing. OWEN's built-in
converter is an independent implementation; the adapters serve as a second opinion
(`docs/ADAPTER_COMPARISON.md`).

Compendium material data derives from **PNNL-15870 Rev. 2** (April 2021): R.S. Detwiler,
R.J. McConn Jr., T.F. Grimes, S.A. Upton, E.J. Engel, *Compendium of Material Composition Data
for Radiation Transport Modeling*, PNNL. https://doi.org/10.2172/1782721 — via the PyNE
`materials-compendium` export (BSD-2-Clause).

## Related

- **[ReactorMC](https://reactormc.net)** — tutorials, the community library, ALLEN cross-section pages, and the NRDP material data that powers OWEN.
- **[GROVES](https://reactormc.net/groves)** — an open-source catalog of nuclear toolchains.
- **[NICHOLS](https://github.com/caalh/nichols)** — Sublime Text and Notepad++ packages for the same languages.

## Thanks

These people ran OWEN on real decks and reported what broke:

- [b-shaffer](https://github.com/b-shaffer) — MCNP line length, preview rendering, and converter issues.
- Cibi Sundaram ([cibi-sundaram](https://github.com/cibi-sundaram)) — MCNP 6.3.1 `READ` cards.
- Lubomír Bureš (Saltfoss Energy) — the geometry tools on multi-file decks.
- John ([bluetyde](https://github.com/bluetyde)) — converter bugs [#7](https://github.com/caalh/owen/issues/7), [#8](https://github.com/caalh/owen/issues/8), and [#9](https://github.com/caalh/owen/issues/9).
- Frank Helk — MCNP parsing errors, per-cell 3D controls, and the lunar-crater deck behind the meshed cells, slices, zoom, and visible volume.

Found something wrong? [Open an issue](https://github.com/caalh/owen/issues); a deck attached gets it fixed fastest.

## License

[MIT](./LICENSE) © 2026 BelvoirDynamics.
