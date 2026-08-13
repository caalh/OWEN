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
    /** Window center within the plane (cm along uDir/vDir); 0 = plane origin. */
    centerU?: number;
    centerV?: number;
    /** Pixel resolution. */
    width: number;
    height: number;
    colorBy: 'cell' | 'material';
    /**
     * Subpixel grid per axis (1 = one sample at the pixel center). Values > 1
     * classify s² points per pixel and keep the majority, which is what makes
     * a whole-core view legible: at core scale one pixel spans more than a pin
     * pitch, and single-point sampling turns a regular lattice into speckle.
     */
    samples?: number;
    /** Legend label for a cell id / material number (host knows real names). */
    labelFor?: (key: number) => string;
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
    /** Subpixel grid per axis actually used (see SliceRequest.samples). */
    samples: number;
    /** Plane-space cm covered by one pixel, [u, v] — the aliasing budget. */
    cmPerPixel: [number, number];
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

/**
 * A sensible default window: the model's bounds projected onto the plane, and
 * centered on them — a deck built away from the origin (a shielding problem at
 * x = 300 cm) must still be framed, not pushed off the edge of the image.
 */
export function defaultWindow(
    model: McnpGeometryModel,
    plane: SlicePlane,
): { halfU: number; halfV: number; centerU: number; centerV: number } {
    const b = worldBounds(model);
    const half: Vec3 = [(b.max[0] - b.min[0]) / 2, (b.max[1] - b.min[1]) / 2, (b.max[2] - b.min[2]) / 2];
    const mid: Vec3 = [(b.max[0] + b.min[0]) / 2, (b.max[1] + b.min[1]) / 2, (b.max[2] + b.min[2]) / 2];
    const project = (dir: Vec3) =>
        Math.abs(dir[0]) * half[0] + Math.abs(dir[1]) * half[1] + Math.abs(dir[2]) * half[2];
    // Center in plane coordinates: the model mid-point measured from the
    // plane origin along each in-plane direction.
    const along = (dir: Vec3) =>
        dir[0] * (mid[0] - plane.origin[0]) + dir[1] * (mid[1] - plane.origin[1]) + dir[2] * (mid[2] - plane.origin[2]);
    return {
        halfU: Math.max(1e-3, project(plane.uDir) * 1.02),
        halfV: Math.max(1e-3, project(plane.vDir) * 1.02),
        centerU: along(plane.uDir),
        centerV: along(plane.vDir),
    };
}

/** World point for a plane-space (u, v) offset from the window center. */
function planePoint(plane: SlicePlane, u: number, v: number): Vec3 {
    return [
        plane.origin[0] + plane.uDir[0] * u + plane.vDir[0] * v,
        plane.origin[1] + plane.uDir[1] * u + plane.vDir[1] * v,
        plane.origin[2] + plane.uDir[2] * u + plane.vDir[2] * v,
    ];
}

/**
 * World point under a (possibly fractional) pixel coordinate. Shared by the
 * rasterizer and click-to-identify so the two can never disagree about which
 * point a pixel means.
 */
export function slicePixelToWorld(req: SliceRequest, px: number, py: number): Vec3 {
    const cu = req.centerU ?? 0;
    const cv = req.centerV ?? 0;
    const u = cu - req.halfU + (px / req.width) * (2 * req.halfU);
    // v runs top→bottom so the image reads like a plot (v up = row 0 top).
    const v = cv + req.halfV - (py / req.height) * (2 * req.halfV);
    return planePoint(req.plane, u, v);
}

/**
 * A slice render in progress. Classification is O(width × height × samples²)
 * point-membership tests — seconds of work on a full core — so it is exposed
 * as a resumable job: the VS Code extension host has no worker to hide in and
 * must hand control back to the editor between bands of rows.
 *
 * `result` is live: `ids` fills in from row 0 downward, and the legend counts
 * grow as rows complete. Rows at or past `rowsDone` are not yet classified.
 */
export interface SliceJob {
    readonly result: SliceResult;
    /** Rows classified so far (rows [0, rowsDone) are final). */
    readonly rowsDone: number;
    readonly done: boolean;
    /** Classify up to `maxRows` more rows; returns how many were done. */
    step(maxRows: number): number;
}

