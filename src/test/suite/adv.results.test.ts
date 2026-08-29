// Adversarial tests: results parsers (src/results/parsers/*).
// Hostile inputs: truncated files, garbage, empty, binary, pathological regex
// feeds — parsers must return gracefully, never hang or throw.
//
// These suites also guard against the failure mode the parsers were rebuilt to
// fix: inventing numbers. A parser that finds "results" in a file with no
// results is worse than one that finds nothing.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { parseMcnpText } from '../../results/parsers/mcnp';
import { parseSerpentResults } from '../../results/parsers/serpent';
import { parseSconeOutput } from '../../results/parsers/scone';
import { parseOpenmcStdout, parseOpenmcTalliesOut } from '../../results/parsers/openmc';

import { FIXTURES } from '../paths';

const PARSERS = [parseMcnpText, parseSerpentResults, parseSconeOutput, parseOpenmcStdout, parseOpenmcTalliesOut];

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
        test(`every parser survives: ${name}`, function () {
            this.timeout(10000);
            for (const fn of PARSERS) {
                const res = fn(text);
                assert.ok(res && typeof res.code === 'string', `${fn.name} returned garbage`);
                assert.ok(Array.isArray(res.tallies));
                assert.ok(
                    res.tallies.every((t) => Number.isFinite(t.value)),
                    `${fn.name} produced a non-finite tally value`,
                );
                if (res.keff?.final) {
                    assert.ok(Number.isFinite(res.keff.final.mean), `${fn.name} produced a non-finite k-eff`);
                }
            }
        });
    }

    test('parsers invent nothing from prose', () => {
        const prose = [
            'This document describes k-effective and how tallies work.',
            'A tally of 4 was requested; the flux was 1.5 and the error 0.02.',
            'Energy bins: 1.0 2.0 3.0 4.0 5.0',
        ].join('\n');
        for (const fn of PARSERS) {
            const res = fn(prose);
            assert.strictEqual(res.spectra.length, 0, `${fn.name} fabricated a spectrum from prose`);
            assert.strictEqual(res.tallies.length, 0, `${fn.name} fabricated tallies from prose`);
        }
    });

    test('a two-column table is not a flux spectrum', () => {
        // The old MCNP reader turned any pair of numbers on a line into spectrum
        // points, so a cross-section listing became a "tally spectrum".
        const table = [
            '1mcnp     version 6     ld=02/20/18                     01/01/26 00:00:00',
            '1cross-section tables                                   print table 100',
            '      92235.80c    5688',
            '      1.0000E-03   4.32106E-03',
            '      1.0000E-02   1.89234E-02',
            '      1.0000E-01   5.67891E-02',
        ].join('\n');
        const res = parseMcnpText(table);
        assert.strictEqual(res.spectra.length, 0, 'fabricated a spectrum outside a tally block');
        assert.strictEqual(res.tallies.length, 0, 'fabricated a tally outside a tally block');
    });

    test('truncated outp (cut mid-line) parses what it can', () => {
        const full = fs.readFileSync(path.join(FIXTURES, 'mcnp_outp.txt'), 'utf8');
        for (const frac of [0.1, 0.5, 0.9]) {
            const cut = full.slice(0, Math.floor(full.length * frac));
            const res = parseMcnpText(cut);
            assert.strictEqual(res.code, 'mcnp');
            assert.ok(res.tallies.every((t) => Number.isFinite(t.value)));
        }
    });

    test('truncated mctal keeps bin counts honest', () => {
        const full = fs.readFileSync(path.join(FIXTURES, 'sample.mctal'), 'utf8');
        const cut = full.slice(0, full.indexOf('vals') + 30);
        const res = parseMcnpText(cut);
        assert.strictEqual(res.code, 'mcnp');
        // Fewer values than the bin structure implies must be reported, not hidden.
        assert.ok(
            (res.notes ?? []).some((n) => /value\/error pairs/i.test(n)),
            `expected a mismatch note, got ${JSON.stringify(res.notes)}`,
        );
    });

    test('MCNP zero tallies are reported as zero, not dropped', () => {
        const res = parseMcnpText(fs.readFileSync(path.join(FIXTURES, 'mcnp_outp.txt'), 'utf8'));
        const zero = res.tallies.find((t) => t.checks === 'zero');
        assert.ok(zero, 'zero tally missing');
        assert.strictEqual(zero!.value, 0);
    });

    test('Serpent detector with mismatched E/value lengths drops only the spectrum', () => {
        const text = ['DETd1 = [', ' 1 1 1 1 1 1 1 1 1 1 1.0E-3 0.01', ' 2 1 1 1 1 1 1 1 1 1 2.0E-3 0.02', '];', 'DETd1E = [', ' 1 2 1.5', '];'].join('\n');
        const res = parseSerpentResults(text);
        assert.strictEqual(res.spectra.length, 0, 'mismatched detector emitted a spectrum');
        assert.strictEqual(res.tallies.length, 1, 'detector bins lost');
        assert.ok((res.notes ?? []).some((n) => /spectrum skipped/i.test(n)));
    });

    test('Serpent keff variants', () => {
        const indexed = parseSerpentResults('IMP_KEFF                  (idx, [1:   2]) = [  9.95455E-01 0.00062 ];');
        assert.ok(Math.abs((indexed.keff?.final?.mean ?? 0) - 0.995455) < 1e-9, 'indexed form not parsed');
        const bare = parseSerpentResults('IMP_KEFF = [ 1.34721 0.00095 ];');
        assert.ok(Math.abs((bare.keff?.final?.mean ?? 0) - 1.34721) < 1e-9, 'bare form not parsed');
    });

    test('SCONE k-eff entry names', () => {
        for (const line of ['keff_k_analog = [ 1.00123,0.00045];', 'keff_K_EFF = [ 0.99850,0.00075];']) {
            const res = parseSconeOutput(line);
            assert.ok(res.keff, `entry not parsed: ${line}`);
        }
    });

    test('OpenMC stdout batch table and combined estimate', () => {
        const text = [
            '  Bat./Gen.      k            Average k',
            '  =========   ========   ====================',
            '        1/1    1.05000',
            '        2/1    1.04000',
            '        3/1    1.03000    1.03500 +/- 0.00500',
            ' Combined k-effective        = 1.03210 +/- 0.00420',
        ].join('\n');
        const res = parseOpenmcStdout(text);
        assert.strictEqual(res.keff?.mean.length, 3);
        assert.strictEqual(res.keff?.inactive, 1);
        assert.ok(Math.abs((res.keff?.final?.mean ?? 0) - 1.0321) < 1e-9);
    });

    test('regex DoS guard: pathological repeated tokens complete fast', function () {
        this.timeout(15000);
        const evil1 = ('1tally 4 nps = 1\n cell 1\n' + '9'.repeat(400) + ' 0.5\n').repeat(200);
        const evil2 = 'cycle '.repeat(50000);
        const evil3 = 'DETd = [' + '1 '.repeat(20000); // unterminated bracket
        const evil4 = 'k-eff (analog):  1.0 +/- 0.1\n'.repeat(20000);
        const t0 = Date.now();
        parseMcnpText(evil1);
        parseSerpentResults(evil2);
        parseSerpentResults(evil3);
        parseSconeOutput(evil4);
        const dt = Date.now() - t0;
        assert.ok(dt < 12000, `parsers too slow on hostile input: ${dt}ms`);
    });

    test('numbers like "1.2.3" and "..." do not produce NaN results', () => {
        const texts = [
            '1tally 4 nps = 1\n cell 1\n 1.2.3 0.0.1',
            'IMP_KEFF = [ ... ... ];',
            'keff_k_analog = [ .,.];',
        ];
        for (const text of texts) {
            for (const fn of PARSERS) {
                const res = fn(text);
                if (res.keff?.final) {
                    assert.ok(
                        Number.isFinite(res.keff.final.mean),
                        `${fn.name} produced non-finite keff from "${text}"`,
                    );
                }
                assert.ok(res.tallies.every((t) => Number.isFinite(t.value)), `${fn.name} produced NaN tally`);
            }
        }
    });

    test('baseline fixtures still parse (sanity anchor)', () => {
        const outp = parseMcnpText(fs.readFileSync(path.join(FIXTURES, 'mcnp_outp.txt'), 'utf8'));
        assert.ok(outp.keff, 'fixture outp keff lost');
        const serp = parseSerpentResults(fs.readFileSync(path.join(FIXTURES, 'sample_res.m'), 'utf8'));
        assert.strictEqual(serp.code, 'serpent');
        const scone = parseSconeOutput(fs.readFileSync(path.join(FIXTURES, 'sample_scone.m'), 'utf8'));
        assert.strictEqual(scone.code, 'scone');
    });
});
