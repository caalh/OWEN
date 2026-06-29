import * as assert from 'assert';
import {
    supExp,
    logTickLabel,
    unifiedGrid,
    interpLogLog,
    buildPlotData,
} from '../../allen/plotConfig';

suite('ALLEN plotConfig', () => {
    test('supExp renders signed superscript exponents', () => {
        assert.strictEqual(supExp(0), '\u2070');
        assert.strictEqual(supExp(5), '\u2075');
        assert.strictEqual(supExp(-3), '\u207b\u00b3');
        assert.strictEqual(supExp(-15), '\u207b\u00b9\u2075');
    });

    test('logTickLabel labels only clean decades as powers of ten', () => {
        assert.strictEqual(logTickLabel(1e-5), '10\u207b\u2075');
        assert.strictEqual(logTickLabel(1), '10\u2070');
        assert.strictEqual(logTickLabel(1e7), '10\u2077');
        // Intermediate / minor splits get no label.
        assert.strictEqual(logTickLabel(3e3), '');
        assert.strictEqual(logTickLabel(0), '');
        assert.strictEqual(logTickLabel(-1), '');
    });

    test('unifiedGrid merges, sorts, de-dups and drops non-positive energies', () => {
        const grid = unifiedGrid([
            { E: [1e-5, 1, 2e7] },
            { E: [1, 10, 2e7] },
            { E: [0, -1, 5] },
        ]);
        assert.deepStrictEqual(grid, [1e-5, 1, 5, 10, 2e7]);
    });

    test('interpLogLog returns null outside a curve range (no edge cliff)', () => {
        const E = [1, 10, 100];
        const xs = [1, 10, 100];
        assert.strictEqual(interpLogLog(E, xs, 0.5), null);
        assert.strictEqual(interpLogLog(E, xs, 200), null);
    });

    test('interpLogLog recovers native points exactly and interpolates log-log', () => {
        const E = [1, 10, 100];
        const xs = [2, 20, 200];
        // Native points come back exactly.
        assert.ok(Math.abs((interpLogLog(E, xs, 1) ?? 0) - 2) < 1e-9);
        assert.ok(Math.abs((interpLogLog(E, xs, 100) ?? 0) - 200) < 1e-9);
        // A power-law curve interpolates exactly in log-log space.
        const mid = interpLogLog(E, xs, Math.sqrt(10)) ?? 0; // E = 10^0.5
        assert.ok(Math.abs(mid - 2 * Math.sqrt(10)) < 1e-6);
    });

    test('buildPlotData aligns every series to one grid with null padding', () => {
        const data = buildPlotData([
            { E: [1, 10, 100], xs: [1, 2, 3] },
            { E: [10, 100], xs: [5, 6] },
        ]);
        const [E, s1, s2] = data;
        assert.deepStrictEqual(E, [1, 10, 100]);
        assert.strictEqual(s1.length, 3);
        assert.strictEqual(s2.length, 3);
        // Second curve has no data below 10 eV -> null, no spurious zero.
        assert.strictEqual(s2[0], null);
        assert.ok(s2[1] != null && s2[2] != null);
    });
});
