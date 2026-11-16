/**
 * Hover text for MCNP surface mnemonics and a few card words.
 * ZAIDs are handled by zaidHover.ts, which already refuses to call .80c
 * ENDF/B-VIII.0. Nothing in this table may contradict that.
 */

const FACTS: Record<string, string> = {
    so: 'Sphere centered at the origin. `so R` has radius R in centimetres. The inside is `-1` when this surface is numbered 1.',
    s: 'Sphere. `s x y z R` is centered at (x, y, z) with radius R in centimetres.',
    sx: 'Sphere centered on the x axis. The entries are the centre and the radius, in centimetres.',
    sy: 'Sphere centered on the y axis. The entries are the centre and the radius, in centimetres.',
    sz: 'Sphere centered on the z axis. The entries are the centre and the radius, in centimetres.',
    cz: 'Infinite cylinder on the z axis. `cz R` has radius R in centimetres. Close it with two pz planes or the cell has no finite volume.',
    pz: 'Plane of constant z, in centimetres.',
    px: 'Plane of constant x, in centimetres.',
    py: 'Plane of constant y, in centimetres.',
    rcc: 'Right circular cylinder macrobody. MCNP has no CYL mnemonic; RCC is the cylinder.',
    rhp: 'Right hexagonal prism. HEX is a documented alias for RHP. A regular hexagon takes 9 entries; 15 when the facet vectors are written out.',
    hex: 'Alias for RHP, the right hexagonal prism. It is legal. A regular hexagon takes 9 entries.',
    box: 'Box macrobody. 9 entries (the third edge is implied) or 12. It is not infinite along every axis when the third edge is omitted — that omission makes it infinite along the a1 × a2 normal.',
    'imp:n': 'Neutron importance. imp:n=0 is the outside of the problem (the graveyard). A positive value transports neutrons. Every cell needs one, or an IMP data card.',
    kcode: 'Criticality source. `kcode N k0 inactive total`: N histories per cycle, k0 the initial k guess, `inactive` settle cycles that are skipped, `total` cycles run. Active cycles = total − inactive, and k is scored only on the active cycles.',
    ksrc: 'Initial source points for a kcode run: `ksrc x y z …`, one triplet per point. Each point must sit inside a cell (never on a surface), and at least one must land in a fissile cell.',
    mode: 'Particle types transported. `mode n` is neutrons only; `mode n p` adds photons. A particle not listed here is not tracked.',
    m: 'Material card. `mN zaid frac …`: positive fractions are atom fraction, negative are weight fraction — do not mix signs in one material. Natural-abundance mixes are tabulated by atom, so they take positive entries. The density and its sign live on the cell card, not here.',
    mt: 'Thermal S(α,β) treatment for the material of the same number (`MT4` pairs with `M4`). It only alters the one target nuclide it was built for; a table whose target is absent from the material is silently ignored.',
    tmp: 'Free-gas thermal temperature, one entry per cell in cell order, given as kT in MeV. It rescales free-gas scattering only — resonance broadening comes from the library suffix. A zero on a non-void cell is a fatal error.',
    nps: 'History count for a fixed-source run. It is ignored in kcode (criticality) mode, where `kcode` sets the cycle and history counts.',
    dbrc: 'Doppler-broadening rejection correction for resonance upscatter. `endf=` (71 or 80) is required whenever `isos=` is present; `isos=` takes bare targets like `U-238` or `92238`, never a table id like `92238.80c`.',
    prdmp: 'Print-and-dump cycle control for the OUTP and RUNTPE files.',
};

/** Lookup a surface mnemonic, a data-card word, or `imp:n`. Material/thermal
 *  cards carry a number (`m1`, `mt4`); collapse that to the `m`/`mt` entry.
 *  Returns null for ZAIDs and plain numbers. */
export function cardFactMarkdown(token: string): string | null {
    let key = token.trim().toLowerCase().replace(/[=].*$/, '');
    if (/^m\d+$/.test(key)) key = 'm';
    else if (/^mt\d+$/.test(key)) key = 'mt';
    const fact = FACTS[key];
    if (!fact) return null;
    if (/\.80c/.test(fact) && /VIII\.0/.test(fact)) return null;
    return fact;
}
