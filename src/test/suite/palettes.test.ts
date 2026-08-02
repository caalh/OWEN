// Highlight palettes: OpenMC per-palette hue distinctness, and the Custom
// palette (owen.highlight.customColors → 'custom' PaletteId). Pure module —
// no vscode dependency, so these run as plain unit tests.
import * as assert from 'assert';
import {
    LANGUAGES,
    PALETTE_IDS,
    PALETTE_LABELS,
    ROLES,
    buildRules,
    paletteIdFromLabel,
    resolveCustomColors,
    setCustomColors,
    styleForScope,
} from '../../highlight/palettes';
import { findOpenmcTokens } from '../../highlight/openmcTokens';

suite('Highlight palettes — OpenMC distinctness', () => {
    /** One scope per *distinct role* OpenMC uses. Two further scopes share a
     *  role deliberately (see the pair of tests below), so they are excluded
     *  from the pairwise-distinctness checks. */
    const OPENMC_SCOPES = [
        'variable.language.openmc',   // keyword
        'support.class.openmc',       // type
        'support.function.openmc',    // func
        'support.type.openmc',        // entity
        'support.variable.openmc',    // modifier
        'comment.line.openmc',        // comment
        'constant.numeric.openmc',    // number
        'string.quoted.openmc',       // string
    ];

    /** The Python-level scopes the decorator adds under 'full' coverage. */
    const PYTHON_SCOPES = [
        'comment.line.openmc',
        'string.quoted.openmc',
        'constant.numeric.openmc',
        'keyword.control.openmc',
        'entity.name.function.openmc',
    ];

    test('every Python-level scope resolves to a color', () => {
        // A scope missing from SCOPE_ROLES resolves to undefined, and the
        // decorator then silently creates no decoration type for it — which is
        // indistinguishable, on screen, from the palette doing nothing.
        for (const id of PALETTE_IDS) {
            for (const scope of PYTHON_SCOPES) {
                const style = styleForScope('openmc', id, scope);
                assert.ok(style?.foreground, `${id}/${scope} has no color`);
            }
        }
    });

    test('each Python-level scope changes color across the built-in palettes', () => {
        // This is the property the user is actually looking at: switch palette,
        // see the numbers and strings change.
        const builtIns = PALETTE_IDS.filter((id) => id !== 'custom');
        for (const scope of PYTHON_SCOPES) {
            const colors = builtIns.map((id) => styleForScope('openmc', id, scope)?.foreground);
            assert.strictEqual(new Set(colors).size, builtIns.length,
                `${scope} repeats a color across palettes: ${colors}`);
        }
    });

    test('Python keywords share the module hue, def names share the submodule hue', () => {
        // Both are deliberate (see SCOPE_ROLES.openmc). Asserted so that a
        // future edit which splits them is a decision rather than an accident.
        for (const id of PALETTE_IDS) {
            assert.strictEqual(
                styleForScope('openmc', id, 'keyword.control.openmc')?.foreground,
                styleForScope('openmc', id, 'variable.language.openmc')?.foreground,
                `${id}: python keyword should track the module color`);
            assert.strictEqual(
                styleForScope('openmc', id, 'entity.name.function.openmc')?.foreground,
                styleForScope('openmc', id, 'support.type.openmc')?.foreground,
                `${id}: def name should track the submodule color`);
        }
    });

    test('every built-in palette gives OpenMC a distinct color set', () => {
        const builtIns = PALETTE_IDS.filter((id) => id !== 'custom');
        const signatures = builtIns.map((id) =>
            OPENMC_SCOPES.map((s) => styleForScope('openmc', id, s)?.foreground).join('|'),
        );
        assert.strictEqual(new Set(signatures).size, builtIns.length,
            `palette signatures collide: ${signatures.join('  vs  ')}`);
    });

    test('no two OpenMC palettes share a module-name color', () => {
        const builtIns = PALETTE_IDS.filter((id) => id !== 'custom');
        const kw = builtIns.map((id) => styleForScope('openmc', id, 'variable.language.openmc')?.foreground);
        assert.strictEqual(new Set(kw).size, builtIns.length, `keyword colors collide: ${kw}`);
    });

    test('within each palette, the OpenMC roles are pairwise different', () => {
        for (const id of PALETTE_IDS.filter((p) => p !== 'custom')) {
            const colors = OPENMC_SCOPES.map((s) => styleForScope('openmc', id, s)?.foreground);
            assert.strictEqual(new Set(colors).size, colors.length,
                `${id}: OpenMC role colors collide: ${colors}`);
        }
    });

    test('attribute color differs across every built-in palette', () => {
        const builtIns = PALETTE_IDS.filter((id) => id !== 'custom');
        const attr = builtIns.map((id) => styleForScope('openmc', id, 'support.variable.openmc')?.foreground);
        assert.strictEqual(new Set(attr).size, builtIns.length, `attribute colors collide: ${attr}`);
    });

    test('OpenMC overrides do not leak into other languages', () => {
        // MCNP keyword under highContrast must remain the base palette blue,
        // not OpenMC's orange override.
        const style = styleForScope('mcnp', 'highContrast', 'keyword.control.mcnp');
        assert.strictEqual(style?.foreground, '#00B0FF');
        // MCNP particle modifier must remain the base orange, not OpenMC's
        // per-palette attribute hue.
        const mod = styleForScope('mcnp', 'highContrast', 'keyword.other.particle.mcnp');
        assert.strictEqual(mod?.foreground, '#FF9E64');
    });
});

