/** Validate a generated snippet before insert (headless wrapper over language rules). */

import { runLanguageRules } from '../language/rules';
import type { MonteCarloCode } from './materials';

export interface SnippetValidationIssue {
    line: number;
    message: string;
    severity: 'error' | 'warning' | 'information' | 'hint';
    code?: string;
}

export function validateSnippet(code: MonteCarloCode, text: string): SnippetValidationIssue[] {
    const lang = code === 'openmc' ? 'openmc' : code;
    return runLanguageRules(lang, text).map((d) => ({
        line: d.line,
        message: d.message,
        severity: d.severity,
        code: d.code,
    }));
}

export function formatValidationSummary(issues: SnippetValidationIssue[]): string {
    if (issues.length === 0) return 'Validation: no issues found.';
    const errors = issues.filter((i) => i.severity === 'error').length;
    const warnings = issues.filter((i) => i.severity === 'warning').length;
    const parts: string[] = [];
    if (errors) parts.push(`${errors} error(s)`);
    if (warnings) parts.push(`${warnings} warning(s)`);
    return `Validation: ${parts.join(', ')} — review before insert.`;
}
