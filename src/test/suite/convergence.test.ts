import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { assessConvergence, attachConvergence } from '../../results/convergence';
import { parseCheckDetails, parseKeffEstimators, parseLostParticles, parseMcnpOutp } from '../../results/parsers/mcnpOutp';
import { parseSerpentResults } from '../../results/parsers/serpent';
import { parseOpenmcStdout } from '../../results/parsers/openmc';
import type { KeffHistory } from '../../results/types';

const FIXTURES = path.resolve(__dirname, '..', '..', '..', '..', 'src', 'test', 'fixtures');

/** Deterministic pseudo-random noise so the tests do not flap. */
function noise(seed: number): () => number {
    let s = seed >>> 0;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 - 0.5; };
}

function history(opts: { n: number; inactive: number; drift?: number; step?: number; sigma?: number; entropy?: 'flat' | 'late' }): KeffHistory {
    const rnd = noise(42);
    const mean: number[] = [];
    const entropy: number[] = [];
    for (let i = 0; i < opts.n; i++) {
        let k = 1.0 + (opts.sigma ?? 0.003) * rnd() * 2;
        if (opts.drift) k += opts.drift * i;
        if (opts.step && i >= opts.inactive + (opts.n - opts.inactive) / 2) k += opts.step;
        mean.push(k);
        if (opts.entropy === 'flat') entropy.push(7.5 + 0.02 * rnd());
        else if (opts.entropy === 'late') entropy.push((i < opts.inactive + 10 ? 6.0 + 0.1 * (i / (opts.inactive + 10)) * 15 : 7.5) + 0.02 * rnd());
    }
    const h: KeffHistory = { cycles: mean.map((_, i) => i + 1), mean, std: mean.map(() => 0), inactive: opts.inactive };
    if (opts.entropy) h.entropy = entropy;
    return h;
}

suite('OWEN results — convergence reading', () => {
    test('a flat history with flat entropy is converged', () => {
        const r = assessConvergence(history({ n: 200, inactive: 50, entropy: 'flat' }));
        assert.strictEqual(r.verdict, 'converged', r.reasons.join(' | '));
        assert.ok(r.halvesZ! < 2 && r.driftZ! < 2);
        assert.ok(r.entropyZ !== null && r.entropyZ! < 2);
    });

    test('a step between the halves is called out', () => {
        const r = assessConvergence(history({ n: 200, inactive: 50, step: 0.004 }));
        assert.strictEqual(r.verdict, 'unconverged', r.reasons.join(' | '));
        assert.ok(r.reasons.some((x) => /halves/i.test(x)));
    });

    test('a drift across the active cycles is called out', () => {
        const r = assessConvergence(history({ n: 200, inactive: 50, drift: 0.00005 }));
        assert.strictEqual(r.verdict, 'unconverged', r.reasons.join(' | '));
        assert.ok(r.reasons.some((x) => /drift/i.test(x)));
    });

    test('entropy still rising into the active cycles means too few inactive cycles', () => {
        const r = assessConvergence(history({ n: 200, inactive: 20, entropy: 'late' }));
        assert.ok(r.entropyZ! > 3, `entropy z ${r.entropyZ}`);
        assert.ok(r.reasons.some((x) => /inactive/i.test(x)));
    });

    test('a history with no entropy says so instead of pretending', () => {
        const r = assessConvergence(history({ n: 100, inactive: 20 }));
        assert.strictEqual(r.entropyZ, null);
        assert.ok(r.reasons.some((x) => /entropy/i.test(x) && /unchecked/i.test(x)));
    });

    test('too short a history gives no verdict', () => {
        assert.strictEqual(assessConvergence({ cycles: [1], mean: [1.0], std: [0] }).verdict, 'unknown');
        assert.strictEqual(assessConvergence(undefined).verdict, 'unknown');
    });

    test('lost particles turn a clean history into a check', () => {
        const r = assessConvergence(history({ n: 200, inactive: 50, entropy: 'flat' }), { lostParticles: 3 });
        assert.strictEqual(r.verdict, 'suspect');
        assert.ok(r.reasons.some((x) => /Check Geometry/.test(x)));
    });
});

