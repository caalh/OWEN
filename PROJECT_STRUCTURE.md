# OWEN — Project Structure

Annotated layout of the **OWEN** VS Code / Cursor extension. OWEN lives in the
BelvoirDynamics monorepo at `owen/` and is mirrored to the public repo `caalh/owen`; both
copies share this structure. For architecture and the rules behind it, see
`AI_MAINTAINER_GUIDE.md`.

```
owen/
├── src/                              # TypeScript source (bundled by esbuild → out/)
│   ├── extension.ts                  # activate(): registers all owen.* commands
│   ├── commands/
│   │   ├── insertMaterial.ts         # owen.insertMaterial — NRDP material → language-aware code
│   │   ├── openTutorial.ts           # owen.openTutorial — deep-link into reactormc.net
│   │   └── openPrebuiltModel.ts      # owen.openPrebuiltModel — bundled BEAVRS + assembly decks
│   ├── allen/
│   │   ├── detectNuclides.ts         # harvest ZAIDs/nuclides from active deck
│   │   ├── fetch.ts                  # NRDP manifest + curve JSON
│   │   └── panel.ts                  # owen.openAllen — uPlot σ(E) webview
│   ├── panels/
│   │   └── latticeBuilder.ts         # owen.openLatticeBuilder — webview grid → lattice code
│   ├── preview/
│   │   ├── extractor.ts              # deck text → CylinderSpec[] (port of GROVES analysis.py)
│   │   ├── webview.ts                # owen.openGeometryPreview — Three.js 3D webview
│   │   ├── radialStructure.ts        # BEAVRS barrel/shields/RPV/baffle emitters
│   │   └── codes/                    # mcnp.ts, openmc.ts, serpent.ts, scone.ts
│   ├── validation/
│   │   └── validator.ts              # owen.validateInput — per-language diagnostics
│   ├── workflows/                    # DO NOT RENAME (owen.runSimulation / owen.runSweep)
│   │   ├── runner.ts                 # planLaunch() + launch solver in a terminal
│   │   └── sweep.ts                  # JSON param sweep → mutate, run, parse k-eff, manifest+TSV
│   ├── community/
│   │   ├── client.ts                 # LAZY @supabase/supabase-js import (activation-safe)
│   │   └── browser.ts                # owen.searchReactorLibrary — approved-model quick-pick
│   ├── util/
│   │   └── detectLanguage.ts         # langId / Python-openmc-import → MonteCarloLanguage
│   └── test/
│       ├── runTest.ts                # @vscode/test-electron launcher
│       └── suite/
│           ├── index.ts              # Mocha bootstrap
│           ├── extractor.test.ts     # geometry-extractor tests
│           └── validator.test.ts     # validation tests
│
├── prebuilt-models/                  # Bundled BEAVRS full core + assembly starters (VSIX-shipped)
│   └── index.json                    # manifest for owen.openPrebuiltModel
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
out/extension.js        # esbuild bundle — the actual extension entry (package.json "main")
out/test/**             # compiled test suite (npm test target)
*.vsix                  # packaged extension (npx @vscode/vsce package)
```

## Activation flow (summary)

`extension.ts` `activate()` registers eight `owen.*` commands and does no heavy work.
Each command resolves the active document's language via `util/detectLanguage.ts`, then
delegates to its module. See `AI_MAINTAINER_GUIDE.md` §3 for the full map and §6 for the
lazy-Supabase activation rule.
