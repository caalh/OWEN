// Geometry extractor for the 3D preview webview.
//
// This is the dispatch layer over the per-code parsers in `./codes/*`. Each
// parser turns a deck into a flat list of placed `CylinderSpec`s plus optional
// warnings/notes (a shared geometry IR — see `./types.ts`). `extractCylinders`
// returns just the flat list (back-compat, used by tests); `buildScene` wraps
// it with the legend summaries and caveats the webview needs.

import {
    CylinderSpec,
    GeometryScene,
    ParseResult,
    ComponentSummary,
    MaterialSummary,
    AxialLayerSummary,
    COMPONENT_LABELS,
    Component,
    FidelityOptions,
    FidelityState,
} from './types';
import { componentColor } from './palette';
import { DEFAULT_MAX_INSTANCES, simplificationNote, truncationWarning } from './budget';
import { parseMcnp } from './codes/mcnp';
import { parseOpenmc } from './codes/openmc';
import { parseSerpent } from './codes/serpent';
import { parseScone } from './codes/scone';

export type { CylinderSpec };

function parseRaw(text: string, language: string, opts?: FidelityOptions): ParseResult {
    switch (language) {
        case 'mcnp':
            return parseMcnp(text, opts);
        case 'openmc':
            return parseOpenmc(text, opts);
        case 'serpent':
            return parseSerpent(text, opts);
        case 'scone':
            return parseScone(text, opts);
        default:
            console.warn(`[owen.preview] unknown language ${language}`);
            return { cylinders: [], warnings: [`Unknown language "${language}" — no geometry parser available.`] };
    }
}

/**
 * Parses with an auto-LOD safety net. Each parser predictively degrades detail
 * to fit the instance ceiling (see budget.ts), but per-code pin counting can
 * under-estimate (e.g. Serpent nested cores), so placement may still hit the
 * cap. When that happens we re-parse at a coarser fidelity — concentric layers
 * → single discs, then collapse axial segments — until everything fits. Every
 * pin position is preserved at each step, so pins are never silently dropped
 * when a coarser detail would render the whole core. A non-alarming note
 * explains any simplification; a warning fires only if even the coarsest
 * fidelity overflows.
 */
function parse(text: string, language: string, opts?: FidelityOptions): ParseResult {
    let res = parseRaw(text, language, opts);

    let guard = 0;
    while (res.capped && res.fidelity && guard++ < 3) {
        const f = res.fidelity;
        let next: FidelityOptions | null = null;
        if (f.detail === 'layers') next = { ...opts, detail: 'disc' };
        else if (f.axial) next = { ...opts, detail: 'disc', axial: false };
        if (!next) break;
        res = parseRaw(text, language, next);
    }

    const f = res.fidelity;
    if (f) {
        const max = opts?.maxInstances && opts.maxInstances > 0 ? opts.maxInstances : DEFAULT_MAX_INSTANCES;
        const requestedDetail = opts?.detail === 'disc' || opts?.detail === 'layers' ? opts.detail : f.autoDetail;
        const requestedAxial = !!opts?.axial && f.hasAxial;
        if (res.capped) {
            res.warnings = [truncationWarning(max), ...(res.warnings ?? [])];
        } else {
            const note = simplificationNote(
                requestedDetail === 'layers' && f.detail === 'disc',
                requestedAxial && !f.axial,
                max,
            );
            if (note) res.notes = [note, ...(res.notes ?? [])];
        }
    }
    return res;
}

/**
 * Extracts cylinder specs from an input deck. Dispatches to per-language
 * parsers; unknown languages return an empty array.
 */
export function extractCylinders(text: string, language: string, opts?: FidelityOptions): CylinderSpec[] {
    return parse(text, language, opts).cylinders;
}

const DEFAULT_FIDELITY: FidelityState = {
    detail: 'layers', axial: false, autoDetail: 'layers', totalPins: 0, hasAxial: false,
};

/** Full scene for the webview: geometry + legend summaries + caveats. */
export function buildScene(text: string, language: string, opts?: FidelityOptions): GeometryScene {
    const result = parse(text, language, opts);
    const cylinders = result.cylinders;

    const components = summarizeComponents(cylinders);
    const materials = summarizeMaterials(cylinders);
    const fidelity = result.fidelity ?? DEFAULT_FIDELITY;
    const axialLayers = summarizeAxialLayers(cylinders, fidelity.axial);

    return {
        language,
        cylinders,
        components,
        materials,
        axialLayers,
        warnings: result.warnings ?? [],
        notes: result.notes ?? [],
        primitiveCount: cylinders.length,
        fidelity,
    };
}

