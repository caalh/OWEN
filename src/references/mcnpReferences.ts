// MCNP reference / cross-reference index.
//
// Answers "what is this number, and where is it defined vs. used?" for an MCNP
// deck: cell IDs, surface IDs, material IDs, and universe IDs. It is a focused,
// position-aware companion to the geometry parser in `../preview/codes/mcnp.ts`
// (which parses the same cells / surfaces / universes / fills but discards
// source positions). Special attention is paid to lattices: a `lat`/`fill` cell
// has its fill array decoded into per-universe counts and unit-cell bounding
// surfaces, which directly answers "what input is used for this lattice".
//
// This module is intentionally free of any `vscode` import so it can be unit
// tested headlessly (tsc → mocha). The editor providers and tree view that wrap
// it live in `./providers.ts` and `./referencesView.ts`.

export type McnpEntityKind = 'cell' | 'surface' | 'material' | 'universe' | 'transform';

/** A single 0-based source position span on one line. */
export interface SourceSpan {
    line: number;
    startCol: number;
    endCol: number;
}

export interface Occurrence extends SourceSpan {
    kind: McnpEntityKind;
    id: number;
    /** True for the canonical definition of the entity. */
    isDefinition: boolean;
    /** Cell id this occurrence sits inside, for context in the references list. */
    cellContext?: number;
}

export interface EntityDefinition extends SourceSpan {
    kind: McnpEntityKind;
    id: number;
    /** Short human label, e.g. "px 0.63", "UO2 3.1%", "guide tube". */
    summary: string;
    /** Raw first card line (trimmed), for the hover detail. */
    detail: string;
}

export interface LatticeInfo {
    cellId: number;
    line: number;
    /** 1 = square (REC), 2 = hexagonal. */
    lat: number;
    /** Filling universe id -> number of placed positions in the fill array. */
    universeCounts: Map<number, number>;
    /** Surface ids that bound the lattice unit cell (px/py/pz/rpp …). */
    boundingSurfaces: number[];
    nx: number;
    ny: number;
    nz: number;
}

export interface McnpReferenceIndex {
    /** key = `${kind}:${id}`. */
    definitions: Map<string, EntityDefinition>;
    occurrences: Occurrence[];
    lattices: LatticeInfo[];
}

const SURFACE_MNEMONICS = new Set([
    'cz', 'cx', 'cy', 'c/z', 'c/x', 'c/y', 'pz', 'px', 'py', 'p',
    'rpp', 'rcc', 'rhp', 'hex', 'so', 's', 'sx', 'sy', 'sz', 'sph',
    'kz', 'kx', 'ky', 'gq', 'sq', 'tz', 'tx', 'ty', 'box', 'rec', 'trc', 'ell', 'wed', 'arb',
]);

const defKey = (kind: McnpEntityKind, id: number) => `${kind}:${id}`;

// ---------------------------------------------------------------------------
// Logical card assembly with a char-offset → source-position map
// ---------------------------------------------------------------------------

interface Card {
    text: string;
    /** Per-character source position (null for inserted separators). */
    map: ({ line: number; col: number } | null)[];
    firstLine: number;
}

function buildCards(text: string): Card[] {
    const lines = text.split(/\r?\n/);
    const cards: Card[] = [];
    let cur: Card | null = null;

    const flush = () => {
        if (cur && cur.text.trim()) cards.push(cur);
        cur = null;
    };

    const append = (card: Card, lineText: string, lineNo: number) => {
        for (let k = 0; k < lineText.length; k++) {
            card.text += lineText[k];
            card.map.push({ line: lineNo, col: k });
        }
    };

    for (let li = 0; li < lines.length; li++) {
        const raw = lines[li];
        const dollar = raw.indexOf('$');
        const stripped = dollar >= 0 ? raw.slice(0, dollar) : raw;
        if (stripped.trim() === '') { flush(); continue; }
        if (/^\s{0,4}c(\s|$)/i.test(raw)) continue; // comment card (cols 1-5)

        const prevEndsAmp = cur ? /&\s*$/.test(cur.text) : false;
        const isCont = /^\s+\S/.test(raw) || prevEndsAmp;
        if (isCont && cur) {
            cur.text += ' ';
            cur.map.push(null);
            append(cur, stripped, li);
        } else {
            flush();
            cur = { text: '', map: [], firstLine: li };
            append(cur, stripped, li);
        }
    }
    flush();
    return cards;
}

