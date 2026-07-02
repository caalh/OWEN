/**
 * Document symbols (outline) for the MC language server.
 *
 * MCNP: grouped outline (Cells / Surfaces / Materials / Universes /
 * Transforms + Tallies) built from the references index plus a light tally
 * scan (the index does not track tally cards).
 * Serpent / SCONE: lightweight regex outlines.
 *
 * Pure module (LSP structure types only) — headless-testable.
 */

import { DocumentSymbol, SymbolKind } from 'vscode-languageserver';
import { EntityDefinition, McnpReferenceIndex } from '../references/mcnpReferences';
import { RulesLanguage } from '../language/types';

function span(line: number, startCol: number, endCol: number) {
    return {
        start: { line, character: startCol },
        end: { line, character: endCol },
    };
}

function symbol(
    name: string,
    detail: string,
    kind: SymbolKind,
    line: number,
    startCol: number,
    endCol: number,
    children?: DocumentSymbol[],
): DocumentSymbol {
    const r = span(line, startCol, Math.max(endCol, startCol + 1));
    return { name, detail, kind, range: r, selectionRange: r, children };
}

export function buildDocumentSymbols(
    lang: RulesLanguage,
    text: string,
    mcnpIndex?: McnpReferenceIndex,
): DocumentSymbol[] {
    if (lang === 'mcnp' && mcnpIndex) return mcnpSymbols(text, mcnpIndex);
    if (lang === 'serpent') return serpentSymbols(text);
    if (lang === 'scone') return sconeSymbols(text);
    return [];
}

// ---------------------------------------------------------------------------
// MCNP
// ---------------------------------------------------------------------------

const MCNP_GROUPS: { kind: EntityDefinition['kind']; label: string; symbolKind: SymbolKind }[] = [
    { kind: 'cell', label: 'Cells', symbolKind: SymbolKind.Object },
    { kind: 'surface', label: 'Surfaces', symbolKind: SymbolKind.Interface },
    { kind: 'material', label: 'Materials', symbolKind: SymbolKind.Field },
    { kind: 'universe', label: 'Universes', symbolKind: SymbolKind.Namespace },
    { kind: 'transform', label: 'Transforms', symbolKind: SymbolKind.Operator },
];

const TALLY_RE = /^\s*(\*?f(?:\d+)(?::[a-z,]+)?)\s/i;

function mcnpSymbols(text: string, index: McnpReferenceIndex): DocumentSymbol[] {
    const out: DocumentSymbol[] = [];

    for (const group of MCNP_GROUPS) {
        const defs = [...index.definitions.values()]
            .filter((d) => d.kind === group.kind)
            .sort((a, b) => a.id - b.id);
        if (defs.length === 0) continue;
        const children = defs.map((d) =>
            symbol(`${group.kind} ${d.id}`, d.summary, group.symbolKind, d.line, d.startCol, d.endCol));
        const first = defs[0];
        out.push(symbol(
            `${group.label} (${defs.length})`, '', group.symbolKind,
            first.line, first.startCol, first.endCol, children,
        ));
    }

    // Tallies (fN cards) — not tracked by the references index.
    const tallies: DocumentSymbol[] = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(TALLY_RE);
        if (!m) continue;
        if (/^\s{0,4}c(\s|$)/i.test(lines[i])) continue;
        tallies.push(symbol(m[1].toLowerCase(), lines[i].trim(), SymbolKind.Event, i, 0, lines[i].length));
    }
    if (tallies.length > 0) {
        const first = tallies[0];
        out.push(symbol(
            `Tallies (${tallies.length})`, '', SymbolKind.Event,
            first.range.start.line, 0, 1, tallies,
        ));
    }

    return out;
}

// ---------------------------------------------------------------------------
// Serpent
// ---------------------------------------------------------------------------

const SERPENT_CARD_RE = /^\s*(surf|cell|mat|lat|pin|det|therm|trans|set)\s+(\S+)/i;

const SERPENT_KINDS: Record<string, SymbolKind> = {
    surf: SymbolKind.Interface,
    cell: SymbolKind.Object,
    mat: SymbolKind.Field,
    lat: SymbolKind.Array,
    pin: SymbolKind.Namespace,
    det: SymbolKind.Event,
    therm: SymbolKind.Constant,
    trans: SymbolKind.Operator,
    set: SymbolKind.Property,
};

function serpentSymbols(text: string): DocumentSymbol[] {
    const out: DocumentSymbol[] = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trimStart().startsWith('%')) continue;
        const m = line.match(SERPENT_CARD_RE);
        if (!m) continue;
        const card = m[1].toLowerCase();
        out.push(symbol(
            `${card} ${m[2]}`, line.trim().slice(0, 60), SERPENT_KINDS[card] ?? SymbolKind.Object,
            i, 0, line.length,
        ));
    }
    return out;
}

// ---------------------------------------------------------------------------
// SCONE
// ---------------------------------------------------------------------------

function sconeSymbols(text: string): DocumentSymbol[] {
    // Nested dictionary blocks: `name { … }` become a nested outline.
    const lines = text.split(/\r?\n/);
    const root: DocumentSymbol[] = [];
    const stack: DocumentSymbol[] = [];

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const code = raw.split(/!|\/\//)[0];
        const open = code.match(/^\s*([A-Za-z_][\w]*)\s*\{/);
        if (open) {
            const name = open[1];
            const sym = symbol(name, '', SymbolKind.Namespace, i, code.indexOf(name), code.indexOf(name) + name.length, []);
            (stack.length ? stack[stack.length - 1].children! : root).push(sym);
            // Single-line `name { … }` blocks don't go on the stack.
            const opens = (code.match(/\{/g) ?? []).length;
            const closes = (code.match(/\}/g) ?? []).length;
            if (opens > closes) stack.push(sym);
            continue;
        }
        const opens = (code.match(/\{/g) ?? []).length;
        let closes = (code.match(/\}/g) ?? []).length - opens;
        while (closes > 0 && stack.length > 0) {
            const done = stack.pop()!;
            done.range = { start: done.range.start, end: { line: i, character: raw.length } };
            closes--;
        }
    }
    return root;
}
