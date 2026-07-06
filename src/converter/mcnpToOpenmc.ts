// MCNP -> OpenMC Python script (high-fidelity, v0.3.8).
//
// Coverage: all common surfaces (planes, spheres, cylinders incl. off-axis,
// cones incl. one-sided, tori, SQ/GQ quadrics, RPP/RCC/BOX/RHP macrobodies),
// full boolean cell logic (unions, complements #N and #(expr), nesting),
// multi-level universe/fill hierarchies, lat=1 square and lat=2 hex lattices
// with full fill arrays, trcl/fill transforms, per-(material,density) cloning,
// cell temperatures (tmp), graveyard -> vacuum boundary synthesis, kcode/ksrc,
// FMESH + F4/F6/F7 tallies. Anything unrepresentable keeps the
// TODO(owen-convert) marker convention with a precise reason.

import {
    parseMcnpDeck, McnpDeck, McnpSurface, McnpCell, McnpTransformSpec,
    RegionNode, regionSurfaces,
} from './mcnpModel';
import { ConversionResult, ConversionIssue, TODO_MARK } from './types';
import { MT_TO_SAB } from './zaid';

// ---------------------------------------------------------------------------
// Surface conversion
// ---------------------------------------------------------------------------

interface SurfaceEmit {
    /** Python constructor expression, or null when unconvertible. */
    code: string | null;
    /** True when the object is an openmc.model composite (RPP/RCC/Hex/…). */
    composite: boolean;
    /** Extra statement lines emitted after the assignment (e.g. hex z-planes). */
    extra: string[];
    /**
     * When set, overrides how region senses map onto the emitted variable(s):
     * inside = MCNP negative sense, outside = positive sense.
     */
    insideExpr?: string;
    outsideExpr?: string;
    comment?: string;
}

function fmt(x: number): string {
    if (!Number.isFinite(x)) return String(x);
    // preserve precision without float noise
    const s = String(x);
    return s;
}

function num(p: string[], i: number): number {
    return parseFloat(p[i]);
}

