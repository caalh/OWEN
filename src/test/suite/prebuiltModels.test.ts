import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

// Pure-logic checks on the bundled prebuilt-models manifest. These do not
// require the VS Code host, so they run headless via tsc + mocha.

type PrebuiltCode = 'mcnp' | 'openmc' | 'serpent' | 'scone';

interface PrebuiltModel {
    id: string;
    name: string;
    code: PrebuiltCode;
    scale: string;
    provenance: string;
    description: string;
    filename: string;
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const MODELS_DIR = path.join(REPO_ROOT, 'prebuilt-models');

function loadManifest(): PrebuiltModel[] {
    const raw = fs.readFileSync(path.join(MODELS_DIR, 'index.json'), 'utf8');
    return JSON.parse(raw) as PrebuiltModel[];
}

suite('OWEN prebuilt models manifest', () => {
    test('manifest is a non-empty array', () => {
        const models = loadManifest();
        assert.ok(Array.isArray(models) && models.length > 0, 'expected at least one model');
    });

    test('every entry has required fields and a valid code', () => {
        const valid: PrebuiltCode[] = ['mcnp', 'openmc', 'serpent', 'scone'];
        for (const m of loadManifest()) {
            assert.ok(m.id, 'missing id');
            assert.ok(m.name, `missing name for ${m.id}`);
            assert.ok(valid.includes(m.code), `invalid code "${m.code}" for ${m.id}`);
            assert.ok(m.scale, `missing scale for ${m.id}`);
            assert.ok(m.provenance, `missing provenance for ${m.id}`);
            assert.ok(m.description, `missing description for ${m.id}`);
            assert.ok(m.filename, `missing filename for ${m.id}`);
        }
    });

    test('ids are unique', () => {
        const ids = loadManifest().map((m) => m.id);
        assert.strictEqual(new Set(ids).size, ids.length, 'duplicate ids in manifest');
    });

    test('every referenced deck file exists and is non-empty', () => {
        for (const m of loadManifest()) {
            const p = path.join(MODELS_DIR, m.filename);
            assert.ok(fs.existsSync(p), `bundled deck missing: ${m.filename}`);
            assert.ok(fs.statSync(p).size > 0, `bundled deck is empty: ${m.filename}`);
        }
    });

    test('ships a verified SCONE BEAVRS full-core deck', () => {
        const scone = loadManifest().find(
            (m) => m.code === 'scone' && m.scale === 'full-core',
        );
        assert.ok(scone, 'expected a SCONE full-core entry');
        assert.strictEqual(scone!.provenance, 'verified');
    });
});
