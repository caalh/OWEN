import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { mcnpToOpenmc } from '../converter/mcnpToOpenmc';
import { constructTodos } from '../converter/certifyDeck';
import { runLanguageRules } from '../language/rules';
import { assessHistory, formatReactorPanel } from '../mc/workbench';
import { preflightMcnp } from '../mc/preflight';
import {
    DEPLETION_BLOCKED,
    armOpenmcScript,
    launchBlocked,
    meshPeaksInside,
    parseBatchLog,
    parseReactorResult,
} from '../mc/reactorLaunch';

const DEFAULT_PYTHON = '/home/me/.conda/envs/openmc/bin/python';
const DEFAULT_XS = '/home/me/openmc-data-full/cross_sections.xml';

function toWsl(filePath: string): string {
    const norm = filePath.replace(/\\/g, '/');
    const match = norm.match(/^([A-Za-z]):\/(.*)$/);
    if (!match) return norm;
    return `/mnt/${match[1].toLowerCase()}/${match[2]}`;
}

function siblingOpenmc(python: string): string {
    const slash = Math.max(python.lastIndexOf('/'), python.lastIndexOf('\\'));
    if (slash < 0) return '/home/me/.conda/envs/openmc/bin/openmc';
    return `${python.slice(0, slash).replace(/\\/g, '/')}/openmc`;
}

function page(text: string): string {
    const body = text.replace(/[&<>]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : '&gt;'));
    return `<!DOCTYPE html><html><body style="font-family: sans-serif; padding: 16px; white-space: pre-wrap;">${body}</body></html>`;
}

export function registerRunReactor(): vscode.Disposable {
    return vscode.commands.registerCommand('owen.runReactor', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('OWEN: open an MCNP deck, then run the reactor.');
            return;
        }
        const text = editor.document.getText();
        const panel = vscode.window.createWebviewPanel('owen.runReactor', 'OWEN: reactor', vscode.ViewColumn.Beside, {});
        const show = (body: string) => { panel.webview.html = page(body); };

        const blocked = launchBlocked(runLanguageRules('mcnp', text).map((diag) => diag.code));
        if (blocked) {
            show(`${blocked}\n${DEPLETION_BLOCKED}`);
            return;
        }
        let findings: string[] = [];
        try {
            findings = preflightMcnp(text, 800).map((issue) => `${issue.code}: ${issue.message}`);
        } catch (err) {
            findings = [err instanceof Error ? err.message : String(err)];
        }
        if (findings.length) {
            show(`Not launched. Preflight failed.\n${findings.join('\n')}\n${DEPLETION_BLOCKED}`);
            return;
        }

        let converted: string;
        try {
            converted = mcnpToOpenmc(text).output;
        } catch (err) {
            show(err instanceof Error ? err.message : String(err));
            return;
        }
        const todos = constructTodos(converted);
        if (todos.length) {
            show(`Not launched. The conversion left ${todos.length} TODO mark(s). A dropped construct is not run.\n${todos.slice(0, 8).join('\n')}\n${DEPLETION_BLOCKED}`);
            return;
        }

        const cfg = vscode.workspace.getConfiguration('owen');
        const python = cfg.get<string>('openmc.pythonExecutable') || DEFAULT_PYTHON;
        const crossSections = cfg.get<string>('openmc.crossSections') || DEFAULT_XS;
        let armed: string;
        try {
            armed = armOpenmcScript(converted, siblingOpenmc(python));
        } catch (err) {
            show(err instanceof Error ? err.message : String(err));
            return;
        }

        const file = path.join(os.tmpdir(), `owen-reactor-${Date.now()}.py`);
        fs.writeFileSync(file, armed.replace(/\r\n/g, '\n'));
        const wslPath = toWsl(file);
        const command = `sed -i 's/\\r$//' ${wslPath} && export HOME=/home/me OPENMC_CROSS_SECTIONS=${crossSections} && cd /tmp && ${python} ${wslPath}`;
        show(`OpenMC is running in WSL. A final k appears only after the entropy has flattened.\n${DEPLETION_BLOCKED}`);

        const child = spawn('wsl', ['-e', 'bash', '-lc', command], { windowsHide: true });
        let log = '';
        const consume = (chunk: Buffer) => {
            log += chunk.toString();
            const batches = parseBatchLog(log);
            const last = batches[batches.length - 1];
            const line = last ? `batch ${last.batch}  k ${last.mean.toFixed(5)} ± ${last.sigma.toFixed(5)}  entropy ${last.entropy.toFixed(3)}` : 'waiting for the first batch';
            show(`${line}\n${DEPLETION_BLOCKED}`);
        };
        child.stdout.on('data', consume);
        child.stderr.on('data', consume);
        child.on('close', () => {
            fs.rmSync(file, { force: true });
            const result = parseReactorResult(log);
            if (!result) {
                show(`OpenMC did not return a result.\n${log.slice(-2000)}`);
                return;
            }
            const verdict = assessHistory({ mean: result.mean, entropy: result.entropy, inactive: result.inactive });
            const headline = formatReactorPanel(verdict, [
                { name: 'absorption', mean: result.absorption },
                { name: 'nu-fission', mean: result.production },
            ]);
            const meshNote = result.mesh
                ? `Flux mesh ${result.mesh.width}×${result.mesh.height}. Peak inside the frame: ${meshPeaksInside(result.mesh) ? 'yes' : 'no'}.`
                : 'No flux mesh.';
            const quoted = verdict.reportK ? `Statepoint k ${result.k.toFixed(5)} ± ${result.sigma.toFixed(5)}.` : 'Statepoint k withheld.';
            show(`${headline}\n${quoted}\n${meshNote}\n${DEPLETION_BLOCKED}`);
        });
    });
}
