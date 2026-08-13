/**
 * Stage-1/2/3/4 geometry engine tests (geometry-preview plan).
 *
 * Every section-numbered case cites the MCNP 6.3.1 manual (LA-UR-24-24602
 * Rev. 1). The macrobody listings (5.3–5.12) come straight from §5.3.4's
 * example file, and the combined cell-expression deck is the §5.3.4.11.1
 * example — facets, LIKE n BUT, TRCL generated surfaces, unions and cell
 * complements, all probed against hand-derived point memberships.
 */
import * as assert from 'assert';
import { parseMcnpGeometry, Shape } from '../../preview/mcnpGeometry';
import {
    cellContains,
    findCell,
    surfaceValue,
    worldBounds,
} from '../../preview/mcnpEvaluate';
import { axisPlane, defaultWindow, identifyAt, sliceModel, SLICE_LOST, SLICE_OVERLAP } from '../../preview/slice';
import { buildCsgScene } from '../../preview/csgScene';
import { Component } from '../../preview/types';

type V3 = [number, number, number];

/** Deterministic LCG so volume checks are reproducible. */
function makeRng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0xffffffff;
    };
}

function deck(lines: string[]): string {
    return lines.join('\n');
}

suite('MCNP geometry engine — surfaces (§5.3.1, Table 5.1)', () => {
    function surfOf(text: string, id: number) {
        const model = parseMcnpGeometry(deck(['t', '1 0 -1', '', text, '', 'mode n']));
        const s = model.surfaces.get(id);
        assert.ok(s, `surface ${id} should parse from: ${text}`);
        return s!;
    }

    test('px/py/pz planes: sense negative below the plane coordinate', () => {
        const s = surfOf('7 pz 3.5', 7);
        assert.ok(surfaceValue(s, 0, [0, 0, 3.0]) < 0);
        assert.ok(surfaceValue(s, 0, [0, 0, 4.0]) > 0);
    });

    test('p with 4 entries is the general plane Ax+By+Cz−D', () => {
        const s = surfOf('3 p 1 1 0 2', 3);
        assert.ok(surfaceValue(s, 0, [0, 0, 0]) < 0);
        assert.ok(surfaceValue(s, 0, [2, 2, 0]) > 0);
    });

    test('p with 9 entries (3-point plane): origin gets negative sense (§5.3.3)', () => {
        // Plane z = 1 via three points.
        const s = surfOf('4 p 0 0 1  1 0 1  0 1 1', 4);
        assert.ok(surfaceValue(s, 0, [0, 0, 0]) < 0, 'origin must be negative');
        assert.ok(surfaceValue(s, 0, [0, 0, 2]) > 0);
    });

    test('so/s/sx/sy/sz spheres', () => {
        const so = surfOf('1 so 2', 1);
        assert.ok(surfaceValue(so, 0, [1, 0, 0]) < 0);
        assert.ok(surfaceValue(so, 0, [3, 0, 0]) > 0);
        const s = surfOf('2 s 1 2 3 1.5', 2);
        assert.ok(surfaceValue(s, 0, [1, 2, 3]) < 0);
        assert.ok(surfaceValue(s, 0, [1, 2, 4.6]) > 0);
        const sx = surfOf('3 sx 5 1', 3);
        assert.ok(surfaceValue(sx, 0, [5.5, 0, 0]) < 0);
        assert.ok(surfaceValue(sx, 0, [6.5, 0, 0]) > 0);
    });

    test('cz/cx/cy and c/z off-axis cylinders', () => {
        const cz = surfOf('1 cz 0.5', 1);
        assert.ok(surfaceValue(cz, 0, [0.3, 0, 99]) < 0, 'infinite along z');
        assert.ok(surfaceValue(cz, 0, [0.6, 0, 0]) > 0);
        const coz = surfOf('2 c/z 1 1 0.5', 2);
        assert.ok(surfaceValue(coz, 0, [1.2, 1, 5]) < 0);
        assert.ok(surfaceValue(coz, 0, [0, 0, 0]) > 0);
        const cx = surfOf('3 cx 2', 3);
        assert.ok(surfaceValue(cx, 0, [123, 1, 1]) < 0, 'infinite along x');
        assert.ok(surfaceValue(cx, 0, [0, 2.5, 0]) > 0);
    });

    test('kz cone: two-sheet by default, one sheet with the ±1 selector', () => {
        const two = surfOf('1 kz 0 0.25', 1); // t² = 0.25 → half-angle atan(0.5)
        assert.ok(surfaceValue(two, 0, [0.4, 0, 1]) < 0, 'inside upper sheet');
        assert.ok(surfaceValue(two, 0, [0.4, 0, -1]) < 0, 'inside lower sheet (two-sheet)');
        const upper = surfOf('2 kz 0 0.25 1', 2);
        assert.ok(surfaceValue(upper, 0, [0.4, 0, 1]) < 0, 'inside selected +1 sheet');
        assert.ok(surfaceValue(upper, 0, [0.4, 0, -1]) > 0, 'below apex is outside the +1 sheet');
    });

    test('sq surface: A(x−x̄)² … form (§5.3.1)', () => {
        // Unit sphere at (1,0,0): 1(x−1)²+1y²+1z²−1 = 0.
        const s = surfOf('9 sq 1 1 1 0 0 0 -1 1 0 0', 9);
        assert.ok(surfaceValue(s, 0, [1, 0, 0]) < 0);
        assert.ok(surfaceValue(s, 0, [2.5, 0, 0]) > 0);
    });

    test('gq surface: raw quadric coefficients', () => {
        // x² + y² − 1 = 0 (unit z-cylinder).
        const s = surfOf('8 gq 1 1 0 0 0 0 0 0 0 -1', 8);
        assert.ok(surfaceValue(s, 0, [0.5, 0.5, 7]) < 0);
        assert.ok(surfaceValue(s, 0, [1.2, 0, 0]) > 0);
    });

    test('tz torus: inside the tube is negative', () => {
        const s = surfOf('5 tz 0 0 0 3 0.5 0.5', 5);
        assert.ok(surfaceValue(s, 0, [3, 0, 0]) < 0, 'tube center');
        assert.ok(surfaceValue(s, 0, [3, 0, 0.4]) < 0, 'inside tube');
        assert.ok(surfaceValue(s, 0, [3, 0, 0.6]) > 0, 'outside tube');
        assert.ok(surfaceValue(s, 0, [0, 0, 0]) > 0, 'hole is outside');
    });

    test('x-axisymmetric point surfaces: 1 pair = plane, 2 pairs = cone/cylinder (§5.3.2)', () => {
        const pl = surfOf('1 x 4 0', 1); // single pair → plane x=4
        assert.ok(surfaceValue(pl, 0, [3, 0, 0]) < 0);
        const cyl = surfOf('2 x 0 2 5 2', 2); // r constant → cylinder r=2 about x-axis
        assert.ok(surfaceValue(cyl, 0, [2.5, 1, 0]) < 0);
        assert.ok(surfaceValue(cyl, 0, [2.5, 3, 0]) > 0);
        const cone = surfOf('3 x 0 0 5 5', 3); // r = s → 45° cone from origin
        assert.ok(surfaceValue(cone, 0, [2, 1, 0]) < 0);
        assert.ok(surfaceValue(cone, 0, [2, 3, 0]) > 0);
    });
});

