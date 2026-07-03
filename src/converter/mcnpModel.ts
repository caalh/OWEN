// MCNP deck -> intermediate representation used by every conversion target.
// Parsing logic began as a TypeScript port of groves/src/groves/converter.py
// and has since grown a full boolean region AST, keyword-split cell parsing
// (u/lat/fill/trcl/tmp), lattice fill-array decoding, tally/fmesh capture and
// TR-card support. GROVES converter.py mirrors this file — keep in sync.

// ---------------------------------------------------------------------------
// Region AST
// ---------------------------------------------------------------------------

export type RegionNode =
    | { kind: 'half'; surface: number; sense: 1 | -1 }
    | { kind: 'and'; children: RegionNode[] }
    | { kind: 'or'; children: RegionNode[] }
    | { kind: 'cellcomp'; cell: number }
    | { kind: 'comp'; child: RegionNode };

/**
 * Parse an MCNP cell region expression into an AST.
 * Grammar:  union := inter (':' inter)* ; inter := factor+ ;
 *           factor := '#'num | '#(' union ')' | '(' union ')' | signed-num
 * Returns null for an empty region; throws on malformed input.
 */
export function parseRegion(raw: string): RegionNode | null {
    const src = raw.trim();
    if (!src) return null;
    const tokens: string[] = [];
    const re = /#\s*\(|[():]|#?[-+]?\d+(?:\.\d+)?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) tokens.push(m[0].replace(/\s+/g, ''));
    let pos = 0;

    const peek = () => (pos < tokens.length ? tokens[pos] : null);

    function parseUnion(): RegionNode {
        const parts: RegionNode[] = [parseInter()];
        while (peek() === ':') {
            pos++;
            parts.push(parseInter());
        }
        return parts.length === 1 ? parts[0] : { kind: 'or', children: parts };
    }

    function parseInter(): RegionNode {
        const parts: RegionNode[] = [];
        for (;;) {
            const t = peek();
            if (t === null || t === ':' || t === ')') break;
            parts.push(parseFactor());
        }
        if (parts.length === 0) throw new Error(`empty intersection in region '${raw}'`);
        return parts.length === 1 ? parts[0] : { kind: 'and', children: parts };
    }

    function parseFactor(): RegionNode {
        const t = peek();
        if (t === null) throw new Error(`unexpected end of region '${raw}'`);
        if (t === '(') {
            pos++;
            const inner = parseUnion();
            if (peek() !== ')') throw new Error(`unbalanced parentheses in region '${raw}'`);
            pos++;
            return inner;
        }
        if (t === '#(') {
            pos++;
            const inner = parseUnion();
            if (peek() !== ')') throw new Error(`unbalanced #() in region '${raw}'`);
            pos++;
            return { kind: 'comp', child: inner };
        }
        pos++;
        if (t.startsWith('#')) {
            const cell = parseInt(t.slice(1), 10);
            if (!Number.isFinite(cell)) throw new Error(`bad complement token '${t}' in region '${raw}'`);
            return { kind: 'cellcomp', cell };
        }
        const num = parseFloat(t);
        if (!Number.isFinite(num) || num === 0) throw new Error(`bad surface token '${t}' in region '${raw}'`);
        return { kind: 'half', surface: Math.abs(Math.trunc(num)), sense: num < 0 ? -1 : 1 };
    }

    const ast = parseUnion();
    if (pos !== tokens.length) throw new Error(`trailing tokens in region '${raw}'`);
    return ast;
}

/** All surface ids referenced by a region AST. */
export function regionSurfaces(node: RegionNode | null, out = new Set<number>()): Set<number> {
    if (!node) return out;
    switch (node.kind) {
        case 'half': out.add(node.surface); break;
        case 'and':
        case 'or': for (const c of node.children) regionSurfaces(c, out); break;
        case 'comp': regionSurfaces(node.child, out); break;
        case 'cellcomp': break;
    }
    return out;
}

