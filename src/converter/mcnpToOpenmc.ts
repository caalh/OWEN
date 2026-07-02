// MCNP -> OpenMC Python script. Port of groves converter.py mcnp_to_openmc
// with better surface coverage (rcc/rhp), lattice fill reporting, and
// explicit TODO markers for anything that cannot be mapped.

import { parseMcnpDeck, McnpSurface } from './mcnpModel';
import { MT_TO_SAB } from './zaid';
import { ConversionResult, ConversionIssue, TODO_MARK } from './types';

function surfaceToOpenmc(s: McnpSurface, issues: ConversionIssue[]): string {
    const bnd = s.boundary !== 'transmission' ? `, boundary_type='${s.boundary}'` : '';
    const p = s.params;
    switch (s.type) {
        case 'cz': return `openmc.ZCylinder(surface_id=${s.id}, r=${p[0]}${bnd})`;
        case 'cx': return `openmc.XCylinder(surface_id=${s.id}, r=${p[0]}${bnd})`;
        case 'cy': return `openmc.YCylinder(surface_id=${s.id}, r=${p[0]}${bnd})`;
        case 'c/z': return `openmc.ZCylinder(surface_id=${s.id}, x0=${p[0]}, y0=${p[1]}, r=${p[2]}${bnd})`;
        case 'c/x': return `openmc.XCylinder(surface_id=${s.id}, y0=${p[0]}, z0=${p[1]}, r=${p[2]}${bnd})`;
        case 'c/y': return `openmc.YCylinder(surface_id=${s.id}, x0=${p[0]}, z0=${p[1]}, r=${p[2]}${bnd})`;
        case 'pz': return `openmc.ZPlane(surface_id=${s.id}, z0=${p[0]}${bnd})`;
        case 'px': return `openmc.XPlane(surface_id=${s.id}, x0=${p[0]}${bnd})`;
        case 'py': return `openmc.YPlane(surface_id=${s.id}, y0=${p[0]}${bnd})`;
        case 'p':
            if (p.length >= 4) {
                return `openmc.Plane(surface_id=${s.id}, a=${p[0]}, b=${p[1]}, c=${p[2]}, d=${p[3]}${bnd})`;
            }
            break;
        case 'so': return `openmc.Sphere(surface_id=${s.id}, r=${p[0]}${bnd})`;
        case 's':
            if (p.length >= 4) {
                return `openmc.Sphere(surface_id=${s.id}, x0=${p[0]}, y0=${p[1]}, z0=${p[2]}, r=${p[3]}${bnd})`;
            }
            break;
        case 'sph':
            if (p.length >= 4) {
                return `openmc.Sphere(surface_id=${s.id}, x0=${p[0]}, y0=${p[1]}, z0=${p[2]}, r=${p[3]}${bnd})`;
            }
            break;
        case 'rpp':
            if (p.length >= 6) {
                return (
                    `openmc.model.RectangularParallelepiped(surface_id=${s.id}, ` +
                    `xmin=${p[0]}, xmax=${p[1]}, ymin=${p[2]}, ymax=${p[3]}, zmin=${p[4]}, zmax=${p[5]}${bnd})`
                );
            }
            break;
        case 'rcc':
            if (p.length >= 7) {
                const [vx, vy, vz, hx, hy, hz, r] = p.map(parseFloat);
                if (hx === 0 && hy === 0) {
                    return (
                        `openmc.model.RightCircularCylinder((${vx}, ${vy}, ${vz}), ${hz}, ${r}, axis='z'${bnd})`
                    );
                }
                if (hx === 0 && hz === 0) {
                    return `openmc.model.RightCircularCylinder((${vx}, ${vy}, ${vz}), ${hy}, ${r}, axis='y'${bnd})`;
                }
                if (hy === 0 && hz === 0) {
                    return `openmc.model.RightCircularCylinder((${vx}, ${vy}, ${vz}), ${hx}, ${r}, axis='x'${bnd})`;
                }
                issues.push({ sourceLine: s.line, message: `RCC surface ${s.id} has an off-axis height vector` });
                return `None  # ${TODO_MARK}: RCC surface ${s.id} with off-axis height vector — convert manually`;
            }
            break;
        case 'rhp':
        case 'hex':
            if (p.length >= 9) {
                const nums = p.map(parseFloat);
                const [bx, by] = [nums[0], nums[1]];
                const [hx, hy] = [nums[3], nums[4]];
                const [rx, ry] = [nums[6], nums[7]];
                if (hx === 0 && hy === 0) {
                    const edge = Math.hypot(rx, ry); // apothem (center -> flat face)
                    const orient = Math.abs(ry) >= Math.abs(rx) ? 'y' : 'x';
                    return (
                        `openmc.model.HexagonalPrism(edge_length=${(2 * edge / Math.sqrt(3)).toPrecision(8)}, ` +
                        `orientation='${orient}', origin=(${bx}, ${by})${bnd})` +
                        `  # ${TODO_MARK}: verify hexagon orientation/edge length (from RHP apothem ${edge.toPrecision(8)})`
                    );
                }
                issues.push({ sourceLine: s.line, message: `RHP surface ${s.id} with off-z axis is not converted` });
                return `None  # ${TODO_MARK}: RHP surface ${s.id} with off-z axis — convert manually`;
            }
            break;
    }
    issues.push({ sourceLine: s.line, message: `Surface ${s.id} type '${s.type}' not converted` });
    return `None  # ${TODO_MARK}: could not convert surface ${s.id} type '${s.type}': ${s.params.join(' ')}`;
}

