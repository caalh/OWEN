/**
 * Chatter from the OpenMC geometry-capture pass that is not a defect in the
 * deck. The overlay used to treat the first of these as the reason the 3D
 * view was empty.
 */
export function isCaptureNoise(w: string): boolean {
    return /OPENMC_CROSS_SECTIONS was not set|was skipped \(|intercepted so it could not overwrite|continued past the point OWEN stopped|owen_skipped_statepoint|Ran the deck as:/i.test(w);
}
