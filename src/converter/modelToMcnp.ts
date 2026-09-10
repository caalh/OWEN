// Serpent / SCONE → MCNP, through the exact-geometry model.
//
// The preview engine already reads Serpent and SCONE decks onto the shared
// MCNP-shaped model (surfaces as planes/quadrics/bodies, cells as CSG over
// them, universes, fills, lattices). That model is one short step from an
// MCNP deck, and it is a step the converter did not have: MCNP was only ever
// a *source*. So this emits cells, surfaces and materials from the model plus
// the source deck's material cards, and marks with TODO everything MCNP
// needs that the source did not say — densities Serpent left as `sum`,
// libraries (Serpent's `.09c` is a temperature, MCNP's `.80c` is an
// evaluation), the graveyard, and the kcode/ksrc data block.
//
// Design contract shared with the other directions: never drop a construct
// silently; emit a TODO comment instead.

import { McnpGeometryModel, RegionNode, Shape, Transform, Vec3 } from '../preview/mcnpGeometry';
import { cellContains, rootUniverseId, worldBounds } from '../preview/mcnpEvaluate';
import { canonicalMaterials, CanonicalMaterial } from '../compare/canonical';
import { extractOverlays } from '../preview/overlays';
import { nuclideToZaid } from './zaid';
import { ConversionIssue, ConversionResult, TODO_MARK } from './types';

const fmt = (v: number): string => {
    if (Math.abs(v) < 1e-12) return '0';
    const s = Number(v.toPrecision(8));
    return String(s);
};

interface Emitter {
    /** Model surface id → MCNP surface number(s). A body maps to its facets. */
    surfNum: Map<number, number | number[]>;
    surfaceCards: string[];
    issues: ConversionIssue[];
    nextSurf: number;
}

function emitPlane(n: Vec3, d: number): string {
    // f(p) = n·p − d; axis-aligned planes take the short mnemonic.
    if (Math.abs(n[0]) > 0.999999 && !n[1] && !n[2]) return `px ${fmt(d / n[0])}`;
    if (Math.abs(n[1]) > 0.999999 && !n[0] && !n[2]) return `py ${fmt(d / n[1])}`;
    if (Math.abs(n[2]) > 0.999999 && !n[0] && !n[1]) return `pz ${fmt(d / n[2])}`;
    return `p ${fmt(n[0])} ${fmt(n[1])} ${fmt(n[2])} ${fmt(d)}`;
}

function emitQuadric(s: Extract<Shape, { kind: 'quadric' }>): string {
    const { a, b, c, d, e, f, g, h, j, k } = s;
    if (a === 1 && b === 1 && c === 1 && !d && !e && !f) {
        const cx = -g / 2, cy = -h / 2, cz = -j / 2;
        const r2 = cx * cx + cy * cy + cz * cz - k;
        if (r2 > 0) {
            if (!cx && !cy && !cz) return `so ${fmt(Math.sqrt(r2))}`;
            return `s ${fmt(cx)} ${fmt(cy)} ${fmt(cz)} ${fmt(Math.sqrt(r2))}`;
        }
    }
    const cyl = (mn: string, u: number, v: number): string | null => {
        const r2 = u * u + v * v - k;
        if (!(r2 > 0)) return null;
        const r = Math.sqrt(r2);
        if (!u && !v) return `c${mn} ${fmt(r)}`;
        return `c/${mn} ${fmt(u)} ${fmt(v)} ${fmt(r)}`;
    };
    if (a === 0 && b === 1 && c === 1 && !d && !e && !f) { const t = cyl('x', -h / 2, -j / 2); if (t) return t; }
    if (a === 1 && b === 0 && c === 1 && !d && !e && !f) { const t = cyl('y', -g / 2, -j / 2); if (t) return t; }
    if (a === 1 && b === 1 && c === 0 && !d && !e && !f) { const t = cyl('z', -g / 2, -h / 2); if (t) return t; }
    // MCNP GQ: Ax²+By²+Cz²+Dxy+Eyz+Fzx+Gx+Hy+Jz+K = 0 — same layout as the model.
    return `gq ${[a, b, c, d, e, f, g, h, j, k].map(fmt).join(' ')}`;
}

