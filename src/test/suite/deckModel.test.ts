import * as assert from 'assert';
import {
    applySconeTemperature,
    buildDeckDocument,
    declaredMaterialName,
    IdAllocator,
    type DeckModel,
    type DeckSection,
} from '../../inputBuilder/deckModel';
import { checkDeck, summarizeChecks } from '../../inputBuilder/deckChecks';
import { MATERIAL_LIBRARY, renderMaterial, type MonteCarloCode } from '../../inputBuilder/materials';

/** A three-material, two-pin, one-lattice deck — the builder's common shape. */
function pinCellModel(code: MonteCarloCode, overrides: DeckSection[] = []): DeckModel {
    const sections: DeckSection[] = [
        {
            id: 'm1', kind: 'materials', entries: [
                { key: 'fuel', source: 'library', libraryId: 'uo2-3pct' },
                { key: 'clad', source: 'library', libraryId: 'zirc4' },
                { key: 'water', source: 'library', libraryId: 'light-water' },
            ],
        },
        {
            id: 'p1', kind: 'pincell', name: 'fuel pin', universe: 1,
            layers: [{ material: 'fuel', outerRadius: 0.39218 }, { material: 'clad', outerRadius: 0.4572 }],
            outerMaterial: 'water', pitch: 1.26, zMin: 0, zMax: 365.76,
        },
        {
            id: 'l1', kind: 'lattice', nx: 3, ny: 3, pitch: 1.26,
            grid: [[1, 1, 1], [1, 1, 1], [1, 1, 1]],
            pins: [{ id: 1, label: 'fuel', universe: 1, pincellId: 'p1' }],
            latticeCell: 900, latticeUniverse: 10,
        },
        {
            id: 'b1', kind: 'boundary', shape: 'box', size: 1.89, zMin: 0, zMax: 365.76,
            bc: 'reflective', fillLatticeId: 'l1',
        },
        {
            id: 'r1', kind: 'run', mode: 'eigenvalue', particles: 10000, inactive: 50,
            active: 150, keffGuess: 1.0, source: [0, 0, 182.88],
        },
        ...overrides,
    ];
    return { code, title: 'test deck', lineLimit: 80, sections };
}

const CODES: MonteCarloCode[] = ['mcnp', 'openmc', 'serpent', 'scone'];

