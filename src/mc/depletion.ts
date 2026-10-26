/**
 * Constant-flux Bateman integrator.
 *
 * dy/dt = A y + b. The source is kept out of the exponential: y = y_eq + exp(At)(y0 − y_eq).
 * The integrator is what scripts/verify-mc-burnup.mjs checks against SciPy's
 * expm and against the closed-form xenon equilibrium. The yields below are
 * textbook thermal U-235 figures, not an ENDF evaluation. Half-lives are the
 * evaluated I-135 (6.57 h) and Xe-135 (9.14 h).
 */

export const XENON = {
  halfLifeI_s: 6.57 * 3600,
  halfLifeXe_s: 9.14 * 3600,
  gammaI: 0.061,
  gammaXe: 0.003,
  /** Thermal Xe-135 absorption, barns. Textbook figure paired with the yields. */
  sigmaXe_b: 2.65e6,
};

export interface XenonState {
  nI: number;
  nXe: number;
  /** Seconds. */
  t: number;
}

function clone(A: number[][]): number[][] {
  return A.map((row) => row.slice());
}

function norm1(A: number[][]): number {
  const n = A.length;
  let max = 0;
  for (let j = 0; j < n; j++) {
    let col = 0;
    for (let i = 0; i < n; i++) col += Math.abs(A[i][j]);
    if (col > max) max = col;
  }
  return max;
}

function matmul(A: number[][], B: number[][]): number[][] {
  const n = A.length;
  const out: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < n; k++) {
      const aik = A[i][k];
      if (aik === 0) continue;
      for (let j = 0; j < n; j++) out[i][j] += aik * B[k][j];
    }
  }
  return out;
}

function addScaled(into: number[][], B: number[][], scale: number): void {
  for (let i = 0; i < into.length; i++) {
    for (let j = 0; j < into.length; j++) into[i][j] += scale * B[i][j];
  }
}

/** Matrix exponential by scaling and a Taylor polynomial. Fine for these small burn matrices. */
export function expm(A: number[][]): number[][] {
  return taylor(A, scaleOf(A));
}

function taylor(A: number[][], s: number): number[][] {
  const n = A.length;
  const scaled = clone(A);
  const div = 2 ** s;
  if (div !== 1) {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) scaled[i][j] /= div;
  }
  const acc: number[][] = Array.from({ length: n }, (_, i) => {
    const row = new Array<number>(n).fill(0);
    row[i] = 1;
    return row;
  });
  let term: number[][] = Array.from({ length: n }, (_, i) => {
    const row = new Array<number>(n).fill(0);
    row[i] = 1;
    return row;
  });
  for (let k = 1; k <= 18; k++) {
    term = matmul(term, scaled);
    const factor = 1 / factorial(k);
    addScaled(acc, term, factor);
  }
  let result = acc;
  for (let i = 0; i < s; i++) result = matmul(result, result);
  return result;
}

function factorial(k: number): number {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return f;
}

export function matVec(A: number[][], x: number[]): number[] {
  return A.map((row) => row.reduce((sum, value, j) => sum + value * x[j], 0));
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const diag = M[col][col];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col] / diag;
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * y(t) for dy/dt = A y + b.
 * y = y_eq + exp(A t) (y0 − y_eq), with A y_eq = −b.
 * Putting b inside an augmented exponential overflows when the source is
 * 10^13 and the decay constants are 10^-5, so the source stays outside expm.
 */
export function burnAffine(A: number[][], b: number[], y0: number[], t: number): number[] {
  const yEq = solve(A, b.map((value) => -value));
  const At = A.map((row) => row.map((value) => value * t));
  const E = expm(At);
  const delta = matVec(E, y0.map((value, i) => value - yEq[i]));
  return yEq.map((value, i) => value + delta[i]);
}

function scaleOf(A: number[][]): number {
  const nrm = norm1(A);
  return nrm > 0 ? Math.max(0, Math.ceil(Math.log2(nrm))) : 0;
}

/** I-135 / Xe-135 at constant fission rate density (fissions per cm³ per s) and flux. */
export function xenonState(fissionRate: number, flux: number, t: number, nI0 = 0, nXe0 = 0): XenonState {
  const lambdaI = Math.LN2 / XENON.halfLifeI_s;
  const lambdaXe = Math.LN2 / XENON.halfLifeXe_s;
  const removal = lambdaXe + XENON.sigmaXe_b * 1e-24 * flux;
  const A = [
    [-lambdaI, 0],
    [lambdaI, -removal],
  ];
  const b = [XENON.gammaI * fissionRate, XENON.gammaXe * fissionRate];
  const [nI, nXe] = burnAffine(A, b, [nI0, nXe0], t);
  return { nI, nXe, t };
}
