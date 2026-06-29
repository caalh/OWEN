/** Unified intermediate representation for Monte Carlo run results. */

export interface KeffHistory {
    cycles: number[];
    mean: number[];
    std: number[];
    final?: { mean: number; std: number };
}

export interface FluxSpectrum {
    label: string;
    E: number[];
    phi: number[];
    unit?: string;
}

export interface TallyEntry {
    id: string;
    label: string;
    value: number;
    error?: number;
    unit?: string;
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
}

export interface DetectedOutput {
    path: string;
    code: RunResults['code'];
    kind: 'statepoint' | 'mctal' | 'resm' | 'detm' | 'scone_out' | 'stdout';
    label: string;
}
