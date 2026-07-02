// Adversarial tests: MCNP reference index (src/references/mcnpReferences.ts).
import * as assert from 'assert';
import {
    buildMcnpReferenceIndex,
    getDefinition,
    getReferences,
    resolveAt,
    describeEntity,
    describeLattice,
} from '../../references/mcnpReferences';

suite('ADV MCNP references', () => {
    test('duplicate IDs across roles stay separate (cell 1, surface 1, material 1, universe 1)', () => {
        const deck = [
            '1 1 -10.4 -1 u=1 imp:n=1',
            '2 0 1 imp:n=0',
            '',
            '1 cz 0.41',
            '',
            'm1 92235.80c 0.05 92238.80c 0.95',
        ].join('\n');
        const idx = buildMcnpReferenceIndex(deck);
        assert.ok(getDefinition(idx, 'cell', 1), 'cell 1 def missing');
        assert.ok(getDefinition(idx, 'surface', 1), 'surface 1 def missing');
        assert.ok(getDefinition(idx, 'material', 1), 'material 1 def missing');
        assert.ok(getDefinition(idx, 'universe', 1), 'universe 1 def missing');
        // Surface refs must not bleed into material refs.
        const surfRefs = getReferences(idx, 'surface', 1, false);
        assert.ok(surfRefs.length >= 2, `expected surface 1 used in 2 cells, got ${surfRefs.length}`);
    });

    test('IDs inside fill arrays are recorded as universe references with counts', () => {
        const deck = [
            '101 1 -10.4 -1 u=1 imp:n=1',
            '500 0 -10 11 -12 13 lat=1 u=5 fill=-1:1 -1:1 0:0 1 1 1 1 0 1 1 1 1 imp:n=1',
            '900 0 -10 11 -12 13 fill=5 imp:n=1',
            '',
            '1 cz 0.41',
            '10 px 0.63',
            '11 px -0.63',
            '12 py 0.63',
            '13 py -0.63',
            'm1 92235.80c 1.0',
        ].join('\n');
        const idx = buildMcnpReferenceIndex(deck);
        assert.strictEqual(idx.lattices.length, 1);
        const lat = idx.lattices[0];
        assert.strictEqual(lat.nx, 3);
        assert.strictEqual(lat.ny, 3);
        assert.strictEqual(lat.universeCounts.get(1), 8, `u1 count: ${lat.universeCounts.get(1)}`);
        // 0 entries are background — must NOT be counted.
        assert.ok(!lat.universeCounts.has(0), 'background 0 counted as universe');
    });

    test('fill array with nR repeats expands counts correctly', () => {
        const deck = [
            '101 1 -10.4 -1 u=1 imp:n=1',
            '500 0 -10 11 -12 13 lat=1 u=5 fill=-8:8 -8:8 0:0 1 288r imp:n=1',
            '900 0 -10 11 -12 13 fill=5 imp:n=1',
            '1 cz 0.41',
            '10 px 0.63',
            'm1 92235.80c 1.0',
        ].join('\n');
        const idx = buildMcnpReferenceIndex(deck);
        assert.strictEqual(idx.lattices[0]?.universeCounts.get(1), 289);
    });

    test('negative surface senses resolve to positive surface ids', () => {
        const deck = [
            '10 1 -10.4 -1 2 -3 imp:n=1',
            '',
            '1 cz 0.41',
            '2 cz 0.30',
            '3 cz 0.62',
            'm1 92235.80c 1.0',
        ].join('\n');
        const idx = buildMcnpReferenceIndex(deck);
        for (const sid of [1, 2, 3]) {
            const refs = getReferences(idx, 'surface', sid, false);
            assert.strictEqual(refs.length, 1, `surface ${sid}: ${refs.length} refs`);
        }
    });

    test('# cell complements are NOT surface references', () => {
        const deck = [
            '10 1 -10.4 -1 #20 #(30) imp:n=1',
            '20 0 1 imp:n=0',
            '30 0 1 imp:n=0',
            '',
            '1 cz 0.41',
            '20 cz 5.0',
            '30 cz 6.0',
            'm1 92235.80c 1.0',
        ].join('\n');
        const idx = buildMcnpReferenceIndex(deck);
        // #20 / #(30) reference CELLS; they must not appear as surface refs.
        const s20 = getReferences(idx, 'surface', 20, false);
        const s30 = getReferences(idx, 'surface', 30, false);
        assert.strictEqual(s20.length + s30.length, 0,
            `complement leaked into surface refs: s20=${s20.length} s30=${s30.length}`);
    });

    test('data-card ranges/jumps (imp:n 1 22r) do not corrupt the index', () => {
        const deck = [
            '10 1 -10.4 -1 imp:n=1',
            '11 0 1 imp:n=0',
            '',
            '1 cz 0.41',
            '',
            'm1 92235.80c 1.0',
            'imp:n 1 22r 0',
        ].join('\n');
        const idx = buildMcnpReferenceIndex(deck);
        // The imp:n data card is 'other'; its numbers must not become refs.
        const cellDefs = [...idx.definitions.values()].filter((d) => d.kind === 'cell');
        assert.strictEqual(cellDefs.length, 2);
    });

    test('like n but cards do not crash the index', () => {
        const deck = [
            '10 1 -10.4 -1 u=1 imp:n=1',
            '20 like 10 but u=2',
            '',
            '1 cz 0.41',
            'm1 92235.80c 1.0',
        ].join('\n');
        const idx = buildMcnpReferenceIndex(deck);
        assert.ok(getDefinition(idx, 'cell', 10), 'cell 10 lost');
        // 'like' cards: at minimum should not produce garbage surface refs to id 10.
        assert.ok(idx.occurrences.length > 0);
    });

    test('resolveAt picks the most specific overlapping span', () => {
        const deck = [
            '10 1 -10.4 -1 imp:n=1',
            '1 cz 0.41',
            'm1 92235.80c 1.0',
        ].join('\n');
        const idx = buildMcnpReferenceIndex(deck);
        // Position on the "1" of "-1" (line 0). "-10.4" is density, not a surface.
        const line0 = '10 1 -10.4 -1 imp:n=1';
        const col = line0.indexOf('-1', 6) + 1;
        const occ = resolveAt(idx, 0, col);
        assert.ok(occ, 'no occurrence at surface ref');
        assert.strictEqual(occ!.kind, 'surface');
        assert.strictEqual(occ!.id, 1);
    });

    test('density is not misparsed as a surface reference', () => {
        const deck = [
            '10 1 -10.4 -1 imp:n=1',
            '1 cz 0.41',
            'm1 92235.80c 1.0',
        ].join('\n');
        const idx = buildMcnpReferenceIndex(deck);
        const s10 = getReferences(idx, 'surface', 10, false);
        // "-10.4" density must not create a surface-10 reference.
        assert.strictEqual(s10.length, 0, 'density -10.4 leaked as surface 10 ref');
    });

    test('tr / *tr transform cards define transforms; surfaces reference them', () => {
        const deck = [
            '10 1 -10.4 -1 trcl=3 imp:n=1',
            '',
            '1 1 cz 0.41',
            '*tr1 0 0 0 45 45 90',
            'tr3 1 2 3',
            'm1 92235.80c 1.0',
        ].join('\n');
        const idx = buildMcnpReferenceIndex(deck);
        assert.ok(getDefinition(idx, 'transform', 1), 'tr1 def missing');
        assert.ok(getDefinition(idx, 'transform', 3), 'tr3 def missing');
        const tr3refs = getReferences(idx, 'transform', 3, false);
        assert.ok(tr3refs.length >= 1, 'trcl=3 reference missing');
        const tr1refs = getReferences(idx, 'transform', 1, false);
        assert.ok(tr1refs.length >= 1, 'surface transform reference missing');
    });

    test('mt card references (not defines) material', () => {
        const deck = [
            'm3 1001.80c 2 8016.80c 1',
            'mt3 lwtr.20t',
        ].join('\n');
        const idx = buildMcnpReferenceIndex(deck);
        const refs = getReferences(idx, 'material', 3, false);
        assert.strictEqual(refs.length, 1, `mt3 should be 1 reference, got ${refs.length}`);
        const def = getDefinition(idx, 'material', 3);
        assert.ok(def && def.line === 0, 'm3 definition should be the m3 card');
    });

    test('describeEntity / describeLattice never throw on sparse indexes', () => {
        const idx = buildMcnpReferenceIndex('10 0 -1 imp:n=0\n1 cz 5');
        for (const occ of idx.occurrences) {
            assert.ok(typeof describeEntity(idx, occ) === 'string');
        }
        for (const lat of idx.lattices) {
            assert.ok(Array.isArray(describeLattice(idx, lat)));
        }
    });

    test('empty text and pathological whitespace', () => {
        for (const text of ['', '\n\n\n', '     \n\t\n', 'c pure comment deck\nc more']) {
            const idx = buildMcnpReferenceIndex(text);
            assert.strictEqual(idx.occurrences.length, 0);
        }
    });

    test('universe defined by first u= cell; lattice universes labelled', () => {
        const deck = [
            '101 1 -10.4 -1 u=1 imp:n=1',
            '500 0 -10 11 -12 13 lat=1 u=5 fill=0:0 0:0 0:0 1 imp:n=1',
            '900 0 -10 11 -12 13 fill=5 imp:n=1',
            '1 cz 0.41',
            '10 px 0.63',
            '11 px -0.63',
            '12 py 0.63',
            '13 py -0.63',
            'm1 92235.80c 0.05 92238.80c 0.95',
        ].join('\n');
        const idx = buildMcnpReferenceIndex(deck);
        const u5 = getDefinition(idx, 'universe', 5);
        assert.ok(u5 && /lattice/i.test(u5.summary), `u5 summary: ${u5?.summary}`);
        const u1 = getDefinition(idx, 'universe', 1);
        assert.ok(u1 && /fuel/i.test(u1.summary), `u1 summary: ${u1?.summary}`);
    });

    test('huge deck (5000 cells) indexes in reasonable time', function () {
        this.timeout(10000);
        const lines: string[] = [];
        for (let i = 1; i <= 5000; i++) lines.push(`${i} 1 -10.4 -${i} imp:n=1`);
        for (let i = 1; i <= 5000; i++) lines.push(`${i} cz ${(i * 0.001).toFixed(3)}`);
        lines.push('m1 92235.80c 1.0');
        const t0 = Date.now();
        const idx = buildMcnpReferenceIndex(lines.join('\n'));
        const dt = Date.now() - t0;
        assert.ok(idx.definitions.size >= 10000, `defs: ${idx.definitions.size}`);
        assert.ok(dt < 8000, `too slow: ${dt}ms`);
    });
});
