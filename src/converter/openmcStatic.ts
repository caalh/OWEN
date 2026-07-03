// Static (no-execution) parser: flat OpenMC Python scripts -> TracedModel.
//
// Handles literal, statement-per-line scripts — everything OWEN's own
// MCNP→OpenMC converter emits, plus typical hand-written pin cells and
// assemblies: surfaces (incl. openmc.model composites), region expressions
// with & | ~ and parentheses, cells, universes, rect/hex lattices with
// literal universe arrays, settings and mesh/cell tallies. Scripts that build
// geometry with functions/loops/comprehensions need the Python trace harness
// (traceHarness.ts) instead; this parser reports what it could not interpret.

import {
    TracedModel, TSurface, TMaterial, TCell, TUniverse, TLattice, TRegion, TSettings, TTally,
} from './tracedModel';

interface StaticParseResult {
    model: TracedModel;
    /** Lines the parser could not interpret as geometry-relevant statements. */
    unparsed: Array<{ line: number; text: string; reason: string }>;
    /** True when the script contains dynamic constructs (def/for/comprehension). */
    dynamic: boolean;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Join physical lines into logical statements by bracket balance. */
function logicalLines(text: string): Array<{ text: string; line: number }> {
    const out: Array<{ text: string; line: number }> = [];
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    let buf = '';
    let start = 0;
    let depth = 0;
    for (let i = 0; i < lines.length; i++) {
        let ln = lines[i];
        // strip comments (naive: assumes no '#' inside strings except color hex — fine here)
        const hash = findCommentStart(ln);
        if (hash !== -1) ln = ln.slice(0, hash);
        if (!buf) { start = i; }
        buf += (buf ? ' ' : '') + ln.trim();
        for (const ch of ln) {
            if (ch === '(' || ch === '[' || ch === '{') depth++;
            else if (ch === ')' || ch === ']' || ch === '}') depth--;
        }
        if (depth <= 0) {
            const t = buf.trim();
            if (t) out.push({ text: t, line: start });
            buf = '';
            depth = 0;
        }
    }
    if (buf.trim()) out.push({ text: buf.trim(), line: start });
    return out;
}

function findCommentStart(line: string): number {
    let inStr: string | null = null;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inStr) {
            if (ch === inStr && line[i - 1] !== '\\') inStr = null;
        } else if (ch === '"' || ch === "'") {
            inStr = ch;
        } else if (ch === '#') {
            return i;
        }
    }
    return -1;
}