function surfaceToOpenmc(
    s: McnpSurface,
    boundaryOverride: string | null,
    issues: ConversionIssue[],
): SurfaceEmit {
    const boundary = boundaryOverride ?? (s.boundary !== 'transmission' ? s.boundary : null);
    const bnd = boundary ? `, boundary_type='${boundary}'` : '';
    const bndOnly = boundary ? `boundary_type='${boundary}'` : '';
    const p = s.params;
    const v = `surf_${s.id}`;
    const fail = (why: string): SurfaceEmit => {
        issues.push({ sourceLine: s.line, message: `Surface ${s.id} (${s.type}): ${why}` });
        return {
            code: null, composite: false,
            extra: [`# ${TODO_MARK}: surface ${s.id} type '${s.type}' ${why} — params: ${p.join(' ')}`],
        };
    };

    switch (s.type) {
        case 'px': return { code: `openmc.XPlane(surface_id=${s.id}, x0=${p[0]}${bnd})`, composite: false, extra: [] };
        case 'py': return { code: `openmc.YPlane(surface_id=${s.id}, y0=${p[0]}${bnd})`, composite: false, extra: [] };
        case 'pz': return { code: `openmc.ZPlane(surface_id=${s.id}, z0=${p[0]}${bnd})`, composite: false, extra: [] };
        case 'p': {
            if (p.length >= 9) {
                // three-point form: normal = (p2-p1) x (p3-p1), d = n . p1
                const [x1, y1, z1, x2, y2, z2, x3, y3, z3] = p.slice(0, 9).map(parseFloat);
                const ux = x2 - x1, uy = y2 - y1, uz = z2 - z1;
                const wx = x3 - x1, wy = y3 - y1, wz = z3 - z1;
                const a = uy * wz - uz * wy;
                const b = uz * wx - ux * wz;
                const c = ux * wy - uy * wx;
                const d = a * x1 + b * y1 + c * z1;
                if (a === 0 && b === 0 && c === 0) return fail('three-point plane is degenerate');
                return {
                    code: `openmc.Plane(surface_id=${s.id}, a=${fmt(a)}, b=${fmt(b)}, c=${fmt(c)}, d=${fmt(d)}${bnd})`,
                    composite: false, extra: [],
                    comment: 'plane from 3 points',
                };
            }
            if (p.length >= 4) {
                return {
                    code: `openmc.Plane(surface_id=${s.id}, a=${p[0]}, b=${p[1]}, c=${p[2]}, d=${p[3]}${bnd})`,
                    composite: false, extra: [],
                };
            }
            return fail('needs 4 (ABCD) or 9 (three-point) parameters');
        }
        case 'so': return { code: `openmc.Sphere(surface_id=${s.id}, r=${p[0]}${bnd})`, composite: false, extra: [] };
        case 'sx': return { code: `openmc.Sphere(surface_id=${s.id}, x0=${p[0]}, r=${p[1]}${bnd})`, composite: false, extra: [] };
        case 'sy': return { code: `openmc.Sphere(surface_id=${s.id}, y0=${p[0]}, r=${p[1]}${bnd})`, composite: false, extra: [] };
        case 'sz': return { code: `openmc.Sphere(surface_id=${s.id}, z0=${p[0]}, r=${p[1]}${bnd})`, composite: false, extra: [] };
        case 's':
        case 'sph':
            if (p.length >= 4) {
                return {
                    code: `openmc.Sphere(surface_id=${s.id}, x0=${p[0]}, y0=${p[1]}, z0=${p[2]}, r=${p[3]}${bnd})`,
                    composite: false, extra: [],
                };
            }
            return fail('needs 4 parameters');
        case 'cx': return { code: `openmc.XCylinder(surface_id=${s.id}, r=${p[0]}${bnd})`, composite: false, extra: [] };
        case 'cy': return { code: `openmc.YCylinder(surface_id=${s.id}, r=${p[0]}${bnd})`, composite: false, extra: [] };
        case 'cz': return { code: `openmc.ZCylinder(surface_id=${s.id}, r=${p[0]}${bnd})`, composite: false, extra: [] };
        case 'c/x': return { code: `openmc.XCylinder(surface_id=${s.id}, y0=${p[0]}, z0=${p[1]}, r=${p[2]}${bnd})`, composite: false, extra: [] };
        case 'c/y': return { code: `openmc.YCylinder(surface_id=${s.id}, x0=${p[0]}, z0=${p[1]}, r=${p[2]}${bnd})`, composite: false, extra: [] };
        case 'c/z': return { code: `openmc.ZCylinder(surface_id=${s.id}, x0=${p[0]}, y0=${p[1]}, r=${p[2]}${bnd})`, composite: false, extra: [] };
        case 'kx': case 'ky': case 'kz': case 'k/x': case 'k/y': case 'k/z': {
            const onAxis = !s.type.includes('/');
            const axis = s.type[s.type.length - 1].toUpperCase();
            const need = onAxis ? 2 : 4;
            if (p.length < need) return fail(`needs at least ${need} parameters`);
            const x0 = onAxis ? (axis === 'X' ? p[0] : '0') : p[0];
            const y0 = onAxis ? (axis === 'Y' ? p[0] : '0') : p[1];
            const z0 = onAxis ? (axis === 'Z' ? p[0] : '0') : p[2];
            const t2 = onAxis ? p[1] : p[3];
            const sheet = p.length > need ? parseFloat(p[need]) : null;
            if (sheet === 1 || sheet === -1) {
                // one-sheet cone -> openmc.model composite
                return {
                    code: `openmc.model.${axis}ConeOneSided(x0=${x0}, y0=${y0}, z0=${z0}, r2=${t2}, up=${sheet === 1 ? 'True' : 'False'}${bnd})`,
                    composite: true, extra: [],
                };
            }
            return {
                code: `openmc.${axis}Cone(surface_id=${s.id}, x0=${x0}, y0=${y0}, z0=${z0}, r2=${t2}${bnd})`,
                composite: false, extra: [],
            };
        }
        case 'tx': case 'ty': case 'tz': {
            if (p.length < 6) return fail('torus needs 6 parameters');
            const axis = s.type[1].toUpperCase();
            return {
                code: `openmc.${axis}Torus(surface_id=${s.id}, x0=${p[0]}, y0=${p[1]}, z0=${p[2]}, a=${p[3]}, b=${p[4]}, c=${p[5]}${bnd})`,
                composite: false, extra: [],
            };
        }
        case 'sq': {
            // A(x-x1)^2+B(y-y1)^2+C(z-z1)^2+2D(x-x1)+2E(y-y1)+2F(z-z1)+G=0
            if (p.length < 10) return fail('SQ needs 10 parameters');
            const [A, B, C, D, E, F, G, x1, y1, z1] = p.map(parseFloat);
            const g = -2 * A * x1 + 2 * D;
            const h = -2 * B * y1 + 2 * E;
            const j = -2 * C * z1 + 2 * F;
            const k = A * x1 * x1 + B * y1 * y1 + C * z1 * z1 - 2 * (D * x1 + E * y1 + F * z1) + G;
            return {
                code: `openmc.Quadric(surface_id=${s.id}, a=${fmt(A)}, b=${fmt(B)}, c=${fmt(C)}, d=0, e=0, f=0, g=${fmt(g)}, h=${fmt(h)}, j=${fmt(j)}, k=${fmt(k)}${bnd})`,
                composite: false, extra: [],
                comment: 'expanded from MCNP SQ',
            };
        }
        case 'gq': {
            if (p.length < 10) return fail('GQ needs 10 parameters');
            return {
                code: `openmc.Quadric(surface_id=${s.id}, a=${p[0]}, b=${p[1]}, c=${p[2]}, d=${p[3]}, e=${p[4]}, f=${p[5]}, g=${p[6]}, h=${p[7]}, j=${p[8]}, k=${p[9]}${bnd})`,
                composite: false, extra: [],
            };
        }
        case 'rpp': {
            if (p.length < 6) return fail('RPP needs 6 parameters');
            return {
                code: `openmc.model.RectangularParallelepiped(${p[0]}, ${p[1]}, ${p[2]}, ${p[3]}, ${p[4]}, ${p[5]}${bnd})`,
                composite: true, extra: [],
            };
        }
        case 'rcc': {
            if (p.length < 7) return fail('RCC needs 7 parameters');
            const [vx, vy, vz, hx, hy, hz, r] = p.map(parseFloat);
            let axis: string | null = null;
            let height = 0;
            if (hx === 0 && hy === 0 && hz !== 0) { axis = 'z'; height = hz; }
            else if (hx === 0 && hz === 0 && hy !== 0) { axis = 'y'; height = hy; }
            else if (hy === 0 && hz === 0 && hx !== 0) { axis = 'x'; height = hx; }
            if (!axis) return fail('has an off-axis height vector (not representable as RightCircularCylinder)');
            if (height < 0) return fail('has a negative height vector (flip the base point manually)');
            return {
                code: `openmc.model.RightCircularCylinder((${fmt(vx)}, ${fmt(vy)}, ${fmt(vz)}), ${fmt(height)}, ${fmt(r)}, axis='${axis}'${bnd})`,
                composite: true, extra: [],
            };
        }
        case 'box': {
            if (p.length < 12) return fail('BOX needs 12 parameters');
            const n = p.map(parseFloat);
            const [px0, py0, pz0] = n.slice(0, 3);
            const a = n.slice(3, 6), b = n.slice(6, 9), c = n.slice(9, 12);
            const axisAligned = (vec: number[]) => vec.filter((x) => x !== 0).length === 1;
            if (!(axisAligned(a) && axisAligned(b) && axisAligned(c))) {
                return fail('is not axis-aligned — convert to intersecting openmc.Plane surfaces manually');
            }
            let xmin = px0, xmax = px0, ymin = py0, ymax = py0, zmin = pz0, zmax = pz0;
            for (const vec of [a, b, c]) {
                if (vec[0] !== 0) { xmin = Math.min(px0, px0 + vec[0]); xmax = Math.max(px0, px0 + vec[0]); }
                if (vec[1] !== 0) { ymin = Math.min(py0, py0 + vec[1]); ymax = Math.max(py0, py0 + vec[1]); }
                if (vec[2] !== 0) { zmin = Math.min(pz0, pz0 + vec[2]); zmax = Math.max(pz0, pz0 + vec[2]); }
            }
            return {
                code: `openmc.model.RectangularParallelepiped(${fmt(xmin)}, ${fmt(xmax)}, ${fmt(ymin)}, ${fmt(ymax)}, ${fmt(zmin)}, ${fmt(zmax)}${bnd})`,
                composite: true, extra: [],
                comment: 'axis-aligned BOX',
            };
        }
        case 'rhp':
        case 'hex': {
            if (p.length < 9) return fail('RHP/HEX needs at least 9 parameters');
            const n = p.map(parseFloat);
            const [bx, by, bz] = n.slice(0, 3);
            const [hx, hy, hz] = n.slice(3, 6);
            const [rx, ry, rz] = n.slice(6, 9);
            if (!(hx === 0 && hy === 0)) return fail('has an off-z prism axis');
            if (rz !== 0) return fail('facet vector R has a z component');
            const apothem = Math.hypot(rx, ry);
            const edge = (2 * apothem) / Math.sqrt(3);
            // R along y -> flat faces normal to y -> OpenMC orientation 'y';
            // R along x -> orientation 'x'.
            const orient = Math.abs(ry) >= Math.abs(rx) ? 'y' : 'x';
            const zmin = Math.min(bz, bz + hz);
            const zmax = Math.max(bz, bz + hz);
            const extra = [
                `${v}_zmin = openmc.ZPlane(z0=${fmt(zmin)}${bndOnly ? ', ' + bndOnly : ''})`,
                `${v}_zmax = openmc.ZPlane(z0=${fmt(zmax)}${bndOnly ? ', ' + bndOnly : ''})`,
            ];
            return {
                code: `openmc.model.HexagonalPrism(edge_length=${fmt(edge)}, orientation='${orient}', origin=(${fmt(bx)}, ${fmt(by)})${bnd})`,
                composite: true,
                extra,
                insideExpr: `(-${v} & +${v}_zmin & -${v}_zmax)`,
                outsideExpr: `~(-${v} & +${v}_zmin & -${v}_zmax)`,
                comment: `hexagonal prism, apothem ${fmt(apothem)}, z ${fmt(zmin)}..${fmt(zmax)}`,
            };
        }
        default:
            return fail('is not a supported surface type');
    }
}

