import * as assert from 'assert';
import { buildDeck, DEFAULT_SETTINGS } from '../../inputBuilder/deckBuilder';
import { MATERIAL_LIBRARY, renderMaterial } from '../../inputBuilder/materials';
import { defaultPinTypes, defaultStructuralIds } from '../../panels/latticeCodegen';

suite('Input Builder', () => {
    const baseMaterials = [
        { ...MATERIAL_LIBRARY.find((m) => m.id === 'uo2-3pct')!, mcnpNumber: 1 },
        { ...MATERIAL_LIBRARY.find((m) => m.id === 'zirc4')!, mcnpNumber: 2 },
        { ...MATERIAL_LIBRARY.find((m) => m.id === 'light-water')!, mcnpNumber: 3 },
    ];

    test('material library has at least 15 entries', () => {
        assert.ok(MATERIAL_LIBRARY.length >= 15, `expected >=15 materials, got ${MATERIAL_LIBRARY.length}`);
    });

    test('renderMaterial emits MCNP m cards with ZAIDs', () => {
        const code = renderMaterial('mcnp', baseMaterials[0]);
        // Rows follow the compendium's element order, so the m card opens on
        // oxygen; what matters is that it is one m card carrying the actinides
        // as weight fractions.
        assert.match(code, /^m1\s+\d{4,6}\.80c\s+-/m);
        assert.match(code, /92235\.80c\s+-0\.0264/);
        assert.match(code, /92238\.80c\s+-0\.85/);
    });

    test('renderMaterial emits OpenMC Material blocks', () => {
        const code = renderMaterial('openmc', baseMaterials[2]);
        assert.match(code, /openmc\.Material/);
        // Natural elements go in as elements so OpenMC expands them against
        // whichever library the user configured.
        assert.match(code, /add_element\('H', [\d.]+, percent_type='wo'\)/);
        assert.match(code, /add_s_alpha_beta\('c_H_in_H2O'\)/);
    });

    test('renderMaterial emits Serpent mat cards', () => {
        const code = renderMaterial('serpent', baseMaterials[1]);
        assert.match(code, /^% .+\nmat zirc4 -6\.56/m);
        assert.match(code, /^40090\.80c\s+-0\.49/m);
    });

    test('library cards are ASCII and fit a card image', () => {
        for (const entry of MATERIAL_LIBRARY) {
            for (const code of ['mcnp', 'serpent', 'scone'] as const) {
                const card = renderMaterial(code, { ...entry, mcnpNumber: 7 });
                for (const line of card.split('\n')) {
                    assert.ok(
                        !/[^\x20-\x7E\t]/.test(line),
                        `${entry.id} ${code}: non-ASCII in "${line}"`,
                    );
                    assert.ok(
                        line.length <= 80,
                        `${entry.id} ${code}: ${line.length} columns in "${line}"`,
                    );
                }
            }
        }
    });

    test('buildDeck MCNP pin-cell includes kcode and materials', () => {
        const deck = buildDeck({
            code: 'mcnp',
            title: 'test',
            materials: baseMaterials,
            geometryMode: 'pin-cell',
            lattice: null,
            settings: DEFAULT_SETTINGS,
        });
        assert.match(deck, /kcode 10000/);
        assert.match(deck, /^m1\s/m);
        assert.match(deck, /92235\.80c\s+-0\.0264/);
        assert.match(deck, /mt3\s+lwtr\.20t/);
    });

    test('buildDeck OpenMC lattice mode includes lattice generator output', () => {
        const n = 3;
        const lattice = {
            gridSize: n,
            pitch: 1.26,
            grid: Array.from({ length: n }, () => Array(n).fill(1)),
            pins: defaultPinTypes(),
            structural: defaultStructuralIds(),
        };
        const deck = buildDeck({
            code: 'openmc',
            title: 'lat test',
            materials: baseMaterials,
            geometryMode: 'lattice',
            lattice,
            settings: DEFAULT_SETTINGS,
        });
        assert.match(deck, /RectLattice|rectlattice|lattice/i);
        assert.match(deck, /model\.run\(\)/);
    });

    test('buildDeck Serpent includes set pop', () => {
        const deck = buildDeck({
            code: 'serpent',
            title: 's',
            materials: baseMaterials,
            geometryMode: 'pin-cell',
            lattice: null,
            settings: DEFAULT_SETTINGS,
        });
        assert.match(deck, /set pop 10000 50 200/);
    });

    test('buildDeck SCONE includes eigenPhysicsPackage', () => {
        const deck = buildDeck({
            code: 'scone',
            title: 's',
            materials: baseMaterials,
            geometryMode: 'pin-cell',
            lattice: null,
            settings: DEFAULT_SETTINGS,
        });
        assert.match(deck, /eigenPhysicsPackage/);
        assert.match(deck, /numActiveCycles 200/);
    });
});
