import * as assert from 'assert';
import * as path from 'path';
import { validateMcnpProject } from '../../../../packages/mcnp-workspace/src/validate';

const FIXTURES = path.resolve(__dirname, '../../../../test/fixtures/mcnp-workspace');

suite('MCNP workspace validation (shared package)', () => {
    test('ok fixture has zero errors', () => {
        const r = validateMcnpProject({ rootPath: path.join(FIXTURES, 'ok', 'main.inp') });
        assert.strictEqual(r.summary.errors, 0);
    });

    test('bad-surface flags undefined surface in main.inp', () => {
        const r = validateMcnpProject({ rootPath: path.join(FIXTURES, 'bad-surface', 'main.inp') });
        assert.ok(r.diagnostics.some((d) => d.code === 'mcnp.undefined-surface' && d.file.endsWith('main.inp')));
    });
});
