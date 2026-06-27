#!/usr/bin/env python3
"""BEAVRS Cycle 1 full-core PWR - OpenMC translation (community example deck).

PROVENANCE
----------
Geometry + materials translated from the author-VERIFIED Cambridge SCONE
BEAVRS full-core deck (reactor-test-decks/beavrs_scone_fullcore.scone) and the
public MIT BEAVRS rev 2.0.2 specification (Horelik, Herman, Forget, Smith;
CRPG/MIT, 2018). This is a COMMUNITY EXAMPLE DECK - it is NOT benchmark-
validated and is not an official MIT/CRPG product.

WHAT THIS BUILDS
----------------
- 17x17 core lattice (assembly pitch 21.50364 cm), 193 fuel assemblies on the
  verified BEAVRS loading map (3 enrichment zones).
- 17x17 assemblies (pin pitch 1.26 cm; fuel 0.39218 / gap 0.40005 /
  clad 0.45720 cm) with 24 guide tubes + 1 central instrument tube.
- Enrichment zones 1.6 / 2.4 / 3.1 wt% UO2; per-assembly Pyrex burnable-
  poison clusters (real 6/12/15/16/20-rod patterns from the verified SCONE
  core); control rods WITHDRAWN (water-filled guide tubes); SS304
  baffle/former plates, core barrel, 4 octant neutron-shield pads,
  downcomer, RPV liner / RPV; vacuum boundary.
- FULL AXIAL MODEL (this is the completed axial build; the older single-zone
  caveat is gone). Each pin type is an axial STACK of cells along z, ported
  layer-for-layer from the verified SCONE deck (z 0 -> 460 cm):
    * active fuel z 36.748 -> 402.508 cm (height 365.76), continuous UO2
      pellet, segmented by 7 Inconel grid spacers + 1 plenum-region spacer;
    * bottom: water (0->20), lower core/support plate (20->35), Zircaloy
      bottom end plug (35->36.748);
    * top: upper fuel-rod plenum w/ Inconel spring (402.508->417.164,
      with a grid spacer band), Zircaloy top end plug (417.164->419.704),
      water (419.704->423.049), SS304 top nozzle (423.049->431.876),
      water (431.876->460);
    * guide tubes: dashpot (narrowed thimble) below z~98, normal thimble
      above, Borated-water support plate, all 8 spacer bands;
    * instrument tube: bare thimble below support plate, full thimble above;
    * Pyrex BA rods: SS/dashpot transition + plenum geometry above the
      poison column (Pyrex active z 40.558 -> 401.238), all spacer bands.
  Inconel grid spacers are modeled as the verified deck's square Inconel
  sleeve in the coolant channel (half-widths 0.61015 -> 0.62992 cm) at the
  8 BEAVRS spacer elevations.

ASSUMPTIONS / SIMPLIFICATIONS (FLAGGED)
---------------------------------------
* Cross sections: requires OPENMC_CROSS_SECTIONS. Number densities are
  identical to the verified SCONE deck (which used JEF-3.1.1 at 600 K);
  pick a 600 K-capable library or rely on windowed multipole / on-the-fly
  Doppler. Expect a cross-library k-eff bias vs the SCONE/JEFF result.
* AXIAL and RADIAL models are both complete: per-assembly Pyrex BA clusters,
  the stepped SS304 baffle/former, core barrel, the four octant neutron-
  shield pads, downcomer and RPV are all ported from the verified SCONE
  core. No radial simplifications remain.
* Temperature (600 K) is set on CELLS (per OpenMC convention) and as the
  Settings default; S(a,b) c_H_in_H2O is on WATER ONLY (incl. borated-water
  support plate), never on UO2/structure.
* Run with:  model.run(threads=N)  then  openmc.StatePoint(<path>).
"""
import openmc
import openmc.model

# ===================== MATERIALS (atoms/b-cm) =====================
fuel16 = openmc.Material(name="UO2-16")
fuel16.set_density("atom/b-cm", 6.89175e-2)
fuel16.add_nuclide("O16", 4.58970e-2, "ao")
fuel16.add_nuclide("O17", 1.74360e-5, "ao")
fuel16.add_nuclide("U234", 3.01310e-6, "ao")
fuel16.add_nuclide("U235", 3.75030e-4, "ao")
fuel16.add_nuclide("U238", 2.26250e-2, "ao")

fuel24 = openmc.Material(name="UO2-24")
fuel24.set_density("atom/b-cm", 6.88170e-2)
fuel24.add_nuclide("O16", 4.58300e-2, "ao")
fuel24.add_nuclide("O17", 1.74110e-5, "ao")
fuel24.add_nuclide("U234", 4.48420e-6, "ao")
fuel24.add_nuclide("U235", 5.58140e-4, "ao")
fuel24.add_nuclide("U238", 2.24070e-2, "ao")

fuel31 = openmc.Material(name="UO2-31")
fuel31.set_density("atom/b-cm", 6.88510e-2)
fuel31.add_nuclide("O16", 4.58530e-2, "ao")
fuel31.add_nuclide("O17", 1.74200e-5, "ao")
fuel31.add_nuclide("U234", 5.79870e-6, "ao")
fuel31.add_nuclide("U235", 7.21750e-4, "ao")
fuel31.add_nuclide("U238", 2.22530e-2, "ao")

helium = openmc.Material(name="Helium")
helium.set_density("atom/b-cm", 2.40440e-4)
helium.add_nuclide("He3", 4.80890e-10, "ao")
helium.add_nuclide("He4", 2.40440e-4, "ao")

zirc = openmc.Material(name="Zircaloy")
zirc.set_density("atom/b-cm", 4.34389e-2)
zirc.add_nuclide("Cr50", 3.29620e-6, "ao")
zirc.add_nuclide("Cr52", 6.35640e-5, "ao")
zirc.add_nuclide("Cr53", 7.20760e-6, "ao")
zirc.add_nuclide("Cr54", 1.79410e-6, "ao")
zirc.add_nuclide("Fe54", 8.66980e-6, "ao")
zirc.add_nuclide("Fe56", 1.36100e-4, "ao")
zirc.add_nuclide("Fe57", 3.14310e-6, "ao")
zirc.add_nuclide("Fe58", 4.18290e-7, "ao")
zirc.add_nuclide("O16", 3.07440e-4, "ao")
zirc.add_nuclide("O17", 1.16800e-7, "ao")
zirc.add_nuclide("Sn112", 4.67350e-6, "ao")
zirc.add_nuclide("Sn114", 3.17990e-6, "ao")
zirc.add_nuclide("Sn115", 1.63810e-6, "ao")
zirc.add_nuclide("Sn116", 7.00550e-5, "ao")
zirc.add_nuclide("Sn117", 3.70030e-5, "ao")
zirc.add_nuclide("Sn118", 1.16690e-4, "ao")
zirc.add_nuclide("Sn119", 4.13870e-5, "ao")
zirc.add_nuclide("Sn120", 1.56970e-4, "ao")
zirc.add_nuclide("Sn122", 2.23080e-5, "ao")
zirc.add_nuclide("Sn124", 2.78970e-5, "ao")
zirc.add_nuclide("Zr90", 2.18280e-2, "ao")
zirc.add_nuclide("Zr91", 4.76010e-3, "ao")
zirc.add_nuclide("Zr92", 7.27590e-3, "ao")
zirc.add_nuclide("Zr94", 7.37340e-3, "ao")
zirc.add_nuclide("Zr96", 1.18790e-3, "ao")