/** All cell ids referenced via # complements. */
export function regionCellRefs(node: RegionNode | null, out = new Set<number>()): Set<number> {
    if (!node) return out;
    switch (node.kind) {
        case 'cellcomp': out.add(node.cell); break;
        case 'and':
        case 'or': for (const c of node.children) regionCellRefs(c, out); break;
        case 'comp': regionCellRefs(node.child, out); break;
        case 'half': break;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Deck model
// ---------------------------------------------------------------------------

export interface McnpSurface {
    id: number;
    type: string;
    params: string[];
    boundary: 'transmission' | 'reflective' | 'periodic';
    /** TR number from the `j n type ...` form (j = id, n = transform); null if none. */
    transform: number | null;
    /** 0-based line in the source deck (first line of the card). */
    line: number;
}

export interface McnpNuclide {
    name: string;      // OpenMC-style, e.g. 'U235'
    zaid: string;      // raw MCNP token, e.g. '92235.80c'
    fraction: number;  // absolute value
    type: 'ao' | 'wo';
}

export interface McnpMaterial {
    id: number;
    nuclides: McnpNuclide[];
    sab: string[];        // OpenMC S(alpha,beta) names from mt cards
    mtRaw: string[];      // raw mt library tokens, e.g. 'lwtr.20t'
    line: number;
}

export interface McnpLatticeFill {
    /** fill index ranges, e.g. -8:8 -8:8 0:0 */
    imin: number; imax: number;
    jmin: number; jmax: number;
    kmin: number; kmax: number;
    nx: number;
    ny: number;
    nz: number;
    /** row-major universe ids (x fastest, then y, then z), length nx*ny*nz when fully parsed. */
    universes: number[];
    raw: string;
}

export interface McnpTransformSpec {
    /** displacement */
    dx: number; dy: number; dz: number;
    /** 3x3 rotation matrix (row-major, MCNP B1..B9) or null when pure translation. */
    rotation: number[][] | null;
    /** true when the card used *TRCL / *TRn (rotation entries are degrees). */
    degrees: boolean;
}

export interface McnpCell {
    id: number;
    matId: number;
    density: number | null;
    regionRaw: string;
    region: RegionNode | null;
    /** Set when the region expression failed to parse. */
    regionError: string | null;
    universe: number | null;
    lattice: number | null;      // lat=1 (square) / lat=2 (hex)
    fill: string | null;         // simple fill=N value (may be "N" or "N (…)" transform)
    /** Parsed simple fill universe id (absolute value; MCNP negative fill = truncated). */
    fillUniverse: number | null;
    /** Transformation attached to fill=N (tr number or inline), if any. */
    fillTransform: McnpTransformSpec | null;
    latticeFill: McnpLatticeFill | null;
    /** trcl= / *trcl= transformation, if any. */
    trcl: McnpTransformSpec | null;
    /** Temperature in Kelvin from tmp= (MCNP stores kT in MeV), if given. */
    temperatureK: number | null;
    /** True when the cell has imp:n=0 (graveyard / outside world). */
    importanceZero: boolean;
    line: number;
}

export interface McnpMeshTally {
    id: number;
    particle: string;
    origin: [number, number, number];
    imesh: number; iints: number;
    jmesh: number; jints: number;
    kmesh: number; kints: number;
    line: number;
}

export interface McnpCellTally {
    id: number;              // full tally number, e.g. 4, 14, 6
    kind: 4 | 6 | 7;         // F4 flux / F6 heating / F7 fission energy
    particle: string;
    cells: number[];
    line: number;
}

export interface McnpSettings {
    particles?: number;
    keffGuess?: number;
    inactive?: number;
    batches?: number;
    /** All ksrc points (was a single point pre-0.3.8). */
    ksrcPoints: Array<[number, number, number]>;
    sdefRaw?: string;
    meshTallies: McnpMeshTally[];
    cellTallies: McnpCellTally[];
}

export interface McnpDeck {
    cells: McnpCell[];
    surfaces: McnpSurface[];
    materials: McnpMaterial[];
    /** TRn cards by transform number. */
    transforms: Map<number, McnpTransformSpec>;
    settings: McnpSettings;
    /** 0-based line ranges [start, endExclusive] of the three sections. */
    sections: { cells: [number, number]; surfaces: [number, number]; data: [number, number] };
}

/** Boltzmann constant in MeV/K (MCNP tmp cards store kT in MeV). */
export const BOLTZMANN_MEV_PER_K = 8.617333262e-11;

const SURFACE_TYPE_RE = /^\*?\+?\s*\d+\s+(?:\d+\s+)?(p|px|py|pz|so|s|sx|sy|sz|sph|c\/x|c\/y|c\/z|cx|cy|cz|k\/x|k\/y|k\/z|kx|ky|kz|sq|gq|tx|ty|tz|rpp|rcc|rhp|hex|box|x|y|z)\b/i;
const DATA_CARD_RE = /^(mode|m\d+|mt\d+|kcode|ksrc|sdef|nps|phys|prdmp|print|f\d+|fm\d+|fc\d+|e\d+|si\d+|sp\d+|tr\d+|fmesh\d+|imp|vol|tmp)\b/i;

interface LogicalLine {
    text: string;
    line: number; // first source line of the card
}

function stripComment(line: string): string {
    const idx = line.indexOf('$');
    return (idx !== -1 ? line.slice(0, idx) : line).trim();
}

/** Merge MCNP continuation lines (indented >= 5 columns or trailing '&') into their parent card. */
function joinContinuationLines(lines: string[], offset: number): LogicalLine[] {
    const merged: LogicalLine[] = [];
    let pendingAmp = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const strippedLeft = line.trimStart();
        if (!strippedLeft) continue;
        const low = strippedLeft.toLowerCase();
        if (low.startsWith('c ') || low === 'c') continue;
        let clean = stripComment(strippedLeft);
        if (!clean) continue;
        let hasAmp = false;
        if (clean.endsWith('&')) {
            hasAmp = true;
            clean = clean.slice(0, -1).trim();
        }
        const isCont = (pendingAmp || (line[0] === ' ' && line.length - strippedLeft.length >= 4)) && merged.length > 0;
        if (isCont) {
            merged[merged.length - 1].text += ' ' + clean;
        } else {
            merged.push({ text: clean, line: offset + i });
        }
        pendingAmp = hasAmp;
    }
    return merged;
}

/** Split into cell / surface / data sections; blank-line split with heuristic fallback. */
export function splitMcnpSections(text: string): {
    cellLines: string[]; surfLines: string[]; dataLines: string[];
    ranges: McnpDeck['sections'];
} {
    const lines = text.replace(/\r\n/g, '\n').split('\n');

    const sections: Array<{ start: number; lines: string[] }> = [];
    let current: { start: number; lines: string[] } | null = null;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === '') {
            if (current) { sections.push(current); current = null; }
        } else {
            if (!current) current = { start: i, lines: [] };
            current.lines.push(lines[i]);
        }
    }
    if (current) sections.push(current);

    if (sections.length >= 3) {
        const [c, s, d] = sections;
        const dataEnd = sections[sections.length - 1].start + sections[sections.length - 1].lines.length;
        // everything from the 3rd blank-separated block onward is data
        const dataLines: string[] = [];
        for (let k = 2; k < sections.length; k++) dataLines.push(...sections[k].lines);
        return {
            cellLines: c.lines, surfLines: s.lines, dataLines,
            ranges: {
                cells: [c.start, c.start + c.lines.length],
                surfaces: [s.start, s.start + s.lines.length],
                data: [d.start, dataEnd],
            },
        };
    }

    // Fallback: heuristic boundary detection on non-blank lines.
    const all: Array<{ text: string; idx: number }> = [];
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim()) all.push({ text: lines[i], idx: i });
    }
    let surfStart: number | null = null;
    let dataStart: number | null = null;
    for (let i = 0; i < all.length; i++) {
        const stripped = all[i].text.trim();
        if (/^c/i.test(stripped)) continue;
        if (surfStart === null && SURFACE_TYPE_RE.test(stripped)) surfStart = i;
        if (dataStart === null && DATA_CARD_RE.test(stripped)) dataStart = i;
    }
    if (surfStart !== null && dataStart !== null && dataStart > surfStart) {
        return {
            cellLines: all.slice(0, surfStart).map((l) => l.text),
            surfLines: all.slice(surfStart, dataStart).map((l) => l.text),
            dataLines: all.slice(dataStart).map((l) => l.text),
            ranges: {
                cells: [all[0]?.idx ?? 0, all[surfStart]?.idx ?? 0],
                surfaces: [all[surfStart]?.idx ?? 0, all[dataStart]?.idx ?? 0],
                data: [all[dataStart]?.idx ?? 0, lines.length],
            },
        };
    }
    return {
        cellLines: all.map((l) => l.text), surfLines: [], dataLines: [],
        ranges: { cells: [0, lines.length], surfaces: [lines.length, lines.length], data: [lines.length, lines.length] },
    };
}

