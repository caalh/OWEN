// SCONE geometry extractor.
//
// SCONE uses a dictionary syntax (`key value;`, `block { … }`). This parser is
// brace-aware rather than a single mega-regex: it strips comments, walks every
// leaf `name { … }` block, and classifies it (pinUniverse / latUniverse /
// cellUniverse / rootUniverse / surface / cell). It then resolves the universe
// hierarchy, finds the core lattice, and recursively places assemblies → pins.
//
// Fidelity is driven by `FidelityOptions` (see types.ts):
//   - detail 'layers' emits full concentric pin shells (fuel / gap / clad /
//     moderator …) for EVERY pin, even in a full BEAVRS-scale core; the webview
//     instances them so a few dozen draw calls cover ~hundreds of thousands of
//     cylinders. detail 'disc' draws one disc per pin (fastest). 'auto' picks
//     layers for a single assembly and disc for a full core.
//   - axial expands the deck's real z-segment structure (active fuel / plenum /
//     grid spacers / dashpot / end plugs) from `cellUniverse` axial stacks whose
//     member cells are bounded by z-planes. When off, an axial stack collapses
//     to a single representative pin over the full model height.
//
// Vessel/barrel surfaces are rendered as faint shells so a reactor reads as a
// reactor. Anything that can't be parsed is reported as a warning/note rather
// than silently drawing one pin.

import { CylinderSpec, Component, ComponentId, ParseResult, FidelityOptions, FidelityState } from '../types';
import { emitLayers, materialColor, materialComponent, componentColor, resolveDetail } from '../palette';
import { planRender, DEFAULT_MAX_INSTANCES } from '../budget';
import { emitSconeRadialStructure } from '../radialStructure';

interface LeafBlock {
    name: string;
    inner: string;
}

interface PinDef {
    name: string;
    radii: number[];
    fills: string[];
}

interface LatDef {
    name: string;
    pitch: number;
    nx: number;
    ny: number;
    grid: number[][];
}

interface SurfaceDef {
    id: number;
    type: string;
    radius?: number;
    halfwidth?: number;
}

interface AxialSegment {
    zmin: number;
    zmax: number;
    universe: number;
}

export function extractSconeCylinders(text: string): CylinderSpec[] {
    return parseScone(text).cylinders;
}

