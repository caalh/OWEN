#!/usr/bin/env node
/**
 * Standing end-to-end check for the two native-OpenMC features:
 * "Render with OpenMC (authoritative)" and "Verify Geometry with OpenMC".
 *
 * It generates the same helper scripts and request JSON the extension does,
 * then runs them with a real OpenMC through a real interpreter (local Python
 * first, WSL second) against fixture decks that reproduce the shapes real
 * decks come in:
 *
 *   model_in_main   model built inside main(), gated on OPENMC_CROSS_SECTIONS,
 *                   exported to a subdirectory, ending in model.run() — this
 *                   is the shape that used to fail with "No OpenMC model
 *                   found" (an IFE/HYLIFE chamber deck).
 *   module_level    geometry and materials at module scope, no Model.
 *   builder_only    a build_model() with defaults and no __main__ block.
 *   no_model        imports openmc and builds nothing (must fail clearly).
 *   overlap         two cells claiming the same region (verify must see it).
 *
 * Skips with exit code 0 when no OpenMC is reachable, so it is safe in CI.
 * Run: npm run verify:openmc-native
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');

const corePath = path.join(repo, 'out', 'src', 'preview', 'openmcNative', 'core.js');
const verifyPath = path.join(repo, 'out', 'src', 'verify', 'core.js');
if (!fs.existsSync(corePath) || !fs.existsSync(verifyPath)) {
    console.error('Compiled output missing. Run `tsc -p .` first (npm run verify:openmc-native does).');
    process.exit(1);
}
const core = require(corePath);
const verify = require(verifyPath);

let failures = 0;
let checks = 0;
function check(name, condition, detail) {
    checks += 1;
    if (condition) {
        console.log(`  ok    ${name}`);
        return true;
    }
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    return false;
}

function run(command, args, opts = {}) {
    return execFileSync(command, args, {
        encoding: 'utf8',
        timeout: opts.timeout ?? 300000,
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    });
}

function tryRun(command, args, opts) {
    try {
        return { ok: true, stdout: run(command, args, opts) };
    } catch (err) {
        return {
            ok: false,
            stdout: String(err.stdout ?? ''),
            stderr: String(err.stderr ?? err.message ?? ''),
        };
    }
}

/** A local Python with OpenMC, else an OpenMC Python inside WSL. */
function findInterpreter() {
    for (const cmd of ['python', 'python3']) {
        const probe = tryRun(cmd, ['-c', core.OPENMC_PROBE_SNIPPET], { timeout: 30000 });
        const version = probe.ok ? core.parseProbeOutput(probe.stdout) : null;
        if (version) return { command: cmd, argsPrefix: [], wsl: false, version };
    }
    if (process.platform === 'win32') {
        // `--exec` matches detect.ts: without it the WSL shell eats the quoting.
        const probe = tryRun('wsl', ['--exec', 'sh', '-c', core.buildWslDiscoveryScript()], { timeout: 90000 });
        const found = probe.ok ? core.parseWslDiscovery(probe.stdout) : null;
        if (found) {
            return { command: 'wsl', argsPrefix: ['--exec', found.pythonPath], wsl: true, version: found.version };
        }
    }
    return null;
}

function forInterpreter(interp, winPath) {
    if (!interp.wsl) return winPath;
    const out = tryRun('wsl', ['wslpath', '-a', winPath.replace(/\\/g, '/')], { timeout: 20000 });
    if (out.ok && out.stdout.trim()) return out.stdout.trim();
    return core.toWslPath(winPath);
}

// ---------------------------------------------------------------------------
// Fixture decks
// ---------------------------------------------------------------------------

