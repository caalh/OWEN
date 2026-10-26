/**
 * One-group Monte Carlo k-eigenvalue solver.
 *
 * Analog collision physics and a fission-source iteration. Geometries:
 *
 *   - infinite medium
 *   - sphere, vacuum or specular (mirror) boundary
 *   - cube, each face vacuum or specular
 *   - fissile sphere inside a reflector shell
 *
 * A fully reflecting boundary cannot leak, so k equals k∞ = νΣf/Σa for any
 * shape. A non-absorbing reflector with a reflecting outer surface is the
 * same statement: every neutron is absorbed in the fuel. Those identities are
 * what scripts/verify-mc-transport.mjs pins. This is a teaching solver.
 */

export interface OneGroupMaterial {
  /** Macroscopic scattering cross section (cm^-1). */
  sigmaS: number;
  /** Macroscopic absorption cross section = capture + fission (cm^-1). */
  sigmaA: number;
  /** Macroscopic fission cross section (cm^-1), part of sigmaA. */
  sigmaF: number;
  /** Mean neutrons produced per fission. */
  nu: number;
}

export type FaceBoundary = "vacuum" | "reflective";

export interface Geometry {
  kind: "infinite" | "sphere" | "cube" | "coreReflector";
  /** Outer radius (cm). Sphere, or the outside of a reflector shell. */
  radiusCm?: number;
  /** Sphere boundary. Default vacuum. Ignored for an infinite medium. */
  boundary?: FaceBoundary;
  /** Cube half-width (cm), centered at the origin. */
  halfWidthCm?: number;
  /**
   * Cube faces in order +x, -x, +y, -y, +z, -z.
   * Missing entries are vacuum.
   */
  faces?: FaceBoundary[];
  /** Fuel radius (cm) for kind "coreReflector". */
  coreRadiusCm?: number;
  /** Reflector material. Fission in it should be zero. */
  reflector?: OneGroupMaterial;
  /** Outer boundary of a reflector shell. Default vacuum. */
  outerBoundary?: FaceBoundary;
}

export interface KOptions {
  /** Neutrons per cycle (fission-source bank size). */
  particles: number;
  /** Total cycles, inactive + active. */
  cycles: number;
  /** Inactive cycles discarded while the fission source settles. */
  inactive: number;
  /** PRNG seed; fixes the whole run for reproducibility. */
  seed: number;
  /**
   * Implicit capture: the neutron always scatters and its weight is reduced
   * by Σs/Σt, with fission neutrons banked from the weight. Russian roulette
   * below weight 0.25 is unbiased. Default is analog.
   */
  implicitCapture?: boolean;
}

export interface KResult {
  /** Mean k over the active cycles. */
  k: number;
  /** 1-sigma standard error of that mean. */
  sigma: number;
  /** Per-cycle k, including the discarded inactive cycles. */
  cycleK: number[];
  /** Total neutron histories run. */
  histories: number;
}

/** Analytic infinite-medium multiplication factor for a one-group material. */
export function kInfinity(mat: OneGroupMaterial): number {
  return (mat.nu * mat.sigmaF) / mat.sigmaA;
}

/** Deterministic, seedable PRNG (mulberry32). */
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

type Vec3 = [number, number, number];

const NUDGE = 1e-7;
const HIT_EPS = 1e-9;
const MAX_STEPS = 200000;

function isotropicDirection(rng: () => number): Vec3 {
  const mu = 2 * rng() - 1;
  const phi = 2 * Math.PI * rng();
  const s = Math.sqrt(Math.max(0, 1 - mu * mu));
  return [s * Math.cos(phi), s * Math.sin(phi), mu];
}

function sampleInSphere(radius: number, rng: () => number): Vec3 {
  for (;;) {
    const x = (2 * rng() - 1) * radius;
    const y = (2 * rng() - 1) * radius;
    const z = (2 * rng() - 1) * radius;
    if (x * x + y * y + z * z <= radius * radius) return [x, y, z];
  }
}

function samplePoint(geo: Geometry, rng: () => number): Vec3 {
  if (geo.kind === "cube") {
    const h = geo.halfWidthCm ?? 1;
    return [(2 * rng() - 1) * h, (2 * rng() - 1) * h, (2 * rng() - 1) * h];
  }
  if (geo.kind === "sphere") return sampleInSphere(geo.radiusCm ?? 1, rng);
  if (geo.kind === "coreReflector") return sampleInSphere(geo.coreRadiusCm ?? 1, rng);
  return [0, 0, 0];
}

/** Forward distance to leave a sphere the point is inside, or null. */
function sphereExit(p: Vec3, d: Vec3, radius: number): number | null {
  const b = p[0] * d[0] + p[1] * d[1] + p[2] * d[2];
  const c = p[0] * p[0] + p[1] * p[1] + p[2] * p[2] - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const dist = -b + Math.sqrt(disc);
  return dist > HIT_EPS ? dist : null;
}

