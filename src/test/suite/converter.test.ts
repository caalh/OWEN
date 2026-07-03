import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
    convert, detectConversionSource, mcnpToOpenmc, mcnpToSerpent, mcnpToScone,
    openmcToMcnp, parseMcnpDeck, TODO_MARK,
} from '../../converter';

const PIN_CELL_MCNP = [
    'Simple pin cell',
    'c cells',
    '1 1 -10.4  -1     imp:n=1  $ fuel',
    '2 2 -6.55   1 -2  imp:n=1  $ clad',
    '3 3 -0.74   2 -3  imp:n=1  $ water',
    '4 0         3     imp:n=0  $ graveyard',
    '',
    '1 cz 0.4096',
    '2 cz 0.4750',
    '*3 rpp -0.63 0.63 -0.63 0.63 -100 100',
    '',
    'mode n',
    'm1 92235.80c 0.04 92238.80c 0.96 8016.80c 2.0',
    'm2 40090.80c 1.0',
    'm3 1001.80c 2.0 8016.80c 1.0',
    'mt3 lwtr.20t',
    'kcode 5000 1.0 20 120',
    'ksrc 0 0 0',
].join('\n');

suite('OWEN converter — MCNP deck model', () => {
    test('parses cells, surfaces, materials, settings from a pin cell', () => {
        const deck = parseMcnpDeck(PIN_CELL_MCNP);
        assert.strictEqual(deck.cells.length, 4);
        assert.strictEqual(deck.surfaces.length, 3);
        assert.strictEqual(deck.materials.length, 3);
        assert.strictEqual(deck.settings.particles, 5000);
        assert.strictEqual(deck.settings.batches, 120);
        assert.strictEqual(deck.settings.inactive, 20);
        const graveyard = deck.cells.find((c) => c.id === 4)!;
        assert.strictEqual(graveyard.importanceZero, true);
        const water = deck.materials.find((m) => m.id === 3)!;
        assert.deepStrictEqual(water.sab, ['c_H_in_H2O']);
    });

    test('parses lattice fill arrays with ranges', () => {
        const text = [
            'lat deck',
            '20 0  50 -51 52 -53  lat=1 u=10 imp:n=1',
            '     fill=0:1 0:1 0:0',
            '      1 2',
            '      2 1',
            '',
            '50 px -0.63',
            '51 px  0.63',
            '52 py -0.63',
            '53 py  0.63',
            '',
            'kcode 1000 1.0 10 50',
        ].join('\n');
        const deck = parseMcnpDeck(text);
        const lat = deck.cells.find((c) => c.id === 20)!;
        assert.strictEqual(lat.lattice, 1);
        assert.ok(lat.latticeFill);
        assert.strictEqual(lat.latticeFill!.nx, 2);
        assert.strictEqual(lat.latticeFill!.ny, 2);
        assert.deepStrictEqual(lat.latticeFill!.universes, [1, 2, 2, 1]);
    });
});

suite('OWEN converter — MCNP → OpenMC', () => {
    test('pin cell converts with materials, surfaces, cells, settings', () => {
        const r = mcnpToOpenmc(PIN_CELL_MCNP);
        assert.ok(r.output.includes("mat_1.add_nuclide('U235', 0.04, 'ao')"));
        assert.ok(r.output.includes("mat_3.add_s_alpha_beta('c_H_in_H2O')"));
        assert.ok(r.output.includes("mat_1.set_density('g/cm3', 10.4)"), 'cell density transfers to material');
        assert.ok(r.output.includes('openmc.ZCylinder(surface_id=1, r=0.4096)'));
        assert.ok(r.output.includes("boundary_type='reflective'"));
        assert.ok(r.output.includes('settings.batches = 120'));
        assert.ok(r.output.includes('openmc.IndependentSource'));
    });

    test('gq quadric surfaces convert to openmc.Quadric (v0.3.8)', () => {
        const text = 'deck\n1 0 -1 imp:n=1\n\n1 gq 1 2 3 4 5 6 7 8 9 10\n\nkcode 100 1.0 5 20\n';
        const r = mcnpToOpenmc(text);
        assert.ok(r.output.includes('openmc.Quadric'), 'gq must map to openmc.Quadric');
        assert.ok(!r.issues.some((i) => i.message.includes("type 'gq'")), 'gq is supported now');
    });

    test('unknown surface types produce TODO markers, not silence', () => {
        // ARB (arbitrary polyhedron) has no OpenMC equivalent.
        const text = 'deck\n1 0 -1 imp:n=1\n\n1 arb 0 0 0 1 0 0 1 1 0 0 1 0 0 0 1 1 0 1 1 1 1 0 1 1 1234 5678 1265 4378 1485 2376\n\nkcode 100 1.0 5 20\n';
        const r = mcnpToOpenmc(text);
        assert.ok(r.output.includes(TODO_MARK), 'expected TODO marker in output');
        assert.ok(r.issues.length > 0, 'unsupported surface must surface as an issue');
    });
});

