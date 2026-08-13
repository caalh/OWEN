/**
 * Editor-agnostic diagnostic types shared by the LSP server (owen/server/),
 * the legacy manual validate command, and the headless test suite.
 * No `vscode` and no `vscode-languageserver` imports allowed here.
 */

export type PlainSeverity = 'error' | 'warning' | 'information' | 'hint';

export interface PlainDiagnostic {
    /** 0-based line. */
    line: number;
    /** 0-based inclusive start column. */
    startCol: number;
    /** 0-based exclusive end column. */
    endCol: number;
    message: string;
    severity: PlainSeverity;
    code: string;
    /** True for "defined but never used" hints (maps to DiagnosticTag.Unnecessary). */
    unnecessary?: boolean;
}

export type RulesLanguage = 'mcnp' | 'openmc' | 'serpent' | 'scone';

export interface RulesOptions {
    /**
     * MCNP card-image column limit (owen.mcnp.lineLengthLimit). Used when
     * mcnpDialect is 'custom', or as the legacy pre-dialect setting when
     * mcnpDialect is undefined. Default 80.
     */
    mcnpLineLimit?: number;
    /**
     * owen.mcnp.dialect when the user has explicitly set it: 80 columns for
     * 'mcnp6.1-and-earlier', 128 for 'mcnp6.2+', or the raw mcnpLineLimit for
     * 'custom'. A `c owen: line-limit=N` directive in the file always wins.
     * Resolution lives in decorations/lineLength.ts (resolveLineLimit).
     */
    mcnpDialect?: 'mcnp6.1-and-earlier' | 'mcnp6.2+' | 'custom';
}
