// Concentric-shell reconstruction for OpenMC decks that are not pin lattices.
//
// The lattice extractor in openmc.ts covers PWR-style decks. Everything else
// — a fusion chamber, a sphere-in-sphere criticality benchmark, a tank with a
// first wall — used to land on its "no lattice found, render one representative
// pin" fallback, which drew a fabricated 0.41 cm fuel pin for a 218 cm vessel.
//
// This module recovers the real thing where the deck states it plainly: named
// surfaces (Sphere, {X,Y,Z}Cylinder, {X,Y,Z}Plane) and bodies
// (RightCircularCylinder, RectangularParallelepiped) built from literals or
// module-level scalars, plus cells whose region is an intersection of those.
// Anything whose dimension comes from a function argument, dataclass field or
// comprehension is left out and counted, because OWEN does not execute the
// deck — the caller turns that count into an honest note.
//
// This is a preview, not an evaluator. When OpenMC is installed, the in-editor
// preview replaces this reconstruction with the live geometry.xml. OpenMC's
// own plotter (OWEN: Render with OpenMC) remains the ground truth.

import { Component, ComponentId, CylinderSpec } from '../types';
import { materialColor } from '../palette';

type Axis = 'x' | 'y' | 'z';

interface SphereSurface {
    kind: 'sphere';
    center: [number, number, number];
    r: number;
}

interface CylinderSurface {
    kind: 'cylinder';
    axis: Axis;
    /** Center in the two axes normal to `axis`. */
    center: [number, number];
    r: number;
    /** Axial extent when the surface is really a finite body (RCC). */
    span?: [number, number];
}

interface PlaneSurface {
    kind: 'plane';
    axis: Axis;
    at: number;
}

interface BoxSurface {
    kind: 'box';
    lower: [number, number, number];
    upper: [number, number, number];
}

type Surface = SphereSurface | CylinderSurface | PlaneSurface | BoxSurface;

interface CellSpec {
    name: string | null;
    fill: string | null;
    region: string | null;
}

export interface ShellScene {
    cylinders: CylinderSpec[];
    /** Cells with a material fill that were found in the deck. */
    filledCells: number;
    /** Of those, how many produced a primitive. */
    rendered: number;
    /** Names of filled cells whose dimensions could not be resolved. */
    unresolved: string[];
    /** True when some region used a union or complement we flattened. */
    approximated: boolean;
}

/** The biggest half-extent in the scene, used to fall back on axial bounds. */
function sceneSpan(surfaces: Map<string, Surface>): number {
    let span = 0;
    for (const s of surfaces.values()) {
        if (s.kind === 'sphere') span = Math.max(span, s.r);
        else if (s.kind === 'cylinder') span = Math.max(span, s.r);
        else if (s.kind === 'plane') span = Math.max(span, Math.abs(s.at));
    }
    return span;
}

/**
 * Rebuilds a scene from named surfaces and intersection regions, or null when
 * the deck yields nothing (a lattice deck, or geometry OWEN cannot resolve).
 */
export function buildOpenmcShellScene(text: string): ShellScene | null {
    const scalars = collectScalars(text);
    const surfaces = collectSurfaces(text, scalars);
    if (surfaces.size === 0) return null;
    const cells = collectCells(text);
    if (cells.length === 0) return null;
    const materialNames = collectMaterialNames(text);

    const out: CylinderSpec[] = [];
    const unresolved: string[] = [];
    let filledCells = 0;
    let approximated = false;
    const fallbackSpan = sceneSpan(surfaces) || 50;

    for (const cell of cells) {
        if (!cell.fill || cell.fill === 'None') continue;
        filledCells += 1;
        const label = cell.name ?? cell.fill;
        if (!cell.region) {
            unresolved.push(label);
            continue;
        }
        if (/[|~]/.test(cell.region)) approximated = true;
        const terms = parseRegion(cell.region);
        if (terms.length === 0) {
            unresolved.push(label);
            continue;
        }
        const solid = solidFor(terms, surfaces, fallbackSpan);
        if (!solid) {
            unresolved.push(label);
            continue;
        }
        const material = displayMaterial(cell.fill, materialNames);
        out.push({
            ...solid,
            label,
            component: classifyComponent(material, cell.name),
            material,
            color: materialColor(material),
            opacity: solid.innerRadius && solid.innerRadius > 0 ? 1.0 : 0.45,
        });
    }

    if (out.length === 0) return null;

    // Draw the outermost solids first so nested contents stay visible.
    out.sort((a, b) => b.radius - a.radius);
    return { cylinders: out, filledCells, rendered: out.length, unresolved, approximated };
}

