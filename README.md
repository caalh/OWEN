<h1 align="center">OWEN</h1>
<p align="center"><strong>Open Workspace for Engineered Neutronics</strong></p>
<p align="center">Created by <strong>Aaron W. Calhoun</strong></p>
<p align="center">The nuclear reactor modeling toolkit for VS Code &amp; Cursor — a Monte Carlo language server, visual lattice and input builders, full-core 3D geometry preview, native OpenMC rendering and verification, a cross-code results viewer, and workflow automation for <strong>MCNP</strong>, <strong>OpenMC</strong>, <strong>Serpent</strong>, and <strong>SCONE</strong>.</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=belvoirdynamics.owen-neutronics"><img alt="VS Code Marketplace Version" src="https://img.shields.io/visual-studio-marketplace/v/belvoirdynamics.owen-neutronics?label=VS%20Marketplace&logo=visualstudiocode&color=0b1020"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=belvoirdynamics.owen-neutronics"><img alt="VS Code Marketplace Installs" src="https://img.shields.io/visual-studio-marketplace/i/belvoirdynamics.owen-neutronics?label=installs&color=f59e0b"></a>
  <a href="https://open-vsx.org/extension/belvoirdynamics/owen-neutronics"><img alt="Open VSX Version" src="https://img.shields.io/open-vsx/v/belvoirdynamics/owen-neutronics?label=Open%20VSX&color=0b1020"></a>
  <a href="https://github.com/caalh/owen/releases/latest"><img alt="GitHub release" src="https://img.shields.io/github/v/release/caalh/owen?label=release&color=f59e0b"></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-0b1020"></a>
</p>

<p align="center">A <a href="https://reactormc.net">BelvoirDynamics</a> product · part of <a href="https://reactormc.net">ReactorMC</a></p>

---

OWEN brings first-class editor support for the four major Monte Carlo neutron-transport
codes to VS Code and Cursor. Write decks faster with smart snippets, catch physics and
cross-reference mistakes as you type with the MC Language Server, build lattices and full
input decks visually, preview and verify geometry in 3D, convert decks between codes,
launch solvers and parameter sweeps, and analyze the results — without leaving your editor.

## See it in action

**Visual Lattice Builder → MCNP 17×17 assembly, with live syntax highlighting.** Pick fuel,
guide-tube, and instrument-tube positions on a grid and OWEN writes the lattice deck for you.

<p align="center">
  <img alt="OWEN Lattice Builder generating an MCNP 17×17 PWR assembly deck with live syntax highlighting" src="https://raw.githubusercontent.com/caalh/owen/main/media/demo-lattice-builder.gif" width="900">
</p>

<p align="center"><a href="https://github.com/caalh/owen/releases/download/v0.2.2/demo-lattice-builder.mp4">▶ Watch full-quality MP4</a></p>

**3D geometry preview of a full Serpent core — component toggles, Disc/Layers fidelity, and
X / Y / Z slice planes.** Inspect ~56,900 pins interactively: peel away vessel and guide tubes,
switch to concentric pin layers, and slice through the core.

<p align="center">
  <img alt="OWEN 3D geometry preview of a full Serpent core with component toggles and slice planes" src="https://raw.githubusercontent.com/caalh/owen/main/media/demo-3d-preview.gif" width="820">
</p>

<p align="center"><a href="https://github.com/caalh/owen/releases/download/v0.2.2/demo-3d-preview.mp4">▶ Watch full-quality MP4</a></p>

## Features

### Write