water = openmc.Material(name="Water")
water.set_density("atom/b-cm", 7.41863e-2)
water.add_nuclide("H1", 4.94560e-2, "ao")
water.add_nuclide("B10", 7.97140e-6, "ao")
water.add_nuclide("B11", 3.22470e-5, "ao")
water.add_nuclide("H2", 7.70350e-6, "ao")
water.add_nuclide("O16", 2.46730e-2, "ao")
water.add_nuclide("O17", 9.37340e-6, "ao")
water.add_s_alpha_beta("c_H_in_H2O")

pyrex = openmc.Material(name="BorosilicateGlass")
pyrex.set_density("atom/b-cm", 7.15028e-2)
pyrex.add_nuclide("Al27", 1.73520e-3, "ao")
pyrex.add_nuclide("B10", 9.65060e-4, "ao")
pyrex.add_nuclide("B11", 3.91890e-3, "ao")
pyrex.add_nuclide("O16", 4.65140e-2, "ao")
pyrex.add_nuclide("O17", 1.76710e-5, "ao")
pyrex.add_nuclide("Si28", 1.69260e-2, "ao")
pyrex.add_nuclide("Si29", 8.59440e-4, "ao")
pyrex.add_nuclide("Si30", 5.66540e-4, "ao")

ss304 = openmc.Material(name="StainlessSteel304")
ss304.set_density("atom/b-cm", 8.79322e-2)
ss304.add_nuclide("Cr50", 7.67780e-4, "ao")
ss304.add_nuclide("Cr52", 1.48060e-2, "ao")
ss304.add_nuclide("Cr53", 1.67890e-3, "ao")
ss304.add_nuclide("Cr54", 4.17910e-4, "ao")
ss304.add_nuclide("Fe54", 3.46200e-3, "ao")
ss304.add_nuclide("Fe56", 5.43450e-2, "ao")
ss304.add_nuclide("Fe57", 1.25510e-3, "ao")
ss304.add_nuclide("Fe58", 1.67030e-4, "ao")
ss304.add_nuclide("Mn55", 1.76040e-3, "ao")
ss304.add_nuclide("Ni58", 5.60890e-3, "ao")
ss304.add_nuclide("Ni60", 2.16050e-3, "ao")
ss304.add_nuclide("Ni61", 9.39170e-5, "ao")
ss304.add_nuclide("Ni62", 2.99450e-4, "ao")
ss304.add_nuclide("Ni64", 7.62610e-5, "ao")
ss304.add_nuclide("Si28", 9.52810e-4, "ao")
ss304.add_nuclide("Si29", 4.83810e-5, "ao")
ss304.add_nuclide("Si30", 3.18930e-5, "ao")

# Inconel-718 grid spacers and fuel-rod / control-rod springs.
inconel = openmc.Material(name="Inconel")
inconel.set_density("atom/b-cm", 8.77899e-2)
inconel.add_nuclide("Cr50", 7.82390e-4, "ao")
inconel.add_nuclide("Cr52", 1.50880e-2, "ao")
inconel.add_nuclide("Cr53", 1.71080e-3, "ao")
inconel.add_nuclide("Cr54", 4.25860e-4, "ao")
inconel.add_nuclide("Fe54", 1.47970e-3, "ao")
inconel.add_nuclide("Fe56", 2.32290e-2, "ao")
inconel.add_nuclide("Fe57", 5.36450e-4, "ao")
inconel.add_nuclide("Fe58", 7.13920e-5, "ao")
inconel.add_nuclide("Mn55", 7.82010e-4, "ao")
inconel.add_nuclide("Ni58", 2.93200e-2, "ao")
inconel.add_nuclide("Ni60", 1.12940e-2, "ao")
inconel.add_nuclide("Ni61", 4.90940e-4, "ao")
inconel.add_nuclide("Ni62", 1.56530e-3, "ao")
inconel.add_nuclide("Ni64", 3.98640e-4, "ao")
inconel.add_nuclide("Si28", 5.67570e-4, "ao")
inconel.add_nuclide("Si29", 2.88200e-5, "ao")
inconel.add_nuclide("Si30", 1.89980e-5, "ao")

# Lower-density SS for the lower core / support plate region.
support_ss = openmc.Material(name="SupportPlateSS")
support_ss.set_density("atom/b-cm", 4.03396e-2)
support_ss.add_nuclide("Cr50", 3.52230e-4, "ao")
support_ss.add_nuclide("Cr52", 6.79240e-3, "ao")
support_ss.add_nuclide("Cr53", 7.70200e-4, "ao")
support_ss.add_nuclide("Cr54", 1.91720e-4, "ao")
support_ss.add_nuclide("Fe54", 1.58820e-3, "ao")
support_ss.add_nuclide("Fe56", 2.49310e-2, "ao")
support_ss.add_nuclide("Fe57", 5.75780e-4, "ao")
support_ss.add_nuclide("Fe58", 7.66250e-5, "ao")
support_ss.add_nuclide("Mn55", 8.07620e-4, "ao")
support_ss.add_nuclide("Ni58", 2.57310e-3, "ao")
support_ss.add_nuclide("Ni60", 9.91170e-4, "ao")
support_ss.add_nuclide("Ni61", 4.30850e-5, "ao")
support_ss.add_nuclide("Ni62", 1.37380e-4, "ao")
support_ss.add_nuclide("Ni64", 3.49850e-5, "ao")
support_ss.add_nuclide("Si28", 4.37110e-4, "ao")
support_ss.add_nuclide("Si29", 2.21950e-5, "ao")
support_ss.add_nuclide("Si30", 1.46310e-5, "ao")

