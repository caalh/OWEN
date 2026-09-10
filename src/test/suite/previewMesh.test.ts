import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { REPO_ROOT } from '../paths';

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
