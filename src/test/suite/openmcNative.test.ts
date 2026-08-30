import * as assert from 'assert';
import {
    buildHelperScript,
    buildRenderRequest,
    buildWslDiscoveryScript,
    OPENMC_PROBE_SNIPPET,
    orderCandidates,
    parseProbeOutput,
    parseRenderResult,
    parseWslDiscovery,
    toWslPath,
    PlotSpec,
    parseDeckArgs,
} from '../../preview/openmcNative/core';
import { normalizeDeckOptions } from '../../preview/openmcNative/deckLoader';
import { isCaptureNoise } from '../../preview/openmcNative/captureNoise';

suite('OpenMC native render — deck arguments', () => {
    test('splits on whitespace and respects quotes', () => {
        assert.deepStrictEqual(parseDeckArgs('--preset seventy_thirty_base'), ['--preset', 'seventy_thirty_base']);
        assert.deepStrictEqual(parseDeckArgs('--cwd "run dir" -n 5'), ['--cwd', 'run dir', '-n', '5']);
        assert.deepStrictEqual(parseDeckArgs("--name 'a b'"), ['--name', 'a b']);
        assert.deepStrictEqual(parseDeckArgs('   '), []);
        assert.deepStrictEqual(parseDeckArgs(undefined), []);
    });

    test('an empty quoted argument survives (it is a real argv entry)', () => {
        assert.deepStrictEqual(parseDeckArgs('--tag ""'), ['--tag', '']);
    });

    test('options default to framing the filled cells', () => {
        assert.deepStrictEqual(normalizeDeckOptions(undefined), {
            crossSections: '',
            deckArgs: [],
            fit: 'materials',
        });
        assert.strictEqual(normalizeDeckOptions({ fit: 'geometry' }).fit, 'geometry');
        assert.strictEqual(normalizeDeckOptions({ crossSections: '  /opt/xs.xml ' }).crossSections, '/opt/xs.xml');
    });
});

suite('OpenMC native render — interpreter candidate ordering', () => {
    test('explicit setting outranks everything', () => {
        const c = orderCandidates({
            explicitSetting: 'C:\\envs\\omc\\python.exe',
            msPythonPath: 'C:\\other\\python.exe',
            platform: 'win32',
        });
        assert.strictEqual(c[0].kind, 'setting');
        assert.strictEqual(c[0].command, 'C:\\envs\\omc\\python.exe');
        assert.strictEqual(c[1].kind, 'ms-python');
    });

    test('ms-python interpreter outranks PATH pythons', () => {
        const c = orderCandidates({ msPythonPath: '/usr/bin/python3.11', platform: 'linux' });
        assert.deepStrictEqual(
            c.map((x) => x.kind),
            ['ms-python', 'path', 'path'],
        );
        assert.strictEqual(c[1].command, 'python');
        assert.strictEqual(c[2].command, 'python3');
    });

    test('WSL python3 is the final candidate on Windows only', () => {
        const win = orderCandidates({ platform: 'win32' });
        const last = win[win.length - 1];
        assert.strictEqual(last.kind, 'wsl');
        assert.strictEqual(last.command, 'wsl');
        assert.deepStrictEqual(last.argsPrefix, ['--exec', 'python3']);
        assert.strictEqual(last.needsWslPaths, true);

        const linux = orderCandidates({ platform: 'linux' });
        assert.ok(linux.every((x) => x.kind !== 'wsl'), 'no WSL candidate off Windows');
    });

    test('duplicate setting/ms-python paths are collapsed (case-insensitive on win32)', () => {
        const c = orderCandidates({
            explicitSetting: 'C:\\Env\\python.exe',
            msPythonPath: 'c:/env/python.exe',
            platform: 'win32',
        });
        assert.strictEqual(c.filter((x) => x.kind === 'setting' || x.kind === 'ms-python').length, 1);
        assert.strictEqual(c[0].kind, 'setting');
    });

    test('blank/whitespace setting is ignored', () => {
        const c = orderCandidates({ explicitSetting: '   ', platform: 'linux' });
        assert.strictEqual(c[0].kind, 'path');
    });

    test('non-WSL candidates never request path translation', () => {
        const c = orderCandidates({ explicitSetting: 'python', msPythonPath: '/x/python', platform: 'win32' });
        for (const cand of c) {
            assert.strictEqual(cand.needsWslPaths, cand.kind === 'wsl');
        }
    });
});

