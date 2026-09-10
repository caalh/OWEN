// Source and tally overlays for the 3D preview, read from a deck's data cards.
//
// The geometry parsers ignore everything that is not a cell or a surface. The
// two things a reader most wants to see against the geometry are where the
// source starts particles (`ksrc` must sit inside a cell, never on a surface)
// and where a mesh tally scores (`fmesh` with no `fm` is flux, and one that
// misses the fuel scores nothing). Each code writes those differently; this
// module reads the common forms with regexes — deliberately shallow, because
// a distribution the preview cannot draw is better skipped than misdrawn.
//
// No `vscode` import; tested headless.

import type { SceneOverlay } from './types';

const NUM = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
const numRe = new RegExp(NUM, 'g');

function nums(s: string): number[] {
    return (s.match(numRe) ?? []).map(Number).filter(Number.isFinite);
}

/** MCNP continuation: a card continues on lines starting with 5+ blanks, or after a trailing `&`. */
function mcnpLogicalLines(text: string): string[] {
    const out: string[] = [];
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(/\$.*$/, '');
        if (/^\s*c(\s|$)/i.test(line)) continue;
        const prevAmp = out.length && /&\s*$/.test(out[out.length - 1]);
        if (out.length && (prevAmp || /^\s{5,}\S/.test(line))) {
            out[out.length - 1] = out[out.length - 1].replace(/&\s*$/, '') + ' ' + line.trim();
        } else {
            out.push(line);
        }
    }
    return out;
}