const FIXTURES = {
    'model_in_main.py': `import argparse
import os
from pathlib import Path

import openmc
import openmc.model


def build(preset):
    fuel = openmc.Material(name='fuel')
    fuel.add_nuclide('U235', 1.0)
    fuel.set_density('g/cm3', 10.0)
    water = openmc.Material(name='water')
    water.add_nuclide('H1', 2.0)
    water.add_nuclide('O16', 1.0)
    water.set_density('g/cm3', 1.0)

    core_cyl = openmc.model.RightCircularCylinder(
        center_base=(0.0, 0.0, -20.0), height=40.0, radius=15.0, axis='z')
    vessel = openmc.model.RightCircularCylinder(
        center_base=(0.0, 0.0, -22.0), height=44.0, radius=18.0, axis='z')
    outer = openmc.Sphere(r=2000.0, boundary_type='vacuum')

    c_core = openmc.Cell(name='core', fill=fuel, region=-core_cyl)
    c_vessel = openmc.Cell(name='vessel', fill=water, region=+core_cyl & -vessel)
    c_void = openmc.Cell(name='hall', region=+vessel & -outer)

    geometry = openmc.Geometry(openmc.Universe(cells=[c_core, c_vessel, c_void]))
    settings = openmc.Settings()
    settings.run_mode = 'fixed source'
    settings.batches = 10
    settings.particles = 1000
    return openmc.Model(geometry=geometry,
                        materials=openmc.Materials([fuel, water]),
                        settings=settings)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--preset', default='base')
    parser.add_argument('--no-run', action='store_true')
    args = parser.parse_args()
    if 'OPENMC_CROSS_SECTIONS' not in os.environ:
        raise SystemExit('ERROR: OPENMC_CROSS_SECTIONS not set and --xs not provided.')
    model = build(args.preset)
    out = Path('runs') / args.preset
    out.mkdir(parents=True, exist_ok=True)
    model.export_to_xml(directory=str(out))
    if args.no_run:
        return
    model.run(threads=2, cwd=str(out))


if __name__ == '__main__':
    main()
`,
    'module_level.py': `import openmc

fuel = openmc.Material(name='fuel')
fuel.add_nuclide('U235', 1.0)
fuel.set_density('g/cm3', 10.0)

pin = openmc.ZCylinder(r=0.41)
clad = openmc.ZCylinder(r=0.48)
left = openmc.XPlane(x0=-0.63, boundary_type='reflective')
right = openmc.XPlane(x0=0.63, boundary_type='reflective')
back = openmc.YPlane(y0=-0.63, boundary_type='reflective')
front = openmc.YPlane(y0=0.63, boundary_type='reflective')
box = +left & -right & +back & -front
top = openmc.ZPlane(z0=5.0, boundary_type='reflective')
bottom = openmc.ZPlane(z0=-5.0, boundary_type='reflective')

water = openmc.Material(name='water')
water.add_nuclide('H1', 2.0)
water.add_nuclide('O16', 1.0)
water.set_density('g/cm3', 0.74)

inner = openmc.Cell(fill=fuel, region=-pin & -top & +bottom)
gap = openmc.Cell(region=+pin & -clad & -top & +bottom)
moderator = openmc.Cell(fill=water, region=+clad & box & -top & +bottom)
geometry = openmc.Geometry([inner, gap, moderator])
materials = openmc.Materials([fuel, water])
`,
    'builder_only.py': `import openmc


def build_model(radius=4.0):
    fuel = openmc.Material(name='fuel')
    fuel.add_nuclide('U235', 1.0)
    fuel.set_density('g/cm3', 10.0)
    sphere = openmc.Sphere(r=radius, boundary_type='vacuum')
    cell = openmc.Cell(fill=fuel, region=-sphere)
    geometry = openmc.Geometry([cell])
    settings = openmc.Settings()
    settings.batches = 5
    settings.particles = 100
    return openmc.Model(geometry=geometry, materials=openmc.Materials([fuel]), settings=settings)
`,
    'no_model.py': `import openmc

print('this deck builds nothing at all', openmc.__version__)
`,
    'overlap.py': `import openmc

fuel = openmc.Material(name='fuel')
fuel.add_nuclide('U235', 1.0)
fuel.set_density('g/cm3', 10.0)
water = openmc.Material(name='water')
water.add_nuclide('H1', 2.0)
water.add_nuclide('O16', 1.0)
water.set_density('g/cm3', 1.0)

inner = openmc.Sphere(r=5.0)
middle = openmc.Sphere(r=6.0)
outer = openmc.Sphere(r=10.0, boundary_type='vacuum')

# Both cells claim r < 5: a real overlap, which is the point of this fixture.
c_inner = openmc.Cell(name='inner', fill=fuel, region=-inner)
c_middle = openmc.Cell(name='middle', fill=water, region=-middle)
c_outer = openmc.Cell(name='outer', region=+middle & -outer)
geometry = openmc.Geometry([c_inner, c_middle, c_outer])
`,
};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function renderDeck(interp, sessionDir, deckWinPath, label, opts = {}) {
    const outDir = path.join(sessionDir, `render_${label}`);
    fs.mkdirSync(outDir, { recursive: true });
    const scriptPath = path.join(outDir, 'owen_openmc_render.py');
    fs.writeFileSync(scriptPath, core.buildHelperScript(), 'utf8');
    const plots = [{
        id: 'main',
        kind: 'slice',
        basis: opts.basis ?? 'xy',
        origin: null,
        width: null,
        pixels: [200, 200],
        colorBy: 'material',
    }];
    const request = core.buildRenderRequest(
        forInterpreter(interp, deckWinPath),
        forInterpreter(interp, outDir),
        plots,
        { fit: opts.fit ?? 'materials', deckArgs: opts.deckArgs ?? [], crossSections: opts.crossSections ?? '' },
    );
    const requestPath = path.join(outDir, 'owen_request.json');
    fs.writeFileSync(requestPath, JSON.stringify(request, null, 1), 'utf8');
    const result = tryRun(interp.command, [
        ...interp.argsPrefix,
        forInterpreter(interp, scriptPath),
        forInterpreter(interp, requestPath),
    ]);
    const resultFile = path.join(outDir, 'owen_result.json');
    if (!fs.existsSync(resultFile)) {
        return { outDir, parsed: null, stderr: result.stderr ?? '' };
    }
    return {
        outDir,
        parsed: core.parseRenderResult(fs.readFileSync(resultFile, 'utf8')),
        stderr: result.stderr ?? '',
    };
}

