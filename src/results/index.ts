import * as fs from 'fs';
import type { RunResults, DetectedOutput } from './types';
import { parseMcnpText } from './parsers/mcnp';
import { parseOpenmcFile, parseOpenmcStatepoint } from './parsers/openmc';
import { parseSerpentResults } from './parsers/serpent';
import { parseSconeOutput } from './parsers/scone';
import { identifyOutput } from './detectOutputs';

export async function parseOutput(detected: DetectedOutput): Promise<RunResults> {
    if (detected.kind === 'statepoint') return parseOpenmcStatepoint(detected.path);
    switch (detected.code) {
        case 'openmc':
            return parseOpenmcFile(detected.path);
        case 'mcnp':
            return parseMcnpText(fs.readFileSync(detected.path, 'utf8'), detected.path);
        case 'serpent':
            return parseSerpentResults(fs.readFileSync(detected.path, 'utf8'), detected.path);
        case 'scone':
            return parseSconeOutput(fs.readFileSync(detected.path, 'utf8'), detected.path);
        default:
            return parseOpenmcFile(detected.path);
    }
}

/**
 * Parse a file the user picked by hand. The code is decided by content, so a
 * mis-guessed extension cannot route an MCNP output into the SCONE reader.
 */
export async function parseOutputFile(filePath: string): Promise<RunResults> {
    const id = identifyOutput(filePath);
    if (id) {
        return parseOutput({ path: filePath, code: id.code, kind: id.kind, label: id.label });
    }
    if (/\.h5$/i.test(filePath)) return parseOpenmcStatepoint(filePath);
    const text = fs.readFileSync(filePath, 'utf8');
    const res = parseMcnpText(text, filePath);
    res.notes = [
        'OWEN could not identify this file as MCNP, OpenMC, Serpent or SCONE output.',
        ...(res.notes ?? []),
    ];
    return res;
}

export { parseMcnpText, parseMctalFile, parseMcnpOutp, parseMctalAscii } from './parsers/mcnp';
export { parseOpenmcFile, parseOpenmcStdout, parseOpenmcTalliesOut, parseOpenmcStatepoint } from './parsers/openmc';
export { parseSerpentResults, parseSerpentFile } from './parsers/serpent';
export { parseSconeOutput, parseSconeFile } from './parsers/scone';
