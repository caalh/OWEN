import * as assert from 'assert';
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

    test('buildScene from XML does not invent a PWR pin', () => {
        const scene = buildScene(SPHERE_XML, 'openmc');
        assert.ok(scene.cylinders.some((c) => c.shape === 'sphere' || (c.radius ?? 0) > 5));
        assert.ok(!scene.cylinders.some((c) => Math.abs((c.radius ?? 0) - 0.41) < 0.02));
    });
});
