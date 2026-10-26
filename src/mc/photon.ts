/**
 * Photon attenuation and Compton scattering.
 *
 * A pure absorber has an exact transmitted fraction e^(-μx). Klein–Nishina
 * sampling is checked against an independent integral of the same kernel.
 * A Taylor/Berger buildup benchmark is not claimed: those coefficients are a
 * copyrighted standard, and this file does not invent them.
 *
 * Lead μ/ρ at 1 MeV is the NIST XCOM value 7.102e-2 cm²/g
 * (https://physics.nist.gov/PhysRefData/XrayMassCoef/ElemTab/z82.html).
 * Density 11.35 g/cm³ is the elemental density paired with that table.
 */

export const LEAD_1MEV = {
  energyMeV: 1,
  muOverRho: 7.102e-2,
  densityGPerCm3: 11.35,
  source: "NIST XCOM lead, 1.000 MeV, mu/rho = 7.102E-02 cm2/g",
};

export function leadMuPerCm(): number {
  return LEAD_1MEV.muOverRho * LEAD_1MEV.densityGPerCm3;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fraction of normally incident photons that cross a pure absorber of thickness x. */
export function transmittedFraction(muPerCm: number, thicknessCm: number, particles: number, seed: number): { fraction: number; sigma: number } {
  const rng = mulberry32(seed);
  let passed = 0;
  for (let i = 0; i < particles; i++) {
    const flight = -Math.log(Math.max(rng(), 1e-300)) / muPerCm;
    if (flight >= thicknessCm) passed += 1;
  }
  const fraction = passed / particles;
  const sigma = Math.sqrt((fraction * (1 - fraction)) / particles);
  return { fraction, sigma };
}

const ELECTRON_REST_MEV = 0.511;

/** Klein–Nishina kernel in μ = cos θ, up to the classical electron radius factor. */
export function kleinNishinaKernel(energyMeV: number, mu: number): { epsilon: number; kernel: number } {
  const alpha = energyMeV / ELECTRON_REST_MEV;
  const epsilon = 1 / (1 + alpha * (1 - mu));
  const kernel = epsilon * epsilon * (epsilon + 1 / epsilon - (1 - mu * mu));
  return { epsilon, kernel };
}

/**
 * Mean scattered photon energy. Rejection sampling on μ uniform in [-1, 1]
 * with the kernel bounded by 2 (its value at μ = 1). Throws if a sample
 * exceeds that bound, which would mean the bound is wrong.
 */
export function meanScatteredEnergy(energyMeV: number, samples: number, seed: number): { meanMeV: number; sigma: number } {
  const rng = mulberry32(seed);
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < samples; i++) {
    let energy = 0;
    for (;;) {
      const mu = 2 * rng() - 1;
      const { epsilon, kernel } = kleinNishinaKernel(energyMeV, mu);
      if (kernel > 2 + 1e-9) throw new Error(`Klein-Nishina kernel ${kernel} exceeded the bound 2`);
      if (rng() * 2 <= kernel) {
        energy = epsilon * energyMeV;
        break;
      }
    }
    sum += energy;
    sumSq += energy * energy;
  }
  const mean = sum / samples;
  const variance = sumSq / samples - mean * mean;
  return { meanMeV: mean, sigma: Math.sqrt(Math.max(0, variance) / samples) };
}

/** Capture gammas through a pure-absorber shield. Neutron tracking is not touched. */
export function attenuateCaptures(
  captures: number,
  yieldPerCapture: number,
  muPerCm: number,
  thicknessCm: number,
  seed: number,
): { emitted: number; transmitted: number; fraction: number; sigma: number } {
  const emitted = captures * yieldPerCapture;
  const { fraction, sigma } = transmittedFraction(muPerCm, thicknessCm, Math.max(emitted, 1), seed);
  return { emitted, transmitted: fraction * emitted, fraction, sigma };
}
