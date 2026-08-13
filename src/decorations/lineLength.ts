// Pure, vscode-free helpers for the MCNP card-image line-length guard.
//
// MCNP "card images" (single input lines) were limited to 80 columns for ~40
// years (MCNP5, MCNP6.1 and earlier); characters past the limit are silently
// ignored, a classic source of "my card had no effect" bugs. MCNP6.2 raised
// the limit to 128 columns, and it remains 128 in 6.3.x: the 6.3.1 manual
// (LA-UR-24-24602 Rev. 1) states "All input lines are limited to 128 columns"
// in §3.2.2 (The MCNP Input File) and lists "Maximum length of an input line
// (card): 128 characters" in Table 4.1 (MCNP Code Option Limitations). We
// default to 80 (portable — flags anything that would truncate on the
// broadest set of MCNP versions) and let the user pick the dialect via
// owen.mcnp.dialect, or a raw custom limit via owen.mcnp.lineLengthLimit.
//
// Tab handling: MCNP expands tabs to the next 8-column tab stop ("Tab stops
// are set every eight characters, i.e., 9, 17, 25, etc." — §3.2.2) and
// applies the limit AFTER expansion ("The limit of input lines to 128 columns
// applies after tabs are expanded into blank spaces", same section), so we
// measure expanded width — a line that looks short with tabs can still
// overflow once expanded.

export const MCNP_DEFAULT_LINE_LIMIT = 80;
export const TAB_WIDTH = 8;

/** Column limit through MCNP 6.1 (and MCNP5). */
export const MCNP_LEGACY_LINE_LIMIT = 80;
/** Column limit for MCNP 6.2+ (LA-UR-24-24602 Rev. 1 §3.2.2, Table 4.1). */
export const MCNP_MODERN_LINE_LIMIT = 128;

/** Values of the owen.mcnp.dialect setting. */
export type McnpDialect = 'mcnp6.1-and-earlier' | 'mcnp6.2+' | 'custom';

/** How many leading lines of a deck are searched for a line-limit directive. */
export const LINE_LIMIT_DIRECTIVE_SCAN_LINES = 10;

/**
 * Per-file override: a comment card near the top of the deck, e.g.
 *
 *     c owen: line-limit=128
 *
 * The `c` must sit in columns 1–5 like any MCNP comment card (§4.4.3), so the
 * directive is inert to MCNP itself. Scanned within the first
 * {@link LINE_LIMIT_DIRECTIVE_SCAN_LINES} lines so mixed-version workspaces
 * can pin the dialect per file regardless of editor settings.
 */
const LINE_LIMIT_DIRECTIVE_RE = /^\s{0,4}c\s+owen:\s*line-limit\s*=\s*(\d{1,5})\s*$/i;

export interface LineLimitDirective {
    /** 0-based line index of the directive comment. */
    line: number;
    /** The parsed column limit. */
    limit: number;
}

export interface LineLimitSettings {
    /**
     * owen.mcnp.dialect when the user has explicitly set it; undefined when
     * the setting has never been touched (legacy resolution then honors a
     * non-default owen.mcnp.lineLengthLimit so pre-dialect configs keep
     * working).
     */
    dialect?: McnpDialect;
    /** owen.mcnp.lineLengthLimit (raw column count). */
    customLimit?: number;
}

export type LineLimitSource = 'file-directive' | 'dialect' | 'custom' | 'default';

export interface ResolvedLineLimit {
    /** The effective column limit to enforce. */
    limit: number;
    /** Where the limit came from (drives the diagnostic wording). */
    source: LineLimitSource;
    /** 0-based line of the directive when source === 'file-directive'. */
    directiveLine?: number;
}

export interface OverlengthLine {
    /** 0-based line index. */
    line: number;
    /** 0-based column where the overflow begins (== limit). */
    startCol: number;
    /** Expanded (tab-aware) length of the full line. */
    expandedLength: number;
    /** Raw character length of the line (no tab expansion). */
    rawLength: number;
}

/**
 * Expand tabs to {@link TAB_WIDTH}-column tab stops, returning the visual column
 * count the line would occupy in MCNP after tab expansion.
 */
