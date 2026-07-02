/**
 * "OWEN: Verify Geometry with OpenMC" — geometry debugger for OpenMC decks.
 *
 * Reuses the Render-with-OpenMC infrastructure (interpreter detection, WSL
 * path translation, helper-script pattern from `preview/openmcNative/`) to:
 *   (a) render overlap-highlighted slices at several sampled planes and
 *       count overlap pixels, and
 *   (b) optionally run a short low-particle probe to surface lost-particle
 *       errors (skipped gracefully when cross sections are unavailable).
 *
 * The results panel is honest: a clean scan is reported as "no issues
 * detected at the sampled planes", never as a proof of correctness.
 */
import * as vscode from 'vscode';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectMonteCarloLanguage } from '../util/detectLanguage';
import { resolveOpenmcInterpreter, ResolvedInterpreter, translatePathForCandidate } from '../preview/openmcNative/detect';
import {
    buildVerifyHelperScript,
    buildVerifyRequest,
    isClean,
    parseVerifyResult,
    VerifyResult,
} from './core';

const VERIFY_TIMEOUT_MS = 300000;

let channel: vscode.OutputChannel | undefined;
function log(line: string): void {
    if (!channel) channel = vscode.window.createOutputChannel('OWEN: Verify Geometry');
    channel.appendLine(line);
}

export function registerVerifyGeometry(_context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand('owen.verifyGeometry', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('OWEN: open an OpenMC Python model first.');
            return;
        }
        const language = detectMonteCarloLanguage(editor.document);
        if (language !== 'openmc') {
            vscode.window.showWarningMessage(
                'OWEN: "Verify Geometry with OpenMC" works on OpenMC Python models '
                + '(a .py file importing openmc).',
            );
            return;
        }
        if (editor.document.isDirty) {
            await editor.document.save();
        }
        const deckPath = editor.document.uri.fsPath;

        const interpreter = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'OWEN: locating an OpenMC-capable Python…',
            },
            () => resolveOpenmcInterpreter(editor.document.uri, log),
        );
        if (!interpreter) {
            vscode.window.showInformationMessage(
                'OWEN: OpenMC not detected in the active environment — geometry verification needs a real '
                + 'OpenMC install. (Set owen.openmc.pythonExecutable to a Python with OpenMC to enable it.)',
            );
            return;
        }

        log(`Using ${interpreter.candidate.label} (OpenMC ${interpreter.openmcVersion})`);
        const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'owen-verify-'));
        try {
            const result = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'OWEN: verifying geometry with OpenMC (overlap slices + lost-particle probe)…',
                },
                () => runVerify(interpreter, deckPath, sessionDir),
            );
            showResultsPanel(deckPath, sessionDir, result, interpreter);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log(`Verify failed: ${message}`);
            vscode.window.showErrorMessage(`OWEN: geometry verification failed — ${message}`);
            try {
                fs.rmSync(sessionDir, { recursive: true, force: true });
            } catch {
                // best-effort cleanup
            }
        }
    });
}

async function runVerify(
    interpreter: ResolvedInterpreter,
    deckPath: string,
    outDir: string,
): Promise<VerifyResult> {
    const candidate = interpreter.candidate;
    const scriptPath = path.join(outDir, 'owen_openmc_verify.py');
    fs.writeFileSync(scriptPath, buildVerifyHelperScript(), 'utf8');

    const request = buildVerifyRequest(
        await translatePathForCandidate(candidate, deckPath),
        await translatePathForCandidate(candidate, outDir),
    );
    const requestPath = path.join(outDir, 'owen_verify_request.json');
    fs.writeFileSync(requestPath, JSON.stringify(request, null, 1), 'utf8');

    const args = [
        ...candidate.argsPrefix,
        await translatePathForCandidate(candidate, scriptPath),
        await translatePathForCandidate(candidate, requestPath),
    ];
    log(`Running: ${candidate.command} ${args.join(' ')}`);
    await new Promise<void>((resolve, reject) => {
        execFile(
            candidate.command,
            args,
            { timeout: VERIFY_TIMEOUT_MS, windowsHide: true, maxBuffer: 32 * 1024 * 1024, cwd: path.dirname(deckPath) },
            (err, stdout, stderr) => {
                if (stdout) log(String(stdout));
                if (stderr) log(String(stderr));
                // Helper exits non-zero when issues were found but still
                // writes the result JSON — prefer that over the exec error.
                if (err && !fs.existsSync(path.join(outDir, 'owen_verify_result.json'))) {
                    reject(new Error(`OpenMC verify process failed: ${err.message}`));
                } else {
                    resolve();
                }
            },
        );
    });

    const resultPath = path.join(outDir, 'owen_verify_result.json');
    if (!fs.existsSync(resultPath)) {
        throw new Error('verification produced no result file (see "OWEN: Verify Geometry" output).');
    }
    return parseVerifyResult(fs.readFileSync(resultPath, 'utf8'));
}

function showResultsPanel(
    deckPath: string,
    sessionDir: string,
    result: VerifyResult,
    interpreter: ResolvedInterpreter,
): void {
    const panel = vscode.window.createWebviewPanel(
        'owenVerifyGeometry',
        'OWEN: Geometry Verification',
        vscode.ViewColumn.Beside,
        {
            enableScripts: false,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.file(sessionDir)],
        },
    );
    panel.onDidDispose(() => {
        try {
            fs.rmSync(sessionDir, { recursive: true, force: true });
        } catch {
            // temp dir cleanup is best-effort
        }
    });
    panel.webview.html = buildHtml(panel.webview, deckPath, sessionDir, result, interpreter);
}

