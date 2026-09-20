#!/usr/bin/env node
/**
 * Fetch license-safe field-corpus decks into .field-corpus/ (gitignored).
 *
 *   node scripts/field-corpus/fetch.mjs
 *
 * Local fixtures and prebuilts are copied; GitHub files are pinned by SHA
 * in src/test/field-corpus/manifest.json. GPL / LANL / ICSBEP are not
 * listed there on purpose.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifestPath = path.join(root, 'src', 'test', 'field-corpus', 'manifest.json');
const cacheRoot = path.join(root, '.field-corpus', 'cache');
const fieldDayRoot = path.join(root, '.field-corpus', 'field-day');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

function ensureDir(p) {
    fs.mkdirSync(p, { recursive: true });
}

function copyFile(from, to) {
    ensureDir(path.dirname(to));
    fs.copyFileSync(from, to);
}

async function download(url, dest) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    ensureDir(path.dirname(dest));
    fs.writeFileSync(dest, buf);
    return buf.length;
}

function githubRaw(repo, sha, file) {
    return `https://raw.githubusercontent.com/${repo}/${sha}/${file.replace(/\\/g, '/')}`;
}

/** A manifest file entry is a repo path, or `{ path, saveAs }` when the upstream name has no extension. */
function fileSpec(f) {
    return typeof f === 'string' ? { path: f, saveAs: f.replace(/\\/g, '/').split('/').pop() } : f;
}

function destFor(deck, spec) {
    return path.join(cacheRoot, deck.id, spec.saveAs);
}

async function fetchDeck(deck) {
    const destDir = path.join(cacheRoot, deck.id);
    if (deck.kind === 'local') {
        const from = path.join(root, deck.path);
        if (!fs.existsSync(from)) return { id: deck.id, status: 'missing-local', from };
        const to = path.join(destDir, path.basename(from));
        copyFile(from, to);
        // Fixture folders are one project each (includes, sibling XML); the
        // prebuilt-models folder is eleven unrelated decks, so only the root goes.
        const dir = path.dirname(from);
        if (!/prebuilt-models$/i.test(dir)) {
            for (const name of fs.readdirSync(dir)) {
                const p = path.join(dir, name);
                if (p === from || !fs.statSync(p).isFile()) continue;
                copyFile(p, path.join(destDir, name));
            }
        }
        return { id: deck.id, status: 'copied', to };
    }
    if (deck.kind === 'sibling') {
        const from = path.resolve(root, deck.path);
        if (!fs.existsSync(from)) return { id: deck.id, status: 'missing-sibling', from };
        copyFile(from, path.join(destDir, path.basename(from)));
        const dir = path.dirname(from);
        if (fs.existsSync(dir)) {
            for (const name of fs.readdirSync(dir)) {
                const p = path.join(dir, name);
                if (p === from || !fs.statSync(p).isFile()) continue;
                if (/\.(xml|py|i|sss|scone)$/i.test(name)) copyFile(p, path.join(destDir, name));
            }
        }
        return { id: deck.id, status: 'copied-sibling', to: destDir };
    }
    if (deck.kind === 'github') {
        const meta = manifest.github[deck.repo];
        if (!meta) throw new Error(`No github.sha for ${deck.repo}`);
        if (deck.redistribute === false) {
            return { id: deck.id, status: 'skipped-no-redistribute' };
        }
        const files = (deck.files ?? (deck.entry ? [deck.entry] : [])).map(fileSpec);
        for (const spec of files) {
            const url = githubRaw(deck.repo, meta.sha, spec.path);
            const to = destFor(deck, spec);
            const n = await download(url, to);
            console.log(`  ${deck.id}: ${spec.path} (${n} bytes)`);
        }
        fs.writeFileSync(path.join(destDir, 'SOURCE.txt'),
            `${deck.repo}@${meta.sha}\nSPDX: ${deck.spdx}\n${files.map((f) => f.path).join('\n')}\n`);
        return { id: deck.id, status: 'fetched', to: destDir };
    }
    return { id: deck.id, status: `unknown-kind:${deck.kind}` };
}

function writeFieldDay(decks) {
    ensureDir(fieldDayRoot);
    const lines = [
        '# OWEN field-day folder',
        '',
        'Open this folder in VS Code / Cursor, sideload `owen-neutronics-1.4.7-local.vsix`,',
        'then run **Show Cell Map**, **Check Geometry**, and **Open 3D Geometry Preview**',
        'on each deck. Shot list: docs/FIELD_CORPUS.md',
        '',
    ];
    for (const deck of decks.filter((d) => d.fieldDay)) {
        const src = path.join(cacheRoot, deck.id);
        if (!fs.existsSync(src)) continue;
        const dest = path.join(fieldDayRoot, deck.id);
        ensureDir(dest);
        for (const name of fs.readdirSync(src)) {
            const p = path.join(src, name);
            if (fs.statSync(p).isFile()) copyFile(p, path.join(dest, name));
        }
        lines.push(`- \`${deck.id}/\` — ${deck.code} · ${(deck.tags ?? []).join(', ')}`);
    }
    fs.writeFileSync(path.join(fieldDayRoot, 'README.md'), lines.join('\n') + '\n');
}

async function main() {
    ensureDir(cacheRoot);
    console.log(`Fetching ${manifest.decks.length} decks → ${cacheRoot}`);
    const results = [];
    for (const deck of manifest.decks) {
        try {
            results.push(await fetchDeck(deck));
        } catch (err) {
            results.push({ id: deck.id, status: 'error', error: err instanceof Error ? err.message : String(err) });
            console.error(`  FAIL ${deck.id}: ${err instanceof Error ? err.message : err}`);
        }
    }
    writeFieldDay(manifest.decks);
    const summary = {};
    for (const r of results) summary[r.status] = (summary[r.status] ?? 0) + 1;
    fs.writeFileSync(path.join(root, '.field-corpus', 'fetch-log.json'), JSON.stringify({ when: new Date().toISOString(), summary, results }, null, 2));
    console.log('fetch summary', summary);
    const fatal = results.filter((r) => r.status === 'error');
    if (fatal.length) process.exit(1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
