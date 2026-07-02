// OpenMC geometry extractor.
//
// OpenMC "decks" are Python scripts, so there is no single canonical lattice
// literal. This parser recovers a lattice grid from the three patterns seen in
// real and community decks:
//   1. A literal nested list assigned to `.universes` (`[[F, F, G, …], …]`).
//   2. A symbol grid + `universe_map` dict (`{'F': fuel_pin, 'G': guide_tube}`).
//   3. A NumPy-built map: `arr = np.full((17,17), F)` followed by element
//      assignments (`arr[i,j] = G`) and coordinate-list loops
//      (`for (i, j) in [(2,5), …]: arr[i,j] = G`). This is the dominant style
//      (and exactly what OWEN's own assembly snippet emits) — the previous
//      heuristic could not see it and fell back to a single pin.
//
// Pin layer radii are recovered from scalar assignments and `ZCylinder(r=…)`
// surfaces grouped by role (fuel / clad / gap, guide tube, instrument tube).
// Hex lattices are detected but only laid out on a rectangular approximation.

import { CylinderSpec, Component, ComponentId, ParseResult, FidelityOptions, FidelityState } from '../types';
import { componentColor, emitLayers, extractNumbers, materialColor, resolveDetail } from '../palette';
import { planRender, DEFAULT_MAX_INSTANCES } from '../budget';
import { baffleBox, emitOpenmcRadialStructure } from '../radialStructure';

interface NamedValue {
    name: string;
    value: number;
}

interface NamedLattice {
    name: string;
    grid: string[][];
    pitch: [number, number];
    lowerLeft: [number, number] | null;
}

interface PinTemplate {
    radii: number[];
    components: ComponentId[];
    materials: string[];
    /** When false the position is left empty (pure water/moderator). */
    render: boolean;
}

interface AxialBand {
    zmin: number;
    zmax: number;
    /** Cell fill variable name for this z-band (drives the fuel-layer material). */
    fill: string | null;
}

export function extractOpenmcCylinders(text: string): CylinderSpec[] {
    return parseOpenmc(text).cylinders;
}

