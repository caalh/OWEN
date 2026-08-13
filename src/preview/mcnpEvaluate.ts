// Point-membership evaluation on the Stage-1 MCNP geometry model.
//
// This is the oracle everything downstream trusts: the 2D slice plotter
// classifies pixels with findCell, the CSG mesher checks its output volumes
// against cellContains, and the corpus tests compare both against analytic
// volumes. Keep it pure and allocation-light — slice rendering calls this
// hundreds of thousands of times per frame.
//
// Sense convention (manual §1.3, §5.3): f(p) < 0 is the negative side of a
// surface; a `-N` halfspace keeps f < 0, `+N` keeps f > 0. The space inside a
// macrobody is negative with respect to the body and all its facets
// (§5.3.4). One-sheet cones evaluate only the selected sheet. LAT index
// resolution follows §5.5.5: the element described by the cell's surfaces is
// (0,0,0) and the first listed surface pair runs the first index.

import {
    Fill,
    McnpCell,
    McnpGeometryModel,
    McnpSurface,
    RegionNode,
    Shape,
    toAux,
    Transform,
    Vec3,
} from './mcnpGeometry';

/** Nested-geometry recursion cap (Table 4.1: max 20 levels). */
const MAX_DEPTH = 20;

/** Numerical tolerance on f(p) for "on the surface" (oracle comparisons skip
 *  disagreements within ε of a surface). */
export const SURFACE_EPS = 1e-9;

// ---------------------------------------------------------------------------
// Shape evaluation: f(p), negative = inside
// ---------------------------------------------------------------------------

export function shapeValue(shape: Shape, p: Vec3): number {
    switch (shape.kind) {
        case 'plane':
            return shape.n[0] * p[0] + shape.n[1] * p[1] + shape.n[2] * p[2] - shape.d;
        case 'quadric': {
            const [x, y, z] = p;
            return (
                shape.a * x * x + shape.b * y * y + shape.c * z * z +
                shape.d * x * y + shape.e * y * z + shape.f * z * x +
                shape.g * x + shape.h * y + shape.j * z + shape.k
            );
        }
        case 'cone': {
            const dx = p[0] - shape.apex[0];
            const dy = p[1] - shape.apex[1];
            const dz = p[2] - shape.apex[2];
            const s = dx * shape.axis[0] + dy * shape.axis[1] + dz * shape.axis[2];
            const perp2 = dx * dx + dy * dy + dz * dz - s * s;
            const f = perp2 - shape.t2 * s * s;
            if (shape.sheet === 0) return f;
            // One-sheet cone: on the unselected side of the apex every point
            // is outside the surface (positive), regardless of f.
            if (shape.sheet === 1 && s < 0) return Math.max(f, perp2 + s * s);
            if (shape.sheet === -1 && s > 0) return Math.max(f, perp2 + s * s);
            return f;
        }
        case 'torus': {
            // (s−s̄ axial dist, r radial dist): ((r−a)/b … MCNP tori:
            // (x−x̄,…) with A = major radius, B/C = minor half-axes:
            //   ( s² / C² ) form — MCNP torus: (ρ−A)²/B² + s²/C²… careful:
            // manual Table 5.1: (x−x̄)²/B² + (√((y−ȳ)²+(z−z̄)²) − A)²/C² − 1 = 0
            // for TX (axis x), with B the axial and C the radial semi-axis.
            const dx = p[0] - shape.center[0];
            const dy = p[1] - shape.center[1];
            const dz = p[2] - shape.center[2];
            let s: number;    // along the torus axis
            let rho: number;  // distance from the axis
            if (shape.axis === 'x') { s = dx; rho = Math.hypot(dy, dz); }
            else if (shape.axis === 'y') { s = dy; rho = Math.hypot(dx, dz); }
            else { s = dz; rho = Math.hypot(dx, dy); }
            const B = shape.b !== 0 ? shape.b : 1e-12;
            const C = shape.c !== 0 ? shape.c : 1e-12;
            return (s * s) / (B * B) + ((rho - shape.a) * (rho - shape.a)) / (C * C) - 1;
        }
        case 'body': {
            // Inside the body = inside every facet → f = max over facets.
            let worst = -Infinity;
            for (const facet of shape.facets) {
                const v = shapeValue(facet, p);
                if (v > worst) worst = v;
            }
            return worst;
        }
    }
}

