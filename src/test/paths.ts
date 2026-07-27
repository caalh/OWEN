import * as path from 'path';

/**
 * Repository root, resolved from this file's compiled location.
 *
 * Suites used to each spell their own `path.resolve(__dirname, '../../..')`,
 * which encodes how deep `out/` nests them. When packages/mcnp-workspace was
 * vendored in, tsc's inferred rootDir moved and every one of those counts went
 * stale by a level — in different directions, since a couple had already been
 * written for the new layout. Resolving it once, here, means only this file
 * knows the depth.
 */
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/** Bundled decks under `prebuilt-models/`. */
export const PREBUILT_MODELS = path.join(REPO_ROOT, 'prebuilt-models');

/** Test fixtures that are data, not TypeScript, so they stay in `src/`. */
export const FIXTURES = path.join(REPO_ROOT, 'src', 'test', 'fixtures');
