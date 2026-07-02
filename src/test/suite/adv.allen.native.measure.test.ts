// Adversarial tests: ALLEN plotConfig, openmcNative core, measure, budget.
import * as assert from 'assert';
import {
    unifiedGrid, interpLogLog, buildPlotData, logTickLabel, supExp,
    resonanceIntegral, bondarenkoShieldingFactor, shieldedCurve, dopplerCoeffSeries,
} from '../../allen/plotConfig';
import {
    toWslPath, orderCandidates, parseProbeOutput, parseWslDiscovery,
    parseRenderResult, buildWslDiscoveryScript, buildRenderRequest,
} from '../../preview/openmcNative/core';
import { distance3, deltas, angleDeg, diameter, fmtLen } from '../../preview/measure';
import {
    planRender, estimatePrimitives, simplificationNote, truncationWarning, DEFAULT_MAX_INSTANCES,
} from '../../preview/budget';

suite('ADV ALLEN plotConfig', () => {
    test('empty curve list → empty grid, empty plot data', () => {
        assert.deepStrictEqual(unifiedGrid([]), []);
        const data = buildPlotData([]);
        assert.strictEqual(data.length, 1);
        assert.deepStrictEqual(data[0], []);
    });

    test('single-point curve interpolates only at its own point', () => {
        const E = [1.0];
        const xs = [5.0];
        const at = interpLogLog(E, xs, 1.0);
        // Exact sample points return the value only to within float round-trip
        // (log10/pow10); ~1e-15 relative error is acceptable.
        assert.ok(at !== null && Math.abs(at - 5.0) < 1e-9, `at=${at}`);
        assert.strictEqual(interpLogLog(E, xs, 0.5), null);
        assert.strictEqual(interpLogLog(E, xs, 2.0), null);
    });

    test('zero/negative σ values on a log-scale curve do not produce -Infinity', () => {
        const E = [1, 10, 100];
        const xs = [0, -5, 10];
        for (const e of [1, 3, 10, 31.6, 100]) {
            const y = interpLogLog(E, xs, e);
            assert.ok(y === null || (Number.isFinite(y) && y > 0), `E=${e}: y=${y}`);
        }
    });

    test('zero/negative energies are excluded from the unified grid', () => {
        const grid = unifiedGrid([{ E: [-1, 0, 1e-5, 2] }]);
        assert.deepStrictEqual(grid, [1e-5, 2]);
    });

    test('mismatched grids: each series only covers its own domain', () => {
        const c1 = { E: [1, 10], xs: [2, 2] };
        const c2 = { E: [5, 50], xs: [3, 3] };
        const data = buildPlotData([c1, c2]);
        const E = data[0] as number[];
        const s1 = data[1];
        const s2 = data[2];
        assert.deepStrictEqual(E, [1, 5, 10, 50]);
        assert.strictEqual(s1[3], null, 'series 1 should end at E=10');
        assert.strictEqual(s2[0], null, 'series 2 should start at E=5');
    });

    test('resonance integral over degenerate ranges', () => {
        const E = [1, 10, 100];
        const xs = [1, 1, 1];
        // Emin == Emax → 0.
        assert.strictEqual(resonanceIntegral(E, xs, 10, 10), 0);
        // Inverted range → 0 (not negative).
        const inv = resonanceIntegral(E, xs, 100, 1);
        assert.ok(inv <= 0.0001, `inverted range produced ${inv}`);
        // Range entirely outside data → 0.
        assert.strictEqual(resonanceIntegral(E, xs, 1e7, 1e9), 0);
        // Empty data → 0.
        assert.strictEqual(resonanceIntegral([], [], 0.5, 1e6), 0);
        // Single point → 0 (no interval).
        assert.strictEqual(resonanceIntegral([10], [5], 0.5, 1e6), 0);
    });

    test('resonance integral skips non-positive σ intervals', () => {
        const E = [1, 10, 100];
        const xs = [1, -1, 1];
        const ri = resonanceIntegral(E, xs, 0.5, 1e6);
        assert.ok(Number.isFinite(ri) && ri >= 0, `RI=${ri}`);
    });

    test('bondarenko factor edge cases', () => {
        assert.strictEqual(bondarenkoShieldingFactor(1, 0), 1);
        assert.strictEqual(bondarenkoShieldingFactor(0, 100), 1);
        assert.strictEqual(bondarenkoShieldingFactor(-5, 100), 1);
        const f = bondarenkoShieldingFactor(1e6, 1e-6);
        assert.ok(f > 0 && f <= 1, `factor out of range: ${f}`);
        // shieldedCurve never negative.
        for (const v of shieldedCurve([1, 2], [0, -3], 10)) {
            assert.ok(Number.isFinite(v), `non-finite shielded value ${v}`);
        }
    });

    test('dopplerCoeffSeries with one curve returns null; equal temps returns null', () => {
        assert.strictEqual(dopplerCoeffSeries([{ E: [1, 2], xs: [1, 1], temperature_K: 294 }]), null);
        assert.strictEqual(
            dopplerCoeffSeries([
                { E: [1, 2], xs: [1, 1], temperature_K: 294 },
                { E: [1, 2], xs: [2, 2], temperature_K: 294 },
            ]),
            null,
        );
    });

    test('dopplerCoeffSeries with empty curve array returns null (not crash)', () => {
        assert.strictEqual(dopplerCoeffSeries([]), null);
    });

    test('logTickLabel handles 0, negatives, and near-decades', () => {
        assert.strictEqual(logTickLabel(0), '');
        assert.strictEqual(logTickLabel(-10), '');
        assert.strictEqual(logTickLabel(1000), '10³'.normalize());
        assert.strictEqual(logTickLabel(999), '');
        assert.strictEqual(supExp(-12), '⁻¹²');
    });
});