/** f(p) for a surface (or one of its facets), applying its TR if present. */
export function surfaceValue(surface: McnpSurface, facet: number, p: Vec3): number {
    const q = surface.tr ? toAux(surface.tr, p) : p;
    if (facet > 0 && surface.shape.kind === 'body') {
        const f = surface.shape.facets[facet - 1];
        return f ? shapeValue(f, q) : NaN;
    }
    return shapeValue(surface.shape, q);
}

// ---------------------------------------------------------------------------
// Region evaluation
// ---------------------------------------------------------------------------

interface EvalCtx {
    model: McnpGeometryModel;
    /** Cell this evaluation started from (seeds the cellcomp cycle guard). */
    root: number;
    /**
     * Cells currently being evaluated (cellcomp cycle guard), allocated only
     * once a `#cell` complement is actually reached. Slice rendering evaluates
     * millions of regions and the vast majority contain no complement at all,
     * so an eager Set per call was pure garbage-collector pressure.
     */
    stack: Set<number> | null;
}

function halfspaceContains(
    ctx: EvalCtx,
    surfaceId: number,
    facet: number,
    sense: 1 | -1,
    p: Vec3,
): boolean {
    let surface = ctx.model.surfaces.get(surfaceId);
    let point = p;
    if (!surface) {
        // Generated surface (1000×cell + surface) from a TRCL master cell.
        const gen = ctx.model.generatedSurfaces.get(surfaceId);
        if (!gen) return false; // undefined surface: nothing can be inside it
        surface = ctx.model.surfaces.get(gen.surface);
        if (!surface) return false;
        point = toAux(gen.tr, p);
    }
    const f = surfaceValue(surface, facet, point);
    if (Number.isNaN(f)) return false;
    return sense === -1 ? f < 0 : f > 0;
}

function regionContains(ctx: EvalCtx, region: RegionNode, p: Vec3): boolean {
    switch (region.op) {
        case 'halfspace':
            return halfspaceContains(ctx, region.surface, region.facet, region.sense, p);
        case 'and': {
            for (const k of region.kids) if (!regionContains(ctx, k, p)) return false;
            return true;
        }
        case 'or': {
            for (const k of region.kids) if (regionContains(ctx, k, p)) return true;
            return false;
        }
        case 'not':
            return !regionContains(ctx, region.kid, p);
        case 'cellcomp': {
            if (!ctx.stack) ctx.stack = new Set([ctx.root]);
            if (ctx.stack.has(region.cell)) return false; // #-cycle: fail closed
            const target = ctx.model.cells.get(region.cell);
            if (!target || !target.region) return false;
            ctx.stack.add(region.cell);
            // The complement is of the cell as placed (its trcl included).
            const q = target.trcl ? toAux(target.trcl, p) : p;
            const inside = regionContains(ctx, target.region, q);
            ctx.stack.delete(region.cell);
            return !inside;
        }
    }
}

/**
 * Is the point inside this cell (evaluated in the cell's own universe frame)?
 * Applies the cell's TRCL: the cell was described in an auxiliary system and
 * placed by trcl, so membership is tested at the pulled-back point.
 */
export function cellContains(model: McnpGeometryModel, cellId: number, p: Vec3): boolean {
    const cell = model.cells.get(cellId);
    if (!cell || !cell.region) return false;
    const ctx: EvalCtx = { model, root: cellId, stack: null };
    const q = cell.trcl ? toAux(cell.trcl, p) : p;
    return regionContains(ctx, cell.region, q);
}

// ---------------------------------------------------------------------------
// Universe descent (findCell)
// ---------------------------------------------------------------------------

export interface FoundCell {
    /** Deepest (material) cell containing the point; null when lost. */
    cell: McnpCell | null;
    /** Path of cell ids from universe 0 down to the material cell. */
    path: number[];
    /** Universe-0-level cells that all claimed the point (overlap ⇔ >1). */
    overlaps: number[];
    /** True when no cell in some universe on the path contained the point. */
    lost: boolean;
    /** Lattice element indices encountered on the way down (outermost first). */
    latticeIndices: [number, number, number][];
}

interface LatticeBasis {
    origin: Vec3;   // center of element (0,0,0)
    a: Vec3[];      // index basis vectors (1–3 of them)
    /**
     * (AᵀA)⁻¹Aᵀ for A = [a₁ … a_n], precomputed so resolving a point's
     * fractional lattice coordinates is one small matrix-vector product
     * instead of a Gaussian elimination. Absent when AᵀA is singular.
     */
    pinv?: number[][];
}

