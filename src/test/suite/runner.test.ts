// "Run Simulation" command-line construction (src/workflows/runnerCore.ts).
//
// The end-to-end counterpart is scripts/verify-run.mjs, which executes these
// lines in real PowerShell and runs a real OpenMC deck through the WSL plan.
import * as assert from 'assert';
import {
    detectShellKind,
    formatChangeDirectory,
    formatCommandLine,
    formatEnvAssignment,
    mcnpOutputCollisions,
    ordinal,
    planLaunch,
    planWslRun,
    posixDirname,
    quoteArg,
    shQuote,
} from '../../workflows/runnerCore';

const get = (values: Record<string, string>) => (key: string) => values[key];

suite('Run command — shell detection', () => {
    test('unknown Windows shell is treated as PowerShell', () => {
        assert.strictEqual(detectShellKind('win32', undefined), 'powershell');
        assert.strictEqual(detectShellKind('win32', 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'), 'powershell');
    });

    test('cmd and POSIX shells on Windows are distinguished', () => {
        assert.strictEqual(detectShellKind('win32', 'C:\\WINDOWS\\system32\\cmd.exe'), 'cmd');
        assert.strictEqual(detectShellKind('win32', 'C:\\Program Files\\Git\\bin\\bash.exe'), 'posix');
        assert.strictEqual(detectShellKind('win32', 'C:\\WINDOWS\\system32\\wsl.exe'), 'posix');
    });

    test('non-Windows is always POSIX', () => {
        assert.strictEqual(detectShellKind('linux', '/bin/zsh'), 'posix');
        assert.strictEqual(detectShellKind('darwin', undefined), 'posix');
    });
});

suite('Run command — quoting', () => {
    test('PowerShell needs the call operator for a quoted executable', () => {
        // Without `&`, PowerShell parses `"C:\...\mcnp6.exe" inp=deck.i` as a
        // string followed by a stray token and raises "Unexpected token".
        const line = formatCommandLine(
            { executable: 'C:\\Program Files\\MCNP\\mcnp6.exe', args: ['inp=deck.i'] },
            'powershell',
        );
        assert.strictEqual(line, '& "C:\\Program Files\\MCNP\\mcnp6.exe" inp=deck.i');
    });

    test('an unspaced executable is still invoked with the call operator', () => {
        assert.strictEqual(formatCommandLine({ executable: 'mcnp6', args: ['inp=a.i'] }, 'powershell'), '& mcnp6 inp=a.i');
    });

    test('POSIX quoting only kicks in when needed, and escapes single quotes', () => {
        assert.strictEqual(quoteArg('sss2', 'posix'), 'sss2');
        assert.strictEqual(quoteArg('/opt/serpent/sss2', 'posix'), '/opt/serpent/sss2');
        assert.strictEqual(quoteArg('my deck.serp', 'posix'), "'my deck.serp'");
        assert.strictEqual(quoteArg("it's.i", 'posix'), "'it'\\''s.i'");
    });

    test('cd uses Set-Location under PowerShell', () => {
        assert.strictEqual(formatChangeDirectory('C:\\a b\\c', 'powershell'), 'Set-Location "C:\\a b\\c"');
        assert.strictEqual(formatChangeDirectory('/home/me/decks', 'posix'), 'cd /home/me/decks');
    });

    test('environment assignment follows the shell', () => {
        assert.strictEqual(formatEnvAssignment('X', '/a/b.xml', 'powershell'), '$env:X = /a/b.xml');
        assert.strictEqual(formatEnvAssignment('X', '/a b/c.xml', 'powershell'), '$env:X = "/a b/c.xml"');
        assert.strictEqual(formatEnvAssignment('X', '/a/b.xml', 'posix'), 'export X=/a/b.xml');
        assert.strictEqual(formatEnvAssignment('X', '/a/b.xml', 'cmd'), 'set X=/a/b.xml');
    });
});

suite('Run command — launch plans', () => {
    test('each code gets its own invocation', () => {
        assert.deepStrictEqual(planLaunch('mcnp', 'deck.i', get({}))?.args, ['inp=deck.i']);
        assert.strictEqual(planLaunch('mcnp', 'deck.i', get({ 'mcnp.executable': 'mcnp6.mpi' }))?.executable, 'mcnp6.mpi');
        assert.strictEqual(planLaunch('openmc', 'model.py', get({}))?.executable, 'python');
        assert.strictEqual(planLaunch('serpent', 'a.serp', get({}))?.executable, 'sss2');
        assert.strictEqual(planLaunch('scone', 'a.scone', get({}))?.executable, 'scone');
        assert.strictEqual(planLaunch(null, 'x.txt', get({})), null);
    });

    test('SCONE on Windows carries the WSL note', () => {
        assert.ok(planLaunch('scone', 'a.scone', get({}), 'win32')?.info?.includes('WSL'));
        assert.strictEqual(planLaunch('scone', 'a.scone', get({}), 'linux')?.info, undefined);
    });

    test('the WSL plan repairs both PATH and the cross-section variable', () => {
        // Neither is exported to a non-interactive shell, and each has its own
        // failure: "No cross_sections.xml file was specified" for the library,
        // and FileNotFoundError 'openmc' from model.run() for PATH.
        const plan = planWslRun('/opt/miniconda3/bin/python', '/mnt/c/d/m.py', '/mnt/c/d', '/opt/data/cross_sections.xml');
        assert.strictEqual(plan.executable, 'wsl');
        assert.deepStrictEqual(plan.args.slice(0, 3), ['--exec', 'sh', '-c']);
        assert.ok(plan.args[3].includes(`PATH='/opt/miniconda3/bin':"$PATH"`), plan.args[3]);
        assert.ok(plan.args[3].includes(`OPENMC_CROSS_SECTIONS='/opt/data/cross_sections.xml'`), plan.args[3]);
        assert.ok(plan.args[3].startsWith(`cd '/mnt/c/d' && `), plan.args[3]);
    });

    test('the WSL plan omits the library when none was found', () => {
        const plan = planWslRun('/usr/bin/python3', '/mnt/c/d/m.py', '/mnt/c/d');
        assert.ok(!plan.args[3].includes('OPENMC_CROSS_SECTIONS'), plan.args[3]);
        assert.ok(plan.args[3].includes(`PATH='/usr/bin':"$PATH"`), plan.args[3]);
    });

    test('spaces in WSL paths survive the sh -c payload', () => {
        const plan = planWslRun('/opt/py/python', '/mnt/c/my decks/m.py', '/mnt/c/my decks');
        assert.ok(plan.args[3].includes(`cd '/mnt/c/my decks'`), plan.args[3]);
        assert.ok(plan.args[3].includes(`'/mnt/c/my decks/m.py'`), plan.args[3]);
    });

    test('posixDirname and shQuote handle the awkward cases', () => {
        assert.strictEqual(posixDirname('/opt/a/bin/python'), '/opt/a/bin');
        assert.strictEqual(posixDirname('python3'), undefined);
        assert.strictEqual(posixDirname('/python'), undefined);
        assert.strictEqual(shQuote("a'b"), "'a'\\''b'");
    });
});

suite('Run command — MCNP output collisions', () => {
    test('a clean directory is clean', () => {
        const { existing, exhausted } = mcnpOutputCollisions(['deck.i', 'README.md']);
        assert.deepStrictEqual(existing, []);
        assert.deepStrictEqual(exhausted, []);
    });

    test('previous output is found across all families, case-insensitively', () => {
        const { existing } = mcnpOutputCollisions(['OUTP', 'runtpe', 'mctal', 'meshtal', 'srctp']);
        assert.deepStrictEqual(existing.sort(), ['mctal', 'meshtal', 'outp', 'runtpe', 'srctp']);
    });

    test('letter-bumped names count as taken', () => {
        // MCNP wrote outp, then outq; the next run gets outr.
        const { existing, exhausted } = mcnpOutputCollisions(['outp', 'outq']);
        assert.deepStrictEqual(existing, ['outp', 'outq']);
        assert.deepStrictEqual(exhausted, []);
    });

    test('outp through outz leaves nowhere to write', () => {
        const names: string[] = [];
        for (let c = 'p'.charCodeAt(0); c <= 'z'.charCodeAt(0); c++) names.push('out' + String.fromCharCode(c));
        assert.deepStrictEqual(mcnpOutputCollisions(names).exhausted, ['outp']);
        // One short of the full set is still usable.
        assert.deepStrictEqual(mcnpOutputCollisions(names.slice(0, -1)).exhausted, []);
    });

    test('unrelated files ending in the same letters are ignored', () => {
        assert.deepStrictEqual(mcnpOutputCollisions(['layout', 'checkout', 'mctal.bak']).existing, []);
    });

    test('ordinal', () => {
        assert.deepStrictEqual([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal),
            ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
    });
});
