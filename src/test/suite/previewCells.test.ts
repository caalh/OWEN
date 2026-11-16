import * as assert from 'assert';
import { buildScene } from '../../preview/extractor';
import { GeometryScene } from '../../preview/types';

function cellIds(sc: GeometryScene): string[] {
    return sc.cells.map((c) => c.id);
}

function assertSummaryConsistent(sc: GeometryScene): void {
    const ids = cellIds(sc);
    assert.strictEqual(new Set(ids).size, ids.length, `duplicate cell rows: ${ids.join(', ')}`);
    for (const c of sc.cells) {
        const n = sc.cylinders.filter((s) => s.cell === c.id).length;
        assert.strictEqual(c.count, n, `cell ${c.id} summary count ${c.count} != ${n} primitives`);
    }
}

suite('3D preview per-cell provenance', () => {
    test('MCNP lattice: pin layers answer to their own cell numbers and universe', () => {
        const deck = [
            'lattice cells',
            '1 1 -10.4 -1 u=1 imp:n=1',
            '2 2 -6.5 1 -2 u=1 imp:n=1',
            '3 3 -0.7 2 u=1 imp:n=1',
            '20 3 -0.7 -11 12 -13 14 lat=1 u=10 imp:n=1',
            '     fill=-1:1 -1:1 0:0 1 1 1 1 1 1 1 1 1',
            '30 0 -21 22 -23 24 -25 26 fill=10 imp:n=1',
            '99 0 21:-22:23:-24:25:-26 imp:n=0',
            '',
            '1 cz 0.41',
            '2 cz 0.475',
            '11 px 0.63',
            '12 px -0.63',
            '13 py 0.63',
            '14 py -0.63',
            '21 px 1.89',
            '22 px -1.89',
            '23 py 1.89',
            '24 py -1.89',
            '25 pz 50',
            '26 pz -50',
            '',
            'm1 92235.80c 0.03 92238.80c 0.97',
            'm2 40000.66c 1',
            'm3 1001.80c 2 8016.80c 1',
        ].join('\n');
        const sc = buildScene(deck, 'mcnp');
        const ids = cellIds(sc);
        assert.ok(ids.includes('1') && ids.includes('2'), `fuel and clad cells present: ${ids.join(', ')}`);
        assert.ok(!ids.includes('99'), 'the graveyard is not drawn, so it is not listed');
        const fuel = sc.cells.find((c) => c.id === '1')!;
        assert.strictEqual(fuel.universe, '1');
        assert.strictEqual(fuel.count, 9, 'one fuel primitive per lattice element');
        assertSummaryConsistent(sc);
    });

    test('MCNP non-lattice deck (exact CSG path): the sphere is cell 1', () => {
        const deck = [
            'godiva',
            '1 1 -18.74 -1 imp:n=1',
            '2 0 1 imp:n=0',
            '',
            '1 so 8.7407',
            '',
            'm1 92235.80c 0.9473 92238.80c 0.0527',
            'kcode 5000 1.0 50 250',
            'ksrc 0 0 0',
        ].join('\n');
        const sc = buildScene(deck, 'mcnp');
        assert.deepStrictEqual(cellIds(sc), ['1']);
        assert.strictEqual(sc.cells[0].universe, undefined, 'the root universe is not shown');
        assertSummaryConsistent(sc);
    });

    test('Serpent pin rings are named by pin and material', () => {
        const deck = [
            'pin fp',
            'fuel  0.41',
            'clad  0.475',
            'water',
            'lat asm 1 0.0 0.0 2 2 1.26',
            'fp fp',
            'fp fp',
            'surf 1 cyl 0.0 0.0 100',
            'cell 99 0 fill asm -1',
            'mat fuel -10.4 92235.09c 0.03 92238.09c 0.97',
            'mat clad -6.5 40090.09c 1.0',
            'mat water -0.7 1001.06c 2 8016.06c 1',
        ].join('\n');
        const sc = buildScene(deck, 'serpent');
        const ids = cellIds(sc);
        assert.ok(ids.includes('pin fp [fuel]') && ids.includes('pin fp [clad]'), ids.join(', '));
        assert.strictEqual(sc.cells.find((c) => c.id === 'pin fp [fuel]')!.count, 4);
        assertSummaryConsistent(sc);
    });

    test('Serpent cell-built universes keep the cell names', () => {
        const deck = [
            'surf 1 cyl 0 0 0.41',
            'surf 2 cyl 0 0 0.475',
            'cell c1 u1 fuel -1',
            'cell c2 u1 clad 1 -2',
            'cell c3 u1 water 2',
            'lat L 1 0.0 0.0 2 2 1.26',
            'u1 u1',
            'u1 u1',
            'surf 9 cuboid -1.26 1.26 -1.26 1.26 -50 50',
            'cell root 0 fill L -9',
            'cell out 0 outside 9',
            'mat fuel -10.4 92235.09c 0.03 92238.09c 0.97',
            'mat clad -6.5 40090.09c 1.0',
            'mat water -0.7 1001.06c 2 8016.06c 1',
        ].join('\n');
        const sc = buildScene(deck, 'serpent');
        const ids = cellIds(sc);
        assert.ok(ids.includes('c1') && ids.includes('c2'), ids.join(', '));
        assert.strictEqual(sc.cells.find((c) => c.id === 'c1')!.universe, 'u1');
        assertSummaryConsistent(sc);
    });

    test('SCONE pinUniverse rings are named by block and material', () => {
        const deck = [
            'geometry {',
            '  type geometryStd;',
            '  boundary (0 0 0 0 0 0);',
            '  graph { type shrunk; }',
            '  surfaces {',
            '    squareBound { id 1; type box; origin (0.0 0.0 0.0); halfwidth (1.26 1.26 50.0); }',
            '  }',
            '  cells { }',
            '  universes {',
            '    root { id 1; type rootUniverse; border 1; fill u<2>; }',
            '    lattice { id 2; type latUniverse; shape (2 2 1); pitch (1.26 1.26 0.0); origin (0.0 0.0 0.0);',
            '      padMat water; map ( 3 3 3 3 ); }',
            '    pin { id 3; type pinUniverse; radii (0.41 0.475 0.0); fills (fuel clad water); }',
            '  }',
            '}',
        ].join('\n');
        const sc = buildScene(deck, 'scone');
        const ids = cellIds(sc);
        assert.ok(ids.includes('pin [fuel]') && ids.includes('pin [clad]'), ids.join(', '));
        assert.strictEqual(sc.cells.find((c) => c.id === 'pin [fuel]')!.universe, '3');
        assertSummaryConsistent(sc);
    });

    test('OpenMC lattice pins answer to the universe identifier in the map', () => {
        const deck = [
            'import openmc',
            'import numpy as np',
            'fuel_pin = openmc.Universe()',
            'guide_tube = openmc.Universe()',
            'arr = np.full((17, 17), fuel_pin)',
            'arr[8, 8] = guide_tube',
            'lat = openmc.RectLattice()',
            'lat.pitch = (1.26, 1.26)',
            'lat.universes = arr',
        ].join('\n');
        const sc = buildScene(deck, 'openmc');
        const ids = cellIds(sc);
        assert.ok(ids.some((id) => id.startsWith('fuel_pin [')), ids.join(', '));
        assert.ok(ids.some((id) => id.startsWith('guide_tube [')), ids.join(', '));
        assert.ok(sc.cells.every((c) => c.universe === c.id.split(' [')[0]), 'universe matches the map identifier');
        assertSummaryConsistent(sc);
    });
});
