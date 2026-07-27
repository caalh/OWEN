// Lazy loader for the bundled PNNL-15870 Rev. 2 compendium dataset
// (data/pnnl-materials.json, ~600 KB — read from disk on first use, never
// bundled into the extension JS).

import * as fs from 'fs';
import * as path from 'path';
import type { PnnlDataset, PnnlMaterial } from './pnnlCards';

let cache: PnnlDataset | null = null;

// The dataset sits at <repo>/data, but this module runs from two different
// depths — out/extension.js in the esbuild bundle, out/src/inputBuilder/ under
// tsc — and the tsc depth has moved once already. Rather than guess a fixed
// number of `..`, walk up until the file appears.
function candidatePaths(): string[] {
    const out: string[] = [];
    let dir = __dirname;
    for (let i = 0; i < 6; i++) {
        out.push(path.join(dir, 'data', 'pnnl-materials.json'));
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return out;
}

export function loadPnnlDataset(): PnnlDataset | null {
    if (cache) return cache;
    for (const p of candidatePaths()) {
        try {
            if (!fs.existsSync(p)) continue;
            cache = JSON.parse(fs.readFileSync(p, 'utf8')) as PnnlDataset;
            return cache;
        } catch (err) {
            console.warn('[owen.pnnl] failed to read dataset at', p, err);
        }
    }
    return null;
}

export function findPnnlMaterial(id: string): PnnlMaterial | undefined {
    return loadPnnlDataset()?.materials.find((m) => m.id === id);
}

export interface PnnlSummary {
    id: string;
    name: string;
    formula?: string;
    density: number;
    elements: string;
}

/** Search over name/id/formula/acronyms/element symbols; capped result list. */
export function searchPnnlMaterials(query: string, limit = 50): PnnlSummary[] {
    const ds = loadPnnlDataset();
    if (!ds) return [];
    const q = query.trim().toLowerCase();
    const out: PnnlSummary[] = [];
    for (const m of ds.materials) {
        if (q.length > 0) {
            const match =
                m.name.toLowerCase().includes(q) ||
                m.id.includes(q) ||
                (m.formula ? m.formula.toLowerCase().includes(q) : false) ||
                (m.acronyms ? m.acronyms.some((a) => a.toLowerCase().includes(q)) : false) ||
                m.elements.some((e) => e.sym.toLowerCase() === q);
            if (!match) continue;
        }
        out.push({
            id: m.id,
            name: m.name,
            formula: m.formula,
            density: m.density,
            elements: m.elements.map((e) => e.sym).join(', '),
        });
        if (out.length >= limit) break;
    }
    return out;
}
