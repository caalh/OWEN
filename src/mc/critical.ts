/**
 * Bisection search for the vacuum-sphere radius whose one-group k is 1.
 * The diffusion critical radius is computed in the verify script, not here,
 * so this search cannot be tuned to a formula that lives beside it.
 */

import { kEigenvalue, type KOptions, type OneGroupMaterial } from "./transport";

export interface CriticalSearch {
  radiusCm: number;
  k: number;
  sigma: number;
  /** Half-width of the final bracket (cm). */
  bracketCm: number;
}

export function criticalRadius(
  mat: OneGroupMaterial,
  opt: KOptions,
  bounds: { lo: number; hi: number; iterations: number },
): CriticalSearch {
  let lo = bounds.lo;
  let hi = bounds.hi;
  let mid = (lo + hi) / 2;
  let result = kEigenvalue(mat, { kind: "sphere", radiusCm: mid, boundary: "vacuum" }, opt);
  for (let i = 0; i < bounds.iterations; i++) {
    mid = (lo + hi) / 2;
    result = kEigenvalue(mat, { kind: "sphere", radiusCm: mid, boundary: "vacuum" }, { ...opt, seed: opt.seed + i });
    if (result.k < 1) lo = mid;
    else hi = mid;
  }
  return { radiusCm: (lo + hi) / 2, k: result.k, sigma: result.sigma, bracketCm: (hi - lo) / 2 };
}
