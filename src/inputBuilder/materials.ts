/**
 * The Input Builder's material library.
 *
 * Every card — the bundled library and anything picked out of the PNNL-15870
 * Rev. 2 compendium — is written by the generators in `./pnnlCards`, which are
 * vendored from the ReactorMC site repo (`npm run sync-nrdp-cards`). The
 * compositions come from `./nrdpLibrary.generated.ts` (`npm run export-nrdp`).
 *
 * This used to be a hand-written table of card text, and it drifted: UO2 sat at
 * 10.97 g/cm³ with 3 *atom* percent U-235 under a "3 wt% enriched" label (about
 * 1% light on fissile), SS304 was a nominal 19/10/2/69 at 8.0 instead of the
 * compendium's 8.03, Zircaloy-4 named `40000.80c`, and the SCONE branch wrote
 * fractions into a block that means atom densities. Nothing here is typed by
 * hand any more, so a deck built here matches what reactormc.net publishes.
 */

import type { PnnlMaterial, SabEntry } from './pnnlCards';
import { pnnlMcnpCard, pnnlOpenmcSnippet, pnnlSerpentCard, pnnlSconeEntry, SAB_LIBRARY } from './pnnlCards';
import { NRDP_LIBRARY, type NrdpLibraryMaterial } from './nrdpLibrary.generated';

export type MonteCarloCode = 'mcnp' | 'openmc' | 'serpent' | 'scone';

export interface MaterialEntry {
    id: string;
    name: string;
    category: string;
    density: number;
    densityUnit: 'g/cm3' | 'atom/b-cm';
    description: string;
    /** Where the composition comes from, shown in the picker and on the card. */
    provenance?: string;
    /** 'pnnl' for a compendium material taken verbatim, 'derived' for a recipe. */
    source?: string;
}

export interface SelectedMaterial extends MaterialEntry {
    mcnpNumber: number;
    customName?: string;
    /** Present when the entry comes from the PNNL-15870 Rev. 2 compendium. */
    pnnl?: PnnlMaterial;
}

function sabFor(m: NrdpLibraryMaterial): SabEntry[] | undefined {
    if (!m.sabNames || m.sabNames.length === 0) return undefined;
    const out: SabEntry[] = [];
    for (const name of m.sabNames) {
        const entry = (SAB_LIBRARY as Record<string, SabEntry>)[name];
        if (entry) out.push(entry);
    }
    return out.length > 0 ? out : undefined;
}

/** The library entry as the compendium-shaped material the generators take. */
function asPnnl(m: NrdpLibraryMaterial, label?: string): PnnlMaterial {
    return {
        id: m.id,
        name: label ?? m.name,
        formula: m.formula,
        density: m.density,
        atomDensity: m.atomDensity,
        elements: m.elements,
        sourceLabel: m.source === 'pnnl'
            ? `PNNL-15870 Rev. 2 — reactormc.net/nrdp/material/${m.id}`
            : `ReactorMC NRDP derived material — reactormc.net/nrdp/material/${m.id}`,
        sab: sabFor(m),
    };
}

const BY_ID = new Map(NRDP_LIBRARY.map((m) => [m.id, m]));

/** Bundled library: the NRDP curated set, minus anything with no composition. */
export const MATERIAL_LIBRARY: MaterialEntry[] = NRDP_LIBRARY.map((m) => ({
    id: m.id,
    name: m.name,
    category: m.category,
    density: m.density,
    densityUnit: 'g/cm3' as const,
    description: m.description,
    provenance: m.provenance,
    source: m.source,
}));

export function renderMaterial(code: MonteCarloCode, mat: SelectedMaterial): string {
    const n = mat.mcnpNumber;
    // Newlines in a custom name would split a comment/name across lines in
    // every generated deck; flatten them. For Python (OpenMC) the label lands
    // inside a string literal, so quotes and backslashes in a hostile or
    // accidental name would break the generated script — the label is
    // display-only, so substitute safe lookalikes.
    const rawLabel = (mat.customName || mat.name).replace(/[\r\n]+/g, ' ');
    const label = code === 'openmc'
        ? rawLabel.replace(/\\/g, '/').replace(/'/g, '"')
        : rawLabel;

    const material = mat.pnnl ?? (BY_ID.has(mat.id) ? asPnnl(BY_ID.get(mat.id)!, label) : undefined);
    if (material) {
        if (code === 'mcnp') return pnnlMcnpCard(material, n);
        if (code === 'openmc') return pnnlOpenmcSnippet(material);
        if (code === 'serpent') return pnnlSerpentCard(material);
        return pnnlSconeEntry(material);
    }

    // An id the library does not know: emit something that parses, names itself
    // a placeholder, and cannot be mistaken for a real composition.
    const varName = 'mat_' + mat.id.replace(/[^a-z0-9]/gi, '_');
    const sconeName = mat.id.replace(/[^A-Za-z0-9]/g, '_');
    if (code === 'mcnp') return `c ${label} (${mat.id})\nm${n}    92238.80c  -1.0  $ placeholder — edit composition`;
    if (code === 'openmc') {
        return `${varName} = openmc.Material(name='${label}')  # placeholder — edit composition\n`
            + `${varName}.set_density('g/cm3', ${mat.density})\n`
            + `${varName}.add_nuclide('U238', 1.0, percent_type='wo')`;
    }
    if (code === 'serpent') {
        return `% ${label}\nmat mat_${n} -${mat.density}  % placeholder — edit composition\n92238.80c  -1.0`;
    }
    return `// ${label} — placeholder composition, edit before running\n${sconeName} {\n  temp 300;\n`
        + `  composition {\n    92238.03 1.000000e-3;\n  }\n}`;
}
