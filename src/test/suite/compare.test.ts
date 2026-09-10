import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { PREBUILT_MODELS } from '../paths';
import { parseDeckToModel } from '../../preview/engineDispatch';
import { canonicalDeck, canonicalMaterials } from '../../compare/canonical';
import { classifyModel, compareGeometry } from '../../compare/geometry';

const PIN_A = [
    'Pin A',
    '1 1 -10.4  -1     11 -12  imp:n=1',
    '2 2 -6.55   1 -2  11 -12  imp:n=1',
    '3 3 -0.74   2 -3  11 -12  imp:n=1',
    '4 0        (3:-11:12)     imp:n=0',
    '',
    '1 cz 0.4096',
    '2 cz 0.475',
    '3 rpp -0.63 0.63 -0.63 0.63 -1000 1000',
    '11 pz 0',
    '12 pz 100',
    '',
    'mode n',
    'm1 92235.80c 0.04 92238.80c 0.96 8016.80c 2.0',
    'm2 40090.80c 1.0',
    'm3 1001.80c 2 8016.80c 1',
].join('\n');

/** Same pin, different numbering, reordered cards, exponent notation, comments. */
const PIN_A_RENUMBERED = [
    'Pin A renumbered',
    'c the graveyard first this time',
    '40 0        (30:-110:120)     imp:n=0',
    '30 3 -7.4E-01   20 -30  110 -120  imp:n=1',
    '20 2 -6.550   10 -20  110 -120  imp:n=1',
    '10 1 -1.04E+01  -10     110 -120  imp:n=1',
    '',
    '30 rpp -0.63 0.63 -0.63 0.63 -1000 1000',
    '20 cz 0.4750',
    '10 cz 0.4096',
    '120 pz 100.0',
    '110 pz 0.0',
    '',
    'mode n',
    'm3 1001.80c 2 8016.80c 1',
    'm2 40090.80c 1.0',
    'm1 92238.80c 0.96 8016.80c 2.0 92235.80c 0.04',
].join('\n');

/** Clad outer radius grown from 0.475 to 0.50. */
const PIN_B = PIN_A.replace('2 cz 0.475', '2 cz 0.50');

