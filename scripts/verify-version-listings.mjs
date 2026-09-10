#!/usr/bin/env node
/**
 * Every place the OWEN version is written down, checked against package.json.
 *
 * The number has drifted before: the monorepo README and AGENTS.md said v1.0.3
 * while 1.4.4 was on the Marketplace, and reactormc.net/owen sat on 1.1.6 for
 * three releases. This script is the inventory. If a listing is not in here,
 * it is not guarded — add it.
 *
 *   npm run verify:version            check everything; exit 1 on any mismatch
 *   npm run sync:version              rewrite the markdown listings from package.json
 *   node scripts/verify-version-listings.mjs --release
 *                                     release gate: also require an empty
 *                                     [Unreleased] section and a matching site
 *
 * Listings (source of truth first):
 *   1. package.json "version"                                   — THE number
 *   2. package-lock.json "version" (top-level, both places)      — npm keeps it; check
 *   3. CHANGELOG.md — first "## [x.y.z]" heading                  — must equal 1
 *   4. README.md — no hardcoded OWEN release number (badges are live)
 *   5. ../BelvoirDynamics/README.md product table OWEN row        — **vX.Y.Z**  (monorepo, if present)
 *   6. ../BelvoirDynamics/owen/AGENTS.md "Current release: **vX.Y.Z**"          (monorepo, if present)
 *   7. ../reactor-monte-carlo-guide/src/lib/owenVersion.ts OWEN_VERSION        (site, if present)
 *      The site has its own guard (`npm run verify:owen-version`, then
 *      `npm run sync:owen-version` writes its README/AGENTS). It lags on purpose
 *      until the GitHub VSIX exists, so a mismatch is a warning here and a
 *      failure only with --release.
 *   8. owen-<version>.vsix next to package.json (and in the monorepo copy)      — --release only
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const write = args.has('--write');
const release = args.has('--release');

const failures = [];
const warnings = [];
const fixed = [];
const fail = (m) => failures.push(m);
const warn = (m) => warnings.push(m);

const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);

const pkg = JSON.parse(read(path.join(ROOT, 'package.json')));
const V = pkg.version;
if (!/^\d+\.\d+\.\d+$/.test(V)) fail(`package.json version "${V}" is not x.y.z`);
if (/^0\./.test(V)) fail(`package.json version ${V} is a 0.x number; OWEN is past 1.0 (owen-semver.mdc)`);

// 2. package-lock
const lockPath = path.join(ROOT, 'package-lock.json');
if (exists(lockPath)) {
    const lock = JSON.parse(read(lockPath));
    const rootPkg = lock.packages?.[''];
    if (lock.version !== V) fail(`package-lock.json version is ${lock.version}, package.json is ${V} — run npm install`);
    if (rootPkg && rootPkg.version !== V) fail(`package-lock.json packages[""].version is ${rootPkg.version}, expected ${V}`);
}

// 3. CHANGELOG
const changelog = read(path.join(ROOT, 'CHANGELOG.md'));
const headings = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1]);
if (headings.length === 0) fail('CHANGELOG.md has no "## [x.y.z]" heading');
else if (headings[0] !== V) fail(`CHANGELOG.md top released section is [${headings[0]}], package.json is ${V} — bump both together`);
{
    const m = /^## \[Unreleased\]\s*\n([\s\S]*?)(?=^## \[)/m.exec(changelog);
    const body = m ? m[1].replace(/^\s*(###.*)?$/gm, '').trim() : '';
    if (release && body.length > 0) fail('CHANGELOG.md [Unreleased] still has entries — move them under the new release heading');
}

// 4. README — badges show the live number; a literal one goes stale.
{
    // Historical release-asset links (…/releases/download/v0.2.2/demo.mp4) name
    // the tag they live under and are correct forever; skip those.
    const readme = read(path.join(ROOT, 'README.md')).replace(/\/releases\/(download|tag)\/v\d+\.\d+\.\d+/g, '/releases/$1/vX');
    const released = new Set(headings);
    const allowed = new Set(['0.160.0', '1.6.30', '0.15.3']); // vendored Three.js / uPlot / the OpenMC version in a screenshot caption
    for (const m of readme.matchAll(/\bv?(\d+\.\d+\.\d+)\b/g)) {
        const v = m[1];
        if (allowed.has(v)) continue;
        if (released.has(v)) fail(`README.md hardcodes OWEN release ${v}; the badges carry the version — reword or drop it`);
    }
}

// Helper for the markdown listings that can be rewritten.
function checkMarkdown(file, label, pattern, replacement, expectedText) {
    if (!exists(file)) return;
    let text = read(file);
    if (text.includes(expectedText)) return;
    const next = text.replace(pattern, replacement);
    if (next === text) { fail(`${label}: could not find the OWEN version line to check (pattern miss) in ${file}`); return; }
    if (write) { fs.writeFileSync(file, next); fixed.push(`${label} → ${expectedText}`); }
    else fail(`${label} does not say ${expectedText} (run npm run sync:version): ${file}`);
}

// 5./6. Monorepo listings. This script runs from the public clone
// (GitHub/owen, monorepo beside it) or from the monorepo copy itself
// (GitHub/BelvoirDynamics/owen, monorepo one level up).
const firstExisting = (...cands) => cands.find((c) => exists(c)) ?? cands[0];
const mono = firstExisting(
    path.resolve(ROOT, '..', 'BelvoirDynamics'),
    ...(exists(path.resolve(ROOT, '..', 'owen', 'AGENTS.md')) ? [path.resolve(ROOT, '..')] : []),
);
if (exists(mono)) {
    checkMarkdown(
        path.join(mono, 'README.md'), 'BelvoirDynamics/README.md OWEN row',
        /(\| \[`owen\/`\]\(owen\/\) \| \*\*OWEN\*\* \|[^|]*\| )\*\*v\d+\.\d+\.\d+\*\*/,
        `$1**v${V}**`, `**v${V}**`,
    );
    checkMarkdown(
        path.join(mono, 'owen', 'AGENTS.md'), 'BelvoirDynamics/owen/AGENTS.md "Current release"',
        /Current release: \*\*v\d+\.\d+\.\d+\*\*/,
        `Current release: **v${V}**`, `Current release: **v${V}**`,
    );
    const monoPkg = path.join(mono, 'owen', 'package.json');
    if (exists(monoPkg)) {
        const mv = JSON.parse(read(monoPkg)).version;
        if (mv !== V) fail(`BelvoirDynamics/owen/package.json is ${mv}, this repo is ${V} — mirror before release (owen-public-sync.mdc)`);
    }
} else {
    warn('BelvoirDynamics monorepo not found beside this repo — its README/AGENTS listings were not checked');
}

