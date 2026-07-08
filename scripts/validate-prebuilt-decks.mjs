#!/usr/bin/env node
/** Headless OWEN rules pass on bundled prebuilt-model decks. */
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const modelsDir = join(here, '..', 'prebuilt-models');
const manifest = JSON.parse(readFileSync(join(modelsDir, 'index.json'), 'utf8'));

const filter = process.argv.includes('--beavrs-only')
    ? (m) => m.id.includes('beavrs') || m.scale === 'assembly' || m.scale === 'pin-cell'
    : () => true;

const tmp = mkdtempSync(join(tmpdir(), 'owen-val-'));
const entry = join(tmp, 'entry.ts');
writeFileSync(
    entry,
    [
        `export { runLanguageRules } from ${JSON.stringify(join(here, '..', 'src', 'language', 'rules.ts').replace(/\\/g, '/'))};`,
        `export { mcnpCrossReferenceDiagnostics } from ${JSON.stringify(join(here, '..', 'src', 'language', 'crossReference.ts').replace(/\\/g, '/'))};`,
        `export { buildScene } from ${JSON.stringify(join(here, '..', 'src', 'preview', 'extractor.ts').replace(/\\/g, '/'))};`,
    ].join('\n'),
);
const bundle = join(tmp, 'bundle.mjs');
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent' });
const { runLanguageRules, mcnpCrossReferenceDiagnostics, buildScene } = await import(pathToFileURL(bundle).href);

const LANG = { mcnp: 'mcnp', openmc: 'openmc', serpent: 'serpent', scone: 'scone' };

let totalErrors = 0;
const rows = [];

for (const m of manifest.filter(filter)) {
    const text = readFileSync(join(modelsDir, m.filename), 'utf8');
    const lang = LANG[m.code];
    const rules = runLanguageRules(lang, text);
    const xref = lang === 'mcnp' ? mcnpCrossReferenceDiagnostics(text) : [];
    const diags = [...rules, ...xref];
    const bySev = { error: [], warning: [], information: [], hint: [] };
    for (const d of diags) {
        const sev = typeof d.severity === 'string' ? d.severity : ['error', 'warning', 'information', 'hint'][d.severity] ?? 'warning';
        (bySev[sev] ?? bySev.warning).push(d);
    }
    totalErrors += bySev.error.length;

    let sceneN = null;
    if (m.id.includes('beavrs') && m.scale === 'full-core') {
        try {
            const scene = buildScene(text, lang, { detail: 'disc', axial: false });
            sceneN = (scene.cylinders ?? []).length;
        } catch (e) {
            sceneN = `CRASH: ${e.message}`;
        }
    }

    rows.push({ id: m.id, filename: m.filename, code: m.code, ...bySev, sceneN });
    console.log(`\n=== ${m.id} (${m.filename}) ===`);
    console.log(`  errors=${bySev.error.length} warnings=${bySev.warning.length} info=${bySev.information.length} hints=${bySev.hint.length}${sceneN != null ? ` scene=${sceneN}` : ''}`);
    for (const sev of ['error', 'warning', 'information', 'hint']) {
        for (const d of bySev[sev].slice(0, 20)) {
            console.log(`  [${sev.toUpperCase()}] L${d.line + 1} ${d.code ?? '?'}: ${d.message}`);
        }
        if (bySev[sev].length > 20) console.log(`  ... +${bySev[sev].length - 20} more ${sev}`);
    }
}

console.log(`\nTOTAL ERRORS: ${totalErrors}`);
process.exit(totalErrors > 0 ? 1 : 0);
