/**
 * Pre-insert checks for the OWEN Input Builder.
 *
 * Two layers, deliberately:
 *   1. The language rules (`runLanguageRules`) read the assembled text, exactly
 *      as they do for a saved file, so the builder cannot ship something the
 *      editor would immediately flag.
 *   2. Model checks read the *sections*, which is where the mistakes the text
 *      cannot show up in live: a lattice pitch smaller than the pin it is filled
 *      with, a tally on a cell whose volume MCNP cannot compute, a material
 *      referenced by a pin but never defined, a missing graveyard.
 *
 * Severity is a judgement about consequence, not confidence: `error` means the
 * deck as built will not run, `warning` means it runs but probably does not
 * model what was intended, `info` is a fact worth knowing.
 */

import { MCNP_LEGACY_LINE_LIMIT, MCNP_MODERN_LINE_LIMIT } from '../decorations/lineLength';
import {
    type DeckDocument,
    type DeckModel,
    type DeckSection,
    type LatticeSection,
    type PinCellSection,
    sectionLabel,
} from './deckModel';
import { validateSnippet } from './snippetValidator';

export type CheckSeverity = 'error' | 'warning' | 'info';

export interface DeckCheck {
    severity: CheckSeverity;
    message: string;
    /** Section the problem belongs to, when it is attributable. */
    sectionId?: string;
    /** 0-based line in the assembled deck. */
    line?: number;
    /** Where the check came from: a model rule or the language rules. */
    origin: 'model' | 'rules';
    code?: string;
}

function enabled(model: DeckModel): DeckSection[] {
    return model.sections.filter((s) => s.enabled !== false);
}

function outerRadius(section: PinCellSection): number {
    return section.layers.reduce((m, l) => Math.max(m, l.outerRadius), 0);
}

/** Material keys any geometry section refers to, with the referring section. */
function materialRefs(model: DeckModel): { key: string; sectionId: string }[] {
    const out: { key: string; sectionId: string }[] = [];
    for (const s of enabled(model)) {
        if (s.kind !== 'pincell') continue;
        for (const l of s.layers) out.push({ key: l.material, sectionId: s.id });
        out.push({ key: s.outerMaterial, sectionId: s.id });
    }
    return out;
}

function definedMaterialKeys(model: DeckModel): Set<string> {
    const keys = new Set<string>();
    for (const s of enabled(model)) {
        if (s.kind === 'materials') for (const e of s.entries) keys.add(e.key);
    }
    return keys;
}

/** Duplicated leading ids in a card-image block (MCNP cells / surfaces). */
function duplicateIds(lines: string[], indices: number[]): Map<number, number[]> {
    const seen = new Map<number, number[]>();
    for (const i of indices) {
        const m = /^\s*(\d+)\s/.exec(lines[i]);
        if (!m) continue;
        const id = Number(m[1]);
        const at = seen.get(id) ?? [];
        at.push(i);
        seen.set(id, at);
    }
    const dups = new Map<number, number[]>();
    for (const [id, at] of seen) if (at.length > 1) dups.set(id, at);
    return dups;
}

/** Whether the assembled deck defines the cell a tally names. */
/** First character outside printable ASCII (tab, LF and CR allowed), or null. */
function firstNonAscii(line: string): string | null {
    for (const ch of line) {
        const c = ch.codePointAt(0) ?? 0;
        if (c === 9 || c === 10 || c === 13) continue;
        if (c < 0x20 || c > 0x7e) return ch;
    }
    return null;
}

function definesCell(doc: DeckDocument, code: DeckModel['code'], id: number): boolean {
    if (code === 'openmc') return new RegExp(`cell_id=${id}\\b`).test(doc.text);
    return doc.lines.some((l) => new RegExp(`^\\s*${id}\\s+(\\d+|like)\\b`, 'i').test(l));
}

