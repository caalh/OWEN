// Cell Map — the graph behind OWEN's MCNP cell flowchart.
//
// An MCNP deck is a flat list of cells, but the thing it describes is a tree:
// universe 0 holds the real world, a cell with `fill=` hands its interior to
// another universe, and a `lat=` cell tiles one. Reading that structure off the
// cards is the tedious part of picking up someone else's deck, so this module
// does it once and hands the panel a graph.
//
// Cells are the nodes. Surfaces and materials are attributes of a cell, not
// nodes of their own — a full bipartite cell/surface graph is unreadable past
// about thirty cells, and a professional already knows what `-1 2 -3` means;
// what they do not know is which universe cell 1 lives in and who fills it.
//
// No `vscode` import: this is unit tested headlessly, and `panel.ts` is the
// only part that talks to the editor.

import {
    parseMcnpDeck,
    regionCellRefs,
    type McnpCell,
    type RegionNode,
} from '../converter/mcnpModel';
import {
    buildMcnpReferenceIndex,
    getDefinition,
    type McnpReferenceIndex,
} from '../references/mcnpReferences';

/** Root universe id. MCNP writes cells with no `u=` into universe 0. */
export const ROOT_UNIVERSE = 0;

/**
 * The one thing a cell mainly is, for colour and grouping. A cell can be
 * several at once (a lattice cell is also a container); precedence runs
 * graveyard → lattice → container → void → material, chosen so the label
 * answers "why is this cell here" rather than "what is in it".
 */
export type CellRole = 'graveyard' | 'lattice' | 'container' | 'void' | 'material';

export interface SurfaceRef {
    id: number;
    /** How the region uses it: inside, outside, or both (a `:` union spanning it). */
    sense: '-' | '+' | '+/-';
    /** `cz 0.4096` from the reference index, or empty when the card is missing. */
    summary: string;
    /** True when no surface card defines this id — a broken deck, worth showing. */
    undefined?: boolean;
}

export interface CellNode {
    id: number;
    /** 0-based line of the cell card. */
    line: number;
    role: CellRole;
    universe: number;
    /** Nesting depth of this cell's universe; 0 for the root universe. */
    depth: number;
    material: number;
    materialLabel: string;
    density: number | null;
    /** MCNP sign convention: negative density is g/cm3, positive is atoms/b-cm. */
    densityUnit: 'g/cm3' | 'atom/b-cm' | null;
    temperatureK: number | null;
    importanceZero: boolean;
    /** 0 none, 1 square/hex-in-square (`lat=1`), 2 hexagonal (`lat=2`). */
    lattice: 0 | 1 | 2;
    hasTrcl: boolean;
    summary: string;
    regionRaw: string;
    regionError: string | null;
    surfaces: SurfaceRef[];
    /** Cells this one subtracts with `#n`. */
    complements: number[];
    /** Cells sharing a bounding surface with the opposite sense, same universe. */
    neighbors: number[];
}

export interface UniverseNode {
    id: number;
    depth: number;
    /** `fuel pin`, `lattice universe`, … from the reference index. */
    summary: string;
    /** Cell ids declared with this `u=`, in deck order. */
    cells: number[];
    /** Cells whose `fill=` points here. */
    filledBy: number[];
    /** True when nothing fills it and it is not the root — dead input. */
    orphan: boolean;
}

export interface CellEdge {
    /** `fill` runs cell → universe; `complement` runs cell → cell. */
    kind: 'fill' | 'complement';
    from: number;
    to: number;
    /** Lattice placements of `to` inside `from`; undefined for a single fill. */
    count?: number;
    /** True when the fill came from a `lat=` array rather than a scalar `fill=`. */
    lattice?: boolean;
}

export interface CellMapModel {
    cells: CellNode[];
    universes: UniverseNode[];
    edges: CellEdge[];
    warnings: string[];
    stats: {
        cells: number;
        universes: number;
        maxDepth: number;
        /** Cells with `imp:n=0`. A deck with none cannot terminate histories. */
        graveyards: number;
    };
}

// ---------------------------------------------------------------------------
// Region walking
// ---------------------------------------------------------------------------

/**
 * Surface ids with the sense the cell uses them at. `regionSurfaces` in the
 * converter throws the sense away, and the sense is exactly what tells you
 * whether the cell is inside or outside a given surface — which is the whole
 * point of drawing the thing.
 */