export function parseScone(rawText: string, opts?: FidelityOptions): ParseResult {
    const warnings: string[] = [];
    const notes: string[] = [];
    const text = stripComments(rawText);
    const blocks = findLeafBlocks(text);

    const pinDefs = new Map<number, PinDef>();
    const latDefs = new Map<number, LatDef>();
    const cellUniCells = new Map<number, number[]>(); // cellUniverse id -> cell ids
    const cellToUniverse = new Map<number, number>(); // cell id -> universe it is filled with
    const cellSurfaces = new Map<number, number[]>(); // cell id -> signed surface ids
    const surfaces = new Map<number, SurfaceDef>();
    const planeZ = new Map<number, number>(); // plane surface id -> z elevation

    for (const block of blocks) {
        const id = num(field(block.inner, 'id'));
        const type = (field(block.inner, 'type') ?? '').toLowerCase();

        if (type === 'pinuniverse' && id !== null) {
            const radii = numList(paren(block.inner, 'radii'));
            const fills = tokenList(paren(block.inner, 'fills'));
            pinDefs.set(id, { name: block.name, radii, fills });
        } else if (type === 'latuniverse' && id !== null) {
            const pitchVals = numList(paren(block.inner, 'pitch'));
            const shapeVals = numList(paren(block.inner, 'shape'));
            const mapVals = numList(paren(block.inner, 'map'));
            if (pitchVals.length && shapeVals.length >= 2) {
                const nx = Math.round(shapeVals[0]);
                const ny = Math.round(shapeVals[1]);
                const grid: number[][] = [];
                let idx = 0;
                for (let row = 0; row < ny; row++) {
                    const r: number[] = [];
                    for (let col = 0; col < nx; col++) {
                        r.push(idx < mapVals.length ? Math.round(mapVals[idx++]) : 0);
                    }
                    grid.push(r);
                }
                latDefs.set(id, { name: block.name, pitch: pitchVals[0], nx, ny, grid });
            }
        } else if (type === 'celluniverse' && id !== null) {
            cellUniCells.set(id, numList(paren(block.inner, 'cells')));
        } else if (type === 'simplecell' || type === 'cell') {
            if (id !== null) {
                cellSurfaces.set(id, numList(paren(block.inner, 'surfaces')));
                const ft = (field(block.inner, 'filltype') ?? '').toLowerCase();
                if (ft === 'uni') {
                    const uni = num(field(block.inner, 'universe'));
                    if (uni !== null) cellToUniverse.set(id, uni);
                }
            }
        } else if (type === 'plane' && id !== null) {
            const coeffs = numList(paren(block.inner, 'coeffs'));
            // a x + b y + c z = d → z-plane when (a,b)=(0,0) and c != 0.
            if (coeffs.length >= 4 && coeffs[0] === 0 && coeffs[1] === 0 && coeffs[2] !== 0) {
                planeZ.set(id, coeffs[3] / coeffs[2]);
            }
        } else if (isSurfaceType(type) && id !== null) {
            const radius = num(field(block.inner, 'radius')) ?? undefined;
            const hw = numList(paren(block.inner, 'halfwidth'));
            surfaces.set(id, {
                id,
                type,
                radius: radius ?? undefined,
                halfwidth: hw.length ? hw[0] : undefined,
            });
        }
    }

    if (pinDefs.size === 0 && latDefs.size === 0) {
        warnings.push('No pinUniverse or latUniverse blocks were found — nothing to render. Check that the deck contains a geometry { universes { … } } section.');
        return { cylinders: [], warnings, notes };
    }

    // Resolve a universe id down to a pin id (through cellUniverse shells).
    const resolveCache = new Map<number, number | null>();
    const resolveToPin = (uid: number, depth = 0): number | null => {
        if (pinDefs.has(uid)) return uid;
        if (depth > 12) return null;
        if (resolveCache.has(uid)) return resolveCache.get(uid)!;
        resolveCache.set(uid, null); // guard against cycles
        const cells = cellUniCells.get(uid);
        if (cells) {
            const counts = new Map<number, number>();
            for (const cid of cells) {
                const ref = cellToUniverse.get(cid);
                if (ref === undefined) continue;
                const pin = resolveToPin(ref, depth + 1);
                if (pin !== null) counts.set(pin, (counts.get(pin) ?? 0) + 1);
            }
            let best: number | null = null;
            let bestScore = -1;
            for (const [pin, n] of counts) {
                const hasGeom = (pinDefs.get(pin)?.radii.filter((r) => r > 0).length ?? 0) > 0;
                const score = n + (hasGeom ? 1000 : 0);
                if (score > bestScore) { bestScore = score; best = pin; }
            }
            resolveCache.set(uid, best);
            return best;
        }
        return null;
    };

    // An axial stack is a cellUniverse whose member cells are bounded by z-planes
    // (a top-to-bottom stack of segments). Build the sorted segment list.
    const axialCache = new Map<number, AxialSegment[] | null>();
    const axialStack = (uid: number): AxialSegment[] | null => {
        if (axialCache.has(uid)) return axialCache.get(uid)!;
        axialCache.set(uid, null);
        const cells = cellUniCells.get(uid);
        if (!cells) return null;
        const segs: AxialSegment[] = [];
        for (const cid of cells) {
            const uni = cellToUniverse.get(cid);
            if (uni === undefined) continue;
            const surfs = cellSurfaces.get(cid) ?? [];
            const zs: number[] = [];
            for (const s of surfs) {
                const z = planeZ.get(Math.abs(s));
                if (z !== undefined) zs.push(z);
            }
            if (zs.length === 0) continue; // radial overlay, not an axial segment
            segs.push({ zmin: Math.min(...zs), zmax: Math.max(...zs), universe: uni });
        }
        if (segs.length < 2) return null; // need a real stack
        segs.sort((a, b) => a.zmin - b.zmin);
        axialCache.set(uid, segs);
        return segs;
    };

    // Core lattice = largest pitch.
    let coreLatId: number | null = null;
    let corePitch = -1;
    for (const [id, lat] of latDefs) if (lat.pitch > corePitch) { corePitch = lat.pitch; coreLatId = id; }

    // Count pin positions to pick viz fidelity.
    const totalPins = countPins(coreLatId, latDefs, resolveToPin);
    const { detail, autoDetail } = resolveDetail(opts, totalPins);

    // Does the deck define axial structure anywhere reachable?
    const hasAxial = [...cellUniCells.keys()].some((uid) => axialStack(uid) !== null);

    // Budget the instance count: degrade detail before hiding pins.
    const maxInstances = opts?.maxInstances && opts.maxInstances > 0 ? opts.maxInstances : DEFAULT_MAX_INSTANCES;
    const avgLayers = averagePinLayers(pinDefs);
    let axialSegments = 1;
    for (const uid of cellUniCells.keys()) {
        const segs = axialStack(uid);
        if (segs) axialSegments = Math.max(axialSegments, segs.length);
    }
    const plan = planRender({ totalPins, avgLayers, axialSegments, detail, axial: !!opts?.axial && hasAxial, maxInstances });
    const discMode = plan.detail === 'disc';
    const axialOn = plan.axial;

    // Heights / global axial extent.
    const vessel = collectVessel(surfaces);
    const planeVals = [...planeZ.values()];
    const zLo = planeVals.length ? Math.min(...planeVals) : 0;
    const zHi = planeVals.length ? Math.max(...planeVals) : (vessel.height ?? (discMode ? 200 : 40));
    const coreHeight = vessel.height ?? Math.max(1, zHi - zLo);
    const coreZ = planeVals.length ? (zLo + zHi) / 2 : 0;

    const cylinders: CylinderSpec[] = [];
    let capped = false;

    let subPinPitch = 1.26;
    for (const lat of latDefs.values()) if (lat.pitch < corePitch || corePitch < 0) subPinPitch = Math.min(subPinPitch, lat.pitch);

    const refineComponent = (pinName: string, comp: ComponentId): ComponentId => {
        const low = pinName.toLowerCase();
        if (/plenum|spring/.test(low) && (comp === Component.Structure || comp === Component.Clad)) return Component.Plenum;
        if (/nozzle|endplug|support|\bbw\b/.test(low) && comp === Component.Structure) return Component.EndPlug;
        return comp;
    };

    const placePinAt = (uid: number, cx: number, cy: number, z: number, height: number, label: string): void => {
        if (cylinders.length >= maxInstances) { capped = true; return; }
        const pin = pinDefs.get(uid);
        if (!pin) return;
        const nameLow = pin.name.toLowerCase();
        const isGuide = /guide|\bgt\b/.test(nameLow);
        const isInstr = /instr|thimble/.test(nameLow);
        const isAbsorber = /bp|burn|absorb|poison|control|\bcr\b|rod/.test(nameLow);
        const radii = pin.radii.filter((r) => r > 0);
        if (radii.length === 0) return; // pure-fill pin (water) — nothing to draw

        if (discMode) {
            let matIdx = 0;
            for (let i = 0; i < pin.fills.length; i++) {
                const c = materialComponent(pin.fills[i] ?? '');
                if (c !== Component.Gap && c !== Component.Moderator) { matIdx = i; break; }
            }
            const matName = pin.fills[matIdx] ?? pin.fills[0] ?? 'unknown';
            let comp: ComponentId;
            let color: string;
            if (isGuide) { comp = Component.GuideTube; color = componentColor(comp); }
            else if (isInstr) { comp = Component.InstrumentTube; color = componentColor(comp); }
            else if (isAbsorber) { comp = Component.Absorber; color = componentColor(comp); }
            else { comp = refineComponent(pin.name, materialComponent(matName)); color = materialColor(matName); }
            cylinders.push({
                label,
                radius: Math.min(subPinPitch * 0.47, Math.max(...radii)),
                height,
                x: cx,
                y: cy,
                z,
                color,
                opacity: 1.0,
                component: comp,
                material: matName,
            });
            return;
        }

        const components: ComponentId[] = [];
        const colors: (string | undefined)[] = [];
        const mats: (string | undefined)[] = [];
        for (let i = 0; i < radii.length; i++) {
            const matName = pin.fills[i] ?? `mat${i}`;
            let comp = materialComponent(matName);
            if (isGuide && comp !== Component.Moderator && comp !== Component.Gap) comp = Component.GuideTube;
            if (isInstr && comp !== Component.Moderator && comp !== Component.Gap) comp = Component.InstrumentTube;
            if (isAbsorber && (comp === Component.Structure || comp === Component.Clad)) comp = Component.Absorber;
            comp = refineComponent(pin.name, comp);
            components.push(comp);
            colors.push(materialColor(matName));
            mats.push(matName);
        }
        cylinders.push(...emitLayers(radii, components, cx, cy, z, height, label, colors, mats));
    };

    // Place an entry (sub-universe of an assembly) at (cx,cy): either an axial
    // stack (when axial detail is on) or a single representative pin.
    const placeEntry = (uid: number, cx: number, cy: number, label: string): void => {
        if (axialOn) {
            const segs = axialStack(uid);
            if (segs) {
                for (let i = 0; i < segs.length; i++) {
                    const seg = segs[i];
                    const pin = resolveToPin(seg.universe);
                    if (pin === null) continue;
                    const h = Math.max(0.01, seg.zmax - seg.zmin);
                    placePinAt(pin, cx, cy, (seg.zmin + seg.zmax) / 2, h, `${label}_z${i}`);
                }
                return;
            }
        }
        const pin = resolveToPin(uid);
        if (pin !== null) placePinAt(pin, cx, cy, coreZ, coreHeight, label);
    };

    const placeAssembly = (asmUid: number, cx: number, cy: number, label: string): void => {
        const lat = latDefs.get(asmUid);
        if (!lat) { placeEntry(asmUid, cx, cy, label); return; }
        const x0 = cx - (lat.nx - 1) * lat.pitch / 2;
        const y0 = cy + (lat.ny - 1) * lat.pitch / 2;
        for (let r = 0; r < lat.grid.length; r++) {
            for (let c = 0; c < lat.grid[r].length; c++) {
                const px = x0 + c * lat.pitch;
                const py = y0 - r * lat.pitch;
                placeEntry(lat.grid[r][c], px, py, `${label}_r${r}c${c}`);
            }
        }
    };

    if (coreLatId !== null && latDefs.has(coreLatId)) {
        const core = latDefs.get(coreLatId)!;
        const cx0 = -(core.nx - 1) * core.pitch / 2;
        const cy0 = (core.ny - 1) * core.pitch / 2;
        for (let r = 0; r < core.grid.length; r++) {
            for (let c = 0; c < core.grid[r].length; c++) {
                const ax = cx0 + c * core.pitch;
                const ay = cy0 - r * core.pitch;
                const uid = core.grid[r][c];
                if (latDefs.has(uid)) placeAssembly(uid, ax, ay, `asm_r${r}c${c}`);
                else placeEntry(uid, ax, ay, `core_r${r}c${c}`);
            }
        }
        const nested = [...latDefs.values()].some((l) => l.pitch < corePitch);
        if (nested) {
            notes.push(`Resolved a nested core lattice (${core.nx}×${core.ny} assemblies of ${core.name}).`);
        }
    } else if (latDefs.size > 0) {
        let offset = 0;
        for (const [id, lat] of latDefs) {
            placeAssembly(id, offset, 0, `lat${id}`);
            offset += lat.nx * lat.pitch + 5;
        }
    } else {
        let offset = 0;
        for (const [id, pin] of pinDefs) {
            placePinAt(id, offset, 0, coreZ, coreHeight, pin.name);
            const maxR = pin.radii.length ? Math.max(...pin.radii) : 1;
            offset += maxR * 3 + 0.5;
        }
    }

    if (discMode) {
        const pinCount = cylinders.length;
        notes.push(`Full-core view: ${pinCount.toLocaleString()} pins drawn as single discs (one per position). Switch "Pin detail" to Detailed layers for concentric fuel/gap/clad/coolant shells.`);
    }
    if (axialOn) {
        notes.push('Axial detail: each pin expanded into its real z-segments (active fuel / plenum / grids / dashpot / end plugs).');
    } else if (hasAxial) {
        notes.push('This deck defines axial structure (active fuel / plenum / grids / dashpot). Enable "Axial segments" to expand it; the Slice (Z) control cuts the stack.');
    }
    // Radial containment (barrel, shields, downcomer, RPV).
    if (cylinders.length > 0) {
        let footprint = 0;
        for (const cyl of cylinders) footprint = Math.max(footprint, Math.hypot(cyl.x, cyl.y) + cyl.radius);
        const structN = emitSconeRadialStructure(text, cylinders, { height: coreHeight, zCenter: coreZ }, footprint);
        if (structN > 0) {
            notes.push(`Drew ${structN} radial-structure primitive(s) (barrel, neutron-shield pads, downcomer, RPV).`);
        }
    }

    const fidelity: FidelityState = { detail: plan.detail, axial: axialOn, autoDetail, totalPins, hasAxial };
    return { cylinders, warnings, notes, fidelity, capped };
}

