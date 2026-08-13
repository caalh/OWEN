// VENDORED from the ReactorMC site repo: src/lib/pnnlCards.ts
// Do not edit here. Edit it there, run its verify (npm run verify:nrdp-materials),
// then re-sync: npm run sync-nrdp-cards
/**
 * Per-code material card generators for the PNNL-15870 Rev. 2 compendium dataset.
 *
 * Data source: PNNL-15870 Rev. 2 (April 2021), R.S. Detwiler, R.J. McConn Jr.,
 * T.F. Grimes, S.A. Upton, E.J. Engel, "Compendium of Material Composition Data
 * for Radiation Transport Modeling", Pacific Northwest National Laboratory.
 * https://doi.org/10.2172/1782721
 *
 * Conventions:
 *  - MCNP / Serpent: NEGATIVE values = weight fractions (positive would mean
 *    atom fractions). Cards name isotopic ZAIDs, with two exceptions forced by
 *    the library rather than by the composition (see `src/data/aceInventory.ts`):
 *    carbon collapses to elemental `6000`, and a nuclide with no ENDF/B-VII.1
 *    evaluation — O-18 in every oxide — is folded into the element's most
 *    abundant isotope. Both are announced in a comment line on the card.
 *  - OpenMC: add_element(..., percent_type='wo') for natural-abundance
 *    elements; add_nuclide(..., percent_type='wo') when the compendium
 *    formulation is isotopically customized (enriched/depleted). OpenMC expands
 *    elements against whatever library the user configured, so it needs no
 *    folding.
 *  - SCONE: composition entries are atom densities in atoms/(barn*cm) with a
 *    `.03` (300 K) temperature suffix matching `temp 300;`.
 *  - S(α,β): attached where ENDF/B-VII.1 has a bound-scattering evaluation for
 *    the material as formulated — the waters, polyethylene, graphite, beryllium
 *    metal, BeO, and zirconium hydride. Never on a fuel or a plain metal.
 */

// Explicit .ts so this module also runs under plain Node (scripts/test-pnnl-cards.ts,
// scripts/verify-nrdp-materials.mjs), which has no path aliases.
import { isEndfb71Suffix, planElement } from './aceInventory';

export interface PnnlIsotope {
  zaid: string;
  /** Weight fraction of the whole material. */
  wf: number;
  /** Atom density, atoms/(barn*cm). */
  ad: number;
}

export interface PnnlElement {
  sym: string;
  z: number;
  /** Weight fraction of the whole material. */
  wf: number;
  /** Atom fraction of the whole material. */
  af: number;
  /** True when the formulation uses natural isotopic abundances. */
  natural: boolean;
  isotopes: PnnlIsotope[];
}

export interface PnnlMaterial {
  id: string;
  name: string;
  formula?: string;
  acronyms?: string[];
  /** g/cm3 */
  density: number;
  /** atoms/(barn*cm), whole material */
  atomDensity: number;
  comments?: string[];
  refs?: string[];
  elements: PnnlElement[];
  /**
   * Where the numbers come from, for the comment line on every card. Defaults
   * to the compendium; the NRDP curated library passes its own provenance for
   * materials the compendium does not carry (enrichment variants, FLiBe, …).
   */
  sourceLabel?: string;
  /**
   * Bound-scattering tables, for materials that are not in `SAB_TABLE` because
   * they are not compendium entries. Compendium ids are looked up by id.
   */
  sab?: SabEntry[];
}

export interface PnnlDataset {
  version: string;
  sourceUrl: string;
  reportUrl: string;
  materials: PnnlMaterial[];
}

export const PNNL_CITATION =
  'Material compositions from PNNL-15870 Rev. 2 (April 2021), R.S. Detwiler, R.J. McConn Jr., T.F. Grimes, S.A. Upton, and E.J. Engel, Compendium of Material Composition Data for Radiation Transport Modeling, Pacific Northwest National Laboratory.';

export const PNNL_REPORT_URL = 'https://doi.org/10.2172/1782721';

export interface SabEntry {
  /** MCNP `MT` table, e.g. 'lwtr.20t' (ENDF71SaB, pairs with `.80c`). */
  mcnp: string;
  /** OpenMC name for the same binding. */
  openmc: string;
  /** Serpent `therm` name / library, and the ZAID the `moder` entry binds. */
  serpentName: string;
  serpentLib: string;
  serpentZaid: string;
}

/**
 * The bound-scattering evaluations in ENDF/B-VII.1 that this site uses, keyed by
 * the MCNP table name. `.20t` is ENDF71SaB, which is the set that pairs with
 * `.80c`; ENDF/B-VIII.0 renames several of these (`lwtr` becomes `h-h2o`).
 */
