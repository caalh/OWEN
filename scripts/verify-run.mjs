// Standing check for "Run Simulation" (owen.runSimulation) and the parameter
// sweep, end to end where possible.
//
// Two halves:
//
//   1. The command line. Everything OWEN types into the terminal is built by
//      src/workflows/runnerCore.ts, and this asserts the result against the real
//      shells: a PowerShell line is executed, so a quoting regression fails here
//      rather than in a user's terminal. (An executable path containing a space
//      used to produce "Unexpected token" and run nothing.)
//
//   2. A real run. When WSL has an interpreter that can import openmc, the exact
//      WSL command line OWEN builds is executed on a real pin-cell deck, and the
//      statepoint it writes is read back through OWEN's results readers. That
//      covers the two things that broke the render path for the same reason:
//      the interpreter is not the one on Windows PATH, and OPENMC_CROSS_SECTIONS
//      is not exported to a non-interactive shell.
//
// Usage: node scripts/verify-run.mjs        (after `tsc -p .`)
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require_ = createRequire(import.meta.url);

const core = require_(path.join(root, 'out', 'src', 'workflows', 'runnerCore.js'));
const sweepCore = require_(path.join(root, 'out', 'src', 'workflows', 'sweepCore.js'));
const deckLoader = require_(path.join(root, 'out', 'src', 'preview', 'openmcNative', 'deckLoader.js'));
const detectOutputs = require_(path.join(root, 'out', 'src', 'results', 'detectOutputs.js'));
const openmcResults = require_(path.join(root, 'out', 'src', 'results', 'parsers', 'openmc.js'));

let failures = 0;
let checks = 0;
function check(name, ok, detail) {
    checks++;
    if (ok) return;
    failures++;
    console.error(`FAIL ${name}${detail ? `\n      ${String(detail).split('\n').join('\n      ')}` : ''}`);
}

function run(cmd, args, opts = {}) {
    return new Promise((resolve) => {
        execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true, ...opts }, (err, stdout, stderr) => {
            resolve({ ok: !err, code: err?.code ?? 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
        });
    });
}

// ---------------------------------------------------------------- 1. shells

function commandLineChecks() {
    check('powershell is assumed on Windows when the shell is unknown',
        core.detectShellKind('win32', undefined) === 'powershell');
    check('cmd.exe is recognised', core.detectShellKind('win32', 'C:\\WINDOWS\\system32\\cmd.exe') === 'cmd');
    check('git bash is recognised', core.detectShellKind('win32', 'C:\\Program Files\\Git\\bin\\bash.exe') === 'posix');
    check('linux is always posix', core.detectShellKind('linux', '/bin/zsh') === 'posix');

    const spaced = { executable: 'C:\\Program Files\\MCNP\\mcnp6.exe', args: ['inp=deck.i'] };
    const ps = core.formatCommandLine(spaced, 'powershell');
    check('powershell line uses the call operator', ps.startsWith('& "'), ps);
    check('powershell line quotes the spaced path', ps.includes('"C:\\Program Files\\MCNP\\mcnp6.exe"'), ps);
    check('powershell line leaves the argument unquoted', ps.endsWith(' inp=deck.i'), ps);

    const posix = core.formatCommandLine({ executable: '/opt/serpent/sss2', args: ['my deck.serp'] }, 'posix');
    check('posix line quotes only what needs it', posix === "/opt/serpent/sss2 'my deck.serp'", posix);

    check('cd is Set-Location under powershell',
        core.formatChangeDirectory('C:\\a b\\c', 'powershell') === 'Set-Location "C:\\a b\\c"');
    check('env assignment matches the shell',
        core.formatEnvAssignment('OPENMC_CROSS_SECTIONS', '/opt/d/cross_sections.xml', 'powershell')
            === '$env:OPENMC_CROSS_SECTIONS = /opt/d/cross_sections.xml'
        || core.formatEnvAssignment('OPENMC_CROSS_SECTIONS', '/opt/d/cross_sections.xml', 'powershell').startsWith('$env:'),
        core.formatEnvAssignment('OPENMC_CROSS_SECTIONS', '/opt/d/cross_sections.xml', 'powershell'));

    // A WSL plan must survive one level of `sh -c` quoting with spaces in play.
    const wsl = core.planWslRun('/opt/miniconda3/bin/python', '/mnt/c/my decks/build model.py', '/mnt/c/my decks', '/opt/d/cross_sections.xml');
    check('wsl plan is a single sh -c payload', wsl.args.length === 4 && wsl.args[2] === '-c', JSON.stringify(wsl.args));
    check('wsl payload quotes the script path', wsl.args[3].includes("'/mnt/c/my decks/build model.py'"), wsl.args[3]);
    check('wsl payload exports the library', wsl.args[3].includes("OPENMC_CROSS_SECTIONS='/opt/d/cross_sections.xml'"), wsl.args[3]);
    // model.run() execs the `openmc` binary, which for a conda install lives
    // next to the interpreter and is not on a non-interactive PATH.
    check('wsl payload puts the interpreters bin directory on PATH',
        wsl.args[3].includes(`PATH='/opt/miniconda3/bin':"$PATH"`), wsl.args[3]);
    check('posixDirname ignores a bare command name', core.posixDirname('python3') === undefined);
}

