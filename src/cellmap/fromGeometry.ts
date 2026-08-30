// Cell Map from the shared exact-geometry model (Serpent, SCONE, OpenMC XML).
//
// MCNP has its own parser in model.ts because the converter IR carries density
// sign, imp:n, and column-accurate line numbers the geometry engine discards.
// The other three codes already parse onto McnpGeometryModel, so this walks
// that instead of inventing a fourth deck reader.

import {
    McnpCell,
    McnpGeometryModel,
    RegionNode,
} from '../preview/mcnpGeometry';
import {
    CellEdge,
    CellMapModel,
    CellNode,
    CellRole,
    ROOT_UNIVERSE,
    SurfaceRef,
    UniverseNode,
} from './model';

function senseSymbol(senses: Set<1 | -1>): SurfaceRef['sense'] {
    if (senses.size > 1) return '+/-';
    return senses.has(-1) ? '-' : '+';
}

function collectGeomSenses(
    node: RegionNode | null,
    out = new Map<number, Set<1 | -1>>(),
): Map<number, Set<1 | -1>> {
    if (!node) return out;
    switch (node.op) {
        case 'halfspace': {
            const set = out.get(node.surface) ?? new Set<1 | -1>();
            set.add(node.sense);
            out.set(node.surface, set);
            break;
        }
        case 'and':
        case 'or':
            for (const k of node.kids) collectGeomSenses(k, out);
            break;
        case 'not':
            collectGeomSenses(node.kid, out);
            break;
        case 'cellcomp':
            break;
    }
    return out;
}

function collectGeomCellRefs(node: RegionNode | null, out = new Set<number>()): Set<number> {
    if (!node) return out;
    switch (node.op) {
        case 'cellcomp':
            out.add(node.cell);
            break;
        case 'and':
        case 'or':
            for (const k of node.kids) collectGeomCellRefs(k, out);
            break;
        case 'not':
            collectGeomCellRefs(node.kid, out);
            break;
        case 'halfspace':
            break;
    }
    return out;
}

function fillTargets(cell: McnpCell): Map<number, number> {
    const out = new Map<number, number>();
    if (cell.fill?.grid) {
        for (const e of cell.fill.grid.entries) {
            out.set(e.universe, (out.get(e.universe) ?? 0) + 1);
        }
    }
    if (cell.fill?.universe != null && !out.has(cell.fill.universe)) {
        out.set(cell.fill.universe, 1);
    }
    return out;
}

function classifyRole(cell: McnpCell): CellRole {
    if (cell.lat) return 'lattice';
    if (cell.fill) return 'container';
    if (cell.material === 0) return 'void';
    return 'material';
}

type DeckCell = McnpCell & { universe: number };

function universeDepths(
    cellsByUniverse: Map<number, McnpCell[]>,
): { depths: Map<number, number>; cycle: number[] } {
    const depths = new Map<number, number>([[ROOT_UNIVERSE, 0]]);
    const cycle: number[] = [];
    const onPath = new Set<number>();

    const walk = (uid: number, depth: number) => {
        if (onPath.has(uid)) {
            if (!cycle.includes(uid)) cycle.push(uid);
            return;
        }
        onPath.add(uid);
        for (const cell of cellsByUniverse.get(uid) ?? []) {
            for (const child of fillTargets(cell).keys()) {
                const known = depths.get(child);
                if (known === undefined || depth + 1 < known) {
                    depths.set(child, depth + 1);
                    walk(child, depth + 1);
                } else if (onPath.has(child)) {
                    walk(child, depth + 1);
                }
            }
        }
        onPath.delete(uid);
    };
    walk(ROOT_UNIVERSE, 0);
    let maxReached = 0;
    for (const d of depths.values()) maxReached = Math.max(maxReached, d);
    for (const uid of cellsByUniverse.keys()) {
        if (!depths.has(uid)) depths.set(uid, maxReached + 1);
    }
    return { depths, cycle };
}

/**
 * Build the same graph `buildCellMap` produces, from a parsed geometry model.
 * Line numbers are unknown (the geometry parsers drop them), so click-to-reveal
 * searches the source instead of jumping to a stored span.
 */
