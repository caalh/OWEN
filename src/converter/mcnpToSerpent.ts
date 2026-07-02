// MCNP -> Serpent 2 input. Covers the cleanly-mapping subset: planes,
// cylinders, spheres, RPP (-> cuboid, never "rect"), RCC, RHP (-> hexxc/hexyc),
// cells with MCNP-compatible region syntax, materials with cell-card density
// transfer, mt -> therm/moder, kcode -> set pop, and square lattices where the
// pitch is derivable. Everything else is emitted as a "% TODO(owen-convert)"
// comment rather than silently dropped.
//
// Serpent gotchas honored here: `cuboid` not `rect`, transformations would be
// `trans` not `trcl` (not emitted — flagged), energies stay in MeV, threading
// is a CLI flag (never `set omp`).

import { parseMcnpDeck, McnpDeck, McnpSurface, McnpCell } from './mcnpModel';
import { MT_TO_SERPENT_THERM } from './zaid';
import { ConversionResult, ConversionIssue, TODO_MARK } from './types';

function surfaceToSerpent(s: McnpSurface, issues: ConversionIssue[]): string[] {
    const p = s.params;
    const lines: string[] = [];
    const push = (body: string) => lines.push(`surf ${s.id} ${body}`);
    switch (s.type) {
        case 'cz': push(`cyl 0.0 0.0 ${p[0]}`); break;
        case 'c/z': push(`cyl ${p[0]} ${p[1]} ${p[2]}`); break;
        case 'cx': push(`cylx 0.0 0.0 ${p[0]}`); break;
        case 'c/x': push(`cylx ${p[0]} ${p[1]} ${p[2]}`); break;
        case 'cy': push(`cyly 0.0 0.0 ${p[0]}`); break;
        case 'c/y': push(`cyly ${p[0]} ${p[1]} ${p[2]}`); break;
        case 'pz': push(`pz ${p[0]}`); break;
        case 'px': push(`px ${p[0]}`); break;
        case 'py': push(`py ${p[0]}`); break;
        case 'p':
            if (p.length >= 4) { push(`plane ${p[0]} ${p[1]} ${p[2]} ${p[3]}`); break; }
            issues.push({ sourceLine: s.line, message: `Plane surface ${s.id} has unsupported parameter count` });
            lines.push(`% ${TODO_MARK}: surface ${s.id} 'p' with ${p.length} params — convert manually`);
            break;
        case 'so': push(`sph 0.0 0.0 0.0 ${p[0]}`); break;
        case 's':
        case 'sph':
            if (p.length >= 4) { push(`sph ${p[0]} ${p[1]} ${p[2]} ${p[3]}`); break; }
            issues.push({ sourceLine: s.line, message: `Sphere surface ${s.id} has unsupported parameter count` });
            lines.push(`% ${TODO_MARK}: surface ${s.id} sphere with ${p.length} params — convert manually`);
            break;
        case 'rpp':
            // Serpent rectangular parallelepiped is "cuboid" (NOT "rect").
            if (p.length >= 6) { push(`cuboid ${p.slice(0, 6).join(' ')}`); break; }
            issues.push({ sourceLine: s.line, message: `RPP surface ${s.id} has <6 params` });
            lines.push(`% ${TODO_MARK}: surface ${s.id} rpp with ${p.length} params — convert manually`);
            break;
        case 'rcc':
            if (p.length >= 7) {
                const [vx, vy, vz, hx, hy, hz, r] = p.map(parseFloat);
                if (hx === 0 && hy === 0) {
                    push(`cyl ${vx} ${vy} ${r} ${vz} ${vz + hz}`);
                    break;
                }
                issues.push({ sourceLine: s.line, message: `RCC surface ${s.id} has an off-z axis` });
                lines.push(`% ${TODO_MARK}: surface ${s.id} rcc with off-z height vector — convert manually`);
                break;
            }
            issues.push({ sourceLine: s.line, message: `RCC surface ${s.id} has <7 params` });
            lines.push(`% ${TODO_MARK}: surface ${s.id} rcc with ${p.length} params — convert manually`);
            break;
        case 'rhp':
        case 'hex':
            if (p.length >= 9) {
                const n = p.map(parseFloat);
                const [bx, by] = [n[0], n[1]];
                const [hx, hy] = [n[3], n[4]];
                const [rx, ry] = [n[6], n[7]];
                if (hx === 0 && hy === 0) {
                    const apothem = Math.hypot(rx, ry);
                    // r along y -> flats perpendicular to y (Serpent X-type); along x -> Y-type
                    const kind = Math.abs(ry) >= Math.abs(rx) ? 'hexxc' : 'hexyc';
                    push(`${kind} ${bx} ${by} ${apothem.toPrecision(8)}`);
                    lines.push(`% ${TODO_MARK}: verify hex orientation (${kind}) matches the MCNP RHP r-vector`);
                    issues.push({ sourceLine: s.line, message: `RHP surface ${s.id}: hex orientation needs manual verification` });
                    break;
                }
                issues.push({ sourceLine: s.line, message: `RHP surface ${s.id} with off-z axis is not converted` });
                lines.push(`% ${TODO_MARK}: surface ${s.id} rhp with off-z axis — convert manually`);
                break;
            }
            issues.push({ sourceLine: s.line, message: `RHP surface ${s.id} has <9 params` });
            lines.push(`% ${TODO_MARK}: surface ${s.id} rhp with ${p.length} params — convert manually`);
            break;
        default:
            issues.push({ sourceLine: s.line, message: `Surface ${s.id} type '${s.type}' not converted` });
            lines.push(`% ${TODO_MARK}: could not convert surface ${s.id} type '${s.type}': ${p.join(' ')}`);
    }
    return lines;
}

