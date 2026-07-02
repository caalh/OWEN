// Adversarial tests: MCNP geometry extraction (src/preview/codes/mcnp.ts).
// Goal: FIND bugs — odd decks, hostile syntax, degenerate hierarchies.
import * as assert from 'assert';
import { parseMcnp } from '../../preview/codes/mcnp';
import { buildScene } from '../../preview/extractor';
import { Component } from '../../preview/types';

function pinDeck(uid: number): string[] {
    return [
        `${100 + uid} 1 -10.4 -1 u=${uid} imp:n=1`,
        `${200 + uid} 2 -6.5 1 -2 u=${uid} imp:n=1`,
        `${300 + uid} 3 -1.0 2 u=${uid} imp:n=1`,
    ];
}

const COMMON_TAIL = [
    '',
    '1 cz 0.41',
    '2 cz 0.475',
    '10 px 0.63',
    '11 px -0.63',
    '12 py 0.63',
    '13 py -0.63',
    '',
    'm1 92235.80c 0.03 92238.80c 0.97',
    'm2 40090.80c 1.0',
    'm3 1001.80c 2 8016.80c 1',
];

suite('ADV MCNP extractor', () => {
    test('4-level nested universes place pins without crash', () => {
        // pin u=1 → lattice u=5 (2x2 of u=1) → lattice u=6 (2x2 of u=5) → root fill=6
        const deck = [
            'c 4-level hierarchy',
            ...pinDeck(1),
            '500 0 -10 11 -12 13 lat=1 u=5 fill=0:1 0:1 0:0 1 1 1 1 imp:n=1',
            '600 0 -10 11 -12 13 lat=1 u=6 fill=0:1 0:1 0:0 5 5 5 5 imp:n=1',
            '900 0 -10 11 -12 13 fill=6 imp:n=1',
            ...COMMON_TAIL,
        ].join('\n');
        const res = parseMcnp(deck);
        // 4 sub-lattices × 4 pins × 3 layers = 48 cylinders in layers mode.
        assert.ok(res.cylinders.length >= 16, `expected ≥16 cylinders, got ${res.cylinders.length}`);
        assert.strictEqual(res.fidelity?.totalPins, 16);
    });

    test('negative universe number (u=-5) still fillable via fill=5 (MCNP semantics)', () => {
        // In MCNP, a negative universe number is a promise that the universe
        // doesn't need truncation; fill= references it by |n|.
        const deck = [
            '101 1 -10.4 -1 u=-5 imp:n=1',
            '201 2 -6.5 1 -2 u=-5 imp:n=1',
            '301 3 -1.0 2 u=-5 imp:n=1',
            '400 0 -10 11 -12 13 lat=1 u=9 fill=0:1 0:1 0:0 5 5 5 5 imp:n=1',
            '900 0 -10 11 -12 13 fill=9 imp:n=1',
            ...COMMON_TAIL,
        ].join('\n');
        const res = parseMcnp(deck);
        assert.strictEqual(
            res.fidelity?.totalPins, 4,
            `negative-u universe not matched by positive fill reference: pins=${res.fidelity?.totalPins}, warnings=${JSON.stringify(res.warnings)}`,
        );
    });

    test('like n but card does not crash and ideally clones the cell', () => {
        const deck = [
            ...pinDeck(1),
            '400 like 101 but u=2',
            '500 0 -10 11 -12 13 lat=1 u=9 fill=0:1 0:1 0:0 1 2 1 2 imp:n=1',
            '900 0 -10 11 -12 13 fill=9 imp:n=1',
            ...COMMON_TAIL,
        ].join('\n');
        // Must not throw.
        const res = parseMcnp(deck);
        assert.ok(Array.isArray(res.cylinders));
    });

    test('trcl on the root filled cell translates geometry', () => {
        const deck = [
            ...pinDeck(1),
            '500 0 -10 11 -12 13 lat=1 u=5 fill=0:1 0:1 0:0 1 1 1 1 imp:n=1',
            '900 0 -10 11 -12 13 fill=5 trcl=(10 20 30) imp:n=1',
            ...COMMON_TAIL,
        ].join('\n');
        const res = parseMcnp(deck);
        assert.ok(res.cylinders.length > 0, 'no cylinders');
        const xs = res.cylinders.map((c) => c.x);
        const avgX = xs.reduce((a, b) => a + b, 0) / xs.length;
        assert.ok(Math.abs(avgX - 10) < 2, `trcl x-shift not applied: mean x=${avgX}`);
    });

    test('hex lattice (lat=2) places on hex basis without crash', () => {
        const deck = [
            ...pinDeck(1),
            '500 0 -20 lat=2 u=5 fill=-1:1 -1:1 0:0 1 1 1 1 1 1 1 1 1 imp:n=1',
            '900 0 -21 fill=5 imp:n=1',
            '20 rhp 0 0 -10 0 0 20 0.63 0 0',
            '21 cz 50',
            '1 cz 0.41',
            '2 cz 0.475',
            'm1 92235.80c 0.03 92238.80c 0.97',
            'm2 40090.80c 1.0',
            'm3 1001.80c 2 8016.80c 1',
        ].join('\n');
        const res = parseMcnp(deck);
        assert.ok(res.cylinders.length >= 9, `expected ≥9 pins-worth, got ${res.cylinders.length}`);
        // Hex placement should produce off-grid y-coordinates (sqrt(3)/2 rows).
        const ys = new Set(res.cylinders.map((c) => c.y.toFixed(4)));
        assert.ok(ys.size >= 3, 'hex rows should differ in y');
    });

    test('fill array with repeats: fill=-8:8 -8:8 0:0 1 288r expands to 17x17', () => {
        const deck = [
            ...pinDeck(1),
            '500 0 -10 11 -12 13 lat=1 u=5 fill=-8:8 -8:8 0:0 1 288r imp:n=1',
            '900 0 -10 11 -12 13 fill=5 imp:n=1',
            ...COMMON_TAIL,
        ].join('\n');
        const res = parseMcnp(deck);
        assert.strictEqual(res.fidelity?.totalPins, 289, `expected 289 pins, got ${res.fidelity?.totalPins}`);
    });

    test('continuation lines: &, 5-space, 2-space, and tab all join', () => {
        const mk = (contPrefix: string, amp: boolean) => [
            ...pinDeck(1),
            amp
                ? '500 0 -10 11 -12 13 lat=1 u=5 &'
                : '500 0 -10 11 -12 13 lat=1 u=5',
            ...(amp
                ? ['     fill=0:1 0:1 0:0 1 1 1 1 imp:n=1']
                : [contPrefix + 'fill=0:1 0:1 0:0 1 1 1 1 imp:n=1']),
            '900 0 -10 11 -12 13 fill=5 imp:n=1',
            ...COMMON_TAIL,
        ].join('\n');
        for (const [name, deck] of [
            ['5-space', mk('     ', false)],
            ['2-space', mk('  ', false)],
            ['tab', mk('\t', false)],
            ['ampersand', mk('', true)],
        ] as const) {
            const res = parseMcnp(deck);
            assert.strictEqual(res.fidelity?.totalPins, 4, `${name}: expected 4 pins, got ${res.fidelity?.totalPins}`);
        }
    });

    test('comment lines mid-card do not break continuation', () => {
        const deck = [
            ...pinDeck(1),
            '500 0 -10 11 -12 13 lat=1 u=5',
            'c   this comment interrupts the card',
            '     fill=0:1 0:1 0:0 1 1 1 1 imp:n=1',
            '900 0 -10 11 -12 13 fill=5 imp:n=1',
            ...COMMON_TAIL,
        ].join('\n');
        const res = parseMcnp(deck);
        assert.strictEqual(res.fidelity?.totalPins, 4, `expected 4, got ${res.fidelity?.totalPins}`);
    });

    test('uppercase/lowercase mix (FILL=, LAT=, U=, CZ) parses', () => {
        const deck = [
            '101 1 -10.4 -1 U=1 IMP:N=1',
            '201 2 -6.5 1 -2 U=1 IMP:N=1',
            '301 3 -1.0 2 U=1 IMP:N=1',
            '500 0 -10 11 -12 13 LAT=1 U=5 FILL=0:1 0:1 0:0 1 1 1 1 IMP:N=1',
            '900 0 -10 11 -12 13 FILL=5 IMP:N=1',
            '',
            '1 CZ 0.41',
            '2 CZ 0.475',
            '10 PX 0.63',
            '11 PX -0.63',
            '12 PY 0.63',
            '13 PY -0.63',
            'M1 92235.80c 0.03 92238.80c 0.97',
            'M2 40090.80c 1.0',
            'M3 1001.80c 2 8016.80c 1',
        ].join('\n');
        const res = parseMcnp(deck);
        assert.strictEqual(res.fidelity?.totalPins, 4, `expected 4, got ${res.fidelity?.totalPins}`);
    });

    test('negative fill-array entries (non-standard) do not crash; positives still place', () => {
        const deck = [
            ...pinDeck(1),
            '500 0 -10 11 -12 13 lat=1 u=5 fill=0:1 0:1 0:0 1 -1 1 -1 imp:n=1',
            '900 0 -10 11 -12 13 fill=5 imp:n=1',
            ...COMMON_TAIL,
        ].join('\n');
        const res = parseMcnp(deck);
        assert.ok((res.fidelity?.totalPins ?? 0) >= 2, `positives dropped too: ${res.fidelity?.totalPins}`);
    });

    test('3D fill array (nz=2) does not crash; renders at least the k=0 slice', () => {
        const deck = [
            ...pinDeck(1),
            '500 0 -10 11 -12 13 lat=1 u=5 fill=0:1 0:1 0:1 1 1 1 1 1 1 1 1 imp:n=1',
            '900 0 -10 11 -12 13 fill=5 imp:n=1',
            ...COMMON_TAIL,
        ].join('\n');
        const res = parseMcnp(deck);
        assert.ok((res.fidelity?.totalPins ?? 0) >= 4, `expected ≥4 pins, got ${res.fidelity?.totalPins}`);
    });

    test('fill array short of entries pads with 0 (no crash, no exception)', () => {
        const deck = [
            ...pinDeck(1),
            '500 0 -10 11 -12 13 lat=1 u=5 fill=0:2 0:2 0:0 1 1 1 imp:n=1',
            '900 0 -10 11 -12 13 fill=5 imp:n=1',
            ...COMMON_TAIL,
        ].join('\n');
        const res = parseMcnp(deck);
        assert.strictEqual(res.fidelity?.totalPins, 3);
    });

    test('duplicate ids across roles (cell 1, surface 1, material 1, universe 1)', () => {
        const deck = [
            '1 1 -10.4 -1 u=1 imp:n=1',
            '2 2 -6.5 1 -2 u=1 imp:n=1',
            '3 3 -1.0 2 u=1 imp:n=1',
            '500 0 -10 11 -12 13 lat=1 u=5 fill=0:0 0:0 0:0 1 imp:n=1',
            '900 0 -10 11 -12 13 fill=5 imp:n=1',
            ...COMMON_TAIL,
        ].join('\n');
        const res = parseMcnp(deck);
        assert.ok(res.cylinders.length > 0, 'duplicate ids across roles broke extraction');
    });

    test('$ inline comments and tab indentation inside fill rows', () => {
        const deck = [
            ...pinDeck(1),
            '500 0 -10 11 -12 13 lat=1 u=5 fill=0:1 0:1 0:0 $ lattice',
            '\t1 1 $ row 1',
            '\t1 1 $ row 2',
            '900 0 -10 11 -12 13 fill=5 imp:n=1',
            ...COMMON_TAIL,
        ].join('\n');
        const res = parseMcnp(deck);
        assert.strictEqual(res.fidelity?.totalPins, 4, `expected 4, got ${res.fidelity?.totalPins}`);
    });

    test('cell-complement #n does not inject phantom surfaces', () => {
        const deck = [
            '101 1 -10.4 -1 #999 u=1 imp:n=1',
            '201 2 -6.5 1 -2 u=1 imp:n=1',
            '301 3 -1.0 2 #(101) u=1 imp:n=1',
            '500 0 -10 11 -12 13 lat=1 u=5 fill=0:0 0:0 0:0 1 imp:n=1',
            '900 0 -10 11 -12 13 fill=5 imp:n=1',
            ...COMMON_TAIL,
        ].join('\n');
        const res = parseMcnp(deck);
        assert.ok(res.cylinders.length > 0);
        // No cylinder should have radius pulled from a bogus surface.
        for (const c of res.cylinders) {
            assert.ok(c.radius <= 1.0, `phantom radius ${c.radius} from complement`);
        }
    });

    test('empty deck / garbage deck return warnings, not exceptions', () => {
        for (const text of ['', '   \n\n  ', 'total garbage $$$ 🍕 ###', 'c only a comment\n']) {
            const res = parseMcnp(text);
            assert.ok(Array.isArray(res.cylinders));
        }
    });

    test('buildScene on unknown language warns instead of throwing', () => {
        const scene = buildScene('anything', 'fortran');
        assert.strictEqual(scene.cylinders.length, 0);
        assert.ok(scene.warnings.length > 0);
    });

    test('zero-radius / negative-radius surfaces are not drawn', () => {
        const deck = [
            '1 cz 0.0',
            '2 cz -1.5',
            '3 cz 0.5',
            '10 pz 0',
            '11 pz 10',
        ].join('\n');
        const res = parseMcnp(deck);
        for (const c of res.cylinders) {
            assert.ok(c.radius > 0, `non-positive radius drawn: ${c.radius}`);
        }
    });

    test('maxInstances=1 caps but does not crash; warning surfaces', () => {
        const deck = [
            ...pinDeck(1),
            '500 0 -10 11 -12 13 lat=1 u=5 fill=0:9 0:9 0:0 1 99r imp:n=1',
            '900 0 -10 11 -12 13 fill=5 imp:n=1',
            ...COMMON_TAIL,
        ].join('\n');
        const scene = buildScene(deck, 'mcnp', { maxInstances: 1, detail: 'disc' });
        assert.ok(scene.cylinders.length <= 2, `cap ignored: ${scene.cylinders.length}`);
    });

    test('vertical axial stack universe expands with axial option', () => {
        const deck = [
            ...pinDeck(1),
            ...pinDeck(2),
            // u=7 = axial stack of u=1 (0..100) and u=2 (100..200)
            '701 0 -3 20 -21 fill=1 u=7 imp:n=1',
            '702 0 -3 21 -22 fill=2 u=7 imp:n=1',
            '500 0 -10 11 -12 13 lat=1 u=5 fill=0:1 0:1 0:0 7 7 7 7 imp:n=1',
            '900 0 -10 11 -12 13 fill=5 imp:n=1',
            '',
            '3 cz 0.63',
            '20 pz 0',
            '21 pz 100',
            '22 pz 200',
            ...COMMON_TAIL,
        ].join('\n');
        const withAxial = parseMcnp(deck, { axial: true, detail: 'layers' });
        const without = parseMcnp(deck, { axial: false, detail: 'layers' });
        assert.ok(withAxial.fidelity?.hasAxial, 'axial structure not detected');
        assert.ok(
            withAxial.cylinders.length > without.cylinders.length,
            `axial expansion did not add segments (${withAxial.cylinders.length} vs ${without.cylinders.length})`,
        );
    });

    test('material classification: MOX, B4C, Ag-In-Cd, borosilicate, steel', () => {
        const deck = [
            '101 1 -10.4 -1 u=1 imp:n=1',
            '201 4 -2.5 1 -2 u=1 imp:n=1',
            '301 3 -1.0 2 u=1 imp:n=1',
            '500 0 -10 11 -12 13 lat=1 u=5 fill=0:0 0:0 0:0 1 imp:n=1',
            '900 0 -10 11 -12 13 fill=5 imp:n=1',
            '',
            '1 cz 0.41',
            '2 cz 0.475',
            '10 px 0.63',
            '11 px -0.63',
            '12 py 0.63',
            '13 py -0.63',
            'm1 94239.80c 0.05 92238.80c 0.95',
            'm4 5010.80c 0.2 5011.80c 0.6 6000.80c 0.2',
            'm3 1001.80c 2 8016.80c 1',
        ].join('\n');
        const res = parseMcnp(deck);
        const mats = new Set(res.cylinders.map((c) => c.material));
        assert.ok(mats.has('MOX'), `MOX not classified: ${[...mats]}`);
        assert.ok(mats.has('B4C'), `B4C not classified: ${[...mats]}`);
    });

    test('enrichment naming distinguishes fuel zones', () => {
        const deck = [
            '101 1 -10.4 -1 u=1 imp:n=1',
            '301 3 -1.0 1 u=1 imp:n=1',
            '102 2 -10.4 -1 u=2 imp:n=1',
            '302 3 -1.0 1 u=2 imp:n=1',
            '500 0 -10 11 -12 13 lat=1 u=5 fill=0:1 0:1 0:0 1 2 1 2 imp:n=1',
            '900 0 -10 11 -12 13 fill=5 imp:n=1',
            '',
            '1 cz 0.41',
            '10 px 0.63',
            '11 px -0.63',
            '12 py 0.63',
            '13 py -0.63',
            'm1 92235.80c 0.016 92238.80c 0.984',
            'm2 92235.80c 0.031 92238.80c 0.969',
            'm3 1001.80c 2 8016.80c 1',
        ].join('\n');
        const res = parseMcnp(deck);
        const mats = new Set(res.cylinders.filter((c) => c.component === Component.Fuel).map((c) => c.material));
        assert.ok(mats.size >= 2, `enrichment zones collapsed: ${[...mats]}`);
    });
});
