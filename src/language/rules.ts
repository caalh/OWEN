/**
 * All OWEN validation rules as pure functions: text in, PlainDiagnostic[] out.
 *
 * This is the single source of truth for diagnostics. Both consumers call it:
 *   - the LSP server (owen/server/src/server.ts) — real-time, on-type;
 *   - the legacy `owen.validateInput` command (src/validation/validator.ts).
 * Behavior is a 1:1 port of the old regex validator (same codes, same
 * messages) plus the MCNP line-length rule that previously lived only in the
 * decoration layer. MCNP cross-reference diagnostics are in
 * `crossReference.ts` (they need the references index).
 *
 * No `vscode` / `vscode-languageserver` imports — headless-testable.
 */

import { findOverlengthLines, MCNP_DEFAULT_LINE_LIMIT } from '../decorations/lineLength';
import { PlainDiagnostic, PlainSeverity, RulesLanguage, RulesOptions } from './types';

export function runLanguageRules(
    lang: RulesLanguage | null,
    text: string,
    options: RulesOptions = {},
): PlainDiagnostic[] {
    const diags: PlainDiagnostic[] = [];
    switch (lang) {
        case 'mcnp':
            validateMCNP(text, diags, options);
            break;
        case 'openmc':
            validateOpenMC(text, diags);
            break;
        case 'serpent':
            validateSerpent(text, diags);
            break;
        case 'scone':
            validateSCONE(text, diags);
            break;
        default:
            break;
    }
    return diags;
}

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

function push(
    diags: PlainDiagnostic[],
    line: number,
    startCol: number,
    endCol: number,
    message: string,
    severity: PlainSeverity,
    code: string,
): void {
    diags.push({ line, startCol, endCol, message, severity, code });
}

function pushLine(
    diags: PlainDiagnostic[],
    lines: string[],
    i: number,
    message: string,
    severity: PlainSeverity,
    code: string,
): void {
    push(diags, i, 0, lines[i]?.length ?? 0, message, severity, code);
}

function isCommentLine(line: string, lang: 'mcnp' | 'serpent' | 'scone'): boolean {
    const trimmed = line.trimStart();
    if (lang === 'mcnp') return /^c(\s|$)/i.test(trimmed);
    if (lang === 'serpent') return trimmed.startsWith('%');
    if (lang === 'scone') return trimmed.startsWith('!') || trimmed.startsWith('//');
    return false;
}

// ----------------------------------------------------------------------------
// MCNP
// ----------------------------------------------------------------------------

const ZAID_RE = /\b(\d{4,6})\.(\d{2})([cnpht])\b/g;
const MATERIAL_HEADER_RE = /^\s*m(\d+)\s+/i;
const MT_CARD_RE = /^\s*mt(\d+)\s+/i;
const CELL_CARD_RE = /^\s*(\d+)\s+(\d+|0)\s+(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)?\s+/;
const MACROBODY_RE = /^\s*(\d+)\s+(\*?)(rpp|rcc|rhp|box|hex|cyl|sph|rec|trc|ell|wed|arb)\b/i;

const MACROBODY_PARAM_COUNTS: Record<string, number> = {
    rpp: 6,
    rcc: 7,
    rhp: 15,
    box: 12,
};

