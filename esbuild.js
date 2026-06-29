// Bundles the extension into a single CommonJS file so every production
// dependency (e.g. @supabase/supabase-js) ships inside the VSIX even though
// .vscodeignore excludes node_modules. `vscode` is provided by the host and
// must stay external.
const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
    const ctx = await esbuild.context({
        entryPoints: ['src/extension.ts'],
        bundle: true,
        outfile: 'out/extension.js',
        platform: 'node',
        format: 'cjs',
        target: 'node18',
        external: ['vscode', 'h5wasm'],
        sourcemap: !production,
        minify: production,
        logLevel: 'info',
    });

    if (watch) {
        await ctx.watch();
    } else {
        await ctx.rebuild();
        await ctx.dispose();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
