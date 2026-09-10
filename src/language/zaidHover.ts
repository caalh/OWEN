// Hover text for nuclide identifiers and cross-section library suffixes.
//
// The suffix on `92238.80c` is the single most misread token in an MCNP deck:
// `.80c` looks like "ENDF/B-VIII.0" and is actually ENDF/B-VII.1 at 293.6 K;
// `.71c` is VII.0 at 600 K, not VII.1. The site (reactormc.net) asserted the
// wrong mapping in nine files until mid-2026, which is what convinced us the
// number should be explained where the cursor is. Everything here is a pure
// function so the LSP server and the OpenMC client hover share it and the
// tests run headless.
//
// Sources: MCNP 6.3 manual LA-UR-24-24602 Rev. 1 §1.2.3 and Table B.1 (class
// letters); LANL library release notes for Lib80x / ENDF71x / ENDF70 /
// ENDF71SaB / endf70sab / ENDF80SaB (temperature ladders and identifiers).
// The mapping is the LANL convention: another processor (KAERI, JAEA) may
// reuse the same numbers for a different evaluation, and the manual publishes
// no table on purpose. The text says so.

import { Z_TO_ELEMENT, zaidToNuclide } from '../converter/zaid';

export type HoverLanguage = 'mcnp' | 'serpent' | 'scone' | 'openmc';

const ELEMENT_NAMES: Record<number, string> = {
    1: 'hydrogen', 2: 'helium', 3: 'lithium', 4: 'beryllium', 5: 'boron', 6: 'carbon',
    7: 'nitrogen', 8: 'oxygen', 9: 'fluorine', 10: 'neon', 11: 'sodium', 12: 'magnesium',
    13: 'aluminium', 14: 'silicon', 15: 'phosphorus', 16: 'sulfur', 17: 'chlorine', 18: 'argon',
    19: 'potassium', 20: 'calcium', 21: 'scandium', 22: 'titanium', 23: 'vanadium', 24: 'chromium',
    25: 'manganese', 26: 'iron', 27: 'cobalt', 28: 'nickel', 29: 'copper', 30: 'zinc',
    31: 'gallium', 32: 'germanium', 33: 'arsenic', 34: 'selenium', 35: 'bromine', 36: 'krypton',
    37: 'rubidium', 38: 'strontium', 39: 'yttrium', 40: 'zirconium', 41: 'niobium', 42: 'molybdenum',
    43: 'technetium', 44: 'ruthenium', 45: 'rhodium', 46: 'palladium', 47: 'silver', 48: 'cadmium',
    49: 'indium', 50: 'tin', 51: 'antimony', 52: 'tellurium', 53: 'iodine', 54: 'xenon',
    55: 'caesium', 56: 'barium', 57: 'lanthanum', 58: 'cerium', 59: 'praseodymium', 60: 'neodymium',
    61: 'promethium', 62: 'samarium', 63: 'europium', 64: 'gadolinium', 65: 'terbium', 66: 'dysprosium',
    67: 'holmium', 68: 'erbium', 69: 'thulium', 70: 'ytterbium', 71: 'lutetium', 72: 'hafnium',
    73: 'tantalum', 74: 'tungsten', 75: 'rhenium', 76: 'osmium', 77: 'iridium', 78: 'platinum',
    79: 'gold', 80: 'mercury', 81: 'thallium', 82: 'lead', 83: 'bismuth', 84: 'polonium',
    85: 'astatine', 86: 'radon', 87: 'francium', 88: 'radium', 89: 'actinium', 90: 'thorium',
    91: 'protactinium', 92: 'uranium', 93: 'neptunium', 94: 'plutonium', 95: 'americium', 96: 'curium',
    97: 'berkelium', 98: 'californium',
};

