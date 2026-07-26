/**
 * OWEN LSP workspace validation — loads project files and merges diagnostics.
 */

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { validateMcnpProject, WorkspaceDiagnostic } from '../../packages/mcnp-workspace/src';
import { PlainDiagnostic } from '../language/types';

export interface WorkspaceValidationConfig {
    enabled: boolean;
    projectRoot: string;
    warnUnused: boolean;
}

export function resolveProjectRoot(configRoot: string, workspaceRoot?: string): string | null {
    const raw = configRoot.trim();
    if (!raw) return null;
    const resolved = path.isAbsolute(raw) ? raw : workspaceRoot ? path.resolve(workspaceRoot, raw) : null;
    if (!resolved || !fs.existsSync(resolved)) return null;
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
        const candidates = ['main.inp', 'input.inp', 'deck.inp'];
        for (const name of candidates) {
            const p = path.join(resolved, name);
            if (fs.existsSync(p)) return p;
        }
        const inp = fs.readdirSync(resolved).find((f) => f.endsWith('.inp') || f.endsWith('.i'));
        return inp ? path.join(resolved, inp) : null;
    }
    return resolved;
}

export function workspaceDiagnosticsForOpenDocs(
    rootDeck: string,
    openDocs: TextDocument[],
    warnUnused: boolean,
): Map<string, PlainDiagnostic[]> {
    const overrides = new Map<string, string>();
    for (const doc of openDocs) {
        if (doc.uri.startsWith('file:')) {
            overrides.set(path.normalize(fileUriToPath(doc.uri)), doc.getText());
        }
    }

    const result = validateMcnpProject({
        rootPath: rootDeck,
        warnUnused,
        fileOverrides: overrides,
    });

    const byFile = new Map<string, PlainDiagnostic[]>();
    for (const d of result.diagnostics) {
        const list = byFile.get(d.file) ?? [];
        list.push(toPlain(d));
        byFile.set(d.file, list);
    }
    return byFile;
}

function fileUriToPath(uri: string): string {
    return path.normalize(decodeURIComponent(uri.replace(/^file:\/\//, '').replace(/^file:/, '')));
}

function toPlain(d: WorkspaceDiagnostic): PlainDiagnostic {
    return {
        line: d.line,
        startCol: d.startCol,
        endCol: d.endCol,
        message: d.message,
        severity: d.severity === 'hint' ? 'hint' : d.severity,
        code: d.code,
        unnecessary: d.unnecessary,
    };
}

export function pathToUri(filePath: string): string {
    return pathToFileURL(path.resolve(filePath)).href;
}

export function isInProject(filePath: string, projectFiles: string[]): boolean {
    const norm = path.normalize(filePath);
    return projectFiles.some((f) => path.normalize(f) === norm);
}
