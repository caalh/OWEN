// Full-fidelity MCNP geometry parser (geometry-preview plan, Stage 1).
//
// Unlike the lattice extractor in codes/mcnp.ts (which pattern-matches the
// pin → assembly → core idiom for the instanced fast path), this module parses
// the deck's geometry the way MCNP defines it: every surface mnemonic becomes
// an analytic object, every macrobody is decomposed into its numbered facets,
// and every cell keeps its full boolean expression (intersection, union `:`,
// complement `#n` / `#(expr)`, parentheses, facet references, `like n but`).
// The companion evaluator (mcnpEvaluate.ts) provides point-membership tests on
// this model; nothing here renders.
//
// Sources (MCNP 6.3.1 manual, LA-UR-24-24602 Rev. 1 — verified 2026-08-12):
//   §3.2.2      card images: 128-column limit applied after 8-column tab
//               expansion; `$` comments; `c` comment cards in columns 1–5;
//               `&` and blank-columns-1–5 continuations.
//   §4.4.1      message block; §4.4.2 title card; §4.4.5.2 vertical (`#`)
//               format — rejected here with a warning, never misparsed.
//   §5.3.1      equation-defined surfaces (Table 5.1 mnemonics).
//   §5.3.2      axisymmetric point-defined X/Y/Z surfaces.
//   §5.3.3      3-point plane; sense fixed by requiring the origin (then
//               (0,0,∞), (0,∞,0), (∞,0,0)) to have negative sense.
//   §5.3.4      macrobodies; Table 5.2 facet numbering; BOX 9-or-12 and
//               RHP/HEX 9-or-15 short forms (do NOT "correct" these counts —
//               see scripts/verify-owen-validator.mjs regression guards);
//               facets renumbered down by two when a BOX/RPP dimension is
//               infinite (§5.3.4.11).
//   §5.5.3      TR cards: rows of the entered matrix are the auxiliary axes
//               expressed in main-system components; `*TR` entries are
//               degrees; m=±1 chooses which system the displacement lives in.
//   §5.5.4      TRCL (integer and inline forms); generated surface numbers
//               1000×cell + surface.
//   §5.5.5      repeated structures: U / FILL (single, array with i:j ranges,
//               per-entry transforms) / LAT=1|2.
//
// No vscode imports — headless-testable, and shared verbatim with the
// reactormc.net vendored copy.

// ---------------------------------------------------------------------------
// Public model types
// ---------------------------------------------------------------------------

export type Vec3 = [number, number, number];

/** All senses follow MCNP: f(p) < 0 is the negative side ("inside"). */
export type Shape =
    | { kind: 'plane'; n: Vec3; d: number }
    | {
        kind: 'quadric';
        a: number; b: number; c: number;
        d: number; e: number; f: number;
        g: number; h: number; j: number; k: number;
    }
    | { kind: 'cone'; apex: Vec3; axis: Vec3; t2: number; sheet: -1 | 0 | 1 }
    | { kind: 'torus'; center: Vec3; axis: 'x' | 'y' | 'z'; a: number; b: number; c: number }
    | { kind: 'body'; facets: Shape[] };

export interface Transform {
    /** Displacement (o1 o2 o3). */
    o: Vec3;
    /** Rotation rows = auxiliary axes in main components; null = identity. */
    m: number[] | null;
    /** m entry of the TR card (±1); +1 is the default. */
    origin: 1 | -1;
    /** Unresolved `trcl=n` / `fill=u(n)` reference; replaced by the real TR
     *  during parseMcnpGeometry's resolution pass. */
    trRef?: number;
    trRefDegrees?: boolean;
}

export interface McnpSurface {
    id: number;
    mnemonic: string;
    shape: Shape;
    /** TR applied via the `n` field of the surface card (null = none). */
    tr: Transform | null;
    /** `*j` reflecting / `+j` white boundary markers (informational). */
    boundary: 'none' | 'reflecting' | 'white';
}

export type RegionNode =
    | { op: 'halfspace'; surface: number; facet: number; sense: 1 | -1 }
    | { op: 'and' | 'or'; kids: RegionNode[] }
    | { op: 'not'; kid: RegionNode }
    | { op: 'cellcomp'; cell: number };

export interface FillGrid {
    i1: number; i2: number;
    j1: number; j2: number;
    k1: number; k2: number;
    /** Row-major [k][j][i] flattened: index = i + nx*(j + ny*k). */
    entries: FillEntry[];
}

/**
 * `fill=0:N 0:M 0:0` is the OpenMC-style 0-based map. In MCNP the (0,0,0)
 * element is the lattice cell as written — usually the origin window — and
 * the first listed surface pair runs +i (§5.5.5). That range therefore tiles
 * only one direction from the origin, so a centered assembly `rpp` shows
 * about a quarter of the pins on an exact slice. Returns a warning, or null
 * when the range already straddles zero (e.g. `-8:8`).
 */
export function oneSidedLatticeFillWarning(cellId: number, g: FillGrid): string | null {
    if (g.i1 !== 0 || g.j1 !== 0) return null;
    if (g.i2 < 4 || g.j2 < 4) return null;
    const nx = g.i2 + 1;
    const ny = g.j2 + 1;
    const hi = Math.floor(g.i2 / 2);
    const hj = Math.floor(g.j2 / 2);
    return (
        `Cell ${cellId}: fill=0:${g.i2} 0:${g.j2} ${g.k1}:${g.k2} starts at the origin ` +
        `lattice element (§5.5.5) and only indexes +i/+j, so a centered assembly ` +
        `window shows about a quarter of the pins on an exact 2D slice. For a ` +
        `centered ${nx}×${ny} use fill=-${hi}:${g.i2 - hi} -${hj}:${g.j2 - hj} ${g.k1}:${g.k2}.`
    );
}

export interface FillEntry {
    universe: number;
    tr: Transform | null;
}

export interface Fill {
    /** Single-universe fill (null when an array fill). */
    universe: number | null;
    grid: FillGrid | null;
    /** Transform on a single-universe fill: `fill=5 (3)` or inline numbers. */
    tr: Transform | null;
}

export interface McnpCell {
    id: number;
    material: number;
    density: number | null;
    region: RegionNode | null;
    universe: number;
    fill: Fill | null;
    lat: 0 | 1 | 2;
    trcl: Transform | null;
    /** Surface ids referenced by the region, in written order (drives the
     *  lattice index convention: first listed pair = first index direction). */
    surfaceOrder: number[];
    likeButOf: number | null;
}

export interface McnpGeometryModel {
    title: string;
    surfaces: Map<number, McnpSurface>;
    cells: Map<number, McnpCell>;
    /** Cells grouped by universe id (0 = the real world). */
    universes: Map<number, number[]>;
    transforms: Map<number, Transform>;
    /** Generated surfaces (1000×cell + surface) from TRCL, §5.5.3 Reminder. */
    generatedSurfaces: Map<number, { surface: number; tr: Transform }>;
    warnings: string[];
}

export interface McnpParseOptions {
    /**
     * Card-image column limit applied before parsing (tab-aware), so the
     * parser sees the same card image MCNP sees. Default 128 (MCNP 6.2+,
     * §3.2.2); pass the Stage-0.1 resolved limit to emulate older versions.
     */
    lineLimit?: number;
}

// ---------------------------------------------------------------------------
// Vector helpers
// ---------------------------------------------------------------------------

