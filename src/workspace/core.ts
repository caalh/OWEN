// Workspace validation — do the files of one model work together?
//
// A single deck is validated as you type (the language server, the OpenMC
// XML host). A *project* is more than one file: OpenMC's materials /
// geometry / settings / tallies XML (plus a model.xml that may or may not
// agree with them), an MCNP root deck with `read file=` includes, a Serpent
// deck with `include` cards and an `acelib`, a SCONE input naming an ACE
// library, an OpenMC Python model importing local modules and exporting XML.
// The failures that cost real time live in the seams between those files —
// a tally filter on a cell id that the geometry renumbered, a stale
// model.xml sitting next to freshly edited geometry.xml, a `mat` name the
// cells spell differently — and none of them is visible from inside one
// file.
//
// Every check returns a located diagnostic (file + line) and the report also
// says what was verified, so a clean project shows a green summary rather
// than silence. No vscode import; the host wires the filesystem in.

import * as path from 'path';
import { validateMcnpProject } from '../../packages/mcnp-workspace/src/validate';
import { parseOpenmcGeometryXml } from '../preview/openmcGeometry';
import { parseSerpentGeometry } from '../preview/serpentGeometry';
import { parseSconeGeometry } from '../preview/sconeGeometry';
import { checkGeometry } from '../geomcheck/core';
import { detectOpenmcXmlKind, OpenmcXmlKind } from '../language/openmcXml';
import type { PlainSeverity } from '../language/types';

export type WorkspaceLanguage = 'mcnp' | 'openmc' | 'openmc-xml' | 'serpent' | 'scone';

export interface WorkspaceDiag {
    file: string;
    line: number;
    startCol: number;
    endCol: number;
    message: string;
    severity: PlainSeverity;
    code: string;
}

export interface WorkspaceReport {
    language: WorkspaceLanguage;
    root: string;
    /** Every file that took part, with what it was read as. */
    files: { path: string; role: string; exists: boolean }[];
    diagnostics: WorkspaceDiag[];
    /** Checks that ran and passed — the reassurance a clean project needs. */
    verified: string[];
    /** Counts worth showing: cells, materials, … */
    inventory: Record<string, number>;
    notes: string[];
    summary: { errors: number; warnings: number; hints: number };
}

/** The host's view of the filesystem, so this module stays testable. */
export interface FileSystemLike {
    exists(p: string): boolean;
    read(p: string): string;
    list(dir: string): string[];
    mtime(p: string): number;
}

export interface WorkspaceInput {
    language: WorkspaceLanguage;
    /** Absolute path of the active deck. */
    rootPath: string;
    /** Unsaved buffers by absolute path; win over disk. */
    overrides?: Map<string, string>;
    fs: FileSystemLike;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function summarize(diags: WorkspaceDiag[]): WorkspaceReport['summary'] {
    const s = { errors: 0, warnings: 0, hints: 0 };
    for (const d of diags) {
        if (d.severity === 'error') s.errors++;
        else if (d.severity === 'warning') s.warnings++;
        else s.hints++;
    }
    return s;
}

function readText(input: WorkspaceInput, p: string): string | null {
    const norm = path.resolve(p);
    const o = input.overrides?.get(norm) ?? input.overrides?.get(p);
    if (o !== undefined) return o;
    return input.fs.exists(norm) ? input.fs.read(norm) : null;
}

/** Line/column span of the first regex match, or line 0 when nothing matches. */
function locate(text: string, re: RegExp): { line: number; startCol: number; endCol: number } {
    const m = re.exec(text);
    if (!m) return { line: 0, startCol: 0, endCol: 1 };
    const before = text.slice(0, m.index);
    const line = (before.match(/\n/g) ?? []).length;
    const startCol = m.index - (before.lastIndexOf('\n') + 1);
    return { line, startCol, endCol: startCol + Math.max(1, m[0].length) };
}

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function diag(file: string, text: string, re: RegExp, message: string, severity: PlainSeverity, code: string): WorkspaceDiag {
    return { file, ...locate(text, re), message, severity, code };
}

function attr(tag: string, name: string): string | undefined {
    const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
    return m ? (m[2] ?? m[3]) : undefined;
}

function tags(xml: string, name: string): { tag: string; index: number }[] {
    const out: { tag: string; index: number }[] = [];
    const re = new RegExp(`<${name}\\b[^>]*?/?>`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) out.push({ tag: m[0], index: m.index });
    return out;
}

function blocks(xml: string, name: string): { open: string; body: string; index: number }[] {
    const out: { open: string; body: string; index: number }[] = [];
    const re = new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)</${name}\\s*>`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) out.push({ open: m[1], body: m[2], index: m.index });
    return out;
}

function section(xml: string, name: string): string | null {
    const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}\\s*>`, 'i').exec(xml);
    return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// OpenMC XML project
// ---------------------------------------------------------------------------

interface XmlFile { path: string; kind: OpenmcXmlKind; text: string }

interface XmlInventory {
    materials: Map<string, string>;   // id → file
    cells: Map<string, string>;
    surfaces: Map<string, string>;
    universes: Map<string, string>;   // cell universe= and lattice ids
    lattices: Map<string, string>;
    meshes: Map<string, string>;
    filters: Map<string, { file: string; type: string; bins: string }>;
    tallies: Map<string, string>;
    nuclides: Set<string>;
    fissionable: boolean;
    materialDensityUnits: Map<string, string>;
}

