import * as vscode from 'vscode';
import { cardFactMarkdown } from './cardFacts';

export function registerCardHover(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.languages.registerHoverProvider('mcnp', {
            provideHover(document, position) {
                const line = document.lineAt(position.line).text;
                const token = tokenAt(line, position.character);
                if (!token) return null;
                const fact = cardFactMarkdown(token.text);
                if (!fact) return null;
                return new vscode.Hover(
                    new vscode.MarkdownString(fact),
                    new vscode.Range(position.line, token.start, position.line, token.end),
                );
            },
        }),
    );
}

function tokenAt(line: string, column: number): { text: string; start: number; end: number } | null {
    const match = /[A-Za-z][A-Za-z0-9:]*/g;
    let found: RegExpExecArray | null;
    while ((found = match.exec(line))) {
        if (column >= found.index && column <= found.index + found[0].length) {
            return { text: found[0], start: found.index, end: found.index + found[0].length };
        }
    }
    return null;
}
