import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { parseMctal } from '../../results/parsers/mcnp';
import { parseSerpentResults } from '../../results/parsers/serpent';
import { parseSconeOutput } from '../../results/parsers/scone';
import { parseOpenmcStdout } from '../../results/parsers/openmc';
import { resonanceIntegral, bondarenkoShieldingFactor, shieldedCurve } from '../../allen/plotConfig';

const FIX = path.join(__dirname, '..', '..', '..', 'src', 'test', 'fixtures');

suite('Results parsers', () => {
    test('MCNP mctal parses k-eff history', () => {
        const text = fs.readFileSync(path.join(FIX, 'sample.mctal'), 'utf8');
        const r = parseMctal(text);
        assert.strictEqual(r.code, 'mcnp');
        assert.ok(r.keff);
        assert.strictEqual(r.keff!.mean.length, 5);
        assert.ok(Math.abs(r.keff!.final!.mean - 1.0) < 1e-6);
    });

    test('Serpent _res.m parses keff and spectrum', () => {
        const text = fs.readFileSync(path.join(FIX, 'sample_res.m'), 'utf8');
        const r = parseSerpentResults(text);
        assert.strictEqual(r.code, 'serpent');
        assert.ok(r.keff?.final);
        assert.ok(r.spectra.length >= 1);
        assert.ok(r.meshTallies.length >= 1);
    });

    test('SCONE output parses k-eff', () => {
        const text = fs.readFileSync(path.join(FIX, 'sample_scone.out'), 'utf8');
        const r = parseSconeOutput(text);
        assert.strictEqual(r.code, 'scone');
        assert.ok(r.keff);
        assert.strictEqual(r.keff!.mean.length, 3);
    });

    test('OpenMC stdout parses combined k-effective', () => {
        const text = fs.readFileSync(path.join(FIX, 'sample_openmc.log'), 'utf8');
        const r = parseOpenmcStdout(text);
        assert.strictEqual(r.code, 'openmc');
        assert.ok(r.keff?.final);
        assert.ok(Math.abs(r.keff!.final!.mean - 1.0) < 1e-6);
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
