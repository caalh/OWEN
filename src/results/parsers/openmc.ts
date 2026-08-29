// OpenMC results readers.
//
// Three files can carry results, and OWEN reads all three:
//   statepoint.<n>.h5  binary, authoritative (k-eff history, every tally bin)
//   tallies.out        text summary OpenMC writes when settings.output includes
//                      tallies — mean +/- std_dev per bin
//   stdout / log       batch table and the final k-eff estimators
//
// The HDF5 layout below was read off a statepoint produced by OpenMC 0.15.3
// (see scripts/verify-results.mjs, which re-checks the numbers against values
// printed by OpenMC's own Python API):
//   /k_generation        (n_batches,)   raw k per generation, inactive included
//   /k_combined          (2,)           final mean and std dev
//   /n_realizations                      active batches that scored
//   /tallies/tally N/results  (filter_bins, nuclide*score, 2) = sum, sum_sq
//   /tallies/tally N/{name,score_bins,nuclides,filters,estimator}
//   /tallies/filters/filter M/{type,n_bins,bins}
//   /tallies/meshes/mesh M/{dimension,lower_left,upper_right}
// mean = sum / n; std = sqrt((sum_sq/n - mean^2)/(n-1)); the last filter in the
// list varies fastest, and the score index is nuclide-major.
import * as fs from 'fs';
import type { RunResults, KeffHistory, FluxSpectrum, MeshTally, TallyEntry, TallyBin } from '../types';
import { parseKeff } from '../../workflows/sweepCore';
import { NUM, pushIfFinite } from './numeric';

/** Parse OpenMC stdout / owen-sweep.log: batch table plus final estimators. */
export function parseOpenmcStdout(text: string, sourceFile?: string): RunResults {
    const lines = text.split(/\r?\n/);
    const cycles: number[] = [];
    const mean: number[] = [];
    const std: number[] = [];
    const metadata: Record<string, string | number> = {};
    const warnings: string[] = [];

    // Real batch table rows:
    //        1/1    1.53235
    //       12/1    1.34145    1.35645 +/- 0.01500
    const batchRe = new RegExp(String.raw`^\s*(\d+)\/(\d+)\s+(${NUM})(?:\s+(${NUM})\s*\+\/-\s*(${NUM}))?\s*$`);
    const finalRe = new RegExp(String.raw`k-effective\s*\(([^)]+)\)\s*=\s*(${NUM})\s*\+\/-\s*(${NUM})`, 'i');
    const combinedRe = new RegExp(String.raw`Combined\s+k-?effective\s*=\s*(${NUM})\s*\+\/-\s*(${NUM})`, 'i');
    const leakRe = new RegExp(String.raw`Leakage Fraction\s*=\s*(${NUM})\s*\+\/-\s*(${NUM})`, 'i');

    let combined: { mean: number; std: number } | undefined;
    let inactive: number | undefined;

    for (const line of lines) {
        const batch = batchRe.exec(line);
        if (batch) {
            const gen = parseInt(batch[1], 10);
            const k = parseFloat(batch[3]);
            const avg = batch[4] != null ? parseFloat(batch[4]) : undefined;
            const sd = batch[5] != null ? parseFloat(batch[5]) : 0;
            // OpenMC starts printing the running average once two active
            // batches exist, so the first averaged row is inactive + 2.
            if (avg != null && inactive == null) inactive = Math.max(gen - 2, 0);
            pushIfFinite(cycles, mean, std, gen, k, avg != null ? sd : 0);
            continue;
        }
        const comb = combinedRe.exec(line);
        if (comb) {
            combined = { mean: parseFloat(comb[1]), std: parseFloat(comb[2]) };
            metadata['k-effective (combined)'] = `${comb[1]} +/- ${comb[2]}`;
            continue;
        }
        const est = finalRe.exec(line);
        if (est) {
            metadata[`k-effective (${est[1].toLowerCase()})`] = `${est[2]} +/- ${est[3]}`;
            continue;
        }
        const leak = leakRe.exec(line);
        if (leak) {
            metadata.leakageFraction = `${leak[1]} +/- ${leak[2]}`;
            continue;
        }
        const version = /^\s*Version\s*\|\s*(\S+)/.exec(line);
        if (version) metadata.code = `OpenMC ${version[1]}`;
        const total = new RegExp(String.raw`Total time elapsed\s*=\s*(${NUM})\s*seconds`, 'i').exec(line);
        if (total) metadata.elapsedSeconds = parseFloat(total[1]);
        const particles = /^\s*Particles per generation\s*=\s*(\d+)/i.exec(line);
        if (particles) metadata.particlesPerGeneration = parseInt(particles[1], 10);
        if (/^\s*(WARNING|ERROR|Fatal)/i.test(line) && warnings.length < 40) warnings.push(line.trim());
    }

    if (mean.length === 0) {
        const k = parseKeff(text);
        if (k != null && Number.isFinite(k)) {
            cycles.push(1);
            mean.push(k);
            std.push(0);
        }
    }

    const keff: KeffHistory | undefined =
        mean.length > 0 || combined
            ? {
                  cycles: mean.length ? cycles : [1],
                  mean: mean.length ? mean : [combined!.mean],
                  std: std.length ? std : [combined!.std],
                  final: combined ?? { mean: mean[mean.length - 1], std: std[std.length - 1] },
                  inactive,
              }
            : undefined;

    return {
        code: 'openmc',
        sourceFile,
        keff,
        spectra: [],
        tallies: [],
        meshTallies: [],
        metadata,
        warnings: warnings.length ? warnings : undefined,
    };
}

