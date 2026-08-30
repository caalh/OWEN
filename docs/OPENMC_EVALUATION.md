# OWEN — OpenMC Capability Evaluation Plan

A hands-on test matrix for evaluating what the **OWEN** VS Code / Cursor extension can
actually do with **OpenMC**. Every test is grounded in the real extension source
(`owen/src/`, `owen/package.json`) as of v0.1.0 — no aspirational features.

Run these with OpenMC installed and cross-section data configured
(`OPENMC_CROSS_SECTIONS` pointing at an `endfb-*.xml` / `cross_sections.xml`). Fill in the
**Score** column as you go.

> **How OWEN sees "OpenMC":** OpenMC has no dedicated VS Code language id. OWEN treats a
> `.py` file as OpenMC **only when it contains an `import openmc` (or `from openmc … import`)
> line** — see `src/util/detectLanguage.ts`. Diagnostics, run-as-OpenMC, geometry preview,
> and material insertion all key off that. **Always keep `import openmc` at the top of your
> test files.**

---

## 0. Prerequisites (do this once)

The repo does **not** ship a compiled `out/extension.js`. Build and launch the extension
host first:

```bash
cd owen
npm install
npm run typecheck     # esbuild does not type-check
npm run compile       # produces out/extension.js
```

Then open the `owen/` folder in VS Code / Cursor and press **F5** ("Run Extension") to
launch an Extension Development Host, OR install the packaged VSIX:

```bash
npx @vscode/vsce package -o owen.vsix
# then: code --install-extension owen.vsix
```

OpenMC sanity check (in the Python env OWEN will call — `owen.openmc.pythonExecutable`):

```bash
python -c "import openmc; print(openmc.__version__)"
echo $OPENMC_CROSS_SECTIONS   # must be set for any real run
```

---

## Scoring rubric

| Score | Meaning |
|---|---|
| **Pass** | Feature works as described; output is correct and usable. |
| **Partial** | Feature runs but with caveats (wrong/heuristic output, missing data, manual fixups needed). |
| **Fail** | Command errors, does nothing, or produces unusable output. |
| **Blocked** | Couldn't test (missing dependency, no internet, no OpenMC). |

---

## Canonical test input — paste this into `pincell.py`

Use this correct-API pin cell as the workhorse for several tests below. It uses
`IndependentSource`, sets **temperature on cells** (not materials), and opens the statepoint
**Path** returned by `model.run()`.

```python
import openmc

# --- Materials ---
uo2 = openmc.Material(name='UO2')
uo2.set_density('g/cm3', 10.97)
uo2.add_nuclide('U235', 0.040, percent_type='ao')
uo2.add_nuclide('U238', 0.960, percent_type='ao')
uo2.add_nuclide('O16', 2.000, percent_type='ao')

zircaloy = openmc.Material(name='Zircaloy-4')
zircaloy.set_density('g/cm3', 6.56)
zircaloy.add_element('Zr', 1.0)

water = openmc.Material(name='Water')
water.set_density('g/cm3', 0.998)
water.add_nuclide('H1', 2.0)
water.add_nuclide('O16', 1.0)
water.add_s_alpha_beta('c_H_in_H2O')

materials = openmc.Materials([uo2, zircaloy, water])

# --- Geometry ---
fuel_or = openmc.ZCylinder(r=0.4095)
clad_or = openmc.ZCylinder(r=0.4750)
box = openmc.model.RectangularPrism(width=1.26, height=1.26, boundary_type='reflective')

fuel_cell = openmc.Cell(fill=uo2,      region=-fuel_or, name='fuel')
clad_cell = openmc.Cell(fill=zircaloy, region=+fuel_or & -clad_or, name='clad')
mod_cell  = openmc.Cell(fill=water,    region=+clad_or & -box, name='mod')
fuel_cell.temperature = 900.0      # temperature on the CELL, not the material
mod_cell.temperature  = 600.0

geometry = openmc.Geometry([fuel_cell, clad_cell, mod_cell])

# --- Settings ---
settings = openmc.Settings()
settings.run_mode = 'eigenvalue'
settings.batches = 100
settings.inactive = 20
settings.particles = 5000
settings.source = openmc.IndependentSource(
    space=openmc.stats.Box((-0.63, -0.63, -1.0), (0.63, 0.63, 1.0)),
    constraints={'fissionable': True},
)

model = openmc.model.Model(geometry, materials, settings)
sp_path = model.run(threads=4)
with openmc.StatePoint(sp_path) as sp:
    print('k-eff =', sp.keff)
```

