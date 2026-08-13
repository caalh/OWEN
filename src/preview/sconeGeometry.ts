// SCONE → shared exact-geometry model (geometry-preview plan, Stage 6).
//
// SCONE's dictionary input maps cleanly onto the shared model: surfaces carry
// explicit numeric ids, simpleCells are intersections of signed surface
// halfspaces (same sense convention: negative = inside), pinUniverses expand
// to concentric annular cells on synthesized zCylinders, latUniverses become
// lattice cells with synthesized window planes (map entries are universe ids,
// listed row-major north→south), and the rootUniverse's border surface plus
// fill become universe 0. findCell / sliceModel / buildCsgScene then work
// unchanged.
//
// Coverage: sphere, x/y/zCylinder, zTruncCylinder, x/y/zPlane, plane, box,
// x/y/zSquareCylinder, pinUniverse, cellUniverse, latUniverse (square),
// rootUniverse. Anything else warns and is skipped — never silently dropped.

import {
    McnpCell,
    McnpGeometryModel,
    McnpSurface,
    parseRegionExpression,
    Shape,
    Transform,
    Vec3,
} from './mcnpGeometry';

function planeShape(n: Vec3, d: number, insidePoint?: Vec3): Shape {
    const len = Math.hypot(n[0], n[1], n[2]);
    if (len > 0) { n = [n[0] / len, n[1] / len, n[2] / len]; d /= len; }
    if (insidePoint && n[0] * insidePoint[0] + n[1] * insidePoint[1] + n[2] * insidePoint[2] - d > 0) {
        n = [-n[0], -n[1], -n[2]];
        d = -d;
    }
    return { kind: 'plane', n, d };
}

function sphereShape(c: Vec3, r: number): Shape {
    return {
        kind: 'quadric', a: 1, b: 1, c: 1, d: 0, e: 0, f: 0,
        g: -2 * c[0], h: -2 * c[1], j: -2 * c[2],
        k: c[0] * c[0] + c[1] * c[1] + c[2] * c[2] - r * r,
    };
}

function cylShape(axis: 'x' | 'y' | 'z', u0: number, v0: number, r: number): Shape {
    const q = { kind: 'quadric' as const, a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0, h: 0, j: 0, k: -r * r + u0 * u0 + v0 * v0 };
    if (axis === 'x') { q.b = 1; q.c = 1; q.h = -2 * u0; q.j = -2 * v0; }
    else if (axis === 'y') { q.a = 1; q.c = 1; q.g = -2 * u0; q.j = -2 * v0; }
    else { q.a = 1; q.b = 1; q.g = -2 * u0; q.h = -2 * v0; }
    return q;
}

// ---------------------------------------------------------------------------
// Dictionary scanning
// ---------------------------------------------------------------------------

interface Block { name: string; inner: string }

/** Strip ! and // comments (SCONE allows both). */
function stripComments(text: string): string {
    return text
        .split(/\r?\n/)
        .map((l) => l.replace(/\/\/.*$/, '').replace(/!.*$/, ''))
        .join('\n');
}

/** Extract the body of the first `<name> { … }` section (brace-matched). */
function sectionBody(text: string, name: string): string | null {
    const re = new RegExp(`\\b${name}\\s*\\{`, 'g');
    const m = re.exec(text);
    if (!m) return null;
    let depth = 1;
    let i = re.lastIndex;
    const start = i;
    while (i < text.length && depth > 0) {
        const ch = text[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        i++;
    }
    return depth === 0 ? text.slice(start, i - 1) : null;
}

/** Split a section body into top-level `name { inner }` blocks. */
function topBlocks(body: string): Block[] {
    const out: Block[] = [];
    const re = /([A-Za-z_][\w-]*)\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
        let depth = 1;
        let i = re.lastIndex;
        const start = i;
        while (i < body.length && depth > 0) {
            const ch = body[i];
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
            i++;
        }
        if (depth !== 0) break;
        out.push({ name: m[1], inner: body.slice(start, i - 1) });
        re.lastIndex = i;
    }
    return out;
}

