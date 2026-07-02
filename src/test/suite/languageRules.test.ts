/**
 * Headless tests for the shared rules layer (src/language/rules.ts) — the
 * adapted form of the old validator suite (same cases, same codes) plus
 * coverage for the rules the LSP added (line length) and the cross-reference
 * diagnostics module.
 */
import * as assert from 'assert';
import { runLanguageRules } from '../../language/rules';
import { mcnpCrossReferenceDiagnostics } from '../../language/crossReference';

suite('Language rules (shared layer) — parity with the old validator', () => {
    test('MCNP: flags S(α,β) on a material with no hydrogen', () => {
        const text = [
            'c bad: lwtr on UO2 fuel',
            'm1   92235.80c   0.04',
            '     92238.80c   0.96',
            '     8016.80c    2.0',
            'mt1  lwtr.20t',
        ].join('\n');
        const diags = runLanguageRules('mcnp', text);
        assert.ok(diags.some((d) => d.code === 'mcnp.sab-no-h'),
            `expected mcnp.sab-no-h diagnostic, got: ${JSON.stringify(diags.map((d) => d.code))}`);
    });

    test('MCNP: accepts S(α,β) on water', () => {
        const text = [
            'm3   1001.80c 2.0  8016.80c 1.0',
            'mt3  lwtr.20t',
        ].join('\n');
        const diags = runLanguageRules('mcnp', text);
        assert.ok(!diags.some((d) => d.code === 'mcnp.sab-no-h'));
    });

    test('MCNP: flags HEX macrobody keyword', () => {
        const diags = runLanguageRules('mcnp', '10 hex 0 0 0  5 0 0  0 0 10');
        assert.ok(diags.some((d) => d.code === 'mcnp.macrobody'), 'expected HEX macrobody error');
    });

    test('MCNP: flags RPP with the wrong parameter count', () => {
        const diags = runLanguageRules('mcnp', '1 rpp -1 1 -1 1 -1');
        assert.ok(diags.some((d) => d.code === 'mcnp.macrobody-params'));
    });

    test('MCNP: flags invalid ZAID format', () => {
        const diags = runLanguageRules('mcnp', 'm1 92235.abc 1.0');
        assert.ok(diags.some((d) => d.code === 'mcnp.zaid'));
    });

    test('MCNP: flags mixed fraction signs in a material', () => {
        const diags = runLanguageRules('mcnp', 'm1 92235.80c 0.04 92238.80c -0.96');
        assert.ok(diags.some((d) => d.code === 'mcnp.material-sign'));
    });

    test('MCNP: flags card images past the column limit (tab-aware)', () => {
        const long = '1 1 -10.4 -1 imp:n=1 ' + 'x'.repeat(80);
        const diags = runLanguageRules('mcnp', long);
        const d = diags.find((x) => x.code === 'mcnp.line-length');
        assert.ok(d, 'expected mcnp.line-length diagnostic');
        assert.strictEqual(d!.startCol, 80);
    });

    test('MCNP: honors a custom line limit through options', () => {
        const line = 'c ' + 'x'.repeat(100);
        assert.ok(!runLanguageRules('mcnp', line, { mcnpLineLimit: 128 })
            .some((d) => d.code === 'mcnp.line-length'));
        assert.ok(runLanguageRules('mcnp', line, { mcnpLineLimit: 80 })
            .some((d) => d.code === 'mcnp.line-length'));
    });

    test('OpenMC: flags deprecated openmc.Source(', () => {
        const text = [
            'import openmc',
            'src = openmc.Source(space=openmc.stats.Box((-1,-1,-1),(1,1,1)))',
        ].join('\n');
        const diags = runLanguageRules('openmc', text);
        assert.ok(diags.some((d) => d.code === 'openmc.source'));
    });

    test('OpenMC: flags StatePoint misuse of model.run() return value', () => {
        const text = [
            'sp = model.run()',
            'print(sp.keff)',
        ].join('\n');
        const diags = runLanguageRules('openmc', text);
        assert.ok(diags.some((d) => d.code === 'openmc.run-return'));
    });

    test('Serpent: flags surf rect', () => {
        const diags = runLanguageRules('serpent', 'surf 1 rect -1 1 -1 1');
        assert.ok(diags.some((d) => d.code === 'serpent.surf-rect'));
    });

    test('Serpent: flags set omp and eV-looking egrid values', () => {
        const diags = runLanguageRules('serpent', ['set omp 8', 'set egrid 0.625 1e5'].join('\n'));
        assert.ok(diags.some((d) => d.code === 'serpent.set-omp'));
        assert.ok(diags.some((d) => d.code === 'serpent.egrid-units'));
    });

    test('SCONE: flags aceNuclearDatabase typo and pinUniverse mismatch', () => {
        const text = [
            'nuclearData {',
            '  handles { ce { type aceNuclearDatabase; } }',
            '  materials {',
            '    fuelPin { id 100; type pinUniverse;',
            '              radii (0.4 0.5);',
            '              fills (UO2 Helium Water); }',
            '  }',
            '}',
        ].join('\n');
        const diags = runLanguageRules('scone', text);
        assert.ok(diags.some((d) => d.code === 'scone.ace-typo'));
        assert.ok(diags.some((d) => d.code === 'scone.pin-len' || d.code === 'scone.pin-outer'));
    });

    test('SCONE: flags non-ASCII characters', () => {
        const diags = runLanguageRules('scone', 'pop 10\u00e900;');
        assert.ok(diags.some((d) => d.code === 'scone.non-ascii'));
    });

    test('null language yields no diagnostics', () => {
        assert.deepStrictEqual(runLanguageRules(null, 'anything at all'), []);
    });
});

