#!/usr/bin/env node
// Extract `{ path, title }` entries from the navigation TS files in the sibling
// reactor-monte-carlo-guide repo into a JSON manifest bundled with the OWEN VSIX.
//
// Reads:
//   ../../reactor-monte-carlo-guide/src/lib/navigation/{mcnp,openmc,serpent,scone,fundamentals}Pages.ts
// Writes:
//   owen/data/tutorial-links.json  (object keyed by section name)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const guideRoot = path.resolve(repoRoot, '..', 'reactor-monte-carlo-guide');
const dataDir = path.resolve(repoRoot, 'data');

const SECTIONS = ['mcnp', 'openmc', 'serpent', 'scone', 'fundamentals'];

const ENTRY_RE = /\{\s*path:\s*["'`]([^"'`]+)["'`]\s*,\s*title:\s*["'`]([^"'`]+)["'`][\s\S]*?\}/g;

async function extractSection(section) {
    const src = path.join(guideRoot, 'src', 'lib', 'navigation', `${section}Pages.ts`);
    try {
        const text = await readFile(src, 'utf8');
        const entries = [];
        let m;
        ENTRY_RE.lastIndex = 0;
        while ((m = ENTRY_RE.exec(text)) !== null) {
            entries.push({ path: m[1], title: m[2] });
        }
        return entries;
    } catch (err) {
        console.warn(`[export-tutorials] ${section} missing or unreadable: ${err.message}`);
        return [];
    }
}

async function main() {
    await mkdir(dataDir, { recursive: true });
    const out = {};
    let total = 0;
    for (const section of SECTIONS) {
        const entries = await extractSection(section);
        out[section] = entries;
        total += entries.length;
    }
    const dest = path.join(dataDir, 'tutorial-links.json');
    await writeFile(dest, JSON.stringify(out, null, 2) + '\n', 'utf8');
    console.log(`[export-tutorials] wrote ${total} pages across ${SECTIONS.length} sections -> ${dest}`);
}

main().catch((err) => {
    console.error('[export-tutorials] unexpected failure', err);
    process.exit(1);
});
