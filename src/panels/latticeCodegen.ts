// Pure, vscode-free lattice code generators for the OWEN Lattice Builder.
//
// This module is the single source of truth for the MCNP / OpenMC / Serpent /
// SCONE generators. It is imported two ways:
//   1. Headless unit tests import the functions directly (no vscode, no DOM).
//   2. `latticeBuilder.ts` injects each function into the webview <script> via
//      `Function.prototype.toString()`, so the live preview uses the EXACT same
//      logic that the tests assert against.
//
// Because of (2) every `gen*` function MUST be fully self-contained: it may only
// reference its `spec` argument and JavaScript built-ins — no module-scope
// helpers or constants — otherwise esbuild's production minifier would rename
// those references and break the injected copy. Keep them standalone.

/** Per-pin-type identifiers, one row per palette entry. */
export interface PinTypeIds {
    /** Internal palette id painted into the grid (1..N). */
    id: number;
    label: string;
    /** MCNP universe number used in the lattice fill array. */
    mcnpUniverse: number;
    /** OpenMC universe variable name placed in `lattice.universes`. */
    openmcName: string;
    /** Serpent universe name used in the `lat` map. */
    serpentName: string;
    /** SCONE pinUniverse block name. */
    sconeName: string;
    /** SCONE universe id (integer) referenced by the latUniverse `map`. */
    sconeId: number;
    /** SCONE pinUniverse `radii` (cm); outermost entry must be 0.0. */
    sconeRadii: string;
    /** SCONE pinUniverse `fills`; same length as radii, outermost = moderator. */
    sconeFills: string;
}

/** Structural identifiers so generated code drops into an existing deck. */
export interface StructuralIds {
    /** MCNP lattice cell number (default 100). */
    mcnpCell: number;
    /** MCNP lattice universe number (default 10). */
    mcnpLatticeUniverse: number;
    /** MCNP unit-cell surface numbers [+x, -x, +y, -y] (default 10..13). */
    mcnpSurf: [number, number, number, number];
    /** Serpent lattice id (default 100). */
    serpentLatId: number;
    /** OpenMC lattice Python variable / name (default "lattice"). */
    openmcLatName: string;
    /** SCONE latUniverse block name (default "latCore"). */
    sconeLatName: string;
    /** SCONE latUniverse id used by the geometry root (default 200). */
    sconeLatId: number;
}

export interface LatticeSpec {
    gridSize: number;
    pitch: number;
    /** grid[row][col] = palette id (matches PinTypeIds.id). */
    grid: number[][];
    pins: PinTypeIds[];
    structural: StructuralIds;
}

export function genMCNP(spec: LatticeSpec): string {
    const gridSize = spec.gridSize;
    const pitch = spec.pitch;
    const st = spec.structural;
    const uni: Record<number, number> = {};
    spec.pins.forEach((p) => { uni[p.id] = p.mcnpUniverse; });
    const half = pitch / 2;
    const k = Math.floor((gridSize - 1) / 2);
    const range = gridSize % 2 === 1
        ? '-' + k + ':' + k + ' -' + k + ':' + k + ' 0:0'
        : '-' + (gridSize / 2) + ':' + (gridSize / 2 - 1) + ' -' + (gridSize / 2) + ':' + (gridSize / 2 - 1) + ' 0:0';
    const s = st.mcnpSurf;
    const lines = [
        'c --- ' + gridSize + 'x' + gridSize + ' Lattice (u=' + st.mcnpLatticeUniverse + ') ---',
        'c  Pin pitch = ' + pitch.toFixed(4) + ' cm',
        st.mcnpCell + ' 0  -' + s[0] + ' ' + s[1] + ' -' + s[2] + ' ' + s[3] +
            '  lat=1 u=' + st.mcnpLatticeUniverse + ' imp:n=1 fill=' + range,
    ];
    spec.grid.forEach((row) => lines.push('    ' + row.map((v) => uni[v] !== undefined ? uni[v] : v).join(' ')));
    lines.push('c');
    lines.push('c  Lattice cell surfaces (half-pitch = ' + half.toFixed(4) + ' cm)');
    lines.push(s[0] + '  px  ' + half.toFixed(4));
    lines.push(s[1] + '  px -' + half.toFixed(4));
    lines.push(s[2] + '  py  ' + half.toFixed(4));
    lines.push(s[3] + '  py -' + half.toFixed(4));
    return lines.join('\n');
}

export function genOpenMC(spec: LatticeSpec): string {
    const gridSize = spec.gridSize;
    const pitch = spec.pitch;
    const v = spec.structural.openmcLatName;
    const names: Record<number, string> = {};
    spec.pins.forEach((p) => { names[p.id] = p.openmcName; });
    const lines = [
        '# --- ' + gridSize + 'x' + gridSize + ' Lattice ---',
        v + ' = openmc.RectLattice(name="' + gridSize + 'x' + gridSize + ' lattice")',
        v + '.pitch = (' + pitch + ', ' + pitch + ')',
        v + '.lower_left = (' + (-pitch * gridSize / 2) + ', ' + (-pitch * gridSize / 2) + ')',
        '',
        v + '.universes = [',
    ];
    spec.grid.forEach((row) => lines.push('    [' + row.map((val) => names[val] !== undefined ? names[val] : ('type_' + val)).join(', ') + '],'));
    lines.push(']');
    return lines.join('\n');
}