export const SAB_LIBRARY = {
  lwtr: { mcnp: 'lwtr.20t', openmc: 'c_H_in_H2O', serpentName: 'lwtr', serpentLib: 'lwtr.20t', serpentZaid: '1001' },
  hwtr: { mcnp: 'hwtr.20t', openmc: 'c_D_in_D2O', serpentName: 'hwtr', serpentLib: 'hwtr.20t', serpentZaid: '1002' },
  poly: { mcnp: 'poly.20t', openmc: 'c_H_in_CH2', serpentName: 'poly', serpentLib: 'poly.20t', serpentZaid: '1001' },
  grph: { mcnp: 'grph.20t', openmc: 'c_Graphite', serpentName: 'grph', serpentLib: 'grph.20t', serpentZaid: '6000' },
  'be-met': { mcnp: 'be-met.20t', openmc: 'c_Be', serpentName: 'bemet', serpentLib: 'be-met.20t', serpentZaid: '4009' },
  'be-o': { mcnp: 'be-o.20t', openmc: 'c_Be_in_BeO', serpentName: 'beo', serpentLib: 'be-o.20t', serpentZaid: '4009' },
  'o-be': { mcnp: 'o-be.20t', openmc: 'c_O_in_BeO', serpentName: 'obe', serpentLib: 'o-be.20t', serpentZaid: '8016' },
  'h-zr': { mcnp: 'h-zr.20t', openmc: 'c_H_in_ZrH', serpentName: 'hzr', serpentLib: 'h-zr.20t', serpentZaid: '1001' },
  'zr-h': { mcnp: 'zr-h.20t', openmc: 'c_Zr_in_ZrH', serpentName: 'zrh', serpentLib: 'zr-h.20t', serpentZaid: '40090' },
} as const satisfies Record<string, SabEntry>;

export type SabName = keyof typeof SAB_LIBRARY;

/**
 * Bound-scattering data by compendium id. One material can need more than one
 * table: BeO binds both atoms, and so does zirconium hydride.
 */
const SAB_TABLE: Record<string, SabEntry[]> = {
  'water-liquid': [SAB_LIBRARY.lwtr],
  'water-heavy': [SAB_LIBRARY.hwtr],
  'polyethylene-non-borated': [SAB_LIBRARY.poly],
  'polyethylene-borated': [SAB_LIBRARY.poly],
  'carbon-graphite-reactor-grade': [SAB_LIBRARY.grph],
  beryllium: [SAB_LIBRARY['be-met']],
  'beryllium-oxide': [SAB_LIBRARY['be-o'], SAB_LIBRARY['o-be']],
  'zirconium-hydride-zrh2': [SAB_LIBRARY['h-zr'], SAB_LIBRARY['zr-h']],
  'zirconium-hydride-zr5h8': [SAB_LIBRARY['h-zr'], SAB_LIBRARY['zr-h']],
};

function sabFor(mat: PnnlMaterial): SabEntry[] | undefined {
  const s = SAB_TABLE[mat.id] ?? mat.sab;
  return s && s.length > 0 ? s : undefined;
}

/** Bound-scattering tables for a material, or undefined when free gas is right. */
export function pnnlSab(mat: PnnlMaterial): { mcnp: string[]; openmc: string[] } | undefined {
  const s = sabFor(mat);
  return s ? { mcnp: s.map((e) => e.mcnp), openmc: s.map((e) => e.openmc) } : undefined;
}

/**
 * Characters that reach a card only through a material name, a formula, or a
 * provenance string. A deck is a fixed-column ASCII format: MCNP reads bytes,
 * Serpent and SCONE want plain ASCII, and a UO2 written 'UO₂' has been enough
 * to make a parser reject a comment line. Transliterate rather than strip, so
 * 'UZrH₁.₆' stays readable as 'UZrH1.6'.
 */
const ASCII_SUBSTITUTIONS: Record<string, string> = {
  '\u2014': '-', '\u2013': '-', '\u2212': '-', '\u00b7': '*', '\u00d7': 'x',
  '\u2248': '~', '\u2264': '<=', '\u2265': '>=', '\u00b0': ' deg ',
  '\u03b1': 'alpha', '\u03b2': 'beta', '\u03b3': 'gamma', '\u03bc': 'u', '\u03c1': 'rho',
  '\u2019': "'", '\u2018': "'", '\u201c': '"', '\u201d': '"', '\u2026': '...',
  '\u00b2': '2', '\u00b3': '3', '\u00b9': '1',
  '\u2080': '0', '\u2081': '1', '\u2082': '2', '\u2083': '3', '\u2084': '4',
  '\u2085': '5', '\u2086': '6', '\u2087': '7', '\u2088': '8', '\u2089': '9',
};

