<h1 align="center">OWEN</h1>
<p align="center"><strong>Open Workspace for Engineered Neutronics</strong></p>
<p align="center">Created by <strong>Aaron W. Calhoun</strong></p>
<p align="center">The nuclear reactor modeling toolkit for VS Code &amp; Cursor — a Monte Carlo language server, visual lattice and input builders, full-core 3D geometry preview, native OpenMC rendering and verification, a cross-code results viewer, and workflow automation for <strong>MCNP</strong>, <strong>OpenMC</strong>, <strong>Serpent</strong>, and <strong>SCONE</strong>.</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=belvoirdynamics.owen-neutronics"><img alt="VS Code Marketplace Version" src="https://vsmarketplacebadges.dev/version-short/belvoirdynamics.owen-neutronics.svg?style=flat&label=VS%20Marketplace&color=0b1020"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=belvoirdynamics.owen-neutronics"><img alt="VS Code Marketplace Installs" src="https://vsmarketplacebadges.dev/installs-short/belvoirdynamics.owen-neutronics.svg?style=flat&label=installs&color=f59e0b"></a>
  <a href="https://open-vsx.org/extension/belvoirdynamics/owen-neutronics"><img alt="Open VSX Version" src="https://img.shields.io/open-vsx/v/belvoirdynamics/owen-neutronics?label=Open%20VSX&color=0b1020"></a>
  <a href="https://github.com/caalh/owen/releases/latest"><img alt="GitHub release" src="https://img.shields.io/github/v/release/caalh/owen?label=release&color=f59e0b"></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-0b1020"></a>
</p>

<p align="center">A <a href="https://reactormc.net">BelvoirDynamics</a> product · part of <a href="https://reactormc.net">ReactorMC</a></p>
<p align="center">Get it from the <a href="https://marketplace.visualstudio.com/items?itemName=belvoirdynamics.owen-neutronics">VS Marketplace</a>, <a href="https://open-vsx.org/extension/belvoirdynamics/owen-neutronics">Open VSX</a>, or <a href="https://github.com/caalh/owen/releases">GitHub Releases</a> — the badges above show the current version on each.</p>

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

**A full BEAVRS core from a SCONE deck, at 1.2 million primitives, with the real axial stack.**
OWEN resolves the nested lattice — 17×17 assemblies of 17×17 pins — and draws every one of the
55,809 pin positions. Turn on axial segments and each pin expands into its true z-column, so the
36 levels of active fuel, plena, grid spacers, end plugs and nozzles are individually toggleable.
Peel off the vessel, solo a layer, or slice through the core on any axis.

<p align="center">
  <img alt="OWEN 3D geometry preview of a full BEAVRS core from a SCONE deck, expanding to 1.2 million primitives with per-axial-layer toggles and slice planes" src="https://raw.githubusercontent.com/caalh/owen/main/media/demo-3d-core-axial.gif" width="880">
</p>

**Geometry checked against your own OpenMC, not against OWEN's opinion of it.**
`OWEN: Verify Geometry with OpenMC` runs the model through your real OpenMC install — local or WSL —
and reports overlapping cells on five sampled planes plus a short lost-particle probe. Overlap
pixels come back highlighted in magenta, and the panel says plainly that sampled planes are
evidence rather than proof.

<p align="center">
  <img alt="OWEN Geometry Verification panel showing five overlap slices of a full PWR core checked through OpenMC 0.15.3 under WSL, all clear" src="https://raw.githubusercontent.com/caalh/owen/main/media/demo-verify-openmc.png" width="820">
</p>

**Five highlight palettes per code, previewed side by side before you commit.**
`OWEN: Choose Highlight Palette` opens them on the language you picked — Classic, Solarized,
High Contrast, Pastel, and **Custom** (your own colors) — rendered from the same color table the
editor uses, so what you compare is what you get. Click a card to apply it. For OpenMC each
built-in palette uses its own hue family (blue/teal, olive/blue, orange/yellow/green/cyan,
lilac/rose/mint), and the palette governs the whole deck: `openmc.*` names, method calls
(`fuel.add_nuclide`) and attributes (`settings.batches`) on any variable, and the Python
layer around them — comments, strings, numeric literals, keywords, and the name a
`def`/`class` introduces. That last part is what makes a switch obvious rather than
subtle: on the bundled BEAVRS full-core deck the palette reaches 69% of the non-whitespace
characters, against 10% when only the API names are colored. Set
`owen.highlight.openmc.coverage` to `OpenMC API only` for accents alone. Custom colors live
in `owen.highlight.customColors` — set any of the ten token roles to a hex color (or
`{foreground, fontStyle}`); roles you leave out fall back to Classic.