/**
 * Per-model cache of derived lattice bases. Deriving a basis pairs the window
 * planes and solves a 3×3 system; doing that per sampled point made a
 * full-core slice tens of times slower than the membership tests it exists to
 * serve. Keyed weakly by model so a re-parsed deck drops its cache.
 */
const latticeBasisCache = new WeakMap<McnpGeometryModel, Map<number, LatticeBasis | null>>();

function cachedLatticeBasis(model: McnpGeometryModel, cell: McnpCell): LatticeBasis | null {
    let perModel = latticeBasisCache.get(model);
    if (!perModel) {
        perModel = new Map();
        latticeBasisCache.set(model, perModel);
    }
    if (perModel.has(cell.id)) return perModel.get(cell.id) ?? null;
    const basis = latticeBasis(model, cell);
    perModel.set(cell.id, basis);
    return basis;
}

/** Neighborhood offsets for the hex/rhombic index verification search. */
const NEIGHBOR_DELTAS: readonly number[][] = (() => {
    const range = [0, 1, -1];
    const out: number[][] = [];
    for (const di of range) for (const dj of range) for (const dk of range) out.push([di, dj, dk]);
    return out;
})();

/**
 * Derive the lattice element basis from the lattice cell's bounding planes.
 * §5.5.5: the element described by the cell's surfaces is (0,0,0), and the
 * ordering of listed surfaces fixes which neighbor is (1,0,0): the first
 * listed surface pair runs the first index. Works for px/py/pz pairs and for
 * general `p` planes (skewed lattices); hex (lat=2) uses its first two
 * opposing side-plane pairs the same way.
 */
function latticeBasis(model: McnpGeometryModel, cell: McnpCell): LatticeBasis | null {
    interface PlaneRef { n: Vec3; d: number }
    const planes: PlaneRef[] = [];
    const seen = new Set<number>();
    for (const sid of cell.surfaceOrder) {
        if (seen.has(sid)) continue;
        seen.add(sid);
        const s = model.surfaces.get(sid);
        if (!s) continue;
        if (s.shape.kind === 'plane' && !s.tr) {
            planes.push({ n: s.shape.n, d: s.shape.d });
        } else if (s.shape.kind === 'body') {
            // An RPP/RHP window: use its planar facets in facet order.
            for (const f of s.shape.facets) {
                if (f.kind === 'plane') planes.push({ n: f.n, d: f.d });
            }
        }
    }
    if (planes.length < 2) return null;

    // Pair opposing planes (n·p=d1 vs ±n·p=d2) in listed order. §5.5.5: the
    // FIRST listed surface of a pair is the one crossed toward the +index
    // neighbor, so the basis vector points from the partner plane toward it.
    // A pair whose direction is linearly dependent on the accepted basis is
    // skipped — a hexagonal window (rhp / synthesized hex) has three facet
    // pairs in one plane, and only the first two are index directions; the
    // third would make the fractional-index solve singular.
    const pairs: { n: Vec3; dFirst: number; dPartner: number }[] = [];
    const used = new Array(planes.length).fill(false);
    const independent = (n: Vec3): boolean => {
        if (pairs.length === 0) return true;
        if (pairs.length === 1) {
            const a = pairs[0].n;
            const cross = [
                a[1] * n[2] - a[2] * n[1],
                a[2] * n[0] - a[0] * n[2],
                a[0] * n[1] - a[1] * n[0],
            ];
            return Math.hypot(cross[0], cross[1], cross[2]) > 1e-6;
        }
        const a = pairs[0].n;
        const b = pairs[1].n;
        const det =
            a[0] * (b[1] * n[2] - b[2] * n[1]) -
            a[1] * (b[0] * n[2] - b[2] * n[0]) +
            a[2] * (b[0] * n[1] - b[1] * n[0]);
        return Math.abs(det) > 1e-6;
    };
    for (let i = 0; i < planes.length && pairs.length < 3; i++) {
        if (used[i]) continue;
        for (let j = i + 1; j < planes.length; j++) {
            if (used[j]) continue;
            const dot = planes[i].n[0] * planes[j].n[0] + planes[i].n[1] * planes[j].n[1] + planes[i].n[2] * planes[j].n[2];
            if (Math.abs(Math.abs(dot) - 1) > 1e-6) continue;
            const dj = dot > 0 ? planes[j].d : -planes[j].d;
            if (Math.abs(dj - planes[i].d) < 1e-12) continue; // same plane
            used[i] = used[j] = true;
            if (independent(planes[i].n)) {
                pairs.push({ n: planes[i].n, dFirst: planes[i].d, dPartner: dj });
            }
            break;
        }
    }
    if (pairs.length === 0) return null;

    // Element center: solve n_k · c = midpoint_k for all pairs at once via
    // normal equations (hex windows have non-orthogonal normals, so summing
    // per-axis contributions would smear the origin). Unconstrained axes
    // (e.g. z for a 2D window) are pinned to 0 by regularizing their row.
    const N: number[][] = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
    ];
    const rhs: Vec3 = [0, 0, 0];
    const a: Vec3[] = [];
    for (const pair of pairs) {
        const width = pair.dFirst - pair.dPartner; // signed: toward the first-listed plane
        a.push([pair.n[0] * width, pair.n[1] * width, pair.n[2] * width]);
        const mid = (pair.dFirst + pair.dPartner) / 2;
        for (let r = 0; r < 3; r++) {
            for (let c2 = 0; c2 < 3; c2++) N[r][c2] += pair.n[r] * pair.n[c2];
            rhs[r] += pair.n[r] * mid;
        }
    }
    for (let r = 0; r < 3; r++) {
        if (Math.abs(N[r][r]) < 1e-12) {
            N[r] = [0, 0, 0];
            N[r][r] = 1;
            rhs[r] = 0;
        }
    }
    const origin = solve3(N, rhs) ?? ([0, 0, 0] as Vec3);
    return { origin, a, pinv: pseudoInverse(a) };
}

