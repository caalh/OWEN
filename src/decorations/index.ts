import * as vscode from 'vscode';
import { registerToggleInvisibles } from './invisibles';
import { registerMcnpLineGuard } from './mcnpLineGuard';
import { registerOpenmcPalette } from './openmcPalette';

/**
 * Register OWEN's editor-decoration features:
 *  - "OWEN: Toggle Invisible Characters" (whitespace + control chars)
 *  - the MCNP card-image line-length guard (ruler + diagnostics + decoration)
 *  - the OpenMC palette, drawn over Pylance's semantic tokens
 */
export function registerDecorations(context: vscode.ExtensionContext): void {
    registerToggleInvisibles(context);
    registerMcnpLineGuard(context);
    registerOpenmcPalette(context);
}
