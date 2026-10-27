// Ad-hoc verification harness: runs the compiled extractor against the on-disk
// reactor test decks plus inline axial fixtures, and prints instance counts +
// fidelity behaviour (including axial segment counts) per code.
//
// Compile first: node ./node_modules/typescript/bin/tsc --outDir out-test
// Then:          node scripts/viz-check.mjs
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildScene } from '../out-test/preview/extractor.js';

const here = dirname(fileURLToPath(import.meta.url));
const PREBUILT = join(here, '..', 'prebuilt-models');
const DECKS = join(homedir(), 'reactor-test-decks');

// Disk decks (skipped silently when not present on this machine).
const diskCases = [
    ['basic_mcnp_test.inp', 'mcnp'],
    ['assembly_17x17_mcnp.i', 'mcnp'],
    ['assembly_17x17_serpent.sss', 'serpent'],
    ['beavrs_core_mcnp.i', 'mcnp'],
    ['beavrs_core_serpent.sss', 'serpent'],
];

// --- Inline axial fixtures (a few pz/z layers each) -----------------------
// 2×2 lattice of a 3-segment axial pin stack: end plug / active fuel / plenum.
const MCNP_AXIAL = [
    'c MCNP axial fixture: 2x2 lattice of a pz-bounded 3-segment pin stack',
    '1 1 -10.4 -1    u=1 imp:n=1   $ fuel pellet',
    '2 3 -6.5   1 -2 u=1 imp:n=1   $ clad',
    '3 4 -1.0   2    u=1 imp:n=1   $ water',
    '4 5 -8.0  -2    u=2 imp:n=1   $ plenum (Inconel spring) ',
    '5 4 -1.0   2    u=2 imp:n=1',
    '6 3 -6.5  -2    u=3 imp:n=1   $ end plug (solid Zr)',
    '7 4 -1.0   2    u=3 imp:n=1',
    'c axial stack universe u=30 (bottom -> top): end plug / fuel / plenum',
    '30 0 100 -101 fill=3 u=30 imp:n=1   $ z 0..5  end plug',
    '31 0 101 -102 fill=1 u=30 imp:n=1   $ z 5..45 active fuel',
    '32 0 102 -103 fill=2 u=30 imp:n=1   $ z 45..55 plenum',
    'c lattice + container',
    '40 0 50 -51 52 -53 lat=1 u=40 imp:n=1',
    '     fill=0:1 0:1 0:0',
    '     30 30 30 30',
    '50 0 -60 fill=40 imp:n=1',
    '51 0  60 imp:n=0',
    '',
    '1 cz 0.40',
    '2 cz 0.46',
    '50 px -0.63',
    '51 px  0.63',
    '52 py -0.63',
    '53 py  0.63',
    '100 pz 0',
    '101 pz 5',
    '102 pz 45',
    '103 pz 55',
    '60 rpp -1.26 1.26 -1.26 1.26 0 55',
    '',
    'm1 92235.80c 0.04 92238.80c 0.96 8016.80c 2.0',
    'm3 40090.80c 1.0',
    'm4 1001.80c 2.0 8016.80c 1.0',
    'm5 28058.80c 0.7 24052.80c 0.2 26056.80c 0.1',
    'mode n',
].join('\n');

const SERPENT_AXIAL = [
    '% Serpent axial fixture: 2x2 lattice of a pz-bounded 3-segment pin stack',
    'pin pf',
    'UO2 0.40',
    'Zr 0.46',
    'water',
    'pin pp',
    'steel 0.46',
    'water',
    'pin pe',
    'Zr 0.46',
    'water',
    'surf z0 pz 0',
    'surf z1 pz 5',
    'surf z2 pz 45',
    'surf z3 pz 55',
    'cell s0 30 fill pe z0 -z1   % end plug',
    'cell s1 30 fill pf z1 -z2   % active fuel',
    'cell s2 30 fill pp z2 -z3   % plenum',
    'lat 40 1 0.0 0.0 2 2 1.26',
    '30 30',
    '30 30',
    'surf box sqc 0.0 0.0 1.26',
    'cell c1 0 fill 40 -box',
    'cell c2 0 outside box',
].join('\n');

function summarize(label, scene) {
    console.log(`  ${label}: ${scene.primitiveCount.toLocaleString()} prims | detail=${scene.fidelity.detail} axial=${scene.fidelity.axial} hasAxial=${scene.fidelity.hasAxial} pins=${scene.fidelity.totalPins.toLocaleString()} | axialLayers=${scene.axialLayers.length}`);
    if (scene.axialLayers.length) {
        const bands = scene.axialLayers.map((a) => a.label).join(', ');
        console.log(`     axial bands (${scene.axialLayers.length}): ${bands.length > 160 ? bands.slice(0, 160) + '…' : bands}`);
    }
    if (scene.warnings.length) console.log(`     WARN: ${scene.warnings.join(' | ')}`);
}

function runCase(name, text, lang, axialOnly = false) {
    console.log(`\n=== ${name} (${lang}) ===`);
    if (!axialOnly) summarize('auto', buildScene(text, lang, { detail: 'auto', axial: false }));
    summarize('layers+axial', buildScene(text, lang, { detail: 'layers', axial: true }));
    summarize('disc+axial', buildScene(text, lang, { detail: 'disc', axial: true }));
}

// Inline axial fixtures (always run).
runCase('MCNP_AXIAL (inline fixture)', MCNP_AXIAL, 'mcnp');
runCase('SERPENT_AXIAL (inline fixture)', SERPENT_AXIAL, 'serpent');

// Verified SCONE BEAVRS prebuilt — primary axial test input (~25 layers).
const sconePrebuilt = join(PREBUILT, 'beavrs_scone_fullcore.scone');
if (existsSync(sconePrebuilt)) {
    runCase('beavrs_scone_fullcore.scone (PREBUILT)', readFileSync(sconePrebuilt, 'utf8'), 'scone');
} else {
    console.log('\n(!) prebuilt SCONE BEAVRS not found at ' + sconePrebuilt);
}

// Optional disk decks.
for (const [file, lang] of diskCases) {
    const p = `${DECKS}/${file}`;
    if (!existsSync(p)) { console.log(`\n=== ${file} (${lang}) === SKIPPED (not on disk)`); continue; }
    const text = readFileSync(p, 'utf8');
    console.log(`\n=== ${file} (${lang}) ===`);
    summarize('auto', buildScene(text, lang, { detail: 'auto', axial: false }));
    summarize('layers', buildScene(text, lang, { detail: 'layers', axial: false }));
    if (lang === 'scone') summarize('disc+axial', buildScene(text, lang, { detail: 'disc', axial: true }));
}
