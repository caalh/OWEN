/**
 * Shared numeric-matching helpers for the results parsers.
 *
 * The old `[0-9.]+` character class happily matched dots-only strings ("...",
 * ".") and multi-dot garbage ("1.2.3"), which parseFloat turned into NaN (or a
 * silently truncated value) that then rendered as "k-eff = NaN" in the Results
 * viewer. NUM requires a real decimal number with at least one digit and an
 * optional exponent.
 */
export const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`;

/**
 * Appends one (cycle, mean, std) sample, dropping the whole sample when the
 * mean is non-finite so a garbage line can never poison the k-eff history.
 */
export function pushIfFinite(
    cycles: number[],
    mean: number[],
    std: number[],
    cycle: number,
    m: number,
    s: number,
): void {
    if (!Number.isFinite(m)) return;
    cycles.push(cycle);
    mean.push(m);
    std.push(Number.isFinite(s) ? s : 0);
}
