import * as vscode from 'vscode';
import { detectMonteCarloLanguage, type MonteCarloLanguage } from '../util/detectLanguage';
import {
    orderedReferenceSites,
    SCOPE_LABELS,
    type ReferenceSite,
} from './referenceSites';

interface SiteItem extends vscode.QuickPickItem {
    site?: ReferenceSite;
}

function activeScope(): MonteCarloLanguage | 'phits' | null {
    const doc = vscode.window.activeTextEditor?.document;
    if (!doc) return null;
    return detectMonteCarloLanguage(doc);
}

/**
 * Builds the QuickPick rows, inserting a separator whenever the scope changes so
 * the active code's own manuals read as a block rather than a flat link dump.
 */
export function buildReferenceItems(active: MonteCarloLanguage | 'phits' | null): SiteItem[] {
    const items: SiteItem[] = [];
    let lastScope: string | null = null;
    for (const site of orderedReferenceSites(active)) {
        if (site.scope !== lastScope) {
            lastScope = site.scope;
            items.push({
                label:
                    site.scope === active
                        ? `${SCOPE_LABELS[site.scope]} — this file`
                        : SCOPE_LABELS[site.scope],
                kind: vscode.QuickPickItemKind.Separator,
            });
        }
        items.push({
            label: site.label,
            description: site.url.replace(/^https:\/\//, ''),
            detail: site.description,
            site,
        });
    }
    return items;
}

/**
 * OWEN beaker-menu entry: the upstream manual for whichever code is open,
 * without leaving the editor to search for it.
 */
export function registerOpenReference(_context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand('owen.openReference', async () => {
        const active = activeScope();
        const picked = await vscode.window.showQuickPick(buildReferenceItems(active), {
            title: 'OWEN: Reference documentation',
            placeHolder: active
                ? `Official documentation — ${SCOPE_LABELS[active]} first, because that is what you have open`
                : 'Official documentation for MCNP, OpenMC, Serpent, SCONE and nuclear data',
            matchOnDescription: true,
            matchOnDetail: true,
        });
        if (!picked?.site) return;
        await vscode.env.openExternal(vscode.Uri.parse(picked.site.url));
    });
}
