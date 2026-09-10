import * as assert from 'assert';
import { parseDeckToModel } from '../../preview/engineDispatch';
import { findCell } from '../../preview/mcnpEvaluate';
import { buildScene } from '../../preview/extractor';

// Serpent lists lattice rows BOTTOM first: "the first Nx values create the
// bottommost (minimum y) row" (serpent.vtt.fi/docs, lat card). SCONE and
// OpenMC are the other way round (top row first). The parser assumed the
// SCONE order until Sep 2026 and so drew every Serpent core upside down —
// and hid that the bundled BEAVRS Serpent deck was written upside down too.

const DECK = [
    '% 1 x 2 lattice: pin "lo" listed first must land at the lower y',
    'surf sOut cuboid -0.63 0.63 -1.26 1.26 -10 10',
    'cell cIn  0 fill lat -sOut',
    'cell cOut 0 outside sOut',
    'lat lat 1 0.0 0.0 1 2 1.26',
    'lo',
    'hi',
    'pin lo',
    'fuel 0.4',
    'water',
    'pin hi',
    'zirc 0.4',
    'water',
    'mat fuel  -10.4 92235.06c 1.0',
    'mat zirc  -6.5  40090.06c 1.0',
    'mat water -0.7  1001.06c 2.0 8016.06c 1.0',
].join('\n');

suite('Serpent lattice row order', () => {
    test('the first listed row is the minimum-y row', () => {
        const model = parseDeckToModel(DECK, 'serpent');
        assert.ok(model, 'model parses');
        const nameOf = (p: [number, number, number]): string => {
            const f = findCell(model!, p);
            assert.ok(f.cell && !f.lost, `point ${p} resolves`);
            return model!.names?.materials.get(f.cell!.material) ?? String(f.cell!.material);
        };
        assert.strictEqual(nameOf([0, -0.63, 0]), 'fuel', 'lower element is the first listed pin ("lo")');
        assert.strictEqual(nameOf([0, 0.63, 0]), 'zirc', 'upper element is the second listed pin ("hi")');
    });

    test('the fast-path scene places the first listed row at the bottom too', () => {
        const scene = buildScene(DECK, 'serpent');
        const fuel = scene.cylinders.filter((c) => /fuel/i.test(c.material ?? '') || c.component === 'fuel');
        assert.ok(fuel.length >= 1, 'fuel pin drawn');
        assert.ok(fuel.every((c) => c.y < 0), `fuel (first row) must sit at negative y, got ${fuel.map((c) => c.y)}`);
    });

    test('an axial-stack column counts as a pin for the detail budget', () => {
        // A column universe (cells with fills stacked in z) is a pin; it used
        // to resolve to its bottom segment's fill before the pin test ran.
        const deck = [
            'surf sOut cuboid -0.63 0.63 -0.63 0.63 -10 10',
            'surf zLo pz -10',
            'surf zMid pz 0',
            'surf zHi pz 10',
            'cell cIn  0 fill lat -sOut',
            'cell cOut 0 outside sOut',
            'lat lat 1 0.0 0.0 1 1 1.26',
            'col',
            'cell cA col fill w  zLo -zMid',
            'cell cB col fill f  zMid -zHi',
            'pin w',
            'water',
            'pin f',
            'fuel 0.4',
            'water',
            'mat fuel  -10.4 92235.06c 1.0',
            'mat water -0.7  1001.06c 2.0 8016.06c 1.0',
        ].join('\n');
        const scene = buildScene(deck, 'serpent');
        assert.strictEqual(scene.fidelity.totalPins, 1, `one pin column, got ${scene.fidelity.totalPins}`);
    });
});
