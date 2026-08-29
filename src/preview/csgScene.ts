// CSG → render-primitive scene builder (geometry-preview plan, Stages 2 & 4).
//
// Turns the Stage-1 exact model (mcnpGeometry.ts) into drawable primitives
// for cells the instanced pin/lattice fast path cannot express: spheres,
// cones, tori, off-axis cylinders, boxes, wedges, arbitrary planar solids.
// The fast path in codes/mcnp.ts stays untouched (cardinal rule: it is what
// keeps a 193-assembly core interactive); this engine is an additional path,
// selected when a deck has no expandable lattice, never a replacement.
//
// Robustness policy (plan Stage 4): a cell that cannot be built exactly
// degrades to a translucent bounding shape plus a warning naming the cell —
// never a crash, never a silent omission. Every deck gets a census:
// rendered exactly / approximated / failed, surfaced in the notes.
//
// Method: each cell region is normalized to a union of intersections (DNF,
// capped), and each intersection term is classified:
//   - planes only                    → convex polyhedron (exact)
//   - one quadric + compatible caps  → cylinder / sphere / cone / ellipsoid /
//                                      elliptic cylinder / torus (exact when
//                                      the caps are perpendicular to the
//                                      axis; else approximated)
//   - coaxial outside-cylinder       → annulus via innerRadius (exact)
//   - anything else                  → translucent bounding box (failed)

import { CylinderSpec, Component, ComponentId } from './types';
import { materialColor } from './palette';
import { csgSegmentBudget, DEFAULT_MAX_CSG_TRIANGLES } from './budget';
import {
    McnpGeometryModel,
    McnpSurface,
    RegionNode,
    Shape,
    toMain,
    Transform,
    Vec3,
} from './mcnpGeometry';
import { Bounds, cellContains, worldBounds } from './mcnpEvaluate';

export interface MaterialLookup {
    name: string;
    component: ComponentId;
}

export interface CsgCensus {
    exact: number;
    approximated: number;
    failed: number;
    /** Human lines like "cell 12: approximated (oblique clip ignored)". */
    details: string[];
}

export interface CsgSceneResult {
    cylinders: CylinderSpec[];
    census: CsgCensus;
    warnings: string[];
    notes: string[];
}

const MAX_DNF_TERMS = 64;
const MAX_TERM_LITERALS = 96;
/** How many nested `#cell` substitutions to follow before giving up. */
const MAX_COMPLEMENT_DEPTH = 8;

// ---------------------------------------------------------------------------
// DNF conversion
// ---------------------------------------------------------------------------

interface Literal {
    surface: number;
    facet: number;
    sense: 1 | -1;
}

/**
 * What a DNF expansion needs beyond the region itself: the model, so a `#cell`
 * complement can be substituted, a cycle guard, and somewhere to record why an
 * expansion gave up — the panel repeats that reason back to the reader.
 */
interface DnfCtx {
    model: McnpGeometryModel;
    /** Cells currently being substituted, so `#` chains cannot recurse forever. */
    stack: Set<number>;
    reason?: string;
}

/** Push negations down to literals; expand and/or into DNF with caps. */
function toDnf(node: RegionNode, negate: boolean, ctx?: DnfCtx): Literal[][] | null {
    switch (node.op) {
        case 'halfspace': {
            const sense = (negate ? -node.sense : node.sense) as 1 | -1;
            // Whole-body outside is a union, not an intersection: De Morgan
            // turns "outside AND(facets)" into "OR(outside each facet)".
            // Without this, `3 -4` on two RCCs (the HYLIFE salt annulus) had
            // its inner hole dropped ("outside macrobody — hole ignored") and
            // drew a solid cylinder. Facet expansion is capped so an ARB with
            // dozens of faces cannot blow the DNF budget by itself.
            if (sense === 1 && node.facet === 0 && ctx) {
                const shape = ctx.model.surfaces.get(node.surface)?.shape;
                if (shape?.kind === 'body' && shape.facets.length > 0 && shape.facets.length <= 12) {
                    return shape.facets.map((_, i) => [{
                        surface: node.surface,
                        facet: i + 1,
                        sense: 1 as const,
                    }]);
                }
            }
            return [[{ surface: node.surface, facet: node.facet, sense }]];
        }
        case 'not':
            return toDnf(node.kid, !negate, ctx);
        case 'cellcomp': {
            // `#n` is the complement of cell n's region, so substituting that
            // region under one more negation is an exact rewrite. Doing it here
            // is what lets a deck built out of complements render as real solids
            // instead of a wall of bounding boxes.
            if (!ctx) return null;
            if (ctx.stack.has(node.cell)) {
                ctx.reason ??= `#${node.cell} refers back to a cell already being expanded`;
                return null;
            }
            const target = ctx.model.cells.get(node.cell);
            if (!target || !target.region) {
                ctx.reason ??= `#${node.cell} names a cell with no region`;
                return null;
            }
            if (target.trcl) {
                // The referenced region's surfaces are placed by that cell's
                // transform; pasting its literals here would put them in the
                // wrong spot, so the bounding box is the honest answer.
                ctx.reason ??= `#${node.cell} names a cell carrying a trcl`;
                return null;
            }
            if (ctx.stack.size >= MAX_COMPLEMENT_DEPTH) {
                ctx.reason ??= `# complements nest deeper than ${MAX_COMPLEMENT_DEPTH}`;
                return null;
            }
            ctx.stack.add(node.cell);
            const d = toDnf(target.region, !negate, ctx);
            ctx.stack.delete(node.cell);
            return d;
        }
        case 'and':
        case 'or': {
            const isAnd = (node.op === 'and') !== negate; // De Morgan
            const kids: Literal[][][] = [];
            for (const k of node.kids) {
                const d = toDnf(k, negate, ctx);
                if (!d) return null;
                kids.push(d);
            }
            if (!isAnd) {
                const out: Literal[][] = [];
                for (const d of kids) out.push(...d);
                if (out.length > MAX_DNF_TERMS) {
                    if (ctx) ctx.reason ??= `region expands past ${MAX_DNF_TERMS} union terms`;
                    return null;
                }
                return out;
            }
            // AND: distribute (cartesian product of terms).
            let acc: Literal[][] = [[]];
            for (const d of kids) {
                const next: Literal[][] = [];
                for (const a of acc) {
                    for (const t of d) {
                        if (a.length + t.length > MAX_TERM_LITERALS) {
                            if (ctx) ctx.reason ??= `one term needs more than ${MAX_TERM_LITERALS} surfaces`;
                            return null;
                        }
                        next.push([...a, ...t]);
                        if (next.length > MAX_DNF_TERMS) {
                            if (ctx) ctx.reason ??= `region expands past ${MAX_DNF_TERMS} union terms`;
                            return null;
                        }
                    }
                }
                acc = next;
            }
            return acc;
        }
    }
}

