/**
 * Finds a Python interpreter that can `import openmc`, in the priority order
 * defined by `orderCandidates` in core.ts:
 *
 *   1. `owen.openmc.pythonExecutable` — only when the user explicitly set it
 *      (the setting's default "python" is NOT treated as an explicit choice);
 *   2. the interpreter the ms-python extension has selected for the workspace
 *      (via its `environments` API — guarded, the extension may be absent);
 *   3. `python` / `python3` on PATH;
 *   4. on Windows: `wsl python3` — OpenMC is commonly installed under WSL.
 *
 * Each candidate is verified by actually running
 * `python -c "import openmc, sys; print(openmc.__version__)"` with a timeout,
 * so a bare Python without OpenMC never wins.
 */
import * as vscode from 'vscode';
import { execFile } from 'child_process';
import {
    buildWslDiscoveryScript,
    InterpreterCandidate,
    OPENMC_PROBE_SNIPPET,
    orderCandidates,
    parseProbeOutput,
    parseWslDiscovery,
    toWslPath,
} from './core';

const PROBE_TIMEOUT_MS = 15000;

export interface ResolvedInterpreter {
    candidate: InterpreterCandidate;
    openmcVersion: string;
}

function execFileAsync(
    command: string,
    args: string[],
    timeoutMs: number,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
        execFile(
            command,
            args,
            { timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
            (err, stdout, stderr) => {
                resolve({ ok: !err, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
            },
        );
    });
}

/** The `owen.openmc.pythonExecutable` value, but only if the user set it. */
function explicitPythonSetting(): string | undefined {
    const info = vscode.workspace.getConfiguration('owen').inspect<string>('openmc.pythonExecutable');
    const set =
        info?.workspaceFolderValue ??
        info?.workspaceValue ??
        info?.globalValue;
    return set && set.trim() ? set.trim() : undefined;
}

/** Active interpreter path from the ms-python extension, if installed. */
async function msPythonInterpreter(resource?: vscode.Uri): Promise<string | undefined> {
    try {
        const ext = vscode.extensions.getExtension('ms-python.python');
        if (!ext) return undefined;
        if (!ext.isActive) await ext.activate();
        const environments = (ext.exports as {
            environments?: {
                getActiveEnvironmentPath(resource?: vscode.Uri): { path?: string } | undefined;
                resolveEnvironment(env: unknown): Promise<{ executable?: { uri?: vscode.Uri } } | undefined>;
            };
        })?.environments;
        if (!environments) return undefined;
        const envPath = environments.getActiveEnvironmentPath(resource);
        if (!envPath?.path) return undefined;
        try {
            const resolved = await environments.resolveEnvironment(envPath);
            const exe = resolved?.executable?.uri?.fsPath;
            if (exe) return exe;
        } catch {
            // fall through to the unresolved path
        }
        return envPath.path;
    } catch {
        return undefined;
    }
}

async function probe(candidate: InterpreterCandidate): Promise<string | null> {
    const args = [...candidate.argsPrefix, '-c', OPENMC_PROBE_SNIPPET];
    const res = await execFileAsync(candidate.command, args, PROBE_TIMEOUT_MS);
    if (!res.ok) return null;
    return parseProbeOutput(res.stdout);
}

/**
 * WSL probing goes further than the plain candidate: conda/venv interpreters
 * inside WSL are not on the non-interactive PATH, so a small `sh` script
 * tries `python3` plus common conda locations and reports back which
 * executable (if any) can import openmc. The candidate is then rewritten to
 * invoke that exact interpreter (`wsl /opt/.../python …`).
 */
async function probeWsl(
    candidate: InterpreterCandidate,
): Promise<{ candidate: InterpreterCandidate; version: string } | null> {
    const res = await execFileAsync('wsl', ['--exec', 'sh', '-c', buildWslDiscoveryScript()], PROBE_TIMEOUT_MS * 2);
    if (!res.ok) return null;
    const found = parseWslDiscovery(res.stdout);
    if (!found) return null;
    return {
        candidate: {
            ...candidate,
            argsPrefix: ['--exec', found.pythonPath],
            label: `${found.pythonPath} under WSL`,
        },
        version: found.version,
    };
}

/**
 * Resolves the first candidate whose Python can import openmc, or null.
 * `output` (optional) receives one line per probed candidate for diagnostics.
 */
export async function resolveOpenmcInterpreter(
    resource?: vscode.Uri,
    output?: (line: string) => void,
): Promise<ResolvedInterpreter | null> {
    const candidates = orderCandidates({
        explicitSetting: explicitPythonSetting(),
        msPythonPath: await msPythonInterpreter(resource),
        platform: process.platform,
    });
    for (const candidate of candidates) {
        if (candidate.kind === 'wsl') {
            const found = await probeWsl(candidate);
            output?.(`WSL: ${found ? `OpenMC ${found.version} via ${found.candidate.label}` : 'no importable openmc found'}`);
            if (found) return { candidate: found.candidate, openmcVersion: found.version };
            continue;
        }
        const version = await probe(candidate);
        output?.(`${candidate.label}: ${version ? `OpenMC ${version}` : 'no importable openmc'}`);
        if (version) return { candidate, openmcVersion: version };
    }
    return null;
}

/** Translates a Windows path for a WSL-hosted interpreter via `wslpath`. */
export async function translatePathForCandidate(
    candidate: InterpreterCandidate,
    windowsPath: string,
): Promise<string> {
    if (!candidate.needsWslPaths) return windowsPath;
    // `--exec` keeps the backslashes in the Windows path from being eaten by
    // the WSL shell before wslpath sees them.
    const res = await execFileAsync('wsl', ['--exec', 'wslpath', '-a', windowsPath], PROBE_TIMEOUT_MS);
    const line = res.stdout.trim().split(/\r?\n/)[0];
    if (res.ok && line.startsWith('/')) return line;
    return toWslPath(windowsPath);
}
