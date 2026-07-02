import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';
import { detectMonteCarloLanguageFromText, MonteCarloLanguage } from '../util/detectLanguage';
import { planLaunch } from './runner';
import {
    SweepConfig,
    RunRecord,
    parseKeff,
    cartesian,
    applyParameters,
    runDirName,
    buildManifest,
    buildSummaryTsv,
} from './sweepCore';

export { SweepParameter, SweepConfig } from './sweepCore';

function languageForFile(filename: string, baseText: string): MonteCarloLanguage {
    const ext = path.extname(filename).toLowerCase();
    if (ext === '.i' || ext === '.mcnp' || ext === '.inp') return 'mcnp';
    if (ext === '.serp') return 'serpent';
    if (ext === '.scone') return 'scone';
    if (ext === '.py') {
        const detected = detectMonteCarloLanguageFromText(baseText, 'python');
        return detected ?? 'mcnp';
    }
    return 'mcnp';
}

async function fileBytes(uri: vscode.Uri): Promise<Buffer> {
    const data = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(data);
}

async function writeText(uri: vscode.Uri, text: string): Promise<void> {
    await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
}

async function runOne(plan: { executable: string; args: string[] }, cwd: string, stdoutPath: string): Promise<{ exitCode: number | null; output: string }> {
    return new Promise((resolve) => {
        const child = spawn(plan.executable, plan.args, { cwd, shell: false });
        let buffer = '';
        child.stdout?.on('data', (chunk: Buffer) => { buffer += chunk.toString('utf8'); });
        child.stderr?.on('data', (chunk: Buffer) => { buffer += chunk.toString('utf8'); });
        child.on('error', (err) => {
            buffer += `\n[owen.sweep] failed to launch ${plan.executable}: ${err.message}\n`;
            resolve({ exitCode: null, output: buffer });
        });
        child.on('close', async (code) => {
            try {
                await writeText(vscode.Uri.file(stdoutPath), buffer);
            } catch { /* ignore */ }
            resolve({ exitCode: code, output: buffer });
        });
    });
}

export async function runSweepFromConfig(configUri: vscode.Uri): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('owen');
    let configText: string;
    try {
        configText = (await fileBytes(configUri)).toString('utf8');
    } catch (err) {
        vscode.window.showErrorMessage(`OWEN: cannot read sweep config: ${(err as Error).message}`);
        return;
    }

    let parsed: SweepConfig;
    try {
        parsed = JSON.parse(configText) as SweepConfig;
    } catch (err) {
        vscode.window.showErrorMessage(`OWEN: invalid sweep JSON: ${(err as Error).message}`);
        return;
    }

    const configDir = path.dirname(configUri.fsPath);
    const baseFilePath = path.isAbsolute(parsed.baseFile)
        ? parsed.baseFile
        : path.resolve(configDir, parsed.baseFile);
    const outDir = path.isAbsolute(parsed.output.dir)
        ? parsed.output.dir
        : path.resolve(configDir, parsed.output.dir);

    let baseText: string;
    try {
        baseText = (await fileBytes(vscode.Uri.file(baseFilePath))).toString('utf8');
    } catch (err) {
        vscode.window.showErrorMessage(`OWEN: cannot read base file ${baseFilePath}: ${(err as Error).message}`);
        return;
    }

    const language = (parsed.language as MonteCarloLanguage | undefined)
        ?? languageForFile(baseFilePath, baseText);
    const combinations = cartesian(parsed.parameters);
    const baseName = path.basename(baseFilePath);

    await vscode.workspace.fs.createDirectory(vscode.Uri.file(outDir));

    const records: RunRecord[] = [];

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `OWEN: parameter sweep (${combinations.length} runs)`,
            cancellable: false,
        },
        async (progress) => {
            for (let i = 0; i < combinations.length; i++) {
                const combo = combinations[i];
                const runDir = path.join(outDir, runDirName(i));
                await vscode.workspace.fs.createDirectory(vscode.Uri.file(runDir));
                const inputPath = path.join(runDir, baseName);
                const mutated = applyParameters(baseText, combo, parsed.parameters);
                await writeText(vscode.Uri.file(inputPath), mutated);

                const plan = planLaunch(language, inputPath, cfg);
                const stdoutPath = path.join(runDir, 'owen-sweep.log');
                if (!plan) {
                    records.push({
                        index: i,
                        parameters: combo,
                        inputFile: inputPath,
                        outputDir: runDir,
                        keff: null,
                        exitCode: null,
                        stdoutPath,
                    });
                    continue;
                }

                progress.report({
                    message: `run ${i + 1}/${combinations.length} (${Object.entries(combo).map(([k, v]) => `${k}=${v}`).join(', ')})`,
                });

                const { exitCode, output } = await runOne(plan, runDir, stdoutPath);
                records.push({
                    index: i,
                    parameters: combo,
                    inputFile: inputPath,
                    outputDir: runDir,
                    keff: parseKeff(output),
                    exitCode,
                    stdoutPath,
                });
            }
        },
    );

    const manifest = buildManifest(baseFilePath, language, parsed.parameters, records);
    const manifestPath = path.join(outDir, 'sweep-manifest.json');
    await writeText(vscode.Uri.file(manifestPath), JSON.stringify(manifest, null, 2));

    const tsv = buildSummaryTsv(parsed.parameters, records);
    await writeText(vscode.Uri.file(path.join(outDir, 'sweep-summary.tsv')), tsv + '\n');

    const choice = await vscode.window.showInformationMessage(
        `OWEN: parameter sweep complete (${records.length} runs). Manifest: ${manifestPath}`,
        'View Sweep Dashboard',
    );
    if (choice === 'View Sweep Dashboard') {
        const { SweepDashboardPanel } = await import('./sweepDashboard');
        await SweepDashboardPanel.createOrShow(outDir);
    }
}

export function registerRunSweep(_context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand('owen.runSweep', async () => {
        const editor = vscode.window.activeTextEditor;
        const defaultUri = editor && editor.document.uri.scheme === 'file'
            ? vscode.Uri.file(path.dirname(editor.document.uri.fsPath))
            : undefined;
        const picks = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectMany: false,
            openLabel: 'Select sweep config (.json)',
            filters: { JSON: ['json'] },
            defaultUri,
        });
        if (!picks || picks.length === 0) return;
        await runSweepFromConfig(picks[0]);
    });
}
