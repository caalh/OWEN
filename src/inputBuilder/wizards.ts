/**
 * Per-snippet card generators for the OWEN Input Builder wizards.
 * Headless — no vscode imports. Mirrored in groves/input_builder/wizards.py.
 */

import type { MonteCarloCode } from './materials';

export type DensityMode = 'weight' | 'atom';
export type FractionMode = 'weight' | 'atom';
export type SurfaceTemplate = 'rcc-pin' | 'rpp-box' | 'sphere';
export type LatticeGridType = 'square' | 'hex';
export type RegionOperator = 'intersection' | 'union';

export interface MaterialComponent {
    zaid: string;
    label: string;
    fraction: number;
}

export interface MaterialWizardInput {
    code: MonteCarloCode;
    matNumber: number;
    name: string;
    densityMode: DensityMode;
    density: number;
    fractionMode: FractionMode;
    components: MaterialComponent[];
    /** User-selected S(α,β) table id (MCNP mt / OpenMC add_s_alpha_beta). */
    sab?: string;
    suffix?: string;
}

export interface SurfaceWizardInput {
    code: MonteCarloCode;
    surfaceNumber: number;
    template: SurfaceTemplate;
    comment?: string;
    /** RCC pin: center x,y,z, height (cm), radius (cm). */
    rcc?: { x: number; y: number; z: number; height: number; radius: number };
    /** RPP box bounds (cm). */
    rpp?: { xmin: number; xmax: number; ymin: number; ymax: number; zmin: number; zmax: number };
    /** Sphere center + radius (cm). */
    sphere?: { x: number; y: number; z: number; radius: number };
}

export interface CellSurfaceRef {
    id: number;
    sense: '-' | '+';
}

export interface CellWizardInput {
    code: MonteCarloCode;
    cellNumber: number;
    material: number | 'void';
    /** Cell-card density: negative = g/cm³, positive = atoms/b·cm (MCNP). */
    density?: number;
    surfaces: CellSurfaceRef[];
    operator: RegionOperator;
    imp?: number;
    universe?: number;
    comment?: string;
}

export interface LatticeWizardInput {
    code: MonteCarloCode;
    gridType: LatticeGridType;
    nx: number;
    ny: number;
    pitch: number;
    /** Uniform fill universe / material id for every position. */
    fillValue: number;
    latticeCell?: number;
    latticeUniverse?: number;
}

export interface SourceWizardInput {
    code: MonteCarloCode;
    particles: number;
    inactive: number;
    active: number;
    keffGuess: number;
    x: number;
    y: number;
    z: number;
}

export interface SettingsWizardInput {
    code: MonteCarloCode;
    particles: number;
    inactive: number;
    active: number;
    keffGuess: number;
    threads?: number;
}

export const SAB_OPTIONS: { id: string; label: string; openmc: string; hydrogenOnly: boolean }[] = [
    { id: 'lwtr.20t', label: 'Light water (lwtr.20t)', openmc: 'c_H_in_H2O', hydrogenOnly: true },
    { id: 'hwtr.20t', label: 'Heavy water (hwtr.20t)', openmc: 'c_D_in_D2O', hydrogenOnly: true },
    { id: 'poly.20t', label: 'Polyethylene (poly.20t)', openmc: 'c_H_in_CH2', hydrogenOnly: true },
    { id: 'grph.30t', label: 'Graphite (grph.30t)', openmc: 'c_Graphite', hydrogenOnly: false },
];

export const SURFACE_TEMPLATES: { id: SurfaceTemplate; label: string; hint: string }[] = [
    { id: 'rcc-pin', label: 'RCC fuel pin (cylinder)', hint: 'Right circular cylinder along Z — standard PWR pin macrobody.' },
    { id: 'rpp-box', label: 'RPP assembly box', hint: 'Axis-aligned rectangular parallelepiped for lattice boundaries.' },
    { id: 'sphere', label: 'Sphere (so)', hint: 'Spherical surface centered at (x,y,z).' },
];

