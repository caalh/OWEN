import * as fs from 'fs';
import type { RunResults, KeffHistory, TallyEntry, FluxSpectrum, MeshTally } from '../types';
import { NUM, pushIfFinite } from './numeric';

/** Parse Serpent _res.m / _det.m results files. */
export function parseSerpentResults(text: string, sourceFile?: string): RunResults {
    const cycles: number[] = [];
    const mean: number[] = [];
    const std: number[] = [];
    const tallies: TallyEntry[] = [];
    const spectra: FluxSpectrum[] = [];
    const meshTallies: MeshTally[] = [];

    // Cycle-wise: "1.000000E+00  0.001000E+00" in RESULTS table or explicit cycle lines
    const cycleRe = new RegExp(String.raw`(?:cycle|gen|batch)\s*[=:]?\s*(\d+)[^\n]*?(${NUM})\s*[+/-]+\s*(${NUM})`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = cycleRe.exec(text)) !== null) {
        pushIfFinite(cycles, mean, std, parseInt(m[1], 10), parseFloat(m[2]), parseFloat(m[3]));
    }

    // Final keff: "KEFF = 1.00000 0.00010" or "1.00000 +/- 0.00010"
    if (mean.length === 0) {
        const keffRe = new RegExp(String.raw`(?:KEFF|k-?eff)\s*=?\s*(${NUM})\s*(?:[+/-]+|\+\/-)\s*(${NUM})`, 'gi');
        while ((m = keffRe.exec(text)) !== null) {
            pushIfFinite(cycles, mean, std, cycles.length + 1, parseFloat(m[1]), parseFloat(m[2]));
        }
    }

    // Serpent DET energy grid in _det.m: "DETenergy = ..." or inline vectors
    const detE = /DET\s*\w*\s*energy\s*=\s*\[([^\]]+)\]/i.exec(text);
    const detV = /DET\s*\w*\s*value\s*=\s*\[([^\]]+)\]/i.exec(text);
    if (detE && detV) {
        const E = detE[1].split(/\s+/).map(parseFloat).filter((v) => !isNaN(v));
        const phi = detV[1].split(/\s+/).map(parseFloat).filter((v) => !isNaN(v));
        if (E.length === phi.length && E.length > 2) {
            spectra.push({ label: 'Serpent detector', E, phi });
        }
    }

    // Mesh: "mesh 10 10 1" style metadata
    const meshRe = /mesh\s+(\d+)\s+(\d+)\s+(\d+)/i.exec(text);
    if (meshRe) {
        const nx = parseInt(meshRe[1], 10);
        const ny = parseInt(meshRe[2], 10);
        const nz = parseInt(meshRe[3], 10);
        const valsRe = /(?:values|result)\s*=\s*\[([^\]]+)\]/i.exec(text);
        if (valsRe) {
            const values = valsRe[1].split(/\s+/).map(parseFloat).filter((v) => !isNaN(v));
            if (values.length >= nx * ny * nz) {
                meshTallies.push({
                    id: 'mesh1',
                    label: 'Serpent mesh',
                    nx,
                    ny,
                    nz,
                    values: values.slice(0, nx * ny * nz),
                });
            }
        }
    }

    // ADR / reaction rate tallies
    const adrRe = /ADR\s+(\d+)\s+.*?=\s*([0-9.eE+-]+)/gi;
    while ((m = adrRe.exec(text)) !== null) {
        tallies.push({ id: m[1], label: `ADR ${m[1]}`, value: parseFloat(m[2]) });
    }

    const keff: KeffHistory | undefined =
        mean.length > 0
            ? {
                  cycles: cycles.length ? cycles : mean.map((_, i) => i + 1),
                  mean,
                  std,
                  final: { mean: mean[mean.length - 1], std: std[std.length - 1] },
              }
            : undefined;

    return { code: 'serpent', sourceFile, keff, spectra, tallies, meshTallies };
}

export function parseSerpentFile(filePath: string): RunResults {
    return parseSerpentResults(fs.readFileSync(filePath, 'utf8'), filePath);
}
