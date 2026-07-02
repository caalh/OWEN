import * as fs from 'fs';
import type { RunResults, KeffHistory, TallyEntry } from '../types';
import { NUM, pushIfFinite } from './numeric';

/** Parse SCONE ASCII stdout / .out files. */
export function parseSconeOutput(text: string, sourceFile?: string): RunResults {
    const cycles: number[] = [];
    const mean: number[] = [];
    const std: number[] = [];
    const tallies: TallyEntry[] = [];

    // k_eff lines: "k_eff  1.000000  0.001000" or "k-eff = 1.0 +/- 0.001"
    const keffRe = new RegExp(String.raw`k[_\s-]?eff\s*[=:]?\s*(${NUM})\s*(?:[+/-]+|\+\/-|\s+)\s*(${NUM})`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = keffRe.exec(text)) !== null) {
        pushIfFinite(cycles, mean, std, cycles.length + 1, parseFloat(m[1]), parseFloat(m[2]));
    }

    // Cycle-indexed: "cycle 10 k_eff 1.0 0.01"
    const cycleRe = new RegExp(String.raw`cycle\s+(\d+)[^\n]*k[_\s-]?eff\s*(${NUM})\s*(${NUM})`, 'gi');
    while ((m = cycleRe.exec(text)) !== null) {
        const c = parseInt(m[1], 10);
        if (!cycles.includes(c)) {
            pushIfFinite(cycles, mean, std, c, parseFloat(m[2]), parseFloat(m[3]));
        }
    }

    // Generic tally: "tally_name  value  error"
    const tallyRe = /^(\w+)\s+([0-9.eE+-]+)\s+([0-9.eE+-]+)\s*$/gm;
    while ((m = tallyRe.exec(text)) !== null) {
        if (/k[_-]?eff/i.test(m[1])) continue;
        tallies.push({
            id: m[1],
            label: m[1],
            value: parseFloat(m[2]),
            error: parseFloat(m[3]),
        });
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

    return { code: 'scone', sourceFile, keff, spectra: [], tallies, meshTallies: [] };
}

export function parseSconeFile(filePath: string): RunResults {
    return parseSconeOutput(fs.readFileSync(filePath, 'utf8'), filePath);
}
