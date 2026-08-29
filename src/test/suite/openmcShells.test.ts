import * as assert from 'assert';
import { buildOpenmcShellScene } from '../../preview/codes/openmcShells';
import { parseOpenmc } from '../../preview/codes/openmc';

// Shaped after the IFE/HYLIFE chamber deck in research-decks: module-level scalars
// for the dimensions, RightCircularCylinder bodies, a 2000 cm bounding sphere,
// and a capsule whose radii come from a dataclass field (unresolvable without
// executing the deck).
const CHAMBER_DECK = `import openmc
import openmc.model

DT_INNER_R_CM = 0.0133
VOID_CYL_BASE_Z = -450.0
VOID_CYL_HEIGHT = 900.0
VOID_CYL_R_CM = 88.0
FLINAK_CYL_BASE_Z = -500.0
FLINAK_CYL_HEIGHT = 1000.0
FLINAK_CYL_R_CM = 213.0
STEEL_CYL_BASE_Z = -505.0
STEEL_CYL_HEIGHT = 1010.0
STEEL_CYL_R_CM = 218.0
BOUNDING_SPHERE_R_CM = 2000.0


def build_geometry(preset, dt_material, flinak_material, steel_material):
    s_dt_inner = openmc.Sphere(r=DT_INNER_R_CM)
    s_dt_outer = openmc.Sphere(r=preset.dt_outer_r_cm)
    void_cyl = openmc.model.RightCircularCylinder(
        center_base=(0, 0, VOID_CYL_BASE_Z),
        height=VOID_CYL_HEIGHT, radius=VOID_CYL_R_CM, axis="z",
    )
    flinak_cyl = openmc.model.RightCircularCylinder(
        center_base=(0, 0, FLINAK_CYL_BASE_Z),
        height=FLINAK_CYL_HEIGHT, radius=FLINAK_CYL_R_CM, axis="z",
    )
    steel_cyl = openmc.model.RightCircularCylinder(
        center_base=(0, 0, STEEL_CYL_BASE_Z),
        height=STEEL_CYL_HEIGHT, radius=STEEL_CYL_R_CM, axis="z",
    )
    bound_sph = openmc.Sphere(r=BOUNDING_SPHERE_R_CM, boundary_type="vacuum")

    c_dt = openmc.Cell(
        name="DT_shell",
        fill=dt_material,
        region=+s_dt_inner & -s_dt_outer,
    )
    c_flinak = openmc.Cell(
        name="FLiNaK",
        fill=flinak_material,
        region=+void_cyl & -flinak_cyl,
    )
    c_steel = openmc.Cell(
        name="first_wall",
        fill=steel_material,
        region=+flinak_cyl & -steel_cyl,
    )
    c_outer_void = openmc.Cell(name="outer_void", region=+steel_cyl & -bound_sph)
    return openmc.Geometry(openmc.Universe(cells=[c_dt, c_flinak, c_steel, c_outer_void]))
`;

suite('OpenMC preview — shells for decks that are not lattices', () => {
    const scene = buildOpenmcShellScene(CHAMBER_DECK);

    test('rebuilds the cells whose dimensions the deck states outright', () => {
        assert.ok(scene, 'expected a scene');
        const labels = scene!.cylinders.map((c) => c.label);
        assert.ok(labels.includes('FLiNaK'), JSON.stringify(labels));
        assert.ok(labels.includes('first_wall'), JSON.stringify(labels));
    });

    test('the salt is an annulus between the void and vessel cylinders', () => {
        const salt = scene!.cylinders.find((c) => c.label === 'FLiNaK')!;
        assert.strictEqual(salt.radius, 213);
        assert.strictEqual(salt.innerRadius, 88);
        assert.strictEqual(salt.height, 1000);
        assert.strictEqual(salt.z, 0);
        assert.strictEqual(salt.axis, 'z');
        assert.strictEqual(salt.component, 'moderator');
    });

    test('the first wall is the thin 213-218 cm shell, tagged as vessel', () => {
        const wall = scene!.cylinders.find((c) => c.label === 'first_wall')!;
        assert.strictEqual(wall.radius, 218);
        assert.strictEqual(wall.innerRadius, 213);
        assert.strictEqual(wall.component, 'vessel');
    });

    test('a cell sized from a dataclass field is reported, not invented', () => {
        assert.ok(scene!.unresolved.includes('DT_shell'), JSON.stringify(scene!.unresolved));
        assert.strictEqual(scene!.cylinders.some((c) => c.label === 'DT_shell'), false);
    });

    test('void cells are not drawn as material', () => {
        assert.strictEqual(scene!.cylinders.some((c) => c.label === 'outer_void'), false);
    });

    test('outermost shell is emitted first so nested contents stay visible', () => {
        const radii = scene!.cylinders.map((c) => c.radius);
        assert.deepStrictEqual(radii, [...radii].sort((a, b) => b - a));
    });
});