export function toDeckAscii(text: string): string {
  let out = '';
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128) {
      out += ch;
      continue;
    }
    out += ASCII_SUBSTITUTIONS[ch] ?? '?';
  }
  return out;
}

/**
 * A comment, as ASCII lines that fit a card image. MCNP reads only the first 80
 * columns, and OWEN's validator flags anything past that, so a long provenance
 * or a folding note is wrapped rather than truncated.
 */
export function commentLines(prefix: string, text: string, width = 80): string[] {
  const body = toDeckAscii(text).replace(/\s+/g, ' ').trim();
  if (body.length === 0) return [];
  const limit = Math.max(20, width - prefix.length);
  const out: string[] = [];
  let line = '';
  for (const word of body.split(' ')) {
    if (line.length === 0) {
      line = word;
    } else if (line.length + 1 + word.length <= limit) {
      line += ` ${word}`;
    } else {
      out.push(prefix + line);
      line = word;
    }
  }
  if (line.length > 0) out.push(prefix + line);
  return out;
}

function fmtFrac(x: number): string {
  return x >= 1e-3 ? x.toFixed(6) : x.toExponential(4);
}

function fmtAd(x: number): string {
  return x.toExponential(6);
}

/** ZAID -> OpenMC/GND nuclide name (e.g. '92235' -> 'U235'). */
function nuclideName(sym: string, zaid: string): string {
  const a = Number(zaid) % 1000;
  return `${sym}${a}`;
}