function inventoryOf(files: XmlFile[]): XmlInventory {
    const inv: XmlInventory = {
        materials: new Map(), cells: new Map(), surfaces: new Map(), universes: new Map(), lattices: new Map(),
        meshes: new Map(), filters: new Map(), tallies: new Map(), nuclides: new Set(), fissionable: false,
        materialDensityUnits: new Map(),
    };
    for (const f of files) {
        const mats = f.kind === 'materials' ? f.text : f.kind === 'model' ? section(f.text, 'materials') ?? '' : '';
        for (const b of blocks(mats, 'material')) {
            const id = attr(b.open, 'id');
            if (id) inv.materials.set(id, f.path);
            for (const n of tags(b.body, 'nuclide')) {
                const name = attr(n.tag, 'name');
                if (name) { inv.nuclides.add(name); if (/^(U233|U235|Pu239|Pu241|U238|Th232|Pu240)$/.test(name)) inv.fissionable = true; }
            }
            const d = tags(b.body, 'density')[0];
            if (id && d) inv.materialDensityUnits.set(id, attr(d.tag, 'units') ?? '');
        }
        const geom = f.kind === 'geometry' ? f.text : f.kind === 'model' ? section(f.text, 'geometry') ?? '' : '';
        for (const t of tags(geom, 'surface')) { const id = attr(t.tag, 'id'); if (id) inv.surfaces.set(id, f.path); }
        for (const t of tags(geom, 'cell')) {
            const id = attr(t.tag, 'id'); if (id) inv.cells.set(id, f.path);
            const u = attr(t.tag, 'universe') ?? '0'; inv.universes.set(u, f.path);
        }
        for (const name of ['lattice', 'hex_lattice']) {
            for (const b of blocks(geom, name)) {
                const id = attr(b.open, 'id');
                if (id) { inv.lattices.set(id, f.path); inv.universes.set(id, f.path); }
            }
        }
        const tal = f.kind === 'tallies' ? f.text : f.kind === 'model' ? section(f.text, 'tallies') ?? '' : '';
        for (const b of blocks(tal, 'mesh')) { const id = attr(b.open, 'id'); if (id) inv.meshes.set(id, f.path); }
        for (const b of blocks(tal, 'filter')) {
            const id = attr(b.open, 'id');
            const type = attr(b.open, 'type') ?? '';
            const bins = /<bins\s*>([^<]*)<\/bins\s*>/i.exec(b.body)?.[1] ?? '';
            if (id) inv.filters.set(id, { file: f.path, type, bins: bins.trim() });
        }
        for (const b of blocks(tal, 'tally')) { const id = attr(b.open, 'id'); if (id) inv.tallies.set(id, f.path); }
        const sett = f.kind === 'settings' ? f.text : f.kind === 'model' ? section(f.text, 'settings') ?? '' : '';
        for (const b of blocks(sett, 'mesh')) { const id = attr(b.open, 'id'); if (id) inv.meshes.set(id, f.path); }
    }
    return inv;
}

function xmlIdSets(f: XmlFile): Record<string, Set<string>> {
    const inv = inventoryOf([f]);
    return {
        materials: new Set(inv.materials.keys()), cells: new Set(inv.cells.keys()), surfaces: new Set(inv.surfaces.keys()),
        tallies: new Set(inv.tallies.keys()), filters: new Set(inv.filters.keys()),
    };
}

