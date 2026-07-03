#!/usr/bin/env bash
set -u
/opt/miniconda3/bin/python - <<'EOF'
# mirror openmc.Geometry.from_xml_element's child_of logic exactly
from collections import defaultdict
import openmc
import xml.etree.ElementTree as ET
import openmc._xml as xml

tree = ET.parse('/tmp/owen-gauntlet/model.xml')
root = tree.getroot()
elem = root.find('geometry')
mats_xml = root.find('materials')
mats = openmc.Materials.from_xml_element(mats_xml) if mats_xml is not None else openmc.Materials()
mdict = {str(m.id): m for m in mats}
mdict['void'] = None

universes = {}
def get_universe(univ_id):
    if univ_id not in universes:
        universes[univ_id] = openmc.Universe(univ_id)
    return universes[univ_id]

surfaces = {}
for surface in elem.findall('surface'):
    s = openmc.Surface.from_xml_element(surface)
    surfaces[s.id] = s

child_of = defaultdict(list)

for e in elem.findall('lattice'):
    lat = openmc.RectLattice.from_xml_element(e, get_universe)
    universes[lat.id] = lat
    if lat.outer is not None:
        child_of[lat.outer].append(lat)
    for u in lat.universes.ravel():
        child_of[u].append(lat)

for e in elem.findall('hex_lattice'):
    lat = openmc.HexLattice.from_xml_element(e, get_universe)
    universes[lat.id] = lat
    if lat.outer is not None:
        child_of[lat.outer].append(lat)
    if lat.ndim == 2:
        for ring in lat.universes:
            for u in ring:
                child_of[u].append(lat)
    else:
        for sl in lat.universes:
            for ring in sl:
                for u in ring:
                    child_of[u].append(lat)

for e in elem.findall('cell'):
    c = openmc.Cell.from_xml_element(e, surfaces, mdict, get_universe)
    if c.fill_type in ('universe', 'lattice'):
        child_of[c.fill].append(c)

orphans = [u for u in universes.values() if not child_of[u]]
print('total universes:', len(universes))
print('orphans:', [(u.id, type(u).__name__) for u in orphans])
EOF
