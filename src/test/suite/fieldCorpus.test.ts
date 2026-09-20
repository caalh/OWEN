import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FIXTURES } from '../paths';
import { resolveProject, nodeProjectFs } from '../../util/projectLoader';
import { parseDeckToModel } from '../../preview/engineDispatch';
import { parseMcnpGeometry } from '../../preview/mcnpGeometry';
import { parseOpenmcGeometryXml } from '../../preview/openmcGeometry';
import { findCell } from '../../preview/mcnpEvaluate';
import { buildCellMap } from '../../cellmap/model';
import { buildCellMapFromGeometry } from '../../cellmap/fromGeometry';
import { checkGeometry } from '../../geomcheck/core';
import { buildScene } from '../../preview/extractor';
import { OPENMC_PLACEHOLDER_WARNING } from '../../preview/codes/openmc';
import { validateWorkspace } from '../../workspace/core';
import { validateMcnpProject } from '../../../packages/mcnp-workspace/src/validate';

const CORPUS = path.join(FIXTURES, 'field-corpus');

suite('OpenMC lattices vs openmc.Geometry.find() (frozen oracle)', () => {
    // Points and answers were produced by OpenMC 0.15.3 itself
    // (fixtures/field-corpus/openmc-oracle/make_oracle.py, WSL). If the hex
    // ring order, orientation, axial order or rect row order regresses, these
    // disagree.
    const ORACLE = path.join(CORPUS, 'openmc-oracle');
    for (const name of fs.existsSync(ORACLE) ? fs.readdirSync(ORACLE) : []) {
        const dir = path.join(ORACLE, name);
        if (!fs.existsSync(path.join(dir, 'oracle.json'))) continue;
        test(`${name}: every sampled point lands in the material OpenMC reports`, () => {
            const xml = fs.readFileSync(path.join(dir, 'geometry.xml'), 'utf8') + '\n' + fs.readFileSync(path.join(dir, 'materials.xml'), 'utf8');
            const model = parseOpenmcGeometryXml(xml);
            assert.deepStrictEqual(model.warnings, []);
            const oracle = JSON.parse(fs.readFileSync(path.join(dir, 'oracle.json'), 'utf8')) as { points: [number, number, number, number | null][] };
            const bad: string[] = [];
            for (const [x, y, z, mid] of oracle.points) {
                const f = findCell(model, [x, y, z]);
                const ours = f.cell && !f.lost ? f.cell.material : null;
                if (ours !== (mid ?? null) && bad.length < 5) bad.push(`(${x}, ${y}, ${z}) ours=${ours} openmc=${mid}`);
            }
            assert.deepStrictEqual(bad, [], `${bad.length}+ of ${oracle.points.length} disagree`);
        });
    }

    test('a hex_lattice XML draws its rings in 3D (not an empty stage) and Cell Map places the lattice', () => {
        const dir = path.join(CORPUS, 'openmc-hex');
        const xml = fs.readFileSync(path.join(dir, 'materials.xml'), 'utf8') + '\n' + fs.readFileSync(path.join(dir, 'geometry.xml'), 'utf8');
        const scene = buildScene(xml, 'openmc');
        assert.ok(scene.cylinders.length >= 19, `expected ≥19 pin primitives for 3 rings, got ${scene.cylinders.length}`);
        const geom = parseOpenmcGeometryXml(xml);
        const map = buildCellMapFromGeometry(geom, 'openmc');
        assert.deepStrictEqual(map.warnings.filter((w) => /no cell declares|nothing fills/.test(w)), [], map.warnings.join(' | '));
        assert.ok(map.universes.some((u) => u.id === 5 && u.name === 'hex-core'), 'lattice name survives');
    });
});

