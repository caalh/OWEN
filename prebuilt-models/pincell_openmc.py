# BEAVRS 3.1 wt% UO2 pin cell, reflected (k-infinity) - OWEN teaching deck
# =====================================================================
# "Hello world" PWR pin cell: a single BEAVRS-spec fuel pin in a
# 1.26 cm square water cell with REFLECTIVE boundaries on all six
# faces, so the eigenvalue run converges to the infinite-lattice k-inf.
#
# GEOMETRY (BEAVRS rev 2.0.2 fuel pin):
#   fuel pellet r 0.39218 / clad inner r 0.40005 / clad outer r 0.45720
#   pin pitch 1.26 cm; active height 365.76 cm (z = 0 -> 365.76)
# MATERIALS: number densities identical to the BEAVRS full-core deck
#   (3.1 wt% UO2, He gap, Zircaloy-4, 975 ppm borated water, HFP 600 K).
#   Temperature is set on CELLS (modern OpenMC API), S(a,b) on water only.
# EXPECTED k-inf: 1.2256 +/- 0.0010 - RUN-VERIFIED with OpenMC 0.15.3 +
#   ENDF/B-VIII.0 HDF5 (neutron data at 600 K; the reference library only
#   carried c_H_in_H2O S(a,b) at 294 K, so expect an O(100 pcm) shift with
#   a hot thermal library), 250 batches x 5000 neutrons, leakage 0.0.
#   Other libraries/temperatures will differ by O(100s of pcm).
# =====================================================================
import openmc

# --- Materials (atoms/b-cm; ported from the verified BEAVRS deck) ---
fuel = openmc.Material(name="UO2-31")
fuel.set_density("atom/b-cm", 6.88510e-2)
fuel.add_nuclide("O16", 4.58530e-2, "ao")
fuel.add_nuclide("O17", 1.74200e-5, "ao")
fuel.add_nuclide("U234", 5.79870e-6, "ao")
fuel.add_nuclide("U235", 7.21750e-4, "ao")
fuel.add_nuclide("U238", 2.22530e-2, "ao")

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
water.add_nuclide("H2", 7.70350e-6, "ao")
water.add_nuclide("B10", 7.97140e-6, "ao")
water.add_nuclide("B11", 3.22470e-5, "ao")
water.add_nuclide("O16", 2.46730e-2, "ao")
water.add_nuclide("O17", 9.37340e-6, "ao")
water.add_s_alpha_beta("c_H_in_H2O")

materials = openmc.Materials([fuel, helium, zirc, water])

# --- Geometry: one pin, reflective 1.26 cm cell ---
fuel_or = openmc.ZCylinder(r=0.39218)
clad_ir = openmc.ZCylinder(r=0.40005)
clad_or = openmc.ZCylinder(r=0.45720)
box = openmc.model.RectangularPrism(width=1.26, height=1.26,
                                    boundary_type="reflective")
z_bot = openmc.ZPlane(z0=0.0, boundary_type="reflective")
z_top = openmc.ZPlane(z0=365.76, boundary_type="reflective")
axial = +z_bot & -z_top

c_fuel = openmc.Cell(name="fuel", fill=fuel, region=-fuel_or & axial)
c_gap = openmc.Cell(name="gap", fill=helium,
                    region=+fuel_or & -clad_ir & axial)
c_clad = openmc.Cell(name="clad", fill=zirc,
                     region=+clad_ir & -clad_or & axial)
c_water = openmc.Cell(name="water", fill=water,
                      region=+clad_or & -box & axial)
for c in (c_fuel, c_gap, c_clad, c_water):
    c.temperature = 600.0

geometry = openmc.Geometry([c_fuel, c_gap, c_clad, c_water])

# --- Settings ---
settings = openmc.Settings()
settings.batches = 250
settings.inactive = 50
settings.particles = 5000
settings.temperature = {"method": "interpolation"}
settings.source = openmc.IndependentSource(
    space=openmc.stats.Point((0.0, 0.0, 182.88)),
)

model = openmc.model.Model(geometry, materials, settings)
sp_path = model.run(threads=4)
with openmc.StatePoint(sp_path) as sp:
    print("k-inf =", sp.keff)
