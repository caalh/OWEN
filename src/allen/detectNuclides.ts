import { detectMonteCarloLanguageFromText } from '../util/detectLanguage';

/** OpenMC-style nuclide names (U235, Pu239, H1, …). */
const OPENMC_NUCLIDE = /\b([A-Z][a-z]?)(\d{2,3})\b/g;

/** MCNP/Serpent ZAID → OpenMC name (92235.80c → U235). */
const ZAID = /\b(\d{4,5})\.\d{2}[a-z]/gi;

const ELEMENT_Z: Record<string, number> = {
    H: 1, He: 2, Li: 3, Be: 4, B: 5, C: 6, N: 7, O: 8, F: 9, Ne: 10,
    Na: 11, Mg: 12, Al: 13, Si: 14, P: 15, S: 16, Cl: 17, Ar: 18, K: 19, Ca: 20,
    Sc: 21, Ti: 22, V: 23, Cr: 24, Mn: 25, Fe: 26, Co: 27, Ni: 28, Cu: 29, Zn: 30,
    Ga: 31, Ge: 32, As: 33, Se: 34, Br: 35, Kr: 36, Rb: 37, Sr: 38, Y: 39, Zr: 40,
    Nb: 41, Mo: 42, Tc: 43, Ru: 44, Rh: 45, Pd: 46, Ag: 47, Cd: 48, In: 49, Sn: 50,
    Sb: 51, Te: 52, I: 53, Xe: 54, Cs: 55, Ba: 56, La: 57, Ce: 58, Pr: 59, Nd: 60,
    Pm: 61, Sm: 62, Eu: 63, Gd: 64, Tb: 65, Dy: 66, Ho: 67, Er: 68, Tm: 69, Yb: 70,
    Lu: 71, Hf: 72, Ta: 73, W: 74, Re: 75, Os: 76, Ir: 77, Pt: 78, Au: 79, Hg: 80,
    Tl: 81, Pb: 82, Bi: 83, Po: 84, At: 85, Rn: 86, Fr: 87, Ra: 88, Ac: 89, Th: 90,
    Pa: 91, U: 92, Np: 93, Pu: 94, Am: 95, Cm: 96,
};

const Z_TO_SYMBOL = Object.fromEntries(
    Object.entries(ELEMENT_Z).map(([sym, z]) => [z, sym]),
);

function zaidToOpenMC(zaid: number): string | null {
    const z = Math.floor(zaid / 1000);
    const a = zaid % 1000;
    const sym = Z_TO_SYMBOL[z];
    if (!sym || a === 0) return null;
    return `${sym}${a}`;
}

function addFromZaid(text: string, out: Set<string>): void {
    let m: RegExpExecArray | null;
    const re = new RegExp(ZAID.source, 'gi');
    while ((m = re.exec(text)) !== null) {
        const zaid = parseInt(m[1], 10);
        const name = zaidToOpenMC(zaid);
        if (name) out.add(name);
    }
}

function addFromOpenMC(text: string, out: Set<string>): void {
    // Quoted nuclides in add_nuclide('U235', …) or materials XML
    const quoted = /['"]([A-Z][a-z]?\d{2,3})['"]/g;
    let m: RegExpExecArray | null;
    while ((m = quoted.exec(text)) !== null) {
        out.add(m[1]);
    }

    const re = new RegExp(OPENMC_NUCLIDE.source, 'g');
    while ((m = re.exec(text)) !== null) {
        const candidate = `${m[1]}${m[2]}`;
        if (ELEMENT_Z[m[1]] !== undefined) {
            out.add(candidate);
        }
    }
}

function addFromScone(text: string, out: Set<string>): void {
    // SCONE ZAID indices in nuclearData blocks: 92235, 8016, etc.
    const zaidBare = /\b(\d{4,5})\b/g;
    let m: RegExpExecArray | null;
    while ((m = zaidBare.exec(text)) !== null) {
        const zaid = parseInt(m[1], 10);
        if (zaid >= 1000 && zaid <= 99999) {
            const name = zaidToOpenMC(zaid);
            if (name) out.add(name);
        }
    }
}

const TEACHING_DEFAULT = ['U235', 'U238'];

/**
 * Infer OpenMC-style nuclide names from the active editor document.
 * Returns deduplicated list, most relevant first; falls back to U235/U238.
 */
export function detectNuclides(text: string, languageId: string): string[] {
    const lang = detectMonteCarloLanguageFromText(text, languageId) ?? languageId;
    const found = new Set<string>();

    if (lang === 'mcnp' || lang === 'serpent') {
        addFromZaid(text, found);
    }
    if (lang === 'python' || lang === 'openmc') {
        addFromOpenMC(text, found);
        addFromZaid(text, found);
    }
    if (lang === 'scone') {
        addFromScone(text, found);
        addFromZaid(text, found);
    }

    // Generic fallback: any ZAIDs or quoted nuclides
    if (found.size === 0) {
        addFromZaid(text, found);
        addFromOpenMC(text, found);
    }

    const list = [...found];
    if (list.length === 0) {
        return [...TEACHING_DEFAULT];
    }

    // Prefer common reactor nuclides first
    const priority = ['U235', 'U238', 'Pu239', 'Pu240', 'Pu241', 'H1', 'O16', 'B10', 'Xe135', 'Gd157'];
    list.sort((a, b) => {
        const pa = priority.indexOf(a);
        const pb = priority.indexOf(b);
        if (pa >= 0 && pb >= 0) return pa - pb;
        if (pa >= 0) return -1;
        if (pb >= 0) return 1;
        return a.localeCompare(b);
    });
    return list.slice(0, 8);
}