suite('MCNP geometry engine — macrobodies (§5.3.4, Listings 5.3–5.12)', () => {
    function modelWith(surfCards: string[], cellGeom: string) {
        return parseMcnpGeometry(deck([
            'macrobody test', `1 1 -1.0 ${cellGeom} imp:n=1`, '2 0 #1 imp:n=0', '',
            ...surfCards, '', 'm1 1001.80c 1',
        ]));
    }

    test('Listing 5.3 BOX ≡ Listing 5.4 RPP ≡ Listing 5.12 ARB (same 1×2×3 box)', () => {
        // All three describe a 1×2×3 box; BOX at origin-centered, RPP/ARB at
        // x∈[1,2] / x∈[15.5,16.5] — recentered here on the same span for a
        // point-by-point membership cross-check (the manual calls them
        // equivalent bodies).
        const mBox = modelWith(['10 box -0.5 -1 -1.5 1 0 0 0 2 0 0 0 3'], '-10');
        const mRpp = modelWith(['10 rpp -0.5 0.5 -1 1 -1.5 1.5'], '-10');
        const mArb = modelWith([
            '10 arb -0.5 -1 -1.5  0.5 -1 -1.5  0.5 1 -1.5  -0.5 1 -1.5',
            '      -0.5 -1 1.5  0.5 -1 1.5  0.5 1 1.5  -0.5 1 1.5',
            '      1458 2367 1256 3478 1234 5678',
        ], '-10');
        const rng = makeRng(42);
        let checked = 0;
        for (let i = 0; i < 4000; i++) {
            const p: V3 = [(rng() - 0.5) * 2.4, (rng() - 0.5) * 4.4, (rng() - 0.5) * 6.6];
            const inBox = cellContains(mBox, 1, p);
            const inRpp = cellContains(mRpp, 1, p);
            const inArb = cellContains(mArb, 1, p);
            assert.strictEqual(inBox, inRpp, `BOX vs RPP disagree at ${p}`);
            assert.strictEqual(inRpp, inArb, `RPP vs ARB disagree at ${p}`);
            checked++;
        }
        assert.ok(checked === 4000);
    });

    test('Listing 5.6 RCC: inside/outside + facet references (Table 5.2)', () => {
        const m = modelWith(['20 rcc 3 0 -1.5 0 0 3 0.5'], '-20');
        assert.ok(cellContains(m, 1, [3, 0, 0]));
        assert.ok(cellContains(m, 1, [3.4, 0, 1.4]));
        assert.ok(!cellContains(m, 1, [3.6, 0, 0]), 'outside radius');
        assert.ok(!cellContains(m, 1, [3, 0, 1.6]), 'above the cap');
        // Facet senses: .1 lateral, .2 top, .3 bottom — inside is negative.
        const s = m.surfaces.get(20)!;
        assert.ok(surfaceValue(s, 1, [3, 0, 0]) < 0);
        assert.ok(surfaceValue(s, 2, [3, 0, 0]) < 0);
        assert.ok(surfaceValue(s, 2, [3, 0, 2]) > 0, 'beyond the h end is positive w.r.t. facet 2');
        assert.ok(surfaceValue(s, 3, [3, 0, -2]) > 0);
    });

    test('Listing 5.7 RHP 9-entry (regular hex, r ⊥ y, pitch 1.0)', () => {
        const m = modelWith(['30 rhp 4.5 0 -1.5 0 0 3 0 0.5 0'], '-30');
        assert.ok(cellContains(m, 1, [4.5, 0, 0]), 'center');
        assert.ok(cellContains(m, 1, [4.5, 0.45, 0]), 'inside the first facet (y at 0.45 < 0.5)');
        assert.ok(!cellContains(m, 1, [4.5, 0.55, 0]), 'past the first facet');
        assert.ok(!cellContains(m, 1, [4.5, 0, 1.6]), 'above the top (facet 7)');
        // Flat-to-flat across x for this orientation is 2·0.5/cos(30°)·…: the
        // corner radius = r/cos(30°) ≈ 0.577; a point at x offset 0.56 from
        // the axis is inside the corner region but outside at 0.60.
        assert.ok(cellContains(m, 1, [4.5 + 0.56, 0, 0]));
        assert.ok(!cellContains(m, 1, [4.5 + 0.60, 0, 0]));
    });

    test('Listing 5.7 HEX 15-entry (irregular hexagon) parses and contains its center', () => {
        const m = modelWith(['31 hex 6.0 2 -1.5 0 0 3 0.5 0 0 0.4 0.69282 0.0 -0.4 0.69282 0.0'], '-31');
        assert.ok(cellContains(m, 1, [6.0, 2.0, 0]));
        assert.ok(!cellContains(m, 1, [6.7, 2.0, 0]));
    });

    test('Listing 5.9 TRC truncated cones (both orientations)', () => {
        const up = modelWith(['40 trc 9 -1 0 0 2 0 0.15 0.5'], '-40'); // widens toward +y
        assert.ok(cellContains(up, 1, [9, 0.9, 0.4]), 'near the wide end');
        assert.ok(!cellContains(up, 1, [9, -0.9, 0.4]), 'wide radius near the narrow end');
        assert.ok(cellContains(up, 1, [9, -0.9, 0.1]));
        const down = modelWith(['41 trc 10.5 -1 0 0 2 0 0.5 0.15'], '-41'); // narrows toward +y
        assert.ok(cellContains(down, 1, [10.5, -0.9, 0.4]));
        assert.ok(!cellContains(down, 1, [10.5, 0.9, 0.4]));
    });

    test('Listing 5.10 ELL: focus form (r>0) and center form (r<0)', () => {
        const focus = modelWith(['50 ell 13.5 -0.5 0 13.5 0.5 0 0.75'], '-50');
        assert.ok(cellContains(focus, 1, [13.5, 0, 0]), 'center of the focus form');
        assert.ok(cellContains(focus, 1, [13.5, 0.7, 0]), 'inside along major axis');
        assert.ok(!cellContains(focus, 1, [13.5, 0.8, 0]), 'outside beyond major radius 0.75');
        const center = modelWith(['51 ell 12 0 0 0 1 0 -0.5'], '-51');
        assert.ok(cellContains(center, 1, [12, 0.9, 0]), 'inside along the major (y) axis');
        assert.ok(!cellContains(center, 1, [12, 0, 0.6]), 'outside the 0.5 minor radius');
    });

    test('Listing 5.11 WED: right-angle wedge membership', () => {
        // v=(14.75,-1,-1.5), v1=(0,2,0), v2=(0.5,0,0), v3=(0,0,3):
        // base triangle y∈[-1,1], x∈[14.75, 15.25] with x-extent shrinking as
        // y grows (hypotenuse from (14.75+0.5,-1) to (14.75,1)).
        const m = modelWith(['60 wed 14.75 -1 -1.5 0 2 0 0.5 0 0 0 0 3'], '-60');
        assert.ok(cellContains(m, 1, [14.85, -0.5, 0]), 'deep inside the triangle');
        assert.ok(!cellContains(m, 1, [15.2, 0.9, 0]), 'outside the hypotenuse');
        assert.ok(!cellContains(m, 1, [14.85, -0.5, 2]), 'above the height');
    });

    test('RPP with an infinite dimension renumbers facets down by two (§5.3.4.11)', () => {
        // xmin = xmax → infinite in x; facet 1 becomes ymax.
        const m = modelWith(['70 rpp 0 0 -1 1 -2 2'], '-70');
        const s = m.surfaces.get(70)!;
        assert.strictEqual((s.shape as Extract<Shape, { kind: 'body' }>).facets.length, 4);
        assert.ok(surfaceValue(s, 1, [123, 0.5, 0]) < 0, 'facet 1 = ymax plane after renumbering');
        assert.ok(surfaceValue(s, 1, [0, 1.5, 0]) > 0);
        assert.ok(cellContains(m, 1, [999, 0, 0]), 'infinite along x');
    });
});