suite('OWEN results — MCNP outp convergence fields', () => {
    const text = fs.readFileSync(path.join(FIXTURES, 'mcnp_outp.txt'), 'utf8');
    const lines = text.split(/\n/);

    test('the estimator table and combined line are read', () => {
        const est = parseKeffEstimators(lines, text);
        const names = est.map((e) => e.name);
        assert.deepStrictEqual(names, ['collision', 'absorption', 'track-length', 'combined']);
        assert.strictEqual(est[0].mean, 1.31245);
        assert.strictEqual(est[3].mean, 1.31231);
        assert.strictEqual(est[3].std, 0.00054);
    });

    test('ten-check detail rows are kept per tally', () => {
        const d = parseCheckDetails(lines);
        const t4 = d.get('4')!;
        assert.ok(t4, 'tally 4 has a detail table');
        assert.strictEqual(t4.length, 10);
        assert.strictEqual(t4[0].name, 'mean behavior');
        assert.strictEqual(t4[1].desired, '<0.10');
        assert.strictEqual(t4[1].observed, '0.00');
        assert.ok(t4.every((c) => c.passed));
        assert.strictEqual(t4[9].observed, '10.00');
    });

    test('lost particles default to 0 when the problem summary exists but says nothing', () => {
        assert.strictEqual(parseLostParticles(text), 0);
        assert.strictEqual(parseLostParticles('blah\n      3 particles got lost.\n'), 3);
        assert.strictEqual(parseLostParticles('no summary here'), undefined);
    });

    test('parseMcnpOutp attaches estimators and detail; attachConvergence gives a verdict', () => {
        const r = attachConvergence(parseMcnpOutp(text, 'outp'));
        assert.ok(r.convergence);
        assert.strictEqual(r.convergence!.estimators!.length, 4);
        assert.strictEqual(r.tallies.find((t) => t.id === '4')!.checkDetail!.length, 10);
        // The fixture has no cycle table, so the verdict is honest about it.
        assert.strictEqual(r.convergence!.verdict, 'unknown');
        assert.ok(/per-cycle k table|No per-cycle/.test(r.convergence!.reasons[0]), r.convergence!.reasons[0]);
    });

    test('a cycle table with an entropy column is picked up', () => {
        const synthetic = [
            '1mcnp     version 6.3',
            ' cycle   k(collision)   k(absorption)   k(track)   entropy',
            ...Array.from({ length: 30 }, (_, i) => `   ${i + 1}   ${(1.0 + 0.001 * Math.sin(i)).toFixed(5)}   1.00000   1.00000   ${(7.0 + 0.01 * i).toFixed(4)}`),
            ' the final estimated combined collision/absorption/track-length keff = 1.00012 with an estimated standard deviation of 0.00050',
            '1problem summary',
        ].join('\n');
        const r = parseMcnpOutp(synthetic, 'outp');
        assert.ok(r.keff && r.keff.entropy, 'entropy series expected');
        assert.strictEqual(r.keff!.entropy!.length, 30);
        assert.strictEqual(r.keff!.mean.length, 30);
    });
});

suite('OWEN results — other codes seed the convergence block', () => {
    test('Serpent lists each k-eff estimator', () => {
        const text = fs.readFileSync(path.join(FIXTURES, 'sample_res.m'), 'utf8');
        const r = parseSerpentResults(text, 'x_res.m');
        assert.ok(r.convergence?.estimators?.some((e) => e.name === 'imp'), JSON.stringify(r.convergence));
    });

    test('OpenMC stdout lists the estimators and the combined value', () => {
        const text = fs.readFileSync(path.join(FIXTURES, 'openmc_run.log'), 'utf8');
        const r = parseOpenmcStdout(text, 'run.log');
        const names = (r.convergence?.estimators ?? []).map((e) => e.name);
        assert.ok(names.includes('combined'), names.join(','));
    });
});