function emitShape(em: Emitter, id: number, shape: Shape, tr: Transform | null, label: string): void {
    if (tr) {
        // A transformed surface would need a TRn card and the n field.
        em.issues.push({ sourceLine: -1, message: `Surface ${label}: carries a transform; written untransformed — add a TRn card and the n field by hand.` });
    }
    if (shape.kind === 'body') {
        const facets: number[] = [];
        for (const f of shape.facets) {
            const n = em.nextSurf++;
            facets.push(n);
            em.surfaceCards.push(`${n} ${facetCard(f, em, `${label} facet`)}`);
        }
        em.surfaceCards[em.surfaceCards.length - facets.length] += `  $ body ${label}: facets ${facets[0]}–${facets[facets.length - 1]}`;
        em.surfNum.set(id, facets);
        return;
    }
    const n = em.nextSurf++;
    em.surfaceCards.push(`${n} ${facetCard(shape, em, label)}  $ ${label}`);
    em.surfNum.set(id, n);
}

function facetCard(shape: Shape, em: Emitter, label: string): string {
    switch (shape.kind) {
        case 'plane': return emitPlane(shape.n, shape.d);
        case 'quadric': return emitQuadric(shape);
        case 'cone': {
            const ax = shape.axis;
            const mn = Math.abs(ax[0]) > 0.999 ? 'x' : Math.abs(ax[1]) > 0.999 ? 'y' : Math.abs(ax[2]) > 0.999 ? 'z' : null;
            if (!mn) {
                em.issues.push({ sourceLine: -1, message: `Surface ${label}: skewed cone has no MCNP mnemonic; written as a GQ approximation is not possible — TODO.` });
                return `so 1e6  $ ${TODO_MARK} skewed cone`;
            }
            const sheet = shape.sheet ? ` ${shape.sheet}` : '';
            return `k/${mn} ${fmt(shape.apex[0])} ${fmt(shape.apex[1])} ${fmt(shape.apex[2])} ${fmt(shape.t2)}${sheet}`;
        }
        case 'torus':
            return `t${shape.axis} ${fmt(shape.center[0])} ${fmt(shape.center[1])} ${fmt(shape.center[2])} ${fmt(shape.a)} ${fmt(shape.b)} ${fmt(shape.c)}`;
        case 'body':
            em.issues.push({ sourceLine: -1, message: `Surface ${label}: nested body; only the first facet is written.` });
            return facetCard(shape.facets[0], em, label);
    }
}

function regionText(node: RegionNode | null, em: Emitter, cellNum: (id: number) => number): string {
    if (!node) return '';
    const half = (surface: number, sense: 1 | -1): string => {
        const mapped = em.surfNum.get(surface);
        if (mapped === undefined) return `${sense < 0 ? '-' : ''}${surface}`;
        if (typeof mapped === 'number') return `${sense < 0 ? '-' : ''}${mapped}`;
        // Body: inside = all facets negative; outside = any facet positive.
        return sense < 0 ? `(${mapped.map((f) => `-${f}`).join(' ')})` : `(${mapped.join(':')})`;
    };
    const walk = (n: RegionNode): string => {
        switch (n.op) {
            case 'halfspace': return half(n.surface, n.sense);
            case 'and': return n.kids.map(walk).join(' ');
            case 'or': return `(${n.kids.map(walk).join(':')})`;
            case 'not': return `#(${walk(n.kid)})`;
            case 'cellcomp': return `#${cellNum(n.cell)}`;
        }
    };
    return walk(node);
}

function wrap(card: string): string {
    const out: string[] = [];
    let cur = '';
    for (const tok of card.split(/\s+/)) {
        if ((cur + ' ' + tok).length > 78) { out.push(cur); cur = '     ' + tok; }
        else cur = cur ? cur + ' ' + tok : tok;
    }
    if (cur) out.push(cur);
    return out.join('\n');
}

export interface ModelToMcnpOptions {
    language: 'serpent' | 'scone';
    title?: string;
}

/**
 * MCNP deck from a parsed Serpent/SCONE model and the source text (for
 * material compositions and the source definition).
 */
