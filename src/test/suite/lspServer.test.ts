/**
 * In-process LSP tests: start the real server (src/server/server.ts) on
 * in-memory streams, drive it with a raw JSON-RPC client connection
 * (initialize → didOpen → …), and assert on the published diagnostics and
 * language-feature responses. No child process, no editor host.
 */
import * as assert from 'assert';
import { PassThrough } from 'stream';
import {
    createProtocolConnection,
    DefinitionRequest,
    DidOpenTextDocumentNotification,
    DocumentSymbolRequest,
    HoverRequest,
    InitializedNotification,
    InitializeRequest,
    Location,
    ProtocolConnection,
    PublishDiagnosticsNotification,
    PublishDiagnosticsParams,
    ReferencesRequest,
    StreamMessageReader,
    StreamMessageWriter,
} from 'vscode-languageserver-protocol/node';
import { createConnection } from 'vscode-languageserver/node';
import { startLanguageServer } from '../../server/server';

interface TestHarness {
    client: ProtocolConnection;
    diagnostics: Map<string, PublishDiagnosticsParams>;
    waitForDiagnostics(uri: string): Promise<PublishDiagnosticsParams>;
    dispose(): void;
}

async function startHarness(): Promise<TestHarness> {
    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();

    const serverConnection = createConnection(
        new StreamMessageReader(clientToServer),
        new StreamMessageWriter(serverToClient),
    );
    startLanguageServer(serverConnection, { validationDebounceMs: 1 });

    const client = createProtocolConnection(
        new StreamMessageReader(serverToClient),
        new StreamMessageWriter(clientToServer),
    );

    const diagnostics = new Map<string, PublishDiagnosticsParams>();
    const waiters = new Map<string, ((p: PublishDiagnosticsParams) => void)[]>();
    client.onNotification(PublishDiagnosticsNotification.type, (params) => {
        diagnostics.set(params.uri, params);
        for (const w of waiters.get(params.uri) ?? []) w(params);
        waiters.delete(params.uri);
    });
    client.listen();

    await client.sendRequest(InitializeRequest.type, {
        processId: null,
        rootUri: null,
        capabilities: {},
        initializationOptions: { mcnpLineLimit: 80 },
    });
    await client.sendNotification(InitializedNotification.type, {});

    return {
        client,
        diagnostics,
        waitForDiagnostics(uri: string): Promise<PublishDiagnosticsParams> {
            const hit = diagnostics.get(uri);
            if (hit) return Promise.resolve(hit);
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error(`no diagnostics for ${uri} within 5s`)), 5000);
                const list = waiters.get(uri) ?? [];
                list.push((p) => { clearTimeout(timer); resolve(p); });
                waiters.set(uri, list);
            });
        },
        dispose(): void {
            client.dispose();
            serverConnection.dispose();
        },
    };
}

async function openDoc(h: TestHarness, uri: string, languageId: string, text: string): Promise<void> {
    await h.client.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: { uri, languageId, version: 1, text },
    });
}

const PIN_DECK = [
    '1 1 -10.4 -1 imp:n=1',
    '2 0        1 -2 imp:n=1',
    '3 0        2 imp:n=0',
    '',
    '1 cz 0.4096',
    '2 cz 0.475',
    '',
    'm1 92235.80c 0.04 92238.80c 0.96 8016.80c 2.0',
    'mt1 lwtr.20t',
].join('\n');