/**
 * Parse OpenMC's `tallies.out` text summary. Real layout:
 *
 *   ============================>     TALLY 1: FUEL FLUX     <===============
 *
 *    Cell 1
 *      Total Material
 *        Flux                                 11.3189 +/- 0.00682032
 */
export function parseOpenmcTalliesOut(text: string, sourceFile?: string): RunResults {
    const lines = text.split(/\r?\n/);
    const tallies: TallyEntry[] = [];
    const notes: string[] = [];
    const headRe = /^\s*=+>\s*TALLY\s+(\d+)\s*:\s*(.*?)\s*<=+\s*$/i;
    const scoreRe = new RegExp(String.raw`^(\s+)(\S.*?)\s{2,}(${NUM})\s*\+\/-\s*(${NUM})\s*$`);

    let cur: { id: string; name: string; bins: TallyBin[] } | undefined;
    let context: Array<{ indent: number; text: string }> = [];

    const flush = () => {
        if (!cur) return;
        const label = cur.name ? `Tally ${cur.id} — ${cur.name}` : `Tally ${cur.id}`;
        // A tallies.out value is a mean with an absolute std dev, so convert to
        // the relative error the rest of OWEN uses.
        const first = cur.bins[0];
        tallies.push({
            id: cur.id,
            label,
            value: first?.value ?? 0,
            error: first?.error,
            bins: cur.bins.length ? cur.bins : undefined,
            checks: 'unknown',
        });
        cur = undefined;
    };

    for (const raw of lines) {
        const line = raw.replace(/\r$/, '');
        const head = headRe.exec(line);
        if (head) {
            flush();
            cur = { id: head[1], name: head[2].trim(), bins: [] };
            context = [];
            continue;
        }
        if (!cur) continue;
        if (line.trim() === '') continue;

        const score = scoreRe.exec(line);
        if (score) {
            const mean = parseFloat(score[3]);
            const sd = parseFloat(score[4]);
            const label = [...context.map((c) => c.text), score[2].trim()].filter(Boolean).join(' · ');
            cur.bins.push({
                label,
                value: mean,
                // tallies.out prints an absolute std dev; OWEN carries relative error.
                error: mean !== 0 && Number.isFinite(sd) ? Math.abs(sd / mean) : undefined,
            });
            continue;
        }
        // Context lines nest by indentation: "Cell 1" > "Li6" > score rows.
        const indent = line.match(/^\s*/)?.[0].length ?? 0;
        context = context.filter((c) => c.indent < indent);
        context.push({ indent, text: line.trim() });
    }
    flush();

    if (tallies.length === 0) notes.push('No tally blocks found in this tallies.out file.');

    return {
        code: 'openmc',
        sourceFile,
        spectra: [],
        tallies,
        meshTallies: [],
        notes: notes.length ? notes : undefined,
    };
}

