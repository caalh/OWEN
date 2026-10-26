/**
 * Per-construct certification of an MCNP deck across the three converters.
 *
 * A construct the parser captured is either absent from the TODO list
 * (translated) or present as a TODO(owen-convert) line (not dropped).
 * This command does not launch OpenMC, Serpent, or SCONE. Execution of the
 * OpenMC side is verify:owen-workbench / verify:convert-openmc. Serpent and
 * SCONE stay a structural skip until those codes are installed.
 */

import { mcnpToOpenmc } from './mcnpToOpenmc';
import { mcnpToSerpent } from './mcnpToSerpent';
import { mcnpToScone } from './mcnpToScone';
import { runLanguageRules } from '../language/rules';

const BOILERPLATE = [
    'Unconvertible constructs are marked',
    'verify nuclide library suffixes',
];

export function constructTodos(output: string): string[] {
    return output
        .split('\n')
        .filter((line) => line.includes('TODO(owen-convert)') && !BOILERPLATE.some((mark) => line.includes(mark)));
}

export interface CertRow {
    target: 'openmc' | 'serpent' | 'scone';
    status: 'translated' | 'todo';
    todos: string[];
    execution: 'skipped';
    executionReason: string;
}

export function certifyMcnp(text: string): { codes: string[]; rows: CertRow[] } {
    const codes = [...new Set(runLanguageRules('mcnp', text).map((diag) => diag.code))];
    const jobs = [
        ['openmc', mcnpToOpenmc, 'This command does not launch OpenMC. The site gate verify:owen-workbench runs the corpus.'],
        ['serpent', mcnpToSerpent, 'Serpent is not assumed installed, so this row is structural. A missing code is a skip, not a pass.'],
        ['scone', mcnpToScone, 'SCONE is not assumed installed, so this row is structural. A missing code is a skip, not a pass.'],
    ] as const;
    const rows: CertRow[] = jobs.map(([target, convert, executionReason]) => {
        const todos = constructTodos(convert(text).output);
        return {
            target,
            status: todos.length ? 'todo' : 'translated',
            todos,
            execution: 'skipped',
            executionReason,
        };
    });
    return { codes, rows };
}

export function certifyPanel(text: string): string {
    const report = certifyMcnp(text);
    const guidance = 'Certification is per construct: translated, or a visible TODO. It does not say the deck is physically right, and it does not run a code that is not installed.';
    const rows = report.rows.map((row) => `${row.target}: ${row.status} (${row.todos.length} TODO). ${row.executionReason}`);
    return [guidance, ...rows].join('\n');
}
