/**
 * OWEN: Convert to OpenMC XML (openmc adapters) — optional second conversion
 * backend that shells out to the OpenMC team's own converters:
 *
 *   - MCNP decks    → openmc_mcnp_adapter    (github.com/openmc-dev/openmc_mcnp_adapter, MIT)
 *   - Serpent decks → openmc_serpent_adapter (github.com/openmc-dev/openmc_serpent_adapter, MIT)
 *
 * Positioning vs. the built-in converter (owen.convertDeck):
 *  - the adapters run decks through real openmc.Model objects, so their
 *    geometry/material output is exactly what OpenMC accepts — a good second
 *    opinion on OWEN's own conversion;
 *  - they convert geometry and materials ONLY: sources and tallies are
 *    ignored, and the MCNP adapter writes placeholder settings (40 batches,
 *    point source at the bounding-box centre). OWEN's converter carries
 *    kcode/ksrc and tallies. Both messages say so.
 *  - measured limits (2026-08-02, see docs/ADAPTER_COMPARISON.md): the MCNP
 *    adapter rejects nested lattices (assembly lattice inside a core lattice),
 *    RHP/REC/ELL/WED/ARB macrobodies, and hex lattices.
 *
 * The adapters are NOT bundled — they run from the user's Python (same
 * interpreter discovery as Render with OpenMC, including WSL). Nothing is
 * redistributed; OWEN just invokes an installed tool.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import {
    resolveOpenmcInterpreter, translatePathForCandidate, ResolvedInterpreter,
} from '../preview/openmcNative/detect';
import { requireTrustedWorkspace } from '../util/workspaceTrust';

const CONVERT_TIMEOUT_MS = 120000;
const PROBE_TIMEOUT_MS = 15000;

type AdapterSource = 'mcnp' | 'serpent';

interface AdapterSpec {
    module: string;
    installCmd: string;
    label: string;
}

export const ADAPTERS: Record<AdapterSource, AdapterSpec> = {
    mcnp: {
        module: 'openmc_mcnp_adapter',
        installCmd: 'python -m pip install openmc "git+https://github.com/openmc-dev/openmc_mcnp_adapter.git"',
        label: 'openmc_mcnp_adapter',
    },
    serpent: {
        module: 'openmc_serpent_adapter',
        installCmd: 'python -m pip install openmc "git+https://github.com/openmc-dev/openmc_serpent_adapter.git"',
        label: 'openmc_serpent_adapter',
    },
};

/**
 * Classify a `stderr` (or `stdout`) traceback from the MCNP or Serpent adapter
 * into one of a few actionable kinds. The full text still goes to the OWEN
 * Adapter output channel; this is only what we surface to the user.
 *
 * `kind: 'nested-lattice'` is the BEAVRS full-core failure: OpenMC rejects a
 * `RectLattice` placed directly as a `lattice.universes` entry because a
 * lattice is a fill, not a universe — it needs to be wrapped in a Universe.
 * OWEN's own converter (`owen.convertDeck`) wraps it, so we offer to hand
 * this deck straight to that command.
 */
export type AdapterErrorKind =
    | 'nested-lattice'
    | 'unsupported-macrobody'
    | 'hex-lattice'
    | 'openmc-missing'
    | 'unknown';

export interface AdapterError {
    kind: AdapterErrorKind;
    /** One-line human summary; the full traceback still lives in the output channel. */
    summary: string;
}

