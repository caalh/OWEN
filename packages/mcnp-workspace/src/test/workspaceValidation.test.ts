import * as assert from 'assert';
import * as path from 'path';
import { validateMcnpProject } from '../validate';
import { mcnpCrossReferenceDiagnostics } from '../crossReference';
import { buildMcnpReferenceIndex } from '../mcnpReferences';

const FIXTURES = path.resolve(__dirname, '../../../../test/fixtures/mcnp-workspace');

function fixtureDir(name: string): string {
    return path.join(FIXTURES, name);
}

function countCode(result: ReturnType<typeof validateMcnpProject>, code: string): number {
    return result.diagnostics.filter((d) => d.code === code).length;
}

describe('mcnp-workspace fixtures', () => {
    it('ok/ → 0 errors', () => {
        const r = validateMcnpProject({ rootPath: path.join(fixtureDir('ok'), 'main.inp') });
        assert.strictEqual(r.summary.errors, 0, JSON.stringify(r.diagnostics));
        assert.ok(r.files.length >= 3);
    });

    it('beavrs-lite/ → 0 errors', () => {
        const r = validateMcnpProject({ rootPath: path.join(fixtureDir('beavrs-lite'), 'main.inp') });
        assert.strictEqual(r.summary.errors, 0, JSON.stringify(r.diagnostics));
    });

    it('bad-surface/ → undefined surface on main file', () => {
        const r = validateMcnpProject({ rootPath: path.join(fixtureDir('bad-surface'), 'main.inp') });
        assert.ok(countCode(r, 'mcnp.undefined-surface') >= 1);
        const main = r.diagnostics.find((d) => d.code === 'mcnp.undefined-surface' && d.file.endsWith('main.inp'));
        assert.ok(main, 'error should be on main.inp cell referencing surface 99');
    });

    it('dup-surface/ → duplicate surface', () => {
        const r = validateMcnpProject({ rootPath: path.join(fixtureDir('dup-surface'), 'main.inp') });
        assert.ok(countCode(r, 'mcnp.duplicate-surface') >= 1);
    });

    it('missing-include/ → include not found', () => {
        const r = validateMcnpProject({ rootPath: path.join(fixtureDir('missing-include'), 'main.inp') });
        assert.ok(countCode(r, 'mcnp.include-not-found') >= 1);
    });

    it('read-file-eq/ → FILE = path is one include, not a missing file named "file" (#6)', () => {
        const r = validateMcnpProject({ rootPath: path.join(fixtureDir('read-file-eq'), 'main.inp') });
        assert.strictEqual(r.summary.errors, 0, JSON.stringify(r.diagnostics));
        assert.ok(!r.diagnostics.some((d) => /Include file not found: file\b/.test(d.message)),
            'the FILE keyword must not be treated as a filename');
    });

    it('cycle/ → include cycle', () => {
        const r = validateMcnpProject({ rootPath: path.join(fixtureDir('cycle'), 'a.i') });
        assert.ok(countCode(r, 'mcnp.include-cycle') >= 1);
    });

    it('single-file deck unchanged (no undefined errors on clean deck)', () => {
        const deck = [
            '1 1 -10.4 -1 imp:n=1',
            '1 cz 0.4096',
            'm1 92235.80c 1.0',
        ].join('\n');
        const diags = mcnpCrossReferenceDiagnostics(deck);
        assert.ok(!diags.some((d) => d.severity === 'error'));
    });

    // Regression: Frank Helk's lunar-crater deck (runs in MCNP 6.3) must not
    // raise undefined-surface errors. Two bugs stacked: `z` (axisymmetric by
    // point pairs) was not a known surface mnemonic, and surface cards indented
    // 1–4 columns were glued onto the previous card. See mcnpReferences.ts.
    const LUNAR_CRATER = [
        'Simple lunar crater',
        'c',
        'c',
        '     9     0        401              imp:p=0   $ Graveyard',
        '    10     0        400  -401        imp:p=1   $ Sick bay',
        '    20     0       -400  200 500 900 imp:p=1   $ Space above',
        '    30     1 -1.5  -400 -300         imp:p=1   $ Ground below',
        '    40     0       -100 -200 300     imp:p=1   $ Crater volume',
        '    50     1 -1.5   100 -200 300 #10 imp:p=1   $ Volume surrounding crater',
        '    60     1 -1.5  -500  200         imp:p=1   $ Crater wall',
        '    70     1 -1.5  -900              imp:p=1   $ Indicator',
        '',
        'c Origin = center of crater, at surface level',
        '   100        z 0 20000 -2000 18000 -4000 14000  $ Crater Wall surface',
        '   200        sz -173750000 173750000  $ Lunar Surface (BIG Sphere, 1737.5 km)',
        '   300        pz -3000  $ Crater bottom, 30m below surface',
        '   400        so 100000  $ World\'s end inner',
        '   401        so 100001  $ World\'s end',
        '   500        TZ 0 0 0 21000 800 1000',
        '   900        sz 50000 1000',
        '',
        'mode p',
        'M1 8016 -0.456 $ Lunar Regolith',
        '       11023 -0.004     12000 -0.005      13027 -0.176      14000 -0.207',
        '       20000 -0.136     22000 -0.001      26000 -0.015',
    ].join('\n');

    it('lunar-crater deck → no undefined-surface errors (z mnemonic + indented surfaces)', () => {
        const diags = mcnpCrossReferenceDiagnostics(LUNAR_CRATER);
        const undef = diags.filter((d) => d.code === 'mcnp.undefined-surface');
        assert.strictEqual(undef.length, 0, JSON.stringify(undef, null, 2));
    });

    it('lunar-crater deck → every surface and cell is indexed', () => {
        const index = buildMcnpReferenceIndex(LUNAR_CRATER);
        for (const sid of [100, 200, 300, 400, 401, 500, 900]) {
            assert.ok(index.definitions.has(`surface:${sid}`), `surface ${sid} should be defined`);
        }
        // Cell 9 (single digit, right-aligned to column 6) must survive the
        // title card, not be absorbed by it.
        for (const cid of [9, 10, 20, 30, 40, 50, 60, 70]) {
            assert.ok(index.definitions.has(`cell:${cid}`), `cell ${cid} should be defined`);
        }
        // The coefficients of the `z` surface (20000, 18000, …) must not be
        // reported as surface references.
        assert.ok(!index.definitions.has('surface:20000'), '20000 is a z-surface coefficient, not a surface');
    });
});
