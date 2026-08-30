import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { PREBUILT_MODELS } from '../paths';
import { buildCellMap, collectSurfaceSenses, computeUniverseDepths } from '../../cellmap/model';
import { buildCellMapHtml } from '../../cellmap/webview';
import { parseMcnpDeck, parseRegion } from '../../converter/mcnpModel';
import {
    orderedReferenceSites,
    REFERENCE_SITES,
    SCOPE_LABELS,
} from '../../commands/referenceSites';

const PIN_CELL = [
    'Simple pin cell',
    'c cells',
    '1 1 -10.4  -1     imp:n=1  $ fuel',
    '2 2 -6.55   1 -2  imp:n=1  $ clad',
    '3 3 -0.74   2 -3  imp:n=1  $ water',
    '4 0         3     imp:n=0  $ graveyard',
    '',
    '1 cz 0.4096',
    '2 cz 0.4750',
    '*3 rpp -0.63 0.63 -0.63 0.63 -100 100',
    '',
    'mode n',
    'm1 92235.80c 0.04 92238.80c 0.96 8016.80c 2.0',
    'm2 40090.80c 1.0',
    'm3 1001.80c 2.0 8016.80c 1.0',
    'mt3 lwtr.20t',
    'kcode 5000 1.0 20 120',
    'ksrc 0 0 0',
].join('\n');

const cell = (model: ReturnType<typeof buildCellMap>, id: number) => {
    const c = model.cells.find((x) => x.id === id);
    assert.ok(c, `no cell ${id} in model`);
    return c!;
};