suite('OpenMC token finder — any-receiver methods and attributes', () => {
    // Pinned to 'api': this suite is about which API names get claimed, so the
    // Python-level tokens would only be noise here. Full coverage has its own
    // suite below.
    const scopesAt = (text: string, needle: string): string[] => {
        const idx = text.indexOf(needle);
        return findOpenmcTokens(text, 'api')
            .filter((t) => t.start >= idx && t.end <= idx + needle.length)
            .map((t) => t.scope);
    };

    // The finder short-circuits on files that never mention openmc, so every
    // sample includes the import line a real deck would have.
    test('method call on a variable receiver is a function token', () => {
        const text = "import openmc\nfuel.add_nuclide('U235', 0.045)\n";
        assert.deepStrictEqual(scopesAt(text, 'add_nuclide'), ['support.function.openmc']);
    });

    test('attribute on a variable receiver is an attribute token', () => {
        const text = 'import openmc\nsettings.batches = 150\ncell.temperature = 900.0\n';
        assert.deepStrictEqual(scopesAt(text, 'batches'), ['support.variable.openmc']);
        assert.deepStrictEqual(scopesAt(text, 'temperature'), ['support.variable.openmc']);
    });

    test('openmc.run stays module+function (anchored patterns win)', () => {
        const text = 'openmc.run(threads=4)\n';
        const tokens = findOpenmcTokens(text, 'api');
        assert.deepStrictEqual(tokens.map((t) => t.scope),
            ['variable.language.openmc', 'support.function.openmc']);
    });

    test('a called attribute name is not colored as an attribute', () => {
        // `x.temperature(...)` is a call, not an attribute read; the attribute
        // pattern must not claim it (and it is not on the method list).
        const text = 'import openmc\nx.temperature(1)\n';
        assert.deepStrictEqual(scopesAt(text, 'temperature'), []);
    });

    test('bare identifiers without a dot are never claimed', () => {
        const text = 'import openmc\nbatches = 10\nfill = None\n';
        assert.deepStrictEqual(scopesAt(text, 'batches'), []);
        assert.deepStrictEqual(scopesAt(text, 'fill'), []);
    });

    test('strings and comments stay masked', () => {
        const text = "s = 'settings.batches'\n# cell.temperature = 900\nimport openmc\n";
        const tokens = findOpenmcTokens(text, 'api');
        assert.deepStrictEqual(tokens.map((t) => t.scope), ['variable.language.openmc']);
    });
});

suite('OpenMC token finder — full coverage', () => {
    const DECK = [
        '# PWR pin cell',
        'import openmc',
        "fuel = openmc.Material(name='UO2')",
        "fuel.add_nuclide('U235', 0.045)",
        'settings.batches = 150',
        '',
        'def pin_universe(r):',
        '    return openmc.model.RectangularPrism(1.26, 1.26)',
        '',
        'mat1 = 5',
        'flux = 1e-5',
        ''].join('\n');

    const scopes = (text: string) => findOpenmcTokens(text, 'full').map((t) => t.scope);
    const textsOf = (text: string, scope: string) =>
        findOpenmcTokens(text, 'full')
            .filter((t) => t.scope === scope)
            .map((t) => text.slice(t.start, t.end));

    test('full is the default coverage', () => {
        assert.deepStrictEqual(findOpenmcTokens(DECK), findOpenmcTokens(DECK, 'full'));
    });

    test('full claims far more than api, which is the whole point', () => {
        const api = findOpenmcTokens(DECK, 'api').length;
        const full = findOpenmcTokens(DECK, 'full').length;
        assert.ok(full > api * 2, `expected full (${full}) to dwarf api (${api})`);
    });

    test('numbers, strings, comments and keywords are claimed', () => {
        assert.deepStrictEqual(textsOf(DECK, 'comment.line.openmc'), ['# PWR pin cell']);
        assert.deepStrictEqual(textsOf(DECK, 'string.quoted.openmc'), ["'UO2'", "'U235'"]);
        assert.deepStrictEqual(textsOf(DECK, 'constant.numeric.openmc'),
            ['0.045', '150', '1.26', '1.26', '5', '1e-5']);
        assert.deepStrictEqual(textsOf(DECK, 'keyword.control.openmc'),
            ['import', 'def', 'return']);
    });

    test('a def name is claimed separately from the def keyword', () => {
        assert.deepStrictEqual(textsOf(DECK, 'entity.name.function.openmc'), ['pin_universe']);
    });

    test('digits inside an identifier are never a number', () => {
        // `mat1` must survive whole: the "1" is not a literal. The 5 it is
        // assigned is, and appears in the numeric list above.
        assert.ok(!textsOf(DECK, 'constant.numeric.openmc').includes('1'));
    });

    test('API tokens still win inside a full-coverage scan', () => {
        const text = 'import openmc\nopenmc.run(threads=4)\n';
        assert.deepStrictEqual(scopes(text), [
            'keyword.control.openmc',     // import
            'variable.language.openmc',   // openmc (the import target)
            'variable.language.openmc',   // openmc.run receiver
            'support.function.openmc',    // run
            'constant.numeric.openmc',    // 4
        ]);
    });

    test('an API name inside a string is a string, not an attribute', () => {
        const text = "import openmc\ns = 'settings.batches'\n";
        const tokens = findOpenmcTokens(text, 'full');
        const inString = tokens.filter((t) => text.slice(t.start, t.end).includes('batches'));
        assert.deepStrictEqual(inString.map((t) => t.scope), ['string.quoted.openmc']);
    });

    test('no two tokens overlap', () => {
        const tokens = findOpenmcTokens(DECK, 'full');
        for (let i = 1; i < tokens.length; i++) {
            assert.ok(tokens[i].start >= tokens[i - 1].end,
                `overlap at ${JSON.stringify(tokens[i - 1])} / ${JSON.stringify(tokens[i])}`);
        }
    });
});

