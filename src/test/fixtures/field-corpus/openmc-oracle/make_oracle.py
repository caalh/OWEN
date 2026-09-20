"""Build OpenMC lattices with a unique material per element and record what
openmc.Geometry.find() says at random points. Pure Python (no cross sections,
no transport). Output: <case>/geometry.xml, materials.xml, oracle.json.

Run under WSL:  /opt/miniconda3/bin/python make_hex_oracle.py <outdir>
"""
import json, os, random, sys
import openmc

out_root = sys.argv[1]
random.seed(20260919)


def mat(mid, name):
    m = openmc.Material(material_id=mid, name=name)
    m.add_nuclide('H1', 1.0)
    m.set_density('g/cm3', 1.0)
    return m


def uni_with_mat(uid, m):
    c = openmc.Cell(cell_id=uid, fill=m)
    return openmc.Universe(universe_id=uid, cells=[c])


def write_case(name, geometry, materials, box, n=4000):
    d = os.path.join(out_root, name)
    os.makedirs(d, exist_ok=True)
    geometry.export_to_xml(os.path.join(d, 'geometry.xml'))
    openmc.Materials(materials).export_to_xml(os.path.join(d, 'materials.xml'))
    pts = []
    for _ in range(n):
        p = [random.uniform(box[0][0], box[0][1]), random.uniform(box[1][0], box[1][1]), random.uniform(box[2][0], box[2][1])]
        try:
            path = geometry.find(p)
        except Exception:
            path = []
        last = path[-1] if path else None
        if last is None or getattr(last, 'fill', None) is None:
            mid = None
        else:
            f = last.fill
            mid = f.id if isinstance(f, openmc.Material) else None
        pts.append([round(p[0], 6), round(p[1], 6), round(p[2], 6), mid])
    with open(os.path.join(d, 'oracle.json'), 'w') as fh:
        json.dump({'case': name, 'points': pts}, fh)
    print(name, 'written', len(pts))


def hex_case(name, orientation, rings, n_axial=None):
    mats = []
    unis = []
    next_id = 100
    # universes[ring][i] outermost first; make each element unique
    per_level = []
    levels = n_axial or 1
    for z in range(levels):
        ringlist = []
        for r in range(rings):
            count = 6 * (rings - 1 - r) if r < rings - 1 else 1
            row = []
            for i in range(count):
                m = mat(next_id, f'm{next_id}')
                mats.append(m)
                u = uni_with_mat(next_id, m)
                unis.append(u)
                row.append(u)
                next_id += 1
            ringlist.append(row)
        per_level.append(ringlist)
    outer_m = mat(9, 'outer')
    mats.append(outer_m)
    outer_u = uni_with_mat(9, outer_m)
    lat = openmc.HexLattice(lattice_id=50)
    lat.orientation = orientation
    lat.center = (0.3, -0.2) if n_axial is None else (0.3, -0.2, 1.0)
    lat.pitch = (1.5,) if n_axial is None else (1.5, 4.0)
    lat.outer = outer_u
    lat.universes = per_level[0] if n_axial is None else per_level
    world_m = mat(8, 'world')
    mats.append(world_m)
    sph = openmc.Sphere(r=40.0, boundary_type='vacuum')
    root = openmc.Cell(cell_id=1, fill=lat, region=-sph)
    geom = openmc.Geometry(openmc.Universe(universe_id=0, cells=[root]))
    half = 1.5 * rings + 1.0
    zr = (-8.0, 10.0) if n_axial else (-1.0, 1.0)
    write_case(name, geom, mats, ((-half, half), (-half, half), zr))


def rect_case():
    mats = []
    nx, ny, nz = 3, 2, 2
    grid = []
    next_id = 200
    for z in range(nz):
        rows = []
        for y in range(ny):
            row = []
            for x in range(nx):
                m = mat(next_id, f'm{next_id}')
                mats.append(m)
                row.append(uni_with_mat(next_id, m))
                next_id += 1
            rows.append(row)
        grid.append(rows)
    outer_m = mat(9, 'outer')
    mats.append(outer_m)
    lat = openmc.RectLattice(lattice_id=60)
    lat.lower_left = (-3.0, -2.0, -4.0)
    lat.pitch = (2.0, 2.0, 4.0)
    lat.outer = uni_with_mat(9, outer_m)
    lat.universes = grid
    sph = openmc.Sphere(r=30.0, boundary_type='vacuum')
    root = openmc.Cell(cell_id=1, fill=lat, region=-sph)
    geom = openmc.Geometry(openmc.Universe(universe_id=0, cells=[root]))
    write_case('rect3d', geom, mats, ((-5, 5), (-4, 4), (-6, 6)))


hex_case('hex_y_3rings', 'y', 3)
hex_case('hex_x_3rings', 'x', 3)
hex_case('hex_y_2rings_axial3', 'y', 2, n_axial=3)
rect_case()