export function genSerpent(spec: LatticeSpec): string {
    const gridSize = spec.gridSize;
    const pitch = spec.pitch;
    const latId = spec.structural.serpentLatId;
    const names: Record<number, string> = {};
    spec.pins.forEach((p) => { names[p.id] = p.serpentName; });
    const lines = [
        '% --- ' + gridSize + 'x' + gridSize + ' Lattice ---',
        'lat ' + latId + ' 1  0.0 0.0  ' + gridSize + ' ' + gridSize + '  ' + pitch.toFixed(4),
    ];
    spec.grid.forEach((row) => lines.push(row.map((v) => names[v] !== undefined ? names[v] : ('U' + v)).join(' ')));
    return lines.join('\n');
}

export function genSCONE(spec: LatticeSpec): string {
    const gridSize = spec.gridSize;
    const pitch = spec.pitch;
    const st = spec.structural;
    const byId: Record<number, PinTypeIds> = {};
    spec.pins.forEach((p) => { byId[p.id] = p; });

    // Determine which pin types are actually painted (preserve palette order).
    const usedIds: number[] = [];
    spec.pins.forEach((p) => {
        for (let r = 0; r < spec.grid.length; r++) {
            if (spec.grid[r].indexOf(p.id) !== -1) { usedIds.push(p.id); break; }
        }
    });

    const lines = [
        '// --- ' + gridSize + 'x' + gridSize + ' SCONE lattice universe (OWEN Lattice Builder) ---',
        '// Wire this lattice into your geometry root, e.g.  fill u<' + st.sconeLatId + '>;',
        '// and define the referenced materials (UO2, Helium, Zircaloy, Water, ...) in',
        '// nuclearData { materials { ... } }. The radii/fills below are PLACEHOLDER',
        '// canonical PWR pin-cell values - confirm them against your design.',
        '',
        st.sconeLatName + ' { id ' + st.sconeLatId + '; type latUniverse;',
        '  shape (' + gridSize + ' ' + gridSize + ' 1); pitch (' + pitch + ' ' + pitch + ' ' + pitch + '); origin (0.0 0.0 0.0);',
        '  padMat Water;',
        '  map (',
    ];
    spec.grid.forEach((row) => {
        const cells = row.map((val) => byId[val] !== undefined ? byId[val].sconeId : val);
        lines.push('    ' + cells.join(' '));
    });
    lines.push('  ); }');
    lines.push('');
    lines.push('// pinUniverse stubs for each painted pin type (outermost radius 0.0 = fills to cell edge):');
    usedIds.forEach((id) => {
        const p = byId[id];
        lines.push(p.sconeName + ' { id ' + p.sconeId + '; type pinUniverse;  // ' + p.label);
        lines.push('  radii (' + p.sconeRadii + ');');
        lines.push('  fills (' + p.sconeFills + '); }');
    });
    return lines.join('\n');
}

/** Default per-pin-type identifiers (today's hardcoded values, made editable). */
export function defaultPinTypes(): PinTypeIds[] {
    return [
        { id: 1, label: 'Fuel', mcnpUniverse: 1, openmcName: 'fuel_pin', serpentName: 'P1', sconeName: 'fuelPin', sconeId: 101, sconeRadii: '0.392 0.400 0.457 0.0', sconeFills: 'UO2 Helium Zircaloy Water' },
        { id: 2, label: 'Guide Tube', mcnpUniverse: 2, openmcName: 'guide_tube', serpentName: 'GT', sconeName: 'guideTube', sconeId: 102, sconeRadii: '0.561 0.602 0.0', sconeFills: 'Water Zircaloy Water' },
        { id: 3, label: 'Instr. Tube', mcnpUniverse: 3, openmcName: 'instr_tube', serpentName: 'IT', sconeName: 'instrTube', sconeId: 103, sconeRadii: '0.561 0.602 0.0', sconeFills: 'Water Zircaloy Water' },
        { id: 4, label: 'Water Rod', mcnpUniverse: 4, openmcName: 'water_rod', serpentName: 'WR', sconeName: 'waterRod', sconeId: 104, sconeRadii: '0.0', sconeFills: 'Water' },
        { id: 5, label: 'Alt Fuel', mcnpUniverse: 5, openmcName: 'alt_fuel', serpentName: 'P2', sconeName: 'altFuel', sconeId: 105, sconeRadii: '0.392 0.400 0.457 0.0', sconeFills: 'UO2alt Helium Zircaloy Water' },
    ];
}

/** Default structural identifiers (the values previously hardcoded). */
export function defaultStructuralIds(): StructuralIds {
    return {
        mcnpCell: 100,
        mcnpLatticeUniverse: 10,
        mcnpSurf: [10, 11, 12, 13],
        serpentLatId: 100,
        openmcLatName: 'lattice',
        sconeLatName: 'latCore',
        sconeLatId: 200,
    };
}
