// OpenMC Python script -> MCNP deck. Port of groves converter.py
// openmc_to_mcnp (regex-based; best for pin-cell / single-assembly scripts).

import { ELEMENT_TO_Z, nuclideToZaid, SAB_TO_MT } from './zaid';
import { ConversionResult, ConversionIssue, TODO_MARK } from './types';

interface OMaterial {
    id: number;
    var: string;
    name: string;
    nuclides: Array<{ name: string; fraction: number; type: string; isElement?: boolean; enrichment?: number | null }>;
    density: [string, number] | null;
    sab: string[];
    line: number;
}

interface OSurface {
    id: number;
    var: string;
    mcnpType: string;
    params: string[];
    boundary: string;
}

interface OCell {
    id: number;
    var: string;
    fillVar: string | null;
    regionRaw: string;
    name: string;
    line: number;
}

function lineOfOffset(text: string, offset: number): number {
    let line = 0;
    for (let i = 0; i < offset && i < text.length; i++) {
        if (text[i] === '\n') line++;
    }
    return line;
}

function resolveNumericVars(text: string): Map<string, string> {
    const map = new Map<string, string>();
    const re = /^(\w+)\s*=\s*([0-9eE.+\-]+)\s*(?:#.*)?$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) map.set(m[1], m[2]);
    return map;
}

function resolveParam(val: string, vars: Map<string, string>): string {
    val = val.trim().replace(/,$/, '');
    if (/^[0-9eE.+\-]+$/.test(val)) return val;
    if (vars.has(val)) return vars.get(val)!;
    let expr = val;
    const names = [...vars.keys()].sort((a, b) => b.length - a.length);
    for (const n of names) expr = expr.split(n).join(vars.get(n)!);
    if (/^[\d.eE+\-*/() ]+$/.test(expr)) {
        try {
            // numeric-only characters — safe to evaluate
            // eslint-disable-next-line no-new-func
            const v = Function(`"use strict"; return (${expr});`)() as number;
            if (Number.isFinite(v)) return String(Number(v.toPrecision(10)));
        } catch { /* fall through */ }
    }
    return val;
}

function parseMaterials(text: string): OMaterial[] {
    const seen = new Map<string, OMaterial>();
    let autoId = 1;

    const matPat = /(\w+)\s*=\s*openmc\.Material\(\s*(?:(\d+)\s*,?\s*)?(?:name\s*=\s*["']([^"']*)["'])?\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = matPat.exec(text)) !== null) {
        const id = m[2] ? parseInt(m[2], 10) : autoId;
        seen.set(m[1], {
            id, var: m[1], name: m[3] || m[1],
            nuclides: [], density: null, sab: [], line: lineOfOffset(text, m.index),
        });
        autoId = Math.max(autoId, id + 1);
    }

    const nucPat = /(\w+)\.add_nuclide\(\s*["']([^"']+)["']\s*,\s*([0-9eE.+\-]+)\s*(?:,\s*["'](\w+)["'])?\s*\)/g;
    while ((m = nucPat.exec(text)) !== null) {
        seen.get(m[1])?.nuclides.push({ name: m[2], fraction: parseFloat(m[3]), type: m[4] || 'ao' });
    }

    const elemPat = /(\w+)\.add_element\(\s*["']([^"']+)["']\s*,\s*([0-9eE.+\-]+)\s*(?:,\s*enrichment\s*=\s*([0-9eE.+\-]+))?\s*\)/g;
    while ((m = elemPat.exec(text)) !== null) {
        seen.get(m[1])?.nuclides.push({
            name: m[2], fraction: parseFloat(m[3]), type: 'ao',
            isElement: true, enrichment: m[4] ? parseFloat(m[4]) : null,
        });
    }

    const densPat = /(\w+)\.set_density\(\s*["']([^"']+)["']\s*,\s*([0-9eE.+\-]+)\s*\)/g;
    while ((m = densPat.exec(text)) !== null) {
        const mat = seen.get(m[1]);
        if (mat) mat.density = [m[2], parseFloat(m[3])];
    }

    const sabPat = /(\w+)\.add_s_alpha_beta\(\s*["']([^"']+)["']\s*\)/g;
    while ((m = sabPat.exec(text)) !== null) {
        seen.get(m[1])?.sab.push(m[2]);
    }

    return [...seen.values()];
}

const SURF_CLASSES: Record<string, [string, string[]]> = {
    ZCylinder: ['cz', ['r']],
    XCylinder: ['cx', ['r']],
    YCylinder: ['cy', ['r']],
    XPlane: ['px', ['x0']],
    YPlane: ['py', ['y0']],
    ZPlane: ['pz', ['z0']],
    Sphere: ['so', ['r']],
};

function parseSurfaces(text: string, vars: Map<string, string>): OSurface[] {
    const surfaces: OSurface[] = [];
    let autoId = 1;

    for (const [cls, [mcnpType, paramNames]] of Object.entries(SURF_CLASSES)) {
        const pat = new RegExp(`(\\w+)\\s*=\\s*openmc\\.${cls}\\(([^)]*)\\)`, 'g');
        let m: RegExpExecArray | null;
        while ((m = pat.exec(text)) !== null) {
            const args = m[2];
            const sidM = /surface_id\s*=\s*(\d+)/.exec(args);
            const sid = sidM ? parseInt(sidM[1], 10) : autoId;
            autoId = Math.max(autoId, sid + 1);
            const bM = /boundary_type\s*=\s*['"](\w+)['"]/.exec(args);
            const params: string[] = [];
            for (const pn of paramNames) {
                const pm = new RegExp(`${pn}\\s*=\\s*(\\S+?)(?:\\s*[,)]|$)`).exec(args);
                if (pm) params.push(resolveParam(pm[1], vars));
            }
            surfaces.push({ id: sid, var: m[1], mcnpType, params, boundary: bM ? bM[1] : 'transmission' });
        }
    }

    const rppPat = /(\w+)\s*=\s*openmc\.model\.RectangularParallelepiped\(([^)]*)\)/g;
    let m: RegExpExecArray | null;
    while ((m = rppPat.exec(text)) !== null) {
        const args = m[2];
        const sidM = /surface_id\s*=\s*(\d+)/.exec(args);
        const sid = sidM ? parseInt(sidM[1], 10) : autoId;
        autoId = Math.max(autoId, sid + 1);
        const params: string[] = [];
        for (const pn of ['xmin', 'xmax', 'ymin', 'ymax', 'zmin', 'zmax']) {
            const pm = new RegExp(`${pn}\\s*=\\s*(\\S+?)(?:\\s*[,)]|$)`).exec(args);
            params.push(pm ? resolveParam(pm[1], vars) : '0');
        }
        const bM = /boundary_type\s*=\s*['"](\w+)['"]/.exec(args);
        surfaces.push({ id: sid, var: m[1], mcnpType: 'rpp', params, boundary: bM ? bM[1] : 'transmission' });
    }

    surfaces.sort((a, b) => a.id - b.id);
    return surfaces;
}

const INLINE_TYPE_MAP: Record<string, [string, string]> = {
    ZCylinder: ['cz', 'r'],
    XCylinder: ['cx', 'r'],
    YCylinder: ['cy', 'r'],
    XPlane: ['px', 'x0'],
    YPlane: ['py', 'y0'],
    ZPlane: ['pz', 'z0'],
    Sphere: ['so', 'r'],
};

function extractInlineSurfaces(
    text: string,
    vars: Map<string, string>,
    existing: OSurface[],
): { surfaces: OSurface[]; regionMap: Map<string, string> } {
    let autoId = existing.length ? Math.max(...existing.map((s) => s.id)) + 1 : 1;
    const newSurfaces: OSurface[] = [];
    const regionMap = new Map<string, string>();

    const assignPat = /^(\w+)\s*=\s*(.+openmc\.\w+\(.+)$/gm;
    let m: RegExpExecArray | null;
    while ((m = assignPat.exec(text)) !== null) {
        const regionVar = m[1];
        const rhs = m[2].trim();
        if (/^openmc\.\w+\([^)]*\)\s*$/.test(rhs)) continue; // direct assignment

        const parts: string[] = [];
        let lastEnd = 0;
        const surfPat = /([+-]?)\s*openmc\.(\w+)\(([^)]*)\)/g;
        let sm: RegExpExecArray | null;
        while ((sm = surfPat.exec(rhs)) !== null) {
            const sign = sm[1].trim() || '+';
            const cls = sm[2];
            if (!(cls in INLINE_TYPE_MAP)) continue;
            const [mcnpType, paramName] = INLINE_TYPE_MAP[cls];
            const pm = new RegExp(`${paramName}\\s*=\\s*(\\S+?)(?:\\s*[,)]|$)`).exec(sm[3]);
            const val = pm ? resolveParam(pm[1], vars) : '0';
            const bM = /boundary_type\s*=\s*['"](\w+)['"]/.exec(sm[3]);

            const sid = autoId++;
            newSurfaces.push({
                id: sid, var: `auto_${sid}`, mcnpType, params: [val],
                boundary: bM ? bM[1] : 'transmission',
            });
            const ref = sign === '-' ? `-${sid}` : `${sid}`;
            const prefix = rhs.slice(lastEnd, sm.index);
            if (/\|/.test(prefix) && parts.length) {
                parts.push(':', ref);
            } else {
                parts.push(ref);
            }
            lastEnd = sm.index + sm[0].length;
        }
        if (parts.length) regionMap.set(regionVar, parts.join(' '));
    }
    return { surfaces: newSurfaces, regionMap };
}

function parseCells(text: string): OCell[] {
    const cells: OCell[] = [];
    let autoId = 1;
    const pat = /(\w+)\s*=\s*openmc\.Cell\(([^)]*)\)/g;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(text)) !== null) {
        const args = m[2];
        const cidM = /cell_id\s*=\s*(\d+)/.exec(args);
        const cid = cidM ? parseInt(cidM[1], 10) : autoId;
        autoId = Math.max(autoId, cid + 1);
        const fillM = /fill\s*=\s*(\w+)/.exec(args);
        const regionM = /region\s*=\s*(.+?)(?:,\s*name|$)/.exec(args);
        const nameM = /name\s*=\s*['"]([^'"]*)['"]/.exec(args);
        cells.push({
            id: cid, var: m[1],
            fillVar: fillM ? fillM[1] : null,
            regionRaw: regionM ? regionM[1].trim().replace(/,$/, '') : '',
            name: nameM ? nameM[1] : '',
            line: lineOfOffset(text, m.index),
        });
    }
    cells.sort((a, b) => a.id - b.id);
    return cells;
}

function parseSettings(text: string, vars: Map<string, string>): {
    batches?: number; inactive?: number; particles?: number; ksrc?: number[];
} {
    const settings: { batches?: number; inactive?: number; particles?: number; ksrc?: number[] } = {};
    const bm = /settings\.batches\s*=\s*(\d+)/.exec(text);
    if (bm) settings.batches = parseInt(bm[1], 10);
    const im = /settings\.inactive\s*=\s*(\d+)/.exec(text);
    if (im) settings.inactive = parseInt(im[1], 10);
    const pm = /settings\.particles\s*=\s*(\d+)/.exec(text);
    if (pm) settings.particles = parseInt(pm[1], 10);

    const pt = /openmc\.stats\.Point\(\s*\(\s*([0-9eE.+\-]+)\s*,\s*([0-9eE.+\-]+)\s*,\s*([0-9eE.+\-]+)\s*\)\s*\)/.exec(text);
    if (pt) settings.ksrc = [parseFloat(pt[1]), parseFloat(pt[2]), parseFloat(pt[3])];

    if (!settings.ksrc) {
        const box = /openmc\.stats\.Box\(\s*\[([^\]]+)\]\s*,\s*\[([^\]]+)\]/.exec(text);
        if (box) {
            try {
                const ll = box[1].split(',').map((x) => parseFloat(resolveParam(x.trim(), vars)));
                const ur = box[2].split(',').map((x) => parseFloat(resolveParam(x.trim(), vars)));
                if (ll.length >= 3 && ur.length >= 3 && [...ll, ...ur].every(Number.isFinite)) {
                    settings.ksrc = [0, 1, 2].map((i) => (ll[i] + ur[i]) / 2);
                } else {
                    settings.ksrc = [0, 0, 0];
                }
            } catch {
                settings.ksrc = [0, 0, 0];
            }
        }
    }
    return settings;
}

