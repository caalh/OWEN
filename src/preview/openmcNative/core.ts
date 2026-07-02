/**
 * Pure logic for the "Render with OpenMC (authoritative)" feature: interpreter
 * candidate ordering, WSL path translation, the generated Python helper
 * script, and result parsing. No `vscode` imports — everything here is
 * unit-testable headless (same pattern as `workflows/sweepCore.ts`).
 */

/** Snippet run with `python -c` to verify a candidate interpreter has OpenMC. */
export const OPENMC_PROBE_SNIPPET =
    'import openmc, sys; sys.stdout.write("OWEN_OPENMC " + str(openmc.__version__))';

/** Extracts the OpenMC version from a probe run's stdout, or null if absent. */
export function parseProbeOutput(stdout: string): string | null {
    const m = /OWEN_OPENMC\s+(\S+)/.exec(stdout);
    return m ? m[1] : null;
}

/**
 * WSL discovery: `wsl python3` alone often misses OpenMC because conda/venv
 * setups only activate in interactive shells. We probe a small fixed list of
 * common interpreter locations inside WSL and use the first that can import
 * openmc (the discovery snippet also reports which executable won).
 */
export const WSL_PYTHON_LOCATIONS = [
    'python3',
    '/opt/miniconda3/bin/python',
    '/opt/conda/bin/python',
    '$HOME/miniconda3/bin/python',
    '$HOME/anaconda3/bin/python',
    '$HOME/micromamba/bin/python',
];

export const WSL_DISCOVERY_SNIPPET =
    'import openmc, sys; sys.stdout.write("OWEN_OPENMC_PY " + sys.executable + " " + str(openmc.__version__))';

/** POSIX sh one-liner run as `wsl sh -c <script>` to find an OpenMC python. */
export function buildWslDiscoveryScript(): string {
    const locations = WSL_PYTHON_LOCATIONS.map((p) => `"${p}"`).join(' ');
    return (
        `for p in ${locations}; do ` +
        `if command -v "$p" >/dev/null 2>&1 || [ -x "$p" ]; then ` +
        `if "$p" -c '${WSL_DISCOVERY_SNIPPET}' 2>/dev/null; then exit 0; fi; ` +
        `fi; done; exit 1`
    );
}

/** Parses discovery output → the winning interpreter path + OpenMC version. */
export function parseWslDiscovery(stdout: string): { pythonPath: string; version: string } | null {
    const m = /OWEN_OPENMC_PY (.+) (\S+)\s*$/.exec(stdout);
    return m ? { pythonPath: m[1], version: m[2] } : null;
}

export type CandidateKind = 'setting' | 'ms-python' | 'path' | 'wsl';

export interface InterpreterCandidate {
    kind: CandidateKind;
    /** Executable to spawn (e.g. a python path, `python3`, or `wsl`). */
    command: string;
    /** Args inserted before the python payload (only WSL uses this: `python3`). */
    argsPrefix: string[];
    /** Human-readable description shown in messages/logs. */
    label: string;
    /** True when file paths passed to this interpreter need WSL translation. */
    needsWslPaths: boolean;
}

export interface CandidateOptions {
    /** `owen.openmc.pythonExecutable` — only when explicitly set by the user. */
    explicitSetting?: string;
    /** Interpreter selected by the ms-python extension, when available. */
    msPythonPath?: string;
    platform: NodeJS.Platform;
}

/**
 * Resolution order for finding a Python with OpenMC importable:
 *  1. explicit `owen.openmc.pythonExecutable` setting (user opted in),
 *  2. ms-python's active interpreter for the workspace,
 *  3. `python` / `python3` on PATH,
 *  4. on Windows only: `wsl python3` (OpenMC is commonly installed under WSL).
 * Duplicates (e.g. setting == ms-python path) are dropped, keeping first.
 */
