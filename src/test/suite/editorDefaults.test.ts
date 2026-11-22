import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { REPO_ROOT } from '../paths';

// VS Code's built-in color provider reads any `#` plus three, four, six, or
// eight hex digits as a color. In MCNP and PHITS `#101` is a cell complement,
// and no OWEN language has a color syntax, so the picker it draws is noise
// (reported by Frank Helk, Nov 2026).

interface Manifest {
    contributes: {
        languages: Array<{ id: string }>;
        configurationDefaults: Record<string, Record<string, unknown>>;
    };
}

suite('Editor defaults', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as Manifest;

    test('no OWEN language shows a color picker on a cell complement', () => {
        for (const { id } of manifest.contributes.languages) {
            const scoped = manifest.contributes.configurationDefaults[`[${id}]`];
            assert.ok(scoped, `no configurationDefaults block for [${id}]`);
            assert.strictEqual(scoped['editor.colorDecorators'], false, `[${id}] must turn off editor.colorDecorators`);
        }
    });
});