function materialToCards(mat: OMaterial, issues: ConversionIssue[]): string[] {
    const lines: string[] = [];
    const mid = mat.id;
    let densityComment = '';
    if (mat.density) densityComment = `  $ density: ${mat.density[1]} ${mat.density[0]}`;

    let first = true;
    const emit = (zaid: string, frac: number) => {
        const fracStr = frac.toExponential(4);
        if (first) {
            lines.push(`m${mid.toString().padEnd(4)} ${zaid.padEnd(14)} ${fracStr.padEnd(14)}${densityComment}`);
            first = false;
        } else {
            lines.push(`     ${zaid.padEnd(14)} ${fracStr.padEnd(14)}`);
        }
    };

    for (const nuc of mat.nuclides) {
        if (nuc.isElement) {
            const z = ELEMENT_TO_Z[nuc.name];
            if (z === undefined) {
                lines.push(`c ${TODO_MARK}: unknown element ${nuc.name}`);
                issues.push({ sourceLine: mat.line, message: `Unknown element ${nuc.name} in material ${mat.var}` });
                continue;
            }
            if (nuc.enrichment != null && nuc.name === 'U') {
                const e = nuc.enrichment / 100;
                emit('92235.80c', nuc.fraction * e);
                emit('92238.80c', nuc.fraction * (1 - e));
                continue;
            }
            lines.push(`c NOTE: ${nuc.name} added as natural element (ZAID ${z * 1000}.80c)`);
            emit(`${z * 1000}.80c`, nuc.type === 'wo' ? -Math.abs(nuc.fraction) : nuc.fraction);
            continue;
        }
        const zaid = nuclideToZaid(nuc.name);
        const frac = nuc.type === 'wo' ? -Math.abs(nuc.fraction) : nuc.fraction;
        emit(zaid, frac);
    }

    for (const sab of mat.sab) {
        const mt = SAB_TO_MT[sab];
        if (mt) {
            lines.push(`mt${mid.toString().padEnd(3)} ${mt}.20t`);
        } else {
            lines.push(`c ${TODO_MARK}: S(a,b) '${sab}' has no MCNP mt mapping — add manually`);
            issues.push({ sourceLine: mat.line, message: `S(α,β) '${sab}' has no MCNP mt mapping` });
        }
    }
    return lines;
}

