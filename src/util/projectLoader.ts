/**
 * Join a Monte Carlo *project* into the one string the geometry tools parse.
 *
 * Cell Map, Check Geometry, 3D preview and the converter historically read
 * only the active editor buffer. Workspace validation already followed MCNP
 * `read`/`copy` and Serpent `include`. Researchers keep pins in a second
 * file; the open deck then looks like it fills universes that "were never
 * declared." This module is the shared expander those tools all call.
 *
 * No `vscode` import: unit-tested headlessly, and the field-corpus harness
 * uses it without the extension host.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseMcnpReadTargets } from '../../packages/mcnp-workspace/src/includeGraph';
import { looksLikeOpenmcXml } from '../preview/openmcGeometry';

export const MAX_PROJECT_DEPTH = 32;

export type ProjectLanguage = 'mcnp' | 'openmc' | 'serpent' | 'scone';

export interface ProjectFs {
    exists(p: string): boolean;
    read(p: string): string;
}

export const nodeProjectFs: ProjectFs = {
    exists: (p) => {
        try { return fs.existsSync(p); } catch { return false; }
    },
    read: (p) => fs.readFileSync(p, 'utf8'),
};

export interface ProjectFile {
    path: string;
    role: string;
}

export interface ResolveProjectOptions {
    rootPath: string;
    language: ProjectLanguage;
    /** Unsaved editor text for the root file; wins over disk. */
    rootText?: string;
    fs?: ProjectFs;
}

export interface ResolvedProject {
    language: ProjectLanguage;
    rootPath: string;
    /** Text the geometry parsers should see (includes expanded). */
    text: string;
    /**
     * OpenMC geometry XML when a sibling model.xml / geometry.xml exists
     * (preferred over reconstructing Python). Concatenated with materials
     * when those sit beside it.
     */
    xmlText?: string;
    files: ProjectFile[];
    warnings: string[];
}

const PY_STDLIB = new Set([
    'openmc', 'numpy', 'np', 'math', 'os', 'sys', 'json', 'pathlib', 'argparse',
    'matplotlib', 'pandas', 'scipy', 'h5py', 'typing', 'dataclasses', 'collections',
    'itertools', 'functools', 'shutil', 'subprocess', 'time', 'datetime', 're',
    'csv', 'logging', 'copy', 'random', 'abc', 'enum', 'io', 'tempfile', 'warnings',
    'unicodedata', 'struct', 'hashlib', 'base64', 'gzip', 'zipfile', 'tarfile',
]);

/**
 * MCNP's first non-comment line is the title. Inlining a READ that was the
 * first card would otherwise turn the first included cell into the title and
 * the parser would report no cells.
 */
function ensureMcnpTitle(text: string): string {
    for (const line of text.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || /^c($|\s)/i.test(t)) continue;
        if (/^\d+(\s|$)/.test(t) || /^(read|copy)\b/i.test(t)) {
            return `OWEN joined deck (includes expanded)\n${text}`;
        }
        return text;
    }
    return text;
}

function marker(kind: 'begin' | 'end', filePath: string): string {
    const name = path.basename(filePath);
    return kind === 'begin'
        ? `\n/* OWEN include begin ${name} */\n`
        : `\n/* OWEN include end ${name} */\n`;
}

function mcnpMarker(kind: 'begin' | 'end', filePath: string): string {
    const name = path.basename(filePath);
    return `c ----- OWEN include ${kind} ${name} -----`;
}

/**
 * Expand `read`/`copy` in place, the way MCNP does. Cycles and missing
 * files become warnings; the root text is still returned.
 */