export function parseOpenmc(text: string, opts?: FidelityOptions): ParseResult {
    const warnings: string[] = [];
    const notes: string[] = [];
    const lines = text.split(/\r?\n/);

    const radiiPool = collectRadii(text, lines);
    const pitch = findPitch(lines);
    const lowerLeft = findLowerLeft(lines);
    const height = findHeight(lines);
    const fuelName = findFuelName(text);

    const fuelTemplate = buildTemplate(radiiPool, 'fuel', fuelName);
    const guideTemplate = buildTemplate(radiiPool, 'guide');
    const instrTemplate = buildTemplate(radiiPool, 'instrument');

    const universeMap = findUniverseMap(text);
    const named = findNamedLattices(text);
    const isHex = /HexLattice/.test(text);
    const hasLattice = /RectLattice|HexLattice|\.universes\b/.test(text);

    // Resolve a nested core (a lattice whose entries are other lattices).
    const latByName = new Map(named.map((l) => [l.name, l]));
    const referenced = new Set<string>();
    for (const lat of named) for (const row of lat.grid) for (const t of row) if (latByName.has(t)) referenced.add(t);
    const topLattices = named.filter((l) => !referenced.has(l.name) && l.grid.some((row) => row.some((t) => latByName.has(t))));
    const nested = topLattices.length > 0 ? topLattices[0] : null;

    const grid = nested ? nested.grid : (findLatticeGrid(text) ?? buildNumpyGrid(text));

    // When the literal / NumPy finders see nothing, try the programmatic-core
    // resolver (comprehension-built assemblies + a core literal of universe
    // references). Only attempted on the fallback path, so the simpler
    // single-assembly / nested-literal cases keep their existing behaviour.
    const coreTree = (!grid || grid.length === 0) ? resolveCoreTree(text) : null;

    if ((!grid || grid.length === 0) && !coreTree) {
        const single = fuelTemplate ?? defaultTemplate('fuel');
        const cyls = emitLayers(single.radii, single.components, 0, 0, 0, height, 'pin', undefined, single.materials);
        if (hasLattice) {
            warnings.push('A lattice was declared but its universe map could not be expanded (it is likely built by a function or comprehension OWEN does not execute). Showing a single representative pin.');
        } else {
            notes.push('No lattice found — rendered a single pin cell.');
        }
        const fidelity: FidelityState = { detail: 'layers', axial: false, autoDetail: 'layers', totalPins: 1, hasAxial: false };
        return { cylinders: cyls, warnings, notes, fidelity };
    }

    // Count placed pins to pick fidelity.
    const totalPins = coreTree ? countTreePins(coreTree) : countOpenmcPins(grid!, latByName, universeMap);
    const { detail, autoDetail } = resolveDetail(opts, totalPins);

    // Per-pin axial COLUMNS (the BEAVRS `_SHELLS` / `STACKS` / `R[key]` idiom):
    // each pin is a real z-stack of cells, every band with its own concentric
    // shells/materials (fuel/gap/clad, grid sleeve, plenum spring, end plug,
    // nozzle, support plate, …). When present this drives axial structure so the
    // OpenMC core matches the MCNP/Serpent/SCONE decks instead of collapsing to
    // a short, radially-uniform slab.
    const columnModel = buildColumnModel(text);

    // Fallback axial structure for non-column decks: stacked ZPlane-bounded
    // cells (active fuel / plenum / end plugs), best-effort from the z-bands a
    // deck makes explicit via `ZPlane` + `Cell(region=...)` or `ZP[z]` tables.
    const axialBands = columnModel ? [] : findAxialBands(text);
    const hasAxial = columnModel ? true : axialBands.length >= 2;

    // Budget the instance count: degrade detail before hiding pins.
    const maxInstances = opts?.maxInstances && opts.maxInstances > 0 ? opts.maxInstances : DEFAULT_MAX_INSTANCES;
    const tmpls = [
        fuelTemplate ?? defaultTemplate('fuel'),
        guideTemplate ?? defaultTemplate('guide'),
        instrTemplate ?? defaultTemplate('instrument'),
    ];
    const avgLayers = columnModel
        ? columnModel.avgLayers
        : tmpls.reduce((s, t) => s + Math.max(1, t.radii.length), 0) / tmpls.length;
    const axialSegments = columnModel ? Math.max(1, columnModel.maxSegments) : Math.max(1, axialBands.length);
    const plan = planRender({
        totalPins, avgLayers, axialSegments,
        detail, axial: !!opts?.axial && hasAxial, maxInstances,
    });
    const discMode = plan.detail === 'disc';
    const axialOn = plan.axial;

    // Collapsed (axial-off) height + centre: use the real column extent so the
    // core stands at its true 0→460 cm height, not the 40 cm fuel-only default.
    const collapsedHeight = columnModel ? (columnModel.extent[1] - columnModel.extent[0]) : height;
    const collapsedZ = columnModel ? (columnModel.extent[0] + columnModel.extent[1]) / 2 : 0;

    const cylinders: CylinderSpec[] = [];
    let capped = false;

    const templateFor = (token: string): PinTemplate | null => {
        const role = classifyToken(token, universeMap);
        switch (role) {
            case 'guide': return guideTemplate ?? defaultTemplate('guide');
            case 'instrument': return instrTemplate ?? defaultTemplate('instrument');
            case 'empty': return null;
            default: return fuelTemplate ?? defaultTemplate('fuel');
        }
    };

    const subPitch = coreTree ? treeSmallestPitch(coreTree) : (nested ? smallestPitch(named) : Math.min(pitch[0], pitch[1]));

    const placePinAt = (template: PinTemplate, x: number, y: number, z: number, h: number, label: string, fuelMat?: string | null): void => {
        if (cylinders.length >= maxInstances) { capped = true; return; }
        // When a z-band names its own fill, relabel the fuel layer so distinct
        // axial fuel materials read as separate, separately-coloured bands.
        const mats = (fuelMat && fuelMat.length)
            ? template.materials.map((m, i) => (template.components[i] === Component.Fuel ? fuelMat : m))
            : template.materials;
        if (discMode) {
            const solidIdx = Math.max(0, template.components.findIndex((c) => c !== Component.Gap && c !== Component.Moderator));
            cylinders.push({
                label,
                radius: Math.min(subPitch * 0.47, Math.max(...template.radii)),
                height: h,
                x, y, z,
                color: materialColor(mats[solidIdx] ?? mats[0] ?? 'UO2'),
                opacity: 1.0,
                component: template.components[solidIdx] ?? Component.Fuel,
                material: mats[solidIdx] ?? mats[0],
            });
            return;
        }
        cylinders.push(
            ...emitLayers(template.radii, template.components, x, y, z, h, label, undefined, mats),
        );
    };

    // --- Per-pin axial column placement (BEAVRS `_SHELLS`/`STACKS` model) -----

    /** Picks the column for a pin: its own key, else a role-representative. */
    const columnSegsFor = (colKey: string | undefined, role: Role | ResolvedRole): ColumnSegment[] | null => {
        if (!columnModel) return null;
        const cols = columnModel.columns;
        if (colKey && cols.has(colKey)) return cols.get(colKey)!;
        const find = (pred: (k: string) => boolean): ColumnSegment[] | null => {
            for (const [k, v] of cols) if (pred(k)) return v;
            return null;
        };
        if (role === 'guide') return find((k) => k === 'gt') ?? find((k) => /^gt/.test(k));
        if (role === 'instrument') return find((k) => k === 'it') ?? find((k) => /^it/.test(k));
        return find((k) => /^f\d/.test(k)) ?? find((k) => /^f/.test(k)) ?? cols.values().next().value ?? null;
    };

    /** Emits one axial band (a column segment) at a given z / height. */
    const emitSegment = (s: ColumnSegment, x: number, y: number, z: number, h: number, label: string): void => {
        if (cylinders.length >= maxInstances) { capped = true; return; }
        const hh = Math.max(0.01, h);
        if (discMode) {
            if (s.grid) {
                cylinders.push({
                    label, radius: Math.min(subPitch * 0.5, columnModel!.gridOuter), height: hh,
                    x, y, z, color: materialColor('Inconel'), opacity: 1.0,
                    component: Component.Grid, material: 'Inconel',
                });
                return;
            }
            // Pick the band's signature shell: fuel/absorber first (so a fuel
            // band reads as fuel, a BA band as absorber), else the innermost
            // solid (tube / plenum spring / end plug), mirroring the other codes.
            let idx = s.components.findIndex((c) => c === Component.Fuel);
            if (idx < 0) idx = s.components.findIndex((c) => c === Component.Absorber);
            if (idx < 0) idx = s.components.findIndex((c) => c !== Component.Gap && c !== Component.Moderator);
            if (idx < 0) idx = s.radii.length - 1;
            if (idx < 0) return; // pure-coolant band: nothing to draw
            cylinders.push({
                label, radius: Math.min(subPitch * 0.47, s.radii[idx]), height: hh,
                x, y, z, color: materialColor(s.materials[idx] ?? 'UO2'), opacity: 1.0,
                component: s.components[idx], material: s.materials[idx],
            });
            return;
        }
        cylinders.push(...emitLayers(s.radii, s.components, x, y, z, hh, label, undefined, s.materials));
        if (s.grid) {
            cylinders.push({
                label: `${label}_grid`, radius: columnModel!.gridOuter, innerRadius: columnModel!.gridInner,
                height: hh, x, y, z, color: materialColor('Inconel'), opacity: 1.0,
                component: Component.Grid, material: 'Inconel',
            });
        }
    };

    /** Places a full per-pin column: every band when axial on, else one rep. */
    const placeColumnPin = (segs: ColumnSegment[], x: number, y: number, label: string): void => {
        if (cylinders.length >= maxInstances) { capped = true; return; }
        if (axialOn) {
            for (let i = 0; i < segs.length; i++) {
                const s = segs[i];
                emitSegment(s, x, y, (s.zmin + s.zmax) / 2, s.zmax - s.zmin, `${label}_z${i}`);
            }
            return;
        }
        // Collapsed: one representative band (the tallest, usually active fuel)
        // drawn over the full column height so the pin reads at its true extent.
        let rep = segs[0];
        for (const s of segs) if ((s.zmax - s.zmin) > (rep.zmax - rep.zmin)) rep = s;
        emitSegment(rep, x, y, collapsedZ, collapsedHeight, label);
    };

    const placePin = (token: string, x: number, y: number, label: string): void => {
        const role = classifyToken(token, universeMap);
        if (role === 'empty') return;
        if (columnModel) {
            const segs = columnSegsFor(undefined, role);
            if (segs) { placeColumnPin(segs, x, y, label); return; }
        }
        const template = templateFor(token);
        if (!template || !template.render) return;
        if (axialOn) {
            for (let i = 0; i < axialBands.length; i++) {
                const b = axialBands[i];
                const fuelMat = b.fill ? bandFuelName(b.fill, text) : null;
                placePinAt(template, x, y, (b.zmin + b.zmax) / 2, Math.max(0.01, b.zmax - b.zmin), `${label}_z${i}`, fuelMat);
            }
            return;
        }
        placePinAt(template, x, y, 0, height, label);
    };

    const placeGrid = (lat: NamedLattice | { grid: string[][]; pitch: [number, number]; lowerLeft: [number, number] | null }, cx: number, cy: number, label: string, depth: number): void => {
        if (depth > 8 || cylinders.length >= maxInstances) return;
        const g = lat.grid;
        const rows = g.length;
        const cols = g.reduce((m, r) => Math.max(m, r.length), 0);
        const px = lat.pitch[0];
        const py = lat.pitch[1];
        let x0: number;
        let y0: number;
        if (lat.lowerLeft) {
            x0 = cx + lat.lowerLeft[0] + px / 2;
            y0 = cy + lat.lowerLeft[1] + (rows - 1) * py + py / 2;
        } else {
            x0 = cx - (cols - 1) * px / 2;
            y0 = cy + (rows - 1) * py / 2;
        }
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < g[r].length; c++) {
                const token = g[r][c];
                const x = x0 + c * px;
                const y = y0 - r * py;
                const sub = latByName.get(token);
                if (sub) placeGrid(sub, x, y, `${label}_r${r}c${c}`, depth + 1);
                else placePin(token, x, y, `${classifyToken(token, universeMap)}_r${r}c${c}`);
            }
        }
    };

    // Walks the resolved programmatic-core tree (lattices of lattices of pins),
    // placing each pin by its classified role. Mirrors `placeGrid` but consumes
    // pre-resolved `ResolvedNode`s instead of token strings + a name map.
    const placeTree = (node: ResolvedNode, cx: number, cy: number, label: string, depth: number, pitchHint = 1.26): void => {
        if (depth > 10 || cylinders.length >= maxInstances) return;
        if (node.kind === 'skip') return;
        if (node.kind === 'structure') {
            const hw = Math.max(pitchHint * 0.42, 1.0);
            cylinders.push(baffleBox(`${label}_baffle`, cx, cy, hw, { height, zCenter: collapsedZ }));
            return;
        }
        if (node.kind === 'pin') {
            if (node.role === 'empty') return;
            if (columnModel) {
                const segs = columnSegsFor(node.colKey, node.role);
                if (segs) { placeColumnPin(segs, cx, cy, label); return; }
            }
            const template = templateFor(roleToken(node.role));
            if (!template || !template.render) return;
            if (axialOn) {
                for (let i = 0; i < axialBands.length; i++) {
                    const b = axialBands[i];
                    const fuelMat = b.fill ? bandFuelName(b.fill, text) : null;
                    placePinAt(template, cx, cy, (b.zmin + b.zmax) / 2, Math.max(0.01, b.zmax - b.zmin), `${label}_z${i}`, fuelMat);
                }
            } else {
                placePinAt(template, cx, cy, 0, height, label);
            }
            return;
        }
        const g = node.grid;
        const rows = g.length;
        const cols = g.reduce((m, r) => Math.max(m, r.length), 0);
        const px = node.pitch[0];
        const py = node.pitch[1];
        let x0: number;
        let y0: number;
        if (node.lowerLeft) {
            // `lower_left` is in the lattice's own local frame; offset by the
            // parent cell centre (cx, cy) so nested assemblies land in their
            // core position instead of all stacking on the origin.
            x0 = cx + node.lowerLeft[0] + px / 2;
            y0 = cy + node.lowerLeft[1] + (rows - 1) * py + py / 2;
        } else {
            x0 = cx - (cols - 1) * px / 2;
            y0 = cy + (rows - 1) * py / 2;
        }
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < g[r].length; c++) {
                placeTree(g[r][c], x0 + c * px, y0 - r * py, `${label}_r${r}c${c}`, depth + 1, Math.max(px, py));
            }
        }
    };

    if (coreTree) {
        placeTree(coreTree, 0, 0, 'core', 0);
        const asmCount = countTreeLattices(coreTree);
        notes.push(`Expanded a programmatic OpenMC core (${asmCount} assembly lattice(s), ${totalPins.toLocaleString()} pins) by statically resolving the comprehension/dict-built universe map.`);
    } else if (nested) {
        placeGrid(nested, 0, 0, 'core', 0);
        notes.push(`Expanded a nested OpenMC core (${nested.grid.length}×${nested.grid[0]?.length ?? 0} of ${named.length - 1} assembly lattice(s)).`);
    } else {
        placeGrid({ grid: grid!, pitch, lowerLeft }, 0, 0, 'asm', 0);
        const rows = grid!.length;
        const cols = grid!.reduce((m, r) => Math.max(m, r.length), 0);
        notes.push(`Expanded a ${rows}×${cols} lattice (${cylinders.length} ${discMode ? 'pins' : 'pin layers'}).`);
    }

    // Radial containment shells (barrel, shields, downcomer, RPV) + baffle boxes above.
    const structN = emitOpenmcRadialStructure(text, cylinders, { height: collapsedHeight, zCenter: collapsedZ });
    if (structN > 0) {
        notes.push(`Drew ${structN} radial-structure primitive(s) (barrel, neutron-shield pads, downcomer, RPV). Baffle universes render as thin boxes at peripheral lattice positions.`);
    }

    if (discMode) {
        notes.push(`Disc mode: one disc per pin. Switch "Pin detail" to Detailed layers for concentric fuel/gap/clad/coolant shells.`);
    }
    if (isHex) {
        notes.push('Hex lattice laid out on a rectangular approximation (OpenMC HexLattice index order is not reconstructed).');
        for (const cyl of cylinders) cyl.label = `hexapprox_${cyl.label}`;
    }
    if (columnModel) {
        const span = `${columnModel.extent[0].toFixed(1)}–${columnModel.extent[1].toFixed(1)} cm`;
        if (axialOn) {
            notes.push(`Axial detail: each pin reconstructed as its real z-stack (up to ${columnModel.maxSegments} bands over ${span}) from the deck's _SHELLS/STACKS tables — grid spacers, plena, end plugs and nozzles render with their own shells/materials. Use the Axial Layers toggles and the Axial slice to inspect levels.`);
        } else {
            notes.push(`This deck builds per-pin axial columns (active fuel, grid spacers, plena, end plugs, nozzles over ${span}). Enable "Axial segments" to expand them; the Axial slice control then cuts the stack by height.`);
        }
    } else if (axialOn) {
        notes.push(`Axial detail: pins expanded into ${axialBands.length} z-bands from the deck's ZPlane stack. Use the Axial Layers toggles and the Axial slice to inspect levels.`);
    } else if (hasAxial) {
        notes.push('This deck defines axial structure (ZPlane-bounded cell stacks). Enable "Axial segments" to expand it; the Axial slice control then cuts the stack by height.');
    }

    const fidelity: FidelityState = { detail: plan.detail, axial: axialOn, autoDetail, totalPins, hasAxial };
    return { cylinders, warnings, notes, fidelity, capped };
}

