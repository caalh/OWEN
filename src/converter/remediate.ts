// Mechanical MCNP deck repairs. Only edits whose geometry already determines
// the number: an imp:n=0 complement of a single sphere, and an sd entry whose
// value is the cylinder or sphere volume of a universe cell. Anything that
// would mean inventing a density, an enrichment, or a volume is refused.

import { McnpCell, McnpDeck, McnpSurface, RegionNode, parseMcnpDeck } from './mcnpModel';

export interface RemediationEdit {
    ruleId: string;
    before: string;
    after: string;
    rationale: string;
}

export interface RemediationRefusal {
    ruleId: string;
    reason: string;
}

export interface RemediationResult {
    output: string;
    edits: RemediationEdit[];
    refused: RemediationRefusal[];
}

const PHYSICS_ASK = /owen-remediate:\s*make critical/i;

function halves(node: RegionNode | null, out: { surface: number; sense: 1 | -1 }[] = []): { surface: number; sense: 1 | -1 }[] {
    if (!node) return out;
    if (node.kind === 'half') out.push({ surface: node.surface, sense: node.sense });
    else if (node.kind === 'and' || node.kind === 'or') for (const child of node.children) halves(child, out);
    else if (node.kind === 'comp') halves(node.child, out);
    return out;
}

function surface(deck: McnpDeck, id: number): McnpSurface | undefined {
    return deck.surfaces.find((s) => s.id === id);
}

/** Volume in cm³ when the region is a sphere or a finite z-cylinder. */
export function cellVolumeCm3(cell: McnpCell, deck: McnpDeck): number | null {
    if (!cell.region || cell.region.kind === 'or' || cell.region.kind === 'comp' || cell.region.kind === 'cellcomp') return null;
    const hs = halves(cell.region);
    if (hs.length === 1 && hs[0].sense === -1) {
        const s = surface(deck, hs[0].surface);
        if (!s) return null;
        if ((s.type === 'so' || s.type === 'sph') && s.params.length >= 1) {
            const r = parseFloat(s.params[0]);
            if (r > 0) return (4 / 3) * Math.PI * r ** 3;
        }
        if (s.type === 's' && s.params.length >= 4) {
            const r = parseFloat(s.params[3]);
            if (r > 0) return (4 / 3) * Math.PI * r ** 3;
        }
    }
    const cz = hs.filter((h) => surface(deck, h.surface)?.type === 'cz' && h.sense === -1);
    const pz = hs.filter((h) => surface(deck, h.surface)?.type === 'pz');
    if (cz.length === 1 && pz.length === 2 && hs.length === 3 && pz[0].sense !== pz[1].sense) {
        const r = parseFloat(surface(deck, cz[0].surface)!.params[0]);
        const z0 = parseFloat(surface(deck, pz[0].surface)!.params[0]);
        const z1 = parseFloat(surface(deck, pz[1].surface)!.params[0]);
        const height = Math.abs(z1 - z0);
        if (r > 0 && height > 0) return Math.PI * r * r * height;
    }
    return null;
}

function insertAtFirstBlank(text: string, line: string): string {
    const lines = text.split(/\r?\n/);
    let seen = false;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim()) seen = true;
        else if (seen) {
            lines.splice(i, 0, line);
            return lines.join('\n');
        }
    }
    return `${text.replace(/\s*$/, '')}\n${line}\n`;
}

function repeated(cell: McnpCell): boolean {
    return cell.universe !== null || cell.lattice !== null;
}

/**
 * Repair a deck in place. Physics requests (`c owen-remediate: make critical`)
 * are refused even when the geometry is otherwise left untouched.
 */
export function remediateMcnp(text: string): RemediationResult {
    const edits: RemediationEdit[] = [];
    const refused: RemediationRefusal[] = [];
    if (PHYSICS_ASK.test(text)) {
        refused.push({
            ruleId: 'physics-judgement',
            reason: 'Will not edit density, enrichment, or kcode to chase criticality. A bare assembly is not made critical by changing a number.',
        });
    }

    const deck = parseMcnpDeck(text);
    let output = text.replace(/\s*$/, '\n');

    const hasGraveyard = deck.cells.some((c) => c.importanceZero);
    if (!hasGraveyard) {
        const spheres = deck.surfaces.filter((s) => s.type === 'so' || s.type === 's' || s.type === 'sph');
        const sphere = spheres.length === 1 ? spheres[0] : null;
        const usedInside = sphere
            ? deck.cells.some((c) => halves(c.region).some((h) => h.surface === sphere.id && h.sense === -1))
            : false;
        if (sphere && usedInside) {
            const nextId = Math.max(0, ...deck.cells.map((c) => c.id)) + 1;
            const line = `${nextId} 0 ${sphere.id} imp:n=0`;
            output = insertAtFirstBlank(output, line);
            edits.push({
                ruleId: 'mcnp.graveyard',
                before: '(no imp:n=0 cell)',
                after: line,
                rationale: `The outside of sphere ${sphere.id} is the complement of this finite problem. §5.12.1 asks for that cell at importance 0.`,
            });
        } else {
            refused.push({
                ruleId: 'mcnp.graveyard',
                reason: 'No imp:n=0 cell, and the outside world is not a single sphere already used as an inner boundary. Refusing to guess a complement.',
            });
        }
    }

    const cellById = new Map(deck.cells.map((c) => [c.id, c]));
    const sdLines: string[] = [];
    for (const tally of deck.settings.cellTallies) {
        if (new RegExp(`^sd${tally.id}\\b`, 'im').test(output)) continue;
        const vols: number[] = [];
        let blocked = false;
        for (const id of tally.cells) {
            const cell = cellById.get(id);
            if (!cell) continue;
            const volume = cellVolumeCm3(cell, deck);
            if (volume === null) {
                blocked = true;
                refused.push({
                    ruleId: 'mcnp.tally-sd',
                    reason: `F${tally.kind} tally ${tally.id} scores cell ${id}, whose volume is not a sphere or a finite z-cylinder. Refusing to invent an sd divisor.`,
                });
            } else if (repeated(cell)) {
                vols.push(volume);
            }
        }
        if (!blocked && vols.length) {
            const card = `sd${tally.id} ${vols.map((v) => String(Number(v.toPrecision(8)))).join(' ')}`;
            sdLines.push(card);
            edits.push({
                ruleId: 'mcnp.tally-sd',
                before: `(F${tally.kind} on a repeated cell, no sd${tally.id})`,
                after: card,
                rationale: 'A volume tally on a universe or lattice cell needs sd. The value is the sphere or cylinder volume of that cell, not a guess.',
            });
        }
    }
    if (sdLines.length) output = `${output.replace(/\s*$/, '')}\n${sdLines.join('\n')}\n`;

    return { output, edits, refused };
}
