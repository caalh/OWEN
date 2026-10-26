/**
 * Monte Carlo volume of one cell. Same estimator as the site copy, pointed
 * at OWEN's geometry engine.
 */

import { findCell, worldBounds } from "../preview/mcnpEvaluate";
import type { McnpGeometryModel } from "../preview/mcnpGeometry";

export interface VolumeEstimate {
  volumeCm3: number;
  sigmaCm3: number;
  overlaps: number;
  samples: number;
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

export function stochasticVolume(model: McnpGeometryModel, cellId: number, samples: number, seed: number): VolumeEstimate {
  const box = worldBounds(model);
  const rng = mulberry32(seed);
  const span = [0, 1, 2].map((axis) => box.max[axis] - box.min[axis]);
  const boxVolume = span[0] * span[1] * span[2];
  let hits = 0;
  let overlaps = 0;
  for (let i = 0; i < samples; i++) {
    const p: [number, number, number] = [
      box.min[0] + rng() * span[0],
      box.min[1] + rng() * span[1],
      box.min[2] + rng() * span[2],
    ];
    const found = findCell(model, p);
    if (found.overlaps.length > 1) {
      overlaps += 1;
      continue;
    }
    if (found.cell && found.cell.id === cellId) hits += 1;
  }
  const fraction = hits / samples;
  const volume = fraction * boxVolume;
  const sigma = boxVolume * Math.sqrt((fraction * (1 - fraction)) / samples);
  return { volumeCm3: volume, sigmaCm3: sigma, overlaps, samples };
}
