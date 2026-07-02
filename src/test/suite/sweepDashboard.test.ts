import * as assert from 'assert';
import { buildDashboard, chooseSweepAxis } from '../../workflows/sweepDashboardCore';
import type { SweepManifest, SweepParameter, RunRecord } from '../../workflows/sweepCore';
import type { RunResults } from '../../results/types';

function record(index: number, params: Record<string, string | number>, keff: number | null, exit: number | null = 0): RunRecord {
    return {
        index,
        parameters: params,
        inputFile: `/sweep/run_${index}/deck.py`,
        outputDir: `/sweep/run_${index}`,
        keff,
        exitCode: exit,
        stdoutPath: `/sweep/run_${index}/owen-sweep.log`,
    };
}

function results(mean: number[], std: number[]): RunResults {
    return {
        code: 'openmc',
        keff: {
            cycles: mean.map((_, i) => i + 1),
            mean,
            std,
            final: { mean: mean[mean.length - 1], std: std[std.length - 1] },
        },
        spectra: [],
        tallies: [],
        meshTallies: [],
    };
}

suite('OWEN sweep dashboard — axis selection', () => {
    test('picks the first parameter with more than one distinct value', () => {
        const params: SweepParameter[] = [
            { name: 'const', values: [1, 1, 1], pattern: 'x' },
            { name: 'enrichment', values: [0.02, 0.05], pattern: 'y' },
        ];
        assert.strictEqual(chooseSweepAxis(params), 'enrichment');
    });

    test('falls back to the first parameter when all are constant', () => {
        assert.strictEqual(
            chooseSweepAxis([{ name: 'a', values: [1], pattern: 'x' }]),
            'a',
        );
    });

    test('returns null for an empty schema', () => {
        assert.strictEqual(chooseSweepAxis([]), null);
    });
});

suite('OWEN sweep dashboard — aggregation', () => {
    const params: SweepParameter[] = [
        { name: 'enrichment', values: [0.02, 0.03, 0.05], pattern: 'e' },
    ];
    const manifest: SweepManifest = {
        baseFile: '/base/pincell.py',
        language: 'openmc',
        parameters: params,
        runs: [
            record(0, { enrichment: 0.05 }, 1.188),
            record(1, { enrichment: 0.02 }, 0.921),
            record(2, { enrichment: 0.03 }, null, 1),
        ],
    };

    test('points are sorted by the axis value', () => {
        const data = buildDashboard(manifest, new Map());
        assert.strictEqual(data.paramName, 'enrichment');
        assert.deepStrictEqual(data.x, [0.02, 0.03, 0.05]);
        assert.deepStrictEqual(data.keff, [0.921, null, 1.188]);
    });

    test('parsed results override the manifest grep k-eff and add std + convergence', () => {
        const perRun = new Map<number, RunResults | null>([
            [0, results([1.10, 1.15, 1.189], [0.01, 0.005, 0.0008])],
        ]);
        const data = buildDashboard(manifest, perRun);
        const run0 = data.runs.find((r) => r.index === 0)!;
        assert.strictEqual(run0.keff, 1.189);
        assert.strictEqual(run0.keffStd, 0.0008);
        assert.ok(run0.convergence, 'expected convergence history');
        assert.strictEqual(run0.convergence!.mean.length, 3);
        // the sweep-level series uses the refined value
        assert.strictEqual(data.keff[2], 1.189);
    });

    test('run with no results and no grep k-eff stays null (rendered n/a)', () => {
        const data = buildDashboard(manifest, new Map());
        const run2 = data.runs.find((r) => r.index === 2)!;
        assert.strictEqual(run2.keff, null);
        assert.strictEqual(run2.convergence, null);
    });

    test('single-cycle results do not produce a convergence history', () => {
        const perRun = new Map<number, RunResults | null>([
            [1, results([0.921], [0.001])],
        ]);
        const data = buildDashboard(manifest, perRun);
        const run1 = data.runs.find((r) => r.index === 1)!;
        assert.strictEqual(run1.keff, 0.921);
        assert.strictEqual(run1.convergence, null);
    });

    test('non-numeric axis values are dropped from the chart but kept in the table', () => {
        const m2: SweepManifest = {
            ...manifest,
            parameters: [{ name: 'tag', values: ['a', 'b'], pattern: 't' }],
            runs: [record(0, { tag: 'a' }, 1.0), record(1, { tag: 'b' }, 1.1)],
        };
        const data = buildDashboard(m2, new Map());
        assert.strictEqual(data.x.length, 0);
        assert.strictEqual(data.runs.length, 2);
    });
});
