/**
 * MCNP cross-reference diagnostics from the references index.
 * Pure module — no vscode imports.
 */

import {
    buildMcnpReferenceIndex,
    McnpEntityKind,
    McnpReferenceIndex,
} from './mcnpReferences';
import { PlainDiagnostic } from './types';

const REFERENCED_KINDS: McnpEntityKind[] = ['surface', 'material', 'universe', 'transform'];
const UNUSED_HINT_KINDS: McnpEntityKind[] = ['surface', 'material', 'universe', 'transform'];

const KIND_LABEL: Record<McnpEntityKind, string> = {
    cell: 'Cell', surface: 'Surface', material: 'Material', universe: 'Universe', transform: 'Transform',
};

export interface CrossRefOptions {
    scope?: 'file' | 'project';
    warnUnused?: boolean;
}

export function mcnpCrossReferenceDiagnostics(
    text: string,
    prebuiltIndex?: McnpReferenceIndex,
    options: CrossRefOptions = {},
): PlainDiagnostic[] {
    const scope = options.scope ?? 'file';
    const warnUnused = options.warnUnused ?? true;
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
        const where = scope === 'project' ? ' in this project' : ' in this file';
        diags.push({
            line: occ.line,
            startCol: occ.startCol,
            endCol: occ.endCol,
            message: `${KIND_LABEL[occ.kind]} ${occ.id} is referenced${context} but never defined${where}.`,
            severity: 'error',
            code: `mcnp.undefined-${occ.kind}`,
        });
    }

    if (warnUnused) {
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
    }

    return diags;
}