suite('OpenMC preview — spheres and boxes', () => {
    test('a sphere-in-sphere benchmark renders spheres, not a pin', () => {
        const deck = `import openmc
fuel = openmc.Material(name='Godiva HEU')
inner = openmc.Sphere(r=8.741)
outer = openmc.Sphere(r=20.0, boundary_type='vacuum')
core = openmc.Cell(name='core', fill=fuel, region=-inner)
reflector = openmc.Cell(name='reflector', fill=fuel, region=+inner & -outer)
geometry = openmc.Geometry([core, reflector])
`;
        const scene = buildOpenmcShellScene(deck);
        assert.ok(scene);
        const core = scene!.cylinders.find((c) => c.label === 'core')!;
        assert.strictEqual(core.shape, 'sphere');
        assert.strictEqual(core.radius, 8.741);
        assert.strictEqual(core.material, 'Godiva HEU');
    });

    test('a RectangularParallelepiped tank becomes a box', () => {
        const deck = `import openmc
import openmc.model
water = openmc.Material(name='water')
tank = openmc.model.RectangularParallelepiped(-30.0, 30.0, -20.0, 20.0, 0.0, 50.0)
cell = openmc.Cell(name='tank', fill=water, region=-tank)
geometry = openmc.Geometry([cell])
`;
        const scene = buildOpenmcShellScene(deck);
        const box = scene!.cylinders.find((c) => c.label === 'tank')!;
        assert.strictEqual(box.shape, 'box');
        assert.strictEqual(box.halfX, 30);
        assert.strictEqual(box.halfY, 20);
        assert.strictEqual(box.height, 50);
        assert.strictEqual(box.z, 25);
    });

    test('a deck with nothing resolvable yields no scene', () => {
        assert.strictEqual(buildOpenmcShellScene('import openmc\nprint(1)\n'), null);
    });
});

suite('OpenMC preview — fallback honesty', () => {
    test('the chamber deck no longer renders as a PWR pin', () => {
        const result = parseOpenmc(CHAMBER_DECK);
        assert.ok(result.cylinders.length >= 2);
        assert.ok(result.cylinders.every((c) => (c.radius ?? 0) > 1), 'no 0.41 cm pin invented');
        assert.ok((result.notes ?? []).some((n) => n.includes('rebuilt')), JSON.stringify(result.notes));
        assert.ok((result.warnings ?? []).some((w) => w.includes('could not be sized')), JSON.stringify(result.warnings));
    });

    test('an unrecognizable deck says the pin is a placeholder', () => {
        const result = parseOpenmc('import openmc\nmodel = build_it_all_somewhere_else()\n');
        assert.ok((result.warnings ?? []).some((w) => w.includes('placeholder, not your model')),
            JSON.stringify(result.warnings));
    });

    test('a real pin-lattice deck is unaffected', () => {
        const deck = `import openmc
fuel = openmc.Material(name='UO2')
fuel_or = openmc.ZCylinder(r=0.4096)
clad_or = openmc.ZCylinder(r=0.4750)
lattice = openmc.RectLattice()
lattice.pitch = (1.26, 1.26)
lattice.lower_left = (-1.26, -1.26)
lattice.universes = [[pin, pin], [pin, pin]]
`;
        const result = parseOpenmc(deck);
        assert.ok(result.cylinders.length >= 4, 'lattice path still places pins');
    });
});
