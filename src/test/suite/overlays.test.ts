import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { PREBUILT_MODELS } from '../paths';
import { extractOverlays, mcnpOverlays, openmcOverlays, sconeOverlays, serpentOverlays } from '../../preview/overlays';
import { buildScene } from '../../preview/extractor';

suite('OWEN preview overlays — sources and tallies', () => {
    test('MCNP: ksrc points, sdef pos, fmesh box with divisions and continuation lines', () => {
        const deck = [
            'title',
            '1 0 -1 imp:n=1',
            '2 0  1 imp:n=0',
            '',
            '1 so 100',
            '',
            'kcode 1000 1 10 50',
            'ksrc 0 0 0  10 0 0',
            '     0 10 0',
            'sdef pos=1 2 3 erg=2',
            'fmesh4:n geom=xyz origin=-10 -10 -50',
            '     imesh=10 iints=20',
            '     jmesh=0 10 jints=10 10',
            '     kmesh=50 kints=5',
        ].join('\n');
        const ov = mcnpOverlays(deck);
        const pts = ov.filter((o) => o.kind === 'point');
        assert.strictEqual(pts.length, 4, JSON.stringify(ov));
        assert.deepStrictEqual(pts.slice(0, 3).map((p) => [p.x, p.y, p.z]), [[0, 0, 0], [10, 0, 0], [0, 10, 0]]);
        assert.deepStrictEqual([pts[3].x, pts[3].y, pts[3].z, pts[3].label], [1, 2, 3, 'sdef pos']);
        const box = ov.find((o) => o.kind === 'box')!;
        assert.strictEqual(box.label, 'fmesh4');
        assert.deepStrictEqual([box.x, box.y, box.z, box.x2, box.y2, box.z2], [-10, -10, -50, 10, 10, 50]);
        assert.deepStrictEqual([box.nx, box.ny, box.nz], [20, 20, 5], 'jints sums to 20 over two jmesh bands');
    });

    test('MCNP: a bare sdef is a point at the origin; sdef with a cell/surface distribution is not drawn', () => {
        assert.strictEqual(mcnpOverlays('t\n1 0 -1\n\n1 so 1\n\nsdef')[0]?.label, 'sdef (origin)');
        assert.strictEqual(mcnpOverlays('t\n1 0 -1\n\n1 so 1\n\nsdef cel=1 x=d1 y=d2 z=d3').length, 0);
    });

    test('OpenMC: stats.Point and stats.Box with variables, RegularMesh from attributes', () => {
        const py = [
            'import openmc',
            'h = 100.0',
            'r = 0.4',
            "src = openmc.IndependentSource(space=openmc.stats.Point((0, 0, h/2)))",
            'box = openmc.stats.Box([-r, -r, 0], [r, r, h])',
            'mesh = openmc.RegularMesh()',
            'mesh.dimension = [17, 17, 1]',
            'mesh.lower_left = (-10.71, -10.71, 0.0)',
            'mesh.upper_right = (10.71, 10.71, h)',
        ].join('\n');
        const ov = openmcOverlays(py);
        const pt = ov.find((o) => o.kind === 'point')!;
        assert.deepStrictEqual([pt.x, pt.y, pt.z], [0, 0, 50]);
        const sbox = ov.find((o) => o.group === 'source' && o.kind === 'box')!;
        assert.deepStrictEqual([sbox.x, sbox.y, sbox.z, sbox.x2, sbox.y2, sbox.z2], [-0.4, -0.4, 0, 0.4, 0.4, 100]);
        const mesh = ov.find((o) => o.group === 'tally')!;
        assert.strictEqual(mesh.label, 'RegularMesh mesh');
        assert.deepStrictEqual([mesh.nx, mesh.ny, mesh.nz], [17, 17, 1]);
        assert.strictEqual(mesh.z2, 100);
    });

    test('OpenMC: an expression it cannot evaluate is skipped, not misdrawn', () => {
        const ov = openmcOverlays('import openmc\np = openmc.stats.Point((core.x, 0, 0))');
        assert.strictEqual(ov.length, 0);
    });

    test('Serpent: src sp point, src box, det dx/dy/dz mesh', () => {
        const deck = [
            'src 1 n sp 0.0 0.0 10.0',
            'src 2 n sx -1 1 sy -1 1 sz 0 20',
            'det d1 dx -10 10 20 dy -10 10 20 dz 0 100 1',
            'det d2 dz 0 100 10',
            'set pop 1000 100 20',
        ].join('\n');
        const ov = serpentOverlays(deck);
        assert.deepStrictEqual(ov.map((o) => o.label), ['src 1 sp', 'src 2 box', 'det d1', 'det d2']);
        const d1 = ov[2];
        assert.deepStrictEqual([d1.x, d1.x2, d1.nx, d1.nz], [-10, 10, 20, 1]);
        assert.ok(ov[3].x! < -100 && ov[3].x2! > 100, 'an axial-only det spans the radial extent');
    });

    test('SCONE: pointSource r (x y z)', () => {
        const ov = sconeOverlays('source { type pointSource; r (1.0 2.0 3.0); E 1.0; }');
        assert.deepStrictEqual([ov[0].x, ov[0].y, ov[0].z], [1, 2, 3]);
    });

    test('buildScene carries overlays and never throws on them', () => {
        const text = fs.readFileSync(path.join(PREBUILT_MODELS, 'pincell_mcnp.i'), 'utf8');
        const scene = buildScene(text, 'mcnp');
        assert.ok(Array.isArray(scene.overlays));
        assert.ok(scene.overlays.some((o) => o.group === 'source'), 'the pin cell has a ksrc');
        assert.deepStrictEqual(extractOverlays('garbage', 'unknown'), []);
    });
});
