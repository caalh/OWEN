import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { PREBUILT_MODELS } from '../paths';
import { validateWorkspace, FileSystemLike } from '../../workspace/core';
import { parseDeckToModel } from '../../preview/engineDispatch';
import { checkGeometry } from '../../geomcheck/core';
import { domainPredicate } from '../../preview/mcnpEvaluate';

/** In-memory project: paths are POSIX-ish under a fake root. */
function memFs(files: Record<string, string>, mtimes: Record<string, number> = {}): FileSystemLike {
    const norm = (p: string) => path.resolve(p);
    const map = new Map(Object.entries(files).map(([k, v]) => [norm(k), v]));
    return {
        exists: (p) => map.has(norm(p)),
        read: (p) => map.get(norm(p)) ?? '',
        list: (d) => [...map.keys()].filter((k) => path.dirname(k) === norm(d)).map((k) => path.basename(k)),
        mtime: (p) => mtimes[path.basename(p)] ?? 1000,
    };
}

const ROOT = path.resolve('/proj');
const MATERIALS = `<?xml version='1.0'?>
<materials>
  <material id="1" name="fuel"><density value="10.4" units="g/cm3"/><nuclide name="U235" ao="0.04"/><nuclide name="U238" ao="0.96"/><nuclide name="O16" ao="2"/></material>
  <material id="2" name="water"><density value="0.74" units="g/cm3"/><nuclide name="H1" ao="2"/><nuclide name="O16" ao="1"/></material>
  <material id="3" name="spare"><density value="1" units="g/cm3"/><nuclide name="Fe56" ao="1"/></material>
</materials>`;
const GEOMETRY = `<?xml version='1.0'?>
<geometry>
  <cell id="1" material="1" region="-1" universe="0"/>
  <cell id="2" material="2" region="1 -2" universe="0"/>
  <surface id="1" type="sphere" coeffs="0 0 0 10"/>
  <surface id="2" type="sphere" coeffs="0 0 0 20" boundary="vacuum"/>
  <surface id="3" type="z-plane" coeffs="99"/>
</geometry>`;
const SETTINGS = `<?xml version='1.0'?>
<settings><run_mode>eigenvalue</run_mode><particles>1000</particles><batches>50</batches><inactive>10</inactive>
<source type="independent"><space type="point" parameters="0 0 0"/></source></settings>`;
const TALLIES = `<?xml version='1.0'?>
<tallies>
  <filter id="1" type="cell"><bins>1 2</bins></filter>
  <filter id="2" type="cell"><bins>99</bins></filter>
  <filter id="3" type="energy"><bins>0 1e6</bins></filter>
  <tally id="1" name="ok"><filters>1</filters><scores>flux</scores></tally>
  <tally id="2" name="bad-cell"><filters>2</filters><nuclides>Li6</nuclides><scores>(n,Xt)</scores></tally>
  <tally id="3" name="bad-filter"><filters>7</filters><scores>flux</scores></tally>
</tallies>`;

