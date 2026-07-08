import * as assert from 'assert';
import {
    cellWizardCard,
    hasHydrogen,
    latticeWizardCard,
    materialWizardCard,
    sabAllowed,
    settingsWizardCard,
    sourceWizardCard,
    surfaceWizardCard,
} from '../../inputBuilder/wizards';
import { validateSnippet } from '../../inputBuilder/snippetValidator';

suite('Input Builder wizards', () => {
    test('materialWizardCard MCNP weight fractions are negative', () => {
        const card = materialWizardCard({
            code: 'mcnp',
            matNumber: 3,
            name: 'Test water',
            densityMode: 'weight',
            density: 0.997,
            fractionMode: 'weight',
            components: [
                { zaid: '1001', label: 'H', fraction: 0.111 },
                { zaid: '8016', label: 'O', fraction: 0.889 },
            ],
            sab: 'lwtr.20t',
        });
        assert.match(card, /m3\s+1001\.80c\s+-0\.111000/);
        assert.match(card, /mt3\s+lwtr\.20t/);
    });

    test('sabAllowed rejects lwtr on non-hydrogen material', () => {
        const comps = [{ zaid: '92235', label: 'U235', fraction: 1 }];
        assert.strictEqual(sabAllowed('lwtr.20t', comps), false);
        assert.strictEqual(hasHydrogen(comps), false);
    });

    test('materialWizardCard warns when SAB on fuel', () => {
        const card = materialWizardCard({
            code: 'mcnp',
            matNumber: 1,
            name: 'UO2',
            densityMode: 'weight',
            density: 10.97,
            fractionMode: 'weight',
            components: [{ zaid: '92235', label: 'U235', fraction: 1 }],
            sab: 'lwtr.20t',
        });
        assert.match(card, /WARNING.*hydrogen/);
        assert.doesNotMatch(card, /mt1/);
    });

    test('surfaceWizardCard RCC pin MCNP macrobody', () => {
        const card = surfaceWizardCard({
            code: 'mcnp',
            surfaceNumber: 5,
            template: 'rcc-pin',
            rcc: { x: 0, y: 0, z: 0, height: 365.76, radius: 0.39218 },
            comment: 'fuel',
        });
        assert.strictEqual(card, '5 rcc 0 0 0 365.76 0.39218  $ fuel');
    });

    test('surfaceWizardCard RPP assembly box OpenMC', () => {
        const card = surfaceWizardCard({
            code: 'openmc',
            surfaceNumber: 10,
            template: 'rpp-box',
            rpp: { xmin: -10, xmax: 10, ymin: -10, ymax: 10, zmin: 0, zmax: 365.76 },
        });
        assert.match(card, /RectangularPrism/);
        assert.match(card, /xmin='-10 cm'/);
    });

    test('cellWizardCard intersection region', () => {
        const card = cellWizardCard({
            code: 'mcnp',
            cellNumber: 10,
            material: 1,
            density: -10.44,
            surfaces: [{ id: 1, sense: '-' }, { id: 4, sense: '-' }, { id: 5, sense: '+' }],
            operator: 'intersection',
            imp: 1,
            comment: 'fuel',
        });
        assert.match(card, /^10\s+1 -10\.44\s+-1 -4 \+5/);
        assert.match(card, /imp:n=1/);
    });

    test('cellWizardCard union uses colon syntax', () => {
        const card = cellWizardCard({
            code: 'mcnp',
            cellNumber: 20,
            material: 'void',
            surfaces: [{ id: 1, sense: '-' }, { id: 2, sense: '+' }],
            operator: 'union',
        });
        assert.match(card, /\(-1:2\)/);
    });

    test('latticeWizardCard square MCNP includes fill block', () => {
        const card = latticeWizardCard({
            code: 'mcnp',
            gridType: 'square',
            nx: 3,
            ny: 3,
            pitch: 1.26,
            fillValue: 1,
        });
        assert.match(card, /lat=1/);
        assert.match(card, /fill=-1:1 -1:1 0:0/);
        assert.match(card, /1 1 1/);
    });

    test('sourceWizardCard MCNP kcode and ksrc', () => {
        const card = sourceWizardCard({
            code: 'mcnp',
            particles: 5000,
            inactive: 30,
            active: 150,
            keffGuess: 1.02,
            x: 0,
            y: 0,
            z: 100,
        });
        assert.match(card, /kcode 5000 1\.02 30 150/);
        assert.match(card, /ksrc 0 0 100/);
    });

    test('settingsWizardCard OpenMC uses IndependentSource pattern indirectly', () => {
        const card = settingsWizardCard({
            code: 'openmc',
            particles: 10000,
            inactive: 50,
            active: 200,
            keffGuess: 1,
            threads: 4,
        });
        assert.match(card, /settings\.batches = 200/);
        assert.match(card, /model\.run\(threads=4\)/);
    });

    test('validateSnippet flags deprecated openmc.Source in generated settings', () => {
        const bad = 'settings.source = openmc.Source()';
        const issues = validateSnippet('openmc', bad);
        assert.ok(issues.some((i) => i.code === 'api-source'));
    });

    test('generated MCNP material passes snippet validation', () => {
        const card = materialWizardCard({
            code: 'mcnp',
            matNumber: 1,
            name: 'Water',
            densityMode: 'weight',
            density: 0.997,
            fractionMode: 'weight',
            components: [
                { zaid: '1001', label: 'H', fraction: 0.111 },
                { zaid: '8016', label: 'O', fraction: 0.889 },
            ],
            sab: 'lwtr.20t',
        });
        const issues = validateSnippet('mcnp', card);
        assert.strictEqual(issues.filter((i) => i.severity === 'error').length, 0);
    });
});
