#!/usr/bin/env node
// Sync the vendored material-card generator from the ReactorMC site repo.
//
//   reactormc: src/lib/pnnlCards.ts     -> owen: src/inputBuilder/pnnlCards.ts
//   reactormc: src/data/aceInventory.ts -> owen: src/inputBuilder/aceInventory.ts
//
//   npm run sync-nrdp-cards            copy
//   npm run sync-nrdp-cards -- --check fail if the copies have drifted
//
// The site is the source of truth for these two files because that is where the
// compendium dataset and its tests live (`npm run verify:nrdp-materials`, which
// checks all 411 materials). OWEN inserts cards from the same code so a deck
// written here matches what reactormc.net shows.
//
// The only edit made on the way in is the import specifier: the site compiles
// with `allowImportingTsExtensions` and imports './aceInventory.ts' so its
// scripts can run the file under plain Node, while OWEN emits JavaScript and
// must not carry a .ts extension into the output.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const CANDIDATES = [
    process.env.REACTORMC_REPO,
    path.resolve(repoRoot, '..', 'reactor-monte-carlo-guide'),
    path.resolve(repoRoot, '..', '..', 'reactor-monte-carlo-guide'),
].filter(Boolean);

const guideRoot = CANDIDATES.find((dir) => existsSync(path.join(dir, 'src', 'lib', 'pnnlCards.ts')));
if (!guideRoot) {
    console.error(
        '[sync-nrdp-cards] could not find the ReactorMC site repo. Looked in:\n'
        + CANDIDATES.map((c) => `  ${c}`).join('\n')
        + '\nSet REACTORMC_REPO.',
    );
    process.exit(1);
}

const FILES = [
    {
        from: path.join(guideRoot, 'src', 'data', 'aceInventory.ts'),
        to: path.join(repoRoot, 'src', 'inputBuilder', 'aceInventory.ts'),
        fix: (s) => s,
    },
    {
        from: path.join(guideRoot, 'src', 'lib', 'pnnlCards.ts'),
        to: path.join(repoRoot, 'src', 'inputBuilder', 'pnnlCards.ts'),
        fix: (s) => s.replace(/from '(?:\.\.\/data|\.)\/aceInventory\.ts'/g, "from './aceInventory'"),
    },
];

const BANNER = (rel) => `// VENDORED from the ReactorMC site repo: ${rel}
// Do not edit here. Edit it there, run its verify (npm run verify:nrdp-materials),
// then re-sync: npm run sync-nrdp-cards
`;

const check = process.argv.includes('--check');
let drifted = 0;

for (const f of FILES) {
    const rel = path.relative(guideRoot, f.from).replace(/\\/g, '/');
    const want = BANNER(rel) + f.fix(await readFile(f.from, 'utf8'));
    let have = '';
    try {
        have = await readFile(f.to, 'utf8');
    } catch {
        have = '';
    }
    if (have === want) {
        console.log(`[sync-nrdp-cards] up to date: ${path.relative(repoRoot, f.to)}`);
        continue;
    }
    if (check) {
        console.error(`[sync-nrdp-cards] DRIFTED: ${path.relative(repoRoot, f.to)} != ${rel}`);
        drifted += 1;
        continue;
    }
    await writeFile(f.to, want, 'utf8');
    console.log(`[sync-nrdp-cards] wrote ${path.relative(repoRoot, f.to)} from ${rel}`);
}

if (drifted > 0) {
    console.error('Run: npm run sync-nrdp-cards');
    process.exit(1);
}
