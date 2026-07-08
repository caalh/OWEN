// Traced OpenMC model IR + MCNP emitter (v0.3.8).
//
// Two front-ends build this IR from an OpenMC Python script:
//   1. openmcStatic.ts — a static TypeScript parser for flat, literal scripts
//      (including everything OWEN's own MCNP→OpenMC converter emits).
//   2. traceHarness.ts — a pure-Python stub `openmc` package that executes the
//      script and dumps this IR as JSON (handles loops/functions/comprehensions,
//      e.g. the native BEAVRS deck). No real OpenMC installation is required.
// One emitter (emitMcnpFromTrace) turns the IR into an MCNP deck.

import { ConversionResult, ConversionIssue, TODO_MARK } from './types';
import { nuclideToZaid, ELEMENT_TO_Z, SAB_TO_MT } from './zaid';
import { BOLTZMANN_MEV_PER_K } from './mcnpModel';

// ---------------------------------------------------------------------------
// IR types (kept JSON-serializable: the Python harness emits exactly this)
// ---------------------------------------------------------------------------

export type TRegion =
    | { k: 'h'; s: number; side: 1 | -1 }
    | { k: '&' | '|'; c: TRegion[] }
    | { k: '~'; c: TRegion };

export interface TSurface {
    id: number;
    /** MCNP mnemonic: px/py/pz/p/so/s/cx…/c\/z/kx…/k\/z/gq/tx/ty/tz. */
    type: string;
    coeffs: number[];
    boundary: string; // 'transmission' | 'vacuum' | 'reflective' | 'periodic' | 'white'
}

export interface TNuclide { name: string; frac: number; type: string }
export interface TElement { name: string; frac: number; type: string; enrichment: number | null }

export interface TMaterial {
    id: number;
    name: string;
    density: { units: string; value: number } | null;
    nuclides: TNuclide[];
    elements: TElement[];
    sab: string[];
}

export interface TCell {
    id: number;
    name: string;
    fill: { kind: 'material' | 'universe' | 'lattice' | 'void'; id: number };
    region: TRegion | null;
    temperature: number | null;
    translation: number[] | null;
    rotation: number[][] | null;
}

export interface TUniverse { id: number; name: string; cells: number[] }

export interface TLattice {
    id: number;
    kind: 'rect' | 'hex';
    name: string;
    /** rect: [x, y] or [x, y, z] */
    lowerLeft?: number[];
    pitch: number[];
    outer: number | null; // universe id
    /** rect: [z][y][x] universe ids, y rows top-first (OpenMC order). */
    universes?: number[][][];
    /** hex: rings outermost-first (OpenMC order). */
    rings?: number[][];
    center?: number[];
    orientation?: string;
}

export interface TSettings {
    batches?: number;
    inactive?: number;
    particles?: number;
    sourcePoints: number[][];
    sourceBox?: { lo: number[]; hi: number[] } | null;
}

export interface TTally {
    name: string;
    kind: 'mesh' | 'cell' | 'other';
    mesh?: { dimension: number[]; lowerLeft: number[]; upperRight: number[] } | null;
    cells?: number[];
    scores: string[];
}

export interface TracedModel {
    surfaces: TSurface[];
    materials: TMaterial[];
    cells: TCell[];
    universes: TUniverse[];
    lattices: TLattice[];
    /** Universe id passed to openmc.Geometry, or null when a cell list was used. */
    rootUniverse: number | null;
    /** Cell ids passed directly to openmc.Geometry([...]) when no root universe. */
    rootCells: number[];
    settings: TSettings;
    tallies: TTally[];
    warnings: string[];
}

// ---------------------------------------------------------------------------
// Region utilities
// ---------------------------------------------------------------------------

/** Push complements down to halfspaces (De Morgan) so MCNP output has no #(). */
export function normalizeRegion(node: TRegion, negate = false): TRegion {
    switch (node.k) {
        case 'h':
            return negate ? { k: 'h', s: node.s, side: node.side === 1 ? -1 : 1 } : node;
        case '~':
            return normalizeRegion(node.c, !negate);
        case '&':
        case '|': {
            const k = negate ? (node.k === '&' ? '|' : '&') : node.k;
            return { k, c: node.c.map((ch) => normalizeRegion(ch, negate)) };
        }
    }
}