Expected standalone result (outside OWEN): k-eff ≈ 1.3 for an infinite reflective UO₂ pin at
4 a/o U-235 (exact value depends on library/temperature). This is your reference.

---

# Test matrix

Ordered quickest/most-fundamental → most-advanced.

---

## T1 — Extension activates without crashing

**Feature:** Activation (`src/extension.ts`). Regression guard for the prior bug where a
top-level `@supabase/supabase-js` import crashed activation for *every* command.

**Invoke:**
1. Launch the Extension Development Host (F5) or install the VSIX.
2. Open the **Output** panel → channel "Log (Extension Host)" / "OWEN" and the Developer
   Tools console (`Help → Toggle Developer Tools`).
3. Open `pincell.py`.

**Steps:** Watch for the line `OWEN extension activated` in the console; open the Command
Palette and type `OWEN:` — all 8 commands should be listed.

**Expected / pass criteria:** `OWEN extension activated` logged, no activation error,
all eight `OWEN:` commands visible (Open Lattice Builder, Validate Input File, Run
Simulation, Open 3D Geometry Preview, Input from Community Library, Insert Material from Database,
Open Tutorial, Run Parameter Sweep). This confirms the lazy-Supabase activation fix.

**Score:** ☐ Pass ☐ Partial ☐ Fail ☐ Blocked — notes: ________________

---

## T2 — OpenMC syntax highlighting

**Feature:** Language highlighting. The file stays Python — OWEN registers no `openmc`
language id — but OpenMC API tokens are recolored on top of it, two ways: an injection
grammar into `source.python`, and editor decorations for the (usual) case where Pylance's
semantic tokens would otherwise win. See README → *Why OpenMC is highlighted twice*.

**Invoke:** Open `pincell.py`, with the Python extension installed and enabled.

**Steps:** Confirm `openmc` itself, class names after it (`openmc.Material`,
`openmc.ZCylinder`), called functions (`openmc.run(`), and submodules
(`openmc.model`) each take a distinct color. Then run `OWEN: Choose Highlight
Palette` → OpenMC → High Contrast and confirm those same tokens change while the
rest of the Python file does not.

**Expected / pass criteria:** Pass = the four OpenMC token kinds are colored distinctly from
surrounding Python, and switching palettes changes them live. Partial = colors appear only
after disabling Pylance, which means the decoration layer is not running — check
`owen.highlight.openmc.decorate`. Fail = `openmc.Material` looks identical to any other
class reference under every palette.

**Score:** ☐ Pass ☐ Partial ☐ Fail ☐ Blocked — notes: ________________

---

## T3 — OpenMC snippets

**Feature:** Snippets (`snippets/openmc.json`, scoped to `python`). Prefixes:
`omc_material`, `omc_pin`, `omc_lattice`, `omc_settings`, `omc_model`, `omc_pin_script`,
`omc_assembly_script`.