| Feature | Description |
|---------|-------------|
| **Syntax highlighting** | TextMate grammars for MCNP (`.i`, `.mcnp`, `.inp`), Serpent (`.serp`), and SCONE (`.scone`), plus an OpenMC injection grammar for Python. Four switchable palettes per language (Classic / Solarized / High Contrast / Pastel) via `OWEN: Choose Highlight Palette`. |
| **Snippets** | Ready-to-edit decks: PWR pin cell, 17×17 PWR assembly, criticality array, and shielding slab for MCNP; full OpenMC pin/assembly Python scripts; SCONE fuel pin, 5×5 assembly, and shielding tutorials. |
| **MC Language Server** | A real language server for MCNP, Serpent, and SCONE: **real-time diagnostics as you type** — density-sign and fraction-sign conventions, S(α,β) thermal scattering on non-hydrogenous materials, ZAID format, macrobody parameter counts, MCNP line length, and **cross-reference errors** (a cell referencing an undefined surface/material/universe/transform is flagged; defined-but-unused entities are faded hints) — plus hover, go-to-definition, find-references, and a grouped document outline (Cells / Surfaces / Materials / Universes / Transforms / Tallies). Ships as a self-contained `out/server.js`, reusable by other editors over stdio. OpenMC Python files keep Pylance plus `OWEN: Validate Input File`. |
| **MCNP cross-reference tracker** | Role- and position-aware hover, Go-to-Definition, Find-All-References, occurrence highlight, and a **MCNP References** tree for MCNP decks. A number is resolved by *what it is and where it sits on the card* — cell id (1st field), material number (2nd field; `0` = void), geometry surface refs (signed entries), surface id (1st field of a surface card), `u=` universe, `fill`/`lat` (lattice fill arrays are decoded so universe references inside them resolve), `trcl`/`tr` transforms, and `mt`/`mx` material-data cards. Clicking surface `3` finds only the references to *surface 3* — never material 3, cell 3, or the digit `3` inside a `fill=` index. |
| **Deep validation** | On-demand language-aware diagnostics with codes — ZAID format, density/fraction sign conventions, `mt`/S(α,β) hydrogen checks, macrobody parameter counts (MCNP); `IndependentSource`/`RectangularPrism` API checks (OpenMC); `cuboid` vs `rect`, `trcl`, CLI `omp` (Serpent); `aceNeutronDatabase`, temperature-suffix matching, `pinUniverse` radii/fills (SCONE). |

### Build

| Feature | Description |
|---------|-------------|
| **Lattice Builder** | A visual grid editor that generates MCNP / OpenMC / Serpent / SCONE lattice code from a few clicks. |
| **Input Builder** | Five-step wizard: pick code, add materials from an 18-entry curated library or the searchable **PNNL-15870 Rev. 2 compendium (411 materials)**, pin-cell or lattice geometry, run settings, preview — then insert or open as a new file. |
| **Materials (NRDP + PNNL)** | `OWEN: Insert Material from Database` inserts reactor materials rendered for the detected deck language — the curated Nuclear Reactor Data Project set (bundled snapshot, optional live refresh from reactormc.net) plus the full PNNL-15870 Rev. 2 compendium with correct per-code conventions (isotopic ZAIDs with weight fractions for MCNP/Serpent, `add_element`/`add_nuclide` for OpenMC, atom densities for SCONE; S(α,β) only on hydrogenous moderators). |
| **Prebuilt models** | `OWEN: Open Prebuilt Model…` opens bundled, offline reactor decks in a new editor with the correct language. Ships the **complete BEAVRS Cycle-1 full core** (all 193 assemblies, full axial pin stacks, baffle/barrel/shields/RPV) for **all four codes** — MCNP, OpenMC, Serpent, and SCONE — plus 17×17 PWR assembly starters and a **Reflected UO2 Pin Cell** teaching model in all four codes (the OpenMC twin is run-verified: k-inf 1.2256 ± 0.0010). The SCONE full-core deck is the author-verified source of truth; the MCNP/OpenMC/Serpent decks are geometry/materials-faithful translations of it. |
| **Cross-code converter** | `OWEN: Convert Deck…` (`owen.convertDeck`) converts **MCNP ↔ OpenMC** — a high-fidelity engine with a full boolean region AST, multi-level universes and rect/hex lattices, transforms, graveyard handling, and tally/source mapping, validated against the bundled BEAVRS full core in real OpenMC — plus **MCNP → Serpent / SCONE (experimental)**. Anything that can't be mapped emits a clearly marked `TODO(owen-convert)` comment instead of being silently dropped, and results open in a **Rosetta diff** view — source and converted deck side-by-side with aligned cells/surfaces/materials sections and TODO highlights. |

### Visualize & verify