export function classifyAdapterError(stderr: string, stdout = ''): AdapterError {
    const text = `${stdout}\n${stderr}`;
    // OpenMC's own checkvalue.py message when a lattice is placed where a universe is expected.
    if (/Items must be of type "UniverseBase"[^\n]*is of type "(?:Rect|Hex)Lattice"/.test(text)) {
        return {
            kind: 'nested-lattice',
            summary:
                'The MCNP → OpenMC adapter cannot place a lattice inside another lattice ' +
                '(BEAVRS-style: assembly lattices filled into a core lattice). OWEN\'s built-in ' +
                'converter wraps them in a Universe and handles this case.',
        };
    }
    if (/hex(?:agonal)?[- ]?lattice|LAT\s*=\s*2/i.test(text) && /unsupported|not supported|NotImplemented/i.test(text)) {
        return {
            kind: 'hex-lattice',
            summary: 'The adapter does not support MCNP hexagonal lattices (LAT=2).',
        };
    }
    if (/(RHP|REC|ELL|WED|ARB)\b[^\n]*not supported|Unsupported macrobody|not implemented for macrobody/i.test(text)) {
        return {
            kind: 'unsupported-macrobody',
            summary: 'The adapter does not support one of the MCNP macrobodies used in the deck (RHP/REC/ELL/WED/ARB).',
        };
    }
    if (/No module named ['"]openmc['"]|ImportError: cannot import name .* from ['"]openmc['"]/i.test(text)) {
        return {
            kind: 'openmc-missing',
            summary: 'The interpreter found the adapter but the OpenMC Python package itself is not importable.',
        };
    }
    return { kind: 'unknown', summary: '' };
}

/**
 * Python payload that runs the adapter CLI in-process (no console-script PATH
 * games). The Serpent adapter writes a hardcoded model.xml into the CWD, so
 * both payloads chdir to the requested output directory and normalize the
 * result to outPath.
 */
export function buildAdapterPayload(source: AdapterSource, deckPath: string, outPath: string): string {
    const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    if (source === 'mcnp') {
        return (
            'import sys; ' +
            'from openmc_mcnp_adapter.openmc_conversion import mcnp_to_openmc; ' +
            `sys.argv = ['mcnp_to_openmc', '${esc(deckPath)}', '-o', '${esc(outPath)}']; ` +
            'mcnp_to_openmc()'
        );
    }
    return (
        'import os, sys; ' +
        'from openmc_serpent_adapter.serpent_conversion import main; ' +
        `os.chdir('${esc(path.dirname(outPath).replace(/\\/g, '/')) || '.'}'); ` +
        `sys.argv = ['serpent_to_openmc', '${esc(deckPath)}']; ` +
        'main(); ' +
        `os.replace('model.xml', '${esc(path.basename(outPath))}')`
    );
}

function execFileAsync(
    command: string, args: string[], timeoutMs: number, cwd?: string,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
        execFile(
            command, args,
            { timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024, cwd },
            (err, stdout, stderr) => {
                resolve({ ok: !err, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
            },
        );
    });
}

async function hasAdapter(interp: ResolvedInterpreter, module: string): Promise<boolean> {
    const res = await execFileAsync(
        interp.candidate.command,
        [...interp.candidate.argsPrefix, '-c', `import ${module}; print("OWEN_ADAPTER_OK")`],
        PROBE_TIMEOUT_MS,
    );
    return res.ok && res.stdout.includes('OWEN_ADAPTER_OK');
}

export function registerConvertDeckAdapter(context: vscode.ExtensionContext): vscode.Disposable {
    const output = vscode.window.createOutputChannel('OWEN Adapter');
    context.subscriptions.push(output);

    return vscode.commands.registerCommand('owen.convertDeckAdapter', async () => {
        if (!(await requireTrustedWorkspace('run the OpenMC adapter converter'))) return;
        const editor = vscode.window.activeTextEditor;
        const langId = editor?.document.languageId;
        if (!editor || (langId !== 'mcnp' && langId !== 'serpent')) {
            vscode.window.showWarningMessage(
                'OWEN: open the MCNP or Serpent deck you want to convert first (the adapter backend converts those to OpenMC).',
            );
            return;
        }
        const source = langId as AdapterSource;
        const spec = ADAPTERS[source];
        const doc = editor.document;
        if (doc.isUntitled) {
            vscode.window.showWarningMessage('OWEN: save the deck to disk first — the adapter reads a file.');
            return;
        }
        if (doc.isDirty) await doc.save();

        const deckPath = doc.uri.fsPath;
        const outPath = path.join(
            path.dirname(deckPath),
            `${path.basename(deckPath).replace(/\.[^.]+$/, '')}_adapter_model.xml`,
        );

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `OWEN: converting with ${spec.label}…`,
            },
            async (progress) => {
                progress.report({ message: 'finding a Python with OpenMC…' });
                const interp = await resolveOpenmcInterpreter(doc.uri, (line) => output.appendLine(line));
                if (!interp) {
                    void offerInstallHint(
                        `OWEN: no Python with OpenMC found — the adapter backend needs openmc + ${spec.module} importable.`,
                        spec,
                    );
                    return;
                }
                if (!(await hasAdapter(interp, spec.module))) {
                    void offerInstallHint(
                        `OWEN: found OpenMC ${interp.openmcVersion} (${interp.candidate.label}) but ${spec.module} is not installed there.`,
                        spec,
                    );
                    return;
                }

                progress.report({ message: `running ${spec.label} (OpenMC ${interp.openmcVersion})…` });
                const deckForInterp = await translatePathForCandidate(interp.candidate, deckPath);
                const outForInterp = await translatePathForCandidate(interp.candidate, outPath);
                const res = await execFileAsync(
                    interp.candidate.command,
                    [...interp.candidate.argsPrefix, '-c', buildAdapterPayload(source, deckForInterp, outForInterp)],
                    CONVERT_TIMEOUT_MS,
                    path.dirname(deckPath),
                );
                output.appendLine(`--- ${new Date().toISOString()} ${spec.label} ${path.basename(deckPath)} ---`);
                if (res.stdout) output.appendLine(res.stdout);
                if (res.stderr) output.appendLine(res.stderr);

                if (!res.ok) {
                    output.show(true);
                    const classified = classifyAdapterError(res.stderr, res.stdout);
                    const suggestOwen = classified.kind === 'nested-lattice'
                        || classified.kind === 'unsupported-macrobody'
                        || classified.kind === 'hex-lattice';
                    const base = classified.summary
                        ? `OWEN: ${spec.label} failed — ${classified.summary}`
                        : `OWEN: ${spec.label} failed — see the "OWEN Adapter" output for the Python traceback. ` +
                          'Common causes: unsupported geometry (nested lattices, RHP/REC/ELL/WED/ARB macrobodies, ' +
                          'hex lattices) or data-block U/LAT/FILL cards.';
                    const actions: string[] = [];
                    if (suggestOwen) actions.push('Convert with OWEN instead');
                    actions.push('Show adapter output');
                    const pick = await vscode.window.showErrorMessage(base, ...actions);
                    if (pick === 'Convert with OWEN instead') {
                        await vscode.commands.executeCommand('owen.convertDeck');
                    } else if (pick === 'Show adapter output') {
                        output.show(true);
                    }
                    return;
                }

                const xmlDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(outPath));
                await vscode.window.showTextDocument(xmlDoc, { preview: false });
                vscode.window.showInformationMessage(
                    `OWEN: ${spec.label} wrote ${path.basename(outPath)} — geometry and materials only. ` +
                    'The adapters ignore source and tally definitions and write placeholder settings: ' +
                    'review before running. For source + tally carry-over, compare with OWEN: Convert Deck….',
                );
            },
        );
    });

    async function offerInstallHint(message: string, spec: AdapterSpec): Promise<void> {
        const pick = await vscode.window.showErrorMessage(message, 'Copy pip install command');
        if (pick === 'Copy pip install command') {
            await vscode.env.clipboard.writeText(spec.installCmd);
            vscode.window.showInformationMessage(
                'OWEN: install command copied. Run it in the Python environment OWEN uses ' +
                '(see the "OWEN Adapter" output for which interpreters were probed).',
            );
        }
    }
}
