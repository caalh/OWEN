import * as assert from 'assert';
import { buildAdapterPayload, classifyAdapterError } from '../../converter/adapterCommand';

// Real traceback captured from the BEAVRS full-core run against
// openmc_mcnp_adapter git main + OpenMC 0.15.3 (WSL, 2026-09-16).
const NESTED_LATTICE_TRACEBACK = `
Traceback (most recent call last):
  File "<string>", line 1, in <module>
    import sys; from openmc_mcnp_adapter.openmc_conversion import mcnp_to_openmc; sys.argv = [...]; mcnp_to_openmc()
  File "/home/x/.local/lib/python3.13/site-packages/openmc_mcnp_adapter/openmc_conversion.py", line 903, in mcnp_to_openmc
    model = mcnp_to_model(args.mcnp_filename, args.merge_surfaces, args.expand_elements)
  File "/home/x/.local/lib/python3.13/site-packages/openmc_mcnp_adapter/openmc_conversion.py", line 922, in mcnp_to_model
    openmc_universes = get_openmc_universes(cells, openmc_surfaces, data)
  File "/home/x/.local/lib/python3.13/site-packages/openmc_mcnp_adapter/openmc_conversion.py", line 825, in get_openmc_universes
    lattice.universes = lat_univ[..., ::-1, :]
  File "/opt/miniconda3/lib/python3.13/site-packages/openmc/lattice.py", line 498, in universes
    cv.check_iterable_type('lattice universes', universes, openmc.UniverseBase, min_depth=2, max_depth=5)
  File "/opt/miniconda3/lib/python3.13/site-packages/openmc/checkvalue.py", line 118, in check_iterable_type
    raise TypeError(msg)
TypeError: Error setting lattice universes: Items must be of type "UniverseBase", but item at [2, 6] is of type "RectLattice".
`;

suite('OWEN adapter — classifyAdapterError', () => {
    test('BEAVRS nested-lattice traceback classifies as nested-lattice', () => {
        const c = classifyAdapterError(NESTED_LATTICE_TRACEBACK);
        assert.strictEqual(c.kind, 'nested-lattice');
        assert.match(c.summary, /adapter cannot place a lattice inside another lattice/i);
        assert.match(c.summary, /OWEN's built-in converter/i);
    });

    test('HexLattice variant also classifies as nested-lattice', () => {
        const t = 'TypeError: Error setting lattice universes: Items must be of type "UniverseBase", but item at [0, 0] is of type "HexLattice".';
        assert.strictEqual(classifyAdapterError(t).kind, 'nested-lattice');
    });

    test('Missing OpenMC package classifies distinctly from a broken adapter', () => {
        const t = 'ModuleNotFoundError: No module named \'openmc\'';
        assert.strictEqual(classifyAdapterError(t).kind, 'openmc-missing');
    });

    test('Unrecognized traceback returns kind: unknown with an empty summary', () => {
        const c = classifyAdapterError('KeyError: 42');
        assert.strictEqual(c.kind, 'unknown');
        assert.strictEqual(c.summary, '');
    });

    test('Stdout is also inspected — some adapters print the traceback there', () => {
        const c = classifyAdapterError('', NESTED_LATTICE_TRACEBACK);
        assert.strictEqual(c.kind, 'nested-lattice');
    });
});

suite('OWEN adapter — buildAdapterPayload', () => {
    test('MCNP payload escapes single quotes and backslashes', () => {
        const p = buildAdapterPayload('mcnp', 'C:\\path\\it\'s.i', '/out/model.xml');
        assert.ok(p.includes("from openmc_mcnp_adapter.openmc_conversion import mcnp_to_openmc"));
        // Every backslash is doubled and every single-quote is escaped so the
        // Python string round-trips through the -c argv literal.
        assert.ok(p.includes("C:\\\\path\\\\it\\'s.i"));
        assert.ok(p.includes("/out/model.xml"));
        assert.ok(p.trim().endsWith('mcnp_to_openmc()'));
    });

    test('Serpent payload chdirs to the output directory and renames model.xml', () => {
        const p = buildAdapterPayload('serpent', '/deck/x.sss', '/out/final.xml');
        assert.ok(p.includes("from openmc_serpent_adapter.serpent_conversion import main"));
        assert.ok(p.includes("os.chdir('/out')"));
        assert.ok(p.includes("os.replace('model.xml', 'final.xml')"));
    });
});