# Borated water of the lower support plate (guide-tube/instrument positions).
support_bw = openmc.Material(name="SupportPlateBW")
support_bw.set_density("atom/b-cm", 9.82709e-2)
support_bw.add_nuclide("B10", 1.05590e-5, "ao")
support_bw.add_nuclide("B11", 4.27160e-5, "ao")
support_bw.add_nuclide("H1", 6.55120e-2, "ao")
support_bw.add_nuclide("H2", 1.02040e-5, "ao")
support_bw.add_nuclide("O16", 3.26830e-2, "ao")
support_bw.add_nuclide("O17", 1.24160e-5, "ao")
support_bw.add_s_alpha_beta("c_H_in_H2O")

carbonsteel = openmc.Material(name="CarbonSteel")
carbonsteel.set_density("atom/b-cm", 8.50964e-2)
carbonsteel.add_nuclide("Al27", 4.35230e-5, "ao")
carbonsteel.add_nuclide("B10", 2.58330e-6, "ao")
carbonsteel.add_nuclide("B11", 1.04500e-5, "ao")
carbonsteel.add_nuclide("C12", 1.04420e-3, "ao")
carbonsteel.add_nuclide("Ca40", 1.70430e-5, "ao")
carbonsteel.add_nuclide("Ca42", 1.13750e-7, "ao")
carbonsteel.add_nuclide("Ca43", 2.37340e-8, "ao")
carbonsteel.add_nuclide("Ca44", 3.66730e-7, "ao")
carbonsteel.add_nuclide("Ca46", 7.03220e-10, "ao")
carbonsteel.add_nuclide("Ca48", 3.28750e-8, "ao")
carbonsteel.add_nuclide("Cr50", 1.37380e-5, "ao")
carbonsteel.add_nuclide("Cr52", 2.64930e-4, "ao")
carbonsteel.add_nuclide("Cr53", 3.00410e-5, "ao")
carbonsteel.add_nuclide("Cr54", 7.47780e-6, "ao")
carbonsteel.add_nuclide("Cu63", 1.02230e-4, "ao")
carbonsteel.add_nuclide("Cu65", 4.56080e-5, "ao")
carbonsteel.add_nuclide("Fe54", 4.74370e-3, "ao")
carbonsteel.add_nuclide("Fe56", 7.44650e-2, "ao")
carbonsteel.add_nuclide("Fe57", 1.71970e-3, "ao")
carbonsteel.add_nuclide("Fe58", 2.28860e-4, "ao")
carbonsteel.add_nuclide("Mn55", 6.41260e-4, "ao")
carbonsteel.add_nuclide("Mo100", 2.98140e-5, "ao")
carbonsteel.add_nuclide("Mo92", 4.48220e-5, "ao")
carbonsteel.add_nuclide("Mo94", 2.81100e-5, "ao")
carbonsteel.add_nuclide("Mo95", 4.85670e-5, "ao")
carbonsteel.add_nuclide("Mo96", 5.10150e-5, "ao")
carbonsteel.add_nuclide("Mo97", 2.93190e-5, "ao")
carbonsteel.add_nuclide("Mo98", 7.43270e-5, "ao")
carbonsteel.add_nuclide("Nb93", 5.05590e-6, "ao")
carbonsteel.add_nuclide("Ni58", 4.08620e-4, "ao")
carbonsteel.add_nuclide("Ni60", 1.57400e-4, "ao")
carbonsteel.add_nuclide("Ni61", 6.84200e-6, "ao")
carbonsteel.add_nuclide("Ni62", 2.18150e-5, "ao")
carbonsteel.add_nuclide("Ni64", 5.55570e-6, "ao")
carbonsteel.add_nuclide("P31", 3.79130e-5, "ao")
carbonsteel.add_nuclide("S32", 3.48080e-5, "ao")
carbonsteel.add_nuclide("S33", 2.74200e-7, "ao")
carbonsteel.add_nuclide("S34", 1.53680e-6, "ao")
carbonsteel.add_nuclide("S36", 5.33980e-9, "ao")
carbonsteel.add_nuclide("Si28", 6.17020e-4, "ao")
carbonsteel.add_nuclide("Si29", 3.13300e-5, "ao")
carbonsteel.add_nuclide("Si30", 2.06530e-5, "ao")
carbonsteel.add_nuclide("Ti46", 1.21440e-6, "ao")
carbonsteel.add_nuclide("Ti47", 1.09520e-6, "ao")
carbonsteel.add_nuclide("Ti48", 1.08510e-5, "ao")
carbonsteel.add_nuclide("Ti49", 7.96340e-7, "ao")
carbonsteel.add_nuclide("Ti50", 7.62490e-7, "ao")
carbonsteel.add_nuclide("V51", 4.59890e-5, "ao")

air = openmc.Material(name="Air")
air.set_density("atom/b-cm", 2.52837e-4)
air.add_nuclide("Ar36", 7.87300e-9, "ao")
air.add_nuclide("Ar38", 1.48440e-9, "ao")
air.add_nuclide("Ar40", 2.35060e-6, "ao")
air.add_nuclide("C12", 6.75390e-8, "ao")
air.add_nuclide("N14", 1.96800e-4, "ao")
air.add_nuclide("N15", 7.23540e-7, "ao")
air.add_nuclide("O16", 5.28660e-5, "ao")
air.add_nuclide("O17", 2.00840e-8, "ao")

materials = openmc.Materials([
    fuel16, fuel24, fuel31, helium, zirc, water, pyrex, ss304,
    inconel, support_ss, support_bw, carbonsteel, air
])

TEMP = 600.0

# ===================== GRID-SPACER SQUARE SLEEVE =====================
# Verified SCONE thick grid: square Inconel sleeve, half-widths 0.61015 ->
# 0.62992 cm in the coolant channel (pin pitch 1.26 => half-pitch 0.63).
GRID_IN = 2 * 0.61015   # full width of inner square
GRID_OUT = 2 * 0.62992  # full width of outer square
_grid_inner = -openmc.model.RectangularPrism(GRID_IN, GRID_IN)
_grid_outer = -openmc.model.RectangularPrism(GRID_OUT, GRID_OUT)