export function expandedWidth(line: string, tabWidth: number = TAB_WIDTH): number {
    let col = 0;
    for (const ch of line) {
        if (ch === '\t') {
            col += tabWidth - (col % tabWidth);
        } else {
            col += 1;
        }
    }
    return col;
}

/**
 * Scan the top of the deck for a `c owen: line-limit=N` comment card.
 * Returns null when absent or out of range (1–10000).
 */
export function parseLineLimitDirective(text: string): LineLimitDirective | null {
    const lines = text.split(/\r\n|\r|\n/, LINE_LIMIT_DIRECTIVE_SCAN_LINES);
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(LINE_LIMIT_DIRECTIVE_RE);
        if (!m) continue;
        const limit = parseInt(m[1], 10);
        if (!Number.isFinite(limit) || limit < 1 || limit > 10000) return null;
        return { line: i, limit };
    }
    return null;
}

/**
 * Resolve the effective MCNP column limit for one document. Precedence:
 *
 *   1. A `c owen: line-limit=N` directive in the file (mixed-version
 *      workspaces; always wins so the deck carries its own truth).
 *   2. owen.mcnp.dialect when the user has set it:
 *      'mcnp6.1-and-earlier' → 80, 'mcnp6.2+' → 128,
 *      'custom' → owen.mcnp.lineLengthLimit (falls back to 80 if unset/invalid).
 *   3. Legacy: dialect never touched but owen.mcnp.lineLengthLimit set to a
 *      non-default value → honor it (configs written before the dialect
 *      toggle existed must keep behaving).
 *   4. Default 80 — flags anything that would truncate on the broadest set
 *      of MCNP versions.
 */
export function resolveLineLimit(text: string, settings: LineLimitSettings = {}): ResolvedLineLimit {
    const directive = parseLineLimitDirective(text);
    if (directive) {
        return { limit: directive.limit, source: 'file-directive', directiveLine: directive.line };
    }

    const custom =
        typeof settings.customLimit === 'number' && Number.isFinite(settings.customLimit) && settings.customLimit > 0
            ? Math.floor(settings.customLimit)
            : undefined;

    switch (settings.dialect) {
        case 'mcnp6.1-and-earlier':
            return { limit: MCNP_LEGACY_LINE_LIMIT, source: 'dialect' };
        case 'mcnp6.2+':
            return { limit: MCNP_MODERN_LINE_LIMIT, source: 'dialect' };
        case 'custom':
            return custom !== undefined
                ? { limit: custom, source: 'custom' }
                : { limit: MCNP_DEFAULT_LINE_LIMIT, source: 'default' };
        default:
            break;
    }

    if (custom !== undefined && custom !== MCNP_DEFAULT_LINE_LIMIT) {
        return { limit: custom, source: 'custom' };
    }
    return { limit: MCNP_DEFAULT_LINE_LIMIT, source: 'default' };
}

/**
 * Human wording for which dialect/setting produced a line-length warning, so
 * users learn the toggle exists straight from the diagnostic.
 */
export function describeLineLimit(resolved: ResolvedLineLimit): string {
    switch (resolved.source) {
        case 'file-directive':
            return `limit set by 'c owen: line-limit=${resolved.limit}' on line ${(resolved.directiveLine ?? 0) + 1}`;
        case 'custom':
            return 'custom limit from owen.mcnp.lineLengthLimit';
        default:
            return resolved.limit === MCNP_MODERN_LINE_LIMIT
                ? 'MCNP 6.2+ limit'
                : 'MCNP \u22646.1 limit; 6.2+ allows 128 \u2014 see owen.mcnp.dialect';
    }
}

/**
 * Find every line whose tab-expanded width exceeds `limit`. Used by both the
 * diagnostic provider and the editor decoration so the two never disagree.
 *
 * @param text  full document text (any newline style)
 * @param limit max columns allowed (default {@link MCNP_DEFAULT_LINE_LIMIT})
 */
export function findOverlengthLines(
    text: string,
    limit: number = MCNP_DEFAULT_LINE_LIMIT,
): OverlengthLine[] {
    const out: OverlengthLine[] = [];
    const lines = text.split(/\r\n|\r|\n/);
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const expanded = expandedWidth(raw);
        if (expanded > limit) {
            out.push({
                line: i,
                startCol: limit,
                expandedLength: expanded,
                rawLength: raw.length,
            });
        }
    }
    return out;
}
