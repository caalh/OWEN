/** Jump-to-source for Cell Map clicks on non-MCNP decks.
 *
 * MCNP uses the reference index (column-accurate). Everyone else searches the
 * file. Patterns have to name the construct — a bare `id=2` or `surf …2`
 * matches the first material, or surface 12, and lands on the wrong card.
 */

export type RevealHit = { line: number; start: number; end: number };

export function findInText(text: string, patterns: RegExp[]): RevealHit | null {
    const lines = text.split(/\r?\n/);
    for (const re of patterns) {
        for (let i = 0; i < lines.length; i++) {
            re.lastIndex = 0;
            const m = re.exec(lines[i]);
            if (m && m.index !== undefined) {
                return { line: i, start: m.index, end: m.index + m[0].length };
            }
        }
    }
    return null;
}

export function findCellMapTarget(
    text: string,
    kind: 'cell' | 'surface',
    id: number,
): RevealHit | null {
    const n = String(id);
    if (kind === 'cell') {
        return findInText(text, [
            new RegExp(`<cell\\b[^>]*\\bid\\s*=\\s*["']?${n}\\b`, 'i'),
            new RegExp(`\\bopenmc\\.Cell\\([^\\n]*\\bid\\s*=\\s*${n}\\b`),
            new RegExp(`\\b(?:simple)?[Cc]ell\\s+${n}\\b`),
        ]);
    }
    return findInText(text, [
        new RegExp(`<surface\\b[^>]*\\bid\\s*=\\s*["']?${n}\\b`, 'i'),
        new RegExp(`\\bopenmc\\.(?:X|Y|Z)?(?:Plane|Sphere|Cylinder|Cone|Quadric)\\([^\\n]*\\bid\\s*=\\s*${n}\\b`),
        new RegExp(`\\bsurf\\s+s?${n}\\b`),
        new RegExp(`\\bsurface\\s+${n}\\b`),
    ]);
}