function regionToSerpent(regionRaw: string, issues: ConversionIssue[], cellLine: number, cellId: number): string {
    // MCNP and Serpent share space=intersection, ':'=union, parentheses, and
    // signed surface ids. The cell complement '#' also exists in Serpent, but
    // MCNP's "#N means cell N" vs Serpent's "cell name" distinction warrants a flag.
    if (/#/.test(regionRaw)) {
        issues.push({ sourceLine: cellLine, message: `Cell ${cellId} uses a cell complement (#) — verify the referenced name in Serpent` });
    }
    return regionRaw;
}

/** Derive a square-lattice pitch from bounding px/py pairs or an rpp in the cell region. */
export function derivePitch(cell: McnpCell, deck: McnpDeck): number | null {
    const ids = (cell.regionRaw.match(/-?\d+/g) ?? []).map((t) => Math.abs(parseInt(t, 10)));
    const xs: number[] = [];
    const ys: number[] = [];
    for (const id of ids) {
        const s = deck.surfaces.find((x) => x.id === id);
        if (!s) continue;
        if (s.type === 'px') xs.push(parseFloat(s.params[0]));
        if (s.type === 'py') ys.push(parseFloat(s.params[0]));
        if (s.type === 'rpp' && s.params.length >= 4) {
            xs.push(parseFloat(s.params[0]), parseFloat(s.params[1]));
            ys.push(parseFloat(s.params[2]), parseFloat(s.params[3]));
        }
    }
    if (xs.length >= 2) {
        const dx = Math.max(...xs) - Math.min(...xs);
        if (dx > 0) return dx;
    }
    if (ys.length >= 2) {
        const dy = Math.max(...ys) - Math.min(...ys);
        if (dy > 0) return dy;
    }
    return null;
}

