import type { RunResults } from './types';
import { parseMctalFile } from './parsers/mcnp';
import { parseOpenmcFile } from './parsers/openmc';
import { parseSerpentFile } from './parsers/serpent';
import { parseSconeFile } from './parsers/scone';
import type { DetectedOutput } from './types';

export async function parseOutput(detected: DetectedOutput): Promise<RunResults> {
    switch (detected.code) {
        case 'openmc':
            return parseOpenmcFile(detected.path);
        case 'mcnp':
            return parseMctalFile(detected.path);
        case 'serpent':
            return parseSerpentFile(detected.path);
        case 'scone':
            return parseSconeFile(detected.path);
        default:
            return parseOpenmcFile(detected.path);
    }
}

export { parseMctalFile } from './parsers/mcnp';
export { parseOpenmcFile, parseOpenmcStdout } from './parsers/openmc';
export { parseSerpentFile } from './parsers/serpent';
export { parseSconeFile } from './parsers/scone';
