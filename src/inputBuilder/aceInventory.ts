// VENDORED from the ReactorMC site repo: src/data/aceInventory.ts
// Do not edit here. Edit it there, run its verify (npm run verify:nrdp-materials),
// then re-sync: npm run sync-nrdp-cards
/**
 * ACE table inventory for ENDF/B-VII.1 — the library MCNP names with the
 * `.80c`–`.86c` suffixes (LANL ENDF71x) and Serpent with `.80c`.
 *
 * Source: the ENDF/B-VII.1 neutron reaction sublibrary index,
 * https://www-nds.iaea.org/public/download-endf/ENDF-B-VII.1/n-index.htm
 * cross-checked against the NNDC release page, which states the sublibrary
 * holds 423 materials: "422 isotopic and 1 elemental evaluation"
 * (https://www.nndc.bnl.gov/endf-b7.1/). The one elemental evaluation is
 * 6-C-0, which is why a `.80c` deck writes carbon as `6000` and cannot write
 * `6012`. ENDF/B-VIII.0 is the other way round.
 *
 * Why this file exists: a composition is a list of nuclides, but a deck is a
 * list of *tables*, and the two are not the same set. Oxygen is the case that
 * bites — every oxide contains 0.2 at% O-18, and ENDF/B-VII.1 has no O-18
 * evaluation, so a card that lists `8018.80c` stops MCNP with a fatal
 * missing-table error. Card generators fold nuclides that are absent here into
 * an isotope that is present instead of emitting a table nobody has.
 *
 * Metastable targets carry MCNP's A+400 convention (Cd-115m is 48515).
 *
 * Generated, then checked in; `npm run verify:nrdp-materials` re-asserts the
 * counts and the two anchors (C-0 present, O-18 absent).
 */

/** ZAIDs with an ENDF/B-VII.1 evaluation (423 entries). */
export const ENDFB71_ZAIDS: ReadonlySet<string> = new Set([
  '1001', '1002', '1003', '2003', '2004', '3006', '3007', '4007', '4009', '5010', '5011', '6000',
  '7014', '7015', '8016', '8017', '9019', '11022', '11023', '12024', '12025', '12026', '13027', '14028',
  '14029', '14030', '15031', '16032', '16033', '16034', '16036', '17035', '17037', '18036', '18038', '18040',
  '19039', '19040', '19041', '20040', '20042', '20043', '20044', '20046', '20048', '21045', '22046', '22047',
  '22048', '22049', '22050', '23050', '23051', '24050', '24052', '24053', '24054', '25055', '26054', '26056',
  '26057', '26058', '27058', '27458', '27059', '28058', '28059', '28060', '28061', '28062', '28064', '29063',
  '29065', '30064', '30065', '30066', '30067', '30068', '30070', '31069', '31071', '32070', '32072', '32073',
  '32074', '32076', '33074', '33075', '34074', '34076', '34077', '34078', '34079', '34080', '34082', '35079',
  '35081', '36078', '36080', '36082', '36083', '36084', '36085', '36086', '37085', '37086', '37087', '38084',
  '38086', '38087', '38088', '38089', '38090', '39089', '39090', '39091', '40090', '40091', '40092', '40093',
  '40094', '40095', '40096', '41093', '41094', '41095', '42092', '42094', '42095', '42096', '42097', '42098',
  '42099', '42100', '43099', '44096', '44098', '44099', '44100', '44101', '44102', '44103', '44104', '44105',
  '44106', '45103', '45105', '46102', '46104', '46105', '46106', '46107', '46108', '46110', '47107', '47109',
  '47510', '47111', '48106', '48108', '48110', '48111', '48112', '48113', '48114', '48515', '48116', '49113',
  '49115', '50112', '50113', '50114', '50115', '50116', '50117', '50118', '50119', '50120', '50122', '50123',
  '50124', '50125', '50126', '51121', '51123', '51124', '51125', '51126', '52120', '52122', '52123', '52124',
  '52125', '52126', '52527', '52128', '52529', '52130', '52132', '53127', '53129', '53130', '53131', '53135',
  '54123', '54124', '54126', '54128', '54129', '54130', '54131', '54132', '54133', '54134', '54135', '54136',
  '55133', '55134', '55135', '55136', '55137', '56130', '56132', '56133', '56134', '56135', '56136', '56137',
  '56138', '56140', '57138', '57139', '57140', '58136', '58138', '58139', '58140', '58141', '58142', '58143',
  '58144', '59141', '59142', '59143', '60142', '60143', '60144', '60145', '60146', '60147', '60148', '60150',
  '61147', '61148', '61548', '61149', '61151', '62144', '62147', '62148', '62149', '62150', '62151', '62152',
  '62153', '62154', '63151', '63152', '63153', '63154', '63155', '63156', '63157', '64152', '64153', '64154',
  '64155', '64156', '64157', '64158', '64160', '65159', '65160', '66156', '66158', '66160', '66161', '66162',
  '66163', '66164', '67165', '67566', '68162', '68164', '68166', '68167', '68168', '68170', '69168', '69169',
  '69170', '71175', '71176', '72174', '72176', '72177', '72178', '72179', '72180', '73180', '73181', '73182',
  '74180', '74182', '74183', '74184', '74186', '75185', '75187', '77191', '77193', '79197', '80196', '80198',
  '80199', '80200', '80201', '80202', '80204', '81203', '81205', '82204', '82206', '82207', '82208', '83209',
  '88223', '88224', '88225', '88226', '89225', '89226', '89227', '90227', '90228', '90229', '90230', '90231',
  '90232', '90233', '90234', '91229', '91230', '91231', '91232', '91233', '92230', '92231', '92232', '92233',
  '92234', '92235', '92236', '92237', '92238', '92239', '92240', '92241', '93234', '93235', '93236', '93237',
  '93238', '93239', '94236', '94237', '94238', '94239', '94240', '94241', '94242', '94243', '94244', '94246',
  '95240', '95241', '95242', '95642', '95243', '95244', '95644', '96240', '96241', '96242', '96243', '96244',
  '96245', '96246', '96247', '96248', '96249', '96250', '97245', '97246', '97247', '97248', '97249', '97250',
  '98246', '98248', '98249', '98250', '98251', '98252', '98253', '98254', '99251', '99252', '99253', '99254',
  '99654', '99255', '100255',
]);

