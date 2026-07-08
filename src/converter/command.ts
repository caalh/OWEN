// OWEN: Convert Deck… — source->target picker + Rosetta diff view (source and
// converted output side-by-side with issues highlighted).
// MCNP<->OpenMC is STABLE as of v1.0.0 (hi-fi rewrite, BEAVRS-gauntlet tested);
// Serpent/SCONE targets remain EXPERIMENTAL.

import * as vscode from 'vscode';
import {
    convert, detectConversionSource, CONVERSION_TARGETS,
    SourceLanguage, TargetLanguage, ConversionResult,
} from './index';
import { showRosettaDiff } from './rosettaView';

const TARGET_LABELS: Record<TargetLanguage, string> = {
    mcnp: 'MCNP input deck',
    openmc: 'OpenMC Python script',
    serpent: 'Serpent 2 input',
    scone: 'SCONE input',
};

export function registerConvertDeck(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand('owen.convertDeck', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('OWEN: open the deck you want to convert first.');
            return;
        }
        const text = editor.document.getText();

        let source: SourceLanguage | null = null;
        const langId = editor.document.languageId;
        if (langId === 'mcnp') source = 'mcnp';
        else if (langId === 'python') source = detectConversionSource(text) === 'openmc' ? 'openmc' : null;
        else source = detectConversionSource(text);

        if (!source) {
            vscode.window.showWarningMessage(
                'OWEN: cannot convert this file — supported sources are MCNP decks and OpenMC Python scripts.',
            );
            return;
        }

        const targets = CONVERSION_TARGETS[source];
        const maturity = (t: TargetLanguage) =>
            (t === 'openmc' || t === 'mcnp') ? 'stable' : 'experimental';
        const pick = await vscode.window.showQuickPick(
            targets.map((t) => ({
                label: `${source!.toUpperCase()} → ${TARGET_LABELS[t]}`,
                description: maturity(t),
                target: t,
            })),
            {
                title: 'OWEN: Convert Deck (always review the output)',
                placeHolder: `Convert this ${source.toUpperCase()} ${source === 'openmc' ? 'script' : 'deck'} to…`,
            },
        );
        if (!pick) return;

        let result: ConversionResult;
        try {
            result = convert(source, pick.target, text);
        } catch (err) {
            vscode.window.showErrorMessage(`OWEN: conversion failed: ${(err as Error).message}`);
            return;
        }

        const action = await vscode.window.showInformationMessage(
            `OWEN: converted ${source.toUpperCase()} → ${pick.target.toUpperCase()} with ` +
            `${result.issues.length} construct(s) needing manual attention. ` +
            `This converter is ${maturity(pick.target).toUpperCase()} — verify the physics before running.`,
            'Open Rosetta Diff', 'Open Converted Only',
        );

        if (action === 'Open Rosetta Diff') {
            showRosettaDiff(text, source, result, pick.target);
            return;
        }

        const doc = await vscode.workspace.openTextDocument({
            content: result.output,
            language: pick.target === 'openmc' ? 'python' : pick.target,
        });
        await vscode.window.showTextDocument(doc, { preview: false });
    });
}
