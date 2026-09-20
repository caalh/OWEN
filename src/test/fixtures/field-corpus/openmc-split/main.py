"""OpenMC model whose geometry lives in a sibling module (Cardinal / MSR style)."""
import openmc
from geometry import build_geometry

geom = build_geometry()
mats = geom.get_all_materials().values()
settings = openmc.Settings()
settings.batches = 20
settings.inactive = 5
settings.particles = 200
settings.source = openmc.IndependentSource(space=openmc.stats.Point((0.0, 0.0, 0.0)))
model = openmc.Model(geom, openmc.Materials(list(mats)), settings)
model.export_to_xml()
