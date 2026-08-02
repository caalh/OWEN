/**
 * OpenMC XML validation — materials.xml / geometry.xml / settings.xml /
 * tallies.xml / model.xml (the single-file form written by
 * Model.export_to_model_xml()).
 *
 * Same contract as rules.ts: text in, PlainDiagnostic[] out, no vscode
 * imports (host wiring lives in openmcXmlHost.ts). Regex-based scanning is
 * deliberate — these files are machine-written, flat, and attribute-driven,
 * so a full XML parser buys nothing and costs a dependency.
 *
 * Editorial bar: only flag what is certainly wrong. Unknown child elements
 * and attributes are left alone; OpenMC's schema grows faster than this file.
 */

import { PlainDiagnostic, PlainSeverity } from './types';

export type OpenmcXmlKind = 'materials' | 'geometry' | 'settings' | 'tallies' | 'model';

const ROOT_TO_KIND: Record<string, OpenmcXmlKind> = {
    materials: 'materials',
    geometry: 'geometry',
    settings: 'settings',
    tallies: 'tallies',
    model: 'model',
};

/**
 * Identify an OpenMC XML document by its root element (so renamed files like
 * pin_model.xml still validate). Returns null for unrelated XML.
 */
export function detectOpenmcXmlKind(text: string): OpenmcXmlKind | null {
    // First element that is not the <?xml?> declaration or a comment.
    const m = text.match(/<\s*([a-zA-Z_][\w-]*)/g);
    if (!m) return null;
    for (const tag of m) {
        const name = tag.replace(/<\s*/, '').toLowerCase();
        if (name.startsWith('?') || name.startsWith('!')) continue;
        return ROOT_TO_KIND[name] ?? null;
    }
    return null;
}

export interface OpenmcXmlContext {
    /** Material ids from a sibling materials.xml, for cross-file cell checks. */
    materialIds?: Set<string>;
}

interface Element {
    name: string;
    attrs: Map<string, { value: string; offset: number }>;
    /** Offset of the '<' in the source text. */
    offset: number;
    /** Raw tag text, for column math. */
    raw: string;
}

