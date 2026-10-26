/**
 * Multigroup Monte Carlo k-eigenvalue solver.
 *
 * This is the representation reactor physics actually uses: energy split into
 * groups, a full scattering matrix (down- and up-scatter), a fission spectrum
 * χ, and ν̄Σf per group, per material. It is a real step past the one-group
 * kernel — and it stays cheat-proof, because the infinite-medium k of a
 * multigroup material is the exact dominant eigenvalue of
 *
 *     k  =  ρ[ (T − S)^(-1) F ]
 *
 * with T = diag(Σt_g), S the in-scatter matrix, F_{g,g'} = χ_g ν̄Σf_{g'}.
 * `kInfinityMultigroup` computes that eigenvalue by deterministic linear
 * algebra; the Monte Carlo walk must reproduce it (scripts/verify-mc-multigroup).
 * The multigroup constants here are illustrative reactor-physics numbers, not a
 * published benchmark. This is a teaching solver.
 */

export interface MgMaterial {
  groups: number;
  /** Total macroscopic cross section Σt_g (cm^-1). */
  total: number[];
  /** Fission macroscopic cross section Σf_g (cm^-1). */
  fission: number[];
  /** Production ν̄Σf_g (cm^-1). */
  nuFission: number[];
  /** Fission spectrum χ_g; normalised to sum 1. */
  chi: number[];
  /** scatter[g][g'] = Σs_{g→g'} (cm^-1). Row g is where a group-g neutron goes. */
  scatter: number[][];
}

export type MgBoundary = "vacuum" | "reflective";

export interface MgGeometry {
  kind: "infinite" | "sphere" | "coreReflector";
  radiusCm?: number;
  boundary?: MgBoundary;
  coreRadiusCm?: number;
  reflector?: MgMaterial;
  outerBoundary?: MgBoundary;
}

export interface MgOptions {
  particles: number;
  cycles: number;
  inactive: number;
  seed: number;
}

export interface MgResult {
  k: number;
  sigma: number;
  cycleK: number[];
  histories: number;
}

type Vec3 = [number, number, number];
interface Fission {
  p: Vec3;
  g: number;
}

const HIT_EPS = 1e-9;
const NUDGE = 1e-7;
const MAX_STEPS = 100000;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function scatterRowSum(mat: MgMaterial, g: number): number {
  let s = 0;
  const row = mat.scatter[g];
  for (let i = 0; i < row.length; i++) s += row[i];
  return s;
}

/** Capture Σc_g = Σt_g − (scatter out of g) − Σf_g. Negative means a bad library. */
export function captureOf(mat: MgMaterial, g: number): number {
  return mat.total[g] - scatterRowSum(mat, g) - mat.fission[g];
}

function isotropic(rng: () => number): Vec3 {
  const mu = 2 * rng() - 1;
  const phi = 2 * Math.PI * rng();
  const s = Math.sqrt(Math.max(0, 1 - mu * mu));
  return [s * Math.cos(phi), s * Math.sin(phi), mu];
}

function sampleChi(mat: MgMaterial, rng: () => number): number {
  const xi = rng();
  let acc = 0;
  for (let g = 0; g < mat.groups; g++) {
    acc += mat.chi[g];
    if (xi <= acc) return g;
  }
  return mat.groups - 1;
}

function sampleInSphere(radius: number, rng: () => number): Vec3 {
  for (;;) {
    const x = (2 * rng() - 1) * radius;
    const y = (2 * rng() - 1) * radius;
    const z = (2 * rng() - 1) * radius;
    if (x * x + y * y + z * z <= radius * radius) return [x, y, z];
  }
}

function sampleSite(geo: MgGeometry, rng: () => number): Vec3 {
  if (geo.kind === "sphere") return sampleInSphere(geo.radiusCm ?? 1, rng);
  if (geo.kind === "coreReflector") return sampleInSphere(geo.coreRadiusCm ?? 1, rng);
  return [0, 0, 0];
}

