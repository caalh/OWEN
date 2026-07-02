// Bundles the extension into a single CommonJS file so every production
// dependency (e.g. @supabase/supabase-js) ships inside the VSIX even though
// .vscodeignore excludes node_modules. `vscode` is provided by the host and
// must stay external.
const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// Two bundles ship in the VSIX: the extension host bundle and the MC language
// server (spawned as a separate node process over IPC/stdio).
const builds = [
    { entryPoints: ['src/extension.ts'], outfile: 'out/extension.js' },
    { entryPoints: ['src/server/main.ts'], outfile: 'out/server.js' },
];

async function main() {
    const contexts = await Promise.all(builds.map((b) =>
        esbuild.context({
            ...b,
            bundle: true,
            platform: 'node',
            format: 'cjs',
            target: 'node18',
            external: ['vscode', 'h5wasm'],
            sourcemap: !production,
            minify: production,
            logLevel: 'info',
        }),
    ));

    if (watch) {
        await Promise.all(contexts.map((ctx) => ctx.watch()));
    } else {
        await Promise.all(contexts.map((ctx) => ctx.rebuild()));
        await Promise.all(contexts.map((ctx) => ctx.dispose()));
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
