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
        assert.ok(diags.some((d) => d.code === 'mcnp.sab-no-target'),
            `expected mcnp.sab-no-target diagnostic, got: ${JSON.stringify(diags.map((d) => d.code))}`);
    });

    test('MCNP: accepts S(α,β) on water', () => {
        const text = [
            'm3   1001.80c 2.0  8016.80c 1.0',
            'mt3  lwtr.20t',
        ].join('\n');
        const diags = runLanguageRules('mcnp', text);
        assert.ok(!diags.some((d) => d.code === 'mcnp.sab-no-target'));
    });

    // S(α,β) is not hydrogen-only. Manual §5.6.2 Example 2 applies GRPH to pure
    // carbon; the old hydrogen-only rule made that an error.
    test('MCNP: accepts graphite S(α,β) on a carbon material', () => {
        const text = [
            'm4   6000.80c 1.0',
            'mt4  grph.20t',
        ].join('\n');
        const diags = runLanguageRules('mcnp', text);
        assert.ok(!diags.some((d) => d.code === 'mcnp.sab-no-target'),
            `false positive: ${JSON.stringify(diags.map((d) => d.code))}`);
    });

    // §5.3.4.5 is titled "RHP or HEX" and three of the four examples in
    // Listing 5.7 spell it `hex`.
    test('MCNP: accepts HEX as an alias for RHP', () => {
        const diags = runLanguageRules('mcnp', '10 hex 0 0 0  0 0 10  5 0 0');
        assert.ok(!diags.some((d) => d.code === 'mcnp.macrobody'),
            'HEX is a documented RHP alias and must not be flagged');
    });

    test('MCNP: still flags CYL, which is not a keyword', () => {
        const diags = runLanguageRules('mcnp', '10 cyl 0 0 0 5');
        assert.ok(diags.some((d) => d.code === 'mcnp.macrobody'));
    });

    test('MCNP: flags RPP with the wrong parameter count', () => {
        const diags = runLanguageRules('mcnp', '1 rpp -1 1 -1 1 -1');
        assert.ok(diags.some((d) => d.code === 'mcnp.macrobody-params'));
    });

    // RHP takes 9 or 15 (s and t are optional for a regular hexagon); BOX
    // takes 9 or 12 (a3 omitted makes the body infinite).
    test('MCNP: accepts the short forms of RHP and BOX', () => {
        for (const card of ['1 rhp 0 0 0  0 0 10  5 0 0', '2 box 0 0 0  4 0 0  0 4 0']) {
            const diags = runLanguageRules('mcnp', card);
            assert.ok(!diags.some((d) => d.code === 'mcnp.macrobody-params'),
                `false positive on short form: ${card}`);
        }
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
        const line = '1 1 -10.4 -1 imp:n=1 ' + 'x'.repeat(80);
        assert.ok(!runLanguageRules('mcnp', line, { mcnpLineLimit: 128 })
            .some((d) => d.code === 'mcnp.line-length'));
        assert.ok(runLanguageRules('mcnp', line, { mcnpLineLimit: 80 })
            .some((d) => d.code === 'mcnp.line-length'));
    });

    test('MCNP: dialect option picks the 80/128 limit and the message names it', () => {
        const line = '1 1 -10.4 -1 imp:n=1 ' + 'x'.repeat(80); // ~101 columns
        const legacy = runLanguageRules('mcnp', line, { mcnpDialect: 'mcnp6.1-and-earlier' })
            .find((d) => d.code === 'mcnp.line-length');
        assert.ok(legacy, 'expected a warning in the 80-column dialect');
        assert.match(legacy!.message, /6\.2\+ allows 128/);
        assert.ok(!runLanguageRules('mcnp', line, { mcnpDialect: 'mcnp6.2+' })
            .some((d) => d.code === 'mcnp.line-length'));
        const over128 = '1 1 -10.4 -1 imp:n=1 ' + 'x'.repeat(120);
        const modern = runLanguageRules('mcnp', over128, { mcnpDialect: 'mcnp6.2+' })
            .find((d) => d.code === 'mcnp.line-length');
        assert.ok(modern, 'expected a warning past 128 in the 6.2+ dialect');
        assert.match(modern!.message, /MCNP 6\.2\+ limit/);
    });

    test('MCNP: dialect beats the raw number; file directive beats both', () => {
        const long = '1 1 -10.4 -1 imp:n=1 ' + 'x'.repeat(80);
        // dialect 6.2+ wins over a conflicting custom 80
        assert.ok(!runLanguageRules('mcnp', long, { mcnpDialect: 'mcnp6.2+', mcnpLineLimit: 80 })
            .some((d) => d.code === 'mcnp.line-length'));
        // directive wins over dialect
        const withDirective = ['c owen: line-limit=128', long].join('\n');
        const diags = runLanguageRules('mcnp', withDirective, {
            mcnpDialect: 'mcnp6.1-and-earlier',
        });
        assert.ok(!diags.some((d) => d.code === 'mcnp.line-length'));
        // and the directive is named when it does flag
        const still = ['c owen: line-limit=90', long].join('\n');
        const flagged = runLanguageRules('mcnp', still, { mcnpDialect: 'mcnp6.2+' })
            .find((d) => d.code === 'mcnp.line-length');
        assert.ok(flagged);
        assert.match(flagged!.message, /line-limit=90' on line 1/);
    });

    test('MCNP: fill=0:N 0:M 0:0 on a large lattice names the centered alternative', () => {
        const diags = runLanguageRules('mcnp', '     fill=0:16 0:16 0:0');
        const d = diags.find((x) => x.code === 'mcnp.lattice-fill-origin');
        assert.ok(d, 'expected mcnp.lattice-fill-origin');
        assert.match(d!.message, /fill=-8:8 -8:8 0:0/);
        assert.ok(!runLanguageRules('mcnp', '     fill=-8:8 -8:8 0:0')
            .some((x) => x.code === 'mcnp.lattice-fill-origin'));
        assert.ok(!runLanguageRules('mcnp', '     fill=0:1 0:1 0:0')
            .some((x) => x.code === 'mcnp.lattice-fill-origin'));
    });

    test('MCNP: comment cards and $ tails past the limit are not flagged', () => {
        assert.ok(!runLanguageRules('mcnp', 'c ' + 'x'.repeat(200))
            .some((d) => d.code === 'mcnp.line-length'));
        assert.ok(!runLanguageRules('mcnp', '1 1 -10.4 -1 imp:n=1 $ ' + 'x'.repeat(200))
            .some((d) => d.code === 'mcnp.line-length'));
        assert.ok(runLanguageRules('mcnp', 'x'.repeat(85) + '$ comment')
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