function validateMCNP(text: string, diags: PlainDiagnostic[], options: RulesOptions): void {
    const lines = text.split(/\r?\n/);
    let densityNoteIssued = false;

    interface MatHeader { line: number; matNum: string; zaids: string[]; signs: Set<'+' | '-'>; }
    const materials = new Map<string, MatHeader>();
    let activeMat: MatHeader | null = null;

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = raw.trim();
        if (trimmed === '' || isCommentLine(raw, 'mcnp')) {
            if (trimmed === '') activeMat = null;
            continue;
        }

        const mHead = raw.match(MATERIAL_HEADER_RE);
        if (mHead) {
            activeMat = { line: i, matNum: mHead[1], zaids: [], signs: new Set() };
            materials.set(mHead[1], activeMat);
        } else if (activeMat && !/^\s/.test(raw)) {
            // A new card starting at column 1 (cell, surface, fmesh, kcode, …)
            // ends the material; only indented continuation lines extend it.
            // Without this, e.g. `fmesh4:n … origin=-182.78` following an mN
            // card fed its numbers into the sign check (false material-sign
            // errors on the bundled BEAVRS deck).
            activeMat = null;
        }

        if (activeMat) {
            let zm: RegExpExecArray | null;
            ZAID_RE.lastIndex = 0;
            while ((zm = ZAID_RE.exec(raw)) !== null) {
                activeMat.zaids.push(zm[1]);
            }
            // Fraction signs: whole whitespace-delimited tokens only. A ZAID
            // like `40000.80c` must not partially match as a positive number
            // (that made every all-negative weight-fraction material look
            // "mixed"), so skip ZAID/library tokens and require the token to
            // be a complete standalone number.
            const NUMBER_TOKEN = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
            const toks = raw.trim().split(/\s+/);
            for (let t = 0; t < toks.length; t++) {
                const tok = toks[t];
                if (t === 0 && MATERIAL_HEADER_RE.test(tok + ' ')) continue; // mN header
                if (/^\d{1,6}\.\d{2}[a-z]$/i.test(tok)) continue; // ZAID.TTc
                if (!NUMBER_TOKEN.test(tok)) continue;
                if (tok.startsWith('-')) activeMat.signs.add('-');
                else activeMat.signs.add('+');
            }
        }

        ZAID_RE.lastIndex = 0;
        const tokens = raw.split(/\s+/);
        for (const tok of tokens) {
            if (/^\d{4,6}\.[A-Za-z0-9]+/.test(tok) && !/^\d{4,6}\.\d{2}[cnpht]$/.test(tok)) {
                pushLine(diags, lines, i,
                    `Invalid ZAID '${tok}'. Expected ZAAA.TTc (e.g. 92235.80c).`,
                    'warning',
                    'mcnp.zaid');
            }
        }

        const macro = raw.match(MACROBODY_RE);
        if (macro) {
            const kind = macro[3].toLowerCase();
            if (kind === 'hex') {
                pushLine(diags, lines, i,
                    'Macrobody "HEX" is not an MCNP keyword — use "RHP" (right hexagonal prism).',
                    'error',
                    'mcnp.macrobody');
            } else if (kind === 'cyl') {
                pushLine(diags, lines, i,
                    'Macrobody "CYL" is not an MCNP keyword — use "RCC" (right circular cylinder).',
                    'error',
                    'mcnp.macrobody');
            } else if (kind in MACROBODY_PARAM_COUNTS) {
                const expected = MACROBODY_PARAM_COUNTS[kind];
                const idIdx = tokens.findIndex((t) => /^\d+$/.test(t));
                const params = tokens
                    .slice(idIdx + 1)
                    .filter((t) => /^[-+]?\d/.test(t));
                if (params.length > 0 && params.length !== expected) {
                    pushLine(diags, lines, i,
                        `${kind.toUpperCase()} expects ${expected} parameters but found ${params.length}.`,
                        'warning',
                        'mcnp.macrobody-params');
                }
            }
        }

        const cell = raw.match(CELL_CARD_RE);
        if (cell && !macro && !mHead && !MT_CARD_RE.test(raw) && !/^\s*\*/.test(raw)) {
            const mat = cell[2];
            const density = cell[3];
            if (mat !== '0' && density && !densityNoteIssued) {
                pushLine(diags, lines, i,
                    'MCNP density sign convention: negative = g/cm³, positive = atoms/barn-cm. (informational, shown once)',
                    'information',
                    'mcnp.density-sign');
                densityNoteIssued = true;
            }
            if (!/imp:n/i.test(raw) && !cellContinuesToImp(lines, i)) {
                pushLine(diags, lines, i,
                    `Cell ${cell[1]} is missing imp:n=… — particles entering this cell may be killed.`,
                    'warning',
                    'mcnp.cell-imp');
            }
        }
    }

    for (const mat of materials.values()) {
        if (mat.signs.has('+') && mat.signs.has('-')) {
            push(diags, mat.line, 0, lines[mat.line]?.length ?? 0,
                `Material m${mat.matNum} mixes positive and negative fractions — keep consistent (positive=atom, negative=weight).`,
                'error',
                'mcnp.material-sign');
        }
    }

    for (let i = 0; i < lines.length; i++) {
        const mt = lines[i].match(MT_CARD_RE);
        if (!mt) continue;
        const matNum = mt[1];
        const mat = materials.get(matNum);
        if (!mat) {
            pushLine(diags, lines, i,
                `mt${matNum} references material m${matNum} which is not defined above it.`,
                'error',
                'mcnp.mt-missing-material');
            continue;
        }
        const hasH = mat.zaids.some((z) => z.startsWith('1001') || z.startsWith('1002'));
        if (!hasH) {
            pushLine(diags, lines, i,
                `mt${matNum} (S(α,β) thermal scattering) requires hydrogen in m${matNum}. ` +
                'S(α,β) thermal scattering only applies to hydrogen-bearing materials.',
                'error',
                'mcnp.sab-no-h');
        }
    }

    // Line-length rule (same math as the editor decoration in
    // decorations/lineLength.ts so the two can never disagree).
    const limit = options.mcnpLineLimit && options.mcnpLineLimit > 0
        ? Math.floor(options.mcnpLineLimit)
        : MCNP_DEFAULT_LINE_LIMIT;
    for (const o of findOverlengthLines(text, limit)) {
        push(diags, o.line, o.startCol, o.rawLength,
            `MCNP card image exceeds ${limit} columns (line is ${o.expandedLength} columns after tab expansion). ` +
            `Characters past column ${limit} are silently ignored by MCNP — split onto a continuation line.`,
            'warning',
            'mcnp.line-length');
    }
}