/**
 * (AᵀA)⁻¹Aᵀ for the n ≤ 3 basis vectors of a lattice, as n rows of 3.
 * Undefined when AᵀA is singular (degenerate window), in which case the
 * per-point solve is used instead.
 */
function pseudoInverse(a: Vec3[]): number[][] | undefined {
    const n = a.length;
    if (n === 0) return undefined;
    // AtA (n×n) augmented with Aᵀ (n×3); Gauss-Jordan yields (AᵀA)⁻¹Aᵀ.
    const M: number[][] = [];
    for (let i = 0; i < n; i++) {
        const row: number[] = [];
        for (let j = 0; j < n; j++) {
            row.push(a[i][0] * a[j][0] + a[i][1] * a[j][1] + a[i][2] * a[j][2]);
        }
        row.push(a[i][0], a[i][1], a[i][2]);
        M.push(row);
    }
    for (let col = 0; col < n; col++) {
        let pivot = col;
        for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
        if (Math.abs(M[pivot][col]) < 1e-15) return undefined;
        if (pivot !== col) { const t = M[pivot]; M[pivot] = M[col]; M[col] = t; }
        const d = M[col][col];
        for (let c = col; c < n + 3; c++) M[col][c] /= d;
        for (let r = 0; r < n; r++) {
            if (r === col) continue;
            const f = M[r][col];
            if (f === 0) continue;
            for (let c = col; c < n + 3; c++) M[r][c] -= f * M[col][c];
        }
    }
    return M.map((row) => row.slice(n, n + 3));
}