export function looksLikeOpenmcTalliesOut(text: string): boolean {
    return /=+>\s*TALLY\s+\d+\s*:/i.test(text.slice(0, 8000));
}

export function looksLikeOpenmcStdout(text: string): boolean {
    const head = text.slice(0, 8000);
    return /The OpenMC Monte Carlo Code/i.test(head) || /K EIGENVALUE SIMULATION|FIXED SOURCE TRANSPORT/i.test(head);
}

interface H5Like {
    get(path: string): { value?: unknown; shape?: number[]; keys?: () => string[]; attrs?: Record<string, unknown> } | null;
    keys(): string[];
    close(): void;
    attrs?: Record<string, unknown>;
}

function asNumbers(v: unknown): number[] {
    if (v == null) return [];
    if (typeof v === 'number') return [v];
    if (Array.isArray(v)) return v.map((x) => Number(x)).filter((x) => Number.isFinite(x));
    if (v instanceof Float64Array || v instanceof Float32Array || v instanceof Int32Array) return Array.from(v);
    if (typeof (v as { length?: number }).length === 'number') return Array.from(v as ArrayLike<number>).map(Number);
    return [];
}

function asStrings(v: unknown): string[] {
    if (v == null) return [];
    if (typeof v === 'string') return [v];
    if (Array.isArray(v)) return v.map((x) => String(x));
    return [String(v)];
}

function meanAndRelErr(sum: number, sumSq: number, n: number): { mean: number; error?: number } {
    if (!(n > 1)) return { mean: sum / Math.max(n, 1) };
    const m = sum / n;
    const variance = (sumSq / n - m * m) / (n - 1);
    const std = Math.sqrt(Math.max(variance, 0));
    return { mean: m, error: m !== 0 ? Math.abs(std / m) : undefined };
}

interface FilterInfo {
    id: number;
    type: string;
    nBins: number;
    bins: number[];
}

function filterBinLabel(f: FilterInfo, index: number, meshDims?: number[]): string {
    switch (f.type) {
        case 'energy':
        case 'energyout': {
            const lo = f.bins[index];
            const hi = f.bins[index + 1];
            if (lo != null && hi != null) return `E ${lo.toExponential(3)}–${hi.toExponential(3)} eV`;
            return `energy bin ${index + 1}`;
        }
        case 'cell':
        case 'cellborn':
        case 'material':
        case 'universe':
        case 'surface': {
            const id = f.bins[index];
            return id != null ? `${f.type} ${id}` : `${f.type} bin ${index + 1}`;
        }
        case 'mesh': {
            if (meshDims && meshDims.length === 3) {
                const [nx, ny] = meshDims;
                const i = index % nx;
                const j = Math.floor(index / nx) % ny;
                const k = Math.floor(index / (nx * ny));
                return `mesh (${i + 1},${j + 1},${k + 1})`;
            }
            return `mesh bin ${index + 1}`;
        }
        default:
            return `${f.type} bin ${index + 1}`;
    }
}

// h5wasm ships ESM only: its package `exports` map has an `import` condition
// and no `require`, so a CommonJS `await import('h5wasm')` — which is what both
// tsc and esbuild emit for this extension — fails with "No exports main
// defined". Going through `new Function` keeps a genuine dynamic import in the
// output, which Node honours from CommonJS.
const dynamicImport = new Function('spec', 'return import(spec);') as (spec: string) => Promise<unknown>;