// ---------------------------------------------------------------------------
// Literal resolution to typed constraints
// ---------------------------------------------------------------------------

type Axis = 'x' | 'y' | 'z';

interface PlaneC { n: Vec3; d: number }                      // n·p ≤ d keeps inside
interface CylC { axis: Axis | null; axisVec: Vec3; u0: number; v0: number; base: Vec3; r: number }
interface SphereC { c: Vec3; r: number }
interface ConeC { apex: Vec3; axis: Vec3; t2: number; sheet: -1 | 0 | 1 }
interface EllipsoidC { c: Vec3; rx: number; ry: number; rz: number }
interface EllCylC { axis: Axis; c: [number, number]; r1: number; r2: number }
interface TorusC { center: Vec3; axis: Axis; major: number; tube: number }

interface UnsupportedNote {
    msg: string;
    /**
     * Blocking = a positive (intersecting) constraint we could not honor;
     * claiming an exact primitive would then LIE about the cell's shape, so
     * blocked terms fall through to the translucent-bounds path (plan Stage 4
     * robustness policy). Dropped holes and cosmetic approximations are
     * non-blocking: the drawn solid is a superset, reported as approximated.
     */
    blocking: boolean;
}

interface TermBuckets {
    planes: PlaneC[];            // inside halfspaces (n·p ≤ d)
    inCyl: CylC[];
    outCyl: CylC[];
    inSphere: SphereC[];
    outSphere: SphereC[];
    inCone: ConeC[];
    inEllipsoid: EllipsoidC[];
    inEllCyl: EllCylC[];
    inTorus: TorusC[];
    outTorus: TorusC[];
    /** Constraint kinds present but not classifiable into the above. */
    unsupported: UnsupportedNote[];
}

function newBuckets(): TermBuckets {
    return {
        planes: [], inCyl: [], outCyl: [], inSphere: [], outSphere: [],
        inCone: [], inEllipsoid: [], inEllCyl: [], inTorus: [], outTorus: [],
        unsupported: [],
    };
}

function hasBlocking(bk: TermBuckets): boolean {
    return bk.unsupported.some((u) => u.blocking);
}

function firstNote(bk: TermBuckets): string | undefined {
    return bk.unsupported[0]?.msg;
}

/** Try to read a quadric as one of the friendly special forms. */
function classifyQuadric(sh: Extract<Shape, { kind: 'quadric' }>):
    | { type: 'sphere'; c: Vec3; r: number }
    | { type: 'cyl'; axis: Axis; u0: number; v0: number; r: number }
    | { type: 'ellcyl'; axis: Axis; c: [number, number]; r1: number; r2: number }
    | { type: 'ellipsoid'; c: Vec3; rx: number; ry: number; rz: number }
    | { type: 'general' } {
    const { a, b, c, d, e, f, g, h, j, k } = sh;
    if (d !== 0 || e !== 0 || f !== 0) return { type: 'general' };
    const eps = 1e-9;
    const eq = (p: number, q: number) => Math.abs(p - q) < eps * Math.max(1, Math.abs(p), Math.abs(q));

    // Sphere: a=b=c>0.
    if (a > eps && eq(a, b) && eq(b, c)) {
        const cx = -g / (2 * a); const cy = -h / (2 * a); const cz = -j / (2 * a);
        const r2 = cx * cx + cy * cy + cz * cz - k / a;
        if (r2 > 0) return { type: 'sphere', c: [cx, cy, cz], r: Math.sqrt(r2) };
        return { type: 'general' };
    }
    // Cylinders / elliptic cylinders: exactly one zero diagonal.
    const zeros = [a, b, c].filter((v) => Math.abs(v) < eps).length;
    if (zeros === 1) {
        const axis: Axis = Math.abs(a) < eps ? 'x' : Math.abs(b) < eps ? 'y' : 'z';
        const [ca, cb] = axis === 'x' ? [b, c] : axis === 'y' ? [a, c] : [a, b];
        const [ga, gb] = axis === 'x' ? [h, j] : axis === 'y' ? [g, j] : [g, h];
        const axialLin = axis === 'x' ? g : axis === 'y' ? h : j;
        if (Math.abs(axialLin) > eps || ca <= eps || cb <= eps) return { type: 'general' };
        const u0 = -ga / (2 * ca); const v0 = -gb / (2 * cb);
        const rhs = ca * u0 * u0 + cb * v0 * v0 - k;
        if (rhs <= 0) return { type: 'general' };
        const r1 = Math.sqrt(rhs / ca);
        const r2 = Math.sqrt(rhs / cb);
        if (eq(ca, cb)) return { type: 'cyl', axis, u0, v0, r: Math.sqrt(rhs / ca) };
        return { type: 'ellcyl', axis, c: [u0, v0], r1, r2 };
    }
    // Axis-aligned ellipsoid: all positive, unequal allowed.
    if (a > eps && b > eps && c > eps) {
        const cx = -g / (2 * a); const cy = -h / (2 * b); const cz = -j / (2 * c);
        const rhs = a * cx * cx + b * cy * cy + c * cz * cz - k;
        if (rhs > 0) {
            return {
                type: 'ellipsoid', c: [cx, cy, cz],
                rx: Math.sqrt(rhs / a), ry: Math.sqrt(rhs / b), rz: Math.sqrt(rhs / c),
            };
        }
    }
    return { type: 'general' };
}

/** Axis letter for a unit vector when it is axis-aligned; null otherwise. */
function axisOf(v: Vec3): Axis | null {
    if (Math.abs(v[0]) > 0.9999 && Math.abs(v[1]) < 1e-6 && Math.abs(v[2]) < 1e-6) return 'x';
    if (Math.abs(v[1]) > 0.9999 && Math.abs(v[0]) < 1e-6 && Math.abs(v[2]) < 1e-6) return 'y';
    if (Math.abs(v[2]) > 0.9999 && Math.abs(v[0]) < 1e-6 && Math.abs(v[1]) < 1e-6) return 'z';
    return null;
}

/**
 * Add one shape-with-sense to the buckets. `sense` −1 = inside (f < 0).
 * Shapes arriving from a transformed surface pass `tr`; only pure
 * translations are folded in (a rotated quadric stays 'unsupported' for the
 * exact primitive path and falls back per the robustness policy).
 */
