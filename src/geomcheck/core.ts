// Geometry Check and Cell Volumes — the sampling engine behind both.
//
// Both commands ask the same question of the exact-geometry model: at a
// random point, which cells claim it? Count the answers per universe and you
// have overlaps (>1), gaps (0), and — dividing hits by samples — volumes.
// MCNP only tells you about the first two when a particle gets lost, hours
// into a run; the third it refuses to compute for anything that is not a
// simple bounded cell, and an F4 or F7 tally on such a cell is a fatal error
// until you supply `vol` or `sd`.
//
// Sampling is per universe, in that universe's own frame, inside a box drawn
// from the surfaces its cells reference. That is what makes the estimate
// useful on a full core: a 0.4 cm fuel pellet sampled inside the 4 m reactor
// box gets no hits; sampled inside its own pin window it gets thousands.
//
// No `vscode` import — this runs headless in the tests and could run in a
// worker.

import { McnpGeometryModel, McnpCell, RegionNode, McnpSurface, Vec3 } from '../preview/mcnpGeometry';
// (RegionNode/McnpSurface are also used by analyticVolume below.)
import {
    boundsOfSurfaces,
    Bounds,
    cellContains,
    domainPredicate,
    findCell,
    rootUniverseId,
    unconstrainedAxes,
    worldBounds,
} from '../preview/mcnpEvaluate';

export interface SampleOptions {
    /** Points per universe (root included). */
    samples?: number;
    /** Deterministic seed so two runs of the same deck agree. */
    seed?: number;
    /** Skip universes larger than this many cells (a lattice of 50 000 pins is not a universe you sample). */
    maxCellsPerUniverse?: number;
    /**
     * How the code treats two cells claiming one point. MCNP loses the
     * particle and OpenMC raises an error ('error'); SCONE's cellUniverse
     * takes the first cell in list order, so an overlap is legal and only
     * means the later cell is partly shadowed ('first-wins').
     */
    overlapSemantics?: 'error' | 'first-wins';
}

export interface OverlapPair {
    universe: number;
    a: number;
    b: number;
    /** Sample points both cells claimed. */
    hits: number;
    /** One such point, in the universe frame. */
    example: Vec3;
    /** Fraction of the universe's sampled box that both cells claimed. */
    fraction: number;
}

export interface UniverseCheck {
    id: number;
    cells: number;
    /** The universe's cell ids (for jump links); capped at 24. */
    cellIds: number[];
    samples: number;
    /** Sampling window in the universe frame. */
    bounds: Bounds;
    /** Points no cell in this universe claimed (a gap the particle falls through). */
    gapHits: number;
    gapExample: Vec3 | null;
    /** Points more than one cell claimed. */
    overlapHits: number;
    /** True when the universe's only content is a lattice cell: its window tiles, so gaps outside it are not gaps. */
    lattice: boolean;
    skipped?: string;
}

export interface GeometryCheckResult {
    root: number;
    universes: UniverseCheck[];
    overlaps: OverlapPair[];
    /**
     * World-frame descent through fills and lattices: a point every level
     * claimed exactly once is healthy. `outside` counts points beyond a
     * boundary-condition surface (OpenMC vacuum sphere, MCNP `*` planes),
     * which are not in the problem and are not lost.
     */
    world: { samples: number; lost: number; lostExample: Vec3 | null; rootOverlaps: number; outside: number };
    /** True when the deck marks boundary surfaces and points beyond them were excluded. */
    boundedDomain: boolean;
    overlapSemantics: 'error' | 'first-wins';
    elapsedMs: number;
    notes: string[];
}

export interface CellVolume {
    cell: number;
    universe: number;
    hits: number;
    /** cm³ in the universe frame; null when the cell is unbounded there. */
    volume: number | null;
    /** One-sigma relative error of the estimate; 0 for analytic. */
    relErr: number | null;
    /** Cell reaches the sampling box faces, so the estimate is a lower bound only. */
    unbounded: boolean;
    fill: boolean;
    /**
     * 'analytic' when the cell is a shell between concentric spheres or
     * coaxial cylinders (with an axial extent), which is exact and does not
     * depend on how many samples land in a 0.02 cm target inside a 14 m box.
     */
    method: 'analytic' | 'stochastic';
}

