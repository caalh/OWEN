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
    /** MCNP card-image column limit (owen.mcnp.lineLengthLimit). Default 80. */
    mcnpLineLimit?: number;
}