suite('OWEN workspace validation — OpenMC XML project', () => {
    test('a coherent project reports what it verified and a vacuum boundary is not a gap', () => {
        const fsl = memFs({
            [`${ROOT}/materials.xml`]: MATERIALS, [`${ROOT}/geometry.xml`]: GEOMETRY, [`${ROOT}/settings.xml`]: SETTINGS,
            [`${ROOT}/tallies.xml`]: TALLIES.replace(/<filter id="2"[\s\S]*?<\/filter>/, '').replace(/<tally id="2"[\s\S]*?<\/tally>/, '').replace(/<tally id="3"[\s\S]*?<\/tally>/, ''),
        });
        const r = validateWorkspace({ language: 'openmc-xml', rootPath: `${ROOT}/geometry.xml`, fs: fsl });
        assert.strictEqual(r.summary.errors, 0, JSON.stringify(r.diagnostics));
        assert.ok(r.verified.some((v) => /cell→material/.test(v)));
        assert.ok(r.verified.some((v) => /region→surface/.test(v)));
        assert.ok(r.verified.some((v) => /quick geometry sample/.test(v)), 'the vacuum sphere bounds the problem; box corners are not lost');
        assert.strictEqual(r.inventory.cells, 2);
        assert.strictEqual(r.files.length, 4);
        // Hints for the unused material and surface.
        assert.ok(r.diagnostics.some((d) => d.code === 'workspace.unused-material' && /Material 3/.test(d.message)));
        assert.ok(r.diagnostics.some((d) => d.code === 'workspace.unused-surface' && /Surface 3/.test(d.message)));
    });

    test('tally filters on missing cells, missing filters and absent nuclides are found across files', () => {
        const fsl = memFs({
            [`${ROOT}/materials.xml`]: MATERIALS, [`${ROOT}/geometry.xml`]: GEOMETRY, [`${ROOT}/settings.xml`]: SETTINGS, [`${ROOT}/tallies.xml`]: TALLIES,
        });
        const r = validateWorkspace({ language: 'openmc-xml', rootPath: `${ROOT}/tallies.xml`, fs: fsl });
        const codes = r.diagnostics.map((d) => d.code);
        assert.ok(codes.includes('workspace.filter-cell'), codes.join(','));
        assert.ok(codes.includes('workspace.unknown-filter'));
        assert.ok(codes.includes('workspace.tally-nuclide-absent'));
        const f = r.diagnostics.find((d) => d.code === 'workspace.filter-cell')!;
        assert.ok(f.file.endsWith('tallies.xml') && f.line === 3, `located at ${f.file}:${f.line}`);
    });

    test('model.xml that disagrees with the separate files is an error; a stale one is a warning', () => {
        const model = `<?xml version='1.0'?><model>${MATERIALS.replace(/<\?xml[^>]*>/, '')}${GEOMETRY.replace(/<\?xml[^>]*>/, '').replace('<cell id="2"', '<cell id="5"')}${SETTINGS.replace(/<\?xml[^>]*>/, '')}<tallies/></model>`;
        const fsl = memFs(
            { [`${ROOT}/materials.xml`]: MATERIALS, [`${ROOT}/geometry.xml`]: GEOMETRY, [`${ROOT}/settings.xml`]: SETTINGS, [`${ROOT}/model.xml`]: model },
            { 'geometry.xml': 5000, 'model.xml': 1000 },
        );
        const r = validateWorkspace({ language: 'openmc-xml', rootPath: `${ROOT}/geometry.xml`, fs: fsl });
        const dis = r.diagnostics.find((d) => d.code === 'workspace.model-xml-disagrees');
        assert.ok(dis, JSON.stringify(r.diagnostics.map((d) => d.code)));
        assert.ok(/cells: model.xml has 2, the separate files have 2/.test(dis!.message) && /only in model.xml: 5/.test(dis!.message), dis!.message);
        assert.ok(r.diagnostics.some((d) => d.code === 'workspace.model-xml-stale'));
        assert.ok(r.notes.some((n) => /reads model.xml when present/.test(n)));
    });

    test('fixed source with no <source>, and eigenvalue with nothing fissile, are caught', () => {
        const fsl = memFs({
            [`${ROOT}/materials.xml`]: MATERIALS.replace(/U235|U238/g, 'Fe56'), [`${ROOT}/geometry.xml`]: GEOMETRY,
            [`${ROOT}/settings.xml`]: SETTINGS,
        });
        const r = validateWorkspace({ language: 'openmc-xml', rootPath: `${ROOT}/settings.xml`, fs: fsl });
        assert.ok(r.diagnostics.some((d) => d.code === 'workspace.no-fissile'));
        const fsl2 = memFs({
            [`${ROOT}/materials.xml`]: MATERIALS, [`${ROOT}/geometry.xml`]: GEOMETRY,
            [`${ROOT}/settings.xml`]: SETTINGS.replace('eigenvalue', 'fixed source').replace(/<source[\s\S]*?<\/source>/, ''),
        });
        const r2 = validateWorkspace({ language: 'openmc-xml', rootPath: `${ROOT}/settings.xml`, fs: fsl2 });
        assert.ok(r2.diagnostics.some((d) => d.code === 'workspace.no-source'));
    });

    test('the real IFE spherical-shell run directory validates clean', function () {
        const dir = 'C:/Users/calho/GitHub/AaronOwenRS/ife-neutronics/openmc/runs/official/spherical_shells_flinak_5050_target1042_low_estimate_official_2026-07-14_5e6';
        if (!fs.existsSync(path.join(dir, 'geometry.xml'))) { this.skip(); return; }
        const real: FileSystemLike = {
            exists: (p) => fs.existsSync(p), read: (p) => fs.readFileSync(p, 'utf8'),
            list: (d) => fs.readdirSync(d), mtime: (p) => fs.statSync(p).mtimeMs,
        };
        const r = validateWorkspace({ language: 'openmc-xml', rootPath: path.join(dir, 'geometry.xml'), fs: real });
        assert.strictEqual(r.summary.errors, 0, JSON.stringify(r.diagnostics.filter((d) => d.severity === 'error')));
        assert.strictEqual(r.files.length, 5);
        assert.ok(r.verified.some((v) => /model.xml agrees/.test(v)));
        assert.ok(r.verified.some((v) => /quick geometry sample/.test(v)), 'vacuum sphere: nothing lost');
    });
});

