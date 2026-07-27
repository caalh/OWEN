#!/usr/bin/env node
/**
 * Headless check on the four MCNP rule corrections made against the MCNP6.3.1
 * Theory & User Manual (LA-UR-24-24602 Rev. 1).
 *
 * The full suite runs under vscode-test, which downloads a VS Code build. These
 * four rules are pure functions of text, so they can be exercised in a second
 * without that. This is a guard, not a replacement: `npm test` still owns the
 * rest.
 *
 * Each case below was a false positive on a correct deck:
 *
 *   1. HEX is a documented alias for RHP. Manual 5.3.4.5 is titled "RHP or HEX"
 *      and three of the four examples in Listing 5.7 spell it `hex`. OWEN's own
 *      preview parser has always accepted it, so the validator and the renderer
 *      disagreed about the same card.
 *   2. RHP takes 9 or 15 parameters (s and t are optional for a regular
 *      hexagon); BOX takes 9 or 12 (dropping a3 makes the body infinite along
 *      the normal to a1 x a2). Fixed counts of 15 and 12 rejected the short
 *      forms, which are the common ones.
 *   3. S(alpha,beta) is not hydrogen-only. Manual 5.6.2 Example 2 applies GRPH
 *      to pure carbon. The rule now checks the table's own target element.
 *   4. Lines indented 5+ columns are continuation lines. Reading them as cell
 *      cards put a "missing imp:n" warning on every row of a lattice fill map.
 *
 * Run: npm run verify:mcnp-rules
 */
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const outDir = mkdtempSync(path.join(tmpdir(), 'owen-rules-'));
const outFile = path.join(outDir, 'rules.mjs');

await build({
  entryPoints: ['src/language/rules.ts'],
  outfile: outFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'error',
});

const { runLanguageRules } = await import(pathToFileURL(outFile).href);
const codes = (text) => runLanguageRules('mcnp', text).map((d) => String(d.code));

const failures = [];

/** The rule must fire on this deck. */
function mustFire(code, label, text) {
  if (!codes(text).includes(code)) {
    failures.push(`${label}: expected ${code}, got [${codes(text).join(', ')}]`);
  }
}

/** The rule must stay quiet: this deck is correct MCNP. */
function mustBeQuiet(code, label, text) {
  const got = codes(text);
  if (got.includes(code)) {
    failures.push(`${label}: false positive ${code} on correct MCNP — [${got.join(', ')}]`);
  }
}

// 1. HEX / CYL --------------------------------------------------------------

mustBeQuiet('mcnp.macrobody', 'HEX is an RHP alias', '10 hex 0 0 0  0 0 10  5 0 0');
mustFire('mcnp.macrobody', 'CYL is not a keyword', '10 cyl 0 0 0 5');

// 2. Macrobody parameter counts ---------------------------------------------

mustFire('mcnp.macrobody-params', 'RPP with 5 params', '10 rpp -1 1 -1 1 -1');
mustBeQuiet('mcnp.macrobody-params', 'RCC with 7', '10 rcc 0 0 0 0 0 100 0.5');
mustBeQuiet('mcnp.macrobody-params', 'RHP short form (9)', '10 rhp 0 0 0  0 0 10  5 0 0');
mustBeQuiet('mcnp.macrobody-params', 'RHP long form (15)', '10 rhp 0 0 0  0 0 10  5 0 0  0 5 0  0 0 5');
mustBeQuiet('mcnp.macrobody-params', 'HEX short form (9)', '10 hex 0 0 0  0 0 10  5 0 0');
mustBeQuiet('mcnp.macrobody-params', 'BOX short form (9)', '11 box 0 0 0  4 0 0  0 4 0');
mustBeQuiet('mcnp.macrobody-params', 'BOX long form (12)', '11 box 0 0 0  4 0 0  0 4 0  0 0 4');

// 3. S(alpha,beta) target ---------------------------------------------------

mustFire(
  'mcnp.sab-no-target',
  'lwtr on hydrogen-free UO2',
  'm7 92235.80c 0.04 92238.80c 0.96 8016.80c 2.0\nmt7 lwtr.20t',
);
mustBeQuiet('mcnp.sab-no-target', 'lwtr on water', 'm3 1001.80c 2 8016.80c 1\nmt3 lwtr.20t');
mustBeQuiet('mcnp.sab-no-target', 'grph on graphite', 'm8 6000.80c 1.0\nmt8 grph.20t');
mustBeQuiet('mcnp.sab-no-target', 'be on beryllium metal', 'm9 4009.80c 1.0\nmt9 be.20t');
mustBeQuiet(
  'mcnp.sab-no-target',
  'h-zr on zirconium hydride',
  'm4 1001.80c 2.0 40000.80c 1.0\nmt4 h-zr.20t zr-h.20t',
);
mustFire('mcnp.mt-missing-material', 'mt with no material', 'mt42 lwtr.20t');

// 4. Continuation lines are not cell cards ----------------------------------

mustBeQuiet(
  'mcnp.cell-imp',
  'lattice fill rows',
  [
    '100 0 -1 lat=1 u=5 imp:n=1',
    '     fill=-1:1 -1:1 0:0',
    '     2 2 2',
    '     2 3 2',
    '     2 2 2',
  ].join('\n'),
);
mustFire('mcnp.cell-imp', 'cell genuinely missing imp:n', '10 1 -10.4 -1');
mustBeQuiet('mcnp.cell-imp', 'imp:n on a continuation line', '10 1 -10.4 -1\n        imp:n=1');

// ---------------------------------------------------------------------------

rmSync(outDir, { recursive: true, force: true });

if (failures.length) {
  console.error('[verify-mcnp-rules] FAILED\n');
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    '\nBefore "fixing" a failure here, read the header of this file. Every case is\n' +
    'a card that real MCNP accepts, cited to the 6.3.1 manual.\n',
  );
  process.exit(1);
}

console.log('[verify-mcnp-rules] OK — 17 cases across macrobodies, S(a,b) targets, and continuation lines.');
