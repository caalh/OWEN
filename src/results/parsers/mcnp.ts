import * as fs from 'fs';
import type { RunResults, KeffHistory, TallyEntry, FluxSpectrum } from '../types';
import { NUM, pushIfFinite } from './numeric';

/** Parse MCNP ASCII mctal file for k-eff history and tally tables. */
export function parseMctal(text: string, sourceFile?: string): RunResults {
    const cycles: number[] = [];
    const mean: number[] = [];
    const std: number[] = [];
    const tallies: TallyEntry[] = [];
    const spectra: FluxSpectrum[] = [];

    // k-eff by cycle: "k  eff (c)  1.00000  0.00100" or "col 1  col 2  keff  1.0  0.01"
    const keffLineRe = new RegExp(String.raw`k\s*eff\s*\([a-z]\)\s+(${NUM})\s+(${NUM})`, 'gi');
    let m: RegExpExecArray | null;
    let idx = 0;
    while ((m = keffLineRe.exec(text)) !== null) {
        idx++;
        pushIfFinite(cycles, mean, std, idx, parseFloat(m[1]), parseFloat(m[2]));
    }

    // Alternate: "combined keff = 1.00000 0.00100"
    if (mean.length === 0) {
        const altRe = new RegExp(String.raw`combined\s+keff\s*=?\s*(${NUM})\s+(${NUM})`, 'gi');
        while ((m = altRe.exec(text)) !== null) {
            idx++;
            pushIfFinite(cycles, mean, std, idx, parseFloat(m[1]), parseFloat(m[2]));
        }
    }

    // Tally blocks: "tally        4" followed by energy bins
    const tallyRe = /tally\s+(\d+)/gi;
    while ((m = tallyRe.exec(text)) !== null) {
        tallies.push({ id: m[1], label: `Tally ${m[1]}`, value: 0, unit: 'n/cm²/source' });
    }

    // Energy bin flux lines: pairs of energy, flux
    const binRe = /^\s*([0-9.eE+-]+)\s+([0-9.eE+-]+)\s*$/gm;
    const E: number[] = [];
    const phi: number[] = [];
    while ((m = binRe.exec(text)) !== null) {
        const e = parseFloat(m[1]);
        const f = parseFloat(m[2]);
        if (e > 0 && f >= 0 && e < 1e10) {
            E.push(e);
            phi.push(f);
        }
    }
    if (E.length >= 3) {
        spectra.push({ label: 'MCNP tally spectrum', E, phi, unit: 'n/cm²/source' });
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

    return { code: 'mcnp', sourceFile, keff, spectra, tallies, meshTallies: [] };
}

export function parseMctalFile(filePath: string): RunResults {
    const text = fs.readFileSync(filePath, 'utf8');
    return parseMctal(text, filePath);
}
