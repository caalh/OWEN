// MCNP -> SCONE input (dictionary syntax). Emits a complete
// eigenPhysicsPackage skeleton with converted surfaces, cells, a cellUniverse
// root, materials, and kcode-derived population settings. SCONE gotchas
// honored: `key value;` dict syntax, ASCII-only output, aceNeutronDatabase
// (never aceNuclearDatabase), lattice maps via latUniverse when derivable.
// Anything that does not map cleanly becomes a "! TODO(owen-convert)" comment.

import { parseMcnpDeck, McnpDeck, McnpSurface, McnpCell } from './mcnpModel';
import { zaidBase } from './zaid';
import { ConversionResult, ConversionIssue, TODO_MARK } from './types';
import { derivePitch } from './mcnpToSerpent';

const SCONE_TEMP = 300;         // default material temperature (K)
const SCONE_SUFFIX = '.03';     // must match temp per SCONE convention

function surfaceToScone(s: McnpSurface, issues: ConversionIssue[]): string {
    const p = s.params;
    switch (s.type) {
        case 'cz':
            return `surf_${s.id} { id ${s.id}; type zCylinder; origin (0.0 0.0 0.0); radius ${p[0]}; }`;
        case 'c/z':
            return `surf_${s.id} { id ${s.id}; type zCylinder; origin (${p[0]} ${p[1]} 0.0); radius ${p[2]}; }`;
        case 'cx':
            return `surf_${s.id} { id ${s.id}; type xCylinder; origin (0.0 0.0 0.0); radius ${p[0]}; }`;
        case 'c/x':
            return `surf_${s.id} { id ${s.id}; type xCylinder; origin (0.0 ${p[0]} ${p[1]}); radius ${p[2]}; }`;
        case 'cy':
            return `surf_${s.id} { id ${s.id}; type yCylinder; origin (0.0 0.0 0.0); radius ${p[0]}; }`;
        case 'c/y':
            return `surf_${s.id} { id ${s.id}; type yCylinder; origin (${p[0]} 0.0 ${p[1]}); radius ${p[2]}; }`;
        case 'px':
            return `surf_${s.id} { id ${s.id}; type xPlane; x0 ${p[0]}; }`;
        case 'py':
            return `surf_${s.id} { id ${s.id}; type yPlane; y0 ${p[0]}; }`;
        case 'pz':
            return `surf_${s.id} { id ${s.id}; type zPlane; z0 ${p[0]}; }`;
        case 'so':
            return `surf_${s.id} { id ${s.id}; type sphere; origin (0.0 0.0 0.0); radius ${p[0]}; }`;
        case 's':
        case 'sph':
            if (p.length >= 4) {
                return `surf_${s.id} { id ${s.id}; type sphere; origin (${p[0]} ${p[1]} ${p[2]}); radius ${p[3]}; }`;
            }
            break;
        case 'rpp':
            if (p.length >= 6) {
                const n = p.map(parseFloat);
                const cx = (n[0] + n[1]) / 2;
                const cy = (n[2] + n[3]) / 2;
                const cz = (n[4] + n[5]) / 2;
                const hx = (n[1] - n[0]) / 2;
                const hy = (n[3] - n[2]) / 2;
                const hz = (n[5] - n[4]) / 2;
                return `surf_${s.id} { id ${s.id}; type box; origin (${cx} ${cy} ${cz}); halfwidth (${hx} ${hy} ${hz}); }`;
            }
            break;
        case 'rcc':
            if (p.length >= 7) {
                const n = p.map(parseFloat);
                if (n[3] === 0 && n[4] === 0) {
                    return (
                        `surf_${s.id} { id ${s.id}; type truncCylinder; ` +
                        `origin (${n[0]} ${n[1]} ${n[2] + n[5] / 2}); halfwidth ${Math.abs(n[5] / 2)}; ` +
                        `radius ${n[6]}; align z; }`
                    );
                }
                issues.push({ sourceLine: s.line, message: `RCC surface ${s.id} has an off-z axis` });
                return `! ${TODO_MARK}: surface ${s.id} rcc with off-z height vector — convert manually`;
            }
            break;
    }
    issues.push({ sourceLine: s.line, message: `Surface ${s.id} type '${s.type}' not converted for SCONE` });
    return `! ${TODO_MARK}: could not convert surface ${s.id} type '${s.type}': ${p.join(' ')}`;
}

