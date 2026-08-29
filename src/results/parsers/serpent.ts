// Serpent 2 results readers for the MATLAB-syntax output files:
//   <input>_res.m    global results, one accumulated block per burnup step
//   <input>_det<n>.m detector (tally) matrices
//   <input>_his<n>.m cycle-wise history, written with `set his 1`
//
// Real Serpent writes indexed assignments, e.g.
//   IMP_KEFF                  (idx, [1:   2]) = [  1.34721E+00 0.00095 ];
//   ANA_KEFF                  (idx, [1:   6]) = [ ... three value/error pairs ];
// while post-processing snippets often show the bare `IMP_KEFF = [ … ];` form.
// Both are accepted. Detector matrices carry ten index columns followed by the
// mean and the relative error, and the companion `DET<name>E` matrix holds
// Emin/Emax/Emid in MeV — the layout documented on the Serpent wiki and used by
// the ReactorMC Serpent pages.
//
// Serpent is not installed on the development machine, so these readers are
// checked against fixtures written in the documented format rather than against
// a live run. Mesh detectors are deliberately not reconstructed: the meaning of
// the index columns depends on the detector card, and guessing it would invent
// geometry.
import * as fs from 'fs';
import type { RunResults, KeffHistory, TallyEntry, FluxSpectrum } from '../types';

/** One `NAME = [...]` / `NAME (idx, …) = …` assignment. */
interface Assignment {
    name: string;
    numbers: number[];
    text?: string;
    /** Row width when the value was written as a matrix. */
    rows?: number[][];
}

function stripComments(text: string): string {
    return text
        .split(/\r?\n/)
        .map((line) => {
            const q = line.indexOf("'");
            const c = line.indexOf('%');
            if (c < 0) return line;
            if (q >= 0 && q < c) return line; // quoted string before the %
            return line.slice(0, c);
        })
        .join('\n');
}

const RE_ASSIGN = new RegExp(
    String.raw`^\s*([A-Za-z_]\w*)\s*(?:\(\s*idx\s*,[^)]*\))?\s*=\s*([\s\S]*?);`,
    'gm',
);

function parseAssignments(text: string): Assignment[] {
    const out: Assignment[] = [];
    const clean = stripComments(text);
    RE_ASSIGN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RE_ASSIGN.exec(clean)) !== null) {
        const name = m[1];
        const body = m[2].trim();
        if (/^'/.test(body)) {
            out.push({ name, numbers: [], text: body.replace(/^'|'$/g, '').trim() });
            continue;
        }
        const inner = body.replace(/^\[/, '').replace(/\]$/, '');
        const rows = inner
            .split(/;|\n/)
            .map((r) =>
                r
                    .trim()
                    .split(/[\s,]+/)
                    .filter(Boolean)
                    .map((t) => parseFloat(t.replace(/[dD]/, 'e')))
                    .filter((v) => Number.isFinite(v)),
            )
            .filter((r) => r.length > 0);
        const numbers = rows.flat();
        if (numbers.length === 0) continue;
        out.push({ name, numbers, rows: rows.length > 1 ? rows : undefined });
    }
    return out;
}

const KEFF_VARS = ['IMP_KEFF', 'ANA_KEFF', 'COL_KEFF', 'ABS_KEFF', 'IMP_KINF', 'ANA_KINF', 'ABS_KINF'] as const;
const META_TEXT_VARS: Record<string, string> = {
    VERSION: 'code',
    TITLE: 'title',
    INPUT_FILE_NAME: 'inputFile',
    COMPILE_DATE: 'compiled',
    COMPLETE_DATE: 'finished',
    START_DATE: 'started',
};
const META_NUM_VARS: Record<string, string> = {
    TOT_CPU_TIME: 'cpuTimeMin',
    RUNNING_TIME: 'runningTimeMin',
    CYCLE_IDX: 'cycles',
    SOURCE_POPULATION: 'sourcePopulation',
    BURNUP: 'burnup',
    BURN_DAYS: 'burnDays',
};

function plausibleRelativeError(v: number): boolean {
    return Number.isFinite(v) && v >= 0 && v <= 1;
}