suite('MCNP geometry engine — cells, facets, LIKE/BUT, TRCL (§5.3.4.11.1 example)', () => {
    // The manual's macrobody geometry example, verbatim: five cells built
    // from two RPPs and a py plane, using facet references, a LIKE 1 BUT
    // TRCL copy, generated surfaces (2001.x), a union and a cell complement.
    const EXAMPLE = deck([
        'macrobody example §5.3.4.11.1',
        '3 0 -1.2 -1.1 1.4 -1.5 -1.6 99',
        '4 0 1.1 -2001.1 -5.3 -5.5 -5.6 -5.4',
        '5 0 -5',
        '1 0 -1',
        '2 like 1 but trcl = (2 0 0)',
        '9 0 (-5.1:1.3:2001.1:-99:5.5:5.6) #5',
        '',
        '5 rpp -2 0 -2 0 -1 1',
        '1 rpp 0 2 0 2 -1 1',
        '99 py -2',
        '',
        'mode n',
    ]);

    test('parses all six cells and registers the generated 2001.x surfaces', () => {
        const model = parseMcnpGeometry(EXAMPLE);
        assert.strictEqual(model.cells.size, 6);
        assert.ok(model.generatedSurfaces.has(2001), '1000×cell 2 + surface 1');
    });

    test('hand-derived point memberships all resolve to the right cell', () => {
        const model = parseMcnpGeometry(EXAMPLE);
        const probes: [V3, number][] = [
            [[1, 1, 0], 1],       // inside box 1
            [[3, 1, 0], 2],       // the LIKE 1 BUT trcl (2 0 0) copy
            [[-1, -1, 0], 5],     // inside box 5
            [[1, -1, 0], 3],      // south of box 1
            [[3, -1, 0], 4],      // south of box 2, east of box 1 (via 2001.1)
            [[5, 0, 0], 9],       // beyond the shifted box: outside world
            [[-1, -1, 2], 9],     // above the slab (5.5 side) and not in cell 5
            [[-3, 1, 0], 9],      // west of everything (−5.1 side)
        ];
        for (const [p, want] of probes) {
            const found = findCell(model, p);
            assert.ok(found.cell, `point ${p} should land in a cell`);
            assert.strictEqual(found.cell!.id, want, `point ${p} → cell ${found.cell!.id}, expected ${want}`);
            assert.strictEqual(found.overlaps.length, 1, `point ${p} must be claimed exactly once, got ${found.overlaps}`);
        }
    });

    test('the six cells tile space: random points are claimed exactly once', () => {
        const model = parseMcnpGeometry(EXAMPLE);
        const rng = makeRng(7);
        let lost = 0;
        for (let i = 0; i < 3000; i++) {
            const p: V3 = [(rng() - 0.5) * 12, (rng() - 0.5) * 12, (rng() - 0.5) * 6];
            const found = findCell(model, p);
            if (!found.cell) { lost++; continue; }
            assert.ok(found.overlaps.length <= 1, `overlap at ${p}: cells ${found.overlaps}`);
        }
        assert.strictEqual(lost, 0, 'the example deck covers all space (cell 9 is the exterior)');
    });
});