/** A few facts a reactor physicist wants at a glance; not a data library. */
const NUCLIDE_NOTES: Record<string, string> = {
    U235: 'fissile · thermal σf ≈ 585 b · η ≈ 2.07',
    U238: 'fertile · resonance capture dominates below ~10 keV · fast fission threshold ~1 MeV',
    U233: 'fissile · bred from Th-232',
    Pu239: 'fissile · thermal σf ≈ 748 b · 0.3 eV resonance',
    Pu240: 'fertile · 1.06 eV capture resonance (~10⁵ b)',
    Pu241: 'fissile · β⁻ to Am-241 (14.3 y)',
    Th232: 'fertile · breeds U-233',
    B10: 'absorber · σa ≈ 3840 b (n,α) · 19.9 % of natural boron',
    Gd155: 'burnable absorber · σa ≈ 6.1×10⁴ b',
    Gd157: 'burnable absorber · σa ≈ 2.5×10⁵ b',
    Xe135: 'fission-product poison · σa ≈ 2.6×10⁶ b · 9.1 h',
    Sm149: 'fission-product poison · σa ≈ 4.0×10⁴ b · stable',
    H1: 'moderator · σs ≈ 20 b · needs S(α,β) below ~4 eV in water/polyethylene',
    H2: 'deuterium · low absorption moderator',
    O16: 'σa ≈ 0.19 mb · essentially transparent',
    C12: 'graphite moderator · needs S(α,β) (grph)',
    Zr90: 'cladding · low σa',
    Fe56: 'structural · 27 keV scattering resonance',
    Cd113: 'control absorber · thermal σa ≈ 2.1×10⁴ b',
    Ag107: 'Ag-In-Cd control rod',
    In115: 'Ag-In-Cd control rod · 1.46 eV resonance',
    Hf: 'control absorber (natural)',
    He4: 'gap gas · transparent',
    He3: 'detector gas · σ(n,p) ≈ 5330 b',
};

interface LibraryFamily {
    /** Inclusive two-digit suffix range. */
    lo: number;
    hi: number;
    cls: string;
    name: string;
    evaluation: string;
    /** Temperature by (suffix − lo); `null` when the family is single-temperature. */
    ladder: number[] | null;
}

// LANL temperature ladder shared by ENDF70, ENDF71x and Lib80x.
const LANL_LADDER = [293.6, 600, 900, 1200, 2500, 0.1, 250];

const MCNP_FAMILIES: LibraryFamily[] = [
    { lo: 0, hi: 6, cls: 'c', name: 'Lib80x', evaluation: 'ENDF/B-VIII.0', ladder: LANL_LADDER },
    { lo: 80, hi: 86, cls: 'c', name: 'ENDF71x', evaluation: 'ENDF/B-VII.1', ladder: LANL_LADDER },
    { lo: 70, hi: 76, cls: 'c', name: 'ENDF70', evaluation: 'ENDF/B-VII.0', ladder: LANL_LADDER },
    { lo: 66, hi: 66, cls: 'c', name: 'ENDF66', evaluation: 'ENDF/B-VI.6', ladder: [293.6] },
    { lo: 60, hi: 60, cls: 'c', name: 'ENDF60', evaluation: 'ENDF/B-VI.0/VI.1', ladder: [293.6] },
    { lo: 50, hi: 50, cls: 'c', name: 'RMCCS / ENDF5', evaluation: 'ENDF/B-V', ladder: [293.6] },
    { lo: 20, hi: 28, cls: 't', name: 'ENDF71SaB', evaluation: 'ENDF/B-VII.1 thermal S(α,β) (pairs with .8Nc)', ladder: null },
    { lo: 10, hi: 18, cls: 't', name: 'endf70sab', evaluation: 'ENDF/B-VII.0 thermal S(α,β) (pairs with .7Nc)', ladder: null },
    { lo: 80, hi: 89, cls: 't', name: 'ENDF80SaB', evaluation: 'ENDF/B-VIII.0 thermal S(α,β) — renames lwtr→h-h2o, poly→h-poly', ladder: null },
    { lo: 4, hi: 4, cls: 'p', name: 'mcplib04', evaluation: 'photoatomic (ENDF/B-VI.8 + EPDL97)', ladder: null },
    { lo: 12, hi: 12, cls: 'p', name: 'eprdata12', evaluation: 'photoatomic + electron (EPDL97 / EEDL)', ladder: null },
    { lo: 14, hi: 14, cls: 'p', name: 'eprdata14', evaluation: 'photoatomic + electron (ENDF/B-VIII.0 based)', ladder: null },
];

