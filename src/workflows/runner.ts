import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { detectMonteCarloLanguage } from '../util/detectLanguage';
import { requireTrustedWorkspace } from '../util/workspaceTrust';
import {
    resolveCrossSections,
    resolveOpenmcInterpreter,
    translatePathForCandidate,
} from '../preview/openmcNative/detect';
import {
    LaunchPlan,
    detectShellKind,
    formatChangeDirectory,
    formatCommandLine,
    formatEnvAssignment,
    mcnpOutputCollisions,
    ordinal,
    planLaunch as planLaunchCore,
    planWslRun,
} from './runnerCore';

export { LaunchPlan } from './runnerCore';

const TERMINAL_NAME = 'OWEN: Run';

function getOrCreateTerminal(cwd: string): vscode.Terminal {
    const existing = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME);
    if (existing) return existing;
    return vscode.window.createTerminal({ name: TERMINAL_NAME, cwd });
}

/** Thin wrapper keeping the existing signature for sweep.ts and the tests. */
export function planLaunch(
    language: ReturnType<typeof detectMonteCarloLanguage>,
    filePath: string,
    cfg: vscode.WorkspaceConfiguration,
): LaunchPlan | null {
    return planLaunchCore(language, path.basename(filePath), (key) => cfg.get<string>(key));
}

/**
 * Upgrade an OpenMC plan to an interpreter that can actually import openmc.
 *
 * `owen.openmc.pythonExecutable` defaults to `python`, which on Windows is
 * almost never the interpreter that has OpenMC — it usually lives in WSL. The
 * render and verify commands already probe for a working one, but the run
 * command launched the default and failed with ModuleNotFoundError.
 */
async function resolveOpenmcPlan(
    plan: LaunchPlan,
    filePath: string,
    workDir: string,
    resource: vscode.Uri,
    hint?: string,
): Promise<{ plan: LaunchPlan; info?: string; crossSections?: string }> {
    const resolved = await resolveOpenmcInterpreter(resource);
    if (!resolved) {
        return {
            plan,
            info:
                `No Python that can import openmc was found, so OWEN is launching ${plan.executable} as configured. ` +
                'Set owen.openmc.pythonExecutable if OpenMC lives somewhere OWEN did not look.',
        };
    }
    const { candidate } = resolved;
    const crossSections = await resolveCrossSections(candidate, hint);
    const notes = [`Using ${candidate.label} (OpenMC ${resolved.openmcVersion}).`];
    if (!crossSections) {
        notes.push(
            'No cross_sections.xml was found, and a transport run needs one — set owen.openmc.crossSections ' +
                'to the path your interpreter should use.',
        );
    }
    if (candidate.kind === 'wsl') {
        const script = await translatePathForCandidate(candidate, filePath);
        const cwd = await translatePathForCandidate(candidate, workDir);
        const python = candidate.argsPrefix[candidate.argsPrefix.length - 1];
        notes.push(`Output lands in ${cwd}.`);
        return {
            plan: planWslRun(python, script, cwd, crossSections),
            info: notes.join(' '),
            crossSections,
        };
    }
    return {
        plan: {
            executable: candidate.command,
            args: [...candidate.argsPrefix, path.basename(filePath)],
        },
        info: notes.join(' '),
        crossSections,
    };
}

async function warnAboutMcnpOutputs(workDir: string, notes: string[]): Promise<boolean> {
    let listing: string[] = [];
    try {
        listing = fs.readdirSync(workDir);
    } catch {
        return true;
    }
    const { existing, exhausted } = mcnpOutputCollisions(listing);
    if (exhausted.length > 0) {
        const choice = await vscode.window.showWarningMessage(
            `OWEN: every name MCNP could use for ${exhausted.join(', ')} is taken in this directory. ` +
                'MCNP advances the last letter rather than overwriting, and it has run out of letters, so the run will fail.',
            'Reveal Folder',
            'Run Anyway',
        );
        if (choice === 'Reveal Folder') {
            await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(workDir));
            return false;
        }
        return choice === 'Run Anyway';
    }
    if (existing.length > 0) {
        notes.push(
            `${existing.join(', ')} already exist here, so MCNP will write its ${ordinal(existing.length + 1)} set ` +
                'of output files under the next letter (outp → outq → …) rather than overwriting. ' +
                'Show Run Results reads the newest.',
        );
    }
    return true;
}

export async function runSimulation(document: vscode.TextDocument): Promise<void> {
    if (!(await requireTrustedWorkspace('run a Monte Carlo code'))) return;
    const cfg = vscode.workspace.getConfiguration('owen', document.uri);
    const filePath = document.uri.fsPath;
    const workDir = cfg.get<string>('simulation.workingDirectory') || path.dirname(filePath);
    const language = detectMonteCarloLanguage(document);

    if (!language) {
        vscode.window.showWarningMessage('OWEN: Unsupported file type for simulation.');
        return;
    }

    let plan = planLaunch(language, filePath, cfg);
    if (!plan) {
        vscode.window.showWarningMessage('OWEN: Unable to plan launch for this file.');
        return;
    }

    const notes: string[] = [];
    if (plan.info) notes.push(plan.info);
    let nativeCrossSections: string | undefined;

    if (language === 'openmc') {
        const upgraded = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: 'OWEN: finding an interpreter with OpenMC…' },
            () => resolveOpenmcPlan(
                plan as LaunchPlan,
                filePath,
                workDir,
                document.uri,
                cfg.get<string>('openmc.crossSections'),
            ),
        );
        plan = upgraded.plan;
        if (upgraded.info) notes.push(upgraded.info);
        // A WSL plan carries the variable inside its own command; a native one
        // needs it set in the terminal.
        if (plan.executable !== 'wsl') nativeCrossSections = upgraded.crossSections;
    }

    if (language === 'mcnp' && !(await warnAboutMcnpOutputs(workDir, notes))) return;

    const shell = detectShellKind(process.platform, vscode.env.shell || process.env.COMSPEC);
    const commandLine = formatCommandLine(plan, shell);

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: `OWEN: launching ${plan.executable}…` },
        async () => {
            const terminal = getOrCreateTerminal(workDir);
            terminal.show(true);
            terminal.sendText(formatChangeDirectory(workDir, shell));
            if (nativeCrossSections) {
                terminal.sendText(formatEnvAssignment('OPENMC_CROSS_SECTIONS', nativeCrossSections, shell));
            }
            terminal.sendText(commandLine);
        },
    );

    const suffix = notes.length > 0 ? ` ${notes.join(' ')}` : '';
    vscode.window.showInformationMessage(
        `OWEN: Launched ${plan.executable} for ${path.basename(filePath)} (${language}).${suffix}`,
    );
}
