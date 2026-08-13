// Exact 2D slice plotter (geometry-preview plan, Stage 3).
//
// For a user-chosen plane this classifies every pixel center by evaluating
// the parsed CSG directly (findCell on the Stage-1 model) — no meshing, no
// approximation. This is what the MCNP plotter, Gxsview, and OpenMC's plotter
// treat as ground truth, and it doubles as the permanent regression net for
// the 3D paths: anything the 3D view draws can be cross-checked against the
// slice for the same plane.
//
// Conventions users already know from OpenMC overlap plots: pixels contained
// by no cell or by more than one top-level cell render magenta and are
// counted in the result.
//
// Pure and DOM-free: runs on the extension host, in a web worker on the
// site, or under node for the verify scripts. Output arrays are transferable.

import { McnpGeometryModel, Vec3 } from './mcnpGeometry';
import { findCell, worldBounds } from './mcnpEvaluate';

export type SliceAxis = 'xy' | 'xz' | 'yz';

export interface SlicePlane {
    /** World-space point on the plane (pixel grid center). */
    origin: Vec3;
    /** In-plane orthonormal basis; pixels step along these. */
    uDir: Vec3;
    vDir: Vec3;
}

export interface SliceRequest {
    plane: SlicePlane;
    /** Half-extent of the imaged window along uDir/vDir (cm). */
    halfU: number;
    halfV: number;
    /** Pixel resolution. */
    width: number;
    height: number;
    colorBy: 'cell' | 'material';
}

export interface SliceLegendEntry {
    /** Legend key: cell id or material id depending on colorBy. */
    key: number;
    label: string;
    /** Pixels claimed by this entry. */
    count: number;
}

/** Pixel codes < 0 are diagnostics; ≥ 0 index into `legend`. */
export const SLICE_LOST = -1;
export const SLICE_OVERLAP = -2;

export interface SliceResult {
    width: number;
    height: number;
    /** Per-pixel legend index (row-major, v increasing downward) or a
     *  negative diagnostic code (SLICE_LOST / SLICE_OVERLAP). */
    ids: Int32Array;
    legend: SliceLegendEntry[];
    lostCount: number;
    overlapCount: number;
    /** World-space rect for axis labels: [uMin, uMax, vMin, vMax]. */
    window: [number, number, number, number];
}

/** Convenience: axis-aligned plane at `offset` along the remaining axis. */
export function axisPlane(axis: SliceAxis, offset: number): SlicePlane {
    switch (axis) {
        case 'xy':
            return { origin: [0, 0, offset], uDir: [1, 0, 0], vDir: [0, 1, 0] };
        case 'xz':
            return { origin: [0, offset, 0], uDir: [1, 0, 0], vDir: [0, 0, 1] };
        case 'yz':
            return { origin: [offset, 0, 0], uDir: [0, 1, 0], vDir: [0, 0, 1] };
    }
}

/** A sensible default window: the model's bounds projected onto the plane. */
export function defaultWindow(model: McnpGeometryModel, plane: SlicePlane): { halfU: number; halfV: number } {
    const b = worldBounds(model);
    const half: Vec3 = [(b.max[0] - b.min[0]) / 2, (b.max[1] - b.min[1]) / 2, (b.max[2] - b.min[2]) / 2];
    const project = (dir: Vec3) =>
        Math.abs(dir[0]) * half[0] + Math.abs(dir[1]) * half[1] + Math.abs(dir[2]) * half[2];
    return {
        halfU: Math.max(1e-3, project(plane.uDir) * 1.02),
        halfV: Math.max(1e-3, project(plane.vDir) * 1.02),
    };
}

/**
 * Classify the slice. O(width × height) findCell evaluations — run on a
 * worker for interactive resolutions (1024² on a BEAVRS-size deck is real
 * work). The evaluator itself reuses the lattice index math, so cost per
 * pixel is hierarchy depth, not pin count.
 */
