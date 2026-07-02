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

/** Epithermal resonance-integral limits (Westcott teaching convention). */
export const RI_E_MIN_EV = 0.5;
export const RI_E_MAX_EV = 1e6;

export const DOPPLER_TEMPS_K = [294, 600, 900, 1200] as const;

/** Resonance integral I = ∫ σ(E)/E dE (trapezoidal on native grid). */
export function resonanceIntegral(
    E: number[],
    xs: number[],
    Emin = RI_E_MIN_EV,
    Emax = RI_E_MAX_EV,
): number {
    let sum = 0;
    for (let i = 1; i < E.length; i++) {
        const e0 = E[i - 1];
        const e1 = E[i];
        if (e1 < Emin || e0 > Emax) continue;
        const lo = Math.max(e0, Emin);
        const hi = Math.min(e1, Emax);
        if (hi <= lo) continue;
        const y0 = xs[i - 1];
        const y1 = xs[i];
        if (y0 <= 0 || y1 <= 0) continue;
        const s0 = y0 / e0;
        const s1 = y1 / e1;
        sum += 0.5 * (s0 + s1) * (hi - lo);
    }
    return sum;
}

/**
 * Bondarenko-style narrow-resonance shielding factor (teaching approximation).
 * Uses log1p for numerical stability: for tiny t, Math.log(1 + t)/t suffers
 * catastrophic cancellation and returns values slightly ABOVE 1, which is
 * unphysical (the factor is a probability-like ratio in [0, 1]).
 */
export function bondarenkoShieldingFactor(xs: number, sigma0: number): number {
    if (sigma0 <= 0 || xs <= 0) return 1;
    const t = sigma0 / xs;
    if (!Number.isFinite(t) || t === 0) return 1;
    const f = Math.log1p(t) / t;
    return Math.min(1, Math.max(0, f));
}

export function shieldedCurve(E: number[], xs: number[], sigma0: number): number[] {
    return xs.map((x) => x * bondarenkoShieldingFactor(x, sigma0));
}

/** Finite-difference ∂σ/∂T between refT and next temperature curve. */
export function dopplerCoeffSeries(
    curves: Array<{ E: number[]; xs: number[]; temperature_K: number }>,
    refT = 294,
): { E: number[]; dSigmaDT: number[] } | null {
    const sorted = [...curves].sort((a, b) => a.temperature_K - b.temperature_K);
    const ref = sorted.find((c) => c.temperature_K === refT) ?? sorted[0];
    const next = sorted.find((c) => c.temperature_K > ref.temperature_K);
    if (!ref || !next) return null;
    const E = unifiedGrid(curves);
    const dT = next.temperature_K - ref.temperature_K;
    const dSigmaDT = E.map((e) => {
        const s0 = interpLogLog(ref.E, ref.xs, e);
        const s1 = interpLogLog(next.E, next.xs, e);
        if (s0 == null || s1 == null) return 0;
        return (s1 - s0) / dT;
    });
    return { E, dSigmaDT };
}
