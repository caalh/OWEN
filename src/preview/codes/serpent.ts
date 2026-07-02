// Serpent geometry extractor.
//
// Expands a Serpent geometry toward the shared IR the same way the SCONE/MCNP
// paths do:
//   - `pin <name>` blocks (material + optional radius → concentric cylinders)
//   - `surf <id> <type>` cards (cyl / sqc / cuboid / hexxc / hexyc)
//   - `cell <name> <u> <mat|fill u2> <surfs>` (CSG pins + universe fills)
//   - `lat <u> <type> <x0> <y0> <nx> <ny> <pitch>` square (type 1) and hex
//     (types 2/3) lattices, **including nested lattices** (a core lattice whose
//     entries are assembly lattices whose entries are pin universes).
//
// The full universe hierarchy is resolved and placed like SCONE: a single
// assembly renders as concentric pin shells; a full core switches to disc mode
// (one disc per pin) so it stays interactive. Unsupported constructs are
// reported as warnings/notes rather than silently collapsing to one pin.

import { CylinderSpec, Component, ComponentId, ParseResult, FidelityOptions, FidelityState } from '../types';
import { emitLayers, materialColor, materialComponent, componentColor, resolveDetail } from '../palette';
import { planRender, DEFAULT_MAX_INSTANCES } from '../budget';
import { emitSerpentRadialStructure } from '../radialStructure';

/** Grid-size ceiling shared with the MCNP fill guard (5M cells ≈ full core ×20). */
const MAX_LAT_CELLS = 5_000_000;

const SERPENT_KEYWORDS = new Set([
    'pin', 'surf', 'cell', 'lat', 'set', 'mat', 'det', 'dep', 'plot', 'mesh',
    'therm', 'include', 'trans', 'src', 'ene', 'dtrans', 'div', 'branch', 'coef',
]);

interface PinDef {
    name: string;
    radii: number[];
    materials: string[];
}

interface SurfDef {
    id: string;
    type: string;
    params: number[];
}

interface CellDef {
    name: string;
    universe: string;
    fill: string | null; // universe this cell is filled with
    material: string | null;
    surfaces: { id: string; sense: number }[];
}

interface LatDef {
    name: string;
    type: number;
    x0: number;
    y0: number;
    nx: number;
    ny: number;
    pitch: number;
    grid: string[][]; // [row][col] of universe names
}

interface AxialSegment {
    zmin: number;
    zmax: number;
    universe: string;
}

export function extractSerpentCylinders(text: string): CylinderSpec[] {
    return parseSerpent(text).cylinders;
}