suite('MCNP geometry engine — transforms (§5.5.3)', () => {
    test('Example 1: RCC displaced to (20,0,0) by *TR4 (rotation in degrees)', () => {
        const model = parseMcnpGeometry(deck([
            'tr example',
            '1 1 -1 -17 imp:n=1',
            '2 0 17 imp:n=0',
            '',
            '17 4 rcc 0 0 0 0 12 0 5',
            '',
            '*tr4 20 0 0 45 -45 90 135 45 90 90 90 0',
            'm1 1001.80c 1',
        ]));
        // The base center lands at (20,0,0); the axis (originally +y, length
        // 12) rotates 45° CCW in the x–y plane → midpoint ≈ (20−4.24, 4.24, 0).
        assert.ok(cellContains(model, 1, [20 - 4.24, 4.24, 0]), 'point on the rotated axis');
        assert.ok(!cellContains(model, 1, [20, 11, 0]), 'the un-rotated axis position is now outside');
        assert.ok(cellContains(model, 1, [20, 0.5, 0]), 'just above the displaced base');
    });

    test('surface TR by reference: cz shifted via tr1 translation', () => {
        const model = parseMcnpGeometry(deck([
            't', '1 1 -1 -3 imp:n=1', '2 0 3 imp:n=0', '',
            '3 1 cz 0.5', '',
            'tr1 10 0 0', 'm1 1001.80c 1',
        ]));
        assert.ok(cellContains(model, 1, [10.2, 0, 5]), 'cylinder now centered at x=10');
        assert.ok(!cellContains(model, 1, [0.2, 0, 5]), 'original location empty');
    });

    test('inline trcl on a cell shifts its region', () => {
        const model = parseMcnpGeometry(deck([
            't', '1 1 -1 -3 trcl=(0 5 0) imp:n=1', '2 0 3 imp:n=0', '',
            '3 so 1', '', 'm1 1001.80c 1',
        ]));
        assert.ok(cellContains(model, 1, [0, 5.5, 0]));
        assert.ok(!cellContains(model, 1, [0, 0.5, 0]));
    });
});

