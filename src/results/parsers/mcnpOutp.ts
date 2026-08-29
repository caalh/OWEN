// Parser for the MCNP text output file (outp) — the file every MCNP run writes,
// named `outp` by default, `<prefix>o` with `n=`, or whatever `o=` says.
//
// Written against real MCNP 6 output (LANL MCNP 6.2, ld=02/20/18) rather than
// from the manual: the fixed-source and criticality layouts here were read off
// production output files. Section titles used as anchors:
//   `1tally       14        nps =  ...`      per-tally results
//   `1status of the statistical checks ...`  10-check verdict per tally
//   `1tally fluctuation charts`              convergence history per tally
// Numbers inside a tally block are only accepted while a bin context (cell,
// surface, multiplier, energy) is open, which keeps the confidence-interval and
// "value at nps+1" tables from being mistaken for results.
import * as fs from 'fs';
import type { RunResults, TallyEntry, TallyBin, FluxSpectrum, KeffHistory } from '../types';

const N = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][-+]?\d+)?`;
const RE_NUM = new RegExp(`^${N}$`);

function num(tok: string): number {
    // MCNP can emit Fortran D exponents.
    return parseFloat(tok.replace(/[dD]/, 'e'));
}

function tokens(line: string): string[] {
    return line.trim().split(/\s+/).filter(Boolean);
}

function allNumeric(toks: string[]): boolean {
    return toks.length > 0 && toks.every((t) => RE_NUM.test(t));
}

function plausibleError(v: number): boolean {
    return Number.isFinite(v) && v >= 0 && v <= 2;
}

interface OutpTallyBlock {
    id: string;
    type?: number;
    typeText?: string;
    particles?: string;
    nps?: number;
    bins: TallyBin[];
    spectrum?: { E: number[]; phi: number[]; err: number[] };
}

const RE_TALLY_HEAD = new RegExp(String.raw`^1tally\s+(\d+)\s*(?:nps\s*=\s*(\d+))?`, 'i');
const RE_TALLY_TYPE = /^\s*tally type\s+(\d+)\s*(.*)$/i;
const RE_PARTICLES = /^\s*particle\(s\):\s*(.+)$/i;
const RE_CELL_BIN = /^\s{0,4}(cell|surface)\s+(\S.*?)\s*$/i;
const RE_MULT_BIN = /^\s*multiplier bin:\s*(.+)$/i;
const RE_USER_BIN = /^\s*(user|segment|cosine|time|energy) bin[:\s]*(.*)$/i;
const RE_ENERGY_HEAD = /^\s*energy\s*$/i;
const RE_VOLAREA = /^\s*(volumes|areas|masses)\s*$/i;
const RE_STOP_VALUES = /^(\s*=====|1analysis|\s*results of 10 statistical checks|\s*-+\s*estimated confidence intervals)/i;

/** Split the file into the tally result blocks, ignoring the diagnostic tables. */
function parseTallyBlocks(lines: string[]): OutpTallyBlock[] {
    const blocks: OutpTallyBlock[] = [];
    let cur: OutpTallyBlock | undefined;
    let binLabel = '';
    let energyMode = false;
    let collecting = false;
    let skipping = false;

    const flushSpectrumLabel = () => binLabel;

    for (const raw of lines) {
        const line = raw.replace(/\r$/, '');
        const head = RE_TALLY_HEAD.exec(line);
        if (head) {
            cur = { id: head[1], nps: head[2] ? parseInt(head[2], 10) : undefined, bins: [] };
            blocks.push(cur);
            binLabel = '';
            energyMode = false;
            collecting = true;
            skipping = false;
            continue;
        }
        if (!cur) continue;

        if (RE_STOP_VALUES.test(line)) {
            collecting = false;
            continue;
        }
        // A new page that is not a tally header ends the block's result region.
        if (line.startsWith('1')) collecting = false;
        if (!collecting) continue;

        const type = RE_TALLY_TYPE.exec(line);
        if (type) {
            cur.type = parseInt(type[1], 10);
            cur.typeText = type[2].trim().replace(/\.$/, '') || undefined;
            continue;
        }
        const parts = RE_PARTICLES.exec(line);
        if (parts) {
            cur.particles = parts[1].trim();
            continue;
        }
        if (RE_VOLAREA.test(line)) {
            // Volume/area listings are numbers too; skip until the next bin header.
            skipping = true;
            continue;
        }

        const cellBin = RE_CELL_BIN.exec(line);
        if (cellBin && !/:/.test(line)) {
            binLabel = `${cellBin[1].toLowerCase()} ${cellBin[2].trim()}`;
            energyMode = false;
            skipping = false;
            continue;
        }
        const mult = RE_MULT_BIN.exec(line);
        if (mult) {
            const detail = mult[1].trim().replace(/\s+/g, ' ');
            binLabel = binLabel ? `${binLabel} · mult ${detail}` : `mult ${detail}`;
            energyMode = false;
            skipping = false;
            continue;
        }
        const user = RE_USER_BIN.exec(line);
        if (user) {
            const kind = user[1].toLowerCase();
            if (kind === 'energy') {
                energyMode = true;
            } else {
                const detail = user[2].trim();
                binLabel = binLabel ? `${binLabel} · ${kind}${detail ? ' ' + detail : ''}` : kind;
            }
            skipping = false;
            continue;
        }
        if (RE_ENERGY_HEAD.test(line)) {
            energyMode = true;
            skipping = false;
            continue;
        }
        if (skipping) continue;

        const toks = tokens(line);
        if (toks.length === 0) continue;

        // "total   <mean> <relerr>" closes an energy-binned bin.
        if (/^total$/i.test(toks[0]) && toks.length >= 3 && allNumeric(toks.slice(1, 3))) {
            const mean = num(toks[1]);
            const err = num(toks[2]);
            if (Number.isFinite(mean) && plausibleError(err)) {
                cur.bins.push({ label: binLabel ? `${binLabel} · total` : 'total', value: mean, error: err });
            }
            energyMode = false;
            continue;
        }

        if (!allNumeric(toks)) continue;

        if (energyMode && toks.length === 3) {
            const e = num(toks[0]);
            const mean = num(toks[1]);
            const err = num(toks[2]);
            if (Number.isFinite(e) && Number.isFinite(mean) && plausibleError(err)) {
                cur.spectrum = cur.spectrum ?? { E: [], phi: [], err: [] };
                cur.spectrum.E.push(e * 1e6); // MCNP prints MeV; store eV
                cur.spectrum.phi.push(mean);
                cur.spectrum.err.push(err);
                cur.bins.push({
                    label: `${binLabel ? `${binLabel} · ` : ''}E<${toks[0]} MeV`,
                    value: mean,
                    error: err,
                });
            }
            continue;
        }

        if (toks.length === 2 && binLabel) {
            const mean = num(toks[0]);
            const err = num(toks[1]);
            if (Number.isFinite(mean) && plausibleError(err)) {
                cur.bins.push({ label: flushSpectrumLabel() || 'bin', value: mean, error: err });
            }
        }
    }

    return blocks;
}

interface CheckVerdict {
    checks: TallyEntry['checks'];
    note: string;
}

function parseStatisticalChecks(lines: string[]): Map<string, CheckVerdict> {
    const out = new Map<string, CheckVerdict>();
    let inSection = false;
    for (const raw of lines) {
        const line = raw.replace(/\r$/, '');
        if (/^1status of the statistical checks/i.test(line)) {
            inSection = true;
            continue;
        }
        if (!inSection) continue;
        if (/^1/.test(line)) break;
        const m = /^\s{2,}(\d+)\s{2,}(\S.*?)\s*$/.exec(line);
        if (!m) continue;
        const note = m[2].replace(/\s+/g, ' ');
        let checks: TallyEntry['checks'] = 'unknown';
        if (/no nonzero tallies/i.test(note)) checks = 'zero';
        else if (/^passed the 10 statistical checks/i.test(note)) checks = 'passed';
        else if (/missed|did not pass/i.test(note)) checks = 'missed';
        out.set(m[1], { checks, note });
    }
    return out;
}

interface TfcRow {
    x: number[];
    mean: number[];
    error: number[];
    fom: number[];
}

/**
 * Tally fluctuation charts: one column group of five numbers
 * (mean, error, vov, slope, fom) per tally, sharing the leading nps column.
 */
function parseTfc(lines: string[]): Map<string, TfcRow> {
    const out = new Map<string, TfcRow>();
    let inSection = false;
    let ids: string[] = [];
    for (const raw of lines) {
        const line = raw.replace(/\r$/, '');
        if (/^1tally fluctuation charts/i.test(line)) {
            inSection = true;
            continue;
        }
        if (!inSection) continue;
        if (/^1/.test(line)) break;

        const heads = [...line.matchAll(/tally\s+(\d+)/gi)].map((m) => m[1]);
        if (heads.length > 0) {
            ids = heads;
            for (const id of ids) if (!out.has(id)) out.set(id, { x: [], mean: [], error: [], fom: [] });
            continue;
        }
        if (/\bnps\b/i.test(line) && /\bmean\b/i.test(line)) continue;

        const toks = tokens(line);
        if (ids.length === 0 || toks.length !== 1 + 5 * ids.length || !allNumeric(toks)) continue;
        const nps = num(toks[0]);
        ids.forEach((id, k) => {
            const base = 1 + 5 * k;
            const row = out.get(id)!;
            row.x.push(nps);
            row.mean.push(num(toks[base]));
            row.error.push(num(toks[base + 1]));
            row.fom.push(num(toks[base + 4]));
        });
    }
    return out;
}

const RE_FINAL_KEFF = new RegExp(
    String.raw`final estimated (?:combined )?[a-z/\- ]*keff\s*=\s*(${N})\s+with an estimated standard deviation of\s*(${N})`,
    'i',
);

/**
 * k-eff from a KCODE run. The final combined-estimator line is read directly.
 * Cycle history is only taken when MCNP actually printed a cycle table
 * (`prdmp` / print table 175); its column layout is discovered from the header
 * row rather than assumed, so a run without that table yields no history
 * instead of an invented one.
 */
function parseKeff(lines: string[], text: string): { keff?: KeffHistory; note?: string } {
    const cycles: number[] = [];
    const mean: number[] = [];
    const std: number[] = [];

    let cycleCol = -1;
    let keffCol = -1;
    let active = false;
    for (const raw of lines) {
        const line = raw.replace(/\r$/, '');
        if (/^\s*cycle\b/i.test(line) && /k\s*eff/i.test(line)) {
            const heads = tokens(line);
            cycleCol = heads.findIndex((h) => /^cycle$/i.test(h));
            keffCol = heads.findIndex((h) => /^k\(?eff/i.test(h) || /^keff/i.test(h));
            active = cycleCol >= 0 && keffCol > cycleCol;
            continue;
        }
        if (!active) continue;
        const toks = tokens(line);
        if (!allNumeric(toks) || toks.length <= keffCol) {
            if (toks.length > 0 && !allNumeric(toks)) active = false;
            continue;
        }
        const c = num(toks[cycleCol]);
        const k = num(toks[keffCol]);
        if (Number.isFinite(c) && Number.isFinite(k) && k > 0 && k < 10) {
            cycles.push(c);
            mean.push(k);
            std.push(0);
        }
    }

    const finalM = RE_FINAL_KEFF.exec(text);
    if (finalM) {
        const m = num(finalM[1]);
        const s = num(finalM[2]);
        if (Number.isFinite(m)) {
            return {
                keff: {
                    cycles: cycles.length ? cycles : [1],
                    mean: mean.length ? mean : [m],
                    std: std.length ? std : [s],
                    final: { mean: m, std: Number.isFinite(s) ? s : 0 },
                },
                note: cycles.length ? undefined : 'No cycle-by-cycle k-eff table in this output (only the final estimate).',
            };
        }
    }
    if (mean.length > 0) {
        return {
            keff: { cycles, mean, std, final: { mean: mean[mean.length - 1], std: 0 } },
            note: 'k-eff standard deviation by cycle is not printed in outp; error bars omitted.',
        };
    }
    return {};
}

function parseMetadata(lines: string[], text: string): { metadata: Record<string, string | number>; warnings: string[] } {
    const metadata: Record<string, string | number> = {};
    const warnings: string[] = [];
    let warningCount = 0;

    const version = /^1mcnp\s+version\s+(\S+)\s+ld=(\S+)/im.exec(text);
    if (version) {
        metadata.code = `MCNP ${version[1]}`;
        metadata.libraryDate = version[2];
    }
    const nps = /run terminated when\s+(\d+)\s+particle histories were done/i.exec(text);
    if (nps) metadata.histories = parseInt(nps[1], 10);
    const ctm = new RegExp(String.raw`computer time\s*=\s*(${N})\s*minutes`, 'i').exec(text);
    if (ctm) metadata.computerTimeMin = num(ctm[1]);
    const rate = new RegExp(String.raw`=====>\s*(${N})\s*M histories/hr`, 'i').exec(text);
    if (rate) metadata.mHistoriesPerHr = num(rate[1]);
    const probid = /probid\s*=\s*(\S+\s+\S+)/i.exec(text);
    if (probid) metadata.probid = probid[1].trim();

    for (const raw of lines) {
        const line = raw.replace(/\r$/, '').trim();
        if (/^warning\./i.test(line)) {
            warningCount++;
            const msg = line.replace(/^warning\.\s*/i, '');
            if (warnings.length < 40 && !/warning messages so far/i.test(msg)) warnings.push(msg);
        } else if (/^(fatal error|bad trouble)/i.test(line)) {
            warnings.push(line);
            metadata.fatal = 'yes';
        }
    }
    if (warningCount > 0) metadata.warningLines = warningCount;
    return { metadata, warnings };
}

/** True when the text looks like an MCNP outp file rather than some other output. */
export function looksLikeMcnpOutp(text: string): boolean {
    const head = text.slice(0, 20000);
    return (
        /^1mcnp\s+version/im.test(head) ||
        (/mcnp\s+version\s+\d/i.test(head) && /print table\s+\d+/i.test(head)) ||
        /^1problem summary/im.test(head)
    );
}

export function parseMcnpOutp(text: string, sourceFile?: string): RunResults {
    const lines = text.split(/\n/);
    const blocks = parseTallyBlocks(lines);
    const checks = parseStatisticalChecks(lines);
    const tfc = parseTfc(lines);
    const { keff, note: keffNote } = parseKeff(lines, text);
    const { metadata, warnings } = parseMetadata(lines, text);

    const tallies: TallyEntry[] = [];
    const spectra: FluxSpectrum[] = [];
    const notes: string[] = [];
    if (keffNote) notes.push(keffNote);

    for (const b of blocks) {
        const verdict = checks.get(b.id);
        const hist = tfc.get(b.id);
        const typeLabel = b.type != null ? `F${b.type}` : 'tally';
        const label = [`${typeLabel} ${b.id}`, b.typeText, b.particles ? `(${b.particles})` : undefined]
            .filter(Boolean)
            .join(' ');

        // Prefer the explicit total bin; otherwise the last bin is the tally value.
        const totalBin = b.bins.find((x) => /·\s*total$/.test(x.label)) ?? b.bins[b.bins.length - 1];
        const entry: TallyEntry = {
            id: b.id,
            label,
            value: totalBin?.value ?? 0,
            error: totalBin?.error,
            bins: b.bins.length > 0 ? b.bins : undefined,
            checks: verdict?.checks ?? 'unknown',
            note: verdict?.note,
        };
        if (hist && hist.x.length > 0) {
            entry.history = { x: hist.x, mean: hist.mean, error: hist.error, fom: hist.fom };
            entry.fom = hist.fom[hist.fom.length - 1];
            if (b.bins.length === 0) {
                entry.value = hist.mean[hist.mean.length - 1];
                entry.error = hist.error[hist.error.length - 1];
            }
        }
        tallies.push(entry);

        if (b.spectrum && b.spectrum.E.length >= 3) {
            spectra.push({
                label: `${typeLabel} ${b.id} spectrum`,
                E: b.spectrum.E,
                phi: b.spectrum.phi,
                unit: b.type === 4 ? 'per cm² per source particle' : 'per source particle',
            });
        }
    }

    if (tallies.length === 0 && !keff) {
        notes.push('No tally results or k-eff found. If the run stopped early, check the warnings above.');
    }
    const zeroed = tallies.filter((t) => t.checks === 'zero').length;
    if (zeroed > 0) notes.push(`${zeroed} of ${tallies.length} tallies scored nothing (all-zero bins).`);
    const missed = tallies.filter((t) => t.checks === 'missed').length;
    if (missed > 0) notes.push(`${missed} tallies failed at least one of MCNP's 10 statistical checks.`);

    return {
        code: 'mcnp',
        sourceFile,
        keff,
        spectra,
        tallies,
        meshTallies: [],
        metadata,
        warnings: warnings.length ? warnings : undefined,
        notes: notes.length ? notes : undefined,
    };
}

export function parseMcnpOutpFile(filePath: string): RunResults {
    return parseMcnpOutp(fs.readFileSync(filePath, 'utf8'), filePath);
}
