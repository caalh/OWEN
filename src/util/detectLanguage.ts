import * as vscode from 'vscode';

export type MonteCarloLanguage = 'mcnp' | 'openmc' | 'serpent' | 'scone';

const OPENMC_IMPORT_RE = /^\s*(?:import\s+openmc(?:\s|;|$)|from\s+openmc(?:\.[\w]+)?\s+import\s+)/m;

function looksLikeOpenmcDeckXml(text: string): boolean {
    const head = text.trimStart();
    if (!head.startsWith('<')) return false;
    return /<(geometry|model|materials)\b/i.test(head.slice(0, 2500));
}

/**
 * Resolves a document to one of the Monte Carlo language families OWEN knows about,
 * or null when the file is unrelated. Python files are sniffed for an `openmc`
 * import because VS Code does not register a distinct `openmc` language.
 */
export function detectMonteCarloLanguage(doc: vscode.TextDocument): MonteCarloLanguage | null {
    const langId = doc.languageId;
    switch (langId) {
        case 'mcnp':
        case 'serpent':
        case 'scone':
            return langId;
        case 'python':
            return OPENMC_IMPORT_RE.test(doc.getText()) ? 'openmc' : null;
        case 'xml':
            return looksLikeOpenmcDeckXml(doc.getText()) ? 'openmc' : null;
        default:
            return null;
    }
}

/**
 * String-only variant for tests and headless tooling that doesn't have a TextDocument.
 */
export function detectMonteCarloLanguageFromText(
    text: string,
    languageId: string,
): MonteCarloLanguage | null {
    switch (languageId) {
        case 'mcnp':
        case 'serpent':
        case 'scone':
            return languageId;
        case 'python':
            return OPENMC_IMPORT_RE.test(text) ? 'openmc' : null;
        case 'xml':
            return looksLikeOpenmcDeckXml(text) ? 'openmc' : null;
        default:
            return null;
    }
}
