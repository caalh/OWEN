/**
 * Orthographic ray march over the exact geometry engine.
 *
 * Each pixel steps along a view direction until findCell reports a
 * material cell. The picture is a visual aid: the gate is the count of
 * hit pixels against a known silhouette (disk, rectangle). Hand-copied
 * to owen/src/mc/raycast.ts with the import path pointed at owen/src/preview.
 */

import { findCell } from "../preview/mcnpEvaluate";
import type { McnpGeometryModel, Vec3 } from "../preview/mcnpGeometry";

export interface RayView {
  width: number;
  height: number;
  /** Cell id per pixel. 0 is a miss. -2 is an overlap. */
  cells: Int32Array;
  hits: number;
  overlaps: number;
  pixelAreaCm2: number;
}

export interface OrthographicOptions {
  origin: Vec3;
  viewDir: Vec3;
  uDir: Vec3;
  vDir: Vec3;
  halfU: number;
  halfV: number;
  width: number;
  height: number;
  stepCm?: number;
  maxDistanceCm?: number;
}

function add(a: Vec3, b: Vec3, scale: number): Vec3 {
  return [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale];
}

function unit(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

export function renderOrthographic(model: McnpGeometryModel, opt: OrthographicOptions): RayView {
  const width = opt.width;
  const height = opt.height;
  const cells = new Int32Array(width * height);
  const dir = unit(opt.viewDir);
  const step = opt.stepCm ?? 0.3;
  const maxDistance = opt.maxDistanceCm ?? 80;
  let hits = 0;
  let overlaps = 0;
  for (let py = 0; py < height; py++) {
    const v = opt.halfV - ((py + 0.5) / height) * (2 * opt.halfV);
    for (let px = 0; px < width; px++) {
      const u = -opt.halfU + ((px + 0.5) / width) * (2 * opt.halfU);
      const start = add(add(opt.origin, opt.uDir, u), opt.vDir, v);
      let id = 0;
      for (let distance = 0; distance <= maxDistance; distance += step) {
        const point = add(start, dir, distance);
        const found = findCell(model, point);
        if (found.overlaps.length > 1) {
          id = -2;
          break;
        }
        if (found.cell && found.cell.material !== 0) {
          id = found.cell.id;
          break;
        }
      }
      cells[py * width + px] = id;
      if (id === -2) overlaps += 1;
      else if (id > 0) hits += 1;
    }
  }
  const pixelAreaCm2 = ((2 * opt.halfU) / width) * ((2 * opt.halfV) / height);
  return { width, height, cells, hits, overlaps, pixelAreaCm2 };
}

export function hitArea(view: RayView, cellId: number): number {
  let count = 0;
  for (const id of view.cells) if (id === cellId) count += 1;
  return count * view.pixelAreaCm2;
}

/** HTML grid. A visual aid, not a measurement. */
export function rayGrid(view: RayView): string {
  const rows: string[] = [];
  rows.push("This picture is a ray march through the exact geometry. The area check is the gate; the colors are a visual aid.");
  for (let py = 0; py < view.height; py++) {
    let row = "";
    for (let px = 0; px < view.width; px++) {
      const id = view.cells[py * view.width + px];
      const color = id === -2 ? "#f38ba8" : id > 0 ? `hsl(${(id * 47) % 360} 45% 45%)` : "#1e1e2e";
      row += `<i data-cell="${id}" style="background:${color}"></i>`;
    }
    rows.push(`<div class="row">${row}</div>`);
  }
  return rows.join("");
}
