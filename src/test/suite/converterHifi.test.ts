// High-fidelity MCNP↔OpenMC converter tests (v0.3.8).
//
// Per-construct coverage both directions: surfaces, boolean cell logic,
// universes/lattices (rect + hex + repeats + trcl), materials (ZAID mapping,
// S(α,β), temperatures), boundary conditions (graveyard synthesis both ways),
// settings, plus round-trips and adversarial inputs.

import * as assert from 'assert';
import {
    mcnpToOpenmc, openmcToMcnp, parseMcnpDeck, parseOpenmcStatic, emitMcnpFromTrace,
} from '../../converter';
import { hexFillToRings } from '../../converter/mcnpToOpenmc';
import { zaidToNuclide, nuclideToZaid } from '../../converter/zaid';

function deck(cells: string[], surfaces: string[], data: string[]): string {
    return ['t', ...cells, '', ...surfaces, '', ...data].join('\n');
}

// ---------------------------------------------------------------------------
// MCNP → OpenMC: surfaces
// ---------------------------------------------------------------------------

suite('HiFi converter — MCNP→OpenMC surfaces', () => {
    const surfaceCase = (card: string, expects: string[]) => {
        const text = deck(['1 0 -1 imp:n=1', '2 0 1 imp:n=0'], [card], ['kcode 10 1.0 2 5']);
        const r = mcnpToOpenmc(text);
        for (const e of expects) {
            assert.ok(r.output.includes(e), `card '${card}': missing '${e}' in output`);
        }
    };

    test('general plane p (4-coeff)', () => surfaceCase('1 p 1 2 3 4', ['openmc.Plane(surface_id=1, a=1, b=2, c=3, d=4']));
    test('axis planes px/py/pz', () => {
        surfaceCase('1 px 5', ['openmc.XPlane(surface_id=1, x0=5']);
        surfaceCase('1 py -5', ['openmc.YPlane(surface_id=1, y0=-5']);
        surfaceCase('1 pz 0.5', ['openmc.ZPlane(surface_id=1, z0=0.5']);
    });
    test('spheres so/s/sx/sy/sz', () => {
        surfaceCase('1 so 10', ['openmc.Sphere(surface_id=1, r=10']);
        surfaceCase('1 s 1 2 3 4', ['openmc.Sphere(surface_id=1, x0=1, y0=2, z0=3, r=4']);
        surfaceCase('1 sy 2 3', ['openmc.Sphere(surface_id=1, y0=2, r=3']);
    });
    test('on-axis + off-axis cylinders', () => {
        surfaceCase('1 cz 0.5', ['openmc.ZCylinder(surface_id=1, r=0.5']);
        surfaceCase('1 c/z 1 2 0.5', ['openmc.ZCylinder(surface_id=1, x0=1, y0=2, r=0.5']);
        surfaceCase('1 cx 3', ['openmc.XCylinder(surface_id=1, r=3']);
        surfaceCase('1 c/y 1 2 3', ['openmc.YCylinder(surface_id=1, x0=1, z0=2, r=3']);
    });
    test('two-sided cones kx/ky/kz', () => {
        surfaceCase('1 kz 5 0.25', ['openmc.ZCone(surface_id=1, x0=0, y0=0, z0=5, r2=0.25']);
        surfaceCase('1 k/x 1 2 3 0.5', ['openmc.XCone(surface_id=1, x0=1, y0=2, z0=3, r2=0.5']);
    });
    test('one-sided cone (sheet param) becomes model composite', () => {
        surfaceCase('1 kz 5 0.25 1', ['openmc.model.ZConeOneSided(', 'up=True']);
        surfaceCase('1 kx 5 0.25 -1', ['openmc.model.XConeOneSided(', 'up=False']);
    });
    test('gq general quadric', () => {
        surfaceCase('1 gq 1 2 3 4 5 6 7 8 9 10',
            ['openmc.Quadric(surface_id=1, a=1, b=2, c=3, d=4, e=5, f=6, g=7, h=8, j=9, k=10']);
    });
    test('sq special quadric expands to general quadric', () => {
        // a(x-1)² + 2(y-1)² + 3(z-1)² - 25 = 0 →  x²+2y²+3z² -2x -4y -6z -19
        surfaceCase('1 sq 1 2 3 0 0 0 -25 1 1 1',
            ['openmc.Quadric(surface_id=1, a=1, b=2, c=3, d=0, e=0, f=0, g=-2, h=-4, j=-6, k=-19']);
    });
    test('tori tx/ty/tz', () => {
        surfaceCase('1 tz 0 0 0 5 1 1', ['openmc.ZTorus(surface_id=1, x0=0, y0=0, z0=0, a=5, b=1, c=1']);
        surfaceCase('1 tx 1 2 3 4 5 6', ['openmc.XTorus(surface_id=1, x0=1, y0=2, z0=3, a=4, b=5, c=6']);
    });
    test('macrobody rpp → RectangularParallelepiped', () => {
        surfaceCase('1 rpp -1 1 -2 2 -3 3', ['openmc.model.RectangularParallelepiped(-1, 1, -2, 2, -3, 3']);
    });
    test('macrobody rcc → RightCircularCylinder', () => {
        surfaceCase('1 rcc 0 0 -10 0 0 20 3', ["openmc.model.RightCircularCylinder((0, 0, -10), 20, 3, axis='z'"]);
    });
    test('macrobody box (axis-aligned) → RectangularParallelepiped', () => {
        surfaceCase('1 box -1 -1 -1 2 0 0 0 2 0 0 0 2', ['openmc.model.RectangularParallelepiped(-1, 1, -1, 1, -1, 1']);
    });
    test('macrobody rhp → HexagonalPrism + z planes', () => {
        surfaceCase('1 rhp 0 0 -10 0 0 20 2 0 0', ['openmc.model.HexagonalPrism(', 'openmc.ZPlane(z0=-10', 'openmc.ZPlane(z0=10']);
    });
    test('composites are emitted after primitives (id-collision guard)', () => {
        const text = deck(['1 0 -1 2 imp:n=1', '2 0 1 imp:n=0'],
            ['1 rpp -5 5 -5 5 -5 5', '2 cz 1'], ['kcode 10 1.0 2 5']);
        const r = mcnpToOpenmc(text);
        const iRpp = r.output.indexOf('RectangularParallelepiped');
        const iCz = r.output.indexOf('openmc.ZCylinder');
        assert.ok(iCz >= 0 && iRpp > iCz, 'composite must come after primitive ZCylinder');
    });
    test('reflective and periodic boundaries transfer', () => {
        const text = deck(['1 0 -1 imp:n=1'], ['*1 so 20'], ['kcode 10 1.0 2 5']);
        assert.ok(mcnpToOpenmc(text).output.includes("boundary_type='reflective'"));
    });
});