suite('Highlight palettes — Custom', () => {
    teardown(() => setCustomColors(undefined)); // reset to classic defaults

    test('custom is a first-class palette id with a label', () => {
        assert.ok(PALETTE_IDS.includes('custom'));
        assert.strictEqual(PALETTE_LABELS.custom, 'Custom');
        assert.strictEqual(paletteIdFromLabel('Custom'), 'custom');
    });

    test('unset custom colors fall back to Classic for every language', () => {
        setCustomColors(undefined);
        for (const lang of LANGUAGES) {
            // OpenMC's Classic has a per-language attribute override; Custom
            // deliberately falls back to the *base* Classic roles, so compare
            // the languages whose Classic is the base palette.
            if (lang === 'openmc') continue;
            assert.deepStrictEqual(buildRules(lang, 'custom'), buildRules(lang, 'classic'));
        }
        // OpenMC: everything matches Classic except the overridden attribute role.
        const custom = buildRules('openmc', 'custom');
        const classic = buildRules('openmc', 'classic');
        for (let i = 0; i < custom.length; i++) {
            if (custom[i].scope === 'support.variable.openmc') {
                assert.strictEqual(custom[i].settings.foreground, '#CE9178'); // base classic modifier
                assert.strictEqual(classic[i].settings.foreground, '#9CDCFE'); // openmc override
            } else {
                assert.deepStrictEqual(custom[i], classic[i]);
            }
        }
    });

    test('a hex string per role is applied', () => {
        setCustomColors({ keyword: '#FF0000' });
        const style = styleForScope('openmc', 'custom', 'variable.language.openmc');
        assert.strictEqual(style?.foreground, '#FF0000');
        // untouched role still classic
        const cls = styleForScope('openmc', 'custom', 'support.class.openmc');
        assert.strictEqual(cls?.foreground, '#4EC9B0');
    });

    test('an object with fontStyle is applied', () => {
        setCustomColors({ comment: { foreground: '#123456', fontStyle: 'bold' } });
        const rules = buildRules('mcnp', 'custom');
        const comment = rules.find((r) => r.scope === 'comment.line.mcnp');
        assert.strictEqual(comment?.settings.foreground, '#123456');
        assert.strictEqual(comment?.settings.fontStyle, 'bold');
    });

    test('invalid values fall back per-role instead of breaking the palette', () => {
        const resolved = resolveCustomColors({
            keyword: 'red',                       // not hex
            type: '#12345',                       // wrong length
            func: { foreground: '#ABCDEF', fontStyle: 'blink' }, // bad fontStyle
            number: 42,                           // wrong type
        });
        assert.strictEqual(resolved.keyword.foreground, '#569CD6');   // classic
        assert.strictEqual(resolved.type.foreground, '#4EC9B0');      // classic
        assert.strictEqual(resolved.func.foreground, '#ABCDEF');      // color kept
        assert.strictEqual(resolved.func.fontStyle, undefined);       // style dropped
        assert.strictEqual(resolved.number.foreground, '#B5CEA8');    // classic
    });

    test('non-object config resolves to full classic map', () => {
        const resolved = resolveCustomColors('nonsense');
        for (const role of ROLES) {
            assert.ok(resolved[role].foreground.startsWith('#'), `${role} has a color`);
        }
        assert.strictEqual(resolved.comment.fontStyle, 'italic');
    });

    test('comment keeps its classic italic when set as a bare hex string', () => {
        setCustomColors({ comment: '#808080' });
        const rules = buildRules('scone', 'custom');
        const comment = rules.find((r) => r.scope === 'comment.line.scone');
        assert.strictEqual(comment?.settings.foreground, '#808080');
        assert.strictEqual(comment?.settings.fontStyle, 'italic');
    });
});
