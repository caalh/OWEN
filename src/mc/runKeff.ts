/**
 * k-eff for the open deck. The geometry is the deck. The cross sections are a
 * fixed one-group teaching material — they are not read from the ZAIDs.
 */

import { kFromMcnpDeck } from './deck';
import type { KResult } from './transport';

export const TEACHING_MATERIAL = { sigmaS: 0.25, sigmaA: 0.075, sigmaF: 0.05, nu: 2.4 };

export const KEFF_DISCLAIMER =
    'One-group teaching cross sections (Σs 0.25, Σa 0.075, Σf 0.05, ν 2.4), not the ZAIDs in this deck. The shape is the deck. This is not a licensed result.';

export function runKeffOnText(text: string): KResult {
    return kFromMcnpDeck(text, TEACHING_MATERIAL, { particles: 2000, cycles: 16, inactive: 4, seed: 1 });
}
