#!/usr/bin/env node
// OWEN converter CLI — used by the conversion gauntlet (and handy manually):
//   node scripts/convert-cli.mjs mcnp2openmc <in.i>  <out.py>
//   node scripts/convert-cli.mjs openmc2mcnp <in.py> <out.i>     (static)
//   node scripts/convert-cli.mjs trace2mcnp  <trace.json> <out.i>
//   node scripts/convert-cli.mjs harness     <out.py>            (write trace harness)
// Bundles src/converter on the fly with esbuild, then converts.

import { build } from 'esbuild';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [mode, inPath, outPath] = process.argv.slice(2);
if (!mode || !inPath) {
    console.error('usage: convert-cli.mjs <mcnp2openmc|openmc2mcnp|trace2mcnp|harness> <in> [out]');
    process.exit(2);
}

const tmp = mkdtempSync(join(tmpdir(), 'owen-convert-'));
const bundle = join(tmp, 'converter.mjs');
await build({
    entryPoints: [join(here, '..', 'src', 'converter', 'index.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: bundle,
    logLevel: 'silent',
});
const conv = await import(pathToFileURL(bundle).href);

if (mode === 'harness') {
    writeFileSync(inPath, conv.TRACE_HARNESS_PY, 'utf8');
    console.log(`harness written: ${inPath}`);
    process.exit(0);
}

const text = readFileSync(inPath, 'utf8');
let result;
if (mode === 'mcnp2openmc') result = conv.mcnpToOpenmc(text);
else if (mode === 'openmc2mcnp') result = conv.openmcToMcnp(text);
else if (mode === 'trace2mcnp') result = conv.openmcTraceToMcnp(text);
else {
    console.error(`unknown mode ${mode}`);
    process.exit(2);
}

if (outPath) writeFileSync(outPath, result.output, 'utf8');
else process.stdout.write(result.output);
console.error(`issues: ${result.issues.length}`);
for (const i of result.issues.slice(0, 40)) {
    console.error(`  [line ${i.sourceLine + 1}] ${i.message}`);
}
if (result.issues.length > 40) console.error(`  ... and ${result.issues.length - 40} more`);
const todoCount = (result.output.match(/TODO\(owen-convert\)/g) || []).length;
console.error(`TODO markers in output: ${todoCount}`);
