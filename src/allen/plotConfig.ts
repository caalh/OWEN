// Pure, dependency-free helpers for the ALLEN σ(E) log-log plot.
//
// The ALLEN webview (src/allen/panel.ts) injects equivalent copies of these
// functions inline into its HTML string (the webview cannot import modules).
// Keep the two in sync. These versions are unit-tested in
// src/test/suite/allenPlot.test.ts so the resampling/formatter logic stays
// correct even though the rendered webview itself needs human eyes.

const SUPERSCRIPTS: Record<string, string> = {
    '-': '\u207b',
    '0': '\u2070',
    '1': '\u00b9',
    '2': '\u00b2',
    '3': '\u00b3',
    '4': '\u2074',
    '5': '\u2075',
    '6': '\u2076',
    '7': '\u2077',
    '8': '\u2078',
    '9': '\u2079',
};

/** Render an integer exponent as Unicode superscript digits (e.g. -5 -> "\u207b\u2075"). */
export function supExp(p: number): string {
    return String(p)
        .split('')
        .map((ch) => SUPERSCRIPTS[ch] ?? ch)
        .join('');
}

/**
 * Power-of-ten tick label for a uPlot log axis split.
 * Returns "10\u207b\u00b3", "10\u2070", "10\u2075"\u2026 for clean decades and "" for
 * intermediate (minor) splits so only decade gridlines get labelled.
 */
export function logTickLabel(v: number): string {
    if (!(v > 0)) return '';
    const l = Math.log10(v);
    const r = Math.round(l);
    return Math.abs(l - r) < 1e-6 ? '10' + supExp(r) : '';
}

/**
 * One sorted, de-duplicated, strictly-positive energy grid spanning every
 * curve. Each curve keeps its native sample points (the union contains them
 * all), which preserves fidelity without coarse downsampling.
 */
export function unifiedGrid(curves: Array<{ E: number[] }>): number[] {
    const set = new Set<number>();
    for (const c of curves) {
        for (const e of c.E) {
            if (e > 0) set.add(e);
        }
    }
    return [...set].sort((a, b) => a - b);
}

/**
 * Interpolate a curve's cross-section at energy `e` in log-log space.
 * Returns null when `e` is outside the curve's own [Emin, Emax] so the plotted
 * line ends cleanly instead of dropping vertically to ~0 at the data edges.
 */
export function interpLogLog(srcE: number[], srcXs: number[], e: number): number | null {
    const n = srcE.length;
    if (n === 0 || e < srcE[0] || e > srcE[n - 1]) return null;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (srcE[mid] <= e) lo = mid;
        else hi = mid;
    }
    const x0 = srcE[lo];
    const x1 = srcE[hi];
    const y0 = srcXs[lo];
    const y1 = srcXs[hi];
    if (y0 <= 0 || y1 <= 0 || x0 <= 0 || x1 <= 0) {
        const t = (e - x0) / (x1 - x0 || 1);
        const y = y0 + (y1 - y0) * t;
        return y > 0 ? y : null;
    }
    const lx0 = Math.log10(x0);
    const lx1 = Math.log10(x1);
    const le = Math.log10(e);
    const t = (le - lx0) / (lx1 - lx0 || 1);
    return Math.pow(10, Math.log10(y0) * (1 - t) + Math.log10(y1) * t);
}

/** Build the uPlot aligned-data array [E, ...series] for the given curves. */
export function buildPlotData(
    curves: Array<{ E: number[]; xs: number[] }>,
): Array<Array<number | null>> {
    const E = unifiedGrid(curves);
    const data: Array<Array<number | null>> = [E];
    for (const c of curves) {
        data.push(E.map((e) => interpLogLog(c.E, c.xs, e)));
    }
    return data;
}
