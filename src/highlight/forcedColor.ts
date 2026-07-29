// Forcing a color onto text that a theme has already colored.
//
// Kept separate from the decorator so it can be checked without an editor: this
// is the piece that decides whether the palette is visible at all, and it has
// been silently wrong once already (see CHANGELOG 1.0.6).

import type { TokenStyle } from './palettes';

/**
 * The `textDecoration` value that carries an `!important` color declaration.
 *
 * VS Code renders a token color as `.monaco-editor .mtk7 { color: … }` and a
 * decoration color as `.monaco-editor .ced-<key>-1 { color: … }` — equal
 * specificity, so ordering decides, and the token stylesheet is rebuilt every
 * time `editor.tokenColorCustomizations` changes. `textDecoration` is the one
 * decoration property VS Code passes through to CSS verbatim, so it is the only
 * place an `!important` can be attached; that removes ordering from the question.
 *
 * The leading `none;` closes the `text-decoration` property the value is
 * assigned to, so the declarations that follow stand on their own.
 */
export function forcedColorCss(style: TokenStyle): string {
    const decls = [`color: ${style.foreground} !important`];
    if (style.fontStyle) decls.push(`font-style: ${style.fontStyle} !important`);
    return `none; ${decls.join('; ')}`;
}