<p align="center">
  <img alt="OWEN highlight palette preview showing Classic, Solarized, High Contrast and Pastel side by side for MCNP" src="https://raw.githubusercontent.com/caalh/owen/main/media/demo-highlight-palettes.png" width="880">
</p>

## Features

### Write

| Feature | Description |
|---------|-------------|
| **Syntax highlighting** | TextMate grammars for MCNP (`.i`, `.mcnp`, `.inp`), Serpent (`.serp`), SCONE (`.scone`), and PHITS (`.phits`, `phits.inp` — sections, `$`/`#`/`!`/`c` comments, `infl:`/`set:` directives, `MAT[n]`), plus an OpenMC injection grammar for Python. Line-context MCNP rules color cell/surface/material cards, tallies, particle suffixes (`:n`), thermal libraries, and geometry operators. Five switchable palettes per language (Classic / Solarized / High Contrast / Pastel / Custom — your own colors via `owen.highlight.customColors`) via `OWEN: Choose Highlight Palette`, previewed side by side before you apply one; the OpenMC palettes each use a distinct hue family so the choice is visible at a glance. OpenMC decks are Python, so a language server such as Pylance owns their semantic tokens; OWEN draws the OpenMC palette on top of that layer, which is what makes it visible on a machine with Pylance installed (`owen.highlight.openmc.decorate` turns it off). |
| **Snippets** | Ready-to-edit decks: PWR pin cell, 17×17 PWR assembly, criticality array, and shielding slab for MCNP; full OpenMC pin/assembly Python scripts plus depletion runs (`omc_deplete`, `omc_deplete_results`); SCONE fuel pin, 5×5 assembly, and shielding tutorials; PHITS starter deck, source, material, and T-Track tally blocks. |
| **MC Language Server** | A real language server for MCNP, Serpent, and SCONE: **real-time diagnostics as you type** — density-sign and fraction-sign conventions, S(α,β) thermal scattering on non-hydrogenous materials, ZAID format, macrobody parameter counts, MCNP line length, and **cross-reference errors** (a cell referencing an undefined surface/material/universe/transform is flagged; defined-but-unused entities are faded hints) — plus hover, go-to-definition, find-references, and a grouped document outline (Cells / Surfaces / Materials / Universes / Transforms / Tallies). Ships as a self-contained `out/server.js`, reusable by other editors over stdio. OpenMC Python files keep Pylance plus `OWEN: Validate Input File`. |
| **MCNP cross-reference tracker** | Role- and position-aware hover, Go-to-Definition, Find-All-References, occurrence highlight, and a **MCNP References** tree for MCNP decks. A number is resolved by *what it is and where it sits on the card* — cell id (1st field), material number (2nd field; `0` = void), geometry surface refs (signed entries), surface id (1st field of a surface card), `u=` universe, `fill`/`lat` (lattice fill arrays are decoded so universe references inside them resolve), `trcl`/`tr` transforms, and `mt`/`mx` material-data cards. Clicking surface `3` finds only the references to *surface 3* — never material 3, cell 3, or the digit `3` inside a `fill=` index. |
| **MCNP workspace validation** | Cross-file diagnostics when `owen.mcnp.projectRoot` is set: undefined references and duplicate IDs across included MCNP decks (`OWEN: Set MCNP Project Root`). |
| **Deep validation** | On-demand language-aware diagnostics with codes — ZAID format, density/fraction sign conventions, `mt`/S(α,β) target-element checks, macrobody parameter counts (MCNP); `IndependentSource`/`RectangularPrism` API checks, MCNP-style S(α,β) names, density units (OpenMC); `cuboid` vs `rect`, `trcl`, CLI `omp` (Serpent); `aceNeutronDatabase`, temperature-suffix matching, `pinUniverse` radii/fills (SCONE). |
| **OpenMC XML validation** | Live diagnostics on `materials.xml` / `geometry.xml` / `settings.xml` / `tallies.xml` / `model.xml` (detected by root element, so renamed exports work too): duplicate ids, GNDS nuclide-name format, density units, ao/wo conflicts, MCNP-style `sab` names, surface/boundary types, region → surface and cell → material cross-references (against a sibling `materials.xml`), `inactive < batches`, run modes, tally filter references. |

