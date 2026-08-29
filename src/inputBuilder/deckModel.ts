/**
 * Section model for the OWEN Input Builder.
 *
 * The builder used to be one wizard that emitted a fixed starter deck: pick a
 * code, pick materials, pick pin-cell or lattice, get a string. You could not
 * add a second lattice, could not see which control wrote which card, and the
 * only feedback was the language rules run over the finished text.
 *
 * This module makes a deck a *list of sections*. Each section emits card-image
 * fragments tagged with the deck region they belong to, an assembler puts the
 * regions in the order each code requires, and the assembler records which
 * section produced each output line so the UI can show the deck and the
 * controls side by side.
 *
 * Headless: no vscode, no DOM. The panel calls `buildDeckDocument` on every
 * edit and posts the result to the webview.
 */

import type { MonteCarloCode, SelectedMaterial } from './materials';
import { MATERIAL_LIBRARY, renderMaterial } from './materials';
import type { PnnlMaterial } from './pnnlCards';
import {
    cellWizardCard,
    materialWizardCard,
    surfaceWizardCard,
    type CellWizardInput,
    type MaterialComponent,
    type MaterialWizardInput,
    type SurfaceWizardInput,
} from './wizards';
import {
    genMCNP,
    genOpenMC,
    genSerpent,
    genSCONE,
    type LatticeSpec,
    type PinTypeIds,
    type StructuralIds,
} from '../panels/latticeCodegen';

// ---------------------------------------------------------------------------
// Regions
// ---------------------------------------------------------------------------

/**
 * Where a fragment belongs in the finished deck. Regions are code-independent;
 * each assembler decides the order and any block nesting (SCONE wraps
 * surfaces / cells / universes inside `geometry { … }`, MCNP separates the cell
 * and surface blocks with a blank line, and so on).
 */
export type DeckRegion =
    | 'title'
    | 'materials'
    | 'surfaces'
    | 'cells'
    | 'universes'
    | 'settings'
    | 'tallies'
    | 'trailer';

export type Fragments = Partial<Record<DeckRegion, string[]>>;

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export type SectionKind =
    | 'materials'
    | 'pincell'
    | 'lattice'
    | 'boundary'
    | 'run'
    | 'tally'
    | 'surface'
    | 'cell'
    | 'custom';

export interface SectionCommon {
    id: string;
    label?: string;
    /** Disabled sections stay in the list but emit nothing. */
    enabled?: boolean;
}

/** One material in a materials section: library entry, PNNL entry, or hand-entered. */
export interface MaterialChoice {
    /** Stable key geometry sections use to refer to this material. */
    key: string;
    source: 'library' | 'pnnl' | 'custom';
    libraryId?: string;
    pnnl?: PnnlMaterial;
    custom?: {
        name: string;
        density: number;
        /** `weight` → g/cm³ (negative on an MCNP cell card); `atom` → atoms/b·cm. */
        densityMode: 'weight' | 'atom';
        fractionMode: 'weight' | 'atom';
        components: MaterialComponent[];
        sab?: string;
        suffix?: string;
    };
    /** Explicit MCNP m-number; auto-allocated when omitted. */
    mcnpNumber?: number;
    /** Kelvin, for SCONE `temp` and OpenMC `temperature`. */
    temperature?: number;
}

export interface MaterialsSection extends SectionCommon {
    kind: 'materials';
    entries: MaterialChoice[];
}

/** One concentric shell of a pin: material key + outer radius (cm). */
export interface PinLayer {
    material: string;
    outerRadius: number;
}

export interface PinCellSection extends SectionCommon {
    kind: 'pincell';
    name: string;
    layers: PinLayer[];
    /** Material filling the square cell outside the outermost radius. */
    outerMaterial: string;
    pitch: number;
    zMin: number;
    zMax: number;
    /** Set when this pin is a lattice element rather than a standalone deck. */
    universe?: number;
    /** Reflective faces make a standalone pin cell an infinite-lattice k∞ model. */
    reflective?: boolean;
}

export interface LatticePin {
    /** Palette id painted into the grid. */
    id: number;
    label: string;
    /** MCNP universe / SCONE map id for this palette entry. */
    universe: number;
    /** Pin-cell section this palette entry draws its geometry from. */
    pincellId?: string;
}

export interface LatticeSection extends SectionCommon {
    kind: 'lattice';
    nx: number;
    ny: number;
    pitch: number;
    /** grid[row][col] = palette id. */
    grid: number[][];
    pins: LatticePin[];
    latticeCell?: number;
    latticeUniverse?: number;
}

export interface BoundarySection extends SectionCommon {
    kind: 'boundary';
    shape: 'box' | 'cylinder' | 'sphere';
    /** Half-width for a box, radius for a cylinder or sphere (cm). */
    size: number;
    zMin: number;
    zMax: number;
    bc: 'vacuum' | 'reflective' | 'white';
    /** Lattice section (or universe number) that fills the boundary. */
    fillLatticeId?: string;
    fillUniverse?: number;
}

export interface RunSection extends SectionCommon {
    kind: 'run';
    mode: 'eigenvalue' | 'fixed';
    particles: number;
    inactive: number;
    active: number;
    keffGuess: number;
    /** Eigenvalue start point / fixed source point (cm). */
    source: [number, number, number];
    threads?: number;
    seed?: number;
}

export interface TallySection extends SectionCommon {
    kind: 'tally';
    quantity: 'flux' | 'fission' | 'spectrum' | 'heating';
    /** Cell ids (MCNP / Serpent) or cell names (OpenMC / SCONE). */
    cells: number[];
    /** Equal-lethargy bin count for a spectrum tally. */
    energyBins?: number;
    /** MCNP `sd` divisor — required for tallies in repeated structures. */
    sd?: number;
}

export interface SurfaceSection extends SectionCommon {
    kind: 'surface';
    spec: Omit<SurfaceWizardInput, 'code'>;
}

export interface CellSection extends SectionCommon {
    kind: 'cell';
    spec: Omit<CellWizardInput, 'code'>;
}

export interface CustomSection extends SectionCommon {
    kind: 'custom';
    region: DeckRegion;
    text: string;
}

export type DeckSection =
    | MaterialsSection
    | PinCellSection
    | LatticeSection
    | BoundarySection
    | RunSection
    | TallySection
    | SurfaceSection
    | CellSection
    | CustomSection;

export interface DeckModel {
    code: MonteCarloCode;
    title: string;
    sections: DeckSection[];
    /** MCNP card-image width the checks hold lines to (80 or 128). */
    lineLimit?: number;
}

// ---------------------------------------------------------------------------
// Identifier allocation
// ---------------------------------------------------------------------------

export type IdKind = 'cell' | 'surface' | 'material' | 'universe';

const ID_START: Record<IdKind, number> = { cell: 10, surface: 1, material: 1, universe: 1 };

/**
 * Hands out deck identifiers so two sections never collide. Explicit ids are
 * reserved in a first pass, then automatic ids fill the gaps — which is what
 * makes "add another lattice" safe: the second lattice cannot silently reuse
 * the first one's universe or surface numbers.
 */
