// SCONE results reader.
//
// SCONE writes one file per run through its `outputFile` printer. The default
// printer is asciiMATLAB, whose rules come straight from
// SCONE/UserInterface/fileOutput/asciiMATLAB_class.f90:
//   * one entry per line, always terminated with `;`
//   * block nesting is flattened into the variable name with `_` separators
//   * rank-1 arrays print as `[ a,b,c]`
//   * higher-rank arrays print as `reshape([ … ],n1,n2,…)`
//   * character values print as `{'text'}`
// A result (mean plus standard deviation) is written by outputFile::printResult
// as a two-element array, and clerk result arrays gain a leading dimension of
// two — `<clerk>_Res = reshape([m1,s1,m2,s2,…],2,…)`.
//
// Entry names that matter, from the clerks themselves:
//   keffAnalogClerk   → <clerk>_k_analog
//   keffImplicitClerk → <clerk>_K_EFF, plus IMP_PROD, IMP_ABS, SCATTER_PROD,
//                       ANA_LEAK
//   eigenPhysicsPackage → seed, pop, Inactive_Cycles, Active_Cycles,
//                       Total_CPU_Time, Total_Transport_Time, and an
//                       `inactive_` prefixed copy of the inactive tally
//
// Console output (tallyClerk::display) prints `k-eff (analog):  1.00123 +/-
// 0.00456` once per cycle, which is where a convergence series comes from.
//
// SCONE reports absolute standard deviations; OWEN carries relative errors, so
// results are converted on the way in.
import * as fs from 'fs';
import type { RunResults, KeffHistory, TallyEntry, TallyBin, FluxSpectrum } from '../types';

