// Finding run outputs on disk.
//
// Filenames are a bad guide here: MCNP's text output is named by whoever
// launched the run (`outp`, `o=foo.txt`, `n=case` → `caseo`), and `.out` is
// claimed by SCONE, OpenMC (`tallies.out`) and MCNP users alike. So candidates
// are picked up broadly by name and then identified by reading their first few
// kilobytes.
import * as fs from 'fs';
import * as path from 'path';
import type { DetectedOutput, OutputKind, RunResults } from './types';
import { looksLikeMcnpOutp } from './parsers/mcnpOutp';
import { looksLikeMctal } from './parsers/mctal';
import { looksLikeOpenmcStdout, looksLikeOpenmcTalliesOut } from './parsers/openmc';
import { looksLikeSerpentDet, looksLikeSerpentRes } from './parsers/serpent';
import { looksLikeSconeOutput } from './parsers/scone';

const SNIFF_BYTES = 16384;

/**
 * Names worth opening. Anything matched here still has to pass the sniff.
 *
 * The `out[p-z]` / `mcta[l-z]` / `meshta[l-z]` forms are not typos. When MCNP
 * is about to create a file that already exists it does not overwrite it and
 * does not stop: it advances the last letter of the name, so a second run in
 * the same directory writes `outq`, a third `outr`, and likewise `mctam`,
 * `meshtam`, `runtpf` (LA-10860 §1.4.1). Matching only `outp` meant a rerun's
 * results were invisible and OWEN showed the previous run's numbers instead.
 */
const CANDIDATE_NAME =
    /^(?:.*statepoint[.\d]*\.h5|summary\.h5|mcta[l-z].*|meshta[l-z].*|out[p-z].*|.*\.outp|.*o|.*\.out|.*\.txt|.*\.log|.*\.m|.*\.mctal)$/i;

const SKIP_NAME = /^(?:model\.xml|geometry\.xml|materials\.xml|settings\.xml|tallies\.xml|package(?:-lock)?\.json)$/i;

function readHead(file: string): string {
    const fd = fs.openSync(file, 'r');
    try {
        const buf = Buffer.alloc(SNIFF_BYTES);
        const n = fs.readSync(fd, buf, 0, SNIFF_BYTES, 0);
        return buf.slice(0, n).toString('utf8');
    } finally {
        fs.closeSync(fd);
    }
}

interface Identity {
    code: RunResults['code'];
    kind: OutputKind;
    label: string;
}

/** Identify a single file, or return undefined when it is not run output. */
export function identifyOutput(file: string): Identity | undefined {
    const name = path.basename(file);
    if (/statepoint[.\d]*\.h5$/i.test(name)) {
        return { code: 'openmc', kind: 'statepoint', label: 'OpenMC statepoint' };
    }
    if (/\.h5$/i.test(name)) return undefined; // summary.h5 and friends carry no results

    let head: string;
    try {
        head = readHead(file);
    } catch {
        return undefined;
    }
    // Binary files that slipped through the name filter.
    if (head.includes('\u0000')) return undefined;

    if (looksLikeMcnpOutp(head)) return { code: 'mcnp', kind: 'outp', label: 'MCNP output' };
    if (looksLikeMctal(head)) return { code: 'mcnp', kind: 'mctal', label: 'MCNP mctal' };
    if (looksLikeOpenmcTalliesOut(head)) return { code: 'openmc', kind: 'openmc_tallies', label: 'OpenMC tallies.out' };
    if (looksLikeOpenmcStdout(head)) return { code: 'openmc', kind: 'stdout', label: 'OpenMC log' };
    if (looksLikeSerpentDet(head)) return { code: 'serpent', kind: 'detm', label: 'Serpent detector' };
    if (looksLikeSerpentRes(head)) return { code: 'serpent', kind: 'resm', label: 'Serpent results' };
    if (looksLikeSconeOutput(head)) return { code: 'scone', kind: 'scone_out', label: 'SCONE output' };
    return undefined;
}

export function detectOutputsInDir(dir: string): DetectedOutput[] {
    if (!fs.existsSync(dir)) return [];
    const found: DetectedOutput[] = [];
    const walk = (d: string, depth: number) => {
        if (depth > 3) return;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(d, { withFileTypes: true });
        } catch {
            return;
        }
        for (const ent of entries) {
            const full = path.join(d, ent.name);
            if (ent.isDirectory()) {
                if (/^(node_modules|\.git|__pycache__)$/i.test(ent.name)) continue;
                walk(full, depth + 1);
                continue;
            }
            if (SKIP_NAME.test(ent.name) || !CANDIDATE_NAME.test(ent.name)) continue;
            const id = identifyOutput(full);
            if (!id) continue;
            let mtime: number | undefined;
            try {
                mtime = fs.statSync(full).mtimeMs;
            } catch {
                mtime = undefined;
            }
            found.push({ path: full, code: id.code, kind: id.kind, label: `${id.label}: ${ent.name}`, mtime });
        }
    };
    walk(dir, 0);
    // Newest first: with `outp` and `outq` side by side the second is the run
    // the user just launched, and name order would hand back the first.
    return found.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0) || b.path.localeCompare(a.path));
}

export function guessWorkDir(filePath: string, configured?: string): string {
    if (configured && fs.existsSync(configured)) return configured;
    return path.dirname(filePath);
}

export function pickPrimaryOutput(outputs: DetectedOutput[]): DetectedOutput | undefined {
    const priority: OutputKind[] = ['statepoint', 'outp', 'mctal', 'resm', 'detm', 'scone_out', 'openmc_tallies', 'stdout'];
    for (const k of priority) {
        // detectOutputsInDir returns newest first, so the first hit of the
        // preferred kind is also the most recent one of that kind.
        const hit = outputs.find((o) => o.kind === k);
        if (hit) return hit;
    }
    return outputs[0];
}

/**
 * A note for the results panel when a directory holds more than one output of
 * the chosen kind. For MCNP that is the letter-bump signature — the older files
 * are previous runs, and it is worth saying which one is being shown.
 */
export function staleOutputNote(outputs: DetectedOutput[], chosen: DetectedOutput): string | undefined {
    const siblings = outputs.filter((o) => o.kind === chosen.kind && o.path !== chosen.path);
    if (siblings.length === 0) return undefined;
    const names = siblings.map((o) => path.basename(o.path)).join(', ');
    return (
        `Showing ${path.basename(chosen.path)}, the most recently written of ${siblings.length + 1} ` +
        `${chosen.label.split(':')[0]} files in this directory (also present: ${names}). ` +
        (chosen.code === 'mcnp'
            ? 'MCNP advances the last letter of an output name rather than overwriting, so the others are earlier runs.'
            : 'The others are earlier runs.')
    );
}
