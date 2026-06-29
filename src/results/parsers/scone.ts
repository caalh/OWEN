import * as fs from 'fs';
import type { RunResults, KeffHistory, TallyEntry } from '../types';

/** Parse SCONE ASCII stdout / .out files. */
export function parseSconeOutput(text: string, sourceFile?: string): RunResults {
    const cycles: number[] = [];
    const mean: number[] = [];
    const std: number[] = [];
    const tallies: TallyEntry[] = [];

    // k_eff lines: "k_eff  1.000000  0.001000" or "k-eff = 1.0 +/- 0.001"
    const keffRe = /k[_\s-]?eff\s*[=:]?\s*([0-9.]+)\s*(?:[+/-]+|\+\/-|\s+)\s*([0-9.]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = keffRe.exec(text)) !== null) {
        cycles.push(cycles.length + 1);
        mean.push(parseFloat(m[1]));
        std.push(parseFloat(m[2]));
    }

    // Cycle-indexed: "cycle 10 k_eff 1.0 0.01"
    const cycleRe = /cycle\s+(\d+)[^\n]*k[_\s-]?eff\s*([0-9.]+)\s*([0-9.]+)/gi;
    while ((m = cycleRe.exec(text)) !== null) {
        const c = parseInt(m[1], 10);
        if (!cycles.includes(c)) {
            cycles.push(c);
            mean.push(parseFloat(m[2]));
            std.push(parseFloat(m[3]));
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