suite('MCNP cross-reference diagnostics', () => {
    const DECK = [
        '1 1 -10.4 -1 imp:n=1',
        '2 0        1 -2 imp:n=1',
        '3 0        2 imp:n=0',
        '',
        '1 cz 0.4096',
        '2 cz 0.475',
        '9 cz 99.0',
        '',
        'm1 92235.80c 0.04 92238.80c 0.96',
        'm7 1001.80c 2.0 8016.80c 1.0',
    ].join('\n');

    test('clean references produce no undefined-* errors', () => {
        const diags = mcnpCrossReferenceDiagnostics(DECK);
        assert.ok(!diags.some((d) => d.code.startsWith('mcnp.undefined-')),
            JSON.stringify(diags.filter((d) => d.code.startsWith('mcnp.undefined-'))));
    });

    test('unused surface and material get unnecessary hints', () => {
        const diags = mcnpCrossReferenceDiagnostics(DECK);
        const unusedSurf = diags.find((d) => d.code === 'mcnp.unused-surface');
        const unusedMat = diags.find((d) => d.code === 'mcnp.unused-material');
        assert.ok(unusedSurf && unusedSurf.message.includes('Surface 9'));
        assert.ok(unusedMat && unusedMat.message.includes('Material 7'));
        assert.ok(unusedSurf!.unnecessary && unusedMat!.unnecessary);
        assert.strictEqual(unusedSurf!.severity, 'hint');
    });

    test('undefined surface referenced by a cell is an error', () => {
        const diags = mcnpCrossReferenceDiagnostics([
            '1 1 -10.4 -42 imp:n=1',
            '',
            '1 cz 0.4096',
            '',
            'm1 92235.80c 1.0',
        ].join('\n'));
        const d = diags.find((x) => x.code === 'mcnp.undefined-surface');
        assert.ok(d, 'expected undefined-surface error');
        assert.strictEqual(d!.severity, 'error');
        assert.ok(d!.message.includes('Surface 42'));
        assert.ok(d!.message.includes('cell 1'));
    });

    test('undefined material and fill universe are errors', () => {
        const diags = mcnpCrossReferenceDiagnostics([
            '1 5 -10.4 -1 imp:n=1 fill=30',
            '',
            '1 cz 0.4096',
        ].join('\n'));
        assert.ok(diags.some((d) => d.code === 'mcnp.undefined-material'));
        assert.ok(diags.some((d) => d.code === 'mcnp.undefined-universe'));
    });

    test('universe defined via u= is not reported undefined when filled', () => {
        const diags = mcnpCrossReferenceDiagnostics([
            '1 1 -10.4 -1 u=10 imp:n=1',
            '2 0 -2 fill=10 imp:n=1',
            '',
            '1 cz 0.4096',
            '2 cz 1.0',
            '',
            'm1 92235.80c 1.0',
        ].join('\n'));
        assert.ok(!diags.some((d) => d.code === 'mcnp.undefined-universe'),
            JSON.stringify(diags.filter((d) => d.code.startsWith('mcnp.undefined-'))));
    });
});
