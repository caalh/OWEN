import * as path from 'path';
import { buildIncludeGraph } from './includeGraph';
import { buildSymbolIndex } from './symbolIndex';
import { McnpEntityKind } from './mcnpReferences';
import {
    ValidateMcnpProjectOptions,
    ValidationResult,
    ValidationSummary,
    WorkspaceDiagnostic,
} from './types';

const DUPLICATE_KINDS: McnpEntityKind[] = ['cell', 'surface', 'material', 'universe', 'transform'];

const KIND_LABEL: Record<McnpEntityKind, string> = {
    cell: 'Cell', surface: 'Surface', material: 'Material', universe: 'Universe', transform: 'Transform',
};

function summarize(diags: WorkspaceDiagnostic[]): ValidationSummary {
    const summary: ValidationSummary = { errors: 0, warnings: 0, hints: 0 };
    for (const d of diags) {
        if (d.severity === 'error') summary.errors++;
        else if (d.severity === 'warning') summary.warnings++;
        else summary.hints++;
    }
    return summary;
}

function sortDiags(diags: WorkspaceDiagnostic[]): WorkspaceDiagnostic[] {
    return [...diags].sort((a, b) => {
        if (a.file !== b.file) return a.file.localeCompare(b.file);
        if (a.line !== b.line) return a.line - b.line;
        return a.startCol - b.startCol;
    });
}

/**
 * Validate an MCNP project (root deck + read/copy includes).
 */
export function validateMcnpProject(options: ValidateMcnpProjectOptions): ValidationResult {
    const rootPath = path.resolve(options.rootPath);
    const graph = buildIncludeGraph(rootPath);
    const diags: WorkspaceDiagnostic[] = [...graph.errors];

    const fileTexts = new Map(graph.files);
    if (options.fileOverrides) {
        for (const [file, text] of options.fileOverrides) {
            fileTexts.set(path.resolve(file), text);
        }
    }

    const symbolIndex = buildSymbolIndex(fileTexts);

    // Duplicate definitions across files.
    for (const [key, defs] of symbolIndex.definitions) {
        if (defs.length <= 1) continue;
        const kind = defs[0].kind;
        if (!DUPLICATE_KINDS.includes(kind)) continue;
        const id = defs[0].id;
        for (const def of defs) {
            const others = defs.filter((d) => d.file !== def.file).map((d) => path.basename(d.file));
            diags.push({
                file: def.file,
                line: def.line,
                startCol: def.startCol,
                endCol: def.endCol,
                severity: 'error',
                code: `mcnp.duplicate-${kind}`,
                message: `${KIND_LABEL[kind]} ${id} is also defined in: ${others.join(', ')}`,
            });
        }
    }

    // Project-wide undefined references.
    const projectDefined = new Set(symbolIndex.definitions.keys());
    const projectReferenced = new Set<string>();
    for (const occ of symbolIndex.occurrences) {
        if (!occ.isDefinition) projectReferenced.add(`${occ.kind}:${occ.id}`);
    }

    const refKinds: McnpEntityKind[] = ['surface', 'material', 'universe', 'transform'];
    for (const occ of symbolIndex.occurrences) {
        if (occ.isDefinition || !refKinds.includes(occ.kind)) continue;
        const key = `${occ.kind}:${occ.id}`;
        if (projectDefined.has(key)) continue;
        const context = occ.cellContext !== undefined ? ` (referenced by cell ${occ.cellContext})` : '';
        diags.push({
            file: occ.file,
            line: occ.line,
            startCol: occ.startCol,
            endCol: occ.endCol,
            severity: 'error',
            code: `mcnp.undefined-${occ.kind}`,
            message: `${KIND_LABEL[occ.kind]} ${occ.id} is referenced${context} but never defined in this project.`,
        });
    }

    if (options.warnUnused) {
        for (const [key, defs] of symbolIndex.definitions) {
            const def = defs[0];
            if (!refKinds.includes(def.kind)) continue;
            if (projectReferenced.has(key)) continue;
            diags.push({
                file: def.file,
                line: def.line,
                startCol: def.startCol,
                endCol: def.endCol,
                severity: 'hint',
                code: `mcnp.unused-${def.kind}`,
                message: `${KIND_LABEL[def.kind]} ${def.id} is defined but never referenced.`,
                unnecessary: true,
            });
        }
    }

    const diagnostics = sortDiags(diags);
    return {
        version: 1,
        root: graph.root,
        files: [...fileTexts.keys()].sort(),
        diagnostics,
        summary: summarize(diagnostics),
    };
}
