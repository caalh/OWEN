#!/usr/bin/env node
/**
 * Headless check on the OpenMC token scanner that drives the palette
 * decorations.
 *
 * OWEN colors OpenMC two ways. The injection grammar
 * (syntaxes/openmc.injection.tmLanguage.json) handles a Python file that no
 * language server has claimed. Every real OpenMC user has Pylance, which
 * publishes semantic tokens, and VS Code resolves a semantic token's color from
 * the scopes its *type* maps to — `openmc.Material` arrives as a `class` and is
 * colored as `entity.name.type.class`, so the grammar's `support.class.openmc`
 * is never consulted. Decorations draw above that, and src/highlight/openmcTokens.ts
 * decides where they go.
 *
 * The two mechanisms have to agree, or the same deck gets different colors on
 * two machines. These cases pin the scanner to the grammar's four patterns and
 * their precedence.
 *
 * Run: npm run verify:openmc-tokens
 */
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const outDir = mkdtempSync(path.join(tmpdir(), 'owen-openmc-'));
const outFile = path.join(outDir, 'tokens.mjs');

const cssFile = path.join(outDir, 'forcedColor.mjs');

await build({
  entryPoints: ['src/highlight/openmcTokens.ts'],
  outfile: outFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'error',
});

await build({
  entryPoints: ['src/highlight/forcedColor.ts'],
  outfile: cssFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'error',
});

const { findOpenmcTokens, maskCommentsAndStrings } = await import(pathToFileURL(outFile).href);
const { forcedColorCss } = await import(pathToFileURL(cssFile).href);

const failures = [];

/**
 * The scopes the injection grammar actually declares. v1.1.4 taught the scanner
 * the surrounding Python layer as well — comments, strings, numbers, keywords,
 * `def` names — so it now emits more than the grammar does. That is deliberate
 * (the grammar never colors those; the decorations do), but it is a different
 * question from "do the two mechanisms agree about openmc symbols", which is
 * what the cases below are for. Comparing against the raw stream conflated the
 * two and left this check red from v1.1.4 to v1.4.2 without anyone reading it.
 */
const GRAMMAR_SCOPES = new Set([
  'variable.language.openmc',
  'support.type.openmc',
  'support.class.openmc',
  'support.function.openmc',
  'support.variable.openmc',
]);

/** Every token, as `text:scope` pairs in source order. */
function tokens(src, filter) {
  return findOpenmcTokens(src)
    .filter((t) => !filter || filter(t))
    .map((t) => `${src.slice(t.start, t.end)}:${t.scope}`);
}

/** Compares the openmc symbols only — what the grammar and the scanner share. */
function expect(label, src, want) {
  const got = tokens(src, (t) => GRAMMAR_SCOPES.has(t.scope));
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failures.push(`${label}\n      want [${want.join(', ')}]\n      got  [${got.join(', ')}]`);
  }
}

/** Compares the full stream, for the Python layer the grammar has no say over. */
function expectAll(label, src, want) {
  const got = tokens(src);
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failures.push(`${label}\n      want [${want.join(', ')}]\n      got  [${got.join(', ')}]`);
  }
}

// --- the four grammar patterns --------------------------------------------

expect('bare module reference', 'import openmc', [
  'openmc:variable.language.openmc',
]);

expect('class access', 'm = openmc.Material(name="fuel")', [
  'openmc:variable.language.openmc',
  'Material:support.class.openmc',
]);

expect('function call', 'openmc.run(threads=4)', [
  'openmc:variable.language.openmc',
  'run:support.function.openmc',
]);

expect('submodule', 'openmc.model', [
  'openmc:variable.language.openmc',
  'model:support.type.openmc',
]);

expect('class under a submodule', 'p = openmc.model.RectangularPrism(1.26, 1.26)', [
  'openmc:variable.language.openmc',
  'model:support.type.openmc',
  'RectangularPrism:support.class.openmc',
]);

expect('function under a submodule', 'w = openmc.model.borated_water(600)', [
  'openmc:variable.language.openmc',
  'model:support.type.openmc',
  'borated_water:support.function.openmc',
]);

// --- precedence: the longest pattern claims the span ----------------------

// If the bare-module pattern were allowed to run first, `openmc` in
// `openmc.Material` would be claimed twice and `Material` never colored.
expect('class access is not also a bare module match', 'openmc.Materials()', [
  'openmc:variable.language.openmc',
  'Materials:support.class.openmc',
]);

// A lowercase attribute that is not called is not a function.
expect('attribute without a call is left alone', 'x = openmc.config', [
  'openmc:variable.language.openmc',
]);

// --- comments and strings are excluded ------------------------------------
// The injection selector carries `-comment -string`, so these must match.

expect('line comment', '# openmc.Material is the class\nimport openmc', [
  'openmc:variable.language.openmc',
]);

expect('single-quoted string', "s = 'openmc.Material'\nimport openmc", [
  'openmc:variable.language.openmc',
]);

