// MCNP geometry extractor.
//
// MCNP geometry is constructive solid geometry over quadric surfaces and
// macrobodies, layered into a `universe` / `fill` / `lat` hierarchy. This
// parser expands that hierarchy toward the shared geometry IR the same way the
// SCONE path does:
//
//   surfaces (cz / c/z / pz / px / py / rpp / rcc / rhp|hex)
//     → pin universes (cells sharing `u=N` → concentric cylinders, classified
//       fuel / guide-tube / instrument-tube by their material ZAIDs)
//     → lattice universes (`lat=1` square / `lat=2` hex cell + `fill` array)
//     → the root `fill` cell → a full assembly or a nested core (a core
//       lattice of assembly lattices of pins).
//
// Lattice `fill` index ranges (`fill= i1:i2 j1:j2 k1:k2 u u u …`, with `nR`
// repeats) are expanded into placed sub-universes. Materials are classified by
// ZAID (92xxx/94xxx → fuel, Zr → clad, H+O → water, He → gap, B/Ag-In-Cd →
// absorber, Fe/Cr/Ni → steel) so the component/material toggles are meaningful
// across codes. Anything that can't be expanded is reported as a warning rather
// than silently collapsing to a single pin.
//
// A deck with no universes/lattices (a bare pin cell) still renders its z-axis
// cylinders directly, as before.

import { CylinderSpec, Component, ComponentId, ParseResult, FidelityOptions, FidelityState } from '../types';
import { componentColor, emitLayers, materialColor, resolveDetail } from '../palette';

const MAX_CYLINDERS = 500000;

type SurfaceType =
    | 'cz' | 'cx' | 'cy' | 'c/z' | 'c/x' | 'c/y'
    | 'pz' | 'px' | 'py'
    | 'rpp' | 'rcc' | 'rhp' | 'hex'
    | 'other';

interface MCNPSurface {
    id: number;
    type: SurfaceType;
    params: number[];
}

interface MaterialInfo {
    name: string;
    component: ComponentId;
}

interface CellTransform {
    /** Translation (cm). */
    t: [number, number, number];
    /** Optional 3×3 rotation, row-major (direction cosines). */
    rot: number[] | null;
}

interface MCNPCell {
    id: number;
    material: number;
    surfaces: number[]; // signed surface ids from the geometry portion
    u: number | null; // universe this cell belongs to (null = universe 0)
    fill: FillSpec | null;
    lat: number | null; // 1 = square, 2 = hex
    trcl: CellTransform | null;
}

interface FillSpec {
    uniform: number | null; // single-universe fill
    nx: number;
    ny: number;
    grid: number[][]; // [j][i]
}

interface PinLayer {
    radius: number;
    component: ComponentId;
    material: string;
    color: string;
}

interface PinUniverse {
    id: number;
    layers: PinLayer[];
    kind: 'fuel' | 'guide' | 'instrument' | 'other';
}

interface LatUniverse {
    id: number;
    hex: boolean;
    pitchX: number;
    pitchY: number;
    fill: FillSpec;
}

const SURFACE_MNEMONICS = new Set([
    'cz', 'cx', 'cy', 'c/z', 'c/x', 'c/y', 'pz', 'px', 'py', 'p',
    'rpp', 'rcc', 'rhp', 'hex', 'so', 's', 'sx', 'sy', 'sz', 'sph',
    'kz', 'kx', 'ky', 'gq', 'sq', 'tz', 'tx', 'ty', 'box', 'rec', 'trc', 'ell', 'wed', 'arb',
]);

export function extractMcnpCylinders(text: string): CylinderSpec[] {
    return parseMcnp(text).cylinders;
}