> **How they trigger (v0.1.2+):** the snippets are delivered by an explicit
> `CompletionItemProvider` (`src/completions/snippets.ts`), not only the declarative
> `contributes.snippets`. Earlier versions relied on declarative snippets alone, which only
> appear in the suggestion widget where the Python language server's completions out-rank or
> suppress them — so the prefixes looked dead. The provider loads the same snippet JSON
> (single source of truth) and serves the prefixes directly, so they appear on **Ctrl+Space**
> and as you type `omc_…`, regardless of your `editor.snippetSuggestions` /
> `editor.quickSuggestions` settings. The Python snippets only fire in files that
> `import openmc` (OWEN's OpenMC detection); MCNP/Serpent/SCONE snippets always fire.

**Invoke:** In a `.py` file that contains `import openmc`, type a prefix (or press
Ctrl+Space) and accept the completion.

**Steps:**
1. New file `snippet_test.py`; add `import openmc` on the first line.
2. Type `omc_pin_script` (or press **Ctrl+Space** and pick it), press Tab/Enter.
3. Type `omc_settings`, accept it.
4. Inspect the inserted code.

**Expected / pass criteria:** Full, correct-API code is inserted. Verify the inserted
script uses `openmc.IndependentSource(...)`, `openmc.model.RectangularPrism(width=, height=)`,
sets `cell.temperature` (not on Material), and ends with
`sp_path = model.run(...)` → `with openmc.StatePoint(sp_path) as sp:`. The inserted
`omc_pin_script` should run standalone with OpenMC.

**Score:** ☐ Pass ☐ Partial ☐ Fail ☐ Blocked — notes: ________________

---

## T4 — Validation / diagnostics (OpenMC API gotchas)

**Feature:** `OWEN: Validate Input File` (`owen.validateInput` → `validateOpenMC` in
`src/validation/validator.ts`). It flags five common OpenMC mistakes.

**Invoke:** Command Palette → **OWEN: Validate Input File** (or right-click in editor →
OWEN). File must contain `import openmc` to be detected as OpenMC.

**Steps:** Paste this deliberately-wrong file as `bad_openmc.py` and run validation:

```python
import openmc

src = openmc.Source()                                  # T4.1
prism = openmc.model.rectangular_prism(1.26, 1.26)     # T4.2
fuel = openmc.Material(name='UO2', temperature=900)    # T4.3
result = model.run(openmc_exec_kwargs={'threads': 4})  # T4.4
keff = result.keff                                     # T4.5
```

**Expected / pass criteria:** Five diagnostics (check the Problems panel), one per line:

| # | Line | Expected diagnostic | Severity |
|---|---|---|---|
| T4.1 | `openmc.Source()` | use `openmc.IndependentSource(...)` | Error |
| T4.2 | `rectangular_prism(...)` | deprecated → `RectangularPrism(width=, height=)` | Warning |
| T4.3 | `Material(..., temperature=...)` | set temperature on the **cell**, not the Material | Error |
| T4.4 | `openmc_exec_kwargs=` | deprecated → pass `threads=` to `model.run()` | Warning |
| T4.5 | `result.keff` after `result = …run(…)` | `model.run()` returns a **Path**, open via `openmc.StatePoint(...)` | Error |

Also run validation on the **good** `pincell.py` → expected "OWEN: No issues found."

**Score:** ☐ Pass ☐ Partial ☐ Fail ☐ Blocked — notes: ________________

---

## T5 — Insert Material from Database (NRDP)

**Feature:** `OWEN: Insert Material from Database` (`owen.insertMaterial`). Pulls materials
from `reactormc.net` live (`owen.nrdp.live`, default on) or the bundled
`data/nrdp-materials.json`, and inserts the **OpenMC** code variant when the active file is
detected as OpenMC.

**Invoke:** Command Palette → **OWEN: Insert Material from Database** with `pincell.py`
(or any file containing `import openmc`) focused.

**Steps:**
1. Place cursor on a blank line.
2. Run the command; pick e.g. **UO2 (3% enriched)** or **Water**.
3. Inspect inserted code.

**Expected / pass criteria:** A QuickPick of materials appears; selecting one inserts OpenMC
Python (`openmc.Material(...)`, `set_density`, `add_nuclide`/`add_element`). Because the file
is OpenMC, it inserts `openmcCode`, **not** the MCNP/Serpent variant. If both live fetch and
bundled snapshot fail you'll get "NRDP material snapshot is empty" → Fail/Blocked.

**Score:** ☐ Pass ☐ Partial ☐ Fail ☐ Blocked — notes: ________________

---

## T6 — Open Tutorial (deep links)

**Feature:** `OWEN: Open Tutorial` (`owen.openTutorial`). Reads
`data/tutorial-links.json`, then opens the chosen page on `reactormc.net` in your browser.

**Invoke:** Command Palette → **OWEN: Open Tutorial**.

**Steps:** Pick the **OpenMC** section, then a page; confirm your browser opens the URL.

**Expected / pass criteria:** Two-step QuickPick (section → page); selecting opens
`https://reactormc.net/...` for the OpenMC tutorial. Requires internet for the page to load
(the link generation itself is offline). Empty index → "tutorial index is empty".

**Score:** ☐ Pass ☐ Partial ☐ Fail ☐ Blocked — notes: ________________

---

## T7 — Run Simulation (run OpenMC end-to-end)

**Feature:** `OWEN: Run Simulation` (`owen.runSimulation` → `src/workflows/runner.ts`).
For OpenMC it opens an integrated terminal and runs
`<owen.openmc.pythonExecutable> <file.py>` in the file's directory.

**Invoke:** Open `pincell.py`, Command Palette → **OWEN: Run Simulation**.

**Steps:**
1. Set `owen.openmc.pythonExecutable` in Settings if your OpenMC Python isn't `python`.
2. Run the command. A terminal named "OWEN: Run" appears and executes `python pincell.py`.
3. Wait for OpenMC to finish.

**Expected / pass criteria:** Terminal launches, OpenMC runs all batches, prints
`Combined k-effective` in its log and your `print('k-eff = …')`, and writes
`statepoint.100.h5` next to the file. Info toast: "OWEN: Launched python for pincell.py
(openmc)." Fail = wrong executable, no terminal, or OpenMC import/cross-section errors
(those are environment issues → Blocked).

**Score:** ☐ Pass ☐ Partial ☐ Fail ☐ Blocked — notes: ________________

---

## T8 — 3D Geometry Preview

**Feature:** `OWEN: Open 3D Geometry Preview` (`owen.openGeometryPreview` →
`src/preview/extractor.ts` `extractOpenmcCylinders`). **Caveat — this is a regex/heuristic
parser, not a real OpenMC geometry build.** It scans the text for variable-name patterns
(`pitch`, `fuel_radius`/`fuel_or`, `clad_outer`/`clad_or`, `fuel_height`, and
`guide_tube_coords`/`guide_positions`) and draws three.js cylinders. It does **not** import
or run OpenMC. The webview loads `three` from `unpkg.com`, so it needs internet.

**Invoke:** Open a deck, Command Palette → **OWEN: Open 3D Geometry Preview** (opens beside).

**Steps:** Use this preview-friendly file `preview_pin.py` (note the recognized names):

```python
import openmc

pitch = 1.26
fuel_or = 0.4095
clad_or = 0.4750
fuel_height = 40.0
# (no lattice → OWEN renders a single concentric pin)
```

Then optionally test a lattice render with `guide_tube_coords`:

```python
import openmc

pitch = 1.26
fuel_or = 0.4095
clad_or = 0.4750
guide_tube_coords = [(2,5),(2,8),(2,11),(5,2),(8,8),(14,11)]   # drives a 17x17 grid
```

**Expected / pass criteria:**
- First file → a single concentric pin (fuel + clad annulus) renders; orbit/zoom works.
- Second file → a 17×17 grid of pins with guide-tube positions highlighted.
- A real-but-unrecognized script (e.g. variables named `r_fuel`, or a `np.full((17,17))`
  lattice with no `guide_tube_coords`) will fall back to **defaults / a single pin** — mark
  **Partial** and note what it drew vs. the actual geometry.
- No internet → blank stage (three.js CDN) → Blocked.

**Score:** ☐ Pass ☐ Partial ☐ Fail ☐ Blocked — notes: ________________

---

## T9 — Lattice Builder

**Feature:** `OWEN: Open Lattice Builder` (`owen.openLatticeBuilder` →
`src/panels/latticeBuilder.ts`). A webview grid painter that emits MCNP/OpenMC/Serpent
lattice code and inserts it at the cursor.

**Invoke:** Command Palette → **OWEN: Open Lattice Builder**.

**Steps:**
1. Set **Format → OpenMC**, grid 17, pitch 1.26.
2. Click **W 17×17** preset (places guide tubes + central instrument tube).
3. Read the code preview, then click **Insert at Cursor** into a `.py` file.

**Expected / pass criteria:** Preview shows
`lattice = openmc.RectLattice(...)`, `lattice.pitch = (1.26, 1.26)`,
`lattice.lower_left = (...)`, and a `lattice.universes = [...]` grid using names
`fuel_pin`, `guide_tube`, `instr_tube`. Insert places that code at the cursor.
**Caveat:** the emitted snippet references universe **names** (`fuel_pin`, etc.) you must
define yourself — it is a lattice fragment, not a runnable script. Pass = correct lattice
fragment inserted; Partial if you expected a complete runnable model.

**Score:** ☐ Pass ☐ Partial ☐ Fail ☐ Blocked — notes: ________________

---

## T10 — Run Parameter Sweep

**Feature:** `OWEN: Run Parameter Sweep` (`owen.runSweep` → `src/workflows/sweep.ts`).
Reads a JSON config, regex-substitutes values into a base file per combination, runs each
via `python <input>`, parses k-eff from stdout (`Combined k-effective = …`), and writes
`sweep-manifest.json` + `sweep-summary.tsv`.

**Invoke:** Command Palette → **OWEN: Run Parameter Sweep**, then pick the JSON config.

**Steps:**
1. Save `pincell.py` (from the canonical input) as the base, but make the enrichment a
   substitutable token. Change the U-235/U-238 lines to a single marker you can regex, e.g.:

   ```python
   uo2.add_nuclide('U235', 0.040, percent_type='ao')   # ENR line
   ```

2. Create `sweep.json` next to it:

   ```json
   {
     "baseFile": "pincell.py",
     "language": "openmc",
     "output": { "dir": "sweep_out" },
     "parameters": [
       {
         "name": "enrichment",
         "values": [0.02, 0.03, 0.04, 0.05],
         "pattern": "add_nuclide\\('U235', ([0-9.]+)"
       }
     ]
   }
   ```

3. Run the sweep and pick `sweep.json`.

**Expected / pass criteria:** A progress notification runs 4 cases; `sweep_out/run_000…003/`
each contain a mutated `pincell.py`, an `owen-sweep.log`, and a statepoint. `sweep-summary.tsv`
lists `index / enrichment / exit / keff` with **increasing k-eff vs. enrichment**, and
`sweep-manifest.json` is written. k-eff column = `n/a` means the regex didn't match OpenMC's
stdout (`Combined k-effective`) → Partial. Note: `model.run()` keeps OpenMC's normal stdout,
so the parser should find it.

### Worked enrichment sweep (concrete, hands-on)

This is a fully specified end-to-end scenario you can copy verbatim. It is the same logic the
unit tests in `src/test/suite/sweep.test.ts` exercise (parameter expansion, capture-group-1
substitution, `Combined k-effective` parsing, manifest/TSV assembly) — here run for real
against OpenMC. See `docs/SWEEP_VALIDATION.md` for the full validation checklist.

**1. Base deck `pincell.py`** — a single PWR UO₂ pin (infinite lattice, reflective boundary).
The one enrichment-bearing line is marked; the sweep rewrites only the captured number:

```python
import openmc

uo2 = openmc.Material(name='UO2')
uo2.set_density('g/cm3', 10.42)
uo2.add_nuclide('U235', 0.040, percent_type='ao')   # ← swept (capture group)
uo2.add_nuclide('U238', 0.960, percent_type='ao')
uo2.add_nuclide('O16', 2.0, percent_type='ao')

water = openmc.Material(name='h2o')
water.set_density('g/cm3', 0.74)
water.add_nuclide('H1', 2.0); water.add_nuclide('O16', 1.0)
water.add_s_alpha_beta('c_H_in_H2O')

materials = openmc.Materials([uo2, water])

fuel_or = openmc.ZCylinder(r=0.4096)
pitch = 1.26
box = openmc.model.RectangularPrism(pitch, pitch, boundary_type='reflective')
fuel = openmc.Cell(fill=uo2, region=-fuel_or)
mod  = openmc.Cell(fill=water, region=+fuel_or & -box)
geometry = openmc.Geometry([fuel, mod])

settings = openmc.Settings()
settings.particles = 2000
settings.batches = 100
settings.inactive = 20
settings.source = openmc.IndependentSource(
    space=openmc.stats.Box((-0.6, -0.6, -1), (0.6, 0.6, 1)))

model = openmc.model.Model(geometry, materials, settings)
model.run()
```

**2. `sweep.json`** (same as above): one parameter `enrichment` over
`[0.02, 0.03, 0.04, 0.05]` with pattern `add_nuclide\('U235', ([0-9.]+)`.

**3. Run** → **OWEN: Run Parameter Sweep** → pick `sweep.json`.

**Expected output tree:**

```
sweep_out/
  run_000/  pincell.py (U235=0.02)  owen-sweep.log  statepoint.100.h5  summary.h5
  run_001/  pincell.py (U235=0.03)  owen-sweep.log  statepoint.100.h5  summary.h5
  run_002/  pincell.py (U235=0.04)  owen-sweep.log  statepoint.100.h5  summary.h5
  run_003/  pincell.py (U235=0.05)  owen-sweep.log  statepoint.100.h5  summary.h5
  sweep-manifest.json
  sweep-summary.tsv
```

**Expected `sweep-summary.tsv`** (k-eff rises monotonically with enrichment; absolute values
depend on your cross-section library/temperature — ENDF/B-VII.1 at room temperature gives
roughly the following, ±~0.002 statistical):

```
index	enrichment	exit	keff
0	0.02	0	0.92xxx
1	0.03	0	1.05xxx
2	0.04	0	1.14xxx
3	0.05	0	1.18xxx
```

**Pass:** all four `exit = 0`, `keff` strictly increasing, no `n/a`. **Partial:** runs finish
but `keff = n/a` (OpenMC stdout didn't contain `Combined k-effective` — e.g. output was
redirected). **Blocked:** runs fail for environment reasons (`OPENMC_CROSS_SECTIONS` unset,
wrong `owen.openmc.pythonExecutable`) — not an OWEN bug.

**Score:** ☐ Pass ☐ Partial ☐ Fail ☐ Blocked — notes: ________________

---

## T11 — Community Library (Input from Community Library)

**Feature:** `OWEN: Input from Community Library` (`owen.searchReactorLibrary` →
`src/community/browser.ts`, Supabase-backed). **Disabled by default**
(`owen.community.enabled = false`); requires `owen.supabase.url` + `owen.supabase.anonKey`.

**Invoke:** Command Palette → **OWEN: Input from Community Library**.

**Steps:**
1. With defaults (community disabled), run the command.
2. (Optional) If you have Supabase creds: set `owen.community.enabled = true`,
   `owen.supabase.url`, `owen.supabase.anonKey`, reload, run again with `pincell.py` focused.

**Expected / pass criteria:**
- Default: graceful info message "Community Library is disabled. Set `owen.community.enabled`…"
  and **no crash** (this is the second half of the lazy-Supabase activation-fix verification).
- With creds: a QuickPick of approved models filtered to `openmc` (because the active file is
  OpenMC), insert-at-cursor / open-in-new-doc options work.
- **Likely-Partial for most users:** without public Supabase credentials this feature can't
  return data — that's expected, not a bug. Score Partial and note "no creds".

**Score:** ☐ Pass ☐ Partial ☐ Fail ☐ Blocked — notes: ________________

---

## Known caveats / things likely to not work yet

Honest read of the current code:

1. **OpenMC highlighting is narrow by construction.** Only `openmc`-qualified dotted access
   is recolored — `openmc.Material`, `openmc.model.borated_water(`, `openmc.stats`. A name
   pulled in with `from openmc import Material`, or reached through `import openmc as om`,
   is left to Python's own coloring (T2).
2. **OpenMC detection is import-sniffing.** A `.py` file without a literal
   `import openmc` / `from openmc … import` line is invisible to validation, run-as-OpenMC,
   material insertion, and the OpenMC preview path (`detectLanguage.ts`).
3. **3D preview is heuristic, not real geometry.** It pattern-matches variable names
   (`fuel_or`, `clad_or`, `pitch`, `guide_tube_coords`) and falls back to hard-coded defaults
   (pitch 1.26, fuel r 0.41, clad r 0.475, height 40). It can't read an actual
   `openmc.Geometry`, CSG regions, or `RectLattice.universes` built with NumPy. Expect
   single-pin fallback for most real scripts that don't use the exact recognized names (T8).
4. **Preview needs internet.** three.js loads from `unpkg.com`; offline = blank webview.
5. **Lattice Builder emits a fragment, not a model.** OpenMC output references undefined
   universe names you must wire up yourself (T9).
6. **Community Library is effectively off for most users** — disabled by default and needs
   Supabase credentials (T11). Its main current value is confirming it no longer crashes
   activation.
7. **Run/Sweep depend on your environment.** `owen.openmc.pythonExecutable` must point at the
   Python with OpenMC, and `OPENMC_CROSS_SECTIONS` must be set; otherwise runs fail for
   environment reasons (Blocked, not an OWEN bug).
8. **k-eff scraping is regex-based.** The sweep parser looks for `Combined k-effective = …`
   in stdout; anything that suppresses/redirects OpenMC's console output yields `n/a` (T10).

---

## Results summary (fill in)

| Test | Feature | Score | Notes |
|---|---|---|---|
| T1 | Activation | | |
| T2 | OpenMC highlighting | | |
| T3 | Snippets | | |
| T4 | Validation / diagnostics | | |
| T5 | Insert Material (NRDP) | | |
| T6 | Open Tutorial | | |
| T7 | Run Simulation | | |
| T8 | 3D Geometry Preview | | |
| T9 | Lattice Builder | | |
| T10 | Parameter Sweep | | |
| T11 | Community Library | | |
