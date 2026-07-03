import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'owen-diag-'));
const entry = join(tmp, 'e.ts');
writeFileSync(entry, [
    `export * from ${JSON.stringify(join(here, '..', 'src', 'converter', 'index.ts').replace(/\\/g, '/'))};`,
    `export { hexFillToRings } from ${JSON.stringify(join(here, '..', 'src', 'converter', 'mcnpToOpenmc.ts').replace(/\\/g, '/'))};`,
    `export { zaidToNuclide, nuclideToZaid } from ${JSON.stringify(join(here, '..', 'src', 'converter', 'zaid.ts').replace(/\\/g, '/'))};`,
].join('\n'));
const bundle = join(tmp, 'b.mjs');
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent' });
const C = await import(pathToFileURL(bundle).href);

const deck = (cells, surfaces, data) => ['t', ...cells, '', ...surfaces, '', ...data].join('\n');

console.log('=== 1. general plane ===');
let r = C.mcnpToOpenmc(deck(['1 0 -1 imp:n=1', '2 0 1 imp:n=0'], ['1 p 1 2 3 4'], ['kcode 10 1.0 2 5']));
console.log(r.output.split('\n').filter((l) => l.includes('surf_1')).join('\n'));

console.log('=== 2. rhp macro ===');
r = C.mcnpToOpenmc(deck(['1 0 -1 imp:n=1', '2 0 1 imp:n=0'], ['1 rhp 0 0 -10 0 0 20 2 0 0'], ['kcode 10 1.0 2 5']));
console.log(r.output.split('\n').filter((l) => l.includes('surf_1') || l.includes('Hex')).join('\n'));

console.log('=== 3. hex lattice ===');
r = C.mcnpToOpenmc(deck([
    '1 1 -10.0 -1 u=1 imp:n=1',
    '2 2 -0.7   1 u=1 imp:n=1',
    '3 2 -0.7      u=2 imp:n=1',
    '10 0 -11 lat=2 u=5 imp:n=1',
    '     fill=-1:1 -1:1 0:0',
    '     2 2 1 2 1 2 1 2 2',
    '20 0 -20 fill=5 imp:n=1',
    '99 0 20 imp:n=0',
], ['1 cz 0.4', '11 rhp 0 0 -50 0 0 100 0 0.6 0', '20 so 60'],
    ['m1 92235.80c 1.0', 'm2 1001.80c 2.0 8016.80c 1.0', 'kcode 10 1.0 2 5']));
console.log('issues:', JSON.stringify(r.issues, null, 1));
console.log(r.output.split('\n').filter((l) => /lat_|Hex|TODO/.test(l)).join('\n'));

console.log('=== 4. hexFillToRings ===');
console.log(JSON.stringify(C.hexFillToRings([9, 9, 8, 9, 1, 9, 8, 9, 9], -1, 1, -1, 1)));

console.log('=== 5. zaid metastable ===');
console.log('92235 ->', C.zaidToNuclide('92235'));
console.log('95642 ->', C.zaidToNuclide('95642'));
console.log('Am242_m1 ->', C.nuclideToZaid('Am242_m1'));
r = C.mcnpToOpenmc(deck(['1 1 -6.5 -1 imp:n=1', '9 0 1 imp:n=0'], ['1 cz 1'],
    ['m1 40000.80c 1.0', 'kcode 10 1.0 2 5']));
console.log(r.output.split('\n').filter((l) => l.includes('add_')).join('\n'));

console.log('=== 6. sab grph ===');
r = C.mcnpToOpenmc(deck(['1 1 -1.0 -1 imp:n=1', '2 2 -1.7 1 -2 imp:n=1', '9 0 2 imp:n=0'],
    ['1 cz 1', '2 cz 2'],
    ['m1 1001.80c 2.0 8016.80c 1.0', 'mt1 lwtr.20t', 'm2 6000.80c 1.0', 'mt2 grph.10t', 'kcode 10 1.0 2 5']));
console.log(r.output.split('\n').filter((l) => /add_s_alpha|TODO/.test(l)).join('\n'));
console.log('issues:', JSON.stringify(r.issues));

console.log('=== 7. openmc2mcnp cone/torus ===');
const py7 = [
    'import openmc',
    's4 = openmc.ZCone(x0=0, y0=0, z0=5, r2=0.25)',
    's7 = openmc.Sphere(r=60, boundary_type="vacuum")',
    'm = openmc.Material()',
    "m.add_nuclide('H1', 1.0)",
    "m.set_density('g/cm3', 1.0)",
    'c1 = openmc.Cell(fill=m, region=-s7 & -s4)',
    'root = openmc.Universe(cells=[c1])',
    'geometry = openmc.Geometry(root)',
    'model = openmc.model.Model(geometry)',
].join('\n');
r = C.openmcToMcnp(py7);
console.log(r.output);
console.log('issues:', JSON.stringify(r.issues));

console.log('=== 8. openmc2mcnp union region ===');
const py8 = [
    'import openmc',
    's1 = openmc.ZCylinder(r=1)',
    's2 = openmc.ZCylinder(r=2)',
    's3 = openmc.Sphere(r=30, boundary_type="vacuum")',
    'm = openmc.Material()',
    "m.add_nuclide('H1', 1.0)",
    "m.set_density('g/cm3', 1.0)",
    'c1 = openmc.Cell(fill=m, region=(-s1 | -s2) & -s3)',
    'c2 = openmc.Cell(region=~((-s1 | -s2)) & -s3)',
    'root = openmc.Universe(cells=[c1, c2])',
    'geometry = openmc.Geometry(root)',
    'model = openmc.model.Model(geometry)',
].join('\n');
r = C.openmcToMcnp(py8);
console.log(r.output);
console.log('issues:', JSON.stringify(r.issues));

console.log('=== 9. openmc2mcnp materials ===');
const py9 = [
    'import openmc',
    'm = openmc.Material()',
    "m.add_nuclide('U235', 0.04, 'ao')",
    "m.add_nuclide('U238', 0.96)",
    "m.add_element('Zr', 1.0)",
    "m.add_s_alpha_beta('c_H_in_H2O')",
    "m.set_density('g/cm3', 10.4)",
    's = openmc.Sphere(r=10, boundary_type="vacuum")',
    'c = openmc.Cell(fill=m, region=-s)',
    'root = openmc.Universe(cells=[c])',
    'geometry = openmc.Geometry(root)',
    'model = openmc.model.Model(geometry)',
].join('\n');
r = C.openmcToMcnp(py9);
console.log(r.output);
console.log('issues:', JSON.stringify(r.issues));
