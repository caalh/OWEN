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

suite('Highlight palettes — OpenMC distinctness', () => {
    const OPENMC_SCOPES = [
        'variable.language.openmc',
        'support.class.openmc',
        'support.function.openmc',
        'support.type.openmc',
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

    test('within each palette, the four OpenMC roles are pairwise different', () => {
        for (const id of PALETTE_IDS.filter((p) => p !== 'custom')) {
            const colors = OPENMC_SCOPES.map((s) => styleForScope('openmc', id, s)?.foreground);
            assert.strictEqual(new Set(colors).size, colors.length,
                `${id}: OpenMC role colors collide: ${colors}`);
        }
    });

    test('OpenMC overrides do not leak into other languages', () => {
        // MCNP keyword under highContrast must remain the base palette blue,
        // not OpenMC's orange override.
        const style = styleForScope('mcnp', 'highContrast', 'keyword.control.mcnp');
        assert.strictEqual(style?.foreground, '#00B0FF');
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
            assert.deepStrictEqual(buildRules(lang, 'custom'), buildRules(lang, 'classic'));
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
