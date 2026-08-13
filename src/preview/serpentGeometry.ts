// Serpent → shared exact-geometry model (geometry-preview plan, Stage 6).
//
// Serpent's surface set and cell grammar are close cousins of MCNP's, so this
// parser maps them onto the same McnpGeometryModel: surfaces become the same
// analytic Shape union, `cell` cards become RegionNodes through the shared
// expression parser, `lat` cards synthesize lattice cells whose window planes
// drive the shared lattice-basis math, and `trans s` translations attach as
// surface transforms. findCell / sliceModel / buildCsgScene then work
// unchanged. Sense convention matches MCNP: `-s` = inside (negative).
//
// Coverage (Serpent 2 wiki "surface types", cross-checked against the site's
// audited Serpent tutorial pages): px py pz plane sph cyl/cylz cylx cyly sqc
// cube cuboid hexxc hexyc cone torx tory torz inf. Unsupported types warn and
// are skipped — never silently dropped (Stage 0.2 policy). Square (type 1)
// and hex (types 2/3) lattices are expanded; other lattice types warn.
//
// Names: Serpent surfaces/universes/materials are named, the shared model is
// numeric — symbol tables assign sequential ids (surfaces from 1, materials
// from 1, universes: "0" → 0, others from 1).

import {
    Fill,
    McnpCell,
    McnpGeometryModel,
    McnpSurface,
    parseRegionExpression,
    Shape,
    tokenizeRegion,
    Transform,
    Vec3,
} from './mcnpGeometry';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function plane(n: Vec3, d: number, insidePoint?: Vec3): Shape {
    const len = Math.hypot(n[0], n[1], n[2]);
    if (len > 0) { n = [n[0] / len, n[1] / len, n[2] / len]; d /= len; }
    if (insidePoint && n[0] * insidePoint[0] + n[1] * insidePoint[1] + n[2] * insidePoint[2] - d > 0) {
        n = [-n[0], -n[1], -n[2]];
        d = -d;
    }
    return { kind: 'plane', n, d };
}

function sphere(c: Vec3, r: number): Shape {
    return {
        kind: 'quadric', a: 1, b: 1, c: 1, d: 0, e: 0, f: 0,
        g: -2 * c[0], h: -2 * c[1], j: -2 * c[2],
        k: c[0] * c[0] + c[1] * c[1] + c[2] * c[2] - r * r,
    };
}

function cylinderAlong(axis: 'x' | 'y' | 'z', u0: number, v0: number, r: number): Shape {
    const q = { kind: 'quadric' as const, a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0, h: 0, j: 0, k: -r * r + u0 * u0 + v0 * v0 };
    if (axis === 'x') { q.b = 1; q.c = 1; q.h = -2 * u0; q.j = -2 * v0; }
    else if (axis === 'y') { q.a = 1; q.c = 1; q.g = -2 * u0; q.j = -2 * v0; }
    else { q.a = 1; q.b = 1; q.g = -2 * u0; q.h = -2 * v0; }
    return q;
}

/** Regular hexagonal prism about the z axis: d = center→flat distance,
 *  first flat ⊥ `firstAxis`. Facet planes only (infinite along z). */
