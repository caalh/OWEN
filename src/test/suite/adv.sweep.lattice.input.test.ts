// Adversarial tests: sweepCore, latticeCodegen, inputBuilder.
import * as assert from 'assert';
import {
    cartesian,
    applyParameters,
    runDirName,
    buildSummaryTsv,
    buildManifest,
    parseKeff,
    SweepParameter,
    RunRecord,
} from '../../workflows/sweepCore';
import {
    genMCNP, genOpenMC, genSerpent, genSCONE,
    defaultPinTypes, defaultStructuralIds, LatticeSpec,
} from '../../panels/latticeCodegen';
import { buildDeck, DEFAULT_SETTINGS, InputBuilderState } from '../../inputBuilder/deckBuilder';
import { MATERIAL_LIBRARY, renderMaterial, SelectedMaterial } from '../../inputBuilder/materials';

suite('ADV sweep core', () => {
    test('zero parameters → exactly one (empty) run', () => {
        assert.deepStrictEqual(cartesian([]), [{}]);
    });

    test('parameter with zero values → zero runs (not a crash)', () => {
        const combos = cartesian([{ name: 'p', values: [], pattern: 'x(\\d+)' }]);
        assert.strictEqual(combos.length, 0);
    });

    test('one run', () => {
        const combos = cartesian([{ name: 'enr', values: [3.1], pattern: 'e=(\\d+\\.\\d+)' }]);
        assert.strictEqual(combos.length, 1);
        assert.strictEqual(combos[0].enr, 3.1);
    });

    test('non-numeric parameter values substitute as strings', () => {
        const schema: SweepParameter[] = [{ name: 'lib', values: ['80c', '81c'], pattern: /92235\.(\d+c)/.source }];
        const text = 'm1 92235.80c 1.0';
        const out = applyParameters(text, { lib: '81c' }, schema);
        assert.strictEqual(out, 'm1 92235.81c 1.0');
    });

    test('pattern not found in deck → text unchanged (silent no-op is a design smell but must not throw)', () => {
        const schema: SweepParameter[] = [{ name: 'x', values: [1], pattern: 'NOT_IN_DECK=(\\d+)' }];
        const text = 'kcode 10000 1.0 50 200';
        const out = applyParameters(text, { x: 42 }, schema);
        assert.strictEqual(out, text);
    });

    test('value containing regex metacharacters does not corrupt substitution', () => {
        const schema: SweepParameter[] = [{ name: 'v', values: ['$&\\1'], pattern: 'val=(\\w+)' }];
        const out = applyParameters('val=old rest', { v: '$&\\1' }, schema);
        assert.ok(out.includes('$&\\1'), `metacharacter mangled: "${out}"`);
    });

    test('repeated group content picks the right occurrence', () => {
        // match.indexOf(group) finds the FIRST occurrence of the group text —
        // adversarial case where prefix equals the group value.
        const schema: SweepParameter[] = [{ name: 'x', values: [9], pattern: '(5) 5' }];
        const out = applyParameters('5 5', { x: 9 }, schema);
        assert.strictEqual(out, '9 5', `wrong slice replaced: "${out}"`);
    });

    test('invalid user regex throws a clear error (documented behavior)', () => {
        const schema: SweepParameter[] = [{ name: 'x', values: [1], pattern: '([' }];
        assert.throws(() => applyParameters('text', { x: 1 }, schema), SyntaxError);
    });

    test('runDirName pads and handles index ≥ 1000', () => {
        assert.strictEqual(runDirName(0), 'run_000');
        assert.strictEqual(runDirName(999), 'run_999');
        assert.strictEqual(runDirName(1234), 'run_1234');
    });

    test('summary TSV with zero runs is just the header', () => {
        const tsv = buildSummaryTsv([], []);
        assert.strictEqual(tsv, 'index\texit\tkeff');
    });

    test('summary TSV renders n/a for null keff and exit', () => {
        const rec: RunRecord = {
            index: 0, parameters: { p: 'a b' }, inputFile: 'C:\\dir with spaces\\in.i',
            outputDir: 'C:\\dir with spaces\\run_000', keff: null, exitCode: null, stdoutPath: 'x',
        };
        const tsv = buildSummaryTsv([{ name: 'p', values: ['a b'], pattern: '(x)' }], [rec]);
        assert.ok(tsv.includes('n/a\tn/a'));
        const manifest = buildManifest(rec.inputFile, 'mcnp', [], [rec]);
        assert.ok(JSON.stringify(manifest).includes('dir with spaces'));
    });

    test('parseKeff scrapers: serpent long-form, openmc, generic, absent', () => {
        assert.strictEqual(
            parseKeff('final estimated combined collision/absorption/track-length keff = 1.00512'),
            1.00512,
        );
        assert.strictEqual(parseKeff('Combined k-effective = 0.99870 +/- 0.00080'), 0.99870);
        assert.strictEqual(parseKeff('k-eff = 1.12345'), 1.12345);
        assert.strictEqual(parseKeff('no keff here'), null);
        assert.strictEqual(parseKeff(''), null);
    });
});

