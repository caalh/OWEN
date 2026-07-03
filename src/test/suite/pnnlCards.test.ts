import * as assert from 'assert';
import {
    pnnlMcnpCard,
    pnnlOpenmcSnippet,
    pnnlSerpentCard,
    pnnlSconeEntry,
    pnnlZaidRows,
    pnnlSab,
    type PnnlMaterial,
} from '../../inputBuilder/pnnlCards';
import { loadPnnlDataset, searchPnnlMaterials, findPnnlMaterial } from '../../inputBuilder/pnnlData';
import { buildDeck, DEFAULT_SETTINGS } from '../../inputBuilder/deckBuilder';
import { renderMaterial } from '../../inputBuilder/materials';

suite('PNNL Compendium', () => {
    const dataset = loadPnnlDataset();

    const get = (id: string): PnnlMaterial => {
        const m = dataset?.materials.find((x) => x.id === id);
        assert.ok(m, `material ${id} present`);
        return m!;
    };

    test('bundled dataset loads with 411 materials', () => {
        assert.ok(dataset, 'dataset loads');
        assert.strictEqual(dataset!.materials.length, 411);
    });

    test('dataset sanity: densities positive, element wf sums to 1', () => {
        for (const m of dataset!.materials) {
            assert.ok(m.density > 0, `${m.id} density`);
            assert.ok(m.elements.length > 0, `${m.id} elements`);
            const wfSum = m.elements.reduce((s, e) => s + e.wf, 0);
            assert.ok(Math.abs(wfSum - 1) < 2e-3, `${m.id} wf sum ${wfSum}`);
        }
    });

    test('spot-check known materials against PNNL-15870 Rev. 2', () => {
        assert.strictEqual(get('water-liquid').density, 0.997);
        assert.strictEqual(get('concrete-portland').density, 2.3);
        assert.strictEqual(get('steel-stainless-304').density, 8.03);
        assert.strictEqual(get('uranium-dioxide').density, 10.96);
        assert.strictEqual(get('air-dry-near-sea-level').density, 0.001205);
        const h = get('water-liquid').elements.find((e) => e.sym === 'H')!;
        assert.ok(Math.abs(h.wf - 0.111902) < 1e-5, `water H wf ${h.wf}`);
    });

    test('carbon collapses to elemental 6000 (no isotopic C in ENDF/B-VII.1)', () => {
        const rows = pnnlZaidRows(get('carbon-graphite-reactor-grade'));
        const carbon = rows.filter((r) => r.zaid.startsWith('6'));
        assert.strictEqual(carbon.length, 1);
        assert.strictEqual(carbon[0].zaid, '6000');
    });

    test('MCNP: negative weight fractions; S(α,β) on water only, never fuel/metal', () => {
        const water = pnnlMcnpCard(get('water-liquid'), 5);
        assert.match(water, /1001\.80c\s+-0\.111872/);
        assert.match(water, /mt5\s+lwtr\.20t/);
        const ss = pnnlMcnpCard(get('steel-stainless-304'), 2);
        assert.ok(!ss.includes('mt2'), 'no S(α,β) on stainless');
        const uo2 = pnnlMcnpCard(get('uranium-dioxide'), 3);
        assert.ok(!uo2.includes('mt3'), 'no S(α,β) on fuel');
        assert.match(uo2, /92235\.80c\s+-0\.026444/);
    });

    test("OpenMC: add_element wo for natural, add_nuclide wo for custom isotopics", () => {
        const water = pnnlOpenmcSnippet(get('water-liquid'));
        assert.ok(water.includes("add_element('H', 0.111902, percent_type='wo')"), water);
        assert.ok(water.includes("add_s_alpha_beta('c_H_in_H2O')"));
        const uo2 = pnnlOpenmcSnippet(get('uranium-dioxide'));
        assert.ok(uo2.includes("add_nuclide('U235', 0.026444, percent_type='wo')"), uo2);
        assert.ok(uo2.includes("add_element('O', "), 'O stays elemental');
        assert.ok(!uo2.includes('add_s_alpha_beta'));
    });

    test('Serpent: negative density/fractions, moder+therm only for moderators', () => {
        const water = pnnlSerpentCard(get('water-liquid'));
        assert.ok(water.includes('mat water_liquid -0.997 moder lwtr 1001'), water.split('\n')[1]);
        assert.ok(water.includes('therm lwtr lwtr.20t'));
        const pb = pnnlSerpentCard(get('lead'));
        assert.ok(pb.includes('mat lead -11.35'));
        assert.ok(!pb.includes('moder') && !pb.includes('therm'));
    });

    test('SCONE: atom densities with .03 suffix matching temp 300', () => {
        const entry = pnnlSconeEntry(get('water-liquid'));
        assert.ok(entry.includes('temp 300;'));
        const m = entry.match(/1001\.03 ([0-9.e+-]+);/);
        assert.ok(m, entry);
        // PDF table: Water, Liquid H1 atom density = 0.066647 atoms/b-cm
        assert.ok(Math.abs(Number(m![1]) - 0.066647) / 0.066647 < 1e-4);
    });

    test('S(α,β) allow-list is exactly the hydrogenous moderators', () => {
        const allowed = new Set([
            'water-liquid', 'water-heavy', 'polyethylene-non-borated', 'polyethylene-borated',
        ]);
        for (const m of dataset!.materials) {
            if (pnnlSab(m)) {
                assert.ok(allowed.has(m.id), `unexpected S(α,β) on ${m.id}`);
            }
        }
    });

    test('all 411 materials render all four codes without undefined/NaN', () => {
        for (const m of dataset!.materials) {
            for (const text of [pnnlMcnpCard(m, 1), pnnlOpenmcSnippet(m), pnnlSerpentCard(m), pnnlSconeEntry(m)]) {
                assert.ok(text.length > 0, `${m.id} empty`);
                assert.ok(!text.includes('undefined'), `${m.id} undefined`);
                assert.ok(!text.includes('NaN'), `${m.id} NaN`);
            }
        }
    });

    test('search matches name, formula, and element symbol', () => {
        assert.ok(searchPnnlMaterials('water').some((r) => r.id === 'water-liquid'));
        assert.ok(searchPnnlMaterials('UO2').some((r) => r.id === 'uranium-dioxide'));
        assert.ok(searchPnnlMaterials('gd').length > 0, 'Gd element/name search');
        assert.strictEqual(searchPnnlMaterials('zzz-no-such-material').length, 0);
    });

    test('renderMaterial dispatches PNNL materials to compendium generators', () => {
        const mat = findPnnlMaterial('water-liquid')!;
        const selected = {
            id: mat.id,
            name: mat.name,
            category: 'PNNL compendium',
            density: mat.density,
            densityUnit: 'g/cm3' as const,
            description: 'PNNL-15870 Rev. 2',
            pnnl: mat,
            mcnpNumber: 7,
        };
        const mcnp = renderMaterial('mcnp', selected);
        assert.match(mcnp, /m7\s+1001\.80c\s+-0\.111872/);
        assert.match(mcnp, /mt7\s+lwtr\.20t/);
    });

    test('buildDeck integrates a PNNL material end-to-end (MCNP + OpenMC)', () => {
        const mat = findPnnlMaterial('concrete-portland')!;
        const selected = {
            id: mat.id,
            name: mat.name,
            category: 'PNNL compendium',
            density: mat.density,
            densityUnit: 'g/cm3' as const,
            description: 'PNNL-15870 Rev. 2',
            pnnl: mat,
            mcnpNumber: 1,
        };
        const mcnpDeck = buildDeck({
            code: 'mcnp', title: 'pnnl test', materials: [selected],
            geometryMode: 'pin-cell', lattice: null, settings: DEFAULT_SETTINGS,
        });
        assert.match(mcnpDeck, /PNNL-15870 Rev\. 2/);
        assert.match(mcnpDeck, /kcode/);
        const pyDeck = buildDeck({
            code: 'openmc', title: 'pnnl test', materials: [selected],
            geometryMode: 'pin-cell', lattice: null, settings: DEFAULT_SETTINGS,
        });
        assert.match(pyDeck, /mat_concrete_portland = openmc\.Material/);
        assert.match(pyDeck, /openmc\.Materials\(\[mat_concrete_portland\]\)/);
    });
});