/** Table B.1 class letters. There is no `j`. */
export const MCNP_CLASS_LETTERS: Record<string, string> = {
    c: 'continuous-energy neutron',
    d: 'discrete-reaction neutron',
    t: 'thermal S(α,β) scattering',
    m: 'multigroup neutron',
    g: 'multigroup photon',
    p: 'photoatomic',
    u: 'photonuclear',
    y: 'dosimetry',
    e: 'electron',
    h: 'proton',
    o: 'deuteron',
    r: 'triton',
    s: 'helion (³He)',
    a: 'alpha',
};

/** S(α,β) table stems → what they thermalise. */
const SAB_TARGETS: Record<string, string> = {
    lwtr: 'H in light water', 'h-h2o': 'H in light water',
    hwtr: 'D in heavy water', 'd-d2o': 'D in heavy water',
    grph: 'C in graphite', 'grph10': 'C in graphite (10 % porosity)', 'grph30': 'C in graphite (30 % porosity)',
    poly: 'H in polyethylene', 'h-poly': 'H in polyethylene',
    benz: 'benzene', 'h/zr': 'H in ZrH', 'zr/h': 'Zr in ZrH', 'h-zrh': 'H in ZrH', 'zr-zrh': 'Zr in ZrH',
    be: 'Be metal', 'be-met': 'Be metal', beo: 'Be in BeO', 'be-beo': 'Be in BeO', 'o-be': 'O in BeO', 'o-beo': 'O in BeO',
    sio2: 'SiO₂ (α-quartz)', 'sio2-a': 'SiO₂ (α-quartz)', uo2: 'U in UO₂', 'u-uo2': 'U in UO₂', 'o2/u': 'O in UO₂', 'o-uo2': 'O in UO₂',
    oice: 'O in ice', hice: 'H in ice', al27: 'Al metal', fe56: 'Fe metal', 'h-yh2': 'H in YH₂', 'y-yh2': 'Y in YH₂',
    'al-27': 'Al metal', 'fe-56': 'Fe metal', hzr: 'H in ZrH', zrh: 'Zr in ZrH',
};

export interface ZaidParts {
    z: number;
    /** Mass number as written (metastables keep MCNP's A+300+100m encoding). */
    a: number;
    /** 'U235', 'Am242_m1', 'C' (natural). */
    nuclide: string;
    suffix?: { digits: string; cls?: string };
}

const ZAID_RE = /^(\d{4,6})(?:\.(\d{2})([a-z])?)?$/;
const SAB_RE = /^([a-z][\w\-/]*?)\.(\d{2})t$/i;

export function parseZaid(token: string): ZaidParts | null {
    const m = ZAID_RE.exec(token);
    if (!m) return null;
    const num = parseInt(m[1], 10);
    const z = Math.floor(num / 1000);
    const a = num % 1000;
    if (z < 1 || z > 118) return null;
    const parts: ZaidParts = { z, a, nuclide: zaidToNuclide(m[1]) };
    if (m[2]) parts.suffix = { digits: m[2], cls: m[3] };
    return parts;
}

function fmtTemp(k: number): string {
    return k < 1 ? `${k} K` : `${k} K (${(k - 273.15).toFixed(k === 293.6 ? 1 : 0)} °C)`;
}

