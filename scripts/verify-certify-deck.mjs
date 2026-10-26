/**
 * owen.certifyDeck. Godiva → OpenMC has no construct TODO. A hex lattice
 * and a trcl are visible TODOs, not silent drops. Serpent and SCONE rows
 * say they were not executed.
 * command owen.certifyDeck
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const assert = require('assert');
const { certifyMcnp, certifyPanel } = require('../out/src/converter/certifyDeck.js');

const GODIVA = `1 1 -18.74 -1 imp:n=1
2 0 1 imp:n=0

1 so 8.7407

m1 92234 -0.0102 92235 -0.9371 92238 -0.0527
kcode 4000 1.0 10 30
ksrc 0 0 0
`;
const HEX = `1 0 -1 lat=2 u=1 imp:n=1
2 0 1 imp:n=0

1 rhp 0 0 -1 0 0 2 1 0 0

kcode 1000 1.0 10 20
ksrc 0 0 0
`;
const TRCL = `1 1 -1.0 -1 imp:n=1 trcl=(0 0 1)
2 0 1 imp:n=0

1 so 5

m1 92235.80c 1
kcode 1000 1.0 10 20
ksrc 0 0 0
`;

const godiva = certifyMcnp(GODIVA);
const openmc = godiva.rows.find((row) => row.target === 'openmc');
assert.strictEqual(openmc.status, 'translated', openmc.todos.join(' | '));
assert.strictEqual(openmc.execution, 'skipped');

const hex = certifyMcnp(HEX);
for (const target of ['serpent', 'scone']) {
    const row = hex.rows.find((item) => item.target === target);
    assert.strictEqual(row.status, 'todo');
    assert.ok(row.todos.some((line) => /hexagonal lattice/i.test(line)), row.todos.join(' | '));
    assert.ok(row.executionReason.includes('not assumed installed'));
}

const trcl = certifyMcnp(TRCL).rows.find((row) => row.target === 'serpent');
assert.ok(trcl.todos.some((line) => /trcl/i.test(line)), trcl.todos.join(' | '));

const panel = certifyPanel(GODIVA);
assert.ok(panel.includes('does not run a code that is not installed'));
assert.ok(panel.includes('openmc: translated'));

const { mcnpToOpenmc } = require('../out/src/converter/mcnpToOpenmc.js');
const weight = mcnpToOpenmc('1 1 -18.74 -1 imp:n=1\n2 0 1 imp:n=0\n\n1 so 5\n\nm1 92235.80c -1\nkcode 1000 1.0 5 10\nksrc 0 0 0\n').output;
const atom = mcnpToOpenmc('1 1 -18.74 -1 imp:n=1\n2 0 1 imp:n=0\n\n1 so 5\n\nm1 92235.80c 1\nkcode 1000 1.0 5 10\nksrc 0 0 0\n').output;
assert.match(weight, /add_nuclide\('U235', [^,]+, 'wo'\)/);
assert.match(atom, /add_nuclide\('U235', [^,]+, 'ao'\)/);

console.log('verify:certify-deck OK');