// ---------------------------------------------------------------------------
// Region emission
// ---------------------------------------------------------------------------

interface SurfaceTable {
    /** sense -1 expression per surface id. */
    inside: Map<number, string>;
    /** sense +1 expression per surface id. */
    outside: Map<number, string>;
}

function emitRegion(
    node: RegionNode,
    surfs: SurfaceTable,
    cellById: Map<number, McnpCell>,
    issues: ConversionIssue[],
    ctx: { line: number; cellId: number },
    stack: Set<number> = new Set(),
): string {
    switch (node.kind) {
        case 'half': {
            const table = node.sense === -1 ? surfs.inside : surfs.outside;
            const expr = table.get(node.surface);
            if (!expr) {
                issues.push({ sourceLine: ctx.line, message: `Cell ${ctx.cellId} references undefined or unconvertible surface ${node.surface}` });
                return 'None';
            }
            return expr;
        }
        case 'and': {
            const parts = node.children.map((c) => {
                const e = emitRegion(c, surfs, cellById, issues, ctx, stack);
                return c.kind === 'or' ? `(${e})` : e;
            });
            return parts.join(' & ');
        }
        case 'or': {
            const parts = node.children.map((c) => {
                const e = emitRegion(c, surfs, cellById, issues, ctx, stack);
                return c.kind === 'and' ? `(${e})` : e;
            });
            return parts.join(' | ');
        }
        case 'comp': {
            const inner = emitRegion(node.child, surfs, cellById, issues, ctx, stack);
            return `~(${inner})`;
        }
        case 'cellcomp': {
            const target = cellById.get(node.cell);
            if (!target || !target.region) {
                issues.push({ sourceLine: ctx.line, message: `Cell ${ctx.cellId} complements missing cell #${node.cell}` });
                return 'None';
            }
            if (stack.has(node.cell)) {
                issues.push({ sourceLine: ctx.line, message: `Cell ${ctx.cellId}: circular cell complement chain through #${node.cell}` });
                return 'None';
            }
            stack.add(node.cell);
            const inner = emitRegion(target.region, surfs, cellById, issues, ctx, stack);
            stack.delete(node.cell);
            return `~(${inner})`;
        }
    }
}

// ---------------------------------------------------------------------------
// Lattice geometry helpers
// ---------------------------------------------------------------------------

interface RectWindow {
    xmin: number | null; xmax: number | null;
    ymin: number | null; ymax: number | null;
    zmin: number | null; zmax: number | null;
}

/** Recover the lattice element window from the lat cell's region (axis planes). */
function extractWindow(node: RegionNode | null, surfaces: Map<number, McnpSurface>): RectWindow {
    const w: RectWindow = { xmin: null, xmax: null, ymin: null, ymax: null, zmin: null, zmax: null };
    const visit = (n: RegionNode) => {
        if (n.kind === 'half') {
            const s = surfaces.get(n.surface);
            if (!s) return;
            const val = parseFloat(s.params[0]);
            if (!Number.isFinite(val)) return;
            if (s.type === 'px') {
                if (n.sense === 1) w.xmin = w.xmin === null ? val : Math.max(w.xmin, val);
                else w.xmax = w.xmax === null ? val : Math.min(w.xmax, val);
            } else if (s.type === 'py') {
                if (n.sense === 1) w.ymin = w.ymin === null ? val : Math.max(w.ymin, val);
                else w.ymax = w.ymax === null ? val : Math.min(w.ymax, val);
            } else if (s.type === 'pz') {
                if (n.sense === 1) w.zmin = w.zmin === null ? val : Math.max(w.zmin, val);
                else w.zmax = w.zmax === null ? val : Math.min(w.zmax, val);
            }
        } else if (n.kind === 'and') {
            n.children.forEach(visit);
        }
        // unions / complements never define a lat window
    };
    if (node) visit(node);
    return w;
}

/** Most common universe id along the boundary ring of a fill array (per z-slab). */
function edgeMajority(universes: number[], nx: number, ny: number, nz: number): number | null {
    if (!universes.length) return null;
    const counts = new Map<number, number>();
    for (let k = 0; k < nz; k++) {
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                if (i !== 0 && i !== nx - 1 && j !== 0 && j !== ny - 1 && ny > 2 && nx > 2) continue;
                const u = universes[k * nx * ny + j * nx + i];
                if (u !== undefined) counts.set(u, (counts.get(u) ?? 0) + 1);
            }
        }
    }
    let best: number | null = null;
    let bestN = -1;
    for (const [u, n] of counts) if (n > bestN) { bestN = n; best = u; }
    return best;
}

// ---------------------------------------------------------------------------
// Hex lattice (lat=2) support
// ---------------------------------------------------------------------------

/**
 * Convert an MCNP lat=2 fill array to OpenMC HexLattice rings.
 *
 * MCNP hex lattice indexing: element (i, j) sits at position
 *   center = i * a1 + j * a2
 * where a1 / a2 are the lattice basis vectors implied by the RHP facets.
 * For the common y-orientation hex (RHP R-vector along y), a1 = (pitch, 0)
 * and a2 = (pitch/2, pitch*sqrt(3)/2) — i.e. axial coordinates. OpenMC's
 * HexLattice (orientation 'y' equivalent basis) wants rings from the outside
 * in, each ring starting at the "top" (+y) position and proceeding clockwise.
 * Returns null when the array is not a complete centered hex (in which case
 * the caller falls back to a TODO).
 */
