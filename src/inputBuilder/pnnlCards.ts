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
 *    atom fractions). We emit isotopic ZAIDs with negative weight fractions of
 *    the whole material, except carbon which is emitted as elemental 6000
 *    (ENDF/B-VII.1 `.80c` has no C-12/C-13 isotopic tables).
 *  - OpenMC: add_element(..., percent_type='wo') for natural-abundance
 *    elements; add_nuclide(..., percent_type='wo') when the compendium
 *    formulation is isotopically customized (enriched/depleted).
 *  - SCONE: composition entries are atom densities in atoms/(barn*cm) with a
 *    `.03` (300 K) temperature suffix matching `temp 300;`.
 *  - S(α,β) thermal scattering is attached ONLY to hydrogenous moderators
 *    (light/heavy water, polyethylene) — never to fuels or metals.
 */

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

/** Hydrogenous moderators that get thermal-scattering data automatically. */
const SAB_TABLE: Record<
  string,
  { mcnp: string; openmc: string; serpentName: string; serpentLib: string; serpentZaid: string }
> = {
  'water-liquid': { mcnp: 'lwtr.20t', openmc: 'c_H_in_H2O', serpentName: 'lwtr', serpentLib: 'lwtr.20t', serpentZaid: '1001' },
  'water-heavy': { mcnp: 'hwtr.20t', openmc: 'c_D_in_D2O', serpentName: 'hwtr', serpentLib: 'hwtr.20t', serpentZaid: '1002' },
  'polyethylene-non-borated': { mcnp: 'poly.20t', openmc: 'c_H_in_CH2', serpentName: 'poly', serpentLib: 'poly.20t', serpentZaid: '1001' },
  'polyethylene-borated': { mcnp: 'poly.20t', openmc: 'c_H_in_CH2', serpentName: 'poly', serpentLib: 'poly.20t', serpentZaid: '1001' },
};

export function pnnlSab(mat: PnnlMaterial): { mcnp: string; openmc: string } | undefined {
  const s = SAB_TABLE[mat.id];
  return s ? { mcnp: s.mcnp, openmc: s.openmc } : undefined;
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

/**
 * Expand a material into (zaid, weight-fraction) rows for MCNP/Serpent.
 * Carbon collapses to elemental 6000 (no isotopic C tables in ENDF/B-VII.1).
 * Elements with no isotope rows fall back to the elemental ZAID.
 */
export function pnnlZaidRows(mat: PnnlMaterial): { zaid: string; wf: number; label: string }[] {
  const rows: { zaid: string; wf: number; label: string }[] = [];
  for (const el of mat.elements) {
    if (el.z === 6 || el.isotopes.length === 0) {
      rows.push({ zaid: `${el.z}000`, wf: el.wf, label: el.sym });
      continue;
    }
    for (const iso of el.isotopes) {
      rows.push({ zaid: iso.zaid, wf: iso.wf, label: nuclideName(el.sym, iso.zaid) });
    }
  }
  return rows;
}

export function pnnlMcnpCard(mat: PnnlMaterial, matNumber = 1, suffix = '80c'): string {
  const lines: string[] = [];
  lines.push(`c ${mat.name}`);
  lines.push(`c PNNL-15870 Rev. 2; rho = ${mat.density} g/cm3 (use -${mat.density} on the cell card)`);
  const rows = pnnlZaidRows(mat);
  const head = `m${matNumber}`;
  const pad = ' '.repeat(head.length);
  rows.forEach((r, i) => {
    const lead = i === 0 ? head : pad;
    lines.push(`${lead}    ${r.zaid}.${suffix}  -${fmtFrac(r.wf)}  $ ${r.label}`);
  });
  const sab = SAB_TABLE[mat.id];
  if (sab) lines.push(`mt${matNumber}   ${sab.mcnp}`);
  return lines.join('\n');
}

export function pnnlOpenmcSnippet(mat: PnnlMaterial): string {
  const varName = 'mat_' + sanitize(mat.id).toLowerCase();
  const lines: string[] = ['import openmc', ''];
  lines.push(`# ${mat.name} — PNNL-15870 Rev. 2`);
  lines.push(`${varName} = openmc.Material(name=${JSON.stringify(mat.name)})`);
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
  const sab = SAB_TABLE[mat.id];
  if (sab) lines.push(`${varName}.add_s_alpha_beta('${sab.openmc}')`);
  return lines.join('\n');
}

export function pnnlSerpentCard(mat: PnnlMaterial, suffix = '80c'): string {
  const name = sanitize(mat.id).toLowerCase();
  const sab = SAB_TABLE[mat.id];
  const lines: string[] = [];
  lines.push(`% ${mat.name} — PNNL-15870 Rev. 2`);
  const moder = sab ? ` moder ${sab.serpentName} ${sab.serpentZaid}` : '';
  lines.push(`mat ${name} -${mat.density}${moder}`);
  for (const r of pnnlZaidRows(mat)) {
    lines.push(`${r.zaid}.${suffix}  -${fmtFrac(r.wf)}  % ${r.label}`);
  }
  if (sab) lines.push(`therm ${sab.serpentName} ${sab.serpentLib}`);
  return lines.join('\n');
}

export function pnnlSconeEntry(mat: PnnlMaterial): string {
  const name = sanitize(mat.id);
  const rows: { zaid: string; ad: number }[] = [];
  for (const el of mat.elements) {
    if (el.z === 6 || el.isotopes.length === 0) {
      const ad = el.isotopes.length > 0 ? el.isotopes.reduce((s, i) => s + i.ad, 0) : el.af * mat.atomDensity;
      rows.push({ zaid: `${el.z}000`, ad });
      continue;
    }
    for (const iso of el.isotopes) rows.push({ zaid: iso.zaid, ad: iso.ad });
  }
  return `// ${mat.name} — PNNL-15870 Rev. 2 (atom densities in atoms/barn-cm)\n${name} {\n  temp 300;\n  composition {\n${rows.map((r) => `    ${r.zaid}.03 ${fmtAd(r.ad)};`).join('\n')}\n  }\n}`;
}
