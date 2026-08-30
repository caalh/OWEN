/**
 * Role-aware occurrence paint for MCNP decks.
 *
 * VS Code's built-in word highlighter never fires on a bare fill-array integer:
 * `language-configuration/mcnp.language-configuration.json` deliberately drops
 * `\\d+` from `wordPattern` so a `2` in a lattice is not the same "word" as
 * cell 2, material 2, or surface 2. The LSP documentHighlight provider already
 * knows the role, but the editor still only *selects* the definition when the
 * tree jumps there — so this module paints every occurrence of the resolved
 * entity (definition = strong, references = regular) from the cursor *and*
 * from the MCNP References tree.
 */
import * as vscode from 'vscode';
import {
    getHighlightOccurrences,
    getOccurrences,
    McnpEntityKind,
    Occurrence,
} from './mcnpReferences';
import { getIndexFor } from './providers';

let readDeco: vscode.TextEditorDecorationType | undefined;
let writeDeco: vscode.TextEditorDecorationType | undefined;

function ensureDecos(): { read: vscode.TextEditorDecorationType; write: vscode.TextEditorDecorationType } {
    if (!readDeco) {
        readDeco = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('editor.wordHighlightBackground'),
            borderRadius: '2px',
            overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.wordHighlightForeground'),
            overviewRulerLane: vscode.OverviewRulerLane.Center,
        });
    }
    if (!writeDeco) {
        writeDeco = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('editor.wordHighlightStrongBackground'),
            borderRadius: '2px',
            overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.wordHighlightStrongForeground'),
            overviewRulerLane: vscode.OverviewRulerLane.Center,
        });
    }
    return { read: readDeco, write: writeDeco };
}

function rangeOf(o: Occurrence): vscode.Range {
    return new vscode.Range(o.line, o.startCol, o.line, o.endCol);
}

export function paintMcnpOccurrences(editor: vscode.TextEditor, occs: Occurrence[]): void {
    const { read, write } = ensureDecos();
    editor.setDecorations(write, occs.filter((o) => o.isDefinition).map(rangeOf));
    editor.setDecorations(read, occs.filter((o) => !o.isDefinition).map(rangeOf));
}

export function clearMcnpOccurrences(editor: vscode.TextEditor): void {
    if (!readDeco || !writeDeco) return;
    editor.setDecorations(readDeco, []);
    editor.setDecorations(writeDeco, []);
}

/** Paint every occurrence of an entity the tree named (role-aware, not digit-matching). */
export function paintMcnpEntity(editor: vscode.TextEditor, kind: McnpEntityKind, id: number): void {
    if (editor.document.languageId !== 'mcnp') return;
    paintMcnpOccurrences(editor, getOccurrences(getIndexFor(editor.document), kind, id));
}

/** Paint the entity under the cursor or the current selection. */
export function paintMcnpAtCursor(editor: vscode.TextEditor): void {
    if (editor.document.languageId !== 'mcnp') {
        clearMcnpOccurrences(editor);
        return;
    }
    const index = getIndexFor(editor.document);
    const occs = occurrencesForSelection(index, editor.selection);
    if (occs.length) paintMcnpOccurrences(editor, occs);
    else clearMcnpOccurrences(editor);
}

/**
 * Resolve the entity a selection is on. Double-click and left-to-right drag
 * both put the caret at the exclusive end of the token (one past the last
 * digit), which `resolveAt` treats as a miss because fill-array integers are
 * not editor words. Trying the start of the span and the last included column
 * is what makes a double-clicked lattice number light up the rest of the map.
 */
export function occurrencesForSelection(
    index: ReturnType<typeof getIndexFor>,
    sel: vscode.Selection,
): Occurrence[] {
    const tries: Array<{ line: number; character: number }> = [
        { line: sel.active.line, character: sel.active.character },
        { line: sel.start.line, character: sel.start.character },
    ];
    if (!sel.isEmpty && sel.end.character > 0) {
        tries.push({ line: sel.end.line, character: sel.end.character - 1 });
    }
    if (sel.active.character > 0) {
        tries.push({ line: sel.active.line, character: sel.active.character - 1 });
    }
    for (const pos of tries) {
        const occs = getHighlightOccurrences(index, pos.line, pos.character);
        if (occs.length) return occs;
    }
    return [];
}

export function registerMcnpOccurrenceHighlights(context: vscode.ExtensionContext): void {
    ensureDecos();
    context.subscriptions.push(
        readDeco!,
        writeDeco!,
        vscode.window.onDidChangeTextEditorSelection((e) => {
            if (e.textEditor.document.languageId !== 'mcnp') return;
            paintMcnpAtCursor(e.textEditor);
        }),
        vscode.window.onDidChangeActiveTextEditor((ed) => {
            if (ed && ed.document.languageId === 'mcnp') paintMcnpAtCursor(ed);
        }),
    );
}