export function parseMcnp(text: string, opts?: FidelityOptions): ParseResult {
    const warnings: string[] = [];
    const notes: string[] = [];

    const cards = logicalCards(text);
    const surfaces = new Map<number, MCNPSurface>();
    const materials = new Map<number, MaterialInfo>();
    const cells: MCNPCell[] = [];

    for (const card of cards) {
        const kind = classifyCard(card);
        if (kind === 'surface') {
            const s = parseSurface(card);
            if (s) surfaces.set(s.id, s);
        } else if (kind === 'cell') {
            const c = parseCell(card);
            if (c) cells.push(c);
        } else if (kind === 'material') {
            const m = parseMaterial(card);
            if (m) materials.set(m.id, m.info);
        }
    }

    // Axial extent from pz planes (global), else default per render mode.
    const zBounds = findZPlaneBounds(surfaces);

    // Build pin and lattice universes.
    const pinUniverses = new Map<number, PinUniverse>();
    const latUniverses = new Map<number, LatUniverse>();

    // Group cells by universe id.
    const byUniverse = new Map<number, MCNPCell[]>();
    for (const c of cells) {
        const uid = c.u ?? 0;
        if (!byUniverse.has(uid)) byUniverse.set(uid, []);
        byUniverse.get(uid)!.push(c);
    }

    // Lattice universes: a cell with lat= and a universe id.
    for (const c of cells) {
        if (c.lat !== null && c.u !== null && c.fill) {
            const { pitchX, pitchY, hex } = latticePitch(c, surfaces);
            latUniverses.set(c.u, {
                id: c.u,
                hex: c.lat === 2 || hex,
                pitchX,
                pitchY,
                fill: c.fill,
            });
        }
    }

    // Pin universes: cells with u=N that are NOT lattice cells.
    for (const [uid, group] of byUniverse) {
        if (uid === 0) continue;
        if (latUniverses.has(uid)) continue;
        const pin = buildPinUniverse(uid, group, surfaces, materials);
        if (pin) pinUniverses.set(uid, pin);
    }

    // Determine the top universe to place: a universe-0 cell with fill=,
    // preferring one that resolves to a lattice; else the largest lattice.
    let topUid: number | null = null;
    let rootTransform: CellTransform | null = null;
    for (const c of byUniverse.get(0) ?? []) {
        if (c.fill && c.fill.uniform !== null) {
            const f = c.fill.uniform;
            if (latUniverses.has(f) || pinUniverses.has(f)) {
                if (topUid === null || latUniverses.has(f)) { topUid = f; rootTransform = c.trcl; }
            }
        }
    }
    if (topUid === null) {
        let bestPitch = -1;
        for (const lat of latUniverses.values()) {
            const p = Math.max(lat.pitchX, lat.pitchY);
            if (p > bestPitch) { bestPitch = p; topUid = lat.id; }
        }
    }

    // No hierarchy at all → fall back to drawing standalone z-axis cylinders.
    if (topUid === null && latUniverses.size === 0) {
        return renderBareSurfaces(surfaces, zBounds, warnings, notes, text);
    }

    // Count pins to choose fidelity (layer mode vs. disc mode).
    const totalPins = countPins(topUid, latUniverses, pinUniverses);
    const { detail, autoDetail } = resolveDetail(opts, totalPins);
    const discMode = detail === 'disc';

    const height = zBounds
        ? Math.max(0.1, zBounds.zmax - zBounds.zmin)
        : (discMode ? 200 : 40);
    const zmid = zBounds ? (zBounds.zmax + zBounds.zmin) / 2 : 0;

    // Smallest lattice pitch → disc radius scale.
    let subPitch = 1.26;
    for (const lat of latUniverses.values()) subPitch = Math.min(subPitch, lat.pitchX, lat.pitchY);
    if (!(subPitch > 0)) subPitch = 1.26;

    const cylinders: CylinderSpec[] = [];
    let capped = false;

    const placePin = (uid: number, cx: number, cy: number, label: string): void => {
        if (cylinders.length >= MAX_CYLINDERS) { capped = true; return; }
        const pin = pinUniverses.get(uid);
        if (!pin || pin.layers.length === 0) return;

        if (discMode) {
            // Dominant solid layer drives the colour; component from the pin's
            // classified kind so guide/instrument tubes read correctly.
            let solid = pin.layers.find((l) => l.component !== Component.Gap && l.component !== Component.Moderator) ?? pin.layers[0];
            let comp: ComponentId = solid.component;
            let color = solid.color;
            if (pin.kind === 'guide') { comp = Component.GuideTube; color = componentColor(comp); }
            else if (pin.kind === 'instrument') { comp = Component.InstrumentTube; color = componentColor(comp); }
            cylinders.push({
                label,
                radius: Math.min(subPitch * 0.47, Math.max(...pin.layers.map((l) => l.radius))),
                height,
                x: cx,
                y: cy,
                z: zmid,
                color,
                opacity: 1.0,
                component: comp,
                material: solid.material,
            });
            return;
        }

        const radii = pin.layers.map((l) => l.radius);
        const components = pin.layers.map((l) => l.component);
        const colors = pin.layers.map((l) => l.color);
        const mats = pin.layers.map((l) => l.material);
        cylinders.push(...emitLayers(radii, components, cx, cy, zmid, height, label, colors, mats));
    };

    const placeUniverse = (uid: number, cx: number, cy: number, label: string, depth: number): void => {
        if (depth > 12) return;
        if (cylinders.length >= MAX_CYLINDERS) { capped = true; return; }
        const lat = latUniverses.get(uid);
        if (lat) {
            const { nx, ny, grid } = lat.fill;
            // Hex (lat=2): use real hex basis vectors a1=(p,0), a2=(p/2, p·√3/2)
            // so rows shear and stack at √3/2 spacing instead of a square grid.
            const p = lat.pitchX;
            const x0sq = cx - (nx - 1) * lat.pitchX / 2;
            const y0sq = cy - (ny - 1) * lat.pitchY / 2;
            for (let j = 0; j < ny; j++) {
                for (let i = 0; i < nx; i++) {
                    const sub = grid[j]?.[i] ?? 0;
                    if (sub === 0) continue;
                    let px: number;
                    let py: number;
                    if (lat.hex) {
                        const ic = i - (nx - 1) / 2;
                        const jc = j - (ny - 1) / 2;
                        px = cx + (ic + jc * 0.5) * p;
                        py = cy + jc * (Math.sqrt(3) / 2) * p;
                    } else {
                        px = x0sq + i * lat.pitchX;
                        py = y0sq + j * lat.pitchY;
                    }
                    if (latUniverses.has(sub)) placeUniverse(sub, px, py, `${label}_r${j}c${i}`, depth + 1);
                    else placePin(sub, px, py, `${label}_r${j}c${i}`);
                }
            }
            return;
        }
        placePin(uid, cx, cy, label);
    };

    if (topUid !== null) placeUniverse(topUid, 0, 0, 'core', 0);

    // Apply the root cell's trcl to the placed geometry (translation + rotation).
    if (rootTransform) {
        for (const c of cylinders) {
            const [nx2, ny2, nz2] = applyTransform(rootTransform, c.x, c.y, c.z);
            c.x = nx2; c.y = ny2; c.z = nz2;
        }
        notes.push(`Applied a trcl transform to the placed core (Δ=(${rootTransform.t.map((v) => v.toFixed(2)).join(', ')})${rootTransform.rot ? ', rotation' : ''}).`);
    }

    if (cylinders.length === 0) {
        warnings.push('Found `lat`/`fill`/`u` cards but could not expand the universe hierarchy (missing pin universes, fill array, or pitch surfaces). Check that pin universes reference cz/c/z cylinders and the lattice cell is bounded by px/py planes or an rpp.');
        // Last resort: try drawing whatever bare cylinders exist.
        const bare = renderBareSurfaces(surfaces, zBounds, [], [], text);
        return { cylinders: bare.cylinders, warnings, notes: bare.notes };
    }

    // Vessel / barrel context: large z-axis cylinders not used as pins.
    let footprint = 0;
    for (const c of cylinders) footprint = Math.max(footprint, Math.hypot(c.x, c.y) + c.radius);
    const vesselShells = [...surfaces.values()]
        .filter((s) => (s.type === 'cz' || s.type === 'c/z') && cylinderRadius(s) > footprint * 0.5)
        .sort((a, b) => cylinderRadius(b) - cylinderRadius(a));
    for (const s of vesselShells) {
        cylinders.push({
            label: `vessel_${s.id}`,
            radius: cylinderRadius(s),
            height,
            x: s.type === 'c/z' ? s.params[0] : 0,
            y: s.type === 'c/z' ? s.params[1] : 0,
            z: zmid,
            color: componentColor(Component.Vessel),
            opacity: 0.12,
            component: Component.Vessel,
            material: 'Structure',
        });
    }

    if (discMode) {
        notes.push(`Full-core view: ${cylinders.length.toLocaleString()} pins drawn as single discs (one per position). Switch "Pin detail" to Detailed layers for concentric fuel/gap/clad/coolant shells.`);
    } else {
        const assemblies = latUniverses.size;
        notes.push(`Expanded the MCNP universe hierarchy (${pinUniverses.size} pin universe(s), ${assemblies} lattice(s)).`);
    }
    if ([...latUniverses.values()].some((l) => l.hex)) {
        notes.push('Hex lattice (lat=2) placed on real hexagonal coordinates.');
    }
    if (capped) {
        warnings.push(`Geometry exceeded the ${MAX_CYLINDERS.toLocaleString()}-primitive safety cap and was truncated. Switch Pin detail to Disc or open a single assembly.`);
    }

    const fidelity: FidelityState = { detail, axial: false, autoDetail, totalPins, hasAxial: false };
    return { cylinders, warnings, notes, fidelity };
}

