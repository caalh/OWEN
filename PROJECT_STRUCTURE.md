# OWEN — Project Structure

Annotated layout of the **OWEN** VS Code / Cursor extension. OWEN lives in the
BelvoirDynamics monorepo at `owen/` and is mirrored to the public repo `caalh/owen`; both
copies share this structure. For architecture and the rules behind it, see
`AI_MAINTAINER_GUIDE.md`.

```
owen/
├── src/                              # TypeScript source (bundled by esbuild → out/)
│   ├── extension.ts                  # activate(): registers all owen.* commands + LSP client
│   ├── commands/
│   │   ├── insertMaterial.ts         # owen.insertMaterial — NRDP material → language-aware code
│   │   ├── openTutorial.ts           # owen.openTutorial — deep-link into reactormc.net
│   │   └── openPrebuiltModel.ts      # owen.openPrebuiltModel — bundled benchmark decks
│   ├── language/                     # pure shared rules layer (no vscode imports)
│   │   ├── rules.ts                  # every validator rule + MCNP line length (LSP + manual)
│   │   ├── crossReference.ts         # MCNP undefined-ref errors / unused-def hints
│   │   └── types.ts                  # PlainDiagnostic (editor-agnostic shape)
│   ├── server/                       # MC Language Server → bundled to out/server.js
│   │   ├── main.ts                   # entry (IPC from VS Code; --stdio for other editors)
│   │   ├── server.ts                 # startLanguageServer(): diagnostics/hover/def/refs
│   │   └── symbols.ts                # grouped document outline
│   ├── lsp/
│   │   └── client.ts                 # vscode-languageclient — spawns out/server.js (IPC)
│   ├── allen/
│   │   ├── detectNuclides.ts         # harvest ZAIDs/nuclides from active deck
│   │   ├── fetch.ts                  # NRDP manifest + curve JSON
│   │   ├── plotConfig.ts             # pure uPlot log-scale + Doppler math helpers
│   │   └── panel.ts                  # owen.openAllen — uPlot σ(E) webview + Doppler Studio
│   ├── converter/                    # owen.convertDeck (MCNP↔OpenMC + MCNP→Serpent/SCONE)
│   │   ├── mcnpModel.ts              # MCNP deck → intermediate representation
│   │   ├── mcnpToOpenmc.ts / openmcToMcnp.ts / mcnpToSerpent.ts / mcnpToScone.ts
│   │   ├── rosettaView.ts            # side-by-side Rosetta diff webview
│   │   └── command.ts, index.ts, types.ts, zaid.ts
│   ├── results/                      # owen.openResults — Results Viewer
│   │   ├── parsers/                  # openmc (h5wasm+stdout), mcnp (mctal), serpent, scone
│   │   ├── detectOutputs.ts, panel.ts, index.ts, types.ts
│   ├── verify/
│   │   ├── core.ts                   # owen.verifyGeometry — overlap scan + lost-particle probe
│   │   └── panel.ts
│   ├── panels/
│   │   ├── latticeBuilder.ts         # owen.openLatticeBuilder — webview grid → lattice code
│   │   ├── latticeCodegen.ts         # pure MCNP/OpenMC/Serpent/SCONE generators
│   │   └── inputBuilder.ts           # owen.openInputBuilder — five-step wizard webview
│   ├── inputBuilder/
│   │   ├── materials.ts              # 18-material library with per-code renderers
│   │   └── deckBuilder.ts            # pin-cell / lattice starter deck assembly
│   ├── preview/
│   │   ├── extractor.ts              # deck text → CylinderSpec[] (port of GROVES analysis.py)
│   │   ├── webview.ts                # owen.openGeometryPreview — Three.js 3D webview
│   │   ├── radialStructure.ts        # BEAVRS barrel/shields/RPV/baffle emitters
│   │   ├── budget.ts, measure.ts, palette.ts, types.ts
│   │   ├── codes/                    # mcnp.ts, openmc.ts, serpent.ts, scone.ts
│   │   └── openmcNative/             # owen.renderWithOpenmc (core/detect/panel)
│   ├── references/                   # MCNP cross-reference index + tree view
│   │   └── mcnpReferences.ts, providers.ts, referencesView.ts
│   ├── decorations/                  # invisibles toggle + MCNP line-length guard
│   ├── completions/
│   │   └── snippets.ts               # CompletionItemProvider serving bundled snippets
│   ├── highlight/                    # 4-palette highlight picker + preview panel
│   ├── validation/
│   │   └── validator.ts              # owen.validateInput — thin wrapper over language/rules.ts
│   ├── workflows/                    # DO NOT RENAME (owen.runSimulation / owen.runSweep)
│   │   ├── runner.ts                 # planLaunch() + launch solver in a terminal
│   │   ├── sweep.ts, sweepCore.ts    # JSON param sweep → mutate, run, parse k-eff, manifest+TSV
│   │   └── sweepDashboard.ts, sweepDashboardCore.ts  # owen.viewSweepResults dashboard
│   ├── community/
│   │   ├── client.ts                 # LAZY @supabase/supabase-js import (activation-safe)
│   │   └── browser.ts                # owen.searchReactorLibrary — approved-model quick-pick
│   ├── util/
│   │   └── detectLanguage.ts         # langId / Python-openmc-import → MonteCarloLanguage
│   └── test/
│       ├── runTest.ts                # @vscode/test-electron launcher
│       ├── fixtures/                 # sample mctal / _res.m / scone.out / openmc log
│       └── suite/                    # Mocha suites (423 headless tests as of 0.3.7)
│
├── prebuilt-models/                  # Bundled decks (VSIX-shipped, LF-only via .gitattributes)
│   │                                 #   BEAVRS full core ×4 codes, 17×17 assembly ×3,
│   │                                 #   reflected pin cell ×4 (added 0.3.6)
│   └── index.json                    # manifest for owen.openPrebuiltModel
├── docs/                             # LSP_DESIGN.md, SWEEP_VALIDATION.md, OPENMC_EVALUATION.md
├── syntaxes/                         # TextMate grammars
│   ├── mcnp.tmLanguage.json
│   ├── serpent.tmLanguage.json
│   └── scone.tmLanguage.json
├── snippets/                         # Snippets per language
│   ├── mcnp.json
│   ├── openmc.json                   # contributed to the `python` language
│   ├── serpent.json
│   └── scone.json
├── language-configuration/           # Brackets/comments per language
│   ├── mcnp.language-configuration.json
│   ├── serpent.language-configuration.json
│   └── scone.language-configuration.json
├── data/                             # Bundled snapshots (live refresh optional)
│   ├── nrdp-materials.json           # NRDP materials (owen.insertMaterial)
│   ├── nrdp-elements.json            # NRDP elements
│   └── tutorial-links.json           # tutorial deep-links (owen.openTutorial)
├── assets/
│   ├── owen-icon.png                 # Marketplace icon (package.json "icon")
│   └── belvoirdynamics-b.png         # brand mark (excluded from VSIX via .vscodeignore)
├── scripts/                          # Node .mjs build/export helpers
│   ├── generate-icon.mjs             # renders assets/owen-icon.png (pngjs)
│   ├── export-nrdp-snapshot.mjs      # refresh data/nrdp-*.json
│   └── export-tutorial-links.mjs     # refresh data/tutorial-links.json
│
├── esbuild.js                        # bundle src/extension.ts → out/extension.js (CJS)
├── package.json                      # manifest: name owen-neutronics, publisher belvoirdynamics
├── package-lock.json
├── tsconfig.json                     # tsc --noEmit (type-check only; esbuild emits)
├── .eslintrc.json
├── .vscodeignore                     # VSIX exclusions (drops src/, node_modules/, scripts/)
├── .gitignore                        # node_modules/, out/, *.vsix, .vscode-test/
├── LICENSE                           # MIT
├── CHANGELOG.md                      # Keep-a-Changelog (user-facing release notes)
├── README.md                         # Marketplace README
├── AI_MAINTAINER_GUIDE.md            # how AI agents should work in this repo
├── PROJECT_STRUCTURE.md              # this file
├── AI_CHANGELOG.md                   # engineering changelog (AI-made changes)
└── AGENTS.md                         # quick rules for AI agents
```

## Build output (gitignored)

```
out/extension.js        # esbuild bundle — the extension host entry (package.json "main")
out/server.js           # esbuild bundle — the MC Language Server (spawned child process)
out-test/**             # compiled test suite (npm test target)
*.vsix                  # packaged extension (@vscode/vsce package)
```

## Activation flow (summary)

`extension.ts` `activate()` registers the `owen.*` commands, starts the LSP client for
mcnp/serpent/scone, and does no heavy work. Each command resolves the active document's
language via `util/detectLanguage.ts`, then delegates to its module. See
`AI_MAINTAINER_GUIDE.md` §3 for the full map and §6 for the lazy-Supabase activation rule.
