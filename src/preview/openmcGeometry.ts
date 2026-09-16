// OpenMC geometry.xml / model.xml → shared exact-geometry model.
//
// OpenMC's native plotter is the ground truth for Python decks, but the
// in-editor 3D/2D viewers need the same McnpGeometryModel the MCNP CSG path
// already draws. The XML OpenMC writes is that model: surfaces, cells, and a
// region expression. Python is not parsed here — the deck is executed and the
// XML is what we read, so dataclass fields and function arguments survive.
//
// Region operators are rewritten onto the MCNP parser: `|` → `:`, `&` →
// juxtaposition, `~(-s)` → `#(-s)`. Sense matches MCNP (`-s` = inside).

import {
    emptyGeometryNames,
    FillEntry,
    McnpCell,
    McnpGeometryModel,
    McnpSurface,
    parseRegionExpression,
    Shape,
    tokenizeRegion,
    Vec3,
} from './mcnpGeometry';
import { Component, ComponentId } from './types';

function plane(n: Vec3, d: number): Shape {
    const len = Math.hypot(n[0], n[1], n[2]);
    if (len > 0) { n = [n[0] / len, n[1] / len, n[2] / len]; d /= len; }
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

function coneAlong(axis: 'x' | 'y' | 'z', apex: Vec3, t2: number): Shape {
    const dir: Vec3 = axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1];
    return { kind: 'cone', apex, axis: dir, t2, sheet: 0 };
}

