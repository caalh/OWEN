import * as assert from 'assert';
import {
    buildVerifyHelperScript,
    buildVerifyRequest,
    defaultPlaneSpecs,
    isClean,
    OVERLAP_COLOR,
    parseVerifyResult,
    VerifyResult,
} from '../../verify/core';

function baseResult(overrides: Partial<VerifyResult> = {}): string {
    return JSON.stringify({
        ok: true,
        version: '0.14.0',
        planes: [
            {
                id: 'xy_50', basis: 'xy', origin: [0, 0, 5], width: [10, 10],
                file: 'owen_verify_xy_50.png', overlapPixels: 0, totalPixels: 360000, uncounted: false,
            },
        ],
        lost: { ran: true, lostCount: 0, maxLost: 10, particles: 1000, message: null },
        warnings: [],
        error: null,
        ...overrides,
    });
}

suite('Verify geometry — plane specs and request', () => {
    test('default sampling covers three axial xy planes plus xz and yz', () => {
        const specs = defaultPlaneSpecs();
        assert.strictEqual(specs.length, 5);
        assert.deepStrictEqual(specs.filter((s) => s.basis === 'xy').map((s) => s.fraction), [0.25, 0.5, 0.75]);
        assert.ok(specs.some((s) => s.basis === 'xz'));
        assert.ok(specs.some((s) => s.basis === 'yz'));
    });

    test('request carries planes, probe config, and translated paths verbatim', () => {
        const req = buildVerifyRequest('/mnt/c/deck.py', '/mnt/c/out');
        assert.strictEqual(req.deckPath, '/mnt/c/deck.py');
        assert.strictEqual(req.outDir, '/mnt/c/out');
        assert.strictEqual(req.planes.length, 5);
        assert.strictEqual(req.particleProbe, true);
        assert.ok(req.probeParticles <= 5000, 'probe must stay a short low-particle run');
        assert.ok(req.maxLostParticles > 0);
    });
});

suite('Verify geometry — helper script generation', () => {
    const script = buildVerifyHelperScript();

    test('monkey-patches openmc.run and Model.run so decks cannot start transport', () => {
        assert.ok(script.includes('openmc.run = _skip_run'));
        assert.ok(script.includes('model_cls.run = _capture_run'));
        assert.ok(script.includes("runpy.run_path(deck, run_name='__main__')"));
    });

    test('renders slices with show_overlaps and the sentinel overlap color', () => {
        assert.ok(script.includes('plot.show_overlaps = True'));
        assert.ok(script.includes(`OVERLAP_RGB = (${OVERLAP_COLOR[0]}, ${OVERLAP_COLOR[1]}, ${OVERLAP_COLOR[2]})`));
        assert.ok(script.includes('plot.overlap_color'));
    });

    test('probe uses a short fixed-source run gated on cross sections', () => {
        assert.ok(script.includes('max_lost_particles'));
        assert.ok(script.includes('OPENMC_CROSS_SECTIONS'));
        assert.ok(script.includes("run_mode = 'fixed source'"));
    });

    test('writes owen_verify_result.json and is ASCII-only', () => {
        assert.ok(script.includes('owen_verify_result.json'));
        assert.ok(script.includes('OWEN_VERIFY_WRITTEN'));
        for (let i = 0; i < script.length; i++) {
            assert.ok(script.charCodeAt(i) <= 127, `non-ASCII char at index ${i}`);
        }
    });
});

suite('Verify geometry — result parsing', () => {
    test('accepts a well-formed clean result', () => {
        const r = parseVerifyResult(baseResult());
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.planes.length, 1);
        assert.strictEqual(r.planes[0].overlapPixels, 0);
        assert.strictEqual(isClean(r), true);
    });

    test('overlap pixels make the result not clean', () => {
        const r = parseVerifyResult(baseResult({
            planes: [{
                id: 'xy_50', basis: 'xy', origin: [0, 0, 5], width: [10, 10],
                file: 'owen_verify_xy_50.png', overlapPixels: 42, totalPixels: 360000, uncounted: false,
            }],
        }));
        assert.strictEqual(isClean(r), false);
        assert.strictEqual(r.planes[0].overlapPixels, 42);
    });

    test('lost particles make the result not clean', () => {
        const r = parseVerifyResult(baseResult({
            lost: { ran: true, lostCount: 3, maxLost: 10, particles: 1000, message: 'Lost particles detected.' },
        }));
        assert.strictEqual(isClean(r), false);
    });

    test('a skipped probe does not spoil an otherwise clean scan', () => {
        const r = parseVerifyResult(baseResult({
            lost: { ran: false, lostCount: 0, maxLost: 10, particles: 1000, message: 'Skipped: no cross sections.' },
        }));
        assert.strictEqual(isClean(r), true);
        assert.strictEqual(r.lost?.ran, false);
    });

    test('image paths that try to escape the out dir are dropped', () => {
        const r = parseVerifyResult(baseResult({
            planes: [{
                id: 'xy_50', basis: 'xy', origin: [0, 0, 5], width: [10, 10],
                file: '../../etc/passwd', overlapPixels: 0, totalPixels: 0, uncounted: false,
            }],
        }));
        assert.strictEqual(r.planes[0].file, '');
    });

    test('throws on structurally invalid payloads', () => {
        assert.throws(() => parseVerifyResult('{"ok": "yes"}'));
        assert.throws(() => parseVerifyResult('{"ok": true}'));
        assert.throws(() => parseVerifyResult('not json'));
    });
});
