#!/usr/bin/env bash
set -u
cp /mnt/c/Users/me/AppData/Local/Temp/beavrs_groves.py /tmp/bg.py
cd /tmp
timeout 180 /opt/miniconda3/bin/python - <<'EOF'
import runpy
g = runpy.run_path('/tmp/bg.py', run_name='x')
geom = g['geometry']
print('GROVES BEAVRS OK; cells:', len(geom.get_all_cells()),
      'universes:', len(geom.get_all_universes()),
      'materials:', len(geom.get_all_materials()),
      'lattices:', len(geom.get_all_lattices()))
EOF
