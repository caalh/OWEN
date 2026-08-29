// Pure, vscode-free core of "Run Simulation" (owen.runSimulation).
//
// Command-line construction is where this feature has gone wrong in ways that
// are invisible until someone's run fails, so all of it lives here and is
// covered by tests and by scripts/verify-run.mjs.

export type MonteCarloLanguage = 'mcnp' | 'openmc' | 'serpent' | 'scone';

export type ShellKind = 'powershell' | 'cmd' | 'posix';

export interface LaunchPlan {
    executable: string;
    args: string[];
    info?: string;
}

/** Reads one `owen.*` setting; supplied by the caller so this file stays pure. */
export type SettingsReader = (key: string) => string | undefined;

/**
 * Which shell the integrated terminal will hand the command line to.
 *
 * This decides quoting, and PowerShell is not a detail to gloss over: given
 * `"C:\Program Files\MCNP\mcnp6.exe" inp=deck.i` it raises "Unexpected token
 * 'inp=deck.i'" and runs nothing, because a quoted string followed by a bare
 * word is not a command. It needs the call operator.
 */
export function detectShellKind(platform: NodeJS.Platform, shellPath?: string): ShellKind {
    if (platform !== 'win32') return 'posix';
    const shell = (shellPath ?? '').toLowerCase();
    if (/(^|[\\/])cmd(\.exe)?"?$/.test(shell)) return 'cmd';
    // The separator matters: without it "pwsh.exe" ends in "sh.exe" and would
    // be taken for a POSIX shell.
    if (/(^|[\\/])(bash|sh|zsh|wsl)(\.exe)?"?$/.test(shell)) return 'posix';
    return 'powershell';
}

export function quoteArg(value: string, shell: ShellKind): string {
    if (shell === 'posix') {
        return /[^\w@%+=:,./-]/.test(value) ? `'${value.replace(/'/g, `'\\''`)}'` : value;
    }
    return /[\s&|<>^]/.test(value) ? `"${value}"` : value;
}

/** Single-quote a value for a POSIX shell (used for `wsl sh -c` payloads). */
export function shQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Render a plan as one command line for the given shell. */
export function formatCommandLine(plan: LaunchPlan, shell: ShellKind): string {
    const parts = [quoteArg(plan.executable, shell), ...plan.args.map((a) => quoteArg(a, shell))];
    // PowerShell treats a quoted first token as a string, not a command, unless
    // the call operator is used. Harmless in front of an unquoted name too.
    if (shell === 'powershell') return `& ${parts.join(' ')}`;
    return parts.join(' ');
}

/** A `cd` line for the given shell. */
export function formatChangeDirectory(dir: string, shell: ShellKind): string {
    if (shell === 'powershell') return `Set-Location ${quoteArg(dir, shell)}`;
    return `cd ${quoteArg(dir, shell)}`;
}

export function planLaunch(
    language: MonteCarloLanguage | null | undefined,
    fileName: string,
    get: SettingsReader,
    platform: NodeJS.Platform = process.platform,
): LaunchPlan | null {
    switch (language) {
        case 'mcnp':
            return {
                executable: get('mcnp.executable') || 'mcnp6',
                args: [`inp=${fileName}`],
            };
        case 'openmc':
            return {
                executable: get('openmc.pythonExecutable') || 'python',
                args: [fileName],
            };
        case 'serpent':
            return {
                executable: get('serpent.executable') || 'sss2',
                args: [fileName],
            };
        case 'scone':
            return {
                executable: get('scone.executable') || 'scone',
                args: [fileName],
                info: platform === 'win32'
                    ? 'SCONE typically requires WSL on Windows. See the OWEN README ROADMAP for setup notes.'
                    : undefined,
            };
        default:
            return null;
    }
}

/**
 * The POSIX directory holding an executable, for putting it on PATH.
 * Kept independent of `path.posix` so this can be reasoned about on Windows.
 */
export function posixDirname(executable: string): string | undefined {
    const idx = executable.lastIndexOf('/');
    return idx > 0 ? executable.slice(0, idx) : undefined;
}

/**
 * The command line for running a deck through a WSL-hosted interpreter.
 *
 * Two environment repairs, both of which OWEN has to make because it starts a
 * non-interactive shell and the user's `conda activate` / `~/.bashrc` exports
 * are therefore absent (bash skips `.bashrc` for non-interactive shells, so
 * even `bash -lc` does not help):
 *
 *   - `OPENMC_CROSS_SECTIONS`, or transport stops with "No cross_sections.xml
 *     file was specified".
 *   - `PATH`, prefixed with the interpreter's own directory. `model.run()` does
 *     not run the simulation in-process; it execs the `openmc` binary, which for
 *     a conda install sits next to the python being used and is otherwise not
 *     found: `FileNotFoundError: [Errno 2] No such file or directory: 'openmc'`.
 */
export function planWslRun(
    python: string,
    scriptWslPath: string,
    cwdWslPath: string,
    crossSections?: string,
): LaunchPlan {
    const assignments: string[] = [];
    const bin = posixDirname(python);
    if (bin) assignments.push(`PATH=${shQuote(bin)}:"$PATH"`);
    if (crossSections) assignments.push(`OPENMC_CROSS_SECTIONS=${shQuote(crossSections)}`);
    const env = assignments.length > 0 ? `${assignments.join(' ')} ` : '';
    return {
        executable: 'wsl',
        args: [
            '--exec',
            'sh',
            '-c',
            `cd ${shQuote(cwdWslPath)} && ${env}${shQuote(python)} ${shQuote(scriptWslPath)}`,
        ],
    };
}

/** A shell statement exporting one environment variable. */
export function formatEnvAssignment(name: string, value: string, shell: ShellKind): string {
    if (shell === 'powershell') return `$env:${name} = ${quoteArg(value, shell)}`;
    if (shell === 'cmd') return `set ${name}=${value}`;
    return `export ${name}=${quoteArg(value, shell)}`;
}

const MCNP_FAMILIES: Array<[string, string]> = [
    ['outp', 'out'],
    ['runtpe', 'runtp'],
    ['mctal', 'mcta'],
    ['meshtal', 'meshta'],
    ['srctp', 'srct'],
];

/**
 * MCNP output files already present, and the families with no name left.
 *
 * MCNP does not overwrite an output file and does not stop: it advances the
 * last letter of the name, so a directory holding `outp` gets `outq` next, then
 * `outr`, and past `outz` there is nowhere to write (LA-10860 §1.4.1, and the
 * same behaviour in MCNP6: "meshtal already exists. meshtam is created
 * instead."). Two things follow, and OWEN used to get both wrong: a rerun in a
 * dirty directory succeeds but writes somewhere new, and after 26 runs it fails.
 */
export function mcnpOutputCollisions(listing: string[]): { existing: string[]; exhausted: string[] } {
    const present = new Set(listing.map((n) => n.toLowerCase()));
    const existing: string[] = [];
    const exhausted: string[] = [];
    for (const [base, stem] of MCNP_FAMILIES) {
        const start = base.charCodeAt(base.length - 1);
        const names: string[] = [];
        for (let c = start; c <= 'z'.charCodeAt(0); c++) names.push(stem + String.fromCharCode(c));
        const taken = names.filter((n) => present.has(n));
        if (taken.length === 0) continue;
        existing.push(...taken);
        if (taken.length === names.length) exhausted.push(base);
    }
    return { existing, exhausted };
}

export function ordinal(n: number): string {
    if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
    return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}
