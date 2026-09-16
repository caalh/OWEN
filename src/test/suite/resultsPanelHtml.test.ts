// The Results Viewer UI regressions of Sep 2026 (screenshots in the issue):
// uPlot's default live legend spilled "Value:" / "k:" / checkboxes over the
// estimators table; a fabricated one-point k-eff history produced a blank
// 280px chart; the spectrum was built while its tab was display:none (width
// 0 → empty box with a broken vertical legend); the mesh tab was a grey
// canvas with no empty state. These tests pin the fixes at the source level
// (the webview script is a template literal, so string checks are the
// contract) plus parse the script like webviewHtml.test.ts does.

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { REPO_ROOT } from '../paths';

const src = fs.readFileSync(path.join(REPO_ROOT, 'src', 'results', 'panel.ts'), 'utf8');

suite('Results Viewer webview fixes', () => {
    test('every uPlot instance disables the default legend', () => {
        const plots = src.match(/new uPlot\(\{/g) || [];
        const legends = src.match(/legend: \{ show: false \}/g) || [];
        assert.ok(plots.length >= 3, `expected at least 3 uPlot builds, found ${plots.length}`);
        assert.strictEqual(legends.length, plots.length,
            `every uPlot must set legend:{show:false} — ${legends.length}/${plots.length} do`);
    });

    test('a one-point k-eff history is a message, not a blank plot', () => {
        assert.ok(/realPoints < 2/.test(src), 'buildKeffPlot must refuse to plot fewer than 2 points');
        assert.ok(src.includes('no cycle-by-cycle table'), 'the message explains why there is nothing to plot');
    });

    test('plots rebuild when their tab becomes visible (zero-width bug)', () => {
        const showTab = src.slice(src.indexOf('function showTab'), src.indexOf('.tab\').forEach(t => t.onclick'));
        assert.ok(showTab.includes('buildSpecPlot'), 'spectrum rebuilds on tab show');
        assert.ok(showTab.includes('buildKeffPlot'), 'k-eff rebuilds on tab show');
        assert.ok(showTab.includes('renderMesh'), 'mesh redraws on tab show');
        assert.ok(/function plotWidth/.test(src), 'plot width falls back when clientWidth is 0');
    });

    test('mesh tab has an empty state instead of a bare grey canvas', () => {
        assert.ok(src.includes('No mesh tally in this output'), 'mesh empty-state message exists');
        assert.ok(!src.includes('<canvas id="meshCanvas" width="600" height="400" style="max-width:100%;background:var(--card);border-radius:8px"></canvas>\n    </div>'),
            'the static always-on canvas is gone');
    });

    test('spectrum x-scale is not a time axis', () => {
        assert.ok(/x: \{ distr: 3, time: false \}/.test(src),
            'log-energy axis must set time:false or uPlot labels series[0] "Time"');
    });

    test('the results webview script still parses', () => {
        const m = src.match(/<script>\n([\s\S]*?)<\/script>/);
        assert.ok(m, 'inline script found');
        const body = m[1]
            .replace(/\$\{[^}]*\}/g, '"x"')
            .replace(/const vscode = acquireVsCodeApi\(\);/, 'const vscode = { postMessage: () => {} };');
        assert.doesNotThrow(() => new Function(body), 'results webview script must be valid JavaScript');
    });
});