suite('OWEN converter — MCNP → Serpent', () => {
    test('pin cell converts with cuboid (never rect), therm card, set pop', () => {
        const r = mcnpToSerpent(PIN_CELL_MCNP);
        assert.ok(r.output.includes('surf 3 cuboid -0.63 0.63 -0.63 0.63 -100 100'));
        assert.ok(!/\brect\b/.test(r.output), 'must never emit Serpent "rect"');
        assert.ok(r.output.includes('surf 1 cyl 0.0 0.0 0.4096'));
        assert.ok(/therm therm\d+ lwj3\.11t/.test(r.output), 'mt3 lwtr → therm card');
        assert.ok(/mat m3 -0\.74 moder therm\d+ 1001/.test(r.output), 'water gets moder entry');
        assert.ok(r.output.includes('set pop 5000 100 20'), 'kcode → set pop particles active inactive');
        assert.ok(r.output.includes('set bc 2'), 'reflective rpp → set bc 2');
        assert.ok(r.output.includes('cell 4 0 outside'), 'graveyard → outside cell');
        assert.ok(!/^\s*set omp\b/m.test(r.output), 'never emit a "set omp" card');
    });

    test('square lattice with derivable pitch converts to lat card', () => {
        const text = [
            'lat deck',
            '20 0  50 -51 52 -53  lat=1 u=10 imp:n=1',
            '     fill=0:1 0:1 0:0',
            '      1 2',
            '      2 1',
            '',
            '50 px -0.63',
            '51 px  0.63',
            '52 py -0.63',
            '53 py  0.63',
            '',
            'kcode 1000 1.0 10 50',
        ].join('\n');
        const r = mcnpToSerpent(text);
        assert.ok(r.output.includes('lat 10 1 0.0 0.0 2 2 1.26'), `expected lat card, got:\n${r.output}`);
        assert.ok(r.output.includes('u1 u2'));
    });
});

suite('OWEN converter — MCNP → SCONE', () => {
    test('pin cell converts with dict syntax, aceNeutronDatabase, ASCII only', () => {
        const r = mcnpToScone(PIN_CELL_MCNP);
        assert.ok(r.output.includes('type eigenPhysicsPackage;'));
        assert.ok(r.output.includes('aceNeutronDatabase'), 'must use aceNeutronDatabase');
        assert.ok(!r.output.includes('aceNuclearDatabase'));
        assert.ok(r.output.includes('type zCylinder;'));
        assert.ok(r.output.includes('pop 5000;'));
        assert.ok(r.output.includes('active 100;'), 'kcode 120 total - 20 inactive = 100 active');
        assert.ok(r.output.includes('inactive 20;'));
        assert.ok(r.output.includes('92235.03 0.04;'), 'SCONE ZAID with temp suffix .03');
        // temp/suffix consistency rule
        assert.ok(r.output.includes('temp 300;'));
        // ASCII-only
        for (let i = 0; i < r.output.length; i++) {
            assert.ok(r.output.charCodeAt(i) <= 127, `non-ASCII char at ${i}`);
        }
        // border from graveyard cell
        assert.ok(r.output.includes('border 3;'), 'graveyard single-surface region becomes root border');
    });

    test('union regions are flagged as TODO for simpleCell', () => {
        const text = 'deck\n1 1 -1.0  -1 : -2  imp:n=1\n9 0 1 2 imp:n=0\n\n1 cz 1.0\n2 cz 2.0\n\nm1 1001.80c 1.0\nkcode 100 1.0 5 20\n';
        const r = mcnpToScone(text);
        assert.ok(r.issues.some((i) => i.message.includes('union/complement')));
        assert.ok(r.output.includes(TODO_MARK));
    });
});

