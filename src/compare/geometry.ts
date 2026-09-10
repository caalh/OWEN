// Same model, two decks: do they agree point for point?
//
// The Serpent, SCONE, OpenMC and MCNP renderings of one reactor differ in the
// preview because four parsers classify things four ways. This is the check
// that does not care about any of that: throw random points into the region
// both models cover, ask each model which material is there, and count. Two
// decks that describe the same reactor agree at ~100 % of points; a
// mistranslated radius, a mirrored lattice map or a missing baffle shows up
// as a specific pair of materials disagreeing in a specific place.
//
// Materials are compared by *component class* (fuel, clad, moderator …) via
// the shared name heuristic, because the two decks name materials
// differently by construction; an exact-name comparison is also reported
// when both decks have names. No vscode import.

import { McnpGeometryModel, Vec3 } from '../preview/mcnpGeometry';
import { Bounds, domainPredicate, findCell, worldBounds } from '../preview/mcnpEvaluate';
import { materialComponent } from '../preview/palette';
import { Component, ComponentId, COMPONENT_LABELS } from '../preview/types';
import { mcnpMaterialLookup } from '../preview/codes/mcnp';
import { makeRng } from '../geomcheck/core';

export interface ClassifiedModel {
    model: McnpGeometryModel;
    language: string;
    label: string;
    /** material id → display name */
    matName: (id: number) => string;
    /** material id → component class */
    matClass: (id: number) => ComponentId;
}

export function classifyModel(model: McnpGeometryModel, language: string, text: string, label: string): ClassifiedModel {
    const names = model.names?.materials;
    let mcnp: Map<number, { name: string; component: ComponentId }> | null = null;
    if (language === 'mcnp') mcnp = mcnpMaterialLookup(text);
    const matName = (id: number): string => {
        if (id === 0) return 'void';
        return mcnp?.get(id)?.name ?? names?.get(id) ?? `m${id}`;
    };
    const matClass = (id: number): ComponentId => {
        if (id === 0) return Component.Void;
        if (mcnp?.get(id)) return mcnp.get(id)!.component;
        return materialComponent(matName(id), Component.Other);
    };
    return { model, language, label, matName, matClass };
}

export interface Disagreement {
    a: string;
    b: string;
    count: number;
    example: Vec3;
}

export interface GeometryComparison {
    samples: number;
    /** Shared sampling box (intersection of the two world boxes). */
    bounds: Bounds;
    /** Points where both models found a cell (neither lost). */
    resolved: number;
    lostA: number;
    lostB: number;
    /** Agreement by component class. */
    classAgree: number;
    classAgreement: number;
    /** Agreement by material name (only meaningful when both decks have names). */
    nameAgree: number;
    nameAgreement: number;
    /**
     * Agreement once each material of A is paired with the material of B it
     * most often coincides with. This ignores naming and classification
     * entirely and asks only whether the two decks draw the same boundaries:
     * identical geometry scores ~100 % however the materials are labelled.
     */
    mappedAgreement: number;
    /** The pairing used: A material → B material, with its share of A's points. */
    mapping: { a: string; b: string; share: number; points: number }[];
    byClass: Disagreement[];
    byName: Disagreement[];
    /** Per-class point counts in each model, for the composition table. */
    classCountsA: Map<string, number>;
    classCountsB: Map<string, number>;
    summary: { a: ModelSummary; b: ModelSummary };
    notes: string[];
    elapsedMs: number;
}

export interface ModelSummary {
    label: string;
    language: string;
    cells: number;
    surfaces: number;
    universes: number;
    lattices: number;
    bounds: Bounds;
}

function summarize(c: ClassifiedModel): ModelSummary {
    let lattices = 0;
    for (const cell of c.model.cells.values()) if (cell.lat) lattices++;
    return {
        label: c.label, language: c.language,
        cells: c.model.cells.size, surfaces: c.model.surfaces.size, universes: c.model.universes.size,
        lattices, bounds: worldBounds(c.model),
    };
}