/**
 * Buckets the placed geometry into axial layers (z-bands) when axial detail is
 * on, tags every cylinder with its layer (id + bottom-to-top index), and
 * returns the legend summaries. Cylinders sharing a (zmin, zmax) range — every
 * pin's segment at a given elevation — collapse into one layer, so a BEAVRS
 * stack reads as its ~25 real axial levels rather than thousands of segments.
 * Vessel/barrel shells span the full height and are left out of the banding (so
 * the slice slider and per-layer toggles don't fight the context geometry).
 */
function summarizeAxialLayers(cylinders: CylinderSpec[], axialOn: boolean): AxialLayerSummary[] {
    if (!axialOn) return [];
    interface Band { zmin: number; zmax: number; count: number; colors: Map<string, number>; }
    const bands = new Map<string, Band>();
    for (const c of cylinders) {
        if (c.component === Component.Vessel) continue;
        const h = c.height || 0;
        const zmin = (c.z ?? 0) - h / 2;
        const zmax = (c.z ?? 0) + h / 2;
        const key = `${zmin.toFixed(1)}|${zmax.toFixed(1)}`;
        let band = bands.get(key);
        if (!band) { band = { zmin, zmax, count: 0, colors: new Map() }; bands.set(key, band); }
        band.count++;
        const col = c.color ?? '#888888';
        band.colors.set(col, (band.colors.get(col) ?? 0) + 1);
    }
    if (bands.size < 2) return [];

    const ordered = [...bands.values()].sort((a, b) => a.zmin - b.zmin);
    const summaries: AxialLayerSummary[] = ordered.map((band, index) => {
        let bestColor = '#888888';
        let bestN = -1;
        for (const [col, n] of band.colors) if (n > bestN) { bestN = n; bestColor = col; }
        const label = `${band.zmin.toFixed(1)}–${band.zmax.toFixed(1)} cm`;
        return { id: label, label, color: bestColor, count: band.count, zmin: band.zmin, zmax: band.zmax, index };
    });

    // Tag each cylinder with its axial layer for the webview's toggles/slider.
    const byKey = new Map<string, AxialLayerSummary>();
    summaries.forEach((s) => byKey.set(`${s.zmin.toFixed(1)}|${s.zmax.toFixed(1)}`, s));
    for (const c of cylinders) {
        if (c.component === Component.Vessel) continue;
        const h = c.height || 0;
        const zmin = (c.z ?? 0) - h / 2;
        const zmax = (c.z ?? 0) + h / 2;
        const s = byKey.get(`${zmin.toFixed(1)}|${zmax.toFixed(1)}`);
        if (s) { c.axialLayer = s.id; c.axialIndex = s.index; }
    }
    return summaries;
}

function summarizeComponents(cylinders: CylinderSpec[]): ComponentSummary[] {
    const order = Object.values(Component) as string[];
    const counts = new Map<string, number>();
    const colorByComp = new Map<string, string>();
    for (const c of cylinders) {
        const id = c.component ?? Component.Other;
        counts.set(id, (counts.get(id) ?? 0) + 1);
        if (!colorByComp.has(id)) colorByComp.set(id, c.color ?? componentColor(id));
    }
    const ids = [...counts.keys()].sort((a, b) => {
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });
    return ids.map((id) => ({
        id,
        label: COMPONENT_LABELS[id] ?? id,
        color: colorByComp.get(id) ?? componentColor(id),
        count: counts.get(id) ?? 0,
    }));
}

function summarizeMaterials(cylinders: CylinderSpec[]): MaterialSummary[] {
    const counts = new Map<string, number>();
    const colorByMat = new Map<string, string>();
    for (const c of cylinders) {
        if (!c.material) continue;
        counts.set(c.material, (counts.get(c.material) ?? 0) + 1);
        if (!colorByMat.has(c.material)) colorByMat.set(c.material, c.color ?? '#888888');
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, color: colorByMat.get(name) ?? '#888888', count }));
}
