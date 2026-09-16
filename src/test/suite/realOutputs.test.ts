// Real Serpent 2 output files from the serpent-tools project (MIT license,
// CORE-GATECH-GROUP/serpent-tools, src/serpentTools/data). Unlike the
// synthetic fixtures these were written by Serpent itself, so they pin the
// quirks synthetic files miss: a _his file that opens with a TIME matrix and
// restarts its cycle counter, a burnup _res.m with one block per step, and
// an xy mesh detector carrying two reaction bins over one 5×5 grid.

import * as assert from 'assert';
import * as path from 'path';
import { parseOutputFile } from '../../results/index';
import { identifyOutput } from '../../results/detectOutputs';
import { FIXTURES } from '../paths';

const DIR = path.join(FIXTURES, 'serpent-tools');

suite('Real serpent-tools outputs', () => {
    test('bwr_his0.m identifies as Serpent (it used to fall through to MCNP)', () => {
        const id = identifyOutput(path.join(DIR, 'bwr_his0.m'));
        assert.ok(id, 'his file must be recognized');
        assert.strictEqual(id!.code, 'serpent');
    });

    test('bwr_his0.m yields a real cycle-by-cycle k-eff history', async () => {
        const r = await parseOutputFile(path.join(DIR, 'bwr_his0.m'));
        assert.strictEqual(r.code, 'serpent');
        assert.ok(r.keff && r.keff.mean.length > 100, `expected >100 cycles, got ${r.keff?.mean.length}`);
        // Final = cumulative mean ± cumulative σ from the last row.
        assert.ok(Math.abs(r.keff!.final!.mean - 1.0526) < 0.001, `final ${r.keff!.final!.mean}`);
        assert.ok(r.keff!.final!.std > 0, 'final σ comes from the cumulative rel-std column');
    });

    test('ref_det0.m reconstructs the 5×5 xy mesh (two reaction bins)', async () => {
        const r = await parseOutputFile(path.join(DIR, 'ref_det0.m'));
        assert.strictEqual(r.meshTallies.length, 2, 'fission + capture meshes');
        for (const m of r.meshTallies) {
            assert.strictEqual(m.nx, 5);
            assert.strictEqual(m.ny, 5);
            assert.strictEqual(m.values.length, 25);
            assert.ok(m.values.every((v) => v > 0), 'all mesh cells scored');
            assert.ok(Math.abs(m.bounds!.xmin - -1.95) < 1e-6);
            assert.ok(Math.abs(m.bounds!.xmax - 1.95) < 1e-6);
        }
    });

    test('fuelPin_det0.m: 16 axial bins, one energy bin — no fake spectrum', async () => {
        const r = await parseOutputFile(path.join(DIR, 'fuelPin_det0.m'));
        assert.strictEqual(r.tallies.length, 1);
        assert.strictEqual(r.tallies[0].bins!.length, 16);
        assert.strictEqual(r.spectra.length, 0, 'a 1-row E matrix must not become a spectrum');
        assert.strictEqual(r.meshTallies.length, 0);
    });

    test('pwr_res.m: burnup steps become the k series, with the note saying so', async () => {
        const r = await parseOutputFile(path.join(DIR, 'pwr_res.m'));
        assert.strictEqual(r.keff!.mean.length, 2, 'two burnup steps');
        assert.ok((r.notes ?? []).some((n) => /burnup/.test(n)), 'per-step note present');
        assert.ok(r.convergence?.estimators && r.convergence.estimators.length >= 3,
            'imp/col/abs estimators from the last step');
    });
});
