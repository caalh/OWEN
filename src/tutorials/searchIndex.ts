import * as vscode from 'vscode';

export interface SearchEntry {
    id: string;
    title: string;
    description: string;
    path: string;
    category: string;
    keywords?: string[];
}

interface SearchIndexFile {
    version: number;
    generated?: string;
    count?: number;
    entries: SearchEntry[];
}

function scoreEntry(item: SearchEntry, term: string): number {
    const t = term.toLowerCase().trim();
    if (!t) return 0;

    const title = item.title.toLowerCase();
    const desc = item.description.toLowerCase();
    const cat = item.category.toLowerCase();
    const kw = (item.keywords ?? []).join(' ').toLowerCase();
    const blob = `${title} ${desc} ${cat} ${kw}`;

    const tokens = t.split(/\s+/).filter(Boolean);
    if (tokens.length > 1 && !tokens.every((tok) => blob.includes(tok))) return 0;

    let score = 0;
    if (title === t) score += 120;
    else if (title.startsWith(t)) score += 90;
    else if (title.includes(t)) score += 65;

    for (const tok of tokens) {
        if (item.keywords?.some((k) => k.includes(tok))) score += 45;
        if (title.includes(tok)) score += 35;
        if (desc.includes(tok)) score += 20;
        if (cat.includes(tok)) score += 12;
    }

    return score;
}

export function filterEntries(entries: SearchEntry[], term: string, limit = 24, category?: string): SearchEntry[] {
    const q = term.trim();
    let pool = entries;
    if (category && category !== 'all') {
        pool = pool.filter((e) => e.category.toLowerCase().includes(category.toLowerCase()));
    }
    if (!q) {
        return pool.slice(0, limit);
    }
    return pool
        .map((item) => ({ item, score: scoreEntry(item, q) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
        .slice(0, limit)
        .map(({ item }) => item);
}

export function siteBaseUrl(cfg: vscode.WorkspaceConfiguration): string {
    const endpoint = cfg.get<string>('nrdp.endpoint', 'https://reactormc.net/data');
    try {
        return new URL(endpoint).origin || 'https://reactormc.net';
    } catch {
        return 'https://reactormc.net';
    }
}

async function readBundledIndex(extensionUri: vscode.Uri): Promise<SearchEntry[]> {
    const uri = vscode.Uri.joinPath(extensionUri, 'data', 'search-index.json');
    const bytes = await vscode.workspace.fs.readFile(uri);
    const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as SearchIndexFile;
    return Array.isArray(parsed.entries) ? parsed.entries : [];
}

async function fetchLiveIndex(baseUrl: string): Promise<SearchEntry[] | null> {
    const url = `${baseUrl.replace(/\/+$/, '')}/data/search-index.json`;
    try {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) return null;
        const parsed = (await res.json()) as SearchIndexFile;
        return Array.isArray(parsed.entries) ? parsed.entries : null;
    } catch {
        return null;
    }
}

export async function loadSearchIndex(
    extensionUri: vscode.Uri,
    cfg: vscode.WorkspaceConfiguration,
): Promise<{ entries: SearchEntry[]; source: 'live' | 'bundled' }> {
    const bundled = await readBundledIndex(extensionUri);
    if (!cfg.get<boolean>('nrdp.live', true)) {
        return { entries: bundled, source: 'bundled' };
    }
    const live = await fetchLiveIndex(siteBaseUrl(cfg));
    if (live && live.length >= bundled.length * 0.5) {
        return { entries: live, source: 'live' };
    }
    return { entries: bundled, source: 'bundled' };
}

export function guessCategoryFromDocument(doc: vscode.TextDocument | undefined): string | undefined {
    if (!doc) return undefined;
    const lang = doc.languageId;
    if (lang === 'mcnp') return 'MCNP';
    if (lang === 'openmc') return 'OpenMC';
    if (lang === 'serpent') return 'Serpent';
    if (lang === 'scone') return 'SCONE';
    return undefined;
}

export function uniqueCategories(entries: SearchEntry[]): string[] {
    const set = new Set<string>();
    for (const e of entries) {
        const top = e.category.split(' · ')[0]?.trim();
        if (top) set.add(top);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
}