function vsub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function vdot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function vcross(a: Vec3, b: Vec3): Vec3 {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function vlen(a: Vec3): number { return Math.hypot(a[0], a[1], a[2]); }
function vscale(a: Vec3, s: number): Vec3 { return [a[0] * s, a[1] * s, a[2] * s]; }
function vnorm(a: Vec3): Vec3 {
    const l = vlen(a);
    return l > 0 ? vscale(a, 1 / l) : [0, 0, 1];
}

/** Rotate v by `deg` degrees about unit axis u (Rodrigues). */
function vrotate(v: Vec3, u: Vec3, deg: number): Vec3 {
    const th = (deg * Math.PI) / 180;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const cross = vcross(u, v);
    const dot = vdot(u, v);
    return [
        v[0] * c + cross[0] * s + u[0] * dot * (1 - c),
        v[1] * c + cross[1] * s + u[1] * dot * (1 - c),
        v[2] * c + cross[2] * s + u[2] * dot * (1 - c),
    ];
}

// ---------------------------------------------------------------------------
// Shape constructors
// ---------------------------------------------------------------------------

/** Plane n·p = d, oriented so `insidePoint` (when given) has negative sense. */
function plane(n: Vec3, d: number, insidePoint?: Vec3): Shape {
    const len = vlen(n);
    if (len > 0) { n = vscale(n, 1 / len); d /= len; }
    if (insidePoint && vdot(n, insidePoint) - d > 0) {
        n = vscale(n, -1);
        d = -d;
    }
    return { kind: 'plane', n, d };
}

/** Plane through 3 points with the §5.3.3 sense rule. */
function planeFrom3Points(p1: Vec3, p2: Vec3, p3: Vec3): Shape | null {
    const n = vcross(vsub(p2, p1), vsub(p3, p1));
    if (vlen(n) < 1e-12) return null;
    const nn = vnorm(n);
    let d = vdot(nn, p1);
    let A = nn[0]; let B = nn[1]; let C = nn[2];
    // Orient so the origin has negative sense; tie-break along +z, +y, +x.
    let flip: boolean;
    if (Math.abs(d) > 1e-12) flip = -d > 0;            // f(0) = −d must be < 0
    else if (Math.abs(C) > 1e-12) flip = C < 0;        // (0,0,∞) positive
    else if (Math.abs(B) > 1e-12) flip = B < 0;        // (0,∞,0) positive
    else flip = A < 0;                                  // (∞,0,0) positive
    if (flip) { A = -A; B = -B; C = -C; d = -d; }
    return { kind: 'plane', n: [A, B, C], d };
}

function sphere(c: Vec3, r: number): Shape {
    return {
        kind: 'quadric',
        a: 1, b: 1, c: 1, d: 0, e: 0, f: 0,
        g: -2 * c[0], h: -2 * c[1], j: -2 * c[2],
        k: c[0] * c[0] + c[1] * c[1] + c[2] * c[2] - r * r,
    };
}

/** Infinite circular cylinder along `axis` through (x0,y0 in the perp plane). */
function cylinderAlong(axis: 'x' | 'y' | 'z', u0: number, v0: number, r: number): Shape {
    // axis x: (y−u0)²+(z−v0)²=r²; axis y: (x−u0)²+(z−v0)²; axis z: (x−u0)²+(y−v0)².
    const q = { kind: 'quadric' as const, a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0, h: 0, j: 0, k: -r * r + u0 * u0 + v0 * v0 };
    if (axis === 'x') { q.b = 1; q.c = 1; q.h = -2 * u0; q.j = -2 * v0; }
    else if (axis === 'y') { q.a = 1; q.c = 1; q.g = -2 * u0; q.j = -2 * v0; }
    else { q.a = 1; q.b = 1; q.g = -2 * u0; q.h = -2 * v0; }
    return q;
}

/** Arbitrary-axis circular cylinder as a quadric: |p−a|² − ((p−a)·û)² = r². */
function cylinderArbitrary(base: Vec3, axisUnit: Vec3, r: number): Shape {
    const [ux, uy, uz] = axisUnit;
    const [ax, ay, az] = base;
    // f = (p−a)·(p−a) − ((p−a)·u)² − r²
    // Expand into the general quadric form.
    const a = 1 - ux * ux;
    const b = 1 - uy * uy;
    const c = 1 - uz * uz;
    const d = -2 * ux * uy;
    const e = -2 * uy * uz;
    const f = -2 * uz * ux;
    const au = ax * ux + ay * uy + az * uz;
    const g = -2 * ax + 2 * ux * au;
    const h = -2 * ay + 2 * uy * au;
    const j = -2 * az + 2 * uz * au;
    const k = ax * ax + ay * ay + az * az - au * au - r * r;
    return { kind: 'quadric', a, b, c, d, e, f, g, h, j, k };
}

/** Elliptic cylinder |w1·(p−v)|²/r1² + |w2·(p−v)|²/r2² = 1 as a quadric-free body facet. */
function ellipticCylinder(base: Vec3, w1: Vec3, r1: number, w2: Vec3, r2: number): Shape {
    // f = ((p−v)·ŵ1)²/r1² + ((p−v)·ŵ2)²/r2² − 1, expanded to a quadric.
    const q = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0, h: 0, j: 0, k: -1 };
    const addOuter = (w: Vec3, r: number) => {
        const s = 1 / (r * r);
        const wb = vdot(w, base);
        q.a += s * w[0] * w[0];
        q.b += s * w[1] * w[1];
        q.c += s * w[2] * w[2];
        q.d += s * 2 * w[0] * w[1];
        q.e += s * 2 * w[1] * w[2];
        q.f += s * 2 * w[2] * w[0];
        q.g += s * -2 * wb * w[0];
        q.h += s * -2 * wb * w[1];
        q.j += s * -2 * wb * w[2];
        q.k += s * wb * wb;
    };
    addOuter(vnorm(w1), r1);
    addOuter(vnorm(w2), r2);
    return { kind: 'quadric', ...q };
}

/** Ellipsoid of revolution about (center, axisUnit) with semi-major aMaj (along axis) and semi-minor aMin. */
function spheroid(center: Vec3, axisUnit: Vec3, aMaj: number, aMin: number): Shape {
    // f = ((p−c)·û)²/aMaj² + (|p−c|² − ((p−c)·û)²)/aMin² − 1
    const q = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0, h: 0, j: 0, k: -1 };
    const u = axisUnit;
    const sAx = 1 / (aMaj * aMaj) - 1 / (aMin * aMin);
    const sIso = 1 / (aMin * aMin);
    // isotropic |p−c|² term
    q.a += sIso; q.b += sIso; q.c += sIso;
    q.g += -2 * sIso * center[0];
    q.h += -2 * sIso * center[1];
    q.j += -2 * sIso * center[2];
    q.k += sIso * vdot(center, center);
    // axial ((p−c)·û)² term
    const cu = vdot(center, u);
    q.a += sAx * u[0] * u[0];
    q.b += sAx * u[1] * u[1];
    q.c += sAx * u[2] * u[2];
    q.d += sAx * 2 * u[0] * u[1];
    q.e += sAx * 2 * u[1] * u[2];
    q.f += sAx * 2 * u[2] * u[0];
    q.g += sAx * -2 * cu * u[0];
    q.h += sAx * -2 * cu * u[1];
    q.j += sAx * -2 * cu * u[2];
    q.k += sAx * cu * cu;
    return { kind: 'quadric', ...q };
}

// ---------------------------------------------------------------------------
// Card image assembly (§3.2.2, §4.4)
// ---------------------------------------------------------------------------

const TAB = 8;

function truncateToLimit(raw: string, limit: number): string {
    let col = 0;
    for (let i = 0; i < raw.length; i++) {
        col += raw[i] === '\t' ? TAB - (col % TAB) : 1;
        if (col > limit) return raw.slice(0, i);
    }
    return raw;
}

function isCommentCard(line: string): boolean {
    // `c` (any case) somewhere in columns 1–5 followed by a space or EOL.
    return /^ {0,4}c(?:\s|$)/i.test(line.replace(/\t/g, '        '));
}

interface LogicalCard {
    text: string;
    /** 0-based source line of the card's first line (for diagnostics). */
    line: number;
}

interface DeckBlocks {
    title: string;
    cellCards: LogicalCard[];
    surfaceCards: LogicalCard[];
    dataCards: LogicalCard[];
    warnings: string[];
}

/** Split a deck into title / cell / surface / data blocks per §3.2.2. */
function splitBlocks(text: string, limit: number, warnings: string[]): DeckBlocks {
    const rawLines = text.split(/\r\n|\r|\n/);
    const lines = rawLines.map((l) => truncateToLimit(l, limit));

    let idx = 0;
    // Optional message block: first card of the file, ends at a blank line.
    if (/^\s*message:/i.test(lines[0] ?? '')) {
        while (idx < lines.length && lines[idx].trim() !== '') idx++;
        while (idx < lines.length && lines[idx].trim() === '') idx++;
    }

    // MCNP requires a title card, but decks pasted into a preview panel often
    // lack one. If line 1 looks like a cell card (integer id + integer
    // material) treat the deck as headerless rather than eating a real cell.
    let title = lines[idx] ?? '';
    const looksLikeCell = /^\s*\d+\s+\d+(\s|$)/.test(title) && !isCommentCard(title);
    if (looksLikeCell) {
        warnings.push('First line looks like a cell card — treating the deck as having no title card.');
        title = '';
    } else {
        idx++;
    }

    const blocks: LogicalCard[][] = [[], [], []];
    let block = 0;
    let buf = '';
    let bufLine = -1;

    const flush = () => {
        const t = buf.trim();
        if (t && block < 3) blocks[block].push({ text: t, line: bufLine });
        buf = '';
        bufLine = -1;
    };

    for (; idx < lines.length; idx++) {
        const raw = lines[idx];
        if (raw.trim() === '') {
            flush();
            if (block < 2 || blocks[2].length > 0 || buf) block++;
            if (block > 2) break; // blank after data block terminates the file
            continue;
        }
        if (isCommentCard(raw)) continue;
        const noComment = raw.replace(/\$.*$/, '');
        if (noComment.trim() === '') continue;

        // Continuation: `&` on the previous card, or blank columns 1–5.
        const expanded = noComment.replace(/\t/g, ' '.repeat(TAB));
        const isIndented = /^ {5,}/.test(expanded);
        const prevAmp = /&\s*$/.test(buf);
        if ((isIndented || prevAmp) && buf !== '') {
            buf = buf.replace(/&\s*$/, ' ') + ' ' + noComment.trim();
            continue;
        }
        flush();
        buf = noComment.trim();
        bufLine = idx;
    }
    flush();

    if (blocks[0].length === 0) {
        warnings.push('No cell cards found — is the deck missing its title card or block structure?');
    }
    return { title: title.trim(), cellCards: blocks[0], surfaceCards: blocks[1], dataCards: blocks[2], warnings };
}