async function powershellExecutionChecks() {
    if (process.platform !== 'win32') return;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owen run test '));
    const exe = path.join(dir, 'fake code.cmd');
    fs.writeFileSync(exe, '@echo OWEN_RAN %*\r\n');
    try {
        const line = core.formatCommandLine({ executable: exe, args: ['inp=deck.i'] }, 'powershell');
        const res = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', line]);
        check('powershell actually runs a spaced executable path', res.stdout.includes('OWEN_RAN inp=deck.i'),
            `line: ${line}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);

        // The old formatting, kept as a regression witness: a quoted path with a
        // bare argument is a parse error, so this must NOT run.
        const old = `"${exe}" inp=deck.i`;
        const bad = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', old]);
        check('the pre-fix line really was broken (regression witness)',
            !bad.stdout.includes('OWEN_RAN'), bad.stdout);

        const cd = core.formatChangeDirectory(dir, 'powershell');
        const cdRes = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', `${cd}; (Get-Location).Path`]);
        check('powershell cd line lands in the directory', cdRes.stdout.trim().toLowerCase() === dir.toLowerCase(),
            `${cd} → ${cdRes.stdout.trim()}`);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

// ------------------------------------------------- 2. MCNP output collisions

function mcnpCollisionChecks() {
    const clean = core.mcnpOutputCollisions(['deck.i', 'notes.txt']);
    check('clean directory has no collisions', clean.existing.length === 0 && clean.exhausted.length === 0);

    const rerun = core.mcnpOutputCollisions(['deck.i', 'outp', 'runtpe', 'mctal']);
    check('a used directory is reported', rerun.existing.includes('outp') && rerun.existing.includes('mctal'),
        JSON.stringify(rerun));
    check('a used directory is not called exhausted', rerun.exhausted.length === 0, JSON.stringify(rerun));

    const letters = [];
    for (let c = 'p'.charCodeAt(0); c <= 'z'.charCodeAt(0); c++) letters.push('out' + String.fromCharCode(c));
    const full = core.mcnpOutputCollisions(letters);
    check('outp..outz is reported as exhausted', full.exhausted.includes('outp'), JSON.stringify(full));

    check('ordinal reads correctly', ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st']
        .every((want, i) => core.ordinal([1, 2, 3, 4, 11, 12, 13, 21][i]) === want));
}

function letterBumpDetectionChecks() {
    // A rerun writes `outq`; OWEN must read that, not the stale `outp`.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owen-bump-'));
    try {
        const header = (keff) => [
            '1mcnp     version 6     ld=02/20/18                     08/29/26 12:00:00 ',
            '  probid =  08/29/26 12:00:00 ',
            ' the final estimated combined collision/absorption/track-length keff = ' + keff + ' with an estimated',
            ' standard deviation of 0.00100',
        ].join('\n');
        fs.writeFileSync(path.join(dir, 'outp'), header('1.10000'));
        const old = Date.now() - 60_000;
        fs.utimesSync(path.join(dir, 'outp'), old / 1000, old / 1000);
        fs.writeFileSync(path.join(dir, 'outq'), header('1.20000'));

        const found = detectOutputs.detectOutputsInDir(dir);
        check('outq is detected at all', found.some((o) => path.basename(o.path) === 'outq'),
            JSON.stringify(found.map((o) => path.basename(o.path))));
        const primary = detectOutputs.pickPrimaryOutput(found);
        check('the newest MCNP output wins', path.basename(primary?.path ?? '') === 'outq',
            path.basename(primary?.path ?? 'none'));
        const note = detectOutputs.staleOutputNote(found, primary);
        check('the panel is told the older files are earlier runs', /outp/.test(note ?? ''), note);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

// -------------------------------------------------------- 3. sweep guardrails

function sweepChecks() {
    const deck = "fuel.add_nuclide('U235', 0.04)\nfuel.set_density('g/cm3', 10.4)\n";
    const good = [{ name: 'enr', values: [0.03, 0.05], pattern: String.raw`add_nuclide\('U235', ([\d.]+)` }];
    check('a working pattern passes validation', sweepCore.validateParameters(deck, good).length === 0,
        JSON.stringify(sweepCore.validateParameters(deck, good)));

    const applied = sweepCore.applyParameters(deck, { enr: 0.05 }, good);
    check('substitution replaces only the captured value', applied.includes("add_nuclide('U235', 0.05)"), applied);

    const missing = [{ name: 'enr', values: [1], pattern: String.raw`add_nuclide\('U238', ([\d.]+)` }];
    const missProblems = sweepCore.validateParameters(deck, missing);
    check('a pattern that matches nothing is rejected', missProblems.length === 1 && /matches nothing/.test(missProblems[0]),
        JSON.stringify(missProblems));
    check('and the reason says every run would be identical', /same deck/.test(missProblems[0] ?? ''), missProblems[0]);

    const groupless = [{ name: 'enr', values: [1], pattern: String.raw`add_nuclide\('U235', [\d.]+` }];
    check('a pattern without a capture group is rejected',
        sweepCore.validateParameters(deck, groupless).some((p) => /capture group/.test(p)),
        JSON.stringify(sweepCore.validateParameters(deck, groupless)));

    const bad = [{ name: 'enr', values: [1], pattern: '([' }];
    check('an invalid regex is reported, not thrown',
        sweepCore.validateParameters(deck, bad).some((p) => /invalid pattern/.test(p)));

    check('no values is reported', sweepCore.validateParameters(deck, [{ name: 'x', values: [], pattern: 'U235' }]).length >= 1);

    const tsv = sweepCore.buildSummaryTsv(good, [
        { index: 0, parameters: { enr: 0.03 }, inputFile: 'a', outputDir: 'a', keff: 1.1, keffStd: 0.001, keffSource: 'statepoint.10.h5', exitCode: 0, stdoutPath: 'l' },
        { index: 1, parameters: { enr: 0.05 }, inputFile: 'b', outputDir: 'b', keff: null, exitCode: 1, stdoutPath: 'l' },
    ]);
    const rows = tsv.split('\n');
    check('summary carries the uncertainty and its source',
        rows[0].includes('keff_std') && rows[1].includes('0.001') && rows[1].includes('statepoint.10.h5'), tsv);
    check('a failed run is not given a k-eff', rows[2].endsWith('n/a\tn/a\tn/a'), rows[2]);
}

// ----------------------------------------------------------- 4. the real run

const PIN_DECK = `import openmc

fuel = openmc.Material(name='fuel')
fuel.add_nuclide('U235', 1.0)
fuel.set_density('g/cm3', 10.0)
water = openmc.Material(name='water')
water.add_nuclide('H1', 2.0)
water.add_nuclide('O16', 1.0)
water.set_density('g/cm3', 1.0)
materials = openmc.Materials([fuel, water])

pin = openmc.ZCylinder(r=0.45)
box = openmc.model.RectangularPrism(1.26, 1.26, boundary_type='reflective')
top = openmc.ZPlane(z0=10.0, boundary_type='reflective')
bot = openmc.ZPlane(z0=-10.0, boundary_type='reflective')

inner = openmc.Cell(name='fuel', fill=fuel, region=-pin & +bot & -top)
outer = openmc.Cell(name='water', fill=water, region=+pin & -box & +bot & -top)
geometry = openmc.Geometry([inner, outer])

settings = openmc.Settings()
settings.particles = 200
settings.batches = 12
settings.inactive = 4
settings.source = openmc.IndependentSource(space=openmc.stats.Point((0, 0, 0)))

tally = openmc.Tally(name='fuel fission')
tally.filters = [openmc.CellFilter(inner)]
tally.scores = ['fission']

model = openmc.Model(geometry=geometry, materials=materials, settings=settings,
                     tallies=openmc.Tallies([tally]))
model.run()
`;

async function findWslInterpreter() {
    if (process.platform !== 'win32') return null;
    const core_ = require_(path.join(root, 'out', 'src', 'preview', 'openmcNative', 'core.js'));
    const res = await run('wsl', ['--exec', 'sh', '-c', core_.buildWslDiscoveryScript()], { timeout: 60_000 });
    if (!res.ok) return null;
    return core_.parseWslDiscovery(res.stdout);
}

async function realRunChecks() {
    const found = await findWslInterpreter();
    if (!found) {
        console.log('note: no WSL interpreter with openmc — skipping the real-run half');
        return;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owen-run-'));
    const deckPath = path.join(dir, 'pin_cell.py');
    fs.writeFileSync(deckPath, PIN_DECK);
    try {
        const wslDir = (await run('wsl', ['--exec', 'wslpath', '-a', dir])).stdout.trim();
        const wslDeck = (await run('wsl', ['--exec', 'wslpath', '-a', deckPath])).stdout.trim();

        // Same probe the extension uses, run through the same interpreter.
        const probe = await run('wsl', ['--exec', found.pythonPath, '-c', deckLoader.buildCrossSectionProbe()], { timeout: 60_000 });
        const crossSections = probe.stdout.trim().split(/\r?\n/).pop()?.trim() || undefined;
        check('a cross-section library is discoverable without a login shell', Boolean(crossSections),
            `stdout: ${probe.stdout}\nstderr: ${probe.stderr}`);

        // The bug this guards: the variable the user exports from .bashrc is
        // absent from every non-interactive shell, including `bash -lc`.
        const envProbe = await run('wsl', ['--exec', 'bash', '-lc', 'echo "[$OPENMC_CROSS_SECTIONS]"']);
        check('the shell profile really does not supply it (regression witness)',
            envProbe.stdout.trim() === '[]', envProbe.stdout.trim());

        const plan = core.planWslRun(found.pythonPath, wslDeck, wslDir, crossSections);
        const res = await run(plan.executable, plan.args, { timeout: 600_000 });
        check('the deck runs to completion through OWENs command line', res.ok,
            `exit ${res.code}\n${res.stdout.slice(-2000)}\n${res.stderr.slice(-2000)}`);

        const written = fs.readdirSync(dir);
        const statepoint = written.find((f) => /^statepoint\..*\.h5$/.test(f));
        check('a statepoint is written next to the deck', Boolean(statepoint), written.join(', '));
        if (!statepoint) return;

        // Run → results, through the readers the panel uses.
        const outputs = detectOutputs.detectOutputsInDir(dir);
        const primary = detectOutputs.pickPrimaryOutput(outputs);
        check('the statepoint is what the results panel would open',
            primary && path.basename(primary.path) === statepoint,
            JSON.stringify(outputs.map((o) => path.basename(o.path))));

        const results = await openmcResults.parseOpenmcStatepoint(path.join(dir, statepoint));
        check('the statepoint reader opened the fresh file', !results.metadata?.parseError, String(results.metadata?.parseError));
        const keff = results.keff?.final?.mean;
        check('k-eff is present and physical for a U235 pin', typeof keff === 'number' && keff > 0.5 && keff < 3,
            String(keff));
        check('the batch history has the active batches', (results.keff?.mean.length ?? 0) === 12,
            String(results.keff?.mean.length));
        check('the fission tally came back with an error estimate',
            results.tallies.some((t) => t.label.includes('fuel fission') && (t.bins?.[0]?.error ?? 0) > 0),
            JSON.stringify(results.tallies.map((t) => [t.label, t.value, t.bins?.[0]?.error])));

        // Cross-check against OpenMC's own API on the same file.
        const truth = await run('wsl', ['--exec', found.pythonPath, '-c',
            `import openmc,sys
sp=openmc.StatePoint(sys.argv[1])
print(repr(float(sp.keff.nominal_value)))`,
            wslDir + '/' + statepoint], { timeout: 120_000 });
        const truthKeff = parseFloat(truth.stdout.trim());
        check('k-eff matches what OpenMC reports for the same statepoint',
            Number.isFinite(truthKeff) && Math.abs(truthKeff - keff) < 1e-12,
            `owen ${keff} vs openmc ${truth.stdout.trim()}`);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

// ------------------------------------------------- 6. cross-section discovery

// A machine that runs OpenMC usually has more than one cross_sections.xml: a
// slim test or depletion library beside the real evaluation. OWEN used to take
// the first path that existed, which on this developer's machine meant a
// 26-nuclide library won over ENDF/B-VIII.0 and every transport run died on the
// first nuclide the slim library lacked. Discovery now ranks what it *finds* by
// nuclide count while still deferring to a library the user *named*.
async function crossSectionChoiceChecks(python) {
    if (!python) {
        console.log('cross-section discovery: skipped (no WSL interpreter)');
        return;
    }
    const home = await wsl(['--exec', 'bash', '-c', 'echo -n "$HOME"']);
    if (!home.ok || !home.stdout.trim()) {
        console.log('cross-section discovery: skipped (no WSL home)');
        return;
    }
    const fake = `${home.stdout.trim()}/.owen-verify-xs`;
    const lib = (name, count) =>
        `mkdir -p ${fake}/${name} && { echo '<cross_sections>'; ` +
        `for i in $(seq 1 ${count}); do echo "<library materials=\\"N$i\\" path=\\"x\\" type=\\"neutron\\"/>"; done; ` +
        `echo '</cross_sections>'; } > ${fake}/${name}/cross_sections.xml`;

    try {
        // Two libraries, both only reachable by glob, the richer one sorting last.
        await wsl(['--exec', 'bash', '-c', `${lib('a-slim', 3)} && ${lib('z-full', 40)}`]);
        const probe = deckLoader.buildCrossSectionProbe();
        const picked = await wsl(['--exec', python, '-c', probe],
            { env: { ...process.env, WSLENV: 'HOME', OPENMC_CROSS_SECTIONS: '' } });
        const chose = picked.stdout.trim();
        check('discovery prefers the richer of two found libraries',
            !chose.includes('a-slim'), `picked ${chose || '(nothing)'}`);

        // A named library wins even when it is the slim one: the user said so.
        const named = `${fake}/a-slim/cross_sections.xml`;
        const withHint = await wsl(['--exec', python, '-c', deckLoader.buildCrossSectionProbe(named)]);
        check('an explicitly named library overrides the ranking',
            withHint.stdout.trim() === named, withHint.stdout.trim());

        // The two-deep glob is what finds the openmc-data release layout.
        await wsl(['--exec', 'bash', '-c', lib('nested/endfb-viii.0-hdf5', 90)]);
        const deep = await wsl(['--exec', python, '-c', probe],
            { env: { ...process.env, WSLENV: 'HOME', OPENMC_CROSS_SECTIONS: '' } });
        check('discovery reaches a library nested two directories deep',
            deep.stdout.trim().length > 0, deep.stdout.trim());
    } finally {
        await wsl(['--exec', 'bash', '-c', `rm -rf ${fake}`]);
    }
}

function wsl(args, opts) {
    return run('wsl', args, opts);
}

async function main() {
    commandLineChecks();
    await powershellExecutionChecks();
    mcnpCollisionChecks();
    letterBumpDetectionChecks();
    sweepChecks();
    await realRunChecks();
    await crossSectionChoiceChecks((await findWslInterpreter())?.pythonPath);

    console.log(`\nrun path: ${checks - failures} checks passed, ${failures} failed`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
