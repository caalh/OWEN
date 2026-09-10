import * as assert from 'assert';
import {
    describeMcnpSuffix,
    MCNP_CLASS_LETTERS,
    parseZaid,
    tokenAt,
    zaidHoverMarkdown,
} from '../../language/zaidHover';

suite('OWEN ZAID hover — library suffix mapping', () => {
    test('.80c is ENDF/B-VII.1 at room temperature, not VIII.0', () => {
        const md = zaidHoverMarkdown('92238.80c', 'mcnp')!;
        assert.ok(md.includes('U-238'), md);
        assert.ok(md.includes('ENDF/B-VII.1'), 'must say VII.1');
        assert.ok(md.includes('293.6 K'), 'must give the temperature');
        assert.ok(!/\*\*ENDF\/B-VIII\.0\*\*/.test(md), 'must not present .80c as VIII.0');
    });

    test('.00c is ENDF/B-VIII.0 (Lib80x) and .71c is VII.0 at 600 K', () => {
        assert.ok(zaidHoverMarkdown('92235.00c', 'mcnp')!.includes('**ENDF/B-VIII.0**'));
        const md = zaidHoverMarkdown('92235.71c', 'mcnp')!;
        assert.ok(md.includes('ENDF/B-VII.0'), md);
        assert.ok(md.includes('600 K'), md);
        assert.ok(md.includes('TMP'), 'non-room-temperature tables should mention the TMP card');
    });

    test('the LANL ladder is 293.6 / 600 / 900 / 1200 / 2500 / 0.1 / 250 K', () => {
        const temps = ['80', '81', '82', '83', '84', '85', '86'].map((d) => describeMcnpSuffix(d, 'c')[0]);
        assert.ok(temps[0].includes('293.6 K'));
        assert.ok(temps[1].includes('600 K'));
        assert.ok(temps[2].includes('900 K'));
        assert.ok(temps[3].includes('1200 K'));
        assert.ok(temps[4].includes('2500 K'));
        assert.ok(temps[5].includes('0.1 K'));
        assert.ok(temps[6].includes('250 K'));
    });

    test('thermal tables pair with their neutron library', () => {
        const md = zaidHoverMarkdown('lwtr.20t', 'mcnp')!;
        assert.ok(md.includes('H in light water'));
        assert.ok(md.includes('ENDF71SaB'));
        const md80 = zaidHoverMarkdown('h-h2o.80t', 'mcnp')!;
        assert.ok(md80.includes('ENDF80SaB'));
        assert.ok(zaidHoverMarkdown('grph.10t', 'mcnp')!.includes('endf70sab'));
        assert.ok(zaidHoverMarkdown('h/zr.20t', 'mcnp')!.includes('H in ZrH'));
    });

    test('class letters follow Table B.1 and there is no j', () => {
        assert.ok(!('j' in MCNP_CLASS_LETTERS));
        assert.deepStrictEqual(
            Object.keys(MCNP_CLASS_LETTERS).sort(),
            ['a', 'c', 'd', 'e', 'g', 'h', 'm', 'o', 'p', 'r', 's', 't', 'u', 'y'],
        );
        assert.ok(describeMcnpSuffix('80', 'j')[0].includes('not a class letter'));
    });

    test('elemental ZAIDs warn that VIII.0 dropped them', () => {
        const md = zaidHoverMarkdown('6000.00c', 'mcnp')!;
        assert.ok(md.includes('natural carbon'));
        assert.ok(md.includes('no elemental tables'));
        assert.ok(!zaidHoverMarkdown('6000.80c', 'mcnp')!.includes('no elemental tables'));
    });

    test('metastable encoding is decoded', () => {
        const md = zaidHoverMarkdown('95642.80c', 'mcnp')!;
        assert.ok(md.includes('Am-242m1'), md);
        assert.ok(md.includes('A=242'), md);
    });

    test('Serpent and SCONE suffixes are temperatures, not evaluations', () => {
        const s = zaidHoverMarkdown('92235.09c', 'serpent')!;
        assert.ok(s.includes('900 K'), s);
        assert.ok(s.includes('acelib'), 'Serpent evaluation comes from set acelib');
        assert.ok(!s.includes('ENDF71x'), 'must not apply the LANL MCNP table to Serpent');
        const sc = zaidHoverMarkdown('92235.06', 'scone')!;
        assert.ok(sc.includes('600 K'), sc);
        assert.ok(sc.includes('temp'), 'SCONE ties the suffix to the material temp');
    });

    test('OpenMC nuclide strings describe the nuclide and where temperature comes from', () => {
        const md = zaidHoverMarkdown('U235', 'openmc')!;
        assert.ok(md.includes('U-235'));
        assert.ok(md.includes('cell wins'), 'cell > material > settings precedence');
        assert.strictEqual(zaidHoverMarkdown('model', 'openmc'), null, 'plain identifiers are not nuclides');
        assert.strictEqual(zaidHoverMarkdown('Xx99', 'openmc'), null);
    });

    test('non-identifiers return null', () => {
        assert.strictEqual(zaidHoverMarkdown('imp:n=1', 'mcnp'), null);
        assert.strictEqual(zaidHoverMarkdown('0.4096', 'mcnp'), null);
        assert.strictEqual(zaidHoverMarkdown('123', 'mcnp'), null);
        assert.strictEqual(parseZaid('999999'), null, 'Z beyond the table is not a nuclide');
    });

    test('tokenAt picks the whole identifier under the cursor, stripping quotes', () => {
        const line = "m1 92235.80c 0.04  $ 'U235'";
        assert.deepStrictEqual(tokenAt(line, 6), { text: '92235.80c', start: 3, end: 12 });
        assert.deepStrictEqual(tokenAt("mat.add_nuclide('U235', 0.04)", 18), { text: 'U235', start: 17, end: 21 });
        assert.deepStrictEqual(tokenAt('mt3 lwtr.20t', 6), { text: 'lwtr.20t', start: 4, end: 12 });
        assert.deepStrictEqual(tokenAt('mt3 h/zr.20t', 8), { text: 'h/zr.20t', start: 4, end: 12 });
    });
});
