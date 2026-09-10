// Cross-code deck converter — public API.
//
// Direct directions: MCNP -> OpenMC / Serpent / SCONE, OpenMC -> MCNP, and
// Serpent / SCONE -> MCNP (through the exact-geometry model). Every other pair
// pivots through MCNP: the two hops' issues are concatenated so nothing that
// needed attention on the way is hidden by the second hop.
// MCNP<->OpenMC is STABLE as of v1.0.0 (hi-fi rewrite, validated against the
// bundled BEAVRS full core in real OpenMC); everything touching Serpent or
// SCONE stays EXPERIMENTAL. The design contract (shared with GROVES
// converter.py): where a construct cannot be converted, emit a clearly-marked
// TODO comment in the output rather than silently dropping it.

export { mcnpToOpenmc } from './mcnpToOpenmc';
export { openmcToMcnp, openmcTraceToMcnp, TRACE_HARNESS_PY } from './openmcToMcnp';
export { mcnpToSerpent } from './mcnpToSerpent';
export { mcnpToScone } from './mcnpToScone';
export { modelToMcnp } from './modelToMcnp';
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
import { modelToMcnp } from './modelToMcnp';
import { parseSerpentGeometry } from '../preview/serpentGeometry';
import { parseSconeGeometry } from '../preview/sconeGeometry';
import type { ConversionDirection, ConversionResult } from './types';

export type SourceLanguage = 'mcnp' | 'openmc' | 'serpent' | 'scone';
export type TargetLanguage = 'mcnp' | 'openmc' | 'serpent' | 'scone';

/** Valid conversion targets per source language. */
export const CONVERSION_TARGETS: Record<SourceLanguage, TargetLanguage[]> = {
    mcnp: ['openmc', 'serpent', 'scone'],
    openmc: ['mcnp', 'serpent', 'scone'],
    serpent: ['mcnp', 'openmc', 'scone'],
    scone: ['mcnp', 'openmc', 'serpent'],
};

/** Directions implemented in one step; everything else pivots through MCNP. */
export function isDirectConversion(source: SourceLanguage, target: TargetLanguage): boolean {
    return source === 'mcnp' || target === 'mcnp';
}

function toMcnp(source: SourceLanguage, text: string): ConversionResult {
    switch (source) {
        case 'mcnp': return { direction: 'mcnp_to_openmc', output: text, issues: [] };
        case 'openmc': return openmcToMcnp(text);
        case 'serpent': return modelToMcnp(parseSerpentGeometry(text), text, { language: 'serpent' });
        case 'scone': return modelToMcnp(parseSconeGeometry(text), text, { language: 'scone' });
    }
}

function fromMcnp(target: TargetLanguage, mcnp: string): ConversionResult {
    switch (target) {
        case 'openmc': return mcnpToOpenmc(mcnp);
        case 'serpent': return mcnpToSerpent(mcnp);
        case 'scone': return mcnpToScone(mcnp);
        case 'mcnp': return { direction: 'openmc_to_mcnp', output: mcnp, issues: [] };
    }
}

export function convert(source: SourceLanguage, target: TargetLanguage, text: string): ConversionResult {
    if (source === target) throw new Error(`Unsupported conversion: ${source} -> ${target}`);
    const direction = `${source}_to_${target}` as ConversionDirection;
    if (source === 'mcnp') return { ...fromMcnp(target, text), direction };
    if (target === 'mcnp') return { ...toMcnp(source, text), direction };
    // Pivot through MCNP. Second-hop issues point at lines of the intermediate
    // deck, which the user never sees, so they are reported as whole-deck notes.
    const hop1 = toMcnp(source, text);
    const hop2 = fromMcnp(target, hop1.output);
    return {
        direction,
        output: `${commentFor(target)} ${source.toUpperCase()} -> MCNP -> ${target.toUpperCase()}: two-hop conversion; the intermediate MCNP deck's TODOs carry over.\n${hop2.output}`,
        issues: [
            ...hop1.issues,
            ...hop2.issues.map((i) => ({ sourceLine: -1, message: `[via MCNP] ${i.message}` })),
        ],
    };
}

function commentFor(target: TargetLanguage): string {
    return target === 'openmc' ? '#' : target === 'serpent' ? '%' : target === 'scone' ? '!' : 'c';
}

/** Detect whether text looks like MCNP, OpenMC Python, Serpent or SCONE input. */
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
    const serpentIndicators = [/^\s*surf\s+\S+\s+\w+/m, /^\s*cell\s+\S+\s+\S+\s+/m, /^\s*mat\s+\S+\s+/m, /^\s*set\s+pop\b/m, /^\s*lat\s+\S+\s+\d/m, /^\s*pin\s+\S+/m];
    const sconeIndicators = [/\btype\s+rootUniverse\s*;/, /\bpinUniverse\b/, /\baceNeutronDatabase\b/, /\bsurfaces\s*\{/, /\bcells\s*\{/, /\bfilltype\s+/];
    const score = (ps: RegExp[]) => ps.filter((p) => p.test(text)).length;
    const scores: [SourceLanguage, number][] = [
        ['openmc', score(openmcIndicators)],
        ['mcnp', score(mcnpIndicators)],
        ['serpent', score(serpentIndicators)],
        ['scone', score(sconeIndicators)],
    ];
    scores.sort((a, b) => b[1] - a[1]);
    if (scores[0][1] >= 2 && scores[0][1] > scores[1][1]) return scores[0][0];
    return null;
}