def make_pin(name, shells, grid=False):
    """Build a radial pin universe.

    shells: list of (material, r_outer); the FINAL entry has r_outer=None and
    is the infinite outer fill (always Water in this deck). When grid=True the
    outer fill is split by the Inconel grid sleeve (square annulus in coolant).
    """
    cells = []
    inner_surf = None
    outer_fill = None
    for mat, r in shells:
        if r is None:
            outer_fill = mat
            break
        s = openmc.ZCylinder(r=r)
        reg = (-s) if inner_surf is None else (+inner_surf & -s)
        c = openmc.Cell(fill=mat, region=reg)
        c.temperature = TEMP
        cells.append(c)
        inner_surf = s
    base = +inner_surf if inner_surf is not None else None
    if not grid:
        c = openmc.Cell(fill=outer_fill, region=base)
        c.temperature = TEMP
        cells.append(c)
    else:
        water_in = openmc.Cell(fill=outer_fill,
                               region=(base & _grid_inner) if base is not None else _grid_inner)
        sleeve = openmc.Cell(fill=inconel, region=_grid_outer & ~_grid_inner)
        water_out = openmc.Cell(fill=outer_fill, region=~_grid_outer)
        for c in (water_in, sleeve, water_out):
            c.temperature = TEMP
        cells += [water_in, sleeve, water_out]
    return openmc.Universe(name=name, cells=cells)


# Radial pin layer specifications (material, r_outer); final = infinite outer.
_SHELLS = {
    "f16": [(fuel16, 0.39218), (helium, 0.40005), (zirc, 0.45720), (water, None)],
    "f24": [(fuel24, 0.39218), (helium, 0.40005), (zirc, 0.45720), (water, None)],
    "f31": [(fuel31, 0.39218), (helium, 0.40005), (zirc, 0.45720), (water, None)],
    "gt":  [(water, 0.56134), (zirc, 0.60198), (water, None)],
    "gtd": [(water, 0.50419), (zirc, 0.54610), (water, None)],
    "it":  [(air, 0.43688), (zirc, 0.48387), (water, 0.56134), (zirc, 0.60198), (water, None)],
    "itb": [(air, 0.43688), (zirc, 0.48387), (water, None)],
    "ba":  [(air, 0.21400), (ss304, 0.23051), (helium, 0.24130), (pyrex, 0.42672),
            (helium, 0.43688), (ss304, 0.48387), (water, 0.56134), (zirc, 0.60198), (water, None)],
    "bap": [(air, 0.21400), (ss304, 0.23051), (helium, 0.43688), (ss304, 0.48387),
            (water, 0.50419), (zirc, 0.54610), (water, None)],
    "ssgt": [(ss304, 0.56134), (zirc, 0.60198), (water, None)],
    "ssdp": [(ss304, 0.50419), (zirc, 0.54610), (water, None)],
    "w":   [(water, None)],
    "ss":  [(ss304, 0.45720), (water, None)],
    "sps": [(support_ss, 0.45720), (water, None)],
    "spb": [(support_bw, 0.45720), (water, None)],
    "zr":  [(zirc, 0.45720), (water, None)],
    "plen": [(inconel, 0.06459), (helium, 0.40005), (zirc, 0.45720), (water, None)],
}
# Grid-overlay variants get the Inconel square sleeve in the coolant.
_GRID_VARIANTS = ["f16", "f24", "f31", "gt", "it", "ba", "bap", "plen", "gtd", "ssgt", "ssdp"]

R = {}
for key, shells in _SHELLS.items():
    R[key] = make_pin(f"pin_{key}", shells, grid=False)
for key in _GRID_VARIANTS:
    R[key + "g"] = make_pin(f"pin_{key}g", _SHELLS[key], grid=True)

# ===================== AXIAL Z-PLANES (cm, ported from SCONE) =====================
Z_BOT, Z_TOP = 0.0, 460.0
_zvals = sorted({
    0.0, 20.0, 35.0, 36.748, 37.1621, 38.66, 39.958, 40.52, 40.558, 98.025,
    103.74, 150.222, 155.937, 202.419, 208.134, 254.616, 260.331, 306.813,
    312.528, 359.01, 364.725, 401.238, 402.508, 411.806, 415.164, 417.164,
    419.704, 421.532, 423.049, 431.876, 460.0,
})
ZP = {}
for z in _zvals:
    bt = "vacuum" if z in (Z_BOT, Z_TOP) else "transmission"
    ZP[z] = openmc.ZPlane(z0=z, boundary_type=bt)

# ===================== AXIAL STACKS (z_bottom, z_top, radial key) =========
# Active fuel z 36.748 -> 402.508; grid spacers at the 7 fuel-region bands
# plus the plenum band (411.806 -> 415.164).
def _fuel_stack(e):
    return [
        (0.0, 20.0, "w"), (20.0, 35.0, "sps"), (35.0, 36.748, "zr"),
        (36.748, 37.1621, e), (37.1621, 40.52, e + "g"), (40.52, 98.025, e),
        (98.025, 103.74, e + "g"), (103.74, 150.222, e), (150.222, 155.937, e + "g"),
        (155.937, 202.419, e), (202.419, 208.134, e + "g"), (208.134, 254.616, e),
        (254.616, 260.331, e + "g"), (260.331, 306.813, e), (306.813, 312.528, e + "g"),
        (312.528, 359.01, e), (359.01, 364.725, e + "g"), (364.725, 402.508, e),
        (402.508, 411.806, "plen"), (411.806, 415.164, "pleng"), (415.164, 417.164, "plen"),
        (417.164, 419.704, "zr"), (419.704, 423.049, "w"), (423.049, 431.876, "ss"),
        (431.876, 460.0, "w"),
    ]

STACKS = {
    "f16": _fuel_stack("f16"),
    "f24": _fuel_stack("f24"),
    "f31": _fuel_stack("f31"),
    "gt": [
        (0.0, 20.0, "w"), (20.0, 35.0, "spb"), (35.0, 37.1621, "gtd"),
        (37.1621, 39.958, "gtdg"), (39.958, 40.52, "gt"), (40.52, 98.025, "gtd"),
        (98.025, 103.74, "gtg"), (103.74, 150.222, "gt"), (150.222, 155.937, "gtg"),
        (155.937, 202.419, "gt"), (202.419, 208.134, "gtg"), (208.134, 254.616, "gt"),
        (254.616, 260.331, "gtg"), (260.331, 306.813, "gt"), (306.813, 312.528, "gtg"),
        (312.528, 359.01, "gt"), (359.01, 364.725, "gtg"), (364.725, 411.806, "gt"),
        (411.806, 415.164, "gtg"), (415.164, 423.049, "gt"), (423.049, 431.876, "spb"),
        (431.876, 460.0, "w"),
    ],
    "it": [
        (0.0, 20.0, "itb"), (20.0, 35.0, "spb"), (35.0, 37.1621, "it"),
        (37.1621, 40.52, "itg"), (40.52, 98.025, "it"), (98.025, 103.74, "itg"),
        (103.74, 150.222, "it"), (150.222, 155.937, "itg"), (155.937, 202.419, "it"),
        (202.419, 208.134, "itg"), (208.134, 254.616, "it"), (254.616, 260.331, "itg"),
        (260.331, 306.813, "it"), (306.813, 312.528, "itg"), (312.528, 359.01, "it"),
        (359.01, 364.725, "itg"), (364.725, 411.806, "it"), (411.806, 415.164, "itg"),
        (415.164, 423.049, "it"), (423.049, 460.0, "w"),
    ],
    "ba": [
        (0.0, 20.0, "w"), (20.0, 35.0, "spb"), (35.0, 37.1621, "gtd"),
        (37.1621, 38.66, "gtdg"), (38.66, 39.958, "ssdpg"), (39.958, 40.52, "ssgtg"),
        (40.52, 40.558, "ssgt"), (40.558, 98.025, "ba"), (98.025, 103.74, "bag"),
        (103.74, 150.222, "ba"), (150.222, 155.937, "bag"), (155.937, 202.419, "ba"),
        (202.419, 208.134, "bag"), (208.134, 254.616, "ba"), (254.616, 260.331, "bag"),
        (260.331, 306.813, "ba"), (306.813, 312.528, "bag"), (312.528, 359.01, "ba"),
        (359.01, 364.725, "bag"), (364.725, 401.238, "ba"), (401.238, 411.806, "bap"),
        (411.806, 415.164, "bapg"), (415.164, 421.532, "bap"), (421.532, 423.049, "ssgt"),
        (423.049, 431.876, "ss"), (431.876, 460.0, "w"),
    ],
}