export function parseSerpent(text: string, opts?: FidelityOptions): ParseResult {
    const warnings: string[] = [];
    const notes: string[] = [];
    const lines = text.split(/\r?\n/);

    const pins = new Map<string, PinDef>();
    const surfs = new Map<string, SurfDef>();
    const cells: CellDef[] = [];
    const lats = new Map<string, LatDef>();

    for (let i = 0; i < lines.length; i++) {
        const s = stripComment(lines[i]).trim();
        if (!s) continue;
        const tokens = s.split(/\s+/);
        const kw = tokens[0].toLowerCase();

        if (kw === 'pin') {
            i = parsePinBlock(lines, i, tokens, pins);
        } else if (kw === 'surf') {
            const surf = parseSurf(tokens);
            if (surf) surfs.set(surf.id, surf);
        } else if (kw === 'cell') {
            const cell = parseCell(tokens);
            if (cell) cells.push(cell);
        } else if (kw === 'lat') {
            i = parseLat(lines, i, tokens, lats);
        }
    }

    // z-plane elevations from `surf <id> pz <z>` cards (for axial stacks).
    const planeZ = new Map<string, number>();
    for (const s of surfs.values()) {
        if (s.type === 'pz' && s.params.length >= 1) planeZ.set(s.id, s.params[0]);
    }

    // Cell-defined (CSG) universes: group cells by universe id.
    const cellsByUniverse = new Map<string, CellDef[]>();
    for (const c of cells) {
        if (!cellsByUniverse.has(c.universe)) cellsByUniverse.set(c.universe, []);
        cellsByUniverse.get(c.universe)!.push(c);
    }

    // Axial stacks: a universe whose cells each `fill` a sub-universe and are
    // bounded by pz planes (active fuel / plenum / grids / dashpot / nozzles).
    const axialStacks = new Map<string, AxialSegment[]>();
    for (const [uni, cs] of cellsByUniverse) {
        const segs: AxialSegment[] = [];
        for (const c of cs) {
            if (!c.fill) continue;
            const zs: number[] = [];
            for (const sref of c.surfaces) {
                const z = planeZ.get(sref.id);
                if (z !== undefined) zs.push(z);
            }
            if (zs.length < 2) continue;
            const zmin = Math.min(...zs);
            const zmax = Math.max(...zs);
            if (zmax > zmin) segs.push({ zmin, zmax, universe: c.fill });
        }
        if (segs.length >= 2) {
            segs.sort((a, b) => a.zmin - b.zmin);
            axialStacks.set(uni, segs);
        }
    }
    const hasAxial = axialStacks.size > 0;

    // Resolve a universe name to drawable geometry.
    const isLat = (u: string) => lats.has(u);
    const isPin = (u: string) => pins.has(u);

    // A cell-defined universe that just fills another universe (e.g. a pin
    // wrapped in a bounding cell) resolves through to that universe.
    const resolveFill = (u: string, depth = 0): string => {
        if (depth > 12) return u;
        if (isLat(u) || isPin(u)) return u;
        const cs = cellsByUniverse.get(u);
        if (cs) {
            for (const c of cs) {
                if (c.fill && c.fill !== u) return resolveFill(c.fill, depth + 1);
            }
        }
        return u;
    };

    // Build a pin (concentric layers) from a name: prefer a `pin` block, else
    // CSG cells that reference `cyl` surfaces.
    const pinLayers = (name: string): { radii: number[]; materials: string[] } | null => {
        const pin = pins.get(name);
        if (pin && pin.radii.length) return { radii: pin.radii, materials: pin.materials };
        const cs = cellsByUniverse.get(name);
        if (cs) {
            const layers: { r: number; mat: string }[] = [];
            for (const c of cs) {
                if (!c.material) continue;
                let outer = Infinity;
                for (const sref of c.surfaces) {
                    if (sref.sense >= 0) continue;
                    const surf = surfs.get(sref.id);
                    if (!surf) continue;
                    const r = surfRadius(surf);
                    if (r > 0 && r < outer) outer = r;
                }
                if (isFinite(outer)) layers.push({ r: outer, mat: c.material });
            }
            if (layers.length) {
                layers.sort((a, b) => a.r - b.r);
                return { radii: layers.map((l) => l.r), materials: layers.map((l) => l.mat) };
            }
        }
        return null;
    };

    // Determine the core lattice: largest footprint (nx*ny*pitch²), like SCONE's
    // "largest pitch" heuristic but tolerant of equal pitches.
    let coreLat: string | null = null;
    let bestFootprint = -1;
    for (const [name, lat] of lats) {
        const fp = lat.nx * lat.ny * lat.pitch * lat.pitch;
        if (fp > bestFootprint) { bestFootprint = fp; coreLat = name; }
    }
    // If a cell in universe 0 fills a lattice, prefer that as the explicit root.
    for (const c of cells) {
        if (c.universe === '0' && c.fill) {
            const r = resolveFill(c.fill);
            if (isLat(r)) { coreLat = r; break; }
        }
    }

    const totalPins = countPins(coreLat, lats, resolveFill, (u) => pinLayers(u) !== null || axialStacks.has(u));
    const { detail, autoDetail } = resolveDetail(opts, totalPins);

    // Budget the instance count: degrade detail before hiding pins.
    const maxInstances = opts?.maxInstances && opts.maxInstances > 0 ? opts.maxInstances : DEFAULT_MAX_INSTANCES;
    const avgLayers = averagePinLayers(pins);
    let axialSegments = 1;
    for (const segs of axialStacks.values()) axialSegments = Math.max(axialSegments, segs.length);
    const plan = planRender({
        totalPins, avgLayers, axialSegments, detail, axial: !!opts?.axial && hasAxial, maxInstances,
    });
    const discMode = plan.detail === 'disc';
    const axialOn = plan.axial;

    // Global axial extent from pz planes drives both the collapsed pin height
    // and the vessel/barrel context shells; falls back to a nominal height.
    const planeVals = [...planeZ.values()];
    const zLo = planeVals.length ? Math.min(...planeVals) : 0;
    const zHi = planeVals.length ? Math.max(...planeVals) : 0;
    const fullHeight = planeVals.length ? Math.max(1, zHi - zLo) : (discMode ? 200 : 40);
    const fullZmid = planeVals.length ? (zLo + zHi) / 2 : 0;
    const height = fullHeight;

    let subPitch = 1.26;
    for (const lat of lats.values()) if (lat.pitch > 0) subPitch = Math.min(subPitch, lat.pitch);

    const cylinders: CylinderSpec[] = [];
    let capped = false;

    const classifyKind = (name: string, comps: ComponentId[], mats: string[]): 'fuel' | 'guide' | 'instrument' | 'other' => {
        const low = name.toLowerCase();
        if (comps.includes(Component.Fuel)) return 'fuel';
        const hasTube = comps.includes(Component.Clad) || comps.includes(Component.Structure);
        const innerIsAir = /air|void/i.test(mats[0] ?? '');
        if (/instr|thimble|detector/.test(low)) return 'instrument';
        if (hasTube && innerIsAir) return 'instrument';
        if (/guide|\bgt\b|tube/.test(low)) return 'guide';
        if (hasTube) return 'guide';
        return 'other';
    };

    const placePin = (name: string, cx: number, cy: number, label: string, zCenter: number = fullZmid, segHeight: number = fullHeight): void => {
        if (cylinders.length >= maxInstances) { capped = true; return; }
        const layers = pinLayers(name);
        if (!layers) return;
        const positive = layers.radii.map((r, i) => ({ r, mat: layers.materials[i] ?? `mat${i}` })).filter((l) => l.r > 0);
        if (positive.length === 0) return;
        const comps = positive.map((l) => materialComponent(l.mat));
        const kind = classifyKind(name, comps, positive.map((l) => l.mat));
        if (kind === 'guide') comps.forEach((c, i) => { if (c === Component.Clad || c === Component.Structure) comps[i] = Component.GuideTube; });
        else if (kind === 'instrument') comps.forEach((c, i) => { if (c === Component.Clad || c === Component.Structure) comps[i] = Component.InstrumentTube; });

        if (discMode) {
            let solidIdx = comps.findIndex((c) => c !== Component.Gap && c !== Component.Moderator);
            if (solidIdx < 0) solidIdx = 0;
            const matName = positive[solidIdx].mat;
            let comp = comps[solidIdx];
            let color = materialColor(matName);
            if (kind === 'guide') { comp = Component.GuideTube; color = componentColor(comp); }
            else if (kind === 'instrument') { comp = Component.InstrumentTube; color = componentColor(comp); }
            cylinders.push({
                label,
                radius: Math.min(subPitch * 0.47, Math.max(...positive.map((l) => l.r))),
                height: segHeight,
                x: cx,
                y: cy,
                z: zCenter,
                color,
                opacity: 1.0,
                component: comp,
                material: matName,
            });
            return;
        }

        const colors = positive.map((l) => materialColor(l.mat));
        const mats = positive.map((l) => l.mat);
        cylinders.push(...emitLayers(positive.map((l) => l.r), comps, cx, cy, zCenter, segHeight, label, colors, mats));
    };

    // Place a lattice entry: an axial stack (when axial detail is on) expands
    // into its z-segments; otherwise it collapses to its tallest segment over
    // the full model height. Non-stack entries resolve to a lattice or a pin.
    const placeEntry = (name: string, cx: number, cy: number, label: string, depth: number, ancestors: ReadonlySet<string> = new Set()): void => {
        const segs = axialStacks.get(name);
        if (segs) {
            if (axialOn) {
                for (let i = 0; i < segs.length; i++) {
                    const seg = segs[i];
                    const pin = resolveFill(seg.universe);
                    const h = Math.max(0.01, seg.zmax - seg.zmin);
                    placePin(pin, cx, cy, `${label}_z${i}`, (seg.zmin + seg.zmax) / 2, h);
                }
            } else {
                let rep = segs[0];
                for (const s of segs) if ((s.zmax - s.zmin) > (rep.zmax - rep.zmin)) rep = s;
                placePin(resolveFill(rep.universe), cx, cy, label, fullZmid, fullHeight);
            }
            return;
        }
        const resolved = resolveFill(name);
        if (lats.has(resolved)) placeUniverse(resolved, cx, cy, label, depth + 1, ancestors);
        else placePin(resolved, cx, cy, label);
    };

    const placeUniverse = (name: string, cx: number, cy: number, label: string, depth: number, ancestors: ReadonlySet<string> = new Set()): void => {
        if (depth > 12 || cylinders.length >= maxInstances) return;
        const resolved = resolveFill(name);
        // Cycle guard: a lattice whose grid references itself (or an ancestor)
        // would otherwise recurse combinatorially and hang the host.
        if (ancestors.has(resolved)) return;
        const lat = lats.get(resolved);
        if (lat) {
            const nextAncestors = new Set(ancestors);
            nextAncestors.add(resolved);
            const hex = lat.type === 2 || lat.type === 3;
            const p = lat.pitch;
            const x0 = cx + lat.x0 - (lat.nx - 1) * lat.pitch / 2;
            const yTop = cy + lat.y0 + (lat.ny - 1) * lat.pitch / 2;
            const ox = cx + lat.x0;
            const oy = cy + lat.y0;
            for (let row = 0; row < lat.grid.length; row++) {
                for (let col = 0; col < lat.grid[row].length; col++) {
                    const entry = lat.grid[row][col];
                    let px: number;
                    let py: number;
                    if (hex) {
                        // Real hex coordinates. Serpent type 2 = X-type, 3 = Y-type;
                        // both use a 60° basis, transposed between the two types.
                        const ic = col - (lat.nx - 1) / 2;
                        const jc = (lat.ny - 1) / 2 - row;
                        if (lat.type === 2) {
                            px = ox + (ic + jc * 0.5) * p;
                            py = oy + jc * (Math.sqrt(3) / 2) * p;
                        } else {
                            px = ox + ic * (Math.sqrt(3) / 2) * p;
                            py = oy + (jc + ic * 0.5) * p;
                        }
                    } else {
                        px = x0 + col * lat.pitch;
                        py = yTop - row * lat.pitch;
                    }
                    placeEntry(entry, px, py, `${label}_r${row}c${col}`, depth, nextAncestors);
                }
            }
            return;
        }
        placePin(resolved, cx, cy, label);
    };

    if (coreLat) {
        placeUniverse(coreLat, 0, 0, 'core', 0);
        const nested = [...lats.values()].some((l) => lats.get(coreLat!) && l.name !== coreLat && l.pitch < lats.get(coreLat!)!.pitch);
        if (nested && !discMode) notes.push(`Resolved a nested core lattice (${lats.get(coreLat)!.nx}×${lats.get(coreLat)!.ny}).`);
    } else if (lats.size > 0) {
        // No clear core: place each lattice side by side.
        let offset = 0;
        for (const lat of lats.values()) {
            placeUniverse(lat.name, offset, 0, lat.name, 0);
            offset += lat.nx * lat.pitch + 5;
        }
    } else {
        // No lattice: lay out pin definitions side by side.
        let offset = 0;
        for (const [name, pin] of pins) {
            if (!pin.radii.some((r) => r > 0)) continue;
            placePin(name, offset, 0, name);
            offset += Math.max(...pin.radii) * 3 + 0.5;
        }
        if (pins.size > 0) notes.push('No lattice card found — laid out pin definitions side by side.');
    }

    // Radial containment (barrel, shields, downcomer, RPV).
    if (cylinders.length > 0) {
        let footprint = 0;
        for (const c of cylinders) footprint = Math.max(footprint, Math.hypot(c.x, c.y) + c.radius);
        const structN = emitSerpentRadialStructure(text, surfs, cylinders, { height: fullHeight, zCenter: fullZmid }, footprint);
        if (structN > 0) {
            notes.push(`Drew ${structN} radial-structure primitive(s) (barrel, neutron-shield pads, downcomer, RPV).`);
        }
    }

    if (discMode) {
        notes.push(`Full-core view: ${cylinders.length.toLocaleString()} pins drawn as single discs (one per position). Switch "Pin detail" to Detailed layers for concentric fuel/gap/clad/coolant shells.`);
    }
    if ([...lats.values()].some((l) => l.type === 2 || l.type === 3)) {
        notes.push('Hex lattice (type 2/3) placed on real hexagonal coordinates.');
    }
    if (axialOn) {
        notes.push('Axial detail: each pin expanded into its real z-segments (active fuel / plenum / grids / dashpot / end plugs). Use the Axial Layers toggles and the Axial slice to inspect levels.');
    } else if (hasAxial) {
        notes.push('This deck defines axial structure (pz-bounded cell stacks). Enable "Axial segments" to expand it; the Axial slice control then cuts the stack by height.');
    }
    if (cylinders.length === 0) {
        if (/\bsurf\b/.test(text) || /\bcell\b/.test(text)) {
            warnings.push('Could not expand any `pin`, `lat`, or `cell`/`surf` geometry into drawable cylinders. Check that pins reference `cyl` surfaces and lattices reference defined universes.');
        } else {
            warnings.push('No `pin` blocks, `lat` cards, or CSG cells found — nothing to render.');
        }
    }

    const fidelity: FidelityState = { detail: plan.detail, axial: axialOn, autoDetail, totalPins, hasAxial };
    return { cylinders, warnings, notes, fidelity, capped };
}

