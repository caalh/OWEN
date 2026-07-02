export type ConversionDirection =
    | 'mcnp_to_openmc'
    | 'openmc_to_mcnp'
    | 'mcnp_to_serpent'
    | 'mcnp_to_scone';

export interface ConversionIssue {
    /** 0-based line in the SOURCE text this issue came from (-1 = whole deck). */
    sourceLine: number;
    message: string;
}

export interface ConversionResult {
    direction: ConversionDirection;
    output: string;
    /** Constructs that could not be converted (also marked with TODO comments in output). */
    issues: ConversionIssue[];
}

/** Marker used in every emitted TODO comment so tests/webview can find them. */
export const TODO_MARK = 'TODO(owen-convert)';