// ---------------------------------------------------------------------------
// Scalars and surfaces
// ---------------------------------------------------------------------------

const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

/** Module-level `NAME = <number>` assignments (any magnitude, any sign). */
function collectScalars(text: string): Map<string, number> {
    const out = new Map<string, number>();
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(/#.*$/, '');
        const m = /^\s*([A-Za-z_]\w*)\s*(?::\s*[\w.[\]]+\s*)?=\s*([-+]?[\d.]+(?:[eE][-+]?\d+)?)\s*$/.exec(line);
        if (!m) continue;
        const value = Number(m[2]);
        if (Number.isFinite(value)) out.set(m[1], value);
    }
    return out;
}

/** Resolves a literal or a module-level scalar name; null for anything else. */
function resolveNumber(token: string | undefined, scalars: Map<string, number>): number | null {
    if (!token) return null;
    const t = token.trim();
    if (NUMBER.test(t)) return Number(t);
    if (/^[A-Za-z_]\w*$/.test(t) && scalars.has(t)) return scalars.get(t)!;
    // A leading unary minus on a scalar (`-HEIGHT`) still resolves.
    const neg = /^-\s*([A-Za-z_]\w*)$/.exec(t);
    if (neg && scalars.has(neg[1])) return -scalars.get(neg[1])!;
    return null;
}

/** Splits a call's argument list at top-level commas. */
function splitArgs(body: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let current = '';
    let quote: string | null = null;
    for (const ch of body) {
        if (quote) {
            current += ch;
            if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            current += ch;
            continue;
        }
        if (ch === '(' || ch === '[' || ch === '{') depth += 1;
        if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
        if (ch === ',' && depth === 0) {
            out.push(current.trim());
            current = '';
            continue;
        }
        current += ch;
    }
    if (current.trim().length > 0) out.push(current.trim());
    return out;
}