function verifyDeck(interp, sessionDir, deckWinPath, label) {
    const outDir = path.join(sessionDir, `verify_${label}`);
    fs.mkdirSync(outDir, { recursive: true });
    const scriptPath = path.join(outDir, 'owen_openmc_verify.py');
    fs.writeFileSync(scriptPath, verify.buildVerifyHelperScript(), 'utf8');
    const request = verify.buildVerifyRequest(
        forInterpreter(interp, deckWinPath),
        forInterpreter(interp, outDir),
        verify.defaultPlaneSpecs([200, 200]),
        false,
    );
    const requestPath = path.join(outDir, 'owen_verify_request.json');
    fs.writeFileSync(requestPath, JSON.stringify(request, null, 1), 'utf8');
    const result = tryRun(interp.command, [
        ...interp.argsPrefix,
        forInterpreter(interp, scriptPath),
        forInterpreter(interp, requestPath),
    ]);
    const resultFile = path.join(outDir, 'owen_verify_result.json');
    if (!fs.existsSync(resultFile)) {
        return { outDir, parsed: null, stderr: result.stderr ?? '' };
    }
    return {
        outDir,
        parsed: verify.parseVerifyResult(fs.readFileSync(resultFile, 'utf8')),
        stderr: result.stderr ?? '',
    };
}

/** Distinct colours in a rendered PNG — a blank frame has exactly one. */
function distinctColors(pngPath) {
    const { PNG } = require(path.join(repo, 'node_modules', 'pngjs'));
    const png = PNG.sync.read(fs.readFileSync(pngPath));
    const seen = new Set();
    for (let i = 0; i < png.data.length; i += 4) {
        seen.add((png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2]);
        if (seen.size > 32) break;
    }
    return seen.size;
}

/**
 * `--deck <path> [-- deck args…]`: render one real deck and print what the
 * helper reported. Handy for reproducing a user's "it does not render" case
 * without launching VS Code.
 */