function regionToOpenmc(regionRaw: string, surfIds: Set<number>): { expr: string; unknown: number[] } {
    if (!regionRaw) return { expr: 'None', unknown: [] };
    const expr = regionRaw.replace(/:/g, ' | ');
    const tokens = expr.match(/[()|]|#?[-+]?\d+/g) ?? [];
    const out: string[] = [];
    const unknown: number[] = [];
    for (const tok of tokens) {
        if (tok === '|' || tok === '(' || tok === ')') { out.push(tok); continue; }
        if (tok.startsWith('#')) {
            // complement of a cell — cannot express without the cell's region
            unknown.push(NaN);
            out.push(tok);
            continue;
        }
        const num = parseInt(tok, 10);
        if (!Number.isFinite(num)) { out.push(tok); continue; }
        if (!surfIds.has(Math.abs(num))) unknown.push(Math.abs(num));
        out.push(num < 0 ? `-surf_${Math.abs(num)}` : `+surf_${num}`);
    }
    // implicit intersection: insert & between adjacent operands
    const result: string[] = [];
    for (const tok of out) {
        const isOperand = tok !== '|' && tok !== ')' && !tok.endsWith('|');
        const prev = result[result.length - 1];
        if (
            result.length > 0 && isOperand &&
            prev !== '|' && prev !== '(' &&
            (tok.replace(/^\(+/, '').startsWith('+') || tok.replace(/^\(+/, '').startsWith('-') || tok.startsWith('('))
        ) {
            result.push('&');
        }
        result.push(tok);
    }
    return { expr: result.join(' '), unknown };
}

export function mcnpToOpenmc(mcnpText: string): ConversionResult {
    const deck = parseMcnpDeck(mcnpText);
    const issues: ConversionIssue[] = [];
    const out: string[] = [
        '# Converted from MCNP by OWEN (BelvoirDynamics) — EXPERIMENTAL',
        '# NOTE: Review and verify all converted output before use.',
        `# Unconvertible constructs are marked with "${TODO_MARK}".`,
        'import openmc',
        '',
    ];

    // -- Materials --
    const matVars = new Map<number, string>();
    if (deck.materials.length) {
        out.push('# ' + '='.repeat(60), '# Materials', '# ' + '='.repeat(60));
        for (const mat of deck.materials) {
            const v = `mat_${mat.id}`;
            matVars.set(mat.id, v);
            out.push(`${v} = openmc.Material(${mat.id}, name='${v}')`);
            for (const nuc of mat.nuclides) {
                out.push(`${v}.add_nuclide('${nuc.name}', ${nuc.fraction}, '${nuc.type}')`);
            }
            for (const sab of mat.sab) out.push(`${v}.add_s_alpha_beta('${sab}')`);
            for (const raw of mat.mtRaw) {
                const base = raw.split('.')[0].toLowerCase();
                if (!(base in MT_TO_SAB)) {
                    issues.push({ sourceLine: mat.line, message: `mt library '${raw}' has no OpenMC S(α,β) mapping` });
                    out.push(`# ${TODO_MARK}: mt library '${raw}' has no OpenMC S(α,β) mapping — add manually`);
                }
            }
            // cell-card density lives on cells in MCNP; attach the first user's density
            const cell = deck.cells.find((c) => c.matId === mat.id && c.density !== null);
            if (cell && cell.density !== null) {
                if (cell.density < 0) {
                    out.push(`${v}.set_density('g/cm3', ${Math.abs(cell.density)})`);
                } else {
                    out.push(`${v}.set_density('atom/b-cm', ${cell.density})`);
                }
            }
            out.push('');
        }
        out.push(`materials = openmc.Materials([${deck.materials.map((m) => matVars.get(m.id)).join(', ')}])`, '');
    }

    // -- Surfaces --
    const surfIds = new Set(deck.surfaces.map((s) => s.id));
    if (deck.surfaces.length) {
        out.push('# ' + '='.repeat(60), '# Geometry', '# ' + '='.repeat(60));
        for (const s of deck.surfaces) {
            out.push(`surf_${s.id} = ${surfaceToOpenmc(s, issues)}`);
        }
        out.push('');
    }

    // -- Cells --
    const cellVars: string[] = [];
    for (const c of deck.cells) {
        const v = `cell_${c.id}`;
        if (c.latticeFill) {
            issues.push({ sourceLine: c.line, message: `Cell ${c.id} lattice fill array (${c.latticeFill.nx}×${c.latticeFill.ny}×${c.latticeFill.nz}) requires manual openmc.RectLattice` });
            out.push(`# ${TODO_MARK}: cell ${c.id} is a lattice (lat=${c.lattice ?? '?'}) with a ` +
                `${c.latticeFill.nx}x${c.latticeFill.ny}x${c.latticeFill.nz} fill array — build an openmc.RectLattice manually.`);
            out.push(`#   fill universes: ${[...new Set(c.latticeFill.universes)].join(', ')}`);
        } else if (c.fill) {
            issues.push({ sourceLine: c.line, message: `Cell ${c.id} uses fill=${c.fill} (universe fill) — set cell.fill to that universe manually` });
            out.push(`# ${TODO_MARK}: cell ${c.id} uses fill=${c.fill} — assign the filled universe manually.`);
        }
        if (c.universe !== null) {
            out.push(`# NOTE: cell ${c.id} belongs to universe u=${c.universe}; group into openmc.Universe(${c.universe}) manually.`);
        }
        const fillArg = c.matId !== 0 ? (matVars.get(c.matId) ?? 'None') : 'None';
        if (c.matId !== 0 && !matVars.has(c.matId)) {
            issues.push({ sourceLine: c.line, message: `Cell ${c.id} references undefined material m${c.matId}` });
            out.push(`# ${TODO_MARK}: cell ${c.id} references undefined material m${c.matId}.`);
        }
        const { expr, unknown } = regionToOpenmc(c.regionRaw, surfIds);
        for (const u of unknown) {
            if (Number.isNaN(u)) {
                issues.push({ sourceLine: c.line, message: `Cell ${c.id} uses a cell complement (#) — not converted` });
                out.push(`# ${TODO_MARK}: cell ${c.id} region uses a cell complement (#N) — express via the referenced cell's region.`);
            } else {
                issues.push({ sourceLine: c.line, message: `Cell ${c.id} references undefined surface ${u}` });
            }
        }
        cellVars.push(v);
        out.push(`${v} = openmc.Cell(cell_id=${c.id}, fill=${fillArg}, region=${expr})`);
    }
    if (cellVars.length) {
        out.push('', `geometry = openmc.Geometry([${cellVars.join(', ')}])`, '');
    }

    // -- Settings --
    out.push('# ' + '='.repeat(60), '# Settings', '# ' + '='.repeat(60), 'settings = openmc.Settings()');
    const st = deck.settings;
    if (st.batches !== undefined) out.push(`settings.batches = ${st.batches}`);
    if (st.inactive !== undefined) out.push(`settings.inactive = ${st.inactive}`);
    if (st.particles !== undefined) out.push(`settings.particles = ${st.particles}`);
    if (st.ksrc) {
        out.push(`settings.source = openmc.IndependentSource(space=openmc.stats.Point((${st.ksrc[0]}, ${st.ksrc[1]}, ${st.ksrc[2]})))`);
    } else if (st.sdefRaw) {
        issues.push({ sourceLine: -1, message: `sdef card not fully converted: ${st.sdefRaw}` });
        out.push(`# ${TODO_MARK}: sdef card not fully converted: ${st.sdefRaw}`);
        out.push('settings.source = openmc.IndependentSource(space=openmc.stats.Point((0, 0, 0)))');
    }
    out.push('');

    out.push(
        '# ' + '='.repeat(60),
        '# Build and export model',
        '# ' + '='.repeat(60),
        'model = openmc.model.Model(geometry, materials, settings)',
        '# model.export_to_model_xml()  # uncomment to write XML files',
        '',
    );

    return { direction: 'mcnp_to_openmc', output: out.join('\n'), issues };
}
