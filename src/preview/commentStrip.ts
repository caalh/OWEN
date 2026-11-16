// Shared comment strippers for the line-based input languages.
//
// Each language used to strip its own comments in several places (the fast
// extractor in `codes/<lang>.ts`, the exact-geometry parser in
// `<lang>Geometry.ts`, and the converter), and those copies had drifted apart —
// the same class of bug that produced Frank Helk's MCNP reports in Nov 2026.
// Keeping one definition per language here means a comment edge case is fixed
// once for every consumer.
//
// The canonical comment syntax is the one the editor grammar highlights
// (`syntaxes/*.tmLanguage.json`) and the language configuration declares
// (`language-configuration/*.json`):
//   Serpent  — `%` to end of line, and C-style `/* … */` blocks (may span
//              lines). No `#` comment.            (serpent.tmLanguage.json)
//   SCONE    — `//` and `!` to end of line. No block comments.
//                                                 (scone.tmLanguage.json)
//
// MCNP is column-sensitive (`$`/`c` comments + continuation rule) and is handled
// by `codes/mcnp.ts::logicalCards`; it does not belong here.
//
// The Serpent *results* reader (`results/parsers/serpent.ts`) parses the
// MATLAB-format `_res.m`/`_det.m` output, where `%` is a comment but `'…'`
// strings must be respected and there are no `/* */` blocks — a different
// grammar. It keeps its own quote-aware stripper and must NOT use these.

// Serpent input comments: strip `/* … */` blocks first (they can span lines),
// then `%` to end of line. Block comments become a space so they cannot glue
// two tokens together; line comments are cut to the newline.
export function stripSerpentComments(text: string): string {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .split(/\r?\n/)
        .map((line) => line.replace(/%.*$/, ''))
        .join('\n');
}

// SCONE input comments: `//` and `!` to end of line. SCONE has no block
// comment, so `/* */` is left untouched (it would be a syntax error in SCONE
// too, and must not be silently swallowed).
export function stripSconeComments(text: string): string {
    return text
        .split(/\r?\n/)
        .map((line) => line.replace(/\/\/.*$/, '').replace(/!.*$/, ''))
        .join('\n');
}
