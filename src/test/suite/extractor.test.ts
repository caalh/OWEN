import * as assert from 'assert';
import { extractCylinders, buildScene } from '../../preview/extractor';

function distinctX(cyls: { x: number }[]): number {
    return new Set(cyls.map((c) => Math.round(c.x * 1000))).size;
}

suite('OWEN preview extractor', () => {
    test('extracts at least one MCNP cz cylinder', () => {
        const deck = [
            'Tiny pin cell',
            '1  1 -10.4 -1  imp:n=1',
            '2  2 -0.998 1  imp:n=1',
            '3  0       2  imp:n=0',
            '',
            '1 cz 0.41',
            '2 cz 0.47',
            '',
            'm1 92235.80c 0.04',
            '   92238.80c 0.96',
            '   8016.80c  2.0',
        ].join('\n');
        const cylinders = extractCylinders(deck, 'mcnp');
        assert.ok(cylinders.length >= 1, `expected at least one cylinder, got ${cylinders.length}`);
        assert.ok(cylinders.some((c) => Math.abs(c.radius - 0.41) < 1e-6),
            'expected a cylinder with radius 0.41');
    });

    test('extracts OpenMC fuel radius from a Python snippet', () => {
        // GROVES `_parse_openmc_python` is a keyword-driven heuristic; it picks up
        // `fuel_or` / `fuel_radius` assignments and produces a 2-layer pin (fuel + clad).
        const deck = [
            'import openmc',
            'fuel_or = openmc.ZCylinder(r=0.40)',
            'm = openmc.Material()',
            'cell = openmc.Cell(region=-fuel_or, fill=m)',
            'model = openmc.Model()',
        ].join('\n');
        const cylinders = extractCylinders(deck, 'openmc');
        assert.ok(cylinders.length >= 1, `expected at least one cylinder, got ${cylinders.length}`);
        assert.ok(cylinders.some((c) => Math.abs(c.radius - 0.40) < 1e-6),
            'expected a cylinder with radius 0.40 (fuel)');
    });

    test('extracts Serpent pin layers from a pin block', () => {
        // GROVES `_parse_serpent` mirrors Serpent `pin <name>` blocks — material
        // followed by an optional radius, terminated by a bare material line.
        // The Python implementation does NOT parse `surf <id> cyl ...` cards; we
        // mirror that behaviour for parity.
        const deck = [
            'pin myPin',
            'fuel 0.40',
            'clad 0.46',
            'water',
            '',
        ].join('\n');
        const cylinders = extractCylinders(deck, 'serpent');
        assert.ok(cylinders.length >= 1, `expected at least one cylinder, got ${cylinders.length}`);
        assert.ok(cylinders.some((c) => Math.abs(c.radius - 0.40) < 1e-6),
            'expected a cylinder with radius 0.40 (fuel layer)');
    });

    test('extracts SCONE pin universe layers', () => {
        // SCONE `pinUniverse` block: trailing 0.0 radius is filtered out, so a
        // (0.4 0.0) radii list yields a single cylinder of radius 0.4.
        const deck = 'fuelPin { id 1; type pinUniverse; radii (0.4 0.0); fills (fuel cool); }';
        const cylinders = extractCylinders(deck, 'scone');
        assert.ok(cylinders.length >= 1, `expected at least one cylinder, got ${cylinders.length}`);
        assert.ok(cylinders.some((c) => Math.abs(c.radius - 0.4) < 1e-6),
            'expected a cylinder with radius 0.4');
    });

    test('returns empty array for unknown languages', () => {
        const cylinders = extractCylinders('whatever', 'fortran-77');
        assert.deepStrictEqual(cylinders, []);
    });

    // --- Lattice expansion (the v0.1.7 overhaul) ---

    test('expands an OpenMC numpy np.full 17x17 lattice (not a single pin)', () => {
        const deck = [
            'import openmc',
            'import numpy as np',
            'fuel_or = openmc.ZCylinder(r=0.4095)',
            'clad_or = openmc.ZCylinder(r=0.4750)',
            'lat = openmc.RectLattice()',
            'lat.pitch = (1.26, 1.26)',
            'lat.lower_left = (-10.71, -10.71)',
            'univ_map = np.full((17, 17), F, dtype=object)',
            'for (i, j) in [(2,5),(5,8),(8,8),(11,11),(14,5)]:',
            '    univ_map[i, j] = G',
            'lat.universes = univ_map.tolist()',
        ].join('\n');
        const cyls = extractCylinders(deck, 'openmc');
        // 17x17 = 289 positions; far more than the old single-pin fallback.
        assert.ok(cyls.length > 200, `expected a full lattice, got ${cyls.length} cylinders`);
        assert.ok(distinctX(cyls) >= 17, `expected ≥17 distinct columns, got ${distinctX(cyls)}`);
        assert.ok(cyls.some((c) => c.component === 'guide_tube'), 'expected guide tubes from the coord-list loop');
    });

    test('expands an OpenMC literal nested-list lattice', () => {
        const deck = [
            'import openmc',
            'fuel_or = openmc.ZCylinder(r=0.41)',
            'clad_or = openmc.ZCylinder(r=0.475)',
            'lat = openmc.RectLattice()',
            'lat.pitch = (1.26, 1.26)',
            'lat.universes = [',
            '  [fuel_pin, fuel_pin, guide_tube],',
            '  [fuel_pin, guide_tube, fuel_pin],',
            '  [guide_tube, fuel_pin, fuel_pin],',
            ']',
        ].join('\n');
        const cyls = extractCylinders(deck, 'openmc');
        assert.strictEqual(distinctX(cyls), 3, 'expected a 3-column lattice');
        assert.ok(cyls.some((c) => c.component === 'guide_tube'));
    });

    test('warns (not silently single-pins) when an OpenMC lattice cannot be expanded', () => {
        const deck = [
            'import openmc',
            'fuel_or = openmc.ZCylinder(r=0.41)',
            'lat = openmc.RectLattice()',
            'lat.universes = make_universes()  # built by a function we cannot evaluate',
        ].join('\n');
        const scene = buildScene(deck, 'openmc');
        assert.ok(scene.warnings.length >= 1, 'expected a warning explaining why only one pin shows');
    });

    test('expands a nested SCONE core lattice (assemblies of pins)', () => {
        const deck = `
geometry {
  surfaces { rpv { id 1; type zCylinder; radius 50.0; } }
  universes {
    pinF { id 10; type pinUniverse; radii (0.4 0.46 0.0); fills (UO2 Zircaloy Water); }
    asm  { id 20; type latUniverse; origin (0 0 0); pitch (1.26 1.26 0); shape (2 2 0); padMat Water; map ( 10 10 10 10 ); }
    core { id 9999; type latUniverse; origin (0 0 0); pitch (2.52 2.52 0); shape (2 2 0); padMat Water; map ( 20 20 20 20 ); }
  }
}`;
        const cyls = extractCylinders(deck, 'scone');
        // 2x2 core × 2x2 assemblies = 16 pins × 2 layers = 32 cylinders (+ vessel).
        const pinCyls = cyls.filter((c) => c.component !== 'vessel');
        assert.strictEqual(pinCyls.length, 32, `expected 32 pin-layer cylinders, got ${pinCyls.length}`);
        assert.strictEqual(distinctX(pinCyls), 4, 'expected 4 pin columns across the nested core');
        assert.ok(cyls.some((c) => c.component === 'vessel'), 'expected a vessel shell from the zCylinder surface');
    });

    // --- MCNP lattice / universe expansion (the v0.1.8 work) ---

    test('expands an MCNP 3x3 square lattice of fuel + guide-tube universes', () => {
        const deck = [
            'MCNP mini 3x3 lattice',
            '1 1 -10.4 -1    u=1 imp:n=1   $ fuel pellet',
            '2 2 -6.5   1 -2 u=1 imp:n=1   $ clad',
            '3 3 -0.7   2    u=1 imp:n=1   $ water',
            '4 3 -0.7  -3    u=2 imp:n=1   $ guide-tube inner water',
            '5 2 -6.5   3 -4 u=2 imp:n=1   $ guide tube',
            '6 3 -0.7   4    u=2 imp:n=1   $ outer water',
            '10 0 50 -51 52 -53 lat=1 u=10 imp:n=1',
            '     fill=0:2 0:2 0:0',
            '     1 2 1',
            '     2 1 2',
            '     1 2 1',
            '20 0 -60 fill=10 imp:n=1',
            '21 0  60 imp:n=0',
            '',
            '1 cz 0.40',
            '2 cz 0.46',
            '3 cz 0.56',
            '4 cz 0.60',
            '50 px -0.63',
            '51 px  0.63',
            '52 py -0.63',
            '53 py  0.63',
            '60 rpp -1.89 1.89 -1.89 1.89 -10 10',
            '',
            'm1 92235.80c 0.04 92238.80c 0.96 8016.80c 2.0',
            'm2 40090.80c 1.0',
            'm3 1001.80c 2.0 8016.80c 1.0',
            'mode n',
        ].join('\n');
        const cyls = extractCylinders(deck, 'mcnp');
        assert.strictEqual(distinctX(cyls), 3, `expected a 3-column lattice, got ${distinctX(cyls)}`);
        assert.strictEqual(cyls.filter((c) => c.component === 'guide_tube').length, 4,
            'expected 4 guide-tube layers (the 4 guide positions)');
        assert.ok(cyls.some((c) => c.component === 'fuel'), 'expected fuel pins from the 5 fuel positions');
        // 5 fuel × 2 layers + 4 guide × 2 layers = 18 cylinders.
        assert.strictEqual(cyls.length, 18, `expected 18 pin-layer cylinders, got ${cyls.length}`);
    });

    test('expands a nested MCNP core lattice (a lattice of assembly lattices of pins)', () => {
        const deck = [
            'MCNP nested core',
            '1 1 -10.4 -1 u=1 imp:n=1',
            '2 3 -0.7   1 u=1 imp:n=1',
            '10 0 50 -51 52 -53 lat=1 u=10 imp:n=1',
            '     fill=0:1 0:1 0:0',
            '     1 1 1 1',
            '20 0 70 -71 72 -73 lat=1 u=100 imp:n=1',
            '     fill=0:1 0:1 0:0',
            '     10 10 10 10',
            '30 0 -60 fill=100 imp:n=1',
            '31 0  60 imp:n=0',
            '',
            '1 cz 0.40',
            '50 px -0.63',
            '51 px  0.63',
            '52 py -0.63',
            '53 py  0.63',
            '70 px -1.26',
            '71 px  1.26',
            '72 py -1.26',
            '73 py  1.26',
            '60 rpp -5 5 -5 5 -10 10',
            '',
            'm1 92235.80c 0.04 92238.80c 0.96 8016.80c 2.0',
            'm3 1001.80c 2.0 8016.80c 1.0',
            'mode n',
        ].join('\n');
        const cyls = extractCylinders(deck, 'mcnp');
        // 2x2 core × 2x2 assemblies × 1 fuel layer = 16 cylinders, 4 columns.
        assert.strictEqual(cyls.length, 16, `expected 16 fuel cylinders, got ${cyls.length}`);
        assert.strictEqual(distinctX(cyls), 4, 'expected 4 pin columns across the nested core');
    });

    test('classifies an MCNP instrument tube (air centre) vs guide tube (water centre)', () => {
        const deck = [
            'MCNP tube classification',
            '1 4 -0.00120 -1    u=1 imp:n=1   $ air centre',
            '2 2 -6.5      1 -2 u=1 imp:n=1   $ Zr thimble',
            '3 3 -0.7      2    u=1 imp:n=1   $ water',
            '4 3 -0.7     -3    u=2 imp:n=1   $ water centre',
            '5 2 -6.5      3 -4 u=2 imp:n=1   $ Zr tube',
            '6 3 -0.7      4    u=2 imp:n=1   $ water',
            '10 0 50 -51 52 -53 lat=1 u=10 imp:n=1',
            '     fill=0:1 0:1 0:0',
            '     1 2 2 1',
            '20 0 -60 fill=10 imp:n=1',
            '21 0  60 imp:n=0',
            '',
            '1 cz 0.43',
            '2 cz 0.48',
            '3 cz 0.56',
            '4 cz 0.60',
            '50 px -0.63',
            '51 px  0.63',
            '52 py -0.63',
            '53 py  0.63',
            '60 rpp -1.26 1.26 -1.26 1.26 -10 10',
            '',
            'm2 40090.80c 1.0',
            'm3 1001.80c 2.0 8016.80c 1.0',
            'm4 7014.80c 0.78 8016.80c 0.21 18040.80c 0.01',
            'mode n',
        ].join('\n');
        const cyls = extractCylinders(deck, 'mcnp');
        assert.ok(cyls.some((c) => c.component === 'instrument_tube'),
            'expected an instrument tube (air centre + Zr) to be classified');
        assert.ok(cyls.some((c) => c.component === 'guide_tube'),
            'expected a guide tube (water centre + Zr) to be classified');
    });

    test('still renders a bare MCNP pin cell when there is no lattice/universe', () => {
        const deck = [
            'Bare pin cell',
            '1 1 -10.4 -1 imp:n=1',
            '2 0       1  imp:n=0',
            '',
            '1 cz 0.41',
            '2 cz 0.47',
            '',
            'm1 92235.80c 0.04 92238.80c 0.96 8016.80c 2.0',
        ].join('\n');
        const cyls = extractCylinders(deck, 'mcnp');
        assert.ok(cyls.some((c) => Math.abs(c.radius - 0.41) < 1e-6),
            'expected the bare cz 0.41 cylinder to still render');
    });

    // --- Serpent lattice / nested-core expansion (the v0.1.8 work) ---

    test('expands a Serpent 3x3 square lattice of pin + guide-tube universes', () => {
        const deck = [
            'pin 1',
            'UO2 0.40',
            'Zr 0.46',
            'water',
            'pin 2',
            'water 0.56',
            'Zr 0.60',
            'water',
            'lat 10 1 0.0 0.0 3 3 1.26',
            '1 2 1',
            '2 1 2',
            '1 2 1',
            'surf s1 sqc 0.0 0.0 1.89',
            'cell c1 0 fill 10 -s1',
            'cell c2 0 outside s1',
        ].join('\n');
        const cyls = extractCylinders(deck, 'serpent');
        assert.strictEqual(distinctX(cyls), 3, `expected a 3-column lattice, got ${distinctX(cyls)}`);
        assert.strictEqual(cyls.filter((c) => c.component === 'guide_tube').length, 4,
            'expected 4 guide-tube layers');
        assert.ok(cyls.some((c) => c.component === 'fuel'), 'expected fuel pins');
    });

    test('expands a nested Serpent core lattice (assemblies of pins)', () => {
        const deck = [
            'pin 1',
            'UO2 0.40',
            'water',
            'lat 10 1 0.0 0.0 2 2 1.26',
            '1 1',
            '1 1',
            'lat 100 1 0.0 0.0 2 2 2.52',
            '10 10',
            '10 10',
            'surf s1 cyl 0.0 0.0 5.0',
            'cell c1 0 fill 100 -s1',
            'cell c2 0 outside s1',
        ].join('\n');
        const cyls = extractCylinders(deck, 'serpent');
        const pins = cyls.filter((c) => c.component !== 'vessel');
        assert.strictEqual(pins.length, 16, `expected 16 fuel cylinders, got ${pins.length}`);
        assert.strictEqual(distinctX(pins), 4, 'expected 4 pin columns across the nested core');
    });

    test('classifies a Serpent instrument tube from an air centre', () => {
        const deck = [
            'pin f',
            'UO2 0.40',
            'water',
            'pin it',
            'air 0.43',
            'Zr 0.48',
            'water',
            'lat 10 1 0.0 0.0 2 2 1.26',
            'f it',
            'it f',
            'surf s1 sqc 0.0 0.0 1.26',
            'cell c1 0 fill 10 -s1',
            'cell c2 0 outside s1',
        ].join('\n');
        const cyls = extractCylinders(deck, 'serpent');
        assert.ok(cyls.some((c) => c.component === 'instrument_tube'),
            'expected an instrument tube (air centre) to be classified');
        assert.ok(cyls.some((c) => c.component === 'fuel'), 'expected fuel pins');
    });

    test('builds a component legend in buildScene', () => {
        const deck = `
geometry { universes {
  pinF { id 10; type pinUniverse; radii (0.4 0.46 0.0); fills (UO2 Zircaloy Water); }
  asm  { id 20; type latUniverse; origin (0 0 0); pitch (1.26 1.26 0); shape (2 2 0); padMat Water; map ( 10 10 10 10 ); }
} }`;
        const scene = buildScene(deck, 'scone');
        assert.ok(scene.components.length >= 1, 'expected at least one component group');
        assert.ok(scene.components.some((c) => c.id === 'fuel' && c.count > 0), 'expected a fuel group with a count');
        assert.ok(scene.materials.some((m) => /UO2/i.test(m.name)), 'expected a UO2 material entry');
    });
});