function sphereExit(p: Vec3, d: Vec3, radius: number): number | null {
  const b = p[0] * d[0] + p[1] * d[1] + p[2] * d[2];
  const c = p[0] * p[0] + p[1] * p[1] + p[2] * p[2] - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const dist = -b + Math.sqrt(disc);
  return dist > HIT_EPS ? dist : null;
}

function sphereEnter(p: Vec3, d: Vec3, radius: number): number | null {
  const b = p[0] * d[0] + p[1] * d[1] + p[2] * d[2];
  const c = p[0] * p[0] + p[1] * p[1] + p[2] * p[2] - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const dist = -b - Math.sqrt(disc);
  return dist > HIT_EPS ? dist : null;
}

function materialAt(p: Vec3, fuel: MgMaterial, geo: MgGeometry): MgMaterial {
  if (geo.kind !== "coreReflector" || !geo.reflector) return fuel;
  const core = geo.coreRadiusCm ?? 0;
  const r2 = p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
  return r2 <= core * core ? fuel : geo.reflector;
}

type Hit =
  | { dist: number; kind: "leak" }
  | { dist: number; kind: "reflect" }
  | { dist: number; kind: "cross" };

function nextHit(p: Vec3, d: Vec3, geo: MgGeometry): Hit | null {
  if (geo.kind === "infinite") return null;
  if (geo.kind === "sphere") {
    const dist = sphereExit(p, d, geo.radiusCm ?? 0);
    if (dist === null) return null;
    return geo.boundary === "reflective" ? { dist, kind: "reflect" } : { dist, kind: "leak" };
  }
  const core = geo.coreRadiusCm ?? 0;
  const outer = geo.radiusCm ?? core;
  const r2 = p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
  if (outer <= core + 1e-9) {
    const dist = sphereExit(p, d, core);
    return dist === null ? null : { dist, kind: "leak" };
  }
  if (r2 <= core * core) {
    const dist = sphereExit(p, d, core);
    return dist === null ? null : { dist, kind: "cross" };
  }
  const intoCore = sphereEnter(p, d, core);
  const out = sphereExit(p, d, outer);
  if (intoCore !== null && (out === null || intoCore < out)) return { dist: intoCore, kind: "cross" };
  if (out === null) return null;
  return geo.outerBoundary === "reflective" ? { dist: out, kind: "reflect" } : { dist: out, kind: "leak" };
}

function move(p: Vec3, d: Vec3, dist: number): void {
  p[0] += d[0] * dist;
  p[1] += d[1] * dist;
  p[2] += d[2] * dist;
}

function reflectSphere(p: Vec3, d: Vec3): void {
  const r = Math.hypot(p[0], p[1], p[2]) || 1;
  const n: Vec3 = [p[0] / r, p[1] / r, p[2] / r];
  const dot = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
  d[0] -= 2 * dot * n[0];
  d[1] -= 2 * dot * n[1];
  d[2] -= 2 * dot * n[2];
  p[0] -= n[0] * NUDGE;
  p[1] -= n[1] * NUDGE;
  p[2] -= n[2] * NUDGE;
}

function simulate(start: Vec3, group: number, fuel: MgMaterial, geo: MgGeometry, rng: () => number, out: Fission[]): void {
  const p: Vec3 = [start[0], start[1], start[2]];
  let d = isotropic(rng);
  let g = group;
  let mat = materialAt(p, fuel, geo);

  for (let step = 0; step < MAX_STEPS; step++) {
    const sigmaT = mat.total[g];
    if (!(sigmaT > 0)) return;
    const dColl = -Math.log(Math.max(rng(), 1e-300)) / sigmaT;
    const hit = nextHit(p, d, geo);
    if (hit && hit.dist < dColl) {
      move(p, d, hit.dist);
      if (hit.kind === "leak") return;
      if (hit.kind === "reflect") {
        reflectSphere(p, d);
        continue;
      }
      move(p, d, NUDGE);
      mat = materialAt(p, fuel, geo);
      continue;
    }
    move(p, d, dColl);

    const sRow = scatterRowSum(mat, g);
    const fis = mat.fission[g];
    const r = rng() * sigmaT;
    if (r < sRow) {
      // Scatter: choose destination group.
      let acc = 0;
      const row = mat.scatter[g];
      let dest = row.length - 1;
      for (let gp = 0; gp < row.length; gp++) {
        acc += row[gp];
        if (r <= acc) {
          dest = gp;
          break;
        }
      }
      g = dest;
      d = isotropic(rng);
      continue;
    }
    if (r < sRow + fis) {
      // Fission.
      const nubar = fis > 0 ? mat.nuFission[g] / fis : 0;
      const born = Math.floor(nubar + rng());
      for (let i = 0; i < born; i++) out.push({ p: [p[0], p[1], p[2]], g: sampleChi(mat, rng) });
      return;
    }
    // Capture.
    return;
  }
}

