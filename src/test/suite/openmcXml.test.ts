/**
 * OpenMC XML validator (src/language/openmcXml.ts) — headless tests, no
 * vscode API. Fixtures mirror what Model.export_to_xml()/export_to_model_xml()
 * actually writes.
 */
import * as assert from 'assert';
import { detectOpenmcXmlKind, validateOpenmcXml } from '../../language/openmcXml';

const codes = (diags: { code: string }[]) => diags.map((d) => d.code);

suite('OpenMC XML — kind detection', () => {
    test('detects each root element', () => {
        assert.strictEqual(detectOpenmcXmlKind('<?xml version="1.0"?>\n<materials>\n</materials>'), 'materials');
        assert.strictEqual(detectOpenmcXmlKind('<geometry>\n</geometry>'), 'geometry');
        assert.strictEqual(detectOpenmcXmlKind('<settings/>'), 'settings');
        assert.strictEqual(detectOpenmcXmlKind('<tallies/>'), 'tallies');
        assert.strictEqual(detectOpenmcXmlKind('<model>\n</model>'), 'model');
    });

    test('skips declaration and comments, rejects unrelated XML', () => {
        assert.strictEqual(
            detectOpenmcXmlKind('<?xml version="1.0"?>\n<!-- exported -->\n<materials/>'),
            'materials',
        );
        assert.strictEqual(detectOpenmcXmlKind('<project><flavor>maven</flavor></project>'), null);
        assert.strictEqual(detectOpenmcXmlKind('plain text'), null);
    });
});

suite('OpenMC XML — materials', () => {
    const good = `<materials>
  <material id="1" name="uo2">
    <density units="g/cm3" value="10.97"/>
    <nuclide name="U235" ao="0.04"/>
    <nuclide name="U238" ao="0.96"/>
    <nuclide name="O16" ao="2.0"/>
  </material>
  <material id="2">
    <density units="sum"/>
    <nuclide name="H1" ao="2.0"/>
    <sab name="c_H_in_H2O"/>
  </material>
</materials>`;

    test('clean file produces no diagnostics', () => {
        assert.deepStrictEqual(validateOpenmcXml('materials', good), []);
    });

    test('duplicate ids, bad units, bad nuclide, ao+wo, MCNP sab name', () => {
        const bad = `<materials>
  <material id="1">
    <density units="g/m3" value="10"/>
    <nuclide name="92235.80c" ao="0.04"/>
    <nuclide name="U238" ao="0.9" wo="0.1"/>
    <sab name="lwtr"/>
  </material>
  <material id="1">
    <density units="g/cm3"/>
  </material>
</materials>`;
        const c = codes(validateOpenmcXml('materials', bad));
        assert.ok(c.includes('openmc-xml.duplicate-id'), `missing duplicate-id: ${c}`);
        assert.ok(c.includes('openmc-xml.density-units'), `missing density-units: ${c}`);
        assert.ok(c.includes('openmc-xml.nuclide-name'), `missing nuclide-name: ${c}`);
        assert.ok(c.includes('openmc-xml.nuclide-ao-wo'), `missing ao-wo: ${c}`);
        assert.ok(c.includes('openmc-xml.sab-name'), `missing sab-name: ${c}`);
        assert.ok(c.includes('openmc-xml.density-no-value'), `missing density-no-value: ${c}`);
    });

    test('metastable nuclide names pass', () => {
        const t = '<materials><material id="1"><density units="sum"/><nuclide name="Am242_m1" ao="1"/></material></materials>';
        assert.deepStrictEqual(validateOpenmcXml('materials', t), []);
    });
});

