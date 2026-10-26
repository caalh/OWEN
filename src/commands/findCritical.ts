import * as vscode from 'vscode';
import { criticalRadius } from '../mc/critical';

const TEACHING = { sigmaS: 0.8, sigmaA: 0.2, sigmaF: 0.1, nu: 2.2 };

export function registerFindCritical(): vscode.Disposable {
    return vscode.commands.registerCommand('owen.findCritical', async () => {
        const found = criticalRadius(
            TEACHING,
            { particles: 2500, cycles: 16, inactive: 5, seed: 2 },
            { lo: 4, hi: 30, iterations: 8 },
        );
        const panel = vscode.window.createWebviewPanel('owen.findCritical', 'OWEN: critical radius', vscode.ViewColumn.Beside, {});
        panel.webview.html = `<!DOCTYPE html>
<html><body style="font-family: sans-serif; padding: 16px;">
<h2 style="margin: 0 0 8px;">Critical radius ${found.radiusCm.toFixed(2)} cm</h2>
<p>Bare sphere, k at the last step ${found.k.toFixed(3)} ± ${found.sigma.toFixed(3)}. Bracket ±${found.bracketCm.toFixed(2)} cm.</p>
<p>This is the teaching material (scatter 0.8, absorption 0.2, fission 0.1, ν 2.2, k∞ = 1.1). It does not read the ZAIDs in the open deck.</p>
<p>How to read it: k∞ is above 1, so a finite sphere leaks the excess down to 1. A bigger radius is less leakage.</p>
</body></html>`;
    });
}
