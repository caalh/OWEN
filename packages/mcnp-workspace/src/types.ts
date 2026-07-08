export type PlainSeverity = 'error' | 'warning' | 'information' | 'hint';

export interface PlainDiagnostic {
    line: number;
    startCol: number;
    endCol: number;
    message: string;
    severity: PlainSeverity;
    code: string;
    unnecessary?: boolean;
}

export interface WorkspaceDiagnostic extends PlainDiagnostic {
    file: string;
}

export interface ValidationSummary {
    errors: number;
    warnings: number;
    hints: number;
}

export interface ValidationResult {
    version: 1;
    root: string;
    files: string[];
    diagnostics: WorkspaceDiagnostic[];
    summary: ValidationSummary;
}

export interface IncludeEdge {
    from: string;
    to: string;
    line: number;
    startCol: number;
    endCol: number;
    kind: 'read' | 'copy';
}

export interface IncludeGraphResult {
    root: string;
    files: Map<string, string>;
    edges: IncludeEdge[];
    errors: WorkspaceDiagnostic[];
}

export interface ValidateMcnpProjectOptions {
    rootPath: string;
    warnUnused?: boolean;
    /** Override file text (e.g. unsaved editor buffers). Keys are absolute paths. */
    fileOverrides?: Map<string, string>;
}
