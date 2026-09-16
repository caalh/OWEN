import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { REPO_ROOT } from '../paths';
import { OPENMC_PLACEHOLDER_WARNING, parseOpenmc } from '../../preview/codes/openmc';
import {
    looksLikeOpenmcXml,
    parseOpenmcGeometryXml,
    rewriteOpenmcRegion,
} from '../../preview/openmcGeometry';
import { parseDeckToModel } from '../../preview/engineDispatch';
import { buildCsgScene } from '../../preview/csgScene';
import { buildScene } from '../../preview/extractor';
import { Component } from '../../preview/types';
import { findCell } from '../../preview/mcnpEvaluate';

const SPHERE_XML = `<?xml version="1.0"?>
<geometry>
  <surface id="1" type="sphere" coeffs="0 0 0 10"/>
  <cell id="1" material="1" region="-1"/>
  <cell id="2" material="void" region="+1"/>
</geometry>
`;

const ANNULUS_XML = `<?xml version="1.0"?>
<materials>
  <material id="1" name="FLiNaK"/>
</materials>
<geometry>
  <surface id="1" type="z-cylinder" coeffs="0.0 0.0 88"/>
  <surface id="2" type="z-cylinder" coeffs="0.0 0.0 213"/>
  <surface id="3" type="z-plane" coeffs="-500"/>
  <surface id="4" type="z-plane" coeffs="500"/>
  <cell id="1" material="1" region="1 -2 3 -4"/>
</geometry>
`;

suite('OpenMC <lattice> → exact engine (was dropped entirely)', () => {
    // 2×2 lattice, pitch 10, lower_left (-10,-10). XML lists the TOP row
    // first: [u2 u3] over [u4 u5]. Each pin universe holds one region-less
    // cell of a distinct material. Cell 90 (region-less, universe 20) wraps
    // the lattice the way OpenMC exports do; <outer> is universe 6 (water).
    const XML = `<?xml version="1.0"?>
<model><geometry>
  <surface id="1" type="z-cylinder" coeffs="0 0 4" />
  <surface id="2" type="sphere" coeffs="0 0 0 60" boundary="vacuum" />
  <cell id="10" universe="2" material="21" />
  <cell id="11" universe="3" material="31" />
  <cell id="12" universe="4" material="41" />
  <cell id="13" universe="5" material="51" />
  <cell id="14" universe="6" material="61" />
  <cell id="90" universe="20" fill="7" />
  <cell id="99" universe="0" fill="20" region="-2" />
  <lattice id="7">
    <pitch>10 10</pitch>
    <dimension>2 2</dimension>
    <lower_left>-10 -10</lower_left>
    <universes>
 2 3
 4 5
    </universes>
    <outer>6</outer>
  </lattice>
</geometry></model>`;

    test('elements land where the XML draws them (top row first)', () => {
        const model = parseOpenmcGeometryXml(XML);
        const at = (x: number, y: number) => findCell(model, [x, y, 0]).cell?.material;
        assert.strictEqual(at(-5, 5), 21, 'top-left of the map is universe 2');
        assert.strictEqual(at(5, 5), 31, 'top-right is universe 3');
        assert.strictEqual(at(-5, -5), 41, 'bottom-left is universe 4');
        assert.strictEqual(at(5, -5), 51, 'bottom-right is universe 5');
    });

    test('<outer> universe fills beyond the declared grid', () => {
        const model = parseOpenmcGeometryXml(XML);
        const out = findCell(model, [25, 0, 0]);
        assert.strictEqual(out.cell?.material, 61, 'outer water universe');
        assert.ok(!out.lost);
    });

    test('a region-less cell fills its whole universe', () => {
        const model = parseOpenmcGeometryXml(XML);
        const c = findCell(model, [0.5, 0.5, 0]);
        assert.ok(!c.lost, 'descent through the region-less wrapper must not lose the point');
        assert.strictEqual(c.cell?.material, 31, '(0.5,0.5) sits in element (1,1) — the top-right map entry, universe 3');
    });
});