function sanitize(id: string): string {
  return id.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export interface CardRow {
  zaid: string;
  /** Weight fraction of the whole material. */
  wf: number;
  /** Atom density, atoms/(barn*cm). */
  ad: number;
  label: string;
}

export interface CardRows {
  rows: CardRow[];
  /** Human-readable consequences of the library, for a comment line. */
  notes: string[];
}

/**
 * Expand a material into the rows a card can actually name, for the ACE library
 * `suffix` points at. Mass and atom balance are preserved: a nuclide with no
 * table hands its share to one that has one.
 */
export function pnnlCardRows(mat: PnnlMaterial, suffix = '80c'): CardRows {
  const rows: CardRow[] = [];
  const notes: string[] = [];
  const known = isEndfb71Suffix(suffix);
  for (const el of mat.elements) {
    if (el.isotopes.length === 0) {
      rows.push({ zaid: `${el.z}000`, wf: el.wf, ad: el.af * mat.atomDensity, label: el.sym });
      continue;
    }
    // Outside ENDF/B-VII.1 we have no inventory to reason with, so the
    // composition is written as given and the caller is told to check it.
    const plan = known
      ? planElement(el.z, el.isotopes.map((i) => ({ zaid: i.zaid, weight: i.wf })))
      : ({ kind: 'asIs' } as const);
    if (plan.kind === 'collapse') {
      rows.push({
        zaid: plan.zaid,
        wf: el.wf,
        ad: el.isotopes.reduce((s, i) => s + i.ad, 0),
        label: el.sym,
      });
      if (el.z !== 6) {
        notes.push(`${el.sym} written as elemental ${plan.zaid}: ENDF/B-VII.1 has no isotopic ${el.sym} tables.`);
      }
      continue;
    }
    if (plan.kind === 'unavailable') {
      notes.push(
        `${el.sym} (${fmtFrac(el.wf)} by weight) omitted: ENDF/B-VII.1 has no ${el.sym} evaluation. `
          + 'Use a library that does, or drop this material.',
      );
      continue;
    }
    if (plan.kind === 'fold') {
      const foldedWf = el.isotopes.filter((i) => plan.folded.includes(i.zaid)).reduce((s, i) => s + i.wf, 0);
      const foldedAd = el.isotopes.filter((i) => plan.folded.includes(i.zaid)).reduce((s, i) => s + i.ad, 0);
      for (const iso of el.isotopes) {
        if (plan.folded.includes(iso.zaid)) continue;
        const isInto = iso.zaid === plan.into;
        rows.push({
          zaid: iso.zaid,
          wf: iso.wf + (isInto ? foldedWf : 0),
          ad: iso.ad + (isInto ? foldedAd : 0),
          label: nuclideName(el.sym, iso.zaid),
        });
      }
      const names = plan.folded.map((z) => nuclideName(el.sym, z)).join(', ');
      notes.push(
        `${names} folded into ${nuclideName(el.sym, plan.into)}: ENDF/B-VII.1 has no ${names} evaluation `
          + `(${fmtFrac(foldedWf)} by weight, so the spectrum does not care).`,
      );
      continue;
    }
    for (const iso of el.isotopes) {
      rows.push({ zaid: iso.zaid, wf: iso.wf, ad: iso.ad, label: nuclideName(el.sym, iso.zaid) });
    }
  }
  if (!known) {
    notes.push(`Library '${suffix}' is not ENDF/B-VII.1; check that every ZAID above exists in it.`);
  }
  return { rows, notes };
}

/**
 * Expand a material into (zaid, weight-fraction) rows for MCNP/Serpent.
 * Kept for callers that only want the rows; `pnnlCardRows` also reports what
 * the library forced.
 */
export function pnnlZaidRows(mat: PnnlMaterial, suffix = '80c'): { zaid: string; wf: number; label: string }[] {
  return pnnlCardRows(mat, suffix).rows.map(({ zaid, wf, label }) => ({ zaid, wf, label }));
}

/** What the chosen library forced on this material's cards, for the UI. */
export function pnnlLibraryNotes(mat: PnnlMaterial, suffix = '80c'): string[] {
  return pnnlCardRows(mat, suffix).notes;
}

/** Provenance string for the comment line at the top of every card. */
function sourceOf(mat: PnnlMaterial): string {
  return mat.sourceLabel ?? 'PNNL-15870 Rev. 2';
}

export function pnnlMcnpCard(mat: PnnlMaterial, matNumber = 1, suffix = '80c'): string {
  const lines: string[] = [];
  lines.push(...commentLines('c ', mat.name));
  lines.push(
    ...commentLines('c ', `${sourceOf(mat)}; rho = ${mat.density} g/cm3 (use -${mat.density} on the cell card)`),
  );
  const { rows, notes } = pnnlCardRows(mat, suffix);
  for (const note of notes) lines.push(...commentLines('c ', note));
  const head = `m${matNumber}`;
  const pad = ' '.repeat(head.length);
  rows.forEach((r, i) => {
    const lead = i === 0 ? head : pad;
    lines.push(`${lead}    ${r.zaid}.${suffix}  -${fmtFrac(r.wf)}  $ ${r.label}`);
  });
  const sab = sabFor(mat);
  if (sab) lines.push(`mt${matNumber}   ${sab.map((e) => e.mcnp).join(' ')}`);
  return lines.join('\n');
}

export function pnnlOpenmcSnippet(mat: PnnlMaterial): string {
  const varName = 'mat_' + sanitize(mat.id).toLowerCase();
  const lines: string[] = ['import openmc', ''];
  lines.push(...commentLines('# ', `${mat.name} - ${sourceOf(mat)}`, 100));
  // The name reaches statepoint output and tally labels, so it is ASCII too.
  lines.push(`${varName} = openmc.Material(name=${JSON.stringify(toDeckAscii(mat.name))})`);
  lines.push(`${varName}.set_density('g/cm3', ${mat.density})`);
  for (const el of mat.elements) {
    if (el.natural) {
      lines.push(`${varName}.add_element('${el.sym}', ${fmtFrac(el.wf)}, percent_type='wo')`);
    } else {
      for (const iso of el.isotopes) {
        lines.push(`${varName}.add_nuclide('${nuclideName(el.sym, iso.zaid)}', ${fmtFrac(iso.wf)}, percent_type='wo')`);
      }
    }
  }
  const sab = sabFor(mat);
  if (sab) for (const e of sab) lines.push(`${varName}.add_s_alpha_beta('${e.openmc}')`);
  return lines.join('\n');
}

export function pnnlSerpentCard(mat: PnnlMaterial, suffix = '80c'): string {
  const name = sanitize(mat.id).toLowerCase();
  const sab = sabFor(mat);
  const lines: string[] = [];
  lines.push(...commentLines('% ', `${mat.name} - ${sourceOf(mat)}`));
  const { rows, notes } = pnnlCardRows(mat, suffix);
  for (const note of notes) lines.push(...commentLines('% ', note));
  const moder = sab ? sab.map((e) => ` moder ${e.serpentName} ${e.serpentZaid}`).join('') : '';
  lines.push(`mat ${name} -${mat.density}${moder}`);
  for (const r of rows) {
    lines.push(`${r.zaid}.${suffix}  -${fmtFrac(r.wf)}  % ${r.label}`);
  }
  if (sab) for (const e of sab) lines.push(`therm ${e.serpentName} ${e.serpentLib}`);
  return lines.join('\n');
}

export function pnnlSconeEntry(mat: PnnlMaterial): string {
  const name = sanitize(mat.id);
  const { rows, notes } = pnnlCardRows(mat, '80c');
  const head = [
    ...commentLines('// ', `${mat.name} - ${sourceOf(mat)} (atom densities in atoms/barn-cm)`),
    ...notes.flatMap((n) => commentLines('// ', n)),
  ].join('\n');
  const body = rows.map((r) => `    ${r.zaid}.03 ${fmtAd(r.ad)};`).join('\n');
  return `${head}\n${name} {\n  temp 300;\n  composition {\n${body}\n  }\n}`;
}
