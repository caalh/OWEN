// Pure-Python OpenMC tracing harness (no OpenMC installation required).
//
// TRACE_HARNESS_PY is written to a temp file and run as:
//     python owen_trace_openmc.py <deck.py> <out.json>
// It installs a stub `openmc` package into sys.modules, executes the deck via
// runpy, and dumps the TracedModel JSON (see tracedModel.ts) that
// emitMcnpFromTrace() converts to an MCNP deck. This handles scripts the
// static parser cannot (functions, loops, comprehensions — e.g. the native
// BEAVRS full-core deck). Keep the JSON schema in sync with tracedModel.ts
// and with the GROVES copy (groves/src/groves/owen_trace_openmc.py).

export const TRACE_HARNESS_PY = String.raw`#!/usr/bin/env python3
# OWEN OpenMC trace harness (BelvoirDynamics). Pure Python, ASCII only.
# Usage: python owen_trace_openmc.py <deck.py> <out.json>
import sys, json, math, runpy, types

SURFACES = []
MATERIALS = []
CELLS = []
UNIVERSES = []
LATTICES = []
STATE = {'root': None, 'root_cells': [], 'settings': None}
TALLY_LIST = []
WARNINGS = []

_IDS = {'surface': 0, 'material': 0, 'cell': 0, 'universe': 0, 'lattice': 0}

def _next_id(kind, given=None):
    if given is not None:
        try:
            g = int(given)
            _IDS[kind] = max(_IDS[kind], g)
            return g
        except (TypeError, ValueError):
            pass
    _IDS[kind] += 1
    return _IDS[kind]

# ---------------- regions ----------------
class Region(object):
    def __and__(self, other):
        return Intersection([self, other])
    def __rand__(self, other):
        return Intersection([other, self])
    def __or__(self, other):
        return Union([self, other])
    def __ror__(self, other):
        return Union([other, self])
    def __invert__(self):
        return Complement(self)

class Halfspace(Region):
    def __init__(self, surface, side):
        self.surface = surface
        self.side = side

class Intersection(Region):
    def __init__(self, nodes):
        flat = []
        for n in nodes:
            if isinstance(n, Intersection):
                flat.extend(n.nodes)
            elif n is not None:
                flat.append(n)
        self.nodes = flat

class Union(Region):
    def __init__(self, nodes):
        flat = []
        for n in nodes:
            if isinstance(n, Union):
                flat.extend(n.nodes)
            elif n is not None:
                flat.append(n)
        self.nodes = flat

class Complement(Region):
    def __init__(self, node):
        self.node = node

def region_json(r):
    if r is None:
        return None
    if isinstance(r, Halfspace):
        return {'k': 'h', 's': r.surface.id, 'side': r.side}
    if isinstance(r, Intersection):
        return {'k': '&', 'c': [region_json(n) for n in r.nodes]}
    if isinstance(r, Union):
        return {'k': '|', 'c': [region_json(n) for n in r.nodes]}
    if isinstance(r, Complement):
        return {'k': '~', 'c': region_json(r.node)}
    WARNINGS.append('unknown region node %r treated as None' % (r,))
    return None

# ---------------- surfaces ----------------
class Surface(Region):
    def __init__(self, mcnp_type, coeffs, surface_id=None, boundary_type='transmission', name='', albedo=1.0):
        self.id = _next_id('surface', surface_id)
        self.type = mcnp_type
        self.coeffs = [float(c) for c in coeffs]
        self.boundary_type = boundary_type
        self.name = name
        SURFACES.append(self)
    def __neg__(self):
        return Halfspace(self, -1)
    def __pos__(self):
        return Halfspace(self, 1)

def _kw(kwargs):
    return {
        'surface_id': kwargs.pop('surface_id', None),
        'boundary_type': kwargs.pop('boundary_type', 'transmission'),
        'name': kwargs.pop('name', ''),
        'albedo': kwargs.pop('albedo', 1.0),
    }

def XPlane(x0=0.0, **kw):
    return Surface('px', [x0], **_kw(kw))
def YPlane(y0=0.0, **kw):
    return Surface('py', [y0], **_kw(kw))
def ZPlane(z0=0.0, **kw):
    return Surface('pz', [z0], **_kw(kw))
def Plane(a=1.0, b=0.0, c=0.0, d=0.0, **kw):
    return Surface('p', [a, b, c, d], **_kw(kw))
def Sphere(x0=0.0, y0=0.0, z0=0.0, r=1.0, **kw):
    if x0 == 0.0 and y0 == 0.0 and z0 == 0.0:
        return Surface('so', [r], **_kw(kw))
    return Surface('s', [x0, y0, z0, r], **_kw(kw))
def XCylinder(y0=0.0, z0=0.0, r=1.0, **kw):
    if y0 == 0.0 and z0 == 0.0:
        return Surface('cx', [r], **_kw(kw))
    return Surface('c/x', [y0, z0, r], **_kw(kw))
def YCylinder(x0=0.0, z0=0.0, r=1.0, **kw):
    if x0 == 0.0 and z0 == 0.0:
        return Surface('cy', [r], **_kw(kw))
    return Surface('c/y', [x0, z0, r], **_kw(kw))
def ZCylinder(x0=0.0, y0=0.0, r=1.0, **kw):
    if x0 == 0.0 and y0 == 0.0:
        return Surface('cz', [r], **_kw(kw))
    return Surface('c/z', [x0, y0, r], **_kw(kw))
def XCone(x0=0.0, y0=0.0, z0=0.0, r2=1.0, **kw):
    if y0 == 0.0 and z0 == 0.0:
        return Surface('kx', [x0, r2], **_kw(kw))
    return Surface('k/x', [x0, y0, z0, r2], **_kw(kw))
def YCone(x0=0.0, y0=0.0, z0=0.0, r2=1.0, **kw):
    if x0 == 0.0 and z0 == 0.0:
        return Surface('ky', [y0, r2], **_kw(kw))
    return Surface('k/y', [x0, y0, z0, r2], **_kw(kw))
def ZCone(x0=0.0, y0=0.0, z0=0.0, r2=1.0, **kw):
    if x0 == 0.0 and y0 == 0.0:
        return Surface('kz', [z0, r2], **_kw(kw))
    return Surface('k/z', [x0, y0, z0, r2], **_kw(kw))
def Quadric(a=0.0, b=0.0, c=0.0, d=0.0, e=0.0, f=0.0, g=0.0, h=0.0, j=0.0, k=0.0, **kw):
    return Surface('gq', [a, b, c, d, e, f, g, h, j, k], **_kw(kw))
def XTorus(x0=0.0, y0=0.0, z0=0.0, a=0.0, b=0.0, c=0.0, **kw):
    return Surface('tx', [x0, y0, z0, a, b, c], **_kw(kw))
def YTorus(x0=0.0, y0=0.0, z0=0.0, a=0.0, b=0.0, c=0.0, **kw):
    return Surface('ty', [x0, y0, z0, a, b, c], **_kw(kw))
def ZTorus(x0=0.0, y0=0.0, z0=0.0, a=0.0, b=0.0, c=0.0, **kw):
    return Surface('tz', [x0, y0, z0, a, b, c], **_kw(kw))

# ---------------- composite surfaces (openmc.model) ----------------
class _Composite(Region):
    """Expands to primitive surfaces; unary - is 'inside', ~(-x) is outside."""
    def __init__(self, inside):
        self._inside = inside
    def __neg__(self):
        return self._inside
    def __pos__(self):
        return Complement(self._inside)
    def __invert__(self):
        return Complement(self._inside)

def RectangularPrism(width=1.0, height=1.0, axis='z', origin=(0.0, 0.0), boundary_type='transmission', corner_radius=0.0, **kw):
    ox, oy = origin[0], origin[1]
    if corner_radius:
        WARNINGS.append('RectangularPrism corner_radius ignored')
    b = {'boundary_type': boundary_type}
    if axis == 'z':
        s1 = XPlane(ox - width / 2.0, **b); s2 = XPlane(ox + width / 2.0, **b)
        s3 = YPlane(oy - height / 2.0, **b); s4 = YPlane(oy + height / 2.0, **b)
    elif axis == 'y':
        s1 = XPlane(ox - width / 2.0, **b); s2 = XPlane(ox + width / 2.0, **b)
        s3 = ZPlane(oy - height / 2.0, **b); s4 = ZPlane(oy + height / 2.0, **b)
    else:
        s1 = YPlane(ox - width / 2.0, **b); s2 = YPlane(ox + width / 2.0, **b)
        s3 = ZPlane(oy - height / 2.0, **b); s4 = ZPlane(oy + height / 2.0, **b)
    return _Composite(Intersection([+s1, -s2, +s3, -s4]))

def rectangular_prism(width=1.0, height=1.0, axis='z', origin=(0.0, 0.0), boundary_type='transmission', corner_radius=0.0, **kw):
    return -RectangularPrism(width, height, axis, origin, boundary_type, corner_radius)

def RectangularParallelepiped(xmin, xmax, ymin, ymax, zmin, zmax, boundary_type='transmission', **kw):
    b = {'boundary_type': boundary_type}
    s = [XPlane(xmin, **b), XPlane(xmax, **b), YPlane(ymin, **b), YPlane(ymax, **b), ZPlane(zmin, **b), ZPlane(zmax, **b)]
    return _Composite(Intersection([+s[0], -s[1], +s[2], -s[3], +s[4], -s[5]]))

def RightCircularCylinder(center_base, height, radius, axis='z', boundary_type='transmission', **kw):
    x0, y0, z0 = center_base
    b = {'boundary_type': boundary_type}
    if axis == 'z':
        cyl = ZCylinder(x0, y0, radius, **b)
        lo = ZPlane(z0, **b); hi = ZPlane(z0 + height, **b)
    elif axis == 'y':
        cyl = YCylinder(x0, z0, radius, **b)
        lo = YPlane(y0, **b); hi = YPlane(y0 + height, **b)
    else:
        cyl = XCylinder(y0, z0, radius, **b)
        lo = XPlane(x0, **b); hi = XPlane(x0 + height, **b)
    return _Composite(Intersection([-cyl, +lo, -hi]))

def HexagonalPrism(edge_length=1.0, orientation='y', origin=(0.0, 0.0), boundary_type='transmission', **kw):
    a = edge_length * math.sqrt(3.0) / 2.0  # apothem
    ox, oy = origin[0], origin[1]
    b = {'boundary_type': boundary_type}
    base = 0.0 if orientation == 'x' else 30.0
    halves = []
    for i in range(6):
        ang = math.radians(base + 60.0 * i)
        nx, ny = math.cos(ang), math.sin(ang)
        d = a + nx * ox + ny * oy
        halves.append(-Plane(nx, ny, 0.0, d, **b))
    return _Composite(Intersection(halves))

def _cone_one_sided(cone_fn, plane_fn, apex_coord, up, x0, y0, z0, r2, boundary_type):
    b = {'boundary_type': boundary_type}
    cone = cone_fn(x0, y0, z0, r2, **b)
    plane = plane_fn(apex_coord, **b)
    if up:
        return _Composite(Intersection([-cone, +plane]))
    return _Composite(Intersection([-cone, -plane]))

def XConeOneSided(x0=0.0, y0=0.0, z0=0.0, r2=1.0, up=True, boundary_type='transmission', **kw):
    return _cone_one_sided(XCone, XPlane, x0, up, x0, y0, z0, r2, boundary_type)
def YConeOneSided(x0=0.0, y0=0.0, z0=0.0, r2=1.0, up=True, boundary_type='transmission', **kw):
    return _cone_one_sided(YCone, YPlane, y0, up, x0, y0, z0, r2, boundary_type)
def ZConeOneSided(x0=0.0, y0=0.0, z0=0.0, r2=1.0, up=True, boundary_type='transmission', **kw):
    return _cone_one_sided(ZCone, ZPlane, z0, up, x0, y0, z0, r2, boundary_type)

# ---------------- materials ----------------
class Material(object):
    def __init__(self, material_id=None, name='', temperature=None):
        self.id = _next_id('material', material_id)
        self.name = name or ('material %d' % self.id)
        self.temperature = temperature
        self.density = None
        self.nuclides = []
        self.elements = []
        self.sab = []
        self.volume = None
        self.depletable = False
        MATERIALS.append(self)
    def add_nuclide(self, name, fraction, percent_type='ao'):
        self.nuclides.append({'name': name, 'frac': float(fraction), 'type': percent_type})
    def add_element(self, name, fraction, percent_type='ao', enrichment=None, **kw):
        self.elements.append({'name': name, 'frac': float(fraction), 'type': percent_type,
                              'enrichment': (float(enrichment) if enrichment is not None else None)})
    def add_elements_from_formula(self, formula, percent_type='ao', **kw):
        WARNINGS.append('add_elements_from_formula(%r) not expanded' % formula)
    def set_density(self, units, density=None):
        self.density = {'units': units, 'value': (float(density) if density is not None else 0.0)}
    def add_s_alpha_beta(self, name, fraction=1.0):
        self.sab.append(name)

class Materials(list):
    def __init__(self, materials=None):
        list.__init__(self, materials or [])
    def append(self, m):
        list.append(self, m)
    def export_to_xml(self, *a, **k):
        pass

# ---------------- cells / universes / lattices ----------------
class Cell(object):
    def __init__(self, cell_id=None, name='', fill=None, region=None):
        self.id = _next_id('cell', cell_id)
        self.name = name
        self.fill = fill
        self.region = region
        self.temperature = None
        self.translation = None
        self.rotation = None
        CELLS.append(self)

class UniverseBase(object):
    pass

class Universe(UniverseBase):
    def __init__(self, universe_id=None, name='', cells=None):
        self.id = _next_id('universe', universe_id)
        self.name = name
        self.cells = list(cells or [])
        UNIVERSES.append(self)
    def add_cell(self, cell):
        self.cells.append(cell)
    def add_cells(self, cells):
        self.cells.extend(cells)

class RectLattice(UniverseBase):
    def __init__(self, lattice_id=None, name=''):
        self.id = _next_id('lattice', lattice_id)
        self.name = name
        self.lower_left = None
        self.pitch = None
        self.outer = None
        self.universes = None
        LATTICES.append(self)

class HexLattice(UniverseBase):
    def __init__(self, lattice_id=None, name=''):
        self.id = _next_id('lattice', lattice_id)
        self.name = name
        self.center = (0.0, 0.0)
        self.pitch = None
        self.outer = None
        self.orientation = 'y'
        self.universes = None
        LATTICES.append(self)

class Geometry(object):
    def __init__(self, root=None):
        self.root = root
        if isinstance(root, Universe):
            STATE['root'] = root
        elif root is not None:
            try:
                STATE['root_cells'] = [c for c in root if isinstance(c, Cell)]
            except TypeError:
                pass
    def export_to_xml(self, *a, **k):
        pass

# ---------------- settings / sources / tallies ----------------
class _Point(object):
    def __init__(self, xyz=(0.0, 0.0, 0.0)):
        self.xyz = [float(v) for v in xyz]

class _Box(object):
    def __init__(self, lower_left, upper_right, only_fissionable=False):
        self.lo = [float(v) for v in lower_left]
        self.hi = [float(v) for v in upper_right]

stats = types.ModuleType('openmc.stats')
stats.Point = _Point
stats.Box = _Box

class IndependentSource(object):
    def __init__(self, space=None, **kw):
        self.space = space

Source = IndependentSource

class Settings(object):
    def __init__(self):
        self.run_mode = 'eigenvalue'
        self.batches = None
        self.inactive = None
        self.particles = None
        self.source = None
        self.temperature = None
        STATE['settings'] = self
    def export_to_xml(self, *a, **k):
        pass

class RegularMesh(object):
    def __init__(self, mesh_id=None, name=''):
        self.dimension = None
        self.lower_left = None
        self.upper_right = None

Mesh = RegularMesh

class MeshFilter(object):
    def __init__(self, mesh, **kw):
        self.mesh = mesh

class CellFilter(object):
    def __init__(self, bins, **kw):
        try:
            self.cells = list(bins)
        except TypeError:
            self.cells = [bins]

class Tally(object):
    def __init__(self, tally_id=None, name=''):
        self.name = name
        self.filters = []
        self.scores = []
        TALLY_LIST.append(self)

class Tallies(list):
    def __init__(self, tallies=None):
        list.__init__(self, tallies or [])
    def export_to_xml(self, *a, **k):
        pass

class Model(object):
    def __init__(self, geometry=None, materials=None, settings=None, tallies=None, plots=None):
        self.geometry = geometry
        self.materials = materials
        self.settings = settings
        self.tallies = tallies
    def run(self, *a, **k):
        WARNINGS.append('model.run() skipped (trace-only pass)')
        return None
    def export_to_xml(self, *a, **k):
        pass
    def export_to_model_xml(self, *a, **k):
        pass

def _run(*a, **k):
    WARNINGS.append('openmc.run() skipped (trace-only pass)')

class StatePoint(object):
    def __init__(self, *a, **k):
        raise RuntimeError('StatePoint unavailable in OWEN trace harness')

# ---------------- module assembly ----------------
openmc = types.ModuleType('openmc')
for _n, _v in list(globals().items()):
    if _n.startswith('_'):
        continue
    setattr(openmc, _n, _v)
openmc.stats = stats
openmc_model = types.ModuleType('openmc.model')
openmc_model.RectangularPrism = RectangularPrism
openmc_model.RectangularParallelepiped = RectangularParallelepiped
openmc_model.RightCircularCylinder = RightCircularCylinder
openmc_model.HexagonalPrism = HexagonalPrism
openmc_model.XConeOneSided = XConeOneSided
openmc_model.YConeOneSided = YConeOneSided
openmc_model.ZConeOneSided = ZConeOneSided
openmc_model.Model = Model
openmc.model = openmc_model
openmc.rectangular_prism = rectangular_prism
openmc.run = _run
openmc.__version__ = '0.15.3-owen-trace'
openmc.deplete = types.ModuleType('openmc.deplete')

sys.modules['openmc'] = openmc
sys.modules['openmc.model'] = openmc_model
sys.modules['openmc.stats'] = stats
sys.modules['openmc.deplete'] = openmc.deplete

# ---------------- serialization ----------------
def _fill_json(fill):
    if fill is None:
        return {'kind': 'void', 'id': 0}
    if isinstance(fill, Material):
        return {'kind': 'material', 'id': fill.id}
    if isinstance(fill, Universe):
        return {'kind': 'universe', 'id': fill.id}
    if isinstance(fill, (RectLattice, HexLattice)):
        return {'kind': 'lattice', 'id': fill.id}
    WARNINGS.append('cell fill %r not recognized; treated as void' % (fill,))
    return {'kind': 'void', 'id': 0}

def _uid(u):
    if isinstance(u, (Universe, RectLattice, HexLattice)):
        return u.id
    return 0

def _lattice_json(lat):
    out = {'id': lat.id, 'name': lat.name,
           'outer': (_uid(lat.outer) if lat.outer is not None else None)}
    if isinstance(lat, RectLattice):
        out['kind'] = 'rect'
        out['lowerLeft'] = [float(v) for v in (lat.lower_left or [])]
        out['pitch'] = [float(v) for v in (lat.pitch or [])]
        arr = lat.universes or []
        # normalize to [z][y][x]
        if arr and arr[0] and isinstance(arr[0][0], (Universe, RectLattice, HexLattice)):
            arr = [arr]
        out['universes'] = [[[_uid(u) for u in row] for row in plane] for plane in arr]
    else:
        out['kind'] = 'hex'
        out['pitch'] = [float(v) for v in (lat.pitch or [])]
        out['center'] = [float(v) for v in (lat.center or (0.0, 0.0))]
        out['orientation'] = lat.orientation
        rings = lat.universes or []
        if rings and rings[0] and isinstance(rings[0][0], list):
            WARNINGS.append('3D hex lattice: only the first axial level was converted')
            rings = rings[0]
        out['rings'] = [[_uid(u) for u in ring] for ring in rings]
    return out

def _settings_json():
    s = STATE['settings']
    out = {'sourcePoints': [], 'sourceBox': None}
    if s is None:
        return out
    if s.batches is not None:
        out['batches'] = int(s.batches)
    if s.inactive is not None:
        out['inactive'] = int(s.inactive)
    if s.particles is not None:
        out['particles'] = int(s.particles)
    sources = s.source if isinstance(s.source, (list, tuple)) else ([s.source] if s.source else [])
    for src in sources:
        sp = getattr(src, 'space', None)
        if isinstance(sp, _Point):
            out['sourcePoints'].append(sp.xyz)
        elif isinstance(sp, _Box):
            out['sourceBox'] = {'lo': sp.lo, 'hi': sp.hi}
    return out

def _tally_json(t):
    mesh = None
    cells = None
    for f in (t.filters or []):
        if isinstance(f, MeshFilter) and isinstance(f.mesh, RegularMesh):
            m = f.mesh
            if m.dimension and m.lower_left is not None and m.upper_right is not None:
                mesh = {'dimension': [int(v) for v in m.dimension],
                        'lowerLeft': [float(v) for v in m.lower_left],
                        'upperRight': [float(v) for v in m.upper_right]}
        elif isinstance(f, CellFilter):
            cells = [c.id if isinstance(c, Cell) else int(c) for c in f.cells]
    kind = 'mesh' if mesh else ('cell' if cells else 'other')
    return {'name': t.name, 'kind': kind, 'mesh': mesh, 'cells': cells or [],
            'scores': list(t.scores or [])}

def dump(out_path):
    model = {
        'surfaces': [{'id': s.id, 'type': s.type, 'coeffs': s.coeffs, 'boundary': s.boundary_type}
                     for s in SURFACES],
        'materials': [{'id': m.id, 'name': m.name, 'density': m.density,
                       'nuclides': m.nuclides, 'elements': m.elements, 'sab': m.sab}
                      for m in MATERIALS],
        'cells': [{'id': c.id, 'name': c.name, 'fill': _fill_json(c.fill),
                   'region': region_json(c.region),
                   'temperature': (float(c.temperature) if isinstance(c.temperature, (int, float)) else None),
                   'translation': (list(c.translation) if c.translation is not None else None),
                   'rotation': ([list(r) for r in c.rotation] if c.rotation is not None else None)}
                  for c in CELLS],
        'universes': [{'id': u.id, 'name': u.name, 'cells': [c.id for c in u.cells]}
                      for u in UNIVERSES],
        'lattices': [_lattice_json(l) for l in LATTICES],
        'rootUniverse': (STATE['root'].id if STATE['root'] is not None else None),
        'rootCells': [c.id for c in STATE['root_cells']],
        'settings': _settings_json(),
        'tallies': [_tally_json(t) for t in TALLY_LIST],
        'warnings': WARNINGS,
    }
    with open(out_path, 'w') as fh:
        json.dump(model, fh)

def main():
    if len(sys.argv) < 3:
        sys.stderr.write('usage: owen_trace_openmc.py <deck.py> <out.json>\n')
        return 2
    deck, out_path = sys.argv[1], sys.argv[2]
    try:
        runpy.run_path(deck, run_name='__main__')
    except SystemExit:
        pass
    except Exception as exc:  # noqa: BLE001
        WARNINGS.append('deck raised %s: %s (model traced up to that point)' % (type(exc).__name__, exc))
    dump(out_path)
    sys.stdout.write('OWEN_TRACE_OK %d surfaces %d cells %d universes %d lattices\n'
                     % (len(SURFACES), len(CELLS), len(UNIVERSES), len(LATTICES)))
    return 0

if __name__ == '__main__':
    sys.exit(main())
`;
