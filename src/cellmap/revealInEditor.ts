import * as vscode from 'vscode';
import { detectMonteCarloLanguage } from '../util/detectLanguage';
import { buildMcnpReferenceIndex, getDefinition } from '../references/mcnpReferences';
import { joinNotebookCode } from '../util/deckSource';
import { pickRevealColumn, type RevealGroup } from './pickDeck';
import { findCellMapTarget, type RevealHit } from './reveal';

export type DeckTargetKind = 'cell' | 'surface';

/**
 * Line and columns of a cell or surface card in deck text. MCNP goes through
 * the reference index (column-accurate); the others search by the deck's own
 * name for the construct (`CellNode.name`), falling back to the numeric id.
 */
export function locateDeckTarget(
    text: string,
    language: string,
    kind: DeckTargetKind,
    id: number,
    name?: string,
): RevealHit | null {
    if (language === 'mcnp') {
        const def = getDefinition(buildMcnpReferenceIndex(text), kind, id);
        return def ? { line: def.line, start: def.startCol, end: def.endCol } : null;
    }
    return findCellMapTarget(text, kind, id, name);
}

/**
 * Editor group for revealing a deck from a panel: the deck's existing tab if
 * it has one anywhere (never a second copy in the panel's window), else a
 * group that does not hold a panel of `panelViewType`.
 */
export function deckRevealColumn(deck: vscode.Uri, panelViewType: string): vscode.ViewColumn {
    const key = deck.toString();
    const groups: RevealGroup[] = vscode.window.tabGroups.all.map((g) => ({
        column: g.viewColumn,
        hasDeck: g.tabs.some(
            (t) => t.input instanceof vscode.TabInputText && t.input.uri.toString() === key,
        ),
        hasMap: g.tabs.some(
            (t) => t.input instanceof vscode.TabInputWebview && t.input.viewType.includes(panelViewType),
        ),
    }));
    return (pickRevealColumn(groups) as vscode.ViewColumn | undefined) ?? vscode.ViewColumn.Beside;
}

/**
 * Jump to a cell or surface card in a deck, selecting it. Handles a notebook
 * deck by mapping the joined-text line back to the owning cell. Returns false
 * (with a status-bar note) when the card cannot be found.
 */
export async function revealDeckTarget(
    deck: vscode.Uri,
    kind: DeckTargetKind,
    id: number,
    name: string | undefined,
    panelViewType: string,
): Promise<boolean> {
    const shown = name ?? String(id);
    const nb = vscode.workspace.notebookDocuments.find((n) => n.uri.toString() === deck.toString());
    if (nb) {
        const { text, cells } = joinNotebookCode(nb);
        const hit = locateDeckTarget(text, 'openmc', kind, id, name);
        if (!hit) {
            vscode.window.setStatusBarMessage(`OWEN: could not find ${kind} ${shown} in this notebook`, 3000);
            return false;
        }
        // Joined text = cells separated by one newline; walk to the owner.
        let line = hit.line;
        for (const cellDoc of cells) {
            if (line < cellDoc.lineCount) {
                const editor = await vscode.window.showTextDocument(cellDoc, { preserveFocus: false });
                const range = new vscode.Range(line, hit.start, line, hit.end);
                editor.selection = new vscode.Selection(range.start, range.end);
                editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
                return true;
            }
            line -= cellDoc.lineCount;
        }
        return false;
    }

    const doc = await vscode.workspace.openTextDocument(deck);
    const language = detectMonteCarloLanguage(doc) ?? 'mcnp';
    const hit = locateDeckTarget(doc.getText(), language, kind, id, name);
    if (!hit) {
        vscode.window.setStatusBarMessage(`OWEN: could not find ${kind} ${shown} in this file`, 3000);
        return false;
    }
    const editor = await vscode.window.showTextDocument(doc, {
        viewColumn: deckRevealColumn(deck, panelViewType),
        preview: false,
        preserveFocus: false,
    });
    const range = new vscode.Range(hit.line, hit.start, hit.line, hit.end);
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    return true;
}