export function regionToMcnpString(node: TRegion): string {
    const norm = normalizeRegion(node);
    const emit = (n: TRegion, parentOp: '&' | '|' | null): string => {
        switch (n.k) {
            case 'h':
                return n.side === -1 ? `-${n.s}` : `${n.s}`;
            case '&': {
                const inner = n.c.map((ch) => emit(ch, '&')).join(' ');
                return parentOp === '|' || parentOp === null ? inner : `(${inner})`;
            }
            case '|': {
                const inner = n.c.map((ch) => emit(ch, '|')).join(':');
                return parentOp === null ? inner : `(${inner})`;
            }
            case '~':
                // unreachable after normalize
                return `#(${emit(n.c, null)})`;
        }
    };
    return emit(norm, null);
}

export function tRegionSurfaces(node: TRegion | null, out = new Set<number>()): Set<number> {
    if (!node) return out;
    if (node.k === 'h') out.add(node.s);
    else if (node.k === '~') tRegionSurfaces(node.c, out);
    else for (const c of node.c) tRegionSurfaces(c, out);
    return out;
}

/** Count usage senses of a surface across all cell regions. */
function senseCensus(model: TracedModel): Map<number, { neg: number; pos: number }> {
    const census = new Map<number, { neg: number; pos: number }>();
    const visit = (n: TRegion) => {
        if (n.k === 'h') {
            const e = census.get(n.s) ?? { neg: 0, pos: 0 };
            if (n.side === -1) e.neg++; else e.pos++;
            census.set(n.s, e);
        } else if (n.k === '~') visit(n.c);
        else n.c.forEach(visit);
    };
    for (const c of model.cells) if (c.region) visit(normalizeRegion(c.region));
    return census;
}

// ---------------------------------------------------------------------------
// MCNP emission
// ---------------------------------------------------------------------------

function fmt(x: number): string {
    if (!Number.isFinite(x)) return String(x);
    return String(x);
}

/**
 * Wrap an MCNP card at token boundaries to stay within 80 columns;
 * continuation lines are indented 6 spaces (>= 5 marks a continuation).
 * Comment tails ($ …) are never split.
 */
export function wrapCard(card: string, width = 78): string[] {
    if (card.length <= width || card.trimStart().startsWith('c ')) return [card];
    let body = card;
    let comment = '';
    const dollar = card.indexOf('$');
    if (dollar !== -1) {
        body = card.slice(0, dollar).trimEnd();
        comment = card.slice(dollar);
    }
    const indent = /^\s*/.exec(body)![0];
    const tokens = body.trimStart().split(/\s+/).filter((t) => t.length);
    const lines: string[] = [];
    let cur = indent;
    for (const tok of tokens) {
        const candidate = cur && cur !== indent ? `${cur} ${tok}` : `${cur}${tok}`;
        if (cur && cur !== indent && candidate.length > width) {
            lines.push(cur);
            cur = `      ${tok}`;
        } else {
            cur = candidate;
        }
    }
    if (cur && cur !== indent) lines.push(cur);
    if (comment) {
        const last = lines[lines.length - 1];
        if (last.length + comment.length + 3 <= 100) lines[lines.length - 1] = `${last}   ${comment}`;
        else lines.push(`c ${comment.slice(1).trim()}`);
    }
    return lines;
}

const SURF_CARD: Record<string, string> = {
    'px': 'px', 'py': 'py', 'pz': 'pz', 'p': 'p',
    'so': 'so', 's': 's',
    'cx': 'cx', 'cy': 'cy', 'cz': 'cz',
    'c/x': 'c/x', 'c/y': 'c/y', 'c/z': 'c/z',
    'kx': 'kx', 'ky': 'ky', 'kz': 'kz',
    'k/x': 'k/x', 'k/y': 'k/y', 'k/z': 'k/z',
    'gq': 'gq', 'sq': 'sq', 'tx': 'tx', 'ty': 'ty', 'tz': 'tz',
};

