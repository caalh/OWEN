# OWEN converter vs. the official OpenMC adapters — side-by-side (2026-08-02)

Measured comparison between OWEN's built-in MCNP→OpenMC converter
(`owen.convertDeck`) and the OpenMC team's own converters, which OWEN can now
drive as an optional backend (`owen.convertDeckAdapter`):

- [`openmc-dev/openmc_mcnp_adapter`](https://github.com/openmc-dev/openmc_mcnp_adapter) (MIT, alpha, no release tags)
- [`openmc-dev/openmc_serpent_adapter`](https://github.com/openmc-dev/openmc_serpent_adapter) (MIT, alpha, no release tags)

Everything below was measured on this machine — OpenMC 0.15.3 (conda-forge,
WSL Ubuntu 24.04), adapters installed from git `main` on 2026-08-02 — using
the three bundled prebuilt MCNP decks and two bundled Serpent decks. Loading
and structural comparison were done with real `openmc` Python objects
(`Model.from_model_xml`); no transport was run (no nuclear data library on
this machine).

## Headline results

| Deck | OWEN converter | openmc_mcnp_adapter |
|------|----------------|---------------------|
| `pincell_mcnp.i` | OK, 0 issues | OK |
| `assembly_17x17_mcnp.i` | OK, 0 issues | OK (after deck fix, see below) |
| `beavrs_fullcore_mcnp.i` | OK, 0 issues | **Fails — nested lattices unsupported** |

| Deck | openmc_serpent_adapter |
|------|------------------------|
| `pincell_serpent.sss` | OK (complete geometry; `lwj3` → `c_H_in_H2O` with a printed warning) |
| `assembly_17x17_serpent.sss` | **Silently wrong** — lattice + materials converted, but the three `pin` universes it references came out empty, and only 3 of the 4 outer faces of the `sqc` box got a vacuum boundary |

## Structural agreement where both succeed

Pin cell (MCNP): **exact match** — same cell/surface/universe counts, same
bounding box, identical per-nuclide compositions and densities to the digit,
same boundary conditions, same `c_H_in_H2O` S(α,β).

Assembly (MCNP): physics-equivalent. All five materials identical after the
deck fix. Counts differ for bookkeeping reasons only: the adapter's default
`--merge-surfaces` merges redundant surfaces and renumbers them (its outer
vacuum planes come out as ids 61–66 at the same coordinates OWEN keeps as
10/13–17), and graveyard/root handling differs by one cell and one universe.
Bounding boxes agree exactly.

## Differences that matter

1. **Scope.** The adapters convert geometry + materials only (their README
   says so): SDEF/KCODE/KSRC and all tallies are ignored. The MCNP adapter
   hardcodes placeholder settings — 40 batches / 20 inactive / 100 particles
   and a point source at the bounding-box centre. OWEN carries the deck's
   kcode (250/50/5000 on the pin cell), ksrc, and tallies. Notably the
   *Serpent* adapter does carry `set pop`.
2. **Nested lattices.** BEAVRS puts 17×17 assembly lattices inside the core
   lattice. The MCNP adapter passes a `RectLattice` directly as a lattice
   element, which OpenMC rejects (`TypeError: … item at [1, 5] is of type
   "RectLattice"`) — OpenMC requires lattices wrapped in a universe. OWEN
   wraps them, which is why the full core converts.
3. **Silent physics loss is possible.** Two measured cases:
   - The assembly deck's `m3` continuation line was indented 4 spaces
     (column 5). The adapter silently dropped the line — Zr94 + Zr96 gone,
     ~20% of zirconium missing, no warning. (Real MCNP would fatal on the
     line, since card names live in columns 1–5; see the deck-bug section.)
   - The Serpent assembly conversion produced a lattice whose pin universes
     have no cells — a hollow assembly — with exit code 0.
4. **Error behavior.** When the adapter fails it fails with a Python
   traceback (good). When OWEN can't map a construct it emits
   `TODO(owen-convert)` comments and lists issues in the Rosetta view. Both
   are honest; the danger cases are the silent ones in point 3.
5. **Element expansion.** The adapter expands natural elements to isotopes
   with its own abundance data (`--no-expand-elements` to disable). OWEN
   preserves what the deck wrote. Both are defensible; outputs differ
   textually but not physically for the decks tested.

## What the comparison caught in OUR stuff (fixed 2026-08-02)

Running a second, independent converter over the bundled decks was an
effective audit. It found two latent bugs in `prebuilt-models/` that OWEN's
own (lenient) parser masked:

1. **`assembly_17x17_mcnp.i` line 72** — the `m3` continuation indented 4
   spaces (column 5). MCNP card names may start in columns 1–5, so real MCNP
   reads `40094.80c` as an unknown card: fatal. Fixed to column 7. A new
   validator rule (`mcnp.short-continuation`) now flags this pattern.
2. **`beavrs_fullcore_mcnp.i` cell 61** — the u=30 water cell had *no
   geometry specification*, which is only legal for `like n but` cells.
   Fixed to the standard infinite-cell idiom `-3:3`. (Both fixes applied to
   the monorepo, `caalh/owen`, and the GROVES copy.)

## Verdict

- Keep OWEN's converter as the primary path: it is the only one of the two
  that carries sources/tallies, survives BEAVRS-class nesting, and reports
  what it couldn't map.
- The adapter backend is valuable as a **second opinion** — it builds real
  `openmc.Model` objects, so whatever it emits is definitionally loadable —
  and as an independent audit tool (see above). The command's result message
  states the geometry+materials-only scope every time.
- Treat both adapters as alpha (their own README: "no methodical V&V; use at
  your own risk"), and treat the Serpent adapter's output as requiring
  manual review always.

## Reproduction

```bash
# WSL (no sudo): micromamba + conda-forge OpenMC, adapters from git
micromamba create -y -p ~/omc-env -c conda-forge python=3.12 openmc
~/omc-env/bin/python -m pip install \
    git+https://github.com/openmc-dev/openmc_mcnp_adapter.git \
    git+https://github.com/openmc-dev/openmc_serpent_adapter.git
~/omc-env/bin/mcnp_to_openmc prebuilt-models/pincell_mcnp.i -o pincell_model.xml
~/omc-env/bin/serpent_to_openmc prebuilt-models/pincell_serpent.sss  # writes model.xml in CWD
```

OWEN's side of the comparison: bundle `src/converter/index.ts` with esbuild
and call `convert('mcnp', 'openmc', deckText)` headlessly (same pattern as
`scripts/verify-mcnp-rules.mjs`).
