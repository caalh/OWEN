import {
    buildMcnpReferenceIndex,
    EntityDefinition,
    McnpEntityKind,
    McnpReferenceIndex,
    Occurrence,
} from './mcnpReferences';

export interface FileSymbolIndex {
    file: string;
    index: McnpReferenceIndex;
}

export interface LocatedDefinition extends EntityDefinition {
    file: string;
}

export interface LocatedOccurrence extends Occurrence {
    file: string;
}

export interface SymbolIndex {
    files: FileSymbolIndex[];
    definitions: Map<string, LocatedDefinition[]>;
    occurrences: LocatedOccurrence[];
}

const defKey = (kind: McnpEntityKind, id: number) => `${kind}:${id}`;

/** Build a project-wide symbol index from parsed file contents. */
export function buildSymbolIndex(fileTexts: Map<string, string>): SymbolIndex {
    const files: FileSymbolIndex[] = [];
    const definitions = new Map<string, LocatedDefinition[]>();
    const occurrences: LocatedOccurrence[] = [];

    for (const [file, text] of fileTexts) {
        const index = buildMcnpReferenceIndex(text);
        files.push({ file, index });

        for (const def of index.definitions.values()) {
            const key = defKey(def.kind, def.id);
            const located: LocatedDefinition = { ...def, file };
            const list = definitions.get(key) ?? [];
            list.push(located);
            definitions.set(key, list);
        }

        for (const occ of index.occurrences) {
            occurrences.push({ ...occ, file });
        }
    }

    return { files, definitions, occurrences };
}

export function getProjectDefinition(
    symbolIndex: SymbolIndex,
    kind: McnpEntityKind,
    id: number,
): LocatedDefinition | undefined {
    const list = symbolIndex.definitions.get(defKey(kind, id));
    return list?.[0];
}

export function getProjectReferences(
    symbolIndex: SymbolIndex,
    kind: McnpEntityKind,
    id: number,
    includeDefinition: boolean,
): LocatedOccurrence[] {
    return symbolIndex.occurrences.filter(
        (o) => o.kind === kind && o.id === id && (includeDefinition || !o.isDefinition),
    );
}
