# 17x17 PWR fuel assembly - OWEN OpenMC example fixture (viz / starter)
# =====================================================================
# Westinghouse-style 17x17 PWR assembly: 264 UO2 fuel pins + 25 guide/
# instrument tubes, 1.26 cm pitch, reflective outer boundary.
# Built from OWEN's `omc_assembly_script` snippet (OpenMC >= 0.13 API:
# IndependentSource, model.model.RectangularPrism class, model.run()).
# NOT a converged/validated benchmark - materials & geometry are
# physically sane but settings are nominal. Cross sections assumed from
# your configured OPENMC_CROSS_SECTIONS (e.g. ENDF/B-VII.1).
# =====================================================================
import openmc
import numpy as np

# --- Materials (shared) ---
uo2 = openmc.Material(name='UO2')
uo2.set_density('g/cm3', 10.97)
uo2.add_nuclide('U235', 0.040)
uo2.add_nuclide('U238', 0.960)
uo2.add_nuclide('O16', 2.000)

water = openmc.Material(name='Water')
water.set_density('g/cm3', 0.998)
water.add_nuclide('H1', 2.0)
water.add_nuclide('O16', 1.0)
water.add_s_alpha_beta('c_H_in_H2O')

zr = openmc.Material(name='Zircaloy')
zr.set_density('g/cm3', 6.56)
zr.add_element('Zr', 1.0)

materials = openmc.Materials([uo2, water, zr])

# --- Pin universes ---
def fuel_pin():
    fuel = openmc.ZCylinder(r=0.4095)
    clad = openmc.ZCylinder(r=0.4750)
    c1 = openmc.Cell(fill=uo2,   region=-fuel)
    c2 = openmc.Cell(fill=zr,    region=+fuel & -clad)
    c3 = openmc.Cell(fill=water, region=+clad)
    return openmc.Universe(cells=[c1, c2, c3])

def guide_tube():
    g = openmc.ZCylinder(r=0.6020)
    c1 = openmc.Cell(fill=water, region=-g)
    c2 = openmc.Cell(fill=water, region=+g)
    return openmc.Universe(cells=[c1, c2])

F = fuel_pin()
G = guide_tube()

# --- 17x17 lattice ---
lat = openmc.RectLattice(name='PWR-17x17')
lat.pitch = (1.26, 1.26)
lat.lower_left = (-10.71, -10.71)
univ_map = np.full((17, 17), F, dtype=object)
for (i, j) in [(2,5),(2,8),(2,11), (5,2),(5,5),(5,8),(5,11),(5,14),
               (8,2),(8,5),(8,8),(8,11),(8,14),
               (11,2),(11,5),(11,8),(11,11),(11,14),
               (14,5),(14,8),(14,11)]:
    univ_map[i, j] = G
lat.universes = univ_map.tolist()

box = openmc.model.RectangularPrism(width=17*1.26, height=17*1.26,
                                    boundary_type='reflective')
root = openmc.Cell(fill=lat, region=-box)
geometry = openmc.Geometry([root])

settings = openmc.Settings()
settings.batches = 150
settings.inactive = 50
settings.particles = 10000
settings.source = openmc.IndependentSource(
    space=openmc.stats.Box((-10.0, -10.0, -1.0), (10.0, 10.0, 1.0)),
    constraints={'fissionable': True},
)

model = openmc.model.Model(geometry, materials, settings)
sp_path = model.run(threads=4)
with openmc.StatePoint(sp_path) as sp:
    print('k-eff =', sp.keff)
