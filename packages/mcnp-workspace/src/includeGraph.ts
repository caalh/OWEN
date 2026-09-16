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

/** Keywords on an MCNP READ card that are not filenames (LA-UR-22-30006 §4.5). */
const READ_KEYWORDS = new Set(['file', 'echo', 'noecho', 'encode', 'decode']);

/**
 * Filenames named by an MCNP `read` / `copy` card.
 *
 * MCNP 6.3 accepts `read file=foo.i`, `read file = foo.i`, `read file foo.i`,
 * and the older `read foo.i`. Splitting on whitespace and treating every
 * leftover token as a path made `file` in `read file = material_card.i` look
 * like a missing include (caalh/owen#6).
 */
export function parseMcnpReadTargets(cardText: string): string[] {
    const trimmed = cardText.trim();
    if (!trimmed) return [];
    const head = trimmed.split(/\s+/, 1)[0]?.toLowerCase();
    if (head !== 'read' && head !== 'copy') return [];

    const targets: string[] = [];
    const fileEq = /\bfile\s*=\s*(?:"([^"]+)"|'([^']+)'|(\S+))/ig;
    let m: RegExpExecArray | null;
    while ((m = fileEq.exec(trimmed)) !== null) {
        const t = (m[1] ?? m[2] ?? m[3]).replace(/,$/, '');
        if (t) targets.push(t);
    }
    if (targets.length > 0) return uniq(targets);

    const fileSp = /\bfile\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i.exec(trimmed);
    if (fileSp) {
        const t = fileSp[1] ?? fileSp[2] ?? fileSp[3];
        if (t && t !== '=' && !READ_KEYWORDS.has(t.toLowerCase())) return [t];
    }

    const toks = trimmed.split(/\s+/);
    for (let i = 1; i < toks.length; i++) {
        const tok = toks[i];
        if (tok === '=' || /^\d+$/.test(tok)) continue;
        const eq = tok.indexOf('=');
        if (eq > 0) {
            const key = tok.slice(0, eq).toLowerCase();
            const val = tok.slice(eq + 1).replace(/^["']|["']$/g, '');
            if (READ_KEYWORDS.has(key)) {
                if (key === 'file' && val) targets.push(val);
                continue;
            }
        }
        const bare = tok.replace(/^["']|["']$/g, '');
        if (READ_KEYWORDS.has(bare.toLowerCase())) continue;
        targets.push(bare);
    }
    return uniq(targets);
}

function uniq(xs: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const x of xs) {
        if (seen.has(x)) continue;
        seen.add(x);
        out.push(x);
    }
    return out;
}

function locateTargetSpan(card: Card, target: string): { line: number; startCol: number; endCol: number } {
    for (const s of card.spans) {
        const t = s.token.replace(/^["']|["']$/g, '');
        if (t === target || t.endsWith('=' + target) || t.toLowerCase() === 'file=' + target) {
            return { line: s.line, startCol: s.startCol, endCol: s.endCol };
        }
    }
    return { line: card.firstLine, startCol: 0, endCol: Math.max(1, target.length) };
}

function extractIncludeTargets(card: Card): { kind: 'read' | 'copy'; target: string; line: number; startCol: number; endCol: number }[] {
    const toks = card.text.trim().split(/\s+/);
    if (toks.length === 0) return [];
    const head = toks[0].toLowerCase();
    if (head !== 'read' && head !== 'copy') return [];
    return parseMcnpReadTargets(card.text).map((target) => {
        const span = locateTargetSpan(card, target);
        return { kind: head as 'read' | 'copy', target, ...span };
    });
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