export function kMultigroup(fuel: MgMaterial, geo: MgGeometry, opt: MgOptions): MgResult {
  const rng = mulberry32(opt.seed);
  let bank: Fission[] = [];
  for (let i = 0; i < opt.particles; i++) {
    const p = sampleSite(geo, rng);
    bank.push({ p, g: sampleChi(materialAt(p, fuel, geo), rng) });
  }

  const cycleK: number[] = [];
  for (let cyc = 0; cyc < opt.cycles; cyc++) {
    const next: Fission[] = [];
    for (const site of bank) simulate(site.p, site.g, fuel, geo, rng, next);
    cycleK.push(bank.length ? next.length / bank.length : 0);
    if (next.length === 0) {
      bank = [];
      for (let i = 0; i < opt.particles; i++) {
        const p = sampleSite(geo, rng);
        bank.push({ p, g: sampleChi(materialAt(p, fuel, geo), rng) });
      }
    } else {
      const resampled: Fission[] = [];
      for (let i = 0; i < opt.particles; i++) resampled.push(next[Math.floor(rng() * next.length)]);
      bank = resampled;
    }
  }

  const active = cycleK.slice(opt.inactive);
  const n = active.length;
  const mean = active.reduce((s, v) => s + v, 0) / n;
  const variance = n > 1 ? active.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (n - 1) : 0;
  return { k: mean, sigma: Math.sqrt(variance / n), cycleK, histories: opt.particles * opt.cycles };
}

/**
 * Exact infinite-medium k: dominant eigenvalue of (T − S)^(-1) F.
 * Deterministic linear algebra, independent of the Monte Carlo walk.
 */
export function kInfinityMultigroup(mat: MgMaterial): number {
  const G = mat.groups;
  // Removal operator M = T − S_in, where S_in[g][g'] is scatter from g' into g.
  const M: number[][] = [];
  for (let g = 0; g < G; g++) {
    M.push(new Array<number>(G).fill(0));
    M[g][g] += mat.total[g];
    for (let gp = 0; gp < G; gp++) M[g][gp] -= mat.scatter[gp][g];
  }
  // Fission production F[g][g'] = chi_g * nuFission_g'.
  const F: number[][] = [];
  for (let g = 0; g < G; g++) {
    F.push(new Array<number>(G).fill(0));
    for (let gp = 0; gp < G; gp++) F[g][gp] = mat.chi[g] * mat.nuFission[gp];
  }
  // Power iteration on A = M^(-1) F, applied matrix-free via a solve each step.
  let phi = new Array<number>(G).fill(1 / G);
  let k = 1;
  for (let iter = 0; iter < 500; iter++) {
    const source = matVec(F, phi); // F phi
    const next = solve(M, source); // M^-1 (F phi)
    const knext = norm1(next) / norm1(phi);
    const scaled = next.map((v) => v / knext);
    const delta = Math.abs(knext - k);
    phi = scaled;
    k = knext;
    if (delta < 1e-12) break;
  }
  return k;
}

function matVec(A: number[][], x: number[]): number[] {
  return A.map((row) => row.reduce((s, v, j) => s + v * x[j], 0));
}

function norm1(x: number[]): number {
  return x.reduce((s, v) => s + Math.abs(v), 0);
}

/** Dense solve A y = b by Gaussian elimination with partial pivoting. */
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
