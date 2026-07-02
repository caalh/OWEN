# MC Language Server — Design Note (Phase 0, written before implementation)

Status: design accepted, implemented in OWEN 0.3.5 (Item 1 of the July 2026 roadmap).

## Decision: server lives in `owen/src/server/`, not a monorepo top-level package

The public mirror `caalh/owen` must stay byte-identical to monorepo `owen/`. A top-level
`mc-language-server/` package would not ship in the mirror, so the server sources live
inside `owen/` and are bundled into the VSIX. Another editor consumes the *bundled*
`out/server.js` (or builds it from the public repo), so multi-editor reuse is preserved.
A second reason: worker A is concurrently adding top-level monorepo folders; keeping the
server inside `owen/` avoids tree-level merge contention.

Amendment during implementation: the server sources moved from the planned
`owen/server/src/` to `owen/src/server/` — one `tsconfig`/`rootDir`, one eslint scope,
one `out-test` tree, and plain relative imports into the shared rules layer. The
deliverable is unchanged (a self-contained `out/server.js`).

## Architecture

```
owen/src/
├── extension.ts            ← activates LSP client (vscode-languageclient/node)
├── lsp/client.ts           ← LanguageClient setup: module out/server.js, IPC transport
├── language/               ← PURE shared rules (no vscode, no vscode-languageserver)
│   ├── types.ts            ← PlainDiagnostic {line, startCol, endCol, message, severity, code}
│   ├── rules.ts            ← all validator rules as pure functions (text → PlainDiagnostic[])
│   └── crossReference.ts   ← MCNP undefined/unused diagnostics from the references index
├── validation/validator.ts ← thin wrapper: manual command, converts PlainDiagnostic → vscode.Diagnostic
├── references/mcnpReferences.ts  ← already vscode-free; reused verbatim by the server
└── server/
    ├── main.ts             ← entry: createConnection(ProposedFeatures.all) — IPC or --stdio
    ├── server.ts           ← startLanguageServer(connection): testable with in-memory streams
    └── symbols.ts          ← document symbols (MCNP grouped outline, Serpent/SCONE regex outline)
```

- **Shared rules layer** (`src/language/rules.ts`): every rule from the old regex validator
  is ported to a pure function keyed by language. Both the LSP server (real-time) and the
  legacy `owen.validateInput` command (manual, kept for UX continuity) call the same code,
  so behavior cannot diverge.
- **Server** (`owen/server/`): `vscode-languageserver` + `vscode-languageserver-textdocument`
  over **IPC**. Validates on open/change with a 300 ms debounce. For MCNP it additionally
  builds the `mcnpReferences` index and emits cross-reference diagnostics:
  - undefined surface / material / universe referenced by a cell → **Error**
  - defined but never referenced entity → **Hint** with `DiagnosticTag.Unnecessary`
- **Client** (`src/lsp/client.ts`): documentSelector = `mcnp`, `serpent`, `scone`.
- **LSP features beyond diagnostics** (MCNP, from the references index): hover,
  go-to-definition, find-references, document highlight, document symbols
  (cells / surfaces / materials / tallies outline). Serpent/SCONE get document symbols
  from lightweight regex outlines.

## Deliberate choices

1. **OpenMC (.py) stays client-side.** Pylance owns Python; wiring our server into `python`
   documents risks provider conflicts for near-zero gain. The OpenMC gotcha rules still run
   through the shared rules layer via the manual validate command (unchanged behavior).
2. **Completion stays client-side.** Snippets are contributed declaratively via
   `package.json`; porting them into the server would duplicate a working mechanism for no
   user-visible improvement. Documented here as an accepted deviation.
3. **Old MCNP client-side hover/def/refs/highlight providers are removed** in favor of the
   LSP ones (same index, same strings) to avoid double results. The MCNP References *tree
   view* stays client-side — it is a UI feature, not a language feature.
4. **`owen.validateInput` command survives** as a manual "count the issues" action, but for
   mcnp/serpent/scone it no longer writes its own diagnostics collection (the LSP owns
   diagnostics for those; the command reports counts from the shared rules). For OpenMC
   Python files it works exactly as before.

## Testing strategy

- Existing `validator.test.ts` suite must keep passing against the wrapper (API-compatible
  `runValidators()`).
- New `language.rules` tests hit the pure layer directly.
- New LSP-level test: start `startLanguageServer()` in-process on a pair of PassThrough
  streams, drive it with a raw `vscode-jsonrpc` client connection (`initialize` →
  `didOpen`), and assert on the published diagnostics. No child process, no editor host.

## Bundling

`esbuild.js` gains a second entry point: `server/src/main.ts → out/server.js`
(same options; `vscode` external is irrelevant for the server but harmless).
`.vscodeignore` adds `!out/server.js`. Verify with `vsce ls` that both files ship.

## How another editor consumes this server

See "Multi-editor use" in `AI_MAINTAINER_GUIDE.md` §LSP. Short version: any LSP client can
launch `node out/server.js --stdio` (the entry supports both IPC when spawned by
vscode-languageclient and `--stdio` for generic clients) and associate it with MCNP/Serpent/
SCONE file types.
