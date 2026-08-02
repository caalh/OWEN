// Adversarial tests: validation rules (src/language/rules.ts — the shared
// pure rules layer used by both the LSP server and the manual validate
// command). Each rule is driven to fire; the bundled prebuilt decks must stay
// clean of Error-severity findings (no false positives).
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { PREBUILT_MODELS } from '../paths';
import { runLanguageRules } from '../../language/rules';
import type { RulesLanguage } from '../../language/types';

const run = (lang: RulesLanguage, text: string) => runLanguageRules(lang, text);
const codes = (diags: { code?: string }[]) => diags.map((d) => String(d.code));

suite('ADV validator — MCNP', () => {
    test('mt on hydrogen-free fuel fires mcnp.sab-no-target', () => {
        const text = 'm7 92235.80c 0.04 92238.80c 0.96 8016.80c 2.0\nmt7 lwtr.20t';
        assert.ok(codes(run('mcnp', text)).includes('mcnp.sab-no-target'));
    });

    test('graphite S(a,b) on a carbon material does NOT fire', () => {
        const text = 'm8 6000.80c 1.0\nmt8 grph.20t';
        const c = codes(run('mcnp', text));
        assert.ok(!c.includes('mcnp.sab-no-target'), `false positive: ${c}`);
    });

    test('beryllium S(a,b) on Be metal does NOT fire', () => {
        const text = 'm9 4009.80c 1.0\nmt9 be.20t';
        const c = codes(run('mcnp', text));
        assert.ok(!c.includes('mcnp.sab-no-target'), `false positive: ${c}`);
    });

    test('mt referencing undefined material fires mcnp.mt-missing-material', () => {
        const text = 'mt42 lwtr.20t';
        assert.ok(codes(run('mcnp', text)).includes('mcnp.mt-missing-material'));
    });

    test('mt on water (has H) does NOT fire', () => {
        const text = 'm3 1001.80c 2 8016.80c 1\nmt3 lwtr.20t';
        const c = codes(run('mcnp', text));
        assert.ok(!c.includes('mcnp.sab-no-target'), `false positive: ${c}`);
    });

    test('mixed +/- fractions in one material fires mcnp.material-sign', () => {
        const text = 'm5 92235.80c 0.04 92238.80c -0.96';
        assert.ok(codes(run('mcnp', text)).includes('mcnp.material-sign'));
    });

    test('all-negative (weight) fractions do NOT fire material-sign', () => {
        const text = 'm5 40000.80c -0.9819 50000.80c -0.0150 26000.80c -0.0021 24000.80c -0.0010';
        const c = codes(run('mcnp', text));
        assert.ok(!c.includes('mcnp.material-sign'), `false positive: ${c}`);
    });

    test('non-material card after a material does not leak into the sign check', () => {
        // fmesh origin=-182.78 after an all-positive material must not add '-'.
        const text = [
            'm12 40000.80c 0.5 50000.80c 0.5',
            'fmesh4:n geom=xyz origin=-182.78 -182.78 -183.0',
        ].join('\n');
        const c = codes(run('mcnp', text));
        assert.ok(!c.includes('mcnp.material-sign'), `false positive: ${c}`);
    });

    test('indented material continuation lines still feed the sign check', () => {
        const text = [
            'm5 92235.80c 0.04',
            '     92238.80c -0.96',
        ].join('\n');
        assert.ok(codes(run('mcnp', text)).includes('mcnp.material-sign'));
    });

    test('bad ZAID suffix fires mcnp.zaid', () => {
        const text = 'm1 92235.80x 1.0';
        assert.ok(codes(run('mcnp', text)).includes('mcnp.zaid'));
    });

    test('all Table B.1 class letters are legal ZAID suffixes', () => {
        // t c d m g p u y e h o r s a — manual Table B.1. 'n' and 'j' are not
        // classes; .80x above already covers the invalid path.
        for (const letter of 'tcdmgpuyehorsa') {
            const c = codes(run('mcnp', `m1 92235.80${letter} 1.0`));
            assert.ok(!c.includes('mcnp.zaid'), `false positive on .80${letter}: ${c}`);
        }
        assert.ok(codes(run('mcnp', 'm1 92235.80n 1.0')).includes('mcnp.zaid'),
            '"n" is not a Table B.1 class letter');
        assert.ok(codes(run('mcnp', 'm1 92235.80j 1.0')).includes('mcnp.zaid'),
            '"j" is not a Table B.1 class letter');
    });

    test('3+-digit library identifiers are legal (manual §1.2.3, e.g. 1001.810h)', () => {
        const c = codes(run('mcnp', 'm1 1001.810h 1.0'));
        assert.ok(!c.includes('mcnp.zaid'), `false positive on 1001.810h: ${c}`);
    });

    test('plain decimals are not mistaken for ZAIDs', () => {
        // 4-6 digits before the point used to be enough to enter the ZAID
        // check, flagging coordinates like 12345.6.
        const c = codes(run('mcnp', '10 pz 12345.6'));
        assert.ok(!c.includes('mcnp.zaid'), `false positive on 12345.6: ${c}`);
    });

    test('a truncated ZAID inside a material card is still flagged', () => {
        // In material context 92235.71 is a table identifier missing its
        // class letter, not a coordinate.
        assert.ok(codes(run('mcnp', 'm1 92235.71 0.045')).includes('mcnp.zaid'));
    });

    test('CYL fires an error but HEX does not — HEX is an RHP alias', () => {
        assert.ok(codes(run('mcnp', '10 cyl 0 0 0 5')).includes('mcnp.macrobody'));
        const c = codes(run('mcnp', '10 hex 0 0 0  0 0 10  5 0 0'));
        assert.ok(!c.includes('mcnp.macrobody'), `false positive on HEX: ${c}`);
    });

    test('RPP with wrong param count fires macrobody-params', () => {
        const text = '10 rpp -1 1 -1 1 -1'; // 5 params, needs 6
        assert.ok(codes(run('mcnp', text)).includes('mcnp.macrobody-params'));
    });

    test('RCC with correct 7 params does NOT fire', () => {
        const text = '10 rcc 0 0 0 0 0 100 0.5';
        const c = codes(run('mcnp', text));
        assert.ok(!c.includes('mcnp.macrobody-params'), `false positive: ${c}`);
    });

    test('short-form RHP (9) and BOX (9) do NOT fire macrobody-params', () => {
        for (const card of ['10 rhp 0 0 0  0 0 10  5 0 0', '11 box 0 0 0  4 0 0  0 4 0']) {
            const c = codes(run('mcnp', card));
            assert.ok(!c.includes('mcnp.macrobody-params'), `false positive on ${card}: ${c}`);
        }
    });

    test('long-form RHP (15) and BOX (12) do NOT fire macrobody-params', () => {
        const rhp = '10 rhp 0 0 0  0 0 10  5 0 0  0 5 0  0 0 5';
        const box = '11 box 0 0 0  4 0 0  0 4 0  0 0 4';
        for (const card of [rhp, box]) {
            const c = codes(run('mcnp', card));
            assert.ok(!c.includes('mcnp.macrobody-params'), `false positive on ${card}: ${c}`);
        }
    });

    test('REC accepts 10 or 12 entries, rejects 11 (manual 5.3.4.6)', () => {
        const rec10 = '10 rec 7.5 0 -1.5  0 0 3  0.25 0 0  0.5'; // 10th entry = minor radius
        const rec12 = '10 rec 7.5 0 -1.5  0 0 3  0.25 0 0  0 0.5 0';
        for (const card of [rec10, rec12]) {
            const c = codes(run('mcnp', card));
            assert.ok(!c.includes('mcnp.macrobody-params'), `false positive on ${card}: ${c}`);
        }
        assert.ok(codes(run('mcnp', '10 rec 7.5 0 -1.5  0 0 3  0.25 0 0  0.5 0'))
            .includes('mcnp.macrobody-params'));
    });

    test('ARB counts its 30 entries across continuation lines (manual 5.3.4.10)', () => {
        // Listing 5.12's ARB, verbatim: 8 corner triplets + 6 face integers.
        const arb = [
            '10 arb 15.5 -1 -1  16.5 -1 -1  16.5 1 -1  15.5 1 -1',
            '      15.5 -1 1  16.5 -1 1  16.5 1 1  15.5 1 1',
            '      1458 2367 1256 3478 1234 5678',
        ].join('\n');
        const c = codes(run('mcnp', arb));
        assert.ok(!c.includes('mcnp.macrobody-params'), `false positive on 30-entry ARB: ${c}`);
        const short = arb.replace(' 5678', '');
        assert.ok(codes(run('mcnp', short)).includes('mcnp.macrobody-params'),
            '29-entry ARB must be flagged');
    });

    test('lattice fill rows are continuation lines, not cells missing imp:n', () => {
        const text = [
            '100 0 -1 lat=1 u=5 imp:n=1',
            '     fill=-1:1 -1:1 0:0',
            '     2 2 2',
            '     2 3 2',
            '     2 2 2',
        ].join('\n');
        const c = codes(run('mcnp', text));
        assert.ok(!c.includes('mcnp.cell-imp'), `false positive on fill array: ${c}`);
    });

    test('cell missing imp:n fires mcnp.cell-imp; continuation imp is honored', () => {
        const bad = '10 1 -10.4 -1';
        assert.ok(codes(run('mcnp', bad)).includes('mcnp.cell-imp'));
        const good = '10 1 -10.4 -1\n        imp:n=1';
        const c = codes(run('mcnp', good));
        assert.ok(!c.includes('mcnp.cell-imp'), `continuation imp missed: ${c}`);
    });

    test('imp:p on the cell satisfies the importance check (mode p problems)', () => {
        const c = codes(run('mcnp', '10 1 -10.4 -1 imp:p=1'));
        assert.ok(!c.includes('mcnp.cell-imp'), `false positive on imp:p: ${c}`);
    });

    test('a data-block IMP card suppresses per-cell importance warnings (manual 5.12.1)', () => {
        const deck = [
            '10 1 -10.4 -1',
            '20 0 1',
            '',
            'imp:n 1 0',
        ].join('\n');
        const c = codes(run('mcnp', deck));
        assert.ok(!c.includes('mcnp.cell-imp'), `false positive with IMP data card: ${c}`);
    });

    test('a WWN card suppresses per-cell importance warnings', () => {
        const deck = [
            '10 1 -10.4 -1',
            '',
            'wwn1:n 0.5',
        ].join('\n');
        const c = codes(run('mcnp', deck));
        assert.ok(!c.includes('mcnp.cell-imp'), `false positive with WWN card: ${c}`);
    });
});

