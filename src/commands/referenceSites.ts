// Primary reference websites for the codes OWEN edits.
//
// Deliberately short and authoritative: the upstream developers' own manual or
// documentation for each code, the nuclear-data services those manuals send you
// to, and ReactorMC's own teaching material. This is not a link farm — every
// entry is a place a professional would actually go to settle a question about
// a card, and every URL was checked to resolve before it shipped (2026-08-29).
//
// No `vscode` import: the ordering logic is unit tested headlessly, and the
// command in `openReference.ts` is the only part that touches the editor.

import type { MonteCarloLanguage } from '../util/detectLanguage';

/** Which code a reference belongs to; `general` applies to all of them. */
export type ReferenceScope = MonteCarloLanguage | 'phits' | 'general';

export interface ReferenceSite {
    scope: ReferenceScope;
    label: string;
    /** One line on what this is actually for, shown as QuickPick detail. */
    description: string;
    url: string;
    /** Upstream's canonical entry point for that code, sorted to the top. */
    primary?: boolean;
}

export const SCOPE_LABELS: Record<ReferenceScope, string> = {
    mcnp: 'MCNP',
    openmc: 'OpenMC',
    serpent: 'Serpent',
    scone: 'SCONE',
    phits: 'PHITS',
    general: 'Nuclear data & ReactorMC',
};

export const REFERENCE_SITES: ReferenceSite[] = [
    {
        scope: 'mcnp',
        label: 'MCNP Theory & User Manuals',
        description: 'LANL manual index — 6.3.2, 6.3.1 (LA-UR-24-24602) and earlier, as PDFs',
        url: 'https://mcnp.lanl.gov/manual.html',
        primary: true,
    },
    {
        scope: 'mcnp',
        label: 'MCNP website',
        description: 'Release notes, build guide, data libraries, mcnp_help@lanl.gov',
        url: 'https://mcnp.lanl.gov/',
    },
    {
        scope: 'openmc',
        label: 'OpenMC documentation',
        description: 'Python API reference, user guide, methods, examples',
        url: 'https://docs.openmc.org/',
        primary: true,
    },
    {
        scope: 'openmc',
        label: 'OpenMC nuclear data libraries',
        description: 'Pre-generated HDF5 libraries (ENDF/B-VII.1, VIII.0, JEFF, …)',
        url: 'https://openmc.org/data/',
    },
    {
        scope: 'openmc',
        label: 'OpenMC discussion forum',
        description: 'Discourse — where the developers answer usage questions',
        url: 'https://openmc.discourse.group/',
    },
    {
        scope: 'openmc',
        label: 'OpenMC source (GitHub)',
        description: 'openmc-dev/openmc — issues, releases, the code itself',
        url: 'https://github.com/openmc-dev/openmc',
    },
    {
        scope: 'serpent',
        label: 'Serpent documentation',
        description: 'VTT on-line docs — the current manual; supersedes the wiki',
        url: 'https://serpent.vtt.fi/docs/',
        primary: true,
    },
    {
        scope: 'serpent',
        label: 'Serpent Wiki (legacy)',
        description: 'Still the fullest card reference, but no longer updated by VTT',
        url: 'https://serpent.vtt.fi/mediawiki/index.php?title=Main_Page',
    },
    {
        scope: 'serpent',
        label: 'Serpent project website',
        description: 'Distribution and licensing (VTT, OECD/NEA Data Bank, RSICC)',
        url: 'https://serpent.vtt.fi/',
    },
    {
        scope: 'scone',
        label: 'SCONE documentation',
        description: 'Read the Docs — input dictionary, physics packages, tallies',
        url: 'https://scone.readthedocs.io/',
        primary: true,
    },
    {
        scope: 'scone',
        label: 'SCONE source (GitHub)',
        description: 'CambridgeNuclear/SCONE — the Fortran the docs describe',
        url: 'https://github.com/CambridgeNuclear/SCONE',
    },
    {
        scope: 'phits',
        label: 'PHITS website',
        description: 'JAEA — manual, licence request, updates',
        url: 'https://phits.jaea.go.jp/',
        primary: true,
    },
    {
        scope: 'general',
        label: 'ENDF at NNDC',
        description: 'Evaluated data, plots and MT reaction numbers (Brookhaven)',
        url: 'https://www.nndc.bnl.gov/endf/',
    },
    {
        scope: 'general',
        label: 'IAEA Nuclear Data Services',
        description: 'ENDF/B, JEFF, JENDL, TENDL libraries and retrieval tools',
        url: 'https://www-nds.iaea.org/',
    },
    {
        scope: 'general',
        label: 'JANIS (OECD/NEA)',
        description: 'Cross-section browser for comparing evaluations',
        url: 'https://www.oecd-nea.org/janis/',
    },
    {
        scope: 'general',
        label: 'ReactorMC tutorials',
        description: 'Guides for all four codes, plus the Rosetta Stone comparison',
        url: 'https://reactormc.net/',
    },
    {
        scope: 'general',
        label: 'ALLEN σ(E) explorer',
        description: 'Cross-section plots with Doppler Studio, same data as OWEN',
        url: 'https://reactormc.net/nrdp/allen/',
    },
];

/**
 * Reference list ordered for the code the user is looking at: that code's own
 * sites first (its canonical manual at the very top), then the shared
 * data/teaching links, then the other codes so a converter user can still
 * reach them. `null` means no deck is open — everything, in declaration order.
 */
export function orderedReferenceSites(
    active: MonteCarloLanguage | 'phits' | null,
): ReferenceSite[] {
    const rank = (s: ReferenceSite): number => {
        // Nothing open: leave the list alone. Floating the data services above
        // the manuals would bury exactly what someone opening this wants.
        if (!active) return 0;
        if (s.scope === active) return s.primary ? 0 : 1;
        if (s.scope === 'general') return 2;
        return 3;
    };
    return REFERENCE_SITES.map((site, i) => ({ site, i }))
        .sort((a, b) => rank(a.site) - rank(b.site) || a.i - b.i)
        .map((x) => x.site);
}
