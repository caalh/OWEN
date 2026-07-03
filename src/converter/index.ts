// Cross-code deck converter — public API.
//
// Directions: MCNP -> OpenMC / Serpent / SCONE, and OpenMC -> MCNP.
// MCNP<->OpenMC is BETA as of v0.3.8 (hi-fi rewrite, validated against the
// bundled BEAVRS full core in real OpenMC); Serpent/SCONE stay EXPERIMENTAL.
// The design contract (shared with GROVES converter.py): where a construct
// cannot be converted, emit a clearly-marked TODO comment in the output
// rather than silently dropping it.

export { mcnpToOpenmc } from './mcnpToOpenmc';
export { openmcToMcnp, openmcTraceToMcnp, TRACE_HARNESS_PY } from './openmcToMcnp';
export { mcnpToSerpent } from './mcnpToSerpent';
export { mcnpToScone } from './mcnpToScone';
export { parseMcnpDeck, parseRegion } from './mcnpModel';
export { emitMcnpFromTrace } from './tracedModel';
export type { TracedModel } from './tracedModel';
export { parseOpenmcStatic } from './openmcStatic';
export type { ConversionDirection, ConversionResult, ConversionIssue } from './types';
export { TODO_MARK } from './types';

import { mcnpToOpenmc } from './mcnpToOpenmc';
import { openmcToMcnp } from './openmcToMcnp';
import { mcnpToSerpent } from './mcnpToSerpent';
import { mcnpToScone } from './mcnpToScone';
import type { ConversionDirection, ConversionResult } from './types';

export type SourceLanguage = 'mcnp' | 'openmc';
export type TargetLanguage = 'mcnp' | 'openmc' | 'serpent' | 'scone';

/** Valid conversion targets per source language. */
export const CONVERSION_TARGETS: Record<SourceLanguage, TargetLanguage[]> = {
    mcnp: ['openmc', 'serpent', 'scone'],
    openmc: ['mcnp'],
};

export function convert(source: SourceLanguage, target: TargetLanguage, text: string): ConversionResult {
    const direction = `${source}_to_${target}` as ConversionDirection;
    switch (direction) {
        case 'mcnp_to_openmc': return mcnpToOpenmc(text);
        case 'mcnp_to_serpent': return mcnpToSerpent(text);
        case 'mcnp_to_scone': return mcnpToScone(text);
        case 'openmc_to_mcnp': return openmcToMcnp(text);
        default:
            throw new Error(`Unsupported conversion: ${source} -> ${target}`);
    }
}

/** Detect whether text looks like MCNP input or an OpenMC Python script. */
export function detectConversionSource(text: string): SourceLanguage | null {
    const openmcIndicators = [
        /import\s+openmc/, /openmc\.Material/, /openmc\.Cell/,
        /openmc\.Settings/, /openmc\.ZCylinder/, /openmc\.Geometry/,
    ];
    const mcnpIndicators = [
        /^\s*\d+\s+\d+\s+[+-]?[\d.]+[eE]?[+-]?\d*\s+.*imp:/mi,
        /^\s*\d+\s+cz\s/mi, /^\s*\d+\s+pz\s/mi, /^\s*\d+\s+px\s/mi,
        /^\s*\d+\s+py\s/mi, /^\s*\d+\s+so\s/mi, /^\s*\d+\s+rpp\s/mi,
        /^kcode\s/mi, /^ksrc\s/mi, /^sdef\s/mi, /^m\d+\s/mi, /^mode\s+[np]/mi,
    ];
    const openmcScore = openmcIndicators.filter((p) => p.test(text)).length;
    const mcnpScore = mcnpIndicators.filter((p) => p.test(text)).length;
    if (openmcScore > mcnpScore && openmcScore >= 2) return 'openmc';
    if (mcnpScore > openmcScore && mcnpScore >= 2) return 'mcnp';
    return null;
}
