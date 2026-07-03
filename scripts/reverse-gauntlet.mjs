#!/usr/bin/env node
// Reverse gauntlet: validate a reverse-converted MCNP deck (OpenMC→MCNP)
// against the original bundled BEAVRS MCNP deck using OWEN's own
// extractor (scene statistics) and language rules (zero Errors required).
//
//   node scripts/reverse-gauntlet.mjs <converted.i> [reference.i]

import { build } from 'esbuild';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [convPath, refPath] = process.argv.slice(2);
if (!convPath) {
    console.error('usage: reverse-gauntlet.mjs <converted.i> [reference.i]');
    process.exit(2);
}

const tmp = mkdtempSync(join(tmpdir(), 'owen-revg-'));
const entry = join(tmp, 'entry.ts');
writeFileSync(entry, [
    `export { buildScene } from ${JSON.stringify(join(here, '..', 'src', 'preview', 'extractor.ts').replace(/\\/g, '/'))};`,
    `export { runLanguageRules } from ${JSON.stringify(join(here, '..', 'src', 'language', 'rules.ts').replace(/\\/g, '/'))};`,
].join('\n'));
const bundle = join(tmp, 'bundle.mjs');
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent' });
const { buildScene, runLanguageRules } = await import(pathToFileURL(bundle).href);

const convText = readFileSync(convPath, 'utf8');

// ---- 1. validator: zero Errors ----
const diags = runLanguageRules('mcnp', convText);
const errors = diags.filter((d) => d.severity === 'error' || d.severity === 0);
console.log(`validator: ${diags.length} diagnostics, ${errors.length} errors`);
for (const e of errors.slice(0, 10)) console.log(`  ERROR [line ${e.line + 1}] ${e.code}: ${e.message}`);

// ---- 2. extractor scene ----
function sceneStats(text, label) {
    const scene = buildScene(text, 'mcnp');
    const cyls = scene.cylinders ?? [];
    const byComp = {};
    for (const c of cyls) byComp[c.component ?? 'unknown'] = (byComp[c.component ?? 'unknown'] ?? 0) + 1;
    const rmax = cyls.reduce((m, c) => Math.max(m, Math.hypot(c.x ?? 0, c.y ?? 0) + (c.radius ?? 0)), 0);
    const zmin = cyls.reduce((m, c) => Math.min(m, (c.z ?? 0) - (c.height ?? 0) / 2), Infinity);
    const zmax = cyls.reduce((m, c) => Math.max(m, (c.z ?? 0) + (c.height ?? 0) / 2), -Infinity);
    console.log(`${label}: instances=${cyls.length} outerR=${rmax.toFixed(2)} z=[${zmin.toFixed(2)}, ${zmax.toFixed(2)}]`);
    console.log(`  components: ${Object.entries(byComp).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    for (const c of cyls) {
        if (c.component === 'vessel' || c.component === 'moderator') {
            console.log(`    ${c.component}: label=${c.label} r=${(c.radius ?? 0).toFixed(2)} mat=${c.material ?? '?'}`);
        }
    }
    return { n: cyls.length, rmax, zmin, zmax, byComp };
}

const conv = sceneStats(convText, 'converted');
let ok = errors.length === 0 && conv.n > 0;

if (refPath) {
    const ref = sceneStats(readFileSync(refPath, 'utf8'), 'reference');
    const relN = Math.abs(conv.n - ref.n) / Math.max(ref.n, 1);
    const relR = Math.abs(conv.rmax - ref.rmax) / Math.max(ref.rmax, 1e-9);
    const dzTop = Math.abs(conv.zmax - ref.zmax);
    console.log(`deltas: instances ${(relN * 100).toFixed(1)}% outerR ${(relR * 100).toFixed(1)}% zmax ${dzTop.toFixed(2)} cm`);
    if (relN > 0.10) { console.log('FAIL: instance count delta > 10%'); ok = false; }
    if (relR > 0.05) { console.log('FAIL: outer radius delta > 5%'); ok = false; }
    if (dzTop > 5) { console.log('FAIL: zmax delta > 5 cm'); ok = false; }
}

console.log(ok ? 'REVERSE GAUNTLET OK' : 'REVERSE GAUNTLET FAILED');
process.exit(ok ? 0 : 1);
