/**
 * Short "what to do" text for each diagnostic code. Validate Input shows this
 * next to the message so the Problems panel is not the only place a finding
 * lives, and so a beginner does not have to decode the code name.
 *
 * Keep one sentence. The diagnostic message already says what is wrong; this
 * says how to change the deck. Unknown codes fall back to the message itself.
 */

const SOLUTIONS: Record<string, string> = {
    'mcnp.macrobody': 'Replace the unknown mnemonic with the MCNP name (RCC not CYL, RPP not BOX-with-wrong-count). HEX is legal — it is an alias for RHP.',
    'mcnp.macrobody-params': 'Count the entries on the manual page for that macrobody. BOX is 9 or 12; RHP/HEX is 9 or 15; RCC is 7.',
    'mcnp.zaid': 'Use ZAAA.TTc (for example 92235.80c). There is no class letter j. .80c is ENDF/B-VII.1, not VIII.0.',
    'mcnp.density-sign': 'On a cell card, negative density is g/cm³ and positive is atoms/barn-cm. Pick one and keep the sign consistent with the units you meant.',
    'mcnp.material-sign': 'On an M card, positive fractions are atom fraction and negative are weight fraction. Do not mix signs in one material. Keyword entries such as NLIB= are not fractions — they belong on M0 or after the nuclides.',
    'mcnp.cell-imp': 'Give every cell an importance (imp:n=1 inside the problem, imp:n=0 on the complement). A missing graveyard is a fatal MCNP error.',
    'mcnp.mt-missing-material': 'The MT card number must match an M card. Write M4 … then MT4 lwtr.20t, not MT4 on a material that does not exist.',
    'mcnp.sab-no-target': 'An S(α,β) table only affects the nuclide it is built for. Put lwtr on a material that contains hydrogen; GRPH on carbon. A table whose target is absent is silently ignored.',
    'mcnp.short-continuation': 'A continuation line must start with five or more blanks (or end the previous line with &). A short indent is a new card.',
    'mcnp.line-length': 'Characters past the card-image limit are ignored. Shorten the line, or set OWEN: Toggle MCNP Line Limit to 128 (MCNP 6.2+) / add `c owen: line-limit=128` on one of the first 10 lines.',
    'mcnp.lattice-fill-origin': 'The fill array origin and the lattice window must describe the same region. If the window is −8:8, the fill indices must be −8:8 as well, not 0:16.',
    'mcnp.lattice-index-direction': 'List the +x plane first, then −x, then +y, then −y (for example −51 50 −53 52 when 50 is −x and 51 is +x). MCNP puts element (1,0,0) beyond the first listed surface (§5.5.5); listing −x first rotates the map 180°.',
    'mcnp.undefined-surface': 'Define that surface id on a surface card in this file (or in a READ include), or drop it from the cell region.',
    'mcnp.undefined-material': 'Add an M card with that number, or change the cell to a material that exists. Material 0 is void — only on a cell card.',
    'mcnp.undefined-universe': 'A cell must declare u=N before another cell can fill with N. Add the universe cells, or correct the fill= id.',
    'mcnp.undefined-transform': 'Add a TR card with that number, or remove trcl= / the surface transform.',
    'mcnp.duplicate-surface': 'Two cards share a surface id. Renumber one of them and update every cell that used the old id.',
    'mcnp.duplicate-cell': 'Two cards share a cell id. Renumber one of them.',
    'mcnp.duplicate-material': 'Two M cards share a number. Renumber one of them and update cells and MT cards.',
    'mcnp.duplicate-universe': 'Two cells claim the same u= id as a definition conflict across files. Keep one definition.',
    'mcnp.duplicate-transform': 'Two TR cards share a number. Renumber one of them.',
    'mcnp.unused-surface': 'Nothing references this surface. Delete it, or use it in a cell — unused input is harmless but usually a leftover.',
    'mcnp.unused-material': 'No cell uses this M card. Delete it or point a cell at it. M0 (NLIB=) is a default-library card, not unused void.',
    'mcnp.unused-universe': 'No fill= points at this universe. Delete the u= cells or fill with them.',
    'mcnp.unused-transform': 'No trcl=/TR= uses this transform. Delete the TR card or apply it.',
    'mcnp.include-not-found': 'The READ target is missing on disk. Check the filename (MCNP accepts `read file = foo.i` with spaces around =). Path is resolved next to the deck that contains the READ card.',
    'mcnp.include-cycle': 'A READ chain loops back to a file already open. Break the cycle — A must not read B if B reads A.',
    'mcnp.include-depth': 'Too many nested READ cards. Flatten the includes or raise the nesting only if you truly need more than 32 levels.',
    'openmc.source': 'Replace openmc.Source(...) with openmc.IndependentSource(...). Source still exists as a deprecation shim; IndependentSource is the current name.',
    'openmc.rectprism': 'Use the class openmc.model.RectangularPrism(width=..., height=...). The old rectangular_prism() function returned an already-negated region; the class returns a surface, so the cell region needs a minus sign.',
    'openmc.sab-name': 'OpenMC thermal names are c_H_in_H2O, c_Graphite, … — not MCNP lwtr.20t. Check openmc.data.thermal.',
    'openmc.density-units': 'set_density takes a unit string such as "g/cm3" or "atom/b-cm", then the number. Swap the arguments if they are reversed.',
    'openmc.exec-kwargs': 'Pass threads to model.run(threads=N). openmc_exec_kwargs is gone.',
    'openmc.run-return': 'model.run() returns a Path, not a StatePoint. Open it with openmc.StatePoint(path).',
    'serpent.surf-rect': 'Write `surf id cuboid xmin xmax ymin ymax zmin zmax`. `rect` is not a Serpent surface type.',
    'serpent.trcl': 'Serpent rotations are `trans s <surf> …` or `trans u <uni> …`, not MCNP trcl.',
    'serpent.set-omp': 'Threading is a command-line flag: `sss2 -omp N deck.serp`. There is no `set omp` card.',
    'serpent.egrid-units': 'Serpent energy grids are in MeV. A thermal cut at 0.625 eV is 0.625E-6, not 0.625.',
    'scone.non-ascii': 'SCONE input is ASCII. Replace smart quotes, en-dashes, and non-breaking spaces with plain characters.',
    'scone.ace-typo': 'The handle type is aceNeutronDatabase (Neutron), not aceNuclearDatabase.',
    'scone.pin-len': 'pinUniverse radii and fills must be the same length. The outermost fill has radius 0.0.',
    'scone.pin-outer': 'The last radius in a pinUniverse must be 0.0 — that fill is the outside of the pin.',
    'scone.temp-zaid': 'The ZAID temperature suffix must match temp. temp 600 goes with .06; temp 300 with .03.',
    'scone.semicolon': 'Every SCONE assignment ends with a semicolon: `key value;`.',
    'workspace.missing-file': 'Put materials.xml, geometry.xml and settings.xml in this folder (or one model.xml). OpenMC will not run on a partial set.',
    'workspace.unknown-material': 'The cell names a material id that no <material> (or M/mat card) defines. Add the material or correct the id.',
    'workspace.unknown-surface': 'The region names a surface that is not defined. Add the surface or correct the id.',
    'workspace.unknown-universe': 'A fill/lattice points at a universe no cell declares. Declare the universe or correct the fill.',
    'workspace.unknown-cell': 'A filter, source constraint, or cellUniverse lists a cell id that does not exist. Renumber to match geometry.',
    'workspace.unknown-filter': 'The tally references a filter id that is not defined in tallies.xml. Add the filter or drop the reference.',
    'workspace.unknown-mesh': 'entropy_mesh or a mesh filter names a mesh that is not defined. Add the <mesh> or correct the id.',
    'workspace.unknown-therm': 'The material names a thermal scattering table that no therm card defines. Add the therm card.',
    'workspace.tally-nuclide-absent': 'The tally scores a nuclide that is in no material, so the score is identically zero. Add the nuclide or remove it from the tally.',
    'workspace.tally-no-scores': 'Add a <scores> list to that tally (flux, fission, …).',
    'workspace.no-source': 'fixed source mode needs a <source>. Add one, or switch run_mode to eigenvalue.',
    'workspace.no-fissile': 'Eigenvalue mode needs a fissionable nuclide in some material (U-235, Pu-239, …).',
    'workspace.no-pop': 'Add `set pop <neutrons> <active> <inactive>` so Serpent knows the cycle counts.',
    'workspace.no-root': 'SCONE needs a rootUniverse in universes { }. That is the starting fill.',
    'workspace.inactive-ge-batches': 'inactive must be less than batches. Raise batches or lower inactive.',
    'workspace.model-xml-disagrees': 'When model.xml exists, OpenMC runs that file and ignores the others. Export again, or delete model.xml if the split files are the ones you edit.',
    'workspace.model-xml-stale': 'The split XML files are newer than model.xml. Re-export the model so the file OpenMC actually runs matches what you edited.',
    'workspace.geometry-sample': 'Run OWEN: Check Geometry for the overlap/gap report. A quick sample only proves there is a problem, not where every leak is.',
    'workspace.geometry-shadowed': 'SCONE keeps the first listed cell that contains a point. Reorder cells or split the regions if the later cell was supposed to be reachable.',
    'workspace.include-missing': 'The include/READ path does not exist next to the deck. Fix the filename or move the file.',
    'workspace.library-missing': 'That ACE / xsdir path is not on this machine. Point it at your library, or ignore the warning if the path is for another host (WSL).',
    'workspace.cross-sections-missing': 'OPENMC_CROSS_SECTIONS / the path in the deck does not exist here. Set it to a real cross_sections.xml.',
    'workspace.import-unresolved': 'That import is not next to this deck. Put the module in the same folder or install the package.',
    'workspace.export-stale': 'Re-run the Python deck (or export_to_xml) before trusting the XML siblings — Render with OpenMC reads the .py, not stale XML.',
    'workspace.unused-filter': 'No tally uses this filter. Delete it or attach it.',
    'workspace.unused-material': 'No cell uses this material. Delete it or fill a cell with it.',
    'workspace.unused-surface': 'No region uses this surface. Delete it or use it.',
};

export function solutionFor(code: string, message: string): string {
    if (SOLUTIONS[code]) return SOLUTIONS[code];
    const dash = message.split(/\s+[—–-]\s+/);
    if (dash.length > 1) return dash.slice(1).join(' — ').trim();
    return 'Change the flagged text as the message describes, then run Validate Input File again.';
}
