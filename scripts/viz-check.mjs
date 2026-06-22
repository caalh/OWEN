// Ad-hoc verification harness: runs the compiled extractor against the on-disk
// reactor test decks and prints instance counts + fidelity behaviour per code.
// Compile first: node ./node_modules/typescript/bin/tsc --outDir out-test
// Then: node scripts/viz-check.mjs
import { readFileSync } from 'node:fs';
import { buildScene } from '../out-test/preview/extractor.js';

const DECKS = 'C:/Users/me/reactor-test-decks';
const cases = [
    ['assembly_17x17_mcnp.i', 'mcnp'],
    ['assembly_17x17_serpent.sss', 'serpent'],
    ['beavrs_core_mcnp.i', 'mcnp'],
    ['beavrs_core_serpent.sss', 'serpent'],
    ['beavrs_scone_fullcore.scone', 'scone'],
];

function summarize(label, scene) {
    const comps = scene.components.map((c) => `${c.id}:${c.count}`).join(' ');
    const mats = scene.materials.map((m) => m.name).slice(0, 8).join(', ');
    console.log(`  ${label}: ${scene.primitiveCount.toLocaleString()} prims | detail=${scene.fidelity.detail} auto=${scene.fidelity.autoDetail} axial=${scene.fidelity.axial} hasAxial=${scene.fidelity.hasAxial} pins=${scene.fidelity.totalPins.toLocaleString()}`);
    console.log(`     components: ${comps}`);
    console.log(`     materials: ${mats}`);
    if (scene.warnings.length) console.log(`     WARN: ${scene.warnings.join(' | ')}`);
}

for (const [file, lang] of cases) {
    const text = readFileSync(`${DECKS}/${file}`, 'utf8');
    console.log(`\n=== ${file} (${lang}) ===`);
    summarize('auto', buildScene(text, lang, { detail: 'auto', axial: false }));
    summarize('layers', buildScene(text, lang, { detail: 'layers', axial: false }));
    if (lang === 'scone') {
        summarize('disc+axial', buildScene(text, lang, { detail: 'disc', axial: true }));
    }
}
