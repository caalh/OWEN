import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { REPO_ROOT } from '../paths';

suite('3D preview picking at BEAVRS scale', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'src', 'preview', 'webview.ts'), 'utf8');

    test('hover is never hard-disabled by instance count', () => {
        assert.ok(!/totalInstances > 40000\) return/.test(src),
            'the old 40k hover kill-switch must stay gone — the grid pick path replaced it');
        assert.ok(/buildPickGrid/.test(src), 'plan-view pick grid exists');
        assert.ok(/rayHitInstance/.test(src), 'analytic ray-instance hit test exists');
        assert.ok(/pickAtFast/.test(src), 'fast pick path exists');
    });

    test('hover picking is frame-throttled, not per-event', () => {
        assert.ok(/hoverRaf = requestAnimationFrame/.test(src), 'pointermove hover runs at most once per frame');
    });

    test('click inspects when no measure tool is active', () => {
        const up = src.slice(src.indexOf("addEventListener('pointerup'"), src.indexOf("addEventListener('pointerup'") + 900);
        assert.ok(/setHover\(pick\)/.test(up), 'a plain click pins the readout');
    });

    test('grid pick respects layer visibility and rebuilds with the scene', () => {
        assert.ok(/isInstanceVisible\(inst\)\) return;/.test(src), 'hidden instances are not pickable via the grid');
        const render = src.slice(src.indexOf('totalInstances = groups.reduce'), src.indexOf('totalInstances = groups.reduce') + 200);
        assert.ok(/buildPickGrid\(\);/.test(render), 'grid is rebuilt whenever the scene is rebuilt');
    });
});

suite('OWEN 3D preview mesh', () => {
    test('annular cylinders are extruded rings, not open-ended outer tubes', () => {
        const src = fs.readFileSync(path.join(REPO_ROOT, 'src', 'preview', 'webview.ts'), 'utf8');
        assert.ok(src.includes('function annularCylinderGeometry'), 'missing ring extrude helper');
        assert.ok(src.includes('s.holes.push(hole)'), 'ring must punch an inner hole');
        assert.ok(src.includes('function sphericalShellGeometry'), 'spherical shells need a lathe, not a solid ball');
        assert.ok(
            !/CylinderGeometry\(grp\.r, grp\.r, grp\.h, grp\.segs, 1, !grp\.solid\)/.test(src),
            'openEnded CylinderGeometry ignores innerRadius and draws a wireframe cage',
        );
    });
});
