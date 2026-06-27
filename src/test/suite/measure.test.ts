import * as assert from 'assert';
import { distance3, deltas, angleDeg, diameter, fmtLen, Point3 } from '../../preview/measure';

// Pure-logic measurement tests — no vscode / no DOM — headless via tsc + mocha
// (`--ui tdd`), same as the extractor / lattice-codegen / sweep suites. These
// assert the exact math the 3D preview injects into its webview.

suite('OWEN preview measurement math', () => {
    test('distance3: 3-4-5 right triangle in the XY plane', () => {
        const a: Point3 = { x: 0, y: 0, z: 0 };
        const b: Point3 = { x: 3, y: 4, z: 0 };
        assert.ok(Math.abs(distance3(a, b) - 5) < 1e-9, `expected 5, got ${distance3(a, b)}`);
    });

    test('distance3: full 3D diagonal (2,3,6 -> 7)', () => {
        const a: Point3 = { x: 0, y: 0, z: 0 };
        const b: Point3 = { x: 2, y: 3, z: 6 };
        assert.ok(Math.abs(distance3(a, b) - 7) < 1e-9, `expected 7, got ${distance3(a, b)}`);
    });

    test('distance3 is symmetric', () => {
        const a: Point3 = { x: -1.5, y: 2.25, z: 4 };
        const b: Point3 = { x: 3, y: -1, z: 0.5 };
        assert.ok(Math.abs(distance3(a, b) - distance3(b, a)) < 1e-12);
    });

    test('deltas: absolute axis-aligned components (pin pitch read)', () => {
        const a: Point3 = { x: 1.0, y: 2.0, z: 5.0 };
        const b: Point3 = { x: 2.26, y: -1.0, z: 5.0 };
        const d = deltas(a, b);
        assert.ok(Math.abs(d.dx - 1.26) < 1e-9, `dx ${d.dx}`);
        assert.ok(Math.abs(d.dy - 3.0) < 1e-9, `dy ${d.dy}`);
        assert.ok(Math.abs(d.dz - 0.0) < 1e-9, `dz ${d.dz}`);
    });

    test('angleDeg: right angle at the vertex', () => {
        const a: Point3 = { x: 1, y: 0, z: 0 };
        const v: Point3 = { x: 0, y: 0, z: 0 };
        const b: Point3 = { x: 0, y: 1, z: 0 };
        assert.ok(Math.abs(angleDeg(a, v, b) - 90) < 1e-9, `expected 90, got ${angleDeg(a, v, b)}`);
    });

    test('angleDeg: straight line is 180 degrees', () => {
        const a: Point3 = { x: -2, y: 0, z: 0 };
        const v: Point3 = { x: 0, y: 0, z: 0 };
        const b: Point3 = { x: 3, y: 0, z: 0 };
        assert.ok(Math.abs(angleDeg(a, v, b) - 180) < 1e-9, `expected 180, got ${angleDeg(a, v, b)}`);
    });

    test('angleDeg: 60 degrees of an equilateral triangle', () => {
        const a: Point3 = { x: 0, y: 0, z: 0 };
        const v: Point3 = { x: 1, y: 0, z: 0 };
        const b: Point3 = { x: 0.5, y: Math.sqrt(3) / 2, z: 0 };
        assert.ok(Math.abs(angleDeg(a, v, b) - 60) < 1e-6, `expected 60, got ${angleDeg(a, v, b)}`);
    });

    test('angleDeg: degenerate ray returns 0 (no NaN)', () => {
        const p: Point3 = { x: 1, y: 1, z: 1 };
        assert.strictEqual(angleDeg(p, p, { x: 2, y: 2, z: 2 }), 0);
    });

    test('diameter doubles the radius', () => {
        assert.strictEqual(diameter(0.41), 0.82);
    });

    test('fmtLen trims trailing zeros and clamps precision', () => {
        assert.strictEqual(fmtLen(1.25999, 3), '1.26');
        assert.strictEqual(fmtLen(5, 3), '5');
        assert.strictEqual(fmtLen(0.4000, 3), '0.4');
        assert.strictEqual(fmtLen(NaN), '—');
    });
});
