/**
 * Guardrail: every source file that can launch an external process must gate
 * on workspace trust.
 *
 * Why this exists: commands like "Run reactor", "Run simulation", and "Render
 * with OpenMC" execute files from the open folder. In an untrusted workspace a
 * hostile repo could ship a .vscode/settings.json (or a crafted deck) that
 * turns a click into code execution on the victim's machine. The defense is
 * `requireTrustedWorkspace(...)` at the top of every such command. This test
 * is how we stop a new process-spawning command from shipping without it — the
 * Reactor Workbench did exactly that until Oct 2026.
 *
 * The invariant checked here: any file under src/ (excluding src/test/) that
 * imports node's child_process must EITHER reference requireTrustedWorkspace,
 * OR be listed in scripts/trust-gate-helpers.json with a reason (a helper that
 * is only reachable through a command that already gated).
 *
 * This is deliberately a file-level, zero-runtime static check: it cannot be
 * fooled by control flow and it cannot flake. If it is wrong about a file, the
 * fix is to gate that file or to document it in the allowlist — never to
 * loosen the match.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(scriptsDir, '..');
const srcDir = path.join(root, 'src');

const CHILD_PROCESS_IMPORT = /from\s+['"](?:node:)?child_process['"]|require\(\s*['"](?:node:)?child_process['"]\s*\)/;
const GATE = 'requireTrustedWorkspace';

const allowlist = JSON.parse(fs.readFileSync(path.join(scriptsDir, 'trust-gate-helpers.json'), 'utf8')).allow;

function tsFilesIn(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'test') continue; // test harness may spawn freely
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) tsFilesIn(full, out);
        else if (entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
}

const rel = (file) => path.relative(srcDir, file).split(path.sep).join('/');

const spawners = tsFilesIn(srcDir).filter((file) =>
    CHILD_PROCESS_IMPORT.test(fs.readFileSync(file, 'utf8')),
);

const failures = [];
const usedAllowEntries = new Set();

for (const file of spawners) {
    const key = rel(file);
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes(GATE)) continue;
    if (allowlist[key]) {
        usedAllowEntries.add(key);
        continue;
    }
    failures.push(
        `${key} imports child_process but never calls ${GATE}(). ` +
            `Add the trust gate at the top of the command handler, or — only if this ` +
            `file is a helper reached exclusively through an already-gated command — ` +
            `add it to scripts/trust-gate-helpers.json with a reason.`,
    );
}

// A stale allowlist entry is also a failure: it means a helper was gated or
// removed and the exception is now unaudited cover.
for (const key of Object.keys(allowlist)) {
    if (usedAllowEntries.has(key)) continue;
    const full = path.join(srcDir, key);
    if (!fs.existsSync(full)) {
        failures.push(`trust-gate-helpers.json lists ${key}, which no longer exists. Remove it.`);
    } else if (fs.readFileSync(full, 'utf8').includes(GATE)) {
        failures.push(`trust-gate-helpers.json lists ${key}, but that file now calls ${GATE}() itself. Remove the allowlist entry.`);
    } else if (!CHILD_PROCESS_IMPORT.test(fs.readFileSync(full, 'utf8'))) {
        failures.push(`trust-gate-helpers.json lists ${key}, but that file no longer imports child_process. Remove the allowlist entry.`);
    }
}

if (failures.length) {
    console.error('verify:trust-gated FAILED');
    for (const failure of failures) console.error('  - ' + failure);
    process.exit(1);
}

console.log(
    `verify:trust-gated OK (${spawners.length} process-spawning files: ` +
        `${spawners.length - usedAllowEntries.size} gated, ${usedAllowEntries.size} allowlisted helper(s))`,
);
