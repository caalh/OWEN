// Locating OpenMC API tokens inside Python source, independently of TextMate.
//
// OWEN ships `syntaxes/openmc.injection.tmLanguage.json`, which injects OpenMC
// scopes into `source.python`, and recolors those scopes through
// `editor.tokenColorCustomizations`. That works only until a Python language
// server is installed. Pylance publishes *semantic* tokens, and VS Code resolves
// a semantic token's color from the scopes that token type maps to — `class`
// resolves against `entity.name.type.class`, never against the
// `support.class.openmc` the injection grammar put at the same position. The
// palette is applied, correct, and invisible, which is exactly what a user
// reports as "the OpenMC palettes don't do anything on my machine".
//
// Decorations are drawn above both layers, so the palette is applied that way
// instead. This module is the part that decides *what* to color: it is pure, so
// the token math is testable without an editor. The scopes and precedence match
// the injection grammar exactly — the two must agree, since whichever one wins
// on a given machine should produce the same colors.

export type OpenmcScope =
    | 'variable.language.openmc'
    | 'support.type.openmc'
    | 'support.class.openmc'
    | 'support.function.openmc'
    | 'support.variable.openmc';

export interface OpenmcToken {
    /** Offset of the first character, into the string that was scanned. */
    start: number;
    /** Offset one past the last character. */
    end: number;
    scope: OpenmcScope;
}

/** Submodules the grammar recognises after `openmc.`. */
const SUBMODULES = 'model|stats|deplete|data|lib|mgxs';

// The four `openmc.`-anchored patterns only touch a handful of tokens per
// screen: in a real deck most of the OpenMC API surface appears as method
// calls and attribute accesses on *variables* (`fuel.add_nuclide(...)`,
// `settings.batches = 150`), which stayed theme-colored — so switching
// palettes looked like it did almost nothing (user report, 2026-08-02).
// These curated name lists extend the palette to any receiver. Curation keeps
// it honest: only names that are unmistakably OpenMC API in a deck context.

/** Well-known OpenMC method names, colored as functions on any receiver. */
export const OPENMC_METHODS: readonly string[] = [
    'add_nuclide', 'remove_nuclide', 'add_element', 'add_elements_from_formula',
    'add_components', 'add_macroscopic', 'add_s_alpha_beta', 'set_density',
    'mix_materials', 'get_nuclide_densities', 'get_nuclide_atom_densities',
    'export_to_xml', 'export_to_model_xml', 'from_xml', 'to_xml_element',
    'run', 'plot_geometry', 'calculate_volumes', 'sample_external_source',
    'get_all_cells', 'get_all_materials', 'get_all_universes', 'get_all_lattices',
    'add_cell', 'add_cells', 'remove_cell', 'clone', 'rotate', 'translate',
    'differentiate_depletable_mats', 'find',
];

/** Well-known OpenMC attribute names (settings/cell/lattice/tally fields). */
export const OPENMC_ATTRIBUTES: readonly string[] = [
    // Settings
    'batches', 'inactive', 'particles', 'generations_per_batch', 'run_mode',
    'seed', 'source', 'trigger_active', 'trigger_max_batches', 'photon_transport',
    'energy_mode', 'output', 'cutoff', 'temperature',
    // Geometry / cells / lattices
    'fill', 'region', 'root_universe', 'universes', 'boundary_type', 'albedo',
    'periodic_surface', 'lower_left', 'upper_right', 'pitch', 'outer',
    'ring_radii', 'num_rings', 'orientation',
    // Materials
    'density', 'depletable', 'volume', 'isotropic',
    // Tallies / sources
    'filters', 'scores', 'estimator', 'triggers', 'space', 'angle', 'energy',
    'time', 'strength', 'particle', 'probability',
    // Model wiring
    'geometry', 'settings', 'materials', 'tallies', 'plots',
];

