// Canonical form of a deck, for a diff that means something.
//
// A text diff of two decks is noise: renumbered surfaces, reordered cards,
// comments, `1.0E+00` against `1`. What a reviewer wants to know is whether
// the *model* changed — same surfaces, same regions, same materials at the
// same densities, same fills. So both decks are parsed into the shared
// geometry model, every quantity is rounded and printed in one fixed layout,
// and VS Code's own diff viewer shows the two listings side by side. Names
// are the deck's own where the parser kept them (Serpent, SCONE, OpenMC XML),
// so a Serpent deck and its MCNP conversion line up as far as they can.
//
// No vscode import; tested headless.

import { zaidToNuclide } from '../converter/zaid';
import { parseMcnpDeck } from '../converter/mcnpModel';
import { McnpGeometryModel, RegionNode, Shape, Transform } from '../preview/mcnpGeometry';
import { rootUniverseId } from '../preview/mcnpEvaluate';

const sig = (v: number, digits = 6): string => {
    if (!Number.isFinite(v)) return String(v);
    if (Math.abs(v) < 1e-12) return '0';
    const s = Number(v.toPrecision(digits));
    return String(s === 0 ? 0 : s);
};

const vec = (v: readonly number[]): string => `(${v.map((x) => sig(x)).join(' ')})`;

function shapeText(s: Shape): string {
    switch (s.kind) {
        case 'plane': return `plane n=${vec(s.n)} d=${sig(s.d)}`;
        case 'quadric': {
            const { a, b, c, d, e, f, g, h, j, k } = s;
            // Recognise the common quadrics so the listing reads like a card.
            if (a === 1 && b === 1 && c === 1 && !d && !e && !f) {
                const cx = -g / 2, cy = -h / 2, cz = -j / 2;
                const r2 = cx * cx + cy * cy + cz * cz - k;
                if (r2 > 0) return `sphere c=${vec([cx, cy, cz])} r=${sig(Math.sqrt(r2))}`;
            }
            const cyl = (axis: string, u: number, v: number, kk: number): string | null => {
                const r2 = u * u + v * v - kk;
                return r2 > 0 ? `cyl/${axis} c=${vec([u, v])} r=${sig(Math.sqrt(r2))}` : null;
            };
            if (a === 0 && b === 1 && c === 1 && !d && !e && !f) { const t = cyl('x', -h / 2, -j / 2, k); if (t) return t; }
            if (a === 1 && b === 0 && c === 1 && !d && !e && !f) { const t = cyl('y', -g / 2, -j / 2, k); if (t) return t; }
            if (a === 1 && b === 1 && c === 0 && !d && !e && !f) { const t = cyl('z', -g / 2, -h / 2, k); if (t) return t; }
            return `quadric ${[a, b, c, d, e, f, g, h, j, k].map((x) => sig(x)).join(' ')}`;
        }
        case 'cone': return `cone apex=${vec(s.apex)} axis=${vec(s.axis)} t2=${sig(s.t2)} sheet=${s.sheet}`;
        case 'torus': return `torus c=${vec(s.center)} axis=${s.axis} a=${sig(s.a)} b=${sig(s.b)} c=${sig(s.c)}`;
        case 'body': return `body { ${s.facets.map(shapeText).join(' ; ')} }`;
    }
}

function trText(t: Transform | null): string {
    if (!t) return '';
    return ` tr=o${vec(t.o)}${t.m ? ' rot' : ''}`;
}

function regionText(node: RegionNode | null, surfName: (id: number) => string, cellName: (id: number) => string): string {
    if (!node) return '(none)';
    const walk = (n: RegionNode): string => {
        switch (n.op) {
            case 'halfspace': return `${n.sense < 0 ? '-' : '+'}${surfName(n.surface)}`;
            case 'and': return n.kids.map(walk).join(' ');
            case 'or': return `(${n.kids.map(walk).join(' : ')})`;
            case 'not': return `~(${walk(n.kid)})`;
            case 'cellcomp': return `#${cellName(n.cell)}`;
        }
    };
    return walk(node);
}

export interface CanonicalMaterial {
    name: string;
    /** Mass density (g/cm³, positive) or atom density; null when unknown. */
    density: number | null;
    densityUnit: 'g/cm3' | 'atom/b-cm' | null;
    /** Nuclide → normalised fraction (sums to 1), by 'U235'-style name. */
    nuclides: Map<string, number>;
    fractionType: 'ao' | 'wo' | 'mixed' | null;
}