function spanAt(card: Card, start: number, end: number): SourceSpan | null {
    const a = card.map[start];
    const b = card.map[end - 1];
    if (!a || !b || a.line !== b.line) return null;
    return { line: a.line, startCol: a.col, endCol: b.col + 1 };
}

// ---------------------------------------------------------------------------
// Card classification
// ---------------------------------------------------------------------------

type CardKind = 'cell' | 'surface' | 'material' | 'matdata' | 'transform' | 'other';

function classify(text: string): CardKind {
    const tokens = text.trim().split(/\s+/);
    if (tokens.length === 0) return 'other';
    const first = tokens[0].toLowerCase();
    if (/^m\d+$/.test(first)) return 'material';
    // mt{n}/mx{n} data cards (S(a,b) thermal scattering, nuclide substitution)
    // are keyed by an existing material number; they reference, not define, mN.
    if (/^(?:mt|mx)\d+/.test(first)) return 'matdata';
    // tr{n}/*tr{n} coordinate-transformation cards define a transform id.
    if (/^\*?tr\d+$/.test(first)) return 'transform';
    if (/^\*?\d+$/.test(tokens[0])) {
        const t1 = (tokens[1] ?? '').toLowerCase();
        const t2 = (tokens[2] ?? '').toLowerCase();
        if (SURFACE_MNEMONICS.has(t1)) return 'surface';
        if (/^\d+$/.test(t1) && SURFACE_MNEMONICS.has(t2)) return 'surface';
        return 'cell';
    }
    return 'other';
}

// ---------------------------------------------------------------------------
// Fill-array shorthand expansion (nR / nI / nJ|j) — mirrors the geometry parser
// ---------------------------------------------------------------------------

