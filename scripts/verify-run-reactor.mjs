/**
 * owen.runReactor panel. A flat history reports k and says converged.
 * An entropy that is still moving withholds the headline k.
 * With no statepoint attached, the panel says so.
 * command owen.runReactor
 * command owen.renderCsg
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const assert = require('assert');
const { assessHistory, eigenvalueBalance, formatReactorPanel } = require('../out/src/mc/workbench.js');

function flat(n, inactive, center, wobble) {
    const mean = [];
    const entropy = [];
    for (let i = 0; i < n; i++) {
        const sign = i % 2 ? 1 : -1;
        mean.push(center + sign * wobble);
        entropy.push(5.5 + sign * 0.01);
    }
    return { mean, entropy, inactive };
}

const settled = assessHistory(flat(30, 10, 1.05, 0.0004));
assert.strictEqual(settled.verdict, 'converged');
assert.strictEqual(settled.reportK, true);
assert.ok(Math.abs(settled.k - 1.05) < 1e-9);
const panel = formatReactorPanel(settled, [{ name: 'absorption', mean: 1.2 }, { name: 'nu-fission', mean: 1.39 }]);
assert.match(panel, /k 1\.05000/);
assert.ok(panel.includes('converged'));
assert.ok(panel.includes('absorption') && panel.includes('nu-fission'));
assert.ok(panel.includes('withheld, not printed'));

const mean = [];
const entropy = [];
for (let i = 0; i < 40; i++) {
    const sign = i % 2 ? 0.01 : -0.01;
    mean.push(1.02 + sign);
    entropy.push((i < 15 ? 2 + i * 0.2 : 8) + sign);
}
const moving = assessHistory({ mean, entropy, inactive: 15 });
assert.strictEqual(moving.reportK, false);
assert.strictEqual(moving.k, null);
const movingPanel = formatReactorPanel(moving, []);
assert.ok(movingPanel.includes('Final k withheld'));
assert.ok(!/k \d+\.\d{5}/.test(movingPanel));
assert.ok(formatReactorPanel(null, []).includes('no OpenMC statepoint'));
assert.ok(eigenvalueBalance(1.16, 1, 0, 1.16) < 1e-12);

const { armOpenmcScript, parseBatchLine, launchBlocked, meshPeaksInside, DEPLETION_BLOCKED } = require('../out/src/mc/reactorLaunch.js');
const batch = parseBatchLine('       44/1    1.14415    4.58159    1.16145 +/- 0.00393');
assert.ok(batch && Math.abs(batch.entropy - 4.58159) < 1e-6 && Math.abs(batch.mean - 1.16145) < 1e-6);
assert.ok(launchBlocked(['mcnp.unbounded-tally']));
assert.strictEqual(launchBlocked([]), null);
assert.ok(DEPLETION_BLOCKED.includes('no chain file'));
const armed = armOpenmcScript("model = openmc.model.Model(geometry, materials, settings)\n\nif __name__ == '__main__':\n    model.export_to_model_xml()\n", '/home/me/.conda/envs/openmc/bin/openmc');
assert.ok(armed.includes('entropy_mesh') && armed.includes('owen-mesh') && armed.includes('REACTOR_JSON'));
assert.ok(!armed.includes('export_to_model_xml'));
assert.strictEqual(meshPeaksInside({ width: 4, height: 4, values: [[0, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] }), true);
assert.strictEqual(meshPeaksInside({ width: 4, height: 4, values: [[9, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] }), false);

console.log('verify:run-reactor OK');
