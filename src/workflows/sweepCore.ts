// Pure, vscode-free core of the parameter sweep (owen.runSweep).
//
// Everything here is deterministic and side-effect free so it can be unit
// tested directly: parameter expansion, the per-combination text substitution,
// the k-eff stdout scraping, and the run-directory / manifest / summary layout.
// The vscode-facing orchestration (file IO, child_process, progress UI) lives
// in sweep.ts and delegates to these helpers.

export interface SweepParameter {
    name: string;
    values: Array<string | number>;
    /** Regex matched against baseFile. Group 1 is replaced with each parameter value. */
    pattern: string;
}

export interface SweepConfig {
    baseFile: string;
    parameters: SweepParameter[];
    output: { dir: string };
    /** Optional explicit language override; otherwise detected from baseFile extension. */
    language?: string;
}

export interface RunRecord {
    index: number;
    parameters: Record<string, string | number>;
    inputFile: string;
    outputDir: string;
    keff?: number | null;
    /** Standard deviation on k-eff, when the output file reports one. */
    keffStd?: number | null;
    /** Which file k-eff came from, so a suspicious row can be traced. */
    keffSource?: string;
    exitCode: number | null;
    stdoutPath: string;
}

export interface SweepManifest {
    baseFile: string;
    language: string;
    parameters: SweepParameter[];
    runs: RunRecord[];
}

// k-eff scrapers, tried in order. Serpent's "final estimated … keff", OpenMC's
// "Combined k-effective = …", then a generic "k-eff = …" fallback.
// NUM requires a real number (at least one digit) — the old `[0-9.]+` class
// matched dots-only garbage ("...") and produced NaN k-eff values.
const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`;
export const KEFF_RE = new RegExp(
    String.raw`final\s+estimated\s+combined\s+collision\s*\/\s*absorption\s*\/\s*track[-\s]length\s+keff[^=:\d]*[=:]?\s*(${NUM})`, 'i');
export const KEFF_OPENMC_RE = new RegExp(String.raw`Combined\s+k-?effective\s*=\s*(${NUM})`, 'i');
export const KEFF_FALLBACK_RE = new RegExp(String.raw`\bk-?eff\s*[=:]\s*(${NUM})`, 'i');

/**
 * Extract a k-eff value from simulation stdout, or null when no recognizable
 * k-eff line is present (the summary then records "n/a").
 */
export function parseKeff(text: string): number | null {
    const m = text.match(KEFF_RE) || text.match(KEFF_OPENMC_RE) || text.match(KEFF_FALLBACK_RE);
    if (!m) return null;
    const v = parseFloat(m[1]);
    return isNaN(v) ? null : v;
}

/** Cartesian product of all parameter value lists (one record per combination). */
export function cartesian(parameters: SweepParameter[]): Record<string, string | number>[] {
    if (parameters.length === 0) return [{}];
    const [head, ...tail] = parameters;
    const rest = cartesian(tail);
    const out: Record<string, string | number>[] = [];
    for (const v of head.values) {
        for (const r of rest) out.push({ [head.name]: v, ...r });
    }
    return out;
}

/**
 * Apply one parameter combination to the base text. For each parameter, the
 * first match of its regex is rewritten: capture group 1 is replaced with the
 * value, preserving the surrounding match. Patterns are expected to include a
 * capture group around the value to substitute (e.g.
 * `add_nuclide\('U235', ([0-9.]+)`); a group-less pattern is unsupported.
 */
export function applyParameters(
    text: string,
    params: Record<string, string | number>,
    schema: SweepParameter[],
): string {
    let out = text;
    for (const p of schema) {
        const value = String(params[p.name]);
        const re = new RegExp(p.pattern);
        out = out.replace(re, (match, group: string | undefined) => {
            if (group === undefined) return value;
            const idx = match.indexOf(group);
            return match.slice(0, idx) + value + match.slice(idx + group.length);
        });
    }
    return out;
}

/**
 * Check every parameter's pattern against the base deck before any run starts.
 *
 * A pattern that matches nothing is the worst failure this feature has: every
 * run then gets the unmodified deck, all of them produce the same answer, and
 * the summary table looks like a sweep where the parameter simply has no effect.
 * A pattern with no capture group is equally wrong — `applyParameters` would
 * replace the whole match, so `add_nuclide\('U235', 0\.04` would be replaced by
 * the bare value and the deck would stop being valid Python.
 */
export function validateParameters(text: string, parameters: SweepParameter[]): string[] {
    const problems: string[] = [];
    for (const p of parameters) {
        if (!p.name) {
            problems.push('A parameter has no name.');
            continue;
        }
        if (!p.values || p.values.length === 0) {
            problems.push(`Parameter "${p.name}" has no values.`);
        }
        let re: RegExp;
        try {
            re = new RegExp(p.pattern);
        } catch (err) {
            problems.push(`Parameter "${p.name}" has an invalid pattern: ${(err as Error).message}`);
            continue;
        }
        const m = text.match(re);
        if (!m) {
            problems.push(
                `Parameter "${p.name}" pattern /${p.pattern}/ matches nothing in the base file, ` +
                    'so every run would use the same deck.',
            );
            continue;
        }
        if (m.length < 2 || m[1] === undefined) {
            problems.push(
                `Parameter "${p.name}" pattern /${p.pattern}/ has no capture group around the value to replace, ` +
                    'so the whole match would be overwritten.',
            );
        }
    }
    return problems;
}

/** Zero-padded run directory name for a given run index, e.g. 3 → "run_003". */
export function runDirName(index: number): string {
    return `run_${String(index).padStart(3, '0')}`;
}

/** Build the manifest object that is serialized to sweep-manifest.json. */
export function buildManifest(
    baseFilePath: string,
    language: string,
    parameters: SweepParameter[],
    records: RunRecord[],
): SweepManifest {
    return { baseFile: baseFilePath, language, parameters, runs: records };
}

/**
 * Build the tab-separated summary table (header + one row per run): index, each
 * parameter, exit code, k-eff and its standard deviation. Missing values render
 * as "n/a". The returned string has no trailing newline; callers append one.
 */
export function buildSummaryTsv(parameters: SweepParameter[], records: RunRecord[]): string {
    const lines = [
        ['index', ...parameters.map((p) => p.name), 'exit', 'keff', 'keff_std', 'source'].join('\t'),
        ...records.map((r) =>
            [
                r.index,
                ...parameters.map((p) => r.parameters[p.name]),
                r.exitCode ?? 'n/a',
                r.keff ?? 'n/a',
                r.keffStd ?? 'n/a',
                r.keffSource ?? 'n/a',
            ].join('\t'),
        ),
    ];
    return lines.join('\n');
}
