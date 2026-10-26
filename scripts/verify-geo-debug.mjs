/**
 * owen.preflightGeometry on the same decks the site gate uses, plus the
 * sphere and cylinder slice areas. command owen.preflightGeometry
 * command owen.renderCsg
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const assert = require('assert');
const { preflightMcnp, preflightPanel } = require('../out/src/mc/preflight.js');
const { parseMcnpGeometry } = require('../out/src/preview/mcnpGeometry.js');
const { sliceModel, axisPlane } = require('../out/src/preview/slice.js');

const SPHERE = `1 1 -1.0 -1 imp:n=1
2 0 1 imp:n=0

1 so 10

m1 92235.80c 1
ksrc 0 0 0
`;
const ON_SURFACE = SPHERE.replace('so 10', 'so 5').replace('ksrc 0 0 0', 'ksrc 5 0 0');
const OUTSIDE = SPHERE.replace('so 10', 'so 5').replace('ksrc 0 0 0', 'ksrc 9 0 0');
const NO_GRAVE = `1 1 -1.0 -1 imp:n=1

1 so 5

m1 92235.80c 1
ksrc 0 0 0
`;
const OVERLAP = `1 1 -1.0 -1 imp:n=1
2 1 -1.0 -2 imp:n=1
3 0 1 2 imp:n=0

1 so 5
2 so 5

m1 92235.80c 1
ksrc 0 0 0
`;
const GAP = `1 1 -1.0 -1 imp:n=1
2 0 2 imp:n=0

1 so 2
2 so 6

m1 92235.80c 1
ksrc 0 0 0
`;
const CYLINDER = `1 1 -1.0 -1 2 -3 imp:n=1
2 0 #1 imp:n=0

1 cz 2
2 pz -5
3 pz 5

m1 92235.80c 1
ksrc 0 0 0
`;

function codes(text) {
    return preflightMcnp(text, 1600, 4).map((issue) => issue.code);
}

assert.deepStrictEqual(codes(SPHERE), []);
assert.ok(preflightPanel([]).includes('sampled'));
assert.ok(codes(ON_SURFACE).includes('mcnp.ksrc-on-surface'));
assert.ok(codes(OUTSIDE).includes('mcnp.ksrc-outside'));
assert.ok(codes(NO_GRAVE).includes('mcnp.no-graveyard'));
assert.ok(codes(OVERLAP).includes('mcnp.overlap'));
assert.ok(codes(GAP).includes('mcnp.gap'));

function areaOf(text, axis, halfU, halfV) {
    const result = sliceModel(parseMcnpGeometry(text), {
        plane: axisPlane(axis, 0),
        halfU, halfV, width: 160, height: 160, colorBy: 'cell',
    });
    const entry = result.legend.find((item) => item.key === 1);
    return {
        area: (entry ? entry.count : 0) * result.cmPerPixel[0] * result.cmPerPixel[1],
        overlapCount: result.overlapCount,
    };
}

const disk = areaOf(SPHERE, 'xy', 14, 14);
const diskRel = Math.abs(disk.area - Math.PI * 100) / (Math.PI * 100);
console.log(`  sphere slice rel ${(diskRel * 100).toFixed(2)}%`);
assert.ok(diskRel <= 0.03, `sphere slice ${(diskRel * 100).toFixed(2)}%`);
assert.strictEqual(disk.overlapCount, 0);
const rect = areaOf(CYLINDER, 'xz', 6, 8);
const rectRel = Math.abs(rect.area - 40) / 40;
console.log(`  cylinder slice rel ${(rectRel * 100).toFixed(2)}%`);
assert.ok(rectRel <= 0.03, `cylinder slice ${(rectRel * 100).toFixed(2)}%`);
assert.strictEqual(rect.overlapCount, 0);
assert.ok(areaOf(OVERLAP, 'xy', 8, 8).overlapCount >= 100);

const { renderOrthographic, hitArea } = require('../out/src/mc/raycast.js');
const { runLanguageRules } = require('../out/src/language/rules.js');
const { remediateMcnp } = require('../out/src/converter/remediate.js');

function silhouette(text, camera, cellId) {
    return hitArea(renderOrthographic(parseMcnpGeometry(text), {
        ...camera, width: 64, height: 64, stepCm: 0.3, maxDistanceCm: 70,
    }), cellId);
}
const downZ = { origin: [0, 0, 30], viewDir: [0, 0, -1], uDir: [1, 0, 0], vDir: [0, 1, 0], halfU: 14, halfV: 14 };
const sphereArea = silhouette(SPHERE, downZ, 1);
const sphereRel = Math.abs(sphereArea - Math.PI * 100) / (Math.PI * 100);
console.log(`  ray sphere rel ${(sphereRel * 100).toFixed(2)}%`);
assert.ok(sphereRel <= 0.05, `ray sphere ${(sphereRel * 100).toFixed(2)}%`);

const BOX = `1 1 -1.0 -1 imp:n=1\n2 0 1 imp:n=0\n\n1 rpp -2 2 -3 3 -4 4\n\nm1 92235.80c 1\nksrc 0 0 0\n`;
const boxArea = silhouette(BOX, { origin: [0, 0, 20], viewDir: [0, 0, -1], uDir: [1, 0, 0], vDir: [0, 1, 0], halfU: 6, halfV: 8 }, 1);
assert.ok(Math.abs(boxArea - 24) / 24 <= 0.05, `rpp ${boxArea}`);
const RCC = `1 1 -1.0 -1 imp:n=1\n2 0 1 imp:n=0\n\n1 rcc 0 0 -5  0 0 10  2\n\nm1 92235.80c 1\nksrc 0 0 0\n`;
const cylArea = silhouette(RCC, { origin: [20, 0, 0], viewDir: [-1, 0, 0], uDir: [0, 1, 0], vDir: [0, 0, 1], halfU: 6, halfV: 8 }, 1);
assert.ok(Math.abs(cylArea - 40) / 40 <= 0.05, `rcc ${cylArea}`);

const rotated = '1 0 10 -11 12 -13 lat=1 imp:n=1\n';
assert.ok(runLanguageRules('mcnp', rotated).some((diag) => diag.code === 'mcnp.lattice-index-direction'));
const ordered = '1 0 -11 10 -13 12 lat=1 imp:n=1\n';
assert.ok(!runLanguageRules('mcnp', ordered).some((diag) => diag.code === 'mcnp.lattice-index-direction'));

const openCylinder = '1 1 -1.0 -1 imp:n=1\n2 0 1 imp:n=0\n\n1 cz 1\n\nf4:n 1\n';
assert.ok(remediateMcnp(openCylinder).refused.length > 0, 'an infinite cylinder must not get an invented sd');

console.log('verify:geo-debug OK');
