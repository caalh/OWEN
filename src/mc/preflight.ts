/**
 * Geometry preflight for an MCNP deck: the failures that abort a run or
 * silently drop particles, checked before any solver starts.
 *
 * Text rules for tallies, TMP, and DBRC live in the validator. This file is
 * the part that needs the exact geometry engine: a source point on a surface
 * or in the graveyard, a missing imp:n=0 complement, and sampled overlaps
 * and gaps. Hand-copied to owen/src/mc/preflight.ts with the import path
 * pointed at owen/src/preview.
 */

import { findCell, surfaceValue, worldBounds } from "../preview/mcnpEvaluate";
import { parseMcnpGeometry, type McnpGeometryModel, type Vec3 } from "../preview/mcnpGeometry";
import { stochasticVolume } from "./volume";

export interface PreflightIssue {
  code: "mcnp.no-graveyard" | "mcnp.ksrc-on-surface" | "mcnp.ksrc-outside" | "mcnp.overlap" | "mcnp.gap";
  message: string;
}

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

function liveLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => {
    const trimmed = line.trimStart();
    return trimmed !== "" && !/^c(\s|$)/i.test(trimmed);
  });
}

function ksrcPoints(text: string): Vec3[] {
  const points: Vec3[] = [];
  for (const line of liveLines(text)) {
    const match = line.match(/^\s*ksrc\b(.*)$/i);
    if (!match) continue;
    const nums = match[1].match(/[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g) ?? [];
    for (let i = 0; i + 2 < nums.length; i += 3) {
      points.push([Number(nums[i]), Number(nums[i + 1]), Number(nums[i + 2])]);
    }
  }
  return points;
}

function graveyardIds(text: string): Set<number> {
  const ids = new Set<number>();
  for (const line of liveLines(text)) {
    const match = line.match(/^\s*(\d+)\s+\d+\b.*\bimp:n\s*=\s*0\b/i);
    if (match) ids.add(Number(match[1]));
  }
  return ids;
}

function onSurface(model: McnpGeometryModel, point: Vec3, surfaceIds: number[]): boolean {
  for (const id of surfaceIds) {
    const surface = model.surfaces.get(id);
    if (!surface) continue;
    const value = surfaceValue(surface, 0, point);
    if (Number.isFinite(value) && Math.abs(value) < 1e-2) return true;
  }
  return false;
}

export function preflightModel(text: string, model: McnpGeometryModel, samples = 2000, seed = 5): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const live = liveLines(text).join("\n");
  if (!/\bimp:n\s*=\s*0\b/i.test(live)) {
    issues.push({
      code: "mcnp.no-graveyard",
      message: "No imp:n=0 cell. MCNP needs a complement cell covering everything outside the geometry.",
    });
  }

  const graves = graveyardIds(text);
  for (const point of ksrcPoints(text)) {
    const found = findCell(model, point);
    const ids = found.cell ? found.cell.surfaceOrder : [...model.surfaces.keys()];
    const where = `(${point.map((v) => v.toExponential(3)).join(", ")})`;
    if (onSurface(model, point, ids.length ? ids : [...model.surfaces.keys()])) {
      issues.push({
        code: "mcnp.ksrc-on-surface",
        message: `ksrc ${where} sits on a surface. A source point has to be inside a cell.`,
      });
      continue;
    }
    if (!found.cell || found.lost || graves.has(found.cell.id)) {
      issues.push({
        code: "mcnp.ksrc-outside",
        message: `ksrc ${where} is not inside a transporting cell.`,
      });
    }
  }

  const box = worldBounds(model);
  const span = [0, 1, 2].map((axis) => box.max[axis] - box.min[axis]);
  const boxVolume = span[0] * span[1] * span[2];
  if (samples > 0 && boxVolume > 0 && Number.isFinite(boxVolume)) {
    const rng = mulberry32(seed);
    let overlaps = 0;
    let lost = 0;
    for (let i = 0; i < samples; i++) {
      const point: Vec3 = [
        box.min[0] + rng() * span[0],
        box.min[1] + rng() * span[1],
        box.min[2] + rng() * span[2],
      ];
      const found = findCell(model, point);
      if (found.overlaps.length > 1) overlaps += 1;
      else if (found.lost || !found.cell) lost += 1;
    }
    if (overlaps > 10) {
      issues.push({
        code: "mcnp.overlap",
        message: `${overlaps} of ${samples} sample points are claimed by two cells.`,
      });
    }
    if (graves.size > 0 && lost > 10) {
      issues.push({
        code: "mcnp.gap",
        message: `${lost} of ${samples} sample points are in no cell. The graveyard does not cover them.`,
      });
    }
  }
  return issues;
}

export function preflightMcnp(text: string, samples = 2000, seed = 5): PreflightIssue[] {
  return preflightModel(text, parseMcnpGeometry(text), samples, seed);
}

export function preflightPanel(issues: PreflightIssue[]): string {
  const guidance = "Preflight runs before a solver. Overlap and gap counts are sampled inside the surface box, with a count, not a proof. A clear panel still leaves volume tallies and lattice orientation to the validator.";
  if (!issues.length) return `${guidance}\nNo preflight findings.`;
  return `${guidance}\n${issues.map((issue) => `${issue.code}: ${issue.message}`).join("\n")}`;
}

/** One line per material cell. The ± is the one-sigma sampling error, and the sample count is part of the answer. */
export function volumeReport(model: McnpGeometryModel, samples = 4000, seed = 5): string {
  const lines: string[] = [];
  const cells = [...model.cells.values()].filter((cell) => cell.material !== 0 && cell.region).slice(0, 12);
  for (const cell of cells) {
    const estimate = stochasticVolume(model, cell.id, samples, seed);
    lines.push(`cell ${cell.id}: ${estimate.volumeCm3.toFixed(2)} ± ${estimate.sigmaCm3.toFixed(2)} cm3 (${estimate.samples} samples, ${estimate.overlaps} overlap points)`);
  }
  if (!lines.length) return "No material cell to measure.";
  return lines.join("\n");
}