export class IdAllocator {
    private readonly used: Record<IdKind, Set<number>> = {
        cell: new Set(), surface: new Set(), material: new Set(), universe: new Set(),
    };
    private readonly cursor: Record<IdKind, number> = { ...ID_START };

    reserve(kind: IdKind, id: number | undefined): void {
        if (id === undefined || !Number.isFinite(id) || id <= 0) return;
        this.used[kind].add(Math.floor(id));
    }

    next(kind: IdKind): number {
        let id = this.cursor[kind];
        while (this.used[kind].has(id)) id++;
        this.used[kind].add(id);
        this.cursor[kind] = id + 1;
        return id;
    }

    /** Explicit id when given and free, otherwise the next automatic one. */
    take(kind: IdKind, id: number | undefined): number {
        if (id !== undefined && Number.isFinite(id) && id > 0) {
            const want = Math.floor(id);
            // Claiming it matters: two sections carrying the same saved id (the
            // usual result of duplicating a section) would otherwise both write
            // it, and a repeated cell or surface number is a fatal MCNP error.
            if (!this.used[kind].has(want)) {
                this.used[kind].add(want);
                return want;
            }
        }
        return this.next(kind);
    }

    isTaken(kind: IdKind, id: number): boolean {
        return this.used[kind].has(id);
    }
}

// ---------------------------------------------------------------------------
// Material bindings
// ---------------------------------------------------------------------------

/** A material as every code needs to name it, plus what a cell card needs. */
export interface MaterialBinding {
    key: string;
    label: string;
    mcnpNumber: number;
    openmcVar: string;
    serpentName: string;
    sconeName: string;
    /** Density magnitude in the unit `densityUnit` describes. */
    density: number;
    densityUnit: 'g/cm3' | 'atom/b-cm';
    sectionId: string;
    /** The card as the generator wrote it, so it is emitted exactly once. */
    card: string[];
}

/**
 * The identifier a rendered material card actually declares.
 *
 * Reading it back out of the card is the only way geometry references stay
 * correct: the curated library, the PNNL compendium and the custom-composition
 * wizard each name a material differently (`mat uo2_1`, `mat_pnnl_concrete`,
 * `water3`), and a reference derived independently from the display label —
 * which is what the builder did before — silently pointed at nothing.
 */
