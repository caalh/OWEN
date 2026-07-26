// OWEN per-language syntax-highlighting palettes.
//
// For each of the four languages OWEN supports, the user can pick one of four
// palettes. A palette is a mapping from a *role* (comment, keyword, number, …)
// to a color + optional font style. Each language declares which TextMate
// scopes (emitted by the grammars under ../../syntaxes/) map to which role, so
// the same four palettes recolor every language consistently while still
// targeting that language's namespaced scopes precisely.

export type Language = 'mcnp' | 'openmc' | 'serpent' | 'scone';
export type PaletteId = 'classic' | 'solarized' | 'highContrast' | 'pastel';

/** A semantic token role shared across all languages. */
export type Role =
    | 'comment'
    | 'keyword'
    | 'type'
    | 'entity'
    | 'func'
    | 'number'
    | 'string'
    | 'special'
    | 'identifier'
    | 'modifier';

export interface TokenStyle {
    foreground: string;
    fontStyle?: string;
}

export const LANGUAGES: Language[] = ['mcnp', 'openmc', 'serpent', 'scone'];

export const LANGUAGE_LABELS: Record<Language, string> = {
    mcnp: 'MCNP',
    openmc: 'OpenMC',
    serpent: 'Serpent',
    scone: 'SCONE',
};

/** Ordered for the QuickPick / settings enum. */
export const PALETTE_IDS: PaletteId[] = ['classic', 'solarized', 'highContrast', 'pastel'];

export const PALETTE_LABELS: Record<PaletteId, string> = {
    classic: 'Classic',
    solarized: 'Solarized',
    highContrast: 'High Contrast',
    pastel: 'Pastel',
};

export const PALETTE_DESCRIPTIONS: Record<PaletteId, string> = {
    classic: 'VS Code dark default-style colors',
    solarized: 'Muted Solarized-inspired accents',
    highContrast: 'Bright, vivid, maximum legibility',
    pastel: 'Soft low-saturation tones',
};

/** Map a user-facing label (settings enum value) back to its palette id. */
export function paletteIdFromLabel(label: string | undefined): PaletteId {
    if (!label) return 'classic';
    const found = PALETTE_IDS.find((id) => PALETTE_LABELS[id].toLowerCase() === label.toLowerCase());
    return found ?? 'classic';
}

// Role colors for each palette. Comments are italicized in every palette.
const ROLE_COLORS: Record<PaletteId, Record<Role, TokenStyle>> = {
    classic: {
        comment: { foreground: '#6A9955', fontStyle: 'italic' },
        keyword: { foreground: '#569CD6' },
        type: { foreground: '#4EC9B0' },
        entity: { foreground: '#DCDCAA' },
        func: { foreground: '#C586C0' },
        number: { foreground: '#B5CEA8' },
        string: { foreground: '#CE9178' },
        special: { foreground: '#D7BA7D' },
        identifier: { foreground: '#F44747' },
        modifier: { foreground: '#CE9178' },
    },
    solarized: {
        comment: { foreground: '#657B83', fontStyle: 'italic' },
        keyword: { foreground: '#859900' },
        type: { foreground: '#2AA198' },
        entity: { foreground: '#B58900' },
        func: { foreground: '#6C71C4' },
        number: { foreground: '#93A1A1' },
        string: { foreground: '#CB4B16' },
        special: { foreground: '#D33682' },
        identifier: { foreground: '#DC322F' },
        modifier: { foreground: '#CB4B16' },
    },
    highContrast: {
        comment: { foreground: '#7CA668', fontStyle: 'italic' },
        keyword: { foreground: '#00B0FF' },
        type: { foreground: '#00E5C0' },
        entity: { foreground: '#FFD700' },
        func: { foreground: '#FF6EC7' },
        number: { foreground: '#B5FF6B' },
        string: { foreground: '#FF9E64' },
        special: { foreground: '#FFE65C' },
        identifier: { foreground: '#FF5555' },
        modifier: { foreground: '#FF9E64' },
    },
    pastel: {
        comment: { foreground: '#A8B7AB', fontStyle: 'italic' },
        keyword: { foreground: '#8AB4D8' },
        type: { foreground: '#9DD6C4' },
        entity: { foreground: '#E6D6A8' },
        func: { foreground: '#D2A8D8' },
        number: { foreground: '#BFD9A8' },
        string: { foreground: '#E0B0A0' },
        special: { foreground: '#D8C49A' },
        identifier: { foreground: '#E89898' },
        modifier: { foreground: '#E0B0A0' },
    },
};

