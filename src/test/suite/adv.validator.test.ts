// Adversarial tests: validation rules (src/language/rules.ts — the shared
// pure rules layer used by both the LSP server and the manual validate
// command). Each rule is driven to fire; the bundled prebuilt decks must stay
// clean of Error-severity findings (no false positives).
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { runLanguageRules } from '../../language/rules';
import type { RulesLanguage } from '../../language/types';

const run = (lang: RulesLanguage, text: string) => runLanguageRules(lang, text);
const codes = (diags: { code?: string }[]) => diags.map((d) => String(d.code));

suite('ADV validator — MCNP', () => {
    test('mt on hydrogen-free fuel fires mcnp.sab-no-h', () => {
        const text = 'm7 92235.80c 0.04 92238.80c 0.96 8016.80c 2.0\nmt7 lwtr.20t';
        assert.ok(codes(run('mcnp', text)).includes('mcnp.sab-no-h'));
    });

    test('mt referencing undefined material fires mcnp.mt-missing-material', () => {
        const text = 'mt42 lwtr.20t';
        assert.ok(codes(run('mcnp', text)).includes('mcnp.mt-missing-material'));
    });

    test('mt on water (has H) does NOT fire', () => {
        const text = 'm3 1001.80c 2 8016.80c 1\nmt3 lwtr.20t';
        const c = codes(run('mcnp', text));
        assert.ok(!c.includes('mcnp.sab-no-h'), `false positive: ${c}`);
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

    test('HEX and CYL macrobodies fire errors', () => {
        assert.ok(codes(run('mcnp', '10 hex 0 0 0 5 0 0 0 0 10')).includes('mcnp.macrobody'));
        assert.ok(codes(run('mcnp', '10 cyl 0 0 0 5')).includes('mcnp.macrobody'));
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

    test('cell missing imp:n fires mcnp.cell-imp; continuation imp is honored', () => {
        const bad = '10 1 -10.4 -1';
        assert.ok(codes(run('mcnp', bad)).includes('mcnp.cell-imp'));
        const good = '10 1 -10.4 -1\n        imp:n=1';
        const c = codes(run('mcnp', good));
        assert.ok(!c.includes('mcnp.cell-imp'), `continuation imp missed: ${c}`);
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

    test('Material(temperature=...) fires', () => {
        assert.ok(codes(run('openmc', 'f = openmc.Material(temperature=600.0)')).includes('openmc.mat-temperature'));
    });

    test('cell.temperature assignment does NOT fire', () => {
        const c = codes(run('openmc', 'cell.temperature = 600.0'));
        assert.ok(!c.includes('openmc.mat-temperature'), `false positive: ${c}`);
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
    const root = path.resolve(__dirname, '../../../prebuilt-models');
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
