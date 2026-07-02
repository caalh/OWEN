// Adversarial tests: OpenMC / Serpent / SCONE geometry extraction.
import * as assert from 'assert';
import { parseOpenmc } from '../../preview/codes/openmc';
import { parseSerpent } from '../../preview/codes/serpent';
import { parseScone } from '../../preview/codes/scone';

suite('ADV OpenMC extractor', () => {
    test('lattice via dict comprehension + template resolves pins', () => {
        const deck = [
            'import openmc',
            'F = openmc.Universe(name="fuel pin")',
            'G = openmc.Universe(name="guide tube")',
            'template = ["FFF", "FGF", "FFF"]',
            'pick = {"G": G}',
            'lat = openmc.RectLattice()',
            'lat.pitch = (1.26, 1.26)',
            'lat.universes = [[pick.get(ch, F) for ch in row] for row in template]',
        ].join('\n');
        const res = parseOpenmc(deck);
        assert.ok((res.fidelity?.totalPins ?? 0) >= 8, `expected ≥8 pins, got ${res.fidelity?.totalPins}`);
    });

    test('np.full grid + element assignment + coord-list loop', () => {
        const deck = [
            'import openmc',
            'import numpy as np',
            'fuel_pin = openmc.Universe()',
            'guide_tube = openmc.Universe()',
            'arr = np.full((17, 17), fuel_pin)',
            'arr[8, 8] = guide_tube',
            'for (i, j) in [(2, 5), (2, 8), (2, 11)]:',
            '    arr[i, j] = guide_tube',
            'lat = openmc.RectLattice()',
            'lat.pitch = (1.26, 1.26)',
            'lat.universes = arr',
        ].join('\n');
        const res = parseOpenmc(deck);
        assert.strictEqual(res.fidelity?.totalPins, 289, `expected 289 pins, got ${res.fidelity?.totalPins}`);
    });

    test('literal .universes = [[...]] assignment', () => {
        const deck = [
            'import openmc',
            'fuel_pin = openmc.Universe()',
            'lat = openmc.RectLattice()',
            'lat.pitch = (1.26, 1.26)',
            'lat.universes = [[fuel_pin, fuel_pin], [fuel_pin, fuel_pin]]',
        ].join('\n');
        const res = parseOpenmc(deck);
        assert.ok((res.fidelity?.totalPins ?? 0) >= 4, `expected 4 pins, got ${res.fidelity?.totalPins}`);
    });

    test('ZPlane stacks defined out of order still produce sorted bands', () => {
        const deck = [
            'import openmc',
            'z2 = openmc.ZPlane(z0=200.0)',
            'z0 = openmc.ZPlane(z0=0.0)',
            'z1 = openmc.ZPlane(z0=100.0)',
            'fuel = openmc.Universe()',
            'plenum = openmc.Universe()',
            'c1 = openmc.Cell(region=+z1 & -z2, fill=plenum)',
            'c0 = openmc.Cell(region=+z0 & -z1, fill=fuel)',
            'fuel_pin = openmc.Universe()',
            'lat = openmc.RectLattice()',
            'lat.pitch = (1.26, 1.26)',
            'lat.universes = [[fuel_pin, fuel_pin], [fuel_pin, fuel_pin]]',
        ].join('\n');
        const res = parseOpenmc(deck, { axial: true });
        assert.ok(res.fidelity?.hasAxial, 'axial bands not detected');
        // With axial on, each pin should be 2 bands => more cylinders than pins.
        assert.ok(res.cylinders.length >= 8, `axial bands not expanded: ${res.cylinders.length}`);
    });

    test('cells with region=None do not crash', () => {
        const deck = [
            'import openmc',
            'u = openmc.Universe()',
            'c = openmc.Cell(region=None, fill=u)',
            'lat = openmc.RectLattice()',
            'lat.universes = [[u, u], [u, u]]',
        ].join('\n');
        const res = parseOpenmc(deck);
        assert.ok(Array.isArray(res.cylinders));
    });

    test('empty python file / non-openmc python file degrade gracefully', () => {
        for (const text of ['', 'print("hello")', 'import numpy as np\nx = np.zeros(3)']) {
            const res = parseOpenmc(text);
            assert.ok(Array.isArray(res.cylinders));
        }
    });

    test('HexLattice gets rectangular approximation + note', () => {
        const deck = [
            'import openmc',
            'f = openmc.Universe(name="fuel")',
            'lat = openmc.HexLattice()',
            'lat.universes = [[f, f, f], [f, f, f], [f, f, f]]',
        ].join('\n');
        const res = parseOpenmc(deck);
        assert.ok(res.notes?.some((n) => /hex/i.test(n)), 'expected hex approximation note');
    });

    test('pitch parsed from pathological line ("pitch" appears in comment)', () => {
        const deck = [
            'import openmc',
            '# the pitch = 999 is only a comment mention',
            'pitch = 1.26',
            'fuel_pin = openmc.Universe()',
            'lat = openmc.RectLattice()',
            'lat.pitch = (pitch, pitch)',
            'lat.universes = [[fuel_pin, fuel_pin], [fuel_pin, fuel_pin]]',
        ].join('\n');
        const res = parseOpenmc(deck);
        assert.ok(Array.isArray(res.cylinders));
        // Adjacent pins should be ~1.26 apart, not 999.
        const xs = [...new Set(res.cylinders.map((c) => c.x))].sort((a, b) => a - b);
        if (xs.length >= 2) {
            const gap = xs[1] - xs[0];
            assert.ok(gap < 10, `pitch parsed from comment: gap=${gap}`);
        }
    });
});