function field(inner: string, key: string): string | null {
    const m = inner.match(new RegExp(`\\b${key}\\s+([^;{}]+);`));
    return m ? m[1].trim() : null;
}

function parenList(inner: string, key: string): string[] {
    const m = inner.match(new RegExp(`\\b${key}\\s*\\(([^)]*)\\)`));
    return m ? m[1].trim().split(/\s+/).filter(Boolean) : [];
}

function numField(inner: string, key: string): number | null {
    const v = field(inner, key);
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function parseSconeGeometry(text: string): McnpGeometryModel {
    const warnings: string[] = [];
    const clean = stripComments(text);
    const surfaces = new Map<number, McnpSurface>();
    const cells = new Map<number, McnpCell>();

    const materialIds = new Map<string, number>();
    let nextMaterial = 1;
    const materialId = (name: string): number => {
        if (!name || name.toLowerCase() === 'void' || name.toLowerCase() === 'outside') return 0;
        let id = materialIds.get(name);
        if (id === undefined) { id = nextMaterial++; materialIds.set(name, id); }
        return id;
    };

    let nextSynthSurface = 2_000_000;
    let nextSynthCell = 1_000_000;

    // Lazily synthesized "everywhere" surface (f ≡ −1): pin universes and a
    // borderless root need an explicit all-space region.
    let infSurfaceId: number | null = null;
    const infSurface = (): number => {
        if (infSurfaceId === null) {
            infSurfaceId = nextSynthSurface++;
            surfaces.set(infSurfaceId, {
                id: infSurfaceId,
                mnemonic: 'inf',
                shape: { kind: 'quadric', a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0, h: 0, j: 0, k: -1 },
                tr: null,
                boundary: 'none',
            });
        }
        return infSurfaceId;
    };

    const geomBody = sectionBody(clean, 'geometry') ?? clean;
    const surfBody = sectionBody(geomBody, 'surfaces') ?? sectionBody(clean, 'surfaces');
    const cellBody = sectionBody(geomBody, 'cells') ?? sectionBody(clean, 'cells');
    const uniBody = sectionBody(geomBody, 'universes') ?? sectionBody(clean, 'universes');

    // --- Surfaces -----------------------------------------------------------
    if (surfBody) {
        for (const block of topBlocks(surfBody)) {
            const id = numField(block.inner, 'id');
            const type = (field(block.inner, 'type') ?? '').toLowerCase();
            if (id === null || !type) continue;
            const origin = parenList(block.inner, 'origin').map(Number);
            const halfwidth = parenList(block.inner, 'halfwidth').map(Number);
            const shape = buildSconeShape(type, block, origin, halfwidth, warnings);
            if (!shape) continue;
            surfaces.set(id, { id, mnemonic: type, shape, tr: null, boundary: 'none' });
        }
    }

    // --- Cells ---------------------------------------------------------------
    // cellToUniverse: filltype uni cells reference a universe by id.
    interface SconeCell { id: number; surfs: string[]; material: number; fillUniverse: number | null }
    const sconeCells = new Map<number, SconeCell>();
    if (cellBody) {
        for (const block of topBlocks(cellBody)) {
            const id = numField(block.inner, 'id');
            if (id === null) continue;
            const surfs = parenList(block.inner, 'surfaces');
            const ft = (field(block.inner, 'filltype') ?? 'mat').toLowerCase();
            let material = 0;
            let fillUniverse: number | null = null;
            if (ft === 'mat') {
                material = materialId(field(block.inner, 'material') ?? '');
            } else if (ft === 'uni') {
                const u = numField(block.inner, 'universe');
                if (u !== null) fillUniverse = u;
            } else if (ft === 'outside') {
                material = 0;
            } else {
                warnings.push(`Cell ${block.name}: filltype '${ft}' is not supported; treated as void.`);
            }
            sconeCells.set(id, { id, surfs, material, fillUniverse });
        }
    }

    /** Instantiate one SCONE cell into a model cell within `universe`. */
    const placeCell = (sc: SconeCell, universe: number): void => {
        const { region, order } = parseRegionExpression(sc.surfs);
        cells.set(nextSynthCell, {
            id: nextSynthCell,
            material: sc.material,
            density: null,
            region,
            universe,
            fill: sc.fillUniverse !== null ? { universe: sc.fillUniverse, grid: null, tr: null } : null,
            lat: 0,
            trcl: null,
            surfaceOrder: order,
            likeButOf: null,
        });
        nextSynthCell++;
    };

    // --- Universes ------------------------------------------------------------
    let rootBorder: number | null = null;
    let rootFill: number | null = null;
    if (uniBody) {
        for (const block of topBlocks(uniBody)) {
            const id = numField(block.inner, 'id');
            const type = (field(block.inner, 'type') ?? '').toLowerCase();
            if (id === null || !type) continue;

            if (type === 'rootuniverse') {
                rootBorder = numField(block.inner, 'border');
                const fillRaw = field(block.inner, 'fill') ?? '';
                const um = fillRaw.match(/u<\s*(\d+)\s*>/);
                if (um) rootFill = parseInt(um[1], 10);
                else if (fillRaw) {
                    // Root filled with a bare material: a single-medium world.
                    const mid = materialId(fillRaw.trim());
                    const tokens = rootBorder !== null ? [`-${rootBorder}`] : [`-${infSurface()}`];
                    const parsed = parseRegionExpression(tokens);
                    cells.set(nextSynthCell, {
                        id: nextSynthCell++,
                        material: mid,
                        density: null,
                        region: parsed.region,
                        universe: 0,
                        fill: null,
                        lat: 0,
                        trcl: null,
                        surfaceOrder: parsed.order,
                        likeButOf: null,
                    });
                }
                continue;
            }

            if (type === 'celluniverse') {
                const cellIds = parenList(block.inner, 'cells').map(Number);
                for (const cid of cellIds) {
                    const sc = sconeCells.get(cid);
                    if (sc) placeCell(sc, id);
                    else warnings.push(`cellUniverse ${block.name}: cell ${cid} is not defined.`);
                }
                continue;
            }

            if (type === 'pinuniverse') {
                const radii = parenList(block.inner, 'radii').map(Number);
                const fills = parenList(block.inner, 'fills');
                if (radii.length === 0 || radii.length !== fills.length) {
                    warnings.push(`pinUniverse ${block.name}: radii/fills length mismatch; skipped.`);
                    continue;
                }
                // radii end with 0.0 = the infinite outer region.
                let prevSurf: number | null = null;
                for (let k = 0; k < radii.length; k++) {
                    const r = radii[k];
                    let outerSurf: number | null = null;
                    if (r > 0) {
                        outerSurf = nextSynthSurface++;
                        surfaces.set(outerSurf, {
                            id: outerSurf, mnemonic: 'zcylinder',
                            shape: cylShape('z', 0, 0, r), tr: null, boundary: 'none',
                        });
                    }
                    const tokens: string[] = [];
                    if (outerSurf !== null) tokens.push(`-${outerSurf}`);
                    if (prevSurf !== null) tokens.push(`${prevSurf}`);
                    if (tokens.length === 0) tokens.push(`-${infSurface()}`); // single-region pin
                    const { region, order } = parseRegionExpression(tokens);
                    const fillRaw = fills[k] ?? '';
                    const um = fillRaw.match(/u<\s*(\d+)\s*>/);
                    cells.set(nextSynthCell, {
                        id: nextSynthCell++,
                        material: um ? 0 : materialId(fillRaw),
                        density: null,
                        region,
                        universe: id,
                        fill: um ? { universe: parseInt(um[1], 10), grid: null, tr: null } : null,
                        lat: 0,
                        trcl: null,
                        surfaceOrder: order,
                        likeButOf: null,
                    });
                    if (outerSurf !== null) prevSurf = outerSurf;
                }
                continue;
            }

            if (type === 'latuniverse') {
                const pitch = parenList(block.inner, 'pitch').map(Number);
                const shapeVals = parenList(block.inner, 'shape').map(Number);
                const mapVals = parenList(block.inner, 'map').map((v) => parseInt(v, 10));
                const origin = parenList(block.inner, 'origin').map(Number);
                const padMat = field(block.inner, 'padMat');
                const nx = Math.round(shapeVals[0] ?? 0);
                const ny = Math.round(shapeVals[1] ?? 0);
                const px = pitch[0] ?? 0;
                const py = pitch[1] ?? px;
                if (!(nx > 0 && ny > 0) || !(px > 0) || nx * ny > 5_000_000) {
                    warnings.push(`latUniverse ${block.name}: unusable shape/pitch; skipped.`);
                    continue;
                }
                const x0 = origin[0] ?? 0;
                const y0 = origin[1] ?? 0;
                // Window planes around the south-west element; first listed
                // pair = +x index direction (shared basis convention).
                const cx = x0 - ((nx - 1) * px) / 2;
                const cy = y0 - ((ny - 1) * py) / 2;
                const surfIds: number[] = [];
                const tokens: string[] = [];
                const addPlane = (n: Vec3, d: number, sense: 1 | -1): void => {
                    const sid = nextSynthSurface++;
                    surfaces.set(sid, { id: sid, mnemonic: 'p', shape: { kind: 'plane', n, d }, tr: null, boundary: 'none' });
                    surfIds.push(sid);
                    tokens.push(`${sense === -1 ? '-' : ''}${sid}`);
                };
                addPlane([1, 0, 0], cx + px / 2, -1);
                addPlane([1, 0, 0], cx - px / 2, 1);
                addPlane([0, 1, 0], cy + py / 2, -1);
                addPlane([0, 1, 0], cy - py / 2, 1);
                const entries: { universe: number; tr: Transform | null }[] = [];
                for (let j = 0; j < ny; j++) {
                    const row = ny - 1 - j; // map rows list north→south
                    for (let i = 0; i < nx; i++) {
                        const v = mapVals[row * nx + i];
                        entries.push({ universe: Number.isFinite(v) ? v : 0, tr: null });
                    }
                }
                const { region, order } = parseRegionExpression(tokens);
                void order;
                // SCONE translates each origin-centered universe to its
                // element center; the constant offset (element (0,0)'s
                // center) rides on the whole-array fill transform.
                const fillTr: Transform | null =
                    Math.abs(cx) > 1e-12 || Math.abs(cy) > 1e-12
                        ? { o: [cx, cy, 0], m: null, origin: 1 }
                        : null;
                cells.set(nextSynthCell, {
                    id: nextSynthCell++,
                    material: padMat ? materialId(padMat) : 0,
                    density: null,
                    region,
                    universe: id,
                    fill: {
                        universe: null,
                        grid: { i1: 0, i2: nx - 1, j1: 0, j2: ny - 1, k1: 0, k2: 0, entries },
                        tr: fillTr,
                    },
                    lat: 1,
                    trcl: null,
                    surfaceOrder: surfIds,
                    likeButOf: null,
                });
                continue;
            }

            warnings.push(`Universe ${block.name}: type '${type}' is not supported by the engine; skipped.`);
        }
    }

    // --- Root → universe 0 ----------------------------------------------------
    if (rootFill !== null) {
        const borderTokens = rootBorder !== null ? [`-${rootBorder}`] : [`-${infSurface()}`];
        const { region, order } = parseRegionExpression(borderTokens);
        cells.set(nextSynthCell, {
            id: nextSynthCell++,
            material: 0,
            density: null,
            region,
            universe: 0,
            fill: { universe: rootFill, grid: null, tr: null },
            lat: 0,
            trcl: null,
            surfaceOrder: order,
            likeButOf: null,
        });
        if (rootBorder !== null) {
            const { region: outRegion } = parseRegionExpression([`${rootBorder}`]);
            cells.set(nextSynthCell, {
                id: nextSynthCell++,
                material: 0,
                density: null,
                region: outRegion,
                universe: 0,
                fill: null,
                lat: 0,
                trcl: null,
                surfaceOrder: [rootBorder],
                likeButOf: null,
            });
        }
    } else if (cells.size === 0) {
        warnings.push('No rootUniverse (or usable universes) found — nothing to classify.');
    }

    const universes = new Map<number, number[]>();
    for (const cell of cells.values()) {
        if (!universes.has(cell.universe)) universes.set(cell.universe, []);
        universes.get(cell.universe)!.push(cell.id);
    }

    return {
        title: 'scone deck',
        surfaces,
        cells,
        universes,
        transforms: new Map(),
        generatedSurfaces: new Map(),
        warnings,
    };
}

function buildSconeShape(
    type: string,
    block: Block,
    origin: number[],
    halfwidth: number[],
    warnings: string[],
): Shape | null {
    const o: Vec3 = [origin[0] ?? 0, origin[1] ?? 0, origin[2] ?? 0];
    switch (type) {
        case 'sphere': {
            const r = numField(block.inner, 'radius');
            if (r === null || r <= 0) { warnings.push(`Surface ${block.name} (sphere): bad radius; skipped.`); return null; }
            return sphereShape(o, r);
        }
        case 'zcylinder': case 'ycylinder': case 'xcylinder': {
            const r = numField(block.inner, 'radius');
            if (r === null || r <= 0) { warnings.push(`Surface ${block.name} (${type}): bad radius; skipped.`); return null; }
            if (type === 'zcylinder') return cylShape('z', o[0], o[1], r);
            if (type === 'ycylinder') return cylShape('y', o[0], o[2], r);
            return cylShape('x', o[1], o[2], r);
        }
        case 'ztrunccylinder': {
            const r = numField(block.inner, 'radius');
            const hw = numField(block.inner, 'halfwidth') ?? halfwidth[2] ?? halfwidth[0] ?? null;
            if (r === null || r <= 0 || hw === null || hw <= 0) {
                warnings.push(`Surface ${block.name} (zTruncCylinder): bad radius/halfwidth; skipped.`);
                return null;
            }
            return {
                kind: 'body',
                facets: [
                    cylShape('z', o[0], o[1], r),
                    planeShape([0, 0, 1], o[2] + hw, o),
                    planeShape([0, 0, 1], o[2] - hw, o),
                ],
            };
        }
        case 'xplane': {
            const v = numField(block.inner, 'x0');
            return v !== null ? { kind: 'plane', n: [1, 0, 0], d: v } : null;
        }
        case 'yplane': {
            const v = numField(block.inner, 'y0');
            return v !== null ? { kind: 'plane', n: [0, 1, 0], d: v } : null;
        }
        case 'zplane': {
            const v = numField(block.inner, 'z0');
            return v !== null ? { kind: 'plane', n: [0, 0, 1], d: v } : null;
        }
        case 'plane': {
            const c = parenList(block.inner, 'coeffs').map(Number);
            if (c.length < 4) { warnings.push(`Surface ${block.name} (plane): needs coeffs (a b c d); skipped.`); return null; }
            return planeShape([c[0], c[1], c[2]], c[3]);
        }
        case 'box': case 'zsquarecylinder': case 'xsquarecylinder': case 'ysquarecylinder': {
            const hw = halfwidth;
            if (hw.length < 3) { warnings.push(`Surface ${block.name} (${type}): needs halfwidth (hx hy hz); skipped.`); return null; }
            const facets: Shape[] = [];
            const axes: ('x' | 'y' | 'z')[] = ['x', 'y', 'z'];
            for (let k = 0; k < 3; k++) {
                const axis = axes[k];
                if (hw[k] <= 0) continue; // squareCylinder: 0 halfwidth = infinite axis
                const n: Vec3 = axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1];
                facets.push(planeShape(n, o[k] + hw[k], o));
                facets.push(planeShape(n, o[k] - hw[k], o));
            }
            if (facets.length === 0) { warnings.push(`Surface ${block.name} (${type}): degenerate halfwidths; skipped.`); return null; }
            return { kind: 'body', facets };
        }
        default:
            warnings.push(`Surface ${block.name}: SCONE type '${type}' is not supported by the engine; skipped.`);
            return null;
    }
}