function expandRepeats(tokens: string[]): number[] {
    const out: number[] = [];
    let pendingInterp = 0;
    for (const tok of tokens) {
        const rep = tok.match(/^(\d+)[rR]$/);
        if (rep) {
            const n = parseInt(rep[1], 10);
            const last = out.length ? out[out.length - 1] : 0;
            for (let k = 0; k < n; k++) out.push(last);
            continue;
        }
        const interp = tok.match(/^(\d+)[iI]$/);
        if (interp) { pendingInterp = parseInt(interp[1], 10); continue; }
        const jump = tok.match(/^(\d+)?[jJ]$/);
        if (jump) {
            const n = jump[1] ? parseInt(jump[1], 10) : 1;
            for (let k = 0; k < n; k++) out.push(0);
            continue;
        }
        const n = parseInt(tok, 10);
        if (Number.isNaN(n)) continue;
        if (pendingInterp > 0 && out.length) {
            const start = out[out.length - 1];
            const steps = pendingInterp + 1;
            for (let k = 1; k <= pendingInterp; k++) out.push(Math.round(start + ((n - start) * k) / steps));
            pendingInterp = 0;
        }
        out.push(n);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Material name classification (compact port of the geometry parser's logic)
// ---------------------------------------------------------------------------

function classifyMaterialName(zaids: number[], fracByZaid: Map<number, number>): string {
    const elems = new Set(zaids.map((z) => Math.floor(z / 1000)));
    const has = (z: number) => elems.has(z);
    if (has(92) || has(94)) {
        if (has(94)) return 'MOX';
        const u5 = fracByZaid.get(92235) ?? 0;
        const u8 = fracByZaid.get(92238) ?? 0;
        if (u5 > 0 && u5 + u8 > 0) return `UO2 ${((u5 / (u5 + u8)) * 100).toFixed(1)}%`;
        return 'UO2';
    }
    if (has(5) && has(6) && !has(26)) return 'B4C';
    if (has(47) || has(49)) return 'Ag-In-Cd';
    if (has(5) && has(14) && has(8) && has(13)) return 'Borosilicate glass';
    if ((has(26) && has(24)) || (has(28) && has(24)) || has(25)) return 'Steel';
    if (has(40)) return 'Zircaloy';
    if (has(1) && has(8)) return 'Water';
    if (has(2)) return 'Helium';
    if (has(7) && has(8)) return 'Air';
    if (has(8) && elems.size === 1) return 'Oxide';
    return 'material';
}

// ---------------------------------------------------------------------------
// Main index builder
// ---------------------------------------------------------------------------

interface CellRecord {
    id: number;
    line: number;
    matId: number;
    u: number | null;
    lat: number | null;
    boundingSurfaces: number[];
    hasFillArray: boolean;
}

export function buildMcnpReferenceIndex(text: string): McnpReferenceIndex {
    const cards = buildCards(text);
    const definitions = new Map<string, EntityDefinition>();
    const occurrences: Occurrence[] = [];
    const lattices: LatticeInfo[] = [];
    const cellRecords: CellRecord[] = [];
    // Track the first cell that declares each universe and the cells per universe.
    const universeFirstCell = new Map<number, number>();
    const universeCells = new Map<number, number[]>();
    const universeIsLattice = new Set<number>();

    const addDef = (def: EntityDefinition) => {
        const key = defKey(def.kind, def.id);
        if (!definitions.has(key)) definitions.set(key, def);
    };

    const intMatches = (card: Card, start: number, end: number): { value: number; span: SourceSpan }[] => {
        const sub = card.text.slice(start, end);
        const out: { value: number; span: SourceSpan }[] = [];
        const re = /-?\d+/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(sub)) !== null) {
            const s = start + m.index;
            const e = s + m[0].length;
            const span = spanAt(card, s, e);
            if (span) out.push({ value: parseInt(m[0], 10), span });
        }
        return out;
    };

    for (const card of cards) {
        const kind = classify(card.text);

        if (kind === 'material') {
            const m = card.text.match(/^\s*m(\d+)/i);
            if (!m) continue;
            const id = parseInt(m[1], 10);
            const idStart = card.text.toLowerCase().indexOf('m') + 1;
            const span = spanAt(card, idStart, idStart + m[1].length) ?? { line: card.firstLine, startCol: 0, endCol: 1 };
            // Collect ZAIDs + fractions for naming.
            const zaids: number[] = [];
            const fracByZaid = new Map<number, number>();
            const toks = card.text.trim().split(/\s+/);
            for (let i = 1; i < toks.length - 1; i++) {
                const zm = toks[i].match(/^(\d+)(?:\.\d+[a-z])?$/i);
                if (zm) {
                    const z = parseInt(zm[1], 10);
                    if (z >= 1000) {
                        zaids.push(z);
                        const frac = Number(toks[i + 1]);
                        if (!Number.isNaN(frac)) fracByZaid.set(z, Math.abs(frac));
                    }
                }
            }
            const name = classifyMaterialName(zaids, fracByZaid);
            addDef({ kind: 'material', id, ...span, summary: name, detail: firstLine(text, span.line) });
            occurrences.push({ kind: 'material', id, ...span, isDefinition: true });
            continue;
        }

        if (kind === 'matdata') {
            // mt{n}/mx{n}: a reference to material n, never a definition. Only the
            // digits of the material number are the entity span (mt16 → "16").
            const lead = (card.text.match(/^\s*(?:mt|mx)/i) ?? [''])[0].length;
            const numMatch = card.text.slice(lead).match(/^\d+/);
            if (numMatch) {
                const id = parseInt(numMatch[0], 10);
                const span = spanAt(card, lead, lead + numMatch[0].length);
                if (span) occurrences.push({ kind: 'material', id, ...span, isDefinition: false });
            }
            continue;
        }

        if (kind === 'transform') {
            const lead = (card.text.match(/^\s*\*?tr/i) ?? [''])[0].length;
            const numMatch = card.text.slice(lead).match(/^\d+/);
            if (numMatch) {
                const id = parseInt(numMatch[0], 10);
                const span = spanAt(card, lead, lead + numMatch[0].length)
                    ?? { line: card.firstLine, startCol: 0, endCol: 1 };
                addDef({ kind: 'transform', id, ...span, summary: 'transformation', detail: firstLine(text, span.line) });
                occurrences.push({ kind: 'transform', id, ...span, isDefinition: true });
            }
            continue;
        }

        if (kind === 'surface') {
            const toks = card.text.trim().split(/\s+/);
            const idTok = toks[0].replace(/^\*/, '');
            const id = parseInt(idTok, 10);
            if (Number.isNaN(id)) continue;
            let idx = 1;
            if (/^\d+$/.test(toks[1] ?? '') && SURFACE_MNEMONICS.has((toks[2] ?? '').toLowerCase())) idx = 2;
            const mnemonic = (toks[idx] ?? '').toLowerCase();
            const params = toks.slice(idx + 1).join(' ');
            const idStart = card.text.indexOf(toks[0]);
            const span = spanAt(card, idStart, idStart + toks[0].length) ?? { line: card.firstLine, startCol: 0, endCol: 1 };
            const summary = params ? `${mnemonic} ${params}`.trim() : mnemonic;
            addDef({ kind: 'surface', id, ...span, summary, detail: firstLine(text, span.line) });
            occurrences.push({ kind: 'surface', id, ...span, isDefinition: true });
            // Optional transform number between the surface id and its mnemonic
            // (e.g. "3 1 cz 0.5" → surface 3 uses transform 1).
            if (idx === 2) {
                const trTok = toks[1];
                const trId = parseInt(trTok, 10);
                const trStart = card.text.indexOf(trTok, idStart + toks[0].length);
                const trSpan = spanAt(card, trStart, trStart + trTok.length);
                if (!Number.isNaN(trId) && trSpan) {
                    occurrences.push({ kind: 'transform', id: trId, ...trSpan, isDefinition: false });
                }
            }
            continue;
        }

        if (kind !== 'cell') continue;

        // --- Cell card -----------------------------------------------------
        const toks = card.text.trim().split(/\s+/);
        const id = parseInt(toks[0], 10);
        if (Number.isNaN(id)) continue;
        const matId = parseInt(toks[1], 10);

        const idStart = card.text.indexOf(toks[0]);
        const idSpan = spanAt(card, idStart, idStart + toks[0].length) ?? { line: card.firstLine, startCol: 0, endCol: 1 };
        addDef({ kind: 'cell', id, ...idSpan, summary: cellSummary(card.text), detail: firstLine(text, idSpan.line) });
        occurrences.push({ kind: 'cell', id, ...idSpan, isDefinition: true });

        // Material reference (2nd token), skipping void (0).
        if (!Number.isNaN(matId) && matId !== 0) {
            const matStart = card.text.indexOf(toks[1], idStart + toks[0].length);
            const matSpan = spanAt(card, matStart, matStart + toks[1].length);
            if (matSpan) occurrences.push({ kind: 'material', id: matId, ...matSpan, isDefinition: false, cellContext: id });
        }

        // Geometry section: from after material(+density) to the first key=.
        const gStart = matId !== 0 ? indexOfToken(card.text, toks, idStart, 3) : indexOfToken(card.text, toks, idStart, 2);
        const keyMatch = /\b(u|lat|fill|trcl|tmp|imp|vol|pwt|ext|fcl|wwn|dxc|nonu|pd|u=)\b\s*=|imp:[a-z]/i.exec(card.text);
        const gEnd = keyMatch ? keyMatch.index : card.text.length;
        // Strip cell-complement (#n / #(...)) before pulling surface ids.
        const boundingSurfaces: number[] = [];
        if (gStart >= 0 && gEnd > gStart) {
            const cleaned = blankOut(card.text, gStart, gEnd);
            for (const { value, span } of intMatches({ ...card, text: cleaned }, gStart, gEnd)) {
                const sid = Math.abs(value);
                if (sid === 0) continue;
                boundingSurfaces.push(sid);
                occurrences.push({ kind: 'surface', id: sid, ...span, isDefinition: false, cellContext: id });
            }
        }

        // Parameters: u=, lat=, fill=.
        const params = scanParams(card);
        let u: number | null = null;
        let lat: number | null = null;
        let hasFillArray = false;

        if (params.u) {
            u = params.u.value;
            const isFirst = !universeFirstCell.has(u);
            if (isFirst) universeFirstCell.set(u, id);
            occurrences.push({ kind: 'universe', id: u, ...params.u.span, isDefinition: isFirst, cellContext: id });
            if (!universeCells.has(u)) universeCells.set(u, []);
            universeCells.get(u)!.push(id);
        }
        if (params.lat) lat = params.lat.value;
        if (lat !== null && u !== null) universeIsLattice.add(u);

        if (params.trcl) {
            occurrences.push({ kind: 'transform', id: params.trcl.value, ...params.trcl.span, isDefinition: false, cellContext: id });
        }

        if (params.fillSingle) {
            occurrences.push({ kind: 'universe', id: params.fillSingle.value, ...params.fillSingle.span, isDefinition: false, cellContext: id });
        }
        if (params.fillArray) {
            hasFillArray = true;
            const counts = new Map<number, number>();
            for (const entry of params.fillArray.entries) {
                occurrences.push({ kind: 'universe', id: entry.value, ...entry.span, isDefinition: false, cellContext: id });
            }
            for (const v of params.fillArray.expanded) {
                if (v === 0) continue;
                counts.set(v, (counts.get(v) ?? 0) + 1);
            }
            lattices.push({
                cellId: id,
                line: idSpan.line,
                lat: lat ?? 1,
                universeCounts: counts,
                boundingSurfaces: [...new Set(boundingSurfaces)],
                nx: params.fillArray.nx,
                ny: params.fillArray.ny,
                nz: params.fillArray.nz,
            });
        }

        cellRecords.push({ id, line: idSpan.line, matId, u, lat, boundingSurfaces, hasFillArray });
    }

    // Universe definitions + summaries (after all cells are known).
    for (const [uid, firstCell] of universeFirstCell) {
        const cellsIn = universeCells.get(uid) ?? [];
        const role = universeRole(uid, cellsIn, cellRecords, definitions, universeIsLattice.has(uid));
        // Find the canonical definition occurrence to anchor go-to-definition.
        const defOcc = occurrences.find((o) => o.kind === 'universe' && o.id === uid && o.isDefinition);
        const span: SourceSpan = defOcc ?? { line: 0, startCol: 0, endCol: 1 };
        addDef({
            kind: 'universe', id: uid, ...span,
            summary: role,
            detail: `universe ${uid} — defined at cell ${firstCell}`,
        });
    }

    return { definitions, occurrences, lattices };
}

// ---------------------------------------------------------------------------
// Parameter scanning (u= / lat= / fill=) with positions
// ---------------------------------------------------------------------------

interface ParamScan {
    u?: { value: number; span: SourceSpan };
    lat?: { value: number; span: SourceSpan };
    fillSingle?: { value: number; span: SourceSpan };
    fillArray?: { entries: { value: number; span: SourceSpan }[]; expanded: number[]; nx: number; ny: number; nz: number };
    trcl?: { value: number; span: SourceSpan };
}

function scanParams(card: Card): ParamScan {
    const out: ParamScan = {};
    const text = card.text;

    // trcl=N / *trcl=N: reference to a tr{n} card. The inline-array form
    // (trcl=(dx dy dz …)) defines a transform in place and references nothing,
    // so we only capture the bare-integer form (digit immediately after "=").
    const trclMatch = /\*?trcl\s*=\s*(\d+)/i.exec(text);
    if (trclMatch) {
        const numStart = trclMatch.index + trclMatch[0].length - trclMatch[1].length;
        const span = spanAt(card, numStart, numStart + trclMatch[1].length);
        if (span) out.trcl = { value: parseInt(trclMatch[1], 10), span };
    }

    // Locate u= / lat= / fill= keys and their value start offsets.
    const keyRe = /\b(u|lat|fill)\b\s*=\s*/gi;
    const keys: { key: string; valStart: number; matchStart: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = keyRe.exec(text)) !== null) {
        keys.push({ key: m[1].toLowerCase(), valStart: m.index + m[0].length, matchStart: m.index });
    }
    const intsIn = (start: number, end: number) => {
        const out2: { value: number; span: SourceSpan }[] = [];
        const sub = text.slice(start, end);
        const re = /-?\d+/g;
        let mm: RegExpExecArray | null;
        while ((mm = re.exec(sub)) !== null) {
            const s = start + mm.index;
            const span = spanAt(card, s, s + mm[0].length);
            if (span) out2.push({ value: parseInt(mm[0], 10), span });
        }
        return out2;
    };

    for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const valEnd = i + 1 < keys.length ? keys[i + 1].matchStart : text.length;
        if (k.key === 'u') {
            const ints = intsIn(k.valStart, valEnd);
            if (ints.length) out.u = ints[0];
        } else if (k.key === 'lat') {
            const ints = intsIn(k.valStart, valEnd);
            if (ints.length) out.lat = ints[0];
        } else if (k.key === 'fill') {
            const valText = text.slice(k.valStart, valEnd);
            const rangeRe = /^\s*-?\d+\s*:\s*-?\d+/;
            if (rangeRe.test(valText)) {
                // Array fill: i1:i2 j1:j2 k1:k2 then universe entries.
                const ranges = [...valText.matchAll(/(-?\d+)\s*:\s*(-?\d+)/g)].slice(0, 3);
                let nx = 1, ny = 1, nz = 1;
                if (ranges[0]) nx = parseInt(ranges[0][2], 10) - parseInt(ranges[0][1], 10) + 1;
                if (ranges[1]) ny = parseInt(ranges[1][2], 10) - parseInt(ranges[1][1], 10) + 1;
                if (ranges[2]) nz = parseInt(ranges[2][2], 10) - parseInt(ranges[2][1], 10) + 1;
                // Universe entries start after the last range pair.
                let afterRanges = k.valStart;
                const lastRange = ranges[ranges.length - 1];
                if (lastRange && lastRange.index !== undefined) {
                    afterRanges = k.valStart + lastRange.index + lastRange[0].length;
                }
                // Collect literal entry tokens (positions) — only plain integers
                // are universe references; nR/nI/nJ shorthand is expansion only.
                const entries: { value: number; span: SourceSpan }[] = [];
                const entrySub = text.slice(afterRanges, valEnd);
                const tokRe = /\S+/g;
                let tm: RegExpExecArray | null;
                const rawToks: string[] = [];
                while ((tm = tokRe.exec(entrySub)) !== null) {
                    rawToks.push(tm[0]);
                    if (/^-?\d+$/.test(tm[0])) {
                        const s = afterRanges + tm.index;
                        const span = spanAt(card, s, s + tm[0].length);
                        if (span) entries.push({ value: parseInt(tm[0], 10), span });
                    }
                }
                const expanded = expandRepeats(rawToks);
                out.fillArray = { entries, expanded, nx, ny, nz };
            } else {
                const ints = intsIn(k.valStart, valEnd);
                if (ints.length) out.fillSingle = ints[0];
            }
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function firstLine(text: string, line: number): string {
    return (text.split(/\r?\n/)[line] ?? '').trim();
}

function indexOfToken(text: string, toks: string[], from: number, tokenIndex: number): number {
    let pos = from;
    for (let i = 0; i <= tokenIndex && i < toks.length; i++) {
        pos = text.indexOf(toks[i], i === 0 ? from : pos);
        if (i < tokenIndex) pos += toks[i].length;
    }
    return pos;
}

/** Replaces #n and #(...) complement spans with spaces (keeping offsets). */
function blankOut(text: string, start: number, end: number): string {
    const chars = text.split('');
    const region = text.slice(start, end);
    const re = /#\s*\([^)]*\)|#\d+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(region)) !== null) {
        for (let i = 0; i < m[0].length; i++) chars[start + m.index + i] = ' ';
    }
    return chars.join('');
}

function cellSummary(text: string): string {
    const toks = text.trim().split(/\s+/);
    const mat = toks[1];
    const u = text.match(/\bu\s*=\s*(\d+)/i);
    const fill = text.match(/\bfill\s*=\s*(-?\d+)/i);
    const lat = text.match(/\blat\s*=\s*(\d+)/i);
    const parts: string[] = [mat === '0' ? 'void' : `mat ${mat}`];
    if (u) parts.push(`u=${u[1]}`);
    if (lat) parts.push(`lat=${lat[1]}`);
    if (fill) parts.push(`fill=${fill[1]}`);
    else if (/\bfill\s*=/.test(text)) parts.push('fill=array');
    return parts.join(', ');
}

function universeRole(
    uid: number,
    cellsIn: number[],
    cellRecords: CellRecord[],
    definitions: Map<string, EntityDefinition>,
    isLattice: boolean,
): string {
    if (isLattice) return 'lattice universe';
    const recs = cellRecords.filter((r) => cellsIn.includes(r.id));
    const matNames = recs
        .map((r) => definitions.get(defKey('material', r.matId))?.summary ?? (r.matId === 0 ? 'void' : ''))
        .filter(Boolean);
    if (matNames.some((n) => /UO2|MOX/i.test(n))) return 'fuel pin';
    const hasZr = matNames.some((n) => /Zircaloy|Steel/i.test(n));
    const innerVoid = matNames.some((n) => /Air|void/i.test(n));
    if (hasZr && innerVoid) return 'instrument tube';
    if (hasZr) return 'guide tube';
    if (matNames.some((n) => /B4C|Ag-In-Cd|Borosilicate/i.test(n))) return 'absorber';
    if (matNames.length) return matNames[0] + ' pin';
    return 'universe';
}

// ---------------------------------------------------------------------------
// Query helpers (used by the providers and the tree view)
// ---------------------------------------------------------------------------

export function resolveAt(index: McnpReferenceIndex, line: number, character: number): Occurrence | null {
    let best: Occurrence | null = null;
    for (const o of index.occurrences) {
        if (o.line !== line) continue;
        if (character >= o.startCol && character < o.endCol) {
            // Prefer the most specific (shortest) span if several overlap.
            if (!best || (o.endCol - o.startCol) < (best.endCol - best.startCol)) best = o;
        }
    }
    return best;
}

/** Alias used by providers/tests — entity (kind + id) at a source position. */
export const entityAtPosition = resolveAt;

/** Role-aware highlight/reference set for the entity under the cursor. */
export function getHighlightOccurrences(
    index: McnpReferenceIndex,
    line: number,
    character: number,
): Occurrence[] {
    const occ = resolveAt(index, line, character);
    if (!occ) return [];
    return getReferences(index, occ.kind, occ.id, true);
}

export function getDefinition(index: McnpReferenceIndex, kind: McnpEntityKind, id: number): EntityDefinition | undefined {
    return index.definitions.get(defKey(kind, id));
}

export function getOccurrences(index: McnpReferenceIndex, kind: McnpEntityKind, id: number): Occurrence[] {
    return index.occurrences.filter((o) => o.kind === kind && o.id === id);
}

export function getReferences(index: McnpReferenceIndex, kind: McnpEntityKind, id: number, includeDefinition: boolean): Occurrence[] {
    return index.occurrences.filter((o) => o.kind === kind && o.id === id && (includeDefinition || !o.isDefinition));
}

const KIND_LABEL: Record<McnpEntityKind, string> = {
    cell: 'Cell', surface: 'Surface', material: 'Material', universe: 'Universe', transform: 'Transform',
};

/** Builds the hover/markdown body for the entity an occurrence points at. */
export function describeEntity(index: McnpReferenceIndex, occ: Occurrence): string {
    const def = getDefinition(index, occ.kind, occ.id);
    const refs = getReferences(index, occ.kind, occ.id, false);
    const label = KIND_LABEL[occ.kind];
    const lines: string[] = [];
    if (def) {
        const where = occ.kind === 'material' ? `m${occ.id}, line ${def.line + 1}`
            : occ.kind === 'universe' ? `${def.detail.replace(/^universe \d+ — /, '')}, line ${def.line + 1}`
            : `line ${def.line + 1}`;
        lines.push(`**${label} ${occ.id}** — ${def.summary} (${where})`);
        if (occ.kind !== 'universe') lines.push('```mcnp\n' + def.detail + '\n```');
    } else {
        lines.push(`**${label} ${occ.id}** — definition not found in this file`);
    }
    const refCount = refs.length;
    lines.push(`_${refCount} reference${refCount === 1 ? '' : 's'} in this file._`);

    if (occ.kind === 'universe') {
        const lat = index.lattices.find((l) => {
            // A lattice that fills this universe is interesting context.
            return l.universeCounts.has(occ.id);
        });
        if (lat) lines.push(`Used in the lattice in cell ${lat.cellId} (${lat.universeCounts.get(occ.id)} position(s)).`);
    }
    return lines.join('\n\n');
}

/** Human-readable lattice decode for the tree view / command output. */
export function describeLattice(index: McnpReferenceIndex, lat: LatticeInfo): string[] {
    const lines: string[] = [];
    lines.push(`Lattice in cell ${lat.cellId} (lat=${lat.lat}, ${lat.lat === 2 ? 'hex' : 'square'}), grid ${lat.nx}×${lat.ny}${lat.nz > 1 ? `×${lat.nz}` : ''}`);
    if (lat.boundingSurfaces.length) {
        const surfs = lat.boundingSurfaces.map((s) => {
            const d = getDefinition(index, 'surface', s);
            return d ? `${s} (${d.summary})` : `${s}`;
        });
        lines.push(`Unit-cell bounding surfaces: ${surfs.join(', ')}`);
    }
    const sorted = [...lat.universeCounts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [uid, count] of sorted) {
        const d = getDefinition(index, 'universe', uid);
        const role = d ? d.summary : 'universe';
        const at = d ? `, defined at line ${d.line + 1}` : '';
        lines.push(`  • universe ${uid} — ${role} ×${count}${at}`);
    }
    return lines;
}
