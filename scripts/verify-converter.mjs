// Standing check for the MCNP → OpenMC converter and, at the same time, for the
// exact geometry engine behind the 3D preview.
//
// The two are checked against each other, which is the point. OWEN contains two
// completely independent readings of an MCNP deck:
//
//   - src/converter/* rewrites it as an OpenMC Python model;
//   - src/preview/mcnpGeometry.ts + mcnpEvaluate.ts evaluate the CSG directly to
//     decide what is at a point (this is what the preview and slices draw).
//
// So for each deck this script converts it, runs the conversion in real OpenMC,
// and then asks both implementations what material sits at several thousand
// random points. They share no code, so agreement is meaningful and a
// disagreement localises the bug to whichever one contradicts OpenMC's own
// tracking of the converted model.
//
// Stages per deck: convert → ast.parse → execute → export/re-read model.xml →
// point-cloud agreement → (small decks) transport with lost-particle detection.
//
// Usage:
//   node scripts/verify-converter.mjs                 all bundled decks
//   node scripts/verify-converter.mjs --deck <file.i> one deck
//   node scripts/verify-converter.mjs --points 20000  denser cloud
import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const argv = process.argv.slice(2);
const deckArg = argv.includes('--deck') ? argv[argv.indexOf('--deck') + 1] : undefined;
const POINTS = argv.includes('--points') ? Number(argv[argv.indexOf('--points') + 1]) : 6000;

let failures = 0;
let checks = 0;
function check(name, ok, detail) {
    checks++;
    if (ok) {
        console.log(`  ok   ${name}`);
        return true;
    }
    failures++;
    console.error(`  FAIL ${name}${detail ? `\n       ${String(detail).split('\n').join('\n       ')}` : ''}`);
    return false;
}

