/**
 * One-dimensional slab k-eigenvalue with a spatial flux tally.
 *
 * This is the 3D slab reduced by symmetry: the direction cosine μ is uniform
 * on [-1, 1], and the flight length that enters the collision probability is
 * the physical path, not |Δx|. Track-length and collision flux estimators are
 * both scored. A fully reflecting slab cannot leak, so k equals the
 * multigroup infinite-medium eigenvalue. scripts/verify-mc-spatial.mjs pins
 * that, plus the one-group diffusion shape and the absorption balance.
 */

import type { MgMaterial } from "./multigroup";

export interface SlabOptions {
  particles: number;
  cycles: number;
  inactive: number;
  seed: number;
  bins: number;
}

export interface SlabResult {
  k: number;
  sigma: number;
  cycleK: number[];
  histories: number;
  /** Bin centres (cm). */
  centers: number[];
  /** Track-length scalar flux, active cycles only, per source neutron. */
  flux: number[];
  /** Collision-estimator scalar flux, same normalisation. */
  fluxCollision: number[];
  /** Per-group track-length flux [group][bin], active cycles. */
  fluxByGroup: number[][];
  leaks: number;
  captures: number;
  fissions: number;
  productions: number;
  /** Physical path length summed over every cycle (cm), for the balance. */
  trackCm: number;
}

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

function sampleChi(mat: MgMaterial, rng: () => number): number {
  const xi = rng();
  let acc = 0;
  for (let g = 0; g < mat.groups; g++) {
    acc += mat.chi[g];
    if (xi <= acc) return g;
  }
  return mat.groups - 1;
}

function rowSum(mat: MgMaterial, g: number): number {
  let s = 0;
  const row = mat.scatter[g];
  for (let i = 0; i < row.length; i++) s += row[i];
  return s;
}

interface Binning {
  edges: number[];
  width: number;
}

function makeBins(half: number, n: number): Binning {
  const edges: number[] = [];
  const width = (2 * half) / n;
  for (let i = 0; i <= n; i++) edges.push(-half + i * width);
  return { edges, width };
}

function binIndex(edges: number[], x: number): number {
  const n = edges.length - 1;
  if (x <= edges[0]) return 0;
  if (x >= edges[n]) return n - 1;
  const width = edges[1] - edges[0];
  const i = Math.floor((x - edges[0]) / width);
  return Math.min(n - 1, Math.max(0, i));
}

/** Add physical path `s` starting at x going in direction μ. Returns the new x. */
function deposit(x: number, mu: number, s: number, edges: number[], into: number[]): number {
  let pos = x;
  let left = s;
  const n = edges.length - 1;
  for (let guard = 0; guard < n + 4 && left > 1e-12; guard++) {
    const bin = binIndex(edges, pos);
    const edge = mu >= 0 ? edges[bin + 1] : edges[bin];
    const sToEdge = Math.abs(mu) > 1e-14 ? (edge - pos) / mu : Infinity;
    const step = Math.min(left, Math.max(0, sToEdge));
    into[bin] += step;
    pos += mu * step;
    left -= step;
    if (sToEdge <= left + step + 1e-15 && Math.abs(mu) > 1e-14) {
      pos = edge + Math.sign(mu) * 1e-10;
    }
  }
  return pos;
}

interface Counters {
  leaks: number;
  captures: number;
  fissions: number;
  productions: number;
  trackCm: number;
}