export function modelToMcnp(model: McnpGeometryModel, text: string, opts: ModelToMcnpOptions): ConversionResult {
    const issues: ConversionIssue[] = [];
    const em: Emitter = { surfNum: new Map(), surfaceCards: [], issues, nextSurf: 1 };
    const names = model.names;
    const root = rootUniverseId(model);
    const direction = opts.language === 'serpent' ? 'serpent_to_mcnp' : 'scone_to_mcnp';

    // --- surfaces: deck order by id, skipping synthesized lattice windows
    // (they are re-derived from the lattice cell below).
    const surfaces = [...model.surfaces.values()].sort((a, b) => a.id - b.id);
    for (const s of surfaces) {
        const label = names?.surfaces.get(s.id) ?? String(s.id);
        emitShape(em, s.id, s.shape, s.tr, label);
    }

    // --- materials
    const mats = canonicalMaterials(text, opts.language);
    const matNum = new Map<string, number>();
    const matCards: string[] = [];
    let nextMat = 1;
    const matDensity = new Map<string, CanonicalMaterial>();
    for (const m of mats) {
        matNum.set(m.name.toLowerCase(), nextMat);
        matDensity.set(m.name.toLowerCase(), m);
        const lines = [`m${nextMat}  $ ${m.name}`];
        for (const [nuclide, frac] of m.nuclides) {
            const zaid = nuclideToZaid(nuclide);
            const sign = m.fractionType === 'wo' ? '-' : '';
            lines.push(`     ${zaid} ${sign}${fmt(frac)}`);
        }
        matCards.push(lines.join('\n'));
        nextMat++;
    }
    if (mats.length) {
        issues.push({ sourceLine: -1, message: `Materials written with .80c (ENDF/B-VII.1) — the source suffixes were temperatures, not evaluations. Pick the library and add TMP cards for hot materials.` });
    }

    // Model material id → source name → MCNP number.
    const modelMatToNum = (id: number): number => {
        if (id === 0) return 0;
        const name = names?.materials.get(id)?.toLowerCase();
        if (name && matNum.has(name)) return matNum.get(name)!;
        // Unknown composition: allocate a placeholder material.
        const key = name ?? `m${id}`;
        if (!matNum.has(key)) {
            matNum.set(key, nextMat);
            matCards.push(`m${nextMat}  $ ${TODO_MARK} composition of '${key}' not found in the source deck\n     1001.80c 1`);
            issues.push({ sourceLine: -1, message: `Material '${key}': composition not found in the source; placeholder m${nextMat} written.` });
            nextMat++;
        }
        return matNum.get(key)!;
    };

    // --- cells
    const cellNum = new Map<number, number>();
    let nextCell = 1;
    const universeOrder = [...model.universes.keys()].sort((a, b) => (a === root ? -1 : b === root ? 1 : a - b));
    for (const uid of universeOrder) for (const cid of model.universes.get(uid) ?? []) cellNum.set(cid, nextCell++);
    // Universe numbers: MCNP root is u=0; other universes keep their id when
    // it is not 0, else get a new one.
    const uniNum = new Map<number, number>([[root, 0]]);
    let nextUni = 1;
    for (const uid of universeOrder) {
        if (uid === root) continue;
        if (uid !== 0 && ![...uniNum.values()].includes(uid)) uniNum.set(uid, uid);
        else { while ([...uniNum.values()].includes(nextUni)) nextUni++; uniNum.set(uid, nextUni++); }
    }

    const wb = worldBounds(model);
    const far: Vec3 = [wb.max[0] + 10 * (wb.max[0] - wb.min[0]) + 1e3, wb.max[1] + 1e3, wb.max[2] + 1e3];
    const cellCards: string[] = [];
    let graveyards = 0;
    for (const uid of universeOrder) {
        for (const cid of model.universes.get(uid) ?? []) {
            const c = model.cells.get(cid)!;
            const parts: string[] = [String(cellNum.get(cid))];
            const isRootVoid = uid === root && c.material === 0 && !c.fill;
            const grave = isRootVoid && c.region !== null && cellContains(model, cid, far);
            if (c.fill || c.material === 0) parts.push('0');
            else {
                const mn = modelMatToNum(c.material);
                const cm = names?.materials.get(c.material)?.toLowerCase();
                const cmat = cm ? matDensity.get(cm) : undefined;
                const dens = c.density !== null ? c.density
                    : cmat && cmat.density !== null ? (cmat.densityUnit === 'g/cm3' ? -cmat.density : cmat.density)
                    : null;
                parts.push(String(mn));
                if (dens === null) {
                    parts.push(`-1.0`);
                    issues.push({ sourceLine: -1, message: `Cell ${names?.cells.get(cid) ?? cid}: no density in the source (Serpent 'sum' or SCONE atom densities); -1.0 g/cm3 written as a placeholder.` });
                } else parts.push(fmt(dens));
            }
            parts.push(regionText(c.region, em, (id) => cellNum.get(id) ?? id));
            if (uid !== root) parts.push(`u=${uniNum.get(uid)}`);
            if (c.fill) {
                if (c.fill.grid) {
                    const g = c.fill.grid;
                    parts.push(`lat=${c.lat === 2 ? 2 : 1}`);
                    const list = g.entries.map((e) => String(uniNum.get(e.universe) ?? e.universe));
                    parts.push(`fill=${g.i1}:${g.i2} ${g.j1}:${g.j2} ${g.k1}:${g.k2} ${list.join(' ')}`);
                    if (c.fill.tr) {
                        issues.push({ sourceLine: -1, message: `Cell ${names?.cells.get(cid) ?? cid}: lattice fill carries a translation (${c.fill.tr.o.map(fmt).join(' ')}); MCNP needs it on a TRCL or as a shifted window — check the lattice origin.` });
                        parts.push(`$ ${TODO_MARK} fill offset ${c.fill.tr.o.map(fmt).join(' ')}`);
                    }
                } else if (c.fill.universe !== null) {
                    const trs = c.fill.tr ? ` (${c.fill.tr.o.map(fmt).join(' ')})` : '';
                    parts.push(`fill=${uniNum.get(c.fill.universe) ?? c.fill.universe}${trs}`);
                }
            }
            if (c.trcl) parts.push(`trcl=(${c.trcl.o.map(fmt).join(' ')})`);
            parts.push(grave ? 'imp:n=0' : 'imp:n=1');
            if (grave) graveyards++;
            const label = names?.cells.get(cid);
            const card = wrap(parts.join(' '));
            cellCards.push(label && label !== String(cid) ? `${card}  $ ${label}` : card);
        }
    }
    if (!graveyards) {
        issues.push({ sourceLine: -1, message: 'No outside/graveyard cell could be identified; add a cell with imp:n=0 covering the complement of the problem.' });
    }

    // --- data block
    const data: string[] = ['mode n'];
    data.push(...matCards);
    const overlays = extractOverlays(text, opts.language);
    const pts = overlays.filter((o) => o.kind === 'point' && o.group === 'source');
    data.push(`kcode 10000 1.0 50 250  $ ${TODO_MARK} copy the source's population/cycles`);
    if (pts.length) data.push(wrap(`ksrc ${pts.map((p) => `${fmt(p.x)} ${fmt(p.y)} ${fmt(p.z)}`).join(' ')}`));
    else {
        const c: Vec3 = [(wb.min[0] + wb.max[0]) / 2, (wb.min[1] + wb.max[1]) / 2, (wb.min[2] + wb.max[2]) / 2];
        data.push(`ksrc ${fmt(c[0])} ${fmt(c[1])} ${fmt(c[2])}  $ ${TODO_MARK} box centre — move inside fuel`);
        issues.push({ sourceLine: -1, message: 'No point source found in the source deck; ksrc placed at the bounding-box centre.' });
    }

    const title = opts.title ?? `Converted from ${opts.language.toUpperCase()} by OWEN`;
    const output = [
        title.slice(0, 78),
        `c ${TODO_MARK}: review every line — geometry from the exact-geometry model, materials from the source cards`,
        ...cellCards,
        '',
        ...em.surfaceCards.map(wrap),
        '',
        ...data,
        '',
    ].join('\n');
    return { direction, output, issues };
}