suite('OpenMC native render — probe protocol', () => {
    test('probe snippet imports openmc and prints a sentinel + version', () => {
        assert.ok(OPENMC_PROBE_SNIPPET.includes('import openmc'));
        assert.ok(OPENMC_PROBE_SNIPPET.includes('OWEN_OPENMC'));
    });

    test('parseProbeOutput extracts the version after the sentinel', () => {
        assert.strictEqual(parseProbeOutput('OWEN_OPENMC 0.15.2'), '0.15.2');
        assert.strictEqual(parseProbeOutput('some noise\nOWEN_OPENMC 0.13.3\n'), '0.13.3');
    });

    test('parseProbeOutput rejects output without the sentinel', () => {
        assert.strictEqual(parseProbeOutput(''), null);
        assert.strictEqual(parseProbeOutput('Python 3.11.4'), null);
        assert.strictEqual(parseProbeOutput("ModuleNotFoundError: No module named 'openmc'"), null);
    });
});

suite('OpenMC native render — WSL interpreter discovery', () => {
    test('discovery script tries python3 first, then common conda locations', () => {
        const script = buildWslDiscoveryScript();
        assert.ok(script.startsWith('for p in "python3"'));
        assert.ok(script.includes('/opt/miniconda3/bin/python'));
        assert.ok(script.includes('$HOME/miniconda3/bin/python'));
        assert.ok(script.includes('exit 1'), 'exits non-zero when nothing is found');
    });

    test('parseWslDiscovery extracts the winning interpreter and version', () => {
        const found = parseWslDiscovery('OWEN_OPENMC_PY /opt/miniconda3/bin/python 0.15.3');
        assert.deepStrictEqual(found, { pythonPath: '/opt/miniconda3/bin/python', version: '0.15.3' });
        assert.strictEqual(parseWslDiscovery('no dice'), null);
    });
});

suite('OpenMC native render — WSL path translation fallback', () => {
    test('drive letter paths map to /mnt/<drive>', () => {
        assert.strictEqual(toWslPath('C:\\Users\\me\\model.py'), '/mnt/c/Users/me/model.py');
        assert.strictEqual(toWslPath('D:/data/deck.py'), '/mnt/d/data/deck.py');
    });

    test('non-drive paths only get separators normalized', () => {
        assert.strictEqual(toWslPath('relative\\dir\\x.py'), 'relative/dir/x.py');
    });
});