export function mcnpOverlays(text: string): SceneOverlay[] {
    const out: SceneOverlay[] = [];
    for (const line of mcnpLogicalLines(text)) {
        const low = line.trim().toLowerCase();
        if (low.startsWith('ksrc')) {
            const v = nums(line.trim().slice(4));
            for (let i = 0; i + 2 < v.length; i += 3) {
                out.push({ kind: 'point', group: 'source', label: 'ksrc', x: v[i], y: v[i + 1], z: v[i + 2] });
            }
        } else if (low.startsWith('sdef')) {
            const m = new RegExp(`\\bpos\\s*=?\\s*(${NUM})\\s+(${NUM})\\s+(${NUM})`, 'i').exec(line);
            if (m) {
                out.push({ kind: 'point', group: 'source', label: 'sdef pos', x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) });
            } else if (!/\b(pos|x|y|z|cel|sur)\s*=/i.test(line)) {
                // Bare `sdef` is an isotropic point source at the origin.
                out.push({ kind: 'point', group: 'source', label: 'sdef (origin)', x: 0, y: 0, z: 0 });
            }
        } else if (/^fmesh\d+/.test(low)) {
            const id = /^fmesh(\d+)/.exec(low)![1];
            const grab = (key: string): number[] => {
                const m = new RegExp(`\\b${key}\\s*=\\s*((?:${NUM}\\s*)+)`, 'i').exec(line);
                return m ? nums(m[1]) : [];
            };
            const origin = grab('origin');
            const im = grab('imesh'), jm = grab('jmesh'), km = grab('kmesh');
            if (origin.length >= 3 && im.length && jm.length && km.length) {
                const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
                const ii = grab('iints'), ji = grab('jints'), ki = grab('kints');
                out.push({
                    kind: 'box', group: 'tally', label: `fmesh${id}`,
                    x: origin[0], y: origin[1], z: origin[2],
                    x2: im[im.length - 1], y2: jm[jm.length - 1], z2: km[km.length - 1],
                    nx: ii.length ? sum(ii) : im.length, ny: ji.length ? sum(ji) : jm.length, nz: ki.length ? sum(ki) : km.length,
                });
            }
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// OpenMC (Python)
// ---------------------------------------------------------------------------

/** Scalar assignments `name = 12.5` so a tuple like `(0, 0, h/2)` resolves. */
function pyEnv(text: string): Map<string, number> {
    const env = new Map<string, number>();
    for (const m of text.matchAll(/^\s*([A-Za-z_]\w*)\s*=\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*(?:#.*)?$/gm)) {
        env.set(m[1], Number(m[2]));
    }
    return env;
}

/** Evaluate a small arithmetic expression over numbers and env names. */
function pyEval(expr: string, env: Map<string, number>): number | null {
    const src = expr.trim();
    if (!/^[\w.\s+\-*/()]+$/.test(src)) return null;
    const replaced = src.replace(/[A-Za-z_]\w*/g, (name) => {
        const v = env.get(name);
        return v === undefined ? 'NaN' : String(v);
    });
    if (/[A-Za-z]/.test(replaced.replace(/NaN|e/g, ''))) return null;
    try {
        // Digits, operators and parentheses only by construction of the regex above.
        const v = Function(`"use strict"; return (${replaced});`)() as number;
        return Number.isFinite(v) ? v : null;
    } catch {
        return null;
    }
}

function pyTuple(s: string, env: Map<string, number>): number[] | null {
    const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
    const vals = parts.map((p) => pyEval(p, env));
    return vals.every((v): v is number => v !== null) && vals.length >= 3 ? vals.slice(0, 3) : null;
}

/** OpenMC XML: settings <source><space …> and tallies/settings <mesh>. */
export function openmcXmlOverlays(xml: string): SceneOverlay[] {
    const out: SceneOverlay[] = [];
    const attr = (tag: string, name: string): string | undefined => {
        const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
        return m ? (m[2] ?? m[3]) : undefined;
    };
    for (const sp of xml.matchAll(/<space\b([^>]*)\/?>/gi)) {
        const type = (attr(sp[1], 'type') ?? '').toLowerCase();
        const params = nums(attr(sp[1], 'parameters') ?? '');
        const origin = nums(attr(sp[1], 'origin') ?? '');
        if (type === 'point' && params.length >= 3) {
            out.push({ kind: 'point', group: 'source', label: 'source point', x: params[0], y: params[1], z: params[2] });
        } else if (type === 'box' && params.length >= 6) {
            out.push({ kind: 'box', group: 'source', label: 'source box', x: params[0], y: params[1], z: params[2], x2: params[3], y2: params[4], z2: params[5] });
        } else if ((type === 'spherical' || type === 'cylindrical' || type === 'cartesian') && origin.length >= 3) {
            out.push({ kind: 'point', group: 'source', label: `${type} source origin`, x: origin[0], y: origin[1], z: origin[2] });
        }
    }
    for (const m of xml.matchAll(/<mesh\b([^>]*)>([\s\S]*?)<\/mesh\s*>/gi)) {
        const id = attr(m[1], 'id') ?? '?';
        const inner = (name: string): number[] => nums(new RegExp(`<${name}\\s*>([^<]*)<\\/${name}\\s*>`, 'i').exec(m[2])?.[1] ?? '');
        const ll = inner('lower_left'), ur = inner('upper_right'), dim = inner('dimension');
        if (ll.length >= 3 && ur.length >= 3) {
            out.push({ kind: 'box', group: 'tally', label: `mesh ${id}`, x: ll[0], y: ll[1], z: ll[2], x2: ur[0], y2: ur[1], z2: ur[2], nx: dim[0] ?? 1, ny: dim[1] ?? 1, nz: dim[2] ?? 1 });
        } else if (ll.length >= 2 && ur.length >= 2) {
            const big = 1e3;
            out.push({ kind: 'box', group: 'tally', label: `mesh ${id} (2D)`, x: ll[0], y: ll[1], z: -big, x2: ur[0], y2: ur[1], z2: big, nx: dim[0] ?? 1, ny: dim[1] ?? 1, nz: 1 });
        }
    }
    return out;
}

export function openmcOverlays(text: string): SceneOverlay[] {
    if (/^\s*</.test(text)) return openmcXmlOverlays(text);
    const out: SceneOverlay[] = [];
    const env = pyEnv(text);
    for (const m of text.matchAll(/openmc\.stats\.Point\(\s*[([]([^)\]]*)[)\]]\s*\)/g)) {
        const p = pyTuple(m[1], env);
        if (p) out.push({ kind: 'point', group: 'source', label: 'stats.Point', x: p[0], y: p[1], z: p[2] });
    }
    for (const m of text.matchAll(/openmc\.stats\.Box\(\s*[([]([^)\]]*)[)\]]\s*,\s*[([]([^)\]]*)[)\]]/g)) {
        const a = pyTuple(m[1], env), b = pyTuple(m[2], env);
        if (a && b) out.push({ kind: 'box', group: 'source', label: 'stats.Box', x: a[0], y: a[1], z: a[2], x2: b[0], y2: b[1], z2: b[2] });
    }
    // RegularMesh: `m = openmc.RegularMesh()` then `m.lower_left = …`, `m.upper_right = …`, `m.dimension = …`.
    for (const m of text.matchAll(/^\s*(\w+)\s*=\s*openmc\.(?:RegularMesh|Mesh)\(/gm)) {
        const v = m[1];
        const get = (attr: string): string | null => {
            const r = new RegExp(`^\\s*${v}\\.${attr}\\s*=\\s*[([]([^)\\]]*)[)\\]]`, 'm').exec(text);
            return r ? r[1] : null;
        };
        const ll = get('lower_left'), ur = get('upper_right'), dim = get('dimension');
        const a = ll ? pyTuple(ll, env) : null;
        const b = ur ? pyTuple(ur, env) : null;
        if (!a || !b) continue;
        const d = dim ? dim.split(',').map((s) => pyEval(s, env) ?? 1) : [];
        out.push({
            kind: 'box', group: 'tally', label: `RegularMesh ${v}`,
            x: a[0], y: a[1], z: a[2], x2: b[0], y2: b[1], z2: b[2],
            nx: d[0] ?? 1, ny: d[1] ?? 1, nz: d[2] ?? 1,
        });
    }
    return out;
}

