import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { PREBUILT_MODELS } from '../paths';
import { parseDeckToModel } from '../../preview/engineDispatch';
import { parseMcnpDeck } from '../../converter/mcnpModel';
import { checkGeometry, estimateVolumes, sdCards, universeWindow, volCard } from '../../geomcheck/core';
import { geometryCheckHtml, volumesHtml } from '../../geomcheck/report';

const CLEAN = [
    'Pin cell',
    '1 1 -10.4  -1     11 -12  imp:n=1',
    '2 2 -6.55   1 -2  11 -12  imp:n=1',
    '3 3 -0.74   2 -3  11 -12  imp:n=1',
    '4 0        (3:-11:12)     imp:n=0',
    '',
    '1 cz 0.4',
    '2 cz 0.5',
    '3 rpp -0.63 0.63 -0.63 0.63 -1000 1000',
    '11 pz 0',
    '12 pz 100',
    '',
    'mode n',
    'm1 92235.80c 1',
    'm2 40090.80c 1',
    'm3 1001.80c 2 8016.80c 1',
    'f4:n 1 2',
    'f7:n 1',
    'kcode 1000 1 10 50',
    'ksrc 0 0 50',
].join('\n');

// Clad ring written as `1 -2` but fuel written to r=0.45: 0.4–0.45 is claimed
// twice. And the water cell starts at surface 4 (r=0.55) leaving 0.5–0.55 to no one.
const BROKEN = [
    'Broken pin cell',
    '1 1 -10.4  -4     11 -12  imp:n=1  $ fuel out to 0.45 — overlaps clad',
    '2 2 -6.55   1 -2  11 -12  imp:n=1  $ clad 0.4–0.5',
    '3 3 -0.74   5 -3  11 -12  imp:n=1  $ water from 0.55 — gap 0.5–0.55',
    '9 0        (3:-11:12)     imp:n=0',
    '',
    '1 cz 0.4',
    '2 cz 0.5',
    '3 rpp -0.63 0.63 -0.63 0.63 -1000 1000',
    '4 cz 0.45',
    '5 cz 0.55',
    '11 pz 0',
    '12 pz 100',
    '',
    'mode n',
    'm1 92235.80c 1',
    'm2 40090.80c 1',
    'm3 1001.80c 2 8016.80c 1',
].join('\n');

suite('OWEN Geometry Check', () => {
    test('a clean pin cell reports no overlaps and no gaps', () => {
        const model = parseDeckToModel(CLEAN, 'mcnp')!;
        const r = checkGeometry(model, { samples: 4000, seed: 7 });
        assert.strictEqual(r.overlaps.length, 0);
        assert.strictEqual(r.universes[0].gapHits, 0);
        assert.strictEqual(r.world.lost, 0);
        assert.ok(r.notes[0].includes('No overlaps or gaps'));
    });

    test('an overlapping ring and a missing ring are both found, with the right cells', () => {
        const model = parseDeckToModel(BROKEN, 'mcnp')!;
        const r = checkGeometry(model, { samples: 6000, seed: 7 });
        assert.ok(r.overlaps.length >= 1, 'overlap expected');
        assert.deepStrictEqual([r.overlaps[0].a, r.overlaps[0].b], [1, 2], 'fuel (1) and clad (2) share 0.4–0.45');
        const rr = Math.sqrt(r.overlaps[0].example[0] ** 2 + r.overlaps[0].example[1] ** 2);
        assert.ok(rr > 0.4 - 1e-9 && rr < 0.45 + 1e-9, `example point should sit in the shared ring, r=${rr}`);
        const root = r.universes.find((u) => u.id === r.root)!;
        assert.ok(root.gapHits > 0, 'gap expected');
        const g = Math.sqrt(root.gapExample![0] ** 2 + root.gapExample![1] ** 2);
        assert.ok(g > 0.5 - 1e-9 && g < 0.55 + 1e-9, `gap example should sit in 0.5–0.55, r=${g}`);
        assert.ok(r.world.lost > 0, 'the full descent must also lose points in the gap');
    });

    test('the same seed gives the same answer', () => {
        const model = parseDeckToModel(BROKEN, 'mcnp')!;
        const a = checkGeometry(model, { samples: 2000, seed: 3 });
        const b = checkGeometry(model, { samples: 2000, seed: 3 });
        assert.strictEqual(a.overlaps[0].hits, b.overlaps[0].hits);
        assert.deepStrictEqual(a.universes[0].gapExample, b.universes[0].gapExample);
    });

    test('BEAVRS MCNP full core: no overlaps, no gaps, and every pin universe is windowed by its container', () => {
        const text = fs.readFileSync(path.join(PREBUILT_MODELS, 'beavrs_fullcore_mcnp.i'), 'utf8');
        const model = parseDeckToModel(text, 'mcnp')!;
        const r = checkGeometry(model, { samples: 1500, seed: 1 });
        assert.strictEqual(r.overlaps.length, 0, `overlaps: ${JSON.stringify(r.overlaps.slice(0, 3))}`);
        assert.strictEqual(r.universes.filter((u) => u.gapHits > 0).length, 0);
        assert.strictEqual(r.world.lost, 0);
        const w = universeWindow(model, 1);
        assert.deepStrictEqual(w.inherited, [false, false, true], 'fuel pin u=1 is infinite in z; height comes from its container');
        assert.ok(w.containers > 5 && w.extentVaries, 'u=1 is placed in axial segments of different heights');
        assert.ok(w.bounds.max[0] - w.bounds.min[0] < 1, 'radial window is the pin, not the core');
    });

    test('a lattice universe is judged by its window, not flagged as full of gaps', () => {
        const text = fs.readFileSync(path.join(PREBUILT_MODELS, 'assembly_17x17_mcnp.i'), 'utf8');
        const r = checkGeometry(parseDeckToModel(text, 'mcnp')!, { samples: 1000, seed: 1 });
        const lat = r.universes.find((u) => u.id === 10)!;
        assert.ok(lat.lattice);
        assert.strictEqual(lat.gapHits, 0);
    });
});

