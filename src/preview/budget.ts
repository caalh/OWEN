// Pure, vscode-free instance-budget + level-of-detail (LOD) planning for the
// 3D geometry preview.
//
// The webview batches every cylinder into `THREE.InstancedMesh` groups keyed by
// geometry signature, so the number of *draw calls* is tiny (tens) regardless
// of pin count. The real cost is the number of GPU **instances** (one per
// emitted cylinder) plus the per-instance bookkeeping the webview keeps for
// hover-pick and visibility toggles. A full BEAVRS core is ~56k pin positions;
// expanded into concentric shells (~3 each) and the deck's ~25 axial segments
// that is several million instances — enough to exhaust memory and stutter.
//
// Rather than silently truncating the geometry (dropping whole pins), the
// parsers call `planRender` to pick the richest fidelity that fits the
// configured instance ceiling, degrading detail in this order:
//
//   1. requested (detail, axial)
//   2. drop concentric layers → one disc per pin   (keeps axial structure)
//   3. also collapse axial segments                (keeps every pin)
//
// Every pin position is still drawn at each step, so "all pins visible" holds.
// This module is pure (only args + JS built-ins) so it is unit-tested headlessly
// like `measure.ts` / `latticeCodegen.ts`, and the parsers share one source of
// truth for the estimate math the tests assert against.

/**
 * Default ceiling on emitted cylinder instances. Sized so a full BEAVRS core
 * renders without hiding pins at interactive frame rates:
 *   - radially-complete core (concentric shells, no axial): ~170k instances
 *   - one-disc-per-pin core with full axial segments:        ~0.8M instances
 * Both fit comfortably; the much heavier layers+axial case (~2.5M) auto-degrades
 * to disc+axial. Override with the `owen.preview.maxInstances` setting.
 */
export const DEFAULT_MAX_INSTANCES = 1_500_000;

export interface EstimateInput {
    /** Placed pin positions (before layering / axial expansion). */
    totalPins: number;
    /** Representative concentric shells per pin in 'layers' mode (≥1). */
    avgLayers: number;
    /** Axial segments per pin when axial detail is on (≥1). */
    axialSegments: number;
    detail: 'disc' | 'layers';
    axial: boolean;
    /** Extra context primitives (vessel/barrel shells, …). */
    context?: number;
}

/** Estimated emitted cylinder count for a given fidelity. */
export function estimatePrimitives(p: EstimateInput): number {
    const perPin = p.detail === 'disc' ? 1 : Math.max(1, p.avgLayers);
    const segs = p.axial ? Math.max(1, p.axialSegments) : 1;
    return p.totalPins * perPin * segs + (p.context ?? 0);
}

export interface PlanInput {
    totalPins: number;
    avgLayers: number;
    axialSegments: number;
    /** Fidelity the user/auto picked before budgeting. */
    detail: 'disc' | 'layers';
    axial: boolean;
    context?: number;
    /** Instance ceiling (defaults to DEFAULT_MAX_INSTANCES). */
    maxInstances?: number;
}

export interface RenderPlan {
    /** Effective fidelity that fits the budget. */
    detail: 'disc' | 'layers';
    axial: boolean;
    /** Estimated instances at the effective fidelity. */
    estimate: number;
    /** Estimated instances at the originally requested fidelity. */
    requestedEstimate: number;
    /** Concentric layers were collapsed to single discs to fit. */
    droppedToDisc: boolean;
    /** Axial segments were collapsed to fit. */
    droppedAxial: boolean;
    /** True when any auto-LOD simplification was applied. */
    simplified: boolean;
    /** Ceiling used. */
    maxInstances: number;
}

/**
 * Picks the richest fidelity that fits the instance ceiling, degrading detail
 * (layers→disc) before axial structure so the user's explicit axial toggle is
 * preserved when possible. Never drops pins — every position is still placed.
 */
export function planRender(p: PlanInput): RenderPlan {
    const maxInstances = p.maxInstances && p.maxInstances > 0 ? p.maxInstances : DEFAULT_MAX_INSTANCES;
    const est = (detail: 'disc' | 'layers', axial: boolean): number =>
        estimatePrimitives({
            totalPins: p.totalPins, avgLayers: p.avgLayers, axialSegments: p.axialSegments,
            detail, axial, context: p.context,
        });

    const requestedEstimate = est(p.detail, p.axial);
    let detail = p.detail;
    let axial = p.axial;
    let estimate = requestedEstimate;

    // 1. Drop concentric layers → one disc per pin (cheapest big win, keeps axial).
    if (estimate > maxInstances && detail === 'layers') {
        detail = 'disc';
        estimate = est(detail, axial);
    }
    // 2. Still over → collapse axial segments (keeps every pin).
    if (estimate > maxInstances && axial) {
        axial = false;
        estimate = est(detail, axial);
    }

    const droppedToDisc = p.detail === 'layers' && detail === 'disc';
    const droppedAxial = p.axial && !axial;
    return {
        detail, axial, estimate, requestedEstimate,
        droppedToDisc, droppedAxial,
        simplified: droppedToDisc || droppedAxial,
        maxInstances,
    };
}

/**
 * Builds the user-facing auto-LOD note (non-alarming) describing what was
 * simplified to fit the instance ceiling and how to override. Returns null when
 * nothing was simplified. `droppedToDisc` / `droppedAxial` are computed by the
 * dispatch layer comparing the requested fidelity to what was actually drawn.
 */
export function simplificationNote(
    droppedToDisc: boolean,
    droppedAxial: boolean,
    maxInstances: number,
): string | null {
    if (!droppedToDisc && !droppedAxial) return null;
    const what: string[] = [];
    if (droppedToDisc) what.push('pins drawn as single discs (not concentric shells)');
    if (droppedAxial) what.push('axial segments collapsed to one level');
    return `Auto-simplified to stay within ${maxInstances.toLocaleString()} instances: `
        + `${what.join(' and ')}. All pins are still shown. Open a single assembly, `
        + `or raise "owen.preview.maxInstances", to view full detail.`;
}

/** Warning shown only when geometry still exceeds the ceiling after full auto-LOD. */
export function truncationWarning(maxInstances: number): string {
    return `Geometry exceeded the ${maxInstances.toLocaleString()}-instance ceiling and was `
        + `truncated. Some pins are not shown — open a single assembly, or raise `
        + `"owen.preview.maxInstances".`;
}
