import * as vscode from 'vscode';
import { detectMonteCarloLanguage, detectMonteCarloLanguageFromText, MonteCarloLanguage } from './detectLanguage';

/**
 * The deck a command should act on, resolved from an editor.
 *
 * Ordinary files are themselves. A notebook cell is different: OpenMC models
 * are routinely built in Jupyter, one cell for materials, one for geometry,
 * one for settings, and no single cell is a deck. So for a cell editor the
 * deck is every code cell of its notebook joined in order — the text the
 * kernel has effectively executed — and `uri` is the notebook's, so
 * click-to-reveal and diagnostics can still find their way back.
 */
export interface DeckSource {
    text: string;
    language: MonteCarloLanguage;
    /** Notebook URI for cells; the document URI otherwise. */
    uri: vscode.Uri;
    /** Set for notebook cells: the cell documents in order, for line mapping. */
    cells?: vscode.TextDocument[];
    fromNotebook: boolean;
}

export function notebookOfCell(doc: vscode.TextDocument): vscode.NotebookDocument | undefined {
    if (doc.uri.scheme !== 'vscode-notebook-cell') return undefined;
    const key = doc.uri.toString();
    return vscode.workspace.notebookDocuments.find((nb) =>
        nb.getCells().some((c) => c.document.uri.toString() === key),
    );
}

/** Code cells of a notebook joined into one Python deck. */
export function joinNotebookCode(nb: vscode.NotebookDocument): { text: string; cells: vscode.TextDocument[] } {
    const cells = nb.getCells()
        .filter((c) => c.kind === vscode.NotebookCellKind.Code && c.document.languageId === 'python')
        .map((c) => c.document);
    // Cell magics (`%matplotlib inline`) are not Python; blank them so the
    // regex parsers see the same line numbers the notebook shows.
    const text = cells.map((d) => d.getText().replace(/^\s*[%!].*$/gm, '')).join('\n');
    return { text, cells };
}

export function deckSourceOf(doc: vscode.TextDocument): DeckSource | null {
    const nb = notebookOfCell(doc);
    if (nb) {
        const { text, cells } = joinNotebookCode(nb);
        const language = detectMonteCarloLanguageFromText(text, 'python');
        if (!language) return null;
        return { text, language, uri: nb.uri, cells, fromNotebook: true };
    }
    const language = detectMonteCarloLanguage(doc);
    if (!language) return null;
    return { text: doc.getText(), language, uri: doc.uri, fromNotebook: false };
}

/** The active editor's deck, or null with nothing shown (callers decide the message). */
export function activeDeckSource(): DeckSource | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;
    return deckSourceOf(editor.document);
}