export function sliceModel(model: McnpGeometryModel, req: SliceRequest): SliceResult {
    const { plane, width, height, halfU, halfV, colorBy } = req;
    const ids = new Int32Array(width * height);
    const legend: SliceLegendEntry[] = [];
    const legendIndex = new Map<number, number>();
    let lostCount = 0;
    let overlapCount = 0;

    for (let py = 0; py < height; py++) {
        // v runs top→bottom so the image reads like a plot (v up = row 0 top).
        const v = halfV - ((py + 0.5) / height) * (2 * halfV);
        for (let px = 0; px < width; px++) {
            const u = -halfU + ((px + 0.5) / width) * (2 * halfU);
            const p: Vec3 = [
                plane.origin[0] + plane.uDir[0] * u + plane.vDir[0] * v,
                plane.origin[1] + plane.uDir[1] * u + plane.vDir[1] * v,
                plane.origin[2] + plane.uDir[2] * u + plane.vDir[2] * v,
            ];
            const found = findCell(model, p);
            const idx = py * width + px;
            if (found.overlaps.length > 1) {
                ids[idx] = SLICE_OVERLAP;
                overlapCount++;
                continue;
            }
            if (!found.cell) {
                ids[idx] = SLICE_LOST;
                lostCount++;
                continue;
            }
            const key = colorBy === 'cell' ? found.cell.id : found.cell.material;
            let li = legendIndex.get(key);
            if (li === undefined) {
                li = legend.length;
                legendIndex.set(key, li);
                legend.push({
                    key,
                    label: colorBy === 'cell'
                        ? `cell ${key}`
                        : key === 0 ? 'void' : `m${key}`,
                    count: 0,
                });
            }
            legend[li].count++;
            ids[idx] = li;
        }
    }

    return {
        width,
        height,
        ids,
        legend,
        lostCount,
        overlapCount,
        window: [-halfU, halfU, -halfV, halfV],
    };
}

/** Identify the cell/material under one pixel (click-to-identify). */
export function identifyAt(
    model: McnpGeometryModel,
    req: SliceRequest,
    px: number,
    py: number,
): { cell: number | null; material: number | null; density: number | null; path: number[]; overlaps: number[] } {
    const u = -req.halfU + ((px + 0.5) / req.width) * (2 * req.halfU);
    const v = req.halfV - ((py + 0.5) / req.height) * (2 * req.halfV);
    const p: Vec3 = [
        req.plane.origin[0] + req.plane.uDir[0] * u + req.plane.vDir[0] * v,
        req.plane.origin[1] + req.plane.uDir[1] * u + req.plane.vDir[1] * v,
        req.plane.origin[2] + req.plane.uDir[2] * u + req.plane.vDir[2] * v,
    ];
    const found = findCell(model, p);
    return {
        cell: found.cell?.id ?? null,
        material: found.cell?.material ?? null,
        density: found.cell?.density ?? null,
        path: found.path,
        overlaps: found.overlaps,
    };
}

/** Magenta, per the OpenMC overlap-plot convention. */
const PROBLEM_COLOR: [number, number, number] = [255, 0, 255];

/**
 * Rasterize a classified slice into RGBA for a canvas. `colors` maps legend
 * index → [r, g, b]; missing entries fall back to a stable hash palette.
 */
export function sliceToRgba(result: SliceResult, colors?: [number, number, number][]): Uint8ClampedArray {
    const out = new Uint8ClampedArray(result.width * result.height * 4);
    const palette: [number, number, number][] = [];
    for (let i = 0; i < result.legend.length; i++) {
        palette.push(colors?.[i] ?? hashColor(result.legend[i].key));
    }
    for (let i = 0; i < result.ids.length; i++) {
        const id = result.ids[i];
        const rgb = id >= 0 ? palette[id] ?? PROBLEM_COLOR : PROBLEM_COLOR;
        out[i * 4] = rgb[0];
        out[i * 4 + 1] = rgb[1];
        out[i * 4 + 2] = rgb[2];
        out[i * 4 + 3] = 255;
    }
    return out;
}

/** Deterministic, well-spread color for a numeric key (golden-angle hue). */
export function hashColor(key: number): [number, number, number] {
    const hue = ((key * 137.508) % 360 + 360) % 360;
    const sat = 0.62;
    const val = key === 0 ? 0.35 : 0.9; // void reads dark
    return hsvToRgb(hue, sat, val);
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let rgb: [number, number, number];
    if (h < 60) rgb = [c, x, 0];
    else if (h < 120) rgb = [x, c, 0];
    else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c];
    else if (h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return [
        Math.round((rgb[0] + m) * 255),
        Math.round((rgb[1] + m) * 255),
        Math.round((rgb[2] + m) * 255),
    ];
}