def column(name, table):
    cells = []
    for zb, zt, key in table:
        c = openmc.Cell(name=f"{name}_{zb:g}", fill=R[key],
                        region=+ZP[zb] & -ZP[zt])
        cells.append(c)
    return openmc.Universe(name=name, cells=cells)


COL = {k: column(f"col_{k}", t) for k, t in STACKS.items()}
# Full-height water column for reflector / lattice-outer positions.
u_water = openmc.Universe(name="water_col", cells=[openmc.Cell(fill=water, region=+ZP[Z_BOT] & -ZP[Z_TOP])])

# ===================== ASSEMBLY LATTICES =====================
# Each lattice element is a full-height AXIAL COLUMN universe.
# Per-assembly Pyrex BA (burnable-absorber) templates ported verbatim from the
# verified SCONE core: 6/12/15/16/20-rod Pyrex clusters in their real in-assembly
# positions. '.'=fuel  'G'=guide tube  'I'=instrument tube  'B'=Pyrex BA rod.
ASM_TEMPLATES = {
    "A16": [
        ".................",
        ".................",
        ".....G..G..G.....",
        "...G.........G...",
        ".................",
        "..G..G..G..G..G..",
        ".................",
        ".................",
        "..G..G..I..G..G..",
        ".................",
        ".................",
        "..G..G..G..G..G..",
        ".................",
        "...G.........G...",
        ".....G..G..G.....",
        ".................",
        ".................",
    ],
    "A24": [
        ".................",
        ".................",
        ".....G..G..G.....",
        "...G.........G...",
        ".................",
        "..G..G..G..G..G..",
        ".................",
        ".................",
        "..G..G..I..G..G..",
        ".................",
        ".................",
        "..G..G..G..G..G..",
        ".................",
        "...G.........G...",
        ".....G..G..G.....",
        ".................",
        ".................",
    ],
    "A31": [
        ".................",
        ".................",
        ".....G..G..G.....",
        "...G.........G...",
        ".................",
        "..G..G..G..G..G..",
        ".................",
        ".................",
        "..G..G..I..G..G..",
        ".................",
        ".................",
        "..G..G..G..G..G..",
        ".................",
        "...G.........G...",
        ".....G..G..G.....",
        ".................",
        ".................",
    ],
    "A24_BA12": [
        ".................",
        ".................",
        ".....B..G..B.....",
        "...B.........B...",
        ".................",
        "..B..G..G..G..B..",
        ".................",
        ".................",
        "..G..G..I..G..G..",
        ".................",
        ".................",
        "..B..G..G..G..B..",
        ".................",
        "...B.........B...",
        ".....B..G..B.....",
        ".................",
        ".................",
    ],
    "A24_BA16": [
        ".................",
        ".................",
        ".....B..B..B.....",
        "...B.........B...",
        ".................",
        "..B..G..G..G..B..",
        ".................",
        ".................",
        "..B..G..I..G..B..",
        ".................",
        ".................",
        "..B..G..G..G..B..",
        ".................",
        "...B.........B...",
        ".....B..B..B.....",
        ".................",
        ".................",
    ],
    "A31_BA16": [
        ".................",
        ".................",
        ".....B..B..B.....",
        "...B.........B...",
        ".................",
        "..B..G..G..G..B..",
        ".................",
        ".................",
        "..B..G..I..G..B..",
        ".................",
        ".................",
        "..B..G..G..G..B..",
        ".................",
        "...B.........B...",
        ".....B..B..B.....",
        ".................",
        ".................",
    ],
    "A31_BA20": [
        ".................",
        ".................",
        ".....B..B..B.....",
        "...B.........B...",
        ".................",
        "..B..B..G..B..B..",
        ".................",
        ".................",
        "..B..G..I..G..B..",
        ".................",
        ".................",
        "..B..B..G..B..B..",
        ".................",
        "...B.........B...",
        ".....B..B..B.....",
        ".................",
        ".................",
    ],
    "A31_BA6T": [
        ".................",
        ".................",
        ".....B..G..B.....",
        "...B.........B...",
        ".................",
        "..B..G..G..G..B..",
        ".................",
        ".................",
        "..G..G..I..G..G..",
        ".................",
        ".................",
        "..G..G..G..G..G..",
        ".................",
        "...G.........G...",
        ".....G..G..G.....",
        ".................",
        ".................",
    ],
    "A31_BA6B": [
        ".................",
        ".................",
        ".....G..G..G.....",
        "...G.........G...",
        ".................",
        "..G..G..G..G..G..",
        ".................",
        ".................",
        "..G..G..I..G..G..",
        ".................",
        ".................",
        "..B..G..G..G..B..",
        ".................",
        "...B.........B...",
        ".....B..G..B.....",
        ".................",
        ".................",
    ],
    "A31_BA6L": [
        ".................",
        ".................",
        ".....B..G..G.....",
        "...B.........G...",
        ".................",
        "..B..G..G..G..G..",
        ".................",
        ".................",
        "..G..G..I..G..G..",
        ".................",
        ".................",
        "..B..G..G..G..G..",
        ".................",
        "...B.........G...",
        ".....B..G..G.....",
        ".................",
        ".................",
    ],
    "A31_BA6R": [
        ".................",
        ".................",
        ".....G..G..B.....",
        "...G.........B...",
        ".................",
        "..G..G..G..G..B..",
        ".................",
        ".................",
        "..G..G..I..G..G..",
        ".................",
        ".................",
        "..G..G..G..G..B..",
        ".................",
        "...G.........B...",
        ".....G..G..B.....",
        ".................",
        ".................",
    ],
    "A31_BA15BR": [
        ".................",
        ".................",
        ".....B..B..B.....",
        "...B.........G...",
        ".................",
        "..B..B..B..B..G..",
        ".................",
        ".................",
        "..B..B..I..B..G..",
        ".................",
        ".................",
        "..B..B..B..B..G..",
        ".................",
        "...G.........G...",
        ".....G..G..G.....",
        ".................",
        ".................",
    ],
    "A31_BA15BL": [
        ".................",
        ".................",
        ".....B..B..B.....",
        "...G.........B...",
        ".................",
        "..G..B..B..B..B..",
        ".................",
        ".................",
        "..G..B..I..B..B..",
        ".................",
        ".................",
        "..G..B..B..B..B..",
        ".................",
        "...G.........G...",
        ".....G..G..G.....",
        ".................",
        ".................",
    ],
    "A31_BA15TR": [
        ".................",
        ".................",
        ".....G..G..G.....",
        "...G.........G...",
        ".................",
        "..B..B..B..B..G..",
        ".................",
        ".................",
        "..B..B..I..B..G..",
        ".................",
        ".................",
        "..B..B..B..B..G..",
        ".................",
        "...B.........G...",
        ".....B..B..B.....",
        ".................",
        ".................",
    ],
    "A31_BA15TL": [
        ".................",
        ".................",
        ".....G..G..G.....",
        "...G.........G...",
        ".................",
        "..G..B..B..B..B..",
        ".................",
        ".................",
        "..G..B..I..B..B..",
        ".................",
        ".................",
        "..G..B..B..B..B..",
        ".................",
        "...G.........B...",
        ".....B..B..B.....",
        ".................",
        ".................",
    ],
}