interface H5Module {
    ready: Promise<{ FS?: { writeFile(p: string, d: Uint8Array): void; unlink(p: string): void } }>;
    File: new (path: string, mode: string) => H5Like;
    FS?: { writeFile(p: string, d: Uint8Array): void; unlink(p: string): void };
}

/**
 * Open a statepoint. `h5wasm/node` reads real filesystem paths directly; the
 * browser build needs the file copied into its in-memory filesystem first.
 */
async function openH5(filePath: string): Promise<{ file: H5Like; cleanup: () => void }> {
    try {
        const raw = (await dynamicImport('h5wasm/node')) as { default?: H5Module } & H5Module;
        const h5 = raw.default ?? raw;
        await h5.ready;
        return { file: new h5.File(filePath, 'r'), cleanup: () => undefined };
    } catch {
        const raw = (await dynamicImport('h5wasm')) as { default?: H5Module } & H5Module;
        const h5 = raw.default ?? raw;
        const mod = await h5.ready;
        const FS = mod?.FS ?? h5.FS;
        if (!FS) throw new Error('h5wasm filesystem unavailable');
        const scratch = `sp-${Date.now()}.h5`;
        FS.writeFile(scratch, new Uint8Array(fs.readFileSync(filePath)));
        return {
            file: new h5.File(scratch, 'r'),
            cleanup: () => {
                try {
                    FS.unlink(scratch);
                } catch {
                    /* scratch file already gone */
                }
            },
        };
    }
}

