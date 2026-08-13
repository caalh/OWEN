// Live smoke test for the split-screen Input Builder.
//
// The panel's UI is a single injected script, so a typo in it fails silently:
// the webview simply stops posting. These tests boot the real HTML in the test
// instance's webview and drive the same round trips the panel does — the
// webview must announce itself, hand over a model the host can assemble, accept
// the assembled document back, and never report a client-side error.

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { inputBuilderWebviewHtml } from '../../panels/inputBuilderWebview';
import { MATERIAL_LIBRARY } from '../../inputBuilder/materials';
import { SAB_OPTIONS, SURFACE_TEMPLATES } from '../../inputBuilder/wizards';
import { buildDeckDocument, type DeckModel } from '../../inputBuilder/deckModel';
import { checkDeck, summarizeChecks } from '../../inputBuilder/deckChecks';

interface HostMessage { command: string; [k: string]: unknown }

/** Same payload the panel injects, so the test exercises the shipped script. */
function injectedScript(): string {
    return [
        `const MATERIAL_LIBRARY = ${JSON.stringify(MATERIAL_LIBRARY)};`,
        `const SAB_OPTIONS = ${JSON.stringify(SAB_OPTIONS)};`,
        `const SURFACE_TEMPLATES = ${JSON.stringify(SURFACE_TEMPLATES)};`,
    ].join('\n');
}

function waitFor(
    seen: HostMessage[],
    predicate: (seen: HostMessage[]) => boolean,
    what: string,
    ms = 15000,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const tick = setInterval(() => {
            if (predicate(seen)) {
                clearInterval(tick);
                resolve();
            } else if (Date.now() - started > ms) {
                clearInterval(tick);
                const got = seen.map((m) => m.command).join(', ') || '(nothing)';
                reject(new Error(`timed out waiting for ${what}; webview posted: ${got}`));
            }
        }, 50);
    });
}

suite('Input Builder — live webview', () => {
    let panel: vscode.WebviewPanel | undefined;

    teardown(() => {
        panel?.dispose();
        panel = undefined;
    });

    test('boots, posts a model, accepts the assembled document, no client errors', async () => {
        panel = vscode.window.createWebviewPanel(
            'owen.test.inputBuilder', 'Input Builder test', vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true },
        );
        const seen: HostMessage[] = [];
        panel.webview.onDidReceiveMessage((m: HostMessage) => seen.push(m));
        panel.webview.html = inputBuilderWebviewHtml(injectedScript(), MATERIAL_LIBRARY.length);

        await waitFor(seen,
            (s) => s.some((m) => m.command === 'ready') && s.some((m) => m.command === 'model'),
            'the initial ready + model handshake');

        const first = seen.find((m) => m.command === 'model');
        assert.ok(first, 'no model message');
        const model = first!.model as DeckModel;
        assert.ok(Array.isArray(model.sections) && model.sections.length > 0, 'default model has sections');
        assert.ok(['mcnp', 'openmc', 'serpent', 'scone'].includes(model.code), `unexpected code '${model.code}'`);

        // The host's half of the round trip, exactly as the panel does it.
        const doc = buildDeckDocument(model);
        const checks = checkDeck(model, doc);
        await panel.webview.postMessage({
            command: 'document',
            text: doc.text, lines: doc.lines, owners: doc.owners,
            sections: doc.sections, counts: doc.counts,
            checks, summary: summarizeChecks(checks),
        });

        // A render failure surfaces as clientError now rather than a dead panel.
        await new Promise((r) => setTimeout(r, 600));
        const failed = seen.filter((m) => m.command === 'clientError');
        assert.strictEqual(failed.length, 0,
            `webview reported errors: ${failed.map((m) => m.message).join(' | ')}`);
    });

    test('focusSection adds a lattice, re-posts the model, and acknowledges', async () => {
        panel = vscode.window.createWebviewPanel(
            'owen.test.inputBuilder2', 'Input Builder focus test', vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true },
        );
        const seen: HostMessage[] = [];
        panel.webview.onDidReceiveMessage((m: HostMessage) => seen.push(m));
        panel.webview.html = inputBuilderWebviewHtml(injectedScript(), MATERIAL_LIBRARY.length);
        await waitFor(seen, (s) => s.some((m) => m.command === 'ready'), 'ready');

        await panel.webview.postMessage({ command: 'focusSection', tab: 'lattice' });
        // Model posts are debounced, so wait for both halves of the response.
        await waitFor(seen,
            (s) => s.some((m) => m.command === 'focusAck') && s.some((m) => m.command === 'model'),
            'focusAck plus the re-posted model');

        const last = [...seen].reverse().find((m) => m.command === 'model');
        assert.ok(last, 'no model message after focusSection');
        const focused = last!.model as DeckModel;
        assert.ok(focused.sections.some((s) => s.kind === 'lattice'),
            'focusing the lattice tab should leave a lattice section in the model');
        assert.strictEqual(seen.filter((m) => m.command === 'clientError').length, 0);
    });

    test('every command the webview sends is handled by the panel', () => {
        // Cheap guard against the two files drifting apart: the webview script is
        // a string, so a renamed command would otherwise fail only at runtime.
        const webviewSrc = inputBuilderWebviewHtml(injectedScript(), MATERIAL_LIBRARY.length);
        const sent = new Set<string>();
        for (const m of webviewSrc.matchAll(/postMessage\(\{\s*command:\s*'([a-zA-Z]+)'/g)) sent.add(m[1]);
        assert.ok(sent.size >= 6, `expected several commands, found ${[...sent].join(', ')}`);

        const hostSrc = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', '..', 'src', 'panels', 'inputBuilder.ts'), 'utf8');
        for (const command of sent) {
            assert.ok(hostSrc.includes(`case '${command}'`), `panel has no handler for '${command}'`);
        }
    });
});