/** True when `suffix` (e.g. '80c') names an ENDF/B-VII.1 ACE library. */
export function isEndfb71Suffix(suffix: string): boolean {
    return /^8[0-6]c$/.test(suffix);
}

/**
 * How a card should write `element` for an ENDF/B-VII.1 library.
 *
 * `collapse` — the element has an elemental evaluation and no isotopic ones
 * (carbon); write the single elemental ZAID.
 * `fold` — some isotopes are missing; add their share to `into` (the most
 * abundant isotope that does exist).
 * `asIs` — every isotope has a table.
 * `unavailable` — the library has nothing for this element (neon, platinum).
 */
export type ElementPlan =
    | { kind: 'asIs' }
    | { kind: 'collapse'; zaid: string }
    | { kind: 'fold'; into: string; folded: string[] }
    | { kind: 'unavailable' };

/**
 * Decide how to write an element, given its isotopes as ZAID/abundance pairs
 * (abundance may be a weight fraction or an atom density — only the ordering
 * matters). `inventory` defaults to ENDF/B-VII.1.
 */
export function planElement(
    z: number,
    isotopes: readonly { zaid: string; weight: number }[],
    inventory: ReadonlySet<string> = ENDFB71_ZAIDS,
): ElementPlan {
    if (isotopes.length === 0) return { kind: 'asIs' };
    const missing = isotopes.filter((i) => !inventory.has(i.zaid));
    if (missing.length === 0) return { kind: 'asIs' };
    const elemental = String(z * 1000);
    const present = isotopes.filter((i) => inventory.has(i.zaid));
    if (present.length === 0) {
        return inventory.has(elemental) ? { kind: 'collapse', zaid: elemental } : { kind: 'unavailable' };
    }
    if (inventory.has(elemental)) return { kind: 'collapse', zaid: elemental };
    const into = present.reduce((best, i) => (i.weight > best.weight ? i : best), present[0]);
    return { kind: 'fold', into: into.zaid, folded: missing.map((i) => i.zaid) };
}