suite('OWEN Cell Map — graph model', () => {
    test('flat pin cell lands entirely in the root universe', () => {
        const model = buildCellMap(PIN_CELL);
        assert.strictEqual(model.cells.length, 4);
        assert.strictEqual(model.universes.length, 1);
        assert.strictEqual(model.universes[0].id, 0);
        assert.deepStrictEqual(model.universes[0].cells, [1, 2, 3, 4]);
        assert.strictEqual(model.stats.maxDepth, 0);
        assert.strictEqual(model.edges.length, 0);
    });

    test('roles follow graveyard > lattice > container > void > material', () => {
        const model = buildCellMap(PIN_CELL);
        assert.strictEqual(cell(model, 1).role, 'material');
        // Cell 4 is both void and imp:n=0; the graveyard reading is the useful one.
        assert.strictEqual(cell(model, 4).role, 'graveyard');
        assert.strictEqual(cell(model, 4).importanceZero, true);
        assert.strictEqual(model.stats.graveyards, 1);
    });

    test('density sign is read as MCNP means it', () => {
        const model = buildCellMap(PIN_CELL);
        assert.strictEqual(cell(model, 1).density, -10.4);
        assert.strictEqual(cell(model, 1).densityUnit, 'g/cm3');
        assert.strictEqual(cell(model, 4).density, null);
        assert.strictEqual(cell(model, 4).densityUnit, null);

        const atom = buildCellMap('t\n1 1 0.0603 -1 imp:n=1\n2 0 1 imp:n=0\n\n1 so 5\n\nm1 1001 2\n');
        assert.strictEqual(cell(atom, 1).densityUnit, 'atom/b-cm');
    });

    test('surface senses survive, including a surface used both ways', () => {
        const model = buildCellMap(PIN_CELL);
        assert.deepStrictEqual(
            cell(model, 2).surfaces.map((s) => `${s.sense}${s.id}`),
            ['+1', '-2'],
        );
        assert.strictEqual(cell(model, 1).surfaces[0].summary, 'cz 0.4096');

        const both = collectSurfaceSenses(parseRegion('-1 : 1 -2'));
        assert.deepStrictEqual([...both.get(1)!].sort(), [-1, 1]);
    });

    test('cells across a shared surface are listed as neighbours', () => {
        const model = buildCellMap(PIN_CELL);
        // 1 is inside surface 1, 2 is outside it.
        assert.ok(cell(model, 1).neighbors.includes(2));
        assert.ok(cell(model, 2).neighbors.includes(1));
        assert.ok(cell(model, 2).neighbors.includes(3));
        assert.ok(!cell(model, 1).neighbors.includes(3));
    });

    test('undefined surfaces and dangling complements are flagged, not dropped', () => {
        const model = buildCellMap([
            'broken',
            '1 0  -1 #7  imp:n=1',
            '2 0   1     imp:n=0',
            '',
            '1 so 5',
            '',
            'kcode 100 1 5 20',
        ].join('\n'));
        assert.deepStrictEqual(cell(model, 1).complements, [7]);
        assert.ok(model.edges.some((e) => e.kind === 'complement' && e.from === 1 && e.to === 7));
        assert.ok(model.warnings.some((w) => /complements #7/.test(w)));
    });

    test('a deck with no imp:n=0 is called out', () => {
        const model = buildCellMap('t\n1 0 -1 imp:n=1\n\n1 so 5\n\nkcode 100 1 5 20\n');
        assert.strictEqual(model.stats.graveyards, 0);
        assert.ok(model.warnings.some((w) => /imp:n=0/.test(w)));
    });

    test('a universe nothing fills is reported as dead input', () => {
        const model = buildCellMap([
            'orphan',
            '1 0 -1 u=5 imp:n=1',
            '2 0 -2     imp:n=1',
            '3 0  2     imp:n=0',
            '',
            '1 so 1',
            '2 so 9',
            '',
            'kcode 100 1 5 20',
        ].join('\n'));
        const u5 = model.universes.find((u) => u.id === 5)!;
        assert.strictEqual(u5.orphan, true);
        assert.deepStrictEqual(u5.filledBy, []);
        assert.ok(model.warnings.some((w) => /Universe 5/.test(w)));
    });

    test('fill pointing at a universe no cell declares is a warning', () => {
        const model = buildCellMap([
            'dangling fill',
            '1 0 -1 fill=9 imp:n=1',
            '2 0  1        imp:n=0',
            '',
            '1 so 5',
            '',
            'kcode 100 1 5 20',
        ].join('\n'));
        assert.ok(model.warnings.some((w) => /fills with u=9/.test(w)));
    });

    test('universe depth is the shallowest path from the root', () => {
        const byUni = new Map([
            [0, parseMcnpDeck('t\n1 0 -1 fill=1 imp:n=1\n2 0 -2 fill=2 imp:n=1\n\n1 so 5\n2 so 6\n').cells],
        ]);
        const { depths } = computeUniverseDepths(byUni);
        assert.strictEqual(depths.get(0), 0);
        assert.strictEqual(depths.get(1), 1);
        assert.strictEqual(depths.get(2), 1);
    });

    test('a universe that fills itself is reported rather than hanging', () => {
        const model = buildCellMap([
            'cycle',
            '1 0 -1 u=1 fill=2 imp:n=1',
            '2 0 -2 u=2 fill=1 imp:n=1',
            '3 0 -3 fill=1     imp:n=1',
            '4 0  3            imp:n=0',
            '',
            '1 so 1',
            '2 so 2',
            '3 so 9',
            '',
            'kcode 100 1 5 20',
        ].join('\n'));
        assert.ok(model.warnings.some((w) => /cycle/i.test(w)), model.warnings.join(' | '));
    });
});

suite('OWEN Cell Map — 17x17 assembly fixture', () => {
    const text = fs.readFileSync(path.join(PREBUILT_MODELS, 'assembly_17x17_mcnp.i'), 'utf8');
    const model = buildCellMap(text);

    test('universes are discovered and nested to the right depth', () => {
        assert.deepStrictEqual(
            model.universes.map((u) => u.id).sort((a, b) => a - b),
            [0, 1, 2, 3, 10],
        );
        const depth = (id: number) => model.universes.find((u) => u.id === id)!.depth;
        assert.strictEqual(depth(0), 0);
        assert.strictEqual(depth(10), 1);
        assert.strictEqual(depth(1), 2);
        assert.strictEqual(depth(3), 2);
        assert.strictEqual(model.stats.maxDepth, 2);
    });

    test('the lattice fill array becomes counted edges', () => {
        const fills = model.edges.filter((e) => e.kind === 'fill' && e.from === 20);
        const count = (u: number) => fills.find((e) => e.to === u)?.count;
        // 289 lattice positions: 264 fuel pins, 24 guide tubes, 1 instrument tube.
        assert.strictEqual(count(1), 264);
        assert.strictEqual(count(2), 24);
        assert.strictEqual(count(3), 1);
        assert.ok(fills.every((e) => e.lattice === true));

        const window = model.edges.find((e) => e.kind === 'fill' && e.from === 30)!;
        assert.strictEqual(window.to, 10);
        assert.strictEqual(window.count, undefined);
    });

    test('roles read the way an MCNP author would describe the deck', () => {
        assert.strictEqual(cell(model, 20).role, 'lattice');
        assert.strictEqual(cell(model, 20).lattice, 1);
        assert.strictEqual(cell(model, 30).role, 'container');
        assert.strictEqual(cell(model, 31).role, 'graveyard');
        assert.strictEqual(cell(model, 1).role, 'material');
        assert.strictEqual(cell(model, 1).universe, 1);
    });

    test('a deck this clean produces no warnings', () => {
        assert.deepStrictEqual(model.warnings, []);
    });

    test('every universe except the root records who fills it', () => {
        for (const u of model.universes) {
            if (u.id === 0) continue;
            assert.ok(u.filledBy.length > 0, `u=${u.id} has no parent`);
        }
        assert.deepStrictEqual(model.universes.find((u) => u.id === 1)!.filledBy, [20]);
        assert.deepStrictEqual(model.universes.find((u) => u.id === 10)!.filledBy, [30]);
    });
});

suite('OWEN Cell Map — webview HTML', () => {
    const html = buildCellMapHtml('vscode-webview://x', 'NONCE123');

    test('locks itself down and loads nothing remote', () => {
        assert.ok(html.includes("default-src 'none'"));
        assert.ok(html.includes("script-src 'nonce-NONCE123'"));
        assert.ok(html.includes('<script nonce="NONCE123">'));
        const scriptSrc = html.match(/script-src[^;"]*/)![0];
        assert.ok(!scriptSrc.includes("'unsafe-inline'"), `script-src is loose: ${scriptSrc}`);
        assert.ok(!html.includes('unpkg.com'), 'cell map must not pull a CDN');
        assert.ok(!/src\s*=\s*"https?:/.test(html), 'no remote script or image sources');
    });

    test('the inline script is syntactically valid', () => {
        // It is authored as a string literal, so a stray escape produces a
        // panel that renders the chrome and then does nothing at all. Compile
        // it (without running it) so that fails here instead.
        const body = html.match(/<script nonce="NONCE123">([\s\S]*?)<\/script>/)?.[1];
        assert.ok(body && body.length > 500, 'no inline script found');
        assert.doesNotThrow(() => new Function(body!));
    });

    test('unicode escapes survive into the emitted script', () => {
        // `\\u00D7` in the TypeScript source has to reach the browser as the
        // escape, not as a literal backslash-u.
        assert.ok(html.includes("'\\u00D7'"), 'lattice count multiplication sign lost');
        assert.ok(!html.includes('\\\\u00'), 'a unicode escape was double-escaped');
    });

    test('ships the controls the panel messages depend on', () => {
        for (const id of ['canvas', 'edges', 'detail', 'warn', 'stats', 'q', 'fit']) {
            assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
        }
        assert.ok(html.includes("command: 'ready'"));
        assert.ok(html.includes("command: 'revealCell'"));
        assert.ok(html.includes("command: 'revealSurface'"));
    });
});

suite('OWEN reference sites', () => {
    test('every entry is a plain https URL with a description', () => {
        for (const s of REFERENCE_SITES) {
            assert.ok(s.url.startsWith('https://'), `${s.label} is not https`);
            assert.ok(s.description.length > 10, `${s.label} has no useful description`);
            assert.ok(SCOPE_LABELS[s.scope], `${s.label} has an unlabelled scope`);
        }
        assert.strictEqual(new Set(REFERENCE_SITES.map((s) => s.url)).size, REFERENCE_SITES.length);
    });

    test('each code has exactly one primary entry', () => {
        for (const scope of ['mcnp', 'openmc', 'serpent', 'scone', 'phits'] as const) {
            const primaries = REFERENCE_SITES.filter((s) => s.scope === scope && s.primary);
            assert.strictEqual(primaries.length, 1, `${scope} should have one primary`);
        }
    });

    test('the open code sorts to the top, its manual first', () => {
        const ordered = orderedReferenceSites('serpent');
        assert.strictEqual(ordered[0].url, 'https://serpent.vtt.fi/docs/');
        assert.strictEqual(ordered[0].scope, 'serpent');
        const firstOther = ordered.findIndex((s) => s.scope !== 'serpent');
        const firstGeneral = ordered.findIndex((s) => s.scope === 'general');
        assert.strictEqual(firstOther, firstGeneral, 'general block should follow the active code');
    });

    test('with nothing open the list keeps declaration order', () => {
        assert.deepStrictEqual(
            orderedReferenceSites(null).map((s) => s.url),
            REFERENCE_SITES.map((s) => s.url),
        );
    });

    test('Serpent points at the maintained docs, not only the frozen wiki', () => {
        const serpent = REFERENCE_SITES.filter((s) => s.scope === 'serpent');
        const primary = serpent.find((s) => s.primary)!;
        assert.ok(/serpent\.vtt\.fi\/docs/.test(primary.url));
        const wiki = serpent.find((s) => /mediawiki/.test(s.url))!;
        assert.ok(/legacy|no longer updated/i.test(`${wiki.label} ${wiki.description}`));
    });
});