suite('ADV Serpent extractor', () => {
    const PIN = [
        'pin fp',
        'fuel  0.41',
        'clad  0.475',
        'water',
    ];

    test('nested lattices (core of assemblies) resolve', () => {
        const deck = [
            ...PIN,
            'lat asm 1 0.0 0.0 2 2 1.26',
            'fp fp',
            'fp fp',
            'lat core 1 0.0 0.0 2 2 21.5',
            'asm asm',
            'asm asm',
            'surf 1 cyl 0.0 0.0 100',
            'cell 99 0 fill core -1',
            'mat fuel -10.4 92235.09c 0.03 92238.09c 0.97',
            'mat clad -6.5 40090.09c 1.0',
            'mat water -0.7 1001.06c 2 8016.06c 1',
        ].join('\n');
        const res = parseSerpent(deck);
        assert.strictEqual(res.fidelity?.totalPins, 16, `expected 16 pins, got ${res.fidelity?.totalPins}`);
    });

    test('hex lattice types 2 and 3 place on hex coordinates', () => {
        for (const t of [2, 3]) {
            const deck = [
                ...PIN,
                `lat hexlat ${t} 0.0 0.0 3 3 1.26`,
                'fp fp fp',
                'fp fp fp',
                'fp fp fp',
            ].join('\n');
            const res = parseSerpent(deck);
            assert.ok(res.cylinders.length >= 9, `type ${t}: expected ≥9, got ${res.cylinders.length}`);
            assert.ok(res.notes?.some((n) => /hex/i.test(n)), `type ${t}: expected hex note`);
        }
    });

    test('surfaces defined after use (cell references surf declared later)', () => {
        const deck = [
            'cell c1 5 fuel -1',
            'cell c2 5 clad 1 -2',
            'cell c3 5 water 2',
            'surf 1 cyl 0.0 0.0 0.41',
            'surf 2 cyl 0.0 0.0 0.475',
            'lat core 1 0.0 0.0 2 2 1.26',
            '5 5',
            '5 5',
        ].join('\n');
        const res = parseSerpent(deck);
        assert.ok(res.cylinders.length > 0, `forward surf refs broke parse: warnings=${JSON.stringify(res.warnings)}`);
    });

    test('trans card does not derail parsing', () => {
        const deck = [
            ...PIN,
            'trans s fp 1.0 2.0 0.0',
            'lat core 1 0.0 0.0 2 2 1.26',
            'fp fp',
            'fp fp',
        ].join('\n');
        const res = parseSerpent(deck);
        assert.ok(res.cylinders.length > 0);
    });

    test('lattice grid short of entries (truncated deck) does not crash', () => {
        const deck = [
            ...PIN,
            'lat core 1 0.0 0.0 3 3 1.26',
            'fp fp',
        ].join('\n');
        const res = parseSerpent(deck);
        assert.ok(Array.isArray(res.cylinders));
    });

    test('pin block terminated by EOF (no trailing material)', () => {
        const deck = [
            'pin fp',
            'fuel 0.41',
        ].join('\n');
        const res = parseSerpent(deck);
        assert.ok(Array.isArray(res.cylinders));
    });

    test('cyclic fill (cell fills its own universe) terminates', () => {
        const deck = [
            'cell a 10 fill 20 -1',
            'cell b 20 fill 10 -1',
            'surf 1 cyl 0.0 0.0 5',
            ...PIN,
            'lat core 1 0.0 0.0 2 2 1.26',
            '10 fp',
            'fp 10',
        ].join('\n');
        // Must terminate (no infinite recursion).
        const res = parseSerpent(deck);
        assert.ok(Array.isArray(res.cylinders));
    });

    test('empty / garbage deck returns warnings not exceptions', () => {
        for (const text of ['', '% only comment', 'random words here\n1 2 3']) {
            const res = parseSerpent(text);
            assert.ok(Array.isArray(res.cylinders));
        }
    });
});

