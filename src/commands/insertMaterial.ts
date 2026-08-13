import * as vscode from 'vscode';
import { detectMonteCarloLanguage, MonteCarloLanguage } from '../util/detectLanguage';
import { loadPnnlDataset } from '../inputBuilder/pnnlData';
import {
    pnnlMcnpCard,
    pnnlOpenmcSnippet,
    pnnlSerpentCard,
    pnnlSconeEntry,
    type PnnlMaterial,
} from '../inputBuilder/pnnlCards';
import {
    nextMcnpMaterialNumber,
    remapMcnpMaterialCard,
} from '../references/mcnpReferences';

interface MaterialComposition {
    zaid: string;
    name: string;
    /** Weight fraction of the whole material. */
    fraction: number;
    atomFraction?: number;
    /** atoms/(barn*cm) */
    atomDensity?: number;
    isElement?: boolean;
}

/**
 * A row of the NRDP curated library, as published at
 * https://reactormc.net/data/nrdp-materials.json and bundled in `data/`.
 * Generated on the site side from scripts/nrdp/recipes.mjs — every card here
 * comes from the same generator as the compendium cards, so the two agree.
 */
interface CommonMaterial {
    slug: string;
    name: string;
    formula?: string;
    category: string;
    density: number;
    atomDensity?: number;
    /** 'pnnl' (compendium verbatim), 'derived' (stated recipe), or 'void'. */
    source?: string;
    pnnlId?: string;
    provenance?: string;
    description: string;
    composition: MaterialComposition[];
    sab?: string[];
    /** What ENDF/B-VII.1 forced on the cards (folded or collapsed nuclides). */
    libraryNotes?: string[];
    mcnpCode: string;
    serpentCode: string;
    openmcCode: string;
    sconeCode?: string;
    notes?: string;
}

let cachedMaterials: CommonMaterial[] | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * The bundled snapshot is a bare array; the file the site publishes wraps the
 * same array in `{ citation, reportUrl, materials }`. Accept either, or the
 * live fetch degrades to the bundled copy without saying so.
 */
export function materialsFromJson(parsed: unknown): CommonMaterial[] | null {
    if (Array.isArray(parsed)) return parsed as CommonMaterial[];
    const wrapped = (parsed as { materials?: unknown } | null)?.materials;
    if (Array.isArray(wrapped)) return wrapped as CommonMaterial[];
    return null;
}

async function loadBundled(extensionUri: vscode.Uri): Promise<CommonMaterial[]> {
    const uri = vscode.Uri.joinPath(extensionUri, 'data', 'nrdp-materials.json');
    try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
        return materialsFromJson(parsed) ?? [];
    } catch (err) {
        console.warn('[owen.insertMaterial] failed to read bundled NRDP snapshot', err);
        return [];
    }
}

async function loadLive(endpoint: string): Promise<CommonMaterial[] | null> {
    try {
        const url = endpoint.replace(/\/$/, '') + '/nrdp-materials.json';
        const res = await fetch(url);
        if (!res.ok) {
            console.warn(`[owen.insertMaterial] live NRDP returned ${res.status}; falling back to bundled`);
            return null;
        }
        const data = await res.json();
        const materials = materialsFromJson(data);
        if (!materials) {
            console.warn('[owen.insertMaterial] live NRDP payload had no material array; falling back to bundled');
            return null;
        }
        return materials;
    } catch (err) {
        console.warn('[owen.insertMaterial] live NRDP fetch failed; falling back to bundled', err);
        return null;
    }
}

async function loadMaterials(extensionUri: vscode.Uri): Promise<CommonMaterial[]> {
    if (cachedMaterials && Date.now() - cachedAt < CACHE_TTL_MS) {
        return cachedMaterials;
    }
    const cfg = vscode.workspace.getConfiguration('owen');
    const live = cfg.get<boolean>('nrdp.live', true);
    const endpoint = cfg.get<string>('nrdp.endpoint', 'https://reactormc.net/data');
    let materials: CommonMaterial[] | null = null;
    if (live) {
        materials = await loadLive(endpoint);
    }
    if (!materials) {
        materials = await loadBundled(extensionUri);
    }
    cachedMaterials = materials;
    cachedAt = Date.now();
    return materials;
}