### Build

| Feature | Description |
|---------|-------------|
| **Input Builder** | Snippet wizards for Material, Surface, Cell, Lattice (integrated visual grid editor with W 17×17 / BWR presets and editable identifiers), Source, and Settings — plus a searchable template library. Pick code, add materials from an 18-entry curated library or the searchable **PNNL-15870 Rev. 2 compendium (411 materials)**, pin-cell or lattice geometry, run settings, preview — then insert or open as a new file (`Ctrl+Shift+I`). |
| **Lattice Builder** | Shortcut into Input Builder's Lattice tab — same visual grid editor that generates MCNP / OpenMC / Serpent / SCONE lattice code from a pin map. |
| **Materials (NRDP + PNNL)** | `OWEN: Insert Material from Database` inserts reactor materials rendered for the detected deck language — the curated Nuclear Reactor Data Project set (bundled snapshot, optional live refresh from reactormc.net) plus the full PNNL-15870 Rev. 2 compendium with correct per-code conventions (isotopic ZAIDs with weight fractions for MCNP/Serpent, `add_element`/`add_nuclide` for OpenMC, atom densities for SCONE; S(α,β) only on hydrogenous moderators). **Auto-assigns the next free `mN` (and `mtN`)** from the open deck so inserts do not collide with existing material numbers. |
| **Prebuilt models** | `OWEN: Open Prebuilt Model…` opens bundled, offline reactor decks in a new editor with the correct language. Ships the **complete BEAVRS Cycle-1 full core** (all 193 assemblies, full axial pin stacks, baffle/barrel/shields/RPV) for **all four codes** — MCNP, OpenMC, Serpent, and SCONE — plus 17×17 PWR assembly starters and a **Reflected UO2 Pin Cell** teaching model in all four codes (the OpenMC twin is run-verified: k-inf 1.2256 ± 0.0010). The SCONE full-core deck is the author-verified source of truth; the MCNP/OpenMC/Serpent decks are geometry/materials-faithful translations of it. |
| **Cross-code converter** | `OWEN: Convert Deck…` (`owen.convertDeck`) converts **MCNP ↔ OpenMC** — a high-fidelity engine with a full boolean region AST, multi-level universes and rect/hex lattices, transforms, graveyard handling, and tally/source mapping, validated against the bundled BEAVRS full core in real OpenMC — plus **MCNP → Serpent / SCONE (experimental)**. Anything that can't be mapped emits a clearly marked `TODO(owen-convert)` comment instead of being silently dropped, and results open in a **Rosetta diff** view — source and converted deck side-by-side with aligned cells/surfaces/materials sections and TODO highlights. `OWEN: Convert to OpenMC XML (openmc adapters)` additionally drives the OpenMC team's own converters ([openmc_mcnp_adapter](https://github.com/openmc-dev/openmc_mcnp_adapter), [openmc_serpent_adapter](https://github.com/openmc-dev/openmc_serpent_adapter), both MIT) through your Python as a second opinion — they emit real `openmc.Model` XML for geometry + materials, but ignore source/tally definitions and write placeholder settings, so OWEN flags that in the result. Not bundled; OWEN offers the pip command if one is missing. Measured side-by-side: `docs/ADAPTER_COMPARISON.md`. |

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
| `OWEN: View Results` | k-eff convergence, flux spectrum, tallies, mesh heatmaps for all four codes |
| `OWEN: Open 3D Geometry Preview` | Three.js webview — full-core BEAVRS, layer toggles, measurement tools |
| `OWEN: Render with OpenMC (authoritative)` | Native OpenMC slice plots of the active OpenMC Python model (requires OpenMC installed) |
| `OWEN: Verify Geometry with OpenMC` | Overlap + lost-particle checks through your local OpenMC |
| `OWEN: Convert Deck… (MCNP↔OpenMC)` | MCNP ↔ OpenMC (stable), MCNP → Serpent / SCONE (experimental), with Rosetta diff view |
| `OWEN: Convert to OpenMC XML (openmc adapters)` | Second-opinion MCNP/Serpent → OpenMC conversion via the OpenMC team's adapters in your Python (geometry + materials only) |
| `OWEN: Open Prebuilt Model…` | Load a bundled BEAVRS full-core, assembly, or pin-cell deck |
| `OWEN: Show MCNP References (Cross-Reference Tracker)` | Open the MCNP cross-reference tracker dock |
| `OWEN: Set MCNP Project Root` | Root `.inp` for cross-file workspace validation |
| `OWEN: Insert Material from Database` | NRDP + PNNL-15870 material picker, language-aware (auto-numbered `mN`) |
| `OWEN: Search ReactorMC (Tutorials & NRDP)` | In-editor search over reactormc.net tutorials, NRDP, and site tools |
| `OWEN: Choose Highlight Palette` | Switch between Classic / Solarized / High Contrast / Pastel / Custom |
| `OWEN: Toggle Invisible Characters` | Reveal tabs/trailing whitespace that break fixed-format decks |
| `OWEN: Search Reactor Library` | Browse approved ReactorMC community models and insert one |
| `OWEN: Open Community Library on reactormc.net` | Open the community library in a browser to upload, rate, or comment |

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
| `owen.highlight.<lang>.palette` | `Classic` | Palette for `mcnp` / `openmc` / `serpent` / `scone`. Also settable from `OWEN: Choose Highlight Palette` |
| `owen.highlight.customColors` | `{}` | Colors for the `Custom` palette, per token role (`"keyword": "#FF9100"` or `{foreground, fontStyle}` objects). Unset roles fall back to Classic |
| `owen.highlight.openmc.decorate` | `true` | Draw the OpenMC palette as decorations so it survives Pylance's semantic tokens (see below) |
| `owen.highlight.openmc.coverage` | `Full deck` | Whether the OpenMC palette also colors Python comments, strings, numbers, keywords and `def`/`class` names, or only OpenMC API names |
| `owen.preview.maxInstances` | `1500000` | Max cylinder instances in the 3D preview; auto-simplifies detail (not pins) above this. Raise (e.g. 4000000) for full shell+axial detail on a full core |
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
| MCNP | Yes (4 palettes) | Yes | Real-time (LSP) + on-demand | `mcnp6 inp=…` |
| OpenMC (Python) | Decorations + injection grammar (4 palettes) | Yes | On-demand (deep) + Pylance | `python <file>` |
| Serpent | Yes (4 palettes) | Yes | Real-time (LSP) + on-demand | `sss2 <file>` |
| SCONE | Yes (4 palettes) | Yes | Real-time (LSP) + on-demand | `scone <file>` (WSL on Windows) |
| OpenMC XML | VS Code's XML | — | Live (extension host) | — |
| PHITS | Yes | Yes | — (highlighting + snippets only) | — |

### Why OpenMC is highlighted twice

MCNP, Serpent, and SCONE have their own language ids, so a grammar plus
`editor.tokenColorCustomizations` is all a palette needs. OpenMC decks are
Python, and Python belongs to Pylance.

VS Code colors a *semantic* token — which is what Pylance publishes — from the
scopes that token's **type** maps to. `openmc.Material` arrives as a `class` and
resolves against `entity.name.type.class`; the `support.class.openmc` that
OWEN's injection grammar put at the same position is never consulted. The
palette was applied, correct, and invisible on any machine with a Python
language server installed.

So OWEN also draws the palette as editor decorations, which render above both
the TextMate and semantic layers. The scanner behind them
(`src/highlight/openmcTokens.ts`) matches the injection grammar's four patterns
exactly, so both routes produce the same colors; `npm run verify:openmc-tokens`
holds them together. Set `owen.highlight.openmc.decorate` to `false` to leave
Python files entirely to Pylance.

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
- **GROVES** — the companion desktop editor for the same input languages.
- **[NICHOLS](https://github.com/caalh/nichols)** — Sublime Text and Notepad++ packages for the same languages.

## License

[MIT](./LICENSE) © 2026 BelvoirDynamics.