suite('LSP server — in-process', () => {
    let h: TestHarness;

    setup(async () => {
        h = await startHarness();
    });

    teardown(() => {
        h.dispose();
    });

    test('didOpen on an MCNP deck publishes rule + cross-reference diagnostics', async () => {
        const uri = 'file:///deck.i';
        await openDoc(h, uri, 'mcnp', PIN_DECK);
        const params = await h.waitForDiagnostics(uri);
        const codes = params.diagnostics.map((d) => String(d.code));
        assert.ok(codes.includes('mcnp.sab-no-target'), `expected mcnp.sab-no-target in ${JSON.stringify(codes)}`);
        assert.ok(codes.includes('mcnp.density-sign'));
        assert.ok(params.diagnostics.every((d) => d.source === 'owen'));
    });

    test('undefined surface reference is published as an error', async () => {
        const uri = 'file:///bad.i';
        await openDoc(h, uri, 'mcnp', [
            '1 1 -10.4 -99 imp:n=1',
            '',
            '1 cz 0.4096',
            '',
            'm1 92235.80c 1.0',
        ].join('\n'));
        const params = await h.waitForDiagnostics(uri);
        const d = params.diagnostics.find((x) => x.code === 'mcnp.undefined-surface');
        assert.ok(d, 'expected mcnp.undefined-surface');
        assert.strictEqual(d!.severity, 1 /* Error */);
    });

    test('Serpent and SCONE documents are validated too', async () => {
        await openDoc(h, 'file:///a.serp', 'serpent', 'surf 1 rect -1 1 -1 1');
        const serp = await h.waitForDiagnostics('file:///a.serp');
        assert.ok(serp.diagnostics.some((d) => d.code === 'serpent.surf-rect'));

        await openDoc(h, 'file:///b.scone', 'scone', 'nuclearData { handles { ce { type aceNuclearDatabase; } } }');
        const scone = await h.waitForDiagnostics('file:///b.scone');
        assert.ok(scone.diagnostics.some((d) => d.code === 'scone.ace-typo'));
    });

    test('non-MC languages get no diagnostics', async () => {
        const uri = 'file:///x.py';
        await openDoc(h, uri, 'python', 'import openmc\nsrc = openmc.Source()');
        const params = await h.waitForDiagnostics(uri);
        assert.strictEqual(params.diagnostics.length, 0);
    });

    test('mcnp6.2+ dialect over didChangeConfiguration relaxes the line limit', async () => {
        const long = 'c ' + 'x'.repeat(100); // 102 columns: over 80, under 128
        const uri = 'file:///dialect.i';
        await openDoc(h, uri, 'mcnp', long);
        const before = await h.waitForDiagnostics(uri);
        assert.ok(before.diagnostics.some((d) => d.code === 'mcnp.line-length'),
            'expected an 80-column warning before the dialect switch');

        h.diagnostics.delete(uri);
        await h.client.sendNotification('workspace/didChangeConfiguration', {
            settings: { owen: { mcnp: { dialect: 'mcnp6.2+' } } },
        });
        const after = await h.waitForDiagnostics(uri);
        assert.ok(!after.diagnostics.some((d) => d.code === 'mcnp.line-length'),
            'no line-length warning expected in the 6.2+ dialect');
    });

    test('a file directive wins over the configured dialect', async () => {
        const text = ['c owen: line-limit=90', 'c ' + 'x'.repeat(100)].join('\n');
        const uri = 'file:///directive.i';
        await h.client.sendNotification('workspace/didChangeConfiguration', {
            settings: { owen: { mcnp: { dialect: 'mcnp6.2+' } } },
        });
        await openDoc(h, uri, 'mcnp', text);
        const params = await h.waitForDiagnostics(uri);
        const d = params.diagnostics.find((x) => x.code === 'mcnp.line-length');
        assert.ok(d, 'expected the 90-column directive to flag the 102-column line');
        const msg = typeof d!.message === 'string' ? d!.message : d!.message.value;
        assert.match(msg, /line-limit=90/);
    });

    test('hover on a surface reference describes the surface', async () => {
        const uri = 'file:///hover.i';
        await openDoc(h, uri, 'mcnp', PIN_DECK);
        await h.waitForDiagnostics(uri);
        // Line 0: "1 1 -10.4 -1 imp:n=1" — col 11 is the "1" of "-1" (surface ref).
        const hover = await h.client.sendRequest(HoverRequest.type, {
            textDocument: { uri },
            position: { line: 0, character: 11 },
        });
        assert.ok(hover, 'expected a hover');
        const value = (hover!.contents as { value: string }).value;
        assert.ok(/Surface 1/.test(value), value);
        assert.ok(/cz 0\.4096/.test(value), value);
    });

    test('go-to-definition from a surface reference lands on its card', async () => {
        const uri = 'file:///def.i';
        await openDoc(h, uri, 'mcnp', PIN_DECK);
        await h.waitForDiagnostics(uri);
        const def = (await h.client.sendRequest(DefinitionRequest.type, {
            textDocument: { uri },
            position: { line: 0, character: 11 },
        })) as Location | null;
        assert.ok(def, 'expected a definition');
        assert.strictEqual(def!.range.start.line, 4); // "1 cz 0.4096"
    });

    test('find-references returns every occurrence of the entity', async () => {
        const uri = 'file:///refs.i';
        await openDoc(h, uri, 'mcnp', PIN_DECK);
        await h.waitForDiagnostics(uri);
        const refs = (await h.client.sendRequest(ReferencesRequest.type, {
            textDocument: { uri },
            position: { line: 4, character: 0 }, // definition of surface 1
            context: { includeDeclaration: true },
        })) as Location[];
        // surface 1: definition + refs in cells 1 and 2.
        assert.ok(refs.length >= 3, `expected >=3 references, got ${refs.length}`);
    });

    test('document symbols outline cells/surfaces/materials', async () => {
        const uri = 'file:///sym.i';
        await openDoc(h, uri, 'mcnp', PIN_DECK + '\nf4:n 1\n');
        await h.waitForDiagnostics(uri);
        const symbols = (await h.client.sendRequest(DocumentSymbolRequest.type, {
            textDocument: { uri },
        })) as { name: string; children?: unknown[] }[];
        const names = symbols.map((s) => s.name);
        assert.ok(names.some((n) => n.startsWith('Cells (3')), JSON.stringify(names));
        assert.ok(names.some((n) => n.startsWith('Surfaces (2')));
        assert.ok(names.some((n) => n.startsWith('Materials (1')));
        assert.ok(names.some((n) => n.startsWith('Tallies (1')));
    });
});
