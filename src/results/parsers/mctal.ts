// Reader for the MCNP ASCII mctal file (the `r=`/tally file MCNP writes when
// asked for one). Layout follows the reference implementation in kbat/mc-tools
// (mctools/mcnp/mctal.py), which is the de-facto community parser:
//
//   <kod> <ver> <probid date> <probid time> <knod> <nps> <rnr>
//   <problem title>
//   ntal <n> [npert <m>]
//   <tally numbers…>
//   tally <id> <particle spec> <?> [<detector type>]
//   [particle list line] [FC comment lines]
//   f <nf>            <cell/surface/detector bin numbers…>
//   d <nd>
//   u[t|c] <nu>       <user bins…>
//   s[t|c] <ns>       <segment bins…>
//   m[t|c] <nm>       <multiplier bins…>
//   c[t|c] <nc> [f]   <cosine bins…>
//   e[t|c] <ne> [f]   <energy bins, MeV…>
//   t[t|c] <nt> [f]   <time bins, shakes…>
//   vals              <mean> <relerr> <mean> <relerr> …
//   tfc <n> <9 jtf ints>
//   <nps> <mean> <relerr> [<fom>]     (one row per TFC dump)
//   [kcode <header ints>  <flat cycle data…>]
//
// Value ordering is the Fortran array (f,d,u,s,m,c,e,t) with the time bin
// varying fastest — the same nesting mc-tools uses to fill its array.
//
// Not validated against a real mctal: none was available on this machine when
// this was written (no MCNP install). The outp reader in mcnpOutp.ts is the
// validated MCNP path; prefer it when both files exist.
import * as fs from 'fs';
import type { RunResults, TallyEntry, TallyBin, FluxSpectrum, KeffHistory } from '../types';

const AXES = ['f', 'd', 'u', 's', 'm', 'c', 'e', 't'] as const;
type Axis = (typeof AXES)[number];

const RE_AXIS = /^([fdusmcet])([tc])?$/i;
const RE_INT = /^[-+]?\d+$/;

function toNum(tok: string): number {
    return parseFloat(tok.replace(/[dD]/, 'e'));
}

function isNumeric(tok: string): boolean {
    return Number.isFinite(toNum(tok));
}

interface AxisInfo {
    count: number;
    total: boolean;
    cumulative: boolean;
    bins: number[];
}

interface MctalTally {
    id: string;
    detectorType?: number;
    comments: string[];
    axes: Record<Axis, AxisInfo>;
    mesh?: { nCora: number; nCorb: number; nCorc: number };
    vals: number[];
    tfc: { nps: number[]; mean: number[]; error: number[]; fom: number[] };
}

function emptyAxis(): AxisInfo {
    return { count: 0, total: false, cumulative: false, bins: [] };
}

function newTally(id: string): MctalTally {
    const axes = {} as Record<Axis, AxisInfo>;
    for (const a of AXES) axes[a] = emptyAxis();
    return { id, comments: [], axes, vals: [], tfc: { nps: [], mean: [], error: [], fom: [] } };
}

function nbins(info: AxisInfo): number {
    return info.count === 0 ? 1 : info.count;
}

/** True when the text has the shape of an ASCII mctal file. */
export function looksLikeMctal(text: string): boolean {
    const head = text.slice(0, 4000);
    if (!/^\s*ntal\s+\d+/im.test(head)) return false;
    return /^\s*tally\s+\d+/im.test(text.slice(0, 20000)) || /\bvals\b/.test(text.slice(0, 20000));
}

interface MctalFile {
    code?: string;
    version?: string;
    probid?: string;
    nps?: number;
    title?: string;
    ntal?: number;
    npert?: number;
    tallies: MctalTally[];
    kcode?: { header: number[]; data: number[] };
}