suite('OpenMC native render — helper script generation', () => {
    const script = buildHelperScript();

    test('monkey-patches openmc.run and Model.run so decks cannot start transport', () => {
        assert.ok(script.includes('openmc.run = _skip_run'));
        assert.ok(script.includes('model_cls.run = _model_run'));
        assert.ok(script.includes("run_name='__main__'"), 'deck executed as __main__ via runpy');
    });

    test('captures models built inside a function, not just module globals', () => {
        // A deck whose model is a local in main() used to be invisible.
        assert.ok(script.includes('model_cls.__init__ = _model_init'));
        assert.ok(script.includes('geometry_cls.__init__ = _geometry_init'));
        assert.ok(script.includes('owen_call_builders'), 'zero-argument builders are a fallback');
    });

    test('lends the deck a cross-section path and withdraws a stand-in before plotting', () => {
        assert.ok(script.includes('owen_prepare_cross_sections'));
        assert.ok(script.includes('owen_release_cross_sections'));
        assert.ok(script.includes("os.environ['OPENMC_CROSS_SECTIONS'] = found"));
        assert.ok(!script.includes('was not set for this process'),
            'finding a library is success, not a warning that paints the empty overlay');
    });

    test('stubs openmc.StatePoint so decks that open model.run() do not FileNotFound', () => {
        assert.ok(script.includes('_owen_install_statepoint_stub'));
        assert.ok(script.includes('_OwenDummyStatePoint'));
        assert.ok(script.includes('openmc.StatePoint = _OwenDummyStatePoint'));
        assert.ok(script.includes('owen_skipped_statepoint.h5'));
    });

    test('automatic framing prefers the material-filled cells', () => {
        assert.ok(script.includes('owen_geometry_bounds'));
        assert.ok(script.includes("if fit == 'materials'"));
        assert.ok(script.includes("getattr(cell, 'fill', None) is None"));
    });

    test('uses the stable plots.xml + plot_geometry path, ray trace only if available', () => {
        assert.ok(script.includes('openmc.Plots(plots).export_to_xml()'));
        assert.ok(script.includes("ctx['realPlotGeometry']"));
        assert.ok(script.includes("[exe, '--plot']"), 'subprocess fallback for old APIs');
        assert.ok(script.includes("os.path.dirname(sys.executable), 'openmc'"), 'finds openmc binary next to interpreter');
        assert.ok(script.includes("getattr(openmc, 'SolidRayTracePlot', None)"));
    });

    test('writes owen_result.json and reports image basenames', () => {
        assert.ok(script.includes("'owen_result.json'"));
        assert.ok(script.includes('OWEN_RESULT_WRITTEN'));
        assert.ok(script.includes('os.path.basename'));
    });

    test('is ASCII-only so it survives any locale/codec on the Python side', () => {
        // eslint-disable-next-line no-control-regex
        assert.ok(/^[\x00-\x7F]*$/.test(script), 'helper script must be pure ASCII');
    });

    test('capture chatter is classified as noise, not a deck defect', () => {
        assert.ok(isCaptureNoise('OPENMC_CROSS_SECTIONS was not set for this process; using /tmp/xs.xml.'));
        assert.ok(isCaptureNoise('model.run() in the deck was skipped (geometry-export pass).'));
        assert.ok(isCaptureNoise('The deck continued past the point OWEN stopped it and raised FileNotFoundError: owen_skipped_statepoint.h5'));
        assert.ok(!isCaptureNoise('No OpenMC cells were found in this XML.'));
    });

    test('render request carries translated paths + plot specs verbatim', () => {
        const plots: PlotSpec[] = [
            { id: 'main', kind: 'slice', basis: 'xz', origin: [0, 0, 10], width: [20, 20], pixels: [800, 800], colorBy: 'cell' },
        ];
        const req = buildRenderRequest('/mnt/c/deck.py', '/mnt/c/tmp/out', plots);
        assert.strictEqual(req.deckPath, '/mnt/c/deck.py');
        assert.strictEqual(req.outDir, '/mnt/c/tmp/out');
        assert.deepStrictEqual(req.plots[0].origin, [0, 0, 10]);
        assert.strictEqual(req.plots[0].basis, 'xz');
    });
});

suite('OpenMC native render — result parsing', () => {
    test('accepts a well-formed result', () => {
        const r = parseRenderResult(JSON.stringify({
            ok: true,
            version: '0.15.2',
            modelSource: 'captured',
            capabilities: { rayTrace: true },
            images: [{ id: 'main', kind: 'slice', basis: 'xy', file: 'owen_plot_main.png', origin: [0, 0, 0], width: [10, 10] }],
            warnings: ['openmc.run() in the deck was skipped (render-only pass).'],
            error: null,
        }));
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.version, '0.15.2');
        assert.strictEqual(r.images.length, 1);
        assert.strictEqual(r.capabilities.rayTrace, true);
    });

    test('drops images whose file field tries to escape the out dir', () => {
        const r = parseRenderResult(JSON.stringify({
            ok: true,
            images: [
                { id: 'a', kind: 'slice', basis: 'xy', file: '../../etc/passwd', origin: [0, 0, 0], width: [1, 1] },
                { id: 'b', kind: 'slice', basis: 'xy', file: 'good.png', origin: [0, 0, 0], width: [1, 1] },
            ],
        }));
        assert.strictEqual(r.images.length, 1);
        assert.strictEqual(r.images[0].file, 'good.png');
    });

    test('throws on structurally invalid payloads', () => {
        assert.throws(() => parseRenderResult('{}'));
        assert.throws(() => parseRenderResult('not json'));
    });
});
