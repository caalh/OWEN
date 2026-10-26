/**
 * Edits a quick-fix may apply. A fix that would delete the card, or chase
 * criticality, is not offered. Density-sign and mixed-fraction warnings are
 * not fixed here: the sign the author meant is not in the text.
 */

import { remediateMcnp } from '../converter/remediate';

/** Append imp:n to one cell line that does not have it. Void cells get 0. */
export function importanceFix(line: string): string | null {
    if (/imp:/i.test(line)) return null;
    if (/^\s{5,}/.test(line)) return null;
    if (/^\s*(c\b|\$)/i.test(line)) return null;
    if (/^\s*\d+\s+0\s+\S/.test(line)) return line.replace(/\s*$/, '') + ' imp:n=0';
    if (/^\s*\d+\s+[1-9]\d*\s+[-+]?\d/.test(line)) return line.replace(/\s*$/, '') + ' imp:n=1';
    return null;
}

/**
 * Whole-deck repairs from remediateMcnp: the imp:n=0 complement of a single
 * sphere, and an sd equal to a known sphere or cylinder volume. A physics
 * request ("make critical") suppresses every edit.
 */
export function remediationFix(text: string): { title: string; output: string } | null {
    const result = remediateMcnp(text);
    if (result.refused.some((item) => item.ruleId === 'physics-judgement')) return null;
    if (result.edits.length === 0) return null;
    const kept = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/^c\b/i.test(line));
    for (const line of kept) {
        if (!result.output.includes(line)) return null;
    }
    return {
        title: result.edits.map((edit) => edit.rationale).join(' '),
        output: result.output,
    };
}

/** openmc.Source is the old name. IndependentSource is the current one. */
export function replaceOpenmcSource(text: string): string | null {
    if (!/openmc\.Source\(/.test(text)) return null;
    return text.replace(/openmc\.Source\(/g, 'openmc.IndependentSource(');
}
