/**
 * Run the one-group solver on a parsed MCNP deck.
 *
 * The ray tracer is the exact-geometry engine: findCell says which cell a
 * point is in, and the distance to the cell boundary is the first point along
 * the ray where findCell changes. Macroscopic cross sections are the caller's
 * one-group material. Every non-void cell uses that material; material 0 is
 * void and ends the track. This is how a deck gets a k-eff without a second
 * geometry implementation.
 */

import { parseMcnpGeometry, type McnpGeometryModel } from "../preview/mcnpGeometry";
import { findCell, worldBounds } from "../preview/mcnpEvaluate";
import type { KOptions, KResult, OneGroupMaterial } from "./transport";

type Vec3 = [number, number, number];

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

function isotropic(rng: () => number): Vec3 {
  const mu = 2 * rng() - 1;
  const phi = 2 * Math.PI * rng();
  const s = Math.sqrt(Math.max(0, 1 - mu * mu));
  return [s * Math.cos(phi), s * Math.sin(phi), mu];
}

function at(origin: Vec3, dir: Vec3, dist: number): Vec3 {
  return [origin[0] + dir[0] * dist, origin[1] + dir[1] * dist, origin[2] + dir[2] * dist];
}

function cellIdAt(model: McnpGeometryModel, p: Vec3): number | null {
  const found = findCell(model, p);
  if (found.lost || !found.cell || found.cell.material === 0) return null;
  return found.cell.id;
}

/** Smallest distance at which the ray has left this cell, via the engine. */
function distanceToLeave(model: McnpGeometryModel, origin: Vec3, dir: Vec3, id: number): number {
  const inside = (dist: number) => cellIdAt(model, at(origin, dir, dist)) === id;
  if (!inside(1e-8)) return 0;
  let hi = 0.5;
  while (hi < 1e6 && inside(hi)) hi *= 2;
  if (inside(hi)) return Infinity;
  let lo = 0;
  for (let i = 0; i < 28; i++) {
    const mid = 0.5 * (lo + hi);
    if (inside(mid)) lo = mid;
    else hi = mid;
  }
  return hi;
}

function sampleFuel(model: McnpGeometryModel, rng: () => number): { p: Vec3; id: number } | null {
  const box = worldBounds(model);
  for (let i = 0; i < 2000; i++) {
    const p: Vec3 = [
      box.min[0] + rng() * (box.max[0] - box.min[0]),
      box.min[1] + rng() * (box.max[1] - box.min[1]),
      box.min[2] + rng() * (box.max[2] - box.min[2]),
    ];
    const id = cellIdAt(model, p);
    if (id !== null) return { p, id };
  }
  return null;
}

function simulate(
  model: McnpGeometryModel,
  start: Vec3,
  dir: Vec3,
  mat: OneGroupMaterial,
  rng: () => number,
  out: Vec3[],
): void {
  let p: Vec3 = [start[0], start[1], start[2]];
  let d = dir;
  let id = cellIdAt(model, p);
  if (id === null) return;
  const sigmaT = mat.sigmaS + mat.sigmaA;
  if (!(sigmaT > 0)) return;

  for (let step = 0; step < 100000; step++) {
    const dColl = -Math.log(Math.max(rng(), 1e-300)) / sigmaT;
    const dLeave = distanceToLeave(model, p, d, id);
    if (dLeave < dColl) {
      p = at(p, d, dLeave + 1e-6);
      id = cellIdAt(model, p);
      if (id === null) return;
      continue;
    }
    p = at(p, d, dColl);
    if (rng() < mat.sigmaA / sigmaT) {
      if (mat.sigmaA > 0 && rng() < mat.sigmaF / mat.sigmaA) {
        const born = Math.floor(mat.nu + rng());
        for (let i = 0; i < born; i++) out.push([p[0], p[1], p[2]]);
      }
      return;
    }
    d = isotropic(rng);
  }
}

/** k-eff of an MCNP deck. Geometry from the text, cross sections from `mat`. */
export function kFromMcnpDeck(text: string, mat: OneGroupMaterial, opt: KOptions): KResult {
  const model = parseMcnpGeometry(text);
  const rng = mulberry32(opt.seed);
  let bank: Vec3[] = [];
  for (let i = 0; i < opt.particles; i++) {
    const site = sampleFuel(model, rng);
    if (!site) throw new Error("The deck has no finite non-void cell to start neutrons in.");
    bank.push(site.p);
  }

  const cycleK: number[] = [];
  for (let cycle = 0; cycle < opt.cycles; cycle++) {
    const next: Vec3[] = [];
    for (const site of bank) simulate(model, site, isotropic(rng), mat, rng, next);
    cycleK.push(bank.length ? next.length / bank.length : 0);
    if (next.length === 0) {
      bank = [];
      for (let i = 0; i < opt.particles; i++) {
        const site = sampleFuel(model, rng);
        if (site) bank.push(site.p);
      }
    } else {
      const resampled: Vec3[] = [];
      for (let i = 0; i < opt.particles; i++) resampled.push(next[Math.floor(rng() * next.length)]);
      bank = resampled;
    }
  }

  const active = cycleK.slice(opt.inactive);
  const n = active.length;
  const mean = active.reduce((sum, value) => sum + value, 0) / n;
  const variance = n > 1 ? active.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1) : 0;
  return { k: mean, sigma: Math.sqrt(variance / n), cycleK, histories: opt.particles * opt.cycles };
}
