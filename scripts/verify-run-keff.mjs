/**
 * owen.runKeff on a bare sphere. The number has to move when the radius
 * moves, and the disclaimer has to say the ZAIDs were not used.
 * command owen.runKeff
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const assert = require('assert');
const { KEFF_DISCLAIMER, runKeffOnText } = require('../out/src/mc/runKeff.js');

function deck(radius) {
    return `1 1 -1.0 -1 imp:n=1\n2 0 1 imp:n=0\n\n1 so ${radius}\n\nm1 92235.80c 1\n`;
}

assert.ok(KEFF_DISCLAIMER.includes('not the ZAIDs'), KEFF_DISCLAIMER);
assert.ok(!/VIII\.0/.test(KEFF_DISCLAIMER));

const big = runKeffOnText(deck(12));
const small = runKeffOnText(deck(4));
console.log(`  R=12 k=${big.k.toFixed(4)} ± ${big.sigma.toFixed(4)}`);
console.log(`  R=4  k=${small.k.toFixed(4)} ± ${small.sigma.toFixed(4)}`);
assert.ok(big.k > small.k + 0.2, `shrinking the sphere did not lower k (${big.k} -> ${small.k})`);
assert.ok(big.k < 1.2 && small.k > 0.1);

console.log('verify:run-keff OK');