function mkSpec(gridSize: number, fill = 1): LatticeSpec {
    const grid: number[][] = [];
    for (let r = 0; r < gridSize; r++) grid.push(new Array(gridSize).fill(fill));
    return { gridSize, pitch: 1.26, grid, pins: defaultPinTypes(), structural: defaultStructuralIds() };
}

suite('ADV lattice codegen', () => {
    test('1x1 lattice: all four languages emit syntactically plausible output', () => {
        const spec = mkSpec(1);
        const mcnp = genMCNP(spec);
        assert.ok(/fill=0:0 0:0 0:0/.test(mcnp) || /fill=-0:0/.test(mcnp), `1x1 MCNP fill range: ${mcnp.split('\n')[2]}`);
        assert.ok(/lat=1/.test(mcnp));
        const openmc = genOpenMC(spec);
        assert.ok(/RectLattice/.test(openmc) && /universes = \[/.test(openmc));
        const serpent = genSerpent(spec);
        assert.ok(/^lat 100 1/m.test(serpent));
        const scone = genSCONE(spec);
        assert.ok(/type latUniverse/.test(scone) && /shape \(1 1 1\)/.test(scone));
    });

    test('50x50 lattice: row counts and fill entries match', () => {
        const spec = mkSpec(50);
        const mcnp = genMCNP(spec);
        // Even grid: range must be -25:24.
        assert.ok(mcnp.includes('fill=-25:24 -25:24 0:0'), 'even-grid fill range wrong');
        const rows = mcnp.split('\n').filter((l) => /^ {4}[\d ]+$/.test(l));
        assert.strictEqual(rows.length, 50, `MCNP rows: ${rows.length}`);
        const serpent = genSerpent(spec);
        const sRows = serpent.split('\n').slice(2);
        assert.strictEqual(sRows.length, 50);
        assert.ok(sRows.every((r) => r.trim().split(/\s+/).length === 50));
        const scone = genSCONE(spec);
        assert.ok(scone.includes('shape (50 50 1)'));
    });

    test('odd grid (17) uses symmetric -8:8 range', () => {
        const mcnp = genMCNP(mkSpec(17));
        assert.ok(mcnp.includes('fill=-8:8 -8:8 0:0'), 'odd-grid fill range wrong');
    });

    test('unknown palette id in grid falls back without throwing', () => {
        const spec = mkSpec(2, 42); // id 42 has no pin type
        const mcnp = genMCNP(spec);
        assert.ok(mcnp.includes('42'), 'unknown id dropped silently');
        const openmc = genOpenMC(spec);
        assert.ok(openmc.includes('type_42'));
        const serpent = genSerpent(spec);
        assert.ok(serpent.includes('U42'));
        const scone = genSCONE(spec);
        assert.ok(scone.includes('42'));
    });

    test('SCONE output declares pinUniverse stubs only for painted types', () => {
        const spec = mkSpec(3, 1);
        spec.grid[1][1] = 2; // paint one guide tube
        const scone = genSCONE(spec);
        assert.ok(scone.includes('fuelPin {'));
        assert.ok(scone.includes('guideTube {'));
        assert.ok(!scone.includes('instrTube {'), 'unused pin type emitted');
    });

    test('SCONE radii/fills stub lengths match (validator cross-check)', () => {
        for (const p of defaultPinTypes()) {
            const radii = p.sconeRadii.trim().split(/\s+/);
            const fills = p.sconeFills.trim().split(/\s+/);
            assert.strictEqual(radii.length, fills.length, `${p.label}: radii ${radii.length} vs fills ${fills.length}`);
            assert.strictEqual(radii[radii.length - 1], '0.0', `${p.label}: outermost radius must be 0.0`);
        }
    });

    test('zero-size grid does not throw', () => {
        const spec: LatticeSpec = { gridSize: 0, pitch: 1.26, grid: [], pins: defaultPinTypes(), structural: defaultStructuralIds() };
        for (const fn of [genMCNP, genOpenMC, genSerpent, genSCONE]) {
            const out = fn(spec);
            assert.ok(typeof out === 'string');
        }
    });

    test('non-square pitch value (very small / huge) formats sanely', () => {
        for (const pitch of [0.0001, 100000]) {
            const spec = mkSpec(2);
            spec.pitch = pitch;
            const mcnp = genMCNP(spec);
            assert.ok(!/NaN|Infinity/.test(mcnp), `bad number formatting at pitch=${pitch}`);
        }
    });
});

suite('ADV input builder', () => {
    const water = { ...MATERIAL_LIBRARY.find((m) => m.id === 'light-water')!, mcnpNumber: 3 } as SelectedMaterial;
    const fuel = { ...MATERIAL_LIBRARY.find((m) => m.id === 'uo2-3pct')!, mcnpNumber: 1 } as SelectedMaterial;
    const zirc = { ...MATERIAL_LIBRARY.find((m) => m.id === 'zirc4')!, mcnpNumber: 2 } as SelectedMaterial;

    function state(code: InputBuilderState['code'], mats: SelectedMaterial[], mode: 'pin-cell' | 'lattice' = 'pin-cell'): InputBuilderState {
        return {
            code, title: 'adv test', materials: mats,
            geometryMode: mode,
            lattice: mode === 'lattice' ? mkSpec(3) : null,
            settings: DEFAULT_SETTINGS,
        };
    }

    test('all four codes build pin-cell decks with standard materials', () => {
        for (const code of ['mcnp', 'openmc', 'serpent', 'scone'] as const) {
            const deck = buildDeck(state(code, [fuel, zirc, water]));
            assert.ok(deck.length > 100, `${code} deck too short`);
            assert.ok(!/NaN|undefined/.test(deck), `${code} deck contains NaN/undefined:\n${deck}`);
        }
    });

    test('all four codes build lattice decks', () => {
        for (const code of ['mcnp', 'openmc', 'serpent', 'scone'] as const) {
            const deck = buildDeck(state(code, [fuel, zirc, water], 'lattice'));
            assert.ok(!/NaN|undefined/.test(deck), `${code} lattice deck contains NaN/undefined`);
        }
    });

    test('empty material list does not produce undefined variables', () => {
        for (const code of ['mcnp', 'openmc', 'serpent', 'scone'] as const) {
            const deck = buildDeck(state(code, []));
            assert.ok(!/\bundefined\b/.test(deck), `${code}: undefined in deck with no materials:\n${deck}`);
        }
    });

    test('weird material combo: only helium (no fuel, no water)', () => {
        const helium = { ...MATERIAL_LIBRARY.find((m) => m.id === 'helium')!, mcnpNumber: 9 } as SelectedMaterial;
        for (const code of ['mcnp', 'openmc', 'serpent', 'scone'] as const) {
            const deck = buildDeck(state(code, [helium]));
            assert.ok(!/\bundefined\b|NaN/.test(deck), `${code}: bad tokens with helium-only:\n${deck}`);
        }
    });

    test('every library material renders in every code without placeholder tokens leaking', () => {
        for (const entry of MATERIAL_LIBRARY) {
            const sel = { ...entry, mcnpNumber: 7 } as SelectedMaterial;
            for (const code of ['mcnp', 'openmc', 'serpent', 'scone'] as const) {
                const out = renderMaterial(code, sel);
                assert.ok(out.length > 0, `${code}/${entry.id} empty`);
                assert.ok(!/undefined|NaN/.test(out), `${code}/${entry.id}: ${out}`);
            }
        }
    });

    test('MCNP water material includes mt card; UO2 does not', () => {
        const w = renderMaterial('mcnp', water);
        assert.ok(/mt\d+\s+lwtr/.test(w), 'water missing lwtr S(α,β)');
        const f = renderMaterial('mcnp', fuel);
        assert.ok(!/mt\d+/.test(f), 'fuel wrongly has mt card');
    });

    test('customName with quotes/backslashes does not break generated python', () => {
        const evil = { ...fuel, customName: 'evil\') import os #' } as SelectedMaterial;
        const py = renderMaterial('openmc', evil);
        // Material name lands inside single quotes; a raw single quote in the
        // custom name would produce a syntax error in the generated deck.
        const openQuotes = (py.match(/'/g) ?? []).length;
        assert.strictEqual(openQuotes % 2, 0, `unbalanced quotes in generated python:\n${py}`);
    });

    test('mcnpNumber collisions produce duplicate m-cards (documented hazard, must not crash)', () => {
        const a = { ...fuel, mcnpNumber: 1 } as SelectedMaterial;
        const b = { ...zirc, mcnpNumber: 1 } as SelectedMaterial;
        const deck = buildDeck(state('mcnp', [a, b]));
        assert.ok(typeof deck === 'string');
    });
});