/** Solve a 3×3 linear system by Gaussian elimination; null when singular. */
function solve3(M: number[][], b: Vec3): Vec3 | null {
    const A = M.map((row) => row.slice());
    const x = [b[0], b[1], b[2]];
    for (let col = 0; col < 3; col++) {
        let pivot = col;
        for (let r = col + 1; r < 3; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
        if (Math.abs(A[pivot][col]) < 1e-15) return null;
        if (pivot !== col) {
            [A[pivot], A[col]] = [A[col], A[pivot]];
            [x[pivot], x[col]] = [x[col], x[pivot]];
        }
        for (let r = col + 1; r < 3; r++) {
            const f = A[r][col] / A[col][col];
            for (let c2 = col; c2 < 3; c2++) A[r][c2] -= f * A[col][c2];
            x[r] -= f * x[col];
        }
    }
    const out: Vec3 = [0, 0, 0];
    for (let r = 2; r >= 0; r--) {
        let sum = x[r];
        for (let c2 = r + 1; c2 < 3; c2++) sum -= A[r][c2] * out[c2];
        out[r] = sum / A[r][r];
    }
    return out;
}

/** Solve fractional lattice coordinates t for p = origin + Σ t_k a_k. */
function latticeFractions(basis: LatticeBasis, p: Vec3): number[] {
    const d: Vec3 = [p[0] - basis.origin[0], p[1] - basis.origin[1], p[2] - basis.origin[2]];
    const n = basis.a.length;
    if (basis.pinv) {
        const t = new Array<number>(n);
        for (let i = 0; i < n; i++) {
            const row = basis.pinv[i];
            t[i] = row[0] * d[0] + row[1] * d[1] + row[2] * d[2];
        }
        return t;
    }
    // Build and solve the small normal system Aᵀ A t = Aᵀ d (n ≤ 3).
    const AtA: number[][] = [];
    const Atd: number[] = [];
    for (let i = 0; i < n; i++) {
        AtA.push([]);
        for (let j = 0; j < n; j++) {
            AtA[i].push(basis.a[i][0] * basis.a[j][0] + basis.a[i][1] * basis.a[j][1] + basis.a[i][2] * basis.a[j][2]);
        }
        Atd.push(basis.a[i][0] * d[0] + basis.a[i][1] * d[1] + basis.a[i][2] * d[2]);
    }
    // Gaussian elimination (n ≤ 3).
    for (let col = 0; col < n; col++) {
        let pivot = col;
        for (let r = col + 1; r < n; r++) if (Math.abs(AtA[r][col]) > Math.abs(AtA[pivot][col])) pivot = r;
        if (Math.abs(AtA[pivot][col]) < 1e-15) return Atd.map(() => 0);
        if (pivot !== col) {
            [AtA[pivot], AtA[col]] = [AtA[col], AtA[pivot]];
            [Atd[pivot], Atd[col]] = [Atd[col], Atd[pivot]];
        }
        for (let r = col + 1; r < n; r++) {
            const f = AtA[r][col] / AtA[col][col];
            for (let c2 = col; c2 < n; c2++) AtA[r][c2] -= f * AtA[col][c2];
            Atd[r] -= f * Atd[col];
        }
    }
    const t = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
        let sum = Atd[r];
        for (let c2 = r + 1; c2 < n; c2++) sum -= AtA[r][c2] * t[c2];
        t[r] = sum / AtA[r][r];
    }
    return t;
}

/** Does the lattice cell's own window (region translated by A·k) contain p? */
function elementWindowContains(
    model: McnpGeometryModel,
    cell: McnpCell,
    basis: LatticeBasis,
    k: number[],
    p: Vec3,
): boolean {
    // Translate the point back by A·k and test the (0,0,0) window.
    const q: Vec3 = [p[0], p[1], p[2]];
    for (let i = 0; i < basis.a.length; i++) {
        q[0] -= basis.a[i][0] * k[i];
        q[1] -= basis.a[i][1] * k[i];
        q[2] -= basis.a[i][2] * k[i];
    }
    const ctx: EvalCtx = { model, root: cell.id, stack: null };
    return cell.region ? regionContains(ctx, cell.region, q) : false;
}

function fillEntryAt(fill: Fill, i: number, j: number, k: number): { universe: number; tr: Transform | null } | null {
    const g = fill.grid;
    if (!g) return fill.universe !== null ? { universe: fill.universe, tr: fill.tr } : null;
    if (i < g.i1 || i > g.i2 || j < g.j1 || j > g.j2 || k < g.k1 || k > g.k2) return null;
    const nx = g.i2 - g.i1 + 1;
    const ny = g.j2 - g.j1 + 1;
    const idx = (i - g.i1) + nx * ((j - g.j1) + ny * (k - g.k1));
    return g.entries[idx] ?? null;
}

