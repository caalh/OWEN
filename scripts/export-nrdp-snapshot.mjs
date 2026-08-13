#!/usr/bin/env node
// Bundle the NRDP data from the sibling ReactorMC site repo into the VSIX.
//
// Writes:
//   owen/data/nrdp-materials.json   <- reactormc: public/data/nrdp-materials.json
//   owen/data/nrdp-elements.json    <- reactormc: src/data/elements.ts
//
// The materials file is generated on the site side (scripts/nrdp/recipes.mjs ->
// npm run generate:nrdp-materials) and published at
// https://reactormc.net/data/nrdp-materials.json, which is what the extension
// fetches at runtime; this snapshot is the offline fallback. So it is copied
// verbatim — do not re-derive material data here, or the two can disagree.
//
// Elements have no published JSON yet, so that one is still sliced out of the TS
// array literal.
//
// This script used to resolve the site repo one directory too far up and, when
// it found nothing, write empty arrays and exit 0. The VSIX then shipped with an
// empty material list. It now searches the plausible locations and fails loudly.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const dataDir = path.resolve(repoRoot, 'data');

const CANDIDATES = [
    process.env.REACTORMC_REPO,
    path.resolve(repoRoot, '..', 'reactor-monte-carlo-guide'),
    path.resolve(repoRoot, '..', '..', 'reactor-monte-carlo-guide'),
    path.resolve(repoRoot, '..', '..', '..', 'reactor-monte-carlo-guide'),
].filter(Boolean);

function findGuideRoot() {
    for (const dir of CANDIDATES) {
        if (existsSync(path.join(dir, 'public', 'data', 'nrdp-materials.json'))) return dir;
    }
    return null;
}

const guideRoot = findGuideRoot();
if (!guideRoot) {
    console.error(
        '[export-nrdp] could not find the ReactorMC site repo. Looked in:\n'
        + CANDIDATES.map((c) => `  ${c}`).join('\n')
        + '\nSet REACTORMC_REPO, or run `npm run generate:nrdp-materials` there first '
        + '(public/data/nrdp-materials.json is generated).',
    );
    process.exit(1);
}

const MATERIALS_SRC = path.join(guideRoot, 'public', 'data', 'nrdp-materials.json');
const ELEMENTS_SRC = path.join(guideRoot, 'src', 'data', 'elements.ts');

