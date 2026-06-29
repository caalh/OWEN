import * as fs from 'fs';
import * as path from 'path';
import type { DetectedOutput } from './types';

const OUTPUT_PATTERNS: Array<{ glob: RegExp; code: DetectedOutput['code']; kind: DetectedOutput['kind']; label: string }> = [
    { glob: /^statepoint\.\d+\.h5$/i, code: 'openmc', kind: 'statepoint', label: 'OpenMC statepoint' },
    { glob: /^mctal$/i, code: 'mcnp', kind: 'mctal', label: 'MCNP mctal' },
    { glob: /_res\.m$/i, code: 'serpent', kind: 'resm', label: 'Serpent _res.m' },
    { glob: /_det\d+\.m$/i, code: 'serpent', kind: 'detm', label: 'Serpent detector' },
    { glob: /\.out$/i, code: 'scone', kind: 'scone_out', label: 'SCONE output' },
    { glob: /^owen-sweep\.log$/i, code: 'openmc', kind: 'stdout', label: 'Sweep log' },
];

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
                walk(full, depth + 1);
                continue;
            }
            for (const p of OUTPUT_PATTERNS) {
                if (p.glob.test(ent.name)) {
                    found.push({ path: full, code: p.code, kind: p.kind, label: `${p.label}: ${ent.name}` });
                    break;
                }
            }
        }
    };
    walk(dir, 0);
    return found.sort((a, b) => b.path.localeCompare(a.path));
}

export function guessWorkDir(filePath: string, configured?: string): string {
    if (configured && fs.existsSync(configured)) return configured;
    return path.dirname(filePath);
}

export function pickPrimaryOutput(outputs: DetectedOutput[]): DetectedOutput | undefined {
    const priority: DetectedOutput['kind'][] = ['statepoint', 'mctal', 'resm', 'detm', 'scone_out', 'stdout'];
    for (const k of priority) {
        const hit = outputs.find((o) => o.kind === k);
        if (hit) return hit;
    }
    return outputs[0];
}