suite('ADV validator — OpenMC', () => {
    test('openmc.Source( fires', () => {
        assert.ok(codes(run('openmc', 'src = openmc.Source(space=box)')).includes('openmc.source'));
    });

    test('IndependentSource does NOT fire openmc.source', () => {
        const c = codes(run('openmc', 'src = openmc.IndependentSource(space=box)'));
        assert.ok(!c.includes('openmc.source'), `false positive: ${c}`);
    });

    test('rectangular_prism() deprecated fires', () => {
        assert.ok(codes(run('openmc', 'r = openmc.model.rectangular_prism(1.26, 1.26)')).includes('openmc.rectprism'));
    });

    test('RectangularPrism class does NOT fire', () => {
        const c = codes(run('openmc', 'r = openmc.model.RectangularPrism(width=1.26, height=1.26)'));
        assert.ok(!c.includes('openmc.rectprism'), `false positive: ${c}`);
    });

    test('Material(temperature=...) is valid OpenMC — no diagnostic', () => {
        // Documented signature; openmc.model.borated_water() uses it. The old
        // openmc.mat-temperature error was removed 2026-08-02.
        const c = codes(run('openmc', 'f = openmc.Material(temperature=600.0)'));
        assert.ok(!c.includes('openmc.mat-temperature'), `removed rule fired: ${c}`);
    });

    test('cell.temperature assignment does NOT fire', () => {
        const c = codes(run('openmc', 'cell.temperature = 600.0'));
        assert.ok(!c.includes('openmc.mat-temperature'), `false positive: ${c}`);
    });

    test('material continuation indented 1-4 spaces fires short-continuation', () => {
        const deck = 'm3  40090.80c 0.5145 40091.80c 0.1122\n    40094.80c 0.1738 40096.80c 0.0280';
        assert.ok(codes(run('mcnp', deck)).includes('mcnp.short-continuation'));
    });

    test('material continuation indented 5+ spaces does NOT fire', () => {
        const deck = 'm3  40090.80c 0.5145 40091.80c 0.1122\n     40094.80c 0.1738 40096.80c 0.0280';
        const c = codes(run('mcnp', deck));
        assert.ok(!c.includes('mcnp.short-continuation'), `false positive: ${c}`);
    });

    test('new card at column 1 after a material does NOT fire', () => {
        const deck = 'm3  40090.80c 1.0\nkcode 5000 1.0 30 130';
        const c = codes(run('mcnp', deck));
        assert.ok(!c.includes('mcnp.short-continuation'), `false positive: ${c}`);
    });

    test('MCNP-style S(α,β) name in add_s_alpha_beta fires', () => {
        assert.ok(codes(run('openmc', "w.add_s_alpha_beta('lwtr')")).includes('openmc.sab-name'));
    });

    test('c_H_in_H2O S(α,β) name does NOT fire', () => {
        const c = codes(run('openmc', "w.add_s_alpha_beta('c_H_in_H2O')"));
        assert.ok(!c.includes('openmc.sab-name'), `false positive: ${c}`);
    });

    test('bogus density units fire', () => {
        assert.ok(codes(run('openmc', "m.set_density('g/m3', 10.0)")).includes('openmc.density-units'));
    });

    test('atom/b-cm density units do NOT fire', () => {
        const c = codes(run('openmc', "m.set_density('atom/b-cm', 0.06)"));
        assert.ok(!c.includes('openmc.density-units'), `false positive: ${c}`);
    });

    test('openmc_exec_kwargs fires', () => {
        assert.ok(codes(run('openmc', 'model.run(openmc_exec_kwargs={"threads": 4})')).includes('openmc.exec-kwargs'));
    });

    test('sp = model.run(); sp.keff fires run-return', () => {
        const text = 'sp = model.run()\nprint(sp.keff)';
        assert.ok(codes(run('openmc', text)).includes('openmc.run-return'));
    });

    test('path = model.run(); openmc.StatePoint(path) does NOT fire run-return', () => {
        const text = 'path = model.run()\nwith openmc.StatePoint(path) as sp:\n    print(sp.keff)';
        const c = codes(run('openmc', text));
        assert.ok(!c.includes('openmc.run-return'), `false positive: ${c}`);
    });
});