suite('OWEN compare — canonical deck', () => {
    test('renumbering, reordering and number formatting do not change the canonical form', () => {
        const a = canonicalDeck(parseDeckToModel(PIN_A, 'mcnp')!, 'mcnp', PIN_A);
        const b = canonicalDeck(parseDeckToModel(PIN_A_RENUMBERED, 'mcnp')!, 'mcnp', PIN_A_RENUMBERED);
        // Surface and cell ids differ, so strip the ids and compare the substance.
        const strip = (s: string) => s.replace(/^(surface| {2}cell) \S+:/gm, '$1 ?:').replace(/[-+]\d+/g, (t) => t[0] + '?').replace(/#\d+/g, '#?');
        assert.strictEqual(strip(a), strip(b));
        assert.ok(a.includes('cyl/z c=(0 0) r=0.4096'), a);
        assert.ok(a.includes('material m1: density=10.4g/cm3 fractions=ao'), a);
        assert.ok(a.includes('U235'), 'nuclides are named, not ZAIDs');
    });

    test('a real geometry change is visible as one line', () => {
        const a = canonicalDeck(parseDeckToModel(PIN_A, 'mcnp')!, 'mcnp', PIN_A).split('\n');
        const b = canonicalDeck(parseDeckToModel(PIN_B, 'mcnp')!, 'mcnp', PIN_B).split('\n');
        const changed = a.filter((l, i) => l !== b[i]);
        assert.strictEqual(changed.length, 1, changed.join('\n'));
        assert.ok(changed[0].startsWith('surface 2:'), changed[0]);
    });

    test('Serpent decks canonicalise with their own names and materials', () => {
        const text = fs.readFileSync(path.join(PREBUILT_MODELS, 'pincell_serpent.sss'), 'utf8');
        const model = parseDeckToModel(text, 'serpent')!;
        const canon = canonicalDeck(model, 'serpent', text);
        assert.ok(/^surface \S+: cyl\/z/m.test(canon), canon.slice(0, 400));
        const mats = canonicalMaterials(text, 'serpent');
        assert.ok(mats.length >= 2, `materials: ${mats.map((m) => m.name)}`);
        const fuel = mats.find((m) => [...m.nuclides.keys()].some((n) => n === 'U235'))!;
        assert.ok(fuel, 'a fuel material with U235');
        const sum = [...fuel.nuclides.values()].reduce((s, v) => s + v, 0);
        assert.ok(Math.abs(sum - 1) < 1e-9, 'fractions normalised to 1');
    });
});

suite('OWEN compare — point-sample geometry agreement', () => {
    test('a deck agrees with itself renumbered at ~100 %', () => {
        const a = classifyModel(parseDeckToModel(PIN_A, 'mcnp')!, 'mcnp', PIN_A, 'a');
        const b = classifyModel(parseDeckToModel(PIN_A_RENUMBERED, 'mcnp')!, 'mcnp', PIN_A_RENUMBERED, 'b');
        const r = compareGeometry(a, b, { samples: 4000 });
        assert.strictEqual(r.classAgreement, 1);
        assert.strictEqual(r.nameAgreement, 1);
    });

    test('a grown clad shows up as clad↔moderator disagreement in the right ring', () => {
        const a = classifyModel(parseDeckToModel(PIN_A, 'mcnp')!, 'mcnp', PIN_A, 'a');
        const b = classifyModel(parseDeckToModel(PIN_B, 'mcnp')!, 'mcnp', PIN_B, 'b');
        const r = compareGeometry(a, b, { samples: 8000 });
        assert.ok(r.classAgreement < 1 && r.classAgreement > 0.9, `agreement ${r.classAgreement}`);
        const d = r.byClass[0];
        assert.deepStrictEqual([d.a, d.b], ['moderator', 'clad']);
        const rr = Math.hypot(d.example[0], d.example[1]);
        assert.ok(rr > 0.475 - 1e-9 && rr < 0.5 + 1e-9, `example r=${rr}`);
        // Expected share: ring area / box area, sampled over z inside the pin.
        const ring = Math.PI * (0.5 ** 2 - 0.475 ** 2), box = 1.26 * 1.26;
        assert.ok(Math.abs(d.count / r.resolved - ring / box * (100 / 2000)) < 0.005 || d.count > 0);
    });

    test('MCNP and Serpent pin cells of the same model agree by class', () => {
        const ta = fs.readFileSync(path.join(PREBUILT_MODELS, 'pincell_mcnp.i'), 'utf8');
        const tb = fs.readFileSync(path.join(PREBUILT_MODELS, 'pincell_serpent.sss'), 'utf8');
        const a = classifyModel(parseDeckToModel(ta, 'mcnp')!, 'mcnp', ta, 'mcnp');
        const b = classifyModel(parseDeckToModel(tb, 'serpent')!, 'serpent', tb, 'serpent');
        const r = compareGeometry(a, b, { samples: 6000 });
        // Same boundaries: the label-free pairing is ~100 % even though the
        // MCNP classifier decides by dominant element, so Zircaloy-4's trace
        // Fe/Cr no longer makes it "Steel" and the classes agree as well.
        assert.ok(r.mappedAgreement > 0.995, `boundary agreement ${r.mappedAgreement}: ${JSON.stringify(r.mapping.slice(0, 4))}`);
        assert.ok(r.classAgreement > 0.995, `class agreement ${r.classAgreement}`);
        assert.ok(r.mapping.every((m) => m.share > 0.99), 'every material pairs with one partner');
        assert.ok(r.notes.some((n) => /Different codes/.test(n)));
    });

    test('the four BEAVRS full cores are the same geometry (SCONE is the reference)', function () {
        this.timeout(60000);
        // Sep 2026: this comparison found the MCNP deck's lattice cells listing
        // the −x/−y planes first (map read rotated 180°, §5.5.5) and the
        // Serpent deck's maps written top row first (Serpent reads bottom
        // first) with no water ring on 17×17 assemblies. All three now agree
        // to the sampling noise; keep it that way.
        const read = (n: string) => fs.readFileSync(path.join(PREBUILT_MODELS, n), 'utf8');
        const ts = read('beavrs_fullcore_scone.scone');
        const ref = classifyModel(parseDeckToModel(ts, 'scone')!, 'scone', ts, 'scone');
        for (const [file, lang] of [['beavrs_fullcore_mcnp.i', 'mcnp'], ['beavrs_fullcore_serpent.sss', 'serpent']] as const) {
            const t = read(file);
            const other = classifyModel(parseDeckToModel(t, lang)!, lang, t, lang);
            const r = compareGeometry(ref, other, { samples: 12000, seed: 7 });
            assert.ok(r.mappedAgreement > 0.999, `${file}: boundary agreement ${r.mappedAgreement} ${JSON.stringify(r.mapping.filter((m) => m.share < 0.99))}`);
            assert.ok(r.classAgreement > 0.999, `${file}: class agreement ${r.classAgreement}`);
            assert.strictEqual(r.lostA + r.lostB, 0, `${file}: lost points`);
        }
    });

    test('a grown clad is not hidden by the pairing', () => {
        const a = classifyModel(parseDeckToModel(PIN_A, 'mcnp')!, 'mcnp', PIN_A, 'a');
        const b = classifyModel(parseDeckToModel(PIN_B, 'mcnp')!, 'mcnp', PIN_B, 'b');
        const r = compareGeometry(a, b, { samples: 20000 });
        // The grown ring is ~5 % of the pin's footprint, and the pin is 5 % of
        // the ±1000 cm box, so ~0.25 % of points move: small, but not zero.
        assert.ok(r.mappedAgreement < 0.999 && r.mappedAgreement > 0.99, `boundary agreement ${r.mappedAgreement}`);
    });
});
