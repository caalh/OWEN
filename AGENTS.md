# AGENTS.md — OWEN extension

Quick rules for AI agents (Cursor, Copilot, etc.) working in this repo. For the full
picture read `AI_MAINTAINER_GUIDE.md` and `PROJECT_STRUCTURE.md`. Record notable changes in
`AI_CHANGELOG.md` (engineering) and `CHANGELOG.md` (user-facing).

OWEN — **Open Workspace for Engineered Neutronics** — is a VS Code / Cursor extension for
MCNP, OpenMC, Serpent, and SCONE input files. Current release: **v0.3.1** (stable, published on
the VS Code Marketplace and Open VSX); **v0.3.2 is built locally (VSIX) but not yet published**.
It is a **BelvoirDynamics** product; its desktop sibling is **GROVES** (v1.1.0).

## Key modules (v0.3.x)

| Area | Path | Notes |
|------|------|-------|
| ALLEN σ(E) webview | `src/allen/` | `owen.openAllen`; data from `owen.allen.dataBaseUrl` |
| 3D preview | `src/preview/` | `extractor.ts`, `webview.ts`, `radialStructure.ts`, `codes/*` |
| Prebuilt models | `prebuilt-models/` + `src/commands/openPrebuiltModel.ts` | BEAVRS full core + assembly starters |
| Lattice builder | `src/panels/latticeBuilder.ts` | Editable identifiers; SCONE generator (v0.2.4+) |

## Hard rules — do not break these

1. **Keep Supabase lazy.** `@supabase/supabase-js` must be loaded via `await import()`
   inside `src/community/client.ts`, never as a top-level import. A top-level import once
   crashed extension activation for every command. Keep it in `dependencies` so esbuild
   bundles it.
2. **Don't rename `src/workflows/`** (or `runner.ts` / `sweep.ts`). It backs the
   `owen.runSimulation` and `owen.runSweep` commands. This is unrelated to the "Workflow →
   Workspace" *branding* change, which only touches the product title.
3. **Don't rename `.github/workflows/`** — that's GitHub Actions CI, not an OWEN feature.
4. **Keep identity stable:** `name` = `owen-neutronics`, `publisher` = `belvoirdynamics`,
   `displayName` = `OWEN — Open Workspace for Engineered Neutronics`, command ids = `owen.*`.
   Changing these breaks Marketplace listings and existing installs.
5. **Sync both copies.** This extension exists in `BelvoirDynamics/owen/` (monorepo) and
   `caalh/owen` (public mirror). Apply every change to both.

## Build / verify

```bash
npm install
npm run typecheck     # esbuild does NOT type-check — always run this
npm run lint
npm run compile       # esbuild → out/extension.js
npm test              # @vscode/test-electron (needs a build first)
npx @vscode/vsce package -o owen.vsix
```

## Branding note: "Workflow" vs "Workspace"

The product title is **"Open Workspace for Engineered Neutronics"**. When sweeping for
"Workflow", only change the **title/tagline**. Leave alone: the `src/workflows/` code, the
`.github/workflows/` CI, and generic feature phrasing like "workflow automation" or
"parameter sweep workflow".

## Nuclear-domain reminders (relevant to validation & snippets)

- MCNP: density sign (− = g/cm³, + = atoms/b·cm); material fraction sign (− = weight,
  + = atom); ZAID `ZAAA.TTc`; `mt`/S(α,β) only on hydrogen-bearing materials (water), never
  on UO₂ fuel.
- OpenMC: `IndependentSource`, `RectangularPrism` (class), temperature on cells not
  materials.
- Serpent: `cuboid` (not `rect`); CLI `sss2 -omp N` (not `set omp`).
- SCONE: `aceNeutronDatabase`; ZAID temp suffix must match `temp`; `pinUniverse` `radii`
  length == `fills` length.
- Geometry preview parity: `src/preview/extractor.ts` mirrors GROVES'
  `groves/src/groves/analysis.py` — change both or document the divergence.