suite('OWEN workspace validation — Serpent, SCONE, MCNP, OpenMC Python', () => {
    test('Serpent: missing include, unknown material, unknown therm, missing acelib', () => {
        const fsl = memFs({
            [`${ROOT}/main.sss`]: ['include "geom.sss"', 'include "nope.sss"', 'mat fuel -10.4 moder lwtr 1001 92235.09c 1', 'set acelib "/nowhere/x.xsdata"', 'set pop 1000 100 20'].join('\n'),
            [`${ROOT}/geom.sss`]: ['surf s1 cyl 0 0 0.4', 'surf s2 sqc 0 0 0.63', 'cell c1 0 fuel -s1', 'cell c2 0 watr s1 -s2', 'cell c3 0 outside s2'].join('\n'),
        });
        const r = validateWorkspace({ language: 'serpent', rootPath: `${ROOT}/main.sss`, fs: fsl });
        const codes = r.diagnostics.map((d) => d.code);
        assert.ok(codes.includes('workspace.include-missing'), codes.join(','));
        const mat = r.diagnostics.find((d) => d.code === 'workspace.unknown-material')!;
        assert.ok(mat && mat.file.endsWith('geom.sss') && /watr/.test(mat.message), JSON.stringify(mat));
        assert.ok(codes.includes('workspace.unknown-therm'));
        assert.ok(codes.includes('workspace.library-missing'));
        assert.ok(r.files.some((f) => f.role.startsWith('included by') && f.exists));
        assert.ok(r.verified.some((v) => /include file/.test(v)));
    });

    test('Serpent BEAVRS prebuilt is coherent', () => {
        const real: FileSystemLike = { exists: (p) => fs.existsSync(p), read: (p) => fs.readFileSync(p, 'utf8'), list: (d) => fs.readdirSync(d), mtime: () => 0 };
        const r = validateWorkspace({ language: 'serpent', rootPath: path.join(PREBUILT_MODELS, 'beavrs_fullcore_serpent.sss'), fs: real });
        assert.strictEqual(r.summary.errors, 0, JSON.stringify(r.diagnostics.filter((d) => d.severity === 'error').slice(0, 3)));
        assert.ok(r.verified.length >= 4);
    });

    test('SCONE: unknown material in a pinUniverse and an unmapped universe are caught; shadowed overlaps are informational', () => {
        const scone = [
            'nuclearData { handles { ce { type aceNeutronDatabase; aceLibrary /opt/lib.xsfile; } } materials { fuel { temp 600; composition { 92235.06 1.0; } } water { temp 600; composition { 1001.06 2.0; 8016.06 1.0; } } } }',
            'geometry { type geometryStd; boundary (0 0 0 0 0 0);',
            ' surfaces { s1 { id 1; type box; origin (0 0 0); halfwidth (1 1 1); } }',
            ' cells { }',
            ' universes {',
            '   root { id 1; type rootUniverse; border 1; fill u<2>; }',
            '   pin { id 2; type pinUniverse; radii (0.4 0.0); fills (fuel wafer); }',
            '   lat { id 3; type latUniverse; shape (2 2 0); pitch (1 1 0); padMat water; map (2 2 2 9); }',
            ' } }',
        ].join('\n');
        const fsl = memFs({ [`${ROOT}/in.scone`]: scone });
        const r = validateWorkspace({ language: 'scone', rootPath: `${ROOT}/in.scone`, fs: fsl });
        const codes = r.diagnostics.map((d) => d.code);
        assert.ok(codes.includes('workspace.unknown-material'), codes.join(','));
        assert.ok(r.diagnostics.some((d) => d.code === 'workspace.unknown-universe' && /u<9>/.test(d.message)));
        assert.ok(r.notes.some((n) => /POSIX path/.test(n)));
    });

    test('SCONE BEAVRS prebuilt: no errors, no list-order overlaps, nothing lost', () => {
        // The bundled deck used to write core as (-5) over the barrel and one
        // water annulus under the four shield panels; SCONE resolved both by
        // list order. They are written explicitly now (core -7, four water
        // sectors), so the shadowing information is gone and must stay gone.
        const real: FileSystemLike = { exists: (p) => fs.existsSync(p), read: (p) => fs.readFileSync(p, 'utf8'), list: (d) => fs.readdirSync(d), mtime: () => 0 };
        const r = validateWorkspace({ language: 'scone', rootPath: path.join(PREBUILT_MODELS, 'beavrs_fullcore_scone.scone'), fs: real });
        assert.strictEqual(r.summary.errors, 0, JSON.stringify(r.diagnostics.filter((d) => d.severity === 'error').slice(0, 3)));
        assert.ok(!r.diagnostics.some((d) => d.code === 'workspace.geometry-shadowed'), JSON.stringify(r.diagnostics.filter((d) => d.code === 'workspace.geometry-shadowed')));
        assert.ok(!r.diagnostics.some((d) => d.code === 'workspace.geometry-sample'), 'no lost or overlapping samples');
    });

    test('SCONE list-order overlaps are reported as information, not as lost particles', () => {
        const scone = [
            'type eigenPhysicsPackage;',
            'geometry { type geometryStd; boundary (0 0 0 0 0 0); graph { type shrunk; }',
            '  surfaces {',
            '    out { id 1; type zCylinder; origin (0 0 0); radius 10; }',
            '    mid { id 2; type zCylinder; origin (0 0 0); radius 5; }',
            '  }',
            '  cells {',
            '    inner { type simpleCell; id 1; surfaces (-1); filltype mat; material Water; }',   // written as the whole disc
            '    ring  { type simpleCell; id 2; surfaces (-1 2); filltype mat; material Steel; }', // shadowed by cell 1
            '  }',
            '  universes {',
            '    root { id 1; type rootUniverse; border 1; fill u<2>; }',
            '    body { id 2; type cellUniverse; cells (1 2); }',
            '  }',
            '}',
            'nuclearData { handles { ce { type aceNeutronDatabase; aceLibrary ./lib.xsfile; } }',
            '  materials { Water { temp 300; composition { 1001.03 0.0667; 8016.03 0.0333; } } Steel { temp 300; composition { 26056.03 0.08; } } } }',
        ].join('\n');
        const fsl = memFs({ [`${ROOT}/in.scone`]: scone });
        const r = validateWorkspace({ language: 'scone', rootPath: `${ROOT}/in.scone`, fs: fsl });
        assert.strictEqual(r.summary.errors, 0, JSON.stringify(r.diagnostics.filter((d) => d.severity === 'error')));
        const sh = r.diagnostics.find((d) => d.code === 'workspace.geometry-shadowed');
        assert.ok(sh && sh.severity === 'information', JSON.stringify(r.diagnostics));
        assert.ok(/1 & 2/.test(sh!.message), sh!.message);
    });

    test('MCNP single file: cross-file symbol table passes, and the report says it is single-file', () => {
        const real: FileSystemLike = { exists: (p) => fs.existsSync(p), read: (p) => fs.readFileSync(p, 'utf8'), list: (d) => fs.readdirSync(d), mtime: () => 0 };
        const r = validateWorkspace({ language: 'mcnp', rootPath: path.join(PREBUILT_MODELS, 'beavrs_fullcore_mcnp.i'), fs: real });
        assert.strictEqual(r.summary.errors, 0);
        assert.ok(r.notes[0].includes('Single-file'));
    });

    test('OpenMC Python: local import resolution, stale exports, and the XML checks ride along', () => {
        const py = ['import openmc', 'from materials_lib import fuel', 'import numpy as np', 'model = openmc.Model()'].join('\n');
        const fsl = memFs(
            {
                [`${ROOT}/deck.py`]: py, [`${ROOT}/materials_lib.py`]: 'import openmc\nfuel = openmc.Material()',
                [`${ROOT}/materials.xml`]: MATERIALS, [`${ROOT}/geometry.xml`]: GEOMETRY, [`${ROOT}/settings.xml`]: SETTINGS,
            },
            { 'deck.py': 9000, 'materials.xml': 1000, 'geometry.xml': 1000, 'settings.xml': 1000 },
        );
        const r = validateWorkspace({ language: 'openmc', rootPath: `${ROOT}/deck.py`, fs: fsl });
        assert.ok(r.verified.some((v) => /local module import/.test(v)));
        assert.ok(r.files.some((f) => f.role.includes('materials_lib')));
        assert.ok(r.diagnostics.some((d) => d.code === 'workspace.export-stale'));
        assert.ok(r.verified.some((v) => /exported XML: .*cell→material/.test(v)));
    });
});

