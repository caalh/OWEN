/**
 * HTML for the "OWEN: Validate Input File" report. Pure so tests can parse it.
 */

import { solutionFor } from '../language/solutions';

export interface ReportFinding {
    severity: 'error' | 'warning' | 'information' | 'hint' | string;
    line: number;
    startCol: number;
    message: string;
    code: string;
}

export interface ValidationReportModel {
    fileName: string;
    language: string;
    findings: ReportFinding[];
}

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

export function validationReportHtml(
    model: ValidationReportModel,
    cspSource: string,
    nonce: string,
): string {
    const csp = ["default-src 'none'", `style-src ${cspSource} 'unsafe-inline'`, `script-src 'nonce-${nonce}'`].join('; ');
    const n = model.findings.length;
    const errors = model.findings.filter((f) => f.severity === 'error').length;
    const warnings = model.findings.filter((f) => f.severity === 'warning').length;
    const banner = errors
        ? ['bad', `${errors} error${errors === 1 ? '' : 's'}${warnings ? `, ${warnings} warning${warnings === 1 ? '' : 's'}` : ''} — click a line to jump there.`]
        : warnings
            ? ['warn', `No errors; ${warnings} warning${warnings === 1 ? '' : 's'}. Click a line to jump there.`]
            : n
                ? ['ok', `${n} note${n === 1 ? '' : 's'} (hints / info). The deck is usable; these are leftovers or style.`]
                : ['ok', 'No issues found. Squiggles and the Problems panel match this report.'];
    const order: Record<string, number> = { error: 0, warning: 1, information: 2, hint: 3 };
    const rows = [...model.findings]
        .sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9) || a.line - b.line)
        .map((f) => {
            const fix = solutionFor(f.code, f.message);
            return `<tr class="${esc(f.severity)}">
  <td><span class="sev ${esc(f.severity)}">${esc(f.severity)}</span></td>
  <td><a class="ln" data-line="${f.line}" data-col="${f.startCol}" href="#">${f.line + 1}</a></td>
  <td><div class="msg">${esc(f.message)}</div><div class="fix">${esc(fix)}</div><div class="code">${esc(f.code)}</div></td>
</tr>`;
        }).join('');
    return `<!DOCTYPE html><html><head><meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>OWEN: Validate Input</title>
<style>
  body { font-family: var(--vscode-font-family); font-size: 12px; color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 12px 16px; }
  h1 { font-size: 15px; margin: 0 0 2px; }
  .sub { opacity: .7; margin-bottom: 10px; }
  .banner { padding: 8px 10px; border-radius: 4px; margin: 10px 0; border: 1px solid transparent; font-weight: 600; }
  .ok { background: color-mix(in srgb, #3fb950 12%, transparent); border-color: #3fb95055; }
  .warn { background: var(--vscode-inputValidation-warningBackground, rgba(255,190,60,.12)); border-color: #f2a33c; }
  .bad { background: var(--vscode-inputValidation-errorBackground, rgba(255,80,80,.12)); border-color: #e05561; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 8px 8px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: top; }
  th { opacity: .7; font-weight: 600; }
  .sev { font-size: 11px; font-weight: 600; text-transform: uppercase; padding: 0 6px; border-radius: 9px; color: #fff; background: #8a8f98; }
  .sev.error { background: #e05561; } .sev.warning { background: #d29922; } .sev.information { background: #4f9cf9; } .sev.hint { background: #8a8f98; }
  a.ln { color: var(--vscode-textLink-foreground); text-decoration: none; font-variant-numeric: tabular-nums; } a.ln:hover { text-decoration: underline; }
  .msg { margin-bottom: 4px; }
  .fix { opacity: .9; } .fix::before { content: 'Do this: '; font-weight: 600; opacity: .7; }
  .code { opacity: .45; font-size: 11px; margin-top: 4px; font-family: var(--vscode-editor-font-family); }
  button { font: inherit; padding: 3px 10px; border: none; border-radius: 3px; cursor: pointer; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
</style></head><body>
<h1>Validate Input — ${esc(model.fileName)}</h1>
<div class="sub">${esc(model.language)} · ${n} finding${n === 1 ? '' : 's'}</div>
<div class="banner ${banner[0]}">${esc(banner[1])}</div>
<p><button data-cmd="rerun">Re-run</button> <button data-cmd="problems">Open Problems</button></p>
${n ? `<table><thead><tr><th></th><th>Line</th><th>Problem and what to do</th></tr></thead><tbody>${rows}</tbody></table>` : '<p>Nothing to list.</p>'}
<script nonce="${nonce}">
(function(){ const vscode = acquireVsCodeApi();
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest('a.ln'); if (a) { ev.preventDefault(); vscode.postMessage({ command: 'goto', line: Number(a.dataset.line || 0), col: Number(a.dataset.col || 0) }); return; }
    const b = ev.target.closest('button[data-cmd]'); if (b) vscode.postMessage({ command: b.dataset.cmd });
  });
}());
</script></body></html>`;
}
