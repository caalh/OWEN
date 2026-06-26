import * as assert from 'assert';
import {
    buildMcnpReferenceIndex,
    resolveAt,
    getDefinition,
    getReferences,
} from '../../references/mcnpReferences';

// A compact 3×3 PWR-style lattice: fuel (u=1) + guide tube (u=2), placed by a
// lat=1 fill array in cell 10, wrapped by the root fill cell 20.
const LATTICE_DECK = [
    'c mini lattice deck',
    '1 1 -10.4 -1    u=1 imp:n=1   $ fuel pellet',
    '2 2 -6.5   1 -2 u=1 imp:n=1   $ clad',
    '3 3 -0.7   2    u=1 imp:n=1   $ water',
    '4 3 -0.7  -3    u=2 imp:n=1   $ guide-tube water',
    '5 2 -6.5   3 -4 u=2 imp:n=1   $ guide tube',
    '6 3 -0.7   4    u=2 imp:n=1',
    '10 0 50 -51 52 -53 lat=1 u=10 imp:n=1',
    '     fill=0:2 0:2 0:0',
    '     1 2 1',
    '     2 1 2',
    '     1 2 1',
    '20 0 -60 fill=10 imp:n=1',
    '21 0  60 imp:n=0',
    '',
    '1 cz 0.40',
    '2 cz 0.46',
    '3 cz 0.56',
    '4 cz 0.60',
    '50 px -0.63',
    '51 px  0.63',
    '52 py -0.63',
    '53 py  0.63',
    '60 rpp -1.89 1.89 -1.89 1.89 -10 10',
    '',
    'm1 92235.80c 0.04 92238.80c 0.96 8016.80c 2.0',
    'm2 40090.80c 1.0',
    'm3 1001.80c 2.0 8016.80c 1.0',
    'mode n',
].join('\n');

suite('OWEN MCNP reference tracker', () => {
    test('decodes the lattice fill array into per-universe counts', () => {
        const index = buildMcnpReferenceIndex(LATTICE_DECK);
        assert.strictEqual(index.lattices.length, 1, 'expected one lattice');
        const lat = index.lattices[0];
        assert.strictEqual(lat.cellId, 10);
        assert.strictEqual(lat.lat, 1);
        assert.strictEqual(lat.nx, 3);
        assert.strictEqual(lat.ny, 3);
        // 3x3 = 9 entries: 5 of universe 1 (fuel), 4 of universe 2 (guide).
        assert.strictEqual(lat.universeCounts.get(1), 5, `expected 5 fuel positions, got ${lat.universeCounts.get(1)}`);
        assert.strictEqual(lat.universeCounts.get(2), 4, `expected 4 guide positions, got ${lat.universeCounts.get(2)}`);
    });

    test('reports the unit-cell bounding surfaces of the lattice', () => {
        const index = buildMcnpReferenceIndex(LATTICE_DECK);
        const lat = index.lattices[0];
        for (const sid of [50, 51, 52, 53]) {
            assert.ok(lat.boundingSurfaces.includes(sid), `expected surface ${sid} to bound the lattice unit cell`);
        }
        assert.ok(!lat.boundingSurfaces.includes(60), 'the wrapper surface 60 is not a unit-cell bound');
    });

    test('maps a universe to its definition line', () => {
        const index = buildMcnpReferenceIndex(LATTICE_DECK);
        const u1 = getDefinition(index, 'universe', 1);
        assert.ok(u1, 'expected universe 1 to be defined');
        // Universe 1 is first declared on cell 1 (line index 1 = the second line).
        assert.strictEqual(u1!.line, 1, `expected universe 1 defined on line index 1, got ${u1!.line}`);
        assert.strictEqual(u1!.summary, 'fuel pin', `expected fuel-pin role, got ${u1!.summary}`);
        const u2 = getDefinition(index, 'universe', 2);
        assert.strictEqual(u2!.summary, 'guide tube', `expected guide-tube role, got ${u2!.summary}`);
    });

    test('resolves a fill-array entry to universe and finds its definition', () => {
        const index = buildMcnpReferenceIndex(LATTICE_DECK);
        // The first fill row "1 2 1" is line index 8 (0-based).
        const lineIdx = LATTICE_DECK.split('\n').indexOf('     1 2 1');
        // The "2" in that row sits after "     1 " → column 7.
        const occ = resolveAt(index, lineIdx, 7);
        assert.ok(occ, 'expected to resolve an occurrence at the fill-array entry');
        assert.strictEqual(occ!.kind, 'universe');
        assert.strictEqual(occ!.id, 2);
        assert.strictEqual(occ!.isDefinition, false, 'a fill entry is a reference, not a definition');
    });

    test('classifies material definitions by ZAID (UO2 / Zircaloy / Water)', () => {
        const index = buildMcnpReferenceIndex(LATTICE_DECK);
        assert.match(getDefinition(index, 'material', 1)!.summary, /UO2/);
        assert.strictEqual(getDefinition(index, 'material', 2)!.summary, 'Zircaloy');
        assert.strictEqual(getDefinition(index, 'material', 3)!.summary, 'Water');
    });

    test('hovering a surface id in cell geometry resolves to the surface', () => {
        const index = buildMcnpReferenceIndex(LATTICE_DECK);
        // Cell 2: "2 2 -6.5   1 -2 u=1 ..." — the geometry refs surfaces 1 and 2.
        const lineIdx = LATTICE_DECK.split('\n').findIndex((l) => l.startsWith('2 2 -6.5'));
        const line = LATTICE_DECK.split('\n')[lineIdx];
        const col = line.indexOf(' -2') + 1; // the "-2" surface reference
        const occ = resolveAt(index, lineIdx, col + 1);
        assert.ok(occ, 'expected an occurrence on the surface reference');
        assert.strictEqual(occ!.kind, 'surface');
        assert.strictEqual(occ!.id, 2);
    });

    test('find-all-references on universe 2 returns its cells and fill uses', () => {
        const index = buildMcnpReferenceIndex(LATTICE_DECK);
        const refs = getReferences(index, 'universe', 2, true);
        // u=2 on cells 4,5,6 (3) + 4 fill-array entries = 7 occurrences.
        assert.strictEqual(refs.length, 7, `expected 7 universe-2 occurrences, got ${refs.length}`);
        const defs = refs.filter((r) => r.isDefinition);
        assert.strictEqual(defs.length, 1, 'exactly one of them is the definition');
    });

    test('material reference count tracks how many cells use a material', () => {
        const index = buildMcnpReferenceIndex(LATTICE_DECK);
        // Material 3 (water) is used by cells 3, 4, 6 → 3 references.
        const refs = getReferences(index, 'material', 3, false);
        assert.strictEqual(refs.length, 3, `expected 3 water references, got ${refs.length}`);
    });
});
