import * as assert from 'assert';
import { runValidators } from '../../validation/validator';

suite('OWEN validator', () => {
    test('MCNP: flags S(α,β) on a material with no hydrogen', () => {
        const text = [
            'c bad: lwtr on UO2 fuel',
            'm1   92235.80c   0.04',
            '     92238.80c   0.96',
            '     8016.80c    2.0',
            'mt1  lwtr.20t',
        ].join('\n');
        const diags = runValidators('mcnp', text);
        assert.ok(diags.some((d) => d.code === 'mcnp.sab-no-target'),
            `expected mcnp.sab-no-target diagnostic, got: ${JSON.stringify(diags.map((d) => d.code))}`);
    });

    test('MCNP: accepts HEX, which is a documented alias for RHP', () => {
        const text = '10 hex 0 0 0  0 0 10  5 0 0';
        const diags = runValidators('mcnp', text);
        assert.ok(!diags.some((d) => d.code === 'mcnp.macrobody'),
            'HEX must not be flagged');
    });

    test('OpenMC: flags deprecated openmc.Source(', () => {
        const text = [
            'import openmc',
            'src = openmc.Source(space=openmc.stats.Box((-1,-1,-1),(1,1,1)))',
        ].join('\n');
        const diags = runValidators('openmc', text);
        assert.ok(diags.some((d) => d.code === 'openmc.source'),
            'expected openmc.source diagnostic');
    });

    test('Serpent: flags surf rect', () => {
        const text = 'surf 1 rect -1 1 -1 1';
        const diags = runValidators('serpent', text);
        assert.ok(diags.some((d) => d.code === 'serpent.surf-rect'),
            'expected serpent.surf-rect diagnostic');
    });

    test('SCONE: flags aceNuclearDatabase typo and pinUniverse mismatch', () => {
        const text = [
            'nuclearData {',
            '  handles { ce { type aceNuclearDatabase; } }',
            '  materials {',
            '    fuelPin { id 100; type pinUniverse;',
            '              radii (0.4 0.5);',
            '              fills (UO2 Helium Water); }',
            '  }',
            '}',
        ].join('\n');
        const diags = runValidators('scone', text);
        assert.ok(diags.some((d) => d.code === 'scone.ace-typo'),
            'expected scone.ace-typo diagnostic');
        assert.ok(
            diags.some((d) => d.code === 'scone.pin-len' || d.code === 'scone.pin-outer'),
            'expected scone.pin-len or scone.pin-outer diagnostic',
        );
    });
});
