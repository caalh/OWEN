/** Unified intermediate representation for Monte Carlo run results. */

export interface KeffHistory {
    cycles: number[];
    mean: number[];
    std: number[];
    final?: { mean: number; std: number };
    /** Number of discarded (inactive/settling) cycles, when the output says. */
    inactive?: number;
}

export interface FluxSpectrum {
    label: string;
    E: number[];
    phi: number[];
    unit?: string;
}

/** One scoring bin inside a tally (cell, surface, nuclide, energy group, …). */
export interface TallyBin {
    label: string;
    value: number;
    /** Relative error as a fraction, matching how MCNP and OpenMC report it. */
    error?: number;
}

/** Convergence history of a single tally (MCNP tally fluctuation chart). */
export interface TallyHistory {
    /** Histories (nps) or batches at which the row was written. */
    x: number[];
    mean: number[];
    error: number[];
    fom?: number[];
}

export interface TallyEntry {
    id: string;
    label: string;
    value: number;
    error?: number;
    unit?: string;
    bins?: TallyBin[];
    /** MCNP: result of the 10 statistical checks on the TFC bin. */
    checks?: 'passed' | 'missed' | 'zero' | 'unknown';
    /** Human-readable status straight from the output file. */
    note?: string;
    fom?: number;
    history?: TallyHistory;
}

export interface MeshTally {
    id: string;
    label: string;
    nx: number;
    ny: number;
    nz: number;
    /** Flattened values [i + nx*(j + ny*k)] */
    values: number[];
    errors?: number[];
    bounds?: { xmin: number; xmax: number; ymin: number; ymax: number; zmin: number; zmax: number };
    unit?: string;
}

export interface RunResults {
    code: 'openmc' | 'mcnp' | 'serpent' | 'scone';
    sourceFile?: string;
    workDir?: string;
    keff?: KeffHistory;
    spectra: FluxSpectrum[];
    tallies: TallyEntry[];
    meshTallies: MeshTally[];
    metadata?: Record<string, string | number>;
    /** Warnings and fatal errors lifted out of the output file itself. */
    warnings?: string[];
    /** What OWEN could not read, so the panel can say so instead of showing nothing. */
    notes?: string[];
}

export type OutputKind =
    | 'statepoint'
    | 'mctal'
    | 'outp'
    | 'resm'
    | 'detm'
    | 'scone_out'
    | 'openmc_tallies'
    | 'stdout';

export interface DetectedOutput {
    path: string;
    code: RunResults['code'];
    kind: OutputKind;
    label: string;
    /** Last-modified time, used to prefer the newest of several same-kind files. */
    mtime?: number;
}
