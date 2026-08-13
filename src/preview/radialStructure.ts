// Radial containment geometry (barrel, baffle, neutron shields, downcomer, RPV)
// for full-core PWR decks such as BEAVRS. Emits annular cylinders, box baffles,
// and octant shield pads into the shared CylinderSpec IR.

import { CylinderSpec, Component, ComponentId } from './types';
import { componentColor } from './palette';

export interface RadialContext {
    height: number;
    zCenter: number;
}

/** Annular z-axis shell (barrel, liner, RPV, downcomer water ring, …). */
export function annularShell(
    label: string,
    innerR: number,
    outerR: number,
    component: ComponentId,
    material: string,
    ctx: RadialContext,
    opacity = 0.35,
): CylinderSpec {
    return {
        label,
        radius: outerR,
        innerRadius: innerR,
        height: ctx.height,
        x: 0,
        y: 0,
        z: ctx.zCenter,
        color: componentColor(component),
        opacity,
        component,
        material,
        shape: 'cylinder',
    };
}

/** Thin square prism for a baffle plate at a lattice position (half-width = radius). */
export function baffleBox(
    label: string,
    cx: number,
    cy: number,
    halfWidth: number,
    ctx: RadialContext,
    material = 'SS304',
): CylinderSpec {
    return {
        label,
        shape: 'box',
        radius: halfWidth,
        height: ctx.height,
        x: cx,
        y: cy,
        z: ctx.zCenter,
        color: componentColor(Component.Structure),
        opacity: 0.55,
        component: Component.Structure,
        material,
    };
}

/**
 * Which sides of a reflector lattice cell face the fueled core. Edge sides
 * get a full-length plate; a diagonal that faces the core with neither
 * adjacent edge doing so gets an L-shaped corner piece (two half-length
 * plates), matching how BEAVRS models the stepped-outline corners.
 */
/** Half-open interval along a plate's long axis, relative to the cell centre. */
type Span = [number, number];

/**
 * `span` minus every interval in `cuts`. Used to butt-joint perpendicular
 * plates: the plate that owns a corner square keeps its full run and the
 * crossing plate is emitted as the one or two segments outside it, so the
 * union is unchanged and no two plates share volume.
 */
function subtractSpans(span: Span, cuts: readonly Span[]): Span[] {
    let parts: Span[] = [span];
    for (const [c0, c1] of cuts) {
        const next: Span[] = [];
        for (const [p0, p1] of parts) {
            if (c1 <= p0 || c0 >= p1) { next.push([p0, p1]); continue; }
            if (c0 > p0) next.push([p0, c0]);
            if (c1 < p1) next.push([c1, p1]);
        }
        parts = next;
    }
    return parts.filter(([a, b]) => b - a > 1e-6);
}

export interface BaffleNeighborhood {
    east: boolean;
    west: boolean;
    north: boolean;
    south: boolean;
    ne: boolean;
    nw: boolean;
    se: boolean;
    sw: boolean;
}

/**
 * Radial band the plates occupy, as distances from the cell centre
 * [inner, outer]. BEAVRS puts its SS304 plates at [8.36662, 10.58912] cm in a
 * 21.50364 cm cell — inner ≈ 0.778 × half-pitch, outer ≈ 0.985 × half-pitch —
 * which the default reproduces for any pitch. Parsers that can read the real
 * px/py plane offsets from the deck should pass them instead.
 */
export function defaultBaffleBand(halfPitch: number): [number, number] {
    return [halfPitch * 0.778, halfPitch * 0.985];
}

/**
 * Thin baffle/former plates for one reflector lattice cell, hugging the edges
 * that face fuel assemblies. This replaces the old single `baffleBox` post,
 * which drew the whole cell (or a token square) and produced the blocky belt
 * users saw instead of BEAVRS' stepped plate ring.
 */