function findInUniverse(
    model: McnpGeometryModel,
    universe: number,
    p: Vec3,
    depth: number,
    out: FoundCell,
): McnpCell | null {
    if (depth > MAX_DEPTH) { out.lost = true; return null; }
    const cellIds = model.universes.get(universe);
    if (!cellIds || cellIds.length === 0) { out.lost = true; return null; }

    // Pass 1: exact containment on regular cells. A lattice cell's surfaces
    // describe only its (0,0,0) element; the lattice itself tiles the whole
    // universe (§5.5.5), truncated by the enclosing filled cell — so lattice
    // cells act as the universe's backdrop in pass 2, never containment-gated
    // on their window.
    let hit: McnpCell | null = null;
    for (const id of cellIds) {
        const cellDef = model.cells.get(id);
        if (!cellDef || cellDef.lat !== 0) continue;
        if (!cellContains(model, id, p)) continue;
        if (hit === null) hit = cellDef;
        if (depth === 0) {
            // Overlap accounting at the top level only (the cheap, common
            // case users know from OpenMC overlap plots).
            if (!out.overlaps.includes(id)) out.overlaps.push(id);
        } else {
            break; // deeper levels: first exact claimant wins
        }
    }
    if (!hit) {
        for (const id of cellIds) {
            const cellDef = model.cells.get(id);
            if (cellDef && cellDef.lat !== 0) {
                hit = cellDef;
                if (depth === 0 && out.overlaps.length === 0) out.overlaps.push(id);
                break;
            }
        }
    }
    if (!hit) { out.lost = true; return null; }
    out.path.push(hit.id);

    // Material cell (no fill, not a lattice) → done.
    if (!hit.fill && hit.lat === 0) return hit;

    // Point in the filled/lattice cell's local frame.
    let local: Vec3 = hit.trcl ? toAux(hit.trcl, p) : p;

    if (hit.lat !== 0) {
        const basis = cachedLatticeBasis(model, hit);
        if (!basis) {
            // Un-analyzable lattice window: treat as the cell's own material.
            return hit;
        }
        const t = latticeFractions(basis, local);
        let k0 = t.map((x) => Math.round(x));
        // Rounding in a rhombic (hex) basis can land one element off near
        // corners; verify with the actual window and search the neighborhood.
        if (!elementWindowContains(model, hit, basis, k0, local)) {
            for (const delta of NEIGHBOR_DELTAS) {
                const cand = k0.map((v, idx2) => v + (delta[idx2] ?? 0));
                if (elementWindowContains(model, hit, basis, cand, local)) {
                    k0 = cand;
                    break;
                }
            }
            // If no neighbor matches either, the point sits between elements
            // by numerical grief only; keep the rounded index.
        }
        const i = k0[0] ?? 0;
        const j = k0[1] ?? 0;
        const kk = k0[2] ?? 0;
        out.latticeIndices.push([i, j, kk]);

        if (!hit.fill) return hit; // lattice of its own material everywhere
        const entry = fillEntryAt(hit.fill, i, j, kk);
        if (!entry || entry.universe === 0) {
            // Outside the declared fill range (or a 0 placeholder): the
            // element has no filling universe → lattice cell's own material.
            return hit;
        }
        if (entry.universe === hit.universe) return hit; // self-fill
        // Recurse in element-local coordinates.
        let q: Vec3 = [local[0], local[1], local[2]];
        for (let idx2 = 0; idx2 < basis.a.length; idx2++) {
            const kv = [i, j, kk][idx2] ?? 0;
            q = [q[0] - basis.a[idx2][0] * kv, q[1] - basis.a[idx2][1] * kv, q[2] - basis.a[idx2][2] * kv];
        }
        // A whole-array fill transform shifts the filled universe's frame for
        // every element (Serpent/SCONE lattices translate origin-centered
        // universes to each element center; their synthesized lattice cells
        // carry the constant offset here).
        if (hit.fill.tr) q = toAux(hit.fill.tr, q);
        if (entry.tr) q = toAux(entry.tr, q);
        const deeper = findInUniverse(model, entry.universe, q, depth + 1, out);
        return deeper ?? hit;
    }

    // Plain fill.
    const fill = hit.fill!;
    if (fill.universe === null) return hit;
    if (fill.tr) local = toAux(fill.tr, local);
    const deeper = findInUniverse(model, fill.universe, local, depth + 1, out);
    return deeper ?? hit;
}

/**
 * Locate the material cell containing a world point, descending fills and
 * lattices from universe 0. Reports top-level overlaps (multiple universe-0
 * cells claiming the point) and lost points (no cell claims it) — the same
 * conventions users know from OpenMC overlap plots.
 */
export function findCell(model: McnpGeometryModel, p: Vec3): FoundCell {
    const out: FoundCell = { cell: null, path: [], overlaps: [], lost: false, latticeIndices: [] };
    out.cell = findInUniverse(model, 0, p, 0, out);
    return out;
}

// ---------------------------------------------------------------------------
// World bounds (for slicing and CSG clipping)
// ---------------------------------------------------------------------------

export interface Bounds { min: Vec3; max: Vec3 }