def _assembly(name, fuel_key, template):
    F = COL[fuel_key]
    pick = {"G": COL["gt"], "B": COL["ba"], "I": COL["it"]}
    lat = openmc.RectLattice(name=name)
    lat.lower_left = (-10.71, -10.71)
    lat.pitch = (1.26, 1.26)
    lat.outer = u_water
    lat.universes = [[pick.get(ch, F) for ch in row] for row in template]
    return openmc.Universe(name=name + "_u", cells=[openmc.Cell(fill=lat)])


# ===================== BAFFLE / FORMER UNIVERSES =====================
# SS304 plate bands (local |x|,|y| in [8.36662, 10.58912] cm) ported from the
# verified SCONE core; placed in the peripheral core-lattice positions.
_bxp = openmc.XPlane(8.36662);   _bxm = openmc.XPlane(-8.36662)
_bxP = openmc.XPlane(10.58912);  _bxM = openmc.XPlane(-10.58912)
_byp = openmc.YPlane(8.36662);   _bym = openmc.YPlane(-8.36662)
_byP = openmc.YPlane(10.58912);  _byM = openmc.YPlane(-10.58912)


def _baffle(name, ss_region):
    ss = openmc.Cell(fill=ss304, region=ss_region)
    wat = openmc.Cell(fill=water, region=~ss_region)
    ss.temperature = TEMP
    wat.temperature = TEMP
    return openmc.Universe(name=name, cells=[ss, wat])


BAF = {
    "baf_l": _baffle("baf_l", +_bxp & -_bxP),
    "baf_r": _baffle("baf_r", +_bxM & -_bxm),
    "baf_t": _baffle("baf_t", +_byM & -_bym),
    "baf_b": _baffle("baf_b", +_byp & -_byP),
    "baf_tl": _baffle("baf_tl", (+_bxM & -_bxm & -_byP) | (+_byp & -_byP & +_bxm)),
    "baf_tr": _baffle("baf_tr", (+_bxp & -_bxP & -_byP) | (+_byp & -_byP & -_bxp)),
    "baf_bl": _baffle("baf_bl", (+_bxM & -_bxm & +_byM) | (+_byM & -_bym & +_bxm)),
    "baf_br": _baffle("baf_br", (+_bxp & -_bxP & +_byM) | (+_byM & -_bym & -_bxp)),
    "sq_tl": _baffle("sq_tl", -_bxm & +_byp),
    "sq_tr": _baffle("sq_tr", +_bxp & +_byp),
    "sq_bl": _baffle("sq_bl", -_bxm & -_bym),
    "sq_br": _baffle("sq_br", +_bxp & -_bym),
}

asm_a16_u = _assembly("asm_a16", "f16", ASM_TEMPLATES["A16"])
asm_a24_u = _assembly("asm_a24", "f24", ASM_TEMPLATES["A24"])
asm_a31_u = _assembly("asm_a31", "f31", ASM_TEMPLATES["A31"])
asm_a24ba12_u = _assembly("asm_a24ba12", "f24", ASM_TEMPLATES["A24_BA12"])
asm_a24ba16_u = _assembly("asm_a24ba16", "f24", ASM_TEMPLATES["A24_BA16"])
asm_a31ba16_u = _assembly("asm_a31ba16", "f31", ASM_TEMPLATES["A31_BA16"])
asm_a31ba20_u = _assembly("asm_a31ba20", "f31", ASM_TEMPLATES["A31_BA20"])
asm_a31ba6t_u = _assembly("asm_a31ba6t", "f31", ASM_TEMPLATES["A31_BA6T"])
asm_a31ba6b_u = _assembly("asm_a31ba6b", "f31", ASM_TEMPLATES["A31_BA6B"])
asm_a31ba6l_u = _assembly("asm_a31ba6l", "f31", ASM_TEMPLATES["A31_BA6L"])
asm_a31ba6r_u = _assembly("asm_a31ba6r", "f31", ASM_TEMPLATES["A31_BA6R"])
asm_a31b15br_u = _assembly("asm_a31b15br", "f31", ASM_TEMPLATES["A31_BA15BR"])
asm_a31b15bl_u = _assembly("asm_a31b15bl", "f31", ASM_TEMPLATES["A31_BA15BL"])
asm_a31b15tr_u = _assembly("asm_a31b15tr", "f31", ASM_TEMPLATES["A31_BA15TR"])
asm_a31b15tl_u = _assembly("asm_a31b15tl", "f31", ASM_TEMPLATES["A31_BA15TL"])