/** Average positive-radius layer count across pinUniverse blocks (≥1), for budgeting. */
function averagePinLayers(pinDefs: Map<number, PinDef>): number {
    let sum = 0;
    let n = 0;
    for (const pin of pinDefs.values()) {
        const count = pin.radii.filter((r) => r > 0).length;
        if (count > 0) { sum += count; n++; }
    }
    return n > 0 ? sum / n : 1;
}

// ---------------------------------------------------------------------------
// Block / field parsing
// ---------------------------------------------------------------------------

function stripComments(text: string): string {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\n]*/g, ' ')
        .replace(/!.*$/gm, ' ');
}

/** Finds every `name { … }` block whose body contains no nested `{`. */
function findLeafBlocks(text: string): LeafBlock[] {
    const blocks: LeafBlock[] = [];
    const re = /([A-Za-z_]\w*)\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const open = re.lastIndex - 1;
        const close = matchBrace(text, open);
        if (close < 0) continue;
        const inner = text.slice(open + 1, close);
        if (!inner.includes('{')) {
            blocks.push({ name: m[1], inner });
        }
    }
    return blocks;
}

function matchBrace(text: string, openIdx: number): number {
    let depth = 0;
    for (let i = openIdx; i < text.length; i++) {
        const ch = text[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/** Returns the value token following `key` (`key value;`). */
function field(inner: string, key: string): string | null {
    const re = new RegExp(`(?:^|[;{\\s])${key}\\s+([^;()]+?)\\s*;`, 'i');
    const m = inner.match(re);
    return m ? m[1].trim() : null;
}

/** Returns the parenthesised content of `key ( … )`. */
function paren(inner: string, key: string): string {
    const re = new RegExp(`${key}\\s*\\(([^)]*)\\)`, 'i');
    const m = inner.match(re);
    return m ? m[1].trim() : '';
}

function numList(s: string): number[] {
    if (!s) return [];
    const out: number[] = [];
    for (const tok of s.split(/\s+/)) {
        const n = Number(tok);
        if (!Number.isNaN(n)) out.push(n);
    }
    return out;
}

function tokenList(s: string): string[] {
    if (!s) return [];
    return s.split(/\s+/).filter((t) => t.length > 0);
}

function num(s: string | null): number | null {
    if (s === null) return null;
    const n = Number(s.trim().split(/\s+/)[0]);
    return Number.isNaN(n) ? null : n;
}

function isSurfaceType(type: string): boolean {
    return /cylinder|sphere|trunccylinder|squarecylinder/.test(type);
}

function countPins(
    coreLatId: number | null,
    latDefs: Map<number, LatDef>,
    resolveToPin: (uid: number) => number | null,
): number {
    if (coreLatId === null || !latDefs.has(coreLatId)) {
        let total = 0;
        for (const lat of latDefs.values()) total += lat.nx * lat.ny;
        return total;
    }
    const core = latDefs.get(coreLatId)!;
    let total = 0;
    for (const row of core.grid) {
        for (const uid of row) {
            const sub = latDefs.get(uid);
            if (sub) total += sub.nx * sub.ny;
            else if (resolveToPin(uid) !== null) total += 1;
        }
    }
    return total;
}

function collectVessel(surfaces: Map<number, SurfaceDef>): { shells: SurfaceDef[]; height: number | null } {
    const shells: SurfaceDef[] = [];
    let height: number | null = null;
    for (const s of surfaces.values()) {
        if ((s.type.includes('cylinder') || s.type.includes('sphere')) && s.radius) {
            shells.push(s);
        }
        if (s.type.includes('trunccylinder') && s.halfwidth) {
            height = Math.max(height ?? 0, s.halfwidth * 2);
        }
    }
    shells.sort((a, b) => (b.radius ?? 0) - (a.radius ?? 0));
    return { shells, height };
}