export function bafflePlates(
    label: string,
    cx: number,
    cy: number,
    halfPitchX: number,
    halfPitchY: number,
    nb: BaffleNeighborhood,
    ctx: RadialContext,
    band?: [number, number],
    material = 'SS304',
): CylinderSpec[] {
    const out: CylinderSpec[] = [];
    const [ax, bx] = band ?? defaultBaffleBand(halfPitchX);
    const [ay, by] = band ?? defaultBaffleBand(halfPitchY);
    const midX = (ax + bx) / 2;
    const thickX = Math.max(0.05, (bx - ax) / 2);
    const midY = (ay + by) / 2;
    const thickY = Math.max(0.05, (by - ay) / 2);

    const plate = (suffix: string, x: number, y: number, hx: number, hy: number): void => {
        out.push({
            label: `${label}_${suffix}`,
            shape: 'box',
            radius: Math.max(hx, hy),
            halfX: hx,
            halfY: hy,
            height: ctx.height,
            x,
            y,
            z: ctx.zCenter,
            color: componentColor(Component.Baffle),
            opacity: 0.9,
            component: Component.Baffle,
            material,
        });
    };

    /**
     * A run of plate along y (an east or west plate), emitted as the segments
     * of `span` that the north/south plates do not already cover. The N/S
     * plates run the full width of the cell, so they own the corner squares
     * where the wall turns; without this the two runs crossed and the viewer
     * showed plates passing through each other at every stair step.
     */
    const runY = (suffix: string, x: number, span: Span, cuts: readonly Span[]): void => {
        // A leftover shorter than the plate is thick is a chip between the
        // perpendicular plate and the lattice-cell boundary (0.16 cm on BEAVRS
        // pitch). Dropping it ends the run flush with the plate it butts
        // against instead of adding a degenerate box per stair step.
        const parts = subtractSpans(span, cuts).filter(([a, b]) => b - a >= 2 * thickX);
        parts.forEach(([y0, y1], i) => {
            plate(parts.length > 1 ? `${suffix}${i}` : suffix, x, cy + (y0 + y1) / 2, thickX, (y1 - y0) / 2);
        });
    };

    const yCuts: Span[] = [];
    if (nb.north) yCuts.push([ay, by]);
    if (nb.south) yCuts.push([-by, -ay]);

    if (nb.east) runY('e', cx + midX, [-halfPitchY, halfPitchY], yCuts);
    if (nb.west) runY('w', cx - midX, [-halfPitchY, halfPitchY], yCuts);
    if (nb.north) plate('n', cx, cy + midY, halfPitchX, thickY);
    if (nb.south) plate('s', cx, cy - midY, halfPitchX, thickY);

    // L-shaped corner pieces where only the diagonal faces the core. The
    // along-y arm yields the corner square to the along-x arm, same rule.
    const corner = (suffix: string, sx: 1 | -1, sy: 1 | -1): void => {
        const armY: Span = sy > 0 ? [0, halfPitchY] : [-halfPitchY, 0];
        const cut: Span = sy > 0 ? [ay, by] : [-by, -ay];
        runY(`${suffix}_x`, cx + sx * midX, armY, [cut]);
        plate(`${suffix}_y`, cx + sx * halfPitchX / 2, cy + sy * midY, halfPitchX / 2, thickY);
    };
    if (nb.ne && !nb.north && !nb.east) corner('ne', 1, 1);
    if (nb.nw && !nb.north && !nb.west) corner('nw', -1, 1);
    if (nb.se && !nb.south && !nb.east) corner('se', 1, -1);
    if (nb.sw && !nb.south && !nb.west) corner('sw', -1, -1);
    return out;
}

/**
 * Four octant neutron-shield pads as annular arc segments on the shield ring
 * at 45° / 135° / 225° / 315°. BEAVRS pads span 32°; boxes previously used
 * here read as floating blocks instead of pads hugging the barrel.
 */
export function neutronShieldPads(
    innerR: number,
    outerR: number,
    ctx: RadialContext,
    prefix = 'ns_pad',
    spanDeg = 32,
): CylinderSpec[] {
    if (!(outerR > innerR && innerR > 0)) return [];
    const centers = [45, 135, 225, 315];
    const out: CylinderSpec[] = [];
    centers.forEach((c, i) => {
        out.push({
            label: `${prefix}_${i}`,
            shape: 'arc',
            radius: outerR,
            innerRadius: innerR,
            thetaStart: c - spanDeg / 2,
            thetaLength: spanDeg,
            height: ctx.height,
            x: 0,
            y: 0,
            z: ctx.zCenter,
            color: componentColor(Component.Structure),
            opacity: 0.65,
            component: Component.Structure,
            material: 'SS304',
        });
    });
    return out;
}