export function declaredMaterialName(code: MonteCarloCode, card: string): string | undefined {
    if (code === 'openmc') return /^\s*(\w+)\s*=\s*openmc\.Material/m.exec(card)?.[1];
    if (code === 'serpent') return /^\s*mat\s+(\S+)/m.exec(card)?.[1];
    if (code === 'scone') return /^\s*([A-Za-z_]\w*)\s*\{/m.exec(card)?.[1];
    return /^\s*m(\d+)/m.exec(card)?.[1];
}

/**
 * Retune a SCONE material block to a requested temperature: `temp` and the
 * ZAID suffixes have to agree (`temp 600` needs `.06` data), so changing one
 * without the other is the most common way a SCONE deck fails to load.
 */
export function applySconeTemperature(card: string, tempK: number): string {
    const suffix = String(Math.round(tempK / 100)).padStart(2, '0');
    return card
        .replace(/\btemp\s+\d+(?:\.\d+)?/g, `temp ${Math.round(tempK)}`)
        .replace(/(\b\d{4,6})\.\d\d\b/g, `$1.${suffix}`);
}

export function slug(text: string): string {
    const s = text.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return s.length ? s : 'mat';
}

function libraryEntry(id: string | undefined) {
    return MATERIAL_LIBRARY.find((m) => m.id === id);
}

/** MCNP cell-card density: negative for g/cm³, positive for atoms/b·cm. */
export function cellDensity(b: MaterialBinding): string {
    const v = b.densityUnit === 'g/cm3' ? -Math.abs(b.density) : Math.abs(b.density);
    return String(Number(v.toPrecision(6)));
}

/** The material card text, from the wizard for custom entries and the library otherwise. */
function renderMaterialCard(code: MonteCarloCode, entry: MaterialChoice, b: MaterialBinding): string {
    if (entry.source === 'custom' && entry.custom) {
        const input: MaterialWizardInput = {
            code,
            matNumber: b.mcnpNumber,
            name: entry.custom.name || b.label,
            densityMode: entry.custom.densityMode,
            density: entry.custom.density,
            fractionMode: entry.custom.fractionMode,
            components: entry.custom.components,
            sab: entry.custom.sab,
            suffix: entry.custom.suffix,
        };
        return materialWizardCard(input);
    }
    return renderMaterial(code, toSelected(entry, b));
}

/**
 * Make a material card's declared names unique within the deck.
 *
 * The card generators name a material after its composition, not after its slot
 * in the deck, so two entries built from the same library material (a moderator
 * and a reflector, both light water) declare the same `mat light_water` and the
 * same `therm lwtr` — the second definition either overwrites the first or is a
 * duplicate-definition error, and geometry that meant to point at one gets the
 * other. MCNP is exempt: its cards are numbered, and the numbers come from the
 * allocator.
 */
function uniquifyMaterialNames(
    code: MonteCarloCode,
    card: string,
    matNumber: number,
    used: Set<string>,
): string {
    if (code === 'mcnp') return card;
    let out = card;
    const declared = declaredMaterialName(code, out);
    if (declared) {
        let name = declared;
        if (used.has(name)) {
            name = `${declared}_${matNumber}`;
            const token = declared.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            out = out.replace(new RegExp(`(?<![\\w.-])${token}(?![\\w.-])`, 'g'), name);
        }
        used.add(name);
    }
    if (code === 'serpent') {
        // A `therm` name is a second namespace, and its table (`lwtr.20t`) must
        // survive the rename, so only the bare name is suffixed.
        out = out.replace(/\b(moder|therm)\s+([A-Za-z_]\w*)(?!\.)/g, `$1 $2_${matNumber}`);
    }
    return out;
}

function bindMaterials(model: DeckModel, alloc: IdAllocator): Map<string, MaterialBinding> {
    const out = new Map<string, MaterialBinding>();
    const declaredNames = new Set<string>();
    for (const section of enabledSections(model)) {
        if (section.kind !== 'materials') continue;
        for (const entry of section.entries) {
            if (out.has(entry.key)) continue;
            const lib = libraryEntry(entry.libraryId);
            const label = entry.custom?.name
                ?? entry.pnnl?.name
                ?? lib?.name
                ?? entry.key;
            const density = entry.custom?.density
                ?? entry.pnnl?.density
                ?? lib?.density
                ?? 1;
            const densityUnit: 'g/cm3' | 'atom/b-cm' = entry.custom
                ? (entry.custom.densityMode === 'atom' ? 'atom/b-cm' : 'g/cm3')
                : (lib?.densityUnit ?? 'g/cm3');
            const fallback = slug(label).toLowerCase();
            const mcnpNumber = alloc.take('material', entry.mcnpNumber);
            const binding: MaterialBinding = {
                key: entry.key,
                label,
                mcnpNumber,
                openmcVar: `mat_${fallback}`,
                serpentName: fallback,
                sconeName: slug(label),
                density,
                densityUnit,
                sectionId: section.id,
                card: [],
            };
            let card = renderMaterialCard(model.code, entry, binding);
            // The card generators write SCONE blocks at 300 K; the wizard writes
            // 600 K. One deck with two temperatures is legal and confusing, so
            // normalize every block to the entry's temperature, defaulting to
            // the reactor-ish 600 K the wizard has always used.
            if (model.code === 'scone') card = applySconeTemperature(card, entry.temperature ?? 600);
            card = uniquifyMaterialNames(model.code, card, mcnpNumber, declaredNames);
            const declared = declaredMaterialName(model.code, card);
            if (declared) {
                if (model.code === 'openmc') binding.openmcVar = declared;
                else if (model.code === 'serpent') binding.serpentName = declared;
                else if (model.code === 'scone') binding.sconeName = declared;
            }
            if (model.code === 'openmc' && entry.temperature) {
                card += `\n${binding.openmcVar}.temperature = ${entry.temperature}`;
            }
            binding.card = card.split('\n');
            out.set(entry.key, binding);
        }
    }
    return out;
}

/** The `SelectedMaterial` shape `renderMaterial` and the PNNL cards expect. */
function toSelected(entry: MaterialChoice, b: MaterialBinding): SelectedMaterial {
    const lib = libraryEntry(entry.libraryId);
    return {
        id: entry.libraryId ?? entry.key,
        name: b.label,
        category: lib?.category ?? 'other',
        density: b.density,
        densityUnit: b.densityUnit,
        description: lib?.description ?? '',
        mcnpNumber: b.mcnpNumber,
        customName: b.label,
        pnnl: entry.pnnl,
    };
}

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

interface EmitCtx {
    code: MonteCarloCode;
    alloc: IdAllocator;
    materials: Map<string, MaterialBinding>;
    /** Lattice section id → the universe number its fill uses. */
    latticeUniverses: Map<string, number>;
    /** Lattice section id → the OpenMC Python variable holding it. */
    latticeVars: Map<string, string>;
    /** Pin-cell section id → its universe number and per-code names. */
    pins: Map<string, { universe: number; name: string; layers: PinLayer[]; outerMaterial: string }>;
    /** Emission-order index per repeatable section kind (tally numbering). */
    counters: { tally: number };
    comment: (text: string) => string;
}

function commentFor(code: MonteCarloCode): (text: string) => string {
    if (code === 'mcnp') return (t) => `c ${t}`;
    if (code === 'openmc') return (t) => `# ${t}`;
    if (code === 'serpent') return (t) => `% ${t}`;
    return (t) => `// ${t}`;
}

function enabledSections(model: DeckModel): DeckSection[] {
    return model.sections.filter((s) => s.enabled !== false);
}

export function sectionLabel(section: DeckSection): string {
    if (section.label) return section.label;
    switch (section.kind) {
        case 'materials': return `Materials (${section.entries.length})`;
        case 'pincell': return `Pin cell — ${section.name}`;
        case 'lattice': return `Lattice ${section.nx}×${section.ny}`;
        case 'boundary': return `Boundary (${section.shape})`;
        case 'run': return section.mode === 'eigenvalue' ? 'Run — eigenvalue' : 'Run — fixed source';
        case 'tally': return `Tally — ${section.quantity}`;
        case 'surface': return `Surface ${section.spec.surfaceNumber}`;
        case 'cell': return `Cell ${section.spec.cellNumber}`;
        case 'custom': return `Custom (${section.region})`;
    }
}

/** Half-width of a square lattice about the origin (cm). */
export function latticeHalfSpan(lattice: Pick<LatticeSection, 'nx' | 'ny' | 'pitch'>): number {
    return Math.max(lattice.nx, lattice.ny) * lattice.pitch / 2;
}

function firstEnabledBoundary(sections: DeckSection[]): BoundarySection | undefined {
    return sections.find((s): s is BoundarySection => s.kind === 'boundary' && s.enabled !== false);
}

/**
 * Point the outer boundary at this lattice and grow the box so the map fits.
 *
 * The pin-cell starter deck fills universe 1 inside a 0.63 cm reflecting square.
 * Adding a 17×17 without this step writes a fill map that MCNP never transports.
 * Does not steal `fillLatticeId` from a boundary that already names a lattice.
 */
export function attachLatticeToBoundary(sections: DeckSection[], latticeId: string): void {
    const lat = sections.find((s): s is LatticeSection => s.id === latticeId && s.kind === 'lattice');
    if (!lat) return;
    const bound = firstEnabledBoundary(sections);
    if (!bound) return;
    const alreadyNamed = Boolean(bound.fillLatticeId);
    if (!alreadyNamed) {
        bound.fillLatticeId = latticeId;
        // The pin-cell default is fillUniverse 1. Leaving it set next to a
        // lattice fill shows "or fill universe 1" and is what used to emit fill=1.
        if (bound.fillUniverse === 1) bound.fillUniverse = undefined;
    }
    if (bound.fillLatticeId === latticeId) {
        syncBoundarySizeToLattice(bound, lat);
    }
}

/** Grow a boundary that is smaller than the lattice it fills. Does not shrink. */
export function syncBoundarySizeToLattice(boundary: BoundarySection, lattice: LatticeSection): void {
    if (boundary.shape === 'sphere') return;
    const span = latticeHalfSpan(lattice);
    if (boundary.size + 1e-9 < span) {
        boundary.size = Number(span.toFixed(4));
    }
}

/** After nx/ny/pitch change: grow every boundary that fills a lattice. */
export function syncFilledBoundaries(sections: DeckSection[]): void {
    for (const s of sections) {
        if (s.kind !== 'boundary' || s.enabled === false || !s.fillLatticeId) continue;
        const lat = sections.find((x): x is LatticeSection => x.id === s.fillLatticeId && x.kind === 'lattice');
        if (lat) syncBoundarySizeToLattice(s, lat);
    }
}

/** When the filled lattice is removed or muted, fill the next remaining lattice. */
export function retargetBoundariesAfterLatticeRemoved(sections: DeckSection[], removedId: string): void {
    const replacement = sections.find((s): s is LatticeSection => s.kind === 'lattice' && s.enabled !== false);
    for (const s of sections) {
        if (s.kind !== 'boundary' || s.fillLatticeId !== removedId) continue;
        s.fillLatticeId = undefined;
        if (replacement) attachLatticeToBoundary(sections, replacement.id);
    }
}

function emitMaterials(section: MaterialsSection, ctx: EmitCtx): Fragments {
    const lines: string[] = [];
    for (const entry of section.entries) {
        const b = ctx.materials.get(entry.key);
        if (!b) continue;
        lines.push(...b.card, '');
    }
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return { materials: lines };
}

function emitPinCell(section: PinCellSection, ctx: EmitCtx): Fragments {
    const layers = section.layers.filter((l) => l.outerRadius > 0);
    const outer = ctx.materials.get(section.outerMaterial);
    const half = section.pitch / 2;
    const surfaces: string[] = [];
    const cells: string[] = [];
    const universes: string[] = [];

    if (ctx.code === 'mcnp') {
        const radial = layers.map((l) => ({ layer: l, surf: ctx.alloc.next('surface') }));
        const box = [ctx.alloc.next('surface'), ctx.alloc.next('surface'), ctx.alloc.next('surface'), ctx.alloc.next('surface')];
        const zLo = ctx.alloc.next('surface');
        const zHi = ctx.alloc.next('surface');
        const star = section.reflective ? '*' : '';
        surfaces.push(ctx.comment(`${section.name} — pin surfaces`));
        for (const r of radial) surfaces.push(`${r.surf} cz ${r.layer.outerRadius}`);
        surfaces.push(
            `${star}${box[0]} px ${half}`,
            `${star}${box[1]} px -${half}`,
            `${star}${box[2]} py ${half}`,
            `${star}${box[3]} py -${half}`,
            `${star}${zLo} pz ${section.zMin}`,
            `${star}${zHi} pz ${section.zMax}`,
        );
        const u = section.universe !== undefined ? ` u=${section.universe}` : '';
        const zSpan = `${zLo} -${zHi}`;
        cells.push(ctx.comment(`${section.name} — pin cells`));
        radial.forEach((r, i) => {
            const b = ctx.materials.get(r.layer.material);
            const inner = i === 0 ? `-${r.surf}` : `${radial[i - 1].surf} -${r.surf}`;
            const id = ctx.alloc.next('cell');
            cells.push(b
                ? `${id} ${b.mcnpNumber} ${cellDensity(b)} ${inner} ${zSpan}${u} imp:n=1 $ ${b.label}`
                : `${id} 0 ${inner} ${zSpan}${u} imp:n=1 $ void (no material assigned)`);
        });
        const lastSurf = radial.length ? `${radial[radial.length - 1].surf}` : '';
        const modId = ctx.alloc.next('cell');
        const modRegion = `${lastSurf} -${box[0]} ${box[1]} -${box[2]} ${box[3]} ${zSpan}`.trim();
        cells.push(outer
            ? `${modId} ${outer.mcnpNumber} ${cellDensity(outer)} ${modRegion}${u} imp:n=1 $ ${outer.label}`
            : `${modId} 0 ${modRegion}${u} imp:n=1 $ void`);
        if (section.universe === undefined) {
            const outsideId = ctx.alloc.next('cell');
            cells.push(`${outsideId} 0 ${box[0]}:-${box[1]}:${box[2]}:-${box[3]}:-${zLo}:${zHi} imp:n=0 $ graveyard`);
        }
        ctx.pins.set(section.id, {
            universe: section.universe ?? 0,
            name: section.name,
            layers: section.layers,
            outerMaterial: section.outerMaterial,
        });
        return { surfaces, cells };
    }

    if (ctx.code === 'openmc') {
        const name = slug(section.name).toLowerCase();
        const bt = section.reflective ? ', boundary_type="reflective"' : '';
        surfaces.push(ctx.comment(`${section.name}`));
        layers.forEach((l, i) => surfaces.push(`${name}_s${i} = openmc.ZCylinder(r=${l.outerRadius})`));
        surfaces.push(`${name}_box = openmc.model.RectangularPrism(${section.pitch}, ${section.pitch}${bt})`);
        surfaces.push(`${name}_zlo = openmc.ZPlane(z0=${section.zMin}${bt})`);
        surfaces.push(`${name}_zhi = openmc.ZPlane(z0=${section.zMax}${bt})`);
        const axial = `& +${name}_zlo & -${name}_zhi`;
        const cellNames: string[] = [];
        layers.forEach((l, i) => {
            const b = ctx.materials.get(l.material);
            const region = i === 0 ? `-${name}_s0` : `+${name}_s${i - 1} & -${name}_s${i}`;
            const cn = `${name}_c${i}`;
            cellNames.push(cn);
            // Explicit ids: OpenMC hands out cell numbers in construction order,
            // and a tally CellFilter written by number has to match something.
            cells.push(`${cn} = openmc.Cell(cell_id=${ctx.alloc.next('cell')}, name="${l.material}", fill=${b ? b.openmcVar : 'None'}, region=${region} ${axial})`);
        });
        const last = layers.length ? `+${name}_s${layers.length - 1} & ` : '';
        const cn = `${name}_cmod`;
        cellNames.push(cn);
        cells.push(`${cn} = openmc.Cell(cell_id=${ctx.alloc.next('cell')}, name="moderator", fill=${outer ? outer.openmcVar : 'None'}, region=${last}-${name}_box ${axial})`);
        universes.push(`${name}_universe = openmc.Universe(name="${section.name}", cells=[${cellNames.join(', ')}])`);
        ctx.pins.set(section.id, {
            universe: section.universe ?? 0,
            name: `${name}_universe`,
            layers: section.layers,
            outerMaterial: section.outerMaterial,
        });
        return { surfaces, cells, universes };
    }

    if (ctx.code === 'serpent') {
        const name = slug(section.name).toLowerCase();
        universes.push(ctx.comment(`${section.name}`), `pin ${name}`);
        for (const l of layers) {
            const b = ctx.materials.get(l.material);
            universes.push(`${(b ? b.serpentName : 'void').padEnd(12)} ${l.outerRadius}`);
        }
        universes.push(outer ? outer.serpentName : 'void', '');
        ctx.pins.set(section.id, {
            universe: section.universe ?? 0,
            name,
            layers: section.layers,
            outerMaterial: section.outerMaterial,
        });
        return { universes };
    }

    // SCONE pinUniverse: radii ascending with a trailing 0.0, fills one longer.
    const id = section.universe ?? ctx.alloc.next('universe');
    const radii = [...layers.map((l) => String(l.outerRadius)), '0.0'];
    const fills = [
        ...layers.map((l) => ctx.materials.get(l.material)?.sconeName ?? 'void'),
        outer?.sconeName ?? 'void',
    ];
    universes.push(
        `${slug(section.name)} { id ${id}; type pinUniverse;`,
        `  radii (${radii.join(' ')});`,
        `  fills (${fills.join(' ')}); }`,
    );
    ctx.pins.set(section.id, {
        universe: id,
        name: slug(section.name),
        layers: section.layers,
        outerMaterial: section.outerMaterial,
    });
    return { universes };
}

/** A lattice section as the `LatticeSpec` the shared generators consume. */
export function toLatticeSpec(section: LatticeSection, ctx?: EmitCtx): LatticeSpec {
    const pins: PinTypeIds[] = section.pins.map((p) => {
        const pin = p.pincellId ? ctx?.pins.get(p.pincellId) : undefined;
        const layers = pin?.layers.filter((l) => l.outerRadius > 0) ?? [];
        const radii = layers.length ? [...layers.map((l) => String(l.outerRadius)), '0.0'].join(' ') : '0.0';
        const mods = ctx ? [...ctx.materials.values()] : [];
        const mod = (mods.find((b) => /water|coolant|moderator/i.test(b.label)) ?? mods[0])?.sconeName ?? 'water';
        const fills = layers.length
            ? [...layers.map((l) => ctx?.materials.get(l.material)?.sconeName ?? 'void'),
                ctx?.materials.get(pin?.outerMaterial ?? '')?.sconeName ?? mod].join(' ')
            : mod;
        const name = slug(p.label);
        return {
            id: p.id,
            label: p.label,
            mcnpUniverse: p.universe,
            openmcName: pin && ctx?.code === 'openmc' ? pin.name : `${name.toLowerCase()}_universe`,
            serpentName: pin && ctx?.code === 'serpent' ? pin.name : name.toLowerCase(),
            sconeName: pin && ctx?.code === 'scone' ? pin.name : name,
            sconeId: pin?.universe || p.universe,
            sconeRadii: radii,
            sconeFills: fills,
        };
    });
    const structural: StructuralIds = {
        mcnpCell: section.latticeCell ?? 900,
        mcnpLatticeUniverse: section.latticeUniverse ?? 10,
        mcnpSurf: [901, 902, 903, 904],
        serpentLatId: section.latticeUniverse ?? 100,
        openmcLatName: slug(section.label ?? `lattice_${section.nx}x${section.ny}`).toLowerCase(),
        sconeLatName: slug(section.label ?? 'latCore'),
        sconeLatId: section.latticeUniverse ?? 200,
    };
    return {
        gridSize: Math.max(section.nx, section.ny),
        pitch: section.pitch,
        grid: section.grid,
        pins,
        structural,
    };
}

function emitLattice(section: LatticeSection, ctx: EmitCtx): Fragments {
    const spec = toLatticeSpec(section, ctx);
    if (ctx.code === 'mcnp') {
        // Surface numbers for the unit cell come from the allocator so a second
        // lattice does not reuse the first one's planes.
        const surf: [number, number, number, number] = [
            ctx.alloc.next('surface'), ctx.alloc.next('surface'),
            ctx.alloc.next('surface'), ctx.alloc.next('surface'),
        ];
        spec.structural.mcnpSurf = surf;
        spec.structural.mcnpCell = ctx.alloc.take('cell', section.latticeCell);
        spec.structural.mcnpLatticeUniverse = ctx.alloc.take('universe', section.latticeUniverse);
        ctx.latticeUniverses.set(section.id, spec.structural.mcnpLatticeUniverse);
        const text = genMCNP(spec).split('\n');
        const cutIdx = text.findIndex((l) => /^\d+\s+px/.test(l.trim()));
        const cells = cutIdx > 0 ? text.slice(0, cutIdx).filter((l) => !/^c\s*$/.test(l)) : text;
        const surfaces = cutIdx > 0 ? text.slice(cutIdx) : [];
        return { cells, surfaces };
    }
    if (ctx.code === 'openmc') {
        ctx.latticeUniverses.set(section.id, section.latticeUniverse ?? 0);
        ctx.latticeVars.set(section.id, spec.structural.openmcLatName);
        return { universes: genOpenMC(spec).split('\n') };
    }
    if (ctx.code === 'serpent') {
        ctx.latticeUniverses.set(section.id, spec.structural.serpentLatId);
        return { universes: genSerpent(spec).split('\n') };
    }
    ctx.latticeUniverses.set(section.id, spec.structural.sconeLatId);
    // The SCONE generator also emits pinUniverse stubs; drop them when the deck
    // already has real pin-cell sections for those palette entries.
    const linked = section.pins.some((p) => p.pincellId && ctx.pins.has(p.pincellId));
    let lines = genSCONE(spec).split('\n');
    if (linked) {
        const stubAt = lines.findIndex((l) => l.includes('pinUniverse stubs'));
        if (stubAt > 0) lines = lines.slice(0, stubAt);
    }
    // The standalone Lattice Builder tells the reader to wire the lattice up and
    // to define the materials itself. Here the boundary section already fills
    // this universe and the materials section already declared them, so that
    // advice would be describing a deck the builder is not writing.
    const pad = moderatorName(ctx);
    return {
        universes: lines
            .filter((l) => !/^\/\/ (Wire this|and define|nuclearData \{|canonical PWR)/.test(l))
            .map((l) => (pad ? l.replace(/^(\s*padMat\s+)\S+;/, `$1${pad};`) : l)),
    };
}

/** The bound material a lattice pads with and a bare pin cell fills its gap with. */
function moderatorName(ctx: EmitCtx): string | undefined {
    const all = [...ctx.materials.values()];
    const pick = all.find((b) => /water|coolant|moderator/i.test(b.label)) ?? all[0];
    if (!pick) return undefined;
    return ctx.code === 'scone' ? pick.sconeName : ctx.code === 'serpent' ? pick.serpentName : pick.openmcVar;
}

function emitBoundary(section: BoundarySection, ctx: EmitCtx): Fragments {
    const fillU = section.fillLatticeId
        ? ctx.latticeUniverses.get(section.fillLatticeId) ?? section.fillUniverse
        : section.fillUniverse;
    const surfaces: string[] = [];
    const cells: string[] = [];
    const universes: string[] = [];

    if (ctx.code === 'mcnp') {
        const star = section.bc === 'reflective' ? '*' : section.bc === 'white' ? '+' : '';
        const sid = ctx.alloc.next('surface');
        if (section.shape === 'box') {
            surfaces.push(`${star}${sid} rpp -${section.size} ${section.size} -${section.size} ${section.size} ${section.zMin} ${section.zMax}`);
        } else if (section.shape === 'cylinder') {
            const zLo = ctx.alloc.next('surface');
            const zHi = ctx.alloc.next('surface');
            surfaces.push(
                `${star}${sid} cz ${section.size}`,
                `${star}${zLo} pz ${section.zMin}`,
                `${star}${zHi} pz ${section.zMax}`,
            );
            const fillCell = ctx.alloc.next('cell');
            cells.push(
                ctx.comment('outer boundary'),
                `${fillCell} 0 -${sid} ${zLo} -${zHi}${fillU ? ` fill=${fillU}` : ''} imp:n=1`,
                `${ctx.alloc.next('cell')} 0 ${sid}:-${zLo}:${zHi} imp:n=0 $ graveyard`,
            );
            return { surfaces, cells };
        } else {
            surfaces.push(`${star}${sid} so ${section.size}`);
        }
        const fillCell = ctx.alloc.next('cell');
        cells.push(
            ctx.comment('outer boundary'),
            `${fillCell} 0 -${sid}${fillU ? ` fill=${fillU}` : ''} imp:n=1`,
            `${ctx.alloc.next('cell')} 0 ${sid} imp:n=0 $ graveyard`,
        );
        return { surfaces, cells };
    }

    if (ctx.code === 'openmc') {
        const bt = section.bc === 'reflective' ? 'reflective' : 'vacuum';
        const fill = openmcFill(ctx, section);
        if (section.shape === 'box') {
            surfaces.push(`bounds = openmc.model.RectangularParallelepiped(`
                + `-${section.size}, ${section.size}, -${section.size}, ${section.size}, `
                + `${section.zMin}, ${section.zMax}, boundary_type="${bt}")`);
            universes.push(`root_cell = openmc.Cell(cell_id=${ctx.alloc.next('cell')}, region=-bounds, fill=${fill})`);
        } else {
            surfaces.push(`bound_cyl = openmc.ZCylinder(r=${section.size}, boundary_type="${bt}")`);
            surfaces.push(`bound_lo = openmc.ZPlane(z0=${section.zMin}, boundary_type="${bt}")`);
            surfaces.push(`bound_hi = openmc.ZPlane(z0=${section.zMax}, boundary_type="${bt}")`);
            universes.push(`root_cell = openmc.Cell(cell_id=${ctx.alloc.next('cell')}, region=-bound_cyl & +bound_lo & -bound_hi, fill=${fill})`);
        }
        // The root cell goes in the universes region, not cells: Python binds
        // names in file order, and the lattice it fills with is written there.
        universes.push('root_universe = openmc.Universe(cells=[root_cell])', 'geometry = openmc.Geometry(root_universe)');
        return { surfaces, cells, universes };
    }

    if (ctx.code === 'serpent') {
        const bc = section.bc === 'reflective' ? '2' : '1';
        if (section.shape === 'box') {
            surfaces.push(`surf 900 cuboid -${section.size} ${section.size} -${section.size} ${section.size} ${section.zMin} ${section.zMax}`);
        } else {
            surfaces.push(`surf 900 cyl 0.0 0.0 ${section.size} ${section.zMin} ${section.zMax}`);
        }
        cells.push(
            `cell 900 0 fill ${fillU ?? 'universe'} -900`,
            'cell 999 0 outside 900',
        );
        return { surfaces, cells, settings: [`set bc ${bc}`] };
    }

    // SCONE: root universe border + boundary condition vector.
    const bcVec = section.bc === 'reflective' ? '1 1 1 1 1 1' : '0 0 0 0 0 0';
    surfaces.push(section.shape === 'box'
        ? `boundary { id 900; type box; origin (0.0 0.0 ${(section.zMin + section.zMax) / 2}); halfwidth (${section.size} ${section.size} ${(section.zMax - section.zMin) / 2}); }`
        : `boundary { id 900; type zTruncCylinder; origin (0.0 0.0 ${(section.zMin + section.zMax) / 2}); radius ${section.size}; halfwidth ${(section.zMax - section.zMin) / 2}; }`);
    universes.push(`root { id 1; type rootUniverse; border 900; fill u<${fillU ?? 1}>; }`);
    return { surfaces, universes, settings: [`__scone_bc__ ${bcVec}`] };
}

/** The Python name that fills an OpenMC root cell: a lattice, a pin, or void. */
function openmcFill(ctx: EmitCtx, section: BoundarySection): string {
    if (section.fillLatticeId && ctx.latticeVars.has(section.fillLatticeId)) {
        return ctx.latticeVars.get(section.fillLatticeId)!;
    }
    const firstPin = [...ctx.pins.values()][0];
    return firstPin ? firstPin.name : 'None';
}

function emitRun(section: RunSection, ctx: EmitCtx): Fragments {
    const [x, y, z] = section.source;
    if (ctx.code === 'mcnp') {
        const lines = ['mode n'];
        if (section.mode === 'eigenvalue') {
            lines.push(
                `kcode ${section.particles} ${section.keffGuess} ${section.inactive} ${section.inactive + section.active}`,
                `ksrc ${x} ${y} ${z}`,
            );
        } else {
            lines.push(
                `nps ${section.particles}`,
                `sdef pos=${x} ${y} ${z} erg=d1`,
                'si1 h 1e-3 20',
                'sp1 -3',
            );
        }
        if (section.seed !== undefined) lines.push(`rand seed=${section.seed}`);
        lines.push('print');
        return { settings: lines };
    }
    if (ctx.code === 'openmc') {
        const lines = [
            'settings = openmc.Settings()',
            `settings.run_mode = "${section.mode}"`,
            `settings.particles = ${section.particles}`,
        ];
        if (section.mode === 'eigenvalue') {
            lines.push(`settings.batches = ${section.inactive + section.active}`, `settings.inactive = ${section.inactive}`);
        } else {
            lines.push(`settings.batches = ${section.active}`);
        }
        lines.push(
            `settings.source = openmc.IndependentSource(space=openmc.stats.Point((${x}, ${y}, ${z})))`,
        );
        if (section.seed !== undefined) lines.push(`settings.seed = ${section.seed}`);
        return { settings: lines };
    }
    if (ctx.code === 'serpent') {
        const lines = section.mode === 'eigenvalue'
            ? [`set pop ${section.particles} ${section.inactive + section.active} ${section.inactive} ${section.keffGuess}`]
            : [`set nps ${section.particles}`, `src s1 sp ${x} ${y} ${z}`];
        if (section.seed !== undefined) lines.push(`set seed ${section.seed}`);
        return { settings: lines };
    }
    // A SCONE input file is the physics-package dictionary itself: these keys
    // are top level, and the operators are required — SCONE has no defaults for
    // them and stops with "Keyword ... was not found" if they are missing.
    const pkg = section.mode === 'eigenvalue' ? 'eigenPhysicsPackage' : 'fixedSourcePhysicsPackage';
    const lines = [
        `type ${pkg};`,
        `pop ${section.particles};`,
        ...(section.mode === 'eigenvalue'
            ? [`active ${section.active};`, `inactive ${section.inactive};`]
            : [`cycles ${section.active};`]),
        'XSdata ce;',
        'dataType ce;',
    ];
    if (section.seed !== undefined) lines.push(`seed ${section.seed};`);
    if (section.mode !== 'eigenvalue') {
        lines.push(
            'source {',
            '  type pointSource;',
            `  r (${x} ${y} ${z});`,
            '  particle neutron;',
            '  E 1.0;',
            '}',
        );
    }
    lines.push(
        'collisionOperator { neutronCE { type neutronCEstd; } }',
        'transportOperator { type transportOperatorDT; }',
    );
    return { settings: lines };
}

function emitTally(section: TallySection, ctx: EmitCtx): Fragments {
    const cells = section.cells.length ? section.cells : [10];
    const index = ctx.counters.tally++;
    if (ctx.code === 'mcnp') {
        // MCNP tally numbers must end in the type digit: F4/F14/F24 track flux,
        // F6/F16 energy deposition.
        const typeDigit = section.quantity === 'heating' ? 6 : 4;
        const id = index * 10 + typeDigit;
        const lines = [
            ctx.comment(`${section.quantity} tally`),
            `f${id}:n ${cells.join(' ')}`,
        ];
        if (section.quantity === 'fission') lines.push(`fm${id} -1 0 -6`);
        if (section.quantity === 'spectrum' && section.energyBins) {
            lines.push(`e${id} 1e-9 ${section.energyBins}ilog 20`);
        }
        // An F4/F6 divides by cell volume. MCNP cannot compute the volume of a
        // cell inside a lattice or `fill=` universe, so a tally there is a fatal
        // error without sd — the checks flag it and this writes it when set.
        if (section.sd !== undefined) lines.push(`sd${id} ${section.sd}`);
        return { tallies: lines };
    }
    if (ctx.code === 'openmc') {
        const score = section.quantity === 'heating' ? 'heating'
            : section.quantity === 'fission' ? 'fission' : 'flux';
        const v = `tally_${index + 1}`;
        const filters = [`openmc.CellFilter([${cells.join(', ')}])`];
        if (section.quantity === 'spectrum' && section.energyBins) {
            filters.push(`openmc.EnergyFilter(np.logspace(-3, 7, ${section.energyBins + 1}))`);
        }
        return {
            tallies: [
                `${v} = openmc.Tally(name="${section.quantity}")`,
                `${v}.filters = [${filters.join(', ')}]`,
                `${v}.scores = ["${score}"]`,
            ],
        };
    }
    if (ctx.code === 'serpent') {
        // `dc` takes a Serpent cell *name*, and the builder's geometry is built
        // from named pins rather than numbered cells, so the material bins are
        // the honest translation of a cell list. Repeated `dm` entries become
        // separate output bins; `dr … void` takes the response from the
        // collision site.
        const name = `${section.quantity}_${index + 1}`;
        const dr = section.quantity === 'fission' ? ' dr -6 void'
            : section.quantity === 'heating' ? ' dr -8 void' : '';
        const bins = [...ctx.materials.values()].map((b) => `       dm ${b.serpentName}`);
        const lines = [`det ${name}${dr}`, ...bins];
        if (section.quantity === 'spectrum' && section.energyBins) {
            lines.push(`ene eg_${index + 1} 3 ${section.energyBins} 1e-9 20`);
            lines.push(`det ${name}_spec de eg_${index + 1}`, ...bins);
        }
        return { tallies: lines };
    }
    // SCONE clerks bin by a map, not by a cell list, so the cell numbers the
    // other three codes use do not carry over: a materialMap over the deck's
    // materials is the closest equivalent the builder can write on its own.
    const name = `${slug(section.label ?? section.quantity).toLowerCase()}_${index + 1}`;
    const response = section.quantity === 'fission' ? 'fissionResponse'
        : section.quantity === 'heating' ? 'kappaFissionResponse' : 'fluxResponse';
    const lines = [
        `${name} {`,
        '  type collisionClerk;',
        '  response (res);',
        `  res { type ${response}; }`,
    ];
    if (section.quantity === 'spectrum' && section.energyBins) {
        lines.push(`  map { type energyMap; grid log; min 1.0E-9; max 20.0; N ${section.energyBins}; }`);
    } else {
        const mats = [...ctx.materials.values()].map((b) => b.sconeName);
        if (mats.length) lines.push(`  map { type materialMap; materials (${mats.join(' ')}); }`);
    }
    lines.push('}');
    return { tallies: lines };
}

function emitSurface(section: SurfaceSection, ctx: EmitCtx): Fragments {
    const spec = { ...section.spec, code: ctx.code } as SurfaceWizardInput;
    return { surfaces: surfaceWizardCard(spec).split('\n') };
}

function emitCell(section: CellSection, ctx: EmitCtx): Fragments {
    const spec = { ...section.spec, code: ctx.code } as CellWizardInput;
    return { cells: cellWizardCard(spec).split('\n') };
}

function emitSection(section: DeckSection, ctx: EmitCtx): Fragments {
    switch (section.kind) {
        case 'materials': return emitMaterials(section, ctx);
        case 'pincell': return emitPinCell(section, ctx);
        case 'lattice': return emitLattice(section, ctx);
        case 'boundary': return emitBoundary(section, ctx);
        case 'run': return emitRun(section, ctx);
        case 'tally': return emitTally(section, ctx);
        case 'surface': return emitSurface(section, ctx);
        case 'cell': return emitCell(section, ctx);
        case 'custom': return { [section.region]: section.text.split('\n') };
    }
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** A fragment plus the section that produced it, so lines stay attributable. */
interface OwnedLines {
    sectionId: string;
    lines: string[];
}

type RegionMap = Map<DeckRegion, OwnedLines[]>;

export interface DeckSectionSpan {
    id: string;
    kind: SectionKind;
    label: string;
    /** 0-based line indices this section owns, in output order. */
    lines: number[];
    /** Just this section's contribution, for "insert only this section". */
    text: string;
}

export interface DeckDocument {
    code: MonteCarloCode;
    text: string;
    lines: string[];
    /** Section id per output line; null for assembler scaffolding. */
    owners: (string | null)[];
    sections: DeckSectionSpan[];
    counts: { materials: number; surfaces: number; cells: number; lattices: number; tallies: number };
}

class Writer {
    readonly lines: string[] = [];
    readonly owners: (string | null)[] = [];
    private readonly spans = new Map<string, number[]>();

    push(line: string, owner: string | null): void {
        this.owners.push(owner);
        this.lines.push(line);
        if (owner) {
            const at = this.spans.get(owner) ?? [];
            at.push(this.lines.length - 1);
            this.spans.set(owner, at);
        }
    }

    blank(): void {
        if (this.lines.length && this.lines[this.lines.length - 1] === '') return;
        this.push('', null);
    }

    region(map: RegionMap, region: DeckRegion, indent = ''): boolean {
        const blocks = map.get(region);
        if (!blocks || blocks.length === 0) return false;
        for (const block of blocks) {
            for (const line of block.lines) this.push(line ? indent + line : '', block.sectionId);
        }
        return true;
    }

    spanFor(id: string): number[] {
        return this.spans.get(id) ?? [];
    }
}

function assembleMcnp(model: DeckModel, map: RegionMap, w: Writer): void {
    w.push(`${model.title || 'OWEN Input Builder deck'}`, null);
    w.region(map, 'title');
    w.push('c', null);
    w.push('c Cell cards', null);
    w.region(map, 'cells');
    w.region(map, 'universes');
    w.blank();
    w.push('c Surface cards', null);
    w.region(map, 'surfaces');
    w.blank();
    w.push('c Data cards', null);
    w.region(map, 'materials');
    w.region(map, 'settings');
    w.region(map, 'tallies');
    w.region(map, 'trailer');
}

function assembleOpenmc(model: DeckModel, map: RegionMap, w: Writer, ctx: EmitCtx): void {
    w.push('#!/usr/bin/env python3', null);
    w.push(`"""${model.title || 'OWEN Input Builder model'}"""`, null);
    w.push('', null);
    w.push('import numpy as np', null);
    w.push('import openmc', null);
    w.blank();
    w.region(map, 'title');
    w.push('# Materials', null);
    w.region(map, 'materials');
    const vars = [...ctx.materials.values()].map((b) => b.openmcVar);
    w.push(`materials = openmc.Materials([${vars.join(', ')}])`, null);
    w.blank();
    w.push('# Geometry', null);
    w.region(map, 'surfaces');
    w.region(map, 'cells');
    w.region(map, 'universes');
    w.blank();
    w.push('# Settings', null);
    w.region(map, 'settings');
    const tallies = tallyVars(model);
    if (tallies.length) {
        w.blank();
        w.push('# Tallies', null);
        w.region(map, 'tallies');
        w.push(`tallies = openmc.Tallies([${tallies.join(', ')}])`, null);
    }
    w.blank();
    w.push(`model = openmc.Model(geometry, materials, settings${tallies.length ? ', tallies' : ''})`, null);
    w.push('model.export_to_model_xml()', null);
    w.region(map, 'trailer');
}

function assembleSerpent(model: DeckModel, map: RegionMap, w: Writer): void {
    w.push(`% ${model.title || 'OWEN Input Builder deck'}`, null);
    w.region(map, 'title');
    w.blank();
    w.push('% --- Materials', null);
    w.region(map, 'materials');
    w.blank();
    w.push('% --- Geometry', null);
    w.region(map, 'universes');
    w.region(map, 'surfaces');
    w.region(map, 'cells');
    w.blank();
    w.push('% --- Settings', null);
    w.region(map, 'settings');
    w.region(map, 'tallies');
    w.region(map, 'trailer');
}

function assembleScone(model: DeckModel, map: RegionMap, w: Writer): void {
    w.push(`// ${model.title || 'OWEN Input Builder deck'}`, null);
    w.region(map, 'title');
    w.blank();
    // A SCONE input file *is* the physics-package dictionary: the run keys sit
    // at top level, not inside a `physics { }` block. The boundary section
    // smuggles its boundary-condition vector through the settings region.
    const settings = (map.get('settings') ?? []).map((b) => ({
        sectionId: b.sectionId,
        lines: b.lines.filter((l) => !l.startsWith('__scone_bc__')),
    }));
    const bcLine = (map.get('settings') ?? [])
        .flatMap((b) => b.lines)
        .find((l) => l.startsWith('__scone_bc__'));
    const bc = bcLine ? bcLine.replace('__scone_bc__', '').trim() : '0 0 0 0 0 0';

    for (const block of settings) {
        for (const line of block.lines) w.push(line, block.sectionId);
    }
    if (map.has('tallies')) {
        w.push('inactiveTally {}', null);
        w.push('activeTally {', null);
        w.region(map, 'tallies', '  ');
        w.push('}', null);
    }
    w.blank();
    w.push('geometry {', null);
    w.push('  type geometryStd;', null);
    w.push(`  boundary (${bc});`, null);
    w.push('  graph { type shrunk; }', null);
    w.push('  surfaces {', null);
    w.region(map, 'surfaces', '    ');
    w.push('  }', null);
    w.push('  cells {', null);
    w.region(map, 'cells', '    ');
    w.push('  }', null);
    w.push('  universes {', null);
    w.region(map, 'universes', '    ');
    w.push('  }', null);
    w.push('}', null);
    w.blank();
    w.push('nuclearData {', null);
    w.push('  handles { ce { type aceNeutronDatabase; aceLibrary $SCONE_ACE; } }', null);
    w.push('  materials {', null);
    w.region(map, 'materials', '    ');
    w.push('  }', null);
    w.push('}', null);
    w.region(map, 'trailer');
}

/** `tally_1 … tally_n` in the same order `emitTally` numbered them. */
function tallyVars(model: DeckModel): string[] {
    return enabledSections(model)
        .filter((s): s is TallySection => s.kind === 'tally')
        .map((_, i) => `tally_${i + 1}`);
}

function materialVars(model: DeckModel): string[] {
    const out: string[] = [];
    for (const s of enabledSections(model)) {
        if (s.kind !== 'materials') continue;
        for (const e of s.entries) out.push(`mat_${slug(e.custom?.name ?? e.pnnl?.name ?? libraryEntry(e.libraryId)?.name ?? e.key).toLowerCase()}`);
    }
    return out.length ? out : [];
}

/** Build the deck text, with per-line provenance and per-section slices. */
export function buildDeckDocument(model: DeckModel): DeckDocument {
    const alloc = new IdAllocator();
    // Pass 1: reserve every explicit identifier so automatic ids avoid them.
    for (const s of enabledSections(model)) {
        if (s.kind === 'materials') for (const e of s.entries) alloc.reserve('material', e.mcnpNumber);
        if (s.kind === 'lattice') {
            alloc.reserve('cell', s.latticeCell);
            alloc.reserve('universe', s.latticeUniverse);
        }
        if (s.kind === 'pincell') alloc.reserve('universe', s.universe);
        if (s.kind === 'surface') alloc.reserve('surface', s.spec.surfaceNumber);
        if (s.kind === 'cell') {
            alloc.reserve('cell', s.spec.cellNumber);
            alloc.reserve('universe', s.spec.universe);
        }
    }

    const ctx: EmitCtx = {
        code: model.code,
        alloc,
        materials: bindMaterials(model, alloc),
        latticeUniverses: new Map(),
        latticeVars: new Map(),
        pins: new Map(),
        counters: { tally: 0 },
        comment: commentFor(model.code),
    };

    // Pass 2: emit. Pin cells and lattices run before the boundary that fills
    // them so the boundary knows the universe numbers they chose.
    const map: RegionMap = new Map();
    const order: DeckSection[] = [
        ...enabledSections(model).filter((s) => s.kind !== 'boundary'),
        ...enabledSections(model).filter((s) => s.kind === 'boundary'),
    ];
    for (const section of order) {
        const frags = emitSection(section, ctx);
        for (const [region, lines] of Object.entries(frags) as [DeckRegion, string[]][]) {
            if (!lines || lines.length === 0) continue;
            const at = map.get(region) ?? [];
            at.push({ sectionId: section.id, lines });
            map.set(region, at);
        }
    }

    const w = new Writer();
    if (model.code === 'mcnp') assembleMcnp(model, map, w);
    else if (model.code === 'openmc') assembleOpenmc(model, map, w, ctx);
    else if (model.code === 'serpent') assembleSerpent(model, map, w);
    else assembleScone(model, map, w);

    const text = `${w.lines.join('\n')}\n`;
    const sections: DeckSectionSpan[] = model.sections.map((s) => {
        const lines = w.spanFor(s.id);
        return {
            id: s.id,
            kind: s.kind,
            label: sectionLabel(s),
            lines,
            text: lines.map((i) => w.lines[i]).join('\n'),
        };
    });

    return {
        code: model.code,
        text,
        lines: w.lines,
        owners: w.owners,
        sections,
        counts: {
            materials: ctx.materials.size,
            surfaces: (map.get('surfaces') ?? []).reduce((n, b) => n + b.lines.length, 0),
            cells: (map.get('cells') ?? []).reduce((n, b) => n + b.lines.length, 0),
            lattices: enabledSections(model).filter((s) => s.kind === 'lattice').length,
            tallies: enabledSections(model).filter((s) => s.kind === 'tally').length,
        },
    };
}