export function checkDeck(model: DeckModel, doc: DeckDocument): DeckCheck[] {
    const checks: DeckCheck[] = [];
    const add = (severity: CheckSeverity, message: string, extra: Partial<DeckCheck> = {}) => {
        checks.push({ severity, message, origin: 'model', ...extra });
    };
    const sections = enabled(model);
    const byId = new Map(model.sections.map((s) => [s.id, s]));

    // --- structure: is this a deck at all? -------------------------------
    const geometry = sections.filter((s) => s.kind === 'pincell' || s.kind === 'lattice' || s.kind === 'cell' || s.kind === 'boundary');
    if (geometry.length === 0) {
        add('error', 'No geometry sections: the deck has nothing to transport particles in. Add a pin cell, a lattice, or a cell.');
    }
    if (!sections.some((s) => s.kind === 'run')) {
        add('error', 'No run section: the deck has no source and no cycle counts, so it cannot execute. Add a Run section.');
    }
    const materialSections = sections.filter((s) => s.kind === 'materials');
    if (materialSections.length === 0) {
        add('error', 'No materials: every fillable region would be void. Add a Materials section.');
    }

    // --- references ------------------------------------------------------
    const defined = definedMaterialKeys(model);
    for (const ref of materialRefs(model)) {
        if (ref.key && !defined.has(ref.key)) {
            add('error',
                `${sectionLabel(byId.get(ref.sectionId) ?? sections[0])} fills a region with "${ref.key}", which no Materials section defines.`,
                { sectionId: ref.sectionId });
        }
    }

    // --- pin cells -------------------------------------------------------
    for (const s of sections) {
        if (s.kind !== 'pincell') continue;
        const radii = s.layers.map((l) => l.outerRadius);
        for (let i = 1; i < radii.length; i++) {
            if (radii[i] <= radii[i - 1]) {
                add('error',
                    `${sectionLabel(s)}: layer radii must increase outward — ${radii[i - 1]} cm is followed by ${radii[i]} cm, so the two shells overlap.`,
                    { sectionId: s.id });
                break;
            }
        }
        const or = outerRadius(s);
        if (s.pitch > 0 && or > 0 && s.pitch < 2 * or) {
            add('error',
                `${sectionLabel(s)}: pitch ${s.pitch} cm is narrower than the pin diameter ${(2 * or).toFixed(4)} cm — the clad crosses the cell boundary.`,
                { sectionId: s.id });
        }
        if (s.zMax <= s.zMin) {
            add('error', `${sectionLabel(s)}: axial extent is empty (z from ${s.zMin} to ${s.zMax}).`, { sectionId: s.id });
        }
    }

    // --- lattices --------------------------------------------------------
    const latticeById = new Map<string, LatticeSection>();
    for (const s of sections) {
        if (s.kind !== 'lattice') continue;
        latticeById.set(s.id, s);
        if (s.grid.length !== s.ny || s.grid.some((row) => row.length !== s.nx)) {
            add('error',
                `${sectionLabel(s)}: the painted map is ${s.grid.length} row(s) of ${s.grid[0]?.length ?? 0}, but the lattice is declared ${s.ny}×${s.nx}.`,
                { sectionId: s.id });
        }
        const palette = new Set(s.pins.map((p) => p.id));
        const painted = new Set<number>();
        for (const row of s.grid) for (const v of row) painted.add(v);
        for (const v of painted) {
            if (!palette.has(v)) {
                add('error', `${sectionLabel(s)}: position type ${v} is painted into the map but is not in the pin palette.`, { sectionId: s.id });
            }
        }
        for (const p of s.pins) {
            if (!p.pincellId) continue;
            const pin = byId.get(p.pincellId);
            if (!pin || pin.kind !== 'pincell') {
                add('error', `${sectionLabel(s)}: palette entry "${p.label}" points at a pin cell that is no longer in the deck.`, { sectionId: s.id });
                continue;
            }
            const or = outerRadius(pin);
            if (or > 0 && s.pitch < 2 * or) {
                add('error',
                    `${sectionLabel(s)}: lattice pitch ${s.pitch} cm is narrower than "${pin.name}" (${(2 * or).toFixed(4)} cm across) — neighbouring pins would intersect.`,
                    { sectionId: s.id });
            }
            if (pin.universe === undefined) {
                add('warning',
                    `${sectionLabel(s)}: "${pin.name}" has no universe number, so the lattice fill cannot reference it. Set a universe on the pin cell.`,
                    { sectionId: pin.id });
            }
        }
        // Duplicate universe numbers across palette entries silently collapse
        // two pin types into one.
        const seen = new Map<number, string>();
        for (const p of s.pins) {
            const prev = seen.get(p.universe);
            if (prev !== undefined) {
                add('error', `${sectionLabel(s)}: "${p.label}" and "${prev}" both use universe ${p.universe}.`, { sectionId: s.id });
            }
            seen.set(p.universe, p.label);
        }
    }

    // --- boundary --------------------------------------------------------
    const boundaries = sections.filter((s) => s.kind === 'boundary');
    if (boundaries.length > 1) {
        add('warning', `${boundaries.length} boundary sections: only the outermost one can bound the deck.`, { sectionId: boundaries[1].id });
    }
    for (const s of boundaries) {
        if (s.kind !== 'boundary') continue;
        if (s.zMax <= s.zMin) {
            add('error', `${sectionLabel(s)}: axial extent is empty (z from ${s.zMin} to ${s.zMax}).`, { sectionId: s.id });
        }
        if (s.fillLatticeId && !latticeById.has(s.fillLatticeId)) {
            add('error', `${sectionLabel(s)}: fills with a lattice that is not in the deck.`, { sectionId: s.id });
        }
        const lat = s.fillLatticeId ? latticeById.get(s.fillLatticeId) : undefined;
        if (lat) {
            const span = Math.max(lat.nx, lat.ny) * lat.pitch / 2;
            // A boundary exactly on the outer pin edge is the normal reflective
            // unit cell, not a clipped lattice, so only flag a real shortfall.
            if (s.shape !== 'sphere' && s.size < span - 1e-6) {
                add('warning',
                    `${sectionLabel(s)}: the boundary half-size ${s.size} cm cuts the ${lat.nx}×${lat.ny} lattice, which reaches ${span.toFixed(2)} cm.`,
                    { sectionId: s.id });
            }
        }
        if (s.bc === 'reflective' && s.shape === 'cylinder') {
            add('warning',
                `${sectionLabel(s)}: specular reflection off a curved surface conserves the impact parameter, so tangential neutrons circulate forever. A Wigner–Seitz equivalent cylinder needs a white boundary.`,
                { sectionId: s.id });
        }
    }

    // A lattice that is never filled is legal MCNP and a wrong model: the map
    // is written, the outer cell still fills the pin, and the 17×17 is dead.
    const filledLatticeIds = new Set(
        boundaries
            .filter((b): b is Extract<typeof b, { kind: 'boundary' }> => b.kind === 'boundary' && Boolean(b.fillLatticeId))
            .map((b) => b.fillLatticeId as string),
    );
    if (latticeById.size > 0 && boundaries.length === 0) {
        add('error', 'A lattice has no outer boundary to fill it, so the map is never placed in the problem. Add a Boundary section.');
    } else if (latticeById.size > 0 && filledLatticeIds.size === 0 && boundaries.length > 0) {
        const firstLat = [...latticeById.values()][0];
        add('error',
            `${sectionLabel(firstLat)} is in the deck but the boundary still fills the pin cell, so MCNP never transports the map. Set Fill with lattice on the Boundary section.`,
            { sectionId: firstLat.id });
    }
    for (const lat of latticeById.values()) {
        if (filledLatticeIds.size > 0 && !filledLatticeIds.has(lat.id)) {
            add('warning',
                `${sectionLabel(lat)} is never filled into the boundary, so its map is not in the problem.`,
                { sectionId: lat.id });
        }
    }

    // --- run / source ----------------------------------------------------
    for (const s of sections) {
        if (s.kind !== 'run') continue;
        if (s.particles <= 0) add('error', `${sectionLabel(s)}: particle count must be positive.`, { sectionId: s.id });
        if (s.mode === 'eigenvalue') {
            if (s.active <= 0) add('error', `${sectionLabel(s)}: an eigenvalue run needs at least one active cycle.`, { sectionId: s.id });
            if (s.inactive < 10) {
                add('warning',
                    `${sectionLabel(s)}: ${s.inactive} inactive cycles is unlikely to converge the fission source; 50+ is typical for a full core.`,
                    { sectionId: s.id });
            }
            const bounded = boundaries.find((b) => b.kind === 'boundary');
            if (bounded && bounded.kind === 'boundary') {
                const [x, y, z] = s.source;
                const radial = bounded.shape === 'box' ? Math.max(Math.abs(x), Math.abs(y)) : Math.hypot(x, y);
                if (radial > bounded.size || z < bounded.zMin || z > bounded.zMax) {
                    add('error',
                        `${sectionLabel(s)}: the start point (${x}, ${y}, ${z}) lies outside the boundary — a source point must sit inside a cell.`,
                        { sectionId: s.id });
                }
            }
            if (bounded && bounded.kind === 'boundary' && bounded.bc === 'reflective') {
                add('info',
                    'Every face is reflective, so this run reports k∞ for an infinite lattice rather than k_eff for a finite reactor.',
                    { sectionId: bounded.id });
            }
        }
    }

    // --- tallies ---------------------------------------------------------
    const inUniverse = sections.some((s) => (s.kind === 'pincell' && s.universe !== undefined) || s.kind === 'lattice');
    for (const s of sections) {
        if (s.kind !== 'tally') continue;
        if (s.cells.length === 0) {
            add('warning', `${sectionLabel(s)}: no cells listed, so the tally falls back to cell 10.`, { sectionId: s.id });
        }
        if (model.code === 'mcnp' && inUniverse && s.sd === undefined) {
            add('error',
                `${sectionLabel(s)}: an F4/F6 divides by cell volume, and MCNP cannot compute the volume of a cell inside a lattice or fill= universe. Set an sd divisor or move the tally to a root-level cell.`,
                { sectionId: s.id });
        }
        if (s.quantity === 'spectrum' && !s.energyBins) {
            add('warning', `${sectionLabel(s)}: a spectrum tally with no energy bins scores one integral value.`, { sectionId: s.id });
        }
        // A tally that names a cell the deck never defines is the most common way
        // a generated deck dies, and every code reports it differently.
        if (model.code === 'mcnp' || model.code === 'openmc') {
            const missing = s.cells.filter((id) => !definesCell(doc, model.code, id));
            if (missing.length) {
                add('error',
                    `${sectionLabel(s)}: cell ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} not defined anywhere in this deck.`,
                    { sectionId: s.id });
            }
        } else if (s.cells.length) {
            const how = model.code === 'scone'
                ? 'SCONE clerks bin by a map, not by cell number'
                : 'a Serpent dc bin takes a cell name, and this geometry is built from named pins';
            add('info',
                `${sectionLabel(s)}: ${how}, so the cell list is written as material bins instead.`,
                { sectionId: s.id });
        }
    }

    // --- assembled text --------------------------------------------------
    if (model.code === 'mcnp') {
        const limit = model.lineLimit === MCNP_MODERN_LINE_LIMIT ? MCNP_MODERN_LINE_LIMIT : MCNP_LEGACY_LINE_LIMIT;
        doc.lines.forEach((line, i) => {
            if (line.length > limit) {
                add('error',
                    `Line ${i + 1} is ${line.length} columns; MCNP reads only the first ${limit} of a card image in this dialect.`,
                    { line: i, sectionId: doc.owners[i] ?? undefined });
            }
            if (line.includes('\t')) {
                add('warning', `Line ${i + 1} contains a tab; MCNP column counting treats it as one character.`,
                    { line: i, sectionId: doc.owners[i] ?? undefined });
            }
        });
        if (!doc.text.includes('imp:n=0')) {
            add('error', 'No graveyard: an MCNP deck needs a cell with imp:n=0 covering everything outside the geometry.');
        }
        if (/\bkcode\b/.test(doc.text) && !/\bksrc\b/.test(doc.text) && !/\bsdef\b/.test(doc.text)) {
            add('error', 'kcode without ksrc or sdef: MCNP has no starting fission source.');
        }
        // Repeated leading ids in the cell and surface blocks.
        const cellLines: number[] = [];
        const surfLines: number[] = [];
        let inCells = true;
        let blanks = 0;
        doc.lines.forEach((line, i) => {
            if (line.trim() === '') { blanks++; return; }
            if (line.startsWith('c ') || line === 'c') return;
            if (blanks === 0) return;              // title line
            if (blanks === 1 && inCells) { cellLines.push(i); return; }
            if (blanks >= 2) { inCells = false; surfLines.push(i); }
        });
        for (const [id, at] of duplicateIds(doc.lines, cellLines)) {
            add('error', `Cell ${id} is defined ${at.length} times.`, { line: at[1], sectionId: doc.owners[at[1]] ?? undefined });
        }
        for (const [id, at] of duplicateIds(doc.lines, surfLines)) {
            add('error', `Surface ${id} is defined ${at.length} times.`, { line: at[1], sectionId: doc.owners[at[1]] ?? undefined });
        }
    }

    if (model.code === 'scone') {
        doc.lines.forEach((line, i) => {
            // SCONE's dictionary parser is ASCII-only; a pasted en dash or
            // non-breaking space fails at read time with an unhelpful message.
            const bad = firstNonAscii(line);
            if (bad !== null) {
                add('error', `Line ${i + 1} contains the non-ASCII character "${bad}"; SCONE input must be ASCII.`,
                    { line: i, sectionId: doc.owners[i] ?? undefined });
            }
        });
        // temp ↔ ZAID suffix agreement: `temp 600` needs .06 data.
        for (const s of sections) {
            if (s.kind !== 'materials') continue;
            for (const e of s.entries) {
                const temp = e.temperature;
                if (!temp || !e.custom) continue;
                const want = `.${String(Math.round(temp / 100)).padStart(2, '0')}`;
                const wrong = e.custom.components.find((c) => /\.\d\d$/.test(c.zaid) && !c.zaid.endsWith(want));
                if (wrong) {
                    add('warning',
                        `${sectionLabel(s)}: "${e.custom.name}" is declared at temp ${temp} K but ${wrong.zaid} carries a different temperature suffix (expected ${want}).`,
                        { sectionId: s.id });
                }
            }
        }
    }

    if (model.code === 'openmc' && materialSections.every((s) => s.kind === 'materials' && s.entries.length === 0)) {
        add('error', 'openmc.Materials([]) is empty: every cell would be filled with None (void).');
    }

    if (model.code === 'serpent' && !/set\s+bc/.test(doc.text)) {
        add('warning', 'No `set bc`: Serpent defaults to a black (vacuum) boundary on every surface.');
    }

    // --- language rules over the assembled text --------------------------
    for (const issue of validateSnippet(model.code, doc.text)) {
        if (issue.severity === 'hint') continue;
        checks.push({
            severity: issue.severity === 'information' ? 'info' : issue.severity,
            message: issue.message,
            line: Math.max(0, issue.line),
            sectionId: doc.owners[Math.max(0, issue.line)] ?? undefined,
            origin: 'rules',
            code: issue.code,
        });
    }

    return checks;
}

export function summarizeChecks(checks: DeckCheck[]): { errors: number; warnings: number; infos: number; text: string } {
    const errors = checks.filter((c) => c.severity === 'error').length;
    const warnings = checks.filter((c) => c.severity === 'warning').length;
    const infos = checks.filter((c) => c.severity === 'info').length;
    if (errors === 0 && warnings === 0) {
        return { errors, warnings, infos, text: 'Ready to insert — no problems found.' };
    }
    const parts: string[] = [];
    if (errors) parts.push(`${errors} problem${errors === 1 ? '' : 's'} that will stop the run`);
    if (warnings) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
    return { errors, warnings, infos, text: parts.join(' and ') };
}