function expandMcnp(
    filePath: string,
    text: string,
    io: ProjectFs,
    visiting: Set<string>,
    files: ProjectFile[],
    warnings: string[],
    role: string,
): string {
    const abs = path.resolve(filePath);
    if (visiting.has(abs)) {
        warnings.push(`MCNP include cycle at ${path.basename(abs)}; left unexpanded.`);
        return text;
    }
    if (visiting.size > MAX_PROJECT_DEPTH) {
        warnings.push(`MCNP include depth exceeds ${MAX_PROJECT_DEPTH}; remaining READ cards left as-is.`);
        return text;
    }
    visiting.add(abs);
    files.push({ path: abs, role });

    const lines = text.split(/\r?\n/);
    const out: string[] = [];
    for (const line of lines) {
        const stripped = line.replace(/\$.*$/, '');
        const head = stripped.trim().split(/\s+/, 1)[0]?.toLowerCase();
        if (head !== 'read' && head !== 'copy') {
            out.push(line);
            continue;
        }
        const targets = parseMcnpReadTargets(stripped);
        if (targets.length === 0) {
            out.push(`c ${line}`);
            continue;
        }
        out.push(`c ${line.trim()}  $ expanded by OWEN`);
        for (const target of targets) {
            const resolved = path.resolve(path.dirname(abs), target.replace(/^["']|["']$/g, ''));
            if (!io.exists(resolved)) {
                warnings.push(`MCNP include "${target}" was not found (looked for ${resolved}).`);
                continue;
            }
            const nested = io.read(resolved);
            out.push(mcnpMarker('begin', resolved));
            out.push(expandMcnp(resolved, nested, io, visiting, files, warnings, `included by ${path.basename(abs)}`).replace(/\s+$/, ''));
            out.push(mcnpMarker('end', resolved));
        }
    }
    visiting.delete(abs);
    return out.join('\n');
}

function expandSerpent(
    filePath: string,
    text: string,
    io: ProjectFs,
    visiting: Set<string>,
    files: ProjectFile[],
    warnings: string[],
    role: string,
): string {
    const abs = path.resolve(filePath);
    if (visiting.has(abs)) {
        warnings.push(`Serpent include cycle at ${path.basename(abs)}; left unexpanded.`);
        return text;
    }
    if (visiting.size > MAX_PROJECT_DEPTH) {
        warnings.push(`Serpent include depth exceeds ${MAX_PROJECT_DEPTH}; remaining include cards left as-is.`);
        return text;
    }
    visiting.add(abs);
    files.push({ path: abs, role });

    const parts: string[] = [];
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.replace(/%.*$/, '').trim();
        if (!/^include\b/i.test(trimmed)) {
            parts.push(line);
            continue;
        }
        const tokens = trimmed.split(/\s+/);
        const target = (tokens[1] ?? '').replace(/^["']|["']$/g, '');
        if (!target) {
            warnings.push('Serpent include card has no filename.');
            continue;
        }
        const resolved = path.isAbsolute(target) ? target : path.resolve(path.dirname(abs), target);
        if (!io.exists(resolved)) {
            warnings.push(`Serpent include "${target}" was not found (looked for ${resolved}).`);
            continue;
        }
        const nested = io.read(resolved);
        parts.push(`% include "${target}"  — expanded by OWEN`);
        parts.push(marker('begin', resolved).trim());
        parts.push(expandSerpent(resolved, nested, io, visiting, files, warnings, `included by ${path.basename(abs)}`).replace(/\s+$/, ''));
        parts.push(marker('end', resolved).trim());
    }
    visiting.delete(abs);
    return parts.join('\n');
}

function collectPythonImports(
    filePath: string,
    text: string,
    io: ProjectFs,
    seen: Set<string>,
    files: ProjectFile[],
    warnings: string[],
): string[] {
    const abs = path.resolve(filePath);
    if (seen.has(abs)) return [];
    seen.add(abs);
    const dir = path.dirname(abs);
    const chunks: string[] = [];
    for (const m of text.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm)) {
        const mod = (m[1] ?? m[2]).split('.')[0];
        if (!mod || PY_STDLIB.has(mod)) continue;
        const candidates = [path.join(dir, `${mod}.py`), path.join(dir, mod, '__init__.py')];
        const hit = candidates.find((c) => io.exists(c));
        if (!hit) continue;
        const nested = io.read(hit);
        files.push({ path: path.resolve(hit), role: `imported module ${mod}` });
        chunks.push(...collectPythonImports(hit, nested, io, seen, files, warnings));
        chunks.push(`# ----- OWEN import begin ${path.basename(hit)} -----\n${nested}\n# ----- OWEN import end ${path.basename(hit)} -----`);
    }
    void warnings;
    return chunks;
}

function openmcXmlFromDir(dir: string, io: ProjectFs, files: ProjectFile[]): string | undefined {
    // OpenMC runs model.xml when it exists and ignores the split files.
    const modelPath = path.join(dir, 'model.xml');
    if (io.exists(modelPath)) {
        files.push({ path: path.resolve(modelPath), role: 'model.xml' });
        const model = io.read(modelPath);
        const matsPath = path.join(dir, 'materials.xml');
        if (io.exists(matsPath) && !/<materials[\s>]/i.test(model)) {
            files.push({ path: path.resolve(matsPath), role: 'materials.xml' });
            return `${io.read(matsPath)}\n${model}`;
        }
        return model;
    }
    const geomPath = path.join(dir, 'geometry.xml');
    if (!io.exists(geomPath)) return undefined;
    files.push({ path: path.resolve(geomPath), role: 'geometry.xml' });
    const geom = io.read(geomPath);
    const matsPath = path.join(dir, 'materials.xml');
    if (io.exists(matsPath)) {
        files.push({ path: path.resolve(matsPath), role: 'materials.xml' });
        return `${io.read(matsPath)}\n${geom}`;
    }
    return geom;
}

/**
 * Resolve the project rooted at `rootPath` into one geometry-ready string.
 */
export function resolveProject(opts: ResolveProjectOptions): ResolvedProject {
    const io = opts.fs ?? nodeProjectFs;
    const rootPath = path.resolve(opts.rootPath);
    const warnings: string[] = [];
    const files: ProjectFile[] = [];
    const onDisk = io.exists(rootPath) ? io.read(rootPath) : '';
    const rootText = opts.rootText !== undefined ? opts.rootText : onDisk;
    const language = opts.language;

    if (language === 'mcnp') {
        const text = ensureMcnpTitle(expandMcnp(rootPath, rootText, io, new Set(), files, warnings, 'root deck'));
        return { language, rootPath, text, files, warnings };
    }
    if (language === 'serpent') {
        const text = expandSerpent(rootPath, rootText, io, new Set(), files, warnings, 'root deck');
        return { language, rootPath, text, files, warnings };
    }
    if (language === 'scone') {
        files.push({ path: rootPath, role: 'SCONE input' });
        return { language, rootPath, text: rootText, files, warnings };
    }

    // OpenMC: XML in the buffer, sibling XML, or Python (+ local imports).
    files.push({ path: rootPath, role: looksLikeOpenmcXml(rootText) ? 'OpenMC XML' : 'OpenMC Python model' });
    const dir = path.dirname(rootPath);
    if (looksLikeOpenmcXml(rootText)) {
        const matsPath = path.join(dir, 'materials.xml');
        let text = rootText;
        if (!/<materials[\s>]/i.test(rootText) && io.exists(matsPath)) {
            files.push({ path: path.resolve(matsPath), role: 'materials.xml' });
            text = `${io.read(matsPath)}\n${rootText}`;
        }
        return { language, rootPath, text, xmlText: text, files, warnings };
    }

    const importChunks = collectPythonImports(rootPath, rootText, io, new Set(), files, warnings);
    const text = importChunks.length
        ? `${importChunks.join('\n\n')}\n\n# ----- OWEN root ${path.basename(rootPath)} -----\n${rootText}`
        : rootText;
    const xmlText = openmcXmlFromDir(dir, io, files);
    if (xmlText) {
        warnings.push('OpenMC geometry is taken from the exported XML next to this script (model.xml if present, else geometry.xml).');
    }
    return { language, rootPath, text, xmlText, files, warnings };
}

export function nodeFsFromDisk(): ProjectFs {
    return nodeProjectFs;
}