/** What an MCNP `.NNx` suffix denotes under the LANL identifier convention. */
export function describeMcnpSuffix(digits: string, cls: string | undefined): string[] {
    const lines: string[] = [];
    if (!cls) {
        lines.push(`\`.${digits}\` — no class letter; MCNP expects \`.${digits}c\`, \`.${digits}t\`, … (Table B.1).`);
        return lines;
    }
    const clsText = MCNP_CLASS_LETTERS[cls];
    if (!clsText) {
        lines.push(`\`${cls}\` is not a class letter MCNP knows (Table B.1: ${Object.keys(MCNP_CLASS_LETTERS).join(' ')}).`);
        return lines;
    }
    const n = parseInt(digits, 10);
    const fam = MCNP_FAMILIES.find((f) => f.cls === cls && n >= f.lo && n <= f.hi);
    if (!fam) {
        lines.push(`\`.${digits}${cls}\` — ${clsText}; not one of the LANL-distributed identifiers, so check your xsdir for what it points at.`);
        return lines;
    }
    let head = `\`.${digits}${cls}\` — **${fam.evaluation}**, ${fam.name} (${clsText})`;
    if (fam.ladder) {
        const t = fam.ladder[n - fam.lo];
        if (t !== undefined) head += ` at **${fmtTemp(t)}**`;
    }
    lines.push(head);
    if (fam.ladder && fam.ladder.length > 1) {
        lines.push(
            `Ladder ${String(fam.lo).padStart(2, '0')}–${String(fam.hi).padStart(2, '0')}: ` +
            fam.ladder.map((t, i) => `.${String(fam.lo + i).padStart(2, '0')}${cls}=${t}K`).join(' '),
        );
        if (n - fam.lo > 0) {
            lines.push('A non-room-temperature table needs `TMP` on every cell that uses it (§5.7.5), or MCNP de-broadens free-gas scattering back to 293.6 K.');
        }
    }
    if (cls === 'c' && n <= 6) {
        lines.push('Note: `.80c` looks like "VIII.0" and is VII.1; VIII.0 is `.00c`. ENDF/B-VIII.0 also dropped elemental (ZZ000) evaluations.');
    }
    return lines;
}

/** Serpent: `ZZAAA.NNc`, NN = temperature index of the ACE table in `set acelib`. */
export function describeSerpentSuffix(digits: string, cls: string | undefined): string[] {
    const n = parseInt(digits, 10);
    const lines: string[] = [];
    if (cls === 'c' || cls === undefined) {
        // The standard Serpent xsdata files (ENDF/B-VII.x, JEFF-3.x) label
        // tables at 100 K multiples: 03=300 K, 06=600 K, 09=900 K, 12=1200 K …
        if (n % 3 === 0 && n >= 3 && n <= 18) {
            lines.push(`\`.${digits}c\` — continuous-energy neutron table at **${n * 100} K** in the \`set acelib\` directory (Serpent xsdata convention).`);
        } else {
            lines.push(`\`.${digits}${cls ?? ''}\` — continuous-energy table; the number is the temperature/library index in your \`set acelib\` file.`);
        }
        lines.push('Which evaluation (ENDF/B-VII.1, JEFF-3.3, …) is decided by the xsdata file, not the suffix. Doppler-broaden with `set tmp`/`tms` when the table is not at the material temperature.');
    } else if (cls === 't') {
        lines.push(`\`.${digits}t\` — thermal scattering table; bind it to the material with \`therm\`.`);
    } else {
        lines.push(`\`.${digits}${cls}\` — class \`${cls}\` table (Serpent takes ACE class letters: c neutron, t thermal, p photon).`);
    }
    return lines;
}

/** SCONE: `ZZAAA.NN`, NN = temperature/100 and must match the material `temp`. */
export function describeSconeSuffix(digits: string): string[] {
    const n = parseInt(digits, 10);
    return [
        `\`.${digits}\` — ACE table at **${n * 100} K**; the material's \`temp\` must be ${n * 100} (SCONE does not Doppler-broaden).`,
        'The evaluation comes from the `aceLibrary` file named in the input, not from the suffix.',
    ];
}

function nuclideLines(p: ZaidParts): string[] {
    const sym = Z_TO_ELEMENT[p.z] ?? `Z${p.z}`;
    const name = ELEMENT_NAMES[p.z] ?? '';
    const lines: string[] = [];
    if (p.a === 0) {
        lines.push(`**${sym}** — natural ${name} (Z=${p.z}), elemental evaluation`);
    } else {
        // zaidToNuclide already undid the A+300+100m metastable encoding.
        const m = /^([A-Za-z]+)(\d+)(?:_m(\d))?$/.exec(p.nuclide);
        const groundA = m ? parseInt(m[2], 10) : p.a;
        const meta = m?.[3] ? `m${m[3]}` : '';
        const encoded = p.a > 300 ? ' (metastable; written with MCNP\'s A+300+100m rule)' : '';
        lines.push(`**${sym}-${groundA}${meta}** — ${name} (Z=${p.z}), A=${groundA}, N=${groundA - p.z}${encoded}`);
    }
    const note = NUCLIDE_NOTES[p.nuclide] ?? NUCLIDE_NOTES[sym];
    if (note) lines.push(note);
    return lines;
}