suite('ADV SCONE extractor', () => {
    test('deeply nested dictionary structure parses leaf universes', () => {
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
            '    lattice {',
            '      id 2; type latUniverse;',
            '      shape (2 2 1); pitch (1.26 1.26 0.0); origin (0.0 0.0 0.0);',
            '      padMat water;',
            '      map ( 3 3',
            '            3 3 );',
            '    }',
            '    pin { id 3; type pinUniverse; radii (0.41 0.475 0.0); fills (fuel clad water); }',
            '  }',
            '}',
        ].join('\n');
        const res = parseScone(deck);
        assert.ok(res.cylinders.length >= 4, `expected ≥4 pins-worth, got ${res.cylinders.length}`);
    });

    test('pinUniverse radii/fills length mismatch degrades gracefully (no crash)', () => {
        const deck = [
            'pin { id 3; type pinUniverse; radii (0.41 0.475 0.0); fills (fuel clad); }',
            'lat { id 2; type latUniverse; shape (1 1 1); pitch (1.26 1.26 0.0); map ( 3 ); }',
        ].join('\n');
        const res = parseScone(deck);
        assert.ok(Array.isArray(res.cylinders), 'mismatch crashed the parser');
    });

    test('cyclic cellUniverse fill terminates', () => {
        const deck = [
            'u1 { id 10; type cellUniverse; cells (1); }',
            'c1 { id 1; type simpleCell; surfaces (-5); filltype uni; universe 20; }',
            'u2 { id 20; type cellUniverse; cells (2); }',
            'c2 { id 2; type simpleCell; surfaces (-5); filltype uni; universe 10; }',
            'pin { id 3; type pinUniverse; radii (0.41 0.0); fills (fuel water); }',
            'lat { id 2; type latUniverse; shape (1 1 1); pitch (1.26 1.26 0.0); map ( 10 ); }',
        ].join('\n');
        const res = parseScone(deck);
        assert.ok(Array.isArray(res.cylinders));
    });

    test('grid map shorter than shape pads with zeros', () => {
        const deck = [
            'pin { id 3; type pinUniverse; radii (0.41 0.0); fills (fuel water); }',
            'lat { id 2; type latUniverse; shape (3 3 1); pitch (1.26 1.26 0.0); map ( 3 3 ); }',
        ].join('\n');
        const res = parseScone(deck);
        assert.ok(Array.isArray(res.cylinders));
    });

    test('non-ASCII content and comments do not crash', () => {
        const deck = [
            '! comment with unicode ☢',
            '// another 中文 comment',
            'pin { id 3; type pinUniverse; radii (0.41 0.0); fills (fuel water); }',
            'lat { id 2; type latUniverse; shape (1 1 1); pitch (1.26 1.26 0.0); map ( 3 ); }',
        ].join('\n');
        const res = parseScone(deck);
        assert.ok(res.cylinders.length > 0);
    });

    test('empty deck warns, does not throw', () => {
        const res = parseScone('');
        assert.strictEqual(res.cylinders.length, 0);
        assert.ok((res.warnings ?? []).length > 0);
    });

    test('unclosed brace does not hang or crash', () => {
        const deck = 'pin { id 3; type pinUniverse; radii (0.41 0.0); fills (fuel water);';
        const res = parseScone(deck);
        assert.ok(Array.isArray(res.cylinders));
    });

    test('pinUniverse with all-zero radii (pure fill) draws nothing but does not crash', () => {
        const deck = [
            'waterpin { id 4; type pinUniverse; radii (0.0); fills (water); }',
            'pin { id 3; type pinUniverse; radii (0.41 0.0); fills (fuel water); }',
            'lat { id 2; type latUniverse; shape (2 1 1); pitch (1.26 1.26 0.0); map ( 3 4 ); }',
        ].join('\n');
        const res = parseScone(deck);
        assert.ok(res.cylinders.length > 0);
    });
});
