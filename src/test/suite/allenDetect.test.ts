import * as assert from 'assert';
import { detectNuclides } from '../../allen/detectNuclides';

suite('ALLEN detectNuclides', () => {
    test('detects MCNP ZAIDs from m-card', () => {
        const text = `c fuel
m1  92235.80c  -4.8
    92238.80c  -0.2
`;
        const found = detectNuclides(text, 'mcnp');
        assert.ok(found.includes('U235'));
        assert.ok(found.includes('U238'));
    });

    test('detects OpenMC nuclides from add_nuclide', () => {
        const text = `import openmc
fuel = openmc.Material()
fuel.add_nuclide('Pu239', 0.01)
fuel.add_nuclide('U238', 0.99)
`;
        const found = detectNuclides(text, 'python');
        assert.ok(found.includes('Pu239'));
        assert.ok(found.includes('U238'));
    });

    test('falls back to U235/U238 when nothing found', () => {
        const found = detectNuclides('empty deck', 'mcnp');
        assert.deepStrictEqual(found, ['U235', 'U238']);
    });
});
