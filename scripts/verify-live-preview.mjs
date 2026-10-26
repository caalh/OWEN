/**
 * The geometry preview rebuilds from the editor text, and the scene follows
 * the radius. A bad cell is whatever buildScene already warns about; this
 * check does not invent a second classifier.
 */
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const assert = require('assert');

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'src', 'preview', 'webview.ts'), 'utf8');
assert.ok(src.includes('onDidChangeTextDocument'), 'preview does not listen for edits');
assert.ok(src.includes('rebuildScene()'), 'preview edit listener does not rebuild');

const { buildScene } = require('../out/src/preview/extractor.js');

function deck(radius) {
    return `1 1 -1.0 -1 imp:n=1\n2 0 1 imp:n=0\n\n1 so ${radius}\n`;
}
const big = buildScene(deck(12), 'mcnp');
const small = buildScene(deck(4), 'mcnp');
const radiusOf = (scene) => {
    const cyl = (scene.cylinders || []).find((item) => typeof item.radius === 'number');
    return cyl ? cyl.radius : null;
};
const rb = radiusOf(big);
const rs = radiusOf(small);
console.log(`  preview radius ${rb} -> ${rs}`);
assert.ok(rb && rs && rs < rb, `preview radius did not follow the deck (${rb} -> ${rs})`);

console.log('verify:live-preview OK');
