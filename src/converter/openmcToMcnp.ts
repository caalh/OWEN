// OpenMC Python script -> MCNP deck (v0.3.8).
//
// Orchestrates the two front-ends over the shared TracedModel IR:
//   * static:  openmcStatic.ts — no execution, handles flat literal scripts
//              (including everything OWEN's MCNP→OpenMC converter emits);
//   * traced:  traceHarness.ts — a stub `openmc` package executed with any
//              Python 3 (no OpenMC needed); handles functions/loops/
//              comprehensions (e.g. the native BEAVRS full-core deck).
// Both produce TracedModel JSON; tracedModel.ts emits the MCNP deck.

import { ConversionResult, ConversionIssue, TODO_MARK } from './types';
import { parseOpenmcStatic } from './openmcStatic';
import { TracedModel, emitMcnpFromTrace } from './tracedModel';

export { TRACE_HARNESS_PY } from './traceHarness';

/** Static conversion (synchronous, no Python). */
export function openmcToMcnp(openmcText: string): ConversionResult {
    const { model, unparsed, dynamic } = parseOpenmcStatic(openmcText);
    const result = emitMcnpFromTrace(model);
    const issues: ConversionIssue[] = [...result.issues];
    const extraComments: string[] = [];

    if (dynamic) {
        issues.push({
            sourceLine: -1,
            message: 'Script uses functions/loops/comprehensions — the static converter only sees literal statements. '
                + 'Use "Convert with Python tracing" for full fidelity.',
        });
        extraComments.push(`c ${TODO_MARK}: source script is dynamic (def/for/comprehensions); static conversion may be`);
        extraComments.push('c   incomplete. Re-run with Python tracing (executes the script against a stub openmc).');
    }
    for (const u of unparsed.slice(0, 50)) {
        issues.push({ sourceLine: u.line, message: `Not converted: ${u.reason} — ${u.text.slice(0, 80)}` });
    }
    if (unparsed.length > 50) {
        issues.push({ sourceLine: -1, message: `…and ${unparsed.length - 50} more unconverted statements` });
    }

    if (extraComments.length) {
        const lines = result.output.split('\n');
        lines.splice(3, 0, ...extraComments);
        return { ...result, output: lines.join('\n'), issues };
    }
    return { ...result, issues };
}

/** Conversion from a trace-harness JSON dump (full-fidelity path). */
export function openmcTraceToMcnp(traceJson: string): ConversionResult {
    let model: TracedModel;
    try {
        model = JSON.parse(traceJson) as TracedModel;
    } catch (err) {
        return {
            direction: 'openmc_to_mcnp',
            output: `c ${TODO_MARK}: trace JSON could not be parsed: ${(err as Error).message}`,
            issues: [{ sourceLine: -1, message: `Trace JSON parse failure: ${(err as Error).message}` }],
        };
    }
    return emitMcnpFromTrace(model);
}
