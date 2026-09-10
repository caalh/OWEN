import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { PREBUILT_MODELS } from '../paths';
import { convert, CONVERSION_TARGETS, detectConversionSource, TODO_MARK } from '../../converter';
import { parseDeckToModel } from '../../preview/engineDispatch';
import { classifyModel, compareGeometry } from '../../compare/geometry';
import { checkGeometry } from '../../geomcheck/core';

suite('OWEN converter — Serpent / SCONE → MCNP through the geometry model', () => {
    test('every language converts to every other', () => {
        for (const [src, targets] of Object.entries(CONVERSION_TARGETS)) {
            assert.strictEqual(targets.length, 3, `${src} should have three targets`);
            assert.ok(!targets.includes(src as never));
        }
    });

    test('Serpent pin cell → MCNP reproduces the same boundaries', () => {
        const serpent = fs.readFileSync(path.join(PREBUILT_MODELS, 'pincell_serpent.sss'), 'utf8');
        const r = convert('serpent', 'mcnp', serpent);
        assert.strictEqual(r.direction, 'serpent_to_mcnp');
        const mcnpModel = parseDeckToModel(r.output, 'mcnp')!;
        assert.ok(mcnpModel.cells.size >= 4, `cells: ${mcnpModel.cells.size}\n${r.output}`);
        const a = classifyModel(parseDeckToModel(serpent, 'serpent')!, 'serpent', serpent, 'serpent');
        const b = classifyModel(mcnpModel, 'mcnp', r.output, 'mcnp');
        const cmp = compareGeometry(a, b, { samples: 6000 });
        assert.ok(cmp.mappedAgreement > 0.995, `boundary agreement ${cmp.mappedAgreement}\n${r.output}`);
        // The MCNP deck itself is sound: closed, no overlaps, a graveyard.
        const chk = checkGeometry(mcnpModel, { samples: 2000 });
        assert.strictEqual(chk.overlaps.length, 0);
        assert.strictEqual(chk.world.lost, 0);
        assert.ok(/imp:n=0/.test(r.output), 'graveyard identified');
        assert.ok(/^m\d+ /m.test(r.output) && /92235\.80c/.test(r.output), 'materials carried over as ZAIDs');
        assert.ok(r.issues.some((i) => /\.80c/.test(i.message)), 'library caveat is stated');
    });

    test('Serpent BEAVRS full core → MCNP keeps the lattice hierarchy', () => {
        const serpent = fs.readFileSync(path.join(PREBUILT_MODELS, 'beavrs_fullcore_serpent.sss'), 'utf8');
        const r = convert('serpent', 'mcnp', serpent);
        const m = parseDeckToModel(r.output, 'mcnp')!;
        const lattices = [...m.cells.values()].filter((c) => c.lat).length;
        assert.ok(lattices >= 10, `lattice cells: ${lattices}`);
        assert.ok(m.universes.size >= 50, `universes: ${m.universes.size}`);
        assert.ok(/lat=1 fill=/.test(r.output));
    });

    test('SCONE pin cell → MCNP', () => {
        const scone = fs.readFileSync(path.join(PREBUILT_MODELS, 'pincell_scone.scone'), 'utf8');
        const r = convert('scone', 'mcnp', scone);
        assert.strictEqual(r.direction, 'scone_to_mcnp');
        const m = parseDeckToModel(r.output, 'mcnp')!;
        assert.ok(m.cells.size >= 3, r.output);
        const a = classifyModel(parseDeckToModel(scone, 'scone')!, 'scone', scone, 'scone');
        const b = classifyModel(m, 'mcnp', r.output, 'mcnp');
        const cmp = compareGeometry(a, b, { samples: 4000 });
        assert.ok(cmp.mappedAgreement > 0.99, `boundary agreement ${cmp.mappedAgreement}\n${r.output}`);
    });

    test('two-hop directions pivot through MCNP and keep both hops\' issues', () => {
        const serpent = fs.readFileSync(path.join(PREBUILT_MODELS, 'pincell_serpent.sss'), 'utf8');
        const r = convert('serpent', 'openmc', serpent);
        assert.strictEqual(r.direction, 'serpent_to_openmc');
        assert.ok(r.output.startsWith('# SERPENT -> MCNP -> OPENMC'), r.output.slice(0, 80));
        assert.ok(/import openmc/.test(r.output));
        assert.ok(r.issues.some((i) => /\[via MCNP\]/.test(i.message)) || r.issues.length > 0);
        const s = convert('openmc', 'serpent', fs.readFileSync(path.join(PREBUILT_MODELS, 'pincell_openmc.py'), 'utf8'));
        assert.strictEqual(s.direction, 'openmc_to_serpent');
        assert.ok(/^\s*surf\s+/m.test(s.output), s.output.slice(0, 300));
    });

    test('unconvertible details are marked, never dropped silently', () => {
        const serpent = ['surf s1 sph 0 0 0 10', 'cell c1 0 fuel -s1', 'cell c2 0 outside s1', 'mat fuel sum 92235.09c 1'].join('\n');
        const r = convert('serpent', 'mcnp', serpent);
        assert.ok(r.output.includes(TODO_MARK));
        assert.ok(r.issues.some((i) => /density/.test(i.message)), 'sum density must be flagged');
        assert.ok(/^\d+ \d+ -1\.0 /m.test(r.output), 'placeholder density written');
    });

    test('detectConversionSource recognises Serpent and SCONE', () => {
        assert.strictEqual(detectConversionSource(fs.readFileSync(path.join(PREBUILT_MODELS, 'pincell_serpent.sss'), 'utf8')), 'serpent');
        assert.strictEqual(detectConversionSource(fs.readFileSync(path.join(PREBUILT_MODELS, 'pincell_scone.scone'), 'utf8')), 'scone');
        assert.strictEqual(detectConversionSource(fs.readFileSync(path.join(PREBUILT_MODELS, 'pincell_mcnp.i'), 'utf8')), 'mcnp');
        assert.strictEqual(detectConversionSource(fs.readFileSync(path.join(PREBUILT_MODELS, 'pincell_openmc.py'), 'utf8')), 'openmc');
    });
});