suite('MCNP geometry engine — lattices and fills (§5.5.5)', () => {
    const LAT3 = deck([
        '3x3 square lattice',
        '1 1 -10 -1 u=1 imp:n=1',
        '2 0 1 u=1 imp:n=1',
        '10 0 -11 12 -13 14 lat=1 u=5 fill=-1:1 -1:1 0:0',
        '     2 1 2  1 1 1  2 1 2 imp:n=1',
        '20 0 -21 fill=5 imp:n=1',
        '99 0 21 imp:n=0',
        '',
        '1 cz 0.4',
        '11 px 0.63',
        '12 px -0.63',
        '13 py 0.63',
        '14 py -0.63',
        '21 so 10',
        '',
        'm1 92235.80c 1',
    ]);
    // Universe 2 is not defined: fill entries pointing at it keep the lattice
    // cell's own (void) material — the corner positions read as "no pin".

    test('center element (0,0) holds the pin universe; corners fall through', () => {
        const model = parseMcnpGeometry(LAT3);
        const center = findCell(model, [0, 0, 0]);
        assert.ok(center.cell);
        assert.strictEqual(center.cell!.id, 1, 'pin fuel cell at the lattice center');
        // Element (1,1) at (1.26, 1.26): filled with undefined universe 2 →
        // resolves to the lattice cell itself.
        const corner = findCell(model, [1.26, 1.26, 0]);
        assert.ok(corner.cell);
        assert.strictEqual(corner.cell!.id, 10);
    });

    test('element-local coordinates: pin surface respected inside element (0,1)', () => {
        const model = parseMcnpGeometry(LAT3);
        const inPin = findCell(model, [0, 1.26, 0]);          // center of north element
        assert.strictEqual(inPin.cell!.id, 1);
        const inWater = findCell(model, [0.5, 1.26, 0]);      // radially outside that pin
        assert.strictEqual(inWater.cell!.id, 2);
        assert.deepStrictEqual(inPin.latticeIndices[0], [0, 1, 0]);
    });

    test('nR repeats expand inside fill arrays', () => {
        const model = parseMcnpGeometry(deck([
            'repeat fill',
            '1 1 -10 -1 u=1 imp:n=1',
            '2 0 1 u=1 imp:n=1',
            '10 0 -11 12 -13 14 lat=1 u=5 fill=-1:1 -1:1 0:0 1 8r imp:n=1',
            '20 0 -21 fill=5 imp:n=1',
            '99 0 21 imp:n=0',
            '',
            '1 cz 0.4', '11 px 0.63', '12 px -0.63', '13 py 0.63', '14 py -0.63', '21 so 10',
            '', 'm1 92235.80c 1',
        ]));
        for (const [x, y] of [[0, 0], [1.26, 0], [-1.26, 1.26]] as [number, number][]) {
            const f = findCell(model, [x, y, 0]);
            assert.strictEqual(f.cell!.id, 1, `pin expected at (${x}, ${y})`);
        }
    });

    test('lat=2 hexagonal window resolves neighbors on the rhombic basis', () => {
        const model = parseMcnpGeometry(deck([
            'hex lattice',
            '1 1 -10 -1 u=1 imp:n=1',
            '2 0 1 u=1 imp:n=1',
            '10 0 -30 lat=2 u=5 fill=-1:1 -1:1 0:0 1 1 1 1 1 1 1 1 1 imp:n=1',
            '20 0 -21 fill=5 imp:n=1',
            '99 0 21 imp:n=0',
            '',
            '1 cz 0.4',
            '30 rhp 0 0 -10 0 0 20 0 0.63 0',
            '21 so 15',
            '',
            'm1 92235.80c 1',
        ]));
        const center = findCell(model, [0, 0, 0]);
        assert.strictEqual(center.cell!.id, 1);
        // One flat-to-flat pitch along x lands in a neighboring element pin.
        const neighbor = findCell(model, [1.26 * Math.cos(Math.PI / 6), 1.26 * Math.sin(Math.PI / 6), 0]);
        assert.ok(neighbor.cell, 'neighbor element resolves');
    });
});

suite('MCNP geometry engine — line handling (§3.2.2, §4.4)', () => {
    test('& continuation and 5-space indent both extend a card', () => {
        // Cell 1 is the shell between spheres 1 and 2: "+1 −2" with the −2
        // arriving on an &-continued line; surface 2's radius arrives on a
        // 5-space continuation line.
        const model = parseMcnpGeometry(deck([
            't',
            '1 1 -1 1 &',
            '   -2 imp:n=1',
            '2 0 -1 imp:n=1',
            '3 0 2 imp:n=0',
            '',
            '1 so 1',
            '2 so',
            '     2',
            '',
            'm1 1001.80c 1',
        ]));
        assert.ok(model.surfaces.get(2), 'surface 2 assembled from a 5-space continuation');
        assert.ok(cellContains(model, 1, [0, 0, 1.5]), 'cell 1 region uses the &-continued -2 term');
        assert.ok(!cellContains(model, 1, [0, 0, 0.5]), 'inside sphere 1 is cell 2, not the shell');
    });

    test('$ comments and c comment cards are stripped', () => {
        const model = parseMcnpGeometry(deck([
            't',
            'c a full-line comment',
            '1 1 -1 -1 imp:n=1 $ trailing note',
            '2 0 1 imp:n=0',
            '',
            '1 so 3 $ sphere',
            '',
            'm1 1001.80c 1',
        ]));
        assert.strictEqual(model.cells.size, 2);
        assert.ok(cellContains(model, 1, [0, 0, 0]));
    });

    test('line truncation follows the configured column limit (Stage 0.1)', () => {
        // The surface card hides its real radius past column 80: the "0.5"
        // starts at column 80, so an 80-column image keeps only the "0" and
        // the sphere collapses to radius 0 — exactly the silent truncation
        // bug the line-length rule warns about.
        const padded = '1 so ' + ' '.repeat(74) + '0.5';
        const text = deck(['t', '1 1 -1 -1 imp:n=1', '2 0 1 imp:n=0', '', padded, '', 'm1 1001.80c 1']);
        const at128 = parseMcnpGeometry(text, { lineLimit: 128 });
        const at80 = parseMcnpGeometry(text, { lineLimit: 80 });
        assert.ok(cellContains(at128, 1, [0, 0, 0.4]), '128-column image keeps the 0.5 radius');
        assert.ok(!cellContains(at80, 1, [0, 0, 0.4]), '80-column image truncates the radius, so the point falls outside');
    });

    test('vertical-format (#) data cards are rejected with a warning, not misparsed', () => {
        const model = parseMcnpGeometry(deck([
            't', '1 1 -1 -1 imp:n=1', '2 0 1 imp:n=0', '',
            '1 so 3', '',
            '#   vol',
            '1   1.0',
            'm1 1001.80c 1',
        ]));
        assert.ok(model.warnings.some((w) => /vertical-format/i.test(w)));
    });

    test('message block is skipped; headerless decks are rescued with a warning', () => {
        const withMessage = parseMcnpGeometry(deck([
            'message: datapath=/xs',
            '',
            'real title',
            '1 1 -1 -1 imp:n=1', '2 0 1 imp:n=0', '', '1 so 3', '', 'm1 1001.80c 1',
        ]));
        assert.strictEqual(withMessage.title, 'real title');
        assert.strictEqual(withMessage.cells.size, 2);

        const headerless = parseMcnpGeometry(deck([
            '1 1 -1 -1 imp:n=1', '2 0 1 imp:n=0', '', '1 so 3', '', 'm1 1001.80c 1',
        ]));
        assert.strictEqual(headerless.cells.size, 2, 'first line kept as a cell card');
        assert.ok(headerless.warnings.some((w) => /title/i.test(w)));
    });
});

