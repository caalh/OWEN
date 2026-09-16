#!/usr/bin/env node
// Headless 2D slice renderer over the exact-geometry engine — the same
// classification the in-editor slice view shows, written to a PNG so it can
// sit next to an OpenMC plot_geometry() image for a like-for-like check.
//
//   npm run pretest   (compiles out/)
//   node scripts/render-slice.mjs <deck> <axis> <offset> <halfU> <halfV> <px> <out.png> [centerU centerV]
//
// Example (BEAVRS core midplane, 400×400 cm window, 1600 px):
//   node scripts/render-slice.mjs prebuilt-models/beavrs_fullcore_mcnp.i xy 219.628 200 200 1600 core.png

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { parseDeckToModel } = require(path.join(root, 'out', 'src', 'preview', 'engineDispatch.js'));
const { axisPlane, sliceModel, sliceToRgba } = require(path.join(root, 'out', 'src', 'preview', 'slice.js'));
const { PNG } = require('pngjs');

const [deckPath, axis, offset, halfU, halfV, px, outPath, centerU, centerV] = process.argv.slice(2);
if (!outPath) {
    console.error('usage: render-slice.mjs <deck> <xy|xz|yz> <offset> <halfU> <halfV> <pixels> <out.png> [centerU centerV]');
    process.exit(2);
}

const text = fs.readFileSync(deckPath, 'utf8');
const ext = path.extname(deckPath).toLowerCase();
const language = ext === '.i' || ext === '.inp' || ext === '.mcnp' ? 'mcnp'
    : ext === '.sss' || ext === '.serp' ? 'serpent'
        : ext === '.scone' ? 'scone'
            : ext === '.xml' ? 'openmc' : 'mcnp';

const t0 = Date.now();
const model = parseDeckToModel(text, language);
if (!model) {
    console.error(`could not parse ${deckPath} as ${language}`);
    process.exit(1);
}

const hu = Number(halfU), hv = Number(halfV);
const width = Number(px);
const height = Math.round(width * (hv / hu));
const req = {
    plane: axisPlane(axis, Number(offset)),
    halfU: hu, halfV: hv,
    centerU: centerU !== undefined ? Number(centerU) : 0,
    centerV: centerV !== undefined ? Number(centerV) : 0,
    width, height,
    colorBy: 'material',
    samples: width * 2 >= hu ? 1 : 2,   // subsample when a pixel spans > ~0.5 cm
};
const result = sliceModel(model, req);
const rgba = sliceToRgba(result, { edges: true, edgeStrength: 0.45 });

const png = new PNG({ width: result.width, height: result.height });
Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength).copy(png.data);
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, PNG.sync.write(png));

const legend = result.legend
    .slice()
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)
    .map((l) => `${l.label || l.key}:${l.count}`)
    .join('  ');
console.log(`${path.basename(outPath)}  ${result.width}x${result.height}  ${Date.now() - t0} ms  lost=${result.lostCount} overlap=${result.overlapCount}`);
console.log(`  legend: ${legend}`);