export function mcnpToSerpent(mcnpText: string): ConversionResult {
    const deck = parseMcnpDeck(mcnpText);
    const issues: ConversionIssue[] = [];
    const out: string[] = [
        '% Converted from MCNP by OWEN (BelvoirDynamics) — EXPERIMENTAL',
        '% NOTE: Review and verify all converted output before use.',
        `% Unconvertible constructs are marked with "${TODO_MARK}".`,
        `% ${TODO_MARK}: verify nuclide library suffixes (e.g. .80c) against your xsdata file.`,
        '',
        'set title "Converted from MCNP by OWEN"',
        '',
    ];

    // -- Surfaces --
    out.push('% --- Surfaces ---');
    const hasReflective = deck.surfaces.some((s) => s.boundary === 'reflective');
    for (const s of deck.surfaces) {
        out.push(...surfaceToSerpent(s, issues));
    }
    out.push('');

    // -- Cells --
    out.push('% --- Cells ---');
    for (const c of deck.cells) {
        const uni = c.universe ?? 0;
        if (c.latticeFill && c.lattice === 1) {
            const pitch = derivePitch(c, deck);
            const lf = c.latticeFill;
            const latUni = c.universe ?? c.id;
            if (pitch !== null && lf.nz === 1 && lf.universes.length === lf.nx * lf.ny) {
                out.push(`% square lattice from MCNP cell ${c.id} (lat=1)`);
                out.push(`lat ${latUni} 1 0.0 0.0 ${lf.nx} ${lf.ny} ${pitch}`);
                for (let j = lf.ny - 1; j >= 0; j--) {
                    // MCNP fill arrays list x fastest from the lowest index; Serpent reads
                    // rows top-to-bottom, so flip the y order.
                    const row = lf.universes.slice(j * lf.nx, (j + 1) * lf.nx);
                    out.push(row.map((u) => `u${u}`).join(' '));
                }
                out.push(`% ${TODO_MARK}: verify lattice origin (assumed 0 0) and row order against the MCNP fill array`);
                issues.push({ sourceLine: c.line, message: `Cell ${c.id}: lattice converted — verify origin/row order` });
            } else {
                issues.push({ sourceLine: c.line, message: `Cell ${c.id} lattice could not be converted (pitch underivable, 3-D fill, or ragged array)` });
                out.push(`% ${TODO_MARK}: cell ${c.id} lattice (lat=${c.lattice}) not converted — ` +
                    `pitch underivable or fill not a full 2-D array. Fill spec: ${lf.raw.slice(0, 120)}`);
            }
            continue;
        }
        if (c.lattice === 2) {
            issues.push({ sourceLine: c.line, message: `Cell ${c.id} hexagonal lattice (lat=2) not converted` });
            out.push(`% ${TODO_MARK}: cell ${c.id} hexagonal lattice (lat=2) — build a Serpent "lat ... 2/3" manually.`);
            continue;
        }
        const region = regionToSerpent(c.regionRaw, issues, c.line, c.id);
        if (c.importanceZero && c.matId === 0) {
            out.push(`cell ${c.id} ${uni} outside ${region}`);
            continue;
        }
        if (c.fill) {
            out.push(`cell ${c.id} ${uni} fill u${c.fill} ${region}`);
            continue;
        }
        if (c.matId === 0) {
            out.push(`cell ${c.id} ${uni} void ${region}`);
        } else {
            out.push(`cell ${c.id} ${uni} m${c.matId} ${region}`);
        }
    }
    out.push('');

    // -- Materials --
    out.push('% --- Materials ---');
    let thermCounter = 0;
    for (const mat of deck.materials) {
        const cell = deck.cells.find((c) => c.matId === mat.id && c.density !== null);
        const density = cell?.density ?? null;
        if (density === null) {
            issues.push({ sourceLine: mat.line, message: `Material m${mat.id}: no cell-card density found (Serpent needs one on the mat card)` });
        }
        const thermNames: string[] = [];
        const thermLines: string[] = [];
        for (const raw of mat.mtRaw) {
            const base = raw.split('.')[0].toLowerCase();
            const lib = MT_TO_SERPENT_THERM[base];
            if (lib) {
                const name = `therm${++thermCounter}`;
                thermNames.push(name);
                thermLines.push(`therm ${name} ${lib}`);
            } else {
                issues.push({ sourceLine: mat.line, message: `mt library '${raw}' has no Serpent therm mapping` });
                thermLines.push(`% ${TODO_MARK}: mt library '${raw}' has no Serpent therm mapping — add a "therm" card manually`);
            }
        }
        const moder = thermNames.map((n) => ` moder ${n} 1001`).join('');
        const densStr = density !== null ? String(density) : `0.0 % ${TODO_MARK}: set material density (none found on MCNP cell cards)`;
        out.push(`mat m${mat.id} ${densStr}${moder}`);
        for (const nuc of mat.nuclides) {
            const frac = nuc.type === 'wo' ? -nuc.fraction : nuc.fraction;
            out.push(`${nuc.zaid} ${frac}`);
        }
        out.push(...thermLines);
        out.push('');
    }

    // -- Settings --
    out.push('% --- Settings ---');
    const st = deck.settings;
    if (st.particles !== undefined && st.batches !== undefined && st.inactive !== undefined) {
        out.push(`set pop ${st.particles} ${st.batches - st.inactive} ${st.inactive}`);
    } else if (st.particles !== undefined) {
        out.push(`set pop ${st.particles} 100 20 % ${TODO_MARK}: cycles not found in kcode — defaults used`);
        issues.push({ sourceLine: -1, message: 'kcode cycle counts incomplete — Serpent set pop uses defaults' });
    } else {
        out.push(`% ${TODO_MARK}: no kcode card found — add "set pop <particles> <active> <inactive>"`);
        issues.push({ sourceLine: -1, message: 'No kcode card — set pop left as TODO' });
    }
    if (hasReflective) {
        out.push('set bc 2');
        out.push(`% ${TODO_MARK}: MCNP had *reflective surfaces; "set bc 2" makes ALL outer boundaries reflective — verify.`);
        issues.push({ sourceLine: -1, message: 'Reflective surfaces mapped to global "set bc 2" — verify per-surface intent' });
    } else {
        out.push('set bc 1');
    }
    if (st.sdefRaw) {
        issues.push({ sourceLine: -1, message: `sdef card not converted: ${st.sdefRaw}` });
        out.push(`% ${TODO_MARK}: sdef card not converted: ${st.sdefRaw}`);
    }
    out.push('% Threading: run with "sss2 -omp N" (never "set omp" in the deck).');
    out.push('');

    return { direction: 'mcnp_to_serpent', output: out.join('\n'), issues };
}