suite('OWEN Geometry Check — boundary domains and first-wins overlaps', () => {
    test('points beyond an OpenMC vacuum boundary are outside, not lost', () => {
        const model = parseDeckToModel(GEOMETRY, 'openmc')!;
        assert.ok(domainPredicate(model), 'a vacuum surface defines the domain');
        const r = checkGeometry(model, { samples: 3000, seed: 1 });
        assert.strictEqual(r.world.lost, 0, `lost ${r.world.lost}`);
        assert.ok(r.world.outside > 0, 'box corners outside the sphere are counted as outside');
        assert.ok(r.boundedDomain);
        assert.strictEqual(r.universes[0].gapHits, 0);
    });

    test('without any boundary surface the same corners are genuinely lost', () => {
        const model = parseDeckToModel(GEOMETRY.replace(' boundary="vacuum"', ''), 'openmc')!;
        assert.strictEqual(domainPredicate(model), null);
        const r = checkGeometry(model, { samples: 3000, seed: 1 });
        assert.ok(r.world.lost > 0);
    });

    test('first-wins semantics keep the overlap list but mark it as legal', () => {
        const text = [
            'geometry { type geometryStd; boundary (0 0 0 0 0 0); graph { type shrunk; }',
            '  surfaces { out { id 1; type zCylinder; origin (0 0 0); radius 10; } mid { id 2; type zCylinder; origin (0 0 0); radius 5; } }',
            '  cells {',
            '    inner { type simpleCell; id 1; surfaces (-1); filltype mat; material Water; }',
            '    ring  { type simpleCell; id 2; surfaces (-1 2); filltype mat; material Steel; }',
            '  }',
            '  universes { root { id 1; type rootUniverse; border 1; fill u<2>; } body { id 2; type cellUniverse; cells (1 2); } }',
            '}',
        ].join('\n');
        const model = parseDeckToModel(text, 'scone')!;
        const r = checkGeometry(model, { samples: 1500, seed: 7, overlapSemantics: 'first-wins' });
        assert.ok(r.overlaps.length >= 1, 'the shadowed ring is still listed');
        assert.strictEqual(r.overlapSemantics, 'first-wins');
        assert.ok(r.notes.some((n) => /list order/.test(n)));
    });

    test('the bundled SCONE BEAVRS deck has no overlaps, gaps or lost points at all', function () {
        this.timeout(20000);
        const text = fs.readFileSync(path.join(PREBUILT_MODELS, 'beavrs_fullcore_scone.scone'), 'utf8');
        const model = parseDeckToModel(text, 'scone')!;
        const r = checkGeometry(model, { samples: 1500, seed: 7, overlapSemantics: 'first-wins' });
        assert.strictEqual(r.overlaps.length, 0, JSON.stringify(r.overlaps.slice(0, 3)));
        assert.strictEqual(r.world.lost, 0);
        // Unplaced universes (withdrawn control-rod stacks) are skipped, not
        // reported as gaps; placed universes only have to cover their container.
        assert.ok(r.universes.every((u) => !u.gapHits), JSON.stringify(r.universes.filter((u) => u.gapHits).map((u) => [u.id, u.gapHits])));
        assert.ok(r.universes.some((u) => /unused universe/.test(u.skipped ?? '')));
    });
});
