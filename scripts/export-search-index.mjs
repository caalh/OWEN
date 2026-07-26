#!/usr/bin/env node
/**
 * Copy search-index.json from reactor-monte-carlo-guide into the OWEN VSIX bundle.
 * Run from owen repo after `npm run export:search-index` in the guide repo.
 */
import { copyFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const guideRoot = path.resolve(repoRoot, '..', 'reactor-monte-carlo-guide');
const src = path.join(guideRoot, 'public', 'data', 'search-index.json');
const destDir = path.join(repoRoot, 'data');
const dest = path.join(destDir, 'search-index.json');

async function exists(p) {
    try {
        await access(p);
        return true;
    } catch {
        return false;
    }
}

async function main() {
    if (!(await exists(src))) {
        console.error('[export-search-index] missing guide index — run in reactor-monte-carlo-guide: npm run export:search-index');
        process.exit(1);
    }
    await mkdir(destDir, { recursive: true });
    await copyFile(src, dest);
    console.log(`[export-search-index] copied -> ${dest}`);
}

main().catch((err) => {
    console.error('[export-search-index] unexpected failure', err);
    process.exit(1);
});
