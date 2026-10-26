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
};

/** Lookup a surface mnemonic or `imp:n`. Returns null for ZAIDs and plain numbers. */
export function cardFactMarkdown(token: string): string | null {
    const key = token.trim().toLowerCase().replace(/[=].*$/, '');
    const fact = FACTS[key];
    if (!fact) return null;
    if (/\.80c/.test(fact) && /VIII\.0/.test(fact)) return null;
    return fact;
}
