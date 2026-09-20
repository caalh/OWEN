#!/usr/bin/env node
/**
 * Headless stand-in for the three clicks Lubomír actually used:
 * Cell Map, Check Geometry, 3D preview — plus workspace, volumes, convert.
 *
 *   npm run verify:field-corpus
 *
 * Needs `tsc -p .` first (the npm script does that). GitHub decks live in
 * `.field-corpus/cache/` after `npm run field-corpus:fetch`.
 *
 * Tier-1 `gate: true` decks must not grow unknown-universe, placeholder-pin,
 * or empty-map failures. Tier-2 / ungated decks are report-only.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'src', 'test', 'field-corpus', 'manifest.json'), 'utf8'));
const cacheRoot = path.join(root, '.field-corpus', 'cache');
const reportRoot = path.join(root, '.field-corpus', 'report');
const PNG_DIR = path.join(reportRoot, 'slices');

const { resolveProject, nodeProjectFs } = require(path.join(root, 'out', 'src', 'util', 'projectLoader.js'));
const { parseDeckToModel } = require(path.join(root, 'out', 'src', 'preview', 'engineDispatch.js'));
const { parseMcnpGeometry } = require(path.join(root, 'out', 'src', 'preview', 'mcnpGeometry.js'));
const { looksLikeOpenmcXml, parseOpenmcGeometryXml } = require(path.join(root, 'out', 'src', 'preview', 'openmcGeometry.js'));
const { buildCellMap } = require(path.join(root, 'out', 'src', 'cellmap', 'model.js'));
const { buildCellMapFromGeometry } = require(path.join(root, 'out', 'src', 'cellmap', 'fromGeometry.js'));
const { checkGeometry, estimateVolumes } = require(path.join(root, 'out', 'src', 'geomcheck', 'core.js'));
const { buildScene } = require(path.join(root, 'out', 'src', 'preview', 'extractor.js'));
const { OPENMC_PLACEHOLDER_WARNING } = require(path.join(root, 'out', 'src', 'preview', 'codes', 'openmc.js'));
const { validateWorkspace } = require(path.join(root, 'out', 'src', 'workspace', 'core.js'));
const { convert } = require(path.join(root, 'out', 'src', 'converter', 'index.js'));
const { worldBounds } = require(path.join(root, 'out', 'src', 'preview', 'mcnpEvaluate.js'));
const { axisPlane, sliceModel, sliceToRgba } = require(path.join(root, 'out', 'src', 'preview', 'slice.js'));
const { PNG } = require('pngjs');

const UNKNOWN_RE = /no cell declares|never defined in this file|which no cell\/pin\/lat defines|which is not defined|fills universe/;
const ORPHAN_RE = /nothing fills it/;
const PLACEHOLDER_RE = /placeholder, not your model|missing pin universes/;

function nodeWsFs() {
    return {
        exists: (p) => { try { return fs.existsSync(p); } catch { return false; } },
        read: (p) => fs.readFileSync(p, 'utf8'),
        list: (d) => { try { return fs.readdirSync(d); } catch { return []; } },
        mtime: (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } },
    };
}

function entryPath(deck) {
    const cached = path.join(cacheRoot, deck.id);
    if (deck.kind === 'local') {
        const local = path.join(root, deck.path);
        if (fs.existsSync(local)) return local;
    }
    if (deck.kind === 'sibling') {
        const sib = path.resolve(root, deck.path);
        if (fs.existsSync(sib)) return sib;
    }
    if (fs.existsSync(cached)) {
        if (deck.entry) {
            const named = path.join(cached, path.basename(deck.entry));
            if (fs.existsSync(named)) return named;
        }
        const files = fs.readdirSync(cached).filter((n) => /\.(i|inp|sss|serp|scone|xml|py)$/i.test(n));
        const prefer = files.find((n) => /^main\.|^geometry\.|^model\.|^build_/.test(n)) ?? files[0];
        if (prefer) return path.join(cached, prefer);
    }
    return null;
}

function workspaceLanguage(code, filePath) {
    if (code === 'openmc' && /\.xml$/i.test(filePath)) return 'openmc-xml';
    return code;
}

function parseMap(text, code, project) {
    const joined = project?.xmlText ?? project?.text ?? text;
    if (code === 'mcnp') {
        if (project && project.files.length > 1) {
            return buildCellMapFromGeometry(parseMcnpGeometry(project.text), 'mcnp');
        }
        return buildCellMap(joined);
    }
    if (code === 'openmc') {
        const xml = project?.xmlText ?? (looksLikeOpenmcXml(joined) ? joined : null);
        if (xml) return buildCellMapFromGeometry(parseOpenmcGeometryXml(xml), 'openmc');
        const geom = parseDeckToModel(joined, 'openmc');
        if (geom && geom.cells.size) return buildCellMapFromGeometry(geom, 'openmc');
        return { language: 'openmc', cells: [], universes: [], edges: [], warnings: ['OpenMC Python: no sibling XML; Cell Map waits on export.'], stats: { cells: 0, universes: 0, maxDepth: 0, graveyards: 0 } };
    }
    const geom = parseDeckToModel(joined, code);
    if (!geom || !geom.cells.size) {
        return { language: code, cells: [], universes: [], edges: [], warnings: geom?.warnings ?? ['No cells parsed.'], stats: { cells: 0, universes: 0, maxDepth: 0, graveyards: 0 } };
    }
    return buildCellMapFromGeometry(geom, code);
}

function parseGeom(text, code, project) {
    const xml = project?.xmlText;
    if (code === 'openmc' && xml) return parseOpenmcGeometryXml(xml);
    const joined = project?.text ?? text;
    return parseDeckToModel(joined, code);
}

function writeSlicePng(model, outPath) {
    const b = worldBounds(model);
    const half = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], 2) / 2;
    const z = (b.min[2] + b.max[2]) / 2;
    const width = 240;
    const req = {
        plane: axisPlane('xy', z),
        halfU: half, halfV: half,
        centerU: (b.min[0] + b.max[0]) / 2,
        centerV: (b.min[1] + b.max[1]) / 2,
        width, height: width, colorBy: 'material', samples: 1,
    };
    const result = sliceModel(model, req);
    const rgba = sliceToRgba(result, { edges: true, edgeStrength: 0.45 });
    const png = new PNG({ width: result.width, height: result.height });
    Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength).copy(png.data);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, PNG.sync.write(png));
    return { lost: result.lostCount, overlap: result.overlapCount, pixels: result.width * result.height };
}

function convertSmoke(code, text) {
    if (code === 'mcnp') {
        try { const r = convert('mcnp', 'openmc', text); return { ok: true, issues: r.issues.length }; }
        catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
    }
    try {
        const r = convert(code, 'mcnp', text);
        return { ok: true, issues: r.issues.length };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

function gateFail(deck, row) {
    if (deck.tier !== 1 || deck.gate === false) return null;
    const expect = deck.expect ?? {};
    if (row.blocked) return null;
    const hasExpectedWarning = expect.warning && row.warnings.some((w) => new RegExp(expect.warning, 'i').test(w));
    if (!expect.allowEmptyMap && row.mapCells === 0 && !hasExpectedWarning) return 'empty-map';
    if (!expect.allowPlaceholder && row.placeholder) return 'placeholder-pin';
    const unexpectedUnknown = row.unknownUniverse.filter((w) => {
        const id = Number((/u=(\d+)/.exec(w) ?? [])[1]);
        return !(expect.allowOrphanIds ?? []).includes(id);
    });
    if (unexpectedUnknown.length) return 'unknown-universe';
    if (expect.warning && !hasExpectedWarning) return `missing-expected-warning:${expect.warning}`;
    // Check Geometry / slice that lose every point: the parsed geometry
    // places nothing. That is the "1500 of 1500 lost" a user calls broken.
    if (row.checkSamples && row.checkLost !== null && row.checkLost >= row.checkSamples) return 'false-lost:check-geometry';
    if (row.slice && !row.slice.error && row.slice.pixels && row.slice.lost > 0.9 * row.slice.pixels) return 'false-lost:slice';
    // 3D drew nothing for a deck that parsed cells.
    if (!expect.allowEmptyCylinders && row.geomCells > 0 && row.cylinders === 0 && !hasExpectedWarning) return 'empty-3d';
    // Every cell in an unexpanded construct / no cell region → honest skip, but
    // a deck that parses to a single region-less cell is also a parse failure.
    if (row.geomCells > 0 && row.regionlessCells === row.geomCells && !hasExpectedWarning && !expect.allowEmptyCylinders) return 'no-regions';
    // Orphans the deck itself does not document are false orphans unless the
    // manifest lists them (BEAVRS MCNP u=16 is real dead input).
    const badOrphans = row.orphans.filter((w) => {
        const id = Number((/Universe (\d+)/.exec(w) ?? [])[1]);
        return !(expect.allowOrphanIds ?? []).includes(id);
    });
    if (badOrphans.length && !expect.allowOrphans) return 'unexpected-orphan';
    return null;
}

function runDeck(deck) {
    const file = entryPath(deck);
    if (!file) return { id: deck.id, skipped: true, reason: 'not fetched (run npm run field-corpus:fetch)' };
    const text = fs.readFileSync(file, 'utf8');
    const code = deck.code;
    let project = null;
    try {
        project = resolveProject({ rootPath: file, language: code, rootText: text, fs: nodeProjectFs });
    } catch (err) {
        project = { text, files: [], warnings: [`resolveProject: ${err instanceof Error ? err.message : err}`] };
    }
    const joined = project?.xmlText ?? project?.text ?? text;
    const warnings = [...(project?.warnings ?? [])];
    const map = parseMap(text, code, project);
    warnings.push(...(map.warnings ?? []));
    const geom = parseGeom(text, code, project);
    if (geom?.warnings) warnings.push(...geom.warnings);
    const scene = buildScene(joined, code);
    warnings.push(...(scene.warnings ?? []));

    let check = null;
    if (geom && geom.cells.size && !deck.skipGeomCheck) {
        check = checkGeometry(geom, { samples: deck.samples ?? 400, seed: 3 });
    }
    let volumes = null;
    if (geom && geom.cells.size && (deck.samples ?? 400) <= 800 && geom.cells.size < 80) {
        try { volumes = estimateVolumes(geom, { samples: 400, seed: 3 }); }
        catch (err) { volumes = { error: err instanceof Error ? err.message : String(err) }; }
    }

    let workspace = null;
    try {
        workspace = validateWorkspace({
            language: workspaceLanguage(code, file),
            rootPath: file,
            fs: nodeWsFs(),
        });
    } catch (err) {
        workspace = { error: err instanceof Error ? err.message : String(err) };
    }

    const conversion = deck.skipSlice || deck.skipGeomCheck ? { ok: true, skipped: true } : convertSmoke(code, joined);
    let slice = null;
    if (!deck.skipSlice && geom && geom.cells.size && fs.statSync(file).size < 400_000) {
        try {
            slice = writeSlicePng(geom, path.join(PNG_DIR, `${deck.id}.png`));
        } catch (err) {
            slice = { error: err instanceof Error ? err.message : String(err) };
        }
    }

    const unknownUniverse = warnings.filter((w) => UNKNOWN_RE.test(w) && !ORPHAN_RE.test(w));
    const orphans = warnings.filter((w) => ORPHAN_RE.test(w));
    const placeholder = (scene.warnings ?? []).includes(OPENMC_PLACEHOLDER_WARNING)
        || (scene.warnings ?? []).some((w) => PLACEHOLDER_RE.test(w) && scene.cylinders.length <= 2);
    const threeD = scene.cylinders.length === 0
        ? (placeholder ? 'placeholder' : 'empty')
        : (scene.notes ?? []).some((n) => /Exact/i.test(n)) ? 'csg' : 'extractor';

    const row = {
        id: deck.id,
        code,
        file,
        tags: deck.tags ?? [],
        filesJoined: (project?.files ?? []).map((f) => path.basename(f.path)),
        mapCells: map.cells?.length ?? 0,
        mapUniverses: map.universes?.length ?? 0,
        geomCells: geom?.cells?.size ?? 0,
        regionlessCells: geom ? [...geom.cells.values()].filter((c) => !c.region).length : 0,
        cylinders: scene.cylinders.length,
        threeD,
        placeholder,
        unknownUniverse,
        orphans,
        checkLost: check?.world?.lost ?? null,
        checkSamples: check?.world?.samples ?? null,
        checkOverlaps: check?.overlaps?.length ?? null,
        volumesOk: volumes && !volumes.error,
        workspaceErrors: workspace?.summary?.errors ?? (workspace?.error ? 1 : 0),
        workspaceMessages: workspace?.error
            ? [workspace.error]
            : (workspace?.diagnostics ?? []).filter((d) => d.severity === 'error').slice(0, 6).map((d) => `${path.basename(d.file)}:${d.line + 1} ${d.message}`),
        conversion,
        slice,
        warnings: [...new Set(warnings)].slice(0, 12),
        blocked: code === 'openmc' && !project?.xmlText && !looksLikeOpenmcXml(joined) && (map.cells?.length ?? 0) === 0
            ? 'no-openmc-xml'
            : null,
    };
    row.gate = gateFail(deck, row);
    return row;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function htmlReport(rows) {
    const tr = rows.map((r) => {
        const cls = r.skipped ? 'skip' : r.gate ? 'fail' : 'ok';
        return `<tr class="${cls}"><td>${r.id}</td><td>${r.code}</td><td>${r.skipped ? r.reason : (r.gate ?? 'ok')}</td>
<td>${r.mapCells ?? ''}</td><td>${r.mapUniverses ?? ''}</td><td>${r.geomCells ?? ''}</td>
<td>${r.cylinders ?? ''} ${r.threeD ?? ''}</td><td>${r.checkLost ?? ''}/${r.checkSamples ?? ''}</td>
<td>${(r.unknownUniverse ?? []).length}</td><td>${r.blocked ?? ''}</td>
<td>${r.workspaceErrors ?? ''}${(r.workspaceMessages ?? []).length ? `<div class="msg">${r.workspaceMessages.map((m) => esc(m)).join('<br>')}</div>` : ''}</td>
<td>${(r.warnings ?? []).length ? `<div class="msg">${r.warnings.slice(0, 6).map((m) => esc(m)).join('<br>')}</div>` : ''}</td>
<td>${r.slice && !r.slice.error ? `<img src="slices/${r.id}.png" width="80" alt="">` : ''}</td></tr>`;
    }).join('\n');
    return `<!doctype html><meta charset="utf-8"><title>OWEN field corpus</title>
<style>
 body { font: 13px/1.4 system-ui, sans-serif; margin: 24px; background: #0b1020; color: #e8e6e3; }
 table { border-collapse: collapse; width: 100%; }
 th, td { border-bottom: 1px solid #2a3148; padding: 4px 8px; text-align: left; vertical-align: top; }
 .fail { background: #3a1520; } .skip { opacity: .6; } .ok td:nth-child(3) { color: #7dce7a; }
 img { image-rendering: pixelated; background: #111; }
 .msg { font-size: 11px; opacity: .8; max-width: 420px; }
</style>
<h1>OWEN field corpus</h1>
<p>${rows.filter((r) => r.gate).length} gate failure(s) · ${rows.filter((r) => r.skipped).length} skipped · ${rows.length} decks</p>
<table><thead><tr><th>id</th><th>code</th><th>gate</th><th>map cells</th><th>U</th><th>geom</th><th>3D</th><th>lost/N</th><th>unknown U</th><th>blocked</th><th>workspace errors</th><th>warnings</th><th>slice</th></tr></thead>
<tbody>${tr}</tbody></table>`;
}

function main() {
    fs.mkdirSync(PNG_DIR, { recursive: true });
    const rows = manifest.decks.map((d) => {
        const t0 = Date.now();
        try {
            const row = runDeck(d);
            row.ms = Date.now() - t0;
            console.log(`${row.gate ? 'FAIL' : row.skipped ? 'SKIP' : ' ok '} ${d.id} ${row.ms}ms ${row.gate ?? row.reason ?? `${row.mapCells} cells / ${row.cylinders} prims`}`);
            return row;
        } catch (err) {
            const row = { id: d.id, code: d.code, gate: 'throw', warnings: [err instanceof Error ? err.message : String(err)], ms: Date.now() - t0 };
            console.error(`FAIL ${d.id}: ${row.warnings[0]}`);
            return row;
        }
    });
    fs.writeFileSync(path.join(reportRoot, 'report.json'), JSON.stringify({ when: new Date().toISOString(), rows }, null, 2));
    fs.writeFileSync(path.join(reportRoot, 'index.html'), htmlReport(rows));
    const fails = rows.filter((r) => r.gate);
    console.log(`\nReport: ${path.join(reportRoot, 'index.html')}`);
    if (fails.length) {
        console.error(`${fails.length} tier-1 gate failure(s): ${fails.map((f) => `${f.id}=${f.gate}`).join(', ')}`);
        process.exit(1);
    }
}

main();
