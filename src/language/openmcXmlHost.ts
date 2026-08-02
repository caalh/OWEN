/**
 * VS Code wiring for the OpenMC XML validator (openmcXml.ts) — live
 * diagnostics on materials.xml / geometry.xml / settings.xml / tallies.xml /
 * model.xml. These files carry languageId "xml", which the MC language server
 * never sees, so the extension host owns this collection directly.
 *
 * Cross-file: geometry.xml cell material= references are checked against a
 * sibling materials.xml when one exists next to the file on disk.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import {
    detectOpenmcXmlKind, validateOpenmcXml, OpenmcXmlContext,
} from './openmcXml';
import { PlainDiagnostic } from './types';

const SEVERITY: Record<PlainDiagnostic['severity'], vscode.DiagnosticSeverity> = {
    error: vscode.DiagnosticSeverity.Error,
    warning: vscode.DiagnosticSeverity.Warning,
    information: vscode.DiagnosticSeverity.Information,
    hint: vscode.DiagnosticSeverity.Hint,
};

const DEBOUNCE_MS = 400;

export function registerOpenmcXmlDiagnostics(context: vscode.ExtensionContext): void {
    const collection = vscode.languages.createDiagnosticCollection('owen-openmc-xml');
    const timers = new Map<string, NodeJS.Timeout>();

    const validate = async (doc: vscode.TextDocument): Promise<void> => {
        if (doc.languageId !== 'xml') return;
        const text = doc.getText();
        const kind = detectOpenmcXmlKind(text);
        if (!kind) {
            collection.delete(doc.uri);
            return;
        }

        const ctx: OpenmcXmlContext = {};
        if (kind === 'geometry' && doc.uri.scheme === 'file') {
            const sibling = vscode.Uri.file(path.join(path.dirname(doc.uri.fsPath), 'materials.xml'));
            try {
                const bytes = await vscode.workspace.fs.readFile(sibling);
                const matText = Buffer.from(bytes).toString('utf8');
                const ids = new Set<string>();
                const re = /<material\b[^>]*?\bid\s*=\s*["']([^"']+)["']/g;
                let m: RegExpExecArray | null;
                while ((m = re.exec(matText)) !== null) ids.add(m[1]);
                if (ids.size > 0) ctx.materialIds = ids;
            } catch {
                // No sibling materials.xml — skip the cross-file check.
            }
        }

        const diags = validateOpenmcXml(kind, text, ctx).map((d) => {
            const diag = new vscode.Diagnostic(
                new vscode.Range(d.line, d.startCol, d.line, d.endCol),
                d.message,
                SEVERITY[d.severity],
            );
            diag.source = 'owen';
            diag.code = d.code;
            return diag;
        });
        collection.set(doc.uri, diags);
    };

    const scheduleValidate = (doc: vscode.TextDocument): void => {
        const key = doc.uri.toString();
        const prior = timers.get(key);
        if (prior) clearTimeout(prior);
        timers.set(key, setTimeout(() => {
            timers.delete(key);
            void validate(doc);
        }, DEBOUNCE_MS));
    };

    context.subscriptions.push(
        collection,
        vscode.workspace.onDidOpenTextDocument((doc) => void validate(doc)),
        vscode.workspace.onDidChangeTextDocument((e) => scheduleValidate(e.document)),
        vscode.workspace.onDidCloseTextDocument((doc) => collection.delete(doc.uri)),
        { dispose: () => timers.forEach((t) => clearTimeout(t)) },
    );

    for (const doc of vscode.workspace.textDocuments) void validate(doc);
}