import { zaidToNuclide, MT_TO_SAB } from './zaid';

const SURFACE_TYPES = new Set([
    'p', 'px', 'py', 'pz', 'so', 's', 'sx', 'sy', 'sz', 'sph',
    'c/x', 'c/y', 'c/z', 'cx', 'cy', 'cz',
    'k/x', 'k/y', 'k/z', 'kx', 'ky', 'kz',
    'sq', 'gq', 'tx', 'ty', 'tz',
    'rpp', 'rcc', 'rhp', 'hex', 'box', 'x', 'y', 'z', 'ell', 'wed', 'arb', 'trc',
]);

function parseSurfaces(surfLines: string[], offset: number): McnpSurface[] {
    const out: McnpSurface[] = [];
    for (const ll of joinContinuationLines(surfLines, offset)) {
        let line = ll.text;
        let boundary: McnpSurface['boundary'] = 'transmission';
        if (line.startsWith('*')) {
            boundary = 'reflective';
            line = line.slice(1).trim();
        } else if (line.startsWith('+')) {
            boundary = 'periodic';
            line = line.slice(1).trim();
        }
        const tokens = line.split(/\s+/);
        if (tokens.length < 2) continue;
        const id = parseInt(tokens[0], 10);
        if (!Number.isFinite(id)) continue;
        // optional TR number between id and mnemonic: "j n type params"
        let ti = 1;
        let transform: number | null = null;
        if (/^-?\d+$/.test(tokens[1]) && tokens.length > 2 && SURFACE_TYPES.has(tokens[2].toLowerCase())) {
            transform = parseInt(tokens[1], 10);
            ti = 2;
        }
        const type = tokens[ti]?.toLowerCase();
        if (!type) continue;
        out.push({ id, type, params: tokens.slice(ti + 1), boundary, transform, line: ll.line });
    }
    return out;
}