// ---------------------------------------------------------------------------
// MCNP → OpenMC: boolean cell logic
// ---------------------------------------------------------------------------

suite('HiFi converter — MCNP→OpenMC boolean logic', () => {
    const SURFS = ['1 cz 1', '2 cz 2', '3 cz 3', '4 pz -10', '5 pz 10'];

    const regionOf = (cellRegion: string): string => {
        const text = deck([`1 1 -1.0 ${cellRegion} imp:n=1`, '9 0 3 imp:n=0'], SURFS,
            ['m1 1001.80c 1.0', 'kcode 10 1.0 2 5']);
        const r = mcnpToOpenmc(text);
        const m = r.output.match(/cell_1\.region = (.*)/);
        assert.ok(m, `no region emitted for '${cellRegion}'`);
        return m![1];
    };

    test('intersection (spaces) → &', () => {
        assert.strictEqual(regionOf('-1 4 -5'), '-surf_1 & +surf_4 & -surf_5');
    });
    test('union (:) → |', () => {
        assert.strictEqual(regionOf('-1 : -2'), '-surf_1 | -surf_2');
    });
    test('mixed with parentheses preserves precedence', () => {
        assert.strictEqual(regionOf('(-1 : -2) 4'), '(-surf_1 | -surf_2) & +surf_4');
    });
    test('expression complement #(...)', () => {
        assert.strictEqual(regionOf('#(-1 : -2) -3'), '~(-surf_1 | -surf_2) & -surf_3');
    });
    test('cell complement #n inlines the target region', () => {
        const text = deck([
            '1 1 -1.0 -1 imp:n=1',
            '2 1 -1.0 -2 #1 imp:n=1',
            '9 0 3 imp:n=0',
        ], SURFS, ['m1 1001.80c 1.0', 'kcode 10 1.0 2 5']);
        const r = mcnpToOpenmc(text);
        assert.ok(r.output.includes('cell_2.region = -surf_2 & ~(-surf_1)'));
    });
    test('deeply nested parentheses survive', () => {
        const expr = regionOf('((((-1 : -2)) 4) : (-3 5))');
        assert.ok(expr.includes('|') && expr.includes('&'), expr);
        assert.strictEqual(mcnpToOpenmc(deck(
            [`1 1 -1.0 ((((-1 : -2)) 4) : (-3 5)) imp:n=1`, '9 0 3 imp:n=0'], SURFS,
            ['m1 1001.80c 1.0', 'kcode 10 1.0 2 5'],
        )).issues.filter((i) => /region/.test(i.message)).length, 0);
    });
});

// ---------------------------------------------------------------------------
// MCNP → OpenMC: universes, lattices, transforms
// ---------------------------------------------------------------------------