/**
 * Material compositions in one vocabulary, from the deck text (the geometry
 * model has only ids). MCNP via the converter's deck parser; Serpent and
 * SCONE via their card syntax. OpenMC Python is left out: its materials are
 * built at run time.
 */
export function canonicalMaterials(text: string, language: string): CanonicalMaterial[] {
    const out: CanonicalMaterial[] = [];
    const normalise = (pairs: [string, number][]): Map<string, number> => {
        const total = pairs.reduce((s, [, f]) => s + Math.abs(f), 0) || 1;
        const m = new Map<string, number>();
        for (const [n, f] of pairs) m.set(n, (m.get(n) ?? 0) + Math.abs(f) / total);
        return new Map([...m].sort((a, b) => a[0].localeCompare(b[0])));
    };
    if (language === 'mcnp') {
        const deck = parseMcnpDeck(text);
        const densByMat = new Map<number, { v: number; u: 'g/cm3' | 'atom/b-cm' }>();
        for (const c of deck.cells) {
            if (c.matId && c.density !== null && !densByMat.has(c.matId)) {
                densByMat.set(c.matId, { v: Math.abs(c.density), u: c.density < 0 ? 'g/cm3' : 'atom/b-cm' });
            }
        }
        for (const m of deck.materials) {
            const types = new Set(m.nuclides.map((n) => n.type));
            const d = densByMat.get(m.id);
            out.push({
                name: `m${m.id}`,
                density: d?.v ?? null,
                densityUnit: d?.u ?? null,
                nuclides: normalise(m.nuclides.map((n) => [n.name, n.fraction])),
                fractionType: types.size === 1 ? [...types][0] : types.size ? 'mixed' : null,
            });
        }
        return out;
    }
    if (language === 'serpent') {
        const clean = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/%.*$/gm, '');
        const re = /^\s*mat\s+(\S+)\s+(sum|[-+]?[\d.]+(?:[eE][-+]?\d+)?)([\s\S]*?)(?=^\s*(?:surf|cell|lat|pin|trans|mat|therm|set|include|plot|mesh|det|nest|src|ene|div|branch|coef)\b|$(?![\s\S]))/gm;
        for (const m of clean.matchAll(re)) {
            const dens = m[2] === 'sum' ? null : Number(m[2]);
            const toks = m[3].trim().split(/\s+/).filter(Boolean);
            // Options (tmp, rgb, burn, moder …) precede the ZAID list; a ZAID token has a dot or is Z000 numeric.
            const pairs: [string, number][] = [];
            let types = new Set<'ao' | 'wo'>();
            for (let i = 0; i + 1 < toks.length; i++) {
                if (!/^\d{4,6}(\.\d{2}[a-z])?$/.test(toks[i])) continue;
                const f = Number(toks[i + 1]);
                if (!Number.isFinite(f)) continue;
                pairs.push([zaidToNuclide(toks[i]), f]);
                types.add(f < 0 ? 'wo' : 'ao');
                i++;
            }
            if (!pairs.length) continue;
            out.push({
                name: m[1],
                density: dens === null ? null : Math.abs(dens),
                densityUnit: dens === null ? null : dens < 0 ? 'g/cm3' : 'atom/b-cm',
                nuclides: normalise(pairs),
                fractionType: types.size === 1 ? [...types][0] : 'mixed',
            });
            types = new Set();
        }
        return out;
    }
    if (language === 'scone') {
        const clean = text.replace(/!.*$/gm, '');
        const matsBlock = /\bmaterials\s*\{([\s\S]*)\}\s*$/m.exec(clean)?.[1] ?? clean;
        const re = /(\w+)\s*\{[^{}]*?composition\s*\{([^{}]*)\}[^{}]*\}/g;
        for (const m of matsBlock.matchAll(re)) {
            const pairs: [string, number][] = [];
            for (const p of m[2].matchAll(/(\d{4,6})(?:\.\d{2})?\s+([-+]?[\d.]+(?:[eE][-+]?\d+)?)\s*;/g)) {
                pairs.push([zaidToNuclide(p[1]), Number(p[2])]);
            }
            if (!pairs.length) continue;
            out.push({ name: m[1], density: null, densityUnit: null, nuclides: normalise(pairs), fractionType: 'ao' });
        }
        return out;
    }
    return out;
}

