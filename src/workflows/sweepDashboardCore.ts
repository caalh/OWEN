// Pure, vscode-free aggregation core for the sweep results dashboard
// (owen.viewSweepResults). Takes the sweep-manifest.json written by
// workflows/sweep.ts plus per-run RunResults parsed by src/results/, and
// produces the data the dashboard webview plots: k-eff vs the swept
// parameter (with error bars), per-run convergence small-multiples, and a
// table of runs. Unit tested directly (see sweepDashboard.test.ts).

import type { SweepManifest, SweepParameter, RunRecord } from './sweepCore';
import type { RunResults } from '../results/types';

export interface SweepRunSummary {
    index: number;
    parameters: Record<string, string | number>;
    /** Best k-eff: parsed results final value, else the manifest's grep value. */
    keff: number | null;
    keffStd: number | null;
    exitCode: number | null;
    outputDir: string;
    /** Per-cycle convergence history when the run's outputs were parseable. */
    convergence: { cycles: number[]; mean: number[] } | null;
}

export interface SweepDashboardData {
    /** Name of the swept axis parameter (first parameter with >1 distinct value). */
    paramName: string | null;
    /** Numeric axis values per point, aligned with keff/keffStd (sorted by x). */
    x: number[];
    keff: Array<number | null>;
    keffStd: Array<number | null>;
    runs: SweepRunSummary[];
    /** Names of parameters that could not be used as the numeric axis. */
    otherParams: string[];
}

/**
 * The swept axis is the first parameter whose value list has more than one
 * distinct value. Returns null for degenerate sweeps (0 params or all-constant).
 */
export function chooseSweepAxis(parameters: SweepParameter[]): string | null {
    for (const p of parameters) {
        const distinct = new Set(p.values.map((v) => String(v)));
        if (distinct.size > 1) return p.name;
    }
    return parameters.length > 0 ? parameters[0].name : null;
}

function toNumber(v: string | number | undefined): number | null {
    if (v === undefined) return null;
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : null;
}

function summarizeRun(record: RunRecord, results: RunResults | null): SweepRunSummary {
    let keff: number | null = record.keff ?? null;
    let keffStd: number | null = null;
    let convergence: SweepRunSummary['convergence'] = null;

    if (results?.keff && results.keff.mean.length > 0) {
        const k = results.keff;
        keff = k.final?.mean ?? k.mean[k.mean.length - 1];
        keffStd = k.final?.std ?? (k.std.length ? k.std[k.std.length - 1] : null);
        if (k.mean.length > 1) {
            convergence = { cycles: k.cycles.slice(), mean: k.mean.slice() };
        }
    }

    return {
        index: record.index,
        parameters: record.parameters,
        keff,
        keffStd,
        exitCode: record.exitCode,
        outputDir: record.outputDir,
        convergence,
    };
}

/**
 * Build the dashboard data set. `perRun` maps run index → parsed RunResults
 * (null when the run produced no parseable output; the manifest grep k-eff is
 * used as fallback so the sweep-level chart stays useful).
 */
export function buildDashboard(
    manifest: SweepManifest,
    perRun: Map<number, RunResults | null>,
): SweepDashboardData {
    const paramName = chooseSweepAxis(manifest.parameters);
    const runs = manifest.runs.map((r) => summarizeRun(r, perRun.get(r.index) ?? null));

    const points: Array<{ x: number; keff: number | null; std: number | null }> = [];
    if (paramName) {
        for (const run of runs) {
            const x = toNumber(run.parameters[paramName]);
            if (x === null) continue;
            points.push({ x, keff: run.keff, std: run.keffStd });
        }
        points.sort((a, b) => a.x - b.x);
    }

    return {
        paramName,
        x: points.map((p) => p.x),
        keff: points.map((p) => p.keff),
        keffStd: points.map((p) => p.std),
        runs,
        otherParams: manifest.parameters
            .map((p) => p.name)
            .filter((n) => n !== paramName),
    };
}
