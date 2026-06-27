import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { buildScene } from '../../preview/extractor';
import { GeometryScene } from '../../preview/types';

// End-to-end parity checks on the bundled BEAVRS full-core decks. The v0.2.9
// fix makes the OpenMC preview reconstruct each pin's real axial column (from
// the deck's `_SHELLS` / `STACKS` / `R[key]` tables) so its z-extent, band
// count and per-band materials match the MCNP / Serpent / SCONE translations
// instead of collapsing to a short, radially-uniform slab. These tests pin the
// fix and guard the other three codes against regression.

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const MODELS_DIR = path.join(REPO_ROOT, 'prebuilt-models');

function loadDeck(filename: string): string {
    return fs.readFileSync(path.join(MODELS_DIR, filename), 'utf8');
}

function drawnZExtent(scene: GeometryScene): [number, number] {
    let zmin = Infinity;
    let zmax = -Infinity;
    for (const c of scene.cylinders) {
        if (c.component === 'vessel') continue;
        const h = c.height || 0;
        zmin = Math.min(zmin, (c.z ?? 0) - h / 2);
        zmax = Math.max(zmax, (c.z ?? 0) + h / 2);
    }
    return [zmin, zmax];
}

const DECKS: Record<'mcnp' | 'openmc' | 'serpent' | 'scone', string> = {
    mcnp: 'beavrs_fullcore_mcnp.i',
    openmc: 'beavrs_fullcore_openmc.py',
    serpent: 'beavrs_fullcore_serpent.sss',
    scone: 'beavrs_fullcore_scone.scone',
};

suite('BEAVRS full-core axial parity (v0.2.9 OpenMC fix)', () => {
    test('OpenMC collapsed core spans the full assembly height (0 → 460 cm)', () => {
        const scene = buildScene(loadDeck(DECKS.openmc), 'openmc', { detail: 'disc', axial: false });
        const [zmin, zmax] = drawnZExtent(scene);
        assert.ok(Math.abs(zmin - 0) < 0.5, `expected OpenMC bottom ≈ 0, got ${zmin}`);
        assert.ok(Math.abs(zmax - 460) < 0.5, `expected OpenMC top ≈ 460, got ${zmax}`);
    });

    test('OpenMC axial extent now matches MCNP / Serpent (was a 40 cm slab)', () => {
        const omc = buildScene(loadDeck(DECKS.openmc), 'openmc', { detail: 'disc', axial: true });
        const mcnp = buildScene(loadDeck(DECKS.mcnp), 'mcnp', { detail: 'disc', axial: true });
        const serpent = buildScene(loadDeck(DECKS.serpent), 'serpent', { detail: 'disc', axial: true });

        const [omcMin, omcMax] = drawnZExtent(omc);
        const [mMin, mMax] = drawnZExtent(mcnp);
        const [sMin, sMax] = drawnZExtent(serpent);

        // Within 1 cm of the MCNP translation top/bottom (same SCONE source).
        assert.ok(Math.abs(omcMax - mMax) < 1.0, `OpenMC top ${omcMax} vs MCNP ${mMax}`);
        assert.ok(Math.abs(omcMax - sMax) < 1.0, `OpenMC top ${omcMax} vs Serpent ${sMax}`);
        assert.ok(Math.abs(omcMin - mMin) < 1.0, `OpenMC bottom ${omcMin} vs MCNP ${mMin}`);
        assert.ok(Math.abs(omcMin - sMin) < 1.0, `OpenMC bottom ${omcMin} vs Serpent ${sMin}`);
        // The bug: OpenMC used to render a 40 cm tall slab. The full active +
        // structural stack is > 400 cm tall.
        assert.ok(omcMax - omcMin > 400, `expected a full-height stack, got span ${(omcMax - omcMin).toFixed(1)}`);
    });

    test('OpenMC axial expansion recovers a reasonable number of bands', () => {
        const omc = buildScene(loadDeck(DECKS.openmc), 'openmc', { detail: 'disc', axial: true });
        assert.ok(omc.fidelity.hasAxial, 'expected OpenMC BEAVRS to be detected as axial');
        assert.ok(omc.fidelity.axial, 'expected axial detail to engage within the instance budget');
        // The deck has 8 grid spacers + plena + end plugs + nozzles → ~25-36
        // distinct elevations; require a healthy band count (was 0 / collapsed).
        assert.ok(omc.axialLayers.length >= 20, `expected ≥20 axial bands, got ${omc.axialLayers.length}`);
    });

    test('OpenMC axial bands carry distinct structural materials (grid / plenum / nozzle / end plug)', () => {
        const omc = buildScene(loadDeck(DECKS.openmc), 'openmc', { detail: 'layers', axial: true });
        const mats = new Set(omc.cylinders.map((c) => c.material));
        const comps = new Set(omc.cylinders.map((c) => c.component));

        // Enrichment zones survive as separate fuel materials.
        assert.ok(mats.has('UO2-16'), 'expected the 1.6% fuel zone');
        assert.ok(mats.has('UO2-24'), 'expected the 2.4% fuel zone');
        assert.ok(mats.has('UO2-31'), 'expected the 3.1% fuel zone');
        // Structural bands the old uniform-water expansion was missing.
        assert.ok(mats.has('Inconel'), 'expected Inconel (grid spacers + plenum springs)');
        assert.ok(mats.has('StainlessSteel304'), 'expected stainless-steel nozzle / structure bands');
        assert.ok(mats.has('Zircaloy'), 'expected Zircaloy clad / end-plug bands');

        assert.ok(comps.has('fuel'), 'expected fuel');
        assert.ok(comps.has('grid'), 'expected grid-spacer bands');
        assert.ok(comps.has('plenum'), 'expected plenum bands');
        assert.ok(comps.has('end_plug'), 'expected end-plug / nozzle bands');
    });

    test('does not regress MCNP / Serpent / SCONE axial extents', () => {
        for (const code of ['mcnp', 'serpent', 'scone'] as const) {
            const collapsed = buildScene(loadDeck(DECKS[code]), code, { detail: 'disc', axial: false });
            const [czmin, czmax] = drawnZExtent(collapsed);
            assert.ok(Math.abs(czmin - 0) < 0.5, `${code} collapsed bottom ${czmin}`);
            assert.ok(Math.abs(czmax - 460) < 0.5, `${code} collapsed top ${czmax}`);

            const axial = buildScene(loadDeck(DECKS[code]), code, { detail: 'disc', axial: true });
            const [zmin, zmax] = drawnZExtent(axial);
            assert.ok(zmax - zmin > 400, `${code} axial span ${(zmax - zmin).toFixed(1)}`);
            assert.ok(Math.abs(zmax - 431.876) < 0.5, `${code} axial top ${zmax}`);
        }
    });
});