suite('ADV openmcNative core', () => {
    test('toWslPath: spaces, unicode, UNC, forward slashes, relative', () => {
        assert.strictEqual(toWslPath('C:\\dir with spaces\\deck.py'), '/mnt/c/dir with spaces/deck.py');
        assert.strictEqual(toWslPath('D:/already/forward.py'), '/mnt/d/already/forward.py');
        assert.strictEqual(toWslPath('C:\\ünï códe\\декь.py'), '/mnt/c/ünï códe/декь.py');
        // Relative path: no drive → slash-normalised passthrough.
        assert.strictEqual(toWslPath('rel\\path.py'), 'rel/path.py');
        // UNC path: no drive letter — documented passthrough.
        const unc = toWslPath('\\\\server\\share\\deck.py');
        assert.ok(!unc.includes('\\'), `UNC left backslashes: ${unc}`);
    });

    test('orderCandidates dedupes case-insensitively on Windows', () => {
        const c = orderCandidates({
            explicitSetting: 'C:\\Python\\python.exe',
            msPythonPath: 'c:/python/python.exe',
            platform: 'win32',
        });
        const kinds = c.map((x) => x.kind);
        assert.deepStrictEqual(kinds, ['setting', 'path', 'path', 'wsl'], `dedup failed: ${kinds}`);
    });

    test('orderCandidates on linux has no wsl candidate', () => {
        const c = orderCandidates({ platform: 'linux' });
        assert.ok(!c.some((x) => x.kind === 'wsl'));
    });

    test('empty/whitespace settings are ignored', () => {
        const c = orderCandidates({ explicitSetting: '   ', msPythonPath: '', platform: 'win32' });
        assert.ok(!c.some((x) => x.kind === 'setting' || x.kind === 'ms-python'));
    });

    test('probe / discovery parsers reject garbage', () => {
        assert.strictEqual(parseProbeOutput('no marker here'), null);
        assert.strictEqual(parseProbeOutput(''), null);
        assert.strictEqual(parseProbeOutput('OWEN_OPENMC 0.14.0'), '0.14.0');
        assert.strictEqual(parseWslDiscovery('garbage'), null);
        const d = parseWslDiscovery('OWEN_OPENMC_PY /home/u/miniconda3 with space/bin/python 0.15.0');
        assert.ok(d && d.pythonPath.includes('with space'), 'path with space mis-split');
    });

    test('discovery script is a single line of POSIX sh (no unescaped newlines)', () => {
        const s = buildWslDiscoveryScript();
        assert.ok(!s.includes('\n'));
        assert.ok(s.includes('exit 1'));
    });

    test('parseRenderResult: garbage JSON throws; shape-checked fields survive', () => {
        assert.throws(() => parseRenderResult('not json'));
        assert.throws(() => parseRenderResult('{}'));
        assert.throws(() => parseRenderResult('{"ok": "yes", "images": []}'));
        const ok = parseRenderResult(JSON.stringify({
            ok: true,
            images: [
                { id: 'a', kind: 'slice', basis: 'xy', file: 'plot.png', origin: [0, 0, 0], width: [10, 10] },
                { id: 'b', kind: 'slice', basis: 'xy', file: '../../../etc/passwd', origin: [0, 0, 0], width: [10, 10] },
                { id: 'c', kind: 'slice', basis: 'xy', file: 'C:\\evil\\x.png', origin: [0, 0, 0], width: [10, 10] },
                null,
                { id: 'd' },
            ],
            warnings: [1, 2, 'three'],
            error: null,
        }));
        // Path traversal / absolute path images must be filtered out.
        assert.strictEqual(ok.images.length, 1, `traversal images not filtered: ${JSON.stringify(ok.images)}`);
        assert.deepStrictEqual(ok.warnings, ['1', '2', 'three']);
    });

    test('buildRenderRequest passes hostile paths through untouched (quoting is caller responsibility)', () => {
        const req = buildRenderRequest('/mnt/c/dir with spaces/деck.py', '/tmp/out dir', []);
        assert.ok(req.deckPath.includes('with spaces'));
    });
});