export const INPUT_BUILDER_TEMPLATES: { id: string; label: string; category: string; wizard: string; description: string }[] = [
    { id: 'pwr-pin', label: 'PWR pin cell', category: 'Geometry', wizard: 'deck', description: 'UO₂ / Zircaloy / water pin with kcode source.' },
    { id: 'lattice-17', label: '17×17 lattice assembly', category: 'Geometry', wizard: 'deck', description: 'BEAVRS-style lattice with guide tubes.' },
    { id: 'custom-material', label: 'Custom material card', category: 'Materials', wizard: 'material', description: 'Build an m-card with atom/weight fractions and optional S(α,β).' },
    { id: 'rcc-pin-surf', label: 'RCC pin surface', category: 'Surfaces', wizard: 'surface', description: 'MCNP RCC macrobody for a fuel pin cylinder.' },
    { id: 'rpp-assembly', label: 'RPP assembly box', category: 'Surfaces', wizard: 'surface', description: 'Rectangular boundary for a lattice unit cell.' },
    { id: 'fuel-cell', label: 'Fuel cell (boolean)', category: 'Cells', wizard: 'cell', description: 'Intersection cell with material density and importance.' },
    { id: 'square-lattice', label: 'Square lattice fill', category: 'Lattices', wizard: 'lattice', description: 'Uniform square lattice snippet (open Lattice Builder for custom maps).' },
    { id: 'kcode-source', label: 'kcode + ksrc source', category: 'Sources', wizard: 'source', description: 'Eigenvalue source block with point ksrc.' },
    { id: 'mcnp-settings', label: 'MCNP run settings', category: 'Settings', wizard: 'settings', description: 'mode n + kcode line for criticality.' },
];

export function hasHydrogen(components: MaterialComponent[]): boolean {
    return components.some((c) => /^100[12]\./.test(c.zaid) || c.zaid.startsWith('1001') || c.zaid.startsWith('1002'));
}

export function sabAllowed(sabId: string, components: MaterialComponent[]): boolean {
    const opt = SAB_OPTIONS.find((o) => o.id === sabId);
    if (!opt) return false;
    if (!opt.hydrogenOnly) return true;
    return hasHydrogen(components);
}

function fmtFrac(x: number): string {
    return x >= 1e-3 ? x.toFixed(6) : x.toExponential(4);
}

function signedFraction(frac: number, mode: FractionMode): string {
    const v = mode === 'weight' ? -Math.abs(frac) : Math.abs(frac);
    return fmtFrac(v);
}