const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][-+]?\d+)?`;

interface SconeEntry {
    name: string;
    numbers: number[];
    strings: string[];
    shape?: number[];
}

function parseNumberList(body: string): number[] {
    return body
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((t) => parseFloat(t.replace(/[dD]/, 'e')))
        .filter((v) => Number.isFinite(v));
}

function parseMatlabEntries(text: string): SconeEntry[] {
    const out: SconeEntry[] = [];
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('%')) continue;
        const m = /^([A-Za-z_]\w*)\s*=\s*([\s\S]*?);?\s*$/.exec(line);
        if (!m) continue;
        const name = m[1];
        const body = m[2].trim();

        const reshape = /^reshape\(\s*\[([\s\S]*?)\]\s*,\s*([\d\s,]+)\)$/.exec(body);
        if (reshape) {
            const strings = [...reshape[1].matchAll(/\{'([^']*)'\}/g)].map((x) => x[1]);
            out.push({
                name,
                numbers: strings.length ? [] : parseNumberList(reshape[1]),
                strings,
                shape: parseNumberList(reshape[2]),
            });
            continue;
        }
        if (body.startsWith('[')) {
            const inner = body.replace(/^\[/, '').replace(/\]$/, '');
            const strings = [...inner.matchAll(/\{'([^']*)'\}/g)].map((x) => x[1]);
            out.push({ name, numbers: strings.length ? [] : parseNumberList(inner), strings });
            continue;
        }
        const single = /^\{'([^']*)'\}$/.exec(body);
        if (single) {
            out.push({ name, numbers: [], strings: [single[1]] });
            continue;
        }
        const nums = parseNumberList(body);
        if (nums.length) out.push({ name, numbers: nums, strings: [] });
    }
    return out;
}

/** SCONE can also be asked for JSON output; flatten it to the same entries. */
function parseJsonEntries(text: string): SconeEntry[] {
    let root: unknown;
    try {
        root = JSON.parse(text);
    } catch {
        return [];
    }
    const out: SconeEntry[] = [];
    const walk = (node: unknown, prefix: string) => {
        if (node == null) return;
        if (Array.isArray(node)) {
            const numbers = node.filter((v): v is number => typeof v === 'number');
            const strings = node.filter((v): v is string => typeof v === 'string');
            if (numbers.length || strings.length) out.push({ name: prefix, numbers, strings });
            return;
        }
        if (typeof node === 'number') {
            out.push({ name: prefix, numbers: [node], strings: [] });
            return;
        }
        if (typeof node === 'string') {
            out.push({ name: prefix, numbers: [], strings: [node] });
            return;
        }
        if (typeof node === 'object') {
            for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
                walk(v, prefix ? `${prefix}_${k}` : k);
            }
        }
    };
    walk(root, '');
    return out;
}

const META_NUM: Record<string, string> = {
    pop: 'population',
    Inactive_Cycles: 'inactiveCycles',
    Active_Cycles: 'activeCycles',
    Total_CPU_Time: 'cpuSeconds',
    Total_Transport_Time: 'transportSeconds',
    seed: 'seed',
};

const RE_KEFF_ENTRY = /(?:^|_)(k_analog|K_EFF|k_eff|k_imp)$/;

export function looksLikeSconeOutput(text: string): boolean {
    const head = text.slice(0, 20000);
    if (/(^|\n)\s*(Inactive_Cycles|Active_Cycles|Total_Transport_Time)\s*=/.test(head)) return true;
    if (/_k_analog\s*=|_K_EFF\s*=/.test(head)) return true;
    return /k-eff \((analog|implicit)\):/.test(head);
}

function relativeError(mean: number, std: number): number | undefined {
    if (!Number.isFinite(mean) || !Number.isFinite(std) || mean === 0) return undefined;
    return Math.abs(std / mean);
}

/** Labels for a clerk's result bins, from whichever map the clerk printed. */
function binLabels(entries: SconeEntry[], clerk: string, count: number): string[] | undefined {
    const prefix = `${clerk}_`;
    for (const e of entries) {
        if (!e.name.startsWith(prefix)) continue;
        const tail = e.name.slice(prefix.length);
        if (tail === 'Res') continue;
        if (e.strings.length === count) return e.strings.map((s) => `${tail} ${s}`);
        // Bin-boundary maps print as reshape([lo1,hi1,…],2,N).
        if (e.shape && e.shape.length === 2 && e.shape[0] === 2 && e.shape[1] === count && e.numbers.length >= 2 * count) {
            return Array.from({ length: count }, (_, i) => {
                const lo = e.numbers[2 * i];
                const hi = e.numbers[2 * i + 1];
                return `${tail} ${lo}–${hi}`;
            });
        }
    }
    return undefined;
}

export function parseSconeOutput(text: string, sourceFile?: string): RunResults {
    const trimmed = text.trimStart();
    const entries = trimmed.startsWith('{') ? parseJsonEntries(text) : parseMatlabEntries(text);
    const tallies: TallyEntry[] = [];
    const spectra: FluxSpectrum[] = [];
    const notes: string[] = [];
    const metadata: Record<string, string | number> = {};

    for (const e of entries) {
        const key = META_NUM[e.name];
        if (key && e.numbers.length >= 1) metadata[key] = e.numbers[0];
    }

    // k-eff from the output file: the active-cycle entry wins over `inactive_`.
    let final: { mean: number; std: number } | undefined;
    let finalName: string | undefined;
    for (const e of entries) {
        if (!RE_KEFF_ENTRY.test(e.name) || e.numbers.length < 1) continue;
        const isInactive = /(^|_)inactive_/i.test(e.name);
        const candidate = { mean: e.numbers[0], std: e.numbers[1] ?? 0 };
        if (!Number.isFinite(candidate.mean)) continue;
        if (!final || (isInactive === false && /inactive/i.test(finalName ?? ''))) {
            final = candidate;
            finalName = e.name;
        }
        tallies.push({
            id: e.name,
            label: e.name,
            value: candidate.mean,
            error: relativeError(candidate.mean, candidate.std),
            checks: 'unknown',
        });
    }
    if (finalName) metadata.keffEntry = finalName;

    // Cycle-wise k-eff from console output.
    const cycles: number[] = [];
    const mean: number[] = [];
    const std: number[] = [];
    const displayRe = new RegExp(String.raw`k-eff \((analog|implicit)\):\s*(${NUM})\s*\+\/-\s*(${NUM})`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = displayRe.exec(text)) !== null) {
        const k = parseFloat(m[2]);
        const s = parseFloat(m[3]);
        if (!Number.isFinite(k)) continue;
        cycles.push(cycles.length + 1);
        mean.push(k);
        std.push(Number.isFinite(s) ? s : 0);
    }
    const cycleHeader = /Cycle:\s*(\d+)\s*of\s*(\d+)/.exec(text);
    if (cycleHeader) metadata.cyclesReported = `${cycleHeader[1]} of ${cycleHeader[2]}`;

    let keff: KeffHistory | undefined;
    if (mean.length > 0) {
        keff = {
            cycles,
            mean,
            std,
            final: final ?? { mean: mean[mean.length - 1], std: std[std.length - 1] },
            inactive: typeof metadata.inactiveCycles === 'number' ? metadata.inactiveCycles : undefined,
        };
    } else if (final) {
        keff = { cycles: [1], mean: [final.mean], std: [final.std], final };
        notes.push('SCONE writes only the final k-eff to its output file; a convergence series needs the console log.');
    }

    // Clerk result arrays: reshape([m1,s1,…],2,…)
    for (const e of entries) {
        if (!/_Res$/.test(e.name) && e.name !== 'Res') continue;
        const clerk = e.name.replace(/_?Res$/, '');
        const pairs = Math.floor(e.numbers.length / 2);
        if (pairs < 1) continue;
        const bins: TallyBin[] = [];
        for (let i = 0; i < pairs; i++) {
            const value = e.numbers[2 * i];
            const sd = e.numbers[2 * i + 1];
            bins.push({ label: `bin ${i + 1}`, value, error: relativeError(value, sd) });
        }
        const labels = binLabels(entries, clerk, pairs);
        if (labels) labels.forEach((l, i) => (bins[i].label = l));

        tallies.push({
            id: clerk || e.name,
            label: `${clerk || e.name}${pairs > 1 ? ` (${pairs} bins)` : ''}`,
            value: pairs === 1 ? bins[0].value : bins.reduce((s, b) => s + b.value, 0),
            error: pairs === 1 ? bins[0].error : undefined,
            bins: pairs > 1 ? bins : undefined,
            note: pairs > 1 ? 'Value shown is the sum over all bins.' : undefined,
            checks: 'unknown',
        });

        // An energy map gives a real spectrum.
        const energy = entries.find(
            (x) =>
                x.name.startsWith(`${clerk}_`) &&
                /energy/i.test(x.name.slice(clerk.length + 1)) &&
                x.shape?.length === 2 &&
                x.shape[0] === 2 &&
                x.shape[1] === pairs,
        );
        if (energy) {
            const E: number[] = [];
            const phi: number[] = [];
            for (let i = 0; i < pairs; i++) {
                const lo = energy.numbers[2 * i];
                const hi = energy.numbers[2 * i + 1];
                if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
                E.push(Math.sqrt(Math.max(lo, 1e-12) * Math.max(hi, 1e-12)));
                phi.push(bins[i].value);
            }
            if (E.length >= 3) spectra.push({ label: `${clerk} spectrum`, E, phi, unit: 'per source particle' });
        }
    }

    if (entries.length === 0 && mean.length === 0) {
        notes.push('Nothing recognisable in this file. SCONE output is asciiMATLAB (`.m`) or JSON.');
    }

    return {
        code: 'scone',
        sourceFile,
        keff,
        spectra,
        tallies,
        meshTallies: [],
        metadata,
        notes: notes.length ? notes : undefined,
    };
}

export function parseSconeFile(filePath: string): RunResults {
    return parseSconeOutput(fs.readFileSync(filePath, 'utf8'), filePath);
}