/**
 * Exact volume for the shapes decks are mostly made of. A cell whose region is
 * an intersection of halfspaces on concentric spheres (one `-` outer, at most
 * one `+` inner) is a spherical shell; on coaxial z/x/y cylinders plus two
 * perpendicular planes (or an inherited axial extent) it is an annulus.
 * Anything else returns null and falls back to sampling.
 */
export function analyticVolume(model: McnpGeometryModel, cell: McnpCell, window: UniverseWindow): number | null {
    const region = cell.region;
    if (!region || cell.trcl) return null;
    const halves: { surface: number; sense: 1 | -1 }[] = [];
    const flatten = (n: RegionNode): boolean => {
        if (n.op === 'halfspace') { halves.push({ surface: n.surface, sense: n.sense }); return true; }
        if (n.op === 'and') return n.kids.every(flatten);
        return false;
    };
    if (!flatten(region) || !halves.length) return null;
    const shapes = halves.map((h) => ({ ...h, s: model.surfaces.get(h.surface) }));
    if (shapes.some((x) => !x.s || x.s.tr)) return null;

    const sphere = (sh: McnpSurface): { c: Vec3; r: number } | null => {
        const q = sh.shape;
        if (q.kind !== 'quadric' || q.a !== 1 || q.b !== 1 || q.c !== 1 || q.d || q.e || q.f) return null;
        const c: Vec3 = [-q.g / 2, -q.h / 2, -q.j / 2];
        const r2 = c[0] * c[0] + c[1] * c[1] + c[2] * c[2] - q.k;
        return r2 > 0 ? { c, r: Math.sqrt(r2) } : null;
    };
    const cyl = (sh: McnpSurface): { axis: 0 | 1 | 2; u: number; v: number; r: number } | null => {
        const q = sh.shape;
        if (q.kind !== 'quadric' || q.d || q.e || q.f) return null;
        let axis: 0 | 1 | 2, u: number, v: number;
        if (q.a === 0 && q.b === 1 && q.c === 1) { axis = 0; u = -q.h / 2; v = -q.j / 2; }
        else if (q.a === 1 && q.b === 0 && q.c === 1) { axis = 1; u = -q.g / 2; v = -q.j / 2; }
        else if (q.a === 1 && q.b === 1 && q.c === 0) { axis = 2; u = -q.g / 2; v = -q.h / 2; }
        else return null;
        const r2 = u * u + v * v - q.k;
        return r2 > 0 ? { axis, u, v, r: Math.sqrt(r2) } : null;
    };
    const plane = (sh: McnpSurface): { axis: 0 | 1 | 2; d: number } | null => {
        const q = sh.shape;
        if (q.kind !== 'plane') return null;
        for (const ax of [0, 1, 2] as const) {
            if (Math.abs(q.n[ax]) > 0.999999 && !q.n[(ax + 1) % 3] && !q.n[(ax + 2) % 3]) return { axis: ax, d: q.d / q.n[ax] };
        }
        return null;
    };

    // Spherical shell.
    const sph = shapes.map((x) => ({ ...x, g: sphere(x.s!) }));
    if (sph.every((x) => x.g)) {
        const outer = sph.filter((x) => x.sense < 0), inner = sph.filter((x) => x.sense > 0);
        if (outer.length !== 1 || inner.length > 1) return null;
        const o = outer[0].g!, i = inner[0]?.g;
        if (i && (Math.hypot(o.c[0] - i.c[0], o.c[1] - i.c[1], o.c[2] - i.c[2]) > 1e-9 || i.r >= o.r)) return null;
        return (4 / 3) * Math.PI * (o.r ** 3 - (i ? i.r ** 3 : 0));
    }

    // Coaxial cylindrical annulus with an axial extent.
    const cyls = shapes.map((x) => ({ ...x, g: cyl(x.s!) })).filter((x) => x.g);
    const planes = shapes.map((x) => ({ ...x, g: plane(x.s!) })).filter((x) => x.g);
    if (cyls.length + planes.length !== shapes.length || !cyls.length) return null;
    const axis = cyls[0].g!.axis;
    if (cyls.some((x) => x.g!.axis !== axis || Math.abs(x.g!.u - cyls[0].g!.u) > 1e-9 || Math.abs(x.g!.v - cyls[0].g!.v) > 1e-9)) return null;
    const outer = cyls.filter((x) => x.sense < 0), inner = cyls.filter((x) => x.sense > 0);
    if (outer.length !== 1 || inner.length > 1) return null;
    if (planes.some((x) => x.g!.axis !== axis)) return null;
    let lo = -Infinity, hi = Infinity;
    for (const p of planes) {
        if (p.sense > 0) lo = Math.max(lo, p.g!.d); else hi = Math.min(hi, p.g!.d);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
        // No planes of its own along the axis: the inherited container extent is the height.
        if (!window.inherited[axis]) return null;
        lo = Number.isFinite(lo) ? lo : window.bounds.min[axis];
        hi = Number.isFinite(hi) ? hi : window.bounds.max[axis];
    }
    if (hi <= lo) return null;
    const ro = outer[0].g!.r, ri = inner[0]?.g?.r ?? 0;
    if (ri >= ro) return null;
    return Math.PI * (ro * ro - ri * ri) * (hi - lo);
}

