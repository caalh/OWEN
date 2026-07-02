// MCNP deck -> intermediate representation used by every conversion target.
// Parsing logic is a TypeScript port of groves/src/groves/converter.py
// (_split_mcnp_sections / _join_continuation_lines / surface, material,
// cell, settings parsers) extended with lattice fill-array decoding.

export interface McnpSurface {
    id: number;
    type: string;
    params: string[];
    boundary: 'transmission' | 'reflective';
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
    nx: number;
    ny: number;
    nz: number;
    /** row-major universe ids (x fastest), length nx*ny*nz when fully parsed. */
    universes: number[];
    raw: string;
}

export interface McnpCell {
    id: number;
    matId: number;
    density: number | null;
    regionRaw: string;
    universe: number | null;
    lattice: number | null;      // lat=1 (square) / lat=2 (hex)
    fill: string | null;         // simple fill=N value
    latticeFill: McnpLatticeFill | null;
    /** True when the cell has imp:n=0 (graveyard / outside world). */
    importanceZero: boolean;
    line: number;
}

export interface McnpSettings {
    particles?: number;
    keffGuess?: number;
    inactive?: number;
    batches?: number;
    ksrc?: [number, number, number];
    sdefRaw?: string;
}

export interface McnpDeck {
    cells: McnpCell[];
    surfaces: McnpSurface[];
    materials: McnpMaterial[];
    settings: McnpSettings;
    /** 0-based line ranges [start, endExclusive] of the three sections. */
    sections: { cells: [number, number]; surfaces: [number, number]; data: [number, number] };
}

const SURFACE_TYPE_RE = /^\*?\s*\d+\s+(cz|cx|cy|pz|px|py|so|s|rpp|rcc|rhp|sq|gq|kz|kx|ky|tz)\b/i;
const DATA_CARD_RE = /^(mode|m\d+|mt\d+|kcode|ksrc|sdef|nps|phys|prdmp|print|f\d+|fm\d+|fc\d+|e\d+|si\d+|sp\d+)\b/i;

interface LogicalLine {
    text: string;
    line: number; // first source line of the card
}

function stripComment(line: string): string {
    const idx = line.indexOf('$');
    return (idx !== -1 ? line.slice(0, idx) : line).trim();
}

