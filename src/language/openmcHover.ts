import * as vscode from 'vscode';
import { detectMonteCarloLanguage } from '../util/detectLanguage';
import { tokenAt, zaidHoverMarkdown } from './zaidHover';

/**
 * Nuclide hover for OpenMC decks. Python is Pylance's language, so the MC
 * language server never sees these files; this is a plain client provider
 * that only speaks up for a quoted nuclide name (`'U235'`, `"Am242_m1"`) in a
 * file that imports openmc. VS Code stacks it under Pylance's own hover.
 */
export function registerOpenmcHover(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            [{ language: 'python' }, { scheme: 'vscode-notebook-cell', language: 'python' }],
            {
                provideHover(document, position) {
                    if (detectMonteCarloLanguage(document) !== 'openmc') return null;
                    const line = document.lineAt(position.line).text;
                    const tok = tokenAt(line, position.character);
                    if (!tok) return null;
                    // Only quoted tokens: a bare `U235` is a Python name.
                    const before = line[tok.start - 1];
                    const after = line[tok.end];
                    if (!((before === '\'' || before === '"') && after === before)) return null;
                    const md = zaidHoverMarkdown(tok.text, 'openmc');
                    if (!md) return null;
                    return new vscode.Hover(
                        new vscode.MarkdownString(md),
                        new vscode.Range(position.line, tok.start, position.line, tok.end),
                    );
                },
            },
        ),
    );
}