function parseMaterials(dataLines: string[], offset: number): McnpMaterial[] {
    const materials: McnpMaterial[] = [];
    const mtMap = new Map<number, { sab: string[]; raw: string[] }>();

    for (const ll of joinContinuationLines(dataLines, offset)) {
        const line = ll.text;
        const mtM = /^mt(\d+)\s+(.+)/i.exec(line);
        if (mtM) {
            const matId = parseInt(mtM[1], 10);
            const entry = mtMap.get(matId) ?? { sab: [], raw: [] };
            for (const lib of mtM[2].split(/\s+/)) {
                entry.raw.push(lib);
                const base = lib.split('.')[0].toLowerCase();
                const sab = MT_TO_SAB[base];
                if (sab) entry.sab.push(sab);
            }
            mtMap.set(matId, entry);
            continue;
        }
        const m = /^m(\d+)\s+(.+)/i.exec(line);
        if (!m) continue;
        const id = parseInt(m[1], 10);
        const tokens = m[2].split(/\s+/);
        const nuclides: McnpNuclide[] = [];
        for (let i = 0; i + 1 < tokens.length; ) {
            const zaid = tokens[i];
            // skip material keywords like nlib=80c / plib= etc.
            if (/^[a-z]+lib\s*=/i.test(zaid) || zaid.includes('=')) { i += 1; continue; }
            const frac = parseFloat(tokens[i + 1]);
            if (!Number.isFinite(frac)) { i += 1; continue; }
            nuclides.push({
                name: zaidToNuclide(zaid),
                zaid,
                fraction: Math.abs(frac),
                type: frac < 0 ? 'wo' : 'ao',
            });
            i += 2;
        }
        materials.push({ id, nuclides, sab: [], mtRaw: [], line: ll.line });
    }
    for (const mat of materials) {
        const mt = mtMap.get(mat.id);
        if (mt) { mat.sab = mt.sab; mat.mtRaw = mt.raw; }
    }
    return materials;
}