const DEFAULT_HALF_EXTENT = 1000;

/**
 * Conservative world bounding box from the finite surfaces present. Each
 * surface contributes only along the axes it actually constrains (an x-plane
 * says nothing about y or z), so an off-origin deck is not dragged toward 0.
 * Falls back to ±1000 cm on an axis nothing constrains.
 */
export function worldBounds(model: McnpGeometryModel): Bounds {
    const axes: number[][] = [[], [], []];

    const takeShape = (shape: Shape, tr: Transform | null) => {
        // Cheap, conservative contributions; a transformed surface widens by
        // its displacement (rotation can only exchange axes, and this box is
        // deliberately loose).
        const off: Vec3 = tr ? tr.o : [0, 0, 0];
        if (shape.kind === 'quadric') {
            const { a, b, c, g, h, j, k } = shape;
            if (a === 1 && b === 1 && c === 1 && shape.d === 0 && shape.e === 0 && shape.f === 0) {
                const cx = -g / 2; const cy = -h / 2; const cz = -j / 2;
                const r2 = cx * cx + cy * cy + cz * cz - k;
                if (r2 > 0) {
                    const r = Math.sqrt(r2);
                    axes[0].push(cx - r + off[0], cx + r + off[0]);
                    axes[1].push(cy - r + off[1], cy + r + off[1]);
                    axes[2].push(cz - r + off[2], cz + r + off[2]);
                }
            } else if (a === 0 && b === 1 && c === 1) { // cylinder along x
                const cy = -h / 2; const cz = -j / 2;
                const r2 = cy * cy + cz * cz - k;
                if (r2 > 0) {
                    const r = Math.sqrt(r2);
                    axes[1].push(cy - r + off[1], cy + r + off[1]);
                    axes[2].push(cz - r + off[2], cz + r + off[2]);
                }
            } else if (a === 1 && b === 0 && c === 1) { // along y
                const cx = -g / 2; const cz = -j / 2;
                const r2 = cx * cx + cz * cz - k;
                if (r2 > 0) {
                    const r = Math.sqrt(r2);
                    axes[0].push(cx - r + off[0], cx + r + off[0]);
                    axes[2].push(cz - r + off[2], cz + r + off[2]);
                }
            } else if (a === 1 && b === 1 && c === 0) { // along z
                const cx = -g / 2; const cy = -h / 2;
                const r2 = cx * cx + cy * cy - k;
                if (r2 > 0) {
                    const r = Math.sqrt(r2);
                    axes[0].push(cx - r + off[0], cx + r + off[0]);
                    axes[1].push(cy - r + off[1], cy + r + off[1]);
                }
            }
        } else if (shape.kind === 'plane') {
            const { n, d } = shape;
            if (Math.abs(n[0]) > 0.999) axes[0].push(d / n[0] + off[0]);
            else if (Math.abs(n[1]) > 0.999) axes[1].push(d / n[1] + off[1]);
            else if (Math.abs(n[2]) > 0.999) axes[2].push(d / n[2] + off[2]);
        } else if (shape.kind === 'torus') {
            const R = Math.abs(shape.a) + Math.max(Math.abs(shape.b), Math.abs(shape.c));
            for (let ax = 0; ax < 3; ax++) {
                axes[ax].push(shape.center[ax] - R + off[ax], shape.center[ax] + R + off[ax]);
            }
        } else if (shape.kind === 'cone') {
            for (let ax = 0; ax < 3; ax++) axes[ax].push(shape.apex[ax] + off[ax]);
        } else if (shape.kind === 'body') {
            for (const f of shape.facets) takeShape(f, tr);
        }
    };

    for (const s of model.surfaces.values()) takeShape(s.shape, s.tr);

    const min: Vec3 = [0, 0, 0];
    const max: Vec3 = [0, 0, 0];
    for (let ax = 0; ax < 3; ax++) {
        const vals = axes[ax];
        if (vals.length >= 2) {
            min[ax] = Math.min(...vals);
            max[ax] = Math.max(...vals);
            if (max[ax] - min[ax] < 1e-9) {
                min[ax] -= DEFAULT_HALF_EXTENT;
                max[ax] += DEFAULT_HALF_EXTENT;
            }
        } else {
            min[ax] = -DEFAULT_HALF_EXTENT;
            max[ax] = DEFAULT_HALF_EXTENT;
        }
    }
    return { min, max };
}
