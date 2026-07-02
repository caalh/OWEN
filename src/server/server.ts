/**
 * The MC language server: diagnostics + language features for MCNP, Serpent
 * and SCONE over LSP. Transport-agnostic — `main.ts` wires it to IPC/stdio
 * for production and the test suite wires it to in-memory streams.
 *
 * Diagnostics = shared rules layer (src/language/rules.ts — the same code the
 * manual validate command uses) plus, for MCNP, cross-reference diagnostics
 * from the references index (undefined surface/material/universe → error,
 * unused definitions → hint tagged unnecessary).
 *
 * Language features (MCNP, all backed by src/references/mcnpReferences.ts):
 * hover, go-to-definition, find-references, document highlight, document
 * symbols. Serpent/SCONE get regex-outline document symbols.
 */

import {
    Connection,
    Diagnostic,
    DiagnosticSeverity,
    DiagnosticTag,
    DocumentHighlight,
    DocumentHighlightKind,
    DocumentSymbol,
    Hover,
    InitializeParams,
    InitializeResult,
    Location,
    MarkupKind,
    TextDocuments,
    TextDocumentSyncKind,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { mcnpCrossReferenceDiagnostics } from '../language/crossReference';
import { runLanguageRules } from '../language/rules';
import { PlainDiagnostic, RulesLanguage } from '../language/types';
import {
    buildMcnpReferenceIndex,
    describeEntity,
    getDefinition,
    getHighlightOccurrences,
    getReferences,
    McnpReferenceIndex,
    resolveAt,
} from '../references/mcnpReferences';
import { buildDocumentSymbols } from './symbols';

const VALIDATION_DEBOUNCE_MS = 300;

const SEVERITY: Record<PlainDiagnostic['severity'], DiagnosticSeverity> = {
    error: DiagnosticSeverity.Error,
    warning: DiagnosticSeverity.Warning,
    information: DiagnosticSeverity.Information,
    hint: DiagnosticSeverity.Hint,
};

/** languageId → rules language. OpenMC/.py stays client-side (Pylance owns it). */
function rulesLanguage(languageId: string): RulesLanguage | null {
    if (languageId === 'mcnp' || languageId === 'serpent' || languageId === 'scone') {
        return languageId;
    }
    return null;
}

function toLspDiagnostic(d: PlainDiagnostic): Diagnostic {
    const diag: Diagnostic = {
        range: {
            start: { line: d.line, character: d.startCol },
            end: { line: d.line, character: d.endCol },
        },
        message: d.message,
        severity: SEVERITY[d.severity],
        source: 'owen',
        code: d.code,
    };
    if (d.unnecessary) diag.tags = [DiagnosticTag.Unnecessary];
    return diag;
}

export interface ServerOptions {
    /** For tests: skip the debounce so diagnostics publish synchronously. */
    validationDebounceMs?: number;
}

export function startLanguageServer(connection: Connection, options: ServerOptions = {}): void {
    const documents = new TextDocuments(TextDocument);
    const debounceMs = options.validationDebounceMs ?? VALIDATION_DEBOUNCE_MS;

    let mcnpLineLimit: number | undefined;

    // Per-document MCNP index cache, invalidated by document version.
    const indexCache = new Map<string, { version: number; index: McnpReferenceIndex }>();
    const pendingValidation = new Map<string, ReturnType<typeof setTimeout>>();

    const indexFor = (doc: TextDocument): McnpReferenceIndex => {
        const hit = indexCache.get(doc.uri);
        if (hit && hit.version === doc.version) return hit.index;
        const index = buildMcnpReferenceIndex(doc.getText());
        indexCache.set(doc.uri, { version: doc.version, index });
        return index;
    };

    connection.onInitialize((params: InitializeParams): InitializeResult => {
        const init = params.initializationOptions as { mcnpLineLimit?: number } | undefined;
        if (init && typeof init.mcnpLineLimit === 'number') {
            mcnpLineLimit = init.mcnpLineLimit;
        }
        return {
            capabilities: {
                textDocumentSync: TextDocumentSyncKind.Incremental,
                hoverProvider: true,
                definitionProvider: true,
                referencesProvider: true,
                documentHighlightProvider: true,
                documentSymbolProvider: true,
            },
        };
    });

    connection.onDidChangeConfiguration((change) => {
        const settings = change.settings as { owen?: { mcnp?: { lineLengthLimit?: number } } } | undefined;
        const limit = settings?.owen?.mcnp?.lineLengthLimit;
        if (typeof limit === 'number' && limit > 0) mcnpLineLimit = limit;
        for (const doc of documents.all()) scheduleValidation(doc);
    });

    function computeDiagnostics(doc: TextDocument): Diagnostic[] {
        const lang = rulesLanguage(doc.languageId);
        if (!lang) return [];
        const text = doc.getText();
        const plain = runLanguageRules(lang, text, { mcnpLineLimit });
        if (lang === 'mcnp') {
            plain.push(...mcnpCrossReferenceDiagnostics(text, indexFor(doc)));
        }
        return plain.map(toLspDiagnostic);
    }

    function scheduleValidation(doc: TextDocument): void {
        const existing = pendingValidation.get(doc.uri);
        if (existing) clearTimeout(existing);
        pendingValidation.set(
            doc.uri,
            setTimeout(() => {
                pendingValidation.delete(doc.uri);
                // The document may have been closed while the timer was pending.
                const current = documents.get(doc.uri);
                if (!current) return;
                void connection.sendDiagnostics({
                    uri: current.uri,
                    version: current.version,
                    diagnostics: computeDiagnostics(current),
                });
            }, debounceMs),
        );
    }

    documents.onDidOpen((e) => scheduleValidation(e.document));
    documents.onDidChangeContent((e) => scheduleValidation(e.document));
    documents.onDidClose((e) => {
        const timer = pendingValidation.get(e.document.uri);
        if (timer) clearTimeout(timer);
        pendingValidation.delete(e.document.uri);
        indexCache.delete(e.document.uri);
        void connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
    });

    // --- MCNP language features (references index) ---------------------------

    connection.onHover((params): Hover | null => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc || doc.languageId !== 'mcnp') return null;
        const index = indexFor(doc);
        const occ = resolveAt(index, params.position.line, params.position.character);
        if (!occ) return null;
        return {
            contents: { kind: MarkupKind.Markdown, value: describeEntity(index, occ) },
            range: {
                start: { line: occ.line, character: occ.startCol },
                end: { line: occ.line, character: occ.endCol },
            },
        };
    });

    connection.onDefinition((params): Location | null => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc || doc.languageId !== 'mcnp') return null;
        const index = indexFor(doc);
        const occ = resolveAt(index, params.position.line, params.position.character);
        if (!occ) return null;
        const def = getDefinition(index, occ.kind, occ.id);
        if (!def) return null;
        return {
            uri: doc.uri,
            range: {
                start: { line: def.line, character: def.startCol },
                end: { line: def.line, character: def.endCol },
            },
        };
    });

    connection.onReferences((params): Location[] => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc || doc.languageId !== 'mcnp') return [];
        const index = indexFor(doc);
        const occ = resolveAt(index, params.position.line, params.position.character);
        if (!occ) return [];
        return getReferences(index, occ.kind, occ.id, params.context.includeDeclaration).map((r) => ({
            uri: doc.uri,
            range: {
                start: { line: r.line, character: r.startCol },
                end: { line: r.line, character: r.endCol },
            },
        }));
    });

    connection.onDocumentHighlight((params): DocumentHighlight[] => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc || doc.languageId !== 'mcnp') return [];
        const index = indexFor(doc);
        const refs = getHighlightOccurrences(index, params.position.line, params.position.character);
        return refs.map((r) => ({
            range: {
                start: { line: r.line, character: r.startCol },
                end: { line: r.line, character: r.endCol },
            },
            kind: r.isDefinition ? DocumentHighlightKind.Write : DocumentHighlightKind.Read,
        }));
    });

    connection.onDocumentSymbol((params): DocumentSymbol[] => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return [];
        const lang = rulesLanguage(doc.languageId);
        if (!lang) return [];
        return buildDocumentSymbols(lang, doc.getText(), lang === 'mcnp' ? indexFor(doc) : undefined);
    });

    documents.listen(connection);
    connection.listen();
}