function readMctal(text: string): MctalFile {
    const lines = text.split(/\r?\n/);
    const out: MctalFile = { tallies: [] };
    let i = 0;

    // Header
    const first = (lines[i] ?? '').trim().split(/\s+/).filter(Boolean);
    if (first.length >= 7) {
        out.code = first[0];
        out.version = first[1];
        out.probid = `${first[2]} ${first[3]}`;
        out.nps = parseInt(first[5], 10);
        i++;
        out.title = (lines[i] ?? '').trim();
        i++;
    } else if (first.length === 3 && first.every(RE_INT.test.bind(RE_INT))) {
        out.nps = parseInt(first[1], 10);
        i++;
        out.title = (lines[i] ?? '').trim();
        i++;
    }

    for (; i < lines.length; i++) {
        const toks = (lines[i] ?? '').trim().split(/\s+/).filter(Boolean);
        if (toks.length === 0) continue;
        if (/^ntal$/i.test(toks[0])) {
            out.ntal = parseInt(toks[1], 10);
            const pertIdx = toks.findIndex((t) => /^npert$/i.test(t));
            if (pertIdx >= 0) out.npert = parseInt(toks[pertIdx + 1], 10);
            continue;
        }
        if (/^tally$/i.test(toks[0])) break;
        if (/^kcode$/i.test(toks[0])) break;
    }

    let cur: MctalTally | undefined;
    let axis: Axis | undefined;
    let mode: 'bins' | 'vals' | 'tfc' | 'kcode' | 'idle' = 'idle';

    for (; i < lines.length; i++) {
        const raw = lines[i] ?? '';
        const toks = raw.trim().split(/\s+/).filter(Boolean);
        if (toks.length === 0) continue;
        const head = toks[0].toLowerCase();

        if (head === 'tally' && toks.length >= 2 && RE_INT.test(toks[1])) {
            cur = newTally(toks[1]);
            if (toks.length >= 4 && RE_INT.test(toks[3])) cur.detectorType = parseInt(toks[3], 10);
            out.tallies.push(cur);
            axis = undefined;
            mode = 'idle';
            continue;
        }
        if (head === 'kcode') {
            out.kcode = { header: toks.slice(1).map(toNum).filter(Number.isFinite), data: [] };
            mode = 'kcode';
            continue;
        }
        if (mode === 'kcode') {
            if (toks.every(isNumeric)) out.kcode!.data.push(...toks.map(toNum));
            continue;
        }
        if (!cur) continue;

        if (head === 'vals') {
            mode = 'vals';
            axis = undefined;
            continue;
        }
        if (head === 'tfc') {
            mode = 'tfc';
            axis = undefined;
            continue;
        }

        const axisMatch = RE_AXIS.exec(toks[0]);
        if (axisMatch && toks.length >= 2 && RE_INT.test(toks[1])) {
            const a = axisMatch[1].toLowerCase() as Axis;
            const info = cur.axes[a];
            info.count = parseInt(toks[1], 10);
            info.total = axisMatch[2]?.toLowerCase() === 't';
            info.cumulative = axisMatch[2]?.toLowerCase() === 'c';
            // Mesh tallies put cora/corb/corc counts on the f line.
            if (a === 'f' && toks.length >= 6 && toks.slice(2, 6).every((t) => RE_INT.test(t))) {
                cur.mesh = {
                    nCora: parseInt(toks[3], 10),
                    nCorb: parseInt(toks[4], 10),
                    nCorc: parseInt(toks[5], 10),
                };
                info.count = 1;
            }
            axis = a;
            mode = 'bins';
            continue;
        }

        if (mode === 'bins' && axis && toks.every(isNumeric)) {
            cur.axes[axis].bins.push(...toks.map(toNum));
            continue;
        }
        if (mode === 'vals' && toks.every(isNumeric)) {
            cur.vals.push(...toks.map(toNum));
            continue;
        }
        if (mode === 'tfc' && toks.every(isNumeric) && toks.length >= 3) {
            cur.tfc.nps.push(toNum(toks[0]));
            cur.tfc.mean.push(toNum(toks[1]));
            cur.tfc.error.push(toNum(toks[2]));
            cur.tfc.fom.push(toks.length >= 4 ? toNum(toks[3]) : NaN);
            continue;
        }
        if (mode === 'idle' && /^\s{5}/.test(raw)) {
            cur.comments.push(raw.slice(5).trimEnd());
        }
    }

    return out;
}

/** Index into the flat vals array; time varies fastest, cells slowest. */
function valIndex(t: MctalTally, idx: Partial<Record<Axis, number>>): number {
    let flat = 0;
    for (const a of AXES) {
        flat = flat * nbins(t.axes[a]) + (idx[a] ?? 0);
    }
    if (t.mesh) flat = flat * t.mesh.nCorc * t.mesh.nCorb * t.mesh.nCora;
    return flat;
}

function totalBins(t: MctalTally): number {
    let n = 1;
    for (const a of AXES) n *= nbins(t.axes[a]);
    if (t.mesh) n *= t.mesh.nCora * t.mesh.nCorb * t.mesh.nCorc;
    return n;
}

