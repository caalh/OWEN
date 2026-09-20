# Field-corpus fixtures

Tiny decks that freeze the failures a researcher hits when Cell Map / Check
Geometry / 3D read only the active file, or meet a construct the PWR pin
extractor never saw. Written for OWEN (not copied from LANL or ICSBEP).
Larger MIT decks are fetched by SHA — see `src/test/field-corpus/manifest.json`
and `docs/FIELD_CORPUS.md`.

| Folder | What it freezes |
|---|---|
| `mcnp-read/` | Pin universe in a `read file=` include |
| `mcnp-lat3d/` | 3D lattice, `u=-n`, `#cell` complement, z-planes listed first |
| `mcnp-csg/` | Non-lattice CSG; `showcase.i` has `LIKE n BUT`, macrobodies, `*TR` |
| `serpent-include/` | Pin in `include "pins.sss"`, named lattice universe |
| `serpent-hex/` | `lat … 2` hex with `hexxc` boundary |
| `serpent-stack/` | `lat … 9` vertical stack inside a square lattice |
| `serpent-nest/` | Honest skip: `nest` |
| `openmc-split/` | Python geometry built in an imported module |
| `openmc-hex/` | `<hex_lattice>` 3 rings with `<outer>`, split XML set |
| `openmc-dagmc/` | Honest skip: `<dagmc_universe>` |
| `openmc-oracle/` | OpenMC 0.15.3 `Geometry.find()` answers for hex y / hex x / hex 3D / rect 3D |
| `scone-lat/` | `latUniverse` map of plain ids, root ≠ 0 |