function hexPrism(x0: number, y0: number, d: number, firstAxis: 'x' | 'y'): Shape {
    const start = firstAxis === 'x' ? 0 : 90;
    const facets: Shape[] = [];
    for (const angDeg of [start, start + 60, start + 120]) {
        const a = (angDeg * Math.PI) / 180;
        const n: Vec3 = [Math.cos(a), Math.sin(a), 0];
        const c = n[0] * x0 + n[1] * y0;
        facets.push({ kind: 'plane', n, d: c + d });
        facets.push({ kind: 'plane', n: [-n[0], -n[1], 0], d: -(c - d) });
    }
    return { kind: 'body', facets };
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

interface LatDef {
    uid: number;
    type: number;
    x0: number;
    y0: number;
    nx: number;
    ny: number;
    pitch: number;
    entries: string[];
}

export function parseSerpentGeometry(text: string): McnpGeometryModel {
    const warnings: string[] = [];
    const surfaces = new Map<number, McnpSurface>();
    const cells = new Map<number, McnpCell>();
    const transforms = new Map<number, Transform>();

    const surfaceIds = new Map<string, number>();
    const materialIds = new Map<string, number>();
    const universeIds = new Map<string, number>([['0', 0]]);
    let nextSurface = 1;
    let nextMaterial = 1;
    let nextUniverse = 1;
    let nextCell = 1;
    let nextSynthSurface = 1_000_000; // synthesized lattice windows live high

    const surfaceId = (name: string): number => {
        let id = surfaceIds.get(name);
        if (id === undefined) { id = nextSurface++; surfaceIds.set(name, id); }
        return id;
    };
    const materialId = (name: string): number => {
        if (name === 'void') return 0;
        let id = materialIds.get(name);
        if (id === undefined) { id = nextMaterial++; materialIds.set(name, id); }
        return id;
    };
    const universeId = (name: string): number => {
        let id = universeIds.get(name);
        if (id === undefined) { id = nextUniverse++; universeIds.set(name, id); }
        return id;
    };

    // Strip comments; join into logical lines (Serpent cards are line-based,
    // but lattice maps continue over following lines until the next keyword).
    const rawLines = text
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .split(/\r?\n/)
        .map((l) => l.replace(/%.*$/, '').replace(/#\s.*$/, ''));

    const KEYWORDS = /^(surf|cell|lat|pin|trans|mat|therm|set|include|plot|mesh|det|nest|dtrans|src|wwin|ene|div|branch|coef)\b/i;
    interface Card { kind: string; tokens: string[] }
    const cards: Card[] = [];
    let current: string[] | null = null;
    for (const line of rawLines) {
        const trimmed = line.trim();
        if (trimmed === '') continue;
        if (KEYWORDS.test(trimmed)) {
            if (current) cards.push({ kind: current[0].toLowerCase(), tokens: current });
            current = trimmed.split(/\s+/);
        } else if (current) {
            current.push(...trimmed.split(/\s+/));
        }
    }
    if (current) cards.push({ kind: current[0].toLowerCase(), tokens: current });

    // Pass 1: transforms (surface translations only; rotations warn).
    const surfaceTransforms = new Map<string, Transform>();
    for (const card of cards) {
        if (card.kind !== 'trans') continue;
        const t = card.tokens;
        // trans s <name> x y z [...]   (also legacy: trans <name> x y z)
        const isSurf = t[1]?.toLowerCase() === 's';
        const name = isSurf ? t[2] : t[1];
        const nums = t.slice(isSurf ? 3 : 2).map(Number).filter((v) => Number.isFinite(v));
        if (!name || nums.length < 3) continue;
        if (nums.length > 3) {
            warnings.push(`trans ${name}: rotation entries are not applied by the preview engine (translation only).`);
        }
        surfaceTransforms.set(name, { o: [nums[0], nums[1], nums[2]], m: null, origin: 1 });
    }

    // Pass 2: surfaces.
    for (const card of cards) {
        if (card.kind !== 'surf') continue;
        const t = card.tokens;
        const name = t[1];
        const type = (t[2] ?? '').toLowerCase();
        const p = t.slice(3).map(Number).filter((v) => Number.isFinite(v));
        if (!name || !type) continue;
        const shape = buildSerpentShape(type, p, name, warnings);
        if (!shape) continue;
        const id = surfaceId(name);
        surfaces.set(id, {
            id,
            mnemonic: type,
            shape,
            tr: surfaceTransforms.get(name) ?? null,
            boundary: 'none',
        });
    }

    // Pass 3: cells.
    for (const card of cards) {
        if (card.kind !== 'cell') continue;
        const t = card.tokens;
        const name = t[1];
        const uni = t[2];
        const what = t[3];
        if (!name || !uni || !what) continue;
        let material = 0;
        let fill: Fill | null = null;
        let regionStart = 4;
        const whatLower = what.toLowerCase();
        if (whatLower === 'fill') {
            const target = t[4];
            if (!target) continue;
            fill = { universe: universeId(target), grid: null, tr: null };
            regionStart = 5;
        } else if (whatLower === 'void' || whatLower === 'outside') {
            material = 0;
        } else {
            material = materialId(what);
        }

        // Map surface-name tokens to numeric ids, preserving operators.
        const regionRaw = t.slice(regionStart).join(' ');
        const mapped = tokenizeRegion(regionRaw).map((tok) => {
            const m = tok.match(/^([-+]?)([A-Za-z_][\w.]*)$/);
            if (!m) return tok;
            const id = surfaceIds.get(m[2]);
            if (id === undefined) {
                warnings.push(`Cell ${name}: surface '${m[2]}' is not defined; its halfspace is dropped.`);
                return `${m[1]}999999999`;
            }
            return `${m[1]}${id}`;
        });
        const { region, order } = parseRegionExpression(mapped);
        const cell: McnpCell = {
            id: nextCell++,
            material,
            density: null,
            region,
            universe: universeId(uni),
            fill,
            lat: 0,
            trcl: null,
            surfaceOrder: order,
            likeButOf: null,
        };
        cells.set(cell.id, cell);
    }

    // Pass 3b: `pin` cards — Serpent's concentric-ring sugar. Synthesize a
    // universe of annular cells on z-cylinders (same shape SCONE pinUniverses
    // take), so lattices can reference pins by name.
    for (const card of cards) {
        if (card.kind !== 'pin') continue;
        const t = card.tokens;
        const name = t[1];
        if (!name) continue;
        const uid = universeId(name);
        // Alternating material/radius pairs; the last material has no radius
        // (the infinite outer region).
        const items: { material: string; radius: number | null }[] = [];
        for (let i = 2; i < t.length; i += 2) {
            const mat = t[i];
            const r = i + 1 < t.length ? Number(t[i + 1]) : NaN;
            items.push({ material: mat, radius: Number.isFinite(r) ? r : null });
        }
        if (items.length === 0) continue;
        let prevSurf: number | null = null;
        for (const item of items) {
            let outerSurf: number | null = null;
            if (item.radius !== null && item.radius > 0) {
                outerSurf = nextSynthSurface++;
                surfaces.set(outerSurf, {
                    id: outerSurf, mnemonic: 'cyl',
                    shape: cylinderAlong('z', 0, 0, item.radius), tr: null, boundary: 'none',
                });
            }
            const tokens: string[] = [];
            if (outerSurf !== null) tokens.push(`-${outerSurf}`);
            if (prevSurf !== null) tokens.push(`${prevSurf}`);
            if (tokens.length === 0) {
                // Single-material pin: everywhere.
                const infId = nextSynthSurface++;
                surfaces.set(infId, {
                    id: infId, mnemonic: 'inf',
                    shape: { kind: 'quadric', a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0, h: 0, j: 0, k: -1 },
                    tr: null, boundary: 'none',
                });
                tokens.push(`-${infId}`);
            }
            const { region, order } = parseRegionExpression(tokens);
            cells.set(nextCell, {
                id: nextCell++,
                material: materialId(item.material),
                density: null,
                region,
                universe: uid,
                fill: null,
                lat: 0,
                trcl: null,
                surfaceOrder: order,
                likeButOf: null,
            });
            if (outerSurf !== null) prevSurf = outerSurf;
        }
    }

    // Pass 4: lattices → synthesized lattice cells with window surfaces.
    for (const card of cards) {
        if (card.kind !== 'lat') continue;
        const t = card.tokens;
        // lat <u> <type> <x0> <y0> <nx> <ny> <pitch> <entries…>
        const uName = t[1];
        const type = parseInt(t[2] ?? '', 10);
        if (!uName || !Number.isFinite(type)) continue;
        if (type !== 1 && type !== 2 && type !== 3) {
            warnings.push(`lat ${uName}: lattice type ${type} is not expanded by the engine (types 1/2/3 only).`);
            continue;
        }
        const x0 = Number(t[3]);
        const y0 = Number(t[4]);
        const nx = parseInt(t[5] ?? '', 10);
        const ny = parseInt(t[6] ?? '', 10);
        const pitch = Number(t[7]);
        const entries = t.slice(8);
        if (![x0, y0, pitch].every(Number.isFinite) || !(nx > 0) || !(ny > 0)) continue;
        if (nx * ny > 5_000_000) {
            warnings.push(`lat ${uName}: ${nx}×${ny} is too large to expand; skipped.`);
            continue;
        }

        const def: LatDef = { uid: universeId(uName), type, x0, y0, nx, ny, pitch, entries };
        const synth = synthesizeLattice(def, {
            universeId, surfaces, warnings,
            nextSurfaceId: () => nextSynthSurface++,
            nextCellId: () => nextCell++,
        });
        if (synth) cells.set(synth.id, synth);
    }

    // Universe index.
    const universes = new Map<number, number[]>();
    for (const cell of cells.values()) {
        if (!universes.has(cell.universe)) universes.set(cell.universe, []);
        universes.get(cell.universe)!.push(cell.id);
    }
    if (!universes.has(0) || universes.get(0)!.length === 0) {
        warnings.push('No cells in universe 0 — Serpent decks need at least one root-universe cell (and an outside cell).');
    }

    return {
        title: 'serpent deck',
        surfaces,
        cells,
        universes,
        transforms,
        generatedSurfaces: new Map(),
        warnings,
    };
}

function buildSerpentShape(type: string, p: number[], name: string, warnings: string[]): Shape | null {
    const need = (n: number): boolean => {
        if (p.length >= n) return true;
        warnings.push(`Surface ${name} (${type}): expected ${n} parameters, found ${p.length}; skipped.`);
        return false;
    };
    switch (type) {
        case 'px': return need(1) ? { kind: 'plane', n: [1, 0, 0], d: p[0] } : null;
        case 'py': return need(1) ? { kind: 'plane', n: [0, 1, 0], d: p[0] } : null;
        case 'pz': return need(1) ? { kind: 'plane', n: [0, 0, 1], d: p[0] } : null;
        case 'plane':
            // A B C D with Ax+By+Cz−D = 0 (Serpent writes Ax+By+Cz=D).
            return need(4) ? plane([p[0], p[1], p[2]], p[3]) : null;
        case 'sph': return need(4) ? sphere([p[0], p[1], p[2]], p[3]) : null;
        case 'cyl':
        case 'cylz': {
            if (!need(3)) return null;
            const lateral = cylinderAlong('z', p[0], p[1], p[2]);
            if (p.length >= 5) {
                // Optional axial truncation z1 z2 → a capped body.
                const mid: Vec3 = [p[0], p[1], (p[3] + p[4]) / 2];
                return {
                    kind: 'body',
                    facets: [lateral, plane([0, 0, 1], Math.max(p[3], p[4]), mid), plane([0, 0, 1], Math.min(p[3], p[4]), mid)],
                };
            }
            return lateral;
        }
        case 'cylx': {
            if (!need(3)) return null;
            const lateral = cylinderAlong('x', p[0], p[1], p[2]);
            if (p.length >= 5) {
                const mid: Vec3 = [(p[3] + p[4]) / 2, p[0], p[1]];
                return { kind: 'body', facets: [lateral, plane([1, 0, 0], Math.max(p[3], p[4]), mid), plane([1, 0, 0], Math.min(p[3], p[4]), mid)] };
            }
            return lateral;
        }
        case 'cyly': {
            if (!need(3)) return null;
            const lateral = cylinderAlong('y', p[0], p[1], p[2]);
            if (p.length >= 5) {
                const mid: Vec3 = [p[0], (p[3] + p[4]) / 2, p[1]];
                return { kind: 'body', facets: [lateral, plane([0, 1, 0], Math.max(p[3], p[4]), mid), plane([0, 1, 0], Math.min(p[3], p[4]), mid)] };
            }
            return lateral;
        }
        case 'sqc': {
            if (!need(3)) return null;
            const [x0, y0, d] = p;
            const c: Vec3 = [x0, y0, 0];
            if (p.length >= 4 && p[3] > 0) {
                warnings.push(`Surface ${name} (sqc): rounded corners are drawn square by the engine.`);
            }
            return {
                kind: 'body',
                facets: [
                    plane([1, 0, 0], x0 + d, c), plane([1, 0, 0], x0 - d, c),
                    plane([0, 1, 0], y0 + d, c), plane([0, 1, 0], y0 - d, c),
                ],
            };
        }
        case 'cube': {
            if (!need(4)) return null;
            const [x0, y0, z0, d] = p;
            const c: Vec3 = [x0, y0, z0];
            return {
                kind: 'body',
                facets: [
                    plane([1, 0, 0], x0 + d, c), plane([1, 0, 0], x0 - d, c),
                    plane([0, 1, 0], y0 + d, c), plane([0, 1, 0], y0 - d, c),
                    plane([0, 0, 1], z0 + d, c), plane([0, 0, 1], z0 - d, c),
                ],
            };
        }
        case 'cuboid': {
            if (!need(6)) return null;
            const [x1, x2, y1, y2, z1, z2] = p;
            const c: Vec3 = [(x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2];
            return {
                kind: 'body',
                facets: [
                    plane([1, 0, 0], Math.max(x1, x2), c), plane([1, 0, 0], Math.min(x1, x2), c),
                    plane([0, 1, 0], Math.max(y1, y2), c), plane([0, 1, 0], Math.min(y1, y2), c),
                    plane([0, 0, 1], Math.max(z1, z2), c), plane([0, 0, 1], Math.min(z1, z2), c),
                ],
            };
        }
        case 'hexxc': return need(3) ? hexPrism(p[0], p[1], p[2], 'x') : null;
        case 'hexyc': return need(3) ? hexPrism(p[0], p[1], p[2], 'y') : null;
        case 'cone': {
            // cone x0 y0 z0 r h: base circle at z0, apex at z0+h.
            if (!need(5)) return null;
            const [x0, y0, z0, r, h] = p;
            if (Math.abs(h) < 1e-12 || r <= 0) {
                warnings.push(`Surface ${name} (cone): degenerate radius/height; skipped.`);
                return null;
            }
            const apex: Vec3 = [x0, y0, z0 + h];
            const t2 = (r / h) * (r / h);
            const sheet = h > 0 ? -1 : 1; // solid extends from apex toward the base plane
            const mid: Vec3 = [x0, y0, z0 + h / 2];
            // Base cap at z0, oriented so the solid interior is negative.
            return {
                kind: 'body',
                facets: [
                    { kind: 'cone', apex, axis: [0, 0, 1], t2, sheet },
                    plane([0, 0, 1], z0, mid),
                ],
            };
        }
        case 'torx': case 'tory': case 'torz': {
            if (!need(6)) return null;
            const axis = type[3] as 'x' | 'y' | 'z';
            return { kind: 'torus', center: [p[0], p[1], p[2]], axis, a: p[3], b: p[4], c: p[5] };
        }
        case 'inf':
            return { kind: 'quadric', a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0, h: 0, j: 0, k: -1 };
        default:
            warnings.push(`Surface ${name}: Serpent type '${type}' is not supported by the engine; skipped.`);
            return null;
    }
}

// ---------------------------------------------------------------------------
// Lattice synthesis
// ---------------------------------------------------------------------------

interface SynthCtx {
    universeId: (name: string) => number;
    surfaces: Map<number, McnpSurface>;
    warnings: string[];
    nextSurfaceId: () => number;
    nextCellId: () => number;
}

/**
 * Build a shared-model lattice cell for a Serpent `lat` card. The window
 * surfaces are synthesized so the shared lattice-basis math (first listed
 * plane pair = first index direction) reproduces Serpent's placement:
 * entries are listed row by row north→south, so the grid is flipped into a
 * j-increases-north fill array.
 */
function synthesizeLattice(def: LatDef, ctx: SynthCtx): McnpCell | null {
    const { nx, ny, pitch } = def;
    const surfaceOrder: number[] = [];
    const regionTokens: string[] = [];

    const addPlane = (n: Vec3, d: number, sense: 1 | -1): void => {
        const id = ctx.nextSurfaceId();
        ctx.surfaces.set(id, {
            id,
            mnemonic: 'p',
            shape: { kind: 'plane', n, d },
            tr: null,
            boundary: 'none',
        });
        surfaceOrder.push(id);
        regionTokens.push(`${sense === -1 ? '-' : ''}${id}`);
    };

    let element0Center: Vec3 = [def.x0, def.y0, 0];
    if (def.type === 1) {
        // Square: element (0,0) is the south-west element; its center is at
        // (x0 − (nx−1)p/2, y0 − (ny−1)p/2).
        const cx = def.x0 - ((nx - 1) * pitch) / 2;
        const cy = def.y0 - ((ny - 1) * pitch) / 2;
        element0Center = [cx, cy, 0];
        // First pair = +x direction (first listed = the +x plane).
        addPlane([1, 0, 0], cx + pitch / 2, -1);
        addPlane([1, 0, 0], cx - pitch / 2, 1);
        addPlane([0, 1, 0], cy + pitch / 2, -1);
        addPlane([0, 1, 0], cy - pitch / 2, 1);
    } else {
        // Hex (X-type 2 / Y-type 3): the (0,0) element sits at the array
        // center; the first two facet pairs define the index basis and the
        // third only closes the window (latticeBasis drops linearly
        // dependent pairs, so listing it last is safe).
        const start = def.type === 2 ? 0 : 90;
        for (const angDeg of [start, start + 60, start + 120]) {
            const a = (angDeg * Math.PI) / 180;
            const n: Vec3 = [Math.cos(a), Math.sin(a), 0];
            const c = n[0] * def.x0 + n[1] * def.y0;
            addPlane(n, c + pitch / 2, -1);
            addPlane([-n[0], -n[1], 0], -(c - pitch / 2), 1);
        }
    }

    // Fill grid: Serpent lists rows north→south; the shared model's j runs
    // south→north, so flip rows. Hex maps use the same row-major layout.
    const entries: { universe: number; tr: Transform | null }[] = [];
    const grid = def.entries;
    if (grid.length < nx * ny) {
        ctx.warnings.push(`lat universe: fill map has ${grid.length} entries, expected ${nx * ny}; missing entries read as empty.`);
    }
    for (let j = 0; j < ny; j++) {
        const row = ny - 1 - j; // flip north→south listing into j-up
        for (let i = 0; i < nx; i++) {
            const tok = grid[row * nx + i];
            entries.push({ universe: tok !== undefined ? ctx.universeId(tok) : 0, tr: null });
        }
    }

    let i1: number;
    let j1: number;
    if (def.type === 1) {
        i1 = 0;
        j1 = 0;
    } else {
        // Hex arrays index from the center element.
        i1 = -Math.floor((nx - 1) / 2);
        j1 = -Math.floor((ny - 1) / 2);
    }

    const { region, order } = parseRegionExpression(regionTokens);
    void order;
    // Serpent fills each element with an origin-centered universe translated
    // to that element's center; the constant part (element (0,0)'s center)
    // rides on the whole-array fill transform.
    const fillTr: Transform | null =
        Math.abs(element0Center[0]) > 1e-12 || Math.abs(element0Center[1]) > 1e-12
            ? { o: element0Center, m: null, origin: 1 }
            : null;
    return {
        id: ctx.nextCellId(),
        material: 0,
        density: null,
        region,
        universe: def.uid,
        fill: {
            universe: null,
            grid: {
                i1, i2: i1 + nx - 1,
                j1, j2: j1 + ny - 1,
                k1: 0, k2: 0,
                entries,
            },
            tr: fillTr,
        },
        lat: def.type === 1 ? 1 : 2,
        trcl: null,
        surfaceOrder,
        likeButOf: null,
    };
}
