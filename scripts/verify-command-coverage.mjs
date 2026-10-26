/**
 * A command added after the grandfather list must be named in test/ or
 * scripts/. The list is frozen: do not add today's commands to it to go
 * green. Cover them.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const commands = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).contributes.commands.map((item) => item.command);
const grandfather = new Set(JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'command-coverage-grandfather.json'), 'utf8')));

function filesIn(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) filesIn(full, out);
        else if (/\.(mjs|ts|js)$/.test(entry.name)) out.push(full);
    }
    return out;
}

const haystack = [
    ...filesIn(path.join(root, 'src', 'test')),
    ...filesIn(path.join(root, 'scripts')),
].map((file) => fs.readFileSync(file, 'utf8')).join('\n');

const failures = [];
for (const command of commands) {
    if (grandfather.has(command)) continue;
    if (!haystack.includes(command)) failures.push(`${command} has no test or script reference`);
}
if (failures.length) {
    console.error('verify:command-coverage FAILED');
    for (const failure of failures) console.error('  - ' + failure);
    process.exit(1);
}
console.log(`verify:command-coverage OK (${commands.length} commands, ${commands.length - grandfather.size} required beyond the grandfather list)`);
