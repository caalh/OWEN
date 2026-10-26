/**
 * Whether an OpenMC k-history is allowed to be quoted as a final answer.
 *
 * The tests are the usual criticality ones: active-cycle halves agree, the
 * active k has no linear drift, and the fission-source entropy had already
 * flattened before the first active cycle. An unconverged or unknown history
 * withholds the headline k. A suspect history (between 2σ and 3σ) still
 * reports k, with the verdict in the line.
 *
 * Same arithmetic as OWEN's results/convergence.ts. This copy lives in the
 * site kernel and is hand-copied to owen/src/mc/workbench.ts.
 */

export interface CycleHistory {
  mean: number[];
  entropy?: number[];
  inactive: number;
}

export type WorkbenchVerdictName = "converged" | "suspect" | "unconverged" | "unknown";

export interface WorkbenchVerdict {
  verdict: WorkbenchVerdictName;
  reportK: boolean;
  k: number | null;
  sigma: number | null;
  reasons: string[];
}

export interface TallyRow {
  name: string;
  mean: number;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;
}

function stdev(values: number[]): number {
  if (values.length < 2) return NaN;
  const center = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1));
}

function slope(values: number[]): { b: number; se: number } {
  const n = values.length;
  if (n < 4) return { b: NaN, se: NaN };
  const mx = (n - 1) / 2;
  const my = mean(values);
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (i - mx) ** 2;
    sxy += (i - mx) * (values[i] - my);
  }
  const b = sxy / sxx;
  const a = my - b * mx;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (values[i] - (a + b * i)) ** 2;
  const se = Math.sqrt(ss / (n - 2) / sxx);
  return { b, se };
}

export function assessHistory(history: CycleHistory): WorkbenchVerdict {
  const reasons: string[] = [];
  const inactive = Math.max(0, Math.min(history.inactive ?? 0, Math.max(0, history.mean.length - 4)));
  const active = history.mean.slice(inactive).filter(Number.isFinite);
  if (history.mean.length < 6 || active.length < 6) {
    reasons.push("Too few active cycles to judge convergence.");
    return { verdict: "unknown", reportK: false, k: null, sigma: null, reasons };
  }
  const half = Math.floor(active.length / 2);
  const first = active.slice(0, half);
  const second = active.slice(active.length - half);
  const spread = stdev(active);
  const seDiff = spread * Math.sqrt(1 / first.length + 1 / second.length);
  const halvesZ = seDiff > 0 ? Math.abs(mean(first) - mean(second)) / seDiff : 0;
  const { b: drift, se } = slope(active);
  const driftZ = se > 0 ? Math.abs(drift) / se : 0;
  let bad = 0;
  let warn = 0;
  if (halvesZ > 3) {
    bad += 1;
    reasons.push(`Active-cycle halves differ by ${halvesZ.toFixed(1)}σ.`);
  } else if (halvesZ > 2) {
    warn += 1;
    reasons.push(`Active-cycle halves differ by ${halvesZ.toFixed(1)}σ.`);
  } else {
    reasons.push(`Active-cycle halves agree (${halvesZ.toFixed(1)}σ).`);
  }
  if (driftZ > 3) {
    bad += 1;
    reasons.push(`Active k still drifts (${driftZ.toFixed(1)}σ).`);
  } else if (driftZ > 2) {
    warn += 1;
    reasons.push(`Active k has a slight drift (${driftZ.toFixed(1)}σ).`);
  }

  const entropy = history.entropy;
  if (entropy && entropy.length === history.mean.length) {
    const tailStart = Math.max(0, inactive - Math.max(5, Math.floor(inactive / 4)));
    const tail = entropy.slice(tailStart, inactive).filter(Number.isFinite);
    const act = entropy.slice(inactive).filter(Number.isFinite);
    const sa = stdev(act);
    if (tail.length >= 3 && act.length >= 6 && sa > 0) {
      const z = Math.abs(mean(tail) - mean(act)) / (sa * Math.sqrt(1 / tail.length + 1 / act.length));
      if (z > 3) {
        bad += 1;
        reasons.push(`Source entropy was still changing at the first active cycle (${z.toFixed(1)}σ).`);
      } else if (z > 2) {
        warn += 1;
        reasons.push(`Source entropy had not quite flattened (${z.toFixed(1)}σ).`);
      } else {
        reasons.push("Source entropy was flat before the active cycles.");
      }
    } else {
      reasons.push("Source entropy has no variance to test.");
    }
  } else {
    reasons.push("No source-entropy history; source convergence is unchecked.");
    bad += 1;
  }

  const verdict: WorkbenchVerdictName = bad ? "unconverged" : warn ? "suspect" : "converged";
  const reportK = verdict === "converged" || verdict === "suspect";
  const k = reportK ? mean(active) : null;
  const sigma = reportK && spread > 0 ? spread / Math.sqrt(active.length) : reportK ? 0 : null;
  return { verdict, reportK, k, sigma, reasons };
}

/**
 * |production − k (absorption + leakage)| / production.
 * Zero leakage is the reflective-pin case: k should equal production/absorption.
 */
export function eigenvalueBalance(production: number, absorption: number, leakage: number, k: number): number {
  const removal = absorption + leakage;
  if (!(production > 0) || !(removal > 0) || !(k > 0)) return Number.POSITIVE_INFINITY;
  return Math.abs(production - k * removal) / production;
}

export function formatReactorPanel(verdict: WorkbenchVerdict | null, tallies: TallyRow[]): string {
  const guidance = "OpenMC runs in WSL. A final k is shown only after the active cycles and the source entropy are flat. An unconverged source is withheld, not printed as an answer.";
  const headline = verdict && verdict.reportK && verdict.k !== null
    ? `k ${verdict.k.toFixed(5)} ± ${(verdict.sigma ?? 0).toFixed(5)} ${verdict.verdict}`
    : `Final k withheld${verdict ? ` (${verdict.verdict})` : ": no OpenMC statepoint is attached"}`;
  const reasons = verdict ? verdict.reasons.join(" ") : "Run the deck in OpenMC to attach a k history and a tally table.";
  const table = tallies.length
    ? tallies.map((row) => `${row.name} ${row.mean.toExponential(4)}`).join("\n")
    : "No tally table.";
  return `${guidance}\n${headline}\n${reasons}\n${table}`;
}