suite('ADV measure', () => {
    test('coincident points: distance 0, deltas 0, angle 0', () => {
        const p = { x: 1, y: 2, z: 3 };
        assert.strictEqual(distance3(p, p), 0);
        assert.deepStrictEqual(deltas(p, p), { dx: 0, dy: 0, dz: 0 });
        assert.strictEqual(angleDeg(p, p, p), 0);
    });

    test('angle with zero-length ray returns 0, not NaN', () => {
        const v = { x: 0, y: 0, z: 0 };
        const a = { x: 1, y: 0, z: 0 };
        assert.strictEqual(angleDeg(v, v, a), 0);
    });

    test('angle numerical stability: nearly-parallel unit rays do not exceed [0,180]', () => {
        const v = { x: 0, y: 0, z: 0 };
        const a = { x: 1, y: 1e-14, z: 0 };
        const b = { x: 1, y: -1e-14, z: 0 };
        const ang = angleDeg(a, v, b);
        assert.ok(ang >= 0 && ang <= 180 && Number.isFinite(ang), `angle=${ang}`);
    });

    test('huge coordinates stay finite', () => {
        const d = distance3({ x: 1e150, y: 0, z: 0 }, { x: -1e150, y: 0, z: 0 });
        assert.ok(Number.isFinite(d), `distance overflowed: ${d}`);
    });

    test('zero radius diameter; fmtLen of NaN/Infinity renders em-dash', () => {
        assert.strictEqual(diameter(0), 0);
        assert.strictEqual(fmtLen(NaN), '—');
        assert.strictEqual(fmtLen(Infinity), '—');
        assert.strictEqual(fmtLen(1.5), '1.5');
        assert.strictEqual(fmtLen(2), '2');
        assert.strictEqual(fmtLen(0.1000), '0.1');
    });
});

suite('ADV budget / LOD', () => {
    test('estimate exactly at cap does not degrade', () => {
        const plan = planRender({
            totalPins: 100, avgLayers: 3, axialSegments: 5, detail: 'layers', axial: true,
            maxInstances: 1500,
        });
        assert.strictEqual(plan.estimate, 1500);
        assert.strictEqual(plan.detail, 'layers');
        assert.strictEqual(plan.axial, true);
        assert.strictEqual(plan.simplified, false);
    });

    test('estimate one over cap degrades layers first', () => {
        const plan = planRender({
            totalPins: 100, avgLayers: 3, axialSegments: 5, detail: 'layers', axial: true,
            maxInstances: 1499,
        });
        assert.strictEqual(plan.detail, 'disc');
        assert.strictEqual(plan.axial, true, 'axial should be preserved when disc fits');
        assert.strictEqual(plan.estimate, 500);
    });

    test('degrades axial only when disc alone is insufficient', () => {
        const plan = planRender({
            totalPins: 100, avgLayers: 3, axialSegments: 5, detail: 'layers', axial: true,
            maxInstances: 200,
        });
        assert.strictEqual(plan.detail, 'disc');
        assert.strictEqual(plan.axial, false);
        assert.strictEqual(plan.estimate, 100);
    });

    test('impossible budget (fewer than pins) still returns a plan (capped later)', () => {
        const plan = planRender({
            totalPins: 100, avgLayers: 3, axialSegments: 5, detail: 'layers', axial: true,
            maxInstances: 10,
        });
        assert.strictEqual(plan.estimate, 100, 'floor is one instance per pin');
        assert.ok(plan.simplified);
    });

    test('zero pins / zero layers degenerate inputs', () => {
        const est = estimatePrimitives({ totalPins: 0, avgLayers: 0, axialSegments: 0, detail: 'layers', axial: true });
        assert.strictEqual(est, 0);
        const plan = planRender({ totalPins: 0, avgLayers: 0, axialSegments: 0, detail: 'layers', axial: false });
        assert.strictEqual(plan.simplified, false);
    });

    test('negative maxInstances falls back to default', () => {
        const plan = planRender({ totalPins: 1, avgLayers: 1, axialSegments: 1, detail: 'disc', axial: false, maxInstances: -5 });
        assert.strictEqual(plan.maxInstances, DEFAULT_MAX_INSTANCES);
    });

    test('notes / warnings mention the ceiling', () => {
        const note = simplificationNote(true, true, 12345);
        assert.ok(note && note.includes('12,345'));
        assert.strictEqual(simplificationNote(false, false, 1), null);
        assert.ok(truncationWarning(99).includes('99'));
    });
});
