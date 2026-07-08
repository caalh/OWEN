import * as assert from 'assert';
import * as path from 'path';
import { validateMcnpProject } from '../validate';
import { mcnpCrossReferenceDiagnostics } from '../crossReference';

const FIXTURES = path.resolve(__dirname, '../../../../test/fixtures/mcnp-workspace');

function fixtureDir(name: string): string {
    return path.join(FIXTURES, name);
}

function countCode(result: ReturnType<typeof validateMcnpProject>, code: string): number {
    return result.diagnostics.filter((d) => d.code === code).length;
}

describe('mcnp-workspace fixtures', () => {
    it('ok/ → 0 errors', () => {
        const r = validateMcnpProject({ rootPath: path.join(fixtureDir('ok'), 'main.inp') });
        assert.strictEqual(r.summary.errors, 0, JSON.stringify(r.diagnostics));
        assert.ok(r.files.length >= 3);
    });

    it('beavrs-lite/ → 0 errors', () => {
        const r = validateMcnpProject({ rootPath: path.join(fixtureDir('beavrs-lite'), 'main.inp') });
        assert.strictEqual(r.summary.errors, 0, JSON.stringify(r.diagnostics));
    });

    it('bad-surface/ → undefined surface on main file', () => {
        const r = validateMcnpProject({ rootPath: path.join(fixtureDir('bad-surface'), 'main.inp') });
        assert.ok(countCode(r, 'mcnp.undefined-surface') >= 1);
        const main = r.diagnostics.find((d) => d.code === 'mcnp.undefined-surface' && d.file.endsWith('main.inp'));
        assert.ok(main, 'error should be on main.inp cell referencing surface 99');
    });

    it('dup-surface/ → duplicate surface', () => {
        const r = validateMcnpProject({ rootPath: path.join(fixtureDir('dup-surface'), 'main.inp') });
        assert.ok(countCode(r, 'mcnp.duplicate-surface') >= 1);
    });

    it('missing-include/ → include not found', () => {
        const r = validateMcnpProject({ rootPath: path.join(fixtureDir('missing-include'), 'main.inp') });
        assert.ok(countCode(r, 'mcnp.include-not-found') >= 1);
    });

    it('cycle/ → include cycle', () => {
        const r = validateMcnpProject({ rootPath: path.join(fixtureDir('cycle'), 'a.i') });
        assert.ok(countCode(r, 'mcnp.include-cycle') >= 1);
    });

    it('single-file deck unchanged (no undefined errors on clean deck)', () => {
        const deck = [
            '1 1 -10.4 -1 imp:n=1',
            '1 cz 0.4096',
            'm1 92235.80c 1.0',
        ].join('\n');
        const diags = mcnpCrossReferenceDiagnostics(deck);
        assert.ok(!diags.some((d) => d.severity === 'error'));
    });
});