function sliceArrayLiteral(source, markerRegex) {
    const m = source.match(markerRegex);
    if (!m) return null;
    const afterMatch = m.index + m[0].length;
    const start = source.indexOf('[', afterMatch);
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let stringChar = '';
    let inTemplate = false;
    let inLineComment = false;
    let inBlockComment = false;
    for (let i = start; i < source.length; i++) {
        const ch = source[i];
        const next = source[i + 1];
        if (inLineComment) {
            if (ch === '\n') inLineComment = false;
            continue;
        }
        if (inBlockComment) {
            if (ch === '*' && next === '/') { inBlockComment = false; i++; }
            continue;
        }
        if (inString) {
            if (ch === '\\') { i++; continue; }
            if (ch === stringChar) inString = false;
            continue;
        }
        if (inTemplate) {
            if (ch === '\\') { i++; continue; }
            if (ch === '`') inTemplate = false;
            continue;
        }
        if (ch === '/' && next === '/') { inLineComment = true; i++; continue; }
        if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
        if (ch === '"' || ch === '\'') { inString = true; stringChar = ch; continue; }
        if (ch === '`') { inTemplate = true; continue; }
        if (ch === '[') depth++;
        else if (ch === ']') {
            depth--;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    return null;
}

async function exportElements() {
    const src = await readFile(ELEMENTS_SRC, 'utf8');
    const literal = sliceArrayLiteral(src, /export\s+const\s+elements\s*:\s*Element\s*\[\]\s*=/);
    if (!literal) throw new Error(`could not locate the elements array literal in ${ELEMENTS_SRC}`);
    const factory = new Function('e', `return ${literal};`);
    const e = (z, symbol, name, category, row, col, atomicMass) =>
        ({ z, symbol, name, category, row, col, atomicMass });
    const arr = factory(e);
    if (!Array.isArray(arr) || arr.length === 0) throw new Error('elements literal did not eval to a non-empty array');
    return arr;
}

async function exportMaterials() {
    const parsed = JSON.parse(await readFile(MATERIALS_SRC, 'utf8'));
    const materials = Array.isArray(parsed) ? parsed : parsed.materials;
    if (!Array.isArray(materials) || materials.length === 0) {
        throw new Error(`${MATERIALS_SRC} has no materials array`);
    }
    for (const m of materials) {
        if (!m.slug || !m.provenance) {
            throw new Error(`material ${m.slug ?? '(no slug)'} is missing slug or provenance — stale snapshot?`);
        }
        // The one field the old hand-written snapshot did not have. Its absence
        // means the site repo has not been regenerated.
        if (m.composition?.length > 0 && typeof m.sconeCode !== 'string') {
            throw new Error(`material ${m.slug} has no sconeCode — run generate:nrdp-materials in the site repo`);
        }
    }
    return materials;
}

/**
 * The Input Builder's material dropdown, as TypeScript.
 *
 * It has to be synchronous and available at module load (the webview injects the
 * list into its own script), and the builder renders cards through the shared
 * generators in src/inputBuilder/pnnlCards.ts, so what it needs is the
 * compendium-shaped element tree — not the card text. Generating it keeps the
 * builder, `owen.insertMaterial`, and reactormc.net on one composition: the
 * hand-written version of this table had UO2 at 10.97 g/cm³ with 3 *atom*
 * percent U-235 under a "3% enriched" label, and SS304 at a nominal 19/10/2/69.
 */
function builderModule(materials) {
    const usable = materials.filter((m) => Array.isArray(m.elements) && m.elements.length > 0);
    const rows = usable.map((m) => ({
        id: m.slug,
        name: m.name,
        formula: m.formula,
        category: m.category,
        density: m.density,
        atomDensity: m.atomDensity,
        description: m.description,
        provenance: m.provenance,
        source: m.source,
        sabNames: m.sabNames,
        elements: m.elements,
    }));
    return `// GENERATED FILE — do not edit by hand.
//
// Written by scripts/export-nrdp-snapshot.mjs from the ReactorMC site repo
// (public/data/nrdp-materials.json, itself generated from
// scripts/nrdp/recipes.mjs). Regenerate with:
//
//   npm run export-nrdp
//
// Each entry is either a PNNL-15870 Rev. 2 material verbatim (source: 'pnnl')
// or a derived recipe with stated provenance. Cards are generated from these
// element trees by src/inputBuilder/pnnlCards.ts, which is the same code
// reactormc.net runs, so the builder cannot disagree with the site.

import type { PnnlElement } from './pnnlCards';

export interface NrdpLibraryMaterial {
    id: string;
    name: string;
    formula?: string;
    category: string;
    /** g/cm3 */
    density: number;
    /** atoms/(barn*cm) */
    atomDensity: number;
    description: string;
    provenance: string;
    source: 'pnnl' | 'derived';
    /** Keys into SAB_LIBRARY in pnnlCards.ts, e.g. ['lwtr']. */
    sabNames?: string[];
    elements: PnnlElement[];
}

export const NRDP_LIBRARY: NrdpLibraryMaterial[] = ${JSON.stringify(rows, null, 4)} as NrdpLibraryMaterial[];
`;
}

async function main() {
    await mkdir(dataDir, { recursive: true });
    const elements = await exportElements();
    const materials = await exportMaterials();

    const elementsOut = path.join(dataDir, 'nrdp-elements.json');
    const materialsOut = path.join(dataDir, 'nrdp-materials.json');
    await writeFile(elementsOut, JSON.stringify(elements, null, 2) + '\n', 'utf8');
    await writeFile(materialsOut, JSON.stringify(materials, null, 2) + '\n', 'utf8');

    const builderOut = path.resolve(repoRoot, 'src', 'inputBuilder', 'nrdpLibrary.generated.ts');
    await writeFile(builderOut, builderModule(materials), 'utf8');
    console.log(`[export-nrdp] wrote the builder library -> ${builderOut}`);

    const derived = materials.filter((m) => m.source === 'derived').length;
    console.log(`[export-nrdp] site repo: ${guideRoot}`);
    console.log(`[export-nrdp] wrote ${elements.length} elements -> ${elementsOut}`);
    console.log(
        `[export-nrdp] wrote ${materials.length} materials (${materials.length - derived} from PNNL-15870 Rev. 2, `
        + `${derived} derived) -> ${materialsOut}`,
    );
}

main().catch((err) => {
    console.error(`[export-nrdp] failed: ${err.message}`);
    process.exit(1);
});
