import * as fs from 'fs';
import type { RunResults, KeffHistory, FluxSpectrum, MeshTally } from '../types';
import { parseKeff } from '../../workflows/sweepCore';
import { NUM, pushIfFinite } from './numeric';

/** Parse OpenMC stdout / owen-sweep.log for k-eff when HDF5 unavailable. */
export function parseOpenmcStdout(text: string, sourceFile?: string): RunResults {
    const lines = text.split(/\r?\n/);
    const cycles: number[] = [];
    const mean: number[] = [];
    const std: number[] = [];

    const combinedRe = new RegExp(String.raw`Combined\s+k-?effective\s*=\s*(${NUM})\s*\+\/-\s*(${NUM})`, 'i');
    const batchRe = new RegExp(String.raw`Batch\s+(\d+)[^\n]*k\s*=\s*(${NUM})\s*\+\/-\s*(${NUM})`, 'i');
    for (const line of lines) {
        const combined = combinedRe.exec(line);
        if (combined) {
            pushIfFinite(cycles, mean, std, cycles.length + 1, parseFloat(combined[1]), parseFloat(combined[2]));
            continue;
        }
        const batch = batchRe.exec(line);
        if (batch) {
            pushIfFinite(cycles, mean, std, parseInt(batch[1], 10), parseFloat(batch[2]), parseFloat(batch[3]));
        }
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
        mean.length > 0
            ? {
                  cycles,
                  mean,
                  std,
                  final: { mean: mean[mean.length - 1], std: std[std.length - 1] },
              }
            : undefined;

    return { code: 'openmc', sourceFile, keff, spectra: [], tallies: [], meshTallies: [] };
}

/**
 * Parse OpenMC statepoint.h5 via h5wasm (dynamic import).
 * Reads eigenvalue batch statistics and optional mesh tallies.
 */
export async function parseOpenmcStatepoint(filePath: string): Promise<RunResults> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const h5wasm = await import('h5wasm' as any);
        await h5wasm.ready;
        const { FS } = h5wasm;
        const buf = fs.readFileSync(filePath);
        FS.writeFile('statepoint.h5', new Uint8Array(buf));
        const f = new h5wasm.File('statepoint.h5', 'r');

        const cycles: number[] = [];
        const mean: number[] = [];
        const std: number[] = [];
        const spectra: FluxSpectrum[] = [];
        const meshTallies: MeshTally[] = [];

        // OpenMC 0.13+ eigenvalues group
        const tryDataset = (path: string): Float64Array | null => {
            try {
                const ds = f.get(path);
                if (ds?.value instanceof Float64Array) return ds.value as Float64Array;
                if (ds?.value instanceof Array) return new Float64Array(ds.value as number[]);
                return null;
            } catch {
                return null;
            }
        };

        const kGen = tryDataset('eigenvalues/k_generation') ?? tryDataset('k_generation');
        const kStd = tryDataset('eigenvalues/k_std_dev') ?? tryDataset('k_std_dev');
        if (kGen) {
            for (let i = 0; i < kGen.length; i++) {
                cycles.push(i + 1);
                mean.push(kGen[i]);
                std.push(kStd ? kStd[i] : 0);
            }
        }

        // Tally flux spectrum (first energy filter tally if present)
        const tallyKeys = Object.keys(f.keys()).filter((k) => k.startsWith('tally'));
        for (const tk of tallyKeys.slice(0, 3)) {
            const meanDs = tryDataset(`${tk}/mean`);
            const binDs = tryDataset(`${tk}/filters/filter 1/bins`) ?? tryDataset(`${tk}/energy_bins`);
            if (meanDs && binDs && binDs.length >= 2) {
                const E: number[] = [];
                const phi: number[] = [];
                for (let i = 0; i < binDs.length - 1; i++) {
                    E.push((binDs[i] + binDs[i + 1]) / 2);
                    phi.push(meanDs[i] ?? 0);
                }
                if (E.length > 2) spectra.push({ label: tk, E, phi, unit: 'n/source' });
            }
        }

        // Mesh tally heuristic
        for (const tk of tallyKeys) {
            const meanDs = tryDataset(`${tk}/mean`);
            const shape = f.get(`${tk}/mean`)?.shape as number[] | undefined;
            if (meanDs && shape && shape.length === 3) {
                const [nx, ny, nz] = shape;
                meshTallies.push({
                    id: tk,
                    label: tk,
                    nx,
                    ny,
                    nz,
                    values: Array.from(meanDs),
                });
            }
        }

        f.close();
        FS.unlink('statepoint.h5');

        const keff: KeffHistory | undefined =
            mean.length > 0
                ? {
                      cycles,
                      mean,
                      std,
                      final: { mean: mean[mean.length - 1], std: std[std.length - 1] },
                  }
                : undefined;

        return { code: 'openmc', sourceFile: filePath, keff, spectra, tallies: [], meshTallies };
    } catch (err) {
        // Fallback: parse companion log or return empty shell
        const logPath = filePath.replace(/statepoint\.\d+\.h5$/i, 'owen-sweep.log');
        if (fs.existsSync(logPath)) {
            return parseOpenmcStdout(fs.readFileSync(logPath, 'utf8'), filePath);
        }
        const msg = err instanceof Error ? err.message : String(err);
        return {
            code: 'openmc',
            sourceFile: filePath,
            keff: undefined,
            spectra: [],
            tallies: [],
            meshTallies: [],
            metadata: { parseError: msg },
        };
    }
}

export async function parseOpenmcFile(filePath: string): Promise<RunResults> {
    if (/\.h5$/i.test(filePath)) {
        return parseOpenmcStatepoint(filePath);
    }
    return parseOpenmcStdout(fs.readFileSync(filePath, 'utf8'), filePath);
}