function codeForLanguage(mat: CommonMaterial, lang: MonteCarloLanguage | null): string {
    switch (lang) {
        case 'openmc':
            return mat.openmcCode || '';
        case 'serpent':
            return mat.serpentCode || '';
        case 'scone':
            // Generated on the site side. A SCONE composition is atom densities
            // in atoms/barn-cm, not fractions: this used to write the weight
            // fractions straight into the block, which described a material
            // roughly 10^22 times too dense.
            return mat.sconeCode || '';
        case 'mcnp':
        default:
            return mat.mcnpCode || '';
    }
}

export function registerInsertMaterial(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand('owen.insertMaterial', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('OWEN: open a file before inserting a material.');
            return;
        }

        const lang = detectMonteCarloLanguage(editor.document);
        const materials = await loadMaterials(context.extensionUri);
        if (materials.length === 0) {
            vscode.window.showErrorMessage(
                'OWEN: NRDP material snapshot is empty. Run `npm run export-nrdp` or check `owen.nrdp.live` / `owen.nrdp.endpoint`.',
            );
            return;
        }

        const usable = materials.filter((m) => codeForLanguage(m, lang).trim().length > 0);
        if (usable.length === 0) {
            vscode.window.showErrorMessage(
                `OWEN: the NRDP snapshot carries no ${lang ?? 'MCNP'} cards. If \`owen.nrdp.live\` is on, the `
                + 'published snapshot is older than this extension — set it to false to use the bundled copy.',
            );
            return;
        }

        const items: (vscode.QuickPickItem & { pnnlId?: string })[] = usable.map((m) => ({
            label: m.name,
            description: [
                m.formula,
                `ρ=${m.density} g/cm³`,
                m.source === 'pnnl' ? 'PNNL-15870' : m.source === 'derived' ? 'derived recipe' : m.category,
            ]
                .filter(Boolean)
                .join(' • '),
            detail: m.description,
        }));

        // PNNL-15870 Rev. 2 compendium (411 materials) after the curated set.
        const pnnl = loadPnnlDataset();
        if (pnnl) {
            items.push({
                label: 'PNNL-15870 Rev. 2 Compendium',
                kind: vscode.QuickPickItemKind.Separator,
            });
            for (const m of pnnl.materials) {
                items.push({
                    label: m.name,
                    description: `${m.formula ? m.formula + ' • ' : ''}ρ=${m.density} g/cm³ • PNNL compendium`,
                    detail: m.elements.map((e) => e.sym).join(', '),
                    pnnlId: m.id,
                });
            }
        }

        const pick = await vscode.window.showQuickPick(items, {
            placeHolder: `Insert material (${lang ?? 'unknown language — defaults to MCNP'})`,
            matchOnDescription: true,
            matchOnDetail: true,
        });
        if (!pick) return;

        const mcnpLang = lang === 'mcnp' || lang === null;
        const nextMatNum = mcnpLang
            ? nextMcnpMaterialNumber(editor.document.getText())
            : 1;

        let snippet: string;
        if (pick.pnnlId) {
            const mat = pnnl?.materials.find((m) => m.id === pick.pnnlId) as PnnlMaterial;
            switch (lang) {
                case 'openmc': snippet = pnnlOpenmcSnippet(mat); break;
                case 'serpent': snippet = pnnlSerpentCard(mat); break;
                case 'scone': snippet = pnnlSconeEntry(mat); break;
                default: snippet = pnnlMcnpCard(mat, nextMatNum); break;
            }
        } else {
            const material = materials.find((m) => m.name === pick.label);
            if (!material) return;
            snippet = codeForLanguage(material, lang);
            if (mcnpLang && snippet.trim()) {
                snippet = remapMcnpMaterialCard(snippet, nextMatNum);
            }
        }
        const padded = snippet.endsWith('\n') ? snippet : snippet + '\n';
        const insertText = (editor.selection.active.character > 0 ? '\n' : '') + padded;

        await editor.edit((eb) => {
            eb.insert(editor.selection.active, insertText);
        });

        if (mcnpLang) {
            void vscode.window.setStatusBarMessage(`OWEN: inserted material as m${nextMatNum}`, 3000);
        }
    });
}