suite('MCNP geometry engine — Monte Carlo volume checks (Stage-1 exit gate)', () => {
    function mcVolume(model: ReturnType<typeof parseMcnpGeometry>, cellId: number, box: [V3, V3], n: number, seed: number): number {
        const rng = makeRng(seed);
        let inside = 0;
        const [lo, hi] = box;
        for (let i = 0; i < n; i++) {
            const p: V3 = [
                lo[0] + rng() * (hi[0] - lo[0]),
                lo[1] + rng() * (hi[1] - lo[1]),
                lo[2] + rng() * (hi[2] - lo[2]),
            ];
            if (cellContains(model, cellId, p)) inside++;
        }
        const boxVol = (hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2]);
        return (inside / n) * boxVol;
    }

    test('sphere volume within 2% of 4/3·π·r³', () => {
        const model = parseMcnpGeometry(deck(['t', '1 1 -1 -1 imp:n=1', '2 0 1 imp:n=0', '', '1 so 5', '', 'm1 1001.80c 1']));
        const vol = mcVolume(model, 1, [[-5.5, -5.5, -5.5], [5.5, 5.5, 5.5]], 40000, 1234);
        const exact = (4 / 3) * Math.PI * 125;
        assert.ok(Math.abs(vol - exact) / exact < 0.02, `MC ${vol.toFixed(1)} vs exact ${exact.toFixed(1)}`);
    });

    test('rcc volume within 2% of π·r²·h', () => {
        const model = parseMcnpGeometry(deck(['t', '1 1 -1 -1 imp:n=1', '2 0 1 imp:n=0', '', '1 rcc 0 0 -2 0 0 4 1.5', '', 'm1 1001.80c 1']));
        const vol = mcVolume(model, 1, [[-2, -2, -2.5], [2, 2, 2.5]], 40000, 99);
        const exact = Math.PI * 1.5 * 1.5 * 4;
        assert.ok(Math.abs(vol - exact) / exact < 0.02, `MC ${vol.toFixed(1)} vs exact ${exact.toFixed(1)}`);
    });

    test('annulus (cz pair) volume within 2%', () => {
        const model = parseMcnpGeometry(deck([
            't', '1 1 -1 -2 1 -3 4 imp:n=1', '2 0 2:(-1):3:(-4) imp:n=0', '',
            '1 cz 0.5', '2 cz 1.0', '3 pz 2', '4 pz -2', '', 'm1 1001.80c 1',
        ]));
        const vol = mcVolume(model, 1, [[-1.2, -1.2, -2.2], [1.2, 1.2, 2.2]], 40000, 7);
        const exact = Math.PI * (1 - 0.25) * 4;
        assert.ok(Math.abs(vol - exact) / exact < 0.02, `MC ${vol.toFixed(1)} vs exact ${exact.toFixed(1)}`);
    });
});

