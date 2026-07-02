/** Curated reactor materials for the OWEN Input Builder (NRDP-aligned compositions). */

export type MonteCarloCode = 'mcnp' | 'openmc' | 'serpent' | 'scone';

export interface MaterialEntry {
    id: string;
    name: string;
    category: string;
    density: number;
    densityUnit: 'g/cm3' | 'atom/b-cm';
    description: string;
}

export interface SelectedMaterial extends MaterialEntry {
    mcnpNumber: number;
    customName?: string;
}

/** Bundled library (~18 common reactor materials). */
export const MATERIAL_LIBRARY: MaterialEntry[] = [
    { id: 'light-water', name: 'Light Water (H₂O)', category: 'moderators', density: 0.997, densityUnit: 'g/cm3', description: 'Room-temperature water; attach lwtr.20t S(α,β) on MCNP cells.' },
    { id: 'uo2-3pct', name: 'UO₂ (3% enriched)', category: 'fuels', density: 10.97, densityUnit: 'g/cm3', description: 'Standard PWR/BWR fuel pellet density (theoretical).' },
    { id: 'uo2-4.5pct', name: 'UO₂ (4.5% enriched)', category: 'fuels', density: 10.97, densityUnit: 'g/cm3', description: 'High-burnup PWR fuel.' },
    { id: 'uo2-5pct', name: 'UO₂ (5% enriched)', category: 'fuels', density: 10.97, densityUnit: 'g/cm3', description: 'Extended-burnup PWR fuel.' },
    { id: 'zirc4', name: 'Zircaloy-4', category: 'cladding', density: 6.56, densityUnit: 'g/cm3', description: 'Fuel cladding and structural tubing.' },
    { id: 'ss304', name: 'Stainless Steel 304', category: 'structure', density: 8.0, densityUnit: 'g/cm3', description: 'Baffle, former, barrel, RPV liner.' },
    { id: 'ss316', name: 'Stainless Steel 316', category: 'structure', density: 8.0, densityUnit: 'g/cm3', description: 'Structural stainless.' },
    { id: 'carbon-steel', name: 'Carbon Steel (RPV)', category: 'structure', density: 7.85, densityUnit: 'g/cm3', description: 'Reactor pressure vessel steel.' },
    { id: 'b4c-natural', name: 'B₄C (natural B)', category: 'absorbers', density: 2.52, densityUnit: 'g/cm3', description: 'Control rod absorber.' },
    { id: 'helium', name: 'Helium (He)', category: 'coolants', density: 1.78e-4, densityUnit: 'g/cm3', description: 'Pin plenum fill gas.' },
    { id: 'air', name: 'Air (dry)', category: 'other', density: 1.205e-3, densityUnit: 'g/cm3', description: 'Instrument/guide tube air gap.' },
    { id: 'graphite', name: 'Graphite', category: 'moderators', density: 1.75, densityUnit: 'g/cm3', description: 'HTGR reflector / moderator.' },
    { id: 'inconel-718', name: 'Inconel 718', category: 'structure', density: 8.19, densityUnit: 'g/cm3', description: 'Grid spacers and structural alloy.' },
    { id: 'borated-poly', name: 'Borated Polyethylene', category: 'shielding', density: 1.02, densityUnit: 'g/cm3', description: 'Neutron shielding.' },
    { id: 'sodium', name: 'Sodium (Na)', category: 'coolants', density: 0.971, densityUnit: 'g/cm3', description: 'SFR coolant at ~200 °C reference density.' },
    { id: 'heavy-water', name: 'Heavy Water (D₂O)', category: 'moderators', density: 1.105, densityUnit: 'g/cm3', description: 'CANDU moderator.' },
    { id: 'flibe', name: 'FLiBe (2LiF·BeF₂)', category: 'coolants', density: 1.94, densityUnit: 'g/cm3', description: 'Molten-salt coolant / blanket.' },
    { id: 'mox-5pct', name: 'MOX (5% Pu)', category: 'fuels', density: 10.6, densityUnit: 'g/cm3', description: 'Mixed-oxide LWR fuel.' },
];