/** Forward distance to enter a sphere the point is outside, or null. */
function sphereEnter(p: Vec3, d: Vec3, radius: number): number | null {
  const b = p[0] * d[0] + p[1] * d[1] + p[2] * d[2];
  const c = p[0] * p[0] + p[1] * p[1] + p[2] * p[2] - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const dist = -b - Math.sqrt(disc);
  return dist > HIT_EPS ? dist : null;
}

function cubeExit(p: Vec3, d: Vec3, half: number): { dist: number; face: number } | null {
  let best = Infinity;
  let face = -1;
  for (let i = 0; i < 6; i++) {
    const axis = Math.floor(i / 2);
    const sign = i % 2 === 0 ? 1 : -1;
    const vel = d[axis];
    if (Math.abs(vel) < 1e-15) continue;
    const dist = (sign * half - p[axis]) / vel;
    if (dist > HIT_EPS && dist < best) {
      best = dist;
      face = i;
    }
  }
  return face < 0 ? null : { dist: best, face };
}

type Hit =
  | { dist: number; kind: "leak" }
  | { dist: number; kind: "reflect"; shape: "sphere" }
  | { dist: number; kind: "reflect"; shape: "cube"; face: number }
  | { dist: number; kind: "cross" };

function faceOf(geo: Geometry, index: number): FaceBoundary {
  return geo.faces?.[index] ?? "vacuum";
}

function nextHit(p: Vec3, d: Vec3, geo: Geometry): Hit | null {
  if (geo.kind === "infinite") return null;
  if (geo.kind === "sphere") {
    const dist = sphereExit(p, d, geo.radiusCm ?? 0);
    if (dist === null) return null;
    return geo.boundary === "reflective"
      ? { dist, kind: "reflect", shape: "sphere" }
      : { dist, kind: "leak" };
  }
  if (geo.kind === "cube") {
    const hit = cubeExit(p, d, geo.halfWidthCm ?? 0);
    if (!hit) return null;
    return faceOf(geo, hit.face) === "reflective"
      ? { dist: hit.dist, kind: "reflect", shape: "cube", face: hit.face }
      : { dist: hit.dist, kind: "leak" };
  }
  const core = geo.coreRadiusCm ?? 0;
  const outer = geo.radiusCm ?? core;
  if (outer <= core + 1e-9) {
    const dist = sphereExit(p, d, core);
    return dist === null ? null : { dist, kind: "leak" };
  }
  const r2 = p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
  if (r2 <= core * core) {
    const dist = sphereExit(p, d, core);
    return dist === null ? null : { dist, kind: "cross" };
  }
  const intoCore = sphereEnter(p, d, core);
  const out = sphereExit(p, d, outer);
  if (intoCore !== null && (out === null || intoCore < out)) return { dist: intoCore, kind: "cross" };
  if (out === null) return null;
  return geo.outerBoundary === "reflective"
    ? { dist: out, kind: "reflect", shape: "sphere" }
    : { dist: out, kind: "leak" };
}

function materialAt(p: Vec3, fuel: OneGroupMaterial, geo: Geometry): OneGroupMaterial {
  if (geo.kind !== "coreReflector" || !geo.reflector) return fuel;
  const core = geo.coreRadiusCm ?? 0;
  const outer = geo.radiusCm ?? core;
  if (outer <= core + 1e-9) return fuel;
  const r2 = p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
  return r2 <= core * core ? fuel : geo.reflector;
}

function move(p: Vec3, d: Vec3, dist: number): void {
  p[0] += d[0] * dist;
  p[1] += d[1] * dist;
  p[2] += d[2] * dist;
}

function reflectSphere(p: Vec3, d: Vec3): void {
  const r = Math.hypot(p[0], p[1], p[2]) || 1;
  const nx = p[0] / r;
  const ny = p[1] / r;
  const nz = p[2] / r;
  const dot = d[0] * nx + d[1] * ny + d[2] * nz;
  d[0] -= 2 * dot * nx;
  d[1] -= 2 * dot * ny;
  d[2] -= 2 * dot * nz;
  p[0] -= nx * NUDGE;
  p[1] -= ny * NUDGE;
  p[2] -= nz * NUDGE;
}

function reflectCube(p: Vec3, d: Vec3, face: number, half: number): void {
  const axis = Math.floor(face / 2);
  const sign = face % 2 === 0 ? 1 : -1;
  d[axis] = -d[axis];
  p[axis] = sign * half - sign * NUDGE;
}

/**
 * Track one neutron. Fission-neutron birth sites are appended to `out`.
 * Leakage and non-fission absorption add nothing.
 */