// ---------------------------------------------------------------------------
// Axial bands (ZPlane-bounded cell stacks)
// ---------------------------------------------------------------------------

/**
 * Recovers axial z-bands from an OpenMC script: `ZPlane(z0=…)` surfaces bounding
 * `Cell(region=+a & -b, fill=…)` stacks. Returns the sorted band list (≥2 bands
 * means a real stack). Best-effort — only what the deck makes explicit.
 */
function findAxialBands(text: string): AxialBand[] {
    const zplanes = new Map<string, number>();
    const zRe = /([A-Za-z_]\w*)\s*=\s*openmc\.ZPlane\s*\(([^)]*)\)/g;
    for (const m of text.matchAll(zRe)) {
        const zm = m[2].match(/z0\s*=\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/);
        if (zm) zplanes.set(m[1], Number(zm[1]));
    }

    if (zplanes.size >= 2) {
        const bands: AxialBand[] = [];
        const cellRe = /openmc\.Cell\s*\(([^)]*)\)/g;
        for (const m of text.matchAll(cellRe)) {
            const args = m[1];
            if (!/region\s*=/.test(args)) continue;
            const zs: number[] = [];
            for (const vm of args.matchAll(/[+\-]\s*([A-Za-z_]\w*)/g)) {
                const z = zplanes.get(vm[1]);
                if (z !== undefined) zs.push(z);
            }
            if (zs.length < 2) continue;
            const fm = args.match(/fill\s*=\s*([A-Za-z_]\w*)/);
            const zmin = Math.min(...zs);
            const zmax = Math.max(...zs);
            if (zmax > zmin) bands.push({ zmin, zmax, fill: fm ? fm[1] : null });
        }
        bands.sort((a, b) => a.zmin - b.zmin);
        if (bands.length >= 2) return bands;
    }

    // Fallback for the dict-of-planes idiom: `ZP[z] = openmc.ZPlane(z0=z)` and
    // columns built from `(z_bottom, z_top, key)` stack tables referenced as
    // `region=+ZP[zb] & -ZP[zt], fill=R[key]`. The per-cell zb/zt are loop
    // variables (not statically resolvable), so we recover the band grid from
    // the stack tables themselves: the union of every (z_bottom, z_top, key)
    // tuple's boundaries. (BEAVRS OpenMC full-core deck.)
    if (/\bZP\s*\[/.test(text) && /region\s*=\s*[^\n,]*ZP\s*\[/.test(text)) {
        return findAxialBandsFromStackTables(text);
    }
    return [];
}

/**
 * Recovers axial bands from `(z_bottom, z_top, key)` stack tables (the BEAVRS
 * OpenMC `STACKS` / `_fuel_stack` idiom). Harvests every such tuple, takes the
 * union of its z-boundaries as the global band grid, and tags each band with the
 * `key` of the finest tuple that exactly spans it (so a fuel band still names
 * its fuel fill). All-numeric third fields (colors / coordinates) are skipped.
 */
function findAxialBandsFromStackTables(text: string): AxialBand[] {
    const tupleRe = /\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*([^)]+?)\s*\)/g;
    const intervals: { zmin: number; zmax: number; key: string }[] = [];
    for (const m of text.matchAll(tupleRe)) {
        const third = m[3].trim();
        if (/^[\d.+\-eE\s]*$/.test(third)) continue; // numeric 3rd field → not a stack key
        const zmin = Number(m[1]);
        const zmax = Number(m[2]);
        if (!(zmax > zmin)) continue;
        const key = third.replace(/^['"]|['"]$/g, '');
        intervals.push({ zmin, zmax, key });
    }
    if (intervals.length < 2) return [];

    const bounds = [...new Set(intervals.flatMap((iv) => [iv.zmin, iv.zmax]))].sort((a, b) => a - b);
    if (bounds.length < 3) return [];

    const bands: AxialBand[] = [];
    for (let i = 0; i + 1 < bounds.length; i++) {
        const zmin = bounds[i];
        const zmax = bounds[i + 1];
        // Prefer a fuel-bearing key that exactly spans this band, so fuel bands
        // keep an enrichment-aware fill; otherwise the first exact match.
        const exact = intervals.filter((iv) => iv.zmin === zmin && iv.zmax === zmax);
        const fuelKey = exact.find((iv) => /fuel|pellet|uo2|mox|^f\d/i.test(iv.key));
        const fill = (fuelKey ?? exact[0])?.key ?? null;
        bands.push({ zmin, zmax, fill });
    }
    return bands;
}

/**
 * Maps a band's fill variable to a fuel material name (with enrichment) when it
 * is a fuel universe, so the legend distinguishes axial fuel zones. Falls back
 * to the variable name itself.
 */
function bandFuelName(fill: string, text: string): string | null {
    if (!/fuel|pellet|uo2|mox/i.test(fill)) return null;
    return findFuelName(text) ?? fill;
}

// ---------------------------------------------------------------------------
// Per-pin axial columns (BEAVRS `_SHELLS` / `STACKS` / `R[key]` reconstruction)
// ---------------------------------------------------------------------------
//
// The BEAVRS OpenMC full-core deck builds each pin as an axial STACK of cells:
// a `STACKS[key]` table of `(z_bottom, z_top, radial_key)` tuples, where each
// `radial_key` indexes `R` (= `make_pin(_SHELLS[key])`) — a concentric shell
// set (fuel/gap/clad/coolant, grid sleeve, plenum spring, end plug, nozzle …).
// The v0.2.7/0.2.8 parser recovered only the union of z-boundaries and applied
// one role-based radial template uniformly to every band, so the OpenMC core
// rendered as a short, radially-flat slab (active fuel only, default 2-shell
// pin). This resolver statically reconstructs each column so a pin renders its
// real per-z shells and materials — matching the MCNP/Serpent/SCONE decks.

interface ColumnSegment {
    zmin: number;
    zmax: number;
    radii: number[];
    components: ComponentId[];
    materials: string[];
    /** Inconel grid-spacer sleeve overlays this band's coolant channel. */
    grid: boolean;
    /** Radial `_SHELLS` key this band resolved from (sans grid suffix). */
    segKey: string;
}

interface ColumnModel {
    /** Column key (`f16`/`gt`/`ba`/…) → bottom-to-top axial segments. */
    columns: Map<string, ColumnSegment[]>;
    /** Full axial extent across all columns (cm). */
    extent: [number, number];
    /** Largest per-column segment count (drives the instance budget). */
    maxSegments: number;
    /** Mean concentric-shell count per segment (drives the layers budget). */
    avgLayers: number;
    /** Grid-sleeve inner / outer half-width (cm). */
    gridInner: number;
    gridOuter: number;
}

interface Shell { material: string; r: number | null; }

/** Maps `var = openmc.Material(name="…")` to a var → friendly-name table. */
function parseMaterialNames(text: string): Map<string, string> {
    const out = new Map<string, string>();
    const re = /([A-Za-z_]\w*)\s*=\s*openmc\.Material\s*\(([^)]*)\)/g;
    for (const m of text.matchAll(re)) {
        const nm = m[2].match(/name\s*=\s*['"]([^'"]+)['"]/);
        out.set(m[1], nm ? nm[1] : m[1]);
    }
    return out;
}

/**
 * Parses the `_SHELLS = { key: [(mat, r), …, (mat, None)] }` dict into a
 * key → shell-list table. The final `None` radius is the infinite outer fill
 * (coolant) and is preserved so callers can drop it from the drawn radii.
 */
