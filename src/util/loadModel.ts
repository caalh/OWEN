import * as fs from 'fs';
import * as path from 'path';
import { parseDeckToModel } from '../preview/engineDispatch';
import { McnpGeometryModel } from '../preview/mcnpGeometry';
import { looksLikeOpenmcXml, parseOpenmcGeometryXml } from '../preview/openmcGeometry';
import { isCaptureNoise } from '../preview/openmcNative/captureNoise';
import { exportOpenmcGeometryXml } from '../preview/openmcNative/exportGeometry';
import type { DeckSource } from './deckSource';
import { resolveProject, nodeProjectFs, type ResolvedProject } from './projectLoader';

export interface LoadedModel {
    model: McnpGeometryModel;
    /** Where the geometry came from, for the panel header. */
    origin: 'deck' | 'openmc-xml-sibling' | 'openmc-export';
    warnings: string[];
    /** Text actually parsed (includes expanded / sibling XML concatenated). */
    text: string;
    /** Files the project loader joined (root + includes). */
    projectFiles?: string[];
}

/**
 * Join includes / sibling XML for a file-backed deck. Notebooks already join
 * their cells in deckSource; they are left alone here.
 */
export function resolveDeckProject(src: DeckSource): ResolvedProject | null {
    if (src.fromNotebook || src.uri.scheme !== 'file') return null;
    try {
        return resolveProject({
            rootPath: src.uri.fsPath,
            language: src.language,
            rootText: src.text,
            fs: nodeProjectFs,
        });
    } catch (err) {
        return {
            language: src.language,
            rootPath: src.uri.fsPath,
            text: src.text,
            files: [{ path: src.uri.fsPath, role: 'root' }],
            warnings: [`Could not expand includes: ${err instanceof Error ? err.message : String(err)}`],
        };
    }
}

/**
 * The exact-geometry model for a deck. MCNP, Serpent, SCONE and OpenMC XML
 * parse directly. An OpenMC Python deck builds its geometry at run time, so
 * the same path the Cell Map and Render-with-OpenMC use applies: a sibling
 * geometry.xml/model.xml if one exists, else run the deck through OpenMC's
 * exporter. Returns null with a reason when nothing can be had.
 */
export async function loadGeometryModel(src: DeckSource): Promise<LoadedModel | { model: null; reason: string }> {
    const project = resolveDeckProject(src);
    const extra = project?.warnings ?? [];
    const projectFiles = project?.files.map((f) => f.path);
    const text = project?.text ?? src.text;

    if (project?.xmlText) {
        const model = parseOpenmcGeometryXml(project.xmlText);
        if (model.cells.size) {
            return {
                model,
                origin: 'openmc-xml-sibling',
                warnings: [...extra, ...model.warnings],
                text: project.xmlText,
                projectFiles,
            };
        }
    }

    const direct = parseDeckToModel(text, src.language);
    if (direct && direct.cells.size > 0) {
        return { model: direct, origin: 'deck', warnings: [...extra, ...direct.warnings], text, projectFiles };
    }
    if (src.language !== 'openmc' || looksLikeOpenmcXml(text)) {
        return { model: null, reason: extra[0] ?? direct?.warnings[0] ?? `No cells could be parsed from this ${src.language} deck.` };
    }
    if (src.uri.scheme === 'file') {
        const dir = path.dirname(src.uri.fsPath);
        // OpenMC runs model.xml when both exist; prefer it over geometry.xml.
        for (const name of ['model.xml', 'geometry.xml']) {
            const p = path.join(dir, name);
            try {
                if (fs.existsSync(p)) {
                    const xml = fs.readFileSync(p, 'utf8');
                    const mats = fs.existsSync(path.join(dir, 'materials.xml')) ? fs.readFileSync(path.join(dir, 'materials.xml'), 'utf8') : '';
                    const model = parseOpenmcGeometryXml(`${xml}\n${mats}`);
                    if (model.cells.size) {
                        return { model, origin: 'openmc-xml-sibling', warnings: [...extra, ...model.warnings], text: `${xml}\n${mats}`, projectFiles };
                    }
                }
            } catch { /* unreadable sibling: fall through to export */ }
        }
        if (src.fromNotebook) {
            return { model: null, reason: 'Export the notebook\'s model first (model.export_to_model_xml()) so a model.xml sits next to the .ipynb; OWEN reads that.' };
        }
        try {
            const exported = await exportOpenmcGeometryXml(src.uri.fsPath, src.uri);
            const model = parseOpenmcGeometryXml(`${exported.geometryXml}\n${exported.materialsXml ?? ''}`);
            const warnings = [...extra, ...model.warnings, ...exported.warnings.filter((w) => !isCaptureNoise(w))];
            if (model.cells.size) {
                return {
                    model,
                    origin: 'openmc-export',
                    warnings,
                    text: `${exported.geometryXml}\n${exported.materialsXml ?? ''}`,
                    projectFiles,
                };
            }
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
