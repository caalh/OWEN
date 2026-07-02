// Assembles starter Monte Carlo decks from Input Builder wizard state.
// Self-contained: injected into the webview via Function.prototype.toString().

import type { MonteCarloCode, SelectedMaterial } from './materials';
import { renderMaterial } from './materials';
import type { LatticeSpec } from '../panels/latticeCodegen';
import { genMCNP, genOpenMC, genSerpent, genSCONE } from '../panels/latticeCodegen';

export interface RunSettings {
    particles: number;
    inactive: number;
    cycles: number;
    keffGuess: number;
}

export interface InputBuilderState {
    code: MonteCarloCode;
    title: string;
    materials: SelectedMaterial[];
    geometryMode: 'pin-cell' | 'lattice';
    lattice: LatticeSpec | null;
    settings: RunSettings;
}

export const DEFAULT_SETTINGS: RunSettings = {
    particles: 10000,
    inactive: 50,
    cycles: 200,
    keffGuess: 1.0,
};

export function buildDeck(state: InputBuilderState): string {
    if (state.code === 'mcnp') return buildMcnp(state);
    if (state.code === 'openmc') return buildOpenmc(state);
    if (state.code === 'serpent') return buildSerpent(state);
    return buildScone(state);
}

function buildMcnp(state: InputBuilderState): string {
    const s = state.settings;
    const lines: string[] = [
        'c ============================================================',
        'c OWEN Input Builder — ' + (state.title || 'generated deck'),
        'c ============================================================',
        '',
        'c --- Materials ---',
    ];
    state.materials.forEach((m) => lines.push(renderMaterial('mcnp', m)));
    lines.push('', 'c --- Surfaces ---');
    if (state.geometryMode === 'pin-cell') {
        lines.push(
            '1 cz 0.39218   $ fuel radius',
            '2 cz 0.45720   $ clad OD',
            '3 cz 0.63000   $ pin cell boundary',
            '4 pz 0.0',
            '5 pz 365.76    $ active height',
            '',
            'c --- Cells ---',
            '10  1 -10.44  -1  4 -5  imp:n=1  $ fuel',
            '11  2 -6.56   1 -2  4 -5  imp:n=1  $ clad',
            '12  3         2 -3  4 -5  imp:n=1  $ moderator',
            '13  0          3     4 -5  imp:n=0  $ outside',
        );
    }
    if (state.geometryMode === 'lattice' && state.lattice) {
        lines.push('c --- Pin universes (simplified) ---');
        lines.push(
            '1 cz 0.39218',
            '2 cz 0.45720',
            '3 cz 0.63000',
            '10  1 -10.44  -1  u=1 imp:n=1',
            '11  2 -6.56    1 -2  u=1 imp:n=1',
            '12  3          2 -3  u=1 imp:n=1',
            '20  3          -3   u=2 imp:n=1  $ guide tube (water)',
        );
        lines.push('', 'c --- Lattice ---');
        lines.push(genMCNP(state.lattice));
    }
    lines.push(
        '',
        'c --- Settings ---',
        'mode n',
        'kcode ' + s.particles + ' ' + s.keffGuess + ' ' + s.inactive + ' ' + s.cycles,
        'ksrc 0 0 182.88',
        'print',
    );
    return lines.join('\n') + '\n';
}