export function validateOpenmcXmlProject(files: XmlFile[], fs: FileSystemLike): Omit<WorkspaceReport, 'language' | 'root' | 'files'> {
    const diags: WorkspaceDiag[] = [];
    const verified: string[] = [];
    const notes: string[] = [];
    const model = files.find((f) => f.kind === 'model');
    const separate = files.filter((f) => f.kind !== 'model');

    // OpenMC reads model.xml when it exists and ignores the separate files;
    // validate the set OpenMC will actually run, and compare with the rest.
    const active: XmlFile[] = model ? [model] : separate;
    const inv = inventoryOf(active);

    const geomFiles = active.filter((f) => f.kind === 'geometry' || f.kind === 'model');
    let cellMatRefs = 0, surfRefs = 0, fillRefs = 0;
    for (const f of geomFiles) {
        const geom = f.kind === 'model' ? section(f.text, 'geometry') ?? '' : f.text;
        for (const t of tags(geom, 'cell')) {
            const id = attr(t.tag, 'id') ?? '?';
            const mat = attr(t.tag, 'material');
            if (mat) {
                for (const tok of mat.split(/\s+/).filter(Boolean)) {
                    cellMatRefs++;
                    if (tok !== 'void' && !inv.materials.has(tok)) {
                        diags.push(diag(f.path, f.text, new RegExp(`<cell\\b[^>]*\\bid\\s*=\\s*["']${escapeRe(id)}["'][^>]*>`), `Cell ${id} uses material ${tok}, which no <material> in this project defines.`, 'error', 'workspace.unknown-material'));
                    }
                }
            }
            const region = attr(t.tag, 'region');
            if (region) {
                for (const tok of region.split(/[\s()|~]+/).filter(Boolean)) {
                    const sid = tok.replace(/^[-+]/, '');
                    if (!/^\d+$/.test(sid)) continue;
                    surfRefs++;
                    if (!inv.surfaces.has(sid)) {
                        diags.push(diag(f.path, f.text, new RegExp(`<cell\\b[^>]*\\bid\\s*=\\s*["']${escapeRe(id)}["'][^>]*>`), `Cell ${id} region uses surface ${sid}, which is not defined.`, 'error', 'workspace.unknown-surface'));
                    }
                }
            }
            const fill = attr(t.tag, 'fill');
            if (fill) {
                fillRefs++;
                if (!inv.universes.has(fill) && !inv.lattices.has(fill)) {
                    diags.push(diag(f.path, f.text, new RegExp(`<cell\\b[^>]*\\bid\\s*=\\s*["']${escapeRe(id)}["'][^>]*>`), `Cell ${id} fills with universe ${fill}, but no cell or lattice declares it.`, 'error', 'workspace.unknown-universe'));
                }
            }
        }
        for (const name of ['lattice', 'hex_lattice']) {
            for (const b of blocks(geom, name)) {
                const id = attr(b.open, 'id') ?? '?';
                const uni = /<universes\s*>([^<]*)<\/universes\s*>/i.exec(b.body)?.[1] ?? '';
                for (const u of new Set(uni.trim().split(/\s+/).filter(Boolean))) {
                    fillRefs++;
                    if (!inv.universes.has(u)) {
                        diags.push(diag(f.path, f.text, new RegExp(`<${name}\\b[^>]*\\bid\\s*=\\s*["']${escapeRe(id)}["']`), `Lattice ${id} places universe ${u}, which no cell declares.`, 'error', 'workspace.unknown-universe'));
                    }
                }
                const outer = /<outer\s*>([^<]*)<\/outer\s*>/i.exec(b.body)?.[1]?.trim();
                if (outer && !inv.universes.has(outer)) {
                    diags.push(diag(f.path, f.text, new RegExp(`<${name}\\b[^>]*\\bid\\s*=\\s*["']${escapeRe(id)}["']`), `Lattice ${id} outer universe ${outer} is not declared.`, 'error', 'workspace.unknown-universe'));
                }
            }
        }
    }
    if (cellMatRefs) verified.push(`${cellMatRefs} cell→material references resolve`);
    if (surfRefs) verified.push(`${surfRefs} region→surface references resolve`);
    if (fillRefs) verified.push(`${fillRefs} fill/lattice→universe references resolve`);

    // Tallies against geometry and materials.
    const talFiles = active.filter((f) => f.kind === 'tallies' || f.kind === 'model');
    let filterBinRefs = 0, tallyFilterRefs = 0, nuclideRefs = 0;
    const usedFilters = new Set<string>();
    for (const f of talFiles) {
        const tal = f.kind === 'model' ? section(f.text, 'tallies') ?? '' : f.text;
        for (const b of blocks(tal, 'filter')) {
            const id = attr(b.open, 'id') ?? '?';
            const type = (attr(b.open, 'type') ?? '').toLowerCase();
            const bins = (/<bins\s*>([^<]*)<\/bins\s*>/i.exec(b.body)?.[1] ?? '').trim().split(/\s+/).filter(Boolean);
            const at = new RegExp(`<filter\\b[^>]*\\bid\\s*=\\s*["']${escapeRe(id)}["']`);
            const check = (map: Map<string, unknown>, what: string) => {
                for (const bin of bins) {
                    filterBinRefs++;
                    if (!map.has(bin)) {
                        diags.push(diag(f.path, f.text, at, `Filter ${id} (${type}) bins ${what} ${bin}, which the geometry does not define — the tally would score nothing there.`, 'error', `workspace.filter-${what}`));
                    }
                }
            };
            if (type === 'cell' || type === 'distribcell' || type === 'cellfrom' || type === 'cellborn' || type === 'cellinstance') check(inv.cells, 'cell');
            else if (type === 'material' || type === 'materialfrom') check(inv.materials, 'material');
            else if (type === 'universe') check(inv.universes, 'universe');
            else if (type === 'surface') check(inv.surfaces, 'surface');
            else if (type === 'mesh' || type === 'meshsurface' || type === 'meshborn') check(inv.meshes, 'mesh');
        }
        for (const b of blocks(tal, 'tally')) {
            const id = attr(b.open, 'id') ?? '?';
            const at = new RegExp(`<tally\\b[^>]*\\bid\\s*=\\s*["']${escapeRe(id)}["']`);
            const flt = /<filters\s*>([^<]*)<\/filters\s*>/i.exec(b.body)?.[1] ?? '';
            for (const ref of flt.trim().split(/\s+/).filter(Boolean)) {
                tallyFilterRefs++;
                usedFilters.add(ref);
                if (!inv.filters.has(ref)) {
                    diags.push(diag(f.path, f.text, at, `Tally ${id} uses filter ${ref}, which is not defined.`, 'error', 'workspace.unknown-filter'));
                }
            }
            const nuc = /<nuclides\s*>([^<]*)<\/nuclides\s*>/i.exec(b.body)?.[1] ?? '';
            for (const n of nuc.trim().split(/\s+/).filter(Boolean)) {
                if (n === 'total') continue;
                nuclideRefs++;
                if (inv.nuclides.size && !inv.nuclides.has(n)) {
                    diags.push(diag(f.path, f.text, at, `Tally ${id} scores nuclide ${n}, which appears in no material — it will read exactly zero.`, 'warning', 'workspace.tally-nuclide-absent'));
                }
            }
            if (!/<scores\s*>/i.test(b.body)) {
                diags.push(diag(f.path, f.text, at, `Tally ${id} has no <scores>.`, 'error', 'workspace.tally-no-scores'));
            }
        }
    }
    if (filterBinRefs) verified.push(`${filterBinRefs} filter bins point at cells/materials/surfaces/meshes that exist`);
    if (tallyFilterRefs) verified.push(`${tallyFilterRefs} tally→filter references resolve`);
    if (nuclideRefs) verified.push(`${nuclideRefs} tally nuclide entries are present in the materials`);
    for (const [fid, info] of inv.filters) {
        if (!usedFilters.has(fid)) {
            const f = active.find((x) => x.path === info.file)!;
            diags.push(diag(f.path, f.text, new RegExp(`<filter\\b[^>]*\\bid\\s*=\\s*["']${escapeRe(fid)}["']`), `Filter ${fid} is defined but no tally uses it.`, 'hint', 'workspace.unused-filter'));
        }
    }

    // Materials nobody uses; surfaces nobody uses.
    const usedMats = new Set<string>(), usedSurfs = new Set<string>();
    for (const f of geomFiles) {
        const geom = f.kind === 'model' ? section(f.text, 'geometry') ?? '' : f.text;
        for (const t of tags(geom, 'cell')) {
            for (const tok of (attr(t.tag, 'material') ?? '').split(/\s+/)) if (tok) usedMats.add(tok);
            for (const tok of (attr(t.tag, 'region') ?? '').split(/[\s()|~]+/)) { const s = tok.replace(/^[-+]/, ''); if (s) usedSurfs.add(s); }
        }
    }
    for (const [mid, file] of inv.materials) {
        if (!usedMats.has(mid)) {
            const f = active.find((x) => x.path === file)!;
            diags.push(diag(f.path, f.text, new RegExp(`<material\\b[^>]*\\bid\\s*=\\s*["']${escapeRe(mid)}["']`), `Material ${mid} is defined but no cell uses it.`, 'hint', 'workspace.unused-material'));
        }
    }
    for (const [sid, file] of inv.surfaces) {
        if (!usedSurfs.has(sid)) {
            const f = active.find((x) => x.path === file)!;
            diags.push(diag(f.path, f.text, new RegExp(`<surface\\b[^>]*\\bid\\s*=\\s*["']${escapeRe(sid)}["']`), `Surface ${sid} is defined but no region uses it.`, 'hint', 'workspace.unused-surface'));
        }
    }

    // Settings against the rest.
    const settFiles = active.filter((f) => f.kind === 'settings' || f.kind === 'model');
    for (const f of settFiles) {
        const sett = f.kind === 'model' ? section(f.text, 'settings') ?? '' : f.text;
        const runMode = /<run_mode\s*>([^<]*)<\/run_mode\s*>/i.exec(sett)?.[1]?.trim();
        const hasSource = /<source\b/i.test(sett);
        if (runMode === 'fixed source' && !hasSource) {
            diags.push(diag(f.path, f.text, /<run_mode/i, 'run_mode is "fixed source" but no <source> is defined.', 'error', 'workspace.no-source'));
        }
        if (runMode === 'eigenvalue' && inv.nuclides.size && !inv.fissionable) {
            diags.push(diag(f.path, f.text, /<run_mode/i, 'run_mode is "eigenvalue" but no material contains a fissionable nuclide (U233/U235/U238/Pu239/Pu241/Th232) — k-eff would be zero.', 'warning', 'workspace.no-fissile'));
        }
        if (runMode) verified.push(`run_mode ${runMode} is consistent with the source and materials`);
        const em = /<entropy_mesh\s*>\s*<mesh\s*>\s*([^<\s]+)/i.exec(sett) ?? /<entropy_mesh\b[^>]*\bid\s*=\s*["']([^"']+)["']/i.exec(sett);
        if (em && !inv.meshes.has(em[1])) {
            diags.push(diag(f.path, f.text, /<entropy_mesh/i, `entropy_mesh refers to mesh ${em[1]}, which is not defined.`, 'error', 'workspace.unknown-mesh'));
        }
        // Source volume/cell constraints reference cells.
        for (const c of tags(sett, 'constraints')) {
            const cells = attr(c.tag, 'domain_ids');
            if (cells && attr(c.tag, 'domain_type') === 'cell') {
                for (const cid of cells.split(/\s+/).filter(Boolean)) {
                    if (!inv.cells.has(cid)) diags.push(diag(f.path, f.text, /<constraints/i, `Source constraint names cell ${cid}, which is not defined.`, 'error', 'workspace.unknown-cell'));
                }
            }
        }
        const batches = Number(/<batches\s*>([^<]*)<\/batches\s*>/i.exec(sett)?.[1]);
        const inactive = Number(/<inactive\s*>([^<]*)<\/inactive\s*>/i.exec(sett)?.[1]);
        if (Number.isFinite(batches) && Number.isFinite(inactive) && inactive >= batches) {
            diags.push(diag(f.path, f.text, /<inactive/i, `inactive (${inactive}) must be less than batches (${batches}).`, 'error', 'workspace.inactive-ge-batches'));
        }
    }

    // model.xml vs separate files: which one will run, and do they agree?
    if (model && separate.length) {
        const modelSets = xmlIdSets(model);
        const combined: Record<string, Set<string>> = { materials: new Set(), cells: new Set(), surfaces: new Set(), tallies: new Set(), filters: new Set() };
        for (const f of separate) {
            const s = xmlIdSets(f);
            for (const k of Object.keys(combined)) for (const v of s[k]) combined[k].add(v);
        }
        const disagreements: string[] = [];
        for (const k of Object.keys(combined)) {
            const a = modelSets[k], b = combined[k];
            if (!b.size && !a.size) continue;
            const onlyModel = [...a].filter((x) => !b.has(x)), onlySep = [...b].filter((x) => !a.has(x));
            if (onlyModel.length || onlySep.length) {
                disagreements.push(`${k}: model.xml has ${a.size}, the separate files have ${b.size}` +
                    (onlyModel.length ? ` (only in model.xml: ${onlyModel.slice(0, 6).join(', ')}${onlyModel.length > 6 ? '…' : ''})` : '') +
                    (onlySep.length ? ` (only in separate files: ${onlySep.slice(0, 6).join(', ')}${onlySep.length > 6 ? '…' : ''})` : ''));
            }
        }
        const newerSeparate = separate.filter((f) => fs.exists(f.path) && fs.exists(model.path) && fs.mtime(f.path) > fs.mtime(model.path) + 1000);
        if (disagreements.length) {
            diags.push(diag(model.path, model.text, /<model/i,
                `model.xml and the separate XML files describe different models: ${disagreements.join('; ')}. OpenMC runs model.xml when it exists and ignores the others — make sure the one you edited is the one that runs.`,
                'error', 'workspace.model-xml-disagrees'));
        } else {
            verified.push(`model.xml agrees with materials/geometry/settings/tallies.xml (same ids)`);
        }
        if (newerSeparate.length) {
            diags.push(diag(model.path, model.text, /<model/i,
                `${newerSeparate.map((f) => path.basename(f.path)).join(', ')} ${newerSeparate.length === 1 ? 'is' : 'are'} newer than model.xml. OpenMC will run model.xml; re-export it if the edits were meant to count.`,
                'warning', 'workspace.model-xml-stale'));
        }
        notes.push('OpenMC reads model.xml when present and ignores the separate files; this report validated model.xml and compared the rest against it.');
    } else if (model) {
        notes.push('Single-file model.xml project.');
    } else {
        for (const kind of ['materials', 'geometry', 'settings'] as OpenmcXmlKind[]) {
            if (!separate.some((f) => f.kind === kind)) {
                diags.push({ file: separate[0].path, line: 0, startCol: 0, endCol: 1, message: `No ${kind}.xml in this directory — OpenMC needs materials, geometry and settings (or a model.xml).`, severity: 'error', code: 'workspace.missing-file' });
            }
        }
    }

    // Geometry sanity on the model OpenMC will run (quick pass).
    try {
        const geomText = active.map((f) => (f.kind === 'model' ? f.text : f.kind === 'geometry' || f.kind === 'materials' ? f.text : '')).join('\n');
        const geom = parseOpenmcGeometryXml(geomText);
        if (geom.cells.size) {
            const chk = checkGeometry(geom, { samples: 1500, seed: 7 });
            const badU = chk.universes.filter((u) => u.gapHits || u.overlapHits);
            if (chk.overlaps.length || chk.world.lost || badU.length) {
                const gf = geomFiles[0];
                diags.push(diag(gf.path, gf.text, /<geometry/i,
                    `Quick geometry sample found ${chk.overlaps.length} overlapping cell pair(s) and ${chk.world.lost} of ${chk.world.samples} points in no cell. Run "OWEN: Check Geometry" for the full report.`,
                    'warning', 'workspace.geometry-sample'));
            } else {
                verified.push(`quick geometry sample (${chk.world.samples} points): no overlaps, nothing lost`);
            }
        }
    } catch { /* geometry sanity is best effort */ }

    const inventory: Record<string, number> = {
        files: files.length, materials: inv.materials.size, cells: inv.cells.size, surfaces: inv.surfaces.size,
        universes: inv.universes.size, tallies: inv.tallies.size, filters: inv.filters.size, meshes: inv.meshes.size,
    };
    return { diagnostics: diags, verified, inventory, notes, summary: summarize(diags) };
}

