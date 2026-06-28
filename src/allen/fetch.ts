export interface AllenCurve {
    E: number[];
    xs: number[];
    nuclide: string;
    reaction: string;
    mt: number;
    library: string;
    temperature_K: number;
    unit: string;
}

export interface AllenNuclideManifest {
    temperatures: number[];
    reactions: string[];
}

export interface AllenIndex {
    name?: string;
    fullName?: string;
    version?: string;
    library: string;
    libraryKey: string;
    energyUnit: string;
    xsUnit: string;
    Emin: number;
    Emax: number;
    nuclides: Record<string, AllenNuclideManifest>;
    reactions?: string[];
    attribution?: string;
    gaps: Array<{
        nuclide: string;
        reaction?: string;
        temperature_K?: number;
        reason: string;
    }>;
}

export function allenDataBaseUrl(config: { get: <T>(key: string) => T | undefined }): string {
    const url = config.get<string>('owen.allen.dataBaseUrl');
    return (url ?? 'https://reactormc.net/data/allen').replace(/\/+$/, '');
}

export async function fetchAllenIndex(baseUrl: string): Promise<AllenIndex> {
    const res = await fetch(`${baseUrl}/index.json`);
    if (!res.ok) {
        throw new Error(`Failed to load ALLEN index (${res.status})`);
    }
    return (await res.json()) as AllenIndex;
}

export function allenCurveUrl(
    baseUrl: string,
    libraryKey: string,
    nuclide: string,
    reaction: string,
    tempK: number,
): string {
    return `${baseUrl}/${libraryKey}/${nuclide}/${reaction}_${tempK}K.json`;
}

export async function fetchAllenCurve(
    baseUrl: string,
    libraryKey: string,
    nuclide: string,
    reaction: string,
    tempK: number,
): Promise<AllenCurve | null> {
    const url = allenCurveUrl(baseUrl, libraryKey, nuclide, reaction, tempK);
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
    return (await res.json()) as AllenCurve;
}

export function nuclideAvailable(
    index: AllenIndex,
    nuclide: string,
    reaction: string,
    tempK: number,
): boolean {
    const n = index.nuclides[nuclide];
    if (!n) return false;
    return n.temperatures.includes(tempK) && n.reactions.includes(reaction);
}

export function formatNuclideLabel(name: string): string {
    const m = name.match(/^([A-Z][a-z]?)(\d+)$/);
    if (m) return `${m[1]}-${m[2]}`;
    return name;
}

export const ALLEN_REACTIONS = [
    { slug: 'total', label: 'Total (MT=1)', color: '#94a3b8' },
    { slug: 'elastic', label: 'Elastic (MT=2)', color: '#38bdf8' },
    { slug: 'fission', label: 'Fission (MT=18)', color: '#f97316' },
    { slug: 'capture', label: 'Capture (MT=102)', color: '#a855f7' },
    { slug: 'n2n', label: '(n,2n) (MT=16)', color: '#22c55e' },
    { slug: 'inelastic', label: 'Inelastic (MT=4)', color: '#eab308' },
] as const;