// ---------------------------------------------------------------------------
// Transforms (§5.5.3)
// ---------------------------------------------------------------------------

/**
 * Build a Transform from a TR-style number list (3 / 12 / 13 entries; also
 * tolerates 6- and 9-entry partial-matrix forms per §5.5.3 Detail 3).
 * `degrees` = the `*TR` form (entries are angles).
 */
export function buildTrTransform(nums: number[], degrees: boolean, warnings?: string[], label?: string): Transform | null {
    if (nums.length < 3) return null;
    const o: Vec3 = [nums[0], nums[1], nums[2]];
    let rest = nums.slice(3);
    let origin: 1 | -1 = 1;
    // A trailing ±1 after a full 9-entry matrix is the m flag.
    if (rest.length === 10 && (rest[9] === 1 || rest[9] === -1)) {
        origin = rest[9] as 1 | -1;
        rest = rest.slice(0, 9);
    }
    let m: number[] | null = null;
    if (rest.length === 0) {
        m = null;
    } else if (rest.length === 9) {
        m = degrees ? rest.map((x) => Math.cos((x * Math.PI) / 180)) : rest.slice();
    } else if (rest.length === 6) {
        // Two row vectors given; third by cross product (Detail 3b).
        const vals = degrees ? rest.map((x) => Math.cos((x * Math.PI) / 180)) : rest;
        const r1: Vec3 = [vals[0], vals[1], vals[2]];
        const r2: Vec3 = [vals[3], vals[4], vals[5]];
        const r3 = vcross(r1, r2);
        m = [...r1, ...r2, ...r3];
    } else if (rest.length === 3) {
        // One vector (Detail 3d): complete arbitrarily but orthonormally.
        const vals = degrees ? rest.map((x) => Math.cos((x * Math.PI) / 180)) : rest;
        const r1 = vnorm([vals[0], vals[1], vals[2]]);
        const helper: Vec3 = Math.abs(r1[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
        const r2 = vnorm(vcross(helper, r1));
        const r3 = vcross(r1, r2);
        m = [...r1, ...r2, ...r3];
    } else {
        warnings?.push(`${label ?? 'TR'}: unsupported matrix entry count (${rest.length}); using identity rotation.`);
        m = null;
    }
    // Orthonormalize rows (MCNP "cleans up any small non-orthogonality").
    if (m) {
        const r1 = vnorm([m[0], m[1], m[2]]);
        let r2: Vec3 = [m[3], m[4], m[5]];
        r2 = vnorm(vsub(r2, vscale(r1, vdot(r1, r2))));
        let r3: Vec3 = [m[6], m[7], m[8]];
        const cross = vcross(r1, r2);
        // Keep handedness of the entered third row when it disagrees.
        r3 = vdot(cross, r3) >= 0 ? cross : vscale(cross, -1);
        m = [...r1, ...r2, ...r3];
    }
    return { o, m, origin };
}

/** Map a main-system point into the transform's auxiliary system. */
export function toAux(tr: Transform, p: Vec3): Vec3 {
    if (tr.origin === 1) {
        const d = vsub(p, tr.o);
        if (!tr.m) return d;
        const m = tr.m;
        return [
            m[0] * d[0] + m[1] * d[1] + m[2] * d[2],
            m[3] * d[0] + m[4] * d[1] + m[5] * d[2],
            m[6] * d[0] + m[7] * d[1] + m[8] * d[2],
        ];
    }
    // m = −1: displacement is the main origin in aux coordinates.
    if (!tr.m) return [p[0] + tr.o[0], p[1] + tr.o[1], p[2] + tr.o[2]];
    const m = tr.m;
    return [
        m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + tr.o[0],
        m[3] * p[0] + m[4] * p[1] + m[5] * p[2] + tr.o[1],
        m[6] * p[0] + m[7] * p[1] + m[8] * p[2] + tr.o[2],
    ];
}

/** Map an auxiliary-system point back to the main system (inverse of toAux). */
export function toMain(tr: Transform, q: Vec3): Vec3 {
    if (tr.origin === 1) {
        if (!tr.m) return [q[0] + tr.o[0], q[1] + tr.o[1], q[2] + tr.o[2]];
        const m = tr.m; // rows orthonormal → inverse = transpose
        return [
            m[0] * q[0] + m[3] * q[1] + m[6] * q[2] + tr.o[0],
            m[1] * q[0] + m[4] * q[1] + m[7] * q[2] + tr.o[1],
            m[2] * q[0] + m[5] * q[1] + m[8] * q[2] + tr.o[2],
        ];
    }
    const d: Vec3 = [q[0] - tr.o[0], q[1] - tr.o[1], q[2] - tr.o[2]];
    if (!tr.m) return d;
    const m = tr.m;
    return [
        m[0] * d[0] + m[3] * d[1] + m[6] * d[2],
        m[1] * d[0] + m[4] * d[1] + m[7] * d[2],
        m[2] * d[0] + m[5] * d[1] + m[8] * d[2],
    ];
}

// ---------------------------------------------------------------------------
// Surface parsing (§5.3)
// ---------------------------------------------------------------------------

const EQUATION_MNEMONICS = new Set([
    'p', 'px', 'py', 'pz',
    'so', 's', 'sx', 'sy', 'sz', 'sph',
    'c/x', 'c/y', 'c/z', 'cx', 'cy', 'cz',
    'k/x', 'k/y', 'k/z', 'kx', 'ky', 'kz',
    'sq', 'gq', 'tx', 'ty', 'tz',
    'x', 'y', 'z',
]);

const MACROBODY_MNEMONICS = new Set([
    'box', 'rpp', 'rcc', 'rhp', 'hex', 'rec', 'trc', 'ell', 'wed', 'arb',
]);

export function isSurfaceMnemonic(tok: string): boolean {
    const t = tok.toLowerCase();
    return EQUATION_MNEMONICS.has(t) || MACROBODY_MNEMONICS.has(t);
}

function parseSurfaceCard(
    card: LogicalCard,
    transforms: Map<number, Transform>,
    warnings: string[],
): McnpSurface | null {
    const tokens = card.text.split(/\s+/);
    if (tokens.length < 2) return null;

    let boundary: McnpSurface['boundary'] = 'none';
    let idTok = tokens[0];
    if (idTok.startsWith('*')) { boundary = 'reflecting'; idTok = idTok.slice(1); }
    else if (idTok.startsWith('+')) { boundary = 'white'; idTok = idTok.slice(1); }
    const id = parseInt(idTok, 10);
    if (!Number.isFinite(id) || id <= 0) return null;

    let cursor = 1;
    let tr: Transform | null = null;
    // Optional transform field: an integer before the mnemonic.
    if (/^[-+]?\d+$/.test(tokens[1] ?? '') && isSurfaceMnemonic(tokens[2] ?? '')) {
        const n = parseInt(tokens[1], 10);
        if (n > 0) {
            tr = transforms.get(n) ?? null;
            if (!tr) warnings.push(`Surface ${id}: TR${n} is not defined; treating as untransformed.`);
        } else if (n < 0) {
            warnings.push(`Surface ${id}: periodic boundary (n=${n}) is not supported by the preview; treating as a plain surface.`);
        }
        cursor = 2;
    }

    const mnemonic = (tokens[cursor] ?? '').toLowerCase();
    const params = tokens.slice(cursor + 1).map(Number).filter((n) => Number.isFinite(n));
    const shape = buildShape(id, mnemonic, params, warnings);
    if (!shape) return null;
    return { id, mnemonic, shape, tr, boundary };
}

function need(id: number, mnemonic: string, params: number[], counts: number[], warnings: string[]): boolean {
    if (counts.includes(params.length)) return true;
    warnings.push(`Surface ${id} (${mnemonic}): expected ${counts.join(' or ')} entries, found ${params.length}; skipped.`);
    return false;
}

function buildShape(id: number, mnemonic: string, p: number[], warnings: string[]): Shape | null {
    switch (mnemonic) {
        // --- planes ---------------------------------------------------------
        case 'p':
            if (p.length === 4) {
                const nd = vnormWithD([p[0], p[1], p[2]], p[3]);
                return { kind: 'plane', n: nd.n, d: nd.d };
            }
            if (p.length >= 9) {
                const pl = planeFrom3Points([p[0], p[1], p[2]], [p[3], p[4], p[5]], [p[6], p[7], p[8]]);
                if (!pl) { warnings.push(`Surface ${id} (p): the three points are collinear; skipped.`); return null; }
                return pl;
            }
            warnings.push(`Surface ${id} (p): expected 4 or 9 entries, found ${p.length}; skipped.`);
            return null;
        case 'px': return need(id, mnemonic, p, [1], warnings) ? { kind: 'plane', n: [1, 0, 0], d: p[0] } : null;
        case 'py': return need(id, mnemonic, p, [1], warnings) ? { kind: 'plane', n: [0, 1, 0], d: p[0] } : null;
        case 'pz': return need(id, mnemonic, p, [1], warnings) ? { kind: 'plane', n: [0, 0, 1], d: p[0] } : null;

        // --- spheres ----------------------------------------------------------
        case 'so': return need(id, mnemonic, p, [1], warnings) ? sphere([0, 0, 0], p[0]) : null;
        case 's': case 'sph':
            return need(id, mnemonic, p, [4], warnings) ? sphere([p[0], p[1], p[2]], p[3]) : null;
        case 'sx': return need(id, mnemonic, p, [2], warnings) ? sphere([p[0], 0, 0], p[1]) : null;
        case 'sy': return need(id, mnemonic, p, [2], warnings) ? sphere([0, p[0], 0], p[1]) : null;
        case 'sz': return need(id, mnemonic, p, [2], warnings) ? sphere([0, 0, p[0]], p[1]) : null;

        // --- cylinders --------------------------------------------------------
        case 'c/x': return need(id, mnemonic, p, [3], warnings) ? cylinderAlong('x', p[0], p[1], p[2]) : null;
        case 'c/y': return need(id, mnemonic, p, [3], warnings) ? cylinderAlong('y', p[0], p[1], p[2]) : null;
        case 'c/z': return need(id, mnemonic, p, [3], warnings) ? cylinderAlong('z', p[0], p[1], p[2]) : null;
        case 'cx': return need(id, mnemonic, p, [1], warnings) ? cylinderAlong('x', 0, 0, p[0]) : null;
        case 'cy': return need(id, mnemonic, p, [1], warnings) ? cylinderAlong('y', 0, 0, p[0]) : null;
        case 'cz': return need(id, mnemonic, p, [1], warnings) ? cylinderAlong('z', 0, 0, p[0]) : null;

        // --- cones (t² entry; optional ±1 sheet selector) ----------------------
        case 'k/x': case 'k/y': case 'k/z': {
            if (!need(id, mnemonic, p, [4, 5], warnings)) return null;
            const apex: Vec3 = [p[0], p[1], p[2]];
            const axis: Vec3 = mnemonic === 'k/x' ? [1, 0, 0] : mnemonic === 'k/y' ? [0, 1, 0] : [0, 0, 1];
            const sheet = p.length === 5 ? (p[4] >= 0 ? 1 : -1) : 0;
            return { kind: 'cone', apex, axis, t2: p[3], sheet };
        }
        case 'kx': case 'ky': case 'kz': {
            if (!need(id, mnemonic, p, [2, 3], warnings)) return null;
            const axis: Vec3 = mnemonic === 'kx' ? [1, 0, 0] : mnemonic === 'ky' ? [0, 1, 0] : [0, 0, 1];
            const apex: Vec3 = mnemonic === 'kx' ? [p[0], 0, 0] : mnemonic === 'ky' ? [0, p[0], 0] : [0, 0, p[0]];
            const sheet = p.length === 3 ? (p[2] >= 0 ? 1 : -1) : 0;
            return { kind: 'cone', apex, axis, t2: p[1], sheet };
        }

        // --- general quadrics ---------------------------------------------------
        case 'sq': {
            if (!need(id, mnemonic, p, [10], warnings)) return null;
            const [A, B, C, D, E, F, G, xb, yb, zb] = p;
            // A(x−x̄)²+B(y−ȳ)²+C(z−z̄)²+2D(x−x̄)+2E(y−ȳ)+2F(z−z̄)+G = 0
            return {
                kind: 'quadric',
                a: A, b: B, c: C, d: 0, e: 0, f: 0,
                g: -2 * A * xb + 2 * D,
                h: -2 * B * yb + 2 * E,
                j: -2 * C * zb + 2 * F,
                k: A * xb * xb + B * yb * yb + C * zb * zb - 2 * D * xb - 2 * E * yb - 2 * F * zb + G,
            };
        }
        case 'gq': {
            if (!need(id, mnemonic, p, [10], warnings)) return null;
            const [a, b, c, d, e, f, g, h, j, k] = p;
            return { kind: 'quadric', a, b, c, d, e, f, g, h, j, k };
        }

        // --- tori ---------------------------------------------------------------
        case 'tx': case 'ty': case 'tz': {
            if (!need(id, mnemonic, p, [6], warnings)) return null;
            const axis = mnemonic[1] as 'x' | 'y' | 'z';
            return { kind: 'torus', center: [p[0], p[1], p[2]], axis, a: p[3], b: p[4], c: p[5] };
        }

        // --- axisymmetric point-defined (§5.3.2) ----------------------------------
        case 'x': case 'y': case 'z':
            return axisymmetricFromPoints(id, mnemonic as 'x' | 'y' | 'z', p, warnings);

        // --- macrobodies (§5.3.4, Table 5.2 facet order) ---------------------------
        case 'box': return macroBox(id, p, warnings);
        case 'rpp': return macroRpp(id, p, warnings);
        case 'rcc': return macroRcc(id, p, warnings);
        case 'rhp': case 'hex': return macroRhp(id, mnemonic, p, warnings);
        case 'rec': return macroRec(id, p, warnings);
        case 'trc': return macroTrc(id, p, warnings);
        case 'ell': return macroEll(id, p, warnings);
        case 'wed': return macroWed(id, p, warnings);
        case 'arb': return macroArb(id, p, warnings);

        default:
            warnings.push(`Surface ${id}: unsupported mnemonic '${mnemonic}'; skipped.`);
            return null;
    }
}

function vnormWithD(n: Vec3, d: number): { n: Vec3; d: number } {
    const l = vlen(n);
    return l > 0 ? { n: vscale(n, 1 / l), d: d / l } : { n: [0, 0, 1], d };
}

/**
 * X/Y/Z point-defined axisymmetric surfaces (§5.3.2): 1 pair → plane, 2 pairs
 * → cone or cylinder through the (s, r) points, 3 pairs → conic of revolution
 * fitted as r² = q0 + q1·s + q2·s² (the SQ form MCNP itself reports).
 */
function axisymmetricFromPoints(id: number, axis: 'x' | 'y' | 'z', p: number[], warnings: string[]): Shape | null {
    const pairs: [number, number][] = [];
    for (let i = 0; i + 1 < p.length; i += 2) pairs.push([p[i], p[i + 1]]);
    if (pairs.length < 1 || pairs.length > 3) {
        warnings.push(`Surface ${id} (${axis}): expected 1–3 coordinate pairs, found ${pairs.length}; skipped.`);
        return null;
    }
    const n: Vec3 = axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1];
    if (pairs.length === 1) return { kind: 'plane', n, d: pairs[0][0] };
    if (pairs.length === 2) {
        const [s1, r1] = pairs[0];
        const [s2, r2] = pairs[1];
        if (Math.abs(s2 - s1) < 1e-12) { warnings.push(`Surface ${id} (${axis}): coincident axial coordinates; skipped.`); return null; }
        const slope = (r2 - r1) / (s2 - s1);
        if (Math.abs(slope) < 1e-12) {
            return axis === 'x' ? cylinderAlong('x', 0, 0, Math.abs(r1))
                : axis === 'y' ? cylinderAlong('y', 0, 0, Math.abs(r1))
                : cylinderAlong('z', 0, 0, Math.abs(r1));
        }
        const s0 = s1 - r1 / slope; // apex where r = 0
        const apex: Vec3 = axis === 'x' ? [s0, 0, 0] : axis === 'y' ? [0, s0, 0] : [0, 0, s0];
        const sheet = (s1 - s0) >= 0 ? 1 : -1;
        return { kind: 'cone', apex, axis: n, t2: slope * slope, sheet };
    }
    // 3 pairs: fit r² = q0 + q1 s + q2 s² through the three (s, r²) samples.
    const [s1, r1] = pairs[0];
    const [s2, r2] = pairs[1];
    const [s3, r3] = pairs[2];
    const det = (s2 - s1) * (s3 - s1) * (s3 - s2);
    if (Math.abs(det) < 1e-12) { warnings.push(`Surface ${id} (${axis}): degenerate point set; skipped.`); return null; }
    const y1 = r1 * r1; const y2 = r2 * r2; const y3 = r3 * r3;
    const q2 = ((y3 - y1) * (s2 - s1) - (y2 - y1) * (s3 - s1)) / det;
    const q1 = ((y2 - y1) - q2 * (s2 * s2 - s1 * s1)) / (s2 - s1);
    const q0 = y1 - q1 * s1 - q2 * s1 * s1;
    // perp² − (q0 + q1·s + q2·s²) = 0 in the general quadric form.
    const q = { a: 1, b: 1, c: 1, d: 0, e: 0, f: 0, g: 0, h: 0, j: 0, k: -q0 };
    if (axis === 'x') { q.a = -q2; q.g = -q1; }
    else if (axis === 'y') { q.b = -q2; q.h = -q1; }
    else { q.c = -q2; q.j = -q1; }
    return { kind: 'quadric', ...q };
}

// --- macrobody constructors (facet order per Table 5.2) ----------------------

function macroBox(id: number, p: number[], warnings: string[]): Shape | null {
    if (p.length !== 9 && p.length !== 12) {
        warnings.push(`Surface ${id} (box): expected 9 or 12 entries, found ${p.length}; skipped.`);
        return null;
    }
    const v: Vec3 = [p[0], p[1], p[2]];
    const a1: Vec3 = [p[3], p[4], p[5]];
    const a2: Vec3 = [p[6], p[7], p[8]];
    const a3: Vec3 | null = p.length === 12 ? [p[9], p[10], p[11]] : null;
    const center: Vec3 = [
        v[0] + a1[0] / 2 + a2[0] / 2 + (a3 ? a3[0] / 2 : 0),
        v[1] + a1[1] / 2 + a2[1] / 2 + (a3 ? a3[1] / 2 : 0),
        v[2] + a1[2] / 2 + a2[2] / 2 + (a3 ? a3[2] / 2 : 0),
    ];
    const facets: Shape[] = [];
    const pair = (a: Vec3) => {
        const n = vnorm(a);
        // facet at end of a (far), then at beginning (near) — Table 5.2 order.
        facets.push(plane(n, vdot(n, [v[0] + a[0], v[1] + a[1], v[2] + a[2]]), center));
        facets.push(plane(n, vdot(n, v), center));
    };
    pair(a1);
    pair(a2);
    if (a3) pair(a3);
    return { kind: 'body', facets };
}

function macroRpp(id: number, p: number[], warnings: string[]): Shape | null {
    if (p.length !== 6) {
        warnings.push(`Surface ${id} (rpp): expected 6 entries, found ${p.length}; skipped.`);
        return null;
    }
    const [xmin, xmax, ymin, ymax, zmin, zmax] = p;
    const center: Vec3 = [(xmin + xmax) / 2, (ymin + ymax) / 2, (zmin + zmax) / 2];
    const facets: Shape[] = [];
    // Table 5.2: 1 xmax, 2 xmin, 3 ymax, 4 ymin, 5 zmax, 6 zmin. An equal pair
    // (infinite dimension) skips its two facets and renumbers (§5.3.4.11).
    if (xmax > xmin) {
        facets.push(plane([1, 0, 0], xmax, center));
        facets.push(plane([1, 0, 0], xmin, center));
    }
    if (ymax > ymin) {
        facets.push(plane([0, 1, 0], ymax, center));
        facets.push(plane([0, 1, 0], ymin, center));
    }
    if (zmax > zmin) {
        facets.push(plane([0, 0, 1], zmax, center));
        facets.push(plane([0, 0, 1], zmin, center));
    }
    return { kind: 'body', facets };
}

function macroRcc(id: number, p: number[], warnings: string[]): Shape | null {
    if (p.length !== 7) {
        warnings.push(`Surface ${id} (rcc): expected 7 entries, found ${p.length}; skipped.`);
        return null;
    }
    const v: Vec3 = [p[0], p[1], p[2]];
    const h: Vec3 = [p[3], p[4], p[5]];
    const r = p[6];
    const u = vnorm(h);
    const top: Vec3 = [v[0] + h[0], v[1] + h[1], v[2] + h[2]];
    const mid: Vec3 = [v[0] + h[0] / 2, v[1] + h[1] / 2, v[2] + h[2] / 2];
    return {
        kind: 'body',
        facets: [
            cylinderArbitrary(v, u, r),      // .1 lateral surface
            plane(u, vdot(u, top), mid),      // .2 end of h
            plane(u, vdot(u, v), mid),        // .3 beginning of h
        ],
    };
}

function macroRhp(id: number, mnemonic: string, p: number[], warnings: string[]): Shape | null {
    if (p.length !== 9 && p.length !== 15) {
        // 9 or 15 — the s and t facet vectors are optional for a regular
        // hexagon (do NOT "correct" this; regression-guarded).
        warnings.push(`Surface ${id} (${mnemonic}): expected 9 or 15 entries, found ${p.length}; skipped.`);
        return null;
    }
    const v: Vec3 = [p[0], p[1], p[2]];
    const h: Vec3 = [p[3], p[4], p[5]];
    const r: Vec3 = [p[6], p[7], p[8]];
    const hu = vnorm(h);
    let s: Vec3;
    let t: Vec3;
    if (p.length === 15) {
        s = [p[9], p[10], p[11]];
        t = [p[12], p[13], p[14]];
    } else {
        s = vrotate(r, hu, 60);
        t = vrotate(r, hu, 120);
    }
    const mid: Vec3 = [v[0] + h[0] / 2, v[1] + h[1] / 2, v[2] + h[2] / 2];
    const facets: Shape[] = [];
    for (const w of [r, s, t]) {
        const n = vnorm(w);
        const at: Vec3 = [v[0] + w[0], v[1] + w[1], v[2] + w[2]];
        facets.push(plane(n, vdot(n, at), mid));                             // end of w
        const opp: Vec3 = [v[0] - w[0], v[1] - w[1], v[2] - w[2]];
        facets.push(plane(vscale(n, -1), vdot(vscale(n, -1), opp), mid));    // opposite
    }
    // Facets 7/8 exist only for a finite prism (|h| < 1e6, §5.3.4.5 Detail 2).
    if (vlen(h) < 1e6) {
        const top: Vec3 = [v[0] + h[0], v[1] + h[1], v[2] + h[2]];
        facets.push(plane(hu, vdot(hu, top), mid));
        facets.push(plane(hu, vdot(hu, v), mid));
    }
    return { kind: 'body', facets };
}

function macroRec(id: number, p: number[], warnings: string[]): Shape | null {
    if (p.length !== 10 && p.length !== 12) {
        warnings.push(`Surface ${id} (rec): expected 10 or 12 entries, found ${p.length}; skipped.`);
        return null;
    }
    const v: Vec3 = [p[0], p[1], p[2]];
    const h: Vec3 = [p[3], p[4], p[5]];
    const v1: Vec3 = [p[6], p[7], p[8]];
    const hu = vnorm(h);
    let v2dir: Vec3;
    let r2: number;
    if (p.length === 12) {
        v2dir = [p[9], p[10], p[11]];
        r2 = vlen(v2dir);
    } else {
        v2dir = vcross(hu, vnorm(v1));
        r2 = p[9];
    }
    const mid: Vec3 = [v[0] + h[0] / 2, v[1] + h[1] / 2, v[2] + h[2] / 2];
    const top: Vec3 = [v[0] + h[0], v[1] + h[1], v[2] + h[2]];
    return {
        kind: 'body',
        facets: [
            ellipticCylinder(v, v1, vlen(v1), v2dir, r2), // .1
            plane(hu, vdot(hu, top), mid),                 // .2
            plane(hu, vdot(hu, v), mid),                   // .3
        ],
    };
}

function macroTrc(id: number, p: number[], warnings: string[]): Shape | null {
    if (p.length !== 8) {
        warnings.push(`Surface ${id} (trc): expected 8 entries, found ${p.length}; skipped.`);
        return null;
    }
    const v: Vec3 = [p[0], p[1], p[2]];
    const h: Vec3 = [p[3], p[4], p[5]];
    const r1 = p[6];
    const r2 = p[7];
    const hu = vnorm(h);
    const len = vlen(h);
    if (len < 1e-12) { warnings.push(`Surface ${id} (trc): zero-length axis; skipped.`); return null; }
    const mid: Vec3 = [v[0] + h[0] / 2, v[1] + h[1] / 2, v[2] + h[2] / 2];
    const top: Vec3 = [v[0] + h[0], v[1] + h[1], v[2] + h[2]];
    let lateral: Shape;
    if (Math.abs(r2 - r1) < 1e-12) {
        lateral = cylinderArbitrary(v, hu, r1);
    } else {
        // Apex where the radius extrapolates to zero along the axis.
        const slope = (r2 - r1) / len;
        const s0 = -r1 / slope; // axial distance from v to apex
        const apex: Vec3 = [v[0] + hu[0] * s0, v[1] + hu[1] * s0, v[2] + hu[2] * s0];
        const sheet = s0 <= 0 ? 1 : -1; // body lies on the +hu side of the apex iff s0 < 0
        lateral = { kind: 'cone', apex, axis: hu, t2: slope * slope, sheet };
    }
    return {
        kind: 'body',
        facets: [
            lateral,                        // .1 conical surface
            plane(hu, vdot(hu, top), mid),  // .2 end of h
            plane(hu, vdot(hu, v), mid),    // .3 beginning of h
        ],
    };
}

function macroEll(id: number, p: number[], warnings: string[]): Shape | null {
    if (p.length !== 7) {
        warnings.push(`Surface ${id} (ell): expected 7 entries, found ${p.length}; skipped.`);
        return null;
    }
    const r = p[6];
    if (r > 0) {
        // v1, v2 are the foci; r is the major radius (through both foci).
        const f1: Vec3 = [p[0], p[1], p[2]];
        const f2: Vec3 = [p[3], p[4], p[5]];
        const center: Vec3 = [(f1[0] + f2[0]) / 2, (f1[1] + f2[1]) / 2, (f1[2] + f2[2]) / 2];
        const cdist = vlen(vsub(f2, f1)) / 2;
        if (r <= cdist) { warnings.push(`Surface ${id} (ell): major radius ≤ focal half-distance; skipped.`); return null; }
        const aMin = Math.sqrt(r * r - cdist * cdist);
        const axis = cdist > 1e-12 ? vnorm(vsub(f2, f1)) : ([0, 0, 1] as Vec3);
        return spheroid(center, axis, r, aMin);
    }
    // r < 0: v1 = center, v2 = major axis vector, |r| = minor radius.
    const center: Vec3 = [p[0], p[1], p[2]];
    const major: Vec3 = [p[3], p[4], p[5]];
    const aMaj = vlen(major);
    if (aMaj < 1e-12) { warnings.push(`Surface ${id} (ell): zero-length major axis; skipped.`); return null; }
    return spheroid(center, vnorm(major), aMaj, Math.abs(r));
}

function macroWed(id: number, p: number[], warnings: string[]): Shape | null {
    if (p.length !== 12) {
        warnings.push(`Surface ${id} (wed): expected 12 entries, found ${p.length}; skipped.`);
        return null;
    }
    const v: Vec3 = [p[0], p[1], p[2]];
    const v1: Vec3 = [p[3], p[4], p[5]];
    const v2: Vec3 = [p[6], p[7], p[8]];
    const v3: Vec3 = [p[9], p[10], p[11]];
    // Interior reference: centroid of the wedge (average of the 6 vertices).
    const inside: Vec3 = [
        v[0] + (v1[0] + v2[0]) / 3 + v3[0] / 2,
        v[1] + (v1[1] + v2[1]) / 3 + v3[1] / 2,
        v[2] + (v1[2] + v2[2]) / 3 + v3[2] / 2,
    ];
    const p1: Vec3 = [v[0] + v1[0], v[1] + v1[1], v[2] + v1[2]];
    const p2: Vec3 = [v[0] + v2[0], v[1] + v2[1], v[2] + v2[2]];
    const p3: Vec3 = [v[0] + v3[0], v[1] + v3[1], v[2] + v3[2]];
    // Table 5.2: .1 slant plane (contains both hypotenuses), .2 plane of
    // (v2,v3), .3 plane of (v1,v3), .4 top triangle, .5 bottom triangle.
    const f1n = vnorm(vcross(vsub(p2, p1), v3));
    const facet1 = plane(f1n, vdot(f1n, p1), inside);
    const n2 = vnorm(vcross(v2, v3));
    const facet2 = plane(n2, vdot(n2, v), inside);
    const n3 = vnorm(vcross(v1, v3));
    const facet3 = plane(n3, vdot(n3, v), inside);
    const n45 = vnorm(v3);
    const facet4 = plane(n45, vdot(n45, p3), inside);
    const facet5 = plane(n45, vdot(n45, v), inside);
    return { kind: 'body', facets: [facet1, facet2, facet3, facet4, facet5] };
}

function macroArb(id: number, p: number[], warnings: string[]): Shape | null {
    if (p.length !== 30) {
        warnings.push(`Surface ${id} (arb): expected exactly 30 entries, found ${p.length}; skipped.`);
        return null;
    }
    const corners: Vec3[] = [];
    for (let i = 0; i < 8; i++) corners.push([p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]);
    const sides = p.slice(24, 30);
    const used = new Set<number>();
    for (const s of sides) {
        for (const ch of String(Math.abs(Math.trunc(s)))) {
            const c = parseInt(ch, 10);
            if (c >= 1 && c <= 8) used.add(c);
        }
    }
    const inside: Vec3 = [0, 0, 0];
    const usedList = [...used];
    if (usedList.length === 0) { warnings.push(`Surface ${id} (arb): no face descriptors; skipped.`); return null; }
    for (const c of usedList) {
        inside[0] += corners[c - 1][0];
        inside[1] += corners[c - 1][1];
        inside[2] += corners[c - 1][2];
    }
    inside[0] /= usedList.length;
    inside[1] /= usedList.length;
    inside[2] /= usedList.length;

    const facets: Shape[] = [];
    for (const s of sides) {
        const digits = String(Math.abs(Math.trunc(s))).split('').map((d) => parseInt(d, 10));
        const idxs = digits.filter((d) => d >= 1 && d <= 8);
        if (idxs.length < 3) continue; // zero descriptor → facet absent
        const pl = planeFrom3Points(corners[idxs[0] - 1], corners[idxs[1] - 1], corners[idxs[2] - 1]);
        if (!pl || pl.kind !== 'plane') continue;
        facets.push(plane(pl.n, pl.d, inside));
    }
    if (facets.length < 4) {
        warnings.push(`Surface ${id} (arb): fewer than 4 valid faces; skipped.`);
        return null;
    }
    return { kind: 'body', facets };
}

// ---------------------------------------------------------------------------
// Cell parsing (§5.2)
// ---------------------------------------------------------------------------

interface RawCell {
    card: LogicalCard;
    cell: McnpCell;
    likeBut: { source: number; overrides: string } | null;
}

/** Tokenize the geometry portion, keeping (), :, # as their own tokens. */
function tokenizeGeometry(s: string): string[] {
    return s
        .replace(/([():])/g, ' $1 ')
        .replace(/#\s*\(/g, ' #( ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

class RegionParser {
    private toks: string[];
    private pos = 0;
    private order: number[] = [];

    constructor(tokens: string[]) { this.toks = tokens; }

    surfaceOrder(): number[] { return this.order; }

    parse(): RegionNode | null {
        return this.parseUnion();
    }

    private peek(): string | undefined { return this.toks[this.pos]; }
    private next(): string | undefined { return this.toks[this.pos++]; }

    private parseUnion(): RegionNode | null {
        const kids: RegionNode[] = [];
        const first = this.parseIntersection();
        if (first) kids.push(first);
        while (this.peek() === ':') {
            this.next();
            const k = this.parseIntersection();
            if (k) kids.push(k);
        }
        if (kids.length === 0) return null;
        return kids.length === 1 ? kids[0] : { op: 'or', kids };
    }

    private parseIntersection(): RegionNode | null {
        const kids: RegionNode[] = [];
        for (;;) {
            const t = this.peek();
            if (t === undefined || t === ':' || t === ')') break;
            const f = this.parseFactor();
            if (f) kids.push(f);
            else break;
        }
        if (kids.length === 0) return null;
        return kids.length === 1 ? kids[0] : { op: 'and', kids };
    }

    private parseFactor(): RegionNode | null {
        const t = this.next();
        if (t === undefined) return null;
        if (t === '(') {
            const inner = this.parseUnion();
            if (this.peek() === ')') this.next();
            return inner;
        }
        if (t === '#(') {
            const inner = this.parseUnion();
            if (this.peek() === ')') this.next();
            return inner ? { op: 'not', kid: inner } : null;
        }
        if (t === '#' ) {
            // `# (`-split or `# 5` split across tokens.
            const n = this.peek();
            if (n === '(') { this.next(); const inner = this.parseUnion(); if (this.peek() === ')') this.next(); return inner ? { op: 'not', kid: inner } : null; }
            const cellNum = parseInt(this.next() ?? '', 10);
            return Number.isFinite(cellNum) ? { op: 'cellcomp', cell: cellNum } : null;
        }
        if (t.startsWith('#')) {
            const cellNum = parseInt(t.slice(1), 10);
            return Number.isFinite(cellNum) ? { op: 'cellcomp', cell: cellNum } : null;
        }
        // Signed surface or facet reference: -12, +7, 5.2, -5.3
        const m = t.match(/^([-+]?)(\d+)(?:\.(\d+))?$/);
        if (!m) return null;
        const sense: 1 | -1 = m[1] === '-' ? -1 : 1;
        const surface = parseInt(m[2], 10);
        const facet = m[3] ? parseInt(m[3], 10) : 0;
        this.order.push(surface);
        return { op: 'halfspace', surface, facet, sense };
    }
}

/**
 * Parse a boolean region expression from pre-tokenized input (shared with the
 * Serpent/SCONE engine parsers, whose cell grammars are subsets of MCNP's).
 * Surface references must already be numeric.
 */
export function parseRegionExpression(tokens: string[]): { region: RegionNode | null; order: number[] } {
    const rp = new RegionParser(tokens);
    const region = rp.parse();
    return { region, order: rp.surfaceOrder() };
}

/** Tokenize a region string, keeping (), :, # as their own tokens. */
export function tokenizeRegion(s: string): string[] {
    return tokenizeGeometry(s);
}

const CELL_KEYWORDS = new Set([
    'imp', 'vol', 'pwt', 'ext', 'fcl', 'wwn', 'dxc', 'nonu', 'pd', 'tmp', 'u',
    'trcl', 'lat', 'fill', 'elpt', 'cosy', 'bflcl', 'unc', 'mat', 'rho',
]);

/** Split "key=value" and bare-keyword parameter forms out of the tail. */
function keywordAt(tokens: string[], i: number): { key: string; starred: boolean; inlineVal: string | null } | null {
    const tok = tokens[i];
    const m = tok.match(/^(\*?)([a-zA-Z]+)(?::[a-zA-Z,]+)?(?:=(.*))?$/);
    if (!m) return null;
    const key = m[2].toLowerCase();
    if (!CELL_KEYWORDS.has(key)) return null;
    return { key, starred: m[1] === '*', inlineVal: m[3] !== undefined ? m[3] : null };
}

function parseCellCard(card: LogicalCard, warnings: string[]): RawCell | null {
    const text = card.text.replace(/\s*=\s*/g, '=');
    const tokens = text.split(/\s+/);
    if (tokens.length < 2) return null;
    const id = parseInt(tokens[0], 10);
    if (!Number.isFinite(id) || id <= 0) return null;

    // LIKE n BUT ...
    if ((tokens[1] ?? '').toLowerCase() === 'like') {
        const src = parseInt(tokens[2] ?? '', 10);
        if (!Number.isFinite(src) || (tokens[3] ?? '').toLowerCase() !== 'but') {
            warnings.push(`Cell ${id}: malformed LIKE n BUT card; skipped.`);
            return null;
        }
        const cell: McnpCell = {
            id, material: 0, density: null, region: null, universe: 0,
            fill: null, lat: 0, trcl: null, surfaceOrder: [], likeButOf: src,
        };
        return { card, cell, likeBut: { source: src, overrides: tokens.slice(4).join(' ') } };
    }

    const material = parseInt(tokens[1], 10);
    if (!Number.isFinite(material)) return null;
    let cursor = 2;
    let density: number | null = null;
    if (material !== 0) {
        density = Number(tokens[2]);
        if (!Number.isFinite(density)) { density = null; }
        cursor = 3;
    }

    // Geometry runs until the first cell-parameter keyword.
    let geomEnd = tokens.length;
    for (let i = cursor; i < tokens.length; i++) {
        if (keywordAt(tokens, i)) { geomEnd = i; break; }
    }
    const geomTokens = tokenizeGeometry(tokens.slice(cursor, geomEnd).join(' '));
    const rp = new RegionParser(geomTokens);
    const region = rp.parse();
    if (!region) warnings.push(`Cell ${id}: could not parse its geometry expression.`);

    const cell: McnpCell = {
        id, material, density, region, universe: 0,
        fill: null, lat: 0, trcl: null,
        surfaceOrder: rp.surfaceOrder(), likeButOf: null,
    };
    applyCellParams(cell, tokens.slice(geomEnd), warnings);
    return { card, cell, likeBut: null };
}

/** Parse the cell-parameter tail (u= fill= lat= trcl= …) onto the cell. */
function applyCellParams(cell: McnpCell, tokens: string[], warnings: string[]): void {
    for (let i = 0; i < tokens.length; i++) {
        const kw = keywordAt(tokens, i);
        if (!kw) continue;
        const grabValues = (): string[] => {
            const vals: string[] = [];
            if (kw.inlineVal) vals.push(kw.inlineVal);
            for (let j = i + 1; j < tokens.length; j++) {
                if (keywordAt(tokens, j)) break;
                vals.push(tokens[j]);
            }
            return vals;
        };
        switch (kw.key) {
            case 'u': {
                const v = parseInt(grabValues()[0] ?? '', 10);
                // Negative u = "no truncation" promise; fill refers to |u|.
                if (Number.isFinite(v)) cell.universe = Math.abs(v);
                break;
            }
            case 'lat': {
                const v = parseInt(grabValues()[0] ?? '', 10);
                cell.lat = v === 1 ? 1 : v === 2 ? 2 : 0;
                if (v !== 1 && v !== 2 && Number.isFinite(v)) {
                    warnings.push(`Cell ${cell.id}: lat=${v} is not 1 or 2; ignored.`);
                }
                break;
            }
            case 'trcl': {
                const vals = grabValues().join(' ');
                cell.trcl = parseTrclValue(vals, kw.starred, cell.id, warnings);
                break;
            }
            case 'fill': {
                const vals = grabValues();
                cell.fill = parseFillValue(vals, kw.starred, cell.id, warnings);
                break;
            }
            default:
                break;
        }
    }
}

/** TRCL = n (resolved later) or inline `(o1 o2 o3 …)`. */
function parseTrclValue(raw: string, starred: boolean, cellId: number, warnings: string[]): Transform | null {
    const nums = (raw.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
    if (nums.length === 1 && !raw.includes('(')) {
        // Integer form: reference to TRn — resolved after the data pass.
        return { o: [0, 0, 0], m: null, origin: 1, trRef: nums[0], trRefDegrees: starred };
    }
    const tr = buildTrTransform(nums, starred, warnings, `Cell ${cellId} trcl`);
    if (!tr) warnings.push(`Cell ${cellId}: malformed trcl; ignored.`);
    return tr;
}

/**
 * FILL value: `n`, `n (tr…)`, `n(m)` (TR reference), or an array
 * `i1:i2 j1:j2 k1:k2 u1 u2 …` with nR repeats and per-entry `u(m)`/(inline).
 */
function parseFillValue(vals: string[], starred: boolean, cellId: number, warnings: string[]): Fill | null {
    if (vals.length === 0) return null;
    const joined = vals.join(' ');
    const rangeRe = /^(-?\d+):(-?\d+)$/;

    if (rangeRe.test(vals[0] ?? '')) {
        if (vals.length < 3 || !rangeRe.test(vals[1]) || !rangeRe.test(vals[2])) {
            warnings.push(`Cell ${cellId}: fill array needs three i:j ranges; ignored.`);
            return null;
        }
        const [i1, i2] = vals[0].match(rangeRe)!.slice(1).map(Number);
        const [j1, j2] = vals[1].match(rangeRe)!.slice(1).map(Number);
        const [k1, k2] = vals[2].match(rangeRe)!.slice(1).map(Number);
        const nx = i2 - i1 + 1;
        const ny = j2 - j1 + 1;
        const nz = k2 - k1 + 1;
        if (nx <= 0 || ny <= 0 || nz <= 0 || nx * ny * nz > 5_000_000) {
            warnings.push(`Cell ${cellId}: fill array dimensions ${nx}×${ny}×${nz} are invalid or too large; ignored.`);
            return null;
        }
        const entries = expandFillEntries(joined.slice(joined.indexOf(vals[2]) + vals[2].length), starred, cellId, warnings);
        const total = nx * ny * nz;
        while (entries.length < total) entries.push({ universe: 0, tr: null });
        return { universe: null, grid: { i1, i2, j1, j2, k1, k2, entries: entries.slice(0, total) }, tr: null };
    }

    // Single-universe fill, possibly with a transform.
    const m = joined.match(/^(-?\d+)\s*(?:\(([^)]*)\))?/);
    if (!m) return null;
    const universe = Math.abs(parseInt(m[1], 10));
    let tr: Transform | null = null;
    if (m[2] !== undefined) {
        const nums = (m[2].match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
        if (nums.length === 1) {
            tr = { o: [0, 0, 0], m: null, origin: 1, trRef: nums[0], trRefDegrees: starred };
        } else if (nums.length >= 3) {
            tr = buildTrTransform(nums, starred, warnings, `Cell ${cellId} fill transform`);
        }
    }
    return Number.isFinite(universe) ? { universe, grid: null, tr } : null;
}

const MAX_FILL_ENTRIES = 1_000_000;

/** Expand a fill universe list with nR repeats and per-entry (tr) suffixes. */
function expandFillEntries(raw: string, starred: boolean, cellId: number, warnings: string[]): FillEntry[] {
    const out: FillEntry[] = [];
    // Tokens: number, number(trRef), number(o1 o2 o3 ...), nR, nJ.
    const re = /(-?\d+)\s*\(([^)]*)\)|(\d+)\s*[rR]\b|(\d+)?\s*[jJ]\b|(-?\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
        if (out.length >= MAX_FILL_ENTRIES) break;
        if (m[1] !== undefined) {
            const u = Math.abs(parseInt(m[1], 10));
            const nums = (m[2].match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
            let tr: Transform | null = null;
            if (nums.length === 1) {
                tr = { o: [0, 0, 0], m: null, origin: 1, trRef: nums[0], trRefDegrees: starred };
            } else if (nums.length >= 3) {
                tr = buildTrTransform(nums, starred, warnings, `Cell ${cellId} fill entry transform`);
            }
            out.push({ universe: u, tr });
        } else if (m[3] !== undefined) {
            const n = Math.min(parseInt(m[3], 10), MAX_FILL_ENTRIES - out.length);
            const last = out.length > 0 ? out[out.length - 1] : { universe: 0, tr: null };
            for (let k = 0; k < n; k++) out.push({ universe: last.universe, tr: last.tr });
        } else if (m[0].toLowerCase().includes('j')) {
            const n = Math.min(m[4] ? parseInt(m[4], 10) : 1, MAX_FILL_ENTRIES - out.length);
            for (let k = 0; k < n; k++) out.push({ universe: 0, tr: null });
        } else if (m[5] !== undefined) {
            out.push({ universe: Math.abs(parseInt(m[5], 10)), tr: null });
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// LIKE n BUT
// ---------------------------------------------------------------------------

function applyLikeBut(target: McnpCell, source: McnpCell, overrides: string, warnings: string[]): void {
    target.material = source.material;
    target.density = source.density;
    target.region = source.region;
    target.universe = source.universe;
    target.fill = source.fill;
    target.lat = source.lat;
    target.trcl = source.trcl;
    target.surfaceOrder = source.surfaceOrder.slice();

    const tokens = overrides.replace(/\s*=\s*/g, '=').split(/\s+/).filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
        const kw = keywordAt(tokens, i);
        if (!kw) continue;
        const grab = (): string[] => {
            const vals: string[] = [];
            if (kw.inlineVal) vals.push(kw.inlineVal);
            for (let j = i + 1; j < tokens.length; j++) {
                if (keywordAt(tokens, j)) break;
                vals.push(tokens[j]);
            }
            return vals;
        };
        switch (kw.key) {
            case 'mat': {
                const v = parseInt(grab()[0] ?? '', 10);
                if (Number.isFinite(v)) target.material = v;
                break;
            }
            case 'rho': {
                const v = Number(grab()[0]);
                if (Number.isFinite(v)) target.density = v;
                break;
            }
            case 'u': {
                const v = parseInt(grab()[0] ?? '', 10);
                if (Number.isFinite(v)) target.universe = Math.abs(v);
                break;
            }
            case 'lat': {
                const v = parseInt(grab()[0] ?? '', 10);
                target.lat = v === 1 ? 1 : v === 2 ? 2 : 0;
                break;
            }
            case 'trcl': {
                target.trcl = parseTrclValue(grab().join(' '), kw.starred, target.id, warnings);
                break;
            }
            case 'fill': {
                target.fill = parseFillValue(grab(), kw.starred, target.id, warnings);
                break;
            }
            default:
                break;
        }
    }
}

// ---------------------------------------------------------------------------
// TR reference resolution
// ---------------------------------------------------------------------------

function resolveTransformRef(
    tr: Transform | null,
    transforms: Map<number, Transform>,
    where: string,
    warnings: string[],
): Transform | null {
    if (!tr) return null;
    const ref = tr.trRef;
    if (ref === undefined) return tr;
    if (ref === 0) return null; // TRCL=0 = identity (§5.5.4 default)
    const found = transforms.get(Math.abs(ref));
    if (!found) {
        warnings.push(`${where}: TR${ref} is not defined; ignoring the transform.`);
        return null;
    }
    return found;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function parseMcnpGeometry(text: string, opts: McnpParseOptions = {}): McnpGeometryModel {
    const warnings: string[] = [];
    const limit = opts.lineLimit && opts.lineLimit > 0 ? Math.floor(opts.lineLimit) : 128;
    const blocks = splitBlocks(text, limit, warnings);

    // Pass 1: data cards → TR transforms (surfaces need them).
    const transforms = new Map<number, Transform>();
    for (const card of blocks.dataCards) {
        const expandedFirst = card.text.replace(/\t/g, ' '.repeat(TAB));
        if (/^\s{0,4}#/.test(expandedFirst)) {
            warnings.push(`Vertical-format (#) data card at line ${card.line + 1} is not supported; skipped (its columns are NOT parsed).`);
            continue;
        }
        const m = card.text.match(/^(\*?)tr(\d+)\s+(.*)$/i);
        if (!m) continue;
        const degrees = m[1] === '*';
        const n = parseInt(m[2], 10);
        const nums = (m[3].match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
        const tr = buildTrTransform(nums, degrees, warnings, `TR${n}`);
        if (tr) transforms.set(n, tr);
        else warnings.push(`TR${n}: fewer than 3 entries; ignored.`);
    }

    // Pass 2: surfaces.
    const surfaces = new Map<number, McnpSurface>();
    for (const card of blocks.surfaceCards) {
        const s = parseSurfaceCard(card, transforms, warnings);
        if (s) {
            if (surfaces.has(s.id)) warnings.push(`Surface ${s.id} is defined more than once; the last definition wins.`);
            surfaces.set(s.id, s);
        }
        // Parse failures are warned from inside buildShape (bad counts and
        // unknown mnemonics both name the surface), so nothing is silent here.
    }

    // Pass 3: cells (two-phase for LIKE n BUT forward references).
    const rawCells: RawCell[] = [];
    for (const card of blocks.cellCards) {
        const rc = parseCellCard(card, warnings);
        if (rc) rawCells.push(rc);
    }
    const cells = new Map<number, McnpCell>();
    for (const rc of rawCells) {
        if (cells.has(rc.cell.id)) warnings.push(`Cell ${rc.cell.id} is defined more than once; the last definition wins.`);
        cells.set(rc.cell.id, rc.cell);
    }
    for (const rc of rawCells) {
        if (!rc.likeBut) continue;
        const src = cells.get(rc.likeBut.source);
        if (!src) {
            warnings.push(`Cell ${rc.cell.id}: LIKE ${rc.likeBut.source} BUT — source cell not found; skipped.`);
            cells.delete(rc.cell.id);
            continue;
        }
        if (src.likeButOf !== null) {
            warnings.push(`Cell ${rc.cell.id}: LIKE chains (source is itself LIKE) are resolved one level only.`);
        }
        applyLikeBut(rc.cell, src, rc.likeBut.overrides, warnings);
    }

    // Resolve TR references in trcl / fill.
    for (const cell of cells.values()) {
        cell.trcl = resolveTransformRef(cell.trcl, transforms, `Cell ${cell.id} trcl`, warnings);
        if (cell.fill) {
            cell.fill.tr = resolveTransformRef(cell.fill.tr, transforms, `Cell ${cell.id} fill`, warnings);
            if (cell.fill.grid) {
                for (const e of cell.fill.grid.entries) {
                    e.tr = resolveTransformRef(e.tr, transforms, `Cell ${cell.id} fill entry`, warnings);
                }
            }
        }
    }

    // Generated surfaces from TRCL: 1000×cell + surface (§5.5.3 Reminder).
    const generatedSurfaces = new Map<number, { surface: number; tr: Transform }>();
    for (const cell of cells.values()) {
        if (!cell.trcl) continue;
        if (cell.id > 999_999) continue;
        for (const sid of cell.surfaceOrder) {
            if (sid > 999) continue;
            generatedSurfaces.set(1000 * cell.id + sid, { surface: sid, tr: cell.trcl });
        }
    }

    // Universe index.
    const universes = new Map<number, number[]>();
    for (const cell of cells.values()) {
        const u = cell.universe;
        if (!universes.has(u)) universes.set(u, []);
        universes.get(u)!.push(cell.id);
    }

    for (const cell of cells.values()) {
        if (cell.lat === 0 || !cell.fill?.grid) continue;
        const w = oneSidedLatticeFillWarning(cell.id, cell.fill.grid);
        if (w) warnings.push(w);
    }

    return {
        title: blocks.title,
        surfaces,
        cells,
        universes,
        transforms,
        generatedSurfaces,
        warnings,
    };
}