export function buildCellMapFromGeometry(
    geom: McnpGeometryModel,
    language: CellMapModel['language'],
): CellMapModel {
    const warnings = [...geom.warnings];
    const cellsList = [...geom.cells.values()];
    const cellIds = new Set(cellsList.map((c) => c.id));
    const definedSurfaces = new Set(geom.surfaces.keys());

    const cellsByUniverse = new Map<number, DeckCell[]>();
    for (const cell of cellsList) {
        const uid = cell.universe ?? ROOT_UNIVERSE;
        const list = cellsByUniverse.get(uid) ?? [];
        list.push(cell);
        cellsByUniverse.set(uid, list);
    }

    const { depths, cycle } = universeDepths(cellsByUniverse);
    if (cycle.length) {
        warnings.push(
            `Universe fill cycle through ${cycle.map((u) => `u=${u}`).join(' → ')}.`,
        );
    }

    const senseMap = new Map<number, Map<number, Set<1 | -1>>>();
    for (const cell of cellsList) senseMap.set(cell.id, collectGeomSenses(cell.region));

    const MAX_NEIGHBORS = 12;
    const bySurface = new Map<string, { inside: number[]; outside: number[] }>();
    for (const cell of cellsList) {
        const uni = cell.universe ?? ROOT_UNIVERSE;
        for (const [surf, ss] of senseMap.get(cell.id) ?? []) {
            const key = `${uni}:${surf}`;
            const bucket = bySurface.get(key) ?? { inside: [], outside: [] };
            if (ss.has(-1)) bucket.inside.push(cell.id);
            if (ss.has(1)) bucket.outside.push(cell.id);
            bySurface.set(key, bucket);
        }
    }
    const neighborSets = new Map<number, Set<number>>();
    const addN = (a: number, b: number) => {
        if (a === b) return;
        const set = neighborSets.get(a) ?? new Set<number>();
        if (set.size < MAX_NEIGHBORS) set.add(b);
        neighborSets.set(a, set);
    };
    for (const { inside, outside } of bySurface.values()) {
        if (inside.length > MAX_NEIGHBORS || outside.length > MAX_NEIGHBORS) continue;
        for (const a of inside) for (const b of outside) { addN(a, b); addN(b, a); }
    }

    const edges: CellEdge[] = [];
    const filledBy = new Map<number, number[]>();

    const cells: CellNode[] = cellsList.map((cell) => {
        const universe = cell.universe ?? ROOT_UNIVERSE;
        const surfaces: SurfaceRef[] = [...(senseMap.get(cell.id) ?? [])]
            .sort((a, b) => a[0] - b[0])
            .map(([id, ss]) => {
                const surf = geom.surfaces.get(id);
                const ref: SurfaceRef = {
                    id,
                    sense: senseSymbol(ss),
                    summary: surf ? surf.mnemonic : '',
                };
                if (!definedSurfaces.has(id)) ref.undefined = true;
                return ref;
            });

        const complements = [...collectGeomCellRefs(cell.region)].sort((a, b) => a - b);
        for (const target of complements) {
            edges.push({ kind: 'complement', from: cell.id, to: target });
            if (!cellIds.has(target)) {
                warnings.push(`Cell ${cell.id} complements #${target}, which no cell defines.`);
            }
        }

        const targets = fillTargets(cell);
        for (const [uid, count] of targets) {
            const edge: CellEdge = { kind: 'fill', from: cell.id, to: uid };
            if (cell.fill?.grid) { edge.count = count; edge.lattice = true; }
            edges.push(edge);
            const parents = filledBy.get(uid) ?? [];
            parents.push(cell.id);
            filledBy.set(uid, parents);
            if (!cellsByUniverse.has(uid)) {
                warnings.push(`Cell ${cell.id} fills with u=${uid}, but no cell declares that universe.`);
            }
        }

        const regionRaw = surfaces.map((s) => `${s.sense === '+/-' ? '±' : s.sense}${s.id}`).join(' ');
        return {
            id: cell.id,
            line: 0,
            role: classifyRole(cell),
            universe,
            depth: depths.get(universe) ?? 0,
            material: cell.material,
            materialLabel: cell.material === 0 ? 'void' : `m${cell.material}`,
            density: cell.density,
            densityUnit:
                cell.density === null ? null : cell.density < 0 ? 'g/cm3' : 'atom/b-cm',
            temperatureK: null,
            importanceZero: false,
            lattice: cell.lat,
            hasTrcl: cell.trcl !== null,
            summary: '',
            regionRaw,
            regionError: null,
            surfaces,
            complements,
            neighbors: [...(neighborSets.get(cell.id) ?? [])].sort((a, b) => a - b),
        };
    });

    const universes: UniverseNode[] = [...cellsByUniverse.keys()]
        .sort((a, b) => (depths.get(a) ?? 0) - (depths.get(b) ?? 0) || a - b)
        .map((id) => {
            const parents = filledBy.get(id) ?? [];
            return {
                id,
                depth: depths.get(id) ?? 0,
                summary: '',
                cells: (cellsByUniverse.get(id) ?? []).map((c) => c.id),
                filledBy: [...new Set(parents)].sort((a, b) => a - b),
                orphan: id !== ROOT_UNIVERSE && parents.length === 0,
            };
        });

    for (const u of universes) {
        if (u.orphan) {
            warnings.push(`Universe ${u.id} is defined by ${u.cells.length} cell(s) but nothing fills it.`);
        }
    }

    return {
        language,
        cells,
        universes,
        edges,
        warnings,
        stats: {
            cells: cells.length,
            universes: universes.length,
            maxDepth: universes.reduce((m, u) => Math.max(m, u.depth), 0),
            graveyards: 0,
        },
    };
}
