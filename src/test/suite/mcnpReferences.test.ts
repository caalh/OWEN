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

// ---------------------------------------------------------------------------
// Role disambiguation: a deck where the SAME digit (3) is, at once, a cell id,
// a material number, a surface id, and a universe id. A naive "find every 3"
// tracker would return one merged set for all of them; a role-aware tracker
// must keep four distinct reference sets.
// ---------------------------------------------------------------------------
const DISAMBIG_DECK = [
    'c the digit 3 is simultaneously cell, material, surface and universe',
    '3 3 -10.0 -3 u=3 imp:n=1   $ cell 3, mat 3, surf 3, universe 3',
    '7 3 -10.0 -3 u=7 imp:n=1   $ cell 7 also uses material 3 and surface 3',
    '',
    '3 cz 0.5',
    '',
    'm3 1001.80c 2.0 8016.80c 1.0',
    'mt3 lwtr.20t',
    'mode n',
].join('\n');

suite('OWEN MCNP reference tracker — role disambiguation', () => {
    test('the digit 3 resolves to four DISTINCT entities by role, not one merged set', () => {
        const index = buildMcnpReferenceIndex(DISAMBIG_DECK);
        // cell 3: only its own definition (1 occurrence).
        assert.strictEqual(getReferences(index, 'cell', 3, true).length, 1, 'cell 3 set');
        // material 3: m3 definition + 2 cell uses + 1 mt3 data-card reference = 4.
        assert.strictEqual(getReferences(index, 'material', 3, true).length, 4, 'material 3 set');
        // surface 3: its definition + 2 cell-geometry uses = 3.
        assert.strictEqual(getReferences(index, 'surface', 3, true).length, 3, 'surface 3 set');
        // universe 3: declared on cell 3 only = 1.
        assert.strictEqual(getReferences(index, 'universe', 3, true).length, 1, 'universe 3 set');
        // The four sets must not be the same size — proof they are not merged.
        const sizes = new Set([
            getReferences(index, 'cell', 3, true).length,
            getReferences(index, 'material', 3, true).length,
            getReferences(index, 'surface', 3, true).length,
        ]);
        assert.ok(sizes.size >= 2, 'role sets collapsed to a single size (naive matching)');
    });

    test('hovering each 3 picks the right role by column position', () => {
        const index = buildMcnpReferenceIndex(DISAMBIG_DECK);
        const lines = DISAMBIG_DECK.split('\n');
        const cellLine = lines.findIndex((l) => l.startsWith('3 3 -10.0'));
        // col 0 = cell id, col 2 = material number, the "-3" = surface, "u=3" = universe.
        assert.strictEqual(resolveAt(index, cellLine, 0)!.kind, 'cell');
        assert.strictEqual(resolveAt(index, cellLine, 2)!.kind, 'material');
        const surfCol = lines[cellLine].indexOf(' -3') + 2; // the digit of "-3"
        assert.strictEqual(resolveAt(index, cellLine, surfCol)!.kind, 'surface');
        const uCol = lines[cellLine].indexOf('u=3') + 2; // the digit after "u="
        const uOcc = resolveAt(index, cellLine, uCol);
        assert.strictEqual(uOcc!.kind, 'universe');
        assert.strictEqual(uOcc!.id, 3);
    });

    test('clicking surface 3 does NOT return material/cell/universe 3', () => {
        const index = buildMcnpReferenceIndex(DISAMBIG_DECK);
        const surfRefs = getReferences(index, 'surface', 3, true);
        // Every returned occurrence must itself be a surface occurrence.
        assert.ok(surfRefs.every((o) => o.kind === 'surface'), 'surface refs contain a non-surface');
    });

    test('mt{n} data card resolves to its material, not a surface or digit', () => {
        const index = buildMcnpReferenceIndex(DISAMBIG_DECK);
        const lines = DISAMBIG_DECK.split('\n');
        const mtLine = lines.findIndex((l) => l.startsWith('mt3'));
        const occ = resolveAt(index, mtLine, 2); // the "3" in "mt3"
        assert.ok(occ, 'expected an occurrence on the mt3 number');
        assert.strictEqual(occ!.kind, 'material');
        assert.strictEqual(occ!.id, 3);
        assert.strictEqual(occ!.isDefinition, false, 'mt3 references material 3, not defines it');
    });
});

// ---------------------------------------------------------------------------
// Coordinate transforms: trcl= on a cell, the optional transform field on a
// surface card, and the tr{n} definition card must all resolve to one transform
// entity — and must NOT be misread as surface ids.
// ---------------------------------------------------------------------------
const TRANSFORM_DECK = [
    'c transform cross-referencing',
    '1 1 -10 -1 trcl=5 imp:n=1',
    '2 0 1 -2 imp:n=1',
    '',
    '1 5 cz 0.5',
    '2 cz 1.0',
    '',
    'tr5 0 0 10',
    'm1 92235.80c 1.0',
    'mode n',
].join('\n');

suite('OWEN MCNP reference tracker — transforms', () => {
    test('trcl=, the surface transform field, and tr5 all resolve to transform 5', () => {
        const index = buildMcnpReferenceIndex(TRANSFORM_DECK);
        const refs = getReferences(index, 'transform', 5, true);
        // tr5 definition + cell trcl= + surface transform field = 3.
        assert.strictEqual(refs.length, 3, `expected 3 transform-5 occurrences, got ${refs.length}`);
        assert.strictEqual(refs.filter((r) => r.isDefinition).length, 1, 'exactly one tr definition');
    });

    test('a surface card transform field is not mistaken for a surface id', () => {
        const index = buildMcnpReferenceIndex(TRANSFORM_DECK);
        // "1 5 cz 0.5": surface id is 1, transform is 5 — there is no surface 5.
        assert.ok(getDefinition(index, 'surface', 1), 'surface 1 should be defined');
        assert.strictEqual(getDefinition(index, 'surface', 5), undefined, 'no surface 5 should exist');
        assert.match(getDefinition(index, 'surface', 1)!.summary, /cz/);
    });

    test('the trcl number is not double-counted as a geometry surface', () => {
        const index = buildMcnpReferenceIndex(TRANSFORM_DECK);
        // Cell 1 geometry references only surface 1, not surface 5 (the trcl arg).
        const surf5 = getReferences(index, 'surface', 5, true);
        assert.strictEqual(surf5.length, 0, 'surface 5 should have no occurrences');
    });
});