/** Parse `name = openmc.ZCylinder(r=…)` radii from an OpenMC Python deck. */
export function openmcZCylinderRadii(text: string): Map<string, number> {
    const out = new Map<string, number>();
    const re = /([A-Za-z_]\w*)\s*=\s*openmc\.ZCylinder\s*\([^)]*r\s*=\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;
    for (const m of text.matchAll(re)) {
        const r = Number(m[2]);
        if (r > 0 && r < 500) out.set(m[1], r);
    }
    return out;
}

/**
 * BEAVRS-style radial shells from named OpenMC ZCylinder variables.
 * Falls back to the largest unused ZCylinders when names are absent.
 */
export function emitOpenmcRadialStructure(
    text: string,
    cylinders: CylinderSpec[],
    ctx: RadialContext,
): number {
    const zc = openmcZCylinderRadii(text);
    let n = 0;
    const pair = (a: string, b: string, comp: ComponentId, mat: string, op: number) => {
        const ri = zc.get(a);
        const ro = zc.get(b);
        if (ri !== undefined && ro !== undefined && ro > ri) {
            cylinders.push(annularShell(`${a}_${b}`, ri, ro, comp, mat, ctx, op));
            n++;
        }
    };
    pair('cyl_cb_in', 'cyl_cb_out', Component.Vessel, 'SS304', 0.45);
    pair('cyl_ns_out', 'cyl_lin', Component.Moderator, 'Water', 0.15);
    pair('cyl_lin', 'cyl_rpv_in', Component.Vessel, 'SS304', 0.4);
    pair('cyl_rpv_in', 'cyl_rpv_out', Component.Vessel, 'CarbonSteel', 0.5);

    const ni = zc.get('cyl_ns_in');
    const no = zc.get('cyl_ns_out');
    if (ni !== undefined && no !== undefined && no > ni) {
        cylinders.push(...neutronShieldPads(ni, no, ctx));
        n += 4;
    }

    if (n === 0) {
        // Generic: largest four ZCylinders as faint full shells (legacy behaviour).
        const radii = [...zc.values()].sort((a, b) => b - a);
        for (const r of radii.slice(0, 4)) {
            if (r < 50) continue;
            cylinders.push({
                label: `vessel_${r}`,
                radius: r,
                height: ctx.height,
                x: 0,
                y: 0,
                z: ctx.zCenter,
                color: componentColor(Component.Vessel),
                opacity: 0.12,
                component: Component.Vessel,
                material: 'Structure',
            });
            n++;
        }
    }
    return n;
}

export interface McnpSurfaceLike {
    id: number;
    type: string;
    params: number[];
}

export interface McnpCellLike {
    id: number;
    material: number;
    surfaces: number[];
    u: number | null;
}

/** cz / c/z radius helper. */
export function mcnpCzRadius(s: McnpSurfaceLike): number {
    if (s.type === 'cz') return Math.abs(s.params[0] ?? 0);
    if (s.type === 'c/z') return Math.hypot(s.params[0] ?? 0, s.params[1] ?? 0);
    return 0;
}

/**
 * Radial containment shells for MCNP decks (geometry-preview plan Stage 6:
 * de-BEAVRSed). The general pass runs first and is material-driven: any
 * root-level (universe 0) annular cell bounded by a cz pair, at a radius
 * large relative to the deck's own biggest cylinder, becomes a shell — this
 * covers VVER, compact vessels, and anything else with concentric
 * containment, regardless of surface numbering or comments. The BEAVRS
 * surface-id convention (80–86) remains as a fast special case that fills in
 * pieces the general pass cannot see (the octant neutron-shield pads and a
 * downcomer that isn't modeled as a single annular cell), but it is no longer
 * load-bearing: it never duplicates a shell the general pass already drew.
 */