suite('MCNP geometry engine — 2D slices (Stage 3)', () => {
    const PIN = deck([
        'pin cell',
        '1 1 -10.4 -1 -5 6 imp:n=1',
        '2 2 -6.5 1 -2 -5 6 imp:n=1',
        '3 3 -1.0 2 -3 -5 6 imp:n=1',
        '4 0 3:5:-6 imp:n=0',
        '',
        '1 cz 0.41',
        '2 cz 0.48',
        '3 cz 0.63',
        '5 pz 10',
        '6 pz -10',
        '',
        'm1 92235.80c 1',
        'm2 40090.80c 1',
        'm3 1001.80c 2 8016.80c 1',
    ]);

    test('area fractions on an xy slice match πr² ratios within 2%', () => {
        const model = parseMcnpGeometry(PIN);
        const res = sliceModel(model, {
            plane: axisPlane('xy', 0),
            halfU: 0.63, halfV: 0.63,
            width: 256, height: 256,
            colorBy: 'cell',
        });
        assert.strictEqual(res.overlapCount, 0);
        const total = res.width * res.height;
        const windowArea = 4 * 0.63 * 0.63;
        const areaOf = (cellId: number) => {
            const e = res.legend.find((l) => l.key === cellId);
            return e ? (e.count / total) * windowArea : 0;
        };
        const fuelExact = Math.PI * 0.41 * 0.41;
        const cladExact = Math.PI * (0.48 * 0.48 - 0.41 * 0.41);
        assert.ok(Math.abs(areaOf(1) - fuelExact) / fuelExact < 0.02, `fuel area ${areaOf(1)}`);
        assert.ok(Math.abs(areaOf(2) - cladExact) / cladExact < 0.03, `clad area ${areaOf(2)}`);
    });

    test('slice classification agrees with findCell at every probed pixel (property test)', () => {
        const model = parseMcnpGeometry(PIN);
        const req = {
            plane: axisPlane('xz', 0),
            halfU: 1.0, halfV: 12.0,
            width: 64, height: 64,
            colorBy: 'cell' as const,
        };
        const res = sliceModel(model, req);
        const rng = makeRng(31);
        for (let i = 0; i < 300; i++) {
            const px = Math.floor(rng() * req.width);
            const py = Math.floor(rng() * req.height);
            const who = identifyAt(model, req, px, py);
            const id = res.ids[py * req.width + px];
            if (id >= 0) {
                assert.strictEqual(who.cell, res.legend[id].key, `pixel (${px},${py})`);
            } else if (id === SLICE_LOST) {
                assert.strictEqual(who.cell, null);
            }
        }
    });

    test('overlapping cells render as overlap; uncovered space as lost', () => {
        const model = parseMcnpGeometry(deck([
            'broken deck',
            '1 1 -1 -1 imp:n=1',
            '2 1 -1 -2 imp:n=1',
            '',
            '1 so 2',
            '2 s 1 0 0 2',
            '',
            'm1 1001.80c 1',
        ]));
        const res = sliceModel(model, {
            plane: axisPlane('xy', 0), halfU: 4, halfV: 4,
            width: 64, height: 64, colorBy: 'cell',
        });
        assert.ok(res.overlapCount > 0, 'the two spheres overlap');
        assert.ok(res.lostCount > 0, 'nothing covers the far corners (no graveyard)');
        const someOverlap = res.ids.some((v) => v === SLICE_OVERLAP);
        assert.ok(someOverlap);
    });

    test('defaultWindow spans the model bounds', () => {
        const model = parseMcnpGeometry(PIN);
        const w = defaultWindow(model, axisPlane('xy', 0));
        assert.ok(w.halfU >= 0.63 && w.halfU < 2, `halfU ${w.halfU}`);
        const b = worldBounds(model);
        assert.ok(b.max[2] >= 10 && b.min[2] <= -10);
    });
});