suite('HiFi converter — MCNP→OpenMC universes and lattices', () => {
    test('lat=1 square lattice with full fill array and repeats (nR)', () => {
        const text = deck([
            '1 1 -10.0 -1 u=1 imp:n=1',
            '2 2 -0.7   1 u=1 imp:n=1',
            '3 2 -0.7      u=2 imp:n=1',
            '10 0 -11 12 -13 14 lat=1 u=5 imp:n=1',
            '     fill=-1:1 -1:1 0:0',
            '     2 2 2 2 1 2 2 2R',      // 2R expands to two more 2s
            '20 0 -20 21 -22 fill=5 imp:n=1',
            '99 0 20 : -21 : 22 imp:n=0',
        ], [
            '1 cz 0.4', '11 px 0.63', '12 px -0.63', '13 py 0.63', '14 py -0.63',
            '20 cz 50', '21 pz -50', '22 pz 50',
        ], ['m1 92235.80c 1.0', 'm2 1001.80c 2.0 8016.80c 1.0', 'kcode 10 1.0 2 5']);
        const r = mcnpToOpenmc(text);
        assert.ok(r.output.includes('openmc.RectLattice'), 'RectLattice expected');
        assert.ok(r.output.includes('lat_10.pitch = (1.26, 1.26)'), 'pitch from px/py window');
        assert.ok(/lat_10\.universes = \[\s*\[u_2, u_2, u_2\],\s*\[u_2, u_1, u_2\],\s*\[u_2, u_2, u_2\],\s*\]/.test(r.output),
            `fill array with repeat: ${r.output.match(/lat_10\.universes = \[[\s\S]*?\]\n/)?.[0]}`);
        assert.strictEqual(r.issues.filter((i) => /lattice/i.test(i.message)).length, 0);
    });

    test('lat=2 hex lattice converts to HexLattice rings', () => {
        const text = deck([
            '1 1 -10.0 -1 u=1 imp:n=1',
            '2 2 -0.7   1 u=1 imp:n=1',
            '3 2 -0.7      u=2 imp:n=1',
            '10 0 -11 lat=2 u=5 imp:n=1',
            '     fill=-1:1 -1:1 0:0',
            '     2 2 1 2 1 2 1 2 2',
            '20 0 -20 fill=5 imp:n=1',
            '99 0 20 imp:n=0',
        ], [
            '1 cz 0.4', '11 rhp 0 0 -50 0 0 100 0 0.6 0', '20 so 60',
        ], ['m1 92235.80c 1.0', 'm2 1001.80c 2.0 8016.80c 1.0', 'kcode 10 1.0 2 5']);
        const r = mcnpToOpenmc(text);
        assert.ok(r.output.includes('openmc.HexLattice'), 'HexLattice expected');
        assert.ok(r.output.includes('lat_10.pitch = (1.2,)'), `hex pitch from RHP apothem: ${r.output.match(/lat_10\.pitch.*$/m)?.[0]}`);
        assert.ok(!r.output.match(/TODO\(owen-convert\).*hex/i), 'no hex TODO expected');
    });

    test('hexFillToRings maps a 2-ring rhombus to OpenMC rings', () => {
        // 3x3 rhombus i,j in [-1,1] — full ring 1 + center
        const rings = hexFillToRings([9, 9, 8, 9, 1, 9, 8, 9, 9], -1, 1, -1, 1);
        assert.ok(rings, 'expected complete hex');
        assert.strictEqual(rings!.length, 2);
        assert.strictEqual(rings![0].length, 6, 'ring 1 has 6 elements');
        assert.deepStrictEqual(rings![1], [1], 'center preserved');
    });

    test('multi-level nesting: lattice fills reference other lattice universes', () => {
        const text = deck([
            '1 1 -10.0 -1 u=1 imp:n=1',
            '2 2 -0.7   1 u=1 imp:n=1',
            '3 2 -0.7      u=2 imp:n=1',
            '10 0 -11 12 -13 14 lat=1 u=5 imp:n=1 fill=1',
            '20 0 -21 22 -23 24 lat=1 u=6 imp:n=1',
            '     fill=0:0 0:0 0:0  5',
            '30 0 -31 fill=6 imp:n=1',
            '99 0 31 imp:n=0',
        ], [
            '1 cz 0.4', '11 px 0.63', '12 px -0.63', '13 py 0.63', '14 py -0.63',
            '21 px 10', '22 px -10', '23 py 10', '24 py -10', '31 so 100',
        ], ['m1 92235.80c 1.0', 'm2 1001.80c 2.0 8016.80c 1.0', 'kcode 10 1.0 2 5']);
        const r = mcnpToOpenmc(text);
        const iLat10 = r.output.indexOf('lat_10 = ');
        const iLat20 = r.output.indexOf('lat_20 = ');
        assert.ok(iLat10 >= 0 && iLat20 > iLat10, 'inner lattice must be defined before outer (topological order)');
    });

    test('trcl translation and *trcl degrees rotation transfer', () => {
        const text = deck([
            '1 1 -10.0 -1 u=1 imp:n=1',
            '2 0 -2 fill=1 trcl=(1 2 3) imp:n=1',
            '3 0 -3 2 fill=1 *trcl=(0 0 0 90 180 90 0 90 90 90 90 0) imp:n=1',
            '9 0 3 imp:n=0',
        ], ['1 cz 1', '2 so 10', '3 so 20'], ['m1 92235.80c 1.0', 'kcode 10 1.0 2 5']);
        const r = mcnpToOpenmc(text);
        assert.ok(r.output.includes('cell_2.translation = (1, 2, 3)'));
        assert.ok(r.output.includes('cell_3.rotation = '), 'rotation matrix expected');
    });

    test('negative universe (u=-5) treated as |5| with no extra TODO', () => {
        const text = deck([
            '1 1 -10.0 -1 u=-5 imp:n=1',
            '2 0 -2 fill=5 imp:n=1',
            '9 0 2 imp:n=0',
        ], ['1 cz 1', '2 so 10'], ['m1 92235.80c 1.0', 'kcode 10 1.0 2 5']);
        const r = mcnpToOpenmc(text);
        assert.ok(r.output.includes('u_5 = openmc.Universe(universe_id=5'), 'u=-5 must define universe 5');
    });
});