function nums(s: string): number[] {
    return (s.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
}

function attr(tag: string, name: string): string | undefined {
    const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
    return m ? (m[2] ?? m[3]) : undefined;
}

function scanTags(xml: string, name: string): string[] {
    const out: string[] = [];
    const re = new RegExp(`<${name}\\b([^>]*)/?>`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) out.push(m[0]);
    return out;
}

function innerXml(xml: string, name: string): string {
    const m = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*)</${name}\\s*>`, 'i'));
    return m ? m[1] : xml;
}

/** OpenMC `|` `&` `~` → the MCNP region tokens parseRegionExpression knows. */
export function rewriteOpenmcRegion(region: string): string {
    let s = region.trim();
    // `~-1` / `~+2` / `~3` is complement of a half-space: flip the sign.
    s = s.replace(/~\s*([+-]?)(\d+)/g, (_w, sign: string, id: string) => {
        if (sign === '-') return `+${id}`;
        return `-${id}`;
    });
    s = s.replace(/~/g, ' # ');
    s = s.replace(/\|/g, ' : ');
    s = s.replace(/&/g, ' ');
    return s;
}

function shapeFromOpenmc(type: string, coeffs: number[], warnings: string[], id: number): Shape | null {
    const t = type.toLowerCase();
    switch (t) {
        case 'x-plane': return coeffs.length >= 1 ? plane([1, 0, 0], coeffs[0]) : null;
        case 'y-plane': return coeffs.length >= 1 ? plane([0, 1, 0], coeffs[0]) : null;
        case 'z-plane': return coeffs.length >= 1 ? plane([0, 0, 1], coeffs[0]) : null;
        case 'plane':
            return coeffs.length >= 4 ? plane([coeffs[0], coeffs[1], coeffs[2]], coeffs[3]) : null;
        case 'x-cylinder':
            return coeffs.length >= 3 ? cylinderAlong('x', coeffs[0], coeffs[1], coeffs[2]) : null;
        case 'y-cylinder':
            return coeffs.length >= 3 ? cylinderAlong('y', coeffs[0], coeffs[1], coeffs[2]) : null;
        case 'z-cylinder':
            return coeffs.length >= 3 ? cylinderAlong('z', coeffs[0], coeffs[1], coeffs[2]) : null;
        case 'sphere':
            if (coeffs.length === 1) return sphere([0, 0, 0], coeffs[0]);
            return coeffs.length >= 4 ? sphere([coeffs[0], coeffs[1], coeffs[2]], coeffs[3]) : null;
        case 'x-cone':
            return coeffs.length >= 4 ? coneAlong('x', [coeffs[0], coeffs[1], coeffs[2]], coeffs[3]) : null;
        case 'y-cone':
            return coeffs.length >= 4 ? coneAlong('y', [coeffs[0], coeffs[1], coeffs[2]], coeffs[3]) : null;
        case 'z-cone':
            return coeffs.length >= 4 ? coneAlong('z', [coeffs[0], coeffs[1], coeffs[2]], coeffs[3]) : null;
        case 'quadric':
            if (coeffs.length < 10) return null;
            return {
                kind: 'quadric',
                a: coeffs[0], b: coeffs[1], c: coeffs[2],
                d: coeffs[3], e: coeffs[4], f: coeffs[5],
                g: coeffs[6], h: coeffs[7], j: coeffs[8], k: coeffs[9],
            };
        case 'x-torus':
        case 'y-torus':
        case 'z-torus': {
            if (coeffs.length < 6) return null;
            const axis = t[0] as 'x' | 'y' | 'z';
            return { kind: 'torus', center: [coeffs[0], coeffs[1], coeffs[2]], axis, a: coeffs[3], b: coeffs[4], c: coeffs[5] };
        }
        default:
            warnings.push(`OpenMC surface ${id}: type "${type}" is not drawn yet.`);
            return null;
    }
}

export function classifyOpenmcMaterial(name: string): ComponentId {
    const n = name.toLowerCase();
    if (/\b(uo2|mox|fuel|dt_|dt\b|tritium)\b/.test(n)) return Component.Fuel;
    if (/\b(zircaloy|zirc|clad)\b/.test(n)) return Component.Clad;
    if (/\b(he|helium|gap)\b/.test(n)) return Component.Gap;
    if (/\b(water|h2o|moderator|flinak|flibe|salt|coolant)\b/.test(n)) return Component.Moderator;
    if (/\b(steel|ss304|rafm|vessel|iron)\b/.test(n)) return Component.Structure;
    if (/\b(b4c|ag-in-cd|absorber|poison|cd_)\b/.test(n)) return Component.Absorber;
    return Component.Other;
}

export interface OpenmcMaterialInfo {
    name: string;
    component: ComponentId;
}

export function openmcMaterialLookup(xml: string): Map<number, OpenmcMaterialInfo> {
    const out = new Map<number, OpenmcMaterialInfo>();
    const blob = /<materials[\s>]/.test(xml) ? innerXml(xml, 'materials') : xml;
    for (const tag of scanTags(blob, 'material')) {
        const id = parseInt(attr(tag, 'id') ?? '', 10);
        if (!Number.isFinite(id)) continue;
        const name = attr(tag, 'name') ?? `m${id}`;
        out.set(id, { name, component: classifyOpenmcMaterial(name) });
    }
    return out;
}

/**
 * Parse an OpenMC `geometry.xml` or `model.xml` into the shared CSG model.
 * Returns an empty model (with warnings) rather than throwing.
 */
export function parseOpenmcGeometryXml(text: string): McnpGeometryModel {
    const warnings: string[] = [];
    const surfaces = new Map<number, McnpSurface>();
    const cells = new Map<number, McnpCell>();
    const universes = new Map<number, number[]>();

    const geom = /<geometry[\s>]/.test(text) ? innerXml(text, 'geometry') : text;
    const names = emptyGeometryNames();
    for (const [id, info] of openmcMaterialLookup(text)) {
        if (info.name !== `m${id}`) names.materials.set(id, info.name);
    }

    for (const tag of scanTags(geom, 'surface')) {
        const id = parseInt(attr(tag, 'id') ?? '', 10);
        const type = attr(tag, 'type') ?? '';
        const coeffs = nums(attr(tag, 'coeffs') ?? '');
        if (!Number.isFinite(id) || id <= 0) continue;
        const shape = shapeFromOpenmc(type, coeffs, warnings, id);
        if (!shape) continue;
        const bc = (attr(tag, 'boundary') ?? 'transmission').toLowerCase();
        const boundary: McnpSurface['boundary'] =
            bc === 'vacuum' ? 'vacuum' : bc === 'reflective' ? 'reflecting' : bc === 'white' ? 'white' : bc === 'periodic' ? 'periodic' : 'none';
        surfaces.set(id, {
            id, mnemonic: type, shape, tr: null, boundary,
        });
        const sname = attr(tag, 'name');
        if (sname) names.surfaces.set(id, sname);
    }

    for (const tag of scanTags(geom, 'cell')) {
        const id = parseInt(attr(tag, 'id') ?? '', 10);
        if (!Number.isFinite(id) || id <= 0) continue;
        const cname = attr(tag, 'name');
        if (cname) names.cells.set(id, cname);
        const universe = parseInt(attr(tag, 'universe') ?? '0', 10) || 0;
        const matRaw = (attr(tag, 'material') ?? 'void').trim();
        const fillRaw = attr(tag, 'fill');
        const regionRaw = attr(tag, 'region') ?? '';
        let material = 0;
        if (matRaw && matRaw.toLowerCase() !== 'void' && matRaw !== 'none') {
            const n = parseInt(matRaw, 10);
            material = Number.isFinite(n) ? n : 0;
        }
        const rewritten = rewriteOpenmcRegion(regionRaw);
        const parsed = rewritten ? parseRegionExpression(tokenizeRegion(rewritten)) : { region: null, order: [] as number[] };
        const fill = fillRaw && /^\d+$/.test(fillRaw)
            ? { universe: parseInt(fillRaw, 10), grid: null, tr: null }
            : null;
        const cell: McnpCell = {
            id,
            material,
            density: null,
            region: parsed.region,
            universe,
            fill,
            lat: 0,
            trcl: null,
            surfaceOrder: parsed.order,
            likeButOf: null,
        };
        cells.set(id, cell);
        const bucket = universes.get(universe) ?? [];
        bucket.push(id);
        universes.set(universe, bucket);
    }

    // <lattice> elements. An OpenMC lattice IS a universe: cells point at it
    // with fill="id". The exact-geometry model already evaluates MCNP lat=1
    // cells natively (latticeBasis from the cell's plane pairs), so each
    // lattice becomes one synthesized lattice cell living in universe <id>.
    // This used to be missing entirely — a full-core model.xml sliced as
    // nothing but its outermost water because every lattice fill vanished.
    let synthId = 0;
    for (const s of surfaces.keys()) synthId = Math.max(synthId, s);
    for (const c of cells.keys()) synthId = Math.max(synthId, c);
    synthId += 1000;

    const latBlocks = geom.match(/<lattice\b[^>]*>[\s\S]*?<\/lattice\s*>/gi) ?? [];
    for (const block of latBlocks) {
        const open = block.match(/<lattice\b[^>]*>/i)![0];
        const latId = parseInt(attr(open, 'id') ?? '', 10);
        if (!Number.isFinite(latId)) continue;
        const lname = attr(open, 'name');
        const pitch = nums(innerXml(block, 'pitch'));
        const dim = nums(innerXml(block, 'dimension')).map((v) => Math.round(v));
        const lower = nums(innerXml(block, 'lower_left'));
        const uniIds = nums(innerXml(block, 'universes')).map((v) => Math.round(v));
        const outer = nums(innerXml(block, 'outer'));
        if (pitch.length < 2 || dim.length < 2 || lower.length < 2) {
            warnings.push(`OpenMC lattice ${latId}: missing pitch/dimension/lower_left; skipped.`);
            continue;
        }
        const [nx, ny] = dim;
        const nz = dim.length >= 3 ? dim[2] : 1;
        if (!(nx > 0) || !(ny > 0) || !(nz > 0) || nx * ny * nz > 1_000_000) {
            warnings.push(`OpenMC lattice ${latId}: ${nx}\u00d7${ny}\u00d7${nz} is not expandable; skipped.`);
            continue;
        }
        if (uniIds.length < nx * ny * nz) {
            warnings.push(`OpenMC lattice ${latId}: ${uniIds.length} universe entries for a ${nx}\u00d7${ny}\u00d7${nz} grid; skipped.`);
            continue;
        }
        const outerUniverse = outer.length > 0 && Number.isFinite(outer[0]) ? Math.round(outer[0]) : undefined;
        // XML lists the TOP row first within each z-plane; FillGrid wants
        // j = 0 at the lowest y. Reverse rows plane by plane.
        const entries: FillEntry[] = new Array(nx * ny * nz);
        for (let k = 0; k < nz; k++) {
            for (let j = 0; j < ny; j++) {
                for (let i = 0; i < nx; i++) {
                    const src = uniIds[i + nx * ((ny - 1 - j) + ny * k)];
                    entries[i + nx * (j + ny * k)] = { universe: src, tr: null };
                }
            }
        }
        // Window planes for element (0,0,0): +x listed first, so +i runs
        // toward +x (the §5.5.5 convention latticeBasis expects).
        const [llx, lly] = lower;
        const llz = lower.length >= 3 ? lower[2] : 0;
        const px = pitch[0], py = pitch[1], pz = pitch.length >= 3 ? pitch[2] : 0;
        const mkPlane = (n: Vec3, d: number): number => {
            const id = ++synthId;
            surfaces.set(id, { id, mnemonic: 'p', shape: plane(n, d), tr: null, boundary: 'none' });
            return id;
        };
        const xHi = mkPlane([1, 0, 0], llx + px);
        const xLo = mkPlane([1, 0, 0], llx);
        const yHi = mkPlane([0, 1, 0], lly + py);
        const yLo = mkPlane([0, 1, 0], lly);
        const order = [xHi, xLo, yHi, yLo];
        let regionText = `-${xHi} ${xLo} -${yHi} ${yLo}`;
        const element0: Vec3 = [llx + px / 2, lly + py / 2, 0];
        if (nz > 1 && pz > 0) {
            const zHi = mkPlane([0, 0, 1], llz + pz);
            const zLo = mkPlane([0, 0, 1], llz);
            order.push(zHi, zLo);
            regionText += ` -${zHi} ${zLo}`;
            element0[2] = llz + pz / 2;
        }
        const parsed = parseRegionExpression(tokenizeRegion(regionText));
        const cellId = ++synthId;
        // OpenMC universes are origin-centered; the fill transform carries
        // the base element's center so each element draws its universe in
        // place (same pattern as the Serpent/SCONE synthesized lattices).
        const fillTr = Math.abs(element0[0]) > 1e-12 || Math.abs(element0[1]) > 1e-12 || Math.abs(element0[2]) > 1e-12
            ? { o: element0, m: null, origin: 1 as const }
            : null;
        cells.set(cellId, {
            id: cellId,
            material: 0,
            density: null,
            region: parsed.region,
            universe: latId,
            fill: {
                universe: null,
                grid: { i1: 0, i2: nx - 1, j1: 0, j2: ny - 1, k1: 0, k2: nz - 1, entries, outer: outerUniverse },
                tr: fillTr,
            },
            lat: 1,
            trcl: null,
            surfaceOrder: order,
            likeButOf: null,
        });
        names.cells.set(cellId, lname ? `lattice ${lname}` : `lattice ${latId}`);
        const bucket = universes.get(latId) ?? [];
        bucket.push(cellId);
        universes.set(latId, bucket);
    }

    if (cells.size === 0) {
        warnings.push('No OpenMC cells were found in this XML.');
    }
    return {
        title: 'openmc',
        surfaces,
        cells,
        universes,
        transforms: new Map(),
        generatedSurfaces: new Map(),
        warnings,
        names,
    };
}

export function looksLikeOpenmcXml(text: string): boolean {
    const head = text.trimStart();
    // Concatenated live exports often start with <materials>, not <geometry>.
    // Python decks can mention those tags in comments, so the first non-space
    // character has to be the start of a tag.
    if (!head.startsWith('<')) return false;
    return /<\?xml\b|<model\b|<geometry\b|<materials\b/i.test(head.slice(0, 2500));
}
