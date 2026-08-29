import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { parseMcnpText } from '../../results/parsers/mcnp';
import { parseSerpentResults } from '../../results/parsers/serpent';
import { parseSconeOutput } from '../../results/parsers/scone';
import { parseOpenmcStdout, parseOpenmcTalliesOut, parseOpenmcStatepoint } from '../../results/parsers/openmc';
import { identifyOutput, detectOutputsInDir, pickPrimaryOutput } from '../../results/detectOutputs';
import { resonanceIntegral, bondarenkoShieldingFactor, shieldedCurve } from '../../allen/plotConfig';
import { FIXTURES } from '../paths';

const FIX = FIXTURES;
const read = (f: string) => fs.readFileSync(path.join(FIX, f), 'utf8');

suite('Results parsers', () => {
    test('MCNP outp: tally values, statistical checks, k-eff', () => {
        const r = parseMcnpText(read('mcnp_outp.txt'), 'mcnp_outp.txt');
        assert.strictEqual(r.code, 'mcnp');
        const t4 = r.tallies.find((t) => t.id === '4');
        assert.ok(t4, 'F4 missing');
        assert.ok(Math.abs(t4!.value - 1.26947e-1) < 1e-8, `F4 value ${t4!.value}`);
        assert.strictEqual(t4!.checks, 'passed');
        assert.strictEqual(r.tallies.find((t) => t.id === '14')?.checks, 'zero');
        assert.ok(Math.abs((r.keff?.final?.mean ?? 0) - 1.31231) < 1e-9);
        assert.strictEqual(r.spectra.length, 1);
    });

    test('MCNP mctal: vals pairs, TFC history, kcode cycles', () => {
        const r = parseMcnpText(read('sample.mctal'), 'sample.mctal');
        const t4 = r.tallies.find((t) => t.id === '4');
        assert.ok(Math.abs((t4?.bins?.[0]?.value ?? 0) - 4.32106e-3) < 1e-9);
        assert.strictEqual(t4?.history?.x.length, 4);
        assert.strictEqual(r.keff?.mean.length, 5);
    });

    test('Serpent _res.m: indexed assignments and burnup steps', () => {
        const r = parseSerpentResults(read('sample_res.m'));
        assert.strictEqual(r.code, 'serpent');
        assert.strictEqual(r.keff?.mean.length, 2);
        assert.ok(Math.abs((r.keff?.final?.mean ?? 0) - 1.28443) < 1e-9);
    });

    test('Serpent _det0.m: value in column 11, error in column 12', () => {
        const r = parseSerpentResults(read('sample_det0.m'));
        const spec = r.tallies.find((t) => t.id === 'FluxSpec');
        assert.strictEqual(spec?.bins?.length, 5);
        assert.ok(Math.abs((spec?.bins?.[0]?.value ?? 0) - 4.53211e-3) < 1e-12);
        assert.strictEqual(r.spectra.length, 1);
    });

    test('SCONE asciiMATLAB: active k-eff beats the inactive copy', () => {
        const r = parseSconeOutput(read('sample_scone.m'));
        assert.strictEqual(r.code, 'scone');
        assert.ok(Math.abs((r.keff?.final?.mean ?? 0) - 1.30124) < 1e-9);
        assert.ok(r.tallies.some((t) => t.id === 'active_fluxSpectrum'));
    });

    test('SCONE console output gives a cycle series', () => {
        const r = parseSconeOutput(read('sample_scone_console.txt'));
        assert.strictEqual(r.keff?.mean.length, 8);
    });

    test('OpenMC log: batch table plus four estimators', () => {
        const r = parseOpenmcStdout(read('openmc_run.log'));
        assert.strictEqual(r.code, 'openmc');
        assert.ok(Math.abs((r.keff?.final?.mean ?? 0) - 1.37223) < 1e-9);
        assert.strictEqual(r.keff?.inactive, 10);
    });

    test('OpenMC tallies.out: absolute std dev becomes relative error', () => {
        const r = parseOpenmcTalliesOut(read('openmc_tallies.out'));
        assert.strictEqual(r.tallies.length, 3);
        const err = r.tallies[0].bins?.[0]?.error ?? 0;
        assert.ok(Math.abs(err - 0.0109885) < 1e-6, `rel err ${err}`);
    });

    test('OpenMC statepoint matches values from OpenMCs own API', async () => {
        const r = await parseOpenmcStatepoint(path.join(FIX, 'openmc_statepoint.30.h5'));
        assert.ok(!r.metadata?.parseError, String(r.metadata?.parseError));
        assert.ok(Math.abs((r.keff?.final?.mean ?? 0) - 1.3722300263744938) < 1e-12);
        const rates = r.tallies.find((t) => t.label.includes('fuel rates'));
        assert.ok(Math.abs((rates?.bins?.[0]?.value ?? 0) - 0.52795133) < 1e-7);
        assert.strictEqual(r.meshTallies.length, 1);
        assert.strictEqual(r.meshTallies[0].values.length, 16);
    });

    test('legacy minimal OpenMC log still parses', () => {
        const r = parseOpenmcStdout(read('sample_openmc.log.txt'));
        assert.ok(r.keff?.final);
        assert.ok(Math.abs(r.keff!.final!.mean - 1.0) < 1e-6);
    });
});

suite('Output detection', () => {
    test('files are identified by content, not extension', () => {
        assert.strictEqual(identifyOutput(path.join(FIX, 'mcnp_outp.txt'))?.code, 'mcnp');
        assert.strictEqual(identifyOutput(path.join(FIX, 'sample.mctal'))?.kind, 'mctal');
        assert.strictEqual(identifyOutput(path.join(FIX, 'sample_res.m'))?.kind, 'resm');
        assert.strictEqual(identifyOutput(path.join(FIX, 'sample_det0.m'))?.kind, 'detm');
        assert.strictEqual(identifyOutput(path.join(FIX, 'sample_scone.m'))?.code, 'scone');
    });

    test('OpenMC tallies.out is not claimed by the SCONE reader', () => {
        // `.out` used to route to SCONE regardless of contents.
        assert.strictEqual(identifyOutput(path.join(FIX, 'openmc_tallies.out'))?.code, 'openmc');
    });

    test('directory scan prefers the statepoint', () => {
        const found = detectOutputsInDir(FIX);
        assert.ok(found.length >= 7, `found ${found.length}`);
        assert.strictEqual(pickPrimaryOutput(found)?.kind, 'statepoint');
    });

    test('XML inputs are not mistaken for outputs', () => {
        const xml = path.join(FIX, 'not-an-output.xml');
        fs.writeFileSync(xml, '<?xml version="1.0"?><geometry/>');
        try {
            assert.strictEqual(identifyOutput(xml), undefined);
        } finally {
            fs.unlinkSync(xml);
        }
    });
});

suite('Doppler plotConfig', () => {
    test('resonanceIntegral is positive for capture-like curve', () => {
        const E = [0.1, 1, 10, 100, 1000, 10000];
        const xs = [100, 50, 10, 5, 2, 1];
        const I = resonanceIntegral(E, xs);
        assert.ok(I > 0);
    });

    test('Bondarenko shielding suppresses at high sigma0', () => {
        assert.strictEqual(bondarenkoShieldingFactor(100, 0), 1);
        const f = bondarenkoShieldingFactor(100, 1000);
        assert.ok(f < 0.5);
        const shielded = shieldedCurve([1, 10], [100, 100], 500);
        assert.ok(shielded[0] < 100);
    });
});