export function parseMctalAscii(text: string, sourceFile?: string): RunResults {
    const file = readMctal(text);
    const tallies: TallyEntry[] = [];
    const spectra: FluxSpectrum[] = [];
    const notes: string[] = [];

    for (const t of file.tallies) {
        const pairs = Math.floor(t.vals.length / 2);
        const expected = totalBins(t);
        if (pairs > 0 && pairs !== expected) {
            notes.push(
                `Tally ${t.id}: mctal holds ${pairs} value/error pairs but the bin counts imply ${expected}; bin labels may be offset.`,
            );
        }

        const valueAt = (idx: Partial<Record<Axis, number>>): { value: number; error: number } | undefined => {
            const k = valIndex(t, idx) * 2;
            if (k + 1 >= t.vals.length) return undefined;
            return { value: t.vals[k], error: t.vals[k + 1] };
        };

        const eAxis = t.axes.e;
        const nE = nbins(eAxis);
        const bins: TallyBin[] = [];
        const cellIds = t.axes.f.bins;

        for (let f = 0; f < nbins(t.axes.f); f++) {
            const cellLabel = cellIds[f] != null ? `bin ${cellIds[f]}` : `bin ${f + 1}`;
            for (let e = 0; e < nE; e++) {
                const hit = valueAt({ f, e });
                if (!hit) continue;
                const isTotal = eAxis.total && e === nE - 1;
                const edge = eAxis.bins[e];
                const label =
                    nE === 1
                        ? cellLabel
                        : isTotal
                          ? `${cellLabel} · total`
                          : `${cellLabel} · E<${edge != null ? `${edge} MeV` : `bin ${e + 1}`}`;
                bins.push({ label, value: hit.value, error: hit.error });
            }
        }

        // Spectrum for the first cell bin when real energy bins exist.
        if (nE > 1 && eAxis.bins.length >= nE - (eAxis.total ? 1 : 0)) {
            const E: number[] = [];
            const phi: number[] = [];
            const last = eAxis.total ? nE - 1 : nE;
            for (let e = 0; e < last; e++) {
                const hit = valueAt({ e });
                const edge = eAxis.bins[e];
                if (!hit || edge == null) continue;
                E.push(edge * 1e6); // mctal energies are MeV
                phi.push(hit.value);
            }
            if (E.length >= 3) spectra.push({ label: `Tally ${t.id} spectrum`, E, phi, unit: 'per source particle' });
        }

        const tfcLast = t.tfc.mean.length - 1;
        const totalIdx: Partial<Record<Axis, number>> = {};
        for (const a of AXES) if (t.axes[a].total) totalIdx[a] = nbins(t.axes[a]) - 1;
        const totalHit = valueAt(totalIdx);

        const entry: TallyEntry = {
            id: t.id,
            label: t.comments[0]?.trim() ? `Tally ${t.id} — ${t.comments[0].trim()}` : `Tally ${t.id}`,
            value: tfcLast >= 0 ? t.tfc.mean[tfcLast] : (totalHit?.value ?? 0),
            error: tfcLast >= 0 ? t.tfc.error[tfcLast] : totalHit?.error,
            bins: bins.length > 0 ? bins : undefined,
            checks: 'unknown',
        };
        if (t.tfc.nps.length > 0) {
            entry.history = {
                x: t.tfc.nps,
                mean: t.tfc.mean,
                error: t.tfc.error,
                fom: t.tfc.fom.some(Number.isFinite) ? t.tfc.fom : undefined,
            };
            const fom = t.tfc.fom[tfcLast];
            if (Number.isFinite(fom)) entry.fom = fom;
        }
        tallies.push(entry);
    }

    let keff: KeffHistory | undefined;
    if (file.kcode && file.kcode.data.length > 0) {
        const mk = file.kcode.header[2] ?? 0;
        if (mk >= 1 && file.kcode.data.length % mk === 0) {
            const cycles: number[] = [];
            const mean: number[] = [];
            const std: number[] = [];
            for (let c = 0; c * mk < file.kcode.data.length; c++) {
                const k = file.kcode.data[c * mk];
                if (Number.isFinite(k) && k > 0 && k < 10) {
                    cycles.push(c + 1);
                    mean.push(k);
                    std.push(0);
                }
            }
            if (mean.length > 0) {
                keff = { cycles, mean, std, final: { mean: mean[mean.length - 1], std: 0 } };
                notes.push(
                    'k-eff by cycle read from the mctal kcode block, first entry per cycle (collision estimator). The outp file carries the combined estimate and its uncertainty.',
                );
            }
        } else {
            notes.push('mctal kcode block present but its cycle width could not be determined; k-eff skipped.');
        }
    }

    const metadata: Record<string, string | number> = {};
    if (file.code) metadata.code = `${file.code} ${file.version ?? ''}`.trim();
    if (file.title) metadata.title = file.title;
    if (file.nps != null && Number.isFinite(file.nps)) metadata.histories = file.nps;
    if (file.probid) metadata.probid = file.probid;
    if (file.ntal != null) metadata.talliesInFile = file.ntal;

    if (file.tallies.length === 0) {
        notes.push('No tally blocks found in this mctal file.');
    }

    return {
        code: 'mcnp',
        sourceFile,
        keff,
        spectra,
        tallies,
        meshTallies: [],
        metadata,
        notes: notes.length ? notes : undefined,
    };
}

export function parseMctalAsciiFile(filePath: string): RunResults {
    return parseMctalAscii(fs.readFileSync(filePath, 'utf8'), filePath);
}
