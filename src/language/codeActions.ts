import * as vscode from 'vscode';
import { importanceFix, remediationFix, replaceOpenmcSource } from './quickFixes';

export function registerQuickFixes(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider('mcnp', new McnpQuickFix(), {
            providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
        }),
        vscode.languages.registerCodeActionsProvider('python', new OpenmcSourceQuickFix(), {
            providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
        }),
    );
}

class McnpQuickFix implements vscode.CodeActionProvider {
    provideCodeActions(document: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];
        const text = document.getText();
        const repair = remediationFix(text);
        if (repair) {
            const action = new vscode.CodeAction(repair.title, vscode.CodeActionKind.QuickFix);
            action.edit = new vscode.WorkspaceEdit();
            action.edit.replace(document.uri, whole(document), repair.output);
            const tally = context.diagnostics.filter((diagnostic) =>
                diagnostic.code === 'mcnp.unbounded-tally' || diagnostic.code === 'mcnp.tally-needs-sd');
            if (tally.length) action.diagnostics = tally;
            actions.push(action);
        }
        for (const diagnostic of context.diagnostics) {
            if (diagnostic.code !== 'mcnp.cell-imp') continue;
            const line = document.lineAt(diagnostic.range.start.line);
            const fixed = importanceFix(line.text);
            if (!fixed || fixed === line.text) continue;
            const action = new vscode.CodeAction('Add imp:n for this cell', vscode.CodeActionKind.QuickFix);
            action.edit = new vscode.WorkspaceEdit();
            action.edit.replace(document.uri, line.range, fixed);
            action.diagnostics = [diagnostic];
            actions.push(action);
        }
        return actions;
    }
}

class OpenmcSourceQuickFix implements vscode.CodeActionProvider {
    provideCodeActions(document: vscode.TextDocument): vscode.CodeAction[] {
        const text = document.getText();
        const replaced = replaceOpenmcSource(text);
        if (!replaced) return [];
        const action = new vscode.CodeAction('Use openmc.IndependentSource', vscode.CodeActionKind.QuickFix);
        action.edit = new vscode.WorkspaceEdit();
        action.edit.replace(document.uri, whole(document), replaced);
        return [action];
    }
}

function whole(document: vscode.TextDocument): vscode.Range {
    return new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
}