export interface UniverseVolumes {
    id: number;
    bounds: Bounds;
    boxVolume: number;
    samples: number;
    cells: CellVolume[];
    /** Axes whose extent came from a container (see `UniverseWindow`). */
    inherited: [boolean, boolean, boolean];
    inheritedFrom?: number;
    containers: number;
    /** Containers disagree on the inherited extent: per-instance volumes differ. */
    extentVaries: boolean;
    skipped?: string;
}

export interface VolumeResult {
    root: number;
    universes: UniverseVolumes[];
    elapsedMs: number;
    notes: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic LCG in [0,1): the same seed always gives the same estimate. */
export function makeRng(seed: number): () => number {
    let s = (seed >>> 0) || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function regionSurfaceIds(node: RegionNode | null, out = new Set<number>()): Set<number> {
    if (!node) return out;
    switch (node.op) {
        case 'halfspace': out.add(node.surface); break;
        case 'and':
        case 'or': for (const k of node.kids) regionSurfaceIds(k, out); break;
        case 'not': regionSurfaceIds(node.kid, out); break;
        case 'cellcomp': break;
    }
    return out;
}

function surfacesOfUniverse(model: McnpGeometryModel, uid: number): McnpSurface[] {
    const ids = new Set<number>();
    for (const cid of model.universes.get(uid) ?? []) {
        const cell = model.cells.get(cid);
        if (cell) regionSurfaceIds(cell.region, ids);
    }
    const surfaces: McnpSurface[] = [];
    for (const id of ids) {
        const s = model.surfaces.get(id);
        if (s) surfaces.push(s);
    }
    return surfaces;
}

/** Cells anywhere in the model whose fill places universe `uid`. */
function containersOf(model: McnpGeometryModel, uid: number): McnpCell[] {
    const out: McnpCell[] = [];
    for (const c of model.cells.values()) {
        if (!c.fill) continue;
        if (c.fill.universe === uid) out.push(c);
        else if (c.fill.grid && c.fill.grid.entries.some((e) => e.universe === uid)) out.push(c);
    }
    return out;
}

export interface UniverseWindow {
    bounds: Bounds;
    /**
     * Axes whose extent was borrowed from a container because nothing in the
     * universe itself bounds them: a pin universe is a stack of infinite
     * cylinders, and its height is whatever the lattice cell that holds it
     * says. Volumes along such an axis are "per instance", and a cell that
     * runs the full inherited extent is not unbounded — that is the point.
     */
    inherited: [boolean, boolean, boolean];
    /** Container cell the extent came from, when any. */
    from?: number;
    /** How many cells place this universe. */
    containers: number;
    /**
     * True when those containers do not agree on the inherited extent (a pin
     * universe reused in axial segments of different heights): the volume of
     * a cell here differs per instance, so no single number is right.
     */
    extentVaries: boolean;
}

/**
 * Sampling window for one universe in its own frame: the box its surfaces
 * span, with unconstrained axes filled in from the cell(s) that contain it,
 * walking up through fills until something has an extent. The root uses the
 * world box and inherits nothing.
 */
export function universeWindow(model: McnpGeometryModel, uid: number, depth = 0): UniverseWindow {
    if (uid === rootUniverseId(model) || depth > 12) {
        const wb = worldBounds(model);
        return { bounds: wb, inherited: [false, false, false], containers: 0, extentVaries: false };
    }
    const own = boundsOfSurfaces(surfacesOfUniverse(model, uid));
    const open = unconstrainedAxes(own);
    const containers = containersOf(model, uid);
    if (!open.some(Boolean)) {
        return { bounds: own, inherited: [false, false, false], containers: containers.length, extentVaries: false };
    }

    const bounds: Bounds = { min: [...own.min] as Vec3, max: [...own.max] as Vec3 };
    const inherited: [boolean, boolean, boolean] = [false, false, false];
    let from: number | undefined;
    let extentVaries = false;
    for (const container of containers) {
        // The container's own extent first; then what it inherits in turn.
        const cb = boundsOfSurfaces(
            [...regionSurfaceIds(container.region)].map((id) => model.surfaces.get(id)).filter((s): s is McnpSurface => !!s),
        );
        const cOpen = unconstrainedAxes(cb);
        const parent = universeWindow(model, container.universe, depth + 1);
        for (let ax = 0; ax < 3; ax++) {
            if (!open[ax]) continue;
            let lo: number, hi: number;
            if (!cOpen[ax]) { lo = cb.min[ax]; hi = cb.max[ax]; }
            else if (!unconstrainedAxes(parent.bounds)[ax] || parent.inherited[ax]) { lo = parent.bounds.min[ax]; hi = parent.bounds.max[ax]; }
            else continue;
            const half = (hi - lo) / 2;
            if (inherited[ax]) {
                // Another container already set this axis: do they agree?
                const have = (bounds.max[ax] - bounds.min[ax]) / 2;
                if (Math.abs(have - half) > 1e-6 * Math.max(1, have)) extentVaries = true;
                continue;
            }
            // A lattice window is centred on the element; an inherited extent
            // is a length, so keep it centred on the universe's own origin.
            const centre = container.fill?.grid ? 0 : (lo + hi) / 2;
            bounds.min[ax] = centre - half;
            bounds.max[ax] = centre + half;
            inherited[ax] = true;
            from = container.id;
        }
    }
    bounds.unconstrained = [open[0] && !inherited[0], open[1] && !inherited[1], open[2] && !inherited[2]];
    return { bounds, inherited, from, containers: containers.length, extentVaries };
}

/** Sampling window for one universe (bounds only). */
export function universeBounds(model: McnpGeometryModel, uid: number): Bounds {
    return universeWindow(model, uid).bounds;
}

function boxVolume(b: Bounds): number {
    return (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]);
}

/**
 * Does the cell reach past the box on an axis the universe itself bounds?
 * Probe just outside the faces of a box 5 % larger: a cell that claims a point
 * out there is not contained by its surfaces (an infinite outer region, the
 * graveyard), and hits/N × boxVolume would understate it. Inherited axes are
 * not probed — a pin running the full height of its lattice cell is the
 * normal case, not an error.
 */
function reachesOutside(model: McnpGeometryModel, cellId: number, w: UniverseWindow): boolean {
    const b = w.bounds;
    const grow = 0.05;
    const cand: number[][] = [[], [], []];
    for (let ax = 0; ax < 3; ax++) {
        const span = b.max[ax] - b.min[ax];
        const mid = (b.min[ax] + b.max[ax]) / 2;
        cand[ax] = w.inherited[ax] ? [mid] : [b.min[ax] - grow * span, mid, b.max[ax] + grow * span];
    }
    for (const x of cand[0]) {
        for (const y of cand[1]) {
            for (const z of cand[2]) {
                const isMid = x === cand[0][Math.floor(cand[0].length / 2)] &&
                    y === cand[1][Math.floor(cand[1].length / 2)] &&
                    z === cand[2][Math.floor(cand[2].length / 2)];
                if (isMid) continue;
                if (cellContains(model, cellId, [x, y, z])) return true;
            }
        }
    }
    return false;
}

function samplePoint(rng: () => number, b: Bounds): Vec3 {
    return [
        b.min[0] + rng() * (b.max[0] - b.min[0]),
        b.min[1] + rng() * (b.max[1] - b.min[1]),
        b.min[2] + rng() * (b.max[2] - b.min[2]),
    ];
}

const DEFAULTS = { samples: 20_000, seed: 12345, maxCellsPerUniverse: 4000 };

// ---------------------------------------------------------------------------
// Geometry check
// ---------------------------------------------------------------------------

export function checkGeometry(model: McnpGeometryModel, opts: SampleOptions = {}): GeometryCheckResult {
    const t0 = Date.now();
    const samples = opts.samples ?? DEFAULTS.samples;
    const rng = makeRng(opts.seed ?? DEFAULTS.seed);
    const maxCells = opts.maxCellsPerUniverse ?? DEFAULTS.maxCellsPerUniverse;
    const root = rootUniverseId(model);
    const notes: string[] = [];
    const universes: UniverseCheck[] = [];
    const overlaps = new Map<string, OverlapPair>();
    const inDomain = domainPredicate(model);
    const overlapSemantics = opts.overlapSemantics ?? 'error';

    const uids = [...model.universes.keys()].sort((a, b) => (a === root ? -1 : b === root ? 1 : a - b));
    for (const uid of uids) {
        const cellIds = model.universes.get(uid) ?? [];
        const cells = cellIds.map((id) => model.cells.get(id)).filter((c): c is McnpCell => !!c && !!c.region);
        const { bounds } = universeWindow(model, uid);
        const entry: UniverseCheck = {
            id: uid, cells: cells.length, cellIds: cells.slice(0, 24).map((c) => c.id), samples: 0, bounds,
            gapHits: 0, gapExample: null, overlapHits: 0,
            lattice: cells.length > 0 && cells.every((c) => c.lat !== 0),
        };
        universes.push(entry);
        if (cells.length === 0) { entry.skipped = 'no cells with a region'; continue; }
        if (cells.length > maxCells) {
            entry.skipped = `${cells.length} cells — above the ${maxCells} per-universe limit`;
            continue;
        }
        // A lattice cell's region is one window; the tiling covers the rest.
        // Sample inside the window so overlaps among lattice cells still show.
        const nonLattice = cells.filter((c) => c.lat === 0);
        const testCells = nonLattice.length ? nonLattice : cells;
        // A filled universe only has to cover its container: the SCONE
        // "coreAndStructures" universe is a stack of cylinders inside a
        // root cylinder, and the corners of its own bounding box are never
        // reached. A point outside every container region is not a gap.
        // (Container regions are tested in the universe frame; a fill with a
        // translation is approximated by ignoring it.)
        const containers = uid === root ? [] : containersOf(model, uid).filter((c) => c.region);
        if (uid !== root && containers.length === 0) {
            // Nothing places this universe (a withdrawn control-rod stack, a
            // leftover variant): it is dead input, not geometry a particle can
            // reach, so its gaps are not lost particles.
            entry.skipped = 'not placed by any cell — unused universe';
            continue;
        }
        const insideAContainer = (p: Vec3): boolean =>
            containers.length === 0 || containers.some((c) => cellContains(model, c.id, p));
        entry.samples = samples;
        for (let i = 0; i < samples; i++) {
            const p = samplePoint(rng, bounds);
            // Root-universe points beyond the boundary surfaces are not in
            // the problem; a gap there is the vacuum, not an error.
            if (uid === root && inDomain && !inDomain(p)) continue;
            if (uid !== root && !insideAContainer(p)) continue;
            let count = 0;
            let first = -1;
            for (const c of testCells) {
                if (!cellContains(model, c.id, p)) continue;
                count++;
                if (first < 0) first = c.id;
                else {
                    const key = `${uid}:${Math.min(first, c.id)}-${Math.max(first, c.id)}`;
                    const rec = overlaps.get(key) ?? {
                        universe: uid, a: Math.min(first, c.id), b: Math.max(first, c.id), hits: 0, example: p, fraction: 0,
                    };
                    rec.hits++;
                    overlaps.set(key, rec);
                }
            }
            if (count === 0 && !entry.lattice) {
                entry.gapHits++;
                if (!entry.gapExample) entry.gapExample = p;
            } else if (count > 1) {
                entry.overlapHits++;
            }
        }
    }
    for (const o of overlaps.values()) {
        const u = universes.find((x) => x.id === o.universe);
        o.fraction = u && u.samples ? o.hits / u.samples : 0;
    }

    // World descent: the check MCNP itself effectively performs per history.
    const wb = worldBounds(model);
    const worldN = Math.min(samples, 50_000);
    const world = { samples: worldN, lost: 0, lostExample: null as Vec3 | null, rootOverlaps: 0, outside: 0 };
    for (let i = 0; i < worldN; i++) {
        const p = samplePoint(rng, wb);
        if (inDomain && !inDomain(p)) { world.outside++; continue; }
        const f = findCell(model, p);
        if (f.lost) { world.lost++; if (!world.lostExample) world.lostExample = p; }
        if (f.overlaps.length > 1) world.rootOverlaps++;
    }

    const flagged = universes.filter((u) => u.gapHits || u.overlapHits).length;
    if (!flagged && world.lost === 0) {
        notes.push(`No overlaps or gaps found in ${universes.length} universes at ${samples.toLocaleString()} points each. Sampling is evidence, not proof — thin slivers can hide between points.`);
    }
    if (inDomain) {
        notes.push(`The deck marks boundary surfaces; ${world.outside.toLocaleString()} of ${worldN.toLocaleString()} world points fell beyond them and were not counted as lost.`);
    }
    if (overlapSemantics === 'first-wins' && overlaps.size) {
        notes.push('SCONE resolves a point claimed by two cells by list order — the first cell in the universe wins — so these overlaps are legal; they mean the later cell is partly shadowed and its region as written is not its region as run.');
    }
    notes.push('Points are sampled inside each universe\'s own surface box; a universe whose only cell is a lattice is judged by its window.');

    return {
        root, universes,
        overlaps: [...overlaps.values()].sort((a, b) => b.hits - a.hits),
        world, boundedDomain: !!inDomain, overlapSemantics, elapsedMs: Date.now() - t0, notes,
    };
}

// ---------------------------------------------------------------------------
// Volumes
// ---------------------------------------------------------------------------

export function estimateVolumes(model: McnpGeometryModel, opts: SampleOptions = {}): VolumeResult {
    const t0 = Date.now();
    const samples = opts.samples ?? DEFAULTS.samples * 5;
    const rng = makeRng(opts.seed ?? DEFAULTS.seed);
    const maxCells = opts.maxCellsPerUniverse ?? DEFAULTS.maxCellsPerUniverse;
    const root = rootUniverseId(model);
    const notes: string[] = [];
    const universes: UniverseVolumes[] = [];

    const uids = [...model.universes.keys()].sort((a, b) => (a === root ? -1 : b === root ? 1 : a - b));
    for (const uid of uids) {
        const cellIds = model.universes.get(uid) ?? [];
        const cells = cellIds.map((id) => model.cells.get(id)).filter((c): c is McnpCell => !!c && !!c.region);
        const window = universeWindow(model, uid);
        const { bounds } = window;
        const bv = boxVolume(bounds);
        const entry: UniverseVolumes = {
            id: uid, bounds, boxVolume: bv, samples: 0, cells: [],
            inherited: window.inherited, inheritedFrom: window.from,
            containers: window.containers, extentVaries: window.extentVaries,
        };
        universes.push(entry);
        if (cells.length === 0) { entry.skipped = 'no cells with a region'; continue; }
        if (cells.length > maxCells) { entry.skipped = `${cells.length} cells — above the ${maxCells} per-universe limit`; continue; }
        if (!(bv > 0) || !Number.isFinite(bv)) { entry.skipped = 'no finite surfaces to bound the universe'; continue; }
        if (unconstrainedAxes(bounds).some((o, ax) => o && !window.inherited[ax])) {
            // Nothing bounds this axis anywhere up the fill chain (a 2D deck
            // with no pz planes): a volume per ±1000 cm would be a fiction.
            entry.skipped = 'unbounded along ' + ['x', 'y', 'z'].filter((_, ax) => unconstrainedAxes(bounds)[ax] && !window.inherited[ax]).join(', ') +
                ' — no surface or container gives it an extent, so volumes are undefined (add axial planes or use `vol` by hand)';
            continue;
        }

        const hits = new Map<number, number>();
        for (const c of cells) hits.set(c.id, 0);
        entry.samples = samples;
        for (let i = 0; i < samples; i++) {
            const p = samplePoint(rng, bounds);
            for (const c of cells) {
                if (cellContains(model, c.id, p)) hits.set(c.id, (hits.get(c.id) ?? 0) + 1);
            }
        }
        for (const c of cells) {
            const h = hits.get(c.id) ?? 0;
            const exact = c.lat === 0 ? analyticVolume(model, c, window) : null;
            if (exact !== null) {
                entry.cells.push({ cell: c.id, universe: uid, hits: h, volume: exact, relErr: 0, unbounded: false, fill: !!c.fill, method: 'analytic' });
                continue;
            }
            const unbounded = c.lat !== 0 ? false : reachesOutside(model, c.id, window);
            const p = h / samples;
            const cv: CellVolume = {
                cell: c.id, universe: uid, hits: h,
                volume: unbounded ? null : p * bv,
                relErr: h > 0 ? Math.sqrt((1 - p) / h) : null,
                unbounded,
                fill: !!c.fill,
                method: 'stochastic',
            };
            entry.cells.push(cv);
        }
    }

    notes.push(`Cells that are spherical shells or coaxial cylindrical annuli are integrated exactly; the rest are sampled at ${samples.toLocaleString()} points per universe with a one-sigma error. A cell that reaches its universe's box faces is unbounded there and gets no volume.`);
    notes.push('Volumes are per universe instance (one pin, one assembly), which is what MCNP `vol`/`sd` want for repeated structures.');
    return { root, universes, elapsedMs: Date.now() - t0, notes };
}

// ---------------------------------------------------------------------------
// MCNP card generation
// ---------------------------------------------------------------------------

function fmt(v: number): string {
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a >= 1e5 || a < 1e-3) return v.toExponential(5);
    return Number(v.toPrecision(7)).toString();
}

