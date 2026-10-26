/**
 * A bare Godiva sphere converts without a TODO mark.
 * command owen.convertAndCompare
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const assert = require('assert');
const { conversionTodos } = require('../out/src/converter/conversionReport.js');

const deck = `1 1 -18.74 -1 imp:n=1
2 0 1 imp:n=0

1 so 8.7407

m1 92234 -0.0102 92235 -0.9371 92238 -0.0527
kcode 4000 1.0 10 30
ksrc 0 0 0
`;

const todos = conversionTodos(deck);
console.log(`  godiva todos ${todos.length}`);
assert.deepStrictEqual(todos, []);
console.log('verify:convert-compare OK');
