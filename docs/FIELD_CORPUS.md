# Field corpus — real decks for Cell Map, Check Geometry, and 3D

OWEN's advanced geometry tools used to train on pin cells, a 17×17, and BEAVRS.
Researchers open *their* repo: split `include` files, named universes, OpenMC
Python, hex lattices, vertical stacks, DAGMC. This corpus is that folder.

## Run

```
npm run field-corpus:fetch    # pin GitHub SHAs into .field-corpus/cache/
npm run verify:field-corpus   # Cell Map + Check Geometry + 3D + workspace + convert
```

Report: `.field-corpus/report/index.html` (gitignored; per-deck warnings,
workspace errors, midplane PNG). Field-day folder for a local VSIX:
`.field-corpus/field-day/`.

50 decks as of Sep 2026: 11 prebuilts, 14 frozen fixtures, 11 MIT decks from
`openmc-dev/openmc` (examples + regression-test XML), 2 from
`openmc-dev/openmc_mcnp_adapter` (Tinkertoy, a nested `read` chain), 12 from
`CambridgeNuclear/SCONE` `InputFiles/`.

## Gates (tier-1 `gate: true`)

A deck fails the run when any of these appear: `unknown-universe` (a fill of
a universe the joined project does define), `placeholder-pin`, `empty-map`,
`empty-3d` (cells parsed but nothing drawn — unless `expect.allowEmptyCylinders`
or an `expect.warning` names the honest skip), `false-lost` (Check Geometry
or the slice loses every point), `no-regions`, `unexpected-orphan` (an
orphan universe the manifest does not list in `allowOrphanIds` /
`allowOrphans`). Python without sibling XML records `blocked: no-openmc-xml`
instead of a fake pass.

## OpenMC oracle

`src/test/fixtures/field-corpus/openmc-oracle/` holds lattices whose every
element is a unique material plus the answers `openmc.Geometry.find()` gave
at 1200 random points each (hex y, hex x, hex 3D, rect 3D). The unit test
fails if the hex ring order, orientation, axial order or rect row order drift.
Regenerate with `make_oracle.py` under a Python that has OpenMC (WSL:
`/opt/miniconda3/bin/python`). The same script family in
`.field-corpus/oracle/` (gitignored) ran the upstream VVER hex assembly and
the other regression XML decks: 13 decks, 43 000 points, 0 disagreements.

## Add a deck

1. Confirm the license is MIT, BSD, Apache, or CC-BY, **or** mark
   `redistribute: false` and never commit the files.
2. Add a row to `src/test/field-corpus/manifest.json`:
   - `kind: "local"` — path inside this repo (fixtures, prebuilts).
   - `kind: "github"` — `repo` + `files` (a path, or `{ path, saveAs }` when
     upstream has no extension) + SHA under `github.<repo>.sha`.
   - `kind: "sibling"` — path relative to this repo (ReactorMC site examples).
3. Cover a matrix hole if you can: split files, named universes, hex, nested
   lattice, vertical stack, non-lattice CSG, OpenMC Python without a literal
   grid, axial/`trans`, or an honest skip (`pbed`, DAGMC, `nest`, `umsh`).
4. Freeze a regression as `src/test/fixtures/field-corpus/<id>/` and a test in
   `src/test/suite/fieldCorpus.test.ts`.
5. Do **not** vendor LANL MCNP primers, ICSBEP, or GPL CAD (openmsr/msre).

## Local VSIX shot list

Sideload `owen-neutronics-1.4.7-local.vsix` (work sits under Unreleased until
a 1.4.8 GitHub release). Open `.field-corpus/field-day/` and send screenshots of:

1. Cell Map on `fixture-serpent-include/main.sss` — pin **F** is a live universe,
   not under "Not placed anywhere".
2. Check Geometry on that same file — not 1500/1500 lost.
3. 3D of `openmc-xml-lattice-hex/geometry.xml` — the VVER-1000 hex assembly
   (331 pins, 18 cluster tubes, central guide tube).
4. 3D of `openmc-ex-lattice-hex/build_xml.py` — hex from Python via its
   sibling XML (the top element of each ring is moderator, by design).
5. 3D of `fixture-mcnp-showcase/showcase.i` — CSG gallery, not a 0.4 cm pin.
6. 3D of `adapter-tinkertoy/tinkertoy.mcnp` — 3×3×3 array in a concrete room.
7. 3D + Cell Map of `fixture-serpent-stack/main.sss` — vertical stack columns.
8. Problems panel on `fixture-mcnp-read/main.i` and `fixture-mcnp-lat3d/stack.i`
   — `unknown-universe` count is 0.
9. Cell Map / 3D on `fixture-openmc-dagmc/geometry.xml` — named DAGMC skip.
10. Check Geometry on `scone-JEZ/JEZ.scone` — 0 lost (was ~47 %).

Do not treat BEAVRS MCNP `u=16` as a bug; the bundled deck documents it as an
unused dashpot universe. The upstream SCONE BEAVRS2D keeps pin32 / pin34 /
pinSteel it never places — also true dead input.