function simulate(
  start: Vec3,
  dir: Vec3,
  fuel: OneGroupMaterial,
  geo: Geometry,
  rng: () => number,
  out: Vec3[],
): void {
  const p: Vec3 = [start[0], start[1], start[2]];
  const d: Vec3 = [dir[0], dir[1], dir[2]];
  let mat = materialAt(p, fuel, geo);

  for (let step = 0; step < MAX_STEPS; step++) {
    const sigmaT = mat.sigmaS + mat.sigmaA;
    const dColl = sigmaT > 0 ? -Math.log(Math.max(rng(), 1e-300)) / sigmaT : Infinity;
    const hit = nextHit(p, d, geo);
    if (hit && hit.dist < dColl) {
      move(p, d, hit.dist);
      if (hit.kind === "leak") return;
      if (hit.kind === "reflect") {
        if (hit.shape === "sphere") reflectSphere(p, d);
        else reflectCube(p, d, hit.face, geo.halfWidthCm ?? 0);
        continue;
      }
      move(p, d, NUDGE);
      mat = materialAt(p, fuel, geo);
      continue;
    }
    if (!Number.isFinite(dColl)) return;
    move(p, d, dColl);
    if (rng() < mat.sigmaA / sigmaT) {
      if (mat.sigmaA > 0 && rng() < mat.sigmaF / mat.sigmaA) {
        const born = Math.floor(mat.nu + rng());
        for (let i = 0; i < born; i++) out.push([p[0], p[1], p[2]]);
      }
      return;
    }
    const next = isotropicDirection(rng);
    d[0] = next[0];
    d[1] = next[1];
    d[2] = next[2];
  }
}

/**
 * Implicit-capture twin of `simulate`. Fission bank entries are weight-1
 * neutrons; the expected number at a collision is w · νΣf/Σt. Russian roulette
 * preserves the expected weight.
 */
function simulateImplicit(
  start: Vec3,
  dir: Vec3,
  fuel: OneGroupMaterial,
  geo: Geometry,
  rng: () => number,
  out: Vec3[],
): void {
  const p: Vec3 = [start[0], start[1], start[2]];
  const d: Vec3 = [dir[0], dir[1], dir[2]];
  let mat = materialAt(p, fuel, geo);
  let w = 1;

  for (let step = 0; step < MAX_STEPS; step++) {
    const sigmaT = mat.sigmaS + mat.sigmaA;
    const dColl = sigmaT > 0 ? -Math.log(Math.max(rng(), 1e-300)) / sigmaT : Infinity;
    const hit = nextHit(p, d, geo);
    if (hit && hit.dist < dColl) {
      move(p, d, hit.dist);
      if (hit.kind === "leak") return;
      if (hit.kind === "reflect") {
        if (hit.shape === "sphere") reflectSphere(p, d);
        else reflectCube(p, d, hit.face, geo.halfWidthCm ?? 0);
        continue;
      }
      move(p, d, NUDGE);
      mat = materialAt(p, fuel, geo);
      continue;
    }
    if (!Number.isFinite(dColl)) return;
    move(p, d, dColl);
    const expected = (w * mat.nu * mat.sigmaF) / sigmaT;
    const born = Math.floor(expected + rng());
    for (let i = 0; i < born; i++) out.push([p[0], p[1], p[2]]);
    w *= mat.sigmaS / sigmaT;
    if (w < 0.25) {
      if (rng() < w) w = 1;
      else return;
    }
    const next = isotropicDirection(rng);
    d[0] = next[0];
    d[1] = next[1];
    d[2] = next[2];
  }
}

function resample(sites: Vec3[], n: number, rng: () => number, geo: Geometry): Vec3[] {
  if (sites.length === 0) {
    const fresh: Vec3[] = [];
    for (let i = 0; i < n; i++) fresh.push(samplePoint(geo, rng));
    return fresh;
  }
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) out.push(sites[Math.floor(rng() * sites.length)]);
  return out;
}

/**
 * Fission-source iteration. Each cycle tracks the bank, estimates k as
 * (fission neutrons born) / (source neutrons), then resamples the bank.
 */
export function kEigenvalue(mat: OneGroupMaterial, geo: Geometry, opt: KOptions): KResult {
  const rng = mulberry32(opt.seed);
  let bank: Vec3[] = [];
  for (let i = 0; i < opt.particles; i++) bank.push(samplePoint(geo, rng));

  const cycleK: number[] = [];
  for (let cyc = 0; cyc < opt.cycles; cyc++) {
    const next: Vec3[] = [];
    for (const site of bank) {
      const dir = isotropicDirection(rng);
      if (opt.implicitCapture) simulateImplicit(site, dir, mat, geo, rng, next);
      else simulate(site, dir, mat, geo, rng, next);
    }
    cycleK.push(next.length / bank.length);
    bank = resample(next, opt.particles, rng, geo);
  }

  const active = cycleK.slice(opt.inactive);
  const n = active.length;
  const mean = active.reduce((s, v) => s + v, 0) / n;
  const variance = n > 1 ? active.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (n - 1) : 0;
  const sigma = Math.sqrt(variance / n);

  return { k: mean, sigma, cycleK, histories: opt.particles * opt.cycles };
}