function parseFillArray(fillSpec: string): McnpLatticeFill | null {
    // e.g. "-8:8 -8:8 0:0  1 1 2 1 ... " (already merged onto one logical line)
    const m = /(-?\d+)\s*:\s*(-?\d+)\s+(-?\d+)\s*:\s*(-?\d+)\s+(-?\d+)\s*:\s*(-?\d+)\s+(.+)/.exec(fillSpec);
    if (!m) return null;
    const imin = parseInt(m[1], 10); const imax = parseInt(m[2], 10);
    const jmin = parseInt(m[3], 10); const jmax = parseInt(m[4], 10);
    const kmin = parseInt(m[5], 10); const kmax = parseInt(m[6], 10);
    const nx = imax - imin + 1;
    const ny = jmax - jmin + 1;
    const nz = kmax - kmin + 1;
    if (nx <= 0 || ny <= 0 || nz <= 0) return null;
    const universes: number[] = [];
    for (const tok of m[7].split(/\s+/)) {
        // expand "17r"-style repeats: "3 16r" = 3 repeated 16 MORE times
        const rep = /^(\d+)r$/i.exec(tok);
        if (rep && universes.length > 0) {
            const n = parseInt(rep[1], 10);
            const last = universes[universes.length - 1];
            for (let k = 0; k < n; k++) universes.push(last);
            continue;
        }
        const u = parseInt(tok, 10);
        if (Number.isFinite(u)) universes.push(u);
    }
    return { imin, imax, jmin, jmax, kmin, kmax, nx, ny, nz, universes, raw: fillSpec };
}

/** Parse "(dx dy dz [b1..b9])" or a bare TR number reference into a spec. */
function parseTransformValue(
    value: string,
    degrees: boolean,
    transforms: Map<number, McnpTransformSpec>,
): McnpTransformSpec | null {
    const trimmed = value.trim();
    const parenM = /^\(([^)]*)\)/.exec(trimmed);
    if (parenM) {
        const nums = parenM[1].trim().split(/\s+/).map(parseFloat);
        if (nums.length >= 3 && nums.slice(0, 3).every(Number.isFinite)) {
            let rotation: number[][] | null = null;
            if (nums.length >= 12 && nums.slice(3, 12).every(Number.isFinite)) {
                rotation = [nums.slice(3, 6), nums.slice(6, 9), nums.slice(9, 12)];
            }
            return { dx: nums[0], dy: nums[1], dz: nums[2], rotation, degrees };
        }
        return null;
    }
    const n = parseInt(trimmed.split(/\s+/)[0], 10);
    if (Number.isFinite(n) && transforms.has(Math.abs(n))) {
        return transforms.get(Math.abs(n))!;
    }
    return null;
}

// Cell keyword grammar: keyword [(:particle)] then '=' or whitespace, value(s).
const CELL_KEYWORD_RE = /(?:^|\s)(\*?)(imp|u|lat|fill|tmp|vol|trcl|pwt|ext|fcl|wwn|dxc|nonu|pd|tmp1|elpt|cosy|bflcl|unc|mat|rho)((?::[a-z,]+)?)\s*=?\s*/gi;

