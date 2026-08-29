// Guard: the OpenMC statepoint reader must keep working after esbuild bundles
// the extension to CommonJS.
//
// h5wasm is ESM-only (package.json exports has "import" and no "require"), so a
// plain `await import('h5wasm/node')` in a TypeScript file gets downlevelled by
// esbuild into a `require()` call, which throws ERR_REQUIRE_ESM at runtime. The
// parser dodges that with `new Function('spec', 'return import(spec)')`, which
// esbuild cannot see through. This script bundles the parser exactly the way
// `npm run compile` bundles the extension and then reads a real statepoint
// through the bundle, so the trick cannot silently regress.
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const fixture = path.join(root, 'src', 'test', 'fixtures', 'openmc_statepoint.30.h5');

// The bundle has to live inside the extension folder, not in a temp directory:
// a bare `import('h5wasm/node')` resolves against the importing file, and in the
// packaged VSIX that file is <extension>/out/extension.js sitting next to the
// shipped node_modules/h5wasm. Bundling elsewhere would fail for a reason that
// says nothing about the extension.
const outDir = fs.mkdtempSync(path.join(root, 'out-test', 'h5-bundle-'));
const outFile = path.join(outDir, 'bundle.cjs');

buildSync({
    entryPoints: [path.join(root, 'src', 'results', 'parsers', 'openmc.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['vscode'],
    outfile: outFile,
});

const require_ = createRequire(import.meta.url);
const { parseOpenmcStatepoint } = require_(outFile);

const failures = [];
const check = (name, ok, detail) => {
    if (!ok) failures.push(detail ? `${name}: ${detail}` : name);
};

const res = await parseOpenmcStatepoint(fixture);

check('bundled reader loaded h5wasm', !res.metadata?.parseError, String(res.metadata?.parseError ?? ''));
check(
    'bundled reader did not fall back to an empty result',
    res.tallies.length > 0 && res.keff?.final,
    `tallies=${res.tallies.length} keff=${JSON.stringify(res.keff?.final)}`,
);
check(
    'k-eff matches OpenMC (1.3722300263744938)',
    Math.abs((res.keff?.final?.mean ?? 0) - 1.3722300263744938) < 1e-12,
    String(res.keff?.final?.mean),
);

fs.rmSync(outDir, { recursive: true, force: true });

if (failures.length) {
    console.error('h5wasm bundle guard FAILED:');
    for (const f of failures) console.error('  - ' + f);
    process.exit(1);
}
console.log('h5wasm bundle guard: statepoint reads correctly from a CJS esbuild bundle');