/** Split a call-argument string at top-level commas. */
function splitArgs(argstr: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let cur = '';
    let inStr: string | null = null;
    for (const ch of argstr) {
        if (inStr) {
            cur += ch;
            if (ch === inStr) inStr = null;
            continue;
        }
        if (ch === '"' || ch === "'") { inStr = ch; cur += ch; continue; }
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        if (ch === ')' || ch === ']' || ch === '}') depth--;
        if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
        cur += ch;
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts;
}

interface CallArgs { positional: string[]; kw: Map<string, string> }

function parseCallArgs(argstr: string): CallArgs {
    const positional: string[] = [];
    const kw = new Map<string, string>();
    for (const part of splitArgs(argstr)) {
        const m = /^(\w+)\s*=\s*([\s\S]+)$/.exec(part);
        if (m && !/^[=<>!]/.test(part.slice(m[1].length).trimStart().slice(1))) {
            kw.set(m[1], m[2].trim());
        } else {
            positional.push(part);
        }
    }
    return { positional, kw };
}

// ---------------------------------------------------------------------------
// numeric environment
// ---------------------------------------------------------------------------

class NumEnv {
    private vars = new Map<string, number>();

    set(name: string, value: number): void {
        this.vars.set(name, value);
    }

    /** Evaluate a numeric Python expression over known scalar vars; null if not numeric. */
    eval(expr: string): number | null {
        let e = expr.trim().replace(/,$/, '');
        if (!e) return null;
        // substitute known variables (longest first)
        const names = [...this.vars.keys()].sort((a, b) => b.length - a.length);
        for (const n of names) {
            e = e.replace(new RegExp(`\\b${n}\\b`, 'g'), `(${this.vars.get(n)})`);
        }
        e = e.replace(/math\.sqrt\(/g, 'Math.sqrt(').replace(/math\.pi/g, 'Math.PI');
        if (!/^[-+*/()\d.eE\sMathsqrtPI,]*$/.test(e) || /[a-zA-Z_]\w*/.test(e.replace(/Math\.(sqrt|PI)/g, ''))) {
            return null;
        }
        try {
            // eslint-disable-next-line no-new-func
            const v = Function(`"use strict"; return (${e});`)() as number;
            return Number.isFinite(v) ? v : null;
        } catch {
            return null;
        }
    }

    /** Parse a Python tuple/list of numeric expressions. */
    evalTuple(expr: string): number[] | null {
        const m = /^[([]([\s\S]*)[)\]]$/.exec(expr.trim());
        if (!m) {
            const single = this.eval(expr);
            return single !== null ? [single] : null;
        }
        const parts = splitArgs(m[1]);
        const out: number[] = [];
        for (const p of parts) {
            if (!p) continue;
            const v = this.eval(p);
            if (v === null) return null;
            out.push(v);
        }
        return out;
    }
}

// ---------------------------------------------------------------------------
// surface construction (mirrors the Python trace harness expansions)
// ---------------------------------------------------------------------------

class Builder {
    surfaces: TSurface[] = [];
    materials: TMaterial[] = [];
    cells: TCell[] = [];
    universes: TUniverse[] = [];
    lattices: TLattice[] = [];
    warnings: string[] = [];
    private ids = { surface: 0, material: 0, cell: 0, universe: 0, lattice: 0 };

    nextId(kind: keyof Builder['ids'], given?: number | null): number {
        if (given !== undefined && given !== null && Number.isFinite(given)) {
            this.ids[kind] = Math.max(this.ids[kind], given);
            return given;
        }
        return ++this.ids[kind];
    }

    addSurface(type: string, coeffs: number[], boundary: string, id?: number | null): TSurface {
        const s: TSurface = { id: this.nextId('surface', id), type, coeffs, boundary };
        this.surfaces.push(s);
        return s;
    }
}

const half = (s: TSurface, side: 1 | -1): TRegion => ({ k: 'h', s: s.id, side });
const inter = (c: TRegion[]): TRegion => ({ k: '&', c });

/**
 * Value bound to a script variable: a primitive surface (supports -x/+x), a
 * composite (inside/outside region templates), or an already-built region.
 */
type BoundValue =
    | { kind: 'surface'; surface: TSurface }
    | { kind: 'composite'; inside: TRegion }
    | { kind: 'region'; region: TRegion }
    | { kind: 'material'; id: number }
    | { kind: 'cell'; id: number }
    | { kind: 'universe'; id: number }
    | { kind: 'lattice'; id: number }
    | { kind: 'mesh'; mesh: { dimension: number[]; lowerLeft: number[]; upperRight: number[] } }
    | { kind: 'tally'; tally: TTally };

function makeSurfaceValue(
    cls: string,
    args: CallArgs,
    env: NumEnv,
    b: Builder,
): BoundValue | null {
    const kwNum = (name: string, dflt = 0): number => {
        const raw = args.kw.get(name);
        if (raw === undefined) return dflt;
        return env.eval(raw) ?? dflt;
    };
    const posOrKw = (idx: number, name: string, dflt = 0): number => {
        if (args.positional.length > idx) return env.eval(args.positional[idx]) ?? dflt;
        return kwNum(name, dflt);
    };
    const boundary = (args.kw.get('boundary_type') ?? "'transmission'").replace(/['"]/g, '');
    const sid = args.kw.has('surface_id') ? env.eval(args.kw.get('surface_id')!) : null;

    switch (cls) {
        case 'XPlane': return { kind: 'surface', surface: b.addSurface('px', [posOrKw(0, 'x0')], boundary, sid) };
        case 'YPlane': return { kind: 'surface', surface: b.addSurface('py', [posOrKw(0, 'y0')], boundary, sid) };
        case 'ZPlane': return { kind: 'surface', surface: b.addSurface('pz', [posOrKw(0, 'z0')], boundary, sid) };
        case 'Plane':
            return {
                kind: 'surface',
                surface: b.addSurface('p', [posOrKw(0, 'a', 1), posOrKw(1, 'b'), posOrKw(2, 'c'), posOrKw(3, 'd')], boundary, sid),
            };
        case 'Sphere': {
            const x0 = kwNum('x0'), y0 = kwNum('y0'), z0 = kwNum('z0'), r = posOrKw(0, 'r', 1);
            return {
                kind: 'surface',
                surface: x0 === 0 && y0 === 0 && z0 === 0
                    ? b.addSurface('so', [r], boundary, sid)
                    : b.addSurface('s', [x0, y0, z0, r], boundary, sid),
            };
        }
        case 'XCylinder': {
            const y0 = kwNum('y0'), z0 = kwNum('z0'), r = kwNum('r', posOrKw(0, 'r', 1));
            return {
                kind: 'surface',
                surface: y0 === 0 && z0 === 0 ? b.addSurface('cx', [r], boundary, sid) : b.addSurface('c/x', [y0, z0, r], boundary, sid),
            };
        }
        case 'YCylinder': {
            const x0 = kwNum('x0'), z0 = kwNum('z0'), r = kwNum('r', posOrKw(0, 'r', 1));
            return {
                kind: 'surface',
                surface: x0 === 0 && z0 === 0 ? b.addSurface('cy', [r], boundary, sid) : b.addSurface('c/y', [x0, z0, r], boundary, sid),
            };
        }
        case 'ZCylinder': {
            const x0 = kwNum('x0'), y0 = kwNum('y0'), r = kwNum('r', posOrKw(0, 'r', 1));
            return {
                kind: 'surface',
                surface: x0 === 0 && y0 === 0 ? b.addSurface('cz', [r], boundary, sid) : b.addSurface('c/z', [x0, y0, r], boundary, sid),
            };
        }
        case 'XCone': case 'YCone': case 'ZCone': {
            const axis = cls[0].toLowerCase();
            const x0 = kwNum('x0'), y0 = kwNum('y0'), z0 = kwNum('z0'), r2 = kwNum('r2', 1);
            const apex = axis === 'x' ? x0 : axis === 'y' ? y0 : z0;
            const others = axis === 'x' ? y0 === 0 && z0 === 0 : axis === 'y' ? x0 === 0 && z0 === 0 : x0 === 0 && y0 === 0;
            return {
                kind: 'surface',
                surface: others
                    ? b.addSurface(`k${axis}`, [apex, r2], boundary, sid)
                    : b.addSurface(`k/${axis}`, [x0, y0, z0, r2], boundary, sid),
            };
        }
        case 'Quadric': {
            const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'j', 'k'];
            return { kind: 'surface', surface: b.addSurface('gq', names.map((n, i) => posOrKw(i, n)), boundary, sid) };
        }
        case 'XTorus': case 'YTorus': case 'ZTorus': {
            const t = `t${cls[0].toLowerCase()}`;
            return {
                kind: 'surface',
                surface: b.addSurface(t, [kwNum('x0'), kwNum('y0'), kwNum('z0'), kwNum('a'), kwNum('b'), kwNum('c')], boundary, sid),
            };
        }
        // --- openmc.model composites ---
        case 'RectangularPrism': {
            const width = posOrKw(0, 'width', 1);
            const height = posOrKw(1, 'height', 1);
            const origin = args.kw.has('origin') ? env.evalTuple(args.kw.get('origin')!) ?? [0, 0] : [0, 0];
            const axis = (args.kw.get('axis') ?? "'z'").replace(/['"]/g, '');
            const mk = (t1: 'px' | 'py' | 'pz', t2: 'px' | 'py' | 'pz') => {
                const s1 = b.addSurface(t1, [origin[0] - width / 2], boundary);
                const s2 = b.addSurface(t1, [origin[0] + width / 2], boundary);
                const s3 = b.addSurface(t2, [origin[1] - height / 2], boundary);
                const s4 = b.addSurface(t2, [origin[1] + height / 2], boundary);
                return inter([half(s1, 1), half(s2, -1), half(s3, 1), half(s4, -1)]);
            };
            const inside = axis === 'z' ? mk('px', 'py') : axis === 'y' ? mk('px', 'pz') : mk('py', 'pz');
            return { kind: 'composite', inside };
        }
        case 'RectangularParallelepiped': {
            const names = ['xmin', 'xmax', 'ymin', 'ymax', 'zmin', 'zmax'];
            const vals = names.map((n, i) => posOrKw(i, n));
            const sx1 = b.addSurface('px', [vals[0]], boundary, null);
            const sx2 = b.addSurface('px', [vals[1]], boundary, null);
            const sy1 = b.addSurface('py', [vals[2]], boundary, null);
            const sy2 = b.addSurface('py', [vals[3]], boundary, null);
            const sz1 = b.addSurface('pz', [vals[4]], boundary, null);
            const sz2 = b.addSurface('pz', [vals[5]], boundary, null);
            return {
                kind: 'composite',
                inside: inter([half(sx1, 1), half(sx2, -1), half(sy1, 1), half(sy2, -1), half(sz1, 1), half(sz2, -1)]),
            };
        }
        case 'RightCircularCylinder': {
            const base = args.positional.length > 0 ? env.evalTuple(args.positional[0]) : env.evalTuple(args.kw.get('center_base') ?? '');
            const height = posOrKw(1, 'height', 1);
            const radius = posOrKw(2, 'radius', 1);
            const axis = (args.kw.get('axis') ?? "'z'").replace(/['"]/g, '');
            if (!base || base.length < 3) return null;
            const [x0, y0, z0] = base;
            let cyl: TSurface, lo: TSurface, hi: TSurface;
            if (axis === 'z') {
                cyl = x0 === 0 && y0 === 0 ? b.addSurface('cz', [radius], boundary) : b.addSurface('c/z', [x0, y0, radius], boundary);
                lo = b.addSurface('pz', [z0], boundary); hi = b.addSurface('pz', [z0 + height], boundary);
            } else if (axis === 'y') {
                cyl = x0 === 0 && z0 === 0 ? b.addSurface('cy', [radius], boundary) : b.addSurface('c/y', [x0, z0, radius], boundary);
                lo = b.addSurface('py', [y0], boundary); hi = b.addSurface('py', [y0 + height], boundary);
            } else {
                cyl = y0 === 0 && z0 === 0 ? b.addSurface('cx', [radius], boundary) : b.addSurface('c/x', [y0, z0, radius], boundary);
                lo = b.addSurface('px', [x0], boundary); hi = b.addSurface('px', [x0 + height], boundary);
            }
            return { kind: 'composite', inside: inter([half(cyl, -1), half(lo, 1), half(hi, -1)]) };
        }
        case 'HexagonalPrism': {
            const edge = kwNum('edge_length', 1);
            const orientation = (args.kw.get('orientation') ?? "'y'").replace(/['"]/g, '');
            const origin = args.kw.has('origin') ? env.evalTuple(args.kw.get('origin')!) ?? [0, 0] : [0, 0];
            const a = (edge * Math.sqrt(3)) / 2;
            const baseAng = orientation === 'x' ? 0 : 30;
            const halves: TRegion[] = [];
            for (let i = 0; i < 6; i++) {
                const ang = ((baseAng + 60 * i) * Math.PI) / 180;
                const nx = Math.cos(ang), ny = Math.sin(ang);
                const d = a + nx * origin[0] + ny * origin[1];
                const s = b.addSurface('p', [nx, ny, 0, d], boundary);
                halves.push(half(s, -1));
            }
            return { kind: 'composite', inside: inter(halves) };
        }
        case 'XConeOneSided': case 'YConeOneSided': case 'ZConeOneSided': {
            const axis = cls[0].toLowerCase();
            const x0 = kwNum('x0'), y0 = kwNum('y0'), z0 = kwNum('z0'), r2 = kwNum('r2', 1);
            const up = (args.kw.get('up') ?? 'True').trim() !== 'False';
            const apex = axis === 'x' ? x0 : axis === 'y' ? y0 : z0;
            const onAxis = axis === 'x' ? y0 === 0 && z0 === 0 : axis === 'y' ? x0 === 0 && z0 === 0 : x0 === 0 && y0 === 0;
            const cone = onAxis
                ? b.addSurface(`k${axis}`, [apex, r2], boundary)
                : b.addSurface(`k/${axis}`, [x0, y0, z0, r2], boundary);
            const plane = b.addSurface(`p${axis}`, [apex], boundary);
            return { kind: 'composite', inside: inter([half(cone, -1), half(plane, up ? 1 : -1)]) };
        }
        default:
            return null;
    }
}

// ---------------------------------------------------------------------------
// region expression parsing
// ---------------------------------------------------------------------------

function parseRegionExpr(expr: string, bindings: Map<string, BoundValue>): TRegion | null {
    // tokenize: names, operators & | ~ + -, parens
    const tokens: string[] = [];
    const re = /[\w.]+|[&|~+\-()]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(expr)) !== null) tokens.push(m[0]);
    let pos = 0;
    const peek = () => (pos < tokens.length ? tokens[pos] : null);

    function parseOr(): TRegion | null {
        let left = parseAnd();
        if (!left) return null;
        const parts = [left];
        while (peek() === '|') {
            pos++;
            const r = parseAnd();
            if (!r) return null;
            parts.push(r);
        }
        return parts.length === 1 ? parts[0] : { k: '|', c: parts };
    }

    function parseAnd(): TRegion | null {
        const left = parseUnary();
        if (!left) return null;
        const parts = [left];
        while (peek() === '&') {
            pos++;
            const r = parseUnary();
            if (!r) return null;
            parts.push(r);
        }
        return parts.length === 1 ? parts[0] : { k: '&', c: parts };
    }

    function parseUnary(): TRegion | null {
        const t = peek();
        if (t === '~') {
            pos++;
            const inner = parseUnary();
            return inner ? { k: '~', c: inner } : null;
        }
        if (t === '-' || t === '+') {
            pos++;
            const side: 1 | -1 = t === '-' ? -1 : 1;
            const inner = parseUnary();
            if (!inner) return null;
            // -surface halfspace: inner must be a full-space marker for a surface
            if (inner.k === 'h' && inner.side === 0 as unknown as 1) {
                return { k: 'h', s: inner.s, side };
            }
            // inner came back as the surface's default halfspace: flip if '-'
            if (inner.k === 'h') {
                return side === -1 ? { k: 'h', s: inner.s, side: -1 } : { k: 'h', s: inner.s, side: 1 };
            }
            // -composite = inside, +composite = outside; parseUnary of a composite
            // name returns its inside region, so '-' keeps it and '+' complements.
            return side === -1 ? inner : { k: '~', c: inner };
        }
        if (t === '(') {
            pos++;
            const inner = parseOr();
            if (peek() !== ')') return null;
            pos++;
            return inner;
        }
        if (t && /^[\w.]+$/.test(t)) {
            pos++;
            const v = bindings.get(t);
            if (!v) return null;
            if (v.kind === 'surface') return { k: 'h', s: v.surface.id, side: 1 };
            if (v.kind === 'composite') return v.inside;
            if (v.kind === 'region') return v.region;
            return null;
        }
        return null;
    }

    const r = parseOr();
    return pos === tokens.length ? r : null;
}

// ---------------------------------------------------------------------------
// universe array literals ([ [a, b], [c, d] ] possibly nested 3D / rings)
// ---------------------------------------------------------------------------

type NestedNames = string | NestedNames[];

function parseNestedList(expr: string): NestedNames | null {
    let pos = 0;
    const s = expr.trim();
    function skipWs() { while (pos < s.length && /[\s,]/.test(s[pos])) pos++; }
    function parseItem(): NestedNames | null {
        skipWs();
        if (s[pos] === '[') {
            pos++;
            const items: NestedNames[] = [];
            skipWs();
            while (pos < s.length && s[pos] !== ']') {
                const it = parseItem();
                if (it === null) return null;
                items.push(it);
                skipWs();
            }
            if (s[pos] !== ']') return null;
            pos++;
            return items;
        }
        const m = /^[\w.]+/.exec(s.slice(pos));
        if (!m) return null;
        pos += m[0].length;
        return m[0];
    }
    const r = parseItem();
    skipWs();
    return pos >= s.length ? r : null;
}

// ---------------------------------------------------------------------------
// main static parser
// ---------------------------------------------------------------------------

export function parseOpenmcStatic(text: string): StaticParseResult {
    const b = new Builder();
    const env = new NumEnv();
    const bindings = new Map<string, BoundValue>();
    const unparsed: Array<{ line: number; text: string; reason: string }> = [];
    const cellById = new Map<number, TCell>();
    const uniById = new Map<number, TUniverse>();
    const latById = new Map<number, TLattice>();
    const settings: TSettings = { sourcePoints: [] };
    const tallies: TTally[] = [];
    let rootUniverse: number | null = null;
    let rootCells: number[] = [];

    const dynamic = /^\s*(def |for |while |class )/m.test(text) || /\bfor\b[^\n]*\bin\b[^\n]*\]/.test(text);

    const uidOf = (name: string): number | null => {
        const v = bindings.get(name);
        if (!v) return null;
        if (v.kind === 'universe' || v.kind === 'lattice') return v.id;
        return null;
    };

    for (const ll of logicalLines(text)) {
        const t = ll.text;
        if (/^(import|from)\s/.test(t)) continue;
        if (/^(if|else|elif|try|except|finally|with|return|pass|print|sys\.)/.test(t)) continue;

        // --- attribute assignment: var.attr = value ---
        let m = /^([\w]+)\.(\w+)\s*=\s*([\s\S]+)$/.exec(t);
        if (m) {
            const [, name, attr, valueRaw] = m;
            const value = valueRaw.trim();
            if (name === 'settings') {
                if (attr === 'batches') { const v = env.eval(value); if (v !== null) settings.batches = v; continue; }
                if (attr === 'inactive') { const v = env.eval(value); if (v !== null) settings.inactive = v; continue; }
                if (attr === 'particles') { const v = env.eval(value); if (v !== null) settings.particles = v; continue; }
                if (attr === 'source') {
                    parseSources(value, env, settings);
                    continue;
                }
                continue; // run_mode / temperature / etc.
            }
            const bound = bindings.get(name);
            if (!bound) {
                // numeric attr on unknown object — ignore quietly
                continue;
            }
            if (bound.kind === 'cell') {
                const cell = cellById.get(bound.id)!;
                if (attr === 'region') {
                    const r = parseRegionExpr(value, bindings);
                    if (r) cell.region = r;
                    else unparsed.push({ line: ll.line, text: t, reason: 'region expression not statically resolvable' });
                } else if (attr === 'fill') {
                    const fv = bindings.get(value);
                    if (fv?.kind === 'material') cell.fill = { kind: 'material', id: fv.id };
                    else if (fv?.kind === 'universe') cell.fill = { kind: 'universe', id: fv.id };
                    else if (fv?.kind === 'lattice') cell.fill = { kind: 'lattice', id: fv.id };
                    else unparsed.push({ line: ll.line, text: t, reason: `fill '${value}' is not a known material/universe/lattice` });
                } else if (attr === 'temperature') {
                    const v = env.eval(value);
                    if (v !== null) cell.temperature = v;
                } else if (attr === 'translation') {
                    const v = env.evalTuple(value);
                    if (v) cell.translation = v;
                } else if (attr === 'rotation') {
                    const nested = parseNestedList(value);
                    if (Array.isArray(nested)) {
                        const rows = nested.map((row) => Array.isArray(row) ? row.map((x) => env.eval(x as string) ?? 0) : []);
                        if (rows.length === 3 && rows.every((r) => r.length === 3)) cell.rotation = rows;
                    }
                }
                continue;
            }
            if (bound.kind === 'lattice') {
                const lat = latById.get(bound.id)!;
                if (attr === 'lower_left') { const v = env.evalTuple(value); if (v) lat.lowerLeft = v; continue; }
                if (attr === 'pitch') { const v = env.evalTuple(value); if (v) lat.pitch = v; continue; }
                if (attr === 'center') { const v = env.evalTuple(value); if (v) lat.center = v; continue; }
                if (attr === 'orientation') { lat.orientation = value.replace(/['"]/g, ''); continue; }
                if (attr === 'outer') {
                    const uid = uidOf(value);
                    if (uid !== null) lat.outer = uid;
                    continue;
                }
                if (attr === 'universes') {
                    const nested = parseNestedList(value);
                    if (!nested || !Array.isArray(nested)) {
                        unparsed.push({ line: ll.line, text: t.slice(0, 120), reason: 'lattice universes array is not a literal nested list' });
                        continue;
                    }
                    if (lat.kind === 'rect') {
                        const resolved = resolveRectArray(nested, uidOf);
                        if (resolved) lat.universes = resolved;
                        else unparsed.push({ line: ll.line, text: t.slice(0, 120), reason: 'rect lattice array references unknown universes' });
                    } else {
                        const rings: number[][] = [];
                        let ok = true;
                        for (const ring of nested) {
                            if (!Array.isArray(ring)) { ok = false; break; }
                            const ids: number[] = [];
                            for (const it of ring) {
                                const uid = typeof it === 'string' ? uidOf(it) : null;
                                if (uid === null) { ok = false; break; }
                                ids.push(uid);
                            }
                            if (!ok) break;
                            rings.push(ids);
                        }
                        if (ok) lat.rings = rings;
                        else unparsed.push({ line: ll.line, text: t.slice(0, 120), reason: 'hex lattice rings reference unknown universes' });
                    }
                    continue;
                }
                continue;
            }
            if (bound.kind === 'mesh') {
                if (attr === 'dimension') { const v = env.evalTuple(value); if (v) bound.mesh.dimension = v; }
                if (attr === 'lower_left') { const v = env.evalTuple(value); if (v) bound.mesh.lowerLeft = v; }
                if (attr === 'upper_right') { const v = env.evalTuple(value); if (v) bound.mesh.upperRight = v; }
                continue;
            }
            if (bound.kind === 'tally') {
                if (attr === 'scores') {
                    const scores = [...value.matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
                    bound.tally.scores = scores;
                } else if (attr === 'filters') {
                    parseTallyFilters(value, bindings, bound.tally, cellById);
                }
                continue;
            }
            continue;
        }

        // --- method calls: mat.add_nuclide(...) / u.add_cell(...) ---
        m = /^([\w]+)\.(\w+)\(([\s\S]*)\)$/.exec(t);
        if (m) {
            const [, name, method, argstr] = m;
            const bound = bindings.get(name);
            if (bound?.kind === 'material') {
                const mat = b.materials.find((x) => x.id === bound.id)!;
                const args = parseCallArgs(argstr);
                if (method === 'add_nuclide') {
                    const nm = args.positional[0]?.replace(/['"]/g, '');
                    const frac = env.eval(args.positional[1] ?? '');
                    const type = (args.positional[2] ?? args.kw.get('percent_type') ?? "'ao'").replace(/['"]/g, '');
                    if (nm && frac !== null) mat.nuclides.push({ name: nm, frac, type });
                } else if (method === 'add_element') {
                    const nm = args.positional[0]?.replace(/['"]/g, '');
                    const frac = env.eval(args.positional[1] ?? '');
                    const type = (args.positional[2] ?? args.kw.get('percent_type') ?? "'ao'").replace(/['"]/g, '');
                    const enrich = args.kw.has('enrichment') ? env.eval(args.kw.get('enrichment')!) : null;
                    if (nm && frac !== null) mat.elements.push({ name: nm, frac, type, enrichment: enrich });
                } else if (method === 'set_density') {
                    const units = args.positional[0]?.replace(/['"]/g, '') ?? 'g/cm3';
                    const val = args.positional.length > 1 ? env.eval(args.positional[1]) : 0;
                    mat.density = { units, value: val ?? 0 };
                } else if (method === 'add_s_alpha_beta') {
                    const nm = args.positional[0]?.replace(/['"]/g, '');
                    if (nm) mat.sab.push(nm);
                }
                continue;
            }
            if (bound?.kind === 'universe' && method === 'add_cell') {
                const cv = bindings.get(argstr.trim());
                if (cv?.kind === 'cell') uniById.get(bound.id)!.cells.push(cv.id);
                continue;
            }
            continue;
        }

        // --- assignments: var = expr ---
        m = /^([\w]+)\s*=\s*([\s\S]+)$/.exec(t);
        if (m) {
            const [, name, rhsRaw] = m;
            const rhs = rhsRaw.trim();

            // numeric scalar
            const numVal = env.eval(rhs);
            if (numVal !== null && !/openmc\./.test(rhs)) {
                env.set(name, numVal);
                continue;
            }

            // openmc constructor calls
            const call = /^([-+~]?)\s*openmc\.(model\.)?(\w+)\(([\s\S]*)\)$/.exec(rhs);
            if (call) {
                const [, unary, , cls, argstr] = call;
                const args = parseCallArgs(argstr);
                switch (cls) {
                    case 'Material': {
                        const id = b.nextId('material', args.positional.length ? env.eval(args.positional[0]) : args.kw.has('material_id') ? env.eval(args.kw.get('material_id')!) : null);
                        const nm = (args.kw.get('name') ?? `'${name}'`).replace(/['"]/g, '');
                        b.materials.push({ id, name: nm, density: null, nuclides: [], elements: [], sab: [] });
                        bindings.set(name, { kind: 'material', id });
                        continue;
                    }
                    case 'Materials': continue;
                    case 'Cell': {
                        const id = b.nextId('cell', args.kw.has('cell_id') ? env.eval(args.kw.get('cell_id')!) : null);
                        const nm = (args.kw.get('name') ?? "''").replace(/['"]/g, '');
                        const cell: TCell = {
                            id, name: nm, fill: { kind: 'void', id: 0 }, region: null,
                            temperature: null, translation: null, rotation: null,
                        };
                        const fillName = args.kw.get('fill');
                        if (fillName && fillName !== 'None') {
                            const fv = bindings.get(fillName);
                            if (fv?.kind === 'material') cell.fill = { kind: 'material', id: fv.id };
                            else if (fv?.kind === 'universe') cell.fill = { kind: 'universe', id: fv.id };
                            else if (fv?.kind === 'lattice') cell.fill = { kind: 'lattice', id: fv.id };
                            else unparsed.push({ line: ll.line, text: t.slice(0, 120), reason: `cell fill '${fillName}' unknown` });
                        }
                        const regionExpr = args.kw.get('region');
                        if (regionExpr && regionExpr !== 'None') {
                            const r = parseRegionExpr(regionExpr, bindings);
                            if (r) cell.region = r;
                            else unparsed.push({ line: ll.line, text: t.slice(0, 120), reason: 'cell region not statically resolvable' });
                        }
                        b.cells.push(cell);
                        cellById.set(id, cell);
                        bindings.set(name, { kind: 'cell', id });
                        continue;
                    }
                    case 'Universe': {
                        const id = b.nextId('universe', args.kw.has('universe_id') ? env.eval(args.kw.get('universe_id')!) : null);
                        const nm = (args.kw.get('name') ?? "''").replace(/['"]/g, '');
                        const uni: TUniverse = { id, name: nm, cells: [] };
                        const cellsArg = args.kw.get('cells');
                        if (cellsArg) {
                            const nested = parseNestedList(cellsArg);
                            if (Array.isArray(nested)) {
                                for (const it of nested) {
                                    if (typeof it !== 'string') continue;
                                    // inline openmc.Cell(...) inside cells=[…] is handled below via regex
                                    const cv = bindings.get(it);
                                    if (cv?.kind === 'cell') uni.cells.push(cv.id);
                                }
                            }
                            // inline cell constructors: cells=[openmc.Cell(fill=x)]
                            const inlineCells = [...cellsArg.matchAll(/openmc\.Cell\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)];
                            for (const ic of inlineCells) {
                                const cargs = parseCallArgs(ic[1]);
                                const cid = b.nextId('cell', cargs.kw.has('cell_id') ? env.eval(cargs.kw.get('cell_id')!) : null);
                                const cell: TCell = {
                                    id: cid, name: (cargs.kw.get('name') ?? "''").replace(/['"]/g, ''),
                                    fill: { kind: 'void', id: 0 }, region: null,
                                    temperature: null, translation: null, rotation: null,
                                };
                                const fillName = cargs.kw.get('fill');
                                if (fillName && fillName !== 'None') {
                                    const fv = bindings.get(fillName);
                                    if (fv?.kind === 'material') cell.fill = { kind: 'material', id: fv.id };
                                    else if (fv?.kind === 'universe') cell.fill = { kind: 'universe', id: fv.id };
                                    else if (fv?.kind === 'lattice') cell.fill = { kind: 'lattice', id: fv.id };
                                }
                                const regionExpr = cargs.kw.get('region');
                                if (regionExpr && regionExpr !== 'None') {
                                    const r = parseRegionExpr(regionExpr, bindings);
                                    if (r) cell.region = r;
                                }
                                b.cells.push(cell);
                                cellById.set(cid, cell);
                                uni.cells.push(cid);
                            }
                        }
                        b.universes.push(uni);
                        uniById.set(id, uni);
                        bindings.set(name, { kind: 'universe', id });
                        continue;
                    }
                    case 'RectLattice':
                    case 'HexLattice': {
                        const id = b.nextId('lattice', null);
                        const nm = (args.kw.get('name') ?? "''").replace(/['"]/g, '');
                        const lat: TLattice = {
                            id, kind: cls === 'RectLattice' ? 'rect' : 'hex', name: nm,
                            pitch: [], outer: null,
                        };
                        b.lattices.push(lat);
                        latById.set(id, lat);
                        bindings.set(name, { kind: 'lattice', id });
                        continue;
                    }
                    case 'Geometry': {
                        const arg = args.positional[0];
                        if (arg) {
                            const rv = bindings.get(arg);
                            if (rv?.kind === 'universe') rootUniverse = rv.id;
                            else {
                                const nested = parseNestedList(arg);
                                if (Array.isArray(nested)) {
                                    rootCells = nested
                                        .map((it) => (typeof it === 'string' ? bindings.get(it) : undefined))
                                        .filter((v): v is BoundValue & { kind: 'cell' } => v?.kind === 'cell')
                                        .map((v) => v.id);
                                }
                            }
                        }
                        continue;
                    }
                    case 'Settings': continue;
                    case 'RegularMesh': {
                        const mesh = { dimension: [1, 1, 1], lowerLeft: [0, 0, 0], upperRight: [1, 1, 1] };
                        bindings.set(name, { kind: 'mesh', mesh });
                        continue;
                    }
                    case 'Tally': {
                        const tally: TTally = {
                            name: (args.kw.get('name') ?? "''").replace(/['"]/g, ''),
                            kind: 'other', mesh: null, cells: [], scores: [],
                        };
                        tallies.push(tally);
                        bindings.set(name, { kind: 'tally', tally });
                        continue;
                    }
                    case 'Tallies': continue;
                    case 'Model': continue;
                    case 'IndependentSource':
                    case 'Source': {
                        // bound later via settings.source = name — parse space now
                        parseSources(rhs, env, settings, /*dryRun*/ true);
                        bindings.set(name, { kind: 'region', region: { k: 'h', s: -1, side: 1 } });
                        continue;
                    }
                    default: {
                        const sv = makeSurfaceValue(cls, args, env, b);
                        if (sv) {
                            if (unary === '-' || unary === '~' || unary === '+') {
                                // region assignment from a unary-prefixed constructor
                                const base = sv.kind === 'surface'
                                    ? { k: 'h' as const, s: sv.surface.id, side: (unary === '-' ? -1 : 1) as 1 | -1 }
                                    : unary === '-' ? (sv as { inside: TRegion }).inside : { k: '~' as const, c: (sv as { inside: TRegion }).inside };
                                bindings.set(name, { kind: 'region', region: base });
                            } else {
                                bindings.set(name, sv);
                            }
                            continue;
                        }
                        unparsed.push({ line: ll.line, text: t.slice(0, 120), reason: `openmc.${cls}() is not supported by the static parser` });
                        continue;
                    }
                }
            }

            // region expression assignment (var = -s1 & +s2 | ~x)
            if (/[&|~]|^[-+]\s*\w/.test(rhs) || bindings.has(rhs)) {
                const r = parseRegionExpr(rhs, bindings);
                if (r) {
                    bindings.set(name, { kind: 'region', region: r });
                    continue;
                }
                const alias = bindings.get(rhs);
                if (alias) {
                    bindings.set(name, alias);
                    continue;
                }
            }

            // string / list / dict / f-string assignments: ignore quietly
            if (/^['"[{f]/.test(rhs) || /^\d/.test(rhs)) continue;
            unparsed.push({ line: ll.line, text: t.slice(0, 120), reason: 'assignment not statically resolvable' });
            continue;
        }
    }

    const model: TracedModel = {
        surfaces: b.surfaces,
        materials: b.materials,
        cells: b.cells,
        universes: b.universes,
        lattices: b.lattices,
        rootUniverse,
        rootCells: rootUniverse === null && rootCells.length === 0
            ? b.cells.filter((c) => !b.universes.some((u) => u.cells.includes(c.id))).map((c) => c.id)
            : rootCells,
        settings,
        tallies,
        warnings: b.warnings,
    };
    return { model, unparsed, dynamic };
}

function resolveRectArray(
    nested: NestedNames,
    uidOf: (name: string) => number | null,
): number[][][] | null {
    if (!Array.isArray(nested)) return null;
    // determine depth: 2D [[a,b],[c,d]] or 3D [[[..]..]..]
    const is3D = nested.length > 0 && Array.isArray(nested[0]) && (nested[0] as NestedNames[]).length > 0 && Array.isArray((nested[0] as NestedNames[])[0]);
    const planes: NestedNames[] = is3D ? (nested as NestedNames[]) : [nested];
    const out: number[][][] = [];
    for (const plane of planes) {
        if (!Array.isArray(plane)) return null;
        const rows: number[][] = [];
        for (const row of plane) {
            if (!Array.isArray(row)) return null;
            const ids: number[] = [];
            for (const it of row) {
                if (typeof it !== 'string') return null;
                const uid = uidOf(it);
                if (uid === null) return null;
                ids.push(uid);
            }
            rows.push(ids);
        }
        out.push(rows);
    }
    return out;
}

function parseSources(value: string, env: NumEnv, settings: TSettings, dryRun = false): void {
    const points = [...value.matchAll(/openmc\.stats\.Point\(\s*\(([^)]*)\)\s*\)/g)];
    for (const p of points) {
        const nums = splitArgs(p[1]).map((x) => env.eval(x));
        if (nums.length >= 3 && nums.every((n) => n !== null)) {
            if (!dryRun || settings.sourcePoints.length === 0) {
                settings.sourcePoints.push(nums as number[]);
            }
        }
    }
    const box = /openmc\.stats\.Box\(\s*(\[[^\]]*\])\s*,\s*(\[[^\]]*\])/.exec(value);
    if (box) {
        const lo = env.evalTuple(box[1]);
        const hi = env.evalTuple(box[2]);
        if (lo && hi) settings.sourceBox = { lo, hi };
    }
}

function parseTallyFilters(
    value: string,
    bindings: Map<string, BoundValue>,
    tally: TTally,
    cellById: Map<number, TCell>,
): void {
    const meshM = /openmc\.MeshFilter\(\s*(\w+)\s*\)/.exec(value);
    if (meshM) {
        const mv = bindings.get(meshM[1]);
        if (mv?.kind === 'mesh') {
            tally.kind = 'mesh';
            tally.mesh = mv.mesh;
            return;
        }
    }
    const cellM = /openmc\.CellFilter\(\s*\[([^\]]*)\]\s*\)/.exec(value);
    if (cellM) {
        const ids: number[] = [];
        for (const nm of splitArgs(cellM[1])) {
            const cv = bindings.get(nm);
            if (cv?.kind === 'cell' && cellById.has(cv.id)) ids.push(cv.id);
        }
        if (ids.length) {
            tally.kind = 'cell';
            tally.cells = ids;
        }
    }
}