// Mirrors the four repository patterns in the injection grammar, in the same
// order: the first to match a position claims it.
const PATTERNS: { re: RegExp; scopes: (OpenmcScope | undefined)[] }[] = [
    {
        re: new RegExp(`\\b(openmc)(?:\\.(${SUBMODULES}))?\\.([A-Z]\\w+)\\b`, 'g'),
        scopes: ['variable.language.openmc', 'support.type.openmc', 'support.class.openmc'],
    },
    {
        re: new RegExp(`\\b(openmc)(?:\\.(${SUBMODULES}))?\\.([a-z]\\w+)(?=\\s*\\()`, 'g'),
        scopes: ['variable.language.openmc', 'support.type.openmc', 'support.function.openmc'],
    },
    {
        re: new RegExp(`\\b(openmc)\\.(${SUBMODULES})\\b`, 'g'),
        scopes: ['variable.language.openmc', 'support.type.openmc'],
    },
    {
        re: /\b(openmc)\b/g,
        scopes: ['variable.language.openmc'],
    },
    // Any-receiver API methods and attributes. Lower precedence than the
    // openmc.-anchored patterns above, so `openmc.run(` stays module+function
    // and these claim only the `mat.add_nuclide(` / `settings.batches` forms.
    {
        re: new RegExp(`\\.(${OPENMC_METHODS.join('|')})(?=\\s*\\()`, 'g'),
        scopes: ['support.function.openmc'],
    },
    {
        re: new RegExp(`\\.(${OPENMC_ATTRIBUTES.join('|')})\\b(?!\\s*\\()`, 'g'),
        scopes: ['support.variable.openmc'],
    },
];

/**
 * Blank out comments and string literals, preserving every offset so matches
 * found in the result index straight back into the original text.
 *
 * The injection grammar carries `-comment -string` in its selector, so an
 * `openmc.Material` written inside a docstring is not colored there either.
 */
export function maskCommentsAndStrings(text: string): string {
    const out = text.split('');
    const n = text.length;
    let i = 0;

    const blank = (from: number, to: number) => {
        for (let k = from; k < to && k < n; k++) {
            if (out[k] !== '\n') out[k] = ' ';
        }
    };

    while (i < n) {
        const ch = text[i];

        if (ch === '#') {
            let j = i;
            while (j < n && text[j] !== '\n') j++;
            blank(i, j);
            i = j;
            continue;
        }

        if (ch === '"' || ch === "'") {
            const triple = text.startsWith(ch.repeat(3), i);
            const quote = triple ? ch.repeat(3) : ch;
            let j = i + quote.length;
            while (j < n) {
                if (text[j] === '\\') {
                    j += 2;
                    continue;
                }
                if (text.startsWith(quote, j)) {
                    j += quote.length;
                    break;
                }
                // An unterminated single-quoted string ends at the newline.
                if (!triple && text[j] === '\n') break;
                j++;
            }
            blank(i, Math.min(j, n));
            i = Math.min(j, n);
            continue;
        }

        i++;
    }

    return out.join('');
}

/**
 * Every OpenMC API token in `text`, in source order, non-overlapping.
 *
 * Higher-precedence patterns claim their span first, so the `Material` in
 * `openmc.Material` is a class rather than three separate module matches.
 */
export function findOpenmcTokens(text: string): OpenmcToken[] {
    const masked = maskCommentsAndStrings(text);
    const claimed: OpenmcToken[] = [];

    // Cheap rejection: most Python files in a workspace never mention openmc.
    if (!masked.includes('openmc')) return claimed;

    // Character-level claim map, so precedence costs O(1) per match rather than
    // a scan of everything matched so far.
    const taken = new Uint8Array(masked.length);
    const overlaps = (start: number, end: number) => {
        for (let k = start; k < end; k++) {
            if (taken[k]) return true;
        }
        return false;
    };

    for (const { re, scopes } of PATTERNS) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(masked)) !== null) {
            if (m[0].length === 0) {
                re.lastIndex++;
                continue;
            }
            if (overlaps(m.index, m.index + m[0].length)) continue;
            taken.fill(1, m.index, m.index + m[0].length);

            // Walk the capture groups to find each one's offset. Groups here are
            // dot-separated pieces of the same match, so a forward search from
            // the previous group's end is unambiguous.
            let cursor = m.index;
            for (let g = 1; g < m.length; g++) {
                const captured = m[g];
                const scope = scopes[g - 1];
                if (!captured || !scope) continue;
                const start = masked.indexOf(captured, cursor);
                if (start < 0) continue;
                claimed.push({ start, end: start + captured.length, scope });
                cursor = start + captured.length;
            }
        }
    }

    return claimed.sort((a, b) => a.start - b.start);
}
