// MCNP → OpenMC macrobody conversion (issue #4).
//
// ELL / REC / TRC / WED / ARB, oblique and semi-infinite BOX, and the X/Y/Z
// point-defined surfaces used to fall through to "is not a supported surface
// type". They are all exactly representable in OpenMC, so these tests check the
// emitted surfaces numerically: a quadric or plane set is only right if it puts
// the same points inside the body that MCNP does.

import * as assert from 'assert';
import { mcnpToOpenmc } from '../../converter';

function deck(cells: string[], surfaces: string[], data: string[]): string {
    return ['t', ...cells, '', ...surfaces, '', ...data].join('\n');
}

function convert(card: string, region = '-1'): { output: string; issues: string[] } {
    const text = deck([`1 0 ${region} imp:n=1`, `2 0 #1 imp:n=0`], [card], ['kcode 10 1.0 2 5']);
    const r = mcnpToOpenmc(text);
    return { output: r.output, issues: r.issues.map((i) => i.message) };
}

type Vec = [number, number, number];

/** Keyword arguments of the first `openmc.X(...)` call assigned to `name`. */
function kwargs(output: string, name: string): Record<string, number> {
    const line = output.split('\n').find((l) => l.trim().startsWith(`${name} =`));
    assert.ok(line, `no assignment to ${name} in:\n${output}`);
    const out: Record<string, number> = {};
    for (const m of line!.matchAll(/\b([a-z]\d?|r2|x0|y0|z0)=(-?[\d.eE+]+)/g)) {
        out[m[1]] = parseFloat(m[2]);
    }
    return out;
}

/** ax²+by²+cz²+dxy+eyz+fxz+gx+hy+jz+k, the openmc.Quadric form. */
function quadric(k: Record<string, number>, p: Vec): number {
    const [x, y, z] = p;
    return (k.a ?? 0) * x * x + (k.b ?? 0) * y * y + (k.c ?? 0) * z * z
        + (k.d ?? 0) * x * y + (k.e ?? 0) * y * z + (k.f ?? 0) * x * z
        + (k.g ?? 0) * x + (k.h ?? 0) * y + (k.j ?? 0) * z + (k.k ?? 0);
}

/** ax+by+cz-d, the openmc.Plane form. */
function plane(k: Record<string, number>, p: Vec): number {
    return (k.a ?? 0) * p[0] + (k.b ?? 0) * p[1] + (k.c ?? 0) * p[2] - (k.d ?? 0);
}

/**
 * Evaluate an emitted region expression like `(-surf_1 & +surf_1_f1 & -surf_1_f2)`
 * against a point, reading each surface's coefficients back out of the script.
 */
function inRegion(output: string, expr: string, p: Vec): boolean {
    const terms = expr.replace(/[()]/g, '').split('&').map((t) => t.trim()).filter(Boolean);
    assert.ok(terms.length > 0, `no terms in region '${expr}'`);
    for (const t of terms) {
        const sign = t[0];
        const name = t.slice(1);
        const k = kwargs(output, name);
        const line = output.split('\n').find((l) => l.trim().startsWith(`${name} =`))!;
        const f = line.includes('openmc.Plane') ? plane(k, p) : quadric(k, p);
        if (sign === '-' ? !(f < 0) : !(f > 0)) return false;
    }
    return true;
}

/** The region expression the converter gave cell 1. */
function cellRegion(output: string): string {
    const line = output.split('\n').find((l) => l.trim().startsWith('cell_1.region ='));
    assert.ok(line, `no region assignment for cell_1 in:\n${output}`);
    return line!.split('=').slice(1).join('=').trim();
}