/**
 * A `vol` data card: one entry per cell in deck order. Cells whose volume
 * MCNP can compute itself, or that are unbounded, get `j` so MCNP keeps its
 * own value; only estimates on finite cells are written. Repeated-structure
 * cells (in a filled universe) get their per-instance volume, which is what a
 * tally over that cell needs.
 */
export function volCard(cellOrder: number[], result: VolumeResult): string {
    const byCell = new Map<number, CellVolume>();
    const varies = new Set<number>();
    for (const u of result.universes) {
        for (const c of u.cells) byCell.set(c.cell, c);
        if (u.extentVaries) for (const c of u.cells) varies.add(c.cell);
    }
    const entries = cellOrder.map((id) => {
        const v = byCell.get(id);
        // A cell whose instances have different heights has no one volume.
        return v && v.volume !== null && v.hits > 0 && !varies.has(id) ? fmt(v.volume) : 'j';
    });
    // Collapse trailing jumps: MCNP fills missing entries itself.
    while (entries.length && entries[entries.length - 1] === 'j') entries.pop();
    if (!entries.length) return 'c vol: no finite cell volumes to write';
    return wrapCard('vol', entries);
}

/** `sdN` cards for cell tallies, one entry per tally cell. */
export function sdCards(
    tallies: { id: number; cells: number[] }[],
    result: VolumeResult,
): string[] {
    const byCell = new Map<number, CellVolume>();
    const varies = new Set<number>();
    for (const u of result.universes) {
        for (const c of u.cells) byCell.set(c.cell, c);
        if (u.extentVaries) for (const c of u.cells) varies.add(c.cell);
    }
    const out: string[] = [];
    for (const t of tallies) {
        const vals = t.cells.map((id) => {
            const v = byCell.get(id);
            return v && v.volume !== null && v.hits > 0 && !varies.has(id) ? fmt(v.volume) : null;
        });
        if (vals.some((v) => v === null)) {
            const bad = t.cells[vals.indexOf(null)];
            out.push(varies.has(bad)
                ? `c sd${t.id}: cell ${bad} is placed at several heights; its instances have different volumes — use the segment divisor by hand`
                : `c sd${t.id}: cell ${bad} has no finite volume estimate`);
            continue;
        }
        out.push(wrapCard(`sd${t.id}`, vals as string[]));
    }
    return out;
}

/** MCNP continuation: 5 leading blanks, keep lines under 80 columns. */
function wrapCard(name: string, entries: string[]): string {
    const lines: string[] = [];
    let cur = name;
    for (const e of entries) {
        if ((cur + ' ' + e).length > 78) { lines.push(cur); cur = '     ' + e; }
        else cur += ' ' + e;
    }
    lines.push(cur);
    return lines.join('\n');
}