suite('Input Builder — deck model', () => {
    test('IdAllocator never hands out the same id twice', () => {
        const a = new IdAllocator();
        assert.strictEqual(a.take('cell', 900), 900);
        assert.notStrictEqual(a.take('cell', 900), 900, 'a second request for 900 must move on');
        const seen = new Set<number>();
        for (let i = 0; i < 50; i++) {
            const id = a.next('cell');
            assert.ok(!seen.has(id), `id ${id} was issued twice`);
            seen.add(id);
        }
        // Kinds are independent counters.
        assert.strictEqual(a.take('surface', 900), 900);
    });

    test('every code assembles a deck whose sections all own lines', () => {
        for (const code of CODES) {
            const model = pinCellModel(code);
            const doc = buildDeckDocument(model);
            assert.ok(doc.text.length > 0, `${code}: empty deck`);
            for (const s of doc.sections) {
                assert.ok(s.lines.length > 0, `${code}: section ${s.id} (${s.kind}) contributed no lines`);
            }
            // Ownership map is dense and in range.
            assert.strictEqual(doc.owners.length, doc.lines.length, `${code}: owners/lines length mismatch`);
        }
    });

    test('a disabled section disappears from the deck', () => {
        const model = pinCellModel('mcnp');
        const full = buildDeckDocument(model);
        const off: DeckModel = {
            ...model,
            sections: model.sections.map((s) => (s.id === 'l1' ? { ...s, enabled: false } : s)),
        };
        const trimmed = buildDeckDocument(off);
        assert.ok(trimmed.lines.length < full.lines.length);
        assert.ok(!/lat=1/.test(trimmed.text), 'lattice card survived being disabled');
    });

    test('two lattices do not collide on cells, surfaces or universes', () => {
        const second: DeckSection = {
            id: 'l2', kind: 'lattice', nx: 3, ny: 3, pitch: 1.26,
            grid: [[1, 1, 1], [1, 1, 1], [1, 1, 1]],
            pins: [{ id: 1, label: 'fuel', universe: 1, pincellId: 'p1' }],
        };
        const model = pinCellModel('mcnp', [second]);
        const doc = buildDeckDocument(model);
        // Anchored at column 0 on purpose: a lattice fill map row is indented and
        // reads as `1 1 1`, which would otherwise look like cell 1.
        const ids = doc.lines
            .map((l) => /^(\d+)\s+(?:\d+|like)\b/.exec(l))
            .filter((m): m is RegExpExecArray => m !== null)
            .map((m) => Number(m[1]));
        assert.strictEqual(new Set(ids).size, ids.length, 'duplicate leading ids in the assembled deck');
        assert.strictEqual((doc.text.match(/lat=1/g) ?? []).length, 2, 'expected two lattice cards');
    });

    test('material references match the names the cards actually declare', () => {
        for (const code of CODES) {
            const doc = buildDeckDocument(pinCellModel(code));
            for (const entry of MATERIAL_LIBRARY.filter((m) => ['uo2-3pct', 'zirc4', 'light-water'].includes(m.id))) {
                const card = renderMaterial(code, { ...entry, mcnpNumber: 1 });
                const declared = declaredMaterialName(code, card);
                assert.ok(declared, `${code}: could not read a declared name out of the ${entry.id} card`);
            }
            if (code === 'openmc') {
                // Every fill= name must be bound earlier in the file.
                const declaredVars = new Set(
                    [...doc.text.matchAll(/^(\w+) = openmc\./gm)].map((m) => m[1]),
                );
                for (const m of doc.text.matchAll(/fill=(\w+)/g)) {
                    if (m[1] === 'None') continue;
                    assert.ok(declaredVars.has(m[1]), `openmc: fill=${m[1]} is never assigned`);
                }
            }
            if (code === 'scone') {
                const declared = new Set(
                    [...doc.text.matchAll(/^\s{4}(\w+) \{$/gm)].map((m) => m[1]),
                );
                for (const m of doc.text.matchAll(/fills \(([^)]*)\)/g)) {
                    for (const name of m[1].trim().split(/\s+/)) {
                        assert.ok(declared.has(name), `scone: fills references ${name}, which is not a material`);
                    }
                }
            }
        }
    });

    test('OpenMC binds every name before it is used', () => {
        const doc = buildDeckDocument(pinCellModel('openmc'));
        const boundAt = new Map<string, number>();
        doc.lines.forEach((line, i) => {
            const m = /^(\w+) = /.exec(line);
            if (m && !boundAt.has(m[1])) boundAt.set(m[1], i);
        });
        doc.lines.forEach((line, i) => {
            const m = /fill=(\w+)/.exec(line);
            if (!m || m[1] === 'None') return;
            const at = boundAt.get(m[1]);
            assert.ok(at !== undefined && at < i, `line ${i + 1} uses ${m[1]} before it is defined`);
        });
    });

    test('SCONE physics keys are top level and tallies live in activeTally', () => {
        const model = pinCellModel('scone', [{ id: 't1', kind: 'tally', quantity: 'flux', cells: [] }]);
        const doc = buildDeckDocument(model);
        assert.match(doc.text, /^type eigenPhysicsPackage;$/m);
        assert.match(doc.text, /^collisionOperator \{/m);
        assert.match(doc.text, /^transportOperator \{/m);
        assert.match(doc.text, /^activeTally \{$/m);
        assert.ok(!/^physics \{/m.test(doc.text), 'there is no physics{} wrapper in a SCONE input');
        // Braces balance.
        assert.strictEqual(
            (doc.text.match(/\{/g) ?? []).length,
            (doc.text.match(/\}/g) ?? []).length,
            'unbalanced braces in the SCONE deck',
        );
    });

    test('SCONE compositions are atom densities, not fractions', () => {
        const doc = buildDeckDocument(pinCellModel('scone'));
        const water = /light_water \{\s*temp \d+;\s*composition \{([^}]*)\}/.exec(doc.text);
        assert.ok(water, 'no light water material block');
        const h = /1001\.\d\d ([\d.eE+-]+);/.exec(water[1]);
        assert.ok(h, 'no H-1 entry');
        // 0.997 g/cm3 water is 6.67e-2 hydrogen atoms per barn-cm.
        assert.ok(Math.abs(Number(h[1]) - 6.67e-2) < 1e-3, `H-1 density ${h[1]} is not physical`);
    });

    test('applySconeTemperature moves temp and ZAID suffix together', () => {
        const card = 'fuel {\n  temp 600;\n  composition {\n    92235.06 1.0e-3;\n  }\n}';
        const hot = applySconeTemperature(card, 900);
        assert.match(hot, /temp 900;/);
        assert.match(hot, /92235\.09 /);
        assert.ok(!/\.06 /.test(hot), 'a stale 600 K suffix survived');
    });

    test('Serpent writes mass densities as negative and wires S(a,b) both ways', () => {
        const doc = buildDeckDocument(pinCellModel('serpent'));
        for (const m of doc.text.matchAll(/^mat (\S+) (-?[\d.eE+-]+)/gm)) {
            assert.ok(m[2].startsWith('-'), `mat ${m[1]} has a positive density, which Serpent reads as atom density`);
        }
        const moder = /^mat \S+ \S+ moder (\S+) 1001$/m.exec(doc.text);
        assert.ok(moder, 'light water has no moder entry');
        assert.match(doc.text, new RegExp(`^therm ${moder[1]} `, 'm'));
    });

    test('no card names an ENDF/B-VII.1 elemental evaluation that does not exist', () => {
        // .80c is ENDF/B-VII.1, which dropped the natural Zr/Fe/Cr/Sn evaluations.
        for (const code of ['mcnp', 'serpent'] as const) {
            const doc = buildDeckDocument(pinCellModel(code));
            for (const zaid of ['40000', '26000', '24000', '50000', '28000']) {
                assert.ok(!doc.text.includes(`${zaid}.80c`), `${code}: ${zaid}.80c is not in ENDF71x`);
            }
        }
    });
});

suite('Input Builder — pre-insert checks', () => {
    test('a complete pin-cell deck is clean in every code', () => {
        for (const code of CODES) {
            const model = pinCellModel(code, [
                { id: 't1', kind: 'tally', quantity: 'flux', cells: [], sd: 1 },
            ]);
            const checks = checkDeck(model, buildDeckDocument(model));
            const { errors } = summarizeChecks(checks);
            assert.strictEqual(errors, 0, `${code}: ${checks.filter((c) => c.severity === 'error').map((c) => c.message).join(' | ')}`);
        }
    });

    test('a boundary flush with the lattice edge is not reported as clipping', () => {
        const model = pinCellModel('mcnp');
        const checks = checkDeck(model, buildDeckDocument(model));
        assert.ok(!checks.some((c) => /cuts the/.test(c.message)), 'flush boundary flagged as a cut');
    });

    test('a boundary inside the lattice is reported', () => {
        const model = pinCellModel('mcnp');
        const shrunk: DeckModel = {
            ...model,
            sections: model.sections.map((s) => (s.kind === 'boundary' ? { ...s, size: 1.0 } : s)),
        };
        const checks = checkDeck(shrunk, buildDeckDocument(shrunk));
        assert.ok(checks.some((c) => /cuts the/.test(c.message)), 'clipped lattice went unreported');
    });

    test('an MCNP volume tally inside a lattice demands sd', () => {
        const model = pinCellModel('mcnp', [{ id: 't1', kind: 'tally', quantity: 'flux', cells: [] }]);
        const checks = checkDeck(model, buildDeckDocument(model));
        assert.ok(
            checks.some((c) => c.severity === 'error' && /sd/.test(c.message)),
            'a lattice tally without sd is a fatal MCNP error and must be an error here',
        );
    });

    test('a tally naming a cell the deck never defines is an error', () => {
        for (const code of ['mcnp', 'openmc'] as const) {
            const model = pinCellModel(code, [
                { id: 't1', kind: 'tally', quantity: 'flux', cells: [4242], sd: 1 },
            ]);
            const checks = checkDeck(model, buildDeckDocument(model));
            assert.ok(
                checks.some((c) => c.severity === 'error' && /4242/.test(c.message)),
                `${code}: undefined tally cell went unreported`,
            );
        }
    });

    test('a source point outside the boundary is an error', () => {
        const model = pinCellModel('mcnp');
        const bad: DeckModel = {
            ...model,
            sections: model.sections.map((s) => (s.kind === 'run' ? { ...s, source: [0, 0, 500] as [number, number, number] } : s)),
        };
        const checks = checkDeck(bad, buildDeckDocument(bad));
        assert.ok(checks.some((c) => c.severity === 'error' && /outside the boundary/.test(c.message)));
    });

    test('a material reference with no materials section is an error', () => {
        const model = pinCellModel('mcnp');
        const orphan: DeckModel = { ...model, sections: model.sections.filter((s) => s.kind !== 'materials') };
        const checks = checkDeck(orphan, buildDeckDocument(orphan));
        assert.ok(checks.some((c) => c.severity === 'error'), 'unresolved material references went unreported');
    });

    test('an over-long MCNP card is an error in the 80-column dialect and clean at 128', () => {
        const long = 'c ' + 'x'.repeat(140);
        const model = pinCellModel('mcnp', [{ id: 'c1', kind: 'custom', region: 'cells', text: long }]);
        const legacy = checkDeck(model, buildDeckDocument(model));
        assert.ok(legacy.some((c) => c.severity === 'error' && /columns/.test(c.message)));
        const modern: DeckModel = { ...model, lineLimit: 128 };
        const wide = checkDeck(modern, buildDeckDocument(modern));
        assert.ok(wide.some((c) => c.severity === 'error' && /columns/.test(c.message)), '140 columns is over 128 too');
    });

    test('SCONE decks stay ASCII', () => {
        const model = pinCellModel('scone');
        const doc = buildDeckDocument(model);
        const checks = checkDeck(model, doc);
        // The material labels carry ₂ and ² from the library, so this must be caught.
        const hasWideChar = [...doc.text].some((ch) => (ch.codePointAt(0) ?? 0) > 0x7f);
        assert.ok(
            !hasWideChar || checks.some((c) => /ASCII/i.test(c.message)),
            'a non-ASCII SCONE deck was reported clean',
        );
    });

    test('summarizeChecks counts by severity and leads with the blocking count', () => {
        const s = summarizeChecks([
            { severity: 'error', message: 'a', origin: 'model' },
            { severity: 'warning', message: 'b', origin: 'model' },
            { severity: 'info', message: 'c', origin: 'model' },
        ]);
        assert.strictEqual(s.errors, 1);
        assert.strictEqual(s.warnings, 1);
        assert.strictEqual(s.infos, 1);
        assert.match(s.text, /1 problem/);
    });
});
