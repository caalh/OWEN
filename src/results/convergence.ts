// Convergence reading of a k-eff history — the part of a results file people
// look at last and should look at first.
//
// The tests are the ones every criticality course teaches: the active cycles
// should have no trend (first half ≈ second half, no drift), and the source
// entropy should have flattened before the first active cycle, else the
// inactive count was too small and the "converged" k is biased. None of this
// is a proof; the verdict is a prompt to look at the plot.
//
// No vscode import: runs in the parsers' tests.

import type { ConvergenceReport, KeffHistory, RunResults } from './types';

function mean(a: number[]): number {
    return a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN;
}

function stdev(a: number[]): number {
    if (a.length < 2) return NaN;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

/** Slope of y over x, with its standard error (ordinary least squares). */
function slope(y: number[]): { b: number; se: number } {
    const n = y.length;
    if (n < 4) return { b: NaN, se: NaN };
    const xs = y.map((_, i) => i);
    const mx = mean(xs), my = mean(y);
    let sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (y[i] - my); }
    const b = sxy / sxx;
    const a = my - b * mx;
    let ss = 0;
    for (let i = 0; i < n; i++) ss += (y[i] - (a + b * xs[i])) ** 2;
    const se = Math.sqrt(ss / (n - 2) / sxx);
    return { b, se };
}

export function assessConvergence(keff: KeffHistory | undefined, base: Partial<ConvergenceReport> = {}): ConvergenceReport {
    const report: ConvergenceReport = { ...base, verdict: 'unknown', reasons: [] };
    if (!keff || keff.mean.length < 6) {
        report.reasons.push(keff && keff.mean.length
            ? 'Too few cycles in the output to judge a trend (need a per-cycle k table).'
            : 'No per-cycle k-eff history in this output.');
        return report;
    }
    const inactive = Math.max(0, Math.min(keff.inactive ?? 0, keff.mean.length - 4));
    const active = keff.mean.slice(inactive).filter(Number.isFinite);
    if (active.length < 6) {
        report.reasons.push(`Only ${active.length} active cycles; the halves test needs at least 6.`);
        return report;
    }
    report.activeCycles = active.length;
    const half = Math.floor(active.length / 2);
    const a = active.slice(0, half), b = active.slice(active.length - half);
    const s = stdev(active);
    report.firstHalf = mean(a);
    report.secondHalf = mean(b);
    report.cycleSigma = s;
    const seDiff = s * Math.sqrt(1 / a.length + 1 / b.length);
    report.halvesZ = seDiff > 0 ? Math.abs(report.firstHalf - report.secondHalf) / seDiff : 0;
    const { b: drift, se } = slope(active);
    report.driftZ = se > 0 ? Math.abs(drift) / se : 0;

    let bad = 0, warn = 0;
    if (report.halvesZ > 3) { bad++; report.reasons.push(`First and second halves of the active cycles differ by ${report.halvesZ.toFixed(1)}σ (${report.firstHalf.toFixed(5)} vs ${report.secondHalf.toFixed(5)}): k is still moving.`); }
    else if (report.halvesZ > 2) { warn++; report.reasons.push(`Halves differ by ${report.halvesZ.toFixed(1)}σ — borderline; more active cycles would settle it.`); }
    else report.reasons.push(`Halves agree (${report.halvesZ.toFixed(1)}σ apart).`);
    if (report.driftZ > 3) { bad++; report.reasons.push(`A linear drift of ${(drift * active.length).toExponential(2)} over the active cycles is ${report.driftZ.toFixed(1)}σ from flat.`); }
    else if (report.driftZ > 2) { warn++; report.reasons.push(`Slight drift (${report.driftZ.toFixed(1)}σ) across the active cycles.`); }

    if (keff.entropy && keff.entropy.length === keff.mean.length) {
        const ent = keff.entropy;
        const tail = ent.slice(Math.max(0, inactive - Math.max(5, Math.floor(inactive / 4))), inactive).filter(Number.isFinite);
        const act = ent.slice(inactive).filter(Number.isFinite);
        const sa = stdev(act);
        if (tail.length >= 3 && act.length >= 6 && sa > 0) {
            const z = Math.abs(mean(tail) - mean(act)) / (sa * Math.sqrt(1 / tail.length + 1 / act.length));
            report.entropyZ = z;
            if (z > 3) { bad++; report.reasons.push(`Source entropy was still changing when the active cycles began (${z.toFixed(1)}σ): raise the inactive cycle count.`); }
            else if (z > 2) { warn++; report.reasons.push(`Source entropy had not quite flattened before the active cycles (${z.toFixed(1)}σ).`); }
            else report.reasons.push('Source entropy was flat before the first active cycle.');
        } else {
            report.entropyZ = null;
        }
    } else {
        report.entropyZ = null;
        report.reasons.push('No source-entropy history in this output; source convergence is unchecked.');
    }
    if (typeof report.lostParticles === 'number' && report.lostParticles > 0) {
        warn++;
        report.reasons.push(`${report.lostParticles} lost particle${report.lostParticles === 1 ? '' : 's'}: run OWEN: Check Geometry.`);
    }
    report.verdict = bad ? 'unconverged' : warn ? 'suspect' : 'converged';
    return report;
}

/** Fill `results.convergence` from the history (idempotent; keeps parser-supplied fields). */
export function attachConvergence(results: RunResults): RunResults {
    results.convergence = assessConvergence(results.keff, results.convergence ?? {});
    return results;
}