// ---------------------------------------------------------------------------
// OpenMC Python project
// ---------------------------------------------------------------------------

function validateOpenmcPython(input: WorkspaceInput): WorkspaceReport {
    const root = path.resolve(input.rootPath);
    const dir = path.dirname(root);
    const text = readText(input, root) ?? '';
    const diags: WorkspaceDiag[] = [];
    const verified: string[] = [];
    const notes: string[] = [];
    const files: WorkspaceReport['files'] = [{ path: root, role: 'OpenMC Python model', exists: true }];

    // Local imports: `from materials import …`, `import geometry_lib as g`.
    let localImports = 0;
    for (const m of text.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm)) {
        const mod = (m[1] ?? m[2]).split('.')[0];
        if (['openmc', 'numpy', 'np', 'math', 'os', 'sys', 'json', 'pathlib', 'argparse', 'matplotlib', 'pandas', 'scipy', 'h5py', 'typing', 'dataclasses', 'collections', 'itertools', 'functools', 'shutil', 'subprocess', 'time', 'datetime', 're', 'csv', 'logging', 'copy', 'random'].includes(mod)) continue;
        const candidates = [path.join(dir, `${mod}.py`), path.join(dir, mod, '__init__.py')];
        const hit = candidates.find((c) => input.fs.exists(c));
        if (hit) { files.push({ path: hit, role: `imported module ${mod}`, exists: true }); localImports++; }
        else if (input.fs.exists(path.join(dir, mod)) || /^[a-z_]\w*$/.test(mod) && text.includes(`${mod}.`)) {
            // Only flag when it looks local (lower-case module next to the deck would be the convention).
            if (!input.fs.exists(path.join(dir, mod))) {
                diags.push(diag(root, text, new RegExp(`^\\s*(from\\s+${escapeRe(mod)}\\b|import\\s+${escapeRe(mod)}\\b)`, 'm'), `Module '${mod}' is not a standard library, not openmc, and not a file next to this deck; if it is a local module the run will fail with ImportError.`, 'information', 'workspace.import-unresolved'));
            }
        }
    }
    if (localImports) verified.push(`${localImports} local module import(s) resolve to files`);

    // cross_sections path literal.
    for (const m of text.matchAll(/cross_sections\s*=\s*["']([^"']+)["']/g)) {
        const p = m[1];
        if (/^[A-Za-z]:[\\/]|^\//.test(p) && !input.fs.exists(p)) {
            diags.push(diag(root, text, new RegExp(escapeRe(m[0])), `cross_sections path does not exist on this machine: ${p}`, 'warning', 'workspace.cross-sections-missing'));
        } else if (/^[A-Za-z]:[\\/]|^\//.test(p)) verified.push('cross_sections.xml path exists');
    }

    // Exported XML next to the deck.
    const xmlFiles: XmlFile[] = [];
    for (const name of ['model.xml', 'materials.xml', 'geometry.xml', 'settings.xml', 'tallies.xml']) {
        const p = path.join(dir, name);
        if (!input.fs.exists(p)) continue;
        const t = readText(input, p) ?? '';
        const kind = detectOpenmcXmlKind(t);
        if (kind) xmlFiles.push({ path: p, kind, text: t });
    }
    let inventory: Record<string, number> = { files: files.length };
    if (xmlFiles.length) {
        const sub = validateOpenmcXmlProject(xmlFiles, input.fs);
        diags.push(...sub.diagnostics);
        verified.push(...sub.verified.map((v) => `exported XML: ${v}`));
        notes.push(...sub.notes);
        inventory = { ...inventory, ...sub.inventory, files: files.length + xmlFiles.length };
        for (const f of xmlFiles) files.push({ path: f.path, role: `exported ${f.kind}.xml`, exists: true });
        const stale = xmlFiles.filter((f) => input.fs.mtime(f.path) + 1000 < input.fs.mtime(root));
        if (stale.length) {
            diags.push(diag(root, text, /import\s+openmc/, `The deck is newer than its exported ${stale.map((f) => path.basename(f.path)).join(', ')} — re-run the export before trusting them (Render/Verify with OpenMC read the deck, not these).`, 'information', 'workspace.export-stale'));
        }
    } else {
        notes.push('No exported XML next to this deck; the Python builds the model at run time. Export once (model.export_to_model_xml()) to have OWEN cross-check the XML too.');
    }
    return { language: 'openmc', root, files, diagnostics: diags, verified, inventory, notes, summary: summarize(diags) };
}