suite('OWEN converter — OpenMC → MCNP round trip', () => {
    test('OpenMC pin cell script converts to an MCNP deck', () => {
        const script = [
            'import openmc',
            'fuel_or = 0.4096',
            "fuel = openmc.Material(1, name='fuel')",
            "fuel.add_nuclide('U235', 0.04, 'ao')",
            "fuel.add_nuclide('U238', 0.96, 'ao')",
            "fuel.set_density('g/cm3', 10.4)",
            "water = openmc.Material(2, name='water')",
            "water.add_nuclide('H1', 2.0)",
            "water.add_nuclide('O16', 1.0)",
            "water.add_s_alpha_beta('c_H_in_H2O')",
            "water.set_density('g/cm3', 0.74)",
            'surf1 = openmc.ZCylinder(surface_id=1, r=fuel_or)',
            "surf2 = openmc.ZCylinder(surface_id=2, r=0.475, boundary_type='reflective')",
            'cell1 = openmc.Cell(cell_id=1, fill=fuel, region=-surf1)',
            'cell2 = openmc.Cell(cell_id=2, fill=water, region=+surf1 & -surf2)',
            'settings = openmc.Settings()',
            'settings.batches = 120',
            'settings.inactive = 20',
            'settings.particles = 5000',
            'settings.source = openmc.IndependentSource(space=openmc.stats.Point((0, 0, 0)))',
        ].join('\n');
        const r = openmcToMcnp(script);
        assert.ok(r.output.includes('92235.80c'));
        assert.ok(/mt2\s+lwtr\.20t/.test(r.output), 'S(α,β) → mt card');
        assert.ok(r.output.includes('kcode 5000 1.0 20 120'));
        assert.ok(r.output.includes('cz   0.4096'), 'variable fuel_or resolved');
        assert.ok(/^\*2/m.test(r.output), 'reflective surface gets *');
        const cellLine = r.output.split('\n').find((l) => l.startsWith('1 ') || l.startsWith('1\t') || /^1\s+1/.test(l));
        assert.ok(cellLine, 'cell card for cell 1 present');
        assert.ok(/1\s+1 -10\.4/.test(r.output), 'density transferred with g/cm3 sign convention');
    });

    test('round-trip MCNP → OpenMC → MCNP preserves material and kcode', () => {
        const openmcScript = mcnpToOpenmc(PIN_CELL_MCNP).output;
        const back = openmcToMcnp(openmcScript);
        assert.ok(back.output.includes('92235.80c'));
        assert.ok(back.output.includes('kcode 5000 1.0 20 120'));
        assert.ok(/mt3\s+lwtr\.20t/.test(back.output));
    });
});

suite('OWEN converter — direction detection', () => {
    test('detects MCNP and OpenMC sources', () => {
        assert.strictEqual(detectConversionSource(PIN_CELL_MCNP), 'mcnp');
        assert.strictEqual(
            detectConversionSource('import openmc\nm = openmc.Material()\nc = openmc.Cell()'),
            'openmc',
        );
        assert.strictEqual(detectConversionSource('hello world'), null);
    });
});

suite('OWEN converter — BEAVRS-assembly scale', () => {
    const fixture = path.resolve(__dirname, '../../../prebuilt-models/assembly_17x17_mcnp.i');
    const text = fs.readFileSync(fixture, 'utf8');

    test('17x17 assembly converts to all three targets without crashing', () => {
        for (const target of ['openmc', 'serpent', 'scone'] as const) {
            const r = convert('mcnp', target, text);
            assert.ok(r.output.length > 500, `${target} output suspiciously short`);
        }
    });

    test('17x17 assembly: Serpent output has the lattice and expected TODO markers', () => {
        const r = mcnpToSerpent(text);
        // 17x17 lattice with pitch 1.26 must convert (px pairs -0.63/0.63)
        assert.ok(r.output.includes('lat 10 1 0.0 0.0 17 17 1.26'), 'expected 17x17 lat card');
        // fill=10 window cell
        assert.ok(r.output.includes('fill u10'));
        // materials all present
        for (const m of ['mat m1', 'mat m2', 'mat m3', 'mat m4', 'mat m5']) {
            assert.ok(r.output.includes(m), `missing ${m}`);
        }
        // honest markers exist (lattice verification note at minimum)
        assert.ok(r.output.includes(TODO_MARK));
    });

    test('17x17 assembly: OpenMC output converts the lattice (v0.3.8)', () => {
        const r = mcnpToOpenmc(text);
        assert.ok(r.output.includes('openmc.RectLattice'), 'lat=1 must convert to RectLattice');
        assert.ok(r.output.includes('lat_'), 'lattice variable expected');
        assert.ok(!r.issues.some((i) => /lattice.*not converted/i.test(i.message)),
            'lattice must convert without a TODO issue');
        assert.ok(r.output.includes("mat_4.add_s_alpha_beta('c_H_in_H2O')"));
    });

    test('17x17 assembly: SCONE output is ASCII and has a latUniverse', () => {
        const r = mcnpToScone(text);
        for (let i = 0; i < r.output.length; i++) {
            assert.ok(r.output.charCodeAt(i) <= 127, `non-ASCII char at ${i}`);
        }
        assert.ok(r.output.includes('type latUniverse;'), 'expected latUniverse for the 17x17 lattice');
        assert.ok(r.output.includes('shape (17 17 0);'));
    });
});
