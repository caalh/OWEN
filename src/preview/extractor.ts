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
    COMPONENT_LABELS,
    Component,
    FidelityOptions,
    FidelityState,
} from './types';
import { componentColor } from './palette';
import { parseMcnp } from './codes/mcnp';
import { parseOpenmc } from './codes/openmc';
import { parseSerpent } from './codes/serpent';
import { parseScone } from './codes/scone';

export type { CylinderSpec };

function parse(text: string, language: string, opts?: FidelityOptions): ParseResult {
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

    return {
        language,
        cylinders,
        components,
        materials,
        warnings: result.warnings ?? [],
        notes: result.notes ?? [],
        primitiveCount: cylinders.length,
        fidelity: result.fidelity ?? DEFAULT_FIDELITY,
    };
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
