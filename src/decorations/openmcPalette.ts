import * as vscode from 'vscode';
import { detectMonteCarloLanguage } from '../util/detectLanguage';
import { forcedColorCss } from '../highlight/forcedColor';
import { findOpenmcTokens, OpenmcScope } from '../highlight/openmcTokens';
import { PaletteId, TokenStyle, paletteIdFromLabel, setCustomColors, styleForScope } from '../highlight/palettes';

// Draw the OpenMC palette over Pylance.
//
// The injection grammar and `editor.tokenColorCustomizations` are the right
// mechanism when nothing else claims the file, and they stay in place. But a
// Python language server publishes semantic tokens, and VS Code colors a
// semantic token from the scopes its *type* maps to, not from whatever the
// grammar put underneath. `openmc.Material` arrives as a `class` token and is
// colored as `entity.name.type.class`, so `support.class.openmc` never gets a
// say. Since almost every OpenMC user has Pylance, the palette was invisible
// for almost every OpenMC user.
//
// Decorations render above both the TextMate and semantic layers, so the same
// palette is applied a second way here for Python files that import openmc.

const SCOPES: OpenmcScope[] = [
    'variable.language.openmc',
    'support.type.openmc',
    'support.class.openmc',
    'support.function.openmc',
    'support.variable.openmc',
];

// Beyond this the scan stops being free and the file is almost certainly not a
// hand-written input deck.
const MAX_BYTES = 2_000_000;

/**
 * Decoration options that actually win against a theme's token colors.
 *
 * `DecorationRenderOptions.color` alone is not enough — that is why v1.0.4
 * shipped a palette that still did nothing on a machine with Pylance. The
 * ordering problem and the `!important` workaround are described in
 * {@link forcedColorCss}; `color` is kept as well so the intent is legible to
 * anything that inspects the decoration type.
 */
function forceColor(style: TokenStyle): vscode.DecorationRenderOptions {
    return {
        color: style.foreground,
        fontStyle: style.fontStyle,
        textDecoration: forcedColorCss(style),
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    };
}

function isEnabled(): boolean {
    return vscode.workspace
        .getConfiguration('owen')
        .get<boolean>('highlight.openmc.decorate', true);
}

function currentPalette(): PaletteId {
    return paletteIdFromLabel(
        vscode.workspace.getConfiguration('owen').get<string>('highlight.openmc.palette'),
    );
}

class OpenmcDecorator implements vscode.Disposable {
    private types = new Map<OpenmcScope, vscode.TextEditorDecorationType>();
    private fingerprint: string | null = null;
    private timer: NodeJS.Timeout | undefined;

    dispose(): void {
        if (this.timer) clearTimeout(this.timer);
        this.disposeTypes();
    }

    private disposeTypes(): void {
        for (const t of this.types.values()) t.dispose();
        this.types.clear();
        this.fingerprint = null;
    }

    /**
     * Decoration types carry their color, so they rebuild when the *resolved
     * styles* change — not just when the palette id changes. The distinction
     * matters for the Custom palette, whose id stays "custom" while
     * owen.highlight.customColors edits change every color.
     */
    private ensureTypes(palette: PaletteId): void {
        const styles = SCOPES.map((scope) => [scope, styleForScope('openmc', palette, scope)] as const);
        const fingerprint = JSON.stringify(styles);
        if (this.fingerprint === fingerprint && this.types.size > 0) return;
        this.disposeTypes();
        for (const [scope, style] of styles) {
            if (!style) continue;
            this.types.set(scope, vscode.window.createTextEditorDecorationType(forceColor(style)));
        }
        this.fingerprint = fingerprint;
    }

    private clear(editor: vscode.TextEditor): void {
        for (const t of this.types.values()) editor.setDecorations(t, []);
    }

    refresh(editor: vscode.TextEditor): void {
        const doc = editor.document;
        if (!isEnabled() || doc.languageId !== 'python' || doc.getText().length > MAX_BYTES) {
            this.clear(editor);
            return;
        }
        // Idempotent and cheap; guarantees the Custom palette resolves against
        // the live config even if this refresh ran before applyPalettes().
        setCustomColors(vscode.workspace.getConfiguration('owen').get('highlight.customColors'));
        this.ensureTypes(currentPalette());
        if (detectMonteCarloLanguage(doc) !== 'openmc') {
            this.clear(editor);
            return;
        }

        const text = doc.getText();
        const byScope = new Map<OpenmcScope, vscode.Range[]>(SCOPES.map((s) => [s, []]));
        for (const token of findOpenmcTokens(text)) {
            byScope
                .get(token.scope)
                ?.push(new vscode.Range(doc.positionAt(token.start), doc.positionAt(token.end)));
        }
        for (const [scope, type] of this.types) {
            editor.setDecorations(type, byScope.get(scope) ?? []);
        }
    }

    refreshAll(): void {
        for (const editor of vscode.window.visibleTextEditors) this.refresh(editor);
    }

    /** Typing in a large deck shouldn't re-scan on every keystroke. */
    schedule(): void {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = undefined;
            this.refreshAll();
        }, 150);
    }
}

/**
 * Register the OpenMC token decorator: seeds visible editors, then keeps up
 * with edits, editor changes, and palette changes.
 */
export function registerOpenmcPalette(context: vscode.ExtensionContext): void {
    const decorator = new OpenmcDecorator();
    context.subscriptions.push(decorator);

    decorator.refreshAll();

    context.subscriptions.push(
        vscode.window.onDidChangeVisibleTextEditors(() => decorator.refreshAll()),
        vscode.workspace.onDidChangeTextDocument((e) => {
            if (e.document.languageId === 'python') decorator.schedule();
        }),
        vscode.workspace.onDidChangeConfiguration((e) => {
            // owen.highlight.customColors also affects this decorator when the
            // OpenMC palette is set to Custom, so listen at the highlight root.
            if (e.affectsConfiguration('owen.highlight')) decorator.refreshAll();
        }),
        // A theme switch rebuilds the token stylesheet, and the palette colors are
        // chosen for a dark background, so both the ranges and the reason to draw
        // them are worth re-evaluating.
        vscode.window.onDidChangeActiveColorTheme(() => decorator.refreshAll()),
    );
}