// ---------------------------------------------------------------------------
// Card preprocessing
// ---------------------------------------------------------------------------

/**
 * Splits a deck into logical cards: strips `$` inline comments and `c` comment
 * cards, joins continuation lines (≥5 leading spaces, or a trailing `&`), and
 * normalises whitespace around `=`.
 */
function logicalCards(text: string): string[] {
    const lines = text.split(/\r?\n/);
    const cards: string[] = [];
    let buf = '';

    const flush = () => {
        const trimmed = buf.trim();
        if (trimmed) cards.push(trimmed.replace(/\s*=\s*/g, '='));
        buf = '';
    };

    for (let raw of lines) {
        raw = raw.replace(/\$.*$/, ''); // inline comment
        if (raw.trim() === '') { flush(); continue; }
        if (/^\s{0,4}c(\s|$)/i.test(raw)) continue; // comment card
        const isCont = /^\s{5,}\S/.test(raw) || /&\s*$/.test(buf);
        if (isCont && buf !== '') {
            buf = buf.replace(/&\s*$/, '') + ' ' + raw.trim();
        } else {
            flush();
            buf = raw.trim();
        }
    }
    flush();
    return cards;
}

function classifyCard(card: string): 'cell' | 'surface' | 'material' | 'other' {
    const tokens = card.split(/\s+/);
    if (tokens.length === 0) return 'other';
    const first = tokens[0].toLowerCase();
    if (/^m\d+$/.test(first)) return 'material';
    // Surface: [*]id [transform] mnemonic ...
    const idMatch = /^\*?\d+$/.test(tokens[0]);
    if (idMatch) {
        const t1 = (tokens[1] ?? '').toLowerCase();
        const t2 = (tokens[2] ?? '').toLowerCase();
        if (SURFACE_MNEMONICS.has(t1)) return 'surface';
        if (/^\d+$/.test(t1) && SURFACE_MNEMONICS.has(t2)) return 'surface';
        // Otherwise a cell card: id mat density geom...
        return 'cell';
    }
    return 'other';
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

function parseSurface(card: string): MCNPSurface | null {
    const tokens = card.split(/\s+/);
    const idTok = tokens[0].replace(/^\*/, '');
    const id = parseInt(idTok, 10);
    if (Number.isNaN(id)) return null;
    let idx = 1;
    if (/^\d+$/.test(tokens[1] ?? '') && SURFACE_MNEMONICS.has((tokens[2] ?? '').toLowerCase())) {
        idx = 2; // skip a transform number
    }
    const type = (tokens[idx] ?? '').toLowerCase();
    const params = tokens.slice(idx + 1).map(Number).filter((n) => !Number.isNaN(n));
    const knownTypes: SurfaceType[] = ['cz', 'cx', 'cy', 'c/z', 'c/x', 'c/y', 'pz', 'px', 'py', 'rpp', 'rcc', 'rhp', 'hex'];
    const t = (knownTypes as string[]).includes(type) ? (type as SurfaceType) : 'other';
    return { id, type: t, params };
}

function cylinderRadius(s: MCNPSurface): number {
    if (s.type === 'cz') return s.params[0] ?? 0;
    if (s.type === 'c/z') return s.params[2] ?? 0;
    if (s.type === 'rcc') return s.params[6] ?? 0;
    return 0;
}

function findZPlaneBounds(surfaces: Map<number, MCNPSurface>): { zmin: number; zmax: number } | null {
    const pzs: number[] = [];
    for (const s of surfaces.values()) {
        if (s.type === 'pz') pzs.push(s.params[0]);
        else if (s.type === 'rpp' && s.params.length >= 6) { pzs.push(s.params[4], s.params[5]); }
        else if (s.type === 'rcc' && s.params.length >= 6) { pzs.push(s.params[2], s.params[2] + s.params[5]); }
    }
    if (pzs.length >= 2) {
        const zmin = Math.min(...pzs);
        const zmax = Math.max(...pzs);
        if (zmax > zmin) return { zmin, zmax };
    }
    return null;
}

// ---------------------------------------------------------------------------
// Materials (classified by ZAID)
// ---------------------------------------------------------------------------

function parseMaterial(card: string): { id: number; info: MaterialInfo } | null {
    const tokens = card.split(/\s+/);
    const id = parseInt(tokens[0].slice(1), 10);
    if (Number.isNaN(id)) return null;
    const zaids: number[] = [];
    const fracByZaid = new Map<number, number>();
    for (let i = 1; i < tokens.length - 1; i++) {
        const zm = tokens[i].match(/^(\d+)(?:\.\d+[a-z])?$/i);
        if (zm) {
            const z = parseInt(zm[1], 10);
            if (z >= 1000) {
                zaids.push(z);
                const frac = Number(tokens[i + 1]);
                if (!Number.isNaN(frac)) fracByZaid.set(z, Math.abs(frac));
            }
        }
    }
    return { id, info: classifyMaterial(zaids, fracByZaid, id) };
}

/**
 * U-235 enrichment (wt/at%) from the 92235 / 92238 fractions on the material
 * card, so distinct enrichment zones render as separate, separately-toggleable
 * bands instead of all collapsing to one "UO2".
 */
function uraniumEnrichment(fracByZaid: Map<number, number>): number | null {
    const u5 = fracByZaid.get(92235) ?? 0;
    const u8 = fracByZaid.get(92238) ?? 0;
    if (u5 <= 0 || u5 + u8 <= 0) return null;
    return (u5 / (u5 + u8)) * 100;
}

function classifyMaterial(zaids: number[], fracByZaid: Map<number, number>, id: number): MaterialInfo {
    const elems = new Set(zaids.map((z) => Math.floor(z / 1000)));
    const has = (z: number) => elems.has(z);
    if (has(92) || has(94)) {
        if (has(94)) return { name: 'MOX', component: Component.Fuel };
        const enr = uraniumEnrichment(fracByZaid);
        // Name carries the enrichment when inferable, else the material number,
        // so every distinct fuel material stays a separate band/colour.
        const name = enr !== null ? `UO2 ${enr.toFixed(1)}%` : `UO2 (m${id})`;
        return { name, component: Component.Fuel };
    }
    if (has(5) && has(6) && !has(26)) return { name: 'B4C', component: Component.Absorber };
    if (has(47) || has(49) || (has(48) && has(47))) return { name: 'Ag-In-Cd', component: Component.Absorber };
    if (has(5) && has(14) && has(8) && has(13)) return { name: 'Borosilicate', component: Component.Absorber };
    if ((has(26) && has(24)) || (has(28) && has(24)) || has(25)) return { name: 'Steel', component: Component.Structure };
    if (has(40)) return { name: 'Zircaloy', component: Component.Clad };
    if (has(1) && has(8)) return { name: 'Water', component: Component.Moderator };
    if (has(2)) return { name: 'Helium', component: Component.Gap };
    if (has(7) && has(8)) return { name: 'Air', component: Component.Gap };
    if (has(8) && elems.size === 1) return { name: 'Oxide', component: Component.Other };
    return { name: 'material', component: Component.Other };
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

function parseCell(card: string): MCNPCell | null {
    const tokens = card.split(/\s+/);
    const id = parseInt(tokens[0], 10);
    if (Number.isNaN(id)) return null;
    const material = parseInt(tokens[1], 10);
    if (Number.isNaN(material)) return null;

    // Geometry starts after material (and density if material != 0).
    let gStart = 2;
    if (material !== 0) gStart = 3; // skip density

    // Find where params begin (first token containing '=').
    let pStart = tokens.findIndex((t, i) => i >= gStart && t.includes('='));
    if (pStart < 0) pStart = tokens.length;

    const geomTokens = tokens.slice(gStart, pStart);
    const surfaces: number[] = [];
    for (const g of geomTokens) {
        const m = g.match(/-?\d+/g);
        if (m) for (const n of m) surfaces.push(parseInt(n, 10));
    }

    const paramTokens = tokens.slice(pStart);
    let u: number | null = null;
    let lat: number | null = null;
    let fill: FillSpec | null = null;
    let trcl: CellTransform | null = null;

    for (let i = 0; i < paramTokens.length; i++) {
        const tok = paramTokens[i];
        const eq = tok.indexOf('=');
        if (eq < 0) continue;
        const rawKey = tok.slice(0, eq).toLowerCase();
        const key = rawKey.replace(/^\*/, '');
        const starred = rawKey.startsWith('*');
        const val = tok.slice(eq + 1);
        if (key === 'u') u = parseInt(val, 10);
        else if (key === 'lat') lat = parseInt(val, 10);
        else if (key === 'fill') {
            // Collect this token's value plus following tokens until the next 'key='.
            const fillToks: string[] = [];
            if (val) fillToks.push(val);
            for (let j = i + 1; j < paramTokens.length; j++) {
                if (paramTokens[j].includes('=')) break;
                fillToks.push(paramTokens[j]);
            }
            fill = parseFill(fillToks);
        } else if (key === 'trcl') {
            const nums: number[] = [];
            const grab = (s: string) => { for (const m of s.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []) nums.push(Number(m)); };
            if (val) grab(val);
            for (let j = i + 1; j < paramTokens.length; j++) {
                if (paramTokens[j].includes('=')) break;
                grab(paramTokens[j]);
            }
            trcl = buildTransform(nums, starred);
        }
    }
    if (u !== null && Number.isNaN(u)) u = null;
    if (lat !== null && Number.isNaN(lat)) lat = null;

    return { id, material, surfaces, u, fill, lat, trcl };
}

/** Builds a cell transform from a trcl number list (translation + optional 3×3). */
function buildTransform(nums: number[], starred: boolean): CellTransform | null {
    if (nums.length < 3) return null;
    const t: [number, number, number] = [nums[0], nums[1], nums[2]];
    let rot: number[] | null = null;
    if (nums.length >= 12) {
        rot = nums.slice(3, 12);
        // `*trcl` gives the matrix as angles in degrees → convert to cosines.
        if (starred) rot = rot.map((deg) => Math.cos((deg * Math.PI) / 180));
    }
    return { t, rot };
}

/** Applies a cell transform (rotation then translation) to a point. */
function applyTransform(tr: CellTransform, x: number, y: number, z: number): [number, number, number] {
    let rx = x, ry = y, rz = z;
    if (tr.rot) {
        const m = tr.rot;
        rx = m[0] * x + m[1] * y + m[2] * z;
        ry = m[3] * x + m[4] * y + m[5] * z;
        rz = m[6] * x + m[7] * y + m[8] * z;
    }
    return [rx + tr.t[0], ry + tr.t[1], rz + tr.t[2]];
}

function parseFill(tokens: string[]): FillSpec | null {
    if (tokens.length === 0) return null;
    const rangeRe = /^(-?\d+):(-?\d+)$/;
    if (tokens.length >= 3 && rangeRe.test(tokens[0]) && rangeRe.test(tokens[1]) && rangeRe.test(tokens[2])) {
        const [i1, i2] = tokens[0].match(rangeRe)!.slice(1).map(Number);
        const [j1, j2] = tokens[1].match(rangeRe)!.slice(1).map(Number);
        const [k1, k2] = tokens[2].match(rangeRe)!.slice(1).map(Number);
        const nx = i2 - i1 + 1;
        const ny = j2 - j1 + 1;
        const nz = k2 - k1 + 1;
        if (nx <= 0 || ny <= 0 || nz <= 0 || nx * ny * nz > 5_000_000) return null;
        const values = expandRepeats(tokens.slice(3));
        const grid: number[][] = [];
        for (let j = 0; j < ny; j++) {
            const row: number[] = [];
            for (let i = 0; i < nx; i++) {
                const idx = i + j * nx; // k = 0 slice
                row.push(idx < values.length ? values[idx] : 0);
            }
            grid.push(row);
        }
        return { uniform: null, nx, ny, grid };
    }
    // Single-universe fill.
    const single = parseInt(tokens[0], 10);
    if (!Number.isNaN(single)) return { uniform: single, nx: 1, ny: 1, grid: [[single]] };
    return null;
}

/** Expands MCNP `nR` repeat shorthand in a fill value list. */
function expandRepeats(tokens: string[]): number[] {
    const out: number[] = [];
    for (const tok of tokens) {
        const rep = tok.match(/^(\d+)[rR]$/);
        if (rep) {
            const n = parseInt(rep[1], 10);
            const last = out.length ? out[out.length - 1] : 0;
            for (let k = 0; k < n; k++) out.push(last);
            continue;
        }
        const n = parseInt(tok, 10);
        if (!Number.isNaN(n)) out.push(n);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Pin universes
// ---------------------------------------------------------------------------

function buildPinUniverse(
    uid: number,
    cells: MCNPCell[],
    surfaces: Map<number, MCNPSurface>,
    materials: Map<number, MaterialInfo>,
): PinUniverse | null {
    const layers: PinLayer[] = [];
    for (const cell of cells) {
        if (cell.lat !== null) continue;
        // A cell filled with another universe is structural, not a drawable layer.
        if (cell.fill) continue;
        // Outer radius = smallest cylinder this cell is *inside* of (negative sense).
        let outer = Infinity;
        for (const s of cell.surfaces) {
            if (s >= 0) continue;
            const surf = surfaces.get(-s);
            if (!surf) continue;
            const r = cylinderRadius(surf);
            if (r > 0 && r < outer) outer = r;
        }
        if (!isFinite(outer)) continue; // background fill cell (no bounding cylinder)
        const info = materials.get(cell.material) ?? { name: cell.material === 0 ? 'void' : 'material', component: Component.Other };
        layers.push({
            radius: outer,
            component: info.component,
            material: info.name,
            color: materialColor(info.name),
        });
    }
    if (layers.length === 0) return null;
    layers.sort((a, b) => a.radius - b.radius);

    // Classify the universe and reassign component tags so the toggle UI groups
    // guide / instrument tubes correctly (a guide tube's Zr ring is a guide
    // tube, not generic clad).
    const hasFuel = layers.some((l) => l.component === Component.Fuel);
    let kind: PinUniverse['kind'] = 'other';
    if (hasFuel) {
        kind = 'fuel';
    } else {
        const innermost = layers[0];
        const innerIsAir = /air|void/i.test(innermost.material);
        const hasTube = layers.some((l) => l.component === Component.Clad || l.component === Component.Structure);
        if (hasTube && innerIsAir) kind = 'instrument';
        else if (hasTube) kind = 'guide';
    }

    if (kind === 'guide') {
        for (const l of layers) if (l.component === Component.Clad || l.component === Component.Structure) l.component = Component.GuideTube;
    } else if (kind === 'instrument') {
        for (const l of layers) if (l.component === Component.Clad || l.component === Component.Structure) l.component = Component.InstrumentTube;
    }

    return { id: uid, layers, kind };
}

// ---------------------------------------------------------------------------
// Lattice pitch
// ---------------------------------------------------------------------------

function latticePitch(cell: MCNPCell, surfaces: Map<number, MCNPSurface>): { pitchX: number; pitchY: number; hex: boolean } {
    const pxs: number[] = [];
    const pys: number[] = [];
    let pitchX = 0;
    let pitchY = 0;
    let hex = false;

    for (const s of cell.surfaces) {
        const surf = surfaces.get(Math.abs(s));
        if (!surf) continue;
        if (surf.type === 'px') pxs.push(surf.params[0]);
        else if (surf.type === 'py') pys.push(surf.params[0]);
        else if (surf.type === 'rpp' && surf.params.length >= 4) {
            pitchX = Math.abs(surf.params[1] - surf.params[0]);
            pitchY = Math.abs(surf.params[3] - surf.params[2]);
        } else if ((surf.type === 'rhp' || surf.type === 'hex') && surf.params.length >= 9) {
            // Facet vector r → flat-to-flat = 2|r|.
            const ff = 2 * Math.hypot(surf.params[6], surf.params[7], surf.params[8]);
            pitchX = ff;
            pitchY = ff;
            hex = true;
        }
    }
    if (pxs.length >= 2) pitchX = Math.max(...pxs) - Math.min(...pxs);
    if (pys.length >= 2) pitchY = Math.max(...pys) - Math.min(...pys);
    if (!(pitchX > 0)) pitchX = pitchY > 0 ? pitchY : 1.26;
    if (!(pitchY > 0)) pitchY = pitchX;
    return { pitchX, pitchY, hex };
}

// ---------------------------------------------------------------------------
// Pin counting (fidelity decision)
// ---------------------------------------------------------------------------

function countPins(
    topUid: number | null,
    latUniverses: Map<number, LatUniverse>,
    pinUniverses: Map<number, PinUniverse>,
    depth = 0,
): number {
    if (topUid === null || depth > 12) return 0;
    const lat = latUniverses.get(topUid);
    if (!lat) return pinUniverses.has(topUid) ? 1 : 0;
    let total = 0;
    for (const row of lat.fill.grid) {
        for (const sub of row) {
            if (sub === 0) continue;
            if (latUniverses.has(sub)) total += countPins(sub, latUniverses, pinUniverses, depth + 1);
            else if (pinUniverses.has(sub)) total += 1;
        }
    }
    return total;
}

// ---------------------------------------------------------------------------
// Bare-surface fallback (no universes / lattices)
// ---------------------------------------------------------------------------

function renderBareSurfaces(
    surfaces: Map<number, MCNPSurface>,
    zBounds: { zmin: number; zmax: number } | null,
    warnings: string[],
    notes: string[],
    text: string,
): ParseResult {
    let height = 10.0;
    let zmid = 0;
    if (zBounds) {
        height = Math.max(0.1, zBounds.zmax - zBounds.zmin);
        zmid = (zBounds.zmax + zBounds.zmin) / 2;
    }

    const cylinders: CylinderSpec[] = [];
    let offAxis = 0;
    for (const surf of surfaces.values()) {
        if (surf.type === 'cz') {
            const r = surf.params[0];
            if (r > 0) cylinders.push(makeBareCyl(0, 0, zmid, r, height, surf.id));
        } else if (surf.type === 'c/z') {
            const [x, y, r] = surf.params;
            if (r > 0) cylinders.push(makeBareCyl(x ?? 0, y ?? 0, zmid, r, height, surf.id));
        } else if (surf.type === 'rcc' && surf.params.length >= 7) {
            const r = surf.params[6];
            if (r > 0) cylinders.push(makeBareCyl(surf.params[0], surf.params[1], zmid, r, height, surf.id));
        } else if (surf.type === 'cx' || surf.type === 'cy' || surf.type === 'c/x' || surf.type === 'c/y') {
            offAxis++;
        }
    }

    assignComponents(cylinders);

    if (offAxis > 0) {
        notes.push(`${offAxis} non-z-axis cylinder(s) (cx/cy/c/x/c/y) were skipped — the preview renders z-axis cylinders only.`);
    }
    if (cylinders.length === 0) {
        warnings.push('No z-axis cylinders (cz / c/z / z-aligned rcc) found, and no `lat`/`fill`/`u` universe hierarchy to expand. Nothing to render.');
    } else {
        notes.push(`Rendered ${cylinders.length} z-axis cylinder(s) (no lattice/universe hierarchy in this deck).`);
    }
    return { cylinders, warnings, notes };
}

function makeBareCyl(x: number, y: number, z: number, radius: number, height: number, surfaceId: number): CylinderSpec {
    return { x, y, z, radius, height, surfaceId: String(surfaceId), component: Component.Other, material: `surface ${surfaceId}` };
}

function assignComponents(cylinders: CylinderSpec[]): void {
    const groups = new Map<string, CylinderSpec[]>();
    for (const c of cylinders) {
        const key = `${c.x.toFixed(3)},${c.y.toFixed(3)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(c);
    }
    const ladder: ComponentId[] = [Component.Fuel, Component.Gap, Component.Clad, Component.Moderator];
    for (const group of groups.values()) {
        group.sort((a, b) => a.radius - b.radius);
        let prevR = 0;
        group.forEach((c, i) => {
            const comp = ladder[Math.min(i, ladder.length - 1)];
            c.component = comp;
            c.color = componentColor(comp);
            c.innerRadius = prevR;
            prevR = c.radius;
        });
    }
}