expect(
  'triple-quoted docstring',
  '"""\nBuild with openmc.Material.\n"""\nimport openmc',
  ['openmc:variable.language.openmc'],
);

expect('escaped quote inside a string', "s = 'it\\'s openmc.Material'\nopenmc.run()", [
  'openmc:variable.language.openmc',
  'run:support.function.openmc',
]);

// A trailing apostrophe must not swallow the rest of the file.
expect(
  'unterminated single quote stops at the newline',
  "s = 'oops\nopenmc.run()",
  ['openmc:variable.language.openmc', 'run:support.function.openmc'],
);

// --- offsets stay aligned with the original text --------------------------

{
  const src = 'import openmc\n# openmc\nm = openmc.Material()';
  const masked = maskCommentsAndStrings(src);
  if (masked.length !== src.length) {
    failures.push(`masking changed the length: ${src.length} -> ${masked.length}`);
  }
  if (masked.split('\n').length !== src.split('\n').length) {
    failures.push('masking changed the line count, so decoration ranges would drift');
  }
  const found = findOpenmcTokens(src);
  const material = found.find((t) => src.slice(t.start, t.end) === 'Material');
  if (!material) {
    failures.push('Material not found after a masked comment');
  } else if (src.slice(material.start, material.end) !== 'Material') {
    failures.push('Material offsets do not index back into the original text');
  }
}

// --- a file that never mentions openmc costs nothing ----------------------

expect('unrelated python', 'import numpy as np\nnp.zeros(3)', []);

// --- the Python layer the grammar does not cover --------------------------
// Added in v1.1.4 so a palette colors a whole model script, not just the
// openmc symbols in it. Pinned here in full, in source order, because nothing
// else asserts these scopes and the offsets drive decoration ranges.

expectAll(
  'python layer: keywords, def name, comment, attribute and number',
  'def build():  # make it\n    m = openmc.Material()\n    m.temperature = 900.0\n    return m',
  [
    'def:keyword.control.openmc',
    'build:entity.name.function.openmc',
    '# make it:comment.line.openmc',
    'openmc:variable.language.openmc',
    'Material:support.class.openmc',
    'temperature:support.variable.openmc',
    '900.0:constant.numeric.openmc',
    'return:keyword.control.openmc',
  ],
);

// A comment is one token; the openmc symbols inside it stay unclaimed, or the
// injection selector's `-comment` and the decorations would disagree.
expectAll(
  'python layer: a comment is claimed whole, its openmc symbols are not',
  'import openmc\n# openmc.Material here',
  [
    'import:keyword.control.openmc',
    'openmc:variable.language.openmc',
    '# openmc.Material here:comment.line.openmc',
  ],
);

// The scanner runs on every keystroke in every Python file, so it bails when
// masking leaves no live `openmc`. A file whose only mention is in a comment
// is therefore not an OpenMC file, and costs nothing — including no Python
// layer. Pinned because it is the difference between a decoration pass and a
// full tokenize on unrelated Python.
expectAll('a mention only inside a comment does not make it an OpenMC file', '# openmc.Material here', []);

// --- the decoration has to outrank the theme's token color ----------------
// Without `!important` the palette is computed, applied, and invisible, which
// is exactly what 1.0.4 shipped. Equal specificity means ordering decides, and
// OWEN rewrites editor.tokenColorCustomizations on every palette change.

{
  const css = forcedColorCss({ foreground: '#9DD6C4' });
  if (!/color:\s*#9DD6C4\s*!important/.test(css)) {
    failures.push(`forcedColorCss dropped the important color declaration: ${css}`);
  }
  if (!css.startsWith('none;')) {
    failures.push(
      `forcedColorCss must open with "none;" to close the text-decoration property it is ` +
      `assigned to, otherwise the color declaration is part of a text-decoration value: ${css}`,
    );
  }

  const italic = forcedColorCss({ foreground: '#A8B7AB', fontStyle: 'italic' });
  if (!/font-style:\s*italic\s*!important/.test(italic)) {
    failures.push(`forcedColorCss dropped the important font-style declaration: ${italic}`);
  }

  const plain = forcedColorCss({ foreground: '#8AB4D8' });
  if (/font-style/.test(plain)) {
    failures.push(`forcedColorCss invented a font-style for a style that has none: ${plain}`);
  }
}

// ---------------------------------------------------------------------------

rmSync(outDir, { recursive: true, force: true });

if (failures.length) {
  console.error('[verify-openmc-tokens] FAILED\n');
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    '\nThe scanner must agree with syntaxes/openmc.injection.tmLanguage.json:\n' +
    'whichever mechanism wins on a given machine should produce the same colors.\n',
  );
  process.exit(1);
}

console.log(
  '[verify-openmc-tokens] OK — 18 cases across the four patterns, precedence, masking and the ' +
  'Python layer, plus the forced-color declaration that makes the decorations visible.',
);