function bucketShape(bk: TermBuckets, shape: Shape, sense: 1 | -1, tr: Transform | null, label: string): void {
    if (tr && tr.m) { bk.unsupported.push({ msg: `${label} (rotated surface)`, blocking: true }); return; }
    const shift: Vec3 = tr ? (tr.origin === 1 ? tr.o : [-tr.o[0], -tr.o[1], -tr.o[2]]) : [0, 0, 0];
    const move = (p: Vec3): Vec3 => [p[0] + shift[0], p[1] + shift[1], p[2] + shift[2]];

    switch (shape.kind) {
        case 'plane': {
            // inside (f<0): n·p < d ; outside: n·p > d ⇔ (−n)·p < −d.
            const d2 = shape.d + (shape.n[0] * shift[0] + shape.n[1] * shift[1] + shape.n[2] * shift[2]);
            if (sense === -1) bk.planes.push({ n: shape.n, d: d2 });
            else bk.planes.push({ n: [-shape.n[0], -shape.n[1], -shape.n[2]], d: -d2 });
            return;
        }
        case 'quadric': {
            const q = classifyQuadric(shape);
            if (q.type === 'sphere') {
                const c = move(q.c);
                (sense === -1 ? bk.inSphere : bk.outSphere).push({ c, r: q.r });
                return;
            }
            if (q.type === 'cyl') {
                const base: Vec3 = q.axis === 'x' ? [0, q.u0, q.v0] : q.axis === 'y' ? [q.u0, 0, q.v0] : [q.u0, q.v0, 0];
                const b2 = move(base);
                const [u0, v0] = q.axis === 'x' ? [b2[1], b2[2]] : q.axis === 'y' ? [b2[0], b2[2]] : [b2[0], b2[1]];
                const axisVec: Vec3 = q.axis === 'x' ? [1, 0, 0] : q.axis === 'y' ? [0, 1, 0] : [0, 0, 1];
                (sense === -1 ? bk.inCyl : bk.outCyl).push({ axis: q.axis, axisVec, u0, v0, base: b2, r: q.r });
                return;
            }
            if (q.type === 'ellcyl' && sense === -1) {
                const base: Vec3 = q.axis === 'x' ? [0, q.c[0], q.c[1]] : q.axis === 'y' ? [q.c[0], 0, q.c[1]] : [q.c[0], q.c[1], 0];
                const b2 = move(base);
                const c2: [number, number] = q.axis === 'x' ? [b2[1], b2[2]] : q.axis === 'y' ? [b2[0], b2[2]] : [b2[0], b2[1]];
                bk.inEllCyl.push({ axis: q.axis, c: c2, r1: q.r1, r2: q.r2 });
                return;
            }
            if (q.type === 'ellipsoid' && sense === -1) {
                bk.inEllipsoid.push({ c: move(q.c), rx: q.rx, ry: q.ry, rz: q.rz });
                return;
            }
            bk.unsupported.push({
                msg: `${label} (${sense === -1 ? 'inside' : 'outside'} general quadric)`,
                blocking: sense === -1,
            });
            return;
        }
        case 'cone': {
            if (sense === -1) bk.inCone.push({ apex: move(shape.apex), axis: shape.axis, t2: shape.t2, sheet: shape.sheet });
            else bk.unsupported.push({ msg: `${label} (outside cone — hole ignored)`, blocking: false });
            return;
        }
        case 'torus': {
            const t: TorusC = {
                center: move(shape.center), axis: shape.axis,
                major: shape.a, tube: Math.max(Math.abs(shape.b), Math.abs(shape.c)),
            };
            (sense === -1 ? bk.inTorus : bk.outTorus).push(t);
            if (Math.abs(Math.abs(shape.b) - Math.abs(shape.c)) > 1e-9 * Math.max(1, Math.abs(shape.b))) {
                bk.unsupported.push({ msg: `${label} (elliptical torus cross-section drawn circular)`, blocking: false });
            }
            return;
        }
        case 'body': {
            if (sense === -1) {
                // Inside the body = inside every facet.
                shape.facets.forEach((f, i) => bucketShape(bk, f, -1, tr, `${label}.${i + 1}`));
            } else {
                bk.unsupported.push({ msg: `${label} (outside macrobody — hole ignored)`, blocking: false });
            }
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// Convex polyhedron from half-spaces (planes only)
// ---------------------------------------------------------------------------

interface Poly { verts: Vec3[]; faces: number[][] }

/** Start from the world box, clip by each plane (n·p ≤ d). */
function clipBoxByPlanes(bounds: Bounds, planes: PlaneC[]): Poly | null {
    // Box as vertex + face lists.
    const [x0, y0, z0] = bounds.min;
    const [x1, y1, z1] = bounds.max;
    let verts: Vec3[] = [
        [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
        [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
    ];
    let faces: number[][] = [
        [0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3],
    ];

    for (const pl of planes) {
        const dist = verts.map((v) => vdotp(pl.n, v) - pl.d);
        const eps = 1e-9;
        if (dist.every((di) => di <= eps)) continue;      // plane cuts nothing
        if (dist.every((di) => di >= -eps)) return null;  // everything clipped away

        const keepIdx = new Map<number, number>();
        const newVerts: Vec3[] = [];
        const keep = (i: number): number => {
            let ni = keepIdx.get(i);
            if (ni === undefined) {
                ni = newVerts.length;
                newVerts.push(verts[i]);
                keepIdx.set(i, ni);
            }
            return ni;
        };
        // Cache edge intersections so shared edges produce one vertex.
        const edgeCut = new Map<string, number>();
        const cut = (i: number, jj: number): number => {
            const key = i < jj ? `${i}|${jj}` : `${jj}|${i}`;
            let ni = edgeCut.get(key);
            if (ni === undefined) {
                const t = dist[i] / (dist[i] - dist[jj]);
                const a = verts[i]; const b = verts[jj];
                newVerts.push([
                    a[0] + (b[0] - a[0]) * t,
                    a[1] + (b[1] - a[1]) * t,
                    a[2] + (b[2] - a[2]) * t,
                ]);
                ni = newVerts.length - 1;
                edgeCut.set(key, ni);
            }
            return ni;
        };

        const newFaces: number[][] = [];
        const capEdges: [number, number][] = [];
        for (const face of faces) {
            const out: number[] = [];
            let capA = -1; let capB = -1;
            for (let i2 = 0; i2 < face.length; i2++) {
                const cur = face[i2];
                const nxt = face[(i2 + 1) % face.length];
                const dc = dist[cur]; const dn = dist[nxt];
                if (dc <= eps) out.push(keep(cur));
                if ((dc < -eps && dn > eps) || (dc > eps && dn < -eps)) {
                    const ni = cut(cur, nxt);
                    out.push(ni);
                    if (dc < -eps) capA = ni; else capB = ni;
                }
            }
            if (out.length >= 3) {
                newFaces.push(dedupeFace(out));
                if (capA >= 0 && capB >= 0) capEdges.push([capA, capB]);
            }
        }
        // Build the cap face by chaining the cut edges.
        if (capEdges.length >= 3) {
            const chain: number[] = [capEdges[0][0], capEdges[0][1]];
            const remaining = capEdges.slice(1);
            let guard = 0;
            while (remaining.length > 0 && guard++ < 1000) {
                const tail = chain[chain.length - 1];
                const idx = remaining.findIndex(([a2, b2]) => a2 === tail || b2 === tail);
                if (idx < 0) break;
                const [a2, b2] = remaining.splice(idx, 1)[0];
                chain.push(a2 === tail ? b2 : a2);
            }
            if (chain.length >= 4 && chain[0] === chain[chain.length - 1]) chain.pop();
            if (chain.length >= 3) newFaces.push(chain);
        }
        verts = newVerts;
        faces = newFaces;
        if (verts.length === 0 || faces.length === 0) return null;
    }
    return { verts, faces };
}

function dedupeFace(face: number[]): number[] {
    const out: number[] = [];
    for (const v of face) if (out[out.length - 1] !== v && !(out.length > 1 && out[0] === v)) out.push(v);
    return out;
}

/** Triangle count of a face-list polyhedron (fan triangulation). */
function polyTriangles(p: Poly): number {
    let n = 0;
    for (const f of p.faces) n += Math.max(0, f.length - 2);
    return n;
}

// ---------------------------------------------------------------------------
// Tangent-plane quadric meshing (Stage 4: mesh-clipped CSG)
// ---------------------------------------------------------------------------
//
// A cylinder, sphere or one-sheet cone intersected with half-spaces is a
// CONVEX solid, so the quadric can be replaced by its tangent half-spaces
// (midpoint tangents, splitting the tessellation error to ±r·(1−cos(π/N))/2)
// and the whole term clipped with the same convex plane-clipper used for
// planar cells. The result is watertight by construction — caps appear
// automatically where clip planes cut the solid.

/** Midpoint-tangent half-spaces around an axis-aligned circular cylinder. */
function cylinderTangentPlanes(cyl: CylC, segments: number): PlaneC[] {
    const out: PlaneC[] = [];
    // Circumscribed polygon overshoots by r(1/cos(π/N) − 1) at corners; use
    // the midpoint radius so tessellation error splits evenly inside/outside.
    const rEff = (cyl.r * (1 + 1 / Math.cos(Math.PI / segments))) / 2;
    for (let s = 0; s < segments; s++) {
        const ang = ((s + 0.5) / segments) * 2 * Math.PI;
        const cu = Math.cos(ang);
        const cv = Math.sin(ang);
        let n: Vec3;
        if (cyl.axis === 'x') n = [0, cu, cv];
        else if (cyl.axis === 'y') n = [cu, 0, cv];
        else n = [cu, cv, 0];
        const d = cyl.u0 * cu + cyl.v0 * cv + rEff;
        out.push({ n, d });
    }
    return out;
}

/** Tangent half-spaces around a sphere (spiral point distribution). */
function sphereTangentPlanes(c: Vec3, r: number, count: number): PlaneC[] {
    const out: PlaneC[] = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
        const y = 1 - (2 * (i + 0.5)) / count;
        const rad = Math.sqrt(Math.max(0, 1 - y * y));
        const th = golden * i;
        const n: Vec3 = [Math.cos(th) * rad, y, Math.sin(th) * rad];
        out.push({ n, d: n[0] * c[0] + n[1] * c[1] + n[2] * c[2] + r });
    }
    return out;
}

/** Tangent half-spaces around a one-sheet axis-aligned cone. */
function coneTangentPlanes(cone: ConeC, axis: Axis, segments: number): PlaneC[] {
    const out: PlaneC[] = [];
    const t = Math.sqrt(Math.max(1e-12, cone.t2));
    const sign = cone.sheet >= 0 ? 1 : -1;
    // Lateral tangent plane at angle θ: contains the apex, leans by the cone
    // half-angle. Its unit normal is (cosθ·cosφ, sinθ·cosφ, −sign·sinφ) in
    // (u, v, axis) components, where tanφ = t.
    const phi = Math.atan(t);
    const cphi = Math.cos(phi);
    const sphi = Math.sin(phi);
    for (let s = 0; s < segments; s++) {
        const ang = ((s + 0.5) / segments) * 2 * Math.PI;
        const cu = Math.cos(ang) * cphi;
        const cv = Math.sin(ang) * cphi;
        const ca = -sign * sphi;
        let n: Vec3;
        let apexDot: number;
        if (axis === 'x') { n = [ca, cu, cv]; apexDot = n[0] * cone.apex[0] + n[1] * cone.apex[1] + n[2] * cone.apex[2]; }
        else if (axis === 'y') { n = [cu, ca, cv]; apexDot = n[0] * cone.apex[0] + n[1] * cone.apex[1] + n[2] * cone.apex[2]; }
        else { n = [cu, cv, ca]; apexDot = n[0] * cone.apex[0] + n[1] * cone.apex[1] + n[2] * cone.apex[2]; }
        out.push({ n, d: apexDot });
    }
    return out;
}

/**
 * Mesh a convex quadric-with-planes term as a clipped polytope. Returns null
 * when clipping annihilates the region (legitimately empty).
 */
function emitConvexQuadricMesh(
    quadricPlanes: PlaneC[],
    clipPlanes: PlaneC[],
    ctx: EmitCtx,
    trianglesSoFar: { count: number },
): Emission | null {
    const poly = clipBoxByPlanes(ctx.bounds, [...quadricPlanes, ...clipPlanes]);
    if (!poly || poly.verts.length < 4) return { spec: [], status: 'exact' };
    trianglesSoFar.count += polyTriangles(poly);
    const centroid = polyCentroid(poly);
    const spec: CylinderSpec = {
        x: centroid[0], y: centroid[1], z: centroid[2],
        radius: 1, height: 1,
        shape: 'polyhedron',
        verts: poly.verts.flat(),
        faces: poly.faces,
        color: ctx.color, component: ctx.component, material: ctx.materialName,
        label: `${ctx.label} (mesh)`,
    };
    return { spec: [spec], status: 'exact', detail: 'mesh-clipped quadric' };
}

function vdotp(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

function polyCentroid(p: Poly): Vec3 {
    const c: Vec3 = [0, 0, 0];
    for (const v of p.verts) { c[0] += v[0]; c[1] += v[1]; c[2] += v[2]; }
    const n = Math.max(1, p.verts.length);
    return [c[0] / n, c[1] / n, c[2] / n];
}

// ---------------------------------------------------------------------------
// Term → primitive
// ---------------------------------------------------------------------------

interface EmitCtx {
    bounds: Bounds;
    color: string;
    materialName: string;
    component: ComponentId;
    label: string;
    /** Running CSG-mesh triangle count (drives tessellation coarsening). */
    triCounter: { count: number };
    maxTriangles: number;
}

type EmitStatus = 'exact' | 'approximated' | 'failed';

interface Emission {
    spec: CylinderSpec[];
    status: EmitStatus;
    detail?: string;
}

/** Axial window [lo, hi] along `axis` from the term's planes. */
function axialWindow(planes: PlaneC[], axis: Axis, bounds: Bounds): { lo: number; hi: number; leftovers: PlaneC[] } {
    const ai = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    let lo = bounds.min[ai];
    let hi = bounds.max[ai];
    const leftovers: PlaneC[] = [];
    for (const pl of planes) {
        const alignment = pl.n[ai];
        const offAxis = Math.hypot(pl.n[(ai + 1) % 3], pl.n[(ai + 2) % 3]);
        if (Math.abs(alignment) > 0.9999 && offAxis < 1e-6) {
            // n·p ≤ d ⇒ p_ai ≤ d/alignment (alignment ±1)
            const val = pl.d / alignment;
            if (alignment > 0) hi = Math.min(hi, val);
            else lo = Math.max(lo, val);
        } else {
            leftovers.push(pl);
        }
    }
    return { lo, hi, leftovers };
}

function emitCylinderTerm(bk: TermBuckets, ctx: EmitCtx): Emission | null {
    if (bk.inCyl.length !== 1) return null;
    if (bk.inSphere.length || bk.inCone.length || bk.inEllipsoid.length || bk.inEllCyl.length || bk.inTorus.length) return null;
    if (hasBlocking(bk)) return null;
    const cyl = bk.inCyl[0];
    if (!cyl.axis) return null;
    // Coaxial hole?
    let inner = 0;
    let status: EmitStatus = 'exact';
    let detail: string | undefined;
    const extraOut: string[] = [];
    for (const oc of bk.outCyl) {
        if (oc.axis === cyl.axis && Math.abs(oc.u0 - cyl.u0) < 1e-9 && Math.abs(oc.v0 - cyl.v0) < 1e-9 && oc.r < cyl.r) {
            inner = Math.max(inner, oc.r);
        } else {
            extraOut.push('non-coaxial outside-cylinder ignored');
        }
    }
    if (bk.outSphere.length > 0) extraOut.push('outside-sphere hole ignored');
    if (bk.outTorus.length > 0) extraOut.push('outside-torus hole ignored');

    const { lo, hi, leftovers } = axialWindow(bk.planes, cyl.axis, ctx.bounds);
    if (hi <= lo) return { spec: [], status: 'exact' }; // empty region: nothing to draw
    if (leftovers.length > 0 && inner === 0 && extraOut.length === 0 && bk.unsupported.length === 0) {
        // Oblique clips on a solid cylinder: the term is convex — mesh it
        // from tangent half-spaces and clip exactly (Stage 4 mesh path).
        const segs = csgSegmentBudget(ctx.triCounter.count, ctx.maxTriangles);
        const meshed = emitConvexQuadricMesh(cylinderTangentPlanes(cyl, segs), bk.planes, ctx, ctx.triCounter);
        if (meshed) return meshed;
    }
    if (leftovers.length > 0) {
        status = 'approximated';
        detail = 'oblique clipping plane(s) ignored (annular/held-out constraints prevent meshing)';
    }
    if (extraOut.length > 0) {
        status = 'approximated';
        detail = detail ? `${detail}; ${extraOut[0]}` : extraOut[0];
    }
    if (bk.unsupported.length > 0) {
        status = 'approximated';
        detail = detail ? `${detail}; ${firstNote(bk)}` : firstNote(bk);
    }

    const mid = (lo + hi) / 2;
    const h = hi - lo;
    const spec: CylinderSpec = {
        x: 0, y: 0, z: 0,
        radius: cyl.r, height: h,
        innerRadius: inner > 0 ? inner : undefined,
        color: ctx.color, component: ctx.component, material: ctx.materialName,
        label: ctx.label,
    };
    if (cyl.axis === 'z') { spec.x = cyl.u0; spec.y = cyl.v0; spec.z = mid; }
    else if (cyl.axis === 'x') { spec.axis = 'x'; spec.x = mid; spec.y = cyl.u0; spec.z = cyl.v0; }
    else { spec.axis = 'y'; spec.y = mid; spec.x = cyl.u0; spec.z = cyl.v0; }
    return { spec: [spec], status, detail };
}

/** Same centre to within a hair — concentric shells are the common case. */
function sameCentre(a: Vec3, b: Vec3): boolean {
    return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9 && Math.abs(a[2] - b[2]) < 1e-9;
}

function emitSphereTerm(bk: TermBuckets, ctx: EmitCtx): Emission | null {
    if (bk.inSphere.length < 1) return null;
    if (bk.inCyl.length || bk.inCone.length || bk.inEllipsoid.length || bk.inEllCyl.length || bk.inTorus.length) return null;
    if (hasBlocking(bk)) return null;
    // Concentric spheres intersect to the smallest one. Expanding a `#`
    // complement routinely produces such terms, and they are exact, so collapse
    // rather than falling through to a bounding box.
    let s = bk.inSphere[0];
    if (bk.inSphere.length > 1) {
        if (!bk.inSphere.every((o) => sameCentre(o.c, s.c))) return null;
        for (const o of bk.inSphere) if (o.r < s.r) s = o;
    }
    // A concentric subtracted sphere is an annulus (exact); one at least as big
    // as the kept sphere leaves nothing at all, which is also exact.
    const concentricOut = bk.outSphere.filter((o) => sameCentre(o.c, s.c));
    const innerR = concentricOut.reduce((m, o) => Math.max(m, o.r), 0);
    if (innerR >= s.r) return { spec: [], status: 'exact' };
    const otherOut = bk.outSphere.filter((o) => !sameCentre(o.c, s.c));
    if (innerR > 0 && bk.planes.length === 0 && bk.outCyl.length === 0
        && otherOut.length === 0 && bk.unsupported.length === 0) {
        return {
            spec: [{
                x: s.c[0], y: s.c[1], z: s.c[2],
                radius: s.r, innerRadius: innerR, height: 2 * s.r,
                shape: 'sphere',
                color: ctx.color, component: ctx.component, material: ctx.materialName,
                label: ctx.label,
            }],
            status: 'exact',
        };
    }
    if (bk.planes.length > 0 && bk.outCyl.length === 0 && bk.outSphere.length === 0 && bk.unsupported.length === 0) {
        // Sphere with plane clips is convex: mesh from tangent half-spaces.
        const segs = csgSegmentBudget(ctx.triCounter.count, ctx.maxTriangles);
        const meshed = emitConvexQuadricMesh(sphereTangentPlanes(s.c, s.r, Math.max(32, segs)), bk.planes, ctx, ctx.triCounter);
        if (meshed) return meshed;
    }
    let status: EmitStatus = 'exact';
    let detail: string | undefined;
    if (bk.planes.length > 0 || bk.outCyl.length > 0 || bk.unsupported.length > 0 || bk.outSphere.length > 0) {
        status = 'approximated';
        detail = 'sphere drawn unclipped (clipping constraints ignored)';
    }
    const spec: CylinderSpec = {
        x: s.c[0], y: s.c[1], z: s.c[2],
        radius: s.r, height: 2 * s.r,
        innerRadius: innerR > 0 ? innerR : undefined,
        shape: 'sphere',
        color: ctx.color, component: ctx.component, material: ctx.materialName,
        label: ctx.label,
        opacity: status === 'approximated' ? 0.85 : undefined,
    };
    return { spec: [spec], status, detail };
}

function emitConeTerm(bk: TermBuckets, ctx: EmitCtx): Emission | null {
    if (bk.inCone.length !== 1) return null;
    if (bk.inCyl.length || bk.inSphere.length || bk.inEllipsoid.length || bk.inEllCyl.length || bk.inTorus.length) return null;
    if (hasBlocking(bk)) return null;
    const cone = bk.inCone[0];
    const axis = axisOf(cone.axis);
    if (!axis) return null;
    const t = Math.sqrt(Math.max(0, cone.t2));
    const { lo, hi, leftovers } = axialWindow(bk.planes, axis, ctx.bounds);
    if (hi <= lo) return { spec: [], status: 'exact' };
    const ai = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    const apexS = cone.apex[ai];
    // Selected sheet limits the window to one side of the apex.
    let wLo = lo; let wHi = hi;
    if (cone.sheet === 1) wLo = Math.max(wLo, apexS);
    if (cone.sheet === -1) wHi = Math.min(wHi, apexS);
    if (cone.sheet === 0) {
        // Two-sheet cone in a window: pick the wider side, approximated.
        if (apexS > wLo && apexS < wHi) {
            if (apexS - wLo >= wHi - apexS) wHi = apexS; else wLo = apexS;
        }
    }
    if (wHi <= wLo) return { spec: [], status: 'exact' };
    const rAtLo = Math.abs(wLo - apexS) * t;
    const rAtHi = Math.abs(wHi - apexS) * t;
    if (leftovers.length > 0 && cone.sheet !== 0 && bk.unsupported.length === 0 && bk.outCyl.length === 0 && bk.outSphere.length === 0) {
        // One-sheet cone with oblique clips is convex: mesh it.
        const segs = csgSegmentBudget(ctx.triCounter.count, ctx.maxTriangles);
        const meshed = emitConvexQuadricMesh(coneTangentPlanes(cone, axis, segs), bk.planes, ctx, ctx.triCounter);
        if (meshed) return meshed;
    }
    let status: EmitStatus = 'exact';
    let detail: string | undefined;
    if (leftovers.length > 0 || bk.unsupported.length > 0 || bk.outCyl.length > 0 || bk.outSphere.length > 0) {
        status = 'approximated';
        detail = 'cone clipped only along its axis';
    }
    if (cone.sheet === 0) { status = 'approximated'; detail = detail ?? 'two-sheet cone: drew the dominant sheet'; }
    const mid = (wLo + wHi) / 2;
    const spec: CylinderSpec = {
        x: cone.apex[0], y: cone.apex[1], z: cone.apex[2],
        radius: Math.max(rAtLo, 1e-4), topRadius: Math.max(rAtHi, 0),
        height: wHi - wLo,
        shape: 'cone', axis,
        color: ctx.color, component: ctx.component, material: ctx.materialName,
        label: ctx.label,
    };
    // Center the primitive on the window midpoint along its axis.
    if (axis === 'x') spec.x = mid; else if (axis === 'y') spec.y = mid; else spec.z = mid;
    return { spec: [spec], status, detail };
}

function emitEllipsoidTerm(bk: TermBuckets, ctx: EmitCtx): Emission | null {
    if (bk.inEllipsoid.length !== 1) return null;
    if (bk.inCyl.length || bk.inSphere.length || bk.inCone.length || bk.inEllCyl.length || bk.inTorus.length) return null;
    if (hasBlocking(bk)) return null;
    const e = bk.inEllipsoid[0];
    const clipped = bk.planes.length > 0 || bk.unsupported.length > 0;
    const spec: CylinderSpec = {
        x: e.c[0], y: e.c[1], z: e.c[2],
        radius: e.rx, height: 2 * e.rz,
        halfX: e.rx, halfY: e.ry, halfZ: e.rz,
        shape: 'ellipsoid',
        color: ctx.color, component: ctx.component, material: ctx.materialName,
        label: ctx.label,
        opacity: clipped ? 0.85 : undefined,
    };
    return {
        spec: [spec],
        status: clipped ? 'approximated' : 'exact',
        detail: clipped ? 'ellipsoid drawn unclipped' : undefined,
    };
}

function emitEllCylTerm(bk: TermBuckets, ctx: EmitCtx): Emission | null {
    if (bk.inEllCyl.length !== 1) return null;
    if (bk.inCyl.length || bk.inSphere.length || bk.inCone.length || bk.inEllipsoid.length || bk.inTorus.length) return null;
    if (hasBlocking(bk)) return null;
    const ec = bk.inEllCyl[0];
    const { lo, hi, leftovers } = axialWindow(bk.planes, ec.axis, ctx.bounds);
    if (hi <= lo) return { spec: [], status: 'exact' };
    const status: EmitStatus = leftovers.length > 0 || bk.unsupported.length > 0 ? 'approximated' : 'exact';
    const mid = (lo + hi) / 2;
    const spec: CylinderSpec = {
        x: 0, y: 0, z: 0,
        radius: Math.max(ec.r1, ec.r2), height: hi - lo,
        halfX: ec.r1, halfY: ec.r2,
        shape: 'ellcyl', axis: ec.axis,
        color: ctx.color, component: ctx.component, material: ctx.materialName,
        label: ctx.label,
    };
    if (ec.axis === 'z') { spec.x = ec.c[0]; spec.y = ec.c[1]; spec.z = mid; }
    else if (ec.axis === 'x') { spec.x = mid; spec.y = ec.c[0]; spec.z = ec.c[1]; }
    else { spec.y = mid; spec.x = ec.c[0]; spec.z = ec.c[1]; }
    return {
        spec: [spec], status,
        detail: status === 'approximated' ? 'elliptic cylinder clipped only along its axis' : undefined,
    };
}

function emitTorusTerm(bk: TermBuckets, ctx: EmitCtx): Emission | null {
    if (bk.inTorus.length !== 1) return null;
    if (bk.inCyl.length || bk.inSphere.length || bk.inCone.length || bk.inEllipsoid.length || bk.inEllCyl.length) return null;
    if (hasBlocking(bk)) return null;
    const t = bk.inTorus[0];
    const clipped = bk.planes.length > 0 || bk.unsupported.length > 0;
    const spec: CylinderSpec = {
        x: t.center[0], y: t.center[1], z: t.center[2],
        radius: t.major, tube: t.tube, height: 2 * t.tube,
        shape: 'torus', axis: t.axis,
        color: ctx.color, component: ctx.component, material: ctx.materialName,
        label: ctx.label,
        opacity: clipped ? 0.85 : undefined,
    };
    return {
        spec: [spec],
        status: clipped ? 'approximated' : 'exact',
        detail: clipped ? 'torus drawn unclipped' : undefined,
    };
}

function emitPolyhedronTerm(bk: TermBuckets, ctx: EmitCtx): Emission | null {
    if (bk.planes.length === 0) return null;
    if (bk.inCyl.length || bk.inSphere.length || bk.inCone.length || bk.inEllipsoid.length || bk.inEllCyl.length || bk.inTorus.length) return null;
    if (bk.outCyl.length || bk.outSphere.length || bk.outTorus.length) return null;
    if (hasBlocking(bk)) return null;
    const poly = clipBoxByPlanes(ctx.bounds, bk.planes);
    if (!poly || poly.verts.length < 4) return { spec: [], status: 'exact' }; // empty region
    ctx.triCounter.count += polyTriangles(poly);
    const centroid = polyCentroid(poly);
    const status: EmitStatus = bk.unsupported.length > 0 ? 'approximated' : 'exact';
    const spec: CylinderSpec = {
        x: centroid[0], y: centroid[1], z: centroid[2],
        radius: 1, height: 1,
        shape: 'polyhedron',
        verts: poly.verts.flat(),
        faces: poly.faces,
        color: ctx.color, component: ctx.component, material: ctx.materialName,
        label: ctx.label,
    };
    return { spec: [spec], status, detail: status === 'approximated' ? firstNote(bk) : undefined };
}

/** Last resort: translucent bounding box of the term's planar window. */
function emitFallback(bk: TermBuckets, ctx: EmitCtx, why: string): Emission {
    const wx = axialWindow(bk.planes, 'x', ctx.bounds);
    const wy = axialWindow(bk.planes, 'y', ctx.bounds);
    const wz = axialWindow(bk.planes, 'z', ctx.bounds);
    const spec: CylinderSpec = {
        x: (wx.lo + wx.hi) / 2, y: (wy.lo + wy.hi) / 2, z: (wz.lo + wz.hi) / 2,
        radius: Math.max(0.01, (wx.hi - wx.lo) / 2),
        halfX: Math.max(0.01, (wx.hi - wx.lo) / 2),
        halfY: Math.max(0.01, (wy.hi - wy.lo) / 2),
        height: Math.max(0.01, wz.hi - wz.lo),
        shape: 'box',
        opacity: 0.25,
        color: ctx.color, component: ctx.component, material: ctx.materialName,
        label: `${ctx.label} (unresolved)`,
    };
    return { spec: [spec], status: 'failed', detail: why };
}

// ---------------------------------------------------------------------------
// Cell → primitives
// ---------------------------------------------------------------------------

function applyCellTransformToSpecs(specs: CylinderSpec[], trcl: Transform | null): void {
    if (!trcl) return;
    for (const s of specs) {
        const p = toMain(trcl, [s.x, s.y, s.z]);
        s.x = p[0]; s.y = p[1]; s.z = p[2];
        // Rotation of oriented primitives is not folded in (rare in practice
        // for trcl'd CSG cells); the census marks these approximated upstream.
    }
}

export interface BuildCsgOptions {
    maxPrimitives?: number;
    /** Cells to skip (already drawn by the fast path). */
    skipCells?: Set<number>;
    /** Triangle ceiling for meshed cells (default DEFAULT_MAX_CSG_TRIANGLES). */
    maxTriangles?: number;
}

/**
 * Build render primitives for material cells the fast path cannot draw.
 * Universe-0 cells only: filled/lattice cells belong to the fast path, and
 * the exterior (graveyard) is detected and never meshed.
 */
export function buildCsgScene(
    model: McnpGeometryModel,
    materials: Map<number, MaterialLookup>,
    opts: BuildCsgOptions = {},
): CsgSceneResult {
    const warnings: string[] = [];
    const notes: string[] = [];
    const census: CsgCensus = { exact: 0, approximated: 0, failed: 0, details: [] };
    const out: CylinderSpec[] = [];
    const maxPrims = opts.maxPrimitives && opts.maxPrimitives > 0 ? opts.maxPrimitives : 20000;
    const maxTriangles = opts.maxTriangles && opts.maxTriangles > 0 ? opts.maxTriangles : DEFAULT_MAX_CSG_TRIANGLES;
    const triCounter = { count: 0 };

    const rawBounds = worldBounds(model);
    // Pad the clip box: worldBounds is built from surface *positions*, so a
    // solid can extend past it (a wedge whose only axis-aligned plane sits at
    // its near face, say). Clipping against padded bounds keeps fully-bounded
    // polyhedra exact and merely widens the drawn extent of open regions.
    const pad = (lo: number, hi: number): [number, number] => {
        const m = 0.1 * Math.max(1, hi - lo) + 1;
        return [lo - m, hi + m];
    };
    const [bx0, bx1] = pad(rawBounds.min[0], rawBounds.max[0]);
    const [by0, by1] = pad(rawBounds.min[1], rawBounds.max[1]);
    const [bz0, bz1] = pad(rawBounds.min[2], rawBounds.max[2]);
    const bounds: Bounds = { min: [bx0, by0, bz0], max: [bx1, by1, bz1] };
    // A graveyard/exterior cell contains points far outside everything.
    const far: Vec3 = [
        bounds.max[0] + 10 * Math.max(1, bounds.max[0] - bounds.min[0]),
        bounds.max[1] + 7 * Math.max(1, bounds.max[1] - bounds.min[1]),
        bounds.max[2] + 13 * Math.max(1, bounds.max[2] - bounds.min[2]),
    ];

    const rootCells = model.universes.get(0) ?? [];
    for (const cellId of rootCells) {
        if (out.length >= maxPrims) {
            warnings.push(`CSG primitive budget (${maxPrims}) reached; remaining cells were not drawn.`);
            break;
        }
        const cell = model.cells.get(cellId);
        if (!cell || !cell.region) continue;
        if (opts.skipCells?.has(cellId)) continue;
        if (cell.fill || cell.lat !== 0) continue; // fast-path territory
        if (cellContains(model, cellId, far)) {
            notes.push(`Cell ${cellId} is the exterior/graveyard — not drawn.`);
            continue;
        }

        const matInfo = materials.get(cell.material) ?? {
            name: cell.material === 0 ? 'void' : `m${cell.material}`,
            component: cell.material === 0 ? Component.Other : Component.Structure,
        };
        const ctx: EmitCtx = {
            bounds,
            color: materialColor(matInfo.name),
            materialName: matInfo.name,
            component: matInfo.component,
            label: `cell ${cellId}`,
            triCounter,
            maxTriangles,
        };
        // Void cells are omitted from solid rendering like the fast path does
        // with moderator-less regions — but count them, don't hide the fact.
        if (cell.material === 0) {
            notes.push(`Cell ${cellId} is void — not drawn (enable slices to inspect it).`);
            continue;
        }

        const dnfCtx: DnfCtx = { model, stack: new Set([cellId]) };
        const dnf = cell.region ? toDnf(cell.region, false, dnfCtx) : null;
        if (!dnf) {
            const em = emitFallback(newBuckets(), ctx, dnfCtx.reason ?? 'region is too complex to expand');
            applyCellTransformToSpecs(em.spec, cell.trcl);
            out.push(...em.spec);
            census.failed++;
            census.details.push(`cell ${cellId}: failed (${em.detail})`);
            warnings.push(`Cell ${cellId}: drew a translucent bounding box — ${em.detail}.`);
            continue;
        }

        let worst: EmitStatus = 'exact';
        let worstDetail: string | undefined;
        const cellSpecs: CylinderSpec[] = [];
        for (const term of dnf) {
            const bk = newBuckets();
            for (const lit of term) {
                const surf = resolveSurface(model, lit.surface);
                if (!surf) {
                    bk.unsupported.push({ msg: `surface ${lit.surface} undefined`, blocking: true });
                    continue;
                }
                let shape: Shape = surf.surface.shape;
                if (lit.facet > 0) {
                    if (shape.kind === 'body' && shape.facets[lit.facet - 1]) {
                        shape = shape.facets[lit.facet - 1];
                    } else {
                        bk.unsupported.push({ msg: `facet ${lit.surface}.${lit.facet} not found`, blocking: true });
                        continue;
                    }
                }
                bucketShape(bk, shape, lit.sense, surf.tr, `surface ${lit.surface}`);
            }

            const em =
                emitCylinderTerm(bk, ctx) ??
                emitSphereTerm(bk, ctx) ??
                emitConeTerm(bk, ctx) ??
                emitEllipsoidTerm(bk, ctx) ??
                emitEllCylTerm(bk, ctx) ??
                emitTorusTerm(bk, ctx) ??
                emitPolyhedronTerm(bk, ctx) ??
                emitFallback(bk, ctx, firstNote(bk) ?? 'mixed quadric constraints');
            cellSpecs.push(...em.spec);
            if (em.status === 'failed' && worst !== 'failed') { worst = 'failed'; worstDetail = em.detail; }
            else if (em.status === 'approximated' && worst === 'exact') { worst = 'approximated'; worstDetail = em.detail; }
        }

        applyCellTransformToSpecs(cellSpecs, cell.trcl);
        if (cell.trcl && cell.trcl.m && worst === 'exact') {
            worst = 'approximated';
            worstDetail = 'trcl rotation applied to positions only';
        }
        out.push(...cellSpecs);
        if (worst === 'exact') census.exact++;
        else if (worst === 'approximated') {
            census.approximated++;
            census.details.push(`cell ${cellId}: approximated (${worstDetail ?? 'see notes'})`);
        } else {
            census.failed++;
            census.details.push(`cell ${cellId}: failed (${worstDetail ?? 'unresolved constraints'})`);
            warnings.push(`Cell ${cellId}: drew a translucent bounding box — ${worstDetail ?? 'unresolved constraints'}.`);
        }
    }

    const total = census.exact + census.approximated + census.failed;
    if (total > 0) {
        notes.push(
            `CSG engine: ${census.exact} of ${total} cell(s) rendered exactly` +
            (census.approximated ? `, ${census.approximated} approximated` : '') +
            (census.failed ? `, ${census.failed} as translucent bounds` : '') +
            (triCounter.count > 0 ? ` (${triCounter.count.toLocaleString()} mesh triangles)` : '') + '.',
        );
    }
    return { cylinders: out, census, warnings, notes };
}

function resolveSurface(model: McnpGeometryModel, id: number): { surface: McnpSurface; tr: Transform | null } | null {
    const s = model.surfaces.get(id);
    if (s) return { surface: s, tr: s.tr };
    const gen = model.generatedSurfaces.get(id);
    if (gen) {
        const base = model.surfaces.get(gen.surface);
        if (base) {
            // Generated surface: base surface relocated by the master cell's
            // trcl. Compose: only translations fold exactly here; rotations
            // mark the term approximated via bucketShape's transform check.
            const composed: Transform = base.tr
                ? { o: [base.tr.o[0] + gen.tr.o[0], base.tr.o[1] + gen.tr.o[1], base.tr.o[2] + gen.tr.o[2]], m: base.tr.m ?? gen.tr.m, origin: 1 }
                : gen.tr;
            return { surface: base, tr: composed };
        }
    }
    return null;
}