export function emitMcnpRadialStructure(
    surfaces: Map<number, McnpSurfaceLike>,
    cells: McnpCellLike[],
    cylinders: CylinderSpec[],
    ctx: RadialContext,
    materials?: Map<number, { component: ComponentId; name: string }>,
): number {
    let n = 0;
    const czR = new Map<number, number>();
    let maxCz = 0;
    for (const s of surfaces.values()) {
        if (s.type === 'cz' || s.type === 'c/z') {
            const r = mcnpCzRadius(s);
            if (r > 0) {
                czR.set(s.id, r);
                if (r > maxCz) maxCz = r;
            }
        }
    }

    const getR = (id: number): number | undefined => czR.get(Math.abs(id));

    // Emitted [inner, outer] pairs, so the two passes never double-draw.
    const emitted: [number, number][] = [];
    const alreadyEmitted = (ri: number, ro: number): boolean =>
        emitted.some(([a, b]) => Math.abs(a - ri) < 0.5 && Math.abs(b - ro) < 0.5);

    // --- General pass: material-classified root annular cells. -------------
    // Scale gate: a containment shell is large relative to the deck's own
    // largest cylinder (30%), with an absolute floor so pin-scale annuli in
    // small decks never read as vessels.
    const minShellRadius = Math.max(20, 0.3 * maxCz);
    for (const cell of cells) {
        if (cell.u !== null && cell.u !== 0) continue;
        const czIds = cell.surfaces.filter((s) => czR.has(Math.abs(s)));
        if (czIds.length < 2) continue;
        const pos = czIds.filter((s) => s > 0).map((s) => getR(s)!);
        const neg = czIds.filter((s) => s < 0).map((s) => getR(Math.abs(s))!);
        if (pos.length !== 1 || neg.length !== 1) continue;
        const innerR = Math.min(pos[0], neg[0]);
        const outerR = Math.max(pos[0], neg[0]);
        if (!(outerR > innerR && outerR > minShellRadius)) continue;
        if (alreadyEmitted(innerR, outerR)) continue;
        const mat = materials?.get(cell.material);
        const comp = mat?.component === Component.Moderator ? Component.Moderator
            : mat?.component === Component.Structure ? Component.Vessel
            : mat?.component ?? Component.Vessel;
        const opacity = comp === Component.Moderator ? 0.12 : 0.4;
        cylinders.push(annularShell(`cell_${cell.id}`, innerR, outerR, comp, mat?.name ?? 'Structure', ctx, opacity));
        emitted.push([innerR, outerR]);
        n++;
    }

    // --- BEAVRS id fast path (80–86): fills gaps only. ---------------------
    // Only trusted when the radii are plausibly vessel-scale (decks with
    // auto-numbered surfaces can have small pin cylinders at these ids).
    const vesselScale = (r: number | undefined): number | undefined =>
        r !== undefined && r > 50 ? r : undefined;
    const barrelIn = vesselScale(getR(80));
    const barrelOut = vesselScale(getR(81));
    const linerIn = vesselScale(getR(82));
    const rpvIn = vesselScale(getR(83));
    const rpvOut = vesselScale(getR(84));
    const nsIn = vesselScale(getR(85));
    const nsOut = vesselScale(getR(86));

    const pair = (label: string, ri: number | undefined, ro: number | undefined, comp: ComponentId, mat: string, op: number) => {
        if (ri === undefined || ro === undefined || !(ro > ri)) return;
        if (alreadyEmitted(ri, ro)) return;
        cylinders.push(annularShell(label, ri, ro, comp, mat, ctx, op));
        emitted.push([ri, ro]);
        n++;
    };
    pair('barrel', barrelIn, barrelOut, Component.Vessel, 'SS304', 0.45);
    if (nsIn !== undefined && nsOut !== undefined && nsOut > nsIn) {
        cylinders.push(...neutronShieldPads(nsIn, nsOut, ctx, 'mcnp_ns'));
        n += 4;
    }
    pair('downcomer', nsOut, linerIn, Component.Moderator, 'Water', 0.12);
    pair('rpv_liner', linerIn, rpvIn, Component.Vessel, 'SS304', 0.4);
    pair('rpv', rpvIn, rpvOut, Component.Vessel, 'CarbonSteel', 0.5);

    return n;
}

/** Detect MCNP universes whose cells are SS304 baffle plates (px/py, no cz). */
export function mcnpBaffleUniverses(
    byUniverse: Map<number, McnpCellLike[]>,
    surfaces: Map<number, McnpSurfaceLike>,
    materials: Map<number, { component: ComponentId; name: string }>,
): Set<number> {
    const out = new Set<number>();
    for (const [uid, group] of byUniverse) {
        if (uid === 0) continue;
        let hasPxPy = false;
        let hasCz = false;
        let hasSteel = false;
        for (const cell of group) {
            if (cell.material === 0) continue;
            const mat = materials.get(cell.material);
            if (mat && (mat.component === Component.Structure || mat.name.toLowerCase().includes('steel'))) {
                hasSteel = true;
            }
            for (const sid of cell.surfaces) {
                const s = surfaces.get(Math.abs(sid));
                if (!s) continue;
                if (s.type === 'px' || s.type === 'py') hasPxPy = true;
                if (s.type === 'cz' || s.type === 'c/z') hasCz = true;
            }
        }
        if (hasSteel && hasPxPy && !hasCz) out.add(uid);
    }
    return out;
}

