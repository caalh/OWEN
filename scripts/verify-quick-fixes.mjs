/**
 * Quick fixes must correct the card and must refuse a criticality request.
 * They must not drop a line of the deck in order to silence a warning.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const assert = require('assert');
const { importanceFix, remediationFix, replaceOpenmcSource } = require('../out/src/language/quickFixes.js');

const cell = importanceFix('1 1 -1.0 -1');
assert.ok(cell && cell.includes('imp:n=1') && cell.includes('-1.0'), cell);
assert.strictEqual(importanceFix('2 0 1'), '2 0 1 imp:n=0');
assert.strictEqual(importanceFix('1 1 -1.0 -1 imp:n=1'), null);
assert.strictEqual(importanceFix('     1 1 1 1'), null);

const sphere = 'c bare sphere, no graveyard\n1 1 -18.74 -1 imp:n=1\n\n1 so 8.0\n\nm1 92235.80c 1\nkcode 1000 1.0 5 20\nksrc 0 0 0\n';
const repair = remediationFix(sphere);
assert.ok(repair, 'a bare sphere with no graveyard should be repairable');
assert.ok(repair.output.includes('1 1 -18.74 -1 imp:n=1'), 'the fuel cell must stay');
assert.ok(repair.output.includes('imp:n=0'), repair.output);

const critical = 'c owen-remediate: make critical\n' + sphere;
assert.strictEqual(remediationFix(critical), null, 'a criticality request must not be edited');

const source = 'openmc.Source(space=box)\nopenmc.IndependentSource(space=box)\n';
const replaced = replaceOpenmcSource(source);
assert.strictEqual(replaced.match(/openmc\.IndependentSource\(/g).length, 2);
assert.ok(!replaced.includes('openmc.Source('));

console.log('verify:quick-fixes OK');
