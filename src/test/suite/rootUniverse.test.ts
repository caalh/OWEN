/**
 * Shared world-universe picker. The 3D/2D engines used to hard-code
 * universe 0 (MCNP) and then special-case OpenMC's 1 — this file locks the
 * fill-graph rule so an unused pin universe, an OpenMC id other than 1, a
 * named Serpent universe, and a busier root next to an orphan all pick
 * correctly.
 */
import * as assert from 'assert';
import { pickRootId } from '../../preview/rootUniverse';

suite('pickRootId — world universe from the fill graph', () => {
    test('prefers 0 when it is an unfilled root (unused pin universe is not the world)', () => {
        const populated = [0, 1];
        const filled = new Set([1]);
        const n = (id: number) => (id === 0 ? 2 : 8);
        assert.strictEqual(pickRootId(populated, filled, n, 0), 0);
    });

    test('OpenMC-style live export: only universe 1 is populated', () => {
        assert.strictEqual(pickRootId([1], new Set<number>(), () => 4, 0), 1);
    });

    test('OpenMC-style: only universe 5 is populated (not a special-case of 1)', () => {
        assert.strictEqual(pickRootId([5], new Set<number>(), () => 3, 0), 5);
    });

    test('two unfilled universes: pick the one with more cells, not id 1', () => {
        const n = (id: number) => (id === 1 ? 1 : 6);
        assert.strictEqual(pickRootId([1, 2], new Set<number>(), n, 0), 2);
    });

    test('named Serpent universe is the unique root', () => {
        assert.strictEqual(
            pickRootId(['core'], new Set<string>(), () => 2, '0'),
            'core',
        );
    });

    test('Serpent universe 0 wins over an unused named pin universe', () => {
        assert.strictEqual(
            pickRootId(['0', 'pin1'], new Set(['pin1']), (id) => (id === '0' ? 2 : 4), '0'),
            '0',
        );
    });
});