export function orderCandidates(opts: CandidateOptions): InterpreterCandidate[] {
    const out: InterpreterCandidate[] = [];
    const seen = new Set<string>();
    const norm = (cmd: string) =>
        opts.platform === 'win32' ? cmd.toLowerCase().replace(/\//g, '\\') : cmd;
    const push = (c: InterpreterCandidate) => {
        const key = `${c.command === 'wsl' ? 'wsl:' : ''}${norm(c.command)}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(c);
    };

    const setting = opts.explicitSetting?.trim();
    if (setting) {
        push({
            kind: 'setting',
            command: setting,
            argsPrefix: [],
            label: `owen.openmc.pythonExecutable (${setting})`,
            needsWslPaths: false,
        });
    }
    const ms = opts.msPythonPath?.trim();
    if (ms) {
        push({
            kind: 'ms-python',
            command: ms,
            argsPrefix: [],
            label: `Python extension interpreter (${ms})`,
            needsWslPaths: false,
        });
    }
    for (const cmd of ['python', 'python3']) {
        push({ kind: 'path', command: cmd, argsPrefix: [], label: `${cmd} on PATH`, needsWslPaths: false });
    }
    if (opts.platform === 'win32') {
        // `--exec` bypasses the WSL login shell so argument quoting survives
        // intact (without it, embedded quotes in `-c` payloads get mangled).
        push({
            kind: 'wsl',
            command: 'wsl',
            argsPrefix: ['--exec', 'python3'],
            label: 'python3 under WSL',
            needsWslPaths: true,
        });
    }
    return out;
}

/**
 * Best-effort Windows → WSL path translation (`C:\a\b` → `/mnt/c/a/b`).
 * Used as a fallback when invoking `wslpath` itself fails.
 */
export function toWslPath(winPath: string): string {
    const m = /^([A-Za-z]):[\\/](.*)$/.exec(winPath);
    if (!m) return winPath.replace(/\\/g, '/');
    return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`;
}

export type SliceBasis = 'xy' | 'xz' | 'yz';

export interface PlotSpec {
    id: string;
    kind: 'slice' | 'raytrace';
    basis: SliceBasis;
    /** null → helper auto-centres on the geometry bounding box. */
    origin: [number, number, number] | null;
    /** null → helper auto-fits width to the geometry bounding box. */
    width: [number, number] | null;
    pixels: [number, number];
    colorBy: 'material' | 'cell';
}

export interface RenderRequest {
    /** Deck path as seen by the interpreter (WSL-translated when needed). */
    deckPath: string;
    /** Output dir as seen by the interpreter (WSL-translated when needed). */
    outDir: string;
    plots: PlotSpec[];
}

export function buildRenderRequest(deckPath: string, outDir: string, plots: PlotSpec[]): RenderRequest {
    return { deckPath, outDir, plots };
}

export interface RenderResultImage {
    id: string;
    kind: string;
    basis: string;
    /** Basename only — the extension joins it onto the Windows outDir. */
    file: string;
    origin: [number, number, number];
    width: [number, number];
}

export interface RenderResult {
    ok: boolean;
    version: string | null;
    modelSource: string | null;
    capabilities: { rayTrace?: boolean };
    images: RenderResultImage[];
    warnings: string[];
    error: string | null;
}

/** Parses + shape-checks the helper's owen_result.json. Throws on garbage. */
export function parseRenderResult(text: string): RenderResult {
    const raw = JSON.parse(text) as Partial<RenderResult>;
    if (typeof raw.ok !== 'boolean' || !Array.isArray(raw.images)) {
        throw new Error('owen_result.json is missing required fields');
    }
    return {
        ok: raw.ok,
        version: typeof raw.version === 'string' ? raw.version : null,
        modelSource: typeof raw.modelSource === 'string' ? raw.modelSource : null,
        capabilities: raw.capabilities && typeof raw.capabilities === 'object' ? raw.capabilities : {},
        images: raw.images.filter(
            (im): im is RenderResultImage =>
                !!im && typeof im.file === 'string' && !im.file.includes('/') && !im.file.includes('\\'),
        ),
        warnings: Array.isArray(raw.warnings) ? raw.warnings.map(String) : [],
        error: typeof raw.error === 'string' ? raw.error : null,
    };
}

/**
 * The Python helper OWEN writes to a temp dir and runs with the resolved
 * interpreter: `python owen_openmc_render.py <request.json>`.
 *
 * Design notes (version-guarded on purpose):
 * - The user's deck is executed with `runpy.run_path(run_name='__main__')`
 *   with `openmc.run` and `openmc.Model.run` monkey-patched to no-ops, so
 *   decks that end in `model.run()` never launch a transport run. The patched
 *   `Model.run` also captures the model instance for us.
 * - cwd is the throwaway output dir, so any `export_to_xml()` calls in the
 *   deck write there instead of clobbering files next to the user's deck.
 * - Rendering itself goes through the stable plots.xml + `openmc --plot`
 *   path (OpenMC's own C++ geometry kernel — the authoritative render),
 *   via `openmc.plot_geometry()` when available.
 * - `SolidRayTracePlot`/`WireframeRayTracePlot` are used only if the
 *   installed OpenMC exposes them (capability is reported back to the UI).
 * - Results are written to owen_result.json with image *basenames* so the
 *   extension can join them onto the Windows-side out dir under WSL.
 */
export function buildHelperScript(): string {
    return HELPER_SCRIPT;
}

const HELPER_SCRIPT = `# Generated by the OWEN VS Code extension ("Render with OpenMC"). Safe to delete.
import glob
import json
import os
import runpy
import sys
import traceback

RESULT = {
    'ok': False,
    'version': None,
    'modelSource': None,
    'capabilities': {},
    'images': [],
    'warnings': [],
    'error': None,
}


def finite(value, fallback):
    try:
        v = float(value)
    except Exception:
        return fallback
    if v != v or v == float('inf') or v == float('-inf'):
        return fallback
    return v


def bounds_of(geometry):
    bb = geometry.bounding_box
    lower = getattr(bb, 'lower_left', None)
    upper = getattr(bb, 'upper_right', None)
    if lower is None or upper is None:
        lower, upper = bb[0], bb[1]
    return lower, upper


def auto_view(geometry, basis):
    axes = {'xy': (0, 1), 'xz': (0, 2), 'yz': (1, 2)}[basis]
    origin = [0.0, 0.0, 0.0]
    width = [100.0, 100.0]
    if geometry is None:
        return origin, width
    try:
        lower, upper = bounds_of(geometry)
    except Exception:
        return origin, width
    extent = []
    for i in range(3):
        lo = finite(lower[i], -50.0)
        hi = finite(upper[i], 50.0)
        if hi <= lo:
            lo, hi = -50.0, 50.0
        origin[i] = (lo + hi) / 2.0
        extent.append(max(hi - lo, 0.1))
    width = [extent[axes[0]] * 1.02, extent[axes[1]] * 1.02]
    return origin, width


def convert_to_png(stem, out_dir):
    png = os.path.join(out_dir, stem + '.png')
    if os.path.exists(png):
        return stem + '.png'
    ppm = os.path.join(out_dir, stem + '.ppm')
    if os.path.exists(ppm):
        try:
            from PIL import Image
            Image.open(ppm).save(png)
            return stem + '.png'
        except Exception:
            RESULT['warnings'].append('Could not convert ' + stem + '.ppm to PNG (Pillow missing?).')
            return stem + '.ppm'
    return None


def main():
    with open(sys.argv[1], 'r') as fh:
        req = json.load(fh)
    out_dir = req['outDir']
    try:
        render(req, out_dir)
        RESULT['ok'] = len(RESULT['images']) > 0
        if not RESULT['ok'] and RESULT['error'] is None:
            RESULT['error'] = 'OpenMC produced no plot images. ' + chr(10).join(RESULT['warnings'])
    except Exception:
        RESULT['error'] = traceback.format_exc()
    with open(os.path.join(out_dir, 'owen_result.json'), 'w') as fh:
        json.dump(RESULT, fh, indent=1)
    sys.stdout.write('OWEN_RESULT_WRITTEN' + chr(10))
    sys.exit(0 if RESULT['ok'] else 3)


def render(req, out_dir):
    os.environ.setdefault('MPLBACKEND', 'Agg')
    import openmc

    RESULT['version'] = str(getattr(openmc, '__version__', 'unknown'))
    RESULT['capabilities']['rayTrace'] = bool(
        hasattr(openmc, 'SolidRayTracePlot') or hasattr(openmc, 'WireframeRayTracePlot'))

    captured = {'model': None}

    def _skip_run(*args, **kwargs):
        RESULT['warnings'].append('openmc.run() in the deck was skipped (render-only pass).')

    real_plot_geometry = getattr(openmc, 'plot_geometry', None)
    openmc.run = _skip_run
    if hasattr(openmc, 'plot_geometry'):
        openmc.plot_geometry = lambda *a, **k: None
    if hasattr(openmc, 'plot_inline'):
        openmc.plot_inline = lambda *a, **k: None

    model_cls = getattr(openmc, 'Model', None)
    if model_cls is None and hasattr(openmc, 'model'):
        model_cls = getattr(openmc.model, 'Model', None)
    if model_cls is not None:
        def _capture_run(self, *args, **kwargs):
            captured['model'] = self
            RESULT['warnings'].append('model.run() in the deck was skipped (render-only pass).')
        model_cls.run = _capture_run

    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        plt.show = lambda *a, **k: None
    except Exception:
        pass

    os.chdir(out_dir)
    deck = req['deckPath']
    sys.argv = [deck]
    namespace = {}
    try:
        namespace = runpy.run_path(deck, run_name='__main__')
    except SystemExit:
        pass
    except Exception:
        RESULT['warnings'].append('Deck raised during execution:' + chr(10) + traceback.format_exc())

    model = captured['model']
    if model is None and model_cls is not None:
        for value in namespace.values():
            if isinstance(value, model_cls):
                model = value
                break

    geometry = None
    materials = None
    settings = None
    if model is not None:
        RESULT['modelSource'] = 'captured' if captured['model'] is not None else 'namespace'
        geometry = getattr(model, 'geometry', None)
        materials = getattr(model, 'materials', None)
        settings = getattr(model, 'settings', None)
    else:
        for value in namespace.values():
            if geometry is None and isinstance(value, openmc.Geometry):
                geometry = value
            elif materials is None and isinstance(value, openmc.Materials):
                materials = value
            elif settings is None and isinstance(value, openmc.Settings):
                settings = value
        if geometry is not None:
            RESULT['modelSource'] = 'namespace'

    have_xml = os.path.exists('geometry.xml') or os.path.exists('model.xml')
    if geometry is None and not have_xml:
        raise RuntimeError(
            'No OpenMC model found: the deck defined no openmc.Model/openmc.Geometry '
            'and exported no geometry.xml/model.xml.')

    plots = []
    plot_meta = []
    for spec in req['plots']:
        basis = spec.get('basis', 'xy')
        origin, width = auto_view(geometry, basis)
        if spec.get('origin') is not None:
            origin = [float(v) for v in spec['origin']]
        if spec.get('width') is not None:
            width = [float(v) for v in spec['width']]
        pixels = spec.get('pixels', [800, 800])
        stem = 'owen_plot_' + str(spec['id'])
        if spec.get('kind') == 'raytrace':
            cls = getattr(openmc, 'SolidRayTracePlot', None) or getattr(openmc, 'WireframeRayTracePlot', None)
            if cls is None:
                RESULT['warnings'].append('Ray-traced plots need a newer OpenMC (SolidRayTracePlot not found).')
                continue
            try:
                plot = cls()
                plot.filename = stem
                plot.pixels = pixels
                diag = max(width[0], width[1])
                plot.camera_position = [origin[0] + diag * 2.2, origin[1] - diag * 2.2, origin[2] + diag * 1.5]
                plot.look_at = origin
                # SolidRayTracePlot renders only domains marked opaque; default
                # to every material-filled cell so the image is not blank.
                if hasattr(plot, 'opaque_domains') and geometry is not None:
                    cells = [c for c in geometry.get_all_cells().values()
                             if getattr(c, 'fill', None) is not None]
                    plot.opaque_domains = cells
                plots.append(plot)
                plot_meta.append({'id': spec['id'], 'kind': 'raytrace', 'basis': basis,
                                  'stem': stem, 'origin': origin, 'width': width})
            except Exception:
                RESULT['warnings'].append('Ray-trace plot setup failed:' + chr(10) + traceback.format_exc())
            continue
        plot = openmc.Plot()
        plot.filename = stem
        plot.basis = basis
        plot.origin = origin
        plot.width = width
        plot.pixels = pixels
        plot.color_by = spec.get('colorBy', 'material')
        plots.append(plot)
        plot_meta.append({'id': spec['id'], 'kind': 'slice', 'basis': basis,
                          'stem': stem, 'origin': origin, 'width': width})

    if not plots:
        raise RuntimeError('No renderable plots were requested.')

    if geometry is not None:
        # Export separate XMLs ourselves; drop any model.xml the deck exported
        # into this throwaway dir so OpenMC reads our plots.xml for sure.
        if os.path.exists('model.xml'):
            os.remove('model.xml')
        geometry.export_to_xml()
        # A Model built as Model(geometry=..., settings=...) often has an
        # empty materials collection - derive the real set from the geometry.
        if materials is None or len(materials) == 0:
            try:
                mats = geometry.get_all_materials()
                materials = openmc.Materials(mats.values())
            except Exception:
                materials = None
        if materials is not None and len(materials) > 0:
            materials.export_to_xml()
        if settings is None:
            settings = openmc.Settings()
            settings.batches = 1
            settings.particles = 1
            settings.inactive = 0
        try:
            settings.export_to_xml()
        except Exception:
            RESULT['warnings'].append('settings.xml export failed; relying on defaults.')
    else:
        RESULT['modelSource'] = 'xml'
        RESULT['warnings'].append(
            'Rendering from XML files the deck exported (no in-memory model was found).')

    openmc.Plots(plots).export_to_xml()

    # The openmc binary usually lives next to the interpreter (conda/venv);
    # non-interactive shells often do not have it on PATH.
    exe = 'openmc'
    sibling = os.path.join(os.path.dirname(sys.executable), 'openmc')
    if os.path.exists(sibling):
        exe = sibling

    if real_plot_geometry is not None:
        try:
            real_plot_geometry(openmc_exec=exe, cwd=out_dir)
        except TypeError:
            real_plot_geometry(cwd=out_dir)
    else:
        import subprocess
        subprocess.run([exe, '--plot'], cwd=out_dir, check=True)

    for meta in plot_meta:
        name = convert_to_png(meta['stem'], out_dir)
        if name is None:
            candidates = sorted(glob.glob(os.path.join(out_dir, meta['stem'] + '*')))
            if candidates:
                name = os.path.basename(candidates[0])
        if name is None:
            RESULT['warnings'].append('No image produced for plot ' + str(meta['id']) + '.')
            continue
        RESULT['images'].append({
            'id': meta['id'],
            'kind': meta['kind'],
            'basis': meta['basis'],
            'file': name,
            'origin': meta['origin'],
            'width': meta['width'],
        })


if __name__ == '__main__':
    main()
`;