/** Start a resumable classification of one slice. */
export function beginSlice(model: McnpGeometryModel, req: SliceRequest): SliceJob {
    const { width, height, halfU, halfV, colorBy } = req;
    const cu = req.centerU ?? 0;
    const cv = req.centerV ?? 0;
    const samples = Math.max(1, Math.min(4, Math.floor(req.samples ?? 1)));
    const ids = new Int32Array(width * height);
    const legend: SliceLegendEntry[] = [];
    const legendIndex = new Map<number, number>();

    const result: SliceResult = {
        width,
        height,
        ids,
        legend,
        lostCount: 0,
        overlapCount: 0,
        window: [cu - halfU, cu + halfU, cv - halfV, cv + halfV],
        samples,
        cmPerPixel: [(2 * halfU) / width, (2 * halfV) / height],
    };

    const labelOf = (key: number): string => {
        if (req.labelFor) return req.labelFor(key);
        return colorBy === 'cell' ? `cell ${key}` : key === 0 ? 'void' : `m${key}`;
    };
    const indexOf = (key: number): number => {
        let li = legendIndex.get(key);
        if (li === undefined) {
            li = legend.length;
            legendIndex.set(key, li);
            legend.push({ key, label: labelOf(key), count: 0 });
        }
        return li;
    };

    // Subpixel offsets in [0,1): centers of an s×s grid inside the pixel.
    const offsets: number[] = [];
    for (let i = 0; i < samples; i++) offsets.push((i + 0.5) / samples);

    // Vote tallies reused across pixels (cleared per pixel) to avoid churning
    // a Map per pixel at 1024².
    const votes = new Map<number, number>();
    let row = 0;

    const classifyRow = (py: number): void => {
        for (let px = 0; px < width; px++) {
            const idx = py * width + px;
            votes.clear();
            let anyOverlap = false;
            let lostVotes = 0;

            for (const dy of offsets) {
                const v = cv + halfV - ((py + dy) / height) * (2 * halfV);
                for (const dx of offsets) {
                    const u = cu - halfU + ((px + dx) / width) * (2 * halfU);
                    const found = findCell(model, planePoint(req.plane, u, v));
                    if (found.overlaps.length > 1) {
                        // An overlap is a modeling error, not a shading detail:
                        // one offending subsample paints the whole pixel so a
                        // thin double-claimed sliver cannot be averaged away.
                        anyOverlap = true;
                    } else if (!found.cell) {
                        lostVotes++;
                    } else {
                        const key = colorBy === 'cell' ? found.cell.id : found.cell.material;
                        votes.set(key, (votes.get(key) ?? 0) + 1);
                    }
                }
            }

            if (anyOverlap) {
                ids[idx] = SLICE_OVERLAP;
                result.overlapCount++;
                continue;
            }
            let bestKey: number | null = null;
            let bestCount = 0;
            for (const [key, n] of votes) {
                if (n > bestCount) { bestKey = key; bestCount = n; }
            }
            if (bestKey === null || lostVotes > bestCount) {
                ids[idx] = SLICE_LOST;
                result.lostCount++;
                continue;
            }
            const li = indexOf(bestKey);
            legend[li].count++;
            ids[idx] = li;
        }
    };

    return {
        result,
        get rowsDone() { return row; },
        get done() { return row >= height; },
        step(maxRows: number): number {
            const target = Math.min(height, row + Math.max(1, Math.floor(maxRows)));
            const from = row;
            while (row < target) {
                classifyRow(row);
                row++;
            }
            return row - from;
        },
    };
}

/**
 * Classify a whole slice at once. Convenience wrapper over {@link beginSlice}
 * for tests, verify scripts and any caller that can afford to block.
 */
export function sliceModel(model: McnpGeometryModel, req: SliceRequest): SliceResult {
    const job = beginSlice(model, req);
    while (!job.done) job.step(job.result.height);
    return job.result;
}