# core lattice rows (top-first, matching SCONE)
ASM_U = {
    "A16": asm_a16_u,
    "A24": asm_a24_u,
    "A31": asm_a31_u,
    "A24_BA12": asm_a24ba12_u,
    "A24_BA16": asm_a24ba16_u,
    "A31_BA16": asm_a31ba16_u,
    "A31_BA20": asm_a31ba20_u,
    "A31_BA6T": asm_a31ba6t_u,
    "A31_BA6B": asm_a31ba6b_u,
    "A31_BA6L": asm_a31ba6l_u,
    "A31_BA6R": asm_a31ba6r_u,
    "A31_BA15BR": asm_a31b15br_u,
    "A31_BA15BL": asm_a31b15bl_u,
    "A31_BA15TR": asm_a31b15tr_u,
    "A31_BA15TL": asm_a31b15tl_u,
}

# ===================== CORE LATTICE =====================
core_lat = openmc.RectLattice(name="core")
core_lat.lower_left = (-182.78094, -182.78094)
core_lat.pitch = (21.50364, 21.50364)
core_lat.outer = u_water
W = u_water
core_lat.universes = [
    [W, W, W, W, BAF["sq_br"], BAF["baf_t"], BAF["baf_t"], BAF["baf_t"], BAF["baf_t"], BAF["baf_t"], BAF["baf_t"], BAF["baf_t"], BAF["sq_bl"], W, W, W, W],
    [W, W, BAF["sq_br"], BAF["baf_t"], BAF["baf_br"], ASM_U["A31"], ASM_U["A31_BA6B"], ASM_U["A31"], ASM_U["A31_BA6B"], ASM_U["A31"], ASM_U["A31_BA6B"], ASM_U["A31"], BAF["baf_bl"], BAF["baf_t"], BAF["sq_bl"], W, W],
    [W, BAF["sq_br"], BAF["baf_br"], ASM_U["A31"], ASM_U["A31"], ASM_U["A31_BA16"], ASM_U["A16"], ASM_U["A31_BA20"], ASM_U["A16"], ASM_U["A31_BA20"], ASM_U["A16"], ASM_U["A31_BA16"], ASM_U["A31"], ASM_U["A31"], BAF["baf_bl"], BAF["sq_bl"], W],
    [W, BAF["baf_l"], ASM_U["A31"], ASM_U["A31_BA15TL"], ASM_U["A24_BA16"], ASM_U["A16"], ASM_U["A24_BA16"], ASM_U["A16"], ASM_U["A24_BA16"], ASM_U["A16"], ASM_U["A24_BA16"], ASM_U["A16"], ASM_U["A24_BA16"], ASM_U["A31_BA15TR"], ASM_U["A31"], BAF["baf_r"], W],
    [BAF["sq_br"], BAF["baf_br"], ASM_U["A31"], ASM_U["A24_BA16"], ASM_U["A24"], ASM_U["A24_BA16"], ASM_U["A16"], ASM_U["A24_BA12"], ASM_U["A16"], ASM_U["A24_BA12"], ASM_U["A16"], ASM_U["A24_BA16"], ASM_U["A24"], ASM_U["A24_BA16"], ASM_U["A31"], BAF["baf_bl"], BAF["sq_bl"]],
    [BAF["baf_l"], ASM_U["A31"], ASM_U["A31_BA16"], ASM_U["A16"], ASM_U["A24_BA16"], ASM_U["A16"], ASM_U["A24_BA12"], ASM_U["A16"], ASM_U["A24_BA12"], ASM_U["A16"], ASM_U["A24_BA12"], ASM_U["A16"], ASM_U["A24_BA16"], ASM_U["A16"], ASM_U["A31_BA16"], ASM_U["A31"], BAF["baf_r"]],
    [BAF["baf_l"], ASM_U["A31_BA6R"], ASM_U["A16"], ASM_U["A24_BA16"], ASM_U["A16"], ASM_U["A24_BA12"], ASM_U["A16"], ASM_U["A24_BA12"], ASM_U["A16"], ASM_U["A24_BA12"], ASM_U["A16"], ASM_U["A24_BA12"], ASM_U["A16"], ASM_U["A24_BA16"], ASM_U["A16"], ASM_U["A31_BA6L"], BAF["baf_r"]],
    [BAF["baf_l"], ASM_U["A31"], ASM_U["A31_BA20"], ASM_U["A16"], ASM_U["A24_BA12"], ASM_U["A16"], ASM_U["A24_BA12"], ASM_U["A16"], ASM_U["A24_BA12"], ASM_U["A16"], ASM_U["A24_BA12"], ASM_U["A16"], ASM_U["A24_BA12"], ASM_U["A16"], ASM_U["A31_BA20"], ASM_U["A31"], BAF["baf_r"]],
    [BAF["baf_l"], ASM_U["A31_BA6R"], ASM_U["A16"], ASM_U["A24_BA16"], ASM_U["A16"], ASM_U["A24_BA12"], ASM_U["A16"], ASM_U["A24_BA12"], ASM_U["A16"], ASM_U["A24_BA12"], ASM_U["A16"], ASM_U["A24_BA12"], ASM_U["A16"], ASM_U["A24_BA16"], ASM_U["A16"], ASM_U["A31_BA6L"], BAF["baf_r"]],
    [BAF["baf_l"], ASM_U["A31"], ASM_U["A31_BA20"], ASM_U["A16"], ASM_U["A24_BA12"], ASM_U["A16"], ASM_U["A24_BA12"], ASM_U["A16"], ASM_U["A24_BA12"], ASM_U["A16"], ASM_U["A24_BA12"], ASM_U["A16"], ASM_U["A24_BA12"], ASM_U["A16"], ASM_U["A31_BA20"], ASM_U["A31"], BAF["baf_r"]],
    [BAF["baf_l"], ASM_U["A31_BA6R"], ASM_U["A16"], ASM_U["A24_BA16"], ASM_U["A16"], ASM_U["A24_BA12"], ASM_U["A16"], ASM_U["A24_BA12"], ASM_U["A16"], ASM_U["A24_BA12"], ASM_U["A16"], ASM_U["A24_BA12"], ASM_U["A16"], ASM_U["A24_BA16"], ASM_U["A16"], ASM_U["A31_BA6L"], BAF["baf_r"]],
    [BAF["baf_l"], ASM_U["A31"], ASM_U["A31_BA16"], ASM_U["A16"], ASM_U["A24_BA16"], ASM_U["A16"], ASM_U["A24_BA12"], ASM_U["A16"], ASM_U["A24_BA12"], ASM_U["A16"], ASM_U["A24_BA12"], ASM_U["A16"], ASM_U["A24_BA16"], ASM_U["A16"], ASM_U["A31_BA16"], ASM_U["A31"], BAF["baf_r"]],
    [BAF["sq_tr"], BAF["baf_tr"], ASM_U["A31"], ASM_U["A24_BA16"], ASM_U["A24"], ASM_U["A24_BA16"], ASM_U["A16"], ASM_U["A24_BA12"], ASM_U["A16"], ASM_U["A24_BA12"], ASM_U["A16"], ASM_U["A24_BA16"], ASM_U["A24"], ASM_U["A24_BA16"], ASM_U["A31"], BAF["baf_tl"], BAF["sq_tl"]],
    [W, BAF["baf_l"], ASM_U["A31"], ASM_U["A31_BA15BL"], ASM_U["A24_BA16"], ASM_U["A16"], ASM_U["A24_BA16"], ASM_U["A16"], ASM_U["A24_BA16"], ASM_U["A16"], ASM_U["A24_BA16"], ASM_U["A16"], ASM_U["A24_BA16"], ASM_U["A31_BA15BR"], ASM_U["A31"], BAF["baf_r"], W],
    [W, BAF["sq_tr"], BAF["baf_tr"], ASM_U["A31"], ASM_U["A31"], ASM_U["A31_BA16"], ASM_U["A16"], ASM_U["A31_BA20"], ASM_U["A16"], ASM_U["A31_BA20"], ASM_U["A16"], ASM_U["A31_BA16"], ASM_U["A31"], ASM_U["A31"], BAF["baf_tl"], BAF["sq_tl"], W],
    [W, W, BAF["sq_tr"], BAF["baf_b"], BAF["baf_tr"], ASM_U["A31"], ASM_U["A31_BA6T"], ASM_U["A31"], ASM_U["A31_BA6T"], ASM_U["A31"], ASM_U["A31_BA6T"], ASM_U["A31"], BAF["baf_tl"], BAF["baf_b"], BAF["sq_tl"], W, W],
    [W, W, W, W, BAF["sq_tr"], BAF["baf_b"], BAF["baf_b"], BAF["baf_b"], BAF["baf_b"], BAF["baf_b"], BAF["baf_b"], BAF["baf_b"], BAF["sq_tl"], W, W, W, W],
]

