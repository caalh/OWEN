import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseMcnpReadTargets, buildIncludeGraph } from '../../../packages/mcnp-workspace/src/includeGraph';

suite('MCNP READ / FILE includes (#6)', () => {
    test('parseMcnpReadTargets understands FILE = path with spaces around =', () => {
        assert.deepStrictEqual(parseMcnpReadTargets('read file = material_card.i'), ['material_card.i']);
        assert.deepStrictEqual(parseMcnpReadTargets('read file=material_card.i'), ['material_card.i']);
        assert.deepStrictEqual(parseMcnpReadTargets('READ FILE material_card.i'), ['material_card.i']);
        assert.deepStrictEqual(parseMcnpReadTargets('read echo file = "mats.i"'), ['mats.i']);
        assert.deepStrictEqual(parseMcnpReadTargets('read geom.i'), ['geom.i']);
        assert.deepStrictEqual(parseMcnpReadTargets('read noecho file=foo.i'), ['foo.i']);
        assert.ok(!parseMcnpReadTargets('read file = material_card.i').includes('file'));
        assert.ok(!parseMcnpReadTargets('read file = material_card.i').includes('='));
    });

    test('buildIncludeGraph resolves read file = sibling', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owen-read-'));
        try {
            fs.writeFileSync(path.join(dir, 'material_card.i'), 'm1 92235.80c 1.0\n');
            fs.writeFileSync(path.join(dir, 'input_deck.i'), [
                'read file = material_card.i',
                '1 1 -10.4 -1 imp:n=1',
                '2 0 1 imp:n=0',
                '1 cz 0.4',
                'kcode 100 1 5 10',
            ].join('\n'));
            const g = buildIncludeGraph(path.join(dir, 'input_deck.i'));
            assert.strictEqual(g.errors.filter((e) => e.code === 'mcnp.include-not-found').length, 0, JSON.stringify(g.errors));
            assert.ok([...g.files.keys()].some((f) => f.endsWith('material_card.i')));
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