function inspectDeck(interp, deckPath, deckArgs) {
    const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'owen-native-deck-'));
    // Images are kept outside the repo on purpose: they once landed in the
    // working tree and got packaged into the VSIX.
    const keepDir = fs.mkdtempSync(path.join(os.tmpdir(), 'owen-native-images-'));
    try {
        for (const fit of ['materials', 'geometry']) {
            const out = renderDeck(interp, sessionDir, deckPath, fit, { fit, deckArgs, basis: 'xz' });
            console.log(`\nfit=${fit}`);
            if (!out.parsed) {
                console.log('  no result file. stderr:', out.stderr.slice(0, 800));
                failures += 1;
                continue;
            }
            console.log(`  ok=${out.parsed.ok} modelSource=${out.parsed.modelSource} version=${out.parsed.version}`);
            for (const w of out.parsed.warnings) console.log(`  warn: ${w}`);
            if (out.parsed.error) console.log(`  error: ${out.parsed.error}`);
            for (const im of out.parsed.images) {
                const file = path.join(out.outDir, im.file);
                const kept = path.join(keepDir, `owen_native_${fit}_${im.file}`);
                fs.copyFileSync(file, kept);
                console.log(`  image ${kept} origin=${JSON.stringify(im.origin)} `
                    + `width=${JSON.stringify(im.width)} colors=${distinctColors(file)}`);
            }
            check(`render (fit=${fit}) succeeded with a non-blank image`,
                out.parsed.ok && out.parsed.images.length > 0
                && distinctColors(path.join(out.outDir, out.parsed.images[0].file)) > 1);
        }
    } finally {
        try {
            fs.rmSync(sessionDir, { recursive: true, force: true });
        } catch {
            // best effort
        }
    }
}