suite('OWEN Cell Volumes', () => {
    test('concentric spheres and coaxial annuli are integrated exactly, tiny cells included', () => {
        const xml = [
            '<geometry>',
            '  <cell id="1" material="1" region="-1"/>',
            '  <cell id="2" material="2" region="1 -2"/>',
            '  <cell id="3" material="3" region="2 -3"/>',
            '  <surface id="1" type="sphere" coeffs="0 0 0 0.0198"/>',
            '  <surface id="2" type="sphere" coeffs="0 0 0 0.0215"/>',
            '  <surface id="3" type="sphere" coeffs="0 0 0 700" boundary="vacuum"/>',
            '</geometry>',
        ].join('\n');
        const r = estimateVolumes(parseDeckToModel(xml, 'openmc')!, { samples: 2000, seed: 1 });
        const cells = r.universes[0].cells;
        const c1 = cells.find((c) => c.cell === 1)!, c2 = cells.find((c) => c.cell === 2)!;
        assert.strictEqual(c1.method, 'analytic');
        assert.ok(Math.abs(c1.volume! - (4 / 3) * Math.PI * 0.0198 ** 3) < 1e-12, `hotspot ${c1.volume}`);
        assert.ok(Math.abs(c2.volume! - (4 / 3) * Math.PI * (0.0215 ** 3 - 0.0198 ** 3)) < 1e-12);
        // Pin annuli: cz between pz planes.
        const pin = estimateVolumes(parseDeckToModel(CLEAN, 'mcnp')!, { samples: 1000, seed: 1 }).universes[0].cells;
        const clad = pin.find((c) => c.cell === 2)!;
        assert.strictEqual(clad.method, 'analytic');
        assert.ok(Math.abs(clad.volume! - Math.PI * (0.25 - 0.16) * 100) < 1e-9, `clad ${clad.volume}`);
        // The water cell (rpp body minus cylinder) is not a pure annulus: stochastic.
        assert.strictEqual(pin.find((c) => c.cell === 3)!.method, 'stochastic');
    });

    test('stochastic volumes agree with the analytic pin within a few sigma', () => {
        const model = parseDeckToModel(CLEAN, 'mcnp')!;
        const r = estimateVolumes(model, { samples: 60_000, seed: 11 });
        const root = r.universes[0];
        const fuel = root.cells.find((c) => c.cell === 1)!;
        const clad = root.cells.find((c) => c.cell === 2)!;
        const water = root.cells.find((c) => c.cell === 3)!;
        const grave = root.cells.find((c) => c.cell === 4)!;
        const exactFuel = Math.PI * 0.4 * 0.4 * 100;
        const exactClad = Math.PI * (0.5 * 0.5 - 0.4 * 0.4) * 100;
        const exactWater = 1.26 * 1.26 * 100 - Math.PI * 0.25 * 100;
        const within = (est: number, exact: number, rel: number) =>
            assert.ok(Math.abs(est - exact) / exact < 4 * rel + 0.002, `est ${est} vs ${exact} (1σ ${rel})`);
        // Fuel and clad are exact now; water (box minus cylinder) is the real stochastic check.
        assert.ok(water.method === 'stochastic' && water.hits > 0);
        within(fuel.volume!, exactFuel, fuel.relErr!);
        within(clad.volume!, exactClad, clad.relErr!);
        within(water.volume!, exactWater, water.relErr!);
        assert.ok(grave.unbounded, 'the graveyard reaches past the box');
        assert.strictEqual(grave.volume, null);
    });

    test('vol and sd cards: deck order, j for unbounded, wrapped under 80 columns', () => {
        const model = parseDeckToModel(CLEAN, 'mcnp')!;
        const r = estimateVolumes(model, { samples: 20_000, seed: 11 });
        const deck = parseMcnpDeck(CLEAN);
        const vol = volCard(deck.cells.map((c) => c.id), r);
        assert.ok(vol.startsWith('vol '), vol);
        const entries = vol.split(/\s+/).slice(1);
        assert.strictEqual(entries.length, 3, 'trailing j for the graveyard is dropped');
        for (const line of vol.split('\n')) assert.ok(line.length <= 80);
        const sd = sdCards(deck.settings.cellTallies, r);
        assert.strictEqual(sd.length, 2);
        assert.ok(sd[0].startsWith('sd4 ') && sd[0].split(/\s+/).length === 3, sd[0]);
        assert.ok(sd[1].startsWith('sd7 '), sd[1]);
    });

    test('a universe reused at different heights gets j, not a made-up number', () => {
        const text = fs.readFileSync(path.join(PREBUILT_MODELS, 'beavrs_fullcore_mcnp.i'), 'utf8');
        const model = parseDeckToModel(text, 'mcnp')!;
        const r = estimateVolumes(model, { samples: 500, seed: 1 });
        const u1 = r.universes.find((u) => u.id === 1)!;
        assert.ok(u1.extentVaries);
        const deck = parseMcnpDeck(text);
        const vol = volCard(deck.cells.map((c) => c.id), r);
        const entries = vol.replace(/\n\s+/g, ' ').split(/\s+/).slice(1);
        const idx = deck.cells.findIndex((c) => c.id === 1);
        assert.strictEqual(entries[idx], 'j', 'fuel cell 1 lives in u=1 whose instances differ in height');
    });

    test('a 2D deck with no axial planes refuses to invent volumes', () => {
        const flat = [
            'Infinite pin cell',
            '1 1 -10.4  -1              imp:n=1',
            '2 2 -6.55   1 -2           imp:n=1',
            '3 3 -0.74   2 -3 4 -5 6    imp:n=1',
            '4 0        (3:-4:5:-6)     imp:n=0',
            '',
            '1 cz 0.4',
            '2 cz 0.5',
            '*3 px 0.63',
            '*4 px -0.63',
            '*5 py 0.63',
            '*6 py -0.63',
            '',
            'mode n',
            'm1 92235.80c 1',
        ].join('\n');
        const model = parseDeckToModel(flat, 'mcnp')!;
        const r = estimateVolumes(model, { samples: 1000, seed: 1 });
        assert.ok(r.universes[0].skipped?.includes('unbounded along z'), r.universes[0].skipped);
    });

    test('Serpent decks get volumes too (names, no cards)', () => {
        const text = fs.readFileSync(path.join(PREBUILT_MODELS, 'pincell_serpent.sss'), 'utf8');
        const model = parseDeckToModel(text, 'serpent')!;
        const r = estimateVolumes(model, { samples: 5000, seed: 1 });
        const pin = r.universes.find((u) => u.id !== r.root)!;
        assert.ok(pin.inherited[2], 'pin height inherited from the root cell');
        assert.ok(pin.cells.some((c) => c.volume !== null && c.volume > 100));
    });

    test('report HTML is self-contained and names the cells', () => {
        const model = parseDeckToModel(BROKEN, 'mcnp')!;
        const chk = checkGeometry(model, { samples: 2000, seed: 7 });
        const html = geometryCheckHtml(chk, { fileName: 'broken.i', language: 'mcnp', origin: 'the deck' }, 'vscode-webview://x', 'N1');
        assert.ok(html.includes('Problems found'));
        assert.ok(html.includes('data-cell="1"') && html.includes('data-cell="2"'));
        assert.ok(!html.includes('unpkg'));
        const vol = estimateVolumes(model, { samples: 2000, seed: 7 });
        const vhtml = volumesHtml(vol, { fileName: 'broken.i', language: 'mcnp', origin: 'the deck', cards: { vol: 'vol 1 2', sd: [] } }, 'vscode-webview://x', 'N1');
        assert.ok(vhtml.includes('Insert vol card'));
        assert.ok(vhtml.includes('No F4/F6/F7'));
    });
});