/**
 * Radial band [inner, outer] the baffle plates of one MCNP baffle universe
 * occupy, read from the |offsets| of the px/py planes its steel cells
 * reference (BEAVRS: 8.36662 / 10.58912). Undefined when the universe doesn't
 * expose two distinct plane offsets — callers fall back to defaultBaffleBand.
 */
export function mcnpBaffleBand(
    uid: number,
    byUniverse: Map<number, McnpCellLike[]>,
    surfaces: Map<number, McnpSurfaceLike>,
    materials: Map<number, { component: ComponentId; name: string }>,
): [number, number] | undefined {
    const group = byUniverse.get(uid);
    if (!group) return undefined;
    const offs = new Set<number>();
    for (const cell of group) {
        if (cell.material === 0) continue;
        const mat = materials.get(cell.material);
        const steel = mat && (mat.component === Component.Structure || mat.name.toLowerCase().includes('steel'));
        if (!steel) continue;
        for (const sid of cell.surfaces) {
            const s = surfaces.get(Math.abs(sid));
            if (s && (s.type === 'px' || s.type === 'py')) {
                const v = Math.abs(s.params[0] ?? 0);
                if (v > 0.01) offs.add(Number(v.toFixed(5)));
            }
        }
    }
    const sorted = [...offs].sort((a, b) => a - b);
    if (sorted.length < 2) return undefined;
    return [sorted[0], sorted[sorted.length - 1]];
}

/** Serpent large `cyl` surfaces → annular shells from containment cells. */
export function emitSerpentRadialStructure(
    text: string,
    surfs: Map<string | number, { type: string; params: number[] }>,
    cylinders: CylinderSpec[],
    ctx: RadialContext,
    footprint: number,
): number {
    let n = 0;
    const cylRadii: { id: string | number; r: number }[] = [];
    for (const [id, s] of surfs) {
        if (s.type === 'cyl' || s.type === 'cylz') {
            const r = Math.abs(s.params[2] ?? s.params[0] ?? 0);
            if (r > footprint * 0.5) cylRadii.push({ id, r });
        }
    }
    cylRadii.sort((a, b) => a.r - b.r);
    // Pair consecutive large cylinders as annuli when BEAVRS comments name them.
    const names: Record<string, string> = {};
    for (const m of text.matchAll(/surf\s+s(\w+)\s+cyl\s+[\d.]+\s+[\d.]+\s+([\d.]+)/gi)) {
        const r = Number(m[2]);
        if (r > 50) {
            const hit = cylRadii.find((c) => Math.abs(c.r - r) < 0.01);
            if (hit) names[String(hit.id)] = m[1].toLowerCase();
        }
    }
    for (let i = 0; i < cylRadii.length - 1; i++) {
        const a = cylRadii[i];
        const b = cylRadii[i + 1];
        if (b.r - a.r < 0.5) continue;
        const tag = `${names[String(a.id)] ?? a.id}_${names[String(b.id)] ?? b.id}`;
        let comp: ComponentId = Component.Vessel;
        let mat = 'SS304';
        let op = 0.35;
        if (/ns/i.test(tag)) {
            cylinders.push(...neutronShieldPads(a.r, b.r, ctx, `serpent_${tag}`));
            n += 4;
            continue;
        }
        if (/down|wt|water/i.test(tag)) { comp = Component.Moderator; mat = 'Water'; op = 0.12; }
        if (/rpv/i.test(tag) && !/lin/i.test(tag)) { mat = 'CarbonSteel'; op = 0.5; }
        cylinders.push(annularShell(`serpent_${tag}`, a.r, b.r, comp, mat, ctx, op));
        n++;
    }
    return n;
}

/**
 * Named z-cylinder radii from a SCONE deck, as `{ name, r }` in declaration
 * order. Only leaf blocks are matched (`[^{}]*` body): an enclosing
 * `surfaces { … }` used to match first, so the wrapper's name and the first
 * surface's radius were recorded as one entry and the real surface name was
 * never seen.
 */