function materialDensityForCell(mat: TMaterial | undefined, issues: ConversionIssue[]): string {
    if (!mat) return '-1.0';
    if (mat.density) {
        const { units, value } = mat.density;
        if (units.includes('g/c')) return `-${fmt(value)}`;
        if (units.includes('atom/b') || units.includes('atom/cm')) return `${fmt(value)}`;
        if (units === 'sum') {
            const total = mat.nuclides.reduce((a, n) => a + (n.type === 'ao' ? n.frac : 0), 0)
                + mat.elements.reduce((a, e) => a + (e.type === 'ao' ? e.frac : 0), 0);
            if (total > 0) return `${fmt(Number(total.toPrecision(8)))}`;
        }
        if (units === 'kg/m3') return `-${fmt(value / 1000)}`;
    }
    issues.push({ sourceLine: -1, message: `Material ${mat.name || mat.id}: density could not be resolved — placeholder -1.0 used` });
    return '-1.0';
}

function materialToCards(mat: TMaterial, issues: ConversionIssue[]): string[] {
    const lines: string[] = [`c --- ${mat.name || `material ${mat.id}`} ---`];
    let first = true;
    const emit = (zaid: string, frac: number) => {
        const fracStr = frac < 0 ? `-${Math.abs(frac).toExponential(5)}` : frac.toExponential(5);
        if (first) {
            lines.push(`m${mat.id}  ${zaid.padEnd(12)} ${fracStr}`);
            first = false;
        } else {
            lines.push(`      ${zaid.padEnd(12)} ${fracStr}`);
        }
    };
    for (const nuc of mat.nuclides) {
        emit(nuclideToZaid(nuc.name), nuc.type === 'wo' ? -Math.abs(nuc.frac) : nuc.frac);
    }
    for (const el of mat.elements) {
        const z = ELEMENT_TO_Z[el.name];
        if (z === undefined) {
            lines.push(`c ${TODO_MARK}: unknown element '${el.name}' in ${mat.name || mat.id}`);
            issues.push({ sourceLine: -1, message: `Unknown element ${el.name} in material ${mat.name || mat.id}` });
            continue;
        }
        if (el.enrichment != null && el.name === 'U') {
            const e = el.enrichment / 100;
            emit('92235.80c', el.frac * e);
            emit('92238.80c', el.frac * (1 - e));
            continue;
        }
        lines.push(`c NOTE: ${el.name} emitted as the natural ZAID ${z * 1000}.80c (add_element)`);
        emit(`${z * 1000}.80c`, el.type === 'wo' ? -Math.abs(el.frac) : el.frac);
    }
    for (const sab of mat.sab) {
        const mt = SAB_TO_MT[sab];
        if (mt) {
            lines.push(`mt${mat.id}  ${mt}.20t`);
        } else {
            lines.push(`c ${TODO_MARK}: S(a,b) '${sab}' has no MCNP mt mapping — add manually`);
            issues.push({ sourceLine: -1, message: `S(α,β) '${sab}' has no MCNP mt mapping` });
        }
    }
    return lines;
}

interface SynthSurface { id: number; card: string }

/**
 * Emit an MCNP deck from a traced OpenMC model.
 * Vacuum boundaries become a synthesized graveyard cell; reflective surfaces
 * keep the `*` prefix; lattices become lat=1/lat=2 cells with fill arrays.
 */