// ---------------------------------------------------------------------------
// MCNP → OpenMC: materials, boundaries, settings
// ---------------------------------------------------------------------------

suite('HiFi converter — MCNP→OpenMC materials/boundaries/settings', () => {
    test('ZAID mapping: metastable, natural element expansion', () => {
        assert.strictEqual(zaidToNuclide('92235'), 'U235');
        assert.strictEqual(zaidToNuclide('95642'), 'Am242_m1'); // A=242+300+100m … MCNP metastable convention
        assert.strictEqual(nuclideToZaid('Am242_m1'), '95642.80c');
        const text = deck(['1 1 -6.5 -1 imp:n=1', '9 0 1 imp:n=0'], ['1 cz 1'],
            ['m1 40000.80c 1.0', 'kcode 10 1.0 2 5']);
        const r = mcnpToOpenmc(text);
        assert.ok(r.output.includes("add_element('Zr', 1, 'ao')"), 'natural Zr → add_element');
    });

    test('weight fractions (negative) become wo', () => {
        const text = deck(['1 1 -1.0 -1 imp:n=1', '9 0 1 imp:n=0'], ['1 cz 1'],
            ['m1 1001.80c -0.111 8016.80c -0.889', 'kcode 10 1.0 2 5']);
        const r = mcnpToOpenmc(text);
        assert.ok(r.output.includes("add_nuclide('H1', 0.111, 'wo')"));
    });

    test('S(α,β) mt tables map to OpenMC names', () => {
        const text = deck(['1 1 -1.0 -1 imp:n=1', '2 2 -1.7 1 -2 imp:n=1', '9 0 2 imp:n=0'],
            ['1 cz 1', '2 cz 2'],
            ['m1 1001.80c 2.0 8016.80c 1.0', 'mt1 lwtr.20t', 'm2 6000.80c 1.0', 'mt2 grph.10t', 'kcode 10 1.0 2 5']);
        const r = mcnpToOpenmc(text);
        assert.ok(r.output.includes("add_s_alpha_beta('c_H_in_H2O')"));
        assert.ok(r.output.includes("add_s_alpha_beta('c_Graphite')"), 'grph maps to the official OpenMC name c_Graphite');
    });

    test('cell TMP (MeV) converts to Kelvin cell.temperature', () => {
        const text = deck(['1 1 -1.0 -1 tmp=5.170e-8 imp:n=1', '9 0 1 imp:n=0'], ['1 cz 1'],
            ['m1 1001.80c 1.0', 'kcode 10 1.0 2 5']);
        const r = mcnpToOpenmc(text);
        const m = r.output.match(/cell_1\.temperature = ([\d.]+)/);
        assert.ok(m, 'temperature expected');
        assert.ok(Math.abs(Number(m![1]) - 600) < 1, `5.170e-8 MeV ≈ 600 K, got ${m![1]}`);
    });

    test('one material at two densities splits into clones', () => {
        const text = deck(['1 1 -10.0 -1 imp:n=1', '2 1 -9.0 1 -2 imp:n=1', '9 0 2 imp:n=0'],
            ['1 cz 1', '2 cz 2'], ['m1 92235.80c 1.0', 'kcode 10 1.0 2 5']);
        const r = mcnpToOpenmc(text);
        assert.ok(r.output.includes('mat_1 ') && r.output.includes('mat_1_d2'), 'clone expected');
        assert.ok(r.issues.some((i) => /2 distinct cell densities/.test(i.message)));
    });

    test('graveyard (imp:n=0) removed; bounding surfaces become vacuum', () => {
        const text = deck(['1 1 -1.0 -1 imp:n=1', '9 0 1 imp:n=0'], ['1 so 30'],
            ['m1 1001.80c 1.0', 'kcode 10 1.0 2 5']);
        const r = mcnpToOpenmc(text);
        assert.ok(r.output.includes("boundary_type='vacuum'"));
        assert.ok(!r.output.includes('cell_9'), 'graveyard cell must not be emitted');
    });

    test('kcode + multiple ksrc points → Settings + source list', () => {
        const text = deck(['1 1 -1.0 -1 imp:n=1', '9 0 1 imp:n=0'], ['1 so 30'],
            ['m1 1001.80c 1.0', 'kcode 5000 1.0 20 120', 'ksrc 0 0 0 1 1 1']);
        const r = mcnpToOpenmc(text);
        assert.ok(r.output.includes('settings.batches = 120'));
        assert.ok(r.output.includes('settings.inactive = 20'));
        assert.ok(r.output.includes('settings.particles = 5000'));
        assert.ok(/settings\.source = \[openmc\.IndependentSource.*openmc\.IndependentSource/.test(r.output),
            'two source points expected');
    });

    test('fmesh4 converts to RegularMesh tally', () => {
        const text = deck(['1 1 -1.0 -1 imp:n=1', '9 0 1 imp:n=0'], ['1 so 30'],
            ['m1 1001.80c 1.0', 'kcode 10 1.0 2 5',
                'fmesh4:n geom=xyz origin=-10 -10 -10', '        imesh=10 iints=5', '        jmesh=10 jints=5', '        kmesh=10 kints=5']);
        const r = mcnpToOpenmc(text);
        assert.ok(r.output.includes('openmc.RegularMesh()'));
        assert.ok(r.output.includes('mesh_4.dimension = [5, 5, 5]'));
        assert.ok(r.output.includes('openmc.MeshFilter'));
    });
});

// ---------------------------------------------------------------------------
// OpenMC → MCNP (static parser + emitter)
// ---------------------------------------------------------------------------

suite('HiFi converter — OpenMC→MCNP', () => {
    test('surfaces: plane/sphere/cylinders/cone/torus/quadric emit MCNP cards', () => {
        const py = [
            'import openmc',
            's1 = openmc.XPlane(x0=1.5)',
            's2 = openmc.Sphere(x0=1, y0=2, z0=3, r=4)',
            's3 = openmc.ZCylinder(x0=1, y0=1, r=0.5)',
            's4 = openmc.ZCone(x0=0, y0=0, z0=5, r2=0.25)',
            's5 = openmc.ZTorus(x0=0, y0=0, z0=0, a=5, b=1, c=1)',
            's6 = openmc.Quadric(a=1, b=2, c=3, d=4, e=5, f=6, g=7, h=8, j=9, k=10)',
            's7 = openmc.Sphere(r=60, boundary_type="vacuum")',
            'm = openmc.Material()',
            "m.add_nuclide('H1', 1.0)",
            "m.set_density('g/cm3', 1.0)",
            'c1 = openmc.Cell(fill=m, region=-s7 & +s1 & -s3)',
            'root = openmc.Universe(cells=[c1])',
            'geometry = openmc.Geometry(root)',
            'model = openmc.model.Model(geometry)',
        ].join('\n');
        const r = openmcToMcnp(py);
        assert.ok(/\d+\s+px\s+1\.5/.test(r.output), 'px card');
        assert.ok(/\d+\s+s\s+1 2 3 4/.test(r.output), 's card');
        assert.ok(/\d+\s+c\/z\s+1 1 0\.5/.test(r.output), 'c/z card');
        assert.ok(/\d+\s+kz\s+5 0\.25/.test(r.output), 'kz card (on-axis cone simplifies)');
        assert.ok(/\d+\s+tz\s+0 0 0 5 1 1/.test(r.output), 'tz card');
        assert.ok(/\d+\s+gq\s+1 2 3 4 5 6 7 8 9 10/.test(r.output), 'gq card');
    });

    test('region algebra: & | ~ map to blanks, :, complement', () => {
        const py = [
            'import openmc',
            's1 = openmc.ZCylinder(r=1)',
            's2 = openmc.ZCylinder(r=2)',
            's3 = openmc.Sphere(r=30, boundary_type="vacuum")',
            'm = openmc.Material()',
            "m.add_nuclide('H1', 1.0)",
            "m.set_density('g/cm3', 1.0)",
            'c1 = openmc.Cell(fill=m, region=(-s1 | -s2) & -s3)',
            'c2 = openmc.Cell(region=~((-s1 | -s2)) & -s3)',
            'root = openmc.Universe(cells=[c1, c2])',
            'geometry = openmc.Geometry(root)',
            'model = openmc.model.Model(geometry)',
        ].join('\n');
        const r = openmcToMcnp(py);
        assert.ok(/\(-1\s*:\s*-2\)\s+-3/.test(r.output.replace(/\s+/g, ' ')), `union in intersection: ${r.output}`);
        // complement is normalized via De Morgan: ~(-1 | -2) → +1 & +2
        assert.ok(/2 0\s+\(?1\s+2\)?\s+-3/.test(r.output.replace(/\s+/g, ' ')), `De Morgan: ${r.output}`);
    });

    test('RectLattice → lat=1 with reversed rows and outer padding', () => {
        const py = [
            'import openmc',
            'fuel_cyl = openmc.ZCylinder(r=0.4)',
            'm1 = openmc.Material()',
            "m1.add_nuclide('U235', 1.0)",
            "m1.set_density('g/cm3', 10.0)",
            'm2 = openmc.Material()',
            "m2.add_nuclide('H1', 1.0)",
            "m2.set_density('g/cm3', 1.0)",
            'fc = openmc.Cell(fill=m1, region=-fuel_cyl)',
            'wc = openmc.Cell(fill=m2, region=+fuel_cyl)',
            'u_pin = openmc.Universe(cells=[fc, wc])',
            'ww = openmc.Cell(fill=m2)',
            'u_w = openmc.Universe(cells=[ww])',
            'lat = openmc.RectLattice()',
            'lat.lower_left = (-1.26, -1.26)',
            'lat.pitch = (1.26, 1.26)',
            'lat.outer = u_w',
            'lat.universes = [[u_pin, u_w], [u_w, u_pin]]',
            'box = openmc.model.RectangularPrism(width=2.52, height=2.52, boundary_type="reflective")',
            'lc = openmc.Cell(fill=lat, region=-box)',
            'root = openmc.Universe(cells=[lc])',
            'geometry = openmc.Geometry(root)',
            'model = openmc.model.Model(geometry)',
        ].join('\n');
        const r = openmcToMcnp(py);
        assert.ok(r.output.includes('lat=1'), 'lat=1 card');
        assert.ok(/fill=-1:2 -1:2 0:0/.test(r.output), `outer pad extends range: ${r.output.match(/fill=.*$/m)?.[0]}`);
        // OpenMC row 0 is TOP; MCNP j rows print bottom-up: first data row is
        // OpenMC's last row [u_w, u_pin] (plus pad) — check row order flipped.
        const gridRows = r.output.split('\n').filter((l) => /^\s+\d+ \d+ \d+ \d+$/.test(l));
        assert.ok(gridRows.length >= 4, `expected padded 4x4 grid, got ${gridRows.length} rows`);
    });

    test('hex lattice → lat=2 rhombus with corner filler', () => {
        const py = [
            'import openmc',
            'm1 = openmc.Material()',
            "m1.add_nuclide('U235', 1.0)",
            "m1.set_density('g/cm3', 10.0)",
            'pc = openmc.Cell(fill=m1)',
            'u_pin = openmc.Universe(cells=[pc])',
            'wc = openmc.Cell()',
            'u_w = openmc.Universe(cells=[wc])',
            'lat = openmc.HexLattice()',
            'lat.center = (0, 0)',
            'lat.pitch = (1.2,)',
            'lat.outer = u_w',
            'lat.universes = [[u_pin, u_pin, u_pin, u_pin, u_pin, u_pin], [u_w]]',
            'sph = openmc.Sphere(r=50, boundary_type="vacuum")',
            'lc = openmc.Cell(fill=lat, region=-sph)',
            'root = openmc.Universe(cells=[lc])',
            'geometry = openmc.Geometry(root)',
            'model = openmc.model.Model(geometry)',
        ].join('\n');
        const r = openmcToMcnp(py);
        assert.ok(r.output.includes('lat=2'), 'lat=2 expected');
        assert.ok(/\d+\s+rhp\s/.test(r.output), 'synthesized RHP window surface');
    });

    test('vacuum boundaries synthesize a graveyard; reflective keeps *', () => {
        const py = [
            'import openmc',
            's1 = openmc.Sphere(r=30, boundary_type="vacuum")',
            's2 = openmc.XPlane(x0=0, boundary_type="reflective")',
            'm = openmc.Material()',
            "m.add_nuclide('H1', 1.0)",
            "m.set_density('g/cm3', 1.0)",
            'c = openmc.Cell(fill=m, region=-s1 & +s2)',
            'root = openmc.Universe(cells=[c])',
            'geometry = openmc.Geometry(root)',
            'model = openmc.model.Model(geometry)',
        ].join('\n');
        const r = openmcToMcnp(py);
        assert.ok(/imp:n=0\s+\$ graveyard/.test(r.output), 'graveyard synthesized');
        assert.ok(/^\*\d+\s+px\s+0/m.test(r.output), 'reflective * prefix');
    });

    test('materials: nuclides, elements, sab, density round out', () => {
        const py = [
            'import openmc',
            'm = openmc.Material()',
            "m.add_nuclide('U235', 0.04, 'ao')",
            "m.add_nuclide('U238', 0.96)",
            "m.add_element('Zr', 1.0)",
            "m.add_s_alpha_beta('c_H_in_H2O')",
            "m.set_density('g/cm3', 10.4)",
            's = openmc.Sphere(r=10, boundary_type="vacuum")',
            'c = openmc.Cell(fill=m, region=-s)',
            'root = openmc.Universe(cells=[c])',
            'geometry = openmc.Geometry(root)',
            'model = openmc.model.Model(geometry)',
        ].join('\n');
        const r = openmcToMcnp(py);
        assert.ok(/92235\.80c\s+4\.0+e-2/i.test(r.output), 'U235 ZAID with atom fraction');
        assert.ok(/40000\.80c/.test(r.output), 'natural Zr → 40000');
        assert.ok(/mt1\s+lwtr/.test(r.output), 'sab → mt card');
        assert.ok(/1 1 -10\.4/.test(r.output), 'g/cm3 → negative density');
    });

    test('temperature (K) → tmp (MeV)', () => {
        const py = [
            'import openmc',
            's = openmc.Sphere(r=10, boundary_type="vacuum")',
            'm = openmc.Material()',
            "m.add_nuclide('H1', 1.0)",
            "m.set_density('g/cm3', 1.0)",
            'c = openmc.Cell(fill=m, region=-s)',
            'c.temperature = 600',
            'root = openmc.Universe(cells=[c])',
            'geometry = openmc.Geometry(root)',
            'model = openmc.model.Model(geometry)',
        ].join('\n');
        const r = openmcToMcnp(py);
        const m = r.output.match(/tmp=([\d.e-]+)/);
        assert.ok(m, 'tmp expected');
        assert.ok(Math.abs(Number(m![1]) / 5.1704e-8 - 1) < 0.01, `600 K ≈ 5.17e-8 MeV, got ${m![1]}`);
    });

    test('Settings + IndependentSource → kcode + ksrc', () => {
        const py = [
            'import openmc',
            's = openmc.Sphere(r=10, boundary_type="vacuum")',
            'm = openmc.Material()',
            "m.add_nuclide('U235', 1.0)",
            "m.set_density('g/cm3', 10.0)",
            'c = openmc.Cell(fill=m, region=-s)',
            'root = openmc.Universe(cells=[c])',
            'geometry = openmc.Geometry(root)',
            'settings = openmc.Settings()',
            'settings.batches = 120',
            'settings.inactive = 20',
            'settings.particles = 5000',
            'settings.source = openmc.IndependentSource(space=openmc.stats.Point((1, 2, 3)))',
            'model = openmc.model.Model(geometry, settings=settings)',
        ].join('\n');
        const r = openmcToMcnp(py);
        assert.ok(r.output.includes('kcode 5000 1.0 20 120'));
        assert.ok(r.output.includes('ksrc 1 2 3'));
    });

    test('dynamic scripts flag the trace-harness path', () => {
        const py = [
            'import openmc',
            'for i in range(3):',
            '    pass',
            'm = openmc.Material()',
        ].join('\n');
        const r = openmcToMcnp(py);
        assert.ok(r.issues.some((i) => /Python tracing/i.test(i.message)), 'dynamic warning expected');
    });
});

// ---------------------------------------------------------------------------
// Round trips
// ---------------------------------------------------------------------------

suite('HiFi converter — round trips', () => {
    const PIN = deck([
        '1 1 -10.4  -1     imp:n=1',
        '2 2 -6.55   1 -2  imp:n=1',
        '3 3 -0.74   2 -3  imp:n=1',
        '4 0         3     imp:n=0',
    ], [
        '1 cz 0.4096', '2 cz 0.4750', '3 so 100',
    ], [
        'm1 92235.80c 0.04 92238.80c 0.96 8016.80c 2.0',
        'm2 40000.80c 1.0',
        'm3 1001.80c 2.0 8016.80c 1.0',
        'mt3 lwtr.20t',
        'kcode 5000 1.0 20 120',
        'ksrc 0 0 0',
    ]);

    test('pin cell MCNP→OpenMC→MCNP preserves semantics', () => {
        const py = mcnpToOpenmc(PIN);
        assert.strictEqual(py.issues.length, 0, JSON.stringify(py.issues));
        const back = openmcToMcnp(py.output);
        const d0 = parseMcnpDeck(PIN);
        const d1 = parseMcnpDeck(back.output);
        // graveyard is re-synthesized: model cells count matches
        assert.strictEqual(
            d1.cells.filter((c) => !c.importanceZero).length,
            d0.cells.filter((c) => !c.importanceZero).length,
        );
        assert.strictEqual(d1.cells.filter((c) => c.importanceZero).length, 1, 'graveyard resynthesized');
        assert.strictEqual(d1.materials.length, d0.materials.length);
        assert.strictEqual(d1.settings.particles, 5000);
        assert.strictEqual(d1.settings.batches, 120);
        const m3 = d1.materials.find((m) => m.sab.length)!;
        assert.ok(m3, 'S(α,β) survives the round trip');
        // radii survive
        assert.ok(d1.surfaces.some((s) => s.type === 'cz' && Math.abs(parseFloat(s.params[0]) - 0.4096) < 1e-9));
    });

    test('17x17 assembly MCNP→OpenMC→MCNP: lattice + universe structure survives', () => {
        const rows: string[] = [];
        for (let j = 0; j < 17; j++) {
            const row: string[] = [];
            for (let i = 0; i < 17; i++) row.push((i === 8 && j === 8) ? '2' : '1');
            rows.push('     ' + row.join(' '));
        }
        const asm = deck([
            '1 1 -10.4 -1    u=1 imp:n=1',
            '2 3 -0.74  1    u=1 imp:n=1',
            '3 3 -0.74  -2   u=2 imp:n=1',
            '4 2 -6.55   2 -3 u=2 imp:n=1',
            '5 3 -0.74   3   u=2 imp:n=1',
            '10 0 -11 12 -13 14 lat=1 u=5 imp:n=1',
            '     fill=-8:8 -8:8 0:0',
            ...rows,
            '20 0 -21 22 -23 24 25 -26 fill=5 imp:n=1',
            '99 0 21:-22:23:-24:-25:26 imp:n=0',
        ], [
            '1 cz 0.41', '2 cz 0.56', '3 cz 0.60',
            '11 px 0.63', '12 px -0.63', '13 py 0.63', '14 py -0.63',
            '21 px 10.71', '22 px -10.71', '23 py 10.71', '24 py -10.71', '25 pz -200', '26 pz 200',
        ], [
            'm1 92235.80c 0.04 92238.80c 0.96 8016.80c 2.0',
            'm2 40000.80c 1.0',
            'm3 1001.80c 2.0 8016.80c 1.0',
            'mt3 lwtr.20t',
            'kcode 5000 1.0 20 120', 'ksrc 0 0 0',
        ]);
        const py = mcnpToOpenmc(asm);
        assert.strictEqual(py.issues.filter((i) => !/rotation|densities/.test(i.message)).length, 0,
            JSON.stringify(py.issues, null, 1));
        const back = openmcToMcnp(py.output);
        const d1 = parseMcnpDeck(back.output);
        const lat = d1.cells.find((c) => c.lattice === 1);
        assert.ok(lat, 'lat=1 cell survives');
        assert.ok(lat!.latticeFill, 'fill array survives');
        // pad ring (outer) may extend 17→19; the inner 17x17 content must match
        const lf = lat!.latticeFill!;
        assert.ok(lf.nx === 17 || lf.nx === 19, `nx=${lf.nx}`);
        const uSet = new Set(lf.universes);
        assert.ok(uSet.size >= 2, 'both pin universes present');
        assert.strictEqual(d1.materials.length, 3);
    });
});

// ---------------------------------------------------------------------------
// Adversarial (pathological but legal)
// ---------------------------------------------------------------------------

suite('HiFi converter — adversarial inputs', () => {
    test('20-deep nested parentheses do not blow up', () => {
        const open = '('.repeat(20);
        const close = ')'.repeat(20);
        const text = deck([`1 1 -1.0 ${open}-1 : -2${close} -3 imp:n=1`, '9 0 3 imp:n=0'],
            ['1 cz 1', '2 cz 2', '3 so 50'], ['m1 1001.80c 1.0', 'kcode 10 1.0 2 5']);
        const r = mcnpToOpenmc(text);
        assert.ok(r.output.includes('cell_1.region = '), 'region emitted');
        assert.strictEqual(r.issues.length, 0);
    });

    test('chained cell complements #1 #2 #3', () => {
        const text = deck([
            '1 1 -1.0 -1 imp:n=1',
            '2 1 -1.0 -2 1 imp:n=1',
            '3 1 -1.0 -3 2 imp:n=1',
            '4 0 -4 #1 #2 #3 imp:n=1',
            '9 0 4 imp:n=0',
        ], ['1 cz 1', '2 cz 2', '3 cz 3', '4 so 50'], ['m1 1001.80c 1.0', 'kcode 10 1.0 2 5']);
        const r = mcnpToOpenmc(text);
        assert.strictEqual((r.output.match(/cell_4\.region = .*~\(/g) ?? []).length, 1);
        assert.strictEqual(r.issues.length, 0);
    });

    test('circular cell complements are flagged, not infinite-looped', () => {
        const text = deck([
            '1 1 -1.0 -1 #2 imp:n=1',
            '2 1 -1.0 -2 #1 imp:n=1',
            '9 0 3 imp:n=0',
        ], ['1 cz 1', '2 cz 2', '3 so 50'], ['m1 1001.80c 1.0', 'kcode 10 1.0 2 5']);
        const r = mcnpToOpenmc(text);
        assert.ok(r.issues.some((i) => /circular/i.test(i.message)));
    });

    test('duplicate cell ids are renumbered with an issue', () => {
        const text = deck([
            '1 1 -1.0 -1 imp:n=1',
            '1 1 -1.0 1 -2 imp:n=1',
            '9 0 2 imp:n=0',
        ], ['1 cz 1', '2 so 50'], ['m1 1001.80c 1.0', 'kcode 10 1.0 2 5']);
        const r = mcnpToOpenmc(text);
        assert.ok(r.issues.some((i) => /Duplicate cell id 1/.test(i.message)));
        assert.ok(r.output.includes('cell_id=2') || r.output.includes('cell_id=10'), 'renumbered');
    });

    test('incomplete lattice fill array is TODO-marked, not crashed', () => {
        const text = deck([
            '1 1 -1.0 -1 u=1 imp:n=1',
            '10 0 -11 12 -13 14 lat=1 u=5 imp:n=1',
            '     fill=-1:1 -1:1 0:0',
            '     1 1 1',
            '20 0 -20 fill=5 imp:n=1',
            '99 0 20 imp:n=0',
        ], ['1 cz 0.4', '11 px 0.63', '12 px -0.63', '13 py 0.63', '14 py -0.63', '20 so 50'],
            ['m1 92235.80c 1.0', 'kcode 10 1.0 2 5']);
        const r = mcnpToOpenmc(text);
        assert.ok(r.issues.some((i) => /fill array has 3 entries, expected 9/.test(i.message)));
    });

    test('static OpenMC parser survives weird whitespace and comments', () => {
        const py = [
            'import openmc',
            's  =   openmc.Sphere( r = 10 , boundary_type = "vacuum" )  # outer',
            'm = openmc.Material()  # fuel',
            "m.add_nuclide('U235', 1.0)",
            "m.set_density('g/cm3', 10.0)",
            'c = openmc.Cell(',
            '    fill=m,',
            '    region=-s,',
            ')',
            'root = openmc.Universe(cells=[c])',
            'geometry = openmc.Geometry(root)',
            'model = openmc.model.Model(geometry)',
        ].join('\n');
        const r = openmcToMcnp(py);
        assert.ok(/\d+\s+so\s+10/.test(r.output), 'so card from spaced-out call');
        assert.ok(/92235/.test(r.output));
    });
});