function main() {
    const interp = findInterpreter();
    if (!interp) {
        console.log('verify:openmc-native — no OpenMC-capable interpreter found; skipping.');
        return;
    }
    console.log(`verify:openmc-native — OpenMC ${interp.version} via ${interp.command} ${interp.argsPrefix.join(' ')}`);

    const argv = process.argv.slice(2);
    const deckFlag = argv.indexOf('--deck');
    if (deckFlag >= 0) {
        const deckPath = path.resolve(argv[deckFlag + 1] ?? '');
        const sep = argv.indexOf('--');
        const deckArgs = sep >= 0 ? argv.slice(sep + 1) : [];
        console.log(`\ninspecting ${deckPath}${deckArgs.length ? ` with ${deckArgs.join(' ')}` : ''}`);
        inspectDeck(interp, deckPath, deckArgs);
        console.log(`\n${checks - failures}/${checks} checks passed`);
        if (failures > 0) process.exit(1);
        return;
    }

    const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'owen-native-check-'));
    const deckDir = path.join(sessionDir, 'decks');
    fs.mkdirSync(deckDir, { recursive: true });
    for (const [name, source] of Object.entries(FIXTURES)) {
        fs.writeFileSync(path.join(deckDir, name), source, 'utf8');
    }
    const deck = (name) => path.join(deckDir, name);

    try {
        console.log('\nmodel built inside main(), gated on OPENMC_CROSS_SECTIONS, ends in model.run()');
        const gated = renderDeck(interp, sessionDir, deck('model_in_main.py'), 'gated');
        if (check('render succeeds', gated.parsed?.ok === true,
            gated.parsed?.error ?? gated.stderr.slice(0, 400))) {
            check('model came from the deck, not from XML',
                ['run', 'export', 'constructed'].includes(gated.parsed.modelSource),
                `modelSource=${gated.parsed.modelSource}`);
            const image = path.join(gated.outDir, gated.parsed.images[0]?.file ?? '');
            check('image exists and is not blank',
                fs.existsSync(image) && distinctColors(image) > 1);
            const width = gated.parsed.images[0]?.width?.[0] ?? 0;
            check('framed on the filled cells, not the 2000 cm vacuum sphere',
                width > 20 && width < 200, `width=${width}`);
            check('no transport was started',
                gated.parsed.warnings.some((w) => w.includes('model.run() in the deck was skipped')));
        }

        console.log('\nsame deck, auto fit = whole geometry');
        const whole = renderDeck(interp, sessionDir, deck('model_in_main.py'), 'whole', { fit: 'geometry' });
        check('render succeeds', whole.parsed?.ok === true, whole.parsed?.error ?? '');
        check('frames the full 4000 cm sphere',
            (whole.parsed?.images[0]?.width?.[0] ?? 0) > 3000,
            `width=${whole.parsed?.images[0]?.width?.[0]}`);

        console.log('\ndeck arguments are passed through');
        const withArgs = renderDeck(interp, sessionDir, deck('model_in_main.py'), 'args', {
            deckArgs: ['--preset', 'variant'],
        });
        check('render succeeds', withArgs.parsed?.ok === true, withArgs.parsed?.error ?? '');
        check('argv reached the deck',
            (withArgs.parsed?.warnings ?? []).some((w) => w.includes('--preset variant')),
            JSON.stringify(withArgs.parsed?.warnings ?? []));

        console.log('\nmodule-level geometry with no Model');
        const moduleLevel = renderDeck(interp, sessionDir, deck('module_level.py'), 'module');
        if (check('render succeeds', moduleLevel.parsed?.ok === true,
            moduleLevel.parsed?.error ?? moduleLevel.stderr.slice(0, 400))) {
            const image = path.join(moduleLevel.outDir, moduleLevel.parsed.images[0]?.file ?? '');
            check('pin cell renders more than one material', distinctColors(image) > 2);
        }

        console.log('\nbuilder function with defaults and no __main__ block');
        const builder = renderDeck(interp, sessionDir, deck('builder_only.py'), 'builder');
        if (check('render succeeds', builder.parsed?.ok === true,
            builder.parsed?.error ?? builder.stderr.slice(0, 400))) {
            check('reports that OWEN called the builder',
                builder.parsed.warnings.some((w) => w.includes('called build_model() directly')),
                JSON.stringify(builder.parsed.warnings));
        }

        console.log('\ndeck that builds nothing');
        const nothing = renderDeck(interp, sessionDir, deck('no_model.py'), 'nothing');
        check('reports a result file rather than crashing', nothing.parsed !== null, nothing.stderr.slice(0, 300));
        check('render fails', nothing.parsed?.ok === false);
        check('error names the real problem and what was tried',
            (nothing.parsed?.error ?? '').includes('No OpenMC model found in this deck')
            && (nothing.parsed?.error ?? '').includes('builders'),
            (nothing.parsed?.error ?? '').slice(0, 300));

        console.log('\nverify: clean geometry');
        const clean = verifyDeck(interp, sessionDir, deck('model_in_main.py'), 'clean');
        if (check('verify completes', clean.parsed?.ok === true,
            clean.parsed?.error ?? clean.stderr.slice(0, 400))) {
            check('all five planes rendered', clean.parsed.planes.length === 5,
                `planes=${clean.parsed.planes.length}`);
            check('every plane produced an image',
                clean.parsed.planes.every((p) => p.file
                    && fs.existsSync(path.join(clean.outDir, p.file))));
            check('no overlaps reported',
                clean.parsed.planes.every((p) => p.overlapPixels === 0 || p.uncounted));
        }

        console.log('\nverify: deliberate overlap');
        const overlap = verifyDeck(interp, sessionDir, deck('overlap.py'), 'overlap');
        if (check('verify completes', overlap.parsed?.ok === true,
            overlap.parsed?.error ?? overlap.stderr.slice(0, 400))) {
            const counted = overlap.parsed.planes.filter((p) => !p.uncounted);
            if (counted.length === 0) {
                console.log('  skip  overlap pixel counting (Pillow not installed)');
            } else {
                check('the overlap is detected',
                    counted.some((p) => p.overlapPixels > 0),
                    JSON.stringify(counted.map((p) => [p.id, p.overlapPixels])));
            }
        }
    } finally {
        try {
            fs.rmSync(sessionDir, { recursive: true, force: true });
        } catch {
            // best effort
        }
    }

    console.log(`\n${checks - failures}/${checks} checks passed`);
    if (failures > 0) process.exit(1);
}

main();
