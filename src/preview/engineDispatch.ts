// Language dispatch for the exact-geometry engine (plan Stages 1–6).
//
// The evaluator, slice plotter and CSG builder all operate on the shared
// McnpGeometryModel shape; per-code parsers produce it. MCNP is the full
// Stage-1 implementation; Serpent and SCONE map their (smaller) surface and
// cell syntaxes onto the same model (Stage 6) — see serpentGeometry.ts and
// sconeGeometry.ts.

import { McnpGeometryModel, parseMcnpGeometry } from './mcnpGeometry';
import { parseSerpentGeometry } from './serpentGeometry';
import { parseSconeGeometry } from './sconeGeometry';
import { looksLikeOpenmcXml, parseOpenmcGeometryXml } from './openmcGeometry';

/** Parse a deck into the shared exact-geometry model, or null when the
 *  language has no engine parser yet. */
export function parseDeckToModel(text: string, language: string): McnpGeometryModel | null {
    switch (language) {
        case 'mcnp':
            return parseMcnpGeometry(text);
        case 'serpent':
            return parseSerpentGeometry(text);
        case 'scone':
            return parseSconeGeometry(text);
        case 'openmc':
            return looksLikeOpenmcXml(text) ? parseOpenmcGeometryXml(text) : null;
        default:
            return null;
    }
}

/** Human note shown when the slice view cannot run for this deck. */
export function sliceSupportNote(language: string): string {
    if (language === 'openmc') {
        return 'Exact 2D slices need an OpenMC model. OWEN loads it from geometry.xml / model.xml, or by running the Python deck the same way "Render with OpenMC" does. If OpenMC is not installed, use that command instead.';
    }
    return 'No cells could be parsed from this deck, so there is nothing to classify. ' +
        'Check the Problems panel for parse warnings.';
}