function run(cmd, args, opts = {}) {
    return new Promise((resolve) => {
        execFile(cmd, args, { maxBuffer: 256 * 1024 * 1024, windowsHide: true, ...opts }, (err, stdout, stderr) => {
            resolve({ ok: !err, code: err?.code ?? 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
        });
    });
}

// ------------------------------------------------------------------ toolchain

async function loadBundles() {
    const dir = fs.mkdtempSync(path.join(root, 'out-test', 'conv-'));
    const conv = path.join(dir, 'converter.mjs');
    const geom = path.join(dir, 'geometry.mjs');
    await build({
        entryPoints: [path.join(root, 'src', 'converter', 'index.ts')],
        bundle: true, platform: 'node', format: 'esm', outfile: conv, logLevel: 'silent',
    });
    await build({
        stdin: {
            contents: `export { parseMcnpGeometry } from '${path
                .join(root, 'src', 'preview', 'mcnpGeometry.ts')
                .replace(/\\/g, '/')}';
export { findCell, worldBounds } from '${path
                .join(root, 'src', 'preview', 'mcnpEvaluate.ts')
                .replace(/\\/g, '/')}';`,
            resolveDir: root,
            loader: 'ts',
        },
        bundle: true, platform: 'node', format: 'esm', outfile: geom, logLevel: 'silent',
    });
    return {
        dir,
        converter: await import(pathToFileURL(conv).href),
        engine: await import(pathToFileURL(geom).href),
    };
}

async function findWslPython() {
    if (process.platform !== 'win32') return null;
    const core = await import(pathToFileURL(path.join(root, 'out', 'src', 'preview', 'openmcNative', 'core.js')).href)
        .catch(() => null);
    if (!core) return null;
    const res = await run('wsl', ['--exec', 'sh', '-c', core.buildWslDiscoveryScript()], { timeout: 90_000 });
    if (!res.ok) return null;
    return core.parseWslDiscovery(res.stdout);
}

const wslPath = async (p) => (await run('wsl', ['--exec', 'wslpath', '-a', p])).stdout.trim();

// ------------------------------------------------------------- python stages

const STAGE_PY = String.raw`
import json, math, os, runpy, sys

req = json.load(open(sys.argv[1]))
deck = req['deck']
out = {'warnings': []}

# 1. syntax
import ast
ast.parse(open(deck).read())
out['ast'] = True

# 2. execute (never as __main__: a converted deck may end in model.run())
import openmc
os.environ.setdefault('OPENMC_CROSS_SECTIONS', req.get('crossSections') or '')
ns = runpy.run_path(deck, run_name='owen_verify')

geometry = None
model = None
for value in ns.values():
    if isinstance(value, openmc.Model) and model is None:
        model = value
    elif isinstance(value, openmc.Geometry) and geometry is None:
        geometry = value
if model is not None and geometry is None:
    geometry = model.geometry
if geometry is None:
    out['error'] = 'the converted deck defines no openmc.Geometry'
    print(json.dumps(out))
    raise SystemExit(0)

cells = geometry.get_all_cells()
out['counts'] = {
    'cells': len(cells),
    'surfaces': len(geometry.get_all_surfaces()),
    'universes': len(geometry.get_all_universes()),
    'lattices': len(geometry.get_all_lattices()),
    'materials': len(geometry.get_all_materials()),
}
bb = geometry.bounding_box
out['bbox'] = [[float(x) for x in bb.lower_left], [float(x) for x in bb.upper_right]]

# 3. XML round trip: what OpenMC's own transport would read back.
work = req['workDir']
os.chdir(work)
xml_path = os.path.join(work, 'model.xml')
if model is None:
    model = openmc.Model(geometry=geometry, materials=openmc.Materials(geometry.get_all_materials().values()))
if model.settings is None or not model.settings.batches:
    model.settings = openmc.Settings()
    model.settings.particles = 100
    model.settings.batches = 2
    model.settings.inactive = 1
    model.settings.source = openmc.IndependentSource(
        space=openmc.stats.Point(tuple((a + b) / 2 for a, b in zip(*out['bbox']))))
model.export_to_model_xml(xml_path)
reread = openmc.Model.from_model_xml(xml_path)
out['roundTrip'] = {
    'cells': len(reread.geometry.get_all_cells()),
    'universes': len(reread.geometry.get_all_universes()),
    'lattices': len(reread.geometry.get_all_lattices()),
}

# 4. what material is at each sample point, by OpenMC's own tracking
points = json.load(open(req['points']))
found = []
for p in points:
    try:
        hit = geometry.find(tuple(p))
    except Exception:
        found.append('error')
        continue
    if not hit:
        found.append('outside')
        continue
    fill = getattr(hit[-1], 'fill', None)
    if isinstance(fill, openmc.Material):
        found.append(int(fill.id))
    elif fill is None:
        found.append('void')
    else:
        found.append('fill')
json.dump(found, open(req['found'], 'w'))
out['sampled'] = len(found)

# 5. transport smoke, for decks small enough to be worth it
if req.get('transport'):
    xs = req.get('crossSections')
    if xs and os.path.exists(xs):
        os.environ['OPENMC_CROSS_SECTIONS'] = xs
        os.environ['PATH'] = os.path.dirname(sys.executable) + os.pathsep + os.environ.get('PATH', '')
        avail = set()
        import xml.etree.ElementTree as ET
        for lib in ET.parse(xs).getroot():
            for m in lib.get('materials', '').split():
                avail.add(m)
        # The local library is a slim set; drop nuclides it lacks. Composition
        # does not affect geometry tracking, and lost particles are the point.
        stripped = set()
        for mat in model.materials:
            keep = [nd for nd in mat.nuclides if nd[0] in avail]
            drop = [nd[0] for nd in mat.nuclides if nd[0] not in avail]
            if not drop:
                continue
            stripped.update(drop)
            units, dens = mat.density_units, mat.density
            for name in list({nd[0] for nd in mat.nuclides}):
                mat.remove_nuclide(name)
            for nd in keep:
                mat.add_nuclide(nd[0], nd[1], nd[2])
            if not keep:
                mat.add_nuclide('O16', 1.0)
            mat.set_density(units, dens)
            mat._sab = [s for s in mat._sab if s[0] in avail]
        out['strippedNuclides'] = sorted(stripped)
        model.settings.particles = 200
        model.settings.batches = 3
        model.settings.inactive = 1
        model.settings.max_lost_particles = 20
        model.settings.verbosity = 4
        try:
            sp = model.run(cwd=work)
            log = ''
            out['transport'] = 'ok'
            with openmc.StatePoint(str(sp)) as state:
                out['keff'] = [float(state.keff.nominal_value), float(state.keff.std_dev)]
        except Exception as exc:
            out['transport'] = 'failed: ' + str(exc)[:400]
    else:
        out['transport'] = 'skipped (no cross-section library)'

print(json.dumps(out))
`;

// ------------------------------------------------------------------ one deck

function samplePoints(engine, model, count) {
    const bounds = engine.worldBounds(model);
    const span = [0, 1, 2].map((i) => {
        const lo = bounds.min[i];
        const hi = bounds.max[i];
        return Number.isFinite(lo) && Number.isFinite(hi) && hi > lo ? [lo, hi] : [-50, 50];
    });
    // Deterministic: a regression has to be reproducible to be fixable.
    let seed = 20260829;
    const rand = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
    };
    const pts = [];
    for (let i = 0; i < count; i++) {
        pts.push(span.map(([lo, hi]) => lo + rand() * (hi - lo)));
    }
    return { pts, span };
}

/**
 * Cells the deck marks `imp:n=0`. The converter drops these and turns their
 * bounding surfaces into vacuum boundaries, which is the right translation:
 * OpenMC has no graveyard concept. So a point the exact engine places in the
 * graveyard is the same answer as OpenMC reporting no cell at all, and treating
 * them as a disagreement would flag every deck.
 */
function graveyardCells(text) {
    const ids = new Set();
    for (const line of text.split(/\r?\n/)) {
        if (/^\s{0,4}c(\s|$)/i.test(line) || /^\s*$/.test(line)) continue;
        if (!/imp:n\s*=\s*0(\s|$)/i.test(line)) continue;
        const m = line.match(/^\s*(\d+)\s/);
        if (m) ids.add(Number(m[1]));
    }
    return ids;
}

function engineMaterialAt(engine, model, p, graveyard) {
    let found;
    try {
        found = engine.findCell(model, p);
    } catch {
        return 'error';
    }
    if (found.lost || !found.cell) return 'outside';
    if (graveyard.has(found.cell.id)) return 'outside';
    if (found.cell.material === 0) return 'void';
    return found.cell.material;
}

async function verifyDeck(deckPath, tools, python, crossSections) {
    const name = path.basename(deckPath);
    console.log(`\n=== ${name} ===`);
    const text = fs.readFileSync(deckPath, 'utf8');

    const converted = tools.converter.mcnpToOpenmc(text);
    const todos = (converted.output.match(/TODO\(owen-convert\)/g) || []).length;
    console.log(`     converter: ${converted.issues.length} issues, ${todos} TODO markers, ${converted.output.split('\n').length} lines`);
    check(`${name}: conversion produced a deck`, converted.output.includes('import openmc'), converted.output.slice(0, 300));

    const model = tools.engine.parseMcnpGeometry(text);
    check(`${name}: the exact engine parsed the deck`, model.cells.size > 0,
        `cells=${model.cells.size} surfaces=${model.surfaces.size}`);

    if (!python) {
        console.log('     (no OpenMC interpreter — stopping after the structural checks)');
        return;
    }

    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'owen-conv-'));
    try {
        const deckPy = path.join(work, 'converted.py');
        fs.writeFileSync(deckPy, converted.output);

        const { pts } = samplePoints(tools.engine, model, POINTS);
        const pointsPath = path.join(work, 'points.json');
        const foundPath = path.join(work, 'found.json');
        fs.writeFileSync(pointsPath, JSON.stringify(pts));

        const reqPath = path.join(work, 'request.json');
        const stagePath = path.join(work, 'stage.py');
        fs.writeFileSync(stagePath, STAGE_PY);
        fs.writeFileSync(reqPath, JSON.stringify({
            deck: await wslPath(deckPy),
            workDir: await wslPath(work),
            points: await wslPath(pointsPath),
            found: await wslPath(foundPath),
            crossSections,
            transport: model.cells.size <= 40,
        }));

        const res = await run('wsl', ['--exec', python, await wslPath(stagePath), await wslPath(reqPath)],
            { timeout: 1_800_000 });
        const jsonLine = res.stdout.trim().split(/\r?\n/).filter((l) => l.startsWith('{')).pop();
        if (!check(`${name}: the converted deck ran under OpenMC`, res.ok && Boolean(jsonLine),
            `exit ${res.code}\n${res.stdout.slice(-1500)}\n${res.stderr.slice(-2500)}`)) {
            return;
        }
        const out = JSON.parse(jsonLine);
        if (out.error) {
            check(`${name}: the converted deck defines a geometry`, false, out.error);
            return;
        }

        console.log(`     openmc: ${JSON.stringify(out.counts)}`);
        console.log(`     bbox:   ${JSON.stringify(out.bbox)}`);

        check(`${name}: OpenMC read a non-trivial geometry`, out.counts.cells > 0 && out.counts.surfaces > 0,
            JSON.stringify(out.counts));
        check(`${name}: model.xml round-trips through OpenMC`,
            out.roundTrip && out.roundTrip.cells === out.counts.cells
                && out.roundTrip.universes === out.counts.universes
                && out.roundTrip.lattices === out.counts.lattices,
            `in ${JSON.stringify(out.counts)} out ${JSON.stringify(out.roundTrip)}`);

        // The three-way comparison.
        const openmcFound = JSON.parse(fs.readFileSync(foundPath, 'utf8'));
        const graveyard = graveyardCells(text);
        const engineFound = pts.map((p) => engineMaterialAt(tools.engine, model, p, graveyard));
        let agree = 0;
        let bothInside = 0;
        let presence = 0;
        let material = 0;
        const examples = new Map();
        const witnesses = new Map();
        for (let i = 0; i < pts.length; i++) {
            const a = engineFound[i];
            const b = openmcFound[i];
            const aOut = a === 'outside' || a === 'error';
            const bOut = b === 'outside' || b === 'error';
            if (aOut && bOut) continue;
            const key = `engine ${a} vs openmc ${b}`;
            if (aOut !== bOut) {
                presence++;
                examples.set(key, (examples.get(key) ?? 0) + 1);
                if (!witnesses.has(key)) witnesses.set(key, pts[i]);
                continue;
            }
            bothInside++;
            if (String(a) === String(b)) {
                agree++;
            } else {
                material++;
                examples.set(key, (examples.get(key) ?? 0) + 1);
                if (!witnesses.has(key)) witnesses.set(key, pts[i]);
            }
        }
        const inModel = bothInside + presence;
        console.log(`     points: ${pts.length} sampled, ${inModel} inside either model, ` +
            `${agree} agree, ${presence} presence differ, ${material} material differ`);
        if (examples.size > 0) {
            for (const [key, n] of [...examples.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8)) {
                const w = witnesses.get(key);
                const at = w ? `  at (${w.map((v) => v.toFixed(3)).join(', ')})` : '';
                console.log(`             ${n.toString().padStart(5)}  ${key}${at}`);
            }
        }

        check(`${name}: the point cloud actually landed in the model`, inModel > pts.length * 0.05,
            `${inModel} of ${pts.length}`);
        // The converter and the exact engine are independent readings of the
        // same deck; anything below full agreement is a bug in one of them.
        check(`${name}: converter and exact engine agree on every point`,
            presence === 0 && material === 0,
            `${presence} presence + ${material} material disagreements out of ${inModel}`);

        if (out.transport) {
            console.log(`     transport: ${out.transport}${out.keff ? ` keff=${out.keff[0].toFixed(5)} +/- ${out.keff[1].toFixed(5)}` : ''}`);
            if (out.strippedNuclides?.length) {
                console.log(`     (stripped for the slim local library: ${out.strippedNuclides.join(' ')})`);
            }
            if (!out.transport.startsWith('skipped')) {
                check(`${name}: transport runs without losing particles`, out.transport === 'ok', out.transport);
                if (out.keff) {
                    check(`${name}: k-eff is finite and physical`, out.keff[0] > 0 && out.keff[0] < 5,
                        String(out.keff[0]));
                }
            }
        }
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
}