/** Fixed-layout listing of a geometry model (+ materials) for the diff viewer. */
export function canonicalDeck(model: McnpGeometryModel, language: string, text: string): string {
    const names = model.names;
    const surfName = (id: number): string => names?.surfaces.get(id) ?? String(id);
    const cellName = (id: number): string => names?.cells.get(id) ?? String(id);
    const uniName = (id: number): string => names?.universes.get(id) ?? String(id);
    const matName = (id: number): string => (id === 0 ? 'void' : names?.materials.get(id) ?? `m${id}`);
    const root = rootUniverseId(model);
    const lines: string[] = [];
    lines.push(`# OWEN canonical deck — ${language.toUpperCase()} · ${model.cells.size} cells · ${model.surfaces.size} surfaces · ${model.universes.size} universes · root ${uniName(root)}`);
    lines.push('');

    lines.push('## surfaces');
    const surfaces = [...model.surfaces.values()].sort((a, b) => surfName(a.id).localeCompare(surfName(b.id), undefined, { numeric: true }));
    for (const s of surfaces) {
        if (s.id >= 1_000_000 && !names?.surfaces.has(s.id)) continue; // synthesized lattice windows: structure, not input
        lines.push(`surface ${surfName(s.id)}: ${shapeText(s.shape)}${trText(s.tr)}${s.boundary !== 'none' ? ` bc=${s.boundary}` : ''}`);
    }
    lines.push('');

    lines.push('## cells');
    const uids = [...model.universes.keys()].sort((a, b) => (a === root ? -1 : b === root ? 1 : uniName(a).localeCompare(uniName(b), undefined, { numeric: true })));
    for (const uid of uids) {
        lines.push(`universe ${uniName(uid)}${uid === root ? ' (root)' : ''}: ${model.universes.get(uid)?.length ?? 0} cells`);
        const cells = (model.universes.get(uid) ?? []).map((id) => model.cells.get(id)!).filter(Boolean)
            .sort((a, b) => cellName(a.id).localeCompare(cellName(b.id), undefined, { numeric: true }));
        for (const c of cells) {
            const parts = [`cell ${cellName(c.id)}:`];
            if (c.fill) {
                if (c.fill.grid) {
                    const g = c.fill.grid;
                    const counts = new Map<number, number>();
                    for (const e of g.entries) counts.set(e.universe, (counts.get(e.universe) ?? 0) + 1);
                    const list = [...counts].sort((a, b) => b[1] - a[1]).map(([u, n]) => `${uniName(u)}×${n}`).join(' ');
                    parts.push(`lattice=${c.lat === 2 ? 'hex' : 'square'} ${g.i2 - g.i1 + 1}×${g.j2 - g.j1 + 1}×${g.k2 - g.k1 + 1} fills=[${list}]`);
                } else if (c.fill.universe !== null) {
                    parts.push(`fill=${uniName(c.fill.universe)}${c.fill.tr ? ' (tr)' : ''}`);
                }
            } else {
                parts.push(`material=${matName(c.material)}`);
                if (c.density !== null) parts.push(`density=${sig(Math.abs(c.density))}${c.density < 0 ? 'g/cm3' : 'a/b-cm'}`);
            }
            parts.push(`region=[${regionText(c.region, surfName, cellName)}]`);
            if (c.trcl) parts.push('trcl');
            lines.push('  ' + parts.join(' '));
        }
    }
    lines.push('');

    const mats = canonicalMaterials(text, language);
    if (mats.length) {
        lines.push('## materials');
        for (const m of mats.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
            const head = `material ${m.name}:` +
                (m.density !== null ? ` density=${sig(m.density)}${m.densityUnit === 'g/cm3' ? 'g/cm3' : 'a/b-cm'}` : '') +
                (m.fractionType ? ` fractions=${m.fractionType}` : '');
            lines.push(head);
            for (const [n, f] of m.nuclides) lines.push(`  ${n.padEnd(10)} ${sig(f, 5)}`);
        }
        lines.push('');
    }
    return lines.join('\n');
}