function buildOpenmc(state: InputBuilderState): string {
    const s = state.settings;
    const lines: string[] = [
        '#!/usr/bin/env python3',
        '"""OWEN Input Builder — ' + (state.title || 'generated model') + '"""',
        '',
        'import openmc',
        '',
        '# --- Materials ---',
    ];
    state.materials.forEach((m) => lines.push(renderMaterial('openmc', m)));
    const matVars = state.materials.map((m) => 'mat_' + m.id.replace(/[^a-z0-9]/gi, '_'));
    lines.push('', 'materials = openmc.Materials([' + matVars.join(', ') + '])', '');
    if (state.geometryMode === 'pin-cell') {
        // With no materials selected, fill the cells with None (void) instead
        // of interpolating `undefined` into the generated Python.
        const fuelFill = matVars[0] ?? 'None';
        const cladFill = matVars[1] ?? matVars[0] ?? 'None';
        const modFill = matVars.find((_, i) => state.materials[i]?.id === 'light-water')
            ?? matVars[matVars.length - 1] ?? 'None';
        if (matVars.length === 0) {
            lines.push('# NOTE: no materials selected — cells are filled with None (void).');
            lines.push('#       Add materials in the Input Builder before running.');
        }
        lines.push(
            '# --- Pin cell geometry ---',
            'fuel_or = openmc.ZCylinder(r=0.39218)',
            'clad_or = openmc.ZCylinder(r=0.45720)',
            'pin_bound = openmc.ZCylinder(r=0.63000, boundary_type="reflective")',
            'fuel_cell = openmc.Cell(fill=' + fuelFill + ', region=-fuel_or)',
            'clad_cell = openmc.Cell(fill=' + cladFill + ', region=+fuel_or & -clad_or)',
            'mod_cell = openmc.Cell(fill=' + modFill + ', region=+clad_or & -pin_bound)',
            'root = openmc.Universe(cells=[fuel_cell, clad_cell, mod_cell])',
            'geometry = openmc.Geometry(root)',
        );
    } else if (state.lattice) {
        lines.push('# --- Lattice (from Lattice Builder) ---');
        lines.push(genOpenMC(state.lattice));
        lines.push('geometry = openmc.Geometry(root_universe)  # adjust to match lattice output');
    }
    lines.push(
        '',
        'settings = openmc.Settings()',
        'settings.batches = ' + s.cycles,
        'settings.inactive = ' + s.inactive,
        'settings.particles = ' + s.particles,
        'settings.run_mode = "eigenvalue"',
        '',
        'model = openmc.Model(geometry, materials, settings)',
        'model.run()',
    );
    return lines.join('\n') + '\n';
}

function buildSerpent(state: InputBuilderState): string {
    const s = state.settings;
    const lines: string[] = [
        '% OWEN Input Builder — ' + (state.title || 'generated deck'),
        '',
        '% --- Materials ---',
    ];
    state.materials.forEach((m) => lines.push(renderMaterial('serpent', m)));
    if (state.geometryMode === 'pin-cell') {
        lines.push(
            '',
            '% --- Pin ---',
            'pin 1',
            'fuel     0.39218',
            'clad     0.45720',
            'water',
            '',
            'surf 1 inf',
            'cell 1 0 fuel -1',
        );
    } else if (state.lattice) {
        lines.push('', '% --- Lattice ---');
        lines.push(genSerpent(state.lattice));
    }
    lines.push(
        '',
        'set pop ' + s.particles + ' ' + s.inactive + ' ' + s.cycles,
        'set bc 3',
    );
    return lines.join('\n') + '\n';
}

function buildScone(state: InputBuilderState): string {
    const s = state.settings;
    const lines: string[] = [
        '// OWEN Input Builder — ' + (state.title || 'generated deck'),
        '',
        'eigenPhysicsPackage {',
        '  numInactiveCycles ' + s.inactive + ';',
        '  numActiveCycles ' + s.cycles + ';',
        '  numNeutronHistoriesPerCycle ' + s.particles + ';',
        '}',
        '',
        '// --- Materials ---',
    ];
    state.materials.forEach((m) => lines.push(renderMaterial('scone', m)));
    if (state.geometryMode === 'lattice' && state.lattice) {
        lines.push('', '// --- Lattice ---');
        lines.push(genSCONE(state.lattice));
    } else {
        lines.push(
            '',
            'pinFuel { id 1; type pinUniverse; radii (0.39218 0.45720 0.0); fills (UO2 Zircaloy4 Water); }',
            'rootCell { type simpleCell; id 10; surfaces (-100); filltype uni; universe 1; }',
        );
    }
    return lines.join('\n') + '\n';
}