function parseShellsDict(text: string, matNames: Map<string, string>): Map<string, Shell[]> {
    const out = new Map<string, Shell[]>();
    const m = text.match(/_SHELLS\s*=\s*\{/);
    if (!m || m.index === undefined) return out;
    const open = text.indexOf('{', m.index);
    const close = findMatching(text, open);
    if (close < 0) return out;
    for (const part of splitTopLevel(text.slice(open + 1, close))) {
        const colon = topLevelColon(part);
        if (colon < 0) continue;
        const km = part.slice(0, colon).trim().match(/^['"]([^'"]+)['"]$/);
        if (!km) continue;
        const listExpr = part.slice(colon + 1).trim();
        const lo = listExpr.indexOf('[');
        if (lo < 0) continue;
        const lc = findMatching(listExpr, lo);
        if (lc < 0) continue;
        const shells: Shell[] = [];
        for (const tup of splitTopLevel(listExpr.slice(lo + 1, lc))) {
            const t = tup.trim();
            if (!t.startsWith('(')) continue;
            const tc = findMatching(t, 0);
            if (tc < 0) continue;
            const fields = splitTopLevel(t.slice(1, tc)).map((s) => s.trim());
            if (fields.length < 2) continue;
            const matVar = fields[0];
            const rRaw = fields[1];
            const material = matNames.get(matVar) ?? matVar;
            const r = /none/i.test(rRaw) ? null : Number(rRaw);
            shells.push({ material, r: r !== null && Number.isFinite(r) ? r : null });
        }
        if (shells.length) out.set(km[1], shells);
    }
    return out;
}

/** A stack-builder function (`_fuel_stack(e)`): its parameter + tuple template. */
interface StackFn { param: string; tuples: { zmin: number; zmax: number; keyExpr: string }[]; }

/** Finds `def NAME(param): return [ (num, num, keyExpr), … ]` stack builders. */
function parseStackFns(text: string): Map<string, StackFn> {
    const out = new Map<string, StackFn>();
    const defRe = /(^|\n)def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:/g;
    for (const dm of text.matchAll(defRe)) {
        const name = dm[2];
        const param = dm[3].split(',')[0].split(/[:=]/)[0].trim();
        if (!param) continue;
        const bodyStart = (dm.index ?? 0) + dm[0].length;
        const rest = text.slice(bodyStart);
        const nextDef = rest.search(/\n[A-Za-z_#@]/);
        const body = nextDef >= 0 ? rest.slice(0, nextDef) : rest;
        const tuples = parseStackTuples(body);
        if (tuples.length >= 2) out.set(name, { param, tuples });
    }
    return out;
}

/** Parses `(z_bottom, z_top, key_expr)` tuples from a block of text. */
function parseStackTuples(body: string): { zmin: number; zmax: number; keyExpr: string }[] {
    const open = body.indexOf('[');
    if (open < 0) return [];
    const close = findMatching(body, open);
    if (close < 0) return [];
    const out: { zmin: number; zmax: number; keyExpr: string }[] = [];
    for (const part of splitTopLevel(body.slice(open + 1, close))) {
        const t = part.trim();
        if (!t.startsWith('(')) continue;
        const tc = findMatching(t, 0);
        if (tc < 0) continue;
        const fields = splitTopLevel(t.slice(1, tc)).map((s) => s.trim());
        if (fields.length < 3) continue;
        const zmin = Number(fields[0]);
        const zmax = Number(fields[1]);
        if (!Number.isFinite(zmin) || !Number.isFinite(zmax) || !(zmax > zmin)) continue;
        out.push({ zmin, zmax, keyExpr: fields.slice(2).join(',').trim() });
    }
    return out;
}

/** Resolves a stack-table key expression (`e`, `e + "g"`, `"w"`) to a key. */
function resolveKeyExpr(expr: string, param: string, argVal: string): string {
    const arg = argVal.replace(/^['"]|['"]$/g, '');
    const lit = expr.match(/^['"]([^'"]+)['"]$/);
    if (lit) return lit[1];
    // `e + "g"` / `e+'g'` → arg + suffix.
    const plus = expr.match(/^([A-Za-z_]\w*)\s*\+\s*['"]([^'"]*)['"]$/);
    if (plus && plus[1] === param) return arg + plus[2];
    if (expr === param) return arg;
    return expr.replace(/^['"]|['"]$/g, '');
}

/**
 * Parses `STACKS = { "f16": _fuel_stack("f16"), "gt": [ (…) , … ], … }` into a
 * column key → `(zb, zt, radial_key)` table, expanding stack-builder calls.
 */
function parseStacksDict(text: string, stackFns: Map<string, StackFn>): Map<string, { zmin: number; zmax: number; key: string }[]> {
    const out = new Map<string, { zmin: number; zmax: number; key: string }[]>();
    const m = text.match(/\bSTACKS\s*=\s*\{/);
    if (!m || m.index === undefined) return out;
    const open = text.indexOf('{', m.index);
    const close = findMatching(text, open);
    if (close < 0) return out;
    for (const part of splitTopLevel(text.slice(open + 1, close))) {
        const colon = topLevelColon(part);
        if (colon < 0) continue;
        const km = part.slice(0, colon).trim().match(/^['"]([^'"]+)['"]$/);
        if (!km) continue;
        const colKey = km[1];
        const valExpr = part.slice(colon + 1).trim();
        let table: { zmin: number; zmax: number; key: string }[] = [];
        const call = valExpr.match(/^([A-Za-z_]\w*)\s*\(([\s\S]*)\)$/);
        if (call && stackFns.has(call[1])) {
            const fn = stackFns.get(call[1])!;
            const arg = splitTopLevel(call[2])[0]?.trim() ?? '';
            table = fn.tuples.map((t) => ({ zmin: t.zmin, zmax: t.zmax, key: resolveKeyExpr(t.keyExpr, fn.param, arg) }));
        } else if (valExpr.startsWith('[')) {
            table = parseStackTuples(valExpr).map((t) => ({ zmin: t.zmin, zmax: t.zmax, key: t.keyExpr.replace(/^['"]|['"]$/g, '') }));
        }
        if (table.length >= 2) out.set(colKey, table);
    }
    return out;
}

/** Classifies a shell material (in the context of its column key) to a component. */
function shellComponent(material: string, segKey: string): ComponentId {
    const low = material.toLowerCase();
    const tube = /^(gt|gtd|it|itb|ssgt|ssdp|ba|bap)/.test(segKey);
    if (/uo2|fuel|pellet|mox/.test(low)) return Component.Fuel;
    if (/helium|\bhe\b|\bair\b/.test(low)) return Component.Gap;
    if (/pyrex|glass|borosil/.test(low)) return Component.Absorber;
    if (/inconel/.test(low)) return Component.Plenum;
    if (/(borated|\bbw\b)/.test(low)) return Component.Moderator;
    if (/water|h2o|coolant|moderat/.test(low)) return Component.Moderator;
    if (/zirc|\bzr\b/.test(low)) {
        if (segKey === 'zr') return Component.EndPlug;
        if (/^(it|itb)/.test(segKey)) return Component.InstrumentTube;
        if (tube) return Component.GuideTube;
        return Component.Clad;
    }
    if (/steel|stainless|\bss\b|support/.test(low)) {
        if (segKey === 'ss') return Component.EndPlug; // top nozzle (End Plugs / Nozzles)
        return Component.Structure;
    }
    return Component.Other;
}

/** Builds a radial template (drawn shells only) from a shell list. */
function templateFromShells(shells: Shell[], segKey: string): { radii: number[]; components: ComponentId[]; materials: string[] } {
    const radii: number[] = [];
    const components: ComponentId[] = [];
    const materials: string[] = [];
    for (const sh of shells) {
        if (sh.r === null || !(sh.r > 0)) continue; // infinite outer coolant fill
        radii.push(sh.r);
        materials.push(sh.material);
        components.push(shellComponent(sh.material, segKey));
    }
    return { radii, components, materials };
}

/**
 * Reconstructs the per-pin axial columns from a BEAVRS-style OpenMC deck.
 * Returns null when the deck doesn't use the `_SHELLS` + `STACKS` idiom (so the
 * generic axial-band path stays in charge for simpler decks).
 */
function buildColumnModel(text: string): ColumnModel | null {
    const matNames = parseMaterialNames(text);
    const shells = parseShellsDict(text, matNames);
    if (shells.size === 0) return null;
    const stackFns = parseStackFns(text);
    const stacks = parseStacksDict(text, stackFns);
    if (stacks.size === 0) return null;

    const gm = text.match(/GRID_OUT\s*=\s*2\s*\*\s*([\d.]+)/);
    const gim = text.match(/GRID_IN\s*=\s*2\s*\*\s*([\d.]+)/);
    const gridOuter = gm ? Number(gm[1]) : 0.62992;
    const gridInner = gim ? Number(gim[1]) : 0.61015;

    const columns = new Map<string, ColumnSegment[]>();
    let zmin = Infinity;
    let zmax = -Infinity;
    let maxSegments = 0;
    let layerSum = 0;
    let layerCount = 0;

    for (const [colKey, table] of stacks) {
        const segs: ColumnSegment[] = [];
        for (const t of table) {
            let key = t.key;
            let grid = false;
            let sh = shells.get(key);
            if (!sh && key.endsWith('g') && shells.get(key.slice(0, -1))) {
                grid = true;
                key = key.slice(0, -1);
                sh = shells.get(key);
            }
            let radii: number[];
            let components: ComponentId[];
            let materials: string[];
            if (sh) {
                ({ radii, components, materials } = templateFromShells(sh, key));
            } else {
                // Unknown radial key: fall back to a role-classified default pin.
                const tmpl = defaultTemplate(classifyKey(key) === 'guide' ? 'guide' : classifyKey(key) === 'instrument' ? 'instrument' : 'fuel');
                radii = tmpl.radii; components = tmpl.components; materials = tmpl.materials;
            }
            segs.push({ zmin: t.zmin, zmax: t.zmax, radii, components, materials, grid, segKey: key });
            zmin = Math.min(zmin, t.zmin);
            zmax = Math.max(zmax, t.zmax);
            layerSum += Math.max(1, radii.length) + (grid ? 1 : 0);
            layerCount++;
        }
        if (segs.length >= 2) {
            segs.sort((a, b) => a.zmin - b.zmin);
            columns.set(colKey, segs);
            maxSegments = Math.max(maxSegments, segs.length);
        }
    }

    if (columns.size === 0 || !Number.isFinite(zmin) || !Number.isFinite(zmax)) return null;
    return {
        columns,
        extent: [zmin, zmax],
        maxSegments,
        avgLayers: layerCount > 0 ? layerSum / layerCount : 2,
        gridInner,
        gridOuter,
    };
}

// ---------------------------------------------------------------------------
// Nested-lattice / core helpers
// ---------------------------------------------------------------------------

/** Finds named RectLattices and their `.universes` grids, pitch, lower_left. */
function findNamedLattices(text: string): NamedLattice[] {
    const out: NamedLattice[] = [];
    const uniRe = /([A-Za-z_]\w*)\s*\.\s*universes\s*=\s*/g;
    let m: RegExpExecArray | null;
    while ((m = uniRe.exec(text)) !== null) {
        const name = m[1];
        const rhsStart = uniRe.lastIndex;
        const rhs = text.slice(rhsStart, rhsStart + 4000);
        let grid: string[][] | null = null;
        const trimmed = rhs.replace(/^\s+/, '');
        if (trimmed.startsWith('[')) {
            const open = text.indexOf('[', rhsStart);
            const close = matchBracket(text, open);
            if (close > open) grid = parseRows(text.slice(open + 1, close));
        } else {
            const vm = trimmed.match(/^([A-Za-z_]\w*)/);
            if (vm) grid = buildNumpyGrid(text, vm[1]);
        }
        if (!grid || grid.length === 0) continue;
        out.push({
            name,
            grid,
            pitch: findNamedPitch(text, name) ?? [1.26, 1.26],
            lowerLeft: findNamedLowerLeft(text, name),
        });
    }
    return out;
}

function findNamedPitch(text: string, name: string): [number, number] | null {
    const re = new RegExp(`${escapeRe(name)}\\s*\\.\\s*pitch\\s*=\\s*([^\\n]+)`);
    const m = text.match(re);
    if (!m) return null;
    const nums = extractNumbers(m[1]);
    if (nums.length >= 2) return [nums[0], nums[1]];
    if (nums.length === 1) return [nums[0], nums[0]];
    return null;
}

function findNamedLowerLeft(text: string, name: string): [number, number] | null {
    const re = new RegExp(`${escapeRe(name)}\\s*\\.\\s*lower_left\\s*=\\s*([^\\n]+)`);
    const m = text.match(re);
    if (!m) return null;
    const nums = extractNumbers(m[1]);
    if (nums.length >= 2) return [nums[0], nums[1]];
    return null;
}

function smallestPitch(named: NamedLattice[]): number {
    let p = Infinity;
    for (const l of named) p = Math.min(p, l.pitch[0], l.pitch[1]);
    return isFinite(p) && p > 0 ? p : 1.26;
}

function countOpenmcPins(grid: string[][], latByName: Map<string, NamedLattice>, universeMap: Map<string, string>, depth = 0): number {
    if (depth > 8) return 0;
    let total = 0;
    for (const row of grid) {
        for (const token of row) {
            const sub = latByName.get(token);
            if (sub) total += countOpenmcPins(sub.grid, latByName, universeMap, depth + 1);
            else if (classifyToken(token, universeMap) !== 'empty') total += 1;
        }
    }
    return total;
}

/** Recovers the fuel material name (with enrichment) from add_nuclide calls. */
function findFuelName(text: string): string | null {
    const matRe = /openmc\.Material\s*\(([^)]*)\)/g;
    // Fallback: scan whole text for U235/U238 fractions to compute enrichment.
    const u5 = text.match(/add_nuclide\s*\(\s*['"]U235['"]\s*,\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/);
    const u8 = text.match(/add_nuclide\s*\(\s*['"]U238['"]\s*,\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/);
    if (u5) {
        const a = Math.abs(Number(u5[1]));
        const b = u8 ? Math.abs(Number(u8[1])) : 0;
        if (a > 0 && a + b > 0) return `UO2 ${((a / (a + b)) * 100).toFixed(1)}%`;
    }
    void matRe;
    return null;
}

function addVesselShells(text: string, cylinders: CylinderSpec[], height: number, zCenter = 0): void {
    if (cylinders.length === 0) return;
    let footprint = 0;
    for (const c of cylinders) footprint = Math.max(footprint, Math.hypot(c.x, c.y) + c.radius);
    const radii: number[] = [];
    const zr = /openmc\.ZCylinder\s*\(([^)]*)\)/g;
    for (const m of text.matchAll(zr)) {
        const rm = m[1].match(/r\s*=\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/);
        if (rm) {
            const r = Number(rm[1]);
            if (r > footprint * 1.2) radii.push(r);
        }
    }
    radii.sort((a, b) => b - a);
    for (const r of radii.slice(0, 4)) {
        cylinders.push({
            label: `vessel_${r}`, radius: r, height, x: 0, y: 0, z: zCenter,
            color: componentColor(Component.Vessel), opacity: 0.12,
            component: Component.Vessel, material: 'Structure',
        });
    }
}

// ---------------------------------------------------------------------------

function collectRadii(text: string, lines: string[]): NamedValue[] {
    const pool: NamedValue[] = [];

    // Scalar assignments: `fuel_radius = 0.4096`
    for (const line of lines) {
        const m = line.match(/^\s*([A-Za-z_]\w*)\s*=\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*(?:#.*)?$/);
        if (m) {
            const v = Number(m[2]);
            if (!Number.isNaN(v) && v > 0 && v < 50) pool.push({ name: m[1], value: v });
        }
    }

    // ZCylinder surfaces: `clad_outer_surf = openmc.ZCylinder(r=clad_outer)` or
    // `... ZCylinder(r=0.475)`.
    const zRe = /([A-Za-z_]\w*)\s*=\s*openmc\.ZCylinder\s*\(([^)]*)\)/g;
    for (const m of text.matchAll(zRe)) {
        const name = m[1];
        const args = m[2];
        const rm = args.match(/r\s*=\s*([A-Za-z_]\w*|[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/);
        if (!rm) continue;
        const raw = rm[1];
        let value: number | null = null;
        if (/^[A-Za-z_]/.test(raw)) {
            const found = pool.find((p) => p.name === raw);
            if (found) value = found.value;
        } else {
            const n = Number(raw);
            if (!Number.isNaN(n)) value = n;
        }
        if (value !== null && value > 0 && value < 50) pool.push({ name, value });
    }

    return pool;
}

/** Strips a `#` comment so commented-out mentions never feed number scans. */
function stripPyComment(line: string): string {
    return line.replace(/#.*$/, '');
}

function findPitch(lines: string[]): [number, number] {
    for (const raw of lines) {
        const line = stripPyComment(raw);
        if (!/pitch/i.test(line) || !line.includes('=')) continue;
        const nums = extractNumbers(line.replace(/.*?=/, ''));
        if (nums.length >= 2) return [nums[0], nums[1]];
        if (nums.length === 1) return [nums[0], nums[0]];
    }
    return [1.26, 1.26];
}

function findLowerLeft(lines: string[]): [number, number] | null {
    for (const raw of lines) {
        const line = stripPyComment(raw);
        if (!/lower_left/i.test(line) || !line.includes('=')) continue;
        const nums = extractNumbers(line.replace(/.*?=/, ''));
        if (nums.length >= 2) return [nums[0], nums[1]];
    }
    return null;
}

function findHeight(lines: string[]): number {
    for (const raw of lines) {
        const line = stripPyComment(raw);
        const low = line.toLowerCase();
        if ((low.includes('fuel_height') || (low.includes('height') && low.includes('active'))) && line.includes('=')) {
            const nums = extractNumbers(line.replace(/.*?=/, ''));
            if (nums.length) return Math.abs(nums[0]);
        }
    }
    return 40.0;
}

function findUniverseMap(text: string): Map<string, string> {
    const map = new Map<string, string>();
    // `universe_map = {'F': fuel_pin, 'G': guide_tube, 'I': instr_tube}`
    const dictRe = /\{([^{}]*?['"][^{}]*?)\}/g;
    for (const m of text.matchAll(dictRe)) {
        const body = m[1];
        const pairRe = /['"]([^'"]+)['"]\s*:\s*([A-Za-z_]\w*)/g;
        for (const p of body.matchAll(pairRe)) {
            map.set(p[1], p[2]);
        }
    }
    return map;
}

type Role = 'fuel' | 'guide' | 'instrument' | 'empty';

function classifyToken(token: string, universeMap: Map<string, string>): Role {
    let name = token.trim().replace(/^['"]|['"]$/g, '');
    if (universeMap.has(name)) name = universeMap.get(name)!;
    const low = name.toLowerCase();
    if (/guide/.test(low)) return 'guide';
    if (/instr|instrument/.test(low)) return 'instrument';
    if (/(^|_)tube/.test(low) && !/guide/.test(low)) return 'instrument';
    if (/fuel|pellet/.test(low)) return 'fuel';
    if (/(water|mod|cool|empty|none|void)/.test(low)) return 'empty';
    // Single-letter conventions: F fuel, G guide, I instrument, W/E water.
    if (low === 'g') return 'guide';
    if (low === 'i') return 'instrument';
    if (low === 'f') return 'fuel';
    if (low === 'w' || low === 'e' || low === '0') return 'empty';
    return 'fuel';
}

function buildTemplate(pool: NamedValue[], role: Role, fuelName?: string | null): PinTemplate | null {
    let matcher: RegExp;
    if (role === 'fuel') matcher = /(fuel|pellet|gap|clad)/i;
    else if (role === 'guide') matcher = /guide/i;
    else matcher = /(instr|tube)/i;

    const entries = pool.filter((p) => matcher.test(p.name) && (role !== 'instrument' || !/guide/i.test(p.name)));
    if (entries.length === 0) return null;

    // Deduplicate by value, keep first name seen.
    const byValue = new Map<number, string>();
    for (const e of entries) if (!byValue.has(e.value)) byValue.set(e.value, e.name);
    const sorted = [...byValue.entries()].sort((a, b) => a[0] - b[0]);

    const radii = sorted.map((s) => s[0]);
    const components = sorted.map((s) => assignComponent(s[1], role));
    // Name the fuel layer after the actual material (with enrichment) so the
    // legend/colour distinguishes 1.6 / 2.4 / 3.1 % bands like SCONE/Serpent.
    const materials = sorted.map((s, i) => (role === 'fuel' && fuelName && components[i] === Component.Fuel ? fuelName : s[1]));
    return { radii, components, materials, render: true };
}

function assignComponent(name: string, role: Role): ComponentId {
    const low = name.toLowerCase();
    if (role === 'fuel') {
        if (/clad.*out|clad_or|cladding/.test(low)) return Component.Clad;
        if (/clad.*in/.test(low)) return Component.Gap;
        if (/gap/.test(low)) return Component.Gap;
        if (/clad/.test(low)) return Component.Clad;
        if (/fuel|pellet/.test(low)) return Component.Fuel;
        return Component.Fuel;
    }
    if (role === 'guide') {
        if (/in/.test(low)) return Component.Moderator;
        return Component.GuideTube;
    }
    // instrument
    if (/in/.test(low)) return Component.Moderator;
    return Component.InstrumentTube;
}

function defaultTemplate(role: Role): PinTemplate {
    if (role === 'guide') {
        return { radii: [0.5610, 0.6020], components: [Component.Moderator, Component.GuideTube], materials: ['Water', 'Zircaloy'], render: true };
    }
    if (role === 'instrument') {
        return { radii: [0.5590, 0.6050], components: [Component.Moderator, Component.InstrumentTube], materials: ['Water', 'Zircaloy'], render: true };
    }
    return { radii: [0.41, 0.475], components: [Component.Fuel, Component.Clad], materials: ['UO2', 'Zircaloy'], render: true };
}

// ---------------------------------------------------------------------------
// Nested-list grid parser
// ---------------------------------------------------------------------------

/** Returns the best 2D grid of raw tokens found among list-of-lists literals. */
function findLatticeGrid(text: string): string[][] | null {
    let best: string[][] | null = null;
    let bestScore = 0;

    const assignRe = /[\w.]+\s*=\s*\[/g;
    let m: RegExpExecArray | null;
    while ((m = assignRe.exec(text)) !== null) {
        const open = assignRe.lastIndex - 1; // position of '['
        const close = matchBracket(text, open);
        if (close < 0) continue;
        const body = text.slice(open + 1, close);
        const grid = parseRows(body);
        if (grid && grid.length >= 2) {
            const cols = grid.reduce((mx, r) => Math.max(mx, r.length), 0);
            const score = grid.length * cols;
            if (cols >= 2 && score > bestScore) {
                bestScore = score;
                best = grid;
            }
        }
        assignRe.lastIndex = close;
    }
    return best;
}

function matchBracket(text: string, openIdx: number): number {
    let depth = 0;
    for (let i = openIdx; i < text.length; i++) {
        const ch = text[i];
        if (ch === '[') depth++;
        else if (ch === ']') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/** Parses inner `[ ... ]` rows from the body of an outer list. */
function parseRows(body: string): string[][] | null {
    const rows: string[][] = [];
    let i = 0;
    while (i < body.length) {
        if (body[i] === '[') {
            const close = matchBracket(body, i);
            if (close < 0) break;
            const inner = body.slice(i + 1, close);
            // Only treat as a row if it has no further nested lists.
            if (!inner.includes('[')) {
                const tokens = inner
                    .split(',')
                    .map((t) => t.trim().replace(/^['"]|['"]$/g, ''))
                    .filter((t) => t.length > 0);
                if (tokens.length) rows.push(tokens);
            }
            i = close + 1;
        } else {
            i++;
        }
    }
    return rows.length ? rows : null;
}

// ---------------------------------------------------------------------------
// NumPy-built grid parser
// ---------------------------------------------------------------------------

/**
 * Reconstructs a lattice grid from the `np.full((R, C), base)` + assignment
 * idiom. Handles element assignments (`arr[i, j] = X`, `arr[i][j] = X`) and
 * coordinate-list loops (`for (i, j) in [(r,c), …]: arr[i, j] = X`).
 */
function buildNumpyGrid(text: string, arrName?: string): string[][] | null {
    const namePat = arrName ? escapeRe(arrName) : '[A-Za-z_]\\w*';
    const fullRe = new RegExp(`(${namePat})\\s*=\\s*np(?:numpy)?\\.(?:full|empty|zeros|ones)\\s*\\(\\s*\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*\\)\\s*(?:,\\s*([A-Za-z_]\\w*))?`);
    const m = text.match(fullRe);
    if (!m) return null;
    const arr = m[1];
    const rows = parseInt(m[2], 10);
    const cols = parseInt(m[3], 10);
    const base = m[4] ?? '0';
    if (!(rows > 0 && cols > 0) || rows * cols > 1_000_000) return null;

    const grid: string[][] = [];
    for (let r = 0; r < rows; r++) grid.push(new Array(cols).fill(base));

    const setCell = (i: number, j: number, val: string) => {
        if (i >= 0 && i < rows && j >= 0 && j < cols) grid[i][j] = val;
    };

    // Direct element assignments: arr[i, j] = X  /  arr[i][j] = X
    const a = escapeRe(arr);
    const elemRe = new RegExp(`${a}\\s*\\[\\s*(\\d+)\\s*(?:,|\\]\\s*\\[)\\s*(\\d+)\\s*\\]\\s*=\\s*([A-Za-z_]\\w*)`, 'g');
    for (const em of text.matchAll(elemRe)) {
        setCell(parseInt(em[1], 10), parseInt(em[2], 10), em[3]);
    }

    // Coordinate-list loops:
    //   for (i, j) in [(2,5), (2,8), …]:
    //       arr[i, j] = G
    const loopRe = /for\s*\(?\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)\s*\)?\s+in\s*\[([\s\S]*?)\]\s*:/g;
    for (const lm of text.matchAll(loopRe)) {
        const vi = lm[1];
        const vj = lm[2];
        const listBody = lm[3];
        const after = text.slice((lm.index ?? 0) + lm[0].length);
        // Find the assignment that uses the loop vars within the next few lines.
        const bodyRe = new RegExp(`${a}\\s*\\[\\s*${escapeRe(vi)}\\s*(?:,|\\]\\s*\\[)\\s*${escapeRe(vj)}\\s*\\]\\s*=\\s*([A-Za-z_]\\w*)`);
        const bm = after.slice(0, 600).match(bodyRe);
        if (!bm) continue;
        const val = bm[1];
        const pairRe = /\(\s*(\d+)\s*,\s*(\d+)\s*\)/g;
        for (const pm of listBody.matchAll(pairRe)) {
            setCell(parseInt(pm[1], 10), parseInt(pm[2], 10), val);
        }
    }

    return grid;
}

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Programmatic-core resolver
// ---------------------------------------------------------------------------
//
// Community decks (the BEAVRS full-core port included) build their lattices
// without a single literal grid OWEN can read off the page:
//
//   * Assemblies come from a comprehension over a literal char template:
//       lat.universes = [[pick.get(ch, F) for ch in row] for row in template]
//     where `template` is a list of 17 strings, `pick` is a {char: universe}
//     dict, and `F` is the default (fuel) universe.
//   * The core lattice is a literal nested list whose *entries are Python
//     references* — `ASM_U["A31"]`, `BAF["sq_br"]`, `W` — not string tokens.
//
// The literal / NumPy grid finders above see neither (the comprehension is not
// a literal, and the core rows contain `[` from the dict subscripts, which the
// row parser rejects), so the deck collapsed to a single representative pin.
//
// This resolver builds a small symbol table (dict literals, simple `name = …`
// assignments, RectLattice variables, and the assembly-builder function) and
// statically resolves the core lattice into a tree of nested lattices and pin
// roles — WITHOUT executing any Python. Anything it cannot resolve degrades to
// a `skip` node (rendered as nothing, like a water/baffle position) so an
// opaque entry never aborts the whole expansion.

type ResolvedRole = 'fuel' | 'guide' | 'instrument' | 'empty';
interface ResolvedPin {
    kind: 'pin';
    role: ResolvedRole;
    /**
     * The universe key the pin resolved from (e.g. `f31`, `gt`, `ba`, `it` for
     * the BEAVRS `COL[...]` columns). Lets the placement step pick the matching
     * axial column stack so each band renders its real per-z shells/materials.
     */
    colKey?: string;
}
interface ResolvedLattice {
    kind: 'lattice';
    grid: ResolvedNode[][];
    pitch: [number, number];
    lowerLeft: [number, number] | null;
}
interface ResolvedSkip { kind: 'skip'; }
interface ResolvedStructure { kind: 'structure'; subtype: 'baffle' | 'other'; }
type ResolvedNode = ResolvedPin | ResolvedLattice | ResolvedSkip | ResolvedStructure;

interface AssemblyFn {
    params: string[];
    /** char → universe-expr (from the `pick` dict). */
    pick: Map<string, string>;
    /** Default universe-expr (the `F` fallback in `pick.get(ch, F)`). */
    defaultExpr: string;
    /** Parameter name supplying the template (list of strings). */
    templateParam: string;
    pitch: [number, number] | null;
    lowerLeft: [number, number] | null;
}

interface Scope {
    text: string;
    dicts: Map<string, Map<string, string>>;
    vars: Map<string, string>;
    rectLats: Set<string>;
    latUniverses: Map<string, string>;
    asmFns: Map<string, AssemblyFn>;
    memo: Map<string, ResolvedNode>;
}

/** Balanced-delimiter matcher (handles []{}() and string literals). */
function findMatching(s: string, open: number): number {
    const pairs: Record<string, string> = { '[': ']', '{': '}', '(': ')' };
    const want = pairs[s[open]];
    if (!want) return -1;
    let depth = 0;
    let quote = '';
    for (let i = open; i < s.length; i++) {
        const ch = s[i];
        if (quote) {
            if (ch === quote && s[i - 1] !== '\\') quote = '';
            continue;
        }
        if (ch === '"' || ch === "'") { quote = ch; continue; }
        if (ch === '[' || ch === '{' || ch === '(') depth++;
        else if (ch === ']' || ch === '}' || ch === ')') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/** Splits a body string by top-level commas (respecting brackets + quotes). */
function splitTopLevel(body: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let quote = '';
    let start = 0;
    for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (quote) {
            if (ch === quote && body[i - 1] !== '\\') quote = '';
            continue;
        }
        if (ch === '"' || ch === "'") { quote = ch; continue; }
        if (ch === '[' || ch === '{' || ch === '(') depth++;
        else if (ch === ']' || ch === '}' || ch === ')') depth--;
        else if (ch === ',' && depth === 0) { out.push(body.slice(start, i)); start = i + 1; }
    }
    if (start < body.length) out.push(body.slice(start));
    return out;
}

/** Parses a `[ "a", "b", … ]` string-list literal. Returns null if not pure strings. */
function parseStringList(expr: string): string[] | null {
    const open = expr.indexOf('[');
    if (open < 0) return null;
    const close = findMatching(expr, open);
    if (close < 0) return null;
    const parts = splitTopLevel(expr.slice(open + 1, close));
    const out: string[] = [];
    for (const p of parts) {
        const t = p.trim();
        if (!t) continue;
        const m = t.match(/^['"]([\s\S]*)['"]$/);
        if (!m) return null;
        out.push(m[1]);
    }
    return out.length ? out : null;
}

/** Extracts the meaningful name from a universe expression for classification. */
function keyOf(expr: string): string {
    const t = expr.trim();
    const sub = t.match(/^[A-Za-z_]\w*\s*\[\s*['"]([^'"]+)['"]\s*\]$/);
    if (sub) return sub[1];
    const str = t.match(/^['"]([^'"]+)['"]$/);
    if (str) return str[1];
    return t;
}

/** Maps a resolved role to a token `classifyToken`/`templateFor` understands. */
function roleToken(role: ResolvedRole): string {
    switch (role) {
        case 'guide': return 'guide';
        case 'instrument': return 'instrument';
        case 'empty': return 'water';
        default: return 'fuel';
    }
}

function classifyKey(name: string): ResolvedRole {
    const low = name.toLowerCase();
    if (/guide/.test(low) || /^gtd?$/.test(low) || /^ssgt$/.test(low) || /(^|_)gt(g|d)?$/.test(low)) return 'guide';
    if (/instr/.test(low) || /^itb?g?$/.test(low) || /^it$/.test(low)) return 'instrument';
    if (/(water|^w$|mod|cool|empty|none|void)/.test(low)) return 'empty';
    // Fuel, burnable absorber (rendered as a pin), and unknown leaf pins.
    return 'fuel';
}

function buildScope(text: string): Scope {
    const dicts = new Map<string, Map<string, string>>();
    const vars = new Map<string, string>();
    const rectLats = new Set<string>();
    const latUniverses = new Map<string, string>();
    const asmFns = new Map<string, AssemblyFn>();

    // Dict literals: `NAME = { … }` (NAME un-dotted, at any indent).
    const dictRe = /(^|\n)[ \t]*([A-Za-z_]\w*)\s*=\s*\{/g;
    let dm: RegExpExecArray | null;
    while ((dm = dictRe.exec(text)) !== null) {
        const name = dm[2];
        const open = text.indexOf('{', dm.index);
        const close = findMatching(text, open);
        if (close < 0) continue;
        const entries = new Map<string, string>();
        for (const part of splitTopLevel(text.slice(open + 1, close))) {
            const colon = topLevelColon(part);
            if (colon < 0) continue;
            const km = part.slice(0, colon).trim().match(/^['"]([^'"]+)['"]$/);
            if (!km) continue;
            entries.set(km[1], part.slice(colon + 1).trim());
        }
        dicts.set(name, entries);
        dictRe.lastIndex = close;
    }

    // List literals: `NAME = [ … ]` (possibly multi-line, e.g. a char template).
    // Captured balanced so a template that spans lines resolves intact; the
    // single-line scan below would only grab the opening `[`.
    const listRe = /(^|\n)[ \t]*([A-Za-z_]\w*)\s*=\s*\[/g;
    let lm: RegExpExecArray | null;
    while ((lm = listRe.exec(text)) !== null) {
        const name = lm[2];
        const open = text.indexOf('[', lm.index);
        const close = findMatching(text, open);
        if (close < 0) continue;
        if (!vars.has(name)) vars.set(name, text.slice(open, close + 1));
        listRe.lastIndex = close;
    }

    // Simple single-line assignments: `name = rhs` (skip dicts, dotted targets).
    for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^[ \t]*([A-Za-z_]\w*)\s*=\s*([^\n]+?)\s*(?:#.*)?$/);
        if (!m) continue;
        const name = m[1];
        const rhs = m[2].trim();
        if (rhs.startsWith('{')) continue; // dict (handled above / multiline)
        if (!vars.has(name)) vars.set(name, rhs);
        if (/^openmc\.RectLattice\s*\(/.test(rhs)) rectLats.add(name);
    }

    // RectLattice variables assigned across the whole text (incl. inside fns).
    for (const m of text.matchAll(/([A-Za-z_]\w*)\s*=\s*openmc\.RectLattice\s*\(/g)) rectLats.add(m[1]);

    // `<lat>.universes = <rhs>` (balanced when the RHS opens a bracket).
    const uniRe = /([A-Za-z_]\w*)\s*\.\s*universes\s*=\s*/g;
    let um: RegExpExecArray | null;
    while ((um = uniRe.exec(text)) !== null) {
        const name = um[1];
        const after = text.slice(uniRe.lastIndex);
        const trimmed = after.replace(/^[ \t]*/, '');
        let rhs: string;
        if (trimmed[0] === '[') {
            const open = text.indexOf('[', uniRe.lastIndex);
            const close = findMatching(text, open);
            rhs = close > open ? text.slice(open, close + 1) : trimmed.split(/\n/)[0];
        } else {
            rhs = trimmed.split(/\n/)[0].trim();
        }
        if (!latUniverses.has(name)) latUniverses.set(name, rhs);
    }

    // Assembly-builder functions: a def whose body assigns a lattice's
    // `.universes` from `[[pick.get(ch, F) for ch in row] for row in <param>]`.
    const defRe = /(^|\n)def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:/g;
    let fm: RegExpExecArray | null;
    while ((fm = defRe.exec(text)) !== null) {
        const fname = fm[2];
        const params = fm[3].split(',').map((p) => p.split(/[:=]/)[0].trim()).filter(Boolean);
        const bodyStart = defRe.lastIndex;
        const rest = text.slice(bodyStart);
        const nextDef = rest.search(/\n[A-Za-z_#@]/); // first non-indented line
        const body = nextDef >= 0 ? rest.slice(0, nextDef) : rest;
        const comp = parseComprehension(body);
        if (!comp) continue;
        const pickName = comp.dict;
        const pick = pickName && dictForBody(body, pickName) ? dictForBody(body, pickName)! : new Map<string, string>();
        // Default expr: trace `F` back to a `F = <expr>` in the body.
        let defaultExpr = comp.def ?? '';
        const defm = comp.def ? body.match(new RegExp(`${escapeRe(comp.def)}\\s*=\\s*([^\\n]+)`)) : null;
        if (defm) defaultExpr = defm[1].trim();
        const pitch = tupleAfter(body, /\.\s*pitch\s*=\s*/);
        const lowerLeft = tupleAfter(body, /\.\s*lower_left\s*=\s*/);
        asmFns.set(fname, {
            params, pick, defaultExpr, templateParam: comp.template, pitch, lowerLeft,
        });
    }

    return { text, dicts, vars, rectLats, latUniverses, asmFns, memo: new Map() };
}

/** First top-level `:` in a dict-entry string (respects brackets/quotes). */
function topLevelColon(s: string): number {
    let depth = 0;
    let quote = '';
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (quote) { if (ch === quote && s[i - 1] !== '\\') quote = ''; continue; }
        if (ch === '"' || ch === "'") { quote = ch; continue; }
        if (ch === '[' || ch === '{' || ch === '(') depth++;
        else if (ch === ']' || ch === '}' || ch === ')') depth--;
        else if (ch === ':' && depth === 0) return i;
    }
    return -1;
}

/** Parses a `{char: expr}` dict literal that lives inside a function body. */
function dictForBody(body: string, name: string): Map<string, string> | null {
    const re = new RegExp(`${escapeRe(name)}\\s*=\\s*\\{`);
    const m = body.match(re);
    if (!m || m.index === undefined) return null;
    const open = body.indexOf('{', m.index);
    const close = findMatching(body, open);
    if (close < 0) return null;
    const out = new Map<string, string>();
    for (const part of splitTopLevel(body.slice(open + 1, close))) {
        const colon = topLevelColon(part);
        if (colon < 0) continue;
        const km = part.slice(0, colon).trim().match(/^['"]([^'"]+)['"]$/);
        if (!km) continue;
        out.set(km[1], part.slice(colon + 1).trim());
    }
    return out;
}

/** Extracts a `(a, b)` numeric tuple following a matched key (e.g. `.pitch = `). */
function tupleAfter(text: string, keyRe: RegExp): [number, number] | null {
    const m = text.match(keyRe);
    if (!m || m.index === undefined) return null;
    const after = text.slice(m.index + m[0].length);
    const tm = after.match(/^\(?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*,\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/);
    if (!tm) return null;
    return [Number(tm[1]), Number(tm[2])];
}

interface Comprehension { cell: string; dict: string | null; def: string | null; template: string; }

/**
 * Parses `[[ <cell> for <ch> in <row> ] for <row> in <template> ]`, returning
 * the per-cell expression, the dict it indexes (`pick`), the default fallback
 * (`F`), and the template expression. Returns null when the RHS is not this
 * 2-level comprehension shape.
 */
function parseComprehension(rhs: string): Comprehension | null {
    const m = rhs.match(/\[\s*\[\s*([\s\S]+?)\s+for\s+(\w+)\s+in\s+(\w+)\s*\]\s+for\s+(\w+)\s+in\s+([\s\S]+?)\s*\]/);
    if (!m) return null;
    const cell = m[1].trim();
    const chVar = m[2];
    const template = m[5].trim();
    // `pick.get(ch, F)` or `pick[ch]` or `pick.get(ch)`.
    let dict: string | null = null;
    let def: string | null = null;
    const getM = cell.match(/^([A-Za-z_]\w*)\s*\.\s*get\s*\(\s*(\w+)\s*(?:,\s*([\s\S]+?)\s*)?\)$/);
    const subM = cell.match(/^([A-Za-z_]\w*)\s*\[\s*(\w+)\s*\]$/);
    if (getM && getM[2] === chVar) { dict = getM[1]; def = getM[3] ? getM[3].trim() : null; }
    else if (subM && subM[2] === chVar) { dict = subM[1]; }
    else return null;
    return { cell, dict, def, template };
}

/** Resolves an expression to a list-of-strings template, if possible. */
function resolveTemplate(expr: string, scope: Scope): string[] | null {
    const t = expr.trim();
    if (t.startsWith('[')) return parseStringList(t);
    const sub = t.match(/^([A-Za-z_]\w*)\s*\[\s*['"]([^'"]+)['"]\s*\]$/);
    if (sub) {
        const d = scope.dicts.get(sub[1]);
        if (d && d.has(sub[2])) return resolveTemplate(d.get(sub[2])!, scope);
        return null;
    }
    if (/^[A-Za-z_]\w*$/.test(t) && scope.vars.has(t)) return resolveTemplate(scope.vars.get(t)!, scope);
    return null;
}

/**
 * Builds a lattice node by mapping each character of a string template through
 * a `pick` dict (char → universe-expr) with an `F` default, classifying each
 * resulting universe-expr into a pin role.
 */
function buildGridFromTemplate(
    rows: string[],
    pick: Map<string, string>,
    defExpr: string,
    pitch: [number, number],
    lowerLeft: [number, number] | null,
): ResolvedLattice {
    const grid: ResolvedNode[][] = [];
    for (const row of rows) {
        const out: ResolvedNode[] = [];
        for (const ch of row) {
            const cellExpr = pick.has(ch) ? pick.get(ch)! : defExpr;
            const key = keyOf(cellExpr);
            out.push({ kind: 'pin', role: classifyKey(key), colKey: key });
        }
        grid.push(out);
    }
    return { kind: 'lattice', grid, pitch, lowerLeft };
}

/** Builds a lattice node for a comprehension-built assembly grid (`lat.universes = …`). */
function expandComprehensionGrid(
    rhs: string,
    scope: Scope,
    overrides?: { pitch?: [number, number] | null; lowerLeft?: [number, number] | null },
): ResolvedLattice | null {
    const comp = parseComprehension(rhs);
    if (!comp) return null;
    const rows = resolveTemplate(comp.template, scope);
    if (!rows || rows.length === 0) return null;
    const pick = (comp.dict && scope.dicts.has(comp.dict)) ? scope.dicts.get(comp.dict)! : new Map<string, string>();
    return buildGridFromTemplate(
        rows, pick, comp.def ?? '',
        overrides?.pitch ?? findNamedPitch(scope.text, 'lat') ?? [1.26, 1.26],
        overrides?.lowerLeft ?? null,
    );
}

/** Resolves a `_assembly(name, fuel_key, template)`-style call into a lattice. */
function resolveAssemblyCall(fname: string, args: string[], scope: Scope): ResolvedNode | null {
    const fn = scope.asmFns.get(fname);
    if (!fn) return null;
    const bind = new Map<string, string>();
    fn.params.forEach((p, i) => { if (i < args.length) bind.set(p, args[i].trim()); });

    // Default universe expr: substitute any param reference (e.g. F = COL[fuel_key]).
    let defExpr = fn.defaultExpr;
    for (const [p, v] of bind) defExpr = defExpr.replace(new RegExp(`\\b${escapeRe(p)}\\b`, 'g'), v);
    // Template expr param → its bound argument, then resolve to its string rows.
    const templateExpr = bind.get(fn.templateParam) ?? fn.templateParam;
    const rows = resolveTemplate(templateExpr, scope);
    if (!rows || rows.length === 0) return null;

    return buildGridFromTemplate(rows, fn.pick, defExpr, fn.pitch ?? [1.26, 1.26], fn.lowerLeft);
}

/** Resolves an arbitrary universe expression into a render tree node. */
function resolveExpr(expr: string, scope: Scope, depth: number): ResolvedNode {
    const t = expr.trim();
    if (depth > 12 || !t) return { kind: 'skip' };
    const memoHit = scope.memo.get(t);
    if (memoHit) return memoHit;
    scope.memo.set(t, { kind: 'skip' }); // cycle guard

    let result: ResolvedNode = { kind: 'skip' };

    // Dict subscript: D["key"].
    const sub = t.match(/^([A-Za-z_]\w*)\s*\[\s*['"]([^'"]+)['"]\s*\]$/);
    if (sub && scope.dicts.has(sub[1])) {
        if (/^(BAF|baf)$/i.test(sub[1])) {
            result = { kind: 'structure', subtype: 'baffle' };
        } else {
            const d = scope.dicts.get(sub[1])!;
            if (d.has(sub[2])) result = resolveExpr(d.get(sub[2])!, scope, depth + 1);
        }
    } else if (sub && /^(BAF|baf)$/i.test(sub[1])) {
        result = { kind: 'structure', subtype: 'baffle' };
    } else if (/^BAF\s*\[/.test(t) || /\bbaf[_\[]/i.test(t)) {
        result = { kind: 'structure', subtype: 'baffle' };
    } else {
        // Function call: name(args).
        const call = t.match(/^([A-Za-z_]\w*)\s*\(([\s\S]*)\)$/);
        if (call && scope.asmFns.has(call[1])) {
            result = resolveAssemblyCall(call[1], splitTopLevel(call[2]), scope) ?? { kind: 'skip' };
        } else if (call && /_baffle/i.test(call[1])) {
            result = { kind: 'structure', subtype: 'baffle' };
        } else if (/^[A-Za-z_]\w*$/.test(t)) {
            // Bare identifier: a RectLattice, another variable, or a leaf pin.
            if (scope.rectLats.has(t) && scope.latUniverses.has(t)) {
                result = resolveLatticeVar(t, scope, depth);
            } else if (scope.vars.has(t) && scope.vars.get(t) !== t) {
                const rhs = scope.vars.get(t)!;
                if (/^openmc\.(Universe|Material)\s*\(/.test(rhs) || /^openmc\./.test(rhs)) {
                    result = { kind: 'pin', role: classifyKey(t) };
                    if (result.role === 'empty') result = { kind: 'skip' };
                } else {
                    result = resolveExpr(rhs, scope, depth + 1);
                }
            } else {
                const role = classifyKey(t);
                result = role === 'empty' ? { kind: 'skip' } : { kind: 'pin', role };
            }
        }
        // A call we don't model (e.g. _baffle(...)) stays a skip.
    }

    scope.memo.set(t, result);
    return result;
}

/** Resolves a named RectLattice (via its `.universes` RHS) into a lattice node. */
function resolveLatticeVar(name: string, scope: Scope, depth: number): ResolvedNode {
    const rhs = scope.latUniverses.get(name);
    if (!rhs) return { kind: 'skip' };
    const pitch = findNamedPitch(scope.text, name) ?? [1.26, 1.26];
    const lowerLeft = findNamedLowerLeft(scope.text, name);

    // Comprehension-built grid.
    if (/\bfor\b/.test(rhs) && rhs.trim().startsWith('[')) {
        const lat = expandComprehensionGrid(rhs, scope, { pitch, lowerLeft });
        if (lat) return lat;
    }
    // Literal nested list of references.
    if (rhs.trim().startsWith('[')) {
        const rows = parseRefRows(rhs);
        if (rows) {
            const grid = rows.map((row) => row.map((tok) => resolveExpr(tok, scope, depth + 1)));
            return { kind: 'lattice', grid, pitch, lowerLeft };
        }
    }
    // `.tolist()` / variable → NumPy-built grid (reuse the existing finder).
    const arr = rhs.match(/^([A-Za-z_]\w*)/);
    if (arr) {
        const np = buildNumpyGrid(scope.text, arr[1]);
        if (np) {
            const grid = np.map((row) => row.map((tok) => resolveExpr(tok, scope, depth + 1)));
            return { kind: 'lattice', grid, pitch, lowerLeft };
        }
    }
    return { kind: 'skip' };
}

/** Parses a literal `[[a, b], [c, d]]` grid into rows of expression tokens. */
function parseRefRows(listExpr: string): string[][] | null {
    const open = listExpr.indexOf('[');
    if (open < 0) return null;
    const close = findMatching(listExpr, open);
    if (close < 0) return null;
    const rows: string[][] = [];
    for (const part of splitTopLevel(listExpr.slice(open + 1, close))) {
        const p = part.trim();
        if (!p.startsWith('[')) continue;
        const rc = findMatching(p, 0);
        if (rc < 0) continue;
        const toks = splitTopLevel(p.slice(1, rc)).map((s) => s.trim()).filter((s) => s.length > 0);
        if (toks.length) rows.push(toks);
    }
    return rows.length ? rows : null;
}

/**
 * Top-level entry: resolves the deck's core lattice into a render tree, or null
 * when no programmatic core could be recovered (so the caller can fall back).
 */
function resolveCoreTree(text: string): ResolvedLattice | null {
    const scope = buildScope(text);

    // Root candidates: any RectLattice variable with a bracketed `.universes`
    // (a literal core nested list, or a standalone comprehension-built
    // assembly). Per-call assembly lattices built inside a function reference
    // unresolvable parameters and resolve to 0 pins, so they self-eliminate.
    const candidates: string[] = [];
    for (const name of scope.rectLats) {
        const rhs = scope.latUniverses.get(name);
        if (!rhs) continue;
        if (rhs.trim().startsWith('[')) candidates.push(name);
    }
    if (candidates.length === 0) return null;

    // Resolve every candidate; the root is the one with the largest pin count
    // (a core of assemblies outweighs any single assembly resolved on its own).
    const resolved = new Map<string, ResolvedLattice>();
    for (const name of candidates) {
        const node = resolveLatticeVar(name, scope, 0);
        if (node.kind === 'lattice') resolved.set(name, node);
    }
    if (resolved.size === 0) return null;

    let best: ResolvedLattice | null = null;
    let bestPins = 0;
    for (const node of resolved.values()) {
        const pins = countTreePins(node);
        if (pins > bestPins) { bestPins = pins; best = node; }
    }
    return bestPins > 1 ? best : null;
}

function countTreePins(node: ResolvedNode): number {
    if (node.kind === 'pin') return 1;
    if (node.kind === 'skip' || node.kind === 'structure') return 0;
    let total = 0;
    for (const row of node.grid) for (const cell of row) total += countTreePins(cell);
    return total;
}

function countTreeLattices(node: ResolvedNode, depth = 0): number {
    if (node.kind !== 'lattice') return 0;
    let total = depth > 0 ? 1 : 0;
    for (const row of node.grid) for (const cell of row) total += countTreeLattices(cell, depth + 1);
    return total;
}

function treeSmallestPitch(node: ResolvedNode): number {
    let p = Infinity;
    const walk = (n: ResolvedNode): void => {
        if (n.kind !== 'lattice') return;
        p = Math.min(p, n.pitch[0], n.pitch[1]);
        for (const row of n.grid) for (const cell of row) walk(cell);
    };
    walk(node);
    return isFinite(p) && p > 0 ? p : 1.26;
}