| Feature | Description |
|---------|-------------|
| **3D geometry preview** | Three.js webview rendering of MCNP / OpenMC / Serpent / SCONE geometry with component / material / axial-layer toggles, slice planes, and a Disc/Layers fidelity control. Renders a **full BEAVRS core** (all 193 assemblies) across every code — including OpenMC cores whose lattices are built programmatically (comprehension/dict-driven assembly maps are statically expanded, no Python executed) — without dropping pins, and shows the **full axial stack** for OpenMC too — each pin is reconstructed as its real z-column from the deck's `_SHELLS`/`STACKS`/`R[key]` tables, so grid spacers, plena, end plugs and SS nozzles render with their own per-band shells/materials over the complete 0→460 cm assembly height, matching MCNP/Serpent/SCONE. Geometry is instanced (so draw calls stay low) and a configurable instance budget (`owen.preview.maxInstances`, default 1.5M) auto-simplifies detail (shells→discs, then collapses axial) instead of hiding pins when a deck is huge. **Hover** any part to read its layer, material, axial index, radius/diameter and z-range; **solo** a layer to isolate it; and **measure** distances (with Δx Δy Δz), included angles, and pin/shell radii directly in the view. |
| **Render with OpenMC** | `OWEN: Render with OpenMC (authoritative)` shells out to your actual OpenMC installation and shows OpenMC's own slice plots (xy/xz/yz, origin/width controls, material/cell coloring, optional 3D ray trace on OpenMC ≥ 0.15) in a panel — ground truth straight from OpenMC's geometry kernel, ideal for verifying OWEN's built-in preview or debugging geometry. Finds your interpreter automatically (settings → ms-python → PATH → WSL) and falls back to the built-in preview when OpenMC isn't installed. |
| **Verify Geometry with OpenMC** | `OWEN: Verify Geometry with OpenMC` runs an OpenMC model through your local OpenMC installation and checks for **overlapping cells** (slice plots with overlap detection at several sampled planes) and **lost particles** (a short capped probe run). The results panel shows per-plane images with overlap highlights, the lost-particle report, or a green all-clear — with the honest caveat that sampled planes are evidence, not proof. |
| **ALLEN σ(E) explorer + Doppler Studio** | Built-in cross-section webview: log-log σ(E) plots from ENDF/B-VIII.0, nuclide/reaction picker, multi-overlay, hover readout — with nuclides auto-detected from the active deck. **Doppler Studio** adds multi-temperature overlays (294/600/900/1200 K), a resonance-integral readout, and a Bondarenko σ₀ self-shielding slider. Cross-library comparison (e.g. ENDF/B-VIII.0 vs JEFF-3.3) lives on the companion <a href="https://reactormc.net">reactormc.net</a> ALLEN pages, one click away. |

### Run & analyze

| Feature | Description |
|---------|-------------|
| **Simulation runner** | One-command launcher that starts the right solver (MCNP / OpenMC / Serpent / SCONE) in a dedicated terminal, with per-code executable settings and WSL support for SCONE on Windows. |
| **Results Viewer** | `OWEN: View Results` parses the outputs of **all four codes** (OpenMC `statepoint.h5` via h5wasm + stdout fallback, MCNP `mctal`, Serpent `_res.m`, SCONE `.out`) and shows k-eff convergence, flux spectrum (log-log), a tally table, and mesh heatmaps — mesh tallies can be overlaid on the 3D geometry preview as a colored slice plane. |
| **Parametric sweep + dashboard** | JSON-described parameter sweeps with per-run input mutation, output capture, k-eff parsing, and a manifest + TSV summary — then `OWEN: View Sweep Results` plots k-eff vs the swept parameter with error bars, per-run convergence small-multiples, and a run table. |
| **Community Library** | Browse and insert community-approved models (opt-in via `owen.community.enabled`; you supply your own Supabase backend). |
| **Tutorials** | Deep-links into the reactormc.net learning material via `OWEN: Open Tutorial`. |

## Install

**From the VS Code Marketplace:**

