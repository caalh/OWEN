// The panels' UI is JavaScript embedded in a TypeScript template literal, so an
// escaping mistake is invisible until someone opens the panel and it silently
// does nothing. These tests parse the emitted script instead of running it.

import * as assert from 'assert';
import * as vscode from 'vscode';
import { buildPreviewHtml } from '../../preview/webview';
import { inputBuilderWebviewHtml } from '../../panels/inputBuilderWebview';

interface ScriptBlock { attrs: string; body: string }

/** Every <script> body in the document, in order. */
function scripts(html: string): ScriptBlock[] {
    return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
        .map((m) => ({ attrs: m[1], body: m[2] }))
        .filter((s) => s.body.trim().length > 0);
}

function assertParses(block: ScriptBlock, what: string): void {
    if (/type\s*=\s*"importmap"/.test(block.attrs)) {
        try {
            JSON.parse(block.body);
        } catch (err) {
            assert.fail(`${what} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
        }
        return;
    }
    // A module's top-level imports cannot appear in a function body; drop them
    // and parse the rest, which is where the template escaping lives anyway.
    const source = block.body.replace(/^\s*import\b[^\n;]*;?\s*$/gm, '');
    try {
        // Parse-only: never invoked, so nothing touches document or window.
        new Function(source);
    } catch (err) {
        assert.fail(`${what} does not parse: ${err instanceof Error ? err.message : String(err)}`);
    }
}

suite('Webview scripts parse', () => {
    test('the geometry preview script is syntactically valid', () => {
        // A webview is only needed for cspSource; a stub is enough.
        const stub = { cspSource: 'vscode-resource:' } as unknown as vscode.Webview;
        const html = buildPreviewHtml(stub);
        const bodies = scripts(html);
        assert.ok(bodies.length > 0, 'expected at least one script block');
        bodies.forEach((s, i) => assertParses(s, `geometry preview script #${i + 1}`));
        assert.ok(html.includes('Math.min(8, next)'), '2D slice zoom must be allowed past the fitted window');
        assert.ok(html.includes('function zoomLabel'), 'zoom label distinguishes in vs out');
    });

    test('the Input Builder script is syntactically valid', () => {
        const html = inputBuilderWebviewHtml('const MATERIAL_LIBRARY = [];', 0);
        const bodies = scripts(html);
        assert.ok(bodies.length > 0, 'expected at least one script block');
        bodies.forEach((s, i) => assertParses(s, `input builder script #${i + 1}`));
    });
});
