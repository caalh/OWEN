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
    const OPENMC_SCOPES = [
        'variable.language.openmc',
        'support.class.openmc',
        'support.function.openmc',
        'support.type.openmc',
        'support.variable.openmc',
    ];

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

    test('within each palette, the five OpenMC roles are pairwise different', () => {
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
    const scopesAt = (text: string, needle: string): string[] => {
        const idx = text.indexOf(needle);
        return findOpenmcTokens(text)
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
        const tokens = findOpenmcTokens(text);
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
        const tokens = findOpenmcTokens(text);
        assert.deepStrictEqual(tokens.map((t) => t.scope), ['variable.language.openmc']);
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
