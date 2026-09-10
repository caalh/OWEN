/** Jump-to-source for Cell Map clicks on non-MCNP decks.
 *
 * MCNP uses the reference index (column-accurate). Everyone else searches the
 * file. Patterns have to name the construct — a bare `id=2` or `surf …2`
 * matches the first material, or surface 12, and lands on the wrong card.
 *
 * The engine invents numeric ids for Serpent and SCONE, so the search key is
 * the deck's own identifier (`CellNode.name`) whenever the parser kept one;
 * the numeric id is only a fallback for decks that number things themselves.
 */

export type RevealHit = { line: number; start: number; end: number };

export function findInText(text: string, patterns: RegExp[], from = 0, to = Infinity): RevealHit | null {
    const lines = text.split(/\r?\n/);
    const last = Math.min(lines.length, to);
    for (const re of patterns) {
        for (let i = from; i < last; i++) {
            re.lastIndex = 0;
            const m = re.exec(lines[i]);
            if (m && m.index !== undefined) {
                return { line: i, start: m.index, end: m.index + m[0].length };
            }
        }
    }
    return null;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Line range of a SCONE section (`cells { … }`, `surfaces { … }`,
 * `universes { … }`), so an `id 3;` lookup cannot hit a surface when a cell
 * was asked for. Brace matching over lines is enough — SCONE blocks are
 * one-per-line in practice and comments were already stripped by the parser
 * that told us the id exists.
 */
export function sconeSectionLines(text: string, section: string): [number, number] | null {
    const lines = text.split(/\r?\n/);
    const open = new RegExp(`^\\s*${section}\\s*\\{`);
    for (let i = 0; i < lines.length; i++) {
        if (!open.test(lines[i].replace(/!.*$/, ''))) continue;
        let depth = 0;
        for (let j = i; j < lines.length; j++) {
            const code = lines[j].replace(/!.*$/, '');
            for (const ch of code) {
                if (ch === '{') depth++;
                else if (ch === '}') depth--;
            }
            if (depth <= 0) return [i, j + 1];
        }
        return [i, lines.length];
    }
    return null;
}

export function findCellMapTarget(
    text: string,
    kind: 'cell' | 'surface',
    id: number,
    name?: string,
): RevealHit | null {
    const n = String(id);
    const key = name ?? n;
    const k = escapeRe(key);

    // SCONE synthesized cells name the universe block they came from.
    const synth = key.match(/^(pinUniverse|latUniverse|cellUniverse)\s+(\d+)$/);
    if (synth) {
        const range = sconeSectionLines(text, 'universes');
        return findInText(text, [new RegExp(`\\bid\\s+${synth[2]}\\s*;`)], range?.[0] ?? 0, range?.[1]);
    }
    if (key === 'rootUniverse') {
        return findInText(text, [/\btype\s+rootUniverse\s*;/]);
    }

    if (kind === 'cell') {
        const inScone = sconeSectionLines(text, 'cells');
        return (
            findInText(text, [
                new RegExp(`<cell\\b[^>]*\\bid\\s*=\\s*["']?${n}\\b`, 'i'),
                new RegExp(`<cell\\b[^>]*\\bname\\s*=\\s*["']${k}["']`, 'i'),
                new RegExp(`\\bopenmc\\.Cell\\([^\\n]*\\bid\\s*=\\s*${n}\\b`),
                new RegExp(`\\bopenmc\\.Cell\\([^\\n]*\\bname\\s*=\\s*["']${k}["']`),
                new RegExp(`\\bcell\\s+${k}\\b`),
                new RegExp(`\\bcell\\s+${n}\\b`),
            ]) ??
            (inScone && /^\d+$/.test(key)
                ? findInText(text, [new RegExp(`\\bid\\s+${key}\\s*;`)], inScone[0], inScone[1])
                : null)
        );
    }

    const inScone = sconeSectionLines(text, 'surfaces');
    return (
        findInText(text, [
            new RegExp(`<surface\\b[^>]*\\bid\\s*=\\s*["']?${n}\\b`, 'i'),
            new RegExp(`\\bopenmc\\.(?:X|Y|Z)?(?:Plane|Sphere|Cylinder|Cone|Quadric)\\([^\\n]*\\bid\\s*=\\s*${n}\\b`),
            new RegExp(`\\bsurf\\s+${k}\\b`),
            new RegExp(`\\bsurf\\s+s?${n}\\b`),
            new RegExp(`\\bsurface\\s+${n}\\b`),
        ]) ??
        (inScone && /^\d+$/.test(key)
            ? findInText(text, [new RegExp(`\\bid\\s+${key}\\s*;`)], inScone[0], inScone[1])
            : null)
    );
}
