#!/usr/bin/env bash
set -u
PY=/opt/miniconda3/bin/python
$PY - <<'EOF'
import runpy
g = runpy.run_path('/mnt/c/Users/me/GitHub/BD-worktree-converter/owen/prebuilt-models/beavrs_fullcore_openmc.py', run_name='not_main')
geom = g['geometry']
print('NATIVE cells:', len(geom.get_all_cells()))
print('NATIVE surfaces:', len(geom.get_all_surfaces()))
print('NATIVE materials:', len(g['materials']))
print('NATIVE universes:', len(geom.get_all_universes()))
print('NATIVE lattices:', len(geom.get_all_lattices()))
bb = geom.bounding_box
print('NATIVE bbox:', bb.lower_left, bb.upper_right)
EOF
echo "== XS check =="
ls /opt/miniconda3/share 2>/dev/null | head -5
env | grep -i openmc || true
for d in /opt/openmc-data /root/openmc-data /home/*/openmc-data /opt/miniconda3/endfb*; do
  [ -e "$d" ] && echo "found: $d"
done
[ -n "${OPENMC_CROSS_SECTIONS:-}" ] && echo "OPENMC_CROSS_SECTIONS=$OPENMC_CROSS_SECTIONS"
find / -maxdepth 3 -name 'cross_sections.xml' 2>/dev/null | head -5