// Each language's TextMate scopes mapped to a shared role. These scope names
// MUST match what the grammars emit (syntaxes/*.tmLanguage.json).
const SCOPE_ROLES: Record<Language, Record<string, Role>> = {
    mcnp: {
        'comment.line.mcnp': 'comment',
        'keyword.control.mcnp': 'keyword',
        'keyword.other.particle.mcnp': 'modifier',
        'keyword.operator.geometry.mcnp': 'modifier',
        'entity.name.cell.mcnp': 'identifier',
        'entity.name.surface-id.mcnp': 'identifier',
        'entity.name.material-id.mcnp': 'type',
        'entity.name.material.mcnp': 'func',
        'entity.name.mt-card.mcnp': 'func',
        'support.function.tally.mcnp': 'func',
        'storage.type.surface.mcnp': 'type',
        'storage.type.macrobody.mcnp': 'entity',
        'constant.numeric.mcnp': 'number',
        'constant.other.zaid.mcnp': 'special',
        'constant.other.library.mcnp': 'special',
    },
    openmc: {
        'variable.language.openmc': 'keyword',
        'support.class.openmc': 'type',
        'support.function.openmc': 'func',
        'support.type.openmc': 'entity',
    },
    serpent: {
        'comment.line.serpent': 'comment',
        'keyword.control.serpent': 'keyword',
        'entity.name.material.serpent': 'entity',
        'entity.name.type.serpent': 'type',
        'constant.numeric.serpent': 'number',
        'string.quoted.serpent': 'string',
        'constant.other.zaid.serpent': 'special',
    },
    scone: {
        'comment.line.scone': 'comment',
        'keyword.control.scone': 'keyword',
        'entity.name.section.scone': 'type',
        'constant.numeric.scone': 'number',
        'string.quoted.scone': 'string',
    },
};

/** Every TextMate scope OWEN manages, across all languages. */
export const MANAGED_SCOPES: ReadonlySet<string> = new Set(
    LANGUAGES.flatMap((lang) => Object.keys(SCOPE_ROLES[lang])),
);

export interface TextMateRule {
    scope: string;
    settings: TokenStyle;
}

/**
 * Resolve the {@link TokenStyle} a palette assigns to a given TextMate scope of
 * a language, or `undefined` if the scope is not OWEN-managed for that language.
 *
 * This is the single source of truth the palette-preview webview uses to color
 * its sample tokens: each sample token is tagged with the same scope key the
 * grammars emit, and the preview asks this function for the color — so the
 * preview shows exactly what the editor would render for that palette.
 */
export function styleForScope(
    language: Language,
    palette: PaletteId,
    scope: string,
): TokenStyle | undefined {
    const role = SCOPE_ROLES[language][scope];
    if (!role) return undefined;
    return ROLE_COLORS[palette][role];
}

/**
 * Build the `editor.tokenColorCustomizations.textMateRules` entries for one
 * language under the given palette. One rule per scope (scope kept as a plain
 * string) so OWEN-managed rules are trivially identifiable via MANAGED_SCOPES.
 */
export function buildRules(language: Language, palette: PaletteId): TextMateRule[] {
    const roleColors = ROLE_COLORS[palette];
    const scopeRoles = SCOPE_ROLES[language];
    return Object.entries(scopeRoles).map(([scope, role]) => {
        const style = roleColors[role];
        const settings: TokenStyle = { foreground: style.foreground };
        if (style.fontStyle) settings.fontStyle = style.fontStyle;
        return { scope, settings };
    });
}

/**
 * Full language → palette → scope → color map, exposed for documentation /
 * testing. Keyed exactly as described in the feature spec.
 */
export function fullPaletteMap(): Record<Language, Record<PaletteId, Record<string, TokenStyle>>> {
    const out = {} as Record<Language, Record<PaletteId, Record<string, TokenStyle>>>;
    for (const lang of LANGUAGES) {
        out[lang] = {} as Record<PaletteId, Record<string, TokenStyle>>;
        for (const id of PALETTE_IDS) {
            out[lang][id] = {};
            for (const rule of buildRules(lang, id)) {
                out[lang][id][rule.scope] = rule.settings;
            }
        }
    }
    return out;
}