suite('MCNP geometry engine — CSG scene builder (Stages 2 & 4)', () => {
    const MATS = new Map([
        [1, { name: 'Steel', component: Component.Structure }],
        [2, { name: 'Water', component: Component.Moderator }],
    ]);

    test('sphere, cone, torus and wedge decks emit their analytic primitives', () => {
        const model = parseMcnpGeometry(deck([
            'primitive zoo',
            '1 1 -8 -1 imp:n=1',
            '2 1 -8 -2 imp:n=1',
            '3 1 -8 -3 imp:n=1',
            '4 1 -8 -4 imp:n=1',
            '9 0 1 2 3 4 imp:n=0',
            '',
            '1 so 3',
            '2 trc 10 0 0 0 0 4 2 0.5',
            '3 tz -10 0 0 4 0.8 0.8',
            '4 wed 20 0 0 2 0 0 0 3 0 0 0 5',
            '',
            'm1 26056.80c 1',
        ]));
        const scene = buildCsgScene(model, MATS);
        const shapes = scene.cylinders.map((c) => c.shape ?? 'cylinder');
        assert.ok(shapes.includes('sphere'), `expected a sphere in ${shapes}`);
        assert.ok(shapes.includes('cone'), `expected a cone in ${shapes}`);
        assert.ok(shapes.includes('torus'), `expected a torus in ${shapes}`);
        assert.ok(shapes.includes('polyhedron'), `expected a polyhedron in ${shapes}`);
        assert.strictEqual(scene.census.failed, 0, `census: ${JSON.stringify(scene.census)}`);
        assert.strictEqual(scene.census.exact, 4);
    });

    test('off-axis cylinder (cx) becomes an oriented cylinder primitive', () => {
        const model = parseMcnpGeometry(deck([
            'candu-ish channel',
            '1 2 -1 -1 2 -3 imp:n=1',
            '9 0 1:(-2):3 imp:n=0',
            '',
            '1 cx 5',
            '2 px -50',
            '3 px 50',
            '',
            'm2 1001.80c 2 8016.80c 1',
        ]));
        const scene = buildCsgScene(model, MATS);
        assert.strictEqual(scene.cylinders.length, 1);
        const c = scene.cylinders[0];
        assert.strictEqual(c.axis, 'x');
        assert.ok(Math.abs(c.radius - 5) < 1e-9);
        assert.ok(Math.abs(c.height - 100) < 1e-9, 'clipped by the px planes');
        assert.strictEqual(scene.census.exact, 1);
    });

    test('coaxial cz pair renders as an annulus via innerRadius', () => {
        const model = parseMcnpGeometry(deck([
            'annulus',
            '1 1 -8 -2 1 -3 4 imp:n=1',
            '9 0 2:(-1):3:(-4) imp:n=0',
            '',
            '1 cz 0.5', '2 cz 1.0', '3 pz 5', '4 pz -5',
            '',
            'm1 26056.80c 1',
        ]));
        const scene = buildCsgScene(model, MATS);
        assert.strictEqual(scene.cylinders.length, 1);
        assert.ok(Math.abs((scene.cylinders[0].innerRadius ?? 0) - 0.5) < 1e-9);
        assert.strictEqual(scene.census.exact, 1);
    });

    test('graveyard is never meshed; unresolvable cells degrade with a census entry', () => {
        const model = parseMcnpGeometry(deck([
            'hard cell',
            '1 1 -8 -1 -2 imp:n=1',
            '9 0 1:2 imp:n=0',
            '',
            '1 gq 1 2 3 0.1 0.2 0.3 0 0 0 -25',
            '2 kx 5 0.5',
            '',
            'm1 26056.80c 1',
        ]));
        const scene = buildCsgScene(model, MATS);
        assert.ok(scene.notes.some((n) => /graveyard|exterior/i.test(n)), 'graveyard note expected');
        assert.strictEqual(scene.census.failed, 1, JSON.stringify(scene.census));
        assert.ok(scene.cylinders.some((c) => (c.opacity ?? 1) < 0.5), 'translucent fallback drawn');
        assert.ok(scene.warnings.some((w) => /cell 1/i.test(w)), 'warning names the cell');
    });

    test('oblique plane on a cylinder produces a watertight mesh with the right volume', () => {
        // Cylinder r=1, z ∈ (−2, 2), cut by the oblique half-space x+z ≤ 0.
        // For each (x, y) in the unit disk, z runs from −2 to −x (since
        // |x| ≤ 1 < 2), so V = ∫∫ (−x + 2) dA = 2·(π·1²) − 0 = 2π.
        const model = parseMcnpGeometry(deck([
            'oblique cut',
            '1 1 -8 -1 -2 3 -4 imp:n=1',
            '9 0 1:2:(-3):4 imp:n=0',
            '',
            '1 cz 1',
            '2 p 1 0 1 0',
            '3 pz -2',
            '4 pz 2',
            '',
            'm1 26056.80c 1',
        ]));
        const scene = buildCsgScene(model, MATS);
        assert.strictEqual(scene.census.failed, 0, JSON.stringify(scene.census));
        assert.strictEqual(scene.census.exact, 1, 'mesh-clipped cell counts as exact');
        const poly = scene.cylinders.find((c) => c.shape === 'polyhedron');
        assert.ok(poly && poly.verts && poly.faces, 'expected a mesh-clipped polyhedron');

        // Watertight: every undirected edge is used by exactly two faces.
        const edgeUse = new Map<string, number>();
        for (const face of poly!.faces!) {
            for (let i = 0; i < face.length; i++) {
                const a = face[i];
                const b = face[(i + 1) % face.length];
                const key = a < b ? `${a}|${b}` : `${b}|${a}`;
                edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
            }
        }
        for (const [edge, uses] of edgeUse) {
            assert.strictEqual(uses, 2, `edge ${edge} used ${uses}× (not watertight)`);
        }

        // Volume via centroid pyramids (orientation-independent for a convex
        // solid): exact volume is 2π (half of the 4π full cylinder — the cut
        // plane passes through the axis at z=0 and the geometry is symmetric).
        const verts = poly!.verts!;
        const nV = verts.length / 3;
        const cx = [0, 0, 0];
        for (let i = 0; i < nV; i++) { cx[0] += verts[i * 3]; cx[1] += verts[i * 3 + 1]; cx[2] += verts[i * 3 + 2]; }
        cx[0] /= nV; cx[1] /= nV; cx[2] /= nV;
        let vol = 0;
        for (const face of poly!.faces!) {
            let faceVol = 0;
            for (let t = 1; t + 1 < face.length; t++) {
                const idx = [face[0], face[t], face[t + 1]];
                const v = idx.map((k) => [verts[k * 3] - cx[0], verts[k * 3 + 1] - cx[1], verts[k * 3 + 2] - cx[2]]);
                faceVol += (
                    v[0][0] * (v[1][1] * v[2][2] - v[1][2] * v[2][1]) -
                    v[0][1] * (v[1][0] * v[2][2] - v[1][2] * v[2][0]) +
                    v[0][2] * (v[1][0] * v[2][1] - v[1][1] * v[2][0])
                ) / 6;
            }
            vol += Math.abs(faceVol);
        }
        const exact = 2 * Math.PI;
        assert.ok(Math.abs(vol - exact) / exact < 0.01,
            `mesh volume ${vol.toFixed(4)} vs exact ${exact.toFixed(4)}`);
    });

    test('sphere clipped by a plane meshes as a convex polytope (exact census)', () => {
        const model = parseMcnpGeometry(deck([
            'hemisphere',
            '1 1 -8 -1 -2 imp:n=1',
            '9 0 1:2 imp:n=0',
            '',
            '1 so 3',
            '2 pz 0',
            '',
            'm1 26056.80c 1',
        ]));
        const scene = buildCsgScene(model, MATS);
        assert.strictEqual(scene.census.exact, 1, JSON.stringify(scene.census));
        assert.ok(scene.cylinders.some((c) => c.shape === 'polyhedron'), 'hemisphere is meshed');
    });

    test('union regions emit one primitive per branch', () => {
        const model = parseMcnpGeometry(deck([
            'two spheres one cell',
            '1 1 -8 -1:-2 imp:n=1',
            '9 0 1 2 imp:n=0',
            '',
            '1 so 2',
            '2 s 10 0 0 2',
            '',
            'm1 26056.80c 1',
        ]));
        const scene = buildCsgScene(model, MATS);
        assert.strictEqual(scene.cylinders.filter((c) => c.shape === 'sphere').length, 2);
        assert.strictEqual(scene.census.exact, 1);
    });
});
