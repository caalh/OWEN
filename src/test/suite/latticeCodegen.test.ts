import * as assert from 'assert';
import {
    genMCNP,
    genOpenMC,
    genSerpent,
    genSCONE,
    defaultPinTypes,
    defaultStructuralIds,
    LatticeSpec,
    PinTypeIds,
} from '../../panels/latticeCodegen';

// Pure-logic generator tests — no vscode / no DOM — so they run headless via
// tsc + mocha (`--ui tdd`), same as the extractor/reference suites.

function makeSpec(grid: number[][], mutate?: {
    pins?: (p: PinTypeIds[]) => void;
    struct?: (s: ReturnType<typeof defaultStructuralIds>) => void;
}): LatticeSpec {
    const pins = defaultPinTypes();
    const structural = defaultStructuralIds();
    if (mutate?.pins) { mutate.pins(pins); }
    if (mutate?.struct) { mutate.struct(structural); }
    return { gridSize: grid.length, pitch: 1.26, grid, pins, structural };
}

// 3x3, all fuel (id 1) with a guide tube (id 2) at the center.
function fuelWithCenterGuide(): number[][] {
    return [
        [1, 1, 1],
        [1, 2, 1],
        [1, 1, 1],
    ];
}

suite('OWEN lattice codegen — editable identifiers', () => {
    test('MCNP: custom universe numbers + structural ids appear in output', () => {
        const spec = makeSpec(fuelWithCenterGuide(), {
            pins: (p) => { p[0].mcnpUniverse = 77; p[1].mcnpUniverse = 42; },
            struct: (s) => { s.mcnpCell = 250; s.mcnpLatticeUniverse = 99; s.mcnpSurf = [21, 22, 23, 24]; },
        });
        const out = genMCNP(spec);
        assert.ok(out.includes('250 0  -21 22 -23 24'), 'lattice cell number + surfaces should appear');
        assert.ok(out.includes('u=99'), 'custom lattice universe should appear');
        assert.ok(out.includes('21  px  0.6300'), 'custom surface card should appear');
        // The painted guide tube (id 2 -> u 42) must be the center of the fill array.
        const fillRows = out.split('\n').filter((l) => /^\s+\d/.test(l));
        assert.strictEqual(fillRows[1].trim(), '77 42 77', 'center row should reference chosen universe ids');
    });

    test('OpenMC: custom variable name + universe names appear', () => {
        const spec = makeSpec(fuelWithCenterGuide(), {
            pins: (p) => { p[0].openmcName = 'my_fuel'; p[1].openmcName = 'my_gt'; },
            struct: (s) => { s.openmcLatName = 'core'; },
        });
        const out = genOpenMC(spec);
        assert.ok(out.includes('core = openmc.RectLattice'), 'custom lattice variable should appear');
        assert.ok(out.includes('core.universes = ['), 'universes assigned to custom variable');
        assert.ok(out.includes('[my_fuel, my_gt, my_fuel]'), 'center row should use custom names');
    });

    test('Serpent: custom lat id + names appear', () => {
        const spec = makeSpec(fuelWithCenterGuide(), {
            pins: (p) => { p[0].serpentName = 'FUEL'; p[1].serpentName = 'GTUBE'; },
            struct: (s) => { s.serpentLatId = 555; },
        });
        const out = genSerpent(spec);
        assert.ok(out.includes('lat 555 1'), 'custom lat id should appear');
        assert.ok(out.includes('FUEL GTUBE FUEL'), 'center row should use custom names');
    });
});

suite('OWEN lattice codegen — SCONE', () => {
    test('emits a latUniverse + pinUniverse stubs only for painted types', () => {
        const spec = makeSpec(fuelWithCenterGuide(), {
            pins: (p) => { p[1].sconeId = 902; },
            struct: (s) => { s.sconeLatName = 'assemblyLat'; s.sconeLatId = 333; },
        });
        const out = genSCONE(spec);
        assert.ok(out.includes('assemblyLat { id 333; type latUniverse;'), 'lattice universe header');
        assert.ok(out.includes('shape (3 3 1)'), 'square shape from grid size');
        // The painted guide tube uses the user-chosen SCONE id 902 in the map center.
        const mapRows = out.split('\n').filter((l) => /^\s+\d+( \d+)*$/.test(l));
        assert.strictEqual(mapRows[1].trim(), '101 902 101', 'center maps to chosen SCONE id');
        // Only fuel (101) + guide tube (902) painted -> two pinUniverse stubs.
        assert.ok(out.includes('fuelPin { id 101; type pinUniverse;'), 'fuel pinUniverse stub');
        assert.ok(out.includes('guideTube { id 902; type pinUniverse;'), 'guide-tube pinUniverse stub with chosen id');
        assert.ok(!out.includes('waterRod'), 'unpainted water rod should be omitted');
        assert.ok(!out.includes('altFuel'), 'unpainted alt fuel should be omitted');
        // Root-wiring guidance comment.
        assert.ok(out.includes('fill u<333>'), 'should tell the user how to wire the lattice into the root');
    });

    test('SCONE rule: radii.length == fills.length and outermost radius is 0.0', () => {
        const out = genSCONE(makeSpec(fuelWithCenterGuide()));
        const lines = out.split('\n');
        let checked = 0;
        for (let i = 0; i < lines.length; i++) {
            const rm = lines[i].match(/radii \(([^)]*)\)/);
            if (!rm) { continue; }
            const fm = (lines[i + 1] || '').match(/fills \(([^)]*)\)/);
            assert.ok(fm, 'each radii line must be followed by a fills line');
            const radii = rm[1].trim().split(/\s+/);
            const fills = fm![1].trim().split(/\s+/);
            assert.strictEqual(radii.length, fills.length, 'radii length must equal fills length');
            assert.strictEqual(radii[radii.length - 1], '0.0', 'outermost radius must be 0.0');
            checked++;
        }
        assert.ok(checked >= 2, 'expected at least the fuel + guide-tube stubs to be checked');
    });

    test('output is ASCII with UNIX newlines', () => {
        const out = genSCONE(makeSpec(fuelWithCenterGuide()));
        assert.ok(!out.includes('\r'), 'no CR characters');
        // eslint-disable-next-line no-control-regex
        assert.ok(/^[\x00-\x7F]*$/.test(out), 'ASCII only');
    });
});

suite('OWEN lattice codegen — painted guide tube uses chosen id across formats', () => {
    test('a painted guide tube is referenced with the user id in every format', () => {
        const spec = makeSpec(fuelWithCenterGuide(), {
            pins: (p) => {
                p[1].mcnpUniverse = 8;
                p[1].openmcName = 'gt_custom';
                p[1].serpentName = 'GTX';
                p[1].sconeId = 808;
            },
        });
        assert.ok(genMCNP(spec).includes(' 8 '), 'MCNP fill references chosen universe');
        assert.ok(genOpenMC(spec).includes('gt_custom'), 'OpenMC references chosen name');
        assert.ok(genSerpent(spec).includes('GTX'), 'Serpent references chosen name');
        assert.ok(genSCONE(spec).includes('808'), 'SCONE map references chosen id');
    });
});