function buildHtml(
    webview: vscode.Webview,
    deckPath: string,
    sessionDir: string,
    result: VerifyResult,
    interpreter: ResolvedInterpreter,
): string {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const clean = isClean(result);
    const overlapPlanes = result.planes.filter((p) => p.overlapPixels > 0);

    let verdict: string;
    let verdictClass: string;
    if (!result.ok) {
        verdict = 'Verification did not complete';
        verdictClass = 'bad';
    } else if (overlapPlanes.length > 0) {
        verdict = `Overlaps found on ${overlapPlanes.length} of ${result.planes.length} sampled planes`;
        verdictClass = 'bad';
    } else if (result.lost?.ran && result.lost.lostCount > 0) {
        verdict = `Lost particles detected (${result.lost.lostCount})`;
        verdictClass = 'bad';
    } else if (clean) {
        verdict = 'No issues detected at the sampled planes';
        verdictClass = 'good';
    } else {
        verdict = 'Scan incomplete — inspect the warnings below';
        verdictClass = 'warn';
    }

    const planeCards = result.planes.map((p) => {
        const src = p.file
            ? webview.asWebviewUri(vscode.Uri.file(path.join(sessionDir, p.file))).toString()
            : '';
        const status = p.uncounted
            ? '<span class="warn-t">pixels not counted (Pillow missing)</span>'
            : p.overlapPixels > 0
                ? `<span class="bad-t">${p.overlapPixels} overlap pixel${p.overlapPixels === 1 ? '' : 's'}</span>`
                : '<span class="good-t">0 overlap pixels</span>';
        const axis = p.basis === 'xy' ? `z = ${p.origin[2].toPrecision(5)}`
            : p.basis === 'xz' ? `y = ${p.origin[1].toPrecision(5)}`
                : `x = ${p.origin[0].toPrecision(5)}`;
        return `<div class="card${p.overlapPixels > 0 ? ' flagged' : ''}">
  <div class="card-h">${esc(p.basis)} @ ${esc(axis)} cm — ${status}</div>
  ${src ? `<img src="${src}" alt="${esc(p.id)}" />` : '<div class="noimg">no image produced</div>'}
</div>`;
    }).join('\n');

    let lostHtml = '';
    if (result.lost) {
        const l = result.lost;
        if (!l.ran) {
            lostHtml = `<p class="warn-t">Lost-particle probe skipped: ${esc(l.message ?? 'unknown reason')}</p>`;
        } else if (l.lostCount > 0) {
            lostHtml = `<p class="bad-t">Probe run (${l.particles} particles): <b>${l.lostCount}</b> lost particle(s)`
                + ` — the geometry has undefined regions or leaks. ${esc(l.message ?? '')}</p>`;
        } else {
            lostHtml = `<p class="good-t">Probe run (${l.particles} particles): no lost particles.</p>`;
        }
    }

    const warnings = result.warnings.map((w) => `<p class="warn-t">⚠ ${esc(w)}</p>`).join('');
    const error = result.error ? `<pre class="err">${esc(result.error)}</pre>` : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src 'unsafe-inline';">
<title>OWEN: Geometry Verification</title>
<style>
  body { margin: 0; padding: 16px; background: #0b1018; color: #cdd6f4; font-family: -apple-system, "Segoe UI", sans-serif; font-size: 13px; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  .meta { opacity: 0.6; font-size: 11px; margin-bottom: 14px; }
  .verdict { padding: 10px 14px; border-radius: 6px; font-weight: 600; margin-bottom: 14px; }
  .verdict.good { background: rgba(166,227,161,0.12); color: #a6e3a1; border: 1px solid #a6e3a1; }
  .verdict.bad { background: rgba(243,139,168,0.12); color: #f38ba8; border: 1px solid #f38ba8; }
  .verdict.warn { background: rgba(249,226,175,0.12); color: #f9e2af; border: 1px solid #f9e2af; }
  .caveat { font-size: 11px; opacity: 0.65; margin: -8px 0 16px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
  .card { border: 1px solid #1f2940; border-radius: 6px; overflow: hidden; background: #101828; }
  .card.flagged { border-color: #f38ba8; }
  .card-h { padding: 6px 10px; font-size: 11px; border-bottom: 1px solid #1f2940; }
  .card img { display: block; width: 100%; background: #fff; }
  .noimg { padding: 30px; text-align: center; opacity: 0.5; }
  .good-t { color: #a6e3a1; } .bad-t { color: #f38ba8; font-weight: 600; } .warn-t { color: #f9e2af; }
  h2 { font-size: 13px; margin: 20px 0 6px; }
  .err { color: #f38ba8; white-space: pre-wrap; font-size: 10.5px; }
</style>
</head>
<body>
<h1>Geometry Verification — ${esc(path.basename(deckPath))}</h1>
<div class="meta">OpenMC ${esc(result.version ?? interpreter.openmcVersion)} • ${esc(interpreter.candidate.label)}</div>
<div class="verdict ${verdictClass}">${esc(verdict)}</div>
<p class="caveat">Sampling is not proof: overlaps are only detected on the ${result.planes.length} rendered planes, and the
particle probe is a short low-statistics run. A clean result means no issues were <i>detected</i>, not that none exist.</p>
<h2>Overlap slices (overlap pixels highlighted magenta)</h2>
<div class="grid">
${planeCards}
</div>
<h2>Lost-particle probe</h2>
${lostHtml || '<p class="warn-t">Probe was not attempted.</p>'}
${warnings ? '<h2>Warnings</h2>' + warnings : ''}
${error ? '<h2>Error</h2>' + error : ''}
</body>
</html>`;
}