function keywordArgs(body: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const arg of splitArgs(body)) {
        const m = /^([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/.exec(arg);
        if (m) out.set(m[1], m[2].trim());
    }
    return out;
}

/** Index of the ')' matching the '(' at `open`, or -1. */
function matchParen(text: string, open: number): number {
    let depth = 0;
    let quote: string | null = null;
    for (let i = open; i < text.length; i++) {
        const ch = text[i];
        if (quote) {
            if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (ch === '(') depth += 1;
        else if (ch === ')') {
            depth -= 1;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/** Every `<name> = openmc[.model].<Kind>(…)` call, paren-matched (multi-line). */
function namedCalls(text: string): { name: string; kind: string; body: string }[] {
    const out: { name: string; kind: string; body: string }[] = [];
    const re = /([A-Za-z_]\w*)\s*=\s*openmc(?:\.model)?\.([A-Za-z_]\w*)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const open = re.lastIndex - 1;
        const close = matchParen(text, open);
        if (close < 0) continue;
        out.push({ name: m[1], kind: m[2], body: text.slice(open + 1, close) });
        re.lastIndex = close;
    }
    return out;
}

function tuple3(token: string | undefined, scalars: Map<string, number>): [number, number, number] | null {
    if (!token) return null;
    const inner = token.trim().replace(/^[([]/, '').replace(/[)\]]$/, '');
    const parts = splitArgs(inner).map((p) => resolveNumber(p, scalars));
    if (parts.length !== 3 || parts.some((p) => p === null)) return null;
    return [parts[0]!, parts[1]!, parts[2]!];
}

function collectSurfaces(text: string, scalars: Map<string, number>): Map<string, Surface> {
    const out = new Map<string, Surface>();
    for (const call of namedCalls(text)) {
        const args = keywordArgs(call.body);
        switch (call.kind) {
            case 'Sphere': {
                const r = resolveNumber(args.get('r'), scalars);
                if (r === null || r <= 0) break;
                out.set(call.name, {
                    kind: 'sphere',
                    r,
                    center: [
                        resolveNumber(args.get('x0'), scalars) ?? 0,
                        resolveNumber(args.get('y0'), scalars) ?? 0,
                        resolveNumber(args.get('z0'), scalars) ?? 0,
                    ],
                });
                break;
            }
            case 'XCylinder':
            case 'YCylinder':
            case 'ZCylinder': {
                const r = resolveNumber(args.get('r'), scalars);
                if (r === null || r <= 0) break;
                const axis = call.kind[0].toLowerCase() as Axis;
                const keys: Record<Axis, [string, string]> = {
                    x: ['y0', 'z0'],
                    y: ['x0', 'z0'],
                    z: ['x0', 'y0'],
                };
                const [k1, k2] = keys[axis];
                out.set(call.name, {
                    kind: 'cylinder',
                    axis,
                    r,
                    center: [resolveNumber(args.get(k1), scalars) ?? 0, resolveNumber(args.get(k2), scalars) ?? 0],
                });
                break;
            }
            case 'XPlane':
            case 'YPlane':
            case 'ZPlane': {
                const axis = call.kind[0].toLowerCase() as Axis;
                const at = resolveNumber(args.get(`${axis}0`), scalars);
                if (at === null) break;
                out.set(call.name, { kind: 'plane', axis, at });
                break;
            }
            case 'RightCircularCylinder': {
                const base = tuple3(args.get('center_base'), scalars);
                const height = resolveNumber(args.get('height'), scalars);
                const radius = resolveNumber(args.get('radius'), scalars);
                if (!base || height === null || radius === null || radius <= 0) break;
                const axisRaw = (args.get('axis') ?? "'z'").replace(/['"]/g, '').trim();
                const axis: Axis = axisRaw === 'x' || axisRaw === 'y' ? axisRaw : 'z';
                const along = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
                const centerAxes: [number, number] = axis === 'x'
                    ? [base[1], base[2]]
                    : axis === 'y' ? [base[0], base[2]] : [base[0], base[1]];
                out.set(call.name, {
                    kind: 'cylinder',
                    axis,
                    r: radius,
                    center: centerAxes,
                    span: [base[along], base[along] + height],
                });
                break;
            }
            case 'RectangularParallelepiped': {
                const values = splitArgs(call.body)
                    .map((a) => resolveNumber(a.replace(/^[A-Za-z_]\w*\s*=\s*/, ''), scalars));
                if (values.length < 6 || values.slice(0, 6).some((v) => v === null)) break;
                const [xmin, xmax, ymin, ymax, zmin, zmax] = values as number[];
                out.set(call.name, {
                    kind: 'box',
                    lower: [xmin, ymin, zmin],
                    upper: [xmax, ymax, zmax],
                });
                break;
            }
            default:
                break;
        }
    }
    return out;
}

/** Material variable → the `name=` OpenMC was given, when it has one. */
function collectMaterialNames(text: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const call of namedCalls(text)) {
        if (call.kind !== 'Material') continue;
        const named = /name\s*=\s*['"]([^'"]+)['"]/.exec(call.body);
        if (named) out.set(call.name, named[1]);
    }
    // `m = openmc.Material(name=f"DT_{...}")` and `m.name = 'x'` both end up
    // unnamed here; the fill variable name is the fallback label.
    return out;
}

function collectCells(text: string): CellSpec[] {
    const out: CellSpec[] = [];
    const re = /(?:([A-Za-z_]\w*)\s*=\s*)?openmc\.Cell\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const open = re.lastIndex - 1;
        const close = matchParen(text, open);
        if (close < 0) continue;
        const args = keywordArgs(text.slice(open + 1, close));
        const named = args.get('name');
        out.push({
            name: named ? named.replace(/['"]/g, '') : (m[1] ?? null),
            fill: args.get('fill') ?? null,
            region: args.get('region') ?? null,
        });
        re.lastIndex = close;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Regions → primitives
// ---------------------------------------------------------------------------

interface RegionTerm {
    inside: boolean;
    surface: string;
}

/**
 * Intersection terms of a region expression. Unions and complements are
 * flattened to their operands (the caller reports the approximation), which
 * keeps a `(+a & -b) | (+c & -d)` cell from disappearing entirely.
 */
function parseRegion(expr: string): RegionTerm[] {
    const out: RegionTerm[] = [];
    const re = /([-+~])\s*([A-Za-z_]\w*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(expr)) !== null) {
        if (m[1] === '~') continue;
        out.push({ inside: m[1] === '-', surface: m[2] });
    }
    return out;
}

type Solid = Pick<CylinderSpec, 'x' | 'y' | 'z' | 'radius' | 'height' | 'innerRadius' | 'shape' | 'axis'
    | 'halfX' | 'halfY' | 'halfZ'>;

function axialBounds(
    terms: RegionTerm[],
    surfaces: Map<string, Surface>,
    axis: Axis,
): [number, number] | null {
    let lo: number | null = null;
    let hi: number | null = null;
    for (const term of terms) {
        const s = surfaces.get(term.surface);
        if (!s) continue;
        if (s.kind === 'plane' && s.axis === axis) {
            if (term.inside) hi = hi === null ? s.at : Math.min(hi, s.at);
            else lo = lo === null ? s.at : Math.max(lo, s.at);
        } else if (s.kind === 'cylinder' && s.axis === axis && s.span && term.inside) {
            lo = lo === null ? s.span[0] : Math.max(lo, s.span[0]);
            hi = hi === null ? s.span[1] : Math.min(hi, s.span[1]);
        }
    }
    if (lo === null || hi === null || hi <= lo) return null;
    return [lo, hi];
}

/** The primitive a cell's terms describe, or null when it is not resolvable. */
function solidFor(
    terms: RegionTerm[],
    surfaces: Map<string, Surface>,
    fallbackSpan: number,
): Solid | null {
    const resolved = terms.filter((t) => surfaces.has(t.surface));
    if (resolved.length === 0) return null;
    // A term naming a surface the deck built from an unresolved expression
    // (a dataclass field, a function argument) means the shape is unknown.
    if (resolved.length !== terms.length) return null;

    const spheres = resolved.filter((t) => surfaces.get(t.surface)!.kind === 'sphere');
    const cylinders = resolved.filter((t) => surfaces.get(t.surface)!.kind === 'cylinder');
    const boxes = resolved.filter((t) => surfaces.get(t.surface)!.kind === 'box');

    if (cylinders.length > 0) {
        const inner = cylinders.filter((t) => !t.inside).map((t) => surfaces.get(t.surface) as CylinderSurface);
        const outerTerms = cylinders.filter((t) => t.inside).map((t) => surfaces.get(t.surface) as CylinderSurface);
        if (outerTerms.length === 0) return null;
        const outer = outerTerms.reduce((a, b) => (a.r <= b.r ? a : b));
        const axis = outer.axis;
        const bounds = axialBounds(resolved, surfaces, axis)
            ?? (outer.span ?? [-fallbackSpan, fallbackSpan]);
        const innerR = inner.length > 0 ? Math.max(...inner.map((s) => s.r)) : 0;
        const mid = (bounds[0] + bounds[1]) / 2;
        const center: [number, number, number] = axis === 'x'
            ? [mid, outer.center[0], outer.center[1]]
            : axis === 'y' ? [outer.center[0], mid, outer.center[1]]
                : [outer.center[0], outer.center[1], mid];
        return {
            shape: 'cylinder',
            axis,
            x: center[0],
            y: center[1],
            z: center[2],
            radius: outer.r,
            innerRadius: innerR > 0 && innerR < outer.r ? innerR : undefined,
            height: bounds[1] - bounds[0],
        };
    }

    if (spheres.length > 0) {
        const insideSpheres = spheres.filter((t) => t.inside).map((t) => surfaces.get(t.surface) as SphereSurface);
        if (insideSpheres.length === 0) return null;
        const outer = insideSpheres.reduce((a, b) => (a.r <= b.r ? a : b));
        return {
            shape: 'sphere',
            x: outer.center[0],
            y: outer.center[1],
            z: outer.center[2],
            radius: outer.r,
            height: outer.r * 2,
        };
    }

    if (boxes.length > 0) {
        const insideBoxes = boxes.filter((t) => t.inside).map((t) => surfaces.get(t.surface) as BoxSurface);
        if (insideBoxes.length === 0) return null;
        const box = insideBoxes[0];
        const half = [
            (box.upper[0] - box.lower[0]) / 2,
            (box.upper[1] - box.lower[1]) / 2,
            (box.upper[2] - box.lower[2]) / 2,
        ];
        return {
            shape: 'box',
            x: box.lower[0] + half[0],
            y: box.lower[1] + half[1],
            z: box.lower[2] + half[2],
            radius: Math.max(half[0], half[1]),
            halfX: half[0],
            halfY: half[1],
            height: half[2] * 2,
        };
    }

    return null;
}

function displayMaterial(fill: string, names: Map<string, string>): string {
    if (names.has(fill)) return names.get(fill)!;
    return fill.replace(/_(material|mat|mix)$/i, '');
}

function classifyComponent(material: string, cellName: string | null): ComponentId {
    const hay = `${material} ${cellName ?? ''}`.toLowerCase();
    if (/fuel|uo2|mox|u23[358]|pu23|dt_|_dt|deuter|tritium|capsule/.test(hay)) return Component.Fuel;
    if (/clad|zirc|zr-|zry/.test(hay)) return Component.Clad;
    if (/steel|ss3|ss-3|inconel|rafm|eurofer|first_wall|wall|vessel|tank/.test(hay)) return Component.Vessel;
    if (/water|h2o|d2o|flinak|flibe|salt|sodium|helium|coolant|moderator|graphite|beryl/.test(hay)) {
        return Component.Moderator;
    }
    if (/b4c|boron|hafnium|cadmium|absorber|control/.test(hay)) return Component.Absorber;
    if (/reflect/.test(hay)) return Component.Reflector;
    if (/shield|concrete|lead|tungsten/.test(hay)) return Component.Structure;
    return Component.Other;
}
