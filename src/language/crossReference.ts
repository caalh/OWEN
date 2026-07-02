/**
 * MCNP cross-reference diagnostics from the references index:
 *   - a cell references an undefined surface / material / universe → error
 *   - a surface / material / universe / transform is defined but never
 *     referenced → hint tagged unnecessary (cells are entry points, not
 *     flagged when unused).
 *
 * Pure (no vscode / vscode-languageserver): used by the LSP server and
 * headless tests.
 */

import {
    buildMcnpReferenceIndex,
    McnpEntityKind,
    McnpReferenceIndex,
} from '../references/mcnpReferences';
import { PlainDiagnostic } from './types';

/** Kinds a cell can reference that must exist somewhere in the deck. */
const REFERENCED_KINDS: McnpEntityKind[] = ['surface', 'material', 'universe', 'transform'];

/** Kinds that are worth an "unused" hint when defined but never referenced. */
const UNUSED_HINT_KINDS: McnpEntityKind[] = ['surface', 'material', 'universe', 'transform'];

const KIND_LABEL: Record<McnpEntityKind, string> = {
    cell: 'Cell', surface: 'Surface', material: 'Material', universe: 'Universe', transform: 'Transform',
};

export function mcnpCrossReferenceDiagnostics(
    text: string,
    prebuiltIndex?: McnpReferenceIndex,
): PlainDiagnostic[] {
    const index = prebuiltIndex ?? buildMcnpReferenceIndex(text);
    const diags: PlainDiagnostic[] = [];

    const defined = new Set<string>();
    for (const def of index.definitions.values()) {
        defined.add(`${def.kind}:${def.id}`);
    }

    const referenced = new Set<string>();
    for (const occ of index.occurrences) {
        if (!occ.isDefinition) referenced.add(`${occ.kind}:${occ.id}`);

        if (occ.isDefinition || !REFERENCED_KINDS.includes(occ.kind)) continue;
        if (defined.has(`${occ.kind}:${occ.id}`)) continue;
        const context = occ.cellContext !== undefined ? ` (referenced by cell ${occ.cellContext})` : '';
        diags.push({
            line: occ.line,
            startCol: occ.startCol,
            endCol: occ.endCol,
            message: `${KIND_LABEL[occ.kind]} ${occ.id} is referenced${context} but never defined in this file.`,
            severity: 'error',
            code: `mcnp.undefined-${occ.kind}`,
        });
    }

    for (const def of index.definitions.values()) {
        if (!UNUSED_HINT_KINDS.includes(def.kind)) continue;
        if (referenced.has(`${def.kind}:${def.id}`)) continue;
        diags.push({
            line: def.line,
            startCol: def.startCol,
            endCol: def.endCol,
            message: `${KIND_LABEL[def.kind]} ${def.id} is defined but never referenced.`,
            severity: 'hint',
            code: `mcnp.unused-${def.kind}`,
            unnecessary: true,
        });
    }

    return diags;
}