// ---------------------------------------------------------------------- main

async function main() {
    fs.mkdirSync(path.join(root, 'out-test'), { recursive: true });
    const tools = await loadBundles();
    try {
        const decks = deckArg
            ? [path.resolve(deckArg)]
            : [
                path.join(root, 'prebuilt-models', 'pincell_mcnp.i'),
                path.join(root, 'prebuilt-models', 'assembly_17x17_mcnp.i'),
                path.join(root, 'prebuilt-models', 'beavrs_fullcore_mcnp.i'),
            ].filter((p) => fs.existsSync(p));

        const found = await findWslPython();
        if (!found) {
            console.log('note: no WSL interpreter with openmc — running structural checks only');
        } else {
            console.log(`interpreter: ${found.pythonPath} (OpenMC ${found.version})`);
        }
        const python = found?.pythonPath;

        let crossSections;
        if (python) {
            const loader = await import(pathToFileURL(
                path.join(root, 'out', 'src', 'preview', 'openmcNative', 'deckLoader.js')).href).catch(() => null);
            if (loader) {
                const probe = await run('wsl', ['--exec', python, '-c', loader.buildCrossSectionProbe()],
                    { timeout: 60_000 });
                crossSections = probe.stdout.trim().split(/\r?\n/).pop()?.trim() || undefined;
            }
            console.log(`cross sections: ${crossSections ?? 'none found'}`);
        }

        for (const deck of decks) {
            await verifyDeck(deck, tools, python, crossSections);
        }
    } finally {
        fs.rmSync(tools.dir, { recursive: true, force: true });
    }

    console.log(`\nconverter + exact engine: ${checks - failures} checks passed, ${failures} failed`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