/**
 * Markdown for the token under the cursor, or null when it is not a nuclide
 * identifier / library suffix / S(α,β) table for that language.
 */
export function zaidHoverMarkdown(token: string, language: HoverLanguage): string | null {
    const sab = SAB_RE.exec(token);
    if (sab && (language === 'mcnp' || language === 'serpent')) {
        const stem = sab[1].toLowerCase();
        const target = SAB_TARGETS[stem];
        const out = [`**${token}** — thermal S(α,β) table${target ? ` for **${target}**` : ''}`];
        if (language === 'mcnp') out.push(...describeMcnpSuffix(sab[2], 't'));
        else out.push(...describeSerpentSuffix(sab[2], 't'));
        if (language === 'mcnp') {
            out.push('An `MT` table only alters the one target it names; if that nuclide is not in the material, MCNP silently ignores it.');
        }
        return out.join('\n\n');
    }

    if (language === 'openmc') {
        const m = /^([A-Z][a-z]?)(\d{1,3})?(?:_m(\d))?$/.exec(token);
        if (!m) return null;
        const z = Object.entries(Z_TO_ELEMENT).find(([, s]) => s === m[1])?.[0];
        if (!z) return null;
        const a = m[2] ? parseInt(m[2], 10) : 0;
        const parts: ZaidParts = { z: Number(z), a, nuclide: token };
        const out = nuclideLines(parts);
        out.push('OpenMC picks the evaluation from `cross_sections.xml` and the temperature from the cell, then the material, then `Settings.temperature[\'default\']` (cell wins).');
        return out.join('\n\n');
    }

    const p = parseZaid(token);
    if (!p) return null;
    const out = nuclideLines(p);
    if (p.suffix) {
        if (language === 'mcnp') out.push(...describeMcnpSuffix(p.suffix.digits, p.suffix.cls));
        else if (language === 'serpent') out.push(...describeSerpentSuffix(p.suffix.digits, p.suffix.cls));
        else out.push(...describeSconeSuffix(p.suffix.digits));
    } else if (language === 'mcnp') {
        out.push('No library suffix: MCNP uses the `M0`/`NLIB=` default or the first matching xsdir entry — say which table you mean.');
    }
    if (p.a === 0 && language === 'mcnp' && p.suffix?.cls === 'c' && parseInt(p.suffix.digits, 10) <= 6) {
        out.push('ENDF/B-VIII.0 (Lib80x) has no elemental tables: `' + token + '` will not be found. Expand to isotopes or use `.80c`.');
    }
    return out.join('\n\n');
}

/**
 * The identifier-looking token around `col` on `line`, with its span.
 * Accepts ZAIDs, S(α,β) names (`lwtr.20t`, `h-h2o.40t`, `h/zr.20t`) and
 * OpenMC nuclide strings; the caller decides which apply to its language.
 */
export function tokenAt(line: string, col: number): { text: string; start: number; end: number } | null {
    const isWord = (ch: string): boolean => /[\w./-]/.test(ch);
    if (col < 0 || col > line.length) return null;
    let s = col, e = col;
    while (s > 0 && isWord(line[s - 1])) s--;
    while (e < line.length && isWord(line[e])) e++;
    if (s === e) return null;
    let text = line.slice(s, e);
    // Strip quotes/punctuation a Python string or a comment may have glued on.
    const trimmed = text.replace(/^[^\w]+|[^\w]+$/g, '');
    if (trimmed !== text) {
        s += text.indexOf(trimmed);
        text = trimmed;
        e = s + text.length;
    }
    return text ? { text, start: s, end: e } : null;
}