function surfaceToCard(s: OSurface): string {
    const prefix = s.boundary === 'reflective' ? '*' : '';
    return `${prefix}${s.id.toString().padEnd(5)} ${s.mcnpType.padEnd(4)} ${s.params.join(' ')}`;
}

function regionToMcnp(regionExpr: string, surfIdMap: Map<string, number>): string {
    if (!regionExpr || regionExpr === 'None') return '';
    let expr = regionExpr.replace(/&/g, ' ').replace(/\|/g, ':');
    const names = [...surfIdMap.keys()].sort((a, b) => b.length - a.length);
    for (const name of names) {
        const sid = surfIdMap.get(name)!;
        expr = expr.split(`-${name}`).join(`-${sid}`);
        expr = expr.split(`+${name}`).join(`${sid}`);
        expr = expr.split(name).join(`${sid}`);
    }
    expr = expr.replace(/\+(\d)/g, '$1');
    return expr.trim();
}

export function openmcToMcnp(openmcText: string): ConversionResult {
    const issues: ConversionIssue[] = [];
    const vars = resolveNumericVars(openmcText);
    const out: string[] = [
        'c === Converted from OpenMC by OWEN (BelvoirDynamics) — EXPERIMENTAL ===',
        'c NOTE: Review all converted output before use.',
        `c Unconvertible constructs are marked with "${TODO_MARK}".`,
    ];

    const materials = parseMaterials(openmcText);
    const matIdMap = new Map<string, number>();
    const matDensityMap = new Map<number, number>();
    const matCards: string[] = [];
    for (const mat of materials) {
        matIdMap.set(mat.var, mat.id);
        if (mat.density) {
            const [unit, val] = mat.density;
            matDensityMap.set(mat.id, unit.includes('g') ? -val : val);
        }
        matCards.push(...materialToCards(mat, issues));
    }

    const surfaces = parseSurfaces(openmcText, vars);
    const inline = extractInlineSurfaces(openmcText, vars, surfaces);
    surfaces.push(...inline.surfaces);

    // rectangular_prism regions (legacy factory)
    const rpPat = /(\w+)\s*=\s*openmc\.rectangular_prism\(([^)]*)\)/g;
    let rpM: RegExpExecArray | null;
    let autoId = surfaces.length ? Math.max(...surfaces.map((s) => s.id)) + 1 : 1;
    while ((rpM = rpPat.exec(openmcText)) !== null) {
        const args = rpM[2];
        const w = /width\s*=\s*([^,)]+)/.exec(args);
        const h = /height\s*=\s*([^,)]+)/.exec(args);
        if (!w || !h) {
            issues.push({ sourceLine: lineOfOffset(openmcText, rpM.index), message: `rectangular_prism for ${rpM[1]} could not be parsed` });
            continue;
        }
        const width = parseFloat(resolveParam(w[1], vars));
        const height = parseFloat(resolveParam(h[1], vars));
        if (!Number.isFinite(width) || !Number.isFinite(height)) {
            issues.push({ sourceLine: lineOfOffset(openmcText, rpM.index), message: `rectangular_prism dims for ${rpM[1]} could not be resolved` });
            continue;
        }
        let ox = 0, oy = 0;
        const om = /origin\s*=\s*\(\s*([^,)]+),\s*([^,)]+)\)/.exec(args);
        if (om) {
            ox = parseFloat(resolveParam(om[1], vars)) || 0;
            oy = parseFloat(resolveParam(om[2], vars)) || 0;
        }
        const bM = /boundary_type\s*=\s*['"](\w+)['"]/.exec(args);
        const sid = autoId++;
        surfaces.push({
            id: sid, var: rpM[1], mcnpType: 'rpp',
            params: [
                String(ox - width / 2), String(ox + width / 2),
                String(oy - height / 2), String(oy + height / 2),
                '-1e10', '1e10',
            ],
            boundary: bM ? bM[1] : 'transmission',
        });
        inline.regionMap.set(rpM[1], `-${sid}`);
    }

    surfaces.sort((a, b) => a.id - b.id);
    const surfIdMap = new Map<string, number>();
    const surfCards: string[] = [];
    for (const s of surfaces) {
        surfIdMap.set(s.var, s.id);
        surfCards.push(surfaceToCard(s));
    }

    const cells = parseCells(openmcText);
    const cellCards: string[] = [];
    for (const cell of cells) {
        let region = cell.regionRaw;
        for (const [rv, expr] of inline.regionMap) {
            region = region.split(rv).join(expr);
        }
        const matId = cell.fillVar && cell.fillVar !== 'None' ? (matIdMap.get(cell.fillVar) ?? 0) : 0;
        if (cell.fillVar && cell.fillVar !== 'None' && !matIdMap.has(cell.fillVar)) {
            // fill by universe or unknown variable
            cellCards.push(`c ${TODO_MARK}: cell ${cell.id} fill='${cell.fillVar}' is not a parsed material (universe fill?) — assign manually`);
            issues.push({ sourceLine: cell.line, message: `Cell ${cell.id} fill '${cell.fillVar}' is not a parsed material` });
        }
        let densityStr = '';
        if (matId !== 0) {
            densityStr = ` ${matDensityMap.get(matId) ?? -1.0}`;
            if (!matDensityMap.has(matId)) {
                issues.push({ sourceLine: cell.line, message: `Cell ${cell.id}: material ${matId} has no set_density — placeholder -1.0 used` });
            }
        }
        const regionMcnp = regionToMcnp(region, surfIdMap);
        const imp = regionMcnp.trim() ? 'imp:n=1' : 'imp:n=0';
        const comment = cell.name ? `  $ ${cell.name}` : '';
        cellCards.push(`${cell.id.toString().padEnd(5)} ${matId}${densityStr}  ${regionMcnp}  ${imp}${comment}`);
    }

    if (/openmc\.(RectLattice|HexLattice)\(/.test(openmcText)) {
        issues.push({ sourceLine: lineOfOffset(openmcText, openmcText.search(/openmc\.(RectLattice|HexLattice)\(/)), message: 'OpenMC lattice not converted — build MCNP lat/fill manually' });
        cellCards.push(`c ${TODO_MARK}: OpenMC RectLattice/HexLattice detected — build the MCNP lat=/fill= cards manually.`);
    }

    const st = parseSettings(openmcText, vars);
    const settingsCards: string[] = [];
    settingsCards.push(`kcode ${st.particles ?? 10000} 1.0 ${st.inactive ?? 10} ${st.batches ?? 100}`);
    if (st.ksrc) {
        settingsCards.push(`ksrc ${st.ksrc[0]} ${st.ksrc[1]} ${st.ksrc[2]}`);
    } else {
        settingsCards.push('ksrc 0 0 0');
    }

    out.push('c Cell Cards');
    out.push(...cellCards);
    out.push('');
    out.push('c Surface Cards');
    out.push(...surfCards);
    out.push('');
    out.push('c Data Cards');
    out.push(...matCards);
    out.push(...settingsCards);
    out.push('');

    return { direction: 'openmc_to_mcnp', output: out.join('\n'), issues };
}