/** Average positive-radius layer count across `pin` blocks (≥1), for budgeting. */
function averagePinLayers(pins: Map<string, PinDef>): number {
    let sum = 0;
    let n = 0;
    for (const pin of pins.values()) {
        const count = pin.radii.filter((r) => r > 0).length;
        if (count > 0) { sum += count; n++; }
    }
    return n > 0 ? sum / n : 1;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function stripComment(line: string): string {
    // Serpent: `%` to end of line, and `/* */` blocks (handled crudely per line).
    return line.replace(/%.*$/, '').replace(/\/\*.*?\*\//g, ' ');
}

function parsePinBlock(lines: string[], i: number, headerTokens: string[], pins: Map<string, PinDef>): number {
    const name = headerTokens[1];
    if (!name) return i;
    const def: PinDef = { name, radii: [], materials: [] };
    pins.set(name, def);
    let j = i + 1;
    for (; j < lines.length; j++) {
        const s = stripComment(lines[j]).trim();
        if (!s) continue;
        const tokens = s.split(/\s+/);
        if (SERPENT_KEYWORDS.has(tokens[0].toLowerCase())) { j--; break; }
        const matName = tokens[0];
        if (tokens.length >= 2) {
            const r = parseFloat(tokens[1]);
            if (!Number.isNaN(r)) {
                def.radii.push(r);
                def.materials.push(matName);
            } else {
                // bare material that isn't a number → ill-formed; stop.
                def.materials.push(matName);
                break;
            }
        } else {
            // bare material (outermost fill) terminates the pin.
            def.materials.push(matName);
            break;
        }
    }
    return j;
}

function parseSurf(tokens: string[]): SurfDef | null {
    // surf <id> <type> <params...>
    if (tokens.length < 3) return null;
    const id = tokens[1];
    const type = tokens[2].toLowerCase();
    const params = tokens.slice(3).map(Number).filter((n) => !Number.isNaN(n));
    return { id, type, params };
}

function surfRadius(s: SurfDef): number {
    switch (s.type) {
        case 'cyl':
        case 'cylz':
            // cyl x0 y0 r  (z-axis) — radius is the 3rd param.
            return s.params[2] ?? 0;
        case 'cylx':
        case 'cyly':
            return s.params[2] ?? 0;
        case 'sqc':
            // sqc x0 y0 halfwidth → bounding radius ~ halfwidth.
            return s.params[2] ?? 0;
        case 'hexxc':
        case 'hexyc':
            // hexxc x0 y0 halfwidth(flat-to-flat/2).
            return s.params[2] ?? 0;
        default:
            return 0;
    }
}

function parseCell(tokens: string[]): CellDef | null {
    // cell <name> <universe> <mat | fill u2 | outside> <surfaces...>
    if (tokens.length < 4) return null;
    const name = tokens[1];
    const universe = tokens[2];
    let fill: string | null = null;
    let material: string | null = null;
    let idx = 3;
    if (tokens[3].toLowerCase() === 'fill') {
        fill = tokens[4];
        idx = 5;
    } else {
        material = tokens[3];
        idx = 4;
    }
    const surfaces: { id: string; sense: number }[] = [];
    for (let k = idx; k < tokens.length; k++) {
        const t = tokens[k];
        if (t === ':' || t === '#' || t === '(' || t === ')') continue;
        const m = t.match(/^(-?)(\w+)$/);
        if (m) surfaces.push({ id: m[2], sense: m[1] === '-' ? -1 : 1 });
    }
    return { name, universe, fill, material, surfaces };
}

function parseLat(lines: string[], i: number, headerTokens: string[], lats: Map<string, LatDef>): number {
    // lat <u> <type> <x0> <y0> <nx> <ny> <pitch>
    if (headerTokens.length < 8) return i;
    const name = headerTokens[1];
    const type = parseInt(headerTokens[2], 10);
    const x0 = parseFloat(headerTokens[3]);
    const y0 = parseFloat(headerTokens[4]);
    const nx = parseInt(headerTokens[5], 10);
    const ny = parseInt(headerTokens[6], 10);
    const pitch = parseFloat(headerTokens[7]);
    if (!(nx > 0 && ny > 0) || Number.isNaN(pitch)) return i;
    // A hostile/typo'd header ("lat core 1 0 0 1000000000 1000000000 1.26")
    // must not drive the loops below: cap total cells at MAX_LAT_CELLS and
    // never emit more rows than the deck actually provides data for.
    const need = Math.min(nx * ny, MAX_LAT_CELLS);
    const flat: string[] = [];
    let j = i + 1;
    for (; j < lines.length && flat.length < need; j++) {
        const s = stripComment(lines[j]).trim();
        if (!s) continue;
        const tokens = s.split(/\s+/);
        if (SERPENT_KEYWORDS.has(tokens[0].toLowerCase())) { j--; break; }
        for (const t of tokens) {
            flat.push(t);
            if (flat.length >= need) break;
        }
    }
    const grid: string[][] = [];
    const maxRows = Math.min(ny, Math.ceil(flat.length / nx));
    for (let r = 0; r < maxRows; r++) {
        grid.push(flat.slice(r * nx, r * nx + nx));
    }
    lats.set(name, { name, type, x0, y0, nx, ny, pitch, grid });
    return j - 1;
}

function countPins(
    coreLat: string | null,
    lats: Map<string, LatDef>,
    resolveFill: (u: string) => string,
    isPin: (u: string) => boolean,
    depth = 0,
    ancestors: ReadonlySet<string> = new Set(),
): number {
    if (!coreLat || depth > 12) return isPin(coreLat ?? '') ? 1 : 0;
    // Cycle guard for self-/mutually-referential lattices.
    if (ancestors.has(coreLat)) return 0;
    const lat = lats.get(coreLat);
    if (!lat) return isPin(coreLat) ? 1 : 0;
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(coreLat);
    let total = 0;
    for (const row of lat.grid) {
        for (const entry of row) {
            const r = resolveFill(entry);
            if (lats.has(r)) total += countPins(r, lats, resolveFill, isPin, depth + 1, nextAncestors);
            else if (isPin(r)) total += 1;
        }
    }
    return total;
}
