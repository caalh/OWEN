// MCNP results entry point. MCNP writes two readable result files:
//   outp   — the text output every run produces (tallies, 10 statistical
//            checks, TFC charts, k-eff, warnings). Validated against real runs.
//   mctal  — the machine-readable tally file, written on request.
// Which one the user hands us is decided by content, not by filename, because
// MCNP output names are entirely up to the person who launched the run.
import * as fs from 'fs';
import type { RunResults } from '../types';
import { looksLikeMcnpOutp, parseMcnpOutp } from './mcnpOutp';
import { looksLikeMctal, parseMctalAscii } from './mctal';

export { parseMcnpOutp, looksLikeMcnpOutp } from './mcnpOutp';
export { parseMctalAscii, looksLikeMctal } from './mctal';

/** Parse either flavour of MCNP result file. */
export function parseMcnpText(text: string, sourceFile?: string): RunResults {
    if (looksLikeMctal(text)) return parseMctalAscii(text, sourceFile);
    if (looksLikeMcnpOutp(text)) return parseMcnpOutp(text, sourceFile);
    // Unrecognised: run the outp reader anyway (it degrades to "nothing found"
    // with a note) rather than guessing numbers out of an unknown format.
    const res = parseMcnpOutp(text, sourceFile);
    res.notes = [
        ...(res.notes ?? []),
        'This file does not look like an MCNP outp or mctal file. If it is MCNP output, please open an issue with a sample.',
    ];
    return res;
}

export function parseMctalFile(filePath: string): RunResults {
    return parseMcnpText(fs.readFileSync(filePath, 'utf8'), filePath);
}
