import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { buildScene } from '../../preview/extractor';

// Headless render checks on the bundled reflected pin-cell teaching decks
// (v0.3.6). All four decks model the SAME system (BEAVRS 3.1 wt% UO2 pin,
// pellet 0.39218 / clad OR 0.45720, pitch 1.26, height 365.76), so each must
// produce a non-trivial scene with the fuel pellet and clad shells present.

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const MODELS_DIR = path.join(REPO_ROOT, 'prebuilt-models');

const DECKS: Record<'mcnp' | 'openmc' | 'serpent' | 'scone', string> = {
    mcnp: 'pincell_mcnp.i',
    openmc: 'pincell_openmc.py',
    serpent: 'pincell_serpent.sss',
    scone: 'pincell_scone.scone',
};

function loadDeck(filename: string): string {
    return fs.readFileSync(path.join(MODELS_DIR, filename), 'utf8');
}

const FUEL_R = 0.39218;
const CLAD_R = 0.4572;

suite('Reflected pin-cell prebuilt models (v0.3.6)', () => {
    for (const code of ['mcnp', 'openmc', 'serpent', 'scone'] as const) {
        test(`${code} pin cell renders a non-trivial scene`, () => {
            const scene = buildScene(loadDeck(DECKS[code]), code);
            assert.ok(scene.cylinders.length >= 2,
                `expected at least fuel + clad shells, got ${scene.cylinders.length}`);
            assert.ok(scene.cylinders.some((c) => Math.abs(c.radius - FUEL_R) < 1e-3),
                `expected the ${FUEL_R} cm fuel pellet shell`);
            assert.ok(scene.cylinders.some((c) => Math.abs(c.radius - CLAD_R) < 1e-3),
                `expected the ${CLAD_R} cm clad shell`);
        });
    }

    test('serpent + scone pin cells classify fuel and clad components', () => {
        for (const code of ['serpent', 'scone'] as const) {
            const scene = buildScene(loadDeck(DECKS[code]), code);
            const comps = new Set(scene.cylinders.map((c) => c.component));
            assert.ok(comps.has('fuel'), `${code}: expected a fuel component, got ${[...comps].join(', ')}`);
            assert.ok(comps.has('clad'), `${code}: expected a clad component, got ${[...comps].join(', ')}`);
        }
    });

    test('17x17 assembly decks still render full lattices (regression)', () => {
        const assemblies: Array<['mcnp' | 'openmc' | 'serpent', string]> = [
            ['mcnp', 'assembly_17x17_mcnp.i'],
            ['openmc', 'assembly_17x17_openmc.py'],
            ['serpent', 'assembly_17x17_serpent.sss'],
        ];
        for (const [code, file] of assemblies) {
            const scene = buildScene(loadDeck(file), code);
            assert.ok(scene.cylinders.length > 200,
                `${file}: expected a full 17x17 lattice, got ${scene.cylinders.length} cylinders`);
            const comps = new Set(scene.cylinders.map((c) => c.component));
            assert.ok(comps.has('fuel'), `${file}: expected fuel pins`);
            assert.ok(comps.has('guide_tube'), `${file}: expected guide tubes`);
        }
    });

    test('all four decks agree on the fuel pellet radius (cross-code parity)', () => {
        for (const code of ['mcnp', 'openmc', 'serpent', 'scone'] as const) {
            const scene = buildScene(loadDeck(DECKS[code]), code);
            const radii = scene.cylinders.map((c) => c.radius);
            assert.ok(radii.some((r) => Math.abs(r - FUEL_R) < 1e-3),
                `${code}: fuel pellet radius ${FUEL_R} missing (radii: ${radii.slice(0, 8).join(', ')})`);
        }
    });
});