suite('Converter — MCNP macrobodies → OpenMC', () => {
    test('ELL centre form (r<0) is an exact spheroid quadric', () => {
        // Centre at the origin, major axis 4 along z, minor radius 2.
        const { output, issues } = convert('1 ell 0 0 0 0 0 4 -2');
        assert.ok(!issues.some((m) => /ell/i.test(m)), `unexpected issues: ${issues.join('; ')}`);
        const k = kwargs(output, 'surf_1');
        assert.ok(Math.abs(k.a - 0.25) < 1e-9, `a=${k.a}`);
        assert.ok(Math.abs(k.b - 0.25) < 1e-9, `b=${k.b}`);
        assert.ok(Math.abs(k.c - 1 / 16) < 1e-9, `c=${k.c}`);
        for (const key of ['d', 'e', 'f', 'g', 'h', 'j']) {
            assert.ok(Math.abs(k[key] ?? 0) < 1e-12, `${key}=${k[key]}`);
        }
        // Vertices sit on the surface; just inside/outside must change sign.
        assert.ok(Math.abs(quadric(k, [0, 0, 4])) < 1e-9);
        assert.ok(Math.abs(quadric(k, [2, 0, 0])) < 1e-9);
        assert.ok(quadric(k, [0, 0, 3.9]) < 0);
        assert.ok(quadric(k, [0, 0, 4.1]) > 0);
        assert.ok(quadric(k, [2.1, 0, 0]) > 0);
    });

    test('ELL focus form (r>0) puts the vertices where MCNP does', () => {
        // Foci at z = ±3 with semi-major 5, so the minor radius is 4.
        const { output } = convert('1 ell 0 0 -3 0 0 3 5');
        const k = kwargs(output, 'surf_1');
        assert.ok(Math.abs(k.c - 1 / 25) < 1e-9, `c=${k.c}`);
        assert.ok(Math.abs(k.a - 1 / 16) < 1e-9, `a=${k.a}`);
        assert.ok(Math.abs(quadric(k, [0, 0, 5])) < 1e-9);
        assert.ok(Math.abs(quadric(k, [4, 0, 0])) < 1e-9);
        assert.ok(quadric(k, [0, 0, 0]) < 0);
        assert.ok(quadric(k, [0, 0, 5.01]) > 0);
    });

    test('ELL with an off-axis major axis keeps the cross terms', () => {
        // Foci along (1,1,0)/sqrt(2) at ±3 from the centre (2,0,1).
        const c: Vec = [2, 0, 1];
        const d = 3 / Math.SQRT2;
        const { output } = convert(`1 ell ${2 - d} ${-d} 1 ${2 + d} ${d} 1 5`);
        const k = kwargs(output, 'surf_1');
        assert.ok(Math.abs(k.d) > 1e-6, 'expected a nonzero xy cross term');
        const u: Vec = [1 / Math.SQRT2, 1 / Math.SQRT2, 0];
        const vertex: Vec = [c[0] + 5 * u[0], c[1] + 5 * u[1], c[2] + 5 * u[2]];
        assert.ok(Math.abs(quadric(k, vertex)) < 1e-7, `vertex value ${quadric(k, vertex)}`);
        assert.ok(quadric(k, c) < 0, 'centre must be inside');
        // Minor radius is 4 (5² − 3²), perpendicular to u.
        const perp: Vec = [c[0], c[1], c[2] + 4];
        assert.ok(Math.abs(quadric(k, perp)) < 1e-7, `minor vertex value ${quadric(k, perp)}`);
    });

    test('TRC becomes openmc.model.ConicalFrustum', () => {
        const { output, issues } = convert('1 trc 0 0 0 0 0 10 3 1');
        assert.ok(output.includes('openmc.model.ConicalFrustum((0, 0, 0), (0, 0, 10), 3, 1'),
            `missing ConicalFrustum in:\n${output}`);
        assert.ok(!issues.some((m) => /trc/i.test(m)), `unexpected issues: ${issues.join('; ')}`);
    });

    test('REC is an elliptical-cylinder quadric capped by two planes', () => {
        // Base at the origin, 10 tall along z, semi-axes 4 (x) and 2 (y).
        const { output } = convert('1 rec 0 0 0 0 0 10 4 0 0 2');
        const region = cellRegion(output);
        assert.ok(/surf_1_lo/.test(region) && /surf_1_hi/.test(region), `region was '${region}'`);
        assert.ok(inRegion(output, region, [0, 0, 5]), 'axis midpoint should be inside');
        assert.ok(inRegion(output, region, [3.9, 0, 5]), 'inside along the major axis');
        assert.ok(!inRegion(output, region, [4.1, 0, 5]), 'outside along the major axis');
        assert.ok(!inRegion(output, region, [0, 2.1, 5]), 'outside along the minor axis');
        assert.ok(!inRegion(output, region, [0, 0, -0.1]), 'below the base');
        assert.ok(!inRegion(output, region, [0, 0, 10.1]), 'above the top');
    });

    test('WED is five planes that classify the wedge', () => {
        // Right triangle legs 4 (x) and 3 (y), 2 tall in z.
        const { output } = convert('1 wed 0 0 0 4 0 0 0 3 0 0 0 2');
        const region = cellRegion(output);
        assert.strictEqual(region.split('&').length, 5, `expected 5 half-spaces, got '${region}'`);
        assert.ok(inRegion(output, region, [0.5, 0.5, 1]), 'near the right-angle corner');
        assert.ok(inRegion(output, region, [1, 1, 0.1]), 'inside');
        assert.ok(!inRegion(output, region, [3, 2, 1]), 'past the hypotenuse');
        assert.ok(!inRegion(output, region, [-0.1, 0.5, 1]), 'behind the v2 face');
        assert.ok(!inRegion(output, region, [1, 1, 2.1]), 'above the top');
    });

    test('ARB unit cube is six planes that classify the cube', () => {
        const corners = [
            '0 0 0', '1 0 0', '1 1 0', '0 1 0',
            '0 0 1', '1 0 1', '1 1 1', '0 1 1',
        ].join(' ');
        // Faces: bottom 1234, top 5678, and the four sides.
        const { output } = convert(`1 arb ${corners} 1234 5678 1256 2367 3478 1458`);
        const region = cellRegion(output);
        assert.strictEqual(region.split('&').length, 6, `expected 6 half-spaces, got '${region}'`);
        assert.ok(inRegion(output, region, [0.5, 0.5, 0.5]), 'centre is inside');
        assert.ok(!inRegion(output, region, [1.5, 0.5, 0.5]), 'outside +x');
        assert.ok(!inRegion(output, region, [0.5, 0.5, -0.5]), 'outside -z');
    });

    test('oblique BOX becomes six bounding planes', () => {
        // a1 tilted in the xy plane, so RectangularParallelepiped cannot hold it.
        const { output } = convert('1 box 0 0 0 2 2 0 -1 1 0 0 0 3');
        const region = cellRegion(output);
        assert.strictEqual(region.split('&').length, 6, `expected 6 half-spaces, got '${region}'`);
        assert.ok(inRegion(output, region, [0.6, 1.2, 1.5]), 'inside the tilted box');
        assert.ok(!inRegion(output, region, [3, 3, 1.5]), 'past the a1 face');
        assert.ok(!inRegion(output, region, [0.6, 1.2, 3.5]), 'above the a3 face');
    });

    test('BOX with no a3 is infinite, not an error', () => {
        const { output, issues } = convert('1 box 0 0 0 2 0 0 0 2 0');
        assert.ok(!issues.some((m) => /needs/i.test(m)), `unexpected issues: ${issues.join('; ')}`);
        const region = cellRegion(output);
        assert.strictEqual(region.split('&').length, 4, `expected 4 half-spaces, got '${region}'`);
        assert.ok(inRegion(output, region, [1, 1, 1e4]), 'infinite along a1 × a2');
        assert.ok(!inRegion(output, region, [2.5, 1, 0]), 'outside in x');
    });

    test('X/Y/Z point-defined surfaces resolve by point count', () => {
        assert.ok(convert('1 z 5 3').output.includes('openmc.ZPlane(surface_id=1, z0=5'));
        assert.ok(convert('1 z 0 2 5 2').output.includes('openmc.ZCylinder(surface_id=1, r=2'));
        const cone = convert('1 z 0 0 4 2').output;
        assert.ok(cone.includes('openmc.model.ZConeOneSided('), `missing cone in:\n${cone}`);
        assert.ok(cone.includes('up=True'), 'cone opens toward +z');
        const three = convert('1 y 0 1 1 2 2 4').output;
        assert.ok(three.includes('openmc.Quadric(surface_id=1'), `missing quadric in:\n${three}`);
    });

    test('a macrobody facet reference is reported, not silently widened', () => {
        const { issues } = convert('1 rpp -1 1 -1 1 -1 1', '-1.2');
        assert.ok(issues.some((m) => /facet 1\.2/.test(m)), `expected a facet issue, got: ${issues.join('; ')}`);
    });

    test('no macrobody card leaves an unsupported-surface issue behind', () => {
        for (const card of [
            '1 ell 0 0 0 0 0 4 -2',
            '1 rec 0 0 0 0 0 10 4 0 0 2',
            '1 trc 0 0 0 0 0 10 3 1',
            '1 wed 0 0 0 4 0 0 0 3 0 0 0 2',
        ]) {
            const { issues } = convert(card);
            assert.ok(!issues.some((m) => /not a supported surface type/.test(m)),
                `card '${card}' still unsupported: ${issues.join('; ')}`);
        }
    });
});
