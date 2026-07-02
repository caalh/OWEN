// Per-document MCNP reference-index cache.
//
// The hover / definition / references / highlight providers that used to live
// here were replaced by the MC language server (src/server/, bundled to
// out/server.js) — the LSP serves the same data from the same index. What
// remains client-side is this cache, used by the MCNP References tree view
// (referencesView.ts), which is a UI feature rather than a language feature.

import * as vscode from 'vscode';
import { McnpReferenceIndex, buildMcnpReferenceIndex } from './mcnpReferences';

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

export function registerMcnpIndexCache(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument((d) => cache.delete(d.uri.toString())),
    );
}
