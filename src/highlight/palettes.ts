// OWEN per-language syntax-highlighting palettes.
//
// For each of the four languages OWEN supports, the user can pick one of four
// palettes. A palette is a mapping from a *role* (comment, keyword, number, …)
// to a color + optional font style. Each language declares which TextMate
// scopes (emitted by the grammars under ../../syntaxes/) map to which role, so
// the same four palettes recolor every language consistently while still
// targeting that language's namespaced scopes precisely.

export type Language = 'mcnp' | 'openmc' | 'serpent' | 'scone';
export type PaletteId = 'classic' | 'solarized' | 'highContrast' | 'pastel' | 'custom';

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
export const PALETTE_IDS: PaletteId[] = ['classic', 'solarized', 'highContrast', 'pastel', 'custom'];

export const PALETTE_LABELS: Record<PaletteId, string> = {
    classic: 'Classic',
    solarized: 'Solarized',
    highContrast: 'High Contrast',
    pastel: 'Pastel',
    custom: 'Custom',
};

export const PALETTE_DESCRIPTIONS: Record<PaletteId, string> = {
    classic: 'VS Code dark default-style colors',
    solarized: 'Muted Solarized-inspired accents',
    highContrast: 'Bright, vivid, maximum legibility',
    pastel: 'Soft low-saturation tones',
    custom: 'Your own colors — edit owen.highlight.customColors',
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
    // Placeholder — the live values come from CUSTOM_COLORS (see setCustomColors).
    // Kept identical to classic so 'custom' behaves sensibly before any config
    // is read, and so fullPaletteMap() never sees a hole.
    custom: {
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
};

// ── Per-language overrides ───────────────────────────────────────────────────
// OpenMC decks only ever show five roles (module / class / function /
// submodule / attribute), and the base palettes differ mostly by saturation
// within the same hue families — which made the OpenMC options nearly
// indistinguishable in practice (user report, 2026-08-02). These overrides
// give each OpenMC palette its own hue family so the choice is visible at a
// glance:
//   classic       blue module    teal classes    violet functions  khaki submodules  light-blue attributes
//   solarized     olive module   blue classes    magenta functions gold submodules   teal attributes
//   highContrast  orange module  yellow classes  green functions   cyan submodules   magenta attributes
//   pastel        lilac module   rose classes    mint functions    peach submodules  periwinkle attributes
// The `modifier` role is the any-receiver attribute coverage
// (`settings.batches`, `cell.temperature`) added alongside the OpenMC method
// list — most of a deck's visible API surface, which is what actually makes a
// palette switch legible. Other languages use the base palettes unchanged.
const ROLE_OVERRIDES: Partial<Record<Language, Partial<Record<PaletteId, Partial<Record<Role, TokenStyle>>>>>> = {
    openmc: {
        classic: {
            modifier: { foreground: '#9CDCFE' },
        },
        solarized: {
            type: { foreground: '#268BD2' },
            func: { foreground: '#D33682' },
            modifier: { foreground: '#2AA198' },
        },
        highContrast: {
            keyword: { foreground: '#FF9100' },
            type: { foreground: '#FFEA00' },
            func: { foreground: '#00E676' },
            entity: { foreground: '#40C4FF' },
            modifier: { foreground: '#FF4081' },
        },
        pastel: {
            keyword: { foreground: '#C8A2C8' },
            type: { foreground: '#FFB3BA' },
            func: { foreground: '#A8E6CF' },
            entity: { foreground: '#FFDAC1' },
            modifier: { foreground: '#C7CEEA' },
        },
    },
};

// ── Custom palette ───────────────────────────────────────────────────────────
// The 'custom' palette takes its colors from the owen.highlight.customColors
// setting. Roles the user leaves out (or sets to an invalid color) fall back
// to the Classic style for that role, so a partial config still renders.

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const FONT_STYLES = new Set(['', 'italic', 'bold', 'underline', 'italic bold', 'bold italic']);

export const ROLES: Role[] = [
    'comment', 'keyword', 'type', 'entity', 'func',
    'number', 'string', 'special', 'identifier', 'modifier',
];

let CUSTOM_COLORS: Record<Role, TokenStyle> = { ...ROLE_COLORS.classic };

/**
 * Validate a raw owen.highlight.customColors value into a full role → style
 * map. Accepts per role either a hex string ("#RRGGBB") or an object
 * `{ foreground, fontStyle? }`. Anything invalid falls back to Classic.
 */
export function resolveCustomColors(raw: unknown): Record<Role, TokenStyle> {
    const out = {} as Record<Role, TokenStyle>;
    const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    for (const role of ROLES) {
        const base = ROLE_COLORS.classic[role];
        const v = src[role];
        if (typeof v === 'string' && HEX_COLOR.test(v)) {
            out[role] = { foreground: v, ...(base.fontStyle ? { fontStyle: base.fontStyle } : {}) };
        } else if (v && typeof v === 'object') {
            const o = v as { foreground?: unknown; fontStyle?: unknown };
            const fg = typeof o.foreground === 'string' && HEX_COLOR.test(o.foreground)
                ? o.foreground : base.foreground;
            const fs = typeof o.fontStyle === 'string' && FONT_STYLES.has(o.fontStyle)
                ? o.fontStyle : base.fontStyle;
            out[role] = { foreground: fg, ...(fs ? { fontStyle: fs } : {}) };
        } else {
            out[role] = { ...base };
        }
    }
    return out;
}

/** Install the user's owen.highlight.customColors value as the Custom palette. */
export function setCustomColors(raw: unknown): void {
    CUSTOM_COLORS = resolveCustomColors(raw);
}

/** Resolve the effective style for a role, honoring custom + per-language overrides. */
function roleStyle(language: Language, palette: PaletteId, role: Role): TokenStyle {
    if (palette === 'custom') return CUSTOM_COLORS[role];
    return ROLE_OVERRIDES[language]?.[palette]?.[role] ?? ROLE_COLORS[palette][role];
}

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
        'support.variable.openmc': 'modifier',
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
    return roleStyle(language, palette, role);
}

/**
 * Build the `editor.tokenColorCustomizations.textMateRules` entries for one
 * language under the given palette. One rule per scope (scope kept as a plain
 * string) so OWEN-managed rules are trivially identifiable via MANAGED_SCOPES.
 */
export function buildRules(language: Language, palette: PaletteId): TextMateRule[] {
    const scopeRoles = SCOPE_ROLES[language];
    return Object.entries(scopeRoles).map(([scope, role]) => {
        const style = roleStyle(language, palette, role);
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
