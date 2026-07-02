// ZAID <-> element/nuclide mapping shared by all conversion targets.
// Mirrors groves/src/groves/converter.py (keep in sync).

export const Z_TO_ELEMENT: Record<number, string> = {
    1: 'H', 2: 'He', 3: 'Li', 4: 'Be', 5: 'B', 6: 'C', 7: 'N', 8: 'O',
    9: 'F', 10: 'Ne', 11: 'Na', 12: 'Mg', 13: 'Al', 14: 'Si', 15: 'P',
    16: 'S', 17: 'Cl', 18: 'Ar', 19: 'K', 20: 'Ca', 21: 'Sc', 22: 'Ti',
    23: 'V', 24: 'Cr', 25: 'Mn', 26: 'Fe', 27: 'Co', 28: 'Ni', 29: 'Cu',
    30: 'Zn', 31: 'Ga', 32: 'Ge', 33: 'As', 34: 'Se', 35: 'Br', 36: 'Kr',
    37: 'Rb', 38: 'Sr', 39: 'Y', 40: 'Zr', 41: 'Nb', 42: 'Mo', 43: 'Tc',
    44: 'Ru', 45: 'Rh', 46: 'Pd', 47: 'Ag', 48: 'Cd', 49: 'In', 50: 'Sn',
    51: 'Sb', 52: 'Te', 53: 'I', 54: 'Xe', 55: 'Cs', 56: 'Ba', 57: 'La',
    58: 'Ce', 59: 'Pr', 60: 'Nd', 61: 'Pm', 62: 'Sm', 63: 'Eu', 64: 'Gd',
    65: 'Tb', 66: 'Dy', 67: 'Ho', 68: 'Er', 69: 'Tm', 70: 'Yb', 71: 'Lu',
    72: 'Hf', 73: 'Ta', 74: 'W', 75: 'Re', 76: 'Os', 77: 'Ir', 78: 'Pt',
    79: 'Au', 80: 'Hg', 81: 'Tl', 82: 'Pb', 83: 'Bi', 84: 'Po', 85: 'At',
    86: 'Rn', 87: 'Fr', 88: 'Ra', 89: 'Ac', 90: 'Th', 91: 'Pa', 92: 'U',
    93: 'Np', 94: 'Pu', 95: 'Am', 96: 'Cm', 97: 'Bk', 98: 'Cf',
};

export const ELEMENT_TO_Z: Record<string, number> = Object.fromEntries(
    Object.entries(Z_TO_ELEMENT).map(([z, e]) => [e, Number(z)]),
);

/** MCNP mt identifier -> OpenMC S(alpha,beta) name. */
export const MT_TO_SAB: Record<string, string> = {
    lwtr: 'c_H_in_H2O',
    hwtr: 'c_D_in_D2O',
    grph: 'c_C_in_graphite',
    poly: 'c_H_in_C5O2H8',
    benz: 'c_H_in_C6H6',
    'zr/h': 'c_H_in_ZrH',
    be: 'c_Be_in_Be',
    beo: 'c_Be_in_BeO',
    oice: 'c_O_in_ice',
    sio2: 'c_O_in_SiO2',
};

export const SAB_TO_MT: Record<string, string> = Object.fromEntries(
    Object.entries(MT_TO_SAB).map(([mt, sab]) => [sab, mt]),
);

/** MCNP mt identifier -> Serpent thermal scattering library name (JEFF-based defaults). */
export const MT_TO_SERPENT_THERM: Record<string, string> = {
    lwtr: 'lwj3.11t',
    hwtr: 'hwj3.11t',
    grph: 'grj3.11t',
};

/** '92235.80c' -> 'U235'; natural (A=0) -> element symbol; metastable A>300 handled. */
export function zaidToNuclide(zaid: string): string {
    const base = zaid.split('.')[0];
    const num = parseInt(base, 10);
    if (!Number.isFinite(num) || num === 0) return zaid;
    const z = Math.floor(num / 1000);
    const a = num % 1000;
    const elem = Z_TO_ELEMENT[z] ?? `Z${z}`;
    if (a === 0) return elem;
    if (a > 300) {
        const m = Math.floor((a - 1) / 300);
        const groundA = a - 300 * m;
        return `${elem}${groundA}_m${m}`;
    }
    return `${elem}${a}`;
}

/** 'U235' -> '92235.80c'; element-only names return the natural ZAID. */
export function nuclideToZaid(name: string): string {
    const m = /^([A-Za-z]+)(\d*)/.exec(name);
    if (!m) return name;
    const z = ELEMENT_TO_Z[m[1]];
    if (z === undefined) return name;
    const a = m[2] ? parseInt(m[2], 10) : 0;
    return `${z * 1000 + a}.80c`;
}

/** '92235.80c' -> bare ZA '92235' (numeric part only). */
export function zaidBase(zaid: string): string {
    return zaid.split('.')[0];
}
