// Adversarial tests: hang/OOM bombs from a single malformed deck.
//
// In-process ports of the adversarial audit's probe scripts
// (adversarial/probe-hangs.js, probe-selfref.js from the v0.3.4 audit).
// Each case previously OOM'd or hung the extension host; post-fix they must
// complete fast. The elapsed-time assertions are generous (CI machines vary)
// but orders of magnitude below the failure mode (which was minutes/OOM).
import * as assert from 'assert';
import { parseMcnp } from '../../preview/codes/mcnp';
import { parseSerpent } from '../../preview/codes/serpent';
import { parseScone } from '../../preview/codes/scone';
import { parseOpenmc } from '../../preview/codes/openmc';
import { buildMcnpReferenceIndex } from '../../references/mcnpReferences';

function timed<T>(fn: () => T, budgetMs: number, label: string): T {
    const t0 = Date.now();
    const result = fn();
    const dt = Date.now() - t0;
    assert.ok(dt < budgetMs, `${label} took ${dt}ms (budget ${budgetMs}ms)`);
    return result;
}

suite('ADV hang/OOM bombs', function () {
    this.timeout(30000);

    test('MCNP fill repeat bomb (1 2000000000r) is capped, not expanded', () => {
        const deck = [
            '101 1 -10.4 -1 u=1 imp:n=1',
            '500 0 -10 11 -12 13 lat=1 u=5 fill=0:1 0:1 0:0 1 2000000000r imp:n=1',
            '900 0 -10 11 -12 13 fill=5 imp:n=1',
            '1 cz 0.41',
            '10 px 0.63',
            '11 px -0.63',
            '12 py 0.63',
            '13 py -0.63',
            'm1 92235.80c 1.0',
        ].join('\n');
        const r = timed(() => parseMcnp(deck), 10000, 'mcnp repeat bomb');
        assert.ok(Array.isArray(r.cylinders));
    });

    test('references-index repeat bomb (rebuilds on typing) is capped', () => {
        const deck = [
            '101 1 -10.4 -1 u=1 imp:n=1',
            '500 0 -10 11 -12 13 lat=1 u=5 fill=0:1 0:1 0:0 1 2000000000r imp:n=1',
            '1 cz 0.41',
            'm1 92235.80c 1.0',
        ].join('\n');
        const idx = timed(() => buildMcnpReferenceIndex(deck), 10000, 'refs repeat bomb');
        assert.strictEqual(idx.lattices.length, 1);
    });

    test('normal fill repeats still expand exactly (289 entries)', () => {
        const deck = [
            '101 1 -10.4 -1 u=1 imp:n=1',
            '500 0 -10 11 -12 13 lat=1 u=5 fill=-8:8 -8:8 0:0 1 288r imp:n=1',
            '1 cz 0.41',
            'm1 92235.80c 1.0',
        ].join('\n');
        const idx = buildMcnpReferenceIndex(deck);
        assert.strictEqual(idx.lattices[0]?.universeCounts.get(1), 289);
    });

    test('SCONE giant shape (100000 x 100000) is rejected with a warning', () => {
        const deck = [
            'pin { id 3; type pinUniverse; radii (0.41 0.0); fills (fuel water); }',
            'lat { id 2; type latUniverse; shape (100000 100000 1); pitch (1.26 1.26 0.0); map ( 3 ); }',
        ].join('\n');
        const r = timed(() => parseScone(deck), 10000, 'scone shape bomb');
        assert.ok(Array.isArray(r.cylinders));
        assert.ok((r.warnings ?? []).some((w) => /too large/i.test(w)), `expected size warning: ${JSON.stringify(r.warnings)}`);
    });

    test('Serpent giant lat header (1e9 x 1e9) caps rows to available data', () => {
        const deck = [
            'pin fp',
            'fuel 0.41',
            'water',
            'lat core 1 0.0 0.0 1000000000 1000000000 1.26',
            'fp fp',
        ].join('\n');
        const r = timed(() => parseSerpent(deck), 10000, 'serpent lat bomb');
        assert.ok(Array.isArray(r.cylinders));
    });

    test('MCNP self-referential lattice (u=5 grid contains 5) terminates', () => {
        const row = new Array(17).fill('5').join(' ');
        const deck = [
            '101 1 -10.4 -1 u=1 imp:n=1',
            `500 0 -10 11 -12 13 lat=1 u=5 fill=-8:8 -8:8 0:0 ${new Array(17).fill(row).join(' ')} imp:n=1`,
            '900 0 -10 11 -12 13 fill=5 imp:n=1',
            '1 cz 0.41',
            '10 px 0.63',
            '11 px -0.63',
            '12 py 0.63',
            '13 py -0.63',
            'm1 92235.80c 1.0',
        ].join('\n');
        const r = timed(() => parseMcnp(deck), 10000, 'mcnp self-lattice');
        assert.ok(Array.isArray(r.cylinders));
    });

    test('MCNP mutually-referential lattices (5 <-> 6) terminate', () => {
        const rowA = new Array(17).fill('6').join(' ');
        const rowB = new Array(17).fill('5').join(' ');
        const deck = [
            '101 1 -10.4 -1 u=1 imp:n=1',
            `500 0 -10 11 -12 13 lat=1 u=5 fill=-8:8 -8:8 0:0 ${new Array(17).fill(rowA).join(' ')} imp:n=1`,
            `600 0 -10 11 -12 13 lat=1 u=6 fill=-8:8 -8:8 0:0 ${new Array(17).fill(rowB).join(' ')} imp:n=1`,
            '900 0 -10 11 -12 13 fill=5 imp:n=1',
            '1 cz 0.41',
            '10 px 0.63',
            '11 px -0.63',
            '12 py 0.63',
            '13 py -0.63',
            'm1 92235.80c 1.0',
        ].join('\n');
        const r = timed(() => parseMcnp(deck), 10000, 'mcnp mutual lattice');
        assert.ok(Array.isArray(r.cylinders));
    });

    test('Serpent self-referential lattice (core grid contains core) terminates', () => {
        const rows: string[] = [];
        for (let i = 0; i < 17; i++) rows.push(new Array(17).fill('core').join(' '));
        const deck = [
            'pin fp',
            'fuel 0.41',
            'water',
            'lat core 1 0.0 0.0 17 17 1.26',
            ...rows,
        ].join('\n');
        const r = timed(() => parseSerpent(deck), 10000, 'serpent self-lattice');
        assert.ok(Array.isArray(r.cylinders));
    });

    test('SCONE lattice referencing itself in the map terminates', () => {
        const map = new Array(17 * 17).fill('2').join(' ');
        const deck = [
            'pin { id 3; type pinUniverse; radii (0.41 0.0); fills (fuel water); }',
            `lat { id 2; type latUniverse; shape (17 17 1); pitch (1.26 1.26 0.0); map ( ${map} ); }`,
        ].join('\n');
        const r = timed(() => parseScone(deck), 10000, 'scone self-lattice');
        assert.ok(Array.isArray(r.cylinders));
    });

    test('OpenMC self-referential comprehension lattice terminates', () => {
        const deck = [
            'import openmc',
            'lat = openmc.RectLattice()',
            'lat.pitch = (1.26, 1.26)',
            'lat.universes = [[lat, lat], [lat, lat]]',
        ].join('\n');
        const r = timed(() => parseOpenmc(deck), 10000, 'openmc self-lattice');
        assert.ok(Array.isArray(r.cylinders));
    });

    test('OpenMC np.full bomb (30000 x 30000) stays bounded', () => {
        const deck = [
            'import openmc',
            'fuel_pin = openmc.Universe()',
            'arr = np.full((30000, 30000), fuel_pin)',
            'lat = openmc.RectLattice()',
            'lat.universes = arr',
        ].join('\n');
        const r = timed(() => parseOpenmc(deck), 15000, 'openmc numpy bomb');
        assert.ok(Array.isArray(r.cylinders));
    });

    test('MCNP fill grid at the 5M guard boundary stays usable in disc mode', () => {
        const deck = [
            '101 1 -10.4 -1 u=1 imp:n=1',
            '500 0 -10 11 -12 13 lat=1 u=5 fill=0:2235 0:2235 0:0 1 4999695r imp:n=1',
            '900 0 -10 11 -12 13 fill=5 imp:n=1',
            '1 cz 0.41',
            '10 px 0.63',
            '11 px -0.63',
            '12 py 0.63',
            '13 py -0.63',
            'm1 92235.80c 1.0',
        ].join('\n');
        const r = timed(() => parseMcnp(deck, { detail: 'disc' }), 25000, 'mcnp 5M grid');
        assert.ok(Array.isArray(r.cylinders));
    });
});
