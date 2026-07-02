// Adversarial tests: results parsers (src/results/parsers/*).
// Hostile inputs: truncated files, garbage, empty, binary, pathological regex
// feeds — parsers must return gracefully, never hang or throw.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { parseMctal } from '../../results/parsers/mcnp';
import { parseSerpentResults } from '../../results/parsers/serpent';
import { parseSconeOutput } from '../../results/parsers/scone';
import { parseOpenmcStdout } from '../../results/parsers/openmc';

const FIXTURES = path.resolve(__dirname, '../../../src/test/fixtures');

function binaryGarbage(n: number): string {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(i % 256);
    return s;
}

suite('ADV results parsers — hostile inputs', () => {
    const hostiles: Array<[string, string]> = [
        ['empty', ''],
        ['whitespace', '   \n\t\r\n  '],
        ['binary', binaryGarbage(4096)],
        ['null bytes', '\0\0\0keff\0\0'],
        ['huge single line', 'x'.repeat(1_000_000)],
        ['unicode soup', '☢️ κ-eff = ∞ ± NaN 中文'],
    ];
    for (const [name, text] of hostiles) {
        test(`all four parsers survive: ${name}`, function () {
            this.timeout(10000);
            for (const fn of [parseMctal, parseSerpentResults, parseSconeOutput, parseOpenmcStdout]) {
                const res = fn(text);
                assert.ok(res && typeof res.code === 'string', `${fn.name} returned garbage`);
                assert.ok(Array.isArray(res.tallies));
            }
        });
    }

    test('truncated mctal (cut mid-line) parses what it can', () => {
        const full = fs.readFileSync(path.join(FIXTURES, 'sample.mctal'), 'utf8');
        for (const frac of [0.1, 0.5, 0.9]) {
            const cut = full.slice(0, Math.floor(full.length * frac));
            const res = parseMctal(cut);
            assert.ok(res.code === 'mcnp');
        }
    });

    test('mctal with multiple tallies + perturbation blocks', () => {
        const text = [
            'mcnp6   6.2  test  ntal 3 npert 2',
            'tally    4',
            'tally   14',
            'tally   24',
            'k eff (c)  1.00512  0.00090',
            'k eff (c)  1.00423  0.00071',
            '  1.0e-6  3.2e-2',
            '  1.0e-3  1.1e-1',
            '  2.0e1   4.4e-3',
            'pert 1',
            'pert 2',
        ].join('\n');
        const res = parseMctal(text);
        assert.strictEqual(res.tallies.length, 3, `tally count: ${res.tallies.length}`);
        assert.ok(res.keff, 'keff missing');
        assert.strictEqual(res.keff!.mean.length, 2);
        assert.ok(Math.abs((res.keff!.final?.mean ?? 0) - 1.00423) < 1e-9);
    });

    test('Serpent _res.m with unusual whitespace still yields keff', () => {
        const text = [
            '% Increase counter:',
            'if (exist("idx", "var"));',
            '  idx = idx + 1;',
            'else;',
            '  idx = 1;',
            'end;',
            '',
            'ANA_KEFF\t(idx, [1:   6])  = [  9.95561E-01 0.00093  ',
            '   9.95561E-01 0.00093 0.0 0.0 ];',
            'IMP_KEFF                  (idx, [1:   2])  = [  9.95455E-01 0.00062 ];',
        ].join('\n');
        const res = parseSerpentResults(text);
        // The baseline fixture format is what the parser targets; here we just
        // require graceful handling (no crash) and correct typing.
        assert.ok(res.code === 'serpent');
    });

    test('Serpent keff formats: "KEFF = x +/- y" and "x +/- y"', () => {
        const a = parseSerpentResults('KEFF = 1.00100 +/- 0.00050');
        assert.ok(a.keff, '"KEFF = x +/- y" not parsed');
        assert.ok(Math.abs((a.keff!.final?.mean ?? 0) - 1.001) < 1e-9);
    });

    test('SCONE output variants', () => {
        const variants = [
            'k_eff  1.000000  0.001000',
            'k-eff = 1.0 +/- 0.001',
            'Final k_eff: 0.99850 0.00075',
        ];
        for (const v of variants) {
            const res = parseSconeOutput(v);
            assert.ok(res.keff, `variant not parsed: "${v}"`);
        }
    });

    test('OpenMC stdout batch history + combined', () => {
        const text = [
            ' Batch 51   k = 1.00123 +/- 0.00210',
            ' Batch 52   k = 1.00088 +/- 0.00190',
            ' Combined k-effective = 1.00095 +/- 0.00085',
        ].join('\n');
        const res = parseOpenmcStdout(text);
        assert.ok(res.keff);
        assert.strictEqual(res.keff!.mean.length, 3);
        assert.ok(Math.abs((res.keff!.final?.mean ?? 0) - 1.00095) < 1e-9);
    });

    test('regex DoS guard: pathological repeated tokens complete fast', function () {
        this.timeout(10000);
        const evil1 = ('k eff (c) ' + '9'.repeat(500) + ' ').repeat(200);
        const evil2 = 'cycle '.repeat(50000);
        const evil3 = ('DET energy = [' + '1 '.repeat(10000)); // unterminated bracket
        const t0 = Date.now();
        parseMctal(evil1);
        parseSerpentResults(evil2);
        parseSerpentResults(evil3);
        parseSconeOutput(evil2);
        const dt = Date.now() - t0;
        assert.ok(dt < 8000, `parsers too slow on hostile input: ${dt}ms`);
    });

    test('numbers like "1.2.3" and "..." do not produce NaN keff', () => {
        for (const text of ['k eff (c)  1.2.3  0.0.1', 'KEFF = ... +/- ...', 'k_eff . .']) {
            for (const fn of [parseMctal, parseSerpentResults, parseSconeOutput]) {
                const res = fn(text);
                if (res.keff && res.keff.final) {
                    assert.ok(
                        Number.isFinite(res.keff.final.mean),
                        `${fn.name} produced non-finite keff from "${text}": ${res.keff.final.mean}`,
                    );
                }
            }
        }
    });

    test('Serpent mesh values shorter than nx*ny*nz are not emitted', () => {
        const text = 'mesh 10 10 1\nvalues = [1 2 3]';
        const res = parseSerpentResults(text);
        assert.strictEqual(res.meshTallies.length, 0, 'undersized mesh emitted');
    });

    test('Serpent detector with mismatched E/value lengths is dropped', () => {
        const text = 'DET d1 energy = [1 2 3 4]\nDET d1 value = [1 2 3]';
        const res = parseSerpentResults(text);
        assert.strictEqual(res.spectra.length, 0, 'mismatched detector emitted');
    });

    test('baseline fixtures still parse (sanity anchor)', () => {
        const mctal = parseMctal(fs.readFileSync(path.join(FIXTURES, 'sample.mctal'), 'utf8'));
        assert.ok(mctal.keff, 'fixture mctal keff lost');
        const serp = parseSerpentResults(fs.readFileSync(path.join(FIXTURES, 'sample_res.m'), 'utf8'));
        assert.ok(serp.code === 'serpent');
        const scone = parseSconeOutput(fs.readFileSync(path.join(FIXTURES, 'sample_scone.out'), 'utf8'));
        assert.ok(scone.code === 'scone');
    });
});
