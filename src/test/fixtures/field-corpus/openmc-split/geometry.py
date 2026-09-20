"""Geometry built in a helper module — the static pin-lattice extractor cannot
see a lattice literal in main.py, so without following the import (or reading
a sibling XML) OWEN used to draw a placeholder pin."""
import openmc

def build_geometry():
    fuel = openmc.Material(name='UO2')
    fuel.add_nuclide('U235', 0.04)
    fuel.add_nuclide('U238', 0.96)
    fuel.add_nuclide('O16', 2.0)
    fuel.set_density('g/cm3', 10.4)
    water = openmc.Material(name='water')
    water.add_nuclide('H1', 2.0)
    water.add_nuclide('O16', 1.0)
    water.set_density('g/cm3', 0.74)
    fuel_or = openmc.ZCylinder(r=0.40)
    clad_or = openmc.ZCylinder(r=0.45)
    box = openmc.model.RectangularPrism(1.26, 1.26, boundary_type='reflective')
    fuel_cell = openmc.Cell(fill=fuel, region=-fuel_or)
    clad_cell = openmc.Cell(fill=water, region=+fuel_or & -clad_or)
    mod_cell = openmc.Cell(fill=water, region=+clad_or & -box)
    pin = openmc.Universe(cells=[fuel_cell, clad_cell, mod_cell])
    return openmc.Geometry([openmc.Cell(fill=pin, region=-box)])
