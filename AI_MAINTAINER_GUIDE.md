# AI Maintainer Guide — OWEN (VS Code / Cursor Extension)

This document is written for future AI agents (Cursor, Copilot, ChatGPT, etc.) working on
the **OWEN** extension. It explains what the extension does, how it is structured, how to
build/package/publish it, and — most importantly — the non-obvious rules that keep it from
breaking. Read this before making changes.

> OWEN is a product of **BelvoirDynamics** (the software division of **ReactorMC**).
> Its sibling product is **GROVES**, a PySide6 desktop editor for the same input
> languages. OWEN lives inside the BelvoirDynamics monorepo at `owen/` and is mirrored to
> the public repo `caalh/owen`. **Changes must be applied to both copies** — see
> [§9 Monorepo ↔ public sync](#9-monorepo--public-mirror-sync).

---

## 1. What Is OWEN?

**OWEN — Open Workspace for Engineered Neutronics** is a VS Code / Cursor extension that
brings first-class editor support for the four major Monte Carlo neutron-transport codes:

| Code | Language id | Notes |
|------|-------------|-------|
| **MCNP** | `mcnp` (`.i`, `.mcnp`, `.inp`) | Los Alamos transport code |
| **OpenMC** | detected from `python` files that `import openmc` | MIT, Python API |
| **Serpent** | `serpent` (`.serp`) | VTT |
| **SCONE** | `scone` (`.scone`) | University of Cambridge |

Features: TextMate syntax highlighting, snippets, a webview lattice builder, a Three.js 3D
geometry preview (full-core BEAVRS, measurement tools, radial structure), **ALLEN** σ(E)
webview (`src/allen/`), bundled prebuilt models (`prebuilt-models/`), deep per-language
validation, a simulation runner, a JSON-driven parameter sweep, NRDP material insertion, and
an opt-in community-library browser.

Current release: **v0.3.1** (stable, VS Code Marketplace + Open VSX).

---

## 2. Technology Stack

| Component | Technology | Notes |
|-----------|-----------|-------|
| Language | TypeScript (`^5.3`) | `src/` → `out/extension.js` |
| Platform | VS Code Extension API (`engines.vscode ^1.85`) | works in VS Code and Cursor |
| Bundler | **esbuild** (`esbuild.js`) | single CommonJS bundle, `vscode` external |
| Syntax | TextMate grammars (`syntaxes/*.tmLanguage.json`) | |
| UI panels | Webviews (lattice builder, geometry preview) | Three.js via importmap |
| Community backend | `@supabase/supabase-js` | **lazy-imported** (see §6) |
| Tests | Mocha + `@vscode/test-electron` | `src/test/` |
| Packaging | `@vscode/vsce` (Marketplace), `ovsx` (Open VSX) | VSIX |

---

## 3. Architecture & Activation Flow

```
VS Code loads out/extension.js (bundled by esbuild)
        │
        ▼
activate(context)            ← src/extension.ts
        │
        ├── registers owen.openLatticeBuilder  → panels/latticeBuilder.ts (webview)
        ├── registers owen.validateInput        → validation/validator.ts
        ├── registers owen.runSimulation        → workflows/runner.ts
        ├── registers owen.runSweep             → workflows/sweep.ts
        ├── registers owen.openGeometryPreview  → preview/webview.ts + preview/extractor.ts
        ├── registers owen.openAllen            → allen/panel.ts (uPlot σ(E) from NRDP)
        ├── registers owen.openPrebuiltModel    → commands/openPrebuiltModel.ts
        ├── registers owen.insertMaterial       → commands/insertMaterial.ts (data/nrdp-*.json)
        ├── registers owen.openTutorial         → commands/openTutorial.ts (data/tutorial-links.json)
        └── registers owen.searchReactorLibrary → community/browser.ts → community/client.ts
```

`activate()` only *registers commands* — it does no heavy work and must not import anything
that can fail at load time (see §6). Language detection for every command flows through
`util/detectLanguage.ts`, which maps a `TextDocument` (or raw text) to one of
`'mcnp' | 'openmc' | 'serpent' | 'scone'`. OpenMC has no VS Code language id, so Python
files are sniffed for an `openmc` import.

### Module map

| Area | File(s) | Responsibility |
|------|---------|----------------|
| Entry | `src/extension.ts` | `activate` / `deactivate`, command registration |
| Lattice builder | `src/panels/latticeBuilder.ts` | webview grid → MCNP/OpenMC/Serpent code |
| Validation | `src/validation/validator.ts` | per-language diagnostics with codes |
| Runner | `src/workflows/runner.ts` | `planLaunch()` + launch solver in a terminal |
| Sweep | `src/workflows/sweep.ts` | cartesian param sweep, per-run mutation, k-eff parse, manifest + TSV |
| Geometry | `src/preview/extractor.ts` | deck → `CylinderSpec[]` (ports GROVES `analysis.py`) |
| Geometry | `src/preview/webview.ts` | Three.js webview, layer toggles, measurement tools |
| Geometry | `src/preview/radialStructure.ts` | BEAVRS barrel/shields/RPV/baffle annular+bbox emitters |
| Geometry | `src/preview/codes/*.ts` | per-language parsers (MCNP, OpenMC, Serpent, SCONE) |
| ALLEN | `src/allen/panel.ts` | `owen.openAllen` — uPlot webview, NRDP ENDF/B-VIII.0 curves |
| ALLEN | `src/allen/detectNuclides.ts` | harvest ZAIDs/nuclides from active deck text |
| Prebuilts | `prebuilt-models/` + `commands/openPrebuiltModel.ts` | bundled BEAVRS full core + assembly starters |
| Materials | `src/commands/insertMaterial.ts` | NRDP picker → language-aware material code |
| Tutorials | `src/commands/openTutorial.ts` | deep-links into reactormc.net |
| Community | `src/community/client.ts` | **lazy** Supabase client factory |
| Community | `src/community/browser.ts` | approved-model quick-pick + insert |
| Detection | `src/util/detectLanguage.ts` | language resolution (shared) |

---

## 4. esbuild Bundling — and Why It Matters

OWEN ships as a **single bundled file** (`out/extension.js`) produced by `esbuild.js`:

- `bundle: true`, `format: 'cjs'`, `platform: 'node'`, `target: 'node18'`.
- `external: ['vscode']` — the `vscode` module is provided by the host and must never be
  bundled.
- `.vscodeignore` excludes `node_modules/**` and `src/**` from the VSIX, so **runtime
  dependencies only ship if they are bundled into `out/extension.js`.** This is why
  `@supabase/supabase-js` (a real runtime dependency) must be reachable by esbuild.

Build commands (`package.json` scripts):

| Script | Command | When |
|--------|---------|------|
| `compile` | `node esbuild.js` | dev build (sourcemaps, no minify) |
| `watch` | `node esbuild.js --watch` | F5 / dev loop |
| `vscode:prepublish` | `npm run typecheck && node esbuild.js --production` | runs before `vsce package`/`publish` |
| `typecheck` | `tsc --noEmit` | type safety (esbuild does not type-check) |
| `lint` | `eslint src --ext ts` | |
| `test` | `node ./out/test/runTest.js` | needs a compiled build first |

> esbuild does **not** type-check. Always run `npm run typecheck` after non-trivial edits.

---

## 5. Naming & Identity — Keep These Stable

These values are load-bearing for the Marketplace / Open VSX listing and for in-place
updates. **Do not change them casually:**

| Field | Value | Notes |
|-------|-------|-------|
| `name` | `owen-neutronics` | extension id; was originally `owen` (renamed to avoid a clash). Changing it orphans existing installs. |
| `publisher` | `belvoirdynamics` | Marketplace/Open VSX publisher. |
| `displayName` | `OWEN — Open Workspace for Engineered Neutronics` | the human title (was "Open Workflow…"; "Workspace" is current). |
| Full extension id | `belvoirdynamics.owen-neutronics` | used in Marketplace/Open VSX URLs and `--install-extension`. |
| Command ids | `owen.*` | referenced by `package.json` contributions, menus, and `src/`. |

---

## 6. The Lazy-Supabase Rule (Critical)

`@supabase/supabase-js` is imported **dynamically**, inside `getSupabaseClient()` in
`src/community/client.ts`:

```ts
const { createClient } = await import('@supabase/supabase-js');
```

**Why:** a top-level `import { createClient } from '@supabase/supabase-js'` once crashed
extension **activation** outright — if the dependency failed to load, the whole extension
(every command, not just the community feature) became unavailable. The community feature
is also opt-in (`owen.community.enabled`, off by default) and ships with no credentials.

**Rules:**
- Keep the Supabase import lazy (`await import(...)` behind the command/feature flag).
- Never move it to a top-level `import` in `extension.ts` or any module loaded at activation.
- Keep `@supabase/supabase-js` in `dependencies` (not `devDependencies`) so esbuild bundles
  it into `out/extension.js`.

---

## 7. Validation, Preview, Sweep — Behavior Notes

- **Validation** (`validation/validator.ts`) emits diagnostics keyed by code. It encodes
  the nuclear-physics gotchas: ZAID format, density/fraction sign conventions, `mt`/S(α,β)
  only on hydrogen-bearing materials (MCNP); `IndependentSource`/`RectangularPrism` (OpenMC);
  `cuboid` vs `rect`, `trcl`, CLI `omp` (Serpent); `aceNeutronDatabase`, temperature-suffix
  matching, `pinUniverse` radii/fills (SCONE). `dispatch()` returns the array so tests can
  introspect without the UI.
- **Geometry extractor** (`preview/extractor.ts`) is a deliberate TypeScript port of GROVES'
  `analysis.py`. The design goal is **parity** with GROVES, not "best possible parsing" —
  if you change geometry behavior, change `groves/src/groves/analysis.py` too (or document
  the divergence).
- **Sweep** (`workflows/sweep.ts`) reads a JSON config (`baseFile`, `parameters[]` with a
  regex `pattern` whose group 1 is replaced, `output.dir`), takes the cartesian product,
  mutates the deck per run, spawns the solver via `planLaunch()` from `runner.ts`, parses
  k-eff (MCNP combined keff / OpenMC `Combined k-effective` / generic fallback), and writes
  `sweep-manifest.json` + `sweep-summary.tsv`.

---

## 8. Build, Package & Publish

```bash
cd owen
npm install
npm run typecheck          # tsc --noEmit
npm run lint               # eslint src --ext ts
npm run compile            # esbuild → out/extension.js
npm test                   # mocha via @vscode/test-electron (needs a build)

# Package a VSIX (vscode:prepublish runs typecheck + production esbuild)
npx @vscode/vsce package -o owen.vsix

# Publish (requires a Personal Access Token / namespace auth)
npx @vscode/vsce publish              # VS Code Marketplace (publisher: belvoirdynamics)
npx ovsx publish owen.vsix            # Open VSX (namespace: belvoirdynamics)
```

CI (`.github/workflows/owen-extension.yml` in the monorepo) runs install → typecheck →
lint → compile → test (under xvfb) → `vsce package` and uploads the VSIX artifact on
pushes/PRs touching `owen/**`.

> `*.vsix` is gitignored, but a few VSIX files were committed historically (e.g.
> `owen-0.1.0.vsix`). Don't add new ones; treat existing committed VSIXs as legacy
> artifacts.

---

## 9. Monorepo ↔ Public Mirror Sync

OWEN exists in **two repos that must stay identical** (excluding `node_modules/`, `out/`,
build artifacts, and repo-specific CI):

| Location | Repo / remote | Role |
|----------|---------------|------|
| `BelvoirDynamics/owen/` | monorepo (`caalh/BelvoirDynamics`) | canonical source, has CI in `.github/` |
| `owen-public/` | `caalh/owen` (remote `origin`) | public mirror, what gets packaged/published |

**When you change one, apply the same change to the other.** This guide and the other AI
docs (`PROJECT_STRUCTURE.md`, `AI_CHANGELOG.md`, `AGENTS.md`) live in both copies.

---

## 10. Gotchas Checklist (read before committing)

- [ ] Keep `@supabase/supabase-js` a **lazy** `await import()` in `community/client.ts`.
- [ ] Don't rename `src/workflows/` or its files — `owen.runSimulation` / `owen.runSweep`
      import from there.
- [ ] Don't rename `.github/workflows/` — that's GitHub Actions, not an OWEN feature.
- [ ] Don't change `name` (`owen-neutronics`), `publisher` (`belvoirdynamics`), or the
      `owen.*` command ids without understanding the Marketplace/install impact.
- [ ] Run `npm run typecheck` (esbuild does not type-check).
- [ ] Keep runtime deps in `dependencies` so esbuild bundles them (`.vscodeignore` drops
      `node_modules/`).
- [ ] Mirror every change to **both** `owen/` and `owen-public/`.
- [ ] Update `CHANGELOG.md` (user-facing) and `AI_CHANGELOG.md` (engineering) for notable
      changes.
- [ ] Geometry changes: keep parity with `groves/src/groves/analysis.py`.