suite('OpenMC geometry.xml → exact engine', () => {
    test('looksLikeOpenmcXml accepts XML and rejects Python', () => {
        assert.ok(looksLikeOpenmcXml(SPHERE_XML));
        assert.ok(looksLikeOpenmcXml('<geometry><cell id="1" material="void" region="-1"/></geometry>'));
        assert.ok(looksLikeOpenmcXml(ANNULUS_XML), 'a concatenated materials+geometry dump is still XML');
        const materialsFirst = `<materials><material id="1" name="fuel"/></materials>
<geometry>
  <surface id="1" type="sphere" coeffs="0 0 0 10"/>
  <cell id="1" material="1" region="-1"/>
</geometry>
`;
        assert.ok(looksLikeOpenmcXml(materialsFirst), 'live export often starts with <materials>');
        const scene = buildScene(materialsFirst, 'openmc');
        assert.ok(scene.cylinders.length > 0, 'materials-first XML must take the CSG path, not the Python pin heuristic');
        assert.ok(!looksLikeOpenmcXml('import openmc\ngeom = openmc.Geometry()'));
        assert.ok(!looksLikeOpenmcXml('# a comment that mentions <geometry> in passing\nimport openmc\n'));
    });

    test('rewriteOpenmcRegion maps | & ~ onto MCNP tokens', () => {
        assert.strictEqual(rewriteOpenmcRegion('-1 | +2').replace(/\s+/g, ' ').trim(), '-1 : +2');
        assert.ok(/\s/.test(rewriteOpenmcRegion('-1 & +2')));
        assert.strictEqual(rewriteOpenmcRegion('~-1').trim(), '+1');
        assert.strictEqual(rewriteOpenmcRegion('~+2').trim(), '-2');
    });

    test('a sphere XML cell contains the origin and not a far point', () => {
        const model = parseOpenmcGeometryXml(SPHERE_XML);
        assert.strictEqual(model.cells.size, 2);
        assert.strictEqual(findCell(model, [0, 0, 0]).cell?.id, 1);
        assert.strictEqual(findCell(model, [50, 0, 0]).cell?.id, 2);
    });

    test('a z-cylinder annulus XML draws an inner hole', () => {
        const model = parseOpenmcGeometryXml(ANNULUS_XML);
        const scene = buildCsgScene(model, new Map([
            [1, { name: 'FLiNaK', component: Component.Moderator }],
        ]));
        const annular = scene.cylinders.find((c) => (c.innerRadius ?? 0) > 50);
        assert.ok(annular, `expected an annulus, got ${JSON.stringify(scene.cylinders.map((c) => [c.radius, c.innerRadius]))}`);
        assert.ok(Math.abs((annular!.innerRadius ?? 0) - 88) < 0.1);
        assert.ok(Math.abs(annular!.radius - 213) < 0.1);
        assert.strictEqual(findCell(model, [0, 0, 0]).cell, null);
        assert.strictEqual(findCell(model, [150, 0, 0]).cell?.id, 1);
    });

    test('parseDeckToModel reads XML and not a Python stub', () => {
        assert.ok(parseDeckToModel(SPHERE_XML, 'openmc'));
        assert.strictEqual(parseDeckToModel('import openmc', 'openmc'), null);
    });

    test('OpenMC XML with universe=1 (live export) still draws and classifies', () => {
        // Geometry.export_to_xml() numbers the root universe from 1. The CSG
        // path used to iterate only universe 0 and emit 0 primitives.
        const xml = `<?xml version="1.0"?>
<materials>
  <material id="1" name="DT_70_30"/>
  <material id="2" name="FLiNaK"/>
  <material id="3" name="RAFM_9Cr2WVTa"/>
</materials>
<geometry>
  <cell id="1" name="DT_shell" material="1" region="1 -2" universe="1"/>
  <cell id="2" name="FLiNaK" material="2" region="(3 | -4 | 5) (-6 7 -8)" universe="1"/>
  <cell id="3" name="first_wall" material="3" region="(6 | -7 | 8) (-9 10 -11)" universe="1"/>
  <cell id="4" name="outer_void" material="void" region="(9 | -10 | 11) -12" universe="1"/>
  <surface id="1" type="sphere" coeffs="0.0 0.0 0.0 0.0133"/>
  <surface id="2" type="sphere" coeffs="0.0 0.0 0.0 0.0183"/>
  <surface id="3" type="z-cylinder" coeffs="0.0 0.0 30.0"/>
  <surface id="4" type="z-plane" coeffs="-450.0"/>
  <surface id="5" type="z-plane" coeffs="450.0"/>
  <surface id="6" type="z-cylinder" coeffs="0.0 0.0 213.0"/>
  <surface id="7" type="z-plane" coeffs="-500.0"/>
  <surface id="8" type="z-plane" coeffs="500.0"/>
  <surface id="9" type="z-cylinder" coeffs="0.0 0.0 218.0"/>
  <surface id="10" type="z-plane" coeffs="-505.0"/>
  <surface id="11" type="z-plane" coeffs="505.0"/>
  <surface id="12" type="sphere" boundary="vacuum" coeffs="0.0 0.0 0.0 2000.0"/>
</geometry>
`;
        const model = parseOpenmcGeometryXml(xml);
        assert.strictEqual(model.cells.size, 4);
        assert.ok((model.universes.get(0) ?? []).length === 0, 'live OpenMC XML has no universe 0');
        const scene = buildCsgScene(model, new Map([
            [1, { name: 'DT_70_30', component: Component.Fuel }],
            [2, { name: 'FLiNaK', component: Component.Moderator }],
            [3, { name: 'RAFM_9Cr2WVTa', component: Component.Structure }],
        ]));
        assert.ok(scene.cylinders.length > 0,
            `expected primitives from universe 1, got ${scene.cylinders.length}: ${JSON.stringify(scene)}`);
        const salt = scene.cylinders.find((c) => (c.innerRadius ?? 0) > 20 && Math.abs(c.radius - 213) < 1);
        assert.ok(salt, `expected FLiNaK annulus, got ${JSON.stringify(scene.cylinders.map((c) => [c.label, c.radius, c.innerRadius, c.height]))}`);
        assert.strictEqual(findCell(model, [150, 0, 0]).cell?.id, 2);
        // Origin is inside the inner DT sphere; this XML has no inner-void cell.
        assert.strictEqual(findCell(model, [0.016, 0, 0]).cell?.id, 1);
        const built = buildScene(xml, 'openmc');
        assert.ok(built.cylinders.length > 0, 'buildScene must not report 0 primitives');
        assert.ok(!built.cylinders.some((c) => Math.abs((c.radius ?? 0) - 0.41) < 0.02), 'no invented PWR pin');
    });

    test('OpenMC XML with universe=5 (not 1) still draws — root is the unfilled universe, not a hardcoded id', () => {
        const xml = `<?xml version="1.0"?>
<geometry>
  <surface id="1" type="sphere" coeffs="0 0 0 10"/>
  <cell id="1" material="1" region="-1" universe="5"/>
  <cell id="2" material="void" region="+1" universe="5"/>
</geometry>
`;
        const model = parseOpenmcGeometryXml(xml);
        assert.ok((model.universes.get(0) ?? []).length === 0);
        assert.ok((model.universes.get(1) ?? []).length === 0);
        assert.ok((model.universes.get(5) ?? []).length === 2);
        const scene = buildCsgScene(model, new Map([
            [1, { name: 'fuel', component: Component.Fuel }],
        ]));
        assert.ok(scene.cylinders.length > 0, `expected primitives from universe 5, got ${scene.cylinders.length}`);
        assert.strictEqual(findCell(model, [0, 0, 0]).cell?.id, 1);
        const built = buildScene(xml, 'openmc');
        assert.ok(built.cylinders.length > 0);
    });

    test('OpenMC XML: a busy world in universe 2 beats an orphan cell in universe 1', () => {
        const xml = `<?xml version="1.0"?>
<geometry>
  <surface id="1" type="sphere" coeffs="0 0 0 10"/>
  <surface id="2" type="sphere" coeffs="100 0 0 1"/>
  <cell id="10" material="1" region="-1" universe="2"/>
  <cell id="11" material="2" region="1 -3" universe="2"/>
  <cell id="12" material="void" region="+3" universe="2"/>
  <surface id="3" type="sphere" coeffs="0 0 0 50"/>
  <cell id="99" material="9" region="-2" universe="1"/>
</geometry>
`;
        const model = parseOpenmcGeometryXml(xml);
        assert.strictEqual(findCell(model, [0, 0, 0]).cell?.id, 10, 'origin is the world sphere, not the orphan');
        assert.strictEqual(findCell(model, [100, 0, 0]).cell?.id, 12, 'orphan universe 1 is not the world');
        const scene = buildCsgScene(model, new Map([
            [1, { name: 'fuel', component: Component.Fuel }],
            [2, { name: 'clad', component: Component.Structure }],
        ]));
        assert.ok(scene.cylinders.length > 0);
        assert.ok(!scene.cylinders.some((c) => Math.abs((c.x ?? 0) - 100) < 0.5 && Math.abs((c.radius ?? 0) - 1) < 0.1),
            'must not mesh the orphan universe-1 sphere at x=100');
    });

    test('OpenMC XML nested fill: world cell fills another universe', () => {
        const xml = `<?xml version="1.0"?>
<geometry>
  <surface id="1" type="sphere" coeffs="0 0 0 20"/>
  <surface id="2" type="sphere" coeffs="0 0 0 5"/>
  <cell id="1" fill="2" region="-1" universe="1"/>
  <cell id="2" material="void" region="+1" universe="1"/>
  <cell id="3" material="1" region="-2" universe="2"/>
  <cell id="4" material="2" region="+2" universe="2"/>
</geometry>
`;
        const model = parseOpenmcGeometryXml(xml);
        assert.strictEqual(findCell(model, [0, 0, 0]).cell?.id, 3);
        const scene = buildCsgScene(model, new Map([
            [1, { name: 'fuel', component: Component.Fuel }],
            [2, { name: 'mod', component: Component.Moderator }],
        ]));
        assert.ok(scene.cylinders.length > 0, 'fill wrapper must not yield 0 primitives');
        const inner = scene.cylinders.find((c) => c.shape === 'sphere' && Math.abs((c.radius ?? 0) - 5) < 0.1);
        assert.ok(inner, `expected inner r=5 sphere, got ${JSON.stringify(scene.cylinders.map((c) => [c.shape, c.radius, c.innerRadius]))}`);
    });

    test('IFE cylindrical chamber: salt is a volume, cavity is glass, outer void is skipped', () => {
        // Matches mcnp_baseline_flinak.py (no CD ablator) as OpenMC exports it.
        const xml = `<?xml version="1.0"?>
<materials>
  <material id="1" name="DT_70_30"/>
  <material id="2" name="FLiNaK"/>
  <material id="3" name="RAFM_9Cr2WVTa"/>
</materials>
<geometry>
  <cell id="1" name="inner_capsule_void" material="void" region="-1" universe="1"/>
  <cell id="2" name="DT_shell" material="1" region="1 -2" universe="1"/>
  <cell id="3" name="capsule_to_void_cyl" material="void" region="2 -3 4 -5" universe="1"/>
  <cell id="4" name="FLiNaK" material="2" region="(3 | -4 | 5) (-6 7 -8)" universe="1"/>
  <cell id="5" name="first_wall" material="3" region="(6 | -7 | 8) (-9 10 -11)" universe="1"/>
  <cell id="6" name="outer_void" material="void" region="(9 | -10 | 11) -12" universe="1"/>
  <surface id="1" type="sphere" coeffs="0.0 0.0 0.0 0.0133"/>
  <surface id="2" type="sphere" coeffs="0.0 0.0 0.0 0.0183"/>
  <surface id="3" type="z-cylinder" coeffs="0.0 0.0 30.0"/>
  <surface id="4" type="z-plane" coeffs="-450.0"/>
  <surface id="5" type="z-plane" coeffs="450.0"/>
  <surface id="6" type="z-cylinder" coeffs="0.0 0.0 213.0"/>
  <surface id="7" type="z-plane" coeffs="-500.0"/>
  <surface id="8" type="z-plane" coeffs="500.0"/>
  <surface id="9" type="z-cylinder" coeffs="0.0 0.0 218.0"/>
  <surface id="10" type="z-plane" coeffs="-505.0"/>
  <surface id="11" type="z-plane" coeffs="505.0"/>
  <surface id="12" type="sphere" boundary="vacuum" coeffs="0.0 0.0 0.0 2000.0"/>
</geometry>
`;
        const scene = buildCsgScene(parseOpenmcGeometryXml(xml), new Map([
            [1, { name: 'DT_70_30', component: Component.Fuel }],
            [2, { name: 'FLiNaK', component: Component.Moderator }],
            [3, { name: 'RAFM_9Cr2WVTa', component: Component.Structure }],
        ]));
        const salt = scene.cylinders.find((c) => (c.innerRadius ?? 0) > 20 && Math.abs(c.radius - 213) < 1);
        assert.ok(salt, `FLiNaK annulus missing: ${JSON.stringify(scene.cylinders.map((c) => [c.label, c.radius, c.innerRadius, c.height, c.material]))}`);
        assert.ok(Math.abs((salt!.innerRadius ?? 0) - 30) < 0.1);
        const cavity = scene.cylinders.find((c) => c.material === 'void' && Math.abs((c.radius ?? 0) - 30) < 1);
        assert.ok(cavity, `chamber cavity was not drawn: ${JSON.stringify(scene.notes)}`);
        assert.ok((cavity!.opacity ?? 1) < 0.5, 'cavity must be translucent');
        assert.ok(!scene.cylinders.some((c) => Math.abs((c.radius ?? 0) - 2000) < 1),
            'bounding-sphere exterior must not be meshed');
        assert.ok(scene.notes.some((n) => /cell 6 is void — exterior/i.test(n)), JSON.stringify(scene.notes));
        assert.ok(scene.notes.some((n) => /cell 3 is void — drawn as a translucent cavity/i.test(n)));
        assert.ok(!scene.notes.some((n) => /not drawn \(enable slices/i.test(n)));
    });

    test('buildScene from XML does not invent a PWR pin', () => {
        const scene = buildScene(SPHERE_XML, 'openmc');
        assert.ok(scene.cylinders.some((c) => c.shape === 'sphere' || (c.radius ?? 0) > 5));
        assert.ok(!scene.cylinders.some((c) => Math.abs((c.radius ?? 0) - 0.41) < 0.02));
    });

    test('the stand-in pin is flagged with the constant the preview parks on', () => {
        const opaque = [
            'import openmc',
            'def build(cfg):',
            '    return make_model(cfg.radius, cfg.height)',
        ].join('\n');
        const warnings = parseOpenmc(opaque).warnings ?? [];
        assert.ok(
            warnings.includes(OPENMC_PLACEHOLDER_WARNING),
            `placeholder must use the shared constant: ${warnings.join(' | ')}`,
        );
        const src = fs.readFileSync(path.join(REPO_ROOT, 'src', 'preview', 'webview.ts'), 'utf8');
        assert.ok(src.includes('function holdPlaceholderPendingExport'), 'preview must park the stand-in pin');
        assert.ok(/openmcPlaceholder = lastScene/.test(src), 'the parked scene has to be restorable');
        assert.ok(/if \(openmcPlaceholder\) \{\s*\n\s*lastScene = openmcPlaceholder;/.test(src),
            'a failed export must put the stand-in pin back');
    });
});