// ---------------------------------------------------------------------------
// Serpent
// ---------------------------------------------------------------------------

export function serpentOverlays(text: string): SceneOverlay[] {
    const out: SceneOverlay[] = [];
    const clean = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/%.*$/gm, '');
    // Cards run until the next keyword at line start; gather each src/det card.
    const cardRe = /^\s*(src|det)\s+(\S+)([\s\S]*?)(?=^\s*(?:surf|cell|lat|pin|trans|mat|therm|set|include|plot|mesh|det|nest|src|ene|div|branch|coef)\b|$(?![\s\S]))/gm;
    for (const m of clean.matchAll(cardRe)) {
        const kind = m[1], name = m[2], body = m[3];
        if (kind === 'src') {
            const sp = new RegExp(`\\bsp\\s+(${NUM})\\s+(${NUM})\\s+(${NUM})`).exec(body);
            if (sp) out.push({ kind: 'point', group: 'source', label: `src ${name} sp`, x: Number(sp[1]), y: Number(sp[2]), z: Number(sp[3]) });
            const sx = new RegExp(`\\bsx\\s+(${NUM})\\s+(${NUM})`).exec(body);
            const sy = new RegExp(`\\bsy\\s+(${NUM})\\s+(${NUM})`).exec(body);
            const sz = new RegExp(`\\bsz\\s+(${NUM})\\s+(${NUM})`).exec(body);
            if (sx && sy && sz) {
                out.push({
                    kind: 'box', group: 'source', label: `src ${name} box`,
                    x: Number(sx[1]), y: Number(sy[1]), z: Number(sz[1]), x2: Number(sx[2]), y2: Number(sy[2]), z2: Number(sz[2]),
                });
            }
        } else {
            const dx = new RegExp(`\\bdx\\s+(${NUM})\\s+(${NUM})\\s+(\\d+)`).exec(body);
            const dy = new RegExp(`\\bdy\\s+(${NUM})\\s+(${NUM})\\s+(\\d+)`).exec(body);
            const dz = new RegExp(`\\bdz\\s+(${NUM})\\s+(${NUM})\\s+(\\d+)`).exec(body);
            if (dx || dy || dz) {
                // A det with only dz is an axial binning over an infinite slab;
                // draw the axes that are bounded and leave the rest at ±extent.
                const big = 1e3;
                out.push({
                    kind: 'box', group: 'tally', label: `det ${name}`,
                    x: dx ? Number(dx[1]) : -big, y: dy ? Number(dy[1]) : -big, z: dz ? Number(dz[1]) : -big,
                    x2: dx ? Number(dx[2]) : big, y2: dy ? Number(dy[2]) : big, z2: dz ? Number(dz[2]) : big,
                    nx: dx ? Number(dx[3]) : 1, ny: dy ? Number(dy[3]) : 1, nz: dz ? Number(dz[3]) : 1,
                });
            }
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// SCONE
// ---------------------------------------------------------------------------

export function sconeOverlays(text: string): SceneOverlay[] {
    const out: SceneOverlay[] = [];
    const clean = text.replace(/!.*$/gm, '');
    const src = /\bsource\s*\{([^{}]*)\}/g;
    for (const m of clean.matchAll(src)) {
        const body = m[1];
        if (/\btype\s+pointSource\b/i.test(body)) {
            const r = new RegExp(`\\br\\s*\\(\\s*(${NUM})\\s+(${NUM})\\s+(${NUM})\\s*\\)`).exec(body);
            if (r) out.push({ kind: 'point', group: 'source', label: 'pointSource', x: Number(r[1]), y: Number(r[2]), z: Number(r[3]) });
        }
    }
    return out;
}

/**
 * Overlays for a deck in any supported language. Returns [] rather than
 * throwing: the preview must never fail because of a source card.
 */
export function extractOverlays(text: string, language: string): SceneOverlay[] {
    try {
        switch (language) {
            case 'mcnp': return mcnpOverlays(text);
            case 'openmc': return openmcOverlays(text);
            case 'serpent': return serpentOverlays(text);
            case 'scone': return sconeOverlays(text);
            default: return [];
        }
    } catch {
        return [];
    }
}