1. Open the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`).
2. Search for **OWEN** and click **Install** — or install [`belvoirdynamics.owen-neutronics`](https://marketplace.visualstudio.com/items?itemName=belvoirdynamics.owen-neutronics).

**From Open VSX** (Cursor, VSCodium, etc.): install [`belvoirdynamics/owen-neutronics`](https://open-vsx.org/extension/belvoirdynamics/owen-neutronics).

**From a VSIX** ([GitHub Releases](https://github.com/caalh/owen/releases/latest)):

```bash
code --install-extension owen-neutronics-1.0.0.vsix
# Cursor:
cursor --install-extension owen-neutronics-1.0.0.vsix
```

Or in the editor: Extensions view → `...` menu → **Install from VSIX…**.

## Commands

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and type **OWEN**:

| Command | Description |
|---------|-------------|
| `OWEN: Open ALLEN Cross-Sections` | σ(E) webview — nuclide/reaction picker, log-log plot, multi-overlay, Doppler Studio |
| `OWEN: Open Input Builder` | Wizard: materials (curated + PNNL compendium) + geometry + settings → full starter deck |
| `OWEN: Open Lattice Builder` | Visual lattice grid editor |
| `OWEN: Validate Input File` | Deep MCNP / OpenMC / Serpent / SCONE checks on demand |
| `OWEN: Run Simulation` | Launch the appropriate solver in a dedicated terminal |
| `OWEN: Run Parameter Sweep` | Generate and run a JSON-described sweep |
| `OWEN: View Sweep Results (Dashboard)` | k-eff vs parameter, per-run convergence, run table |
| `OWEN: View Results` | k-eff convergence, flux spectrum, tallies, mesh heatmaps for all four codes |
| `OWEN: Open 3D Geometry Preview` | Three.js webview — full-core BEAVRS, layer toggles, measurement tools |
| `OWEN: Render with OpenMC (authoritative)` | Native OpenMC slice plots of the active OpenMC Python model (requires OpenMC installed) |
| `OWEN: Verify Geometry with OpenMC` | Overlap + lost-particle checks through your local OpenMC |
| `OWEN: Convert Deck… (MCNP↔OpenMC)` | MCNP ↔ OpenMC (stable), MCNP → Serpent / SCONE (experimental), with Rosetta diff view |
| `OWEN: Open Prebuilt Model…` | Load a bundled BEAVRS full-core, assembly, or pin-cell deck |
| `OWEN: Show MCNP References` | Open the MCNP cross-reference tracker dock |
| `OWEN: Insert Material from Database` | NRDP + PNNL-15870 material picker, language-aware |
| `OWEN: Open Tutorial` | Jump to a reactormc.net tutorial page |
| `OWEN: Choose Highlight Palette` | Switch between Classic / Solarized / High Contrast / Pastel |
| `OWEN: Toggle Invisible Characters` | Reveal tabs/trailing whitespace that break fixed-format decks |
| `OWEN: Search Reactor Library` | Community Library browser (disabled by default) |

## Configuration

All settings live under the **OWEN** section (`Ctrl+,` → search "owen"):

| Key | Default | Notes |
|-----|---------|-------|
| `owen.mcnp.executable` | `mcnp6` | Path to the MCNP executable |
| `owen.mcnp.lineLengthLimit` | `80` | MCNP card-image column limit (set 128 for MCNP6.2+); drives diagnostics and the editor ruler |
| `owen.serpent.executable` | `sss2` | Path to the Serpent executable |
| `owen.openmc.executable` | `openmc` | Non-Python OpenMC entry point only |
| `owen.openmc.pythonExecutable` | `python` | Interpreter for OpenMC model scripts; when explicitly set it is also the first candidate for `Render with OpenMC` |
| `owen.scone.executable` | `scone` | On Windows, SCONE typically requires WSL |
| `owen.preview.maxInstances` | `1500000` | Max cylinder instances in the 3D preview; auto-simplifies detail (not pins) above this. Raise (e.g. 4000000) for full shell+axial detail on a full core |
| `owen.simulation.workingDirectory` | `""` | Empty = the input file's directory |
| `owen.nrdp.live` | `true` | Live-fetch NRDP snapshots when online |
| `owen.nrdp.endpoint` | `https://reactormc.net/data` | Base URL for live NRDP JSON |
| `owen.allen.dataBaseUrl` | `https://reactormc.net/data/allen` | Base URL for ALLEN σ(E) JSON; override for offline use |
| `owen.community.enabled` | `false` | Enable the Community Library browser |
| `owen.supabase.url` | `""` | Supabase project URL (you supply this) |
| `owen.supabase.anonKey` | `""` | Supabase anon/public key (you supply this) |

> The Community Library is **off by default** and ships with **no credentials**. To use it,
> point `owen.supabase.url` / `owen.supabase.anonKey` at your own Supabase project.

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
| MCNP | Yes (4 palettes) | Yes | Real-time (LSP) + on-demand | `mcnp6 inp=…` |
| OpenMC (Python) | Injection grammar (4 palettes) | Yes | On-demand (deep) + Pylance | `python <file>` |
| Serpent | Yes (4 palettes) | Yes | Real-time (LSP) + on-demand | `sss2 <file>` |
| SCONE | Yes (4 palettes) | Yes | Real-time (LSP) + on-demand | `scone <file>` (WSL on Windows) |

## Acknowledgements

OWEN integrates with **[OpenMC](https://openmc.org)** (MIT License, © OpenMC contributors) for
the `Render with OpenMC (authoritative)` and `Verify Geometry with OpenMC` features — the images
and checks in those panels are produced by your locally installed OpenMC, not by OWEN. OpenMC
itself is not bundled or redistributed.

Compendium material data derives from **PNNL-15870 Rev. 2** (April 2021): R.S. Detwiler,
R.J. McConn Jr., T.F. Grimes, S.A. Upton, E.J. Engel, *Compendium of Material Composition Data
for Radiation Transport Modeling*, PNNL. https://doi.org/10.2172/1782721 — via the PyNE
`materials-compendium` export (BSD-2-Clause).

## Related

- **[ReactorMC](https://reactormc.net)** — tutorials, the community library, ALLEN cross-section pages, and the NRDP material data that powers OWEN.
- **GROVES** — the companion desktop editor for the same input languages.
- **[NICHOLS](https://github.com/caalh/nichols)** — Sublime Text and Notepad++ packages for the same languages.

## License

[MIT](./LICENSE) © 2026 BelvoirDynamics.
