# Results-parser fixtures

Where each file came from, because a fixture invented to match a parser proves
nothing. Fixtures are excluded from the VSIX (`src/**` in `.vscodeignore`).

| File | Provenance |
|---|---|
| `openmc_statepoint.30.h5` | Real OpenMC 0.15.3 run. Reflective UO2 pin cell, 30 batches / 10 inactive / 500 particles, ENDF/B-VIII.0. Three tallies: energy-filtered flux, per-nuclide reaction rates, 4×4×1 fission mesh. Generated on this machine under WSL; the generator is `scripts/verify-results.mjs --regenerate`. |
| `openmc_tallies.out` | Written by that same run (`settings.output = {'tallies': True}`). |
| `openmc_run.log` | stdout of that same run, including the batch table and the four k-eff estimators. |
| `mcnp_outp.txt` | Synthetic, but in the layout of real MCNP 6 output: written by copying the section structure of production `outp` files (tally block, volumes listing, energy bins with a `total` row, the ten statistical checks, TFC chart, `1status of the statistical checks`, final combined k-eff, `computer time`). Values are made up; the *shape* is not. |
| `sample.mctal` | Synthetic, in the ASCII mctal layout documented by the reference parser `kbat/mc-tools` (`mctools/mcnp/mctal.py`). No real mctal was available on this machine. |
| `sample_res.m` | Synthetic Serpent 2 `_res.m` in the real indexed-assignment form (`IMP_KEFF (idx, [1: 2]) = [ … ];`), two burnup steps. |
| `sample_det0.m` | Synthetic Serpent 2 detector file: 12-column `DET<name>` rows (value = column 11, relative error = column 12) with a matching 3-column `DET<name>E` energy grid in MeV. |
| `sample_scone.m` | Synthetic SCONE asciiMATLAB output, following `asciiMATLAB_class.f90` (one entry per line, `reshape` for rank > 1, `{'text'}` for characters) and the entry names the eigenvalue physics package and keff clerks actually print. |
| `sample_scone_console.txt` | Synthetic SCONE console output: the `Cycle:` / `k-eff (analog):` lines produced by `keffAnalogClerk::display`. |
| `sample_openmc.log.txt` | Older minimal OpenMC log kept as a regression anchor for the combined-k-eff line. |

Real MCNP output files live outside this repository (they are research data). The
standing check picks them up when present — see `scripts/verify-results.mjs` and
its `OWEN_MCNP_OUTP` environment variable.

## `serpent-tools/` — real Serpent 2 outputs

Downloaded Sep 2026 from [CORE-GATECH-GROUP/serpent-tools](https://github.com/CORE-GATECH-GROUP/serpent-tools)
(`src/serpentTools/data`, MIT license) — files written by Serpent itself, not
synthesized to match our parser. `bwr_his0.m` (cycle history with a restarting
counter; caught the his-detection gap), `pwr_res.m` (two burnup steps),
`ref_det0.m` (5×5 xy mesh detector × 2 reactions; drives the mesh
reconstruction), `fuelPin_det0.m` (16 axial bins, 1 energy bin — must NOT
become a spectrum), `radplot_det0.m`, `hexplot_det0.m`. Tests:
`suite/realOutputs.test.ts`.