export function sconeCylinderRadii(text: string): { name: string; r: number }[] {
    const out: { name: string; r: number }[] = [];
    for (const m of text.matchAll(/([A-Za-z_]\w*)\s*\{([^{}]*)\}/g)) {
        const body = m[2];
        if (!/\btype\s+z(?:Trunc)?Cylinder\b/i.test(body)) continue;
        const rm = /\bradius\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i.exec(body);
        if (!rm) continue;
        const r = Number(rm[1]);
        if (r > 0) out.push({ name: m[1].toLowerCase(), r });
    }
    return out;
}

type SconeShellRole = 'barrel' | 'shield' | 'water' | 'liner' | 'rpv';

/**
 * Which containment shell a SCONE surface name refers to. Deliberately not a
 * BEAVRS name list: the reference deck calls its neutron-shield bounds
 * `innerBoundNS` / `outerBoundNS`, which the old `innerneutron|innershield`
 * patterns missed, so every SCONE core rendered with a barrel and nothing
 * else. `liner` is tested before `rpv` because `innerRPVLiner` contains both.
 */
export function sconeShellRole(name: string): { role: SconeShellRole; side: 'inner' | 'outer' } | null {
    const low = name.toLowerCase();
    const side = low.includes('inner') ? 'inner' : low.includes('outer') ? 'outer' : null;
    if (!side) return null;
    let role: SconeShellRole | null = null;
    if (/barrel/.test(low)) role = 'barrel';
    else if (/liner/.test(low)) role = 'liner';
    else if (/rpv|vessel/.test(low)) role = 'rpv';
    else if (/neutron|shield|(?:^|[^a-z])ns(?:[^a-z]|$)|ns$/.test(low)) role = 'shield';
    else if (/downcomer|barrelwater/.test(low)) role = 'water';
    return role ? { role, side } : null;
}

/** SCONE zCylinder surfaces → barrel, neutron-shield pads, downcomer, RPV. */
export function emitSconeRadialStructure(
    text: string,
    cylinders: CylinderSpec[],
    ctx: RadialContext,
    footprint: number,
): number {
    const radii = sconeCylinderRadii(text).filter((x) => x.r > footprint * 0.5 && x.r < 500);
    radii.sort((a, b) => a.r - b.r);
    let n = 0;
    const pick = (role: SconeShellRole, side: 'inner' | 'outer') => {
        const hit = radii.find((x) => {
            const c = sconeShellRole(x.name);
            return c?.role === role && c.side === side;
        });
        return hit;
    };
    const pushPair = (
        ri: { name: string; r: number } | undefined,
        ro: { name: string; r: number } | undefined,
        comp: ComponentId,
        mat: string,
        op: number,
    ) => {
        if (ri && ro && ro.r > ri.r) {
            cylinders.push(annularShell(`${ri.name}_${ro.name}`, ri.r, ro.r, comp, mat, ctx, op));
            n++;
        }
    };

    const barrelIn = pick('barrel', 'inner');
    const barrelOut = pick('barrel', 'outer');
    const shieldIn = pick('shield', 'inner');
    const shieldOut = pick('shield', 'outer');
    const linerIn = pick('liner', 'inner');
    const rpvIn = pick('rpv', 'inner');
    const rpvOut = pick('rpv', 'outer');

    pushPair(barrelIn, barrelOut, Component.Vessel, 'SS304', 0.45);
    // Downcomer water from the shield ring (or the barrel) out to the liner.
    pushPair(shieldOut ?? barrelOut, linerIn ?? rpvIn, Component.Moderator, 'Water', 0.12);
    pushPair(linerIn, rpvIn, Component.Vessel, 'SS304', 0.4);
    pushPair(rpvIn, rpvOut, Component.Vessel, 'CarbonSteel', 0.5);

    if (shieldIn && shieldOut && shieldOut.r > shieldIn.r) {
        cylinders.push(...neutronShieldPads(shieldIn.r, shieldOut.r, ctx, 'scone_ns'));
        n += 4;
    }
    if (n === 0) {
        for (const { name, r } of radii) {
            if (r > footprint * 0.5) {
                cylinders.push({
                    label: `vessel_${name}`,
                    radius: r,
                    height: ctx.height,
                    x: 0, y: 0, z: ctx.zCenter,
                    color: componentColor(Component.Vessel),
                    opacity: 0.12,
                    component: Component.Vessel,
                    material: 'Structure',
                });
                n++;
            }
        }
    }
    return n;
}