export function compareGeometry(a: ClassifiedModel, b: ClassifiedModel, opts: { samples?: number; seed?: number } = {}): GeometryComparison {
    const t0 = Date.now();
    const samples = opts.samples ?? 20_000;
    const rng = makeRng(opts.seed ?? 4242);
    const ba = worldBounds(a.model), bb = worldBounds(b.model);
    const bounds: Bounds = {
        min: [Math.max(ba.min[0], bb.min[0]), Math.max(ba.min[1], bb.min[1]), Math.max(ba.min[2], bb.min[2])],
        max: [Math.min(ba.max[0], bb.max[0]), Math.min(ba.max[1], bb.max[1]), Math.min(ba.max[2], bb.max[2])],
    };
    const notes: string[] = [];
    const empty = bounds.min.some((v, i) => v >= bounds.max[i]);
    if (empty) notes.push('The two decks occupy different regions of space; falling back to the first deck\'s box.');
    const box = empty ? ba : bounds;

    const byClass = new Map<string, Disagreement>();
    const byName = new Map<string, Disagreement>();
    const classCountsA = new Map<string, number>(), classCountsB = new Map<string, number>();
    /** A-material → (B-material → points), for the label-free pairing. */
    const pairs = new Map<string, Map<string, number>>();
    let resolved = 0, lostA = 0, lostB = 0, classAgree = 0, nameAgree = 0, outside = 0;
    const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
    // Beyond a boundary surface (OpenMC vacuum sphere) there is no problem to compare.
    const domA = domainPredicate(a.model), domB = domainPredicate(b.model);

    for (let i = 0; i < samples; i++) {
        const p: Vec3 = [
            box.min[0] + rng() * (box.max[0] - box.min[0]),
            box.min[1] + rng() * (box.max[1] - box.min[1]),
            box.min[2] + rng() * (box.max[2] - box.min[2]),
        ];
        if ((domA && !domA(p)) || (domB && !domB(p))) { outside++; continue; }
        const fa = findCell(a.model, p), fb = findCell(b.model, p);
        if (fa.lost || !fa.cell) lostA++;
        if (fb.lost || !fb.cell) lostB++;
        if (!fa.cell || !fb.cell) continue;
        resolved++;
        const ca = a.matClass(fa.cell.material), cb = b.matClass(fb.cell.material);
        bump(classCountsA, ca); bump(classCountsB, cb);
        if (ca === cb) classAgree++;
        else {
            const key = `${ca}→${cb}`;
            const rec = byClass.get(key) ?? { a: ca, b: cb, count: 0, example: p };
            rec.count++;
            byClass.set(key, rec);
        }
        const na = a.matName(fa.cell.material).toLowerCase(), nb = b.matName(fb.cell.material).toLowerCase();
        const row = pairs.get(na) ?? new Map<string, number>();
        bump(row, nb);
        pairs.set(na, row);
        if (na === nb) nameAgree++;
        else {
            const key = `${na}→${nb}`;
            const rec = byName.get(key) ?? { a: na, b: nb, count: 0, example: p };
            rec.count++;
            byName.set(key, rec);
        }
    }
    let mappedAgree = 0;
    const mapping: GeometryComparison['mapping'] = [];
    for (const [na, row] of pairs) {
        let best = '', bestN = -1, total = 0;
        for (const [nb, n] of row) { total += n; if (n > bestN) { best = nb; bestN = n; } }
        mappedAgree += bestN;
        mapping.push({ a: na, b: best, share: total ? bestN / total : 0, points: total });
    }
    mapping.sort((x, y) => y.points - x.points);
    if (a.language !== b.language) {
        notes.push('Different codes name materials differently by construction. The boundary agreement pairs each material with its usual partner and ignores names; the class agreement shows how the two decks\' materials are classified, which is what the 3D preview toggles use.');
    }
    if (outside) notes.push(`${outside.toLocaleString()} points fell beyond a boundary surface and were not compared.`);
    notes.push('Points are uniform in the shared bounding box, so thin regions (clad, gap) carry little weight; a 1 % disagreement on a full core is a real difference, not noise.');
    return {
        samples, bounds: box, resolved, lostA, lostB,
        classAgree, classAgreement: resolved ? classAgree / resolved : 0,
        nameAgree, nameAgreement: resolved ? nameAgree / resolved : 0,
        mappedAgreement: resolved ? mappedAgree / resolved : 0,
        mapping,
        byClass: [...byClass.values()].sort((x, y) => y.count - x.count),
        byName: [...byName.values()].sort((x, y) => y.count - x.count),
        classCountsA, classCountsB,
        summary: { a: summarize(a), b: summarize(b) },
        notes, elapsedMs: Date.now() - t0,
    };
}

export function classLabel(id: string): string {
    return COMPONENT_LABELS[id] ?? id;
}