suite('OpenMC XML — geometry', () => {
    const good = `<geometry>
  <cell id="1" material="1" region="-1" universe="0"/>
  <cell id="2" material="void" region="1 -2" universe="0"/>
  <surface id="1" type="z-cylinder" coeffs="0 0 0.45"/>
  <surface id="2" type="sphere" coeffs="0 0 0 100" boundary="vacuum"/>
</geometry>`;

    test('clean geometry produces no diagnostics', () => {
        assert.deepStrictEqual(validateOpenmcXml('geometry', good), []);
    });

    test('bad surface type, bad boundary, unknown surface ref, material+fill', () => {
        const bad = `<geometry>
  <cell id="1" material="1" fill="2" region="-1"/>
  <cell id="2" material="void" region="-99"/>
  <surface id="1" type="zcylinder" coeffs="0 0 0.45"/>
  <surface id="2" type="sphere" coeffs="0 0 0 100" boundary="leaky"/>
</geometry>`;
        const c = codes(validateOpenmcXml('geometry', bad));
        assert.ok(c.includes('openmc-xml.surface-type'), `missing surface-type: ${c}`);
        assert.ok(c.includes('openmc-xml.boundary-type'), `missing boundary-type: ${c}`);
        assert.ok(c.includes('openmc-xml.unknown-surface'), `missing unknown-surface: ${c}`);
        assert.ok(c.includes('openmc-xml.cell-material-and-fill'), `missing material-and-fill: ${c}`);
    });

    test('cross-file material check fires only with context', () => {
        const geom = '<geometry><cell id="1" material="7" region="-1"/><surface id="1" type="sphere" coeffs="0 0 0 1"/></geometry>';
        assert.deepStrictEqual(validateOpenmcXml('geometry', geom), []);
        const c = codes(validateOpenmcXml('geometry', geom, { materialIds: new Set(['1', '2']) }));
        assert.ok(c.includes('openmc-xml.unknown-material'), `missing unknown-material: ${c}`);
    });

    test('complex region operators parse (union, complement, parens)', () => {
        const geom = `<geometry>
  <cell id="1" material="1" region="(-1 | 2) ~(3)"/>
  <surface id="1" type="sphere" coeffs="0 0 0 1"/>
  <surface id="2" type="z-plane" coeffs="0"/>
  <surface id="3" type="z-plane" coeffs="10"/>
</geometry>`;
        assert.deepStrictEqual(validateOpenmcXml('geometry', geom), []);
    });
});

suite('OpenMC XML — settings', () => {
    test('clean settings produce no diagnostics', () => {
        const t = '<settings><run_mode>eigenvalue</run_mode><particles>10000</particles><batches>100</batches><inactive>20</inactive></settings>';
        assert.deepStrictEqual(validateOpenmcXml('settings', t), []);
    });

    test('inactive >= batches, bad run_mode, non-integer particles', () => {
        const t = '<settings><run_mode>criticality</run_mode><particles>lots</particles><batches>50</batches><inactive>50</inactive></settings>';
        const c = codes(validateOpenmcXml('settings', t));
        assert.ok(c.includes('openmc-xml.inactive-ge-batches'), `missing inactive-ge-batches: ${c}`);
        assert.ok(c.includes('openmc-xml.run-mode'), `missing run-mode: ${c}`);
        assert.ok(c.includes('openmc-xml.bad-int'), `missing bad-int: ${c}`);
    });
});

suite('OpenMC XML — tallies', () => {
    test('clean tallies produce no diagnostics', () => {
        const t = `<tallies>
  <filter id="1" type="energy"><bins>0.0 0.625 20.0e6</bins></filter>
  <tally id="1"><filters>1</filters><scores>flux</scores></tally>
</tallies>`;
        assert.deepStrictEqual(validateOpenmcXml('tallies', t), []);
    });

    test('unknown filter ref and missing scores', () => {
        const t = `<tallies>
  <filter id="1" type="energy"><bins>0.0 20.0e6</bins></filter>
  <tally id="1"><filters>1 9</filters><scores>flux</scores></tally>
  <tally id="2"><filters>1</filters></tally>
</tallies>`;
        const c = codes(validateOpenmcXml('tallies', t));
        assert.ok(c.includes('openmc-xml.unknown-filter'), `missing unknown-filter: ${c}`);
        assert.ok(c.includes('openmc-xml.tally-no-scores'), `missing tally-no-scores: ${c}`);
    });
});

suite('OpenMC XML — model.xml', () => {
    test('cross-checks materials against cells inside one file', () => {
        const t = `<model>
  <materials>
    <material id="1"><density units="sum"/><nuclide name="U235" ao="1"/></material>
  </materials>
  <geometry>
    <cell id="1" material="2" region="-1"/>
    <surface id="1" type="sphere" coeffs="0 0 0 1" boundary="vacuum"/>
  </geometry>
  <settings><particles>1000</particles><batches>10</batches><inactive>5</inactive></settings>
</model>`;
        const c = codes(validateOpenmcXml('model', t));
        assert.ok(c.includes('openmc-xml.unknown-material'), `missing unknown-material: ${c}`);
    });

    test('diagnostics carry correct line numbers', () => {
        const t = '<materials>\n  <material id="1">\n    <density units="bogus" value="1"/>\n  </material>\n</materials>';
        const diags = validateOpenmcXml('materials', t);
        assert.strictEqual(diags.length, 1);
        assert.strictEqual(diags[0].line, 2);
    });
});