// ---------------------------------------------------------------------------
// MCNP project (root + read/copy includes)
// ---------------------------------------------------------------------------

function validateMcnp(input: WorkspaceInput): WorkspaceReport {
    const root = path.resolve(input.rootPath);
    const result = validateMcnpProject({ rootPath: root, warnUnused: true, fileOverrides: input.overrides });
    const diags: WorkspaceDiag[] = result.diagnostics.map((d) => ({
        file: d.file, line: d.line, startCol: d.startCol, endCol: d.endCol, message: d.message,
        severity: d.severity === 'hint' ? 'hint' : d.severity, code: d.code,
    }));
    const files = result.files.map((f) => ({ path: f, role: f === root ? 'root deck' : 'read/copy include', exists: input.fs.exists(f) }));
    const verified: string[] = [];
    if (result.files.length > 1) verified.push(`${result.files.length - 1} include file(s) found and read`);
    if (!diags.some((d) => d.code.includes('undefined') || d.code.includes('duplicate'))) {
        verified.push('cells, surfaces, materials, universes and transforms resolve across all files with no duplicates');
    }
    const notes = result.files.length === 1
        ? ['Single-file deck (no read/copy cards). Per-file rules already run in the editor; this pass adds the cross-file symbol table.']
        : [];
    return { language: 'mcnp', root, files, diagnostics: diags, verified, inventory: { files: result.files.length }, notes, summary: summarize(diags) };
}

// ---------------------------------------------------------------------------
// Serpent project (include cards, acelib, mat/therm references)
// ---------------------------------------------------------------------------

function serpentCards(text: string): { kind: string; tokens: string[]; index: number }[] {
    const clean = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/%[^\n]*/g, (m) => ' '.repeat(m.length));
    const KEYWORDS = /^(surf|cell|lat|pin|trans|mat|therm|set|include|plot|mesh|det|nest|dtrans|src|wwin|ene|div|branch|coef|mix)\b/i;
    const out: { kind: string; tokens: string[]; index: number }[] = [];
    let cur: { kind: string; tokens: string[]; index: number } | null = null;
    let offset = 0;
    for (const line of clean.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && KEYWORDS.test(trimmed)) {
            if (cur) out.push(cur);
            const toks = trimmed.split(/\s+/);
            cur = { kind: toks[0].toLowerCase(), tokens: toks, index: offset + line.indexOf(trimmed) };
        } else if (cur && trimmed) {
            cur.tokens.push(...trimmed.split(/\s+/));
        }
        offset += line.length + 1;
    }
    if (cur) out.push(cur);
    return out;
}

