/**
 * Shared "which universe is the real world?" picker for every code.
 *
 * The exact engine, 2D slices, and the pin/lattice fast paths all need the
 * same answer: the world is the populated universe that is never used as a
 * fill. Codes disagree on the id (MCNP/Serpent 0, OpenMC XML 1+, SCONE
 * remaps rootUniverse to 0) — this helper does not care about the number,
 * only about the fill graph. Prefer `0` when it is a root so an unused pin
 * universe is never chosen over MCNP/Serpent's real world.
 */

export function pickRootId<T>(
    populated: readonly T[],
    filled: ReadonlySet<T>,
    cellCount: (id: T) => number,
    prefer?: T,
): T | undefined {
    if (populated.length === 0) return prefer;
    const roots = populated.filter((id) => !filled.has(id));
    const candidates = roots.length > 0 ? roots : populated.slice();
    if (prefer !== undefined && candidates.some((id) => Object.is(id, prefer))) return prefer;
    if (candidates.length === 1) return candidates[0];
    let best = candidates[0];
    let bestN = cellCount(best);
    for (let i = 1; i < candidates.length; i++) {
        const id = candidates[i];
        const n = cellCount(id);
        if (n > bestN) {
            best = id;
            bestN = n;
        }
    }
    return best;
}