function cellContinuesToImp(lines: string[], start: number): boolean {
    for (let i = start + 1; i < Math.min(lines.length, start + 5); i++) {
        const l = lines[i];
        if (l.trim() === '') return false;
        if (/^\s{5,}/.test(l) && /imp:n/i.test(l)) return true;
        if (/^\s{5,}/.test(l)) continue;
        return false;
    }
    return false;
}

// ----------------------------------------------------------------------------
// OpenMC
// ----------------------------------------------------------------------------

function validateOpenMC(text: string, diags: PlainDiagnostic[]): void {
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (/openmc\.Source\s*\(/.test(line)) {
            pushLine(diags, lines, i,
                'openmc.Source() is removed — use openmc.IndependentSource(...) (or openmc.FileSource/CompiledSource).',
                'error',
                'openmc.source');
        }

        if (/openmc\.model\.rectangular_prism\s*\(/.test(line)) {
            pushLine(diags, lines, i,
                'openmc.model.rectangular_prism() is deprecated — use openmc.model.RectangularPrism(width=..., height=...).',
                'warning',
                'openmc.rectprism');
        }

        if (/Material\s*\([^)]*temperature\s*=/.test(line)) {
            pushLine(diags, lines, i,
                'Temperature is set on cells in OpenMC, not on Material. Set cell.temperature = T instead.',
                'error',
                'openmc.mat-temperature');
        }

        if (/\.run\s*\(\s*openmc_exec_kwargs\s*=/.test(line)) {
            pushLine(diags, lines, i,
                'openmc_exec_kwargs= is deprecated — pass threads= (and other args) directly to model.run(threads=N).',
                'warning',
                'openmc.exec-kwargs');
        }

        const runMatch = line.match(/(\w+)\s*=\s*[\w.]*\.run\s*\(/);
        if (runMatch) {
            const varName = runMatch[1];
            for (let j = i + 1; j < Math.min(lines.length, i + 25); j++) {
                if (new RegExp(`\\b${varName}\\b\\.(?:keff|k_combined|tallies|filters|source)`).test(lines[j])) {
                    pushLine(diags, lines, j,
                        `model.run() returns a Path, not a StatePoint. Open it: \`with openmc.StatePoint(${varName}) as sp:\`.`,
                        'error',
                        'openmc.run-return');
                    break;
                }
            }
        }
    }
}

// ----------------------------------------------------------------------------
// Serpent
// ----------------------------------------------------------------------------

function validateSerpent(text: string, diags: PlainDiagnostic[]): void {
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isCommentLine(line, 'serpent')) continue;

        if (/^\s*surf\b[^%]*\brect\b/.test(line)) {
            pushLine(diags, lines, i,
                'Serpent surface type "rect" is not standard — use "cuboid" for a rectangular parallelepiped.',
                'error',
                'serpent.surf-rect');
        }

        if (/^\s*trcl\b/.test(line)) {
            pushLine(diags, lines, i,
                '"trcl" is MCNP syntax. In Serpent, define a coordinate transformation via "trans s ID …".',
                'error',
                'serpent.trcl');
        }

        if (/^\s*set\s+omp\b/.test(line)) {
            pushLine(diags, lines, i,
                '"set omp" is not a Serpent input keyword — pass -omp N on the sss2 CLI instead.',
                'warning',
                'serpent.set-omp');
        }

        const egrid = line.match(/^\s*set\s+egrid\b\s*([\s\S]+)/i);
        if (egrid) {
            const nums = egrid[1].split(/\s+/).map((t) => parseFloat(t)).filter((n) => !isNaN(n));
            if (nums.some((n) => n > 100)) {
                pushLine(diags, lines, i,
                    'Serpent "set egrid" energies are MeV. Values >100 look like eV — convert (e.g. 0.625 eV = 0.625E-6 MeV).',
                    'warning',
                    'serpent.egrid-units');
            }
        }
    }
}

// ----------------------------------------------------------------------------
// SCONE
// ----------------------------------------------------------------------------

const SCONE_TEMP_TO_SUFFIX: Record<string, string> = {
    '300': '.03',
    '600': '.06',
    '900': '.09',
    '1200': '.12',
};

function validateSCONE(text: string, diags: PlainDiagnostic[]): void {
    const lines = text.split(/\r?\n/);

    interface Block { name: string; type: string | null; temp: string | null; radii: number[] | null; fills: string[] | null; startLine: number; }
    const blockStack: Block[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        for (let c = 0; c < line.length; c++) {
            const code = line.charCodeAt(c);
            if (code > 127) {
                push(diags, i, c, c + 1,
                    `Non-ASCII character (U+${code.toString(16).toUpperCase().padStart(4, '0')}) — SCONE expects 7-bit ASCII.`,
                    'error',
                    'scone.non-ascii');
                break;
            }
        }

        if (/aceNuclearDatabase/.test(line)) {
            const col = line.indexOf('aceNuclearDatabase');
            push(diags, i, col, col + 'aceNuclearDatabase'.length,
                'Typo: should be "aceNeutronDatabase" (Neutron, not Nuclear).',
                'error',
                'scone.ace-typo');
        }

        if (isCommentLine(line, 'scone')) continue;

        const blockMatch = line.match(/^\s*([A-Za-z_][\w]*)\s*\{/);
        if (blockMatch) {
            blockStack.push({
                name: blockMatch[1],
                type: null,
                temp: null,
                radii: null,
                fills: null,
                startLine: i,
            });
        }

        if (blockStack.length > 0) {
            const top = blockStack[blockStack.length - 1];
            const typeM = line.match(/\btype\s+(\w+)/);
            if (typeM) top.type = typeM[1];
            const tempM = line.match(/\btemp\s+(\d+)/);
            if (tempM) top.temp = tempM[1];
            const radiiM = line.match(/\bradii\s*\(([^)]*)\)/);
            if (radiiM) top.radii = radiiM[1].split(/\s+/).map(parseFloat).filter((n) => !isNaN(n));
            const fillsM = line.match(/\bfills\s*\(([^)]*)\)/);
            if (fillsM) top.fills = fillsM[1].split(/\s+/).filter(Boolean);
        }

        const closeIdx = line.indexOf('}');
        if (closeIdx >= 0 && blockStack.length > 0) {
            const closed = blockStack.pop()!;

            if (closed.type === 'pinUniverse') {
                if (closed.radii && closed.fills) {
                    if (closed.radii.length !== closed.fills.length) {
                        push(diags, closed.startLine, 0, lines[closed.startLine].length,
                            `pinUniverse "${closed.name}": radii has ${closed.radii.length} entries but fills has ${closed.fills.length}; lengths must match.`,
                            'error',
                            'scone.pin-len');
                    }
                    if (closed.radii.length > 0 && closed.radii[closed.radii.length - 1] !== 0.0) {
                        push(diags, closed.startLine, 0, lines[closed.startLine].length,
                            `pinUniverse "${closed.name}": outermost radii value must be 0.0 to mark the infinite outer region.`,
                            'error',
                            'scone.pin-outer');
                    }
                }
            }

            if (closed.temp && Object.prototype.hasOwnProperty.call(SCONE_TEMP_TO_SUFFIX, closed.temp)) {
                const expectedSuffix = SCONE_TEMP_TO_SUFFIX[closed.temp];
                const body = lines.slice(closed.startLine, i + 1).join('\n');
                const zaids = Array.from(body.matchAll(/\b\d{4,6}\.(\d{2})\b/g));
                for (const z of zaids) {
                    const suffix = '.' + z[1];
                    if (suffix !== expectedSuffix) {
                        push(diags, closed.startLine, 0, lines[closed.startLine].length,
                            `Material "${closed.name}" has temp ${closed.temp} but ZAID suffix ${suffix} doesn't match expected ${expectedSuffix}.`,
                            'warning',
                            'scone.temp-zaid');
                        break;
                    }
                }
            }
        }
    }

    let braceDepth = 0;
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const code = raw.split(/!|\/\//)[0];
        for (const ch of code) {
            if (ch === '{') braceDepth++;
            else if (ch === '}') braceDepth--;
        }
        const trimmed = code.trim();
        if (!trimmed) continue;
        if (/^[A-Za-z_][\w]*\s*\{/.test(trimmed)) continue;
        if (trimmed === '}' || trimmed.startsWith('}')) continue;
        if (braceDepth === 0) {
            if (!trimmed.endsWith(';') && !trimmed.endsWith('{') && !trimmed.endsWith('}')) {
                pushLine(diags, lines, i,
                    'SCONE statements outside blocks must end with ";".',
                    'warning',
                    'scone.semicolon');
            }
        }
    }
}