function scanElements(text: string, name: string): Element[] {
    const out: Element[] = [];
    const re = new RegExp(`<${name}\\b([^>]*?)/?>`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const attrs = new Map<string, { value: string; offset: number }>();
        const attrRe = /([\w-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
        let a: RegExpExecArray | null;
        while ((a = attrRe.exec(m[1])) !== null) {
            attrs.set(a[1], {
                value: a[3] ?? a[4] ?? '',
                offset: m.index + `<${name}`.length + a.index,
            });
        }
        out.push({ name, attrs, offset: m.index, raw: m[0] });
    }
    return out;
}

/** Simple child-element text, e.g. <particles>10000</particles>. */
function scanTextElements(text: string, name: string): { value: string; offset: number }[] {
    const out: { value: string; offset: number }[] = [];
    const re = new RegExp(`<${name}\\s*>([^<]*)</${name}\\s*>`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        out.push({ value: m[1].trim(), offset: m.index });
    }
    return out;
}

function lineColOf(text: string, offset: number): { line: number; col: number } {
    let line = 0;
    let lineStart = 0;
    for (let i = 0; i < offset && i < text.length; i++) {
        if (text[i] === '\n') {
            line++;
            lineStart = i + 1;
        }
    }
    return { line, col: offset - lineStart };
}

function pushAt(
    diags: PlainDiagnostic[], text: string, offset: number, length: number,
    message: string, severity: PlainSeverity, code: string,
): void {
    const { line, col } = lineColOf(text, offset);
    diags.push({ line, startCol: col, endCol: col + Math.max(1, length), message, severity, code });
}

// ---------------------------------------------------------------------------
// materials.xml
// ---------------------------------------------------------------------------

const DENSITY_UNITS = new Set(['g/cm3', 'g/cc', 'kg/m3', 'atom/b-cm', 'atom/cm3', 'sum', 'macro']);
// U235, H1, Am242_m1 — element symbol + mass number + optional metastable tag.
const NUCLIDE_RE = /^[A-Z][a-z]?\d{1,3}(_m\d+)?$/;

function validateMaterials(text: string, diags: PlainDiagnostic[]): Set<string> {
    const ids = new Set<string>();
    for (const mat of scanElements(text, 'material')) {
        const id = mat.attrs.get('id');
        if (!id) {
            pushAt(diags, text, mat.offset, mat.raw.length,
                '<material> is missing the id attribute.', 'error', 'openmc-xml.material-no-id');
            continue;
        }
        if (ids.has(id.value)) {
            pushAt(diags, text, id.offset, id.value.length + 5,
                `Duplicate material id "${id.value}".`, 'error', 'openmc-xml.duplicate-id');
        }
        ids.add(id.value);
    }

    for (const den of scanElements(text, 'density')) {
        const units = den.attrs.get('units');
        if (units && !DENSITY_UNITS.has(units.value)) {
            pushAt(diags, text, units.offset, units.value.length + 8,
                `Unknown density units "${units.value}" — OpenMC accepts g/cm3, g/cc, kg/m3, atom/b-cm, atom/cm3, sum, or macro.`,
                'error', 'openmc-xml.density-units');
        }
        if (units && units.value !== 'sum' && units.value !== 'macro' && !den.attrs.get('value')) {
            pushAt(diags, text, den.offset, den.raw.length,
                `<density units="${units.value}"> needs a value attribute (only units="sum" and "macro" go without one).`,
                'error', 'openmc-xml.density-no-value');
        }
    }

    for (const nuc of scanElements(text, 'nuclide')) {
        const name = nuc.attrs.get('name');
        if (name && !NUCLIDE_RE.test(name.value)) {
            pushAt(diags, text, name.offset, name.value.length + 7,
                `"${name.value}" is not a GNDS nuclide name — OpenMC expects e.g. U235, H1, Am242_m1 ` +
                '(element symbol + mass number, no ZAID suffixes like .80c).',
                'error', 'openmc-xml.nuclide-name');
        }
        if (nuc.attrs.get('ao') && nuc.attrs.get('wo')) {
            pushAt(diags, text, nuc.offset, nuc.raw.length,
                'A nuclide takes ao= (atom fraction) or wo= (weight fraction), not both.',
                'error', 'openmc-xml.nuclide-ao-wo');
        }
    }

    for (const sab of scanElements(text, 'sab')) {
        const name = sab.attrs.get('name');
        if (name && !/^c_/.test(name.value)) {
            pushAt(diags, text, name.offset, name.value.length + 7,
                `"${name.value}" looks like an MCNP S(α,β) id — OpenMC thermal tables use c_ names (c_H_in_H2O, c_Graphite, …).`,
                'warning', 'openmc-xml.sab-name');
        }
    }
    return ids;
}

// ---------------------------------------------------------------------------
// geometry.xml
// ---------------------------------------------------------------------------

const SURFACE_TYPES = new Set([
    'plane', 'x-plane', 'y-plane', 'z-plane',
    'sphere', 'x-cylinder', 'y-cylinder', 'z-cylinder',
    'x-cone', 'y-cone', 'z-cone',
    'quadric', 'x-torus', 'y-torus', 'z-torus',
]);
const BOUNDARY_TYPES = new Set(['transmission', 'vacuum', 'reflective', 'periodic', 'white']);

function validateGeometry(text: string, diags: PlainDiagnostic[], ctx: OpenmcXmlContext): void {
    const surfaceIds = new Set<string>();
    for (const surf of scanElements(text, 'surface')) {
        const id = surf.attrs.get('id');
        if (id) {
            if (surfaceIds.has(id.value)) {
                pushAt(diags, text, id.offset, id.value.length + 5,
                    `Duplicate surface id "${id.value}".`, 'error', 'openmc-xml.duplicate-id');
            }
            surfaceIds.add(id.value);
        }
        const type = surf.attrs.get('type');
        if (type && !SURFACE_TYPES.has(type.value)) {
            pushAt(diags, text, type.offset, type.value.length + 7,
                `Unknown surface type "${type.value}" — OpenMC XML surface types are ${[...SURFACE_TYPES].join(', ')}.`,
                'error', 'openmc-xml.surface-type');
        }
        const boundary = surf.attrs.get('boundary');
        if (boundary && !BOUNDARY_TYPES.has(boundary.value)) {
            pushAt(diags, text, boundary.offset, boundary.value.length + 11,
                `Unknown boundary "${boundary.value}" — valid: transmission, vacuum, reflective, periodic, white.`,
                'error', 'openmc-xml.boundary-type');
        }
    }

    // Lattice/universe ids referenced by fill=; collected loosely.
    const universeIds = new Set<string>();
    for (const name of ['lattice', 'hex_lattice']) {
        for (const lat of scanElements(text, name)) {
            const id = lat.attrs.get('id');
            if (id) universeIds.add(id.value);
        }
    }

    const cellIds = new Set<string>();
    for (const cell of scanElements(text, 'cell')) {
        const id = cell.attrs.get('id');
        if (id) {
            if (cellIds.has(id.value)) {
                pushAt(diags, text, id.offset, id.value.length + 5,
                    `Duplicate cell id "${id.value}".`, 'error', 'openmc-xml.duplicate-id');
            }
            cellIds.add(id.value);
        }
        const universe = cell.attrs.get('universe');
        if (universe) universeIds.add(universe.value);

        const material = cell.attrs.get('material');
        const fill = cell.attrs.get('fill');
        if (material && fill) {
            pushAt(diags, text, cell.offset, cell.raw.length,
                'A cell takes material= or fill=, not both.', 'error', 'openmc-xml.cell-material-and-fill');
        }
        if (material && ctx.materialIds) {
            for (const tok of material.value.split(/\s+/).filter(Boolean)) {
                if (tok !== 'void' && !ctx.materialIds.has(tok)) {
                    pushAt(diags, text, material.offset, material.value.length + 11,
                        `Cell references material "${tok}" which is not defined in materials.xml.`,
                        'error', 'openmc-xml.unknown-material');
                }
            }
        }
        const region = cell.attrs.get('region');
        if (region && surfaceIds.size > 0) {
            for (const tok of region.value.split(/[\s()|~]+/).filter(Boolean)) {
                const surfId = tok.replace(/^[-+]/, '');
                if (/^\d+$/.test(surfId) && !surfaceIds.has(surfId)) {
                    pushAt(diags, text, region.offset, region.value.length + 9,
                        `Region references surface ${surfId} which is not defined.`,
                        'error', 'openmc-xml.unknown-surface');
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// settings.xml
// ---------------------------------------------------------------------------

const RUN_MODES = new Set(['eigenvalue', 'fixed source', 'plot', 'volume', 'particle restart']);

function validateSettings(text: string, diags: PlainDiagnostic[]): void {
    const intOf = (name: string): number | null => {
        const els = scanTextElements(text, name);
        if (els.length === 0) return null;
        const el = els[0];
        const n = Number(el.value);
        if (!Number.isInteger(n) || n <= 0) {
            pushAt(diags, text, el.offset, el.value.length + name.length + 2,
                `<${name}> must be a positive integer (got "${el.value}").`, 'error', 'openmc-xml.bad-int');
            return null;
        }
        return n;
    };

    const batches = intOf('batches');
    const inactive = intOf('inactive');
    intOf('particles');
    if (batches !== null && inactive !== null && inactive >= batches) {
        const el = scanTextElements(text, 'inactive')[0];
        pushAt(diags, text, el.offset, el.value.length + 10,
            `inactive (${inactive}) must be less than batches (${batches}) — no active batches would remain, so no tallies and no k-eff statistics.`,
            'error', 'openmc-xml.inactive-ge-batches');
    }

    for (const rm of scanTextElements(text, 'run_mode')) {
        if (!RUN_MODES.has(rm.value)) {
            pushAt(diags, text, rm.offset, rm.value.length + 10,
                `Unknown run_mode "${rm.value}" — valid: eigenvalue, fixed source, plot, volume, particle restart.`,
                'error', 'openmc-xml.run-mode');
        }
    }
}

// ---------------------------------------------------------------------------
// tallies.xml
// ---------------------------------------------------------------------------

function validateTallies(text: string, diags: PlainDiagnostic[]): void {
    const filterIds = new Set<string>();
    for (const f of scanElements(text, 'filter')) {
        const id = f.attrs.get('id');
        if (id) {
            if (filterIds.has(id.value)) {
                pushAt(diags, text, id.offset, id.value.length + 5,
                    `Duplicate filter id "${id.value}".`, 'error', 'openmc-xml.duplicate-id');
            }
            filterIds.add(id.value);
        }
    }

    const tallyIds = new Set<string>();
    const tallyRe = /<tally\b([^>]*)>([\s\S]*?)<\/tally\s*>/g;
    let m: RegExpExecArray | null;
    while ((m = tallyRe.exec(text)) !== null) {
        const idMatch = m[1].match(/\bid\s*=\s*["']([^"']*)["']/);
        if (idMatch) {
            if (tallyIds.has(idMatch[1])) {
                pushAt(diags, text, m.index, 10,
                    `Duplicate tally id "${idMatch[1]}".`, 'error', 'openmc-xml.duplicate-id');
            }
            tallyIds.add(idMatch[1]);
        }
        const body = m[2];
        if (!/<scores\s*>/.test(body)) {
            pushAt(diags, text, m.index, 10,
                'Tally has no <scores> — it will score nothing.', 'error', 'openmc-xml.tally-no-scores');
        }
        const filters = body.match(/<filters\s*>([^<]*)<\/filters\s*>/);
        if (filters && filterIds.size > 0) {
            for (const ref of filters[1].trim().split(/\s+/).filter(Boolean)) {
                if (!filterIds.has(ref)) {
                    pushAt(diags, text, m.index + m[0].indexOf('<filters'), 20,
                        `Tally references filter ${ref} which is not defined.`, 'error', 'openmc-xml.unknown-filter');
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------

export function validateOpenmcXml(
    kind: OpenmcXmlKind,
    text: string,
    ctx: OpenmcXmlContext = {},
): PlainDiagnostic[] {
    const diags: PlainDiagnostic[] = [];
    switch (kind) {
        case 'materials':
            validateMaterials(text, diags);
            break;
        case 'geometry':
            validateGeometry(text, diags, ctx);
            break;
        case 'settings':
            validateSettings(text, diags);
            break;
        case 'tallies':
            validateTallies(text, diags);
            break;
        case 'model': {
            // model.xml wraps all four; element names don't collide, and
            // materials defined here feed the cell material cross-check.
            const ids = validateMaterials(text, diags);
            validateGeometry(text, diags, { materialIds: ids });
            validateSettings(text, diags);
            validateTallies(text, diags);
            break;
        }
    }
    return diags.sort((a, b) => a.line - b.line || a.startCol - b.startCol);
}