export function renderMaterial(code: MonteCarloCode, mat: SelectedMaterial): string {
    const n = mat.mcnpNumber;
    // Newlines in a custom name would split a comment/name across lines in
    // every generated deck; flatten them. For Python (OpenMC) the label lands
    // inside a single-quoted string literal, so single quotes and backslashes
    // in a hostile/accidental name would break the generated script — the
    // label is display-only, so substitute safe lookalikes instead of relying
    // on escape sequences.
    const rawLabel = (mat.customName || mat.name).replace(/[\r\n]+/g, ' ');
    const label = code === 'openmc'
        ? rawLabel.replace(/\\/g, '/').replace(/'/g, '"')
        : rawLabel;
    switch (mat.id) {
        case 'light-water':
            if (code === 'mcnp') return `c ${label}\nm${n}    1001.80c  6.69174e-2\n       8016.80c  3.34587e-2\nmt${n}   lwtr.20t`;
            if (code === 'openmc') return `${_pyVar(mat)} = openmc.Material(name='${label}')\n${_pyVar(mat)}.set_density('g/cm3', ${mat.density})\n${_pyVar(mat)}.add_nuclide('H1', 2.0)\n${_pyVar(mat)}.add_nuclide('O16', 1.0)\n${_pyVar(mat)}.add_s_alpha_beta('c_H_in_H2O')`;
            if (code === 'serpent') return `% ${label}\nmat water${n} ${mat.density}\n1001.80c  6.69174e-2\n8016.80c  3.34587e-2\ntherm hwtr`;
            return `${_sconeName(mat)} { temp 600; composition { 1001.06 6.691740e-2; 8016.06 3.345870e-2; } }`;
        case 'uo2-3pct':
            if (code === 'mcnp') return `c ${label}\nm${n}    92235.80c  0.010000\n       92238.80c  0.323333\n        8016.80c  0.666667`;
            if (code === 'openmc') return `${_pyVar(mat)} = openmc.Material(name='${label}')\n${_pyVar(mat)}.set_density('g/cm3', ${mat.density})\n${_pyVar(mat)}.add_nuclide('U235', 0.010000)\n${_pyVar(mat)}.add_nuclide('U238', 0.323333)\n${_pyVar(mat)}.add_nuclide('O16', 0.666667)`;
            if (code === 'serpent') return `% ${label}\nmat uo2_${n} -${mat.density}\n92235.80c  0.010000\n92238.80c  0.323333\n8016.80c  0.666667`;
            return `${_sconeName(mat)} { temp 600; composition { 92235.06 1.000000e-2; 92238.06 3.233330e-1; 8016.06 6.666670e-1; } }`;
        case 'uo2-4.5pct':
            if (code === 'mcnp') return `c ${label}\nm${n}    92235.80c  0.015000\n       92238.80c  0.318333\n        8016.80c  0.666667`;
            if (code === 'openmc') return `${_pyVar(mat)} = openmc.Material(name='${label}')\n${_pyVar(mat)}.set_density('g/cm3', ${mat.density})\n${_pyVar(mat)}.add_nuclide('U235', 0.015000)\n${_pyVar(mat)}.add_nuclide('U238', 0.318333)\n${_pyVar(mat)}.add_nuclide('O16', 0.666667)`;
            if (code === 'serpent') return `% ${label}\nmat uo2_${n} -${mat.density}\n92235.80c  0.015000\n92238.80c  0.318333\n8016.80c  0.666667`;
            return `${_sconeName(mat)} { temp 600; composition { 92235.06 1.500000e-2; 92238.06 3.183330e-1; 8016.06 6.666670e-1; } }`;
        case 'uo2-5pct':
            if (code === 'mcnp') return `c ${label}\nm${n}    92235.80c  0.016667\n       92238.80c  0.316667\n        8016.80c  0.666667`;
            if (code === 'openmc') return `${_pyVar(mat)} = openmc.Material(name='${label}')\n${_pyVar(mat)}.set_density('g/cm3', ${mat.density})\n${_pyVar(mat)}.add_nuclide('U235', 0.016667)\n${_pyVar(mat)}.add_nuclide('U238', 0.316667)\n${_pyVar(mat)}.add_nuclide('O16', 0.666667)`;
            if (code === 'serpent') return `% ${label}\nmat uo2_${n} -${mat.density}\n92235.80c  0.016667\n92238.80c  0.316667\n8016.80c  0.666667`;
            return `${_sconeName(mat)} { temp 600; composition { 92235.06 1.666700e-2; 92238.06 3.166670e-1; 8016.06 6.666670e-1; } }`;
        case 'zirc4':
            if (code === 'mcnp') return `c ${label}\nm${n}    40000.80c -0.9819\n       50000.80c -0.0150\n       26000.80c -0.0021\n       24000.80c -0.0010`;
            if (code === 'openmc') return `${_pyVar(mat)} = openmc.Material(name='${label}')\n${_pyVar(mat)}.set_density('g/cm3', ${mat.density})\n${_pyVar(mat)}.add_element('Zr', 0.9819, percent_type='wo')\n${_pyVar(mat)}.add_element('Sn', 0.0150, percent_type='wo')\n${_pyVar(mat)}.add_element('Fe', 0.0021, percent_type='wo')\n${_pyVar(mat)}.add_element('Cr', 0.0010, percent_type='wo')`;
            if (code === 'serpent') return `% ${label}\nmat zirc_${n} -${mat.density}\n40000.80c -0.9819\n50000.80c -0.0150\n26000.80c -0.0021\n24000.80c -0.0010`;
            return `${_sconeName(mat)} { temp 600; composition { 40000.06 9.819000e-1; 50119.06 1.500000e-2; 26056.06 2.100000e-3; 24052.06 1.000000e-3; } }`;
        case 'ss304':
            if (code === 'mcnp') return `c ${label}\nm${n}    24050.80c  7.67780e-4\n       24052.80c  1.48060e-2\n       24053.80c  1.67890e-3\n       24054.80c  4.17910e-4\n       26054.80c  3.46200e-3\n       26056.80c  5.43450e-2\n       26057.80c  1.25510e-3\n       26058.80c  1.67030e-4\n       25055.80c  1.76040e-3\n       28058.80c  5.60890e-3\n       28060.80c  2.16050e-3\n       28061.80c  9.39170e-5\n       28062.80c  2.99450e-4\n       28064.80c  7.62610e-5\n       14028.80c  9.52810e-4\n       14029.80c  4.83810e-5\n       14030.80c  3.18930e-5`;
            if (code === 'openmc') return `${_pyVar(mat)} = openmc.Material(name='${label}')\n${_pyVar(mat)}.set_density('g/cm3', ${mat.density})\n${_pyVar(mat)}.add_element('Cr', 0.19)\n${_pyVar(mat)}.add_element('Ni', 0.10)\n${_pyVar(mat)}.add_element('Fe', 0.69)\n${_pyVar(mat)}.add_element('Mn', 0.02)`;
            if (code === 'serpent') return `% ${label}\nmat ss304_${n} -${mat.density}\n24052.80c  0.19\n28058.80c  0.10\n26056.80c  0.69\n25055.80c  0.02`;
            return `${_sconeName(mat)} { temp 600; composition { 24052.06 1.900000e-1; 28058.06 1.000000e-1; 26056.06 6.900000e-1; 25055.06 2.000000e-2; } }`;
        case 'b4c-natural':
            if (code === 'mcnp') return `c ${label}\nm${n}    5010.80c  0.199\n       5011.80c  0.801`;
            if (code === 'openmc') return `${_pyVar(mat)} = openmc.Material(name='${label}')\n${_pyVar(mat)}.set_density('g/cm3', ${mat.density})\n${_pyVar(mat)}.add_nuclide('B10', 0.199)\n${_pyVar(mat)}.add_nuclide('B11', 0.801)`;
            if (code === 'serpent') return `% ${label}\nmat b4c_${n} -${mat.density}\n5010.80c  0.199\n5011.80c  0.801`;
            return `${_sconeName(mat)} { temp 600; composition { 5010.06 1.990000e-1; 5011.06 8.010000e-1; } }`;
        case 'helium':
            if (code === 'mcnp') return `c ${label}\nm${n}    2004.80c  1.0`;
            if (code === 'openmc') return `${_pyVar(mat)} = openmc.Material(name='${label}')\n${_pyVar(mat)}.set_density('g/cm3', ${mat.density})\n${_pyVar(mat)}.add_nuclide('He4', 1.0)`;
            if (code === 'serpent') return `% ${label}\nmat he_${n} ${mat.density}\n2004.80c  1.0`;
            return `${_sconeName(mat)} { temp 600; composition { 2004.06 1.000000e+0; } }`;
        case 'air':
            if (code === 'mcnp') return `c ${label}\nm${n}    7014.80c  3.663e-5\n       7015.80c  1.318e-4\n        8016.80c  4.918e-6`;
            if (code === 'openmc') return `${_pyVar(mat)} = openmc.Material(name='${label}')\n${_pyVar(mat)}.set_density('g/cm3', ${mat.density})\n${_pyVar(mat)}.add_element('N', 0.78)\n${_pyVar(mat)}.add_element('O', 0.21)\n${_pyVar(mat)}.add_element('Ar', 0.01)`;
            if (code === 'serpent') return `% ${label}\nmat air_${n} ${mat.density}\n7014.80c  0.78\n8016.80c  0.21\n18040.80c  0.01`;
            return `${_sconeName(mat)} { temp 300; composition { 7014.06 7.800000e-1; 8016.06 2.100000e-1; 18040.06 1.000000e-2; } }`;
        default:
            if (code === 'mcnp') return `c ${label} (${mat.id})\nm${n}    92238.80c  1.0  $ placeholder — edit composition`;
            if (code === 'openmc') return `${_pyVar(mat)} = openmc.Material(name='${label}')\n${_pyVar(mat)}.set_density('g/cm3', ${mat.density})`;
            if (code === 'serpent') return `% ${label}\nmat mat_${n} -${mat.density}\n92238.80c  1.0`;
            return `${_sconeName(mat)} { temp 600; composition { 92238.06 1.000000e+0; } }`;
    }
}

function _pyVar(mat: SelectedMaterial): string {
    return 'mat_' + mat.id.replace(/[^a-z0-9]/gi, '_');
}

function _sconeName(mat: SelectedMaterial): string {
    return mat.id.replace(/[^A-Za-z0-9]/g, '_');
}