export function collectSurfaceSenses(
    node: RegionNode | null,
    out = new Map<number, Set<1 | -1>>(),
): Map<number, Set<1 | -1>> {
    if (!node) return out;
    switch (node.kind) {
        case 'half': {
            const set = out.get(node.surface) ?? new Set<1 | -1>();
            set.add(node.sense);
            out.set(node.surface, set);
            break;
        }
        case 'and':
        case 'or':
            for (const c of node.children) collectSurfaceSenses(c, out);
            break;
        case 'comp':
            collectSurfaceSenses(node.child, out);
            break;
        case 'cellcomp':
            break;
    }
    return out;
}

function senseSymbol(senses: Set<1 | -1>): SurfaceRef['sense'] {
    if (senses.size > 1) return '+/-';
    return senses.has(-1) ? '-' : '+';
}

function classifyRole(cell: McnpCell): CellRole {
    if (cell.importanceZero) return 'graveyard';
    if (cell.lattice) return 'lattice';
    if (cell.fillUniverse !== null || cell.latticeFill) return 'container';
    if (cell.matId === 0) return 'void';
    return 'material';
}

/** Distinct fill universes and their placement counts, scalar or lattice array. */
function fillTargets(cell: McnpCell): Map<number, number> {
    const out = new Map<number, number>();
    if (cell.latticeFill) {
        for (const u of cell.latticeFill.universes) {
            out.set(u, (out.get(u) ?? 0) + 1);
        }
    }
    if (cell.fillUniverse !== null && !out.has(cell.fillUniverse)) {
        out.set(cell.fillUniverse, 1);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Depth
// ---------------------------------------------------------------------------

/**
 * Depth of every universe, walking down from the root. A universe reached by
 * more than one path gets the shallowest depth, which keeps the drawing wide
 * rather than deep. Cycles are impossible in valid MCNP but perfectly typable,
 * so the walk is guarded by a visited set instead of trusting the input.
 */
export function computeUniverseDepths(
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

    // Universes never reached from the root still need a depth so they can be
    // drawn; park them one below the deepest thing that is reachable.
    let maxReached = 0;
    for (const d of depths.values()) maxReached = Math.max(maxReached, d);
    for (const uid of cellsByUniverse.keys()) {
        if (!depths.has(uid)) depths.set(uid, maxReached + 1);
    }
    return { depths, cycle };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * Cells that share a surface with the opposite sense, within one universe —
 * "what is on the other side of this wall". Capped per cell because a deck with
 * one big outer sphere would otherwise make every cell a neighbour of every
 * other and the readout would say nothing.
 */
const MAX_NEIGHBORS = 12;

function computeNeighbors(
    cells: McnpCell[],
    senses: Map<number, Map<number, Set<1 | -1>>>,
): Map<number, number[]> {
    const bySurface = new Map<string, { inside: number[]; outside: number[] }>();
    for (const cell of cells) {
        const uni = cell.universe ?? ROOT_UNIVERSE;
        for (const [surf, ss] of senses.get(cell.id) ?? []) {
            const key = `${uni}:${surf}`;
            const bucket = bySurface.get(key) ?? { inside: [], outside: [] };
            if (ss.has(-1)) bucket.inside.push(cell.id);
            if (ss.has(1)) bucket.outside.push(cell.id);
            bySurface.set(key, bucket);
        }
    }

    const out = new Map<number, Set<number>>();
    const add = (a: number, b: number) => {
        if (a === b) return;
        const set = out.get(a) ?? new Set<number>();
        if (set.size < MAX_NEIGHBORS) set.add(b);
        out.set(a, set);
    };
    for (const { inside, outside } of bySurface.values()) {
        // A surface every cell in the universe touches says nothing about
        // adjacency; it is the problem boundary, not a wall between two cells.
        if (inside.length > MAX_NEIGHBORS || outside.length > MAX_NEIGHBORS) continue;
        for (const a of inside) for (const b of outside) { add(a, b); add(b, a); }
    }
    return new Map([...out].map(([k, v]) => [k, [...v].sort((a, b) => a - b)]));
}

export function buildCellMap(text: string): CellMapModel {
    const deck = parseMcnpDeck(text);
    const index: McnpReferenceIndex = buildMcnpReferenceIndex(text);
    const warnings: string[] = [];

    const definedSurfaces = new Set(deck.surfaces.map((s) => s.id));
    const cellIds = new Set(deck.cells.map((c) => c.id));

    const cellsByUniverse = new Map<number, McnpCell[]>();
    for (const cell of deck.cells) {
        const uid = cell.universe ?? ROOT_UNIVERSE;
        const list = cellsByUniverse.get(uid) ?? [];
        list.push(cell);
        cellsByUniverse.set(uid, list);
    }

    const { depths, cycle } = computeUniverseDepths(cellsByUniverse);
    if (cycle.length) {
        warnings.push(
            `Universe fill cycle through ${cycle.map((u) => `u=${u}`).join(' → ')}. ` +
            'MCNP cannot resolve a universe that fills itself.',
        );
    }

    const senseMap = new Map<number, Map<number, Set<1 | -1>>>();
    for (const cell of deck.cells) senseMap.set(cell.id, collectSurfaceSenses(cell.region));
    const neighbors = computeNeighbors(deck.cells, senseMap);

    const edges: CellEdge[] = [];
    const filledBy = new Map<number, number[]>();

    const cells: CellNode[] = deck.cells.map((cell) => {
        const universe = cell.universe ?? ROOT_UNIVERSE;
        const surfaces: SurfaceRef[] = [...(senseMap.get(cell.id) ?? [])]
            .sort((a, b) => a[0] - b[0])
            .map(([id, ss]) => {
                const def = getDefinition(index, 'surface', id);
                const ref: SurfaceRef = { id, sense: senseSymbol(ss), summary: def?.summary ?? '' };
                if (!definedSurfaces.has(id)) ref.undefined = true;
                return ref;
            });

        const complements = [...regionCellRefs(cell.region)].sort((a, b) => a - b);
        for (const target of complements) {
            edges.push({ kind: 'complement', from: cell.id, to: target });
            if (!cellIds.has(target)) {
                warnings.push(`Cell ${cell.id} complements #${target}, which no cell card defines.`);
            }
        }

        const targets = fillTargets(cell);
        for (const [uid, count] of targets) {
            const edge: CellEdge = { kind: 'fill', from: cell.id, to: uid };
            if (cell.latticeFill) { edge.count = count; edge.lattice = true; }
            edges.push(edge);
            const parents = filledBy.get(uid) ?? [];
            parents.push(cell.id);
            filledBy.set(uid, parents);
            if (!cellsByUniverse.has(uid)) {
                warnings.push(`Cell ${cell.id} fills with u=${uid}, but no cell declares that universe.`);
            }
        }

        if (cell.regionError) {
            warnings.push(`Cell ${cell.id}: ${cell.regionError}`);
        }

        const matDef = cell.matId === 0 ? null : getDefinition(index, 'material', cell.matId);
        return {
            id: cell.id,
            line: cell.line,
            role: classifyRole(cell),
            universe,
            depth: depths.get(universe) ?? 0,
            material: cell.matId,
            materialLabel: cell.matId === 0 ? 'void' : (matDef?.summary || `m${cell.matId}`),
            density: cell.density,
            densityUnit:
                cell.density === null ? null : cell.density < 0 ? 'g/cm3' : 'atom/b-cm',
            temperatureK: cell.temperatureK,
            importanceZero: cell.importanceZero,
            lattice: (cell.lattice ?? 0) as 0 | 1 | 2,
            hasTrcl: cell.trcl !== null,
            summary: getDefinition(index, 'cell', cell.id)?.summary ?? '',
            regionRaw: cell.regionRaw,
            regionError: cell.regionError,
            surfaces,
            complements,
            neighbors: neighbors.get(cell.id) ?? [],
        };
    });

    const universes: UniverseNode[] = [...cellsByUniverse.keys()]
        .sort((a, b) => (depths.get(a) ?? 0) - (depths.get(b) ?? 0) || a - b)
        .map((id) => {
            const parents = filledBy.get(id) ?? [];
            return {
                id,
                depth: depths.get(id) ?? 0,
                summary: getDefinition(index, 'universe', id)?.summary ?? '',
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

    const graveyards = cells.filter((c) => c.importanceZero).length;
    if (deck.cells.length && graveyards === 0) {
        warnings.push(
            'No cell has imp:n=0. MCNP needs a zero-importance cell covering the outside world, ' +
            'or histories never terminate.',
        );
    }

    return {
        cells,
        universes,
        edges,
        warnings,
        stats: {
            cells: cells.length,
            universes: universes.length,
            maxDepth: universes.reduce((m, u) => Math.max(m, u.depth), 0),
            graveyards,
        },
    };
}