function validateSerpent(input: WorkspaceInput): WorkspaceReport {
    const root = path.resolve(input.rootPath);
    const dir = path.dirname(root);
    const diags: WorkspaceDiag[] = [];
    const verified: string[] = [];
    const notes: string[] = [];
    const files: WorkspaceReport['files'] = [];
    const texts = new Map<string, string>();

    // Resolve includes recursively.
    const visit = (p: string, role: string): void => {
        const abs = path.resolve(p);
        if (texts.has(abs)) return;
        const t = readText(input, abs);
        files.push({ path: abs, role, exists: t !== null });
        if (t === null) return;
        texts.set(abs, t);
        for (const c of serpentCards(t)) {
            if (c.kind !== 'include') continue;
            const target = (c.tokens[1] ?? '').replace(/^["']|["']$/g, '');
            if (!target) continue;
            const resolved = path.isAbsolute(target) ? target : path.resolve(path.dirname(abs), target);
            if (!input.fs.exists(resolved)) {
                diags.push(diag(abs, t, new RegExp(`include\\s+["']?${escapeRe(target)}`), `include "${target}" not found (looked for ${resolved}).`, 'error', 'workspace.include-missing'));
                files.push({ path: resolved, role: `included by ${path.basename(abs)}`, exists: false });
                continue;
            }
            visit(resolved, `included by ${path.basename(abs)}`);
        }
    };
    visit(root, 'root deck');
    if (files.length > 1) verified.push(`${files.filter((f) => f.exists).length - 1} include file(s) found and read`);

    const all = [...texts.entries()];
    const joined = all.map(([, t]) => t).join('\n');
    const cards = all.flatMap(([p, t]) => serpentCards(t).map((c) => ({ ...c, file: p, text: t })));

    const mats = new Set<string>(), therms = new Set<string>(), surfs = new Set<string>();
    const universes = new Set<string>(['0']);
    for (const c of cards) {
        if (c.kind === 'mat' || c.kind === 'mix') mats.add(c.tokens[1]);
        if (c.kind === 'therm') therms.add(c.tokens[1]);
        if (c.kind === 'surf') surfs.add(c.tokens[1]);
        if (c.kind === 'cell' && c.tokens[2]) universes.add(c.tokens[2]);
        if (c.kind === 'pin' || c.kind === 'lat' || c.kind === 'nest') universes.add(c.tokens[1]);
    }
    let matRefs = 0, uniRefs = 0, surfRefs = 0, thermRefs = 0;
    for (const c of cards) {
        const at = new RegExp(`^\\s*${c.kind}\\s+${escapeRe(c.tokens[1] ?? '')}\\b`, 'm');
        if (c.kind === 'cell') {
            const what = c.tokens[3];
            if (what && !/^(fill|void|outside)$/i.test(what)) {
                matRefs++;
                if (!mats.has(what)) diags.push(diag(c.file, c.text, at, `Cell ${c.tokens[1]} uses material "${what}", but no mat/mix card defines it.`, 'error', 'workspace.unknown-material'));
            }
            const regionStart = /^fill$/i.test(what ?? '') ? 5 : 4;
            if (/^fill$/i.test(what ?? '')) {
                uniRefs++;
                if (c.tokens[4] && !universes.has(c.tokens[4])) diags.push(diag(c.file, c.text, at, `Cell ${c.tokens[1]} fills universe "${c.tokens[4]}", which no cell/pin/lat defines.`, 'error', 'workspace.unknown-universe'));
            }
            for (const tok of c.tokens.slice(regionStart)) {
                const m = /^[-+]?([A-Za-z_][\w.]*)$/.exec(tok);
                if (!m || /^(#|:|\(|\))$/.test(tok)) continue;
                surfRefs++;
                if (!surfs.has(m[1])) diags.push(diag(c.file, c.text, at, `Cell ${c.tokens[1]} uses surface "${m[1]}", which no surf card defines.`, 'error', 'workspace.unknown-surface'));
            }
        } else if (c.kind === 'pin') {
            for (let i = 2; i < c.tokens.length; i += 2) {
                const m = c.tokens[i];
                if (!m) break;
                if (/^fill$/i.test(m)) { uniRefs++; if (c.tokens[i + 1] && !universes.has(c.tokens[i + 1])) diags.push(diag(c.file, c.text, at, `Pin ${c.tokens[1]} fills universe "${c.tokens[i + 1]}", which is not defined.`, 'error', 'workspace.unknown-universe')); i++; continue; }
                matRefs++;
                if (!mats.has(m) && m !== 'void') diags.push(diag(c.file, c.text, at, `Pin ${c.tokens[1]} ring uses material "${m}", but no mat card defines it.`, 'error', 'workspace.unknown-material'));
            }
        } else if (c.kind === 'lat') {
            const type = parseInt(c.tokens[2] ?? '', 10);
            const start = type === 9 ? 3 : 8;
            for (const u of new Set(c.tokens.slice(start).filter((t) => !/^[-+]?[\d.eE]+$/.test(t) || (type !== 9 && universes.has(t))))) {
                if (/^[-+]?[\d.]+(e[-+]?\d+)?$/i.test(u) && !universes.has(u)) continue; // numeric pitch/coords
                uniRefs++;
                if (!universes.has(u)) diags.push(diag(c.file, c.text, at, `Lattice ${c.tokens[1]} places universe "${u}", which is not defined.`, 'error', 'workspace.unknown-universe'));
            }
        } else if (c.kind === 'mat') {
            const mi = c.tokens.findIndex((t) => /^moder$/i.test(t));
            if (mi >= 0 && c.tokens[mi + 1]) {
                thermRefs++;
                if (!therms.has(c.tokens[mi + 1])) diags.push(diag(c.file, c.text, at, `Material ${c.tokens[1]} names thermal scattering "${c.tokens[mi + 1]}", but no therm card defines it.`, 'error', 'workspace.unknown-therm'));
            }
        } else if (c.kind === 'set') {
            const key = (c.tokens[1] ?? '').toLowerCase();
            if (key === 'acelib' || key === 'declib' || key === 'nfylib' || key === 'sfylib') {
                const p = (c.tokens[2] ?? '').replace(/^["']|["']$/g, '');
                const resolved = path.isAbsolute(p) ? p : path.resolve(dir, p);
                if (p && !input.fs.exists(resolved)) {
                    diags.push(diag(c.file, c.text, new RegExp(`set\\s+${key}\\b`, 'i'), `set ${key} "${p}" does not exist on this machine (looked for ${resolved}).`, 'warning', 'workspace.library-missing'));
                } else if (p) verified.push(`set ${key} points at an existing file`);
            }
        }
    }
    if (matRefs) verified.push(`${matRefs} cell/pin→material references resolve`);
    if (surfRefs) verified.push(`${surfRefs} cell→surface references resolve`);
    if (uniRefs) verified.push(`${uniRefs} fill/lattice→universe references resolve`);
    if (thermRefs) verified.push(`${thermRefs} moder→therm references resolve`);
    if (!cards.some((c) => c.kind === 'set' && /^pop$/i.test(c.tokens[1] ?? ''))) {
        diags.push(diag(root, texts.get(root) ?? '', /^/, 'No "set pop" card in the project — Serpent needs the population and cycle counts.', 'warning', 'workspace.no-pop'));
    }
    // Materials nobody uses.
    const used = new Set<string>();
    for (const c of cards) {
        if (c.kind === 'cell' && c.tokens[3]) used.add(c.tokens[3]);
        if (c.kind === 'pin') for (let i = 2; i < c.tokens.length; i += 2) used.add(c.tokens[i]);
        if (c.kind === 'mix') for (let i = 2; i < c.tokens.length; i += 2) used.add(c.tokens[i]);
    }
    for (const c of cards) {
        if (c.kind === 'mat' && !used.has(c.tokens[1])) {
            diags.push(diag(c.file, c.text, new RegExp(`^\\s*mat\\s+${escapeRe(c.tokens[1])}\\b`, 'm'), `Material ${c.tokens[1]} is defined but no cell or pin uses it.`, 'hint', 'workspace.unused-material'));
        }
    }
    // Quick geometry sample.
    try {
        const geom = parseSerpentGeometry(joined);
        if (geom.cells.size) {
            const chk = checkGeometry(geom, { samples: 1500, seed: 7 });
            if (chk.overlaps.length || chk.world.lost) {
                diags.push(diag(root, texts.get(root) ?? '', /^/, `Quick geometry sample found ${chk.overlaps.length} overlapping cell pair(s) and ${chk.world.lost} of ${chk.world.samples} points in no cell. Run "OWEN: Check Geometry".`, 'warning', 'workspace.geometry-sample'));
            } else verified.push(`quick geometry sample (${chk.world.samples} points): no overlaps, nothing lost`);
        }
    } catch { /* best effort */ }
    const inventory = { files: texts.size, materials: mats.size, surfaces: surfs.size, universes: universes.size - 1, cells: cards.filter((c) => c.kind === 'cell').length };
    return { language: 'serpent', root, files, diagnostics: diags, verified, inventory, notes, summary: summarize(diags) };
}

// ---------------------------------------------------------------------------
// SCONE input (single file; library path, material and universe references)
// ---------------------------------------------------------------------------

function validateScone(input: WorkspaceInput): WorkspaceReport {
    const root = path.resolve(input.rootPath);
    const dir = path.dirname(root);
    const text = readText(input, root) ?? '';
    const clean = text.replace(/!.*$/gm, (m) => ' '.repeat(m.length));
    const diags: WorkspaceDiag[] = [];
    const verified: string[] = [];
    const notes: string[] = [];
    const files: WorkspaceReport['files'] = [{ path: root, role: 'SCONE input', exists: true }];

    // ACE library path.
    for (const m of clean.matchAll(/\baceLibrary\s+([^;\s]+)\s*;/g)) {
        const p = m[1].replace(/^["']|["']$/g, '');
        const resolved = path.isAbsolute(p) ? p : path.resolve(dir, p);
        if (!input.fs.exists(resolved) && !/^\//.test(p)) {
            diags.push(diag(root, text, new RegExp(`aceLibrary\\s+${escapeRe(m[1])}`), `aceLibrary "${p}" does not exist here (looked for ${resolved}). A POSIX path is fine if SCONE runs under WSL.`, 'warning', 'workspace.library-missing'));
        } else if (input.fs.exists(resolved)) { verified.push('aceLibrary points at an existing file'); files.push({ path: resolved, role: 'ACE library index', exists: true }); }
        else notes.push(`aceLibrary "${p}" is a POSIX path; not checked from Windows (SCONE runs under WSL).`);
    }

    // Blocks.
    const sectionBody = (name: string): string => {
        const m = new RegExp(`\\b${name}\\s*\\{`).exec(clean);
        if (!m) return '';
        let depth = 0;
        for (let i = m.index + m[0].length - 1; i < clean.length; i++) {
            if (clean[i] === '{') depth++;
            else if (clean[i] === '}') { depth--; if (depth === 0) return clean.slice(m.index + m[0].length, i); }
        }
        return '';
    };
    const topNames = (body: string): string[] => {
        const out: string[] = [];
        let depth = 0, start = -1;
        for (let i = 0; i < body.length; i++) {
            const ch = body[i];
            if (ch === '{') { if (depth === 0) { const head = body.slice(start < 0 ? 0 : start, i).trim().split(/\s+/); out.push(head[head.length - 1]); } depth++; }
            else if (ch === '}') { depth--; if (depth === 0) start = i + 1; }
        }
        return out.filter(Boolean);
    };
    const matBody = sectionBody('materials');
    const materials = new Set(topNames(matBody));
    const geomBody = sectionBody('geometry') || clean;
    const surfaceIds = new Set([...(sectionBody('surfaces') || '').matchAll(/\bid\s+(\d+)\s*;/g)].map((m) => m[1]));
    const cellIds = new Set([...(sectionBody('cells') || '').matchAll(/\bid\s+(\d+)\s*;/g)].map((m) => m[1]));
    const uniBody = sectionBody('universes');
    const universeIds = new Set([...uniBody.matchAll(/\bid\s+(\d+)\s*;/g)].map((m) => m[1]));
    void geomBody;

    let matRefs = 0, uniRefs = 0, surfRefs = 0, cellRefs = 0;
    const usedMats = new Set<string>();
    const flagMat = (name: string, where: string): void => {
        if (!name || /^u<\d+>$/.test(name)) return;
        matRefs++;
        usedMats.add(name);
        if (materials.size && !materials.has(name)) {
            diags.push(diag(root, text, new RegExp(`\\b${escapeRe(name)}\\b`), `${where} uses material "${name}", which is not defined in materials { }.`, 'error', 'workspace.unknown-material'));
        }
    };
    const flagUni = (id: string, where: string): void => {
        uniRefs++;
        if (!universeIds.has(id)) diags.push(diag(root, text, new RegExp(`u<\\s*${escapeRe(id)}\\s*>`), `${where} fills universe u<${id}>, which is not defined in universes { }.`, 'error', 'workspace.unknown-universe'));
    };
    for (const m of (sectionBody('cells') || '').matchAll(/\bmaterial\s+(\S+?)\s*;/g)) flagMat(m[1], 'A cell');
    for (const m of (sectionBody('cells') || '').matchAll(/\bsurfaces\s*\(([^)]*)\)/g)) {
        for (const tok of m[1].trim().split(/\s+/).filter(Boolean)) {
            const id = tok.replace(/^[-+]/, '');
            if (!/^\d+$/.test(id)) continue;
            surfRefs++;
            if (!surfaceIds.has(id)) diags.push(diag(root, text, new RegExp(`surfaces\\s*\\([^)]*\\b${escapeRe(tok)}\\b`), `A cell uses surface ${id}, which is not defined in surfaces { }.`, 'error', 'workspace.unknown-surface'));
        }
    }
    for (const m of (sectionBody('cells') || '').matchAll(/\buniverse\s+(\d+)\s*;/g)) flagUni(m[1], 'A cell');
    for (const m of uniBody.matchAll(/\bfills\s*\(([^)]*)\)/g)) {
        for (const tok of m[1].trim().split(/\s+/).filter(Boolean)) {
            const u = /^u<\s*(\d+)\s*>$/.exec(tok);
            if (u) flagUni(u[1], 'A pinUniverse'); else flagMat(tok, 'A pinUniverse');
        }
    }
    for (const m of uniBody.matchAll(/\bpadMat\s+(\S+?)\s*;/g)) flagMat(m[1], 'A latUniverse');
    for (const m of uniBody.matchAll(/\bfill\s+u<\s*(\d+)\s*>\s*;/g)) flagUni(m[1], 'The rootUniverse');
    for (const m of uniBody.matchAll(/\bfill\s+([A-Za-z_]\w*)\s*;/g)) flagMat(m[1], 'The rootUniverse');
    for (const m of uniBody.matchAll(/\bmap\s*\(([^)]*)\)/g)) {
        for (const id of new Set(m[1].trim().split(/\s+/).filter(Boolean))) flagUni(id, 'A latUniverse map');
    }
    for (const m of uniBody.matchAll(/\bcells\s*\(([^)]*)\)/g)) {
        for (const id of m[1].trim().split(/\s+/).filter(Boolean)) {
            cellRefs++;
            if (!cellIds.has(id)) diags.push(diag(root, text, new RegExp(`cells\\s*\\([^)]*\\b${escapeRe(id)}\\b`), `A cellUniverse lists cell ${id}, which is not defined in cells { }.`, 'error', 'workspace.unknown-cell'));
        }
    }
    if (matRefs) verified.push(`${matRefs} material references resolve to materials { }`);
    if (surfRefs) verified.push(`${surfRefs} cell→surface references resolve`);
    if (cellRefs) verified.push(`${cellRefs} cellUniverse→cell references resolve`);
    if (uniRefs) verified.push(`${uniRefs} universe references resolve`);
    for (const name of materials) {
        if (!usedMats.has(name)) diags.push(diag(root, text, new RegExp(`\\b${escapeRe(name)}\\s*\\{`), `Material ${name} is defined but nothing uses it.`, 'hint', 'workspace.unused-material'));
    }
    if (!/\brootUniverse\b/.test(clean)) diags.push(diag(root, text, /universes/, 'No rootUniverse in universes { } — SCONE cannot start.', 'error', 'workspace.no-root'));
    try {
        const geom = parseSconeGeometry(text);
        if (geom.cells.size) {
            const chk = checkGeometry(geom, { samples: 1500, seed: 7, overlapSemantics: 'first-wins' });
            if (chk.world.lost) {
                diags.push(diag(root, text, /^/, `Quick geometry sample found ${chk.world.lost} of ${chk.world.samples} points in no cell. Run "OWEN: Check Geometry".`, 'warning', 'workspace.geometry-sample'));
            } else verified.push(`quick geometry sample (${chk.world.samples} points): nothing lost`);
            if (chk.overlaps.length) {
                const names = geom.names?.cells;
                const pairs = chk.overlaps.slice(0, 4).map((o) => `${names?.get(o.a) ?? o.a} & ${names?.get(o.b) ?? o.b}`).join(', ');
                diags.push(diag(root, text, /\bcells\s*\{/, `${chk.overlaps.length} cell pair(s) overlap (${pairs}${chk.overlaps.length > 4 ? ', …' : ''}). SCONE takes the first listed cell, so this is legal, but the later cell's region as written is not its region as run. "OWEN: Check Geometry" lists them.`, 'information', 'workspace.geometry-shadowed'));
            }
        }
    } catch { /* best effort */ }
    notes.push('SCONE inputs are single files; this pass checks the library path and that every material, surface, cell and universe named in one block exists in another.');
    const inventory = { files: 1, materials: materials.size, surfaces: surfaceIds.size, cells: cellIds.size, universes: universeIds.size };
    return { language: 'scone', root, files, diagnostics: diags, verified, inventory, notes, summary: summarize(diags) };
}

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------

/** OpenMC XML: every recognised XML file in the deck's directory is the project. */
export function collectOpenmcXmlProject(input: WorkspaceInput): XmlFile[] {
    const dir = path.dirname(path.resolve(input.rootPath));
    const out: XmlFile[] = [];
    for (const name of input.fs.list(dir)) {
        if (!/\.xml$/i.test(name)) continue;
        const p = path.join(dir, name);
        const t = readText(input, p);
        if (t === null) continue;
        const kind = detectOpenmcXmlKind(t);
        if (kind) out.push({ path: p, kind, text: t });
    }
    return out;
}

export function validateWorkspace(input: WorkspaceInput): WorkspaceReport {
    switch (input.language) {
        case 'mcnp': return validateMcnp(input);
        case 'serpent': return validateSerpent(input);
        case 'scone': return validateScone(input);
        case 'openmc': return validateOpenmcPython(input);
        case 'openmc-xml': {
            const files = collectOpenmcXmlProject(input);
            const sub = validateOpenmcXmlProject(files, input.fs);
            return {
                language: 'openmc-xml', root: path.resolve(input.rootPath),
                files: files.map((f) => ({ path: f.path, role: `${f.kind}.xml`, exists: true })),
                ...sub,
            };
        }
    }
}
