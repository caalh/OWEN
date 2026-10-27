#!/usr/bin/env bash
# BEAVRS conversion gauntlet (runs inside WSL; real OpenMC at /opt/miniconda3).
# Usage: gauntlet.sh <converted_beavrs.py windows-temp name>
set -u
PY=/opt/miniconda3/bin/python
SRC="/mnt/c/Users/${USER}/AppData/Local/Temp/${1:-beavrs_conv.py}"
WORK=/tmp/owen-gauntlet
mkdir -p "$WORK"
cp "$SRC" "$WORK/deck.py"
cd "$WORK"

echo "== 1. ast.parse =="
$PY - <<'EOF'
import ast
ast.parse(open('/tmp/owen-gauntlet/deck.py').read())
print('AST OK')
EOF

echo "== 2. execute deck + geometry stats =="
$PY - <<'EOF'
import runpy, sys
sys.path.insert(0, '/tmp/owen-gauntlet')
g = runpy.run_path('/tmp/owen-gauntlet/deck.py', run_name='not_main')
geom = g['geometry']
mats = g['materials']
cells = geom.get_all_cells()
surfs = geom.get_all_surfaces()
unis = geom.get_all_universes()
lats = geom.get_all_lattices()
print('cells:', len(cells))
print('surfaces:', len(surfs))
print('materials:', len(mats))
print('universes:', len(unis))
print('lattices:', len(lats))
bb = geom.bounding_box
print('bbox:', bb.lower_left, bb.upper_right)
EOF

echo "== 3. export + Model.from_model_xml =="
$PY - <<'EOF'
import runpy, sys, os
import openmc
sys.path.insert(0, '/tmp/owen-gauntlet')
os.chdir('/tmp/owen-gauntlet')
g = runpy.run_path('/tmp/owen-gauntlet/deck.py', run_name='not_main')
model = g['model']
model.export_to_model_xml('/tmp/owen-gauntlet/model.xml')
print('export OK')
m2 = openmc.Model.from_model_xml('/tmp/owen-gauntlet/model.xml')
print('from_model_xml OK; cells:', len(m2.geometry.get_all_cells()),
      'universes:', len(m2.geometry.get_all_universes()),
      'lattices:', len(m2.geometry.get_all_lattices()))
EOF

echo "== 4. point sampling vs native deck =="
OWEN_NATIVE="$(cd "$(dirname "$0")/.." && pwd)/prebuilt-models/beavrs_fullcore_openmc.py"
export OWEN_NATIVE
$PY - <<'EOF'
import os, runpy, sys, math, random
sys.path.insert(0, '/tmp/owen-gauntlet')
conv = runpy.run_path('/tmp/owen-gauntlet/deck.py', run_name='not_main')
nat = runpy.run_path(os.environ['OWEN_NATIVE'], run_name='not_main')
gc, gn = conv['geometry'], nat['geometry']
random.seed(42)
pts = []
for _ in range(4000):
    r = random.uniform(0, 240)
    th = random.uniform(0, 2 * math.pi)
    z = random.uniform(0.5, 459.5)
    pts.append((r * math.cos(th), r * math.sin(th), z))
def mat_at(geom, p):
    r = geom.find(p)
    if not r:
        return None
    fill = getattr(r[-1], 'fill', None)
    return fill if isinstance(fill, __import__('openmc').Material) else None

def rho(m):
    if m is None:
        return None
    return m.get_mass_density()

presence = 0
density = 0
checked = 0
diffs = {}
for p in pts:
    try:
        mc, mn = mat_at(gc, p), mat_at(gn, p)
    except Exception as e:
        print('find error at', p, e)
        continue
    checked += 1
    if (mc is None) != (mn is None):
        presence += 1
        key = (getattr(mc, 'name', 'void'), getattr(mn, 'name', 'void'))
        diffs[key] = diffs.get(key, 0) + 1
    elif mc is not None:
        rc, rn = rho(mc), rho(mn)
        if abs(rc - rn) > 0.02 * max(rc, rn, 1e-9):
            density += 1
            key = (f'{mc.name}:{rc:.4f}', f'{mn.name}:{rn:.4f}')
            diffs[key] = diffs.get(key, 0) + 1
print('sampled:', checked, 'material-presence mismatches:', presence,
      'density mismatches (>2%):', density)
for k, v in sorted(diffs.items(), key=lambda x: -x[1])[:15]:
    print('  ', k, v)
EOF
echo "== 5. transport smoke (100 particles, 2 batches) =="
$PY - <<'EOF'
import runpy, sys, os
import openmc
os.environ['OPENMC_CROSS_SECTIONS'] = '/opt/openmc-data/cross_sections.xml'
os.environ['PATH'] = '/opt/miniconda3/bin:' + os.environ.get('PATH', '')
sys.path.insert(0, '/tmp/owen-gauntlet')
os.chdir('/tmp/owen-gauntlet')
g = runpy.run_path('/tmp/owen-gauntlet/deck.py', run_name='not_main')
model = g['model']

# The local XS library is a slim pin-cell set; strip nuclides it lacks.
# Composition changes do NOT affect geometry tracking, which is what this
# smoke test is for (lost particles reveal overlaps/undefined regions).
import xml.etree.ElementTree as ET
avail = set()
for lib in ET.parse('/opt/openmc-data/cross_sections.xml').getroot():
    for m in lib.get('materials', '').split():
        avail.add(m)
stripped = set()
for mat in model.materials:
    present = [(n, f, t) for (n, f, t) in [(nd[0], nd[1], nd[2]) for nd in mat.nuclides] if n in avail]
    dropped = [nd[0] for nd in mat.nuclides if nd[0] not in avail]
    if dropped:
        stripped.update(dropped)
        d_units = mat.density_units
        d = mat.density
        for n in list({nd[0] for nd in mat.nuclides}):
            mat.remove_nuclide(n)
        if present:
            for (n, f, t) in present:
                mat.add_nuclide(n, f, t)
        else:
            mat.add_nuclide('O16', 1.0)
        mat.set_density(d_units, d)
    mat._sab = [s for s in mat._sab if s[0] in avail]
print('stripped nuclides (slim XS library):', ' '.join(sorted(stripped)) or 'none')

model.settings.batches = 2
model.settings.inactive = 1
model.settings.particles = 100
model.settings.max_lost_particles = 50
model.settings.verbosity = 3
try:
    sp = model.run(threads=4)
    print('TRANSPORT OK ->', sp)
except Exception as e:
    print('TRANSPORT FAILED:', e)
EOF
echo "== gauntlet done =="
