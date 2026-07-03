#!/usr/bin/env bash
set -u
cp /mnt/c/Users/me/AppData/Local/Temp/surf_zoo.py /tmp/zoo.py
cd /tmp
/opt/miniconda3/bin/python - <<'EOF'
import runpy
g = runpy.run_path('/tmp/zoo.py', run_name='not_main')
geom = g['geometry']
print('zoo OK; cells:', len(geom.get_all_cells()), 'surfaces:', len(geom.get_all_surfaces()))
bb = g['cell_1'].region.bounding_box
print('cell_1 bbox:', bb)
EOF
