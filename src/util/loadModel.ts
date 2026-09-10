import * as fs from 'fs';
import * as path from 'path';
import { parseDeckToModel } from '../preview/engineDispatch';
import { McnpGeometryModel } from '../preview/mcnpGeometry';
import { looksLikeOpenmcXml, parseOpenmcGeometryXml } from '../preview/openmcGeometry';
import { isCaptureNoise } from '../preview/openmcNative/captureNoise';
import { exportOpenmcGeometryXml } from '../preview/openmcNative/exportGeometry';
import type { DeckSource } from './deckSource';

export interface LoadedModel {
    model: McnpGeometryModel;
    /** Where the geometry came from, for the panel header. */
    origin: 'deck' | 'openmc-xml-sibling' | 'openmc-export';
    warnings: string[];
}

/**
 * The exact-geometry model for a deck. MCNP, Serpent, SCONE and OpenMC XML
 * parse directly. An OpenMC Python deck builds its geometry at run time, so
 * the same path the Cell Map and Render-with-OpenMC use applies: a sibling
 * geometry.xml/model.xml if one exists, else run the deck through OpenMC's
 * exporter. Returns null with a reason when nothing can be had.
 */
export async function loadGeometryModel(src: DeckSource): Promise<LoadedModel | { model: null; reason: string }> {
    const direct = parseDeckToModel(src.text, src.language);
    if (direct && direct.cells.size > 0) return { model: direct, origin: 'deck', warnings: direct.warnings };
    if (src.language !== 'openmc' || looksLikeOpenmcXml(src.text)) {
        return { model: null, reason: direct?.warnings[0] ?? `No cells could be parsed from this ${src.language} deck.` };
    }
    if (src.uri.scheme === 'file') {
        const dir = path.dirname(src.uri.fsPath);
        for (const name of ['geometry.xml', 'model.xml']) {
            const p = path.join(dir, name);
            try {
                if (fs.existsSync(p)) {
                    const xml = fs.readFileSync(p, 'utf8');
                    const mats = fs.existsSync(path.join(dir, 'materials.xml')) ? fs.readFileSync(path.join(dir, 'materials.xml'), 'utf8') : '';
                    const model = parseOpenmcGeometryXml(`${xml}\n${mats}`);
                    if (model.cells.size) return { model, origin: 'openmc-xml-sibling', warnings: model.warnings };
                }
            } catch { /* unreadable sibling: fall through to export */ }
        }
        if (src.fromNotebook) {
            return { model: null, reason: 'Export the notebook\'s model first (model.export_to_model_xml()) so a model.xml sits next to the .ipynb; OWEN reads that.' };
        }
        try {
            const exported = await exportOpenmcGeometryXml(src.uri.fsPath, src.uri);
            const model = parseOpenmcGeometryXml(`${exported.geometryXml}\n${exported.materialsXml ?? ''}`);
            const warnings = [...model.warnings, ...exported.warnings.filter((w) => !isCaptureNoise(w))];
            if (model.cells.size) return { model, origin: 'openmc-export', warnings };
            return { model: null, reason: 'OpenMC exported no cells for this deck.' };
        } catch (err) {
            return { model: null, reason: `Could not load OpenMC geometry: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}` };
        }
    }
    return { model: null, reason: 'Save the deck to disk so OpenMC can export its geometry.' };
}

export function isLoaded(r: Awaited<ReturnType<typeof loadGeometryModel>>): r is LoadedModel {
    return r.model !== null;
}
