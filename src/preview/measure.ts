// Pure, vscode-free measurement math for the 3D geometry preview.
//
// The webview's measurement tools (distance/width, angle, radius/diameter) call
// these functions. They live here — standalone and dependency-free — for two
// reasons:
//   1. They are unit-tested headlessly (mocha), like `latticeCodegen.ts` and
//      `sweepCore.ts`.
//   2. `webview.ts` injects their `toString()` straight into the webview module
//      so the live preview runs the EXACT functions the tests assert against
//      (no duplicated math). Each function is therefore self-contained — it
//      references only its arguments and JS built-ins (`Math`, `Number`) so the
//      injected copy survives esbuild's production minification.
//
// Points are plain `{x, y, z}` in deck coordinates (centimetres). Distances and
// angles are frame-invariant, but the axis-aligned deltas are reported in deck
// axes (x, y, z) so users can read pin pitches, gaps and widths directly.

export interface Point3 {
    x: number;
    y: number;
    z: number;
}

/** Straight-line distance between two points (cm). */
export function distance3(a: Point3, b: Point3): number {
    return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y) + (a.z - b.z) * (a.z - b.z));
}

/** Axis-aligned component deltas |Δx|, |Δy|, |Δz| (cm) between two points. */
export function deltas(a: Point3, b: Point3): { dx: number; dy: number; dz: number } {
    return { dx: Math.abs(a.x - b.x), dy: Math.abs(a.y - b.y), dz: Math.abs(a.z - b.z) };
}

/**
 * Included angle (degrees) at `vertex`, between the rays vertex→a and vertex→b.
 * Returns 0 when either ray has zero length.
 */
export function angleDeg(a: Point3, vertex: Point3, b: Point3): number {
    const ux = a.x - vertex.x, uy = a.y - vertex.y, uz = a.z - vertex.z;
    const vx = b.x - vertex.x, vy = b.y - vertex.y, vz = b.z - vertex.z;
    const lu = Math.sqrt(ux * ux + uy * uy + uz * uz);
    const lv = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (lu < 1e-12 || lv < 1e-12) return 0;
    let cos = (ux * vx + uy * vy + uz * vz) / (lu * lv);
    if (cos > 1) cos = 1;
    if (cos < -1) cos = -1;
    return Math.acos(cos) * 180 / Math.PI;
}

/** Diameter from a radius (cm). */
export function diameter(radius: number): number {
    return radius * 2;
}

/** Compact fixed-precision formatter that trims trailing zeros. */
export function fmtLen(n: number, digits = 3): string {
    if (!Number.isFinite(n)) return '—';
    const s = n.toFixed(digits);
    return s.indexOf('.') >= 0 ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}
