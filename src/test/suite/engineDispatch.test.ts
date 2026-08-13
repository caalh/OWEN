/**
 * Stage-6 engine parity tests: Serpent and SCONE decks mapped onto the shared
 * exact-geometry model, classified by the same findCell/sliceModel the MCNP
 * path uses. Decks mirror the site's audited tutorial idioms (surf/cell/pin/
 * lat cards for Serpent; the SCONE dictionary with rootUniverse / pinUniverse
 * / latUniverse blocks, as in scone-examples/scone_beavrs_clean.inp).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { parseDeckToModel, sliceSupportNote } from '../../preview/engineDispatch';
import { findCell } from '../../preview/mcnpEvaluate';
import { axisPlane, sliceModel } from '../../preview/slice';

type V3 = [number, number, number];

function materialAt(model: NonNullable<ReturnType<typeof parseDeckToModel>>, p: V3): number | null {
    const f = findCell(model, p);
    return f.cell ? f.cell.material : null;
}

suite('Exact engine — Serpent decks (Stage 6)', () => {
    const PIN = [
        '% serpent pin cell',
        'surf s1 cyl 0.0 0.0 0.41',
        'surf s2 cyl 0.0 0.0 0.48',
        'surf s99 cyl 0.0 0.0 50.0',
        'cell c1 0 fuel -s1',
        'cell c2 0 clad s1 -s2',
        'cell c3 0 water s2 -s99',
        'cell c99 0 outside s99',
        'mat fuel -10.4',
        'mat clad -6.5',
        'mat water -1.0',
    ].join('\n');

    test('surf/cell pin: rings classify correctly', () => {
        const model = parseDeckToModel(PIN, 'serpent');
        assert.ok(model, 'serpent deck should parse');
        const fuel = materialAt(model!, [0, 0, 0]);
        const clad = materialAt(model!, [0.45, 0, 0]);
        const water = materialAt(model!, [1.0, 0, 0]);
        assert.notStrictEqual(fuel, null);
        assert.notStrictEqual(clad, null);
        assert.notStrictEqual(water, null);
        assert.ok(fuel !== clad && clad !== water && fuel !== water, 'three distinct materials');
        const outside = findCell(model!, [60, 0, 0]);
        assert.ok(outside.cell, 'outside cell claims far points');
        assert.strictEqual(outside.cell!.material, 0);
    });

    test('pin cards + lat card expand through the shared lattice math', () => {
        const deck = [
            'pin 1',
            'fuel 0.40',
            'clad 0.46',
            'water',
            'pin 2',
            'water 0.56',
            'clad 0.60',
            'water',
            'lat 10 1 0.0 0.0 3 3 1.26',
            '2 1 2',
            '1 1 1',
            '2 1 2',
            'surf s99 cyl 0.0 0.0 10.0',
            'cell cfill 0 fill 10 -s99',
            'cell cout 0 outside s99',
            'mat fuel -10.4',
            'mat clad -6.5',
            'mat water -1.0',
        ].join('\n');
        const model = parseDeckToModel(deck, 'serpent');
        assert.ok(model);
        // Center element is pin 1 → fuel at the center.
        const center = findCell(model!, [0, 0, 0]);
        assert.ok(center.cell);
        const fuelMat = center.cell!.material;
        // North neighbor (0, 1.26) is also pin 1.
        assert.strictEqual(materialAt(model!, [0, 1.26, 0]), fuelMat);
        // Corner elements are guide tubes (pin 2): water at their centers.
        const cornerMat = materialAt(model!, [1.26, 1.26, 0]);
        assert.notStrictEqual(cornerMat, fuelMat, 'corner is the guide-tube pin');
        // Radially outside the pin inside element (0,0): water.
        assert.notStrictEqual(materialAt(model!, [0.55, 0, 0]), fuelMat);
    });

    test('slice classification tiles a Serpent lattice without lost pixels', () => {
        const deck = [
            'pin 1',
            'fuel 0.40',
            'water',
            'lat 10 1 0.0 0.0 3 3 1.26',
            '1 1 1',
            '1 1 1',
            '1 1 1',
            'surf box sqc 0.0 0.0 1.89',
            'cell cfill 0 fill 10 -box',
            'cell cout 0 outside box',
            'mat fuel -10.4',
            'mat water -1.0',
        ].join('\n');
        const model = parseDeckToModel(deck, 'serpent');
        assert.ok(model);
        const res = sliceModel(model!, {
            plane: axisPlane('xy', 0), halfU: 1.8, halfV: 1.8,
            width: 96, height: 96, colorBy: 'material',
        });
        assert.strictEqual(res.lostCount, 0, `lost pixels: ${res.lostCount}`);
        assert.strictEqual(res.overlapCount, 0);
        assert.ok(res.legend.length >= 2, 'fuel and water in the legend');
    });

    test('hex lattice (type 2) resolves center and ring-1 neighbors', () => {
        const deck = [
            'pin 1',
            'fuel 0.40',
            'water',
            'lat 20 2 0.0 0.0 3 3 1.26',
            '1 1 1',
            '1 1 1',
            '1 1 1',
            'surf s99 cyl 0.0 0.0 10.0',
            'cell cfill 0 fill 20 -s99',
            'cell cout 0 outside s99',
            'mat fuel -10.4',
            'mat water -1.0',
        ].join('\n');
        const model = parseDeckToModel(deck, 'serpent');
        assert.ok(model);
        const center = findCell(model!, [0, 0, 0]);
        assert.ok(center.cell, 'hex center resolves');
        // One flat-to-flat pitch along +x lands in the ring-1 element's pin.
        const nb = findCell(model!, [1.26, 0, 0]);
        assert.ok(nb.cell, 'hex neighbor resolves');
        assert.strictEqual(nb.cell!.material, center.cell!.material);
    });
});

suite('Exact engine — SCONE decks (Stage 6)', () => {
    const PIN = [
        'type eigenPhysicsPackage;',
        'geometry {',
        '  type geometryStd;',
        '  boundary (0 0 0 0 0 0);',
        '  graph { type shrunk; }',
        '  surfaces {',
        '    boundary { id 1; type zCylinder; origin (0.0 0.0 0.0); radius 50.0; }',
        '  }',
        '  cells { }',
        '  universes {',
        '    root { id 1; type rootUniverse; border 1; fill u<2>; }',
        '    pin { id 2; type pinUniverse;',
        '      radii (0.41 0.48 0.0);',
        '      fills (fuel clad water); }',
        '  }',
        '}',
    ].join('\n');

    test('rootUniverse + pinUniverse classify concentric rings', () => {
        const model = parseDeckToModel(PIN, 'scone');
        assert.ok(model, 'scone deck should parse');
        const fuel = materialAt(model!, [0, 0, 0]);
        const clad = materialAt(model!, [0.45, 0, 0]);
        const water = materialAt(model!, [1.0, 0, 0]);
        assert.ok(fuel !== null && clad !== null && water !== null);
        assert.ok(fuel !== clad && clad !== water, 'distinct ring materials');
        const outside = findCell(model!, [60, 0, 0]);
        assert.ok(outside.cell, 'outside the border is the graveyard cell');
        assert.strictEqual(outside.cell!.material, 0);
    });

    test('latUniverse map (north→south rows) lands pins on the right elements', () => {
        const deck = [
            'geometry {',
            '  type geometryStd;',
            '  boundary (0 0 0 0 0 0);',
            '  surfaces {',
            '    boundary { id 1; type zCylinder; origin (0.0 0.0 0.0); radius 10.0; }',
            '  }',
            '  cells { }',
            '  universes {',
            '    root { id 1; type rootUniverse; border 1; fill u<5>; }',
            '    pinF { id 100; type pinUniverse; radii (0.40 0.0); fills (fuel water); }',
            '    pinG { id 200; type pinUniverse; radii (0.56 0.0); fills (water clad); }',
            '    lat { id 5; type latUniverse; origin (0.0 0.0 0.0);',
            '      pitch (1.26 1.26 0.0); shape (3 3 0); padMat water; map (',
            '        200 100 200',
            '        100 100 100',
            '        200 100 200 ); }',
            '  }',
            '}',
        ].join('\n');
        const model = parseDeckToModel(deck, 'scone');
        assert.ok(model);
        const center = findCell(model!, [0, 0, 0]);
        assert.ok(center.cell, 'lattice center resolves');
        const fuelMat = center.cell!.material;
        // Element-local coordinates must be respected: radially outside the
        // 0.40 pin radius, still inside the center element, is water.
        const centerWater = materialAt(model!, [0.5, 0, 0]);
        assert.notStrictEqual(centerWater, fuelMat, 'pin surface honored inside the element');
        // Corners are the guide-tube pin: water at the pin center there.
        const cornerCenter = materialAt(model!, [1.26, 1.26, 0]);
        assert.strictEqual(cornerCenter, centerWater, 'guide-tube center is water');
        // North element (row above center) is fuel per the map.
        assert.strictEqual(materialAt(model!, [0, 1.26, 0]), fuelMat);
    });

    test('BEAVRS clean input parses and finds vessel-scale structure', function () {
        // Uses the repo's own mirrored deck when present (monorepo layout);
        // skipped silently otherwise — the two synthetic decks above cover
        // the grammar.
        const candidates = [
            path.join(__dirname, '..', '..', '..', '..', 'scone-examples', 'scone_beavrs_clean.inp'),
        ];
        const hit = candidates.find((c) => fs.existsSync(c));
        if (!hit) { this.skip(); return; }
        const model = parseDeckToModel(fs.readFileSync(hit, 'utf8'), 'scone');
        assert.ok(model);
        assert.ok(model!.cells.size > 50, `expected many cells, got ${model!.cells.size}`);
        const rpv = findCell(model!, [220, 0, 100]);
        assert.ok(rpv.cell, 'a point in the RPV wall resolves');
    });
});

suite('Exact engine — dispatch notes', () => {
    test('openmc decks get the native-render pointer', () => {
        assert.ok(/Render with OpenMC/.test(sliceSupportNote('openmc')));
        assert.strictEqual(parseDeckToModel('import openmc', 'openmc'), null);
    });
});
