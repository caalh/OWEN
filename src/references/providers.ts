// MCNP language providers backed by the cross-reference index.
//
// Hover, Go-to-Definition, and Find-All-References for cell / surface / material
// / universe numbers in MCNP decks. All three resolve the number under the
// cursor through the position-aware index in `./mcnpReferences.ts`, so hovering
// a `fill=` entry says which universe it is and where that universe is defined.

import * as vscode from 'vscode';
import {
    McnpReferenceIndex,
    buildMcnpReferenceIndex,
    resolveAt,
    getDefinition,
    getReferences,
    describeEntity,
    Occurrence,
} from './mcnpReferences';

const MCNP_SELECTOR: vscode.DocumentSelector = { language: 'mcnp' };

// Per-document index cache keyed by URI, invalidated on version change.
const cache = new Map<string, { version: number; index: McnpReferenceIndex }>();

export function getIndexFor(doc: vscode.TextDocument): McnpReferenceIndex {
    const key = doc.uri.toString();
    const hit = cache.get(key);
    if (hit && hit.version === doc.version) return hit.index;
    const index = buildMcnpReferenceIndex(doc.getText());
    cache.set(key, { version: doc.version, index });
    return index;
}

function spanToRange(occ: Occurrence): vscode.Range {
    return new vscode.Range(occ.line, occ.startCol, occ.line, occ.endCol);
}

class McnpHoverProvider implements vscode.HoverProvider {
    provideHover(doc: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
        const index = getIndexFor(doc);
        const occ = resolveAt(index, position.line, position.character);
        if (!occ) return undefined;
        const md = new vscode.MarkdownString(describeEntity(index, occ));
        md.isTrusted = false;
        return new vscode.Hover(md, spanToRange(occ));
    }
}

class McnpDefinitionProvider implements vscode.DefinitionProvider {
    provideDefinition(doc: vscode.TextDocument, position: vscode.Position): vscode.Definition | undefined {
        const index = getIndexFor(doc);
        const occ = resolveAt(index, position.line, position.character);
        if (!occ) return undefined;
        const def = getDefinition(index, occ.kind, occ.id);
        if (!def) return undefined;
        return new vscode.Location(doc.uri, new vscode.Range(def.line, def.startCol, def.line, def.endCol));
    }
}

class McnpReferenceProvider implements vscode.ReferenceProvider {
    provideReferences(
        doc: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.ReferenceContext,
    ): vscode.Location[] | undefined {
        const index = getIndexFor(doc);
        const occ = resolveAt(index, position.line, position.character);
        if (!occ) return undefined;
        return getReferences(index, occ.kind, occ.id, context.includeDeclaration)
            .map((r) => new vscode.Location(doc.uri, spanToRange(r)));
    }
}

// Replaces VS Code's default word-based occurrence highlight (which lights up
// every matching digit in the file — the "it just finds all the 1s" problem)
// with a role-aware highlight: only the occurrences of THIS entity of THIS kind
// are highlighted. The definition is marked Write, references Read.
class McnpDocumentHighlightProvider implements vscode.DocumentHighlightProvider {
    provideDocumentHighlights(
        doc: vscode.TextDocument,
        position: vscode.Position,
    ): vscode.DocumentHighlight[] | undefined {
        const index = getIndexFor(doc);
        const occ = resolveAt(index, position.line, position.character);
        if (!occ) return undefined;
        return getReferences(index, occ.kind, occ.id, true).map(
            (r) =>
                new vscode.DocumentHighlight(
                    spanToRange(r),
                    r.isDefinition
                        ? vscode.DocumentHighlightKind.Write
                        : vscode.DocumentHighlightKind.Read,
                ),
        );
    }
}

export function registerMcnpReferenceProviders(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(MCNP_SELECTOR, new McnpHoverProvider()),
        vscode.languages.registerDefinitionProvider(MCNP_SELECTOR, new McnpDefinitionProvider()),
        vscode.languages.registerReferenceProvider(MCNP_SELECTOR, new McnpReferenceProvider()),
        vscode.languages.registerDocumentHighlightProvider(MCNP_SELECTOR, new McnpDocumentHighlightProvider()),
        vscode.workspace.onDidCloseTextDocument((d) => cache.delete(d.uri.toString())),
    );
}