/** Identify the cell/material under one pixel (click-to-identify). */
export function identifyAt(
    model: McnpGeometryModel,
    req: SliceRequest,
    px: number,
    py: number,
): {
    cell: number | null; material: number | null; density: number | null;
    path: number[]; overlaps: number[]; point: Vec3;
} {
    const p = slicePixelToWorld(req, px + 0.5, py + 0.5);
    const found = findCell(model, p);
    return {
        cell: found.cell?.id ?? null,
        material: found.cell?.material ?? null,
        density: found.cell?.density ?? null,
        path: found.path,
        overlaps: found.overlaps,
        point: p,
    };
}

/** Magenta, per the OpenMC overlap-plot convention. */
const PROBLEM_COLOR: [number, number, number] = [255, 0, 255];

export interface SliceRasterOptions {
    /** Legend index → [r, g, b]; missing entries use the hash palette. */
    colors?: [number, number, number][];
    /**
     * Outline region boundaries. MCNP's own plotter draws surface *curves*, so
     * it stays crisp at any zoom; a classified raster has no lines at all
     * until we add them. Darkening the pixel where the classification changes
     * recovers that read at a fraction of the cost of tracing surfaces.
     */
    edges?: boolean;
    /** Blend toward this color on a boundary pixel (default near-black). */
    edgeColor?: [number, number, number];
    /** 0 = no darkening, 1 = solid edgeColor (default 0.55). */
    edgeStrength?: number;
}

/**
 * Rasterize a classified slice into RGBA for a canvas. `colors` maps legend
 * index → [r, g, b]; missing entries fall back to a stable hash palette.
 */
export function sliceToRgba(
    result: SliceResult,
    optsOrColors?: SliceRasterOptions | [number, number, number][],
): Uint8ClampedArray {
    return sliceRowsToRgba(result, 0, result.height, optsOrColors);
}

/**
 * Rasterize rows [y0, y1) of a classified slice. Used to blit progressive
 * bands of a {@link SliceJob} while the rest is still being classified.
 * Outlining a band looks at the row above it, which is already final because
 * classification runs top-down.
 */
export function sliceRowsToRgba(
    result: SliceResult,
    y0: number,
    y1: number,
    optsOrColors?: SliceRasterOptions | [number, number, number][],
): Uint8ClampedArray {
    const opts: SliceRasterOptions = Array.isArray(optsOrColors)
        ? { colors: optsOrColors }
        : optsOrColors ?? {};
    const { width, ids } = result;
    const from = Math.max(0, Math.min(result.height, Math.floor(y0)));
    const to = Math.max(from, Math.min(result.height, Math.floor(y1)));
    const out = new Uint8ClampedArray(width * (to - from) * 4);
    const palette: [number, number, number][] = [];
    for (let i = 0; i < result.legend.length; i++) {
        palette.push(opts.colors?.[i] ?? hashColor(result.legend[i].key));
    }
    const edgeColor = opts.edgeColor ?? [10, 14, 22];
    const k = Math.max(0, Math.min(1, opts.edgeStrength ?? 0.55));

    for (let py = from; py < to; py++) {
        for (let px = 0; px < width; px++) {
            const i = py * width + px;
            const id = ids[i];
            const rgb = id >= 0 ? palette[id] ?? PROBLEM_COLOR : PROBLEM_COLOR;
            let r = rgb[0], g = rgb[1], b = rgb[2];
            if (opts.edges) {
                // A pixel is on a boundary when the region to its left or above
                // differs. Comparing one side only keeps the outline one pixel
                // wide instead of doubling it on both sides of every interface.
                const left = px > 0 ? ids[i - 1] : id;
                const up = py > 0 ? ids[i - width] : id;
                if (left !== id || up !== id) {
                    r = r + (edgeColor[0] - r) * k;
                    g = g + (edgeColor[1] - g) * k;
                    b = b + (edgeColor[2] - b) * k;
                }
            }
            const o = (py - from) * width + px;
            out[o * 4] = r;
            out[o * 4 + 1] = g;
            out[o * 4 + 2] = b;
            out[o * 4 + 3] = 255;
        }
    }
    return out;
}

/** Parse a `#rrggbb` (or `#rgb`) color to RGB; null when unparseable. */
export function hexToRgb(hex: string): [number, number, number] | null {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
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