function regionToScone(cell: McnpCell, issues: ConversionIssue[]): string | null {
    // SCONE simpleCell surfaces take a halfspace list like (-1 2 -3).
    // Unions / parentheses / complements are not expressible there.
    if (/[():#]/.test(cell.regionRaw)) {
        issues.push({
            sourceLine: cell.line,
            message: `Cell ${cell.id} region '${cell.regionRaw}' uses union/complement/parentheses — not expressible as a SCONE simpleCell halfspace list`,
        });
        return null;
    }
    const tokens = cell.regionRaw.split(/\s+/).filter(Boolean);
    if (tokens.some((t) => !/^[-+]?\d+$/.test(t))) {
        issues.push({ sourceLine: cell.line, message: `Cell ${cell.id} region has unsupported tokens` });
        return null;
    }
    return tokens.map((t) => t.replace(/^\+/, '')).join(' ');
}

export function mcnpToScone(mcnpText: string): ConversionResult {
    const deck = parseMcnpDeck(mcnpText);
    const issues: ConversionIssue[] = [];

    // Identify the outer boundary: surface(s) referenced by the graveyard cell.
    const graveyard = deck.cells.find((c) => c.importanceZero && c.matId === 0);
    let borderSurf: number | null = null;
    if (graveyard) {
        const ids = (graveyard.regionRaw.match(/-?\d+/g) ?? []).map((t) => Math.abs(parseInt(t, 10)));
        if (ids.length === 1) borderSurf = ids[0];
    }

    const matName = (id: number) => `mat${id}`;

    const out: string[] = [
        '! Converted from MCNP by OWEN (BelvoirDynamics) - EXPERIMENTAL',
        '! NOTE: Review and verify all converted output before use.',
        `! Unconvertible constructs are marked with "${TODO_MARK}".`,
        '',
        'type eigenPhysicsPackage;',
        '',
    ];

    const st = deck.settings;
    out.push(`pop ${st.particles ?? 10000};`);
    if (st.batches !== undefined && st.inactive !== undefined) {
        out.push(`active ${st.batches - st.inactive};`);
        out.push(`inactive ${st.inactive};`);
    } else {
        out.push('active 100;', 'inactive 20;');
        out.push(`! ${TODO_MARK}: kcode cycle counts not found - defaults used above`);
        issues.push({ sourceLine: -1, message: 'kcode cycle counts incomplete — SCONE active/inactive use defaults' });
    }
    out.push('XSdata ce;', 'dataType ce;', '');

    // -- Geometry --
    out.push('geometry {', '  type geometryStd;');
    const hasReflective = deck.surfaces.some((s) => s.boundary === 'reflective');
    if (hasReflective) {
        out.push('  boundary (1 1 1 1 1 1);');
        out.push(`  ! ${TODO_MARK}: MCNP had *reflective surfaces; all-reflective boundary assumed - verify per-face intent.`);
        issues.push({ sourceLine: -1, message: 'Reflective surfaces mapped to an all-reflective SCONE boundary vector — verify' });
    } else {
        out.push('  boundary (0 0 0 0 0 0);');
    }
    out.push('  graph { type shrunk; }', '');

    // surfaces
    out.push('  surfaces {');
    for (const s of deck.surfaces) {
        out.push('    ' + surfaceToScone(s, issues));
    }
    out.push('  }', '');

    // cells (skip graveyard — SCONE uses the root universe border instead)
    const convertedCells: number[] = [];
    out.push('  cells {');
    for (const c of deck.cells) {
        if (c === graveyard) continue;
        if (c.latticeFill || c.lattice !== null) continue; // handled under universes
        if (c.fill) {
            issues.push({ sourceLine: c.line, message: `Cell ${c.id} uses fill=${c.fill} — nest universes manually in SCONE` });
            out.push(`    ! ${TODO_MARK}: cell ${c.id} uses fill=${c.fill} - nest the filled universe manually.`);
            continue;
        }
        const halfspaces = regionToScone(c, issues);
        if (halfspaces === null) {
            out.push(`    ! ${TODO_MARK}: cell ${c.id} region '${c.regionRaw}' not expressible as a simpleCell - convert manually.`);
            continue;
        }
        const fill = c.matId === 0
            ? 'filltype void;'
            : `filltype mat; material ${matName(c.matId)};`;
        out.push(`    cell_${c.id} { id ${c.id}; type simpleCell; surfaces (${halfspaces}); ${fill} }`);
        convertedCells.push(c.id);
    }
    out.push('  }', '');

    // universes: root + one cellUniverse holding the converted cells (+ lattices)
    out.push('  universes {');
    if (borderSurf !== null) {
        out.push(`    root { id 1000; type rootUniverse; border ${borderSurf}; fill u<1001>; }`);
    } else {
        out.push(`    ! ${TODO_MARK}: could not identify the outer boundary surface (no single-surface imp:n=0 graveyard cell).`);
        out.push('    root { id 1000; type rootUniverse; border 0; fill u<1001>; }');
        issues.push({ sourceLine: -1, message: 'Outer boundary surface not identified — set rootUniverse border manually' });
    }
    out.push(`    inner { id 1001; type cellUniverse; cells (${convertedCells.join(' ')}); }`);

    for (const c of deck.cells) {
        if (!c.latticeFill || c.lattice !== 1) {
            if (c.lattice === 2) {
                issues.push({ sourceLine: c.line, message: `Cell ${c.id} hexagonal lattice (lat=2) not converted` });
                out.push(`    ! ${TODO_MARK}: cell ${c.id} hexagonal lattice (lat=2) - build a SCONE latUniverse manually.`);
            }
            continue;
        }
        const lf = c.latticeFill;
        const pitch = derivePitch(c, deck);
        const uid = c.universe ?? c.id;
        if (pitch !== null && lf.nz === 1 && lf.universes.length === lf.nx * lf.ny) {
            out.push(`    lat_${uid} { id ${uid}; type latUniverse; shape (${lf.nx} ${lf.ny} 0); ` +
                `pitch (${pitch} ${pitch} 0.0); padMat void; map (`);
            for (let j = lf.ny - 1; j >= 0; j--) {
                out.push('      ' + lf.universes.slice(j * lf.nx, (j + 1) * lf.nx).join(' '));
            }
            out.push('    ); }');
            out.push(`    ! ${TODO_MARK}: verify latUniverse map row order and padMat against the MCNP fill array.`);
            issues.push({ sourceLine: c.line, message: `Cell ${c.id}: lattice converted to latUniverse — verify map order` });
        } else {
            issues.push({ sourceLine: c.line, message: `Cell ${c.id} lattice not converted (pitch underivable, 3-D fill, or ragged array)` });
            out.push(`    ! ${TODO_MARK}: cell ${c.id} lattice not converted - pitch underivable or fill not a full 2-D array.`);
        }
    }
    out.push('  }', '}', '');

    // -- Collision operator / transport (minimal viable stanza) --
    out.push(
        'collisionOperator { neutronCE { type neutronCEstd; } }',
        '',
        'transportOperator { type transportOperatorST; }',
        '',
        'inactiveTally { }',
        'activeTally {',
        '  norm fiss;',
        '  normVal 100.0;',
        '  fiss { type collisionClerk; response (fiss); fiss { type macroResponse; MT -6; } }',
        '}',
        '',
    );

    // -- Nuclear data --
    out.push('nuclearData {', '  handles {',
        '    ce { type aceNeutronDatabase; aceLibrary $SCONE_ACE; ! set to your ace library path',
        '    }',
        '  }',
        '  materials {');
    for (const mat of deck.materials) {
        const cell = deck.cells.find((c) => c.matId === mat.id && c.density !== null);
        out.push(`    ${matName(mat.id)} {`);
        out.push(`      temp ${SCONE_TEMP};`);
        if (cell?.density != null) {
            const kind = cell.density < 0 ? 'g/cm3 (mass)' : 'atoms/barn-cm';
            out.push(`      ! MCNP cell-card density: ${cell.density} (${kind})`);
        }
        out.push(`      ! ${TODO_MARK}: fractions below are copied from MCNP; SCONE compositions expect`);
        out.push('      ! atom densities in atoms/barn-cm - renormalize using the material density.');
        out.push('      composition {');
        for (const nuc of mat.nuclides) {
            out.push(`        ${zaidBase(nuc.zaid)}${SCONE_SUFFIX} ${nuc.fraction};`);
        }
        out.push('      }');
        out.push('    }');
        issues.push({ sourceLine: mat.line, message: `Material m${mat.id}: composition fractions need renormalization to atom densities` });
    }
    out.push('  }', '}', '');

    // ASCII-only guarantee
    const ascii = out.join('\n').replace(/[^\x00-\x7F]/g, '?');
    return { direction: 'mcnp_to_scone', output: ascii, issues };
}