suite('project loader — split files (the Lubomír failure)', () => {
    test('MCNP READ: without expansion the pin universe is undeclared; with it, Cell Map and Check Geometry see u=1', () => {
        const root = path.join(CORPUS, 'mcnp-read', 'main.i');
        const raw = fs.readFileSync(root, 'utf8');
        const dangling = buildCellMap(raw);
        assert.ok(
            dangling.warnings.some((w) => /fills with u=1, but no cell declares/.test(w)),
            dangling.warnings.join(' | '),
        );

        const resolved = resolveProject({ rootPath: root, language: 'mcnp', fs: nodeProjectFs });
        assert.ok(resolved.files.some((f) => f.path.endsWith('pins.i')), JSON.stringify(resolved.files));
        assert.ok(/u=1/.test(resolved.text), 'joined text must contain the pin universe');
        const geom = parseMcnpGeometry(resolved.text);
        const map = buildCellMapFromGeometry(geom, 'mcnp');
        assert.ok(!map.warnings.some((w) => /no cell declares/.test(w)), map.warnings.join(' | '));
        assert.ok(map.universes.some((u) => u.id === 1 && !u.orphan), JSON.stringify(map.universes));
        const chk = checkGeometry(geom, { samples: 800, seed: 3 });
        assert.ok(chk.universes.some((u) => u.id === 1), JSON.stringify(chk.universes.map((u) => u.id)));
    });

    test('Serpent include: pin F is missing until the include is expanded', () => {
        const root = path.join(CORPUS, 'serpent-include', 'main.sss');
        const raw = fs.readFileSync(root, 'utf8');
        const lonely = parseDeckToModel(raw, 'serpent')!;
        const lonelyMap = buildCellMapFromGeometry(lonely, 'serpent');
        assert.ok(
            lonelyMap.warnings.some((w) => /no cell declares/.test(w))
                || !lonely.cells.size
                || lonelyMap.warnings.some((w) => /Universe/.test(w)),
            `expected a dangling fill before expansion; cells=${lonely.cells.size} warn=${lonelyMap.warnings.join(' | ')}`,
        );

        const resolved = resolveProject({ rootPath: root, language: 'serpent', fs: nodeProjectFs });
        assert.ok(resolved.files.some((f) => /pins\.sss$/i.test(f.path)));
        assert.ok(/\bpin\s+F\b/.test(resolved.text));
        const geom = parseDeckToModel(resolved.text, 'serpent')!;
        assert.ok(geom.cells.size >= 2, `cells=${geom.cells.size}`);
        const map = buildCellMapFromGeometry(geom, 'serpent');
        assert.ok(!map.warnings.some((w) => /no cell declares/.test(w)), map.warnings.join(' | '));
    });

    test('OpenMC Python + sibling module: resolveProject concatenates the import', () => {
        const root = path.join(CORPUS, 'openmc-split', 'main.py');
        const resolved = resolveProject({ rootPath: root, language: 'openmc', fs: nodeProjectFs });
        assert.ok(resolved.files.some((f) => /geometry\.py$/i.test(f.path)));
        assert.ok(/ZCylinder/.test(resolved.text), 'imported geometry.py must be in the joined text');
        const scene = buildScene(resolved.text, 'openmc');
        assert.ok(
            !scene.warnings.includes(OPENMC_PLACEHOLDER_WARNING),
            scene.warnings.join(' | '),
        );
        assert.ok(scene.cylinders.length >= 1, `cylinders=${scene.cylinders.length}`);
    });

    test('OpenMC hex_lattice is named, not an unknown universe', () => {
        const root = path.join(CORPUS, 'openmc-hex', 'geometry.xml');
        const text = fs.readFileSync(root, 'utf8');
        const geom = parseDeckToModel(text, 'openmc')!;
        const map = buildCellMapFromGeometry(geom, 'openmc');
        const dangling = map.warnings.filter((w) => /no cell declares/.test(w));
        assert.deepStrictEqual(dangling, [], dangling.join(' | ') + ' :: ' + geom.warnings.join(' | '));
    });

    test('non-lattice MCNP CSG renders through the exact engine, not a missing-pin warning', () => {
        const root = path.join(CORPUS, 'mcnp-csg', 'spheres.i');
        const text = fs.readFileSync(root, 'utf8');
        const scene = buildScene(text, 'mcnp');
        assert.ok(
            !scene.warnings.some((w) => /missing pin universes/.test(w)),
            scene.warnings.join(' | '),
        );
        assert.ok(scene.cylinders.length >= 1 || scene.notes.some((n) => /Exact-geometry engine/.test(n)),
            `cyl=${scene.cylinders.length} notes=${scene.notes.join(' | ')} warn=${scene.warnings.join(' | ')}`);
    });

    test('DAGMC universe is named, not an unknown fill', () => {
        const root = path.join(CORPUS, 'openmc-dagmc', 'geometry.xml');
        const text = fs.readFileSync(root, 'utf8');
        const geom = parseDeckToModel(text, 'openmc')!;
        assert.ok(geom.warnings.some((w) => /DAGMC/i.test(w)), geom.warnings.join(' | '));
        const map = buildCellMapFromGeometry(geom, 'openmc');
        assert.deepStrictEqual(
            map.warnings.filter((w) => /no cell declares/.test(w)),
            [],
            map.warnings.join(' | '),
        );
        assert.ok(map.universes.some((u) => /dagmc/i.test(u.name ?? '')), JSON.stringify(map.universes));
    });

    test('Serpent nest is named, not invented as a universe', () => {
        const root = path.join(CORPUS, 'serpent-nest', 'main.sss');
        const geom = parseDeckToModel(fs.readFileSync(root, 'utf8'), 'serpent')!;
        assert.ok(geom.warnings.some((w) => /\bnest\b/i.test(w)), geom.warnings.join(' | '));
        assert.ok(
            [...(geom.names?.universes.values() ?? [])].some((n) => n === 'pinstack'),
            'nest name must be registered so fills are not unknown universes',
        );
    });

    test('Serpent vertical stack (lat type 9) expands into z layers and a lattice of columns draws', () => {
        const root = path.join(CORPUS, 'serpent-stack', 'main.sss');
        const text = fs.readFileSync(root, 'utf8');
        const geom = parseDeckToModel(text, 'serpent')!;
        assert.ok(!geom.warnings.some((w) => /not expanded/.test(w)), geom.warnings.join(' | '));
        // Bottom 5 cm is the steel plug, 5–45 cm fuel, above 45 cm the Zirc plenum.
        const matAt = (z: number): string => {
            const f = findCell(geom, [0.63, 0.63, z]);
            assert.ok(f.cell && !f.lost, `point z=${z} resolves`);
            return geom.names?.materials.get(f.cell!.material) ?? String(f.cell!.material);
        };
        assert.strictEqual(matAt(2.0), 'steel');
        assert.strictEqual(matAt(20.0), 'UO2');
        assert.strictEqual(matAt(50.0), 'Zirc');
        const scene = buildScene(text, 'serpent');
        assert.ok(scene.cylinders.length > 0, 'a stack lattice must draw, not an empty stage');
        // The instanced primitives must carry the real material names, not all
        // collapse into "Structure" (field-day Sep 2026: one pink column).
        const sceneMats = new Set(scene.cylinders.map((c) => c.material).filter(Boolean));
        assert.ok(sceneMats.has('UO2'), `fuel material named in scene: ${[...sceneMats].join(', ')}`);
        assert.ok(
            new Set(scene.cylinders.map((c) => c.component)).size > 1,
            'stack must span more than one layer category (fuel vs structure vs coolant)',
        );
        // And each primitive must be clipped to its layer band, not drawn over
        // the full column (field-day Sep 2026 retest: full-height steel + fuel
        // + Zirc stacked on top of each other). Steel plug 0–5, fuel 5–45.
        const zSpan = (c: { z: number; height: number }): [number, number] => [c.z - c.height / 2, c.z + c.height / 2];
        for (const c of scene.cylinders.filter((c) => c.material === 'steel')) {
            const [lo, hi] = zSpan(c);
            assert.ok(lo > -0.01 && hi < 5.01, `steel plug clipped to its layer, got z=${lo}..${hi}`);
        }
        for (const c of scene.cylinders.filter((c) => c.material === 'UO2')) {
            const [lo, hi] = zSpan(c);
            assert.ok(lo > 4.99 && hi < 45.01, `fuel clipped to its layer, got z=${lo}..${hi}`);
        }
        const map = buildCellMapFromGeometry(geom, 'serpent');
        assert.deepStrictEqual(map.warnings.filter((w) => /no cell declares/.test(w)), []);
    });

    test('Serpent: an unsupported lat type is a named skip, a truly undefined fill stays a warning', () => {
        const deck = [
            'surf s1 cuboid -5 5 -5 5 -5 5',
            'cell a 0 fill clus -s1',
            'cell b 0 outside s1',
            'lat clus 4 0.0 0.0 1',
            '6 2.0 0.0 F F F F F F',
            'pin F',
            'fuel 0.4',
            'water',
            'mat fuel -10 92235.80c 1',
            'mat water -1 1001.80c 2 8016.80c 1',
        ].join('\n');
        const geom = parseDeckToModel(deck, 'serpent')!;
        assert.ok(geom.warnings.some((w) => /lat clus: lattice type 4/.test(w)), geom.warnings.join(' | '));
        const map = buildCellMapFromGeometry(geom, 'serpent');
        assert.deepStrictEqual(map.warnings.filter((w) => /no cell declares/.test(w)), [], 'named skip is not an unknown universe');

        const dangling = parseDeckToModel(deck.replace('fill clus', 'fill nothere'), 'serpent')!;
        const dmap = buildCellMapFromGeometry(dangling, 'serpent');
        assert.ok(dmap.warnings.some((w) => /no cell declares/.test(w)), 'a fill of an undefined universe must still warn');
    });

    test('MCNP LIKE n BUT cells exist on the Cell Map (complements of them are not dangling)', () => {
        const text = fs.readFileSync(path.join(CORPUS, 'mcnp-csg', 'showcase.i'), 'utf8');
        const map = buildCellMap(text);
        assert.deepStrictEqual(map.warnings.filter((w) => /complements #(10|11|18)/.test(w)), [], map.warnings.join(' | '));
        const c10 = map.cells.find((c) => c.id === 10);
        assert.ok(c10, 'cell 10 (LIKE 1 BUT trcl) is a node');
        assert.strictEqual(c10!.material, 1, 'copies the source material');
        assert.ok(c10!.hasTrcl, 'BUT trcl=(…) is applied');
    });

    test('MCNP 3D lattice with u=-n (untruncated) and a k-range fill', () => {
        const text = fs.readFileSync(path.join(CORPUS, 'mcnp-lat3d', 'stack.i'), 'utf8');
        const geom = parseDeckToModel(text, 'mcnp')!;
        const map = buildCellMapFromGeometry(geom, 'mcnp');
        assert.deepStrictEqual(map.warnings.filter((w) => /no cell declares/.test(w)), [], map.warnings.join(' | '));
        // The lattice cell lists its z planes first, then y, then x, so i runs
        // along z, j along y and k along x (§5.5.5 — the same order Tinkertoy
        // uses). k=0 (x≈0) block: j=0 row is "1 2 1", so i=0 (z≈0) → u=2
        // (paraffin) and i=+1 (z≈30) → u=1 (HEU); k=+1 (x≈30), j=0, i=0 → u=1.
        assert.strictEqual(findCell(geom, [0, 0, 0]).cell?.material, 2);
        assert.strictEqual(findCell(geom, [0, 0, 30]).cell?.material, 1);
        assert.strictEqual(findCell(geom, [30, 0, 0]).cell?.material, 1);
        const ws = validateMcnpProject({ rootPath: path.join(CORPUS, 'mcnp-lat3d', 'stack.i') });
        assert.deepStrictEqual(ws.diagnostics.filter((d) => /undefined-universe/.test(d.code)), [], 'u=-1 is universe 1');
    });

    test('MCNP `+n` white-boundary surface card defines surface n for the workspace validator', () => {
        const deck = [
            'white boundary pin',
            '1 1 -10.4 -1 imp:n=1',
            '2 2 -1.0 1 -4 imp:n=1',
            '3 0 4 imp:n=0',
            '',
            '1 cz 0.4',
            '+4 cz 0.7',
            '',
            'mode n',
            'm1 92235.80c 1',
            'm2 1001.80c 2 8016.80c 1',
        ].join('\n');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owen-white-'));
        const p = path.join(dir, 'pin.i');
        fs.writeFileSync(p, deck);
        try {
            const ws = validateMcnpProject({ rootPath: p });
            assert.deepStrictEqual(ws.diagnostics.filter((d) => /undefined-surface/.test(d.code)), [], JSON.stringify(ws.diagnostics));
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('SCONE rootUniverse with a bare material fill and a spherical border: box corners are outside, not lost', () => {
        const deck = [
            'type eigenPhysicsPackage;',
            'geometry {',
            '  type geometryStd;',
            '  boundary (0 0 0 0 0 0);',
            '  surfaces { sph { id 1; type sphere; origin (0 0 0); radius 6.39; } }',
            '  cells {}',
            '  universes { root { id 1; type rootUniverse; border 1; fill fuel; } }',
            '}',
            'nuclearData { materials { fuel { temp 300; composition { 94239.03 1.0; } } } }',
        ].join('\n');
        const geom = parseDeckToModel(deck, 'scone')!;
        const border = geom.surfaces.get(1)!;
        assert.strictEqual(border.boundary, 'vacuum');
        const chk = checkGeometry(geom, { samples: 600, seed: 3 });
        assert.strictEqual(chk.world.lost, 0, `lost ${chk.world.lost} of ${chk.world.samples}`);
    });

    test('OpenMC zero-padded ids (`id="01"`) resolve in the workspace inventory', () => {
        const geometry = '<geometry><surface id="1" type="sphere" coeffs="0 0 0 5" boundary="vacuum"/><cell id="1" material="1" region="-1"/></geometry>';
        const materials = '<materials><material id="01"><density value="1" units="g/cm3"/><nuclide name="H1" ao="1"/></material></materials>';
        const settings = '<settings><run_mode>fixed source</run_mode><particles>10</particles><batches>2</batches><source><space type="point"><parameters>0 0 0</parameters></space></source></settings>';
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owen-ids-'));
        fs.writeFileSync(path.join(dir, 'geometry.xml'), geometry);
        fs.writeFileSync(path.join(dir, 'materials.xml'), materials);
        fs.writeFileSync(path.join(dir, 'settings.xml'), settings);
        const fsLike = {
            exists: (p: string) => fs.existsSync(p),
            read: (p: string) => fs.readFileSync(p, 'utf8'),
            list: (d: string) => fs.readdirSync(d),
            mtime: (p: string) => fs.statSync(p).mtimeMs,
        };
        try {
            const report = validateWorkspace({ language: 'openmc-xml', rootPath: path.join(dir, 'geometry.xml'), fs: fsLike });
            assert.deepStrictEqual(report.diagnostics.filter((d) => d.code === 'workspace.unknown-material'), [], JSON.stringify(report.diagnostics));
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('SCONE latUniverse map ids are defined universes', () => {
        const root = path.join(CORPUS, 'scone-lat', 'core.scone');
        const geom = parseDeckToModel(fs.readFileSync(root, 'utf8'), 'scone')!;
        const map = buildCellMapFromGeometry(geom, 'scone');
        assert.deepStrictEqual(
            map.warnings.filter((w) => /no cell declares/.test(w)),
            [],
            map.warnings.join(' | '),
        );
        assert.ok(geom.cells.size >= 2, `cells=${geom.cells.size}`);
    });
});