export function hexFillToRings(
    universes: number[],
    imin: number, imax: number, jmin: number, jmax: number,
): number[][] | null {
    // Map (i, j) -> universe using axial coordinates q=i, r=j.
    const byQR = new Map<string, number>();
    let idx = 0;
    for (let j = jmin; j <= jmax; j++) {
        for (let i = imin; i <= imax; i++) {
            if (idx < universes.length) byQR.set(`${i},${j}`, universes[idx]);
            idx++;
        }
    }
    // Determine the largest COMPLETE ring: hex distance
    // d(q, r) = (|q| + |r| + |q+r|) / 2. A rhombus fill array's far corners
    // lie beyond the complete hexagon (MCNP ignores elements outside the
    // window), so extra entries past the last complete ring are dropped.
    const dist = (q: number, r: number) => (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
    let maxObserved = 0;
    for (const key of byQR.keys()) {
        const [q, r] = key.split(',').map(Number);
        maxObserved = Math.max(maxObserved, dist(q, r));
    }
    const ringComplete = (n: number): boolean => {
        for (let q = -n; q <= n; q++) {
            for (let r = -n; r <= n; r++) {
                if (dist(q, r) === n && !byQR.has(`${q},${r}`)) return false;
            }
        }
        return true;
    };
    if (!byQR.has('0,0')) return null;
    let maxRing = 0;
    while (maxRing < maxObserved && ringComplete(maxRing + 1)) maxRing++;
    if (maxRing === 0 && byQR.size > 1 && !ringComplete(1)) return null;
    // Axial neighbor directions, clockwise starting from "top" (+y) for a
    // y-basis hex: top is (q, r) = (0, 1)? With a2 = (p/2, p*sqrt(3)/2), the
    // +y-most element of ring n is at q = -n? Position of (q, r):
    //   x = (q + r/2) * p,  y = r * p * sqrt(3)/2.
    // Ring n top (x=0, max y): q = -n/2… only integral for even n. OpenMC 'y'
    // orientation rings actually start at the NW-ish position; the exact
    // convention is matched empirically by the unit/gauntlet tests:
    // OpenMC ring index position 0 is the (0, n) element in "cube" coords
    // used below, then clockwise.
    // Directions in axial coords that walk the ring clockwise starting at
    // (q, r) = (0, n) [top-right in x, high y]:
    const dirs: Array<[number, number]> = [
        [1, -1],   // toward east/down-right
        [0, -1],   // down
        [-1, 0],   // down-left
        [-1, 1],   // up-left
        [0, 1],    // up
        [1, 0],    // up-right
    ];
    const rings: number[][] = [];
    for (let n = maxRing; n >= 1; n--) {
        const ring: number[] = [];
        let q = 0, r = n;
        for (const [dq, dr] of dirs) {
            for (let step = 0; step < n; step++) {
                ring.push(byQR.get(`${q},${r}`)!);
                q += dq; r += dr;
            }
        }
        rings.push(ring);
    }
    rings.push([byQR.get('0,0')!]);
    return rings;
}

// ---------------------------------------------------------------------------
// Main converter
// ---------------------------------------------------------------------------

function emitTransform(
    varName: string,
    t: McnpTransformSpec,
    out: string[],
    issues: ConversionIssue[],
    line: number,
): void {
    if (t.dx !== 0 || t.dy !== 0 || t.dz !== 0) {
        out.push(`${varName}.translation = (${fmt(t.dx)}, ${fmt(t.dy)}, ${fmt(t.dz)})`);
    }
    if (t.rotation) {
        let rows = t.rotation;
        if (t.degrees) {
            rows = rows.map((row) => row.map((deg) => Math.cos((deg * Math.PI) / 180)));
        }
        // MCNP B-matrix rows are the local axes expressed in global coords;
        // openmc cell.rotation takes the rotation matrix applied to the fill.
        out.push(`${varName}.rotation = [[${rows[0].map(fmt).join(', ')}], [${rows[1].map(fmt).join(', ')}], [${rows[2].map(fmt).join(', ')}]]`);
        issues.push({
            sourceLine: line,
            message: `${varName}: rotation matrix converted — verify the rotation sense matches MCNP's TR convention for your deck`,
        });
    }
}

export function mcnpToOpenmc(mcnpText: string): ConversionResult {
    const deck: McnpDeck = parseMcnpDeck(mcnpText);
    const issues: ConversionIssue[] = [];
    const out: string[] = [
        '# Converted from MCNP by OWEN (BelvoirDynamics) — MCNP↔OpenMC converter',
        '# NOTE: Review and verify all converted output before production use.',
        `# Unconvertible constructs are marked with "${TODO_MARK}".`,
        'import openmc',
        'import openmc.model',
        '',
    ];

    // MCNP forbids duplicate cell ids, but be robust: renumber later duplicates
    // so each emitted openmc.Cell (and its Python variable) is unique.
    {
        const seen = new Set<number>();
        let nextFree = (deck.cells.length ? Math.max(...deck.cells.map((c) => c.id)) : 0) + 1;
        for (const c of deck.cells) {
            if (seen.has(c.id)) {
                const oldId = c.id;
                c.id = nextFree++;
                issues.push({
                    sourceLine: c.line,
                    message: `Duplicate cell id ${oldId} (illegal in MCNP) — renumbered to ${c.id} in the OpenMC output`,
                });
            }
            seen.add(c.id);
        }
    }
    const cellById = new Map<number, McnpCell>(deck.cells.map((c) => [c.id, c]));
    const surfById = new Map<number, McnpSurface>(deck.surfaces.map((s) => [s.id, s]));
    // Explicit id allocators for synthesized objects (holder cells, self-fill
    // universes, lattices, root). OpenMC lattice ids share the universe id
    // namespace in model.xml, and auto-assigned ids can collide with explicit
    // ones — every emitted object gets an explicit id from a safe range.
    let nextCellIdV = (deck.cells.length ? Math.max(...deck.cells.map((c) => c.id)) : 0) + 1;
    let nextUnivIdV = deck.cells.reduce(
        (m, c) => Math.max(
            m,
            c.universe ?? 0,
            c.fillUniverse ?? 0,
            c.latticeFill ? c.latticeFill.universes.reduce((a, b) => Math.max(a, b), 0) : 0,
        ),
        0,
    ) + 1;
    const ids = { nextCell: () => nextCellIdV++, nextUniv: () => nextUnivIdV++ };

    // ---- graveyard analysis: imp:n=0 root cells -> vacuum boundary ----
    const graveyard = deck.cells.filter((c) => c.importanceZero && c.universe === null);
    const vacuumSurfaces = new Set<number>();
    for (const g of graveyard) {
        for (const sid of regionSurfaces(g.region)) {
            const s = surfById.get(sid);
            if (s && s.boundary === 'transmission') vacuumSurfaces.add(sid);
        }
    }
    const modelCells = deck.cells.filter((c) => !(c.importanceZero && c.universe === null));
    if (graveyard.length) {
        out.push(
            `# Graveyard cell(s) ${graveyard.map((c) => c.id).join(', ')} (imp:n=0) removed;`,
            `# their bounding surfaces [${[...vacuumSurfaces].join(', ')}] became vacuum boundaries.`,
            '',
        );
    }

    // ---- materials: one openmc.Material per (mcnp material, cell density) ----
    out.push('# ' + '='.repeat(60), '# Materials', '# ' + '='.repeat(60));
    // key `${matId}|${density}` -> variable name
    const matVarByKey = new Map<string, string>();
    const matVars: string[] = [];
    let nextMatId = deck.materials.length ? Math.max(...deck.materials.map((m) => m.id)) + 1 : 1;
    for (const mat of deck.materials) {
        // distinct densities used with this material (null = unused)
        const densities: Array<number | null> = [];
        for (const c of modelCells) {
            if (c.matId === mat.id && !densities.some((d) => d === c.density)) densities.push(c.density);
        }
        if (densities.length === 0) densities.push(null);
        densities.sort((a, b) => (a ?? 0) - (b ?? 0));
        for (let di = 0; di < densities.length; di++) {
            const density = densities[di];
            const isClone = di > 0;
            const v = isClone ? `mat_${mat.id}_d${di + 1}` : `mat_${mat.id}`;
            const id = isClone ? nextMatId++ : mat.id;
            matVarByKey.set(`${mat.id}|${density}`, v);
            matVars.push(v);
            const cloneNote = isClone
                ? `  # m${mat.id} at its ${di + 1}${['st', 'nd', 'rd'][di] ?? 'th'} distinct cell density`
                : '';
            out.push(`${v} = openmc.Material(${id}, name='m${mat.id}${isClone ? ` (density ${density})` : ''}')${cloneNote}`);
            for (const nuc of mat.nuclides) {
                // natural ZAIDs (A=0) map to a bare element symbol -> add_element
                if (/^[A-Za-z]+$/.test(nuc.name)) {
                    out.push(`${v}.add_element('${nuc.name}', ${fmt(nuc.fraction)}, '${nuc.type}')`);
                } else {
                    out.push(`${v}.add_nuclide('${nuc.name}', ${fmt(nuc.fraction)}, '${nuc.type}')`);
                }
            }
            for (const sab of mat.sab) out.push(`${v}.add_s_alpha_beta('${sab}')`);
            if (density === null) {
                out.push(`${v}.set_density('sum')  # material unused on cell cards; density = sum of nuclide fractions`);
            } else if (density < 0) {
                out.push(`${v}.set_density('g/cm3', ${fmt(Math.abs(density))})`);
            } else {
                out.push(`${v}.set_density('atom/b-cm', ${fmt(density)})`);
            }
            out.push('');
        }
        if (densities.length > 1) {
            issues.push({
                sourceLine: mat.line,
                message: `Material m${mat.id} is used at ${densities.length} distinct cell densities — split into ${densities.length} OpenMC materials`,
            });
        }
    }
    // unmapped mt libraries
    for (const mat of deck.materials) {
        for (const raw of mat.mtRaw) {
            const base = raw.split('.')[0].toLowerCase();
            if (!MT_TO_SAB[base]) {
                issues.push({ sourceLine: mat.line, message: `mt library '${raw}' has no OpenMC S(α,β) mapping` });
                out.push(`# ${TODO_MARK}: mt library '${raw}' (m${mat.id}) has no OpenMC S(α,β) mapping — add manually`);
            }
        }
    }
    if (matVars.length) {
        out.push(`materials = openmc.Materials([${matVars.join(', ')}])`, '');
    } else {
        out.push('materials = openmc.Materials([])', '');
    }

    // ---- surfaces ----
    // Two passes: primitives (with explicit surface_id=) first, composites
    // (openmc.model.*) last. Composites create internal surfaces with
    // auto-assigned ids; emitting them after every explicit id is registered
    // keeps OpenMC's id counter above the explicit range (no collisions).
    out.push('# ' + '='.repeat(60), '# Surfaces', '# ' + '='.repeat(60));
    const surfTable: SurfaceTable = { inside: new Map(), outside: new Map() };
    const compositeLines: string[] = [];
    for (const s of deck.surfaces) {
        if (s.transform !== null) {
            issues.push({ sourceLine: s.line, message: `Surface ${s.id} uses a TR transform — OpenMC surfaces cannot be transformed; apply TR${s.transform} to the coefficients manually` });
            out.push(`# ${TODO_MARK}: surface ${s.id} uses TR${s.transform}; the transform is NOT applied below.`);
        }
        const boundaryOverride = vacuumSurfaces.has(s.id) ? 'vacuum' : null;
        const emit = surfaceToOpenmc(s, boundaryOverride, issues);
        const v = `surf_${s.id}`;
        if (emit.code) {
            const target = emit.composite ? compositeLines : out;
            target.push(`${v} = ${emit.code}${emit.comment ? `  # ${emit.comment}` : ''}`);
            target.push(...emit.extra);
            surfTable.inside.set(s.id, emit.insideExpr ?? `-${v}`);
            surfTable.outside.set(s.id, emit.outsideExpr ?? (emit.composite ? `~(-${v})` : `+${v}`));
        } else {
            out.push(...emit.extra);
        }
    }
    out.push(...compositeLines);
    out.push('');

    // ---- classify cells ----
    const latticeCells = modelCells.filter((c) => c.lattice !== null);
    const plainCells = modelCells.filter((c) => c.lattice === null);
    const universeIds = new Set<number>();
    for (const c of modelCells) if (c.universe !== null) universeIds.add(c.universe);

    // ---- plain cells ----
    out.push('# ' + '='.repeat(60), '# Cells', '# ' + '='.repeat(60));
    const cellVar = (c: McnpCell) => `cell_${c.id}`;
    for (const c of plainCells) {
        const v = cellVar(c);
        let fillArg = 'None';
        if (c.matId !== 0) {
            const mv = matVarByKey.get(`${c.matId}|${c.density}`);
            if (mv) {
                fillArg = mv;
            } else {
                issues.push({ sourceLine: c.line, message: `Cell ${c.id} references undefined material m${c.matId}` });
                out.push(`# ${TODO_MARK}: cell ${c.id} references undefined material m${c.matId}.`);
            }
        }
        let regionExpr = '';
        if (c.regionError) {
            issues.push({ sourceLine: c.line, message: `Cell ${c.id} region could not be parsed: ${c.regionError}` });
            out.push(`# ${TODO_MARK}: cell ${c.id} region '${c.regionRaw}' could not be parsed (${c.regionError}).`);
        } else if (c.region) {
            regionExpr = emitRegion(c.region, surfTable, cellById, issues, { line: c.line, cellId: c.id });
            if (/\bNone\b/.test(regionExpr)) {
                out.push(`# ${TODO_MARK}: cell ${c.id} region references missing surfaces/cells — 'None' placeholders below.`);
            }
        }
        const parts = [`cell_id=${c.id}`, `name='cell ${c.id}'`];
        if (fillArg !== 'None') parts.push(`fill=${fillArg}`);
        out.push(`${v} = openmc.Cell(${parts.join(', ')})`);
        if (regionExpr) out.push(`${v}.region = ${regionExpr}`);
        if (c.temperatureK !== null) out.push(`${v}.temperature = ${fmt(Number(c.temperatureK.toFixed(3)))}`);
    }
    out.push('');

    // ---- universes (plain cells grouped by u=) ----
    out.push('# ' + '='.repeat(60), '# Universes', '# ' + '='.repeat(60));
    const universeVar = (id: number) => `u_${id}`;
    const latticeByUniverse = new Map<number, McnpCell>();
    for (const lc of latticeCells) {
        if (lc.universe === null) {
            issues.push({ sourceLine: lc.line, message: `Lattice cell ${lc.id} has no u= number — a lattice must live in a universe to be filled` });
            continue;
        }
        if (latticeByUniverse.has(lc.universe)) {
            issues.push({ sourceLine: lc.line, message: `Universe ${lc.universe} has more than one lattice cell — only cell ${latticeByUniverse.get(lc.universe)!.id} was converted` });
            continue;
        }
        latticeByUniverse.set(lc.universe, lc);
    }
    const plainUniverseIds = [...universeIds].filter((u) => !latticeByUniverse.has(u)).sort((a, b) => a - b);
    for (const uid of plainUniverseIds) {
        const members = plainCells.filter((c) => c.universe === uid).map(cellVar);
        out.push(`${universeVar(uid)} = openmc.Universe(universe_id=${uid}, cells=[${members.join(', ')}])`);
    }
    out.push('');

    // ---- lattices (topologically ordered: lattices can nest) ----
    out.push('# ' + '='.repeat(60), '# Lattices', '# ' + '='.repeat(60));
    const emittedUniverses = new Set<number>(plainUniverseIds);
    const pendingLats = new Map<number, McnpCell>(latticeByUniverse);
    // universes referenced anywhere in fill arrays that don't exist -> issue
    const definedUniverses = new Set<number>([...universeIds]);
    let guard = 0;
    while (pendingLats.size && guard++ < 100) {
        let progressed = false;
        for (const [uid, lc] of [...pendingLats]) {
            const lf = lc.latticeFill;
            const deps = new Set<number>();
            if (lf) for (const u of lf.universes) deps.add(u);
            else if (lc.fillUniverse !== null) deps.add(lc.fillUniverse);
            deps.delete(uid); // self-fill handled below
            let ready = true;
            for (const d of deps) {
                if (definedUniverses.has(d) && !emittedUniverses.has(d)) { ready = false; break; }
            }
            if (!ready) continue;
            progressed = true;
            pendingLats.delete(uid);
            emitLattice(lc, uid, deck, surfById, cellById, matVarByKey, surfTable, definedUniverses, ids, out, issues);
            emittedUniverses.add(uid);
        }
        if (!progressed) {
            for (const [uid, lc] of pendingLats) {
                issues.push({ sourceLine: lc.line, message: `Lattice universe ${uid} participates in a fill cycle — not converted` });
                out.push(`# ${TODO_MARK}: lattice universe ${uid} participates in a fill cycle.`);
            }
            break;
        }
    }
    out.push('');

    // ---- deferred fills + transforms ----
    out.push('# ' + '='.repeat(60), '# Cell fills (universes) and transforms', '# ' + '='.repeat(60));
    for (const c of plainCells) {
        const v = cellVar(c);
        if (c.latticeFill && c.lattice === null) {
            issues.push({ sourceLine: c.line, message: `Cell ${c.id} has a fill array but no lat= keyword — not converted` });
            out.push(`# ${TODO_MARK}: cell ${c.id} has a fill array without lat=.`);
        } else if (c.fillUniverse !== null) {
            if (definedUniverses.has(c.fillUniverse)) {
                out.push(`${v}.fill = ${universeVar(c.fillUniverse)}`);
            } else {
                issues.push({ sourceLine: c.line, message: `Cell ${c.id} fills with undefined universe ${c.fillUniverse}` });
                out.push(`# ${TODO_MARK}: cell ${c.id} fill=${c.fillUniverse} references an undefined universe.`);
            }
            if (c.fillTransform) emitTransform(v, c.fillTransform, out, issues, c.line);
        } else if (c.fill && c.fillUniverse === null) {
            issues.push({ sourceLine: c.line, message: `Cell ${c.id} fill '${c.fill}' could not be interpreted` });
            out.push(`# ${TODO_MARK}: cell ${c.id} fill '${c.fill}' not interpreted.`);
        }
        if (c.trcl) emitTransform(v, c.trcl, out, issues, c.line);
    }
    out.push('');

    // ---- root universe / geometry ----
    const rootCells = plainCells.filter((c) => c.universe === null).map(cellVar);
    out.push('# ' + '='.repeat(60), '# Geometry', '# ' + '='.repeat(60));
    out.push(`root = openmc.Universe(universe_id=${ids.nextUniv()}, name='root', cells=[${rootCells.join(', ')}])`);
    out.push('geometry = openmc.Geometry(root)', '');
    if (!graveyard.length && !deck.surfaces.some((s) => s.boundary !== 'transmission')) {
        issues.push({ sourceLine: -1, message: 'No graveyard (imp:n=0) cell and no reflective/periodic surfaces found — the OpenMC model may be unbounded' });
        out.push(`# ${TODO_MARK}: no outer boundary detected — set boundary_type on the outermost surfaces.`, '');
    }

    // ---- settings ----
    out.push('# ' + '='.repeat(60), '# Settings', '# ' + '='.repeat(60), 'settings = openmc.Settings()');
    const st = deck.settings;
    if (st.batches !== undefined) out.push(`settings.batches = ${st.batches}`);
    if (st.inactive !== undefined) out.push(`settings.inactive = ${st.inactive}`);
    if (st.particles !== undefined) out.push(`settings.particles = ${st.particles}`);
    if (st.ksrcPoints.length === 1) {
        const [x, y, z] = st.ksrcPoints[0];
        out.push(`settings.source = openmc.IndependentSource(space=openmc.stats.Point((${fmt(x)}, ${fmt(y)}, ${fmt(z)})))`);
    } else if (st.ksrcPoints.length > 1) {
        const srcs = st.ksrcPoints.map(([x, y, z]) =>
            `openmc.IndependentSource(space=openmc.stats.Point((${fmt(x)}, ${fmt(y)}, ${fmt(z)})))`);
        out.push(`settings.source = [${srcs.join(', ')}]`);
    } else if (st.sdefRaw) {
        issues.push({ sourceLine: -1, message: `sdef card not fully converted: ${st.sdefRaw}` });
        out.push(`# ${TODO_MARK}: sdef card not fully converted: ${st.sdefRaw}`);
        out.push('settings.source = openmc.IndependentSource(space=openmc.stats.Point((0, 0, 0)))');
    }
    out.push('');

    // ---- tallies ----
    const tallyVars: string[] = [];
    if (st.meshTallies.length || st.cellTallies.length) {
        out.push('# ' + '='.repeat(60), '# Tallies', '# ' + '='.repeat(60));
        for (const mt of st.meshTallies) {
            const mv = `mesh_${mt.id}`;
            const tv = `tally_${mt.id}`;
            out.push(`${mv} = openmc.RegularMesh()`);
            out.push(`${mv}.dimension = [${mt.iints}, ${mt.jints}, ${mt.kints}]`);
            out.push(`${mv}.lower_left = [${fmt(mt.origin[0])}, ${fmt(mt.origin[1])}, ${fmt(mt.origin[2])}]`);
            out.push(`${mv}.upper_right = [${fmt(mt.imesh)}, ${fmt(mt.jmesh)}, ${fmt(mt.kmesh)}]`);
            out.push(`${tv} = openmc.Tally(name='fmesh${mt.id}')`);
            out.push(`${tv}.filters = [openmc.MeshFilter(${mv})]`);
            out.push(`${tv}.scores = ['flux']  # FMESH type-4 track-length flux`);
            tallyVars.push(tv);
        }
        for (const ct of st.cellTallies) {
            const score = ct.kind === 4 ? 'flux' : ct.kind === 6 ? 'heating' : 'kappa-fission';
            const known = ct.cells.filter((cid) => cellById.has(cid));
            const tv = `tally_${ct.id}`;
            if (!known.length) {
                issues.push({ sourceLine: ct.line, message: `F${ct.id} tally references no known cells — skipped` });
                out.push(`# ${TODO_MARK}: F${ct.id} tally references unknown cells ${ct.cells.join(' ')}.`);
                continue;
            }
            out.push(`${tv} = openmc.Tally(name='f${ct.id}')`);
            out.push(`${tv}.filters = [openmc.CellFilter([${known.map((cid) => `cell_${cid}`).join(', ')}])]`);
            out.push(`${tv}.scores = ['${score}']  # F${ct.id} (type ${ct.kind})`);
            tallyVars.push(tv);
        }
        if (tallyVars.length) out.push(`tallies = openmc.Tallies([${tallyVars.join(', ')}])`);
        out.push('');
    }

    // ---- model ----
    out.push(
        '# ' + '='.repeat(60),
        '# Build and export model',
        '# ' + '='.repeat(60),
        `model = openmc.model.Model(geometry, materials, settings${tallyVars.length ? ', tallies' : ''})`,
        '',
        "if __name__ == '__main__':",
        '    model.export_to_model_xml()',
        '',
    );

    return { direction: 'mcnp_to_openmc', output: out.join('\n'), issues };
}

// ---------------------------------------------------------------------------
// Lattice emission (extracted for readability)
// ---------------------------------------------------------------------------

function emitLattice(
    lc: McnpCell,
    uid: number,
    deck: McnpDeck,
    surfById: Map<number, McnpSurface>,
    cellById: Map<number, McnpCell>,
    matVarByKey: Map<string, string>,
    surfTable: SurfaceTable,
    definedUniverses: Set<number>,
    ids: { nextCell: () => number; nextUniv: () => number },
    out: string[],
    issues: ConversionIssue[],
): void {
    const universeVar = (id: number) => `u_${id}`;
    const latVar = `lat_${lc.id}`;
    const w = extractWindow(lc.region, surfById);

    const missing: string[] = [];
    if (w.xmin === null || w.xmax === null) missing.push('x (px pair)');
    if (w.ymin === null || w.ymax === null) missing.push('y (py pair)');
    if (missing.length && lc.lattice === 1) {
        issues.push({ sourceLine: lc.line, message: `Lattice cell ${lc.id}: element window not derivable — missing ${missing.join(', ')} bounding planes` });
        out.push(`# ${TODO_MARK}: lattice cell ${lc.id} (u=${uid}) window not derivable from region '${lc.regionRaw}'.`);
        return;
    }

    // Self-filled elements (fill entry == lattice's own universe id) get a
    // synthesized universe of the lattice cell's own material.
    const lf = lc.latticeFill;
    const selfFill = lf ? lf.universes.includes(uid) : lc.fillUniverse === uid;
    let selfVar: string | null = null;
    if (selfFill) {
        selfVar = `u_${uid}_self`;
        const mv = lc.matId !== 0 ? matVarByKey.get(`${lc.matId}|${lc.density}`) ?? 'None' : 'None';
        out.push(`${selfVar} = openmc.Universe(universe_id=${ids.nextUniv()}, name='lat ${lc.id} self-fill', cells=[openmc.Cell(cell_id=${ids.nextCell()}, fill=${mv})])`);
    }
    const uref = (u: number): string => {
        if (u === uid && selfVar) return selfVar;
        if (!definedUniverses.has(u)) {
            issues.push({ sourceLine: lc.line, message: `Lattice cell ${lc.id} fill array references undefined universe ${u}` });
            return 'None';
        }
        return universeVar(u);
    };

    if (lc.lattice === 2) {
        // hex lattice
        if (!lf) {
            issues.push({ sourceLine: lc.line, message: `Hex lattice cell ${lc.id} without a fill array is not converted` });
            out.push(`# ${TODO_MARK}: hex lattice cell ${lc.id} (u=${uid}) has no fill array.`);
            return;
        }
        // pitch from the RHP surface in the region, or from the window
        let pitch: number | null = null;
        let orient: 'x' | 'y' = 'y';
        let center: [number, number] = [0, 0];
        for (const sid of regionSurfaces(lc.region)) {
            const s = surfById.get(sid);
            if (s && (s.type === 'rhp' || s.type === 'hex') && s.params.length >= 9) {
                const n = s.params.map(parseFloat);
                const apothem = Math.hypot(n[6], n[7]);
                pitch = 2 * apothem;
                orient = Math.abs(n[7]) >= Math.abs(n[6]) ? 'y' : 'x';
                center = [n[0], n[1]];
                break;
            }
        }
        if (pitch === null) {
            issues.push({ sourceLine: lc.line, message: `Hex lattice cell ${lc.id}: no RHP surface found in its region to derive the pitch` });
            out.push(`# ${TODO_MARK}: hex lattice cell ${lc.id} (u=${uid}) pitch not derivable (expected an RHP element surface).`);
            return;
        }
        const rings = hexFillToRings(lf.universes, lf.imin, lf.imax, lf.jmin, lf.jmax);
        if (!rings) {
            issues.push({ sourceLine: lc.line, message: `Hex lattice cell ${lc.id}: fill array is not a complete centered hexagon — build openmc.HexLattice manually` });
            out.push(`# ${TODO_MARK}: hex lattice cell ${lc.id} (u=${uid}) fill array is not a complete centered hexagon.`);
            return;
        }
        out.push(`${latVar} = openmc.HexLattice(lattice_id=${ids.nextUniv()}, name='mcnp cell ${lc.id} (lat=2, u=${uid})')`);
        out.push(`${latVar}.center = (${fmt(center[0])}, ${fmt(center[1])})`);
        out.push(`${latVar}.pitch = (${fmt(pitch)},)`);
        out.push(`${latVar}.orientation = '${orient}'`);
        out.push(`${latVar}.universes = [`);
        for (const ring of rings) {
            out.push(`    [${ring.map(uref).join(', ')}],`);
        }
        out.push(']');
        const edge = edgeMajority(lf.universes, lf.nx, lf.ny, lf.nz);
        if (edge !== null && definedUniverses.has(edge)) {
            out.push(`${latVar}.outer = ${uref(edge)}  # heuristic: majority universe on the fill-array boundary`);
        }
        out.push(`${universeVar(uid)} = openmc.Universe(universe_id=${uid}, cells=[openmc.Cell(cell_id=${ids.nextCell()}, name='lat ${lc.id} holder', fill=${latVar})])`);
        return;
    }

    // ---- lat=1 rectangular ----
    const pitchX = (w.xmax as number) - (w.xmin as number);
    const pitchY = (w.ymax as number) - (w.ymin as number);
    const cx = ((w.xmax as number) + (w.xmin as number)) / 2;
    const cy = ((w.ymax as number) + (w.ymin as number)) / 2;
    const is3D = lf ? lf.nz > 1 : false;
    let pitchZ: number | null = null;
    let cz: number | null = null;
    if (is3D) {
        if (w.zmin === null || w.zmax === null) {
            issues.push({ sourceLine: lc.line, message: `3D lattice cell ${lc.id}: no pz bounding pair for the z pitch` });
            out.push(`# ${TODO_MARK}: 3D lattice cell ${lc.id} (u=${uid}) has no pz pair.`);
            return;
        }
        pitchZ = w.zmax - w.zmin;
        cz = (w.zmax + w.zmin) / 2;
    }

    let arr: { imin: number; jmin: number; kmin: number; nx: number; ny: number; nz: number; universes: number[] };
    if (lf) {
        if (lf.universes.length !== lf.nx * lf.ny * lf.nz) {
            issues.push({
                sourceLine: lc.line,
                message: `Lattice cell ${lc.id}: fill array has ${lf.universes.length} entries, expected ${lf.nx * lf.ny * lf.nz}`,
            });
            out.push(`# ${TODO_MARK}: lattice cell ${lc.id} (u=${uid}) fill array is incomplete.`);
            return;
        }
        arr = { imin: lf.imin, jmin: lf.jmin, kmin: lf.kmin, nx: lf.nx, ny: lf.ny, nz: lf.nz, universes: lf.universes };
    } else if (lc.fillUniverse !== null) {
        // uniform infinite lattice: expand to a finite array large enough to
        // cover any plausible window, with outer= as the backstop.
        const n = 41; // odd, centered
        const half = (n - 1) / 2;
        arr = {
            imin: -half, jmin: -half, kmin: 0, nx: n, ny: n, nz: 1,
            universes: new Array(n * n).fill(lc.fillUniverse),
        };
        out.push(`# NOTE: lattice cell ${lc.id} used a uniform fill=${lc.fillUniverse}; expanded to ${n}x${n} with outer= backstop.`);
    } else {
        issues.push({ sourceLine: lc.line, message: `Lattice cell ${lc.id} has lat=1 but no fill specification` });
        out.push(`# ${TODO_MARK}: lattice cell ${lc.id} (u=${uid}) has no fill.`);
        return;
    }

    const llx = cx + arr.imin * pitchX - pitchX / 2;
    const lly = cy + arr.jmin * pitchY - pitchY / 2;
    out.push(`${latVar} = openmc.RectLattice(lattice_id=${ids.nextUniv()}, name='mcnp cell ${lc.id} (lat=1, u=${uid})')`);
    if (is3D && pitchZ !== null && cz !== null) {
        const llz = cz + arr.kmin * pitchZ - pitchZ / 2;
        out.push(`${latVar}.lower_left = (${fmt(llx)}, ${fmt(lly)}, ${fmt(llz)})`);
        out.push(`${latVar}.pitch = (${fmt(pitchX)}, ${fmt(pitchY)}, ${fmt(pitchZ)})`);
    } else {
        out.push(`${latVar}.lower_left = (${fmt(llx)}, ${fmt(lly)})`);
        out.push(`${latVar}.pitch = (${fmt(pitchX)}, ${fmt(pitchY)})`);
    }

    // MCNP fill arrays list x fastest, j (y) rows bottom-up, k (z) slabs
    // bottom-up. OpenMC RectLattice.universes is [z][y][x] for 3D and [y][x]
    // for 2D, with the FIRST y row at the TOP (max y) and z slabs bottom-up.
    out.push(`${latVar}.universes = [`);
    for (let k = 0; k < arr.nz; k++) {
        if (is3D) out.push('    [');
        const indent = is3D ? '        ' : '    ';
        for (let j = arr.ny - 1; j >= 0; j--) {
            const row: string[] = [];
            for (let i = 0; i < arr.nx; i++) {
                row.push(uref(arr.universes[k * arr.nx * arr.ny + j * arr.nx + i]));
            }
            out.push(`${indent}[${row.join(', ')}],`);
        }
        if (is3D) out.push('    ],');
    }
    out.push(']');

    const edge = edgeMajority(arr.universes, arr.nx, arr.ny, arr.nz);
    if (edge !== null && (definedUniverses.has(edge) || (edge === uid && selfFill))) {
        out.push(`${latVar}.outer = ${uref(edge)}  # heuristic: majority universe on the fill-array boundary`);
    }
    out.push(`${universeVar(uid)} = openmc.Universe(universe_id=${uid}, cells=[openmc.Cell(cell_id=${ids.nextCell()}, name='lat ${lc.id} holder', fill=${latVar})])`);
}

