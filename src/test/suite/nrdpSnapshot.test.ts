import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { materialsFromJson } from '../../commands/insertMaterial';
import { REPO_ROOT } from '../paths';

const snapshotPath = path.join(REPO_ROOT, 'data', 'nrdp-materials.json');

suite('NRDP material snapshot', () => {
    const raw = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    const materials = materialsFromJson(raw);
    // Void is an entry with no composition on purpose: MCNP writes material 0 on
    // the cell card, so there is nothing to insert. The picker filters it out.
    const withCards = materials!.filter((m) => (m as { source?: string }).source !== 'void');

    test('reader takes both the published array and a wrapped payload', () => {
        assert.strictEqual(materialsFromJson([{ slug: 'a' }])?.length, 1);
        assert.strictEqual(materialsFromJson({ materials: [{ slug: 'a' }] })?.length, 1);
        assert.strictEqual(materialsFromJson({ citation: 'PNNL-15870' }), null);
        assert.strictEqual(materialsFromJson(null), null);
        assert.strictEqual(materialsFromJson('[]'), null);
    });

    test('bundled snapshot is the shape reactormc.net publishes', () => {
        assert.ok(Array.isArray(raw), 'the published payload is a bare array');
        assert.ok(materials && materials.length >= 40, 'snapshot carries the curated set');
    });

    test('every material carries a card for all four codes', () => {
        for (const m of withCards) {
            for (const field of ['mcnpCode', 'serpentCode', 'openmcCode', 'sconeCode'] as const) {
                const code = m[field];
                assert.ok(code && code.trim().length > 0, `${m.slug} has ${field}`);
            }
        }
    });

    test('cards are ASCII and fit an 80-column card image', () => {
        for (const m of withCards) {
            for (const field of ['mcnpCode', 'serpentCode', 'sconeCode'] as const) {
                for (const line of (m[field] as string).split('\n')) {
                    assert.ok(line.length <= 80, `${m.slug} ${field}: ${line.length} columns`);
                    for (let i = 0; i < line.length; i++) {
                        const cp = line.codePointAt(i)!;
                        assert.ok(cp >= 0x20 && cp <= 0x7e, `${m.slug} ${field}: non-ASCII U+${cp.toString(16)}`);
                    }
                }
            }
        }
    });

    test('no card names a table ENDF/B-VII.1 does not ship', () => {
        for (const m of withCards) {
            assert.ok(!/\b8018\./.test(m.mcnpCode), `${m.slug} names O18, which has no .80c table`);
            assert.ok(!/\b6012\./.test(m.mcnpCode), `${m.slug} names C12; elemental 6000 is the only carbon`);
        }
    });

    test('SCONE blocks are atom densities, not fractions', () => {
        for (const m of withCards) {
            const values = [...(m.sconeCode as string).matchAll(/^\s*\d+\.\d\d\s+([\d.eE+-]+);/gm)]
                .map((match) => Number(match[1]));
            assert.ok(values.length > 0, `${m.slug} has composition entries`);
            const total = values.reduce((a, b) => a + b, 0);
            // A weight or atom fraction set sums to 1. Atoms/barn-cm for a solid
            // lands near 1e-1 and for a gas far below that, so a total anywhere
            // near unity is the fractions bug this guards against.
            assert.ok(total > 0 && total < 0.4, `${m.slug} SCONE total ${total} is not an atom density`);
        }
    });
});