suite('ADV validator — Serpent', () => {
    test('surf rect fires', () => {
        assert.ok(codes(run('serpent', 'surf 1 rect -1 1 -1 1')).includes('serpent.surf-rect'));
    });

    test('surf cuboid does NOT fire', () => {
        const c = codes(run('serpent', 'surf 1 cuboid -1 1 -1 1 -1 1'));
        assert.ok(!c.includes('serpent.surf-rect'), `false positive: ${c}`);
    });

    test('comment containing rect does NOT fire', () => {
        const c = codes(run('serpent', '% this surf uses rect conventions'));
        assert.ok(!c.includes('serpent.surf-rect'), `false positive: ${c}`);
    });

    test('trcl in Serpent fires', () => {
        assert.ok(codes(run('serpent', 'trcl 1 0 0 5')).includes('serpent.trcl'));
    });

    test('set omp fires warning', () => {
        assert.ok(codes(run('serpent', 'set omp 8')).includes('serpent.set-omp'));
    });

    test('eV-looking egrid values fire units warning', () => {
        assert.ok(codes(run('serpent', 'set egrid 1e-11 625 2e7')).includes('serpent.egrid-units'));
    });

    test('MeV egrid does NOT fire', () => {
        const c = codes(run('serpent', 'set egrid 1e-11 0.625E-6 20.0'));
        assert.ok(!c.includes('serpent.egrid-units'), `false positive: ${c}`);
    });
});