/** Merge MCNP continuation lines (indented >= 4 spaces) into their parent card. */
function joinContinuationLines(lines: string[], offset: number): LogicalLine[] {
    const merged: LogicalLine[] = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const strippedLeft = line.trimStart();
        if (!strippedLeft) continue;
        const low = strippedLeft.toLowerCase();
        if (low.startsWith('c ') || low === 'c') continue;
        const clean = stripComment(strippedLeft);
        if (!clean) continue;
        const isCont = line[0] === ' ' && line.length - strippedLeft.length >= 4 && merged.length > 0;
        if (isCont) {
            merged[merged.length - 1].text += ' ' + clean;
        } else {
            merged.push({ text: clean, line: offset + i });
        }
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

function parseSurfaces(surfLines: string[], offset: number): McnpSurface[] {
    const out: McnpSurface[] = [];
    for (const ll of joinContinuationLines(surfLines, offset)) {
        let line = ll.text;
        let boundary: McnpSurface['boundary'] = 'transmission';
        if (line.startsWith('*')) {
            boundary = 'reflective';
            line = line.slice(1).trim();
        }
        const tokens = line.split(/\s+/);
        if (tokens.length < 3) continue;
        const id = parseInt(tokens[0], 10);
        if (!Number.isFinite(id)) continue;
        out.push({ id, type: tokens[1].toLowerCase(), params: tokens.slice(2), boundary, line: ll.line });
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
    const nx = parseInt(m[2], 10) - parseInt(m[1], 10) + 1;
    const ny = parseInt(m[4], 10) - parseInt(m[3], 10) + 1;
    const nz = parseInt(m[6], 10) - parseInt(m[5], 10) + 1;
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
    return { nx, ny, nz, universes, raw: fillSpec };
}

function parseCells(cellLines: string[], offset: number): McnpCell[] {
    const out: McnpCell[] = [];
    for (const ll of joinContinuationLines(cellLines, offset)) {
        let line = ll.text;
        const importanceZero = /imp:n\s*=?\s*0(?:\s|$)/i.test(line);
        line = line.replace(/imp:[a-z]+\s*=?\s*\S+/gi, '');
        const uM = /\bu\s*=\s*(\d+)/i.exec(line);
        line = line.replace(/\bu\s*=\s*\d+/gi, '');
        const latM = /\blat\s*=\s*(\d+)/i.exec(line);
        line = line.replace(/\blat\s*=\s*\d+/gi, '');
        const fillM = /\bfill\s*=\s*(.+)$/i.exec(line);
        line = line.replace(/\bfill\s*=.*$/i, '');
        line = line.replace(/\b(?:vol|tmp|trcl)\s*=\s*\S+/gi, '');

        const tokens = line.trim().split(/\s+/);
        if (tokens.length < 2) continue;
        const id = parseInt(tokens[0], 10);
        const matId = parseInt(tokens[1], 10);
        if (!Number.isFinite(id) || !Number.isFinite(matId)) continue;

        let density: number | null = null;
        let surfStart = 2;
        if (matId !== 0) {
            const d = parseFloat(tokens[2]);
            if (Number.isFinite(d)) { density = d; surfStart = 3; }
        }
        const regionRaw = tokens.slice(surfStart).join(' ').trim();

        let latticeFill: McnpLatticeFill | null = null;
        let fill: string | null = null;
        if (fillM) {
            const spec = fillM[1].trim();
            if (/:/.test(spec)) {
                latticeFill = parseFillArray(spec);
                fill = latticeFill ? null : spec;
            } else {
                fill = spec.split(/\s+/)[0];
            }
        }

        out.push({
            id, matId, density, regionRaw,
            universe: uM ? parseInt(uM[1], 10) : null,
            lattice: latM ? parseInt(latM[1], 10) : null,
            fill,
            latticeFill,
            importanceZero,
            line: ll.line,
        });
    }
    return out;
}

function parseSettings(dataLines: string[], offset: number): McnpSettings {
    const settings: McnpSettings = {};
    for (const ll of joinContinuationLines(dataLines, offset)) {
        const line = ll.text;
        const low = line.toLowerCase();
        if (low.startsWith('kcode')) {
            const t = line.split(/\s+/);
            const particles = parseInt(t[1], 10);
            const keffGuess = parseFloat(t[2]);
            const inactive = parseInt(t[3], 10);
            const batches = parseInt(t[4], 10);
            if (Number.isFinite(particles)) settings.particles = particles;
            if (Number.isFinite(keffGuess)) settings.keffGuess = keffGuess;
            if (Number.isFinite(inactive)) settings.inactive = inactive;
            if (Number.isFinite(batches)) settings.batches = batches;
        } else if (low.startsWith('ksrc')) {
            const t = line.split(/\s+/).slice(1, 4).map(parseFloat);
            if (t.length === 3 && t.every(Number.isFinite)) {
                settings.ksrc = [t[0], t[1], t[2]];
            }
        } else if (low.startsWith('sdef')) {
            settings.sdefRaw = line;
        }
    }
    return settings;
}

export function parseMcnpDeck(text: string): McnpDeck {
    const { cellLines, surfLines, dataLines, ranges } = splitMcnpSections(text);
    return {
        cells: parseCells(cellLines, ranges.cells[0]),
        surfaces: parseSurfaces(surfLines, ranges.surfaces[0]),
        materials: parseMaterials(dataLines, ranges.data[0]),
        settings: parseSettings(dataLines, ranges.data[0]),
        sections: ranges,
    };
}