function simulate(
  x0: number,
  g0: number,
  mat: MgMaterial,
  half: number,
  reflecting: boolean,
  rng: () => number,
  out: { x: number; g: number }[],
  edges: number[] | null,
  track: number[] | null,
  trackG: number[][] | null,
  coll: number[] | null,
  score: boolean,
  tally: Counters,
): void {
  let x = Math.min(half - 1e-8, Math.max(-half + 1e-8, x0));
  let mu = 2 * rng() - 1;
  if (Math.abs(mu) < 1e-8) mu = mu < 0 ? -1e-8 : 1e-8;
  let g = g0;

  for (let step = 0; step < MAX_STEPS; step++) {
    const sigmaT = mat.total[g];
    if (!(sigmaT > 0)) return;
    const dColl = -Math.log(Math.max(rng(), 1e-300)) / sigmaT;
    const boundary = mu > 0 ? half : -half;
    const dBound = (boundary - x) / mu;
    if (dBound < dColl) {
      if (edges && track && score) {
        deposit(x, mu, dBound, edges, track);
        if (trackG) deposit(x, mu, dBound, edges, trackG[g]);
      }
      tally.trackCm += dBound;
      x += mu * dBound;
      if (!reflecting) {
        tally.leaks += 1;
        return;
      }
      mu = -mu;
      x = Math.min(half - 1e-8, Math.max(-half + 1e-8, x));
      continue;
    }
    if (edges && track && score) {
      deposit(x, mu, dColl, edges, track);
      if (trackG) deposit(x, mu, dColl, edges, trackG[g]);
    }
    tally.trackCm += dColl;
    x += mu * dColl;
    if (edges && coll && score) coll[binIndex(edges, x)] += 1 / sigmaT;

    const sRow = rowSum(mat, g);
    const fis = mat.fission[g];
    const r = rng() * sigmaT;
    if (r < sRow) {
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
      mu = 2 * rng() - 1;
      if (Math.abs(mu) < 1e-8) mu = mu < 0 ? -1e-8 : 1e-8;
      continue;
    }
    if (r < sRow + fis) {
      tally.fissions += 1;
      const nubar = fis > 0 ? mat.nuFission[g] / fis : 0;
      const born = Math.floor(nubar + rng());
      tally.productions += born;
      for (let i = 0; i < born; i++) out.push({ x, g: sampleChi(mat, rng) });
      return;
    }
    tally.captures += 1;
    return;
  }
}

export function kSlab(
  mat: MgMaterial,
  halfWidthCm: number,
  boundary: "vacuum" | "reflective",
  opt: SlabOptions,
): SlabResult {
  const rng = mulberry32(opt.seed);
  const bins = makeBins(halfWidthCm, opt.bins);
  const reflecting = boundary === "reflective";
  const track = new Array<number>(opt.bins).fill(0);
  const coll = new Array<number>(opt.bins).fill(0);
  const trackG = Array.from({ length: mat.groups }, () => new Array<number>(opt.bins).fill(0));
  const tally: Counters = { leaks: 0, captures: 0, fissions: 0, productions: 0, trackCm: 0 };

  let bank: { x: number; g: number }[] = [];
  for (let i = 0; i < opt.particles; i++) {
    const x = (2 * rng() - 1) * halfWidthCm;
    bank.push({ x, g: sampleChi(mat, rng) });
  }

  const cycleK: number[] = [];
  let activeHistories = 0;
  for (let cyc = 0; cyc < opt.cycles; cyc++) {
    const next: { x: number; g: number }[] = [];
    const score = cyc >= opt.inactive;
    if (score) activeHistories += bank.length;
    for (const site of bank) {
      simulate(site.x, site.g, mat, halfWidthCm, reflecting, rng, next, bins.edges, track, trackG, coll, score, tally);
    }
    cycleK.push(bank.length ? next.length / bank.length : 0);
    if (next.length === 0) {
      bank = [];
      for (let i = 0; i < opt.particles; i++) bank.push({ x: (2 * rng() - 1) * halfWidthCm, g: sampleChi(mat, rng) });
    } else {
      const resampled: { x: number; g: number }[] = [];
      for (let i = 0; i < opt.particles; i++) resampled.push(next[Math.floor(rng() * next.length)]);
      bank = resampled;
    }
  }

  const active = cycleK.slice(opt.inactive);
  const n = active.length;
  const mean = active.reduce((s, v) => s + v, 0) / n;
  const variance = n > 1 ? active.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (n - 1) : 0;
  const norm = activeHistories * bins.width;
  const centers = bins.edges.slice(0, -1).map((edge, i) => (edge + bins.edges[i + 1]) / 2);
  return {
    k: mean,
    sigma: Math.sqrt(variance / n),
    cycleK,
    histories: opt.particles * opt.cycles,
    centers,
    flux: track.map((v) => v / norm),
    fluxCollision: coll.map((v) => v / norm),
    fluxByGroup: trackG.map((row) => row.map((v) => v / norm)),
    leaks: tally.leaks,
    captures: tally.captures,
    fissions: tally.fissions,
    productions: tally.productions,
    trackCm: tally.trackCm,
  };
}

/** Wrap a one-group material (absorption includes fission) as a 1-group library. */
export function oneGroupLibrary(sigmaS: number, sigmaA: number, sigmaF: number, nu: number): MgMaterial {
  return {
    groups: 1,
    total: [sigmaS + sigmaA],
    fission: [sigmaF],
    nuFission: [nu * sigmaF],
    chi: [1],
    scatter: [[sigmaS]],
  };
}