suite('ADV validator — SCONE', () => {
    test('aceNuclearDatabase typo fires', () => {
        assert.ok(codes(run('scone', 'ce { type aceNuclearDatabase; }')).includes('scone.ace-typo'));
    });

    test('aceNeutronDatabase does NOT fire', () => {
        const c = codes(run('scone', 'ce { type aceNeutronDatabase; }'));
        assert.ok(!c.includes('scone.ace-typo'), `false positive: ${c}`);
    });

    test('radii/fills length mismatch fires scone.pin-len', () => {
        const text = 'fuelPin { id 1; type pinUniverse; radii (0.4 0.5 0.0); fills (UO2 Water); }';
        assert.ok(codes(run('scone', text)).includes('scone.pin-len'));
    });

    test('non-zero outermost radius fires scone.pin-outer', () => {
        const text = 'fuelPin { id 1; type pinUniverse; radii (0.4 0.5); fills (UO2 Water); }';
        assert.ok(codes(run('scone', text)).includes('scone.pin-outer'));
    });

    test('correct pinUniverse does NOT fire pin rules', () => {
        const text = 'fuelPin { id 1; type pinUniverse; radii (0.4 0.5 0.0); fills (UO2 Clad Water); }';
        const c = codes(run('scone', text));
        assert.ok(!c.includes('scone.pin-len') && !c.includes('scone.pin-outer'), `false positive: ${c}`);
    });

    test('temp 600 with .03 suffix fires temp-zaid mismatch', () => {
        const text = 'fuel { temp 600; composition { 92235.03 1.0e-2; } }';
        assert.ok(codes(run('scone', text)).includes('scone.temp-zaid'));
    });

    test('temp 600 with .06 suffix does NOT fire', () => {
        const text = 'fuel { temp 600; composition { 92235.06 1.0e-2; } }';
        const c = codes(run('scone', text));
        assert.ok(!c.includes('scone.temp-zaid'), `false positive: ${c}`);
    });

    test('non-ASCII fires scone.non-ascii', () => {
        assert.ok(codes(run('scone', 'fuel { temp 600; } — em-dash')).includes('scone.non-ascii'));
    });

    test('missing semicolon at top level fires scone.semicolon', () => {
        assert.ok(codes(run('scone', 'pop 5000')).includes('scone.semicolon'));
    });

    test('nested (multi-line, deep) blocks with matched braces do not false-fire semicolon', () => {
        const text = [
            'geometry {',
            '  universes {',
            '    pin { id 1; type pinUniverse; radii (0.4 0.0); fills (UO2 Water); }',
            '  }',
            '}',
        ].join('\n');
        const c = codes(run('scone', text));
        assert.ok(!c.includes('scone.semicolon'), `false positive: ${c}`);
    });
});

suite('ADV validator — bundled prebuilt decks are clean of Errors', () => {
    // Enumerate ALL bundled decks by extension so new prebuilt models are
    // covered automatically without editing this test.
    const root = PREBUILT_MODELS;
    const langByExt: Record<string, RulesLanguage> = {
        '.i': 'mcnp', '.mcnp': 'mcnp', '.inp': 'mcnp',
        '.py': 'openmc',
        '.sss': 'serpent', '.serp': 'serpent',
        '.scone': 'scone',
    };
    const cases: Array<[string, RulesLanguage]> = fs.readdirSync(root)
        .filter((f) => path.extname(f) in langByExt)
        .map((f) => [f, langByExt[path.extname(f)]]);
    for (const [file, lang] of cases) {
        test(`${file} has no Error-severity diagnostics`, () => {
            const text = fs.readFileSync(path.join(root, file), 'utf8');
            const diags = run(lang, text);
            const errors = diags.filter((d) => d.severity === 'error');
            assert.strictEqual(
                errors.length, 0,
                `false positives in ${file}: ${JSON.stringify(errors.map((e) => ({ code: e.code, msg: e.message })))}`,
            );
        });
    }
});