function parseCells(
    cellLines: string[],
    offset: number,
    transforms: Map<number, McnpTransformSpec>,
): McnpCell[] {
    const out: McnpCell[] = [];
    for (const ll of joinContinuationLines(cellLines, offset)) {
        const line = ll.text;

        // Split "id mat [density] region…" from the trailing keyword params:
        // find the first cell keyword occurrence.
        CELL_KEYWORD_RE.lastIndex = 0;
        let firstKw = line.length;
        const kwMatches: Array<{ star: boolean; name: string; particle: string; start: number; valueStart: number }> = [];
        let km: RegExpExecArray | null;
        while ((km = CELL_KEYWORD_RE.exec(line)) !== null) {
            kwMatches.push({
                star: km[1] === '*',
                name: km[2].toLowerCase(),
                particle: km[3] ?? '',
                start: km.index,
                valueStart: km.index + km[0].length,
            });
            if (km.index < firstKw) firstKw = km.index;
        }
        const head = line.slice(0, firstKw).trim();

        const tokens = head.split(/\s+/);
        if (tokens.length < 2) continue;
        const id = parseInt(tokens[0], 10);
        const matId = parseInt(tokens[1], 10);
        if (!Number.isFinite(id) || !Number.isFinite(matId)) continue;
        // "like n but" cells are not expanded — surface as regionError.
        if (/^like$/i.test(tokens[1])) continue;

        let density: number | null = null;
        let surfStart = 2;
        if (matId !== 0) {
            const d = parseFloat(tokens[2]);
            if (Number.isFinite(d)) { density = d; surfStart = 3; }
        }
        const regionRaw = tokens.slice(surfStart).join(' ').trim();
        let region: RegionNode | null = null;
        let regionError: string | null = null;
        try {
            region = parseRegion(regionRaw);
        } catch (err) {
            regionError = (err as Error).message;
        }

        // Extract keyword values (value runs to the start of the next keyword).
        let universe: number | null = null;
        let lattice: number | null = null;
        let fill: string | null = null;
        let fillUniverse: number | null = null;
        let fillTransform: McnpTransformSpec | null = null;
        let latticeFill: McnpLatticeFill | null = null;
        let trcl: McnpTransformSpec | null = null;
        let temperatureK: number | null = null;
        let importanceZero = false;

        for (let i = 0; i < kwMatches.length; i++) {
            const kw = kwMatches[i];
            const valueEnd = i + 1 < kwMatches.length ? kwMatches[i + 1].start : line.length;
            const value = line.slice(kw.valueStart, valueEnd).trim();
            switch (kw.name) {
                case 'imp': {
                    const v = parseFloat(value.split(/\s+/)[0]);
                    if (v === 0) importanceZero = true;
                    break;
                }
                case 'u': {
                    const v = parseInt(value.split(/\s+/)[0], 10);
                    if (Number.isFinite(v)) universe = Math.abs(v);
                    break;
                }
                case 'lat': {
                    const v = parseInt(value.split(/\s+/)[0], 10);
                    if (Number.isFinite(v)) lattice = v;
                    break;
                }
                case 'tmp': {
                    const v = parseFloat(value.split(/\s+/)[0]);
                    if (Number.isFinite(v) && v > 0) temperatureK = v / BOLTZMANN_MEV_PER_K;
                    break;
                }
                case 'trcl': {
                    trcl = parseTransformValue(value, kw.star, transforms);
                    break;
                }
                case 'fill': {
                    if (/^-?\d+\s*:/.test(value)) {
                        latticeFill = parseFillArray(value);
                        if (!latticeFill) fill = value;
                    } else {
                        // keep `fill` as the bare universe token for back-compat
                        // (Serpent/SCONE emitters print `fill u${fill}`).
                        fill = value.split(/\s+/)[0];
                        const fm = /^(-?\d+)\s*(\(.*\))?/.exec(value);
                        if (fm) {
                            fillUniverse = Math.abs(parseInt(fm[1], 10));
                            if (fm[2]) {
                                fillTransform = parseTransformValue(fm[2], kw.star, transforms);
                            } else {
                                // fill=N n — trailing bare TR number
                                const rest = value.slice(fm[1].length).trim();
                                if (/^\d+$/.test(rest)) {
                                    fillTransform = transforms.get(parseInt(rest, 10)) ?? null;
                                }
                            }
                        }
                    }
                    break;
                }
                default: break; // vol / pwt / … ignored
            }
        }

        out.push({
            id, matId, density, regionRaw, region, regionError,
            universe, lattice, fill, fillUniverse, fillTransform, latticeFill,
            trcl, temperatureK, importanceZero,
            line: ll.line,
        });
    }
    return out;
}

