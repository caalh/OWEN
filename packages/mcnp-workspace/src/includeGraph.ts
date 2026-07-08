import * as fs from 'fs';
import * as path from 'path';
import { IncludeEdge, IncludeGraphResult, WorkspaceDiagnostic } from './types';

export const MAX_INCLUDE_DEPTH = 32;

interface Card {
    text: string;
    firstLine: number;
    spans: { token: string; line: number; startCol: number; endCol: number }[];
}

function buildCards(text: string): Card[] {
    const lines = text.split(/\r?\n/);
    const cards: Card[] = [];
    let cur: Card | null = null;

    const flush = () => {
        if (cur && cur.text.trim()) cards.push(cur);
        cur = null;
    };

    const append = (card: Card, lineText: string, lineNo: number) => {
        for (let k = 0; k < lineText.length; k++) {
            card.text += lineText[k];
        }
        const tokens = lineText.trim().split(/\s+/).filter(Boolean);
        let col = 0;
        for (const raw of lineText.split(/(\s+)/)) {
            if (raw.trim()) {
                card.spans.push({ token: raw.trim(), line: lineNo, startCol: col, endCol: col + raw.length });
            }
            col += raw.length;
        }
        void tokens;
    };

    for (let li = 0; li < lines.length; li++) {
        const raw = lines[li];
        const dollar = raw.indexOf('$');
        const stripped = dollar >= 0 ? raw.slice(0, dollar) : raw;
        if (stripped.trim() === '') { flush(); continue; }
        if (/^\s{0,4}c(\s|$)/i.test(raw)) continue;

        const prevEndsAmp = cur ? /&\s*$/.test(cur.text) : false;
        const isCont = /^\s+\S/.test(raw) || prevEndsAmp;
        if (isCont && cur) {
            cur.text += ' ';
            append(cur, stripped, li);
        } else {
            flush();
            cur = { text: '', firstLine: li, spans: [] };
            append(cur, stripped, li);
        }
    }
    flush();
    return cards;
}

function extractIncludeTargets(card: Card): { kind: 'read' | 'copy'; target: string; line: number; startCol: number; endCol: number }[] {
    const toks = card.text.trim().split(/\s+/);
    if (toks.length === 0) return [];
    const head = toks[0].toLowerCase();
    if (head !== 'read' && head !== 'copy') return [];

    const out: { kind: 'read' | 'copy'; target: string; line: number; startCol: number; endCol: number }[] = [];
    for (let i = 1; i < toks.length; i++) {
        const tok = toks[i];
        if (/^\d+$/.test(tok)) continue;
        const idx = card.text.indexOf(tok, i === 1 ? card.text.toLowerCase().indexOf(head) + head.length : undefined);
        const span = card.spans.find((s) => s.token === tok && s.line >= card.firstLine);
        out.push({
            kind: head as 'read' | 'copy',
            target: tok,
            line: span?.line ?? card.firstLine,
            startCol: span?.startCol ?? 0,
            endCol: span?.endCol ?? tok.length,
        });
    }
    return out;
}

function resolveIncludePath(fromFile: string, target: string): string {
    const base = path.dirname(fromFile);
    const cleaned = target.replace(/^["']|["']$/g, '');
    return path.normalize(path.resolve(base, cleaned));
}

function readFileUtf8(filePath: string): string {
    return fs.readFileSync(filePath, 'utf8');
}

/**
 * Resolve MCNP read/copy includes from a root deck. Detects missing files,
 * cycles, and depth > MAX_INCLUDE_DEPTH.
 */
export function buildIncludeGraph(rootPath: string): IncludeGraphResult {
    const root = path.resolve(rootPath);
    const files = new Map<string, string>();
    const edges: IncludeEdge[] = [];
    const errors: WorkspaceDiagnostic[] = [];

    if (!fs.existsSync(root)) {
        errors.push({
            file: root,
            line: 0,
            startCol: 0,
            endCol: 1,
            severity: 'error',
            code: 'mcnp.include-not-found',
            message: `Root deck not found: ${root}`,
        });
        return { root, files, edges, errors };
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();

    const walk = (filePath: string, depth: number, stack: string[]) => {
        const abs = path.resolve(filePath);
        if (depth > MAX_INCLUDE_DEPTH) {
            errors.push({
                file: abs,
                line: 0,
                startCol: 0,
                endCol: 1,
                severity: 'error',
                code: 'mcnp.include-depth',
                message: `Include depth exceeds ${MAX_INCLUDE_DEPTH} (chain: ${stack.join(' → ')})`,
            });
            return;
        }
        if (visiting.has(abs)) {
            const cycleStart = stack.indexOf(abs);
            const cycle = cycleStart >= 0 ? stack.slice(cycleStart).concat(abs) : stack.concat(abs);
            errors.push({
                file: abs,
                line: 0,
                startCol: 0,
                endCol: 1,
                severity: 'error',
                code: 'mcnp.include-cycle',
                message: `Include cycle detected: ${cycle.join(' → ')}`,
            });
            return;
        }
        if (visited.has(abs)) return;

        visiting.add(abs);
        let text: string;
        try {
            text = readFileUtf8(abs);
        } catch {
            errors.push({
                file: abs,
                line: 0,
                startCol: 0,
                endCol: 1,
                severity: 'error',
                code: 'mcnp.include-not-found',
                message: `Cannot read include file: ${abs}`,
            });
            visiting.delete(abs);
            return;
        }
        files.set(abs, text);

        for (const card of buildCards(text)) {
            for (const inc of extractIncludeTargets(card)) {
                const target = resolveIncludePath(abs, inc.target);
                edges.push({
                    from: abs,
                    to: target,
                    line: inc.line,
                    startCol: inc.startCol,
                    endCol: inc.endCol,
                    kind: inc.kind,
                });
                if (!fs.existsSync(target)) {
                    errors.push({
                        file: abs,
                        line: inc.line,
                        startCol: inc.startCol,
                        endCol: inc.endCol,
                        severity: 'error',
                        code: 'mcnp.include-not-found',
                        message: `Include file not found: ${inc.target} (resolved to ${target})`,
                    });
                    continue;
                }
                walk(target, depth + 1, stack.concat(abs));
            }
        }

        visiting.delete(abs);
        visited.add(abs);
    };

    walk(root, 0, []);
    return { root, files, edges, errors };
}