// 7. Site.
const site = firstExisting(
    path.resolve(ROOT, '..', 'reactor-monte-carlo-guide', 'src', 'lib', 'owenVersion.ts'),
    path.resolve(ROOT, '..', '..', 'reactor-monte-carlo-guide', 'src', 'lib', 'owenVersion.ts'),
);
if (exists(site)) {
    const m = /export const OWEN_VERSION = "(\d+\.\d+\.\d+)"/.exec(read(site));
    const sv = m?.[1];
    if (sv !== V) {
        const msg = `reactormc.net says OWEN_VERSION ${sv}, this repo is ${V} — after the GitHub VSIX exists, edit src/lib/owenVersion.ts there and run npm run sync:owen-version + verify:owen-version (site rule owen-version.mdc)`;
        if (release) fail(msg); else warn(msg);
    }
} else {
    warn('reactor-monte-carlo-guide not found beside this repo — the site listing was not checked');
}

// 8. VSIX files.
if (release) {
    for (const dir of [ROOT, path.join(mono, 'owen')]) {
        if (!exists(dir)) continue;
        const vsix = path.join(dir, `owen-${V}.vsix`);
        if (!exists(vsix)) fail(`missing ${vsix} — package it (npx @vscode/vsce package -o owen-${V}.vsix) and leak-check`);
    }
}

for (const f of fixed) console.log(`fixed: ${f}`);
for (const w of warnings) console.warn(`warning: ${w}`);
if (failures.length) {
    console.error(`\nverify:version — ${failures.length} failure(s) against package.json ${V}\n`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
}
console.log(`verify:version — every listing agrees with package.json ${V}${release ? ' (release gate)' : ''}`);
