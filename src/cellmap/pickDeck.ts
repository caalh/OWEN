/**
 * Which open document the Cell Map reads.
 *
 * The active editor wins when it is a deck. The rest of the chain exists
 * because a floating (auxiliary) window has no active text editor: VS Code
 * reports `activeTextEditor` as undefined the moment focus leaves the main
 * window, and the map rendered "0 cells - open a Monte Carlo deck" without a
 * fallback even though the deck was sitting right there.
 */
export interface DeckDoc {
    /** Stable identity, i.e. `uri.toString()`. */
    readonly key: string;
    /** True when the document is MCNP, OpenMC, Serpent or SCONE. */
    readonly mapped: boolean;
}

export function pickDeck<T extends DeckDoc>(opts: {
    active?: T;
    /** Key of the deck the map was opened on. */
    remembered?: string;
    visible?: readonly T[];
    open: readonly T[];
}): T | undefined {
    if (opts.active?.mapped) return opts.active;
    if (opts.remembered) {
        const hit = opts.open.find((d) => d.key === opts.remembered);
        if (hit) return hit;
    }
    return opts.visible?.find((d) => d.mapped) ?? opts.open.find((d) => d.mapped);
}

/** One editor group as the reveal logic sees it. */
export interface RevealGroup {
    /** `TabGroup.viewColumn`; auxiliary windows continue the numbering. */
    readonly column: number;
    /** A tab in this group shows the deck being mapped. */
    readonly hasDeck: boolean;
    /** The Cell Map webview itself lives in this group. */
    readonly hasMap: boolean;
}

/**
 * Where a click in the map should reveal the deck.
 *
 * The deck's own tab, wherever it is, always wins — that is the whole point
 * ("take me to the card"), and it is what stops a floating map from opening a
 * second copy of the file in its own window. Otherwise the first group that is
 * not the map's; groups are listed main window first, so a docked map never
 * gets covered. `undefined` means every group holds the map (a lone panel in
 * an aux window): the caller opens beside it.
 */
export function pickRevealColumn(groups: readonly RevealGroup[]): number | undefined {
    const deck = groups.find((g) => g.hasDeck);
    if (deck) return deck.column;
    return groups.find((g) => !g.hasMap)?.column;
}