function pyVar(name: string): string {
    return 'mat_' + name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

export function materialWizardCard(input: MaterialWizardInput): string {
    const suffix = input.suffix || '80c';
    const lines: string[] = [];
    if (input.code === 'mcnp') {
        lines.push(`c ${input.name}`);
        const densHint = input.densityMode === 'weight'
            ? `rho = ${input.density} g/cm³ (use -${input.density} on the cell card)`
            : `N = ${input.density} atoms/b·cm (use +${input.density} on the cell card)`;
        lines.push(`c ${densHint}; ${input.fractionMode} fractions on m-card`);
        const head = `m${input.matNumber}`;
        const pad = ' '.repeat(head.length);
        input.components.forEach((c, i) => {
            const lead = i === 0 ? head : pad;
            lines.push(`${lead}    ${c.zaid}.${suffix}  ${signedFraction(c.fraction, input.fractionMode)}  $ ${c.label}`);
        });
        if (input.sab) {
            if (!sabAllowed(input.sab, input.components)) {
                lines.push(`c WARNING: ${input.sab} applies to hydrogen-bearing moderators only`);
            } else {
                lines.push(`mt${input.matNumber}   ${input.sab}`);
            }
        }
        return lines.join('\n');
    }
    if (input.code === 'openmc') {
        const v = pyVar(input.name);
        lines.push(`# ${input.name}`);
        lines.push(`${v} = openmc.Material(name=${JSON.stringify(input.name)})`);
        const unit = input.densityMode === 'weight' ? 'g/cm3' : 'sum';
        if (input.densityMode === 'weight') {
            lines.push(`${v}.set_density('g/cm3', ${input.density})`);
        } else {
            lines.push(`${v}.set_density('sum', ${input.density})  # atoms/b·cm`);
        }
        const pt = input.fractionMode === 'weight' ? 'wo' : 'ao';
        for (const c of input.components) {
            const nuclide = zaidToOpenmc(c.zaid);
            lines.push(`${v}.add_nuclide('${nuclide}', ${Math.abs(c.fraction)}, percent_type='${pt}')`);
        }
        if (input.sab) {
            const opt = SAB_OPTIONS.find((o) => o.id === input.sab);
            if (opt && sabAllowed(input.sab, input.components)) {
                lines.push(`${v}.add_s_alpha_beta('${opt.openmc}')`);
            } else if (input.sab) {
                lines.push(`# WARNING: S(α,β) ${input.sab} — hydrogen-bearing moderators only`);
            }
        }
        return lines.join('\n');
    }
    if (input.code === 'serpent') {
        const name = pyVar(input.name).replace(/^mat_/, '');
        const dens = input.densityMode === 'weight' ? `-${input.density}` : input.density;
        lines.push(`% ${input.name}`);
        lines.push(`mat ${name} ${dens}`);
        for (const c of input.components) {
            lines.push(`${c.zaid}.${suffix}  ${signedFraction(c.fraction, input.fractionMode)}  % ${c.label}`);
        }
        if (input.sab === 'lwtr.20t' && sabAllowed(input.sab, input.components)) {
            lines.push('therm lwtr lwtr.20t');
        }
        return lines.join('\n');
    }
    // SCONE
    const sname = pyVar(input.name);
    const temp = '.06';
    lines.push(`// ${input.name}`);
    lines.push(`${sname} {`);
    lines.push('  temp 600;');
    lines.push('  composition {');
    for (const c of input.components) {
        const ad = Math.abs(c.fraction) * input.density;
        lines.push(`    ${c.zaid}${temp} ${fmtFrac(ad)};  // ${c.label}`);
    }
    lines.push('  }');
    lines.push('}');
    return lines.join('\n');
}

function zaidToOpenmc(zaid: string): string {
    const z = parseInt(zaid, 10);
    const sym = ['', 'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne',
        'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca', 'Sc', 'Ti',
        'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se',
        'Br', 'Kr', 'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd',
        'Ag', 'Cd', 'In', 'Sn', 'Sb', 'Te', 'I', 'Xe', 'Cs', 'Ba', 'La', 'Ce',
        'Pr', 'Nd', 'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb',
        'Lu', 'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg', 'Tl', 'Pb',
        'Bi', 'Po', 'At', 'Rn', 'Fr', 'Ra', 'Ac', 'Th', 'Pa', 'U', 'Np', 'Pu',
        'Am', 'Cm', 'Bk', 'Cf', 'Es', 'Fm', 'Md', 'No', 'Lr'][Math.floor(z / 1000)] || 'X';
    const a = z % 1000;
    return `${sym}${a}`;
}

export function surfaceWizardCard(input: SurfaceWizardInput): string {
    const n = input.surfaceNumber;
    const cmt = input.comment ? `  $ ${input.comment}` : '';
    if (input.template === 'rcc-pin' && input.rcc) {
        const { x, y, z, height, radius } = input.rcc;
        if (input.code === 'mcnp') {
            return `${n} rcc ${x} ${y} ${z} ${height} ${radius}${cmt}`;
        }
        if (input.code === 'openmc') {
            return `fuel_cyl = openmc.ZCylinder(x0=${x}, y0=${y}, r=${radius})\n# height ${height} cm along z from z=${z}`;
        }
        if (input.code === 'serpent') {
            return `surf ${n} cylz ${x} ${y} ${radius} ${z} ${z + height}`;
        }
        return `surfFuelPin { type cylinderZ; id ${n}; origin (${x} ${y}); radius ${radius}; zmin ${z}; zmax ${z + height}; }`;
    }
    if (input.template === 'rpp-box' && input.rpp) {
        const { xmin, xmax, ymin, ymax, zmin, zmax } = input.rpp;
        if (input.code === 'mcnp') {
            return `${n} rpp ${xmin} ${xmax} ${ymin} ${ymax} ${zmin} ${zmax}${cmt}`;
        }
        if (input.code === 'openmc') {
            return `box = openmc.model.RectangularPrism(\n    xmin='${xmin} cm', xmax='${xmax} cm',\n    ymin='${ymin} cm', ymax='${ymax} cm',\n    zmin='${zmin} cm', zmax='${zmax} cm',\n)`;
        }
        if (input.code === 'serpent') {
            return `surf ${n} cuboid ${xmin} ${xmax} ${ymin} ${ymax} ${zmin} ${zmax}`;
        }
        return `surfBox { type cuboid; id ${n}; bounds (${xmin} ${xmax} ${ymin} ${ymax} ${zmin} ${zmax}); }`;
    }
    if (input.template === 'sphere' && input.sphere) {
        const { x, y, z, radius } = input.sphere;
        if (input.code === 'mcnp') {
            return `${n} so ${x} ${y} ${z} ${radius}${cmt}`;
        }
        if (input.code === 'openmc') {
            return `sphere = openmc.Sphere(x0=${x}, y0=${y}, z0=${z}, r=${radius})`;
        }
        if (input.code === 'serpent') {
            return `surf ${n} sph ${x} ${y} ${z} ${radius}`;
        }
        return `surfSphere { type sphere; id ${n}; center (${x} ${y} ${z}); radius ${radius}; }`;
    }
    return `c surface wizard: missing parameters`;
}

export function cellWizardCard(input: CellWizardInput): string {
    const mat = input.material === 'void' ? 0 : input.material;
    const dens = input.density !== undefined ? ` ${input.density > 0 ? '+' : ''}${input.density}` : '';
    const region = formatRegion(input.surfaces, input.operator, input.code);
    const cmt = input.comment ? `  $ ${input.comment}` : '';
    if (input.code === 'mcnp') {
        const imp = input.imp !== undefined ? `  imp:n=${input.imp}` : '';
        const uni = input.universe !== undefined ? `  u=${input.universe}` : '';
        return `${input.cellNumber}  ${mat}${dens}  ${region}${imp}${uni}${cmt}`;
    }
    if (input.code === 'openmc') {
        const fill = mat === 0 ? 'None' : `mat_${mat}`;
        return `cell_${input.cellNumber} = openmc.Cell(fill=${fill}, region=${region})`;
    }
    if (input.code === 'serpent') {
        const fill = mat === 0 ? '0' : String(mat);
        return `cell ${input.cellNumber} ${fill} ${region}`;
    }
    const fill = mat === 0 ? 'void' : `mat${mat}`;
    return `cell${input.cellNumber} { type simpleCell; id ${input.cellNumber}; surfaces (${region}); fill ${fill}; }`;
}

function formatRegion(surfaces: CellSurfaceRef[], op: RegionOperator, code: MonteCarloCode): string {
    if (surfaces.length === 0) return code === 'openmc' ? 'None' : '';
    const parts = surfaces.map((s) => {
        if (code === 'openmc') {
            return `${s.sense === '-' ? '-' : '+'}surf_${s.id}`;
        }
        return `${s.sense}${s.id}`;
    });
    if (op === 'union' && parts.length > 1) {
        if (code === 'openmc') {
            return `(${parts.join(' | ')})`;
        }
        const bare = surfaces.map((s) => (s.sense === '-' ? `-${s.id}` : String(s.id)));
        return `(${bare.join(':')})`;
    }
    if (code === 'openmc') {
        return parts.join(' & ');
    }
    return parts.join(' ');
}

export function latticeWizardCard(input: LatticeWizardInput): string {
    const cell = input.latticeCell ?? 100;
    const uni = input.latticeUniverse ?? 10;
    const n = input.nx;
    const pitch = input.pitch;
    const half = pitch / 2;
    const k = Math.floor((n - 1) / 2);
    const fillRange = n % 2 === 1
        ? `-${k}:${k} -${k}:${k} 0:0`
        : `-${n / 2}:${n / 2 - 1} -${n / 2}:${n / 2 - 1} 0:0`;

    if (input.gridType === 'hex') {
        if (input.code === 'mcnp') {
            return [
                `c --- Hex lattice (${n} rings) u=${uni} ---`,
                `${cell} 0  lat=2 u=${uni} imp:n=1 fill=${input.fillValue}`,
                `c Hex pitch = ${pitch.toFixed(4)} cm — customize fill in Lattice Builder`,
            ].join('\n');
        }
        return `c hex lattice — open Lattice Builder for full hex map (pitch ${pitch} cm)`;
    }

    if (input.code === 'mcnp') {
        const rows = Array.from({ length: input.ny }, () => Array(input.nx).fill(input.fillValue).join(' '));
        return [
            `c --- ${input.nx}×${input.ny} square lattice u=${uni} ---`,
            `c  Pin pitch = ${pitch.toFixed(4)} cm`,
            `${cell} 0  -10 11 -12 13  lat=1 u=${uni} imp:n=1 fill=${fillRange}`,
            ...rows.map((r) => '    ' + r),
            'c',
            `c  Lattice cell surfaces (half-pitch = ${half.toFixed(4)} cm)`,
            `10  px  ${half.toFixed(4)}`,
            `11  px -${half.toFixed(4)}`,
            `12  py  ${half.toFixed(4)}`,
            `13  py -${half.toFixed(4)}`,
        ].join('\n');
    }
    if (input.code === 'openmc') {
        const rows = Array.from({ length: input.ny }, () =>
            '    [' + Array(input.nx).fill(`uni_${input.fillValue}`).join(', ') + '],');
        return [
            `# --- ${input.nx}×${input.ny} square lattice ---`,
            'lattice = openmc.RectLattice(name="input_builder_lattice")',
            `lattice.pitch = (${pitch}, ${pitch})`,
            `lattice.lower_left = (${-pitch * input.nx / 2}, ${-pitch * input.ny / 2})`,
            'lattice.universes = [',
            ...rows,
            ']',
        ].join('\n');
    }
    if (input.code === 'serpent') {
        const rows = Array.from({ length: input.ny }, () =>
            Array(input.nx).fill(`U${input.fillValue}`).join(' '));
        return [
            `% --- ${input.nx}×${input.ny} square lattice ---`,
            `lat ${cell} 1  0.0 0.0  ${input.nx} ${input.ny}  ${pitch.toFixed(4)}`,
            ...rows,
        ].join('\n');
    }
    return [
        `// --- ${input.nx}×${input.ny} square lattice ---`,
        `latCore {`,
        `  type latUniverse; id ${uni};`,
        `  pitch ${pitch};`,
        `  map ( ${Array(input.ny).fill(Array(input.nx).fill(input.fillValue).join(' ')).join('; ')} );`,
        `}`,
    ].join('\n');
}

export function sourceWizardCard(input: SourceWizardInput): string {
    if (input.code === 'mcnp') {
        return [
            'mode n',
            `kcode ${input.particles} ${input.keffGuess} ${input.inactive} ${input.active}`,
            `ksrc ${input.x} ${input.y} ${input.z}`,
        ].join('\n');
    }
    if (input.code === 'openmc') {
        return [
            'settings = openmc.Settings()',
            `settings.batches = ${input.active}`,
            `settings.inactive = ${input.inactive}`,
            `settings.particles = ${input.particles}`,
            'settings.run_mode = "eigenvalue"',
            `settings.source = openmc.IndependentSource(`,
            `    space=openmc.stats.Point((${input.x}, ${input.y}, ${input.z})),`,
            ')',
        ].join('\n');
    }
    if (input.code === 'serpent') {
        return [
            `set pop ${input.particles} ${input.inactive} ${input.active}`,
            `src 1  sp  ${input.x} ${input.y} ${input.z}`,
        ].join('\n');
    }
    return [
        'eigenPhysicsPackage {',
        `  numInactiveCycles ${input.inactive};`,
        `  numActiveCycles ${input.active};`,
        `  numNeutronHistoriesPerCycle ${input.particles};`,
        '}',
        `sourcePoint { position (${input.x} ${input.y} ${input.z}); }`,
    ].join('\n');
}

export function settingsWizardCard(input: SettingsWizardInput): string {
    if (input.code === 'mcnp') {
        return [
            'mode n',
            `kcode ${input.particles} ${input.keffGuess} ${input.inactive} ${input.active}`,
            'print',
        ].join('\n');
    }
    if (input.code === 'openmc') {
        const threads = input.threads ? `\nmodel.run(threads=${input.threads})` : '\nmodel.run()';
        return [
            'settings = openmc.Settings()',
            `settings.batches = ${input.active}`,
            `settings.inactive = ${input.inactive}`,
            `settings.particles = ${input.particles}`,
            'settings.run_mode = "eigenvalue"',
            threads.trim(),
        ].join('\n');
    }
    if (input.code === 'serpent') {
        return [
            `set pop ${input.particles} ${input.inactive} ${input.active}`,
            'set bc 3',
        ].join('\n');
    }
    return [
        'eigenPhysicsPackage {',
        `  numInactiveCycles ${input.inactive};`,
        `  numActiveCycles ${input.active};`,
        `  numNeutronHistoriesPerCycle ${input.particles};`,
        '}',
    ].join('\n');
}
