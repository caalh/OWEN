/**
 * Surface and card hovers. .80c is not described here at all: ZAID hovers
 * live in zaidHover.ts and already pin .80c to ENDF/B-VII.1.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const assert = require('assert');
const { cardFactMarkdown } = require('../out/src/language/cardFacts.js');

const so = cardFactMarkdown('so');
assert.ok(so && so.includes('Sphere') && so.includes('centimetres'), so);
assert.ok(cardFactMarkdown('RCC').includes('CYL'));
assert.ok(cardFactMarkdown('HEX').toLowerCase().includes('rhp'));
const imp = cardFactMarkdown('imp:n');
assert.ok(imp.includes('imp:n=0') && imp.includes('graveyard'), imp);
assert.strictEqual(cardFactMarkdown('92235.80c'), null);
assert.strictEqual(cardFactMarkdown('12.0'), null);

const facts = ['so', 's', 'cz', 'pz', 'rcc', 'rhp', 'hex', 'box', 'imp:n'].map(cardFactMarkdown).join('\n');
assert.ok(!/\.80c[^.\n]*VIII\.0/.test(facts), 'a card hover must not call .80c ENDF/B-VIII.0');

console.log('verify:card-facts OK');