/** Parse a statepoint.h5 via h5wasm. */
export async function parseOpenmcStatepoint(filePath: string): Promise<RunResults> {
    const notes: string[] = [];
    try {
        const opened = await openH5(filePath);
        const f = opened.file;

        const value = (p: string): unknown => {
            try {
                return f.get(p)?.value;
            } catch {
                return undefined;
            }
        };
        const shapeOf = (p: string): number[] => {
            try {
                return f.get(p)?.shape ?? [];
            } catch {
                return [];
            }
        };
        const keysOf = (p: string): string[] => {
            try {
                return f.get(p)?.keys?.() ?? [];
            } catch {
                return [];
            }
        };

        const metadata: Record<string, string | number> = {};
        const versionAttr = asNumbers((f.attrs as Record<string, unknown> | undefined)?.openmc_version);
        if (versionAttr.length >= 3) metadata.code = `OpenMC ${versionAttr.join('.')}`;
        const runMode = asStrings(value('run_mode'))[0];
        if (runMode) metadata.runMode = runMode;
        for (const [key, label] of [
            ['n_batches', 'batches'],
            ['n_inactive', 'inactiveBatches'],
            ['n_particles', 'particlesPerBatch'],
            ['n_realizations', 'realizations'],
            ['current_batch', 'currentBatch'],
        ] as const) {
            const v = asNumbers(value(key))[0];
            if (Number.isFinite(v)) metadata[label] = v;
        }
        const totalRuntime = asNumbers(value('runtime/total'))[0];
        if (Number.isFinite(totalRuntime)) metadata.elapsedSeconds = totalRuntime;

        // k-eff
        const kGen = asNumbers(value('k_generation'));
        const kCombined = asNumbers(value('k_combined'));
        const inactive = asNumbers(value('n_inactive'))[0];
        let keff: KeffHistory | undefined;
        if (kGen.length > 0 || kCombined.length >= 2) {
            keff = {
                cycles: kGen.map((_, i) => i + 1),
                mean: kGen,
                std: kGen.map(() => 0),
                final:
                    kCombined.length >= 2
                        ? { mean: kCombined[0], std: kCombined[1] }
                        : { mean: kGen[kGen.length - 1], std: 0 },
                inactive: Number.isFinite(inactive) ? inactive : undefined,
            };
            if (kGen.length > 0) {
                notes.push(
                    'k-eff by generation is the raw per-generation estimate (inactive batches included); the final value is OpenMC\'s combined estimator.',
                );
            }
        }

        // Filters and meshes
        const filters = new Map<number, FilterInfo>();
        for (const key of keysOf('tallies/filters')) {
            const m = /^filter\s+(\d+)$/i.exec(key);
            if (!m) continue;
            const id = parseInt(m[1], 10);
            filters.set(id, {
                id,
                type: asStrings(value(`tallies/filters/${key}/type`))[0] ?? 'unknown',
                nBins: asNumbers(value(`tallies/filters/${key}/n_bins`))[0] ?? 1,
                bins: asNumbers(value(`tallies/filters/${key}/bins`)),
            });
        }
        const meshes: Array<{ dimension: number[]; lower: number[]; upper: number[] }> = [];
        for (const key of keysOf('tallies/meshes')) {
            meshes.push({
                dimension: asNumbers(value(`tallies/meshes/${key}/dimension`)),
                lower: asNumbers(value(`tallies/meshes/${key}/lower_left`)),
                upper: asNumbers(value(`tallies/meshes/${key}/upper_right`)),
            });
        }
        const meshDims = meshes[0]?.dimension;

        const tallies: TallyEntry[] = [];
        const spectra: FluxSpectrum[] = [];
        const meshTallies: MeshTally[] = [];

        for (const key of keysOf('tallies')) {
            const m = /^tally\s+(\d+)$/i.exec(key);
            if (!m) continue;
            const id = m[1];
            const base = `tallies/${key}`;
            const results = asNumbers(value(`${base}/results`));
            const shape = shapeOf(`${base}/results`);
            if (results.length === 0 || shape.length !== 3) continue;
            const [nFilterBins, nScoreBins] = shape;
            const n = asNumbers(value(`${base}/n_realizations`))[0] ?? asNumbers(value('n_realizations'))[0] ?? 1;
            const name = asStrings(value(`${base}/name`))[0] ?? '';
            const scores = asStrings(value(`${base}/score_bins`));
            const nuclides = asStrings(value(`${base}/nuclides`));
            const estimator = asStrings(value(`${base}/estimator`))[0];
            const filterIds = asNumbers(value(`${base}/filters`));
            const filterList = filterIds.map((fid) => filters.get(fid)).filter((x): x is FilterInfo => !!x);

            // Filter bin index → label, last filter varying fastest.
            const labelForFilterBin = (bin: number): string => {
                if (filterList.length === 0) return 'total';
                const parts: string[] = [];
                let rest = bin;
                for (let k = filterList.length - 1; k >= 0; k--) {
                    const fl = filterList[k];
                    const idx = rest % fl.nBins;
                    rest = Math.floor(rest / fl.nBins);
                    parts.unshift(filterBinLabel(fl, idx, meshDims));
                }
                return parts.join(' · ');
            };

            const bins: TallyBin[] = [];
            for (let fb = 0; fb < nFilterBins; fb++) {
                for (let sb = 0; sb < nScoreBins; sb++) {
                    const off = (fb * nScoreBins + sb) * 2;
                    const { mean, error } = meanAndRelErr(results[off], results[off + 1], n);
                    const nucIdx = nuclides.length > 1 ? Math.floor(sb / Math.max(scores.length, 1)) : 0;
                    const scoreIdx = scores.length > 0 ? sb % scores.length : 0;
                    const scoreName = scores[scoreIdx] ?? `score ${sb + 1}`;
                    const nucName = nuclides[nucIdx] && nuclides[nucIdx] !== 'total' ? nuclides[nucIdx] : '';
                    const label = [labelForFilterBin(fb), nucName, scoreName].filter(Boolean).join(' · ');
                    bins.push({ label, value: mean, error });
                }
            }

            const entry: TallyEntry = {
                id,
                label: name ? `Tally ${id} — ${name}` : `Tally ${id}`,
                value: bins[0]?.value ?? 0,
                error: bins[0]?.error,
                unit: estimator ? `${estimator} estimator` : undefined,
                bins: bins.length ? bins : undefined,
                checks: 'unknown',
            };
            tallies.push(entry);

            // Energy spectrum when exactly one energy filter is present.
            const energyFilter = filterList.find((fl) => fl.type === 'energy');
            if (energyFilter && filterList.length >= 1 && energyFilter.bins.length >= 2) {
                const strideAfter = filterList
                    .slice(filterList.indexOf(energyFilter) + 1)
                    .reduce((acc, fl) => acc * fl.nBins, 1);
                const E: number[] = [];
                const phi: number[] = [];
                for (let e = 0; e < energyFilter.nBins; e++) {
                    const fb = e * strideAfter;
                    const off = (fb * nScoreBins + 0) * 2;
                    if (off + 1 >= results.length) break;
                    const { mean } = meanAndRelErr(results[off], results[off + 1], n);
                    const lo = energyFilter.bins[e];
                    const hi = energyFilter.bins[e + 1] ?? lo;
                    E.push(Math.sqrt(Math.max(lo, 1e-12) * Math.max(hi, 1e-12)));
                    phi.push(mean);
                }
                if (E.length >= 3) {
                    spectra.push({
                        label: `${name || `Tally ${id}`} — ${scores[0] ?? 'score'}`,
                        E,
                        phi,
                        unit: 'per source particle',
                    });
                }
            }

            // Mesh tally
            const meshFilter = filterList.find((fl) => fl.type === 'mesh');
            if (meshFilter && meshDims && meshDims.length === 3) {
                const [nx, ny, nz] = meshDims;
                if (nx * ny * nz === meshFilter.nBins) {
                    const values: number[] = [];
                    const errors: number[] = [];
                    for (let b = 0; b < meshFilter.nBins; b++) {
                        const off = (b * nScoreBins + 0) * 2;
                        const { mean, error } = meanAndRelErr(results[off], results[off + 1], n);
                        values.push(mean);
                        errors.push(error ?? 0);
                    }
                    const mesh = meshes[0];
                    meshTallies.push({
                        id,
                        label: name ? `${name} (${scores[0] ?? 'score'})` : `Tally ${id} mesh`,
                        nx,
                        ny,
                        nz,
                        values,
                        errors,
                        bounds:
                            mesh.lower.length === 3 && mesh.upper.length === 3
                                ? {
                                      xmin: mesh.lower[0],
                                      xmax: mesh.upper[0],
                                      ymin: mesh.lower[1],
                                      ymax: mesh.upper[1],
                                      zmin: mesh.lower[2],
                                      zmax: mesh.upper[2],
                                  }
                                : undefined,
                    });
                }
            }
        }

        f.close();
        opened.cleanup();

        return {
            code: 'openmc',
            sourceFile: filePath,
            keff,
            spectra,
            tallies,
            meshTallies,
            metadata,
            notes: notes.length ? notes : undefined,
        };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Fall back to a companion text output so the panel still shows something.
        const dir = filePath.replace(/[^\\/]+$/, '');
        for (const companion of ['tallies.out', 'owen-sweep.log']) {
            const p = `${dir}${companion}`;
            if (fs.existsSync(p)) {
                const text = fs.readFileSync(p, 'utf8');
                const res = looksLikeOpenmcTalliesOut(text)
                    ? parseOpenmcTalliesOut(text, p)
                    : parseOpenmcStdout(text, p);
                res.notes = [...(res.notes ?? []), `Could not read ${filePath}: ${msg}. Showing ${companion} instead.`];
                return res;
            }
        }
        return {
            code: 'openmc',
            sourceFile: filePath,
            keff: undefined,
            spectra: [],
            tallies: [],
            meshTallies: [],
            metadata: { parseError: msg },
            notes: [`Could not read this statepoint: ${msg}`],
        };
    }
}

export async function parseOpenmcFile(filePath: string): Promise<RunResults> {
    if (/\.h5$/i.test(filePath)) {
        return parseOpenmcStatepoint(filePath);
    }
    const text = fs.readFileSync(filePath, 'utf8');
    if (looksLikeOpenmcTalliesOut(text)) return parseOpenmcTalliesOut(text, filePath);
    return parseOpenmcStdout(text, filePath);
}
