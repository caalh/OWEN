/** Unified intermediate representation for Monte Carlo run results. */

export interface KeffHistory {
    cycles: number[];
    mean: number[];
    std: number[];
    final?: { mean: number; std: number };
    /** Number of discarded (inactive/settling) cycles, when the output says. */
    inactive?: number;
    /** Shannon entropy of the fission source per cycle, aligned with `cycles`, when printed. */
    entropy?: number[];
}

/** One k-eff estimator's final value (collision, absorption, track-length, combined). */
export interface KeffEstimator {
    name: string;
    mean: number;
    std: number;
}

/** One row of MCNP's ten statistical checks for a tally's TFC bin. */
export interface StatisticalCheck {
    name: string;
    desired: string;
    observed: string;
    passed: boolean;
}

/**
 * What the run itself says about convergence, plus OWEN's reading of the
 * history. The verdict is heuristic and says so: it compares the first and
 * second halves of the active cycles, looks for a drift, and checks that the
 * source entropy had flattened before the active cycles began.
 */
export interface ConvergenceReport {
    estimators?: KeffEstimator[];
    lostParticles?: number;
    /** Active cycles used for the verdict. */
    activeCycles?: number;
    /** Mean k over the first / second half of the active cycles. */
    firstHalf?: number;
    secondHalf?: number;
    /** Standard deviation of the per-cycle k over the active cycles. */
    cycleSigma?: number;
    /** |first − second| in units of its own standard error. */
    halvesZ?: number;
    /** Linear drift over the active cycles, per cycle, in units of its standard error. */
    driftZ?: number;
    /** Entropy: last-inactive-cycles mean vs active mean, in sigma. Null when no entropy. */
    entropyZ?: number | null;
    /** 'converged' | 'suspect' | 'unconverged' | 'unknown' */
    verdict: 'converged' | 'suspect' | 'unconverged' | 'unknown';
    reasons: string[];
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
    /** MCNP: the ten checks row by row (desired / observed / passed). */
    checkDetail?: StatisticalCheck[];
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
    /** Convergence diagnostics; filled by `attachConvergence` for every code. */
    convergence?: ConvergenceReport;
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
