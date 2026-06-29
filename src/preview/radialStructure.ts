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
 * Four octant neutron-shield pads approximated as box prisms on the annulus
 * mid-radius at 45° / 135° / 225° / 315°.
 */
export function neutronShieldPads(
    innerR: number,
    outerR: number,
    ctx: RadialContext,
    prefix = 'ns_pad',
): CylinderSpec[] {
    if (!(outerR > innerR && innerR > 0)) return [];
    const midR = (innerR + outerR) / 2;
    const pad = Math.max(2.0, (outerR - innerR) * 0.85);
    const angles = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
    const out: CylinderSpec[] = [];
    angles.forEach((a, i) => {
        out.push({
            label: `${prefix}_${i}`,
            shape: 'box',
            radius: pad,
            height: ctx.height,
            x: midR * Math.cos(a),
            y: midR * Math.sin(a),
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
 * Root-level (universe 0) annular cells bounded by cz pairs, plus neutron-shield
 * pads and downcomer from the BEAVRS surface id convention (80–86).
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
    for (const s of surfaces.values()) {
        if (s.type === 'cz' || s.type === 'c/z') {
            const r = mcnpCzRadius(s);
            if (r > 0) czR.set(s.id, r);
        }
    }

    const getR = (id: number): number | undefined => czR.get(Math.abs(id));

    // Named BEAVRS surfaces when present.
    const barrelIn = getR(80);
    const barrelOut = getR(81);
    const linerIn = getR(82);
    const rpvIn = getR(83);
    const rpvOut = getR(84);
    const nsIn = getR(85);
    const nsOut = getR(86);

    if (barrelIn !== undefined && barrelOut !== undefined && barrelOut > barrelIn) {
        cylinders.push(annularShell('barrel', barrelIn, barrelOut, Component.Vessel, 'SS304', ctx, 0.45));
        n++;
    }
    if (nsIn !== undefined && nsOut !== undefined && nsOut > nsIn) {
        cylinders.push(...neutronShieldPads(nsIn, nsOut, ctx, 'mcnp_ns'));
        n += 4;
    }
    if (nsOut !== undefined && linerIn !== undefined && linerIn > nsOut) {
        cylinders.push(annularShell('downcomer', nsOut, linerIn, Component.Moderator, 'Water', ctx, 0.12));
        n++;
    }
    if (linerIn !== undefined && rpvIn !== undefined && rpvIn > linerIn) {
        cylinders.push(annularShell('rpv_liner', linerIn, rpvIn, Component.Vessel, 'SS304', ctx, 0.4));
        n++;
    }
    if (rpvIn !== undefined && rpvOut !== undefined && rpvOut > rpvIn) {
        cylinders.push(annularShell('rpv', rpvIn, rpvOut, Component.Vessel, 'CarbonSteel', ctx, 0.5));
        n++;
    }

    // Generic root annular cells (material steel/water + two cz surfaces).
    if (n === 0) {
        for (const cell of cells) {
            if (cell.u !== null && cell.u !== 0) continue;
            const czIds = cell.surfaces.filter((s) => czR.has(Math.abs(s)));
            if (czIds.length < 2) continue;
            const pos = czIds.filter((s) => s > 0).map((s) => getR(s)!);
            const neg = czIds.filter((s) => s < 0).map((s) => getR(Math.abs(s))!);
            if (pos.length !== 1 || neg.length !== 1) continue;
            const innerR = Math.min(pos[0], neg[0]);
            const outerR = Math.max(pos[0], neg[0]);
            if (!(outerR > innerR && outerR > 50)) continue;
            const mat = materials?.get(cell.material);
            const comp = mat?.component ?? Component.Vessel;
            cylinders.push(annularShell(`cell_${cell.id}`, innerR, outerR, comp, mat?.name ?? 'Structure', ctx, 0.3));
            n++;
        }
    }
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

/** SCONE zCylinder surfaces for barrel / RPV from the geometry block. */
export function emitSconeRadialStructure(
    text: string,
    cylinders: CylinderSpec[],
    ctx: RadialContext,
    footprint: number,
): number {
    const radii: { name: string; r: number }[] = [];
    const re = /(\w+)\s*\{[^}]*type\s+z(?:Trunc)?Cylinder[^}]*radius\s+([\d.]+)/gi;
    for (const m of text.matchAll(re)) {
        const r = Number(m[2]);
        if (r > footprint * 0.5 && r < 500) radii.push({ name: m[1].toLowerCase(), r });
    }
    radii.sort((a, b) => a.r - b.r);
    let n = 0;
    const pushPair = (inner: string, outer: string, comp: ComponentId, mat: string, op: number) => {
        const ri = radii.find((x) => inner.split('|').some((k) => x.name.includes(k)));
        const ro = radii.find((x) => outer.split('|').some((k) => x.name.includes(k)));
        if (ri && ro && ro.r > ri.r) {
            cylinders.push(annularShell(`${ri.name}_${ro.name}`, ri.r, ro.r, comp, mat, ctx, op));
            n++;
        }
    };
    pushPair('innercorebarrel|innercore', 'outercorebarrel|outercore', Component.Vessel, 'SS304', 0.45);
    pushPair('innerneutron|innershield', 'outerneutron|outershield', Component.Structure, 'SS304', 0.5);
    pushPair('outerneutron|outershield', 'innerrpv|innerrpvliner|innerrpvliner', Component.Moderator, 'Water', 0.12);
    pushPair('innerrpv|innerrpvliner', 'innerRPV|innerrpv', Component.Vessel, 'SS304', 0.4);
    pushPair('innerRPV|innerrpv', 'outerRPV|outerrpv', Component.Vessel, 'CarbonSteel', 0.5);

    const nsIn = radii.find((x) => x.name.includes('neutron') && x.name.includes('inner'));
    const nsOut = radii.find((x) => x.name.includes('neutron') && x.name.includes('outer'));
    if (nsIn && nsOut && nsOut.r > nsIn.r) {
        cylinders.push(...neutronShieldPads(nsIn.r, nsOut.r, ctx, 'scone_ns'));
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
