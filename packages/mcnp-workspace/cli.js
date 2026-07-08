#!/usr/bin/env node
/**
 * CLI: node packages/mcnp-workspace/cli.js --root main.inp --json
 */
const path = require('path');
const { validateMcnpProject } = require('./dist/validate');

function parseArgs(argv) {
    const opts = { root: '', json: false, warnUnused: false, cwd: process.cwd() };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--json') opts.json = true;
        else if (a === '--warn-unused') opts.warnUnused = true;
        else if (a === '--root' && argv[i + 1]) { opts.root = argv[++i]; }
        else if (a === '--cwd' && argv[i + 1]) { opts.cwd = argv[++i]; }
        else if (!a.startsWith('-') && !opts.root) opts.root = a;
    }
    return opts;
}

const opts = parseArgs(process.argv);
if (!opts.root) {
    console.error('Usage: mcnp-workspace --root <main.inp> [--json] [--warn-unused] [--cwd <dir>]');
    process.exit(2);
}

const rootPath = path.resolve(opts.cwd, opts.root);
const result = validateMcnpProject({ rootPath, warnUnused: opts.warnUnused });

if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} else {
    for (const d of result.diagnostics) {
        const rel = path.relative(opts.cwd, d.file);
        console.log(`${rel}:${d.line + 1}:${d.startCol + 1} ${d.severity} ${d.code}: ${d.message}`);
    }
    console.log(`\n${result.summary.errors} error(s), ${result.summary.warnings} warning(s), ${result.summary.hints} hint(s)`);
}

process.exit(result.summary.errors > 0 ? 1 : 0);