export function emitMcnpFromTrace(model: TracedModel): ConversionResult {
    const issues: ConversionIssue[] = [];
    for (const w of model.warnings) issues.push({ sourceLine: -1, message: w });

    const matById = new Map(model.materials.map((m) => [m.id, m]));
    const cellById = new Map(model.cells.map((c) => [c.id, c]));
    const latById = new Map(model.lattices.map((l) => [l.id, l]));
    const uniById = new Map(model.universes.map((u) => [u.id, u]));

    let nextSurfId = model.surfaces.length ? Math.max(...model.surfaces.map((s) => s.id)) + 1 : 1;
    let nextCellId = model.cells.length ? Math.max(...model.cells.map((c) => c.id)) + 1 : 1;
    let nextUnivId = Math.max(
        0,
        ...model.universes.map((u) => u.id),
        ...model.lattices.map((l) => l.id),
    ) + 1;
    const synthSurfaces: SynthSurface[] = [];
    /** dedupe synthesized axis planes by (type, value). */
    const synthPlaneCache = new Map<string, number>();
    const synthPlane = (type: 'px' | 'py' | 'pz', value: number): number => {
        const key = `${type}|${value}`;
        const hit = synthPlaneCache.get(key);
        if (hit !== undefined) return hit;
        const id = nextSurfId++;
        synthSurfaces.push({ id, card: `${id}    ${type}  ${fmt(value)}   $ synthesized lattice window` });
        synthPlaneCache.set(key, id);
        return id;
    };

    // ---- universe numbering: MCNP root universe is "no u=" -----------------
    // Map the root universe id (if any) to null; every other universe keeps
    // its id (OpenMC ids start at 1, so no collision with MCNP's implicit 0).
    const rootU = model.rootUniverse;
    const mcnpU = (uid: number): number | null => (uid === rootU ? null : uid);

    // ---- cell cards --------------------------------------------------------
    const cellCards: string[] = [];
    const emittedCells = new Set<number>();

    const emitCellCard = (cell: TCell, universeId: number | null) => {
        if (emittedCells.has(cell.id)) return;
        emittedCells.add(cell.id);
        const uPart = universeId !== null ? ` u=${universeId}` : '';
        const namePart = cell.name ? `   $ ${cell.name}` : '';
        const tmpPart = cell.temperature !== null
            ? ` tmp=${(cell.temperature * BOLTZMANN_MEV_PER_K).toExponential(4)}`
            : '';
        let trclPart = '';
        if (cell.translation && cell.translation.some((x) => x !== 0)) {
            if (cell.rotation) {
                const flat = cell.rotation.flat().map(fmt).join(' ');
                trclPart = ` trcl=(${cell.translation.map(fmt).join(' ')} ${flat})`;
            } else {
                trclPart = ` trcl=(${cell.translation.map(fmt).join(' ')})`;
            }
        } else if (cell.rotation) {
            trclPart = ` trcl=(0 0 0 ${cell.rotation.flat().map(fmt).join(' ')})`;
        }
        const regionStr = cell.region ? regionToMcnpString(cell.region) : '';

        if (cell.fill.kind === 'material') {
            const mat = matById.get(cell.fill.id);
            const dens = materialDensityForCell(mat, issues);
            cellCards.push(`${cell.id} ${cell.fill.id} ${dens}  ${regionStr}${uPart}${tmpPart}${trclPart} imp:n=1${namePart}`);
        } else if (cell.fill.kind === 'void') {
            cellCards.push(`${cell.id} 0  ${regionStr}${uPart}${tmpPart}${trclPart} imp:n=1${namePart}`);
        } else if (cell.fill.kind === 'universe') {
            cellCards.push(`${cell.id} 0  ${regionStr} fill=${cell.fill.id}${uPart}${tmpPart}${trclPart} imp:n=1${namePart}`);
        } else if (cell.fill.kind === 'lattice') {
            const lat = latById.get(cell.fill.id);
            if (!lat) {
                issues.push({ sourceLine: -1, message: `Cell ${cell.id} fills with unknown lattice ${cell.fill.id}` });
                cellCards.push(`c ${TODO_MARK}: cell ${cell.id} fills with unknown lattice ${cell.fill.id}`);
                return;
            }
            if (cell.region) {
                // MCNP pattern: the bounded cell fills a universe that contains
                // the (infinite) lattice cell. Reuse one universe per lattice.
                let latU = latUniverseByLat.get(lat.id);
                if (latU === undefined) {
                    latU = nextUnivId++;
                    latUniverseByLat.set(lat.id, latU);
                    const latCell: TCell = { ...cell, id: nextCellId++, region: null, name: lat.name || `lattice ${lat.id}`, translation: null, rotation: null, temperature: null };
                    deferredLattices.push({ cell: latCell, lat, latU });
                }
                cellCards.push(`${cell.id} 0  ${regionStr} fill=${latU}${uPart}${tmpPart}${trclPart} imp:n=1${namePart}`);
            } else {
                // No bounding region: the lattice fills this cell's entire
                // universe, so emit the lattice cell directly in it.
                emitLatticeCell(cell, lat, universeId, namePart);
            }
        }
    };
    const latUniverseByLat = new Map<number, number>();
    const deferredLattices: Array<{ cell: TCell; lat: TLattice; latU: number }> = [];

    const emitLatticeCell = (
        cell: TCell,
        lat: TLattice,
        universeId: number | null,
        namePart: string,
    ) => {
        if (lat.kind === 'rect') {
            const uarr = lat.universes ?? [];
            const nz = uarr.length;
            const ny = nz ? uarr[0].length : 0;
            const nx = ny ? uarr[0][0].length : 0;
            if (!nx || !ny || !nz || !lat.lowerLeft || lat.pitch.length < 2) {
                issues.push({ sourceLine: -1, message: `Lattice ${lat.name || lat.id}: incomplete definition — not converted` });
                cellCards.push(`c ${TODO_MARK}: rect lattice ${lat.id} incomplete (missing universes/lower_left/pitch).`);
                return;
            }
            const [px, py] = lat.pitch;
            const is3D = nz > 1 || lat.pitch.length > 2;
            const pz = is3D ? (lat.pitch[2] ?? 0) : 0;
            const [llx, lly] = lat.lowerLeft;
            const llz = is3D ? (lat.lowerLeft[2] ?? 0) : 0;
            // element [0,0(,0)] window
            const sxmin = synthPlane('px', llx);
            const sxmax = synthPlane('px', llx + px);
            const symin = synthPlane('py', lly);
            const symax = synthPlane('py', lly + py);
            let windowRegion = `${sxmin} -${sxmax} ${symin} -${symax}`;
            if (is3D) {
                const szmin = synthPlane('pz', llz);
                const szmax = synthPlane('pz', llz + pz);
                windowRegion += ` ${szmin} -${szmax}`;
            }
            // Extend by one ring of `outer` when set, so the MCNP array covers
            // window overhang exactly like OpenMC's outer universe would.
            const pad = lat.outer !== null ? 1 : 0;
            const outerId = lat.outer;
            const imax = nx - 1 + pad, jmax = ny - 1 + pad;
            const kmax = is3D ? nz - 1 : 0;
            const uPart = universeId !== null ? ` u=${universeId}` : '';
            cellCards.push(`${cell.id} 0  ${windowRegion}  lat=1${uPart} imp:n=1${namePart}`);
            const kRange = is3D ? `${0}:${kmax}` : '0:0';
            cellCards.push(`     fill=${-pad}:${imax} ${-pad}:${jmax} ${kRange}`);
            if (pad) {
                cellCards.push(`c NOTE: fill range padded by one ring of universe ${outerId} (OpenMC lattice 'outer').`);
            }
            for (let k = 0; k < nz; k++) {
                const rows: string[] = [];
                // OpenMC rows are top-first; MCNP j runs bottom-up.
                const yRows = [...uarr[k]].reverse();
                if (pad) rows.push(new Array(nx + 2).fill(outerId).join(' '));
                for (const row of yRows) {
                    const cells = pad ? [outerId, ...row, outerId] : row;
                    rows.push(cells.join(' '));
                }
                if (pad) rows.push(new Array(nx + 2).fill(outerId).join(' '));
                for (const r of rows) cellCards.push(`       ${r}`);
            }
            return;
        }

        // hex lattice
        const rings = lat.rings ?? [];
        if (!rings.length || lat.pitch.length < 1) {
            issues.push({ sourceLine: -1, message: `Hex lattice ${lat.name || lat.id}: incomplete definition — not converted` });
            cellCards.push(`c ${TODO_MARK}: hex lattice ${lat.id} incomplete.`);
            return;
        }
        const pitch = lat.pitch[0];
        const n = rings.length - 1; // outermost ring index
        const [cx, cy] = lat.center ?? [0, 0];
        // window: RHP with apothem pitch/2, y-orientation facet by default
        const apo = pitch / 2;
        const rhpId = nextSurfId++;
        const orient = lat.orientation === 'x' ? `${fmt(apo)} 0 0` : `0 ${fmt(apo)} 0`;
        synthSurfaces.push({
            id: rhpId,
            card: `${rhpId}    rhp  ${fmt(cx)} ${fmt(cy)} -1.0e10  0 0 2.0e10  ${orient}   $ synthesized hex lattice window`,
        });
        // rings (outermost first) -> axial (q, r) map; ring m starts at (0, m), clockwise
        const byQR = new Map<string, number>();
        const dirs: Array<[number, number]> = [[1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1], [1, 0]];
        for (let ri = 0; ri < rings.length; ri++) {
            const m = n - ri;
            const ring = rings[ri];
            if (m === 0) { byQR.set('0,0', ring[0]); continue; }
            let q = 0, r = m, idx = 0;
            for (const [dq, dr] of dirs) {
                for (let step = 0; step < m; step++) {
                    byQR.set(`${q},${r}`, ring[idx++]);
                    q += dq; r += dr;
                }
            }
        }
        const fillerU = lat.outer ?? rings[0][0];
        const uPart = universeId !== null ? ` u=${universeId}` : '';
        cellCards.push(`${cell.id} 0  -${rhpId}  lat=2${uPart} imp:n=1${namePart}`);
        cellCards.push(`     fill=${-n}:${n} ${-n}:${n} 0:0`);
        cellCards.push(`c NOTE: hex corners outside the ring pattern are filled with universe ${fillerU}.`);
        for (let r = -n; r <= n; r++) {
            const row: number[] = [];
            for (let q = -n; q <= n; q++) {
                row.push(byQR.get(`${q},${r}`) ?? fillerU);
            }
            cellCards.push(`       ${row.join(' ')}`);
        }
        issues.push({
            sourceLine: -1,
            message: `Hex lattice ${lat.name || lat.id}: converted assuming MCNP lat=2 axial indexing with a1=(p,0), a2=(p/2, p·√3/2) — verify orientation`,
        });
    };

    // Emit cells universe by universe: root first (no u=), then each universe.
    const rootCellIds = rootU !== null ? (uniById.get(rootU)?.cells ?? []) : model.rootCells;
    for (const cid of rootCellIds) {
        const cell = cellById.get(cid);
        if (cell) emitCellCard(cell, null);
    }
    for (const u of model.universes) {
        if (u.id === rootU) continue;
        for (const cid of u.cells) {
            const cell = cellById.get(cid);
            if (cell) emitCellCard(cell, mcnpU(u.id));
        }
    }
    // Cells never attached to any universe are unreachable in OpenMC's
    // geometry tree — dropping them mirrors what OpenMC itself would track.
    for (const cell of model.cells) {
        if (!emittedCells.has(cell.id)) {
            issues.push({ sourceLine: -1, message: `Cell ${cell.id} (${cell.name || 'unnamed'}) belongs to no universe — dropped (unreachable in OpenMC)` });
        }
    }
    // lattices referenced by bounded cells: each gets its own holder universe
    for (const d of deferredLattices) {
        emitLatticeCell(d.cell, d.lat, d.latU, d.cell.name ? `   $ ${d.cell.name}` : '');
    }

    // ---- graveyard synthesis from vacuum boundaries ------------------------
    const vacuum = model.surfaces.filter((s) => s.boundary === 'vacuum');
    if (vacuum.length) {
        const census = senseCensus(model);
        const terms: string[] = [];
        for (const s of vacuum) {
            const c = census.get(s.id) ?? { neg: 0, pos: 0 };
            // graveyard side = opposite of the majority model-side sense
            const modelSideNeg = c.neg >= c.pos;
            terms.push(modelSideNeg ? `${s.id}` : `-${s.id}`);
        }
        const gid = nextCellId++;
        cellCards.push(`${gid} 0  ${terms.join(' : ')}  imp:n=0   $ graveyard (synthesized from vacuum boundaries)`);
    } else {
        const hasReflOrPeriodic = model.surfaces.some((s) => s.boundary === 'reflective' || s.boundary === 'periodic' || s.boundary === 'white');
        if (!hasReflOrPeriodic) {
            issues.push({ sourceLine: -1, message: 'No vacuum/reflective boundary surfaces found — MCNP deck has no graveyard; add an outer boundary manually' });
            cellCards.push(`c ${TODO_MARK}: no boundary surfaces found — add a graveyard cell manually.`);
        }
    }

    // ---- surface cards ------------------------------------------------------
    const surfCards: string[] = [];
    for (const s of [...model.surfaces].sort((a, b) => a.id - b.id)) {
        const mnem = SURF_CARD[s.type];
        if (!mnem) {
            issues.push({ sourceLine: -1, message: `Surface ${s.id} type '${s.type}' has no MCNP card mapping` });
            surfCards.push(`c ${TODO_MARK}: surface ${s.id} type '${s.type}' not mapped — coeffs: ${s.coeffs.join(' ')}`);
            continue;
        }
        const prefix = s.boundary === 'reflective' ? '*' : s.boundary === 'periodic' ? '+' : '';
        if (s.boundary === 'white') {
            issues.push({ sourceLine: -1, message: `Surface ${s.id}: 'white' boundary has no MCNP equivalent — emitted as reflective` });
        }
        const pfx = s.boundary === 'white' ? '*' : prefix;
        surfCards.push(`${pfx}${s.id}    ${mnem.padEnd(4)} ${s.coeffs.map(fmt).join(' ')}`);
    }
    for (const s of synthSurfaces) surfCards.push(s.card);

    // ---- data cards ---------------------------------------------------------
    const dataCards: string[] = ['mode n'];
    for (const mat of model.materials) dataCards.push(...materialToCards(mat, issues));

    const st = model.settings;
    dataCards.push(`kcode ${st.particles ?? 10000} 1.0 ${st.inactive ?? 10} ${st.batches ?? 100}`);
    if (st.sourcePoints.length) {
        const pts = st.sourcePoints.map((p) => p.map(fmt).join(' ')).join('  ');
        dataCards.push(`ksrc ${pts}`);
    } else if (st.sourceBox) {
        const { lo, hi } = st.sourceBox;
        const mid = lo.map((v, i) => (v + hi[i]) / 2);
        const qx = (hi[0] - lo[0]) / 4;
        const qy = (hi[1] - lo[1]) / 4;
        dataCards.push('c NOTE: OpenMC Box source converted to ksrc points inside the box.');
        dataCards.push(
            `ksrc ${fmt(mid[0] + qx)} ${fmt(mid[1])} ${fmt(mid[2])}  ${fmt(mid[0] - qx)} ${fmt(mid[1])} ${fmt(mid[2])}` +
            `  ${fmt(mid[0])} ${fmt(mid[1] + qy)} ${fmt(mid[2])}  ${fmt(mid[0])} ${fmt(mid[1] - qy)} ${fmt(mid[2])}`,
        );
    } else {
        dataCards.push('ksrc 0 0 0');
    }

    let fmeshN = 4;
    for (const t of model.tallies) {
        if (t.kind === 'mesh' && t.mesh) {
            const m = t.mesh;
            dataCards.push(
                `fmesh${fmeshN}:n geom=xyz origin=${m.lowerLeft.map(fmt).join(' ')}`,
                `        imesh=${fmt(m.upperRight[0])} iints=${m.dimension[0]}`,
                `        jmesh=${fmt(m.upperRight[1])} jints=${m.dimension[1]}`,
                `        kmesh=${fmt(m.upperRight[2])} kints=${m.dimension[2]}`,
            );
            fmeshN += 10;
        } else if (t.kind === 'cell' && t.cells?.length) {
            const heating = t.scores.some((s) => s === 'heating' || s === 'heating-local');
            const kappa = t.scores.some((s) => s === 'kappa-fission');
            const n = heating ? 6 : kappa ? 7 : 4;
            dataCards.push(`f${n}:n ${t.cells.join(' ')}`);
        } else if (t.kind === 'other') {
            issues.push({ sourceLine: -1, message: `Tally '${t.name}' uses filters/scores with no direct MCNP F-card mapping — skipped` });
            dataCards.push(`c ${TODO_MARK}: tally '${t.name}' (${t.scores.join(', ')}) has no direct MCNP equivalent.`);
        }
    }
    dataCards.push('print');

    const wrapped = (cards: string[]) => cards.flatMap((c) => wrapCard(c));
    const out: string[] = [
        'Converted from OpenMC by OWEN (BelvoirDynamics) - MCNP<->OpenMC converter',
        'c NOTE: Review all converted output before production use.',
        `c Unconvertible constructs are marked with "${TODO_MARK}".`,
        'c Cell Cards',
        ...wrapped(cellCards),
        '',
        'c Surface Cards',
        ...wrapped(surfCards),
        '',
        'c Data Cards',
        ...wrapped(dataCards),
        '',
    ];
    return { direction: 'openmc_to_mcnp', output: out.join('\n'), issues };
}