# ===================== RADIAL / AXIAL CONTAINMENT =====================
cyl_cb_in = openmc.ZCylinder(r=187.96)
cyl_cb_out = openmc.ZCylinder(r=193.675)
cyl_ns_in = openmc.ZCylinder(r=194.84)
cyl_ns_out = openmc.ZCylinder(r=201.630)
cyl_lin = openmc.ZCylinder(r=219.150)
cyl_rpv_in = openmc.ZCylinder(r=219.710)
cyl_rpv_out = openmc.ZCylinder(r=241.3, boundary_type="vacuum")
# Neutron-shield panel bounding planes (octant symmetry).
nsp1 = openmc.Plane(-0.48480962025, 0.87461970714, 0.0, 0.0)
nsp2 = openmc.Plane(-0.87461970714, 0.48480962025, 0.0, 0.0)
nsp3 = openmc.Plane(-0.87461970714, -0.48480962025, 0.0, 0.0)
nsp4 = openmc.Plane(-0.48480962025, -0.87461970714, 0.0, 0.0)
z_bot = ZP[Z_BOT]   # vacuum
z_top = ZP[Z_TOP]   # vacuum

core_cell = openmc.Cell(fill=core_lat, region=-cyl_cb_in & +z_bot & -z_top)
barrel = openmc.Cell(fill=ss304, region=+cyl_cb_in & -cyl_cb_out & +z_bot & -z_top)
wt_ns = openmc.Cell(fill=water, region=+cyl_cb_out & -cyl_ns_in & +z_bot & -z_top)
# 4 SS304 neutron-shield pads at the octant positions; water fills the rest.
_ns_ring = +cyl_ns_in & -cyl_ns_out & +z_bot & -z_top
_pads = (-nsp1 & +nsp2) | (+nsp1 & -nsp2) | (-nsp3 & +nsp4) | (+nsp3 & -nsp4)
ns1 = openmc.Cell(fill=ss304, region=_ns_ring & -nsp1 & +nsp2)
ns2 = openmc.Cell(fill=ss304, region=_ns_ring & +nsp1 & -nsp2)
ns3 = openmc.Cell(fill=ss304, region=_ns_ring & -nsp3 & +nsp4)
ns4 = openmc.Cell(fill=ss304, region=_ns_ring & +nsp3 & -nsp4)
ns_water = openmc.Cell(fill=water, region=_ns_ring & ~_pads)
down = openmc.Cell(fill=water, region=+cyl_ns_out & -cyl_lin & +z_bot & -z_top)
liner = openmc.Cell(fill=ss304, region=+cyl_lin & -cyl_rpv_in & +z_bot & -z_top)
rpv = openmc.Cell(fill=carbonsteel, region=+cyl_rpv_in & -cyl_rpv_out & +z_bot & -z_top)
root = openmc.Universe(cells=[core_cell, barrel, wt_ns, ns1, ns2, ns3, ns4,
                              ns_water, down, liner, rpv])
geometry = openmc.Geometry(root)

# ===================== SETTINGS + TALLIES =====================
settings = openmc.Settings()
settings.run_mode = "eigenvalue"
settings.batches = 250
settings.inactive = 50
settings.particles = 20000
settings.temperature = {"default": TEMP, "method": "interpolation"}
# Initial source: uniform over the active-fuel envelope (z 36.748 -> 402.508).
bounds_lo = [-182.78094, -182.78094, 36.748]
bounds_hi = [182.78094, 182.78094, 402.508]
settings.source = openmc.IndependentSource(
    space=openmc.stats.Box(bounds_lo, bounds_hi, only_fissionable=True)
)

# Pin-power-style mesh tally over the core footprint (17x17 assemblies),
# axially over the active fuel column.
mesh = openmc.RegularMesh()
mesh.dimension = [17, 17, 1]
mesh.lower_left = [-182.78094, -182.78094, 36.748]
mesh.upper_right = [182.78094, 182.78094, 402.508]
fission_tally = openmc.Tally(name="assembly_fission")
fission_tally.filters = [openmc.MeshFilter(mesh)]
fission_tally.scores = ["fission", "nu-fission"]
tallies = openmc.Tallies([fission_tally])

model = openmc.Model(geometry=geometry, materials=materials,
                     settings=settings, tallies=tallies)

if __name__ == "__main__":
    # Full-core eigenvalue is expensive: use many threads and converge.
    #   sp_path = model.run(threads=8)
    #   with openmc.StatePoint(sp_path) as sp:
    #       print("k-eff =", sp.keff)
    model.export_to_model_xml()