function parseTransforms(dataLines: string[], offset: number): Map<number, McnpTransformSpec> {
    const out = new Map<number, McnpTransformSpec>();
    for (const ll of joinContinuationLines(dataLines, offset)) {
        const m = /^(\*?)tr(\d+)\s+(.+)/i.exec(ll.text);
        if (!m) continue;
        const degrees = m[1] === '*';
        const n = parseInt(m[2], 10);
        const nums = m[3].split(/\s+/).map(parseFloat);
        if (nums.length >= 3 && nums.slice(0, 3).every(Number.isFinite)) {
            let rotation: number[][] | null = null;
            if (nums.length >= 12 && nums.slice(3, 12).every(Number.isFinite)) {
                rotation = [nums.slice(3, 6), nums.slice(6, 9), nums.slice(9, 12)];
            }
            out.set(n, { dx: nums[0], dy: nums[1], dz: nums[2], rotation, degrees });
        }
    }
    return out;
}

function parseSettings(dataLines: string[], offset: number): McnpSettings {
    const settings: McnpSettings = { ksrcPoints: [], meshTallies: [], cellTallies: [] };
    for (const ll of joinContinuationLines(dataLines, offset)) {
        const line = ll.text;
        const low = line.toLowerCase();
        if (low.startsWith('kcode')) {
            const t = line.split(/\s+/);
            const particles = Math.round(parseFloat(t[1]));
            const keffGuess = parseFloat(t[2]);
            const inactive = Math.round(parseFloat(t[3]));
            const batches = Math.round(parseFloat(t[4]));
            if (Number.isFinite(particles)) settings.particles = particles;
            if (Number.isFinite(keffGuess)) settings.keffGuess = keffGuess;
            if (Number.isFinite(inactive)) settings.inactive = inactive;
            if (Number.isFinite(batches)) settings.batches = batches;
        } else if (low.startsWith('ksrc')) {
            const nums = line.split(/\s+/).slice(1).map(parseFloat).filter(Number.isFinite);
            for (let i = 0; i + 2 < nums.length + 1 && i + 3 <= nums.length; i += 3) {
                settings.ksrcPoints.push([nums[i], nums[i + 1], nums[i + 2]]);
            }
        } else if (low.startsWith('sdef')) {
            settings.sdefRaw = line;
        } else if (/^fmesh\d+/.test(low)) {
            const idM = /^fmesh(\d+):?(\w*)/.exec(low)!;
            const grab = (key: string): number | null => {
                const g = new RegExp(`${key}\\s*=\\s*([-+0-9.eE]+)`, 'i').exec(line);
                return g ? parseFloat(g[1]) : null;
            };
            const originM = /origin\s*=\s*([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/i.exec(line);
            const imesh = grab('imesh'); const jmesh = grab('jmesh'); const kmesh = grab('kmesh');
            if (originM && imesh !== null && jmesh !== null && kmesh !== null) {
                settings.meshTallies.push({
                    id: parseInt(idM[1], 10),
                    particle: idM[2] || 'n',
                    origin: [parseFloat(originM[1]), parseFloat(originM[2]), parseFloat(originM[3])],
                    imesh, iints: grab('iints') ?? 1,
                    jmesh, jints: grab('jints') ?? 1,
                    kmesh, kints: grab('kints') ?? 1,
                    line: ll.line,
                });
            }
        } else {
            const fM = /^f(\d+):?(\w*)\s+(.+)/i.exec(line);
            if (fM) {
                const id = parseInt(fM[1], 10);
                const kind = id % 10;
                if (kind === 4 || kind === 6 || kind === 7) {
                    const cells = fM[3].split(/\s+/).map((t) => parseInt(t, 10)).filter(Number.isFinite);
                    if (cells.length) {
                        settings.cellTallies.push({
                            id, kind: kind as 4 | 6 | 7, particle: fM[2] || 'n', cells, line: ll.line,
                        });
                    }
                }
            }
        }
    }
    return settings;
}

export function parseMcnpDeck(text: string): McnpDeck {
    const { cellLines, surfLines, dataLines, ranges } = splitMcnpSections(text);
    const transforms = parseTransforms(dataLines, ranges.data[0]);
    return {
        cells: parseCells(cellLines, ranges.cells[0], transforms),
        surfaces: parseSurfaces(surfLines, ranges.surfaces[0]),
        materials: parseMaterials(dataLines, ranges.data[0]),
        transforms,
        settings: parseSettings(dataLines, ranges.data[0]),
        sections: ranges,
    };
}