export function looksLikeSerpentRes(text: string): boolean {
    const head = text.slice(0, 20000);
    return /^\s*(IMP_KEFF|ANA_KEFF|COL_KEFF|ABS_KEFF|VERSION)\s*(\(\s*idx)?/m.test(head);
}

export function looksLikeSerpentDet(text: string): boolean {
    return /^\s*DET[A-Za-z_]\w*\s*(\(\s*idx[^)]*\))?\s*=\s*\[/m.test(text.slice(0, 20000));
}

export function parseSerpentResults(text: string, sourceFile?: string): RunResults {
    const assignments = parseAssignments(text);
    const tallies: TallyEntry[] = [];
    const spectra: FluxSpectrum[] = [];
    const notes: string[] = [];
    const metadata: Record<string, string | number> = {};

    // Group repeated assignments: _res.m appends one block per burnup step.
    const byName = new Map<string, Assignment[]>();
    for (const a of assignments) {
        const list = byName.get(a.name) ?? [];
        list.push(a);
        byName.set(a.name, list);
    }

    for (const [name, key] of Object.entries(META_TEXT_VARS)) {
        const hit = byName.get(name)?.[0];
        if (hit?.text) metadata[key] = hit.text;
    }
    for (const [name, key] of Object.entries(META_NUM_VARS)) {
        const list = byName.get(name);
        if (!list?.length) continue;
        const last = list[list.length - 1].numbers[0];
        if (Number.isFinite(last)) metadata[key] = last;
    }
    const steps = byName.get('IMP_KEFF')?.length ?? byName.get('ANA_KEFF')?.length ?? 0;
    if (steps > 1) metadata.burnupSteps = steps;

    // k-eff: prefer the implicit estimate, which Serpent recommends.
    let keff: KeffHistory | undefined;
    for (const varName of KEFF_VARS) {
        const list = byName.get(varName);
        if (!list?.length) continue;
        const mean: number[] = [];
        const std: number[] = [];
        for (const a of list) {
            const m = a.numbers[0];
            const s = a.numbers[1];
            if (!Number.isFinite(m)) continue;
            mean.push(m);
            // Serpent reports a *relative* uncertainty; convert to absolute.
            std.push(plausibleRelativeError(s) ? Math.abs(m * s) : 0);
        }
        if (mean.length === 0) continue;
        if (!keff) {
            keff = {
                cycles: mean.map((_, i) => i + 1),
                mean,
                std,
                final: { mean: mean[mean.length - 1], std: std[std.length - 1] },
            };
            metadata.keffEstimator = varName;
            if (mean.length > 1) {
                notes.push(
                    `${varName} has ${mean.length} entries — this _res.m covers a burnup calculation, so the k-eff series is per burnup step, not per cycle.`,
                );
            }
        }
        tallies.push({
            id: varName,
            label: varName,
            value: mean[mean.length - 1],
            error: plausibleRelativeError(list[list.length - 1].numbers[1])
                ? list[list.length - 1].numbers[1]
                : undefined,
            checks: 'unknown',
        });
    }

    // Cycle-wise history from a _his file, when that is what we were handed.
    for (const hisName of ['HIS_IMP_KEFF', 'HIS_ANA_KEFF', 'HIS_COL_KEFF']) {
        const hit = byName.get(hisName)?.[0];
        if (!hit?.rows || hit.rows.length < 3) continue;
        const width = hit.rows[0].length;
        // Find the column that looks like k-eff rather than a cycle counter.
        let col = -1;
        for (let c = 0; c < width; c++) {
            const values = hit.rows.map((r) => r[c]).filter(Number.isFinite);
            if (values.length < hit.rows.length) continue;
            const isCounter = values.every((v, i) => v === i + 1);
            if (isCounter) continue;
            if (values.every((v) => v > 0.1 && v < 10)) {
                col = c;
                break;
            }
        }
        if (col < 0) continue;
        const mean = hit.rows.map((r) => r[col]);
        keff = {
            cycles: mean.map((_, i) => i + 1),
            mean,
            std: mean.map(() => 0),
            final: keff?.final ?? { mean: mean[mean.length - 1], std: 0 },
        };
        metadata.keffHistorySource = hisName;
        break;
    }

    // Everything else that is a [mean, relative error] pair is a real result.
    for (const [name, list] of byName) {
        if ((KEFF_VARS as readonly string[]).includes(name)) continue;
        if (name.startsWith('DET') || name.startsWith('HIS_')) continue;
        const a = list[list.length - 1];
        if (a.numbers.length !== 2 || a.rows) continue;
        if (!plausibleRelativeError(a.numbers[1])) continue;
        if (!Number.isFinite(a.numbers[0])) continue;
        tallies.push({
            id: name,
            label: name,
            value: a.numbers[0],
            error: a.numbers[1],
            checks: 'unknown',
        });
    }

    // Detector matrices, if this file also holds them.
    const det = parseSerpentDetectors(byName);
    tallies.push(...det.tallies);
    spectra.push(...det.spectra);
    notes.push(...det.notes);

    return {
        code: 'serpent',
        sourceFile,
        keff,
        spectra,
        tallies,
        meshTallies: [],
        metadata,
        notes: notes.length ? notes : undefined,
    };
}

/**
 * Detector matrices: `DET<name>` rows are ten index columns followed by the
 * mean and the relative error; `DET<name>E` is Emin/Emax/Emid in MeV.
 */
function parseSerpentDetectors(byName: Map<string, Assignment[]>): {
    tallies: TallyEntry[];
    spectra: FluxSpectrum[];
    notes: string[];
} {
    const tallies: TallyEntry[] = [];
    const spectra: FluxSpectrum[] = [];
    const notes: string[] = [];

    for (const [name, list] of byName) {
        if (!name.startsWith('DET') || /E$/.test(name)) continue;
        const a = list[list.length - 1];
        const rows = a.rows ?? (a.numbers.length >= 3 ? [a.numbers] : undefined);
        if (!rows) continue;
        const width = rows[0].length;
        if (rows.some((r) => r.length !== width) || width < 3) {
            notes.push(`${name}: detector rows have inconsistent widths; skipped.`);
            continue;
        }
        const detName = name.slice(3);
        const values = rows.map((r) => r[width - 2]);
        const errors = rows.map((r) => r[width - 1]);
        const total = values.reduce((s, v) => s + v, 0);

        tallies.push({
            id: detName || name,
            label: `Detector ${detName || name}${rows.length > 1 ? ` (${rows.length} bins)` : ''}`,
            value: rows.length === 1 ? values[0] : total,
            error: rows.length === 1 && plausibleRelativeError(errors[0]) ? errors[0] : undefined,
            bins:
                rows.length > 1
                    ? rows.map((_, i) => ({
                          label: `bin ${i + 1}`,
                          value: values[i],
                          error: plausibleRelativeError(errors[i]) ? errors[i] : undefined,
                      }))
                    : undefined,
            note: rows.length > 1 ? 'Value shown is the sum over all detector bins.' : undefined,
            checks: 'unknown',
        });

        const eAssign = byName.get(`${name}E`)?.[0];
        const eRows = eAssign?.rows ?? (eAssign && eAssign.numbers.length % 3 === 0
            ? Array.from({ length: eAssign.numbers.length / 3 }, (_, i) => eAssign.numbers.slice(i * 3, i * 3 + 3))
            : undefined);
        if (eRows && eRows.length === rows.length && eRows[0].length === 3) {
            spectra.push({
                label: `Detector ${detName || name}`,
                E: eRows.map((r) => r[2] * 1e6), // Emid, MeV → eV
                phi: values,
                unit: 'per source particle',
            });
        } else if (eRows) {
            notes.push(
                `${name}: energy grid has ${eRows.length} rows but the detector has ${rows.length}; spectrum skipped.`,
            );
        }

        const indexCols = width - 2;
        if (indexCols >= 8) {
            const varying = Array.from({ length: indexCols }, (_, c) => new Set(rows.map((r) => r[c])).size).filter(
                (n) => n > 1,
            ).length;
            if (varying > 1) {
                notes.push(
                    `${name} bins over more than one index column (mesh or multi-bin detector). OWEN lists the bins in file order and does not reconstruct the mesh.`,
                );
            }
        }
    }

    return { tallies, spectra, notes };
}

export function parseSerpentFile(filePath: string): RunResults {
    return parseSerpentResults(fs.readFileSync(filePath, 'utf8'), filePath);
}
