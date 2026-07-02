/**
 * Pure logic for "Verify Geometry with OpenMC": the sampled-plane specs, the
 * generated Python helper script, and result parsing. No `vscode` imports —
 * everything here is unit-testable headless (same pattern as
 * `preview/openmcNative/core.ts`, whose interpreter detection this feature
 * reuses via `preview/openmcNative/detect.ts`).
 *
 * Method (honest sampling, not proof):
 *  (a) Overlap scan — slice plots at several axial/radial positions rendered
 *      with `show_overlaps=True` and a sentinel overlap color; overlap pixels
 *      are counted per plane with PIL.
 *  (b) Lost-particle probe — a short low-particle transport run with
 *      `max_lost_particles` configured, surfacing lost-particle errors that
 *      indicate undefined regions. Skipped gracefully when cross sections
 *      are unavailable.
 */

/** Exact RGB the helper assigns to overlaps before pixel counting. */
export const OVERLAP_COLOR: [number, number, number] = [255, 0, 255];

export interface VerifyPlaneSpec {
    id: string;
    basis: 'xy' | 'xz' | 'yz';
    /**
     * Position of the slice along the axis normal to `basis`, as a 0..1
     * fraction of the geometry bounding box (resolved by the helper).
     */
    fraction: number;
    pixels: [number, number];
}

/** Default sampling: 3 axial xy slices + 1 xz + 1 yz through the center. */
export function defaultPlaneSpecs(pixels: [number, number] = [600, 600]): VerifyPlaneSpec[] {
    return [
        { id: 'xy_25', basis: 'xy', fraction: 0.25, pixels },
        { id: 'xy_50', basis: 'xy', fraction: 0.5, pixels },
        { id: 'xy_75', basis: 'xy', fraction: 0.75, pixels },
        { id: 'xz_50', basis: 'xz', fraction: 0.5, pixels },
        { id: 'yz_50', basis: 'yz', fraction: 0.5, pixels },
    ];
}

export interface VerifyRequest {
    /** Deck path as seen by the interpreter (WSL-translated when needed). */
    deckPath: string;
    /** Output dir as seen by the interpreter (WSL-translated when needed). */
    outDir: string;
    planes: VerifyPlaneSpec[];
    /** Whether to attempt the short lost-particle transport probe. */
    particleProbe: boolean;
    /** Particles per batch for the probe (kept low on purpose). */
    probeParticles: number;
    /** `max_lost_particles` for the probe run. */
    maxLostParticles: number;
}

export function buildVerifyRequest(
    deckPath: string,
    outDir: string,
    planes: VerifyPlaneSpec[] = defaultPlaneSpecs(),
    particleProbe = true,
): VerifyRequest {
    return {
        deckPath,
        outDir,
        planes,
        particleProbe,
        probeParticles: 1000,
        maxLostParticles: 10,
    };
}

export interface VerifyPlaneResult {
    id: string;
    basis: string;
    /** Actual slice coordinate the helper used (cm). */
    origin: [number, number, number];
    width: [number, number];
    /** Image basename inside outDir (empty when the render failed). */
    file: string;
    overlapPixels: number;
    totalPixels: number;
    /** True when PIL was unavailable and pixels could not be counted. */
    uncounted: boolean;
}

export interface LostParticleReport {
    /** False when the probe was skipped (no cross sections, run error…). */
    ran: boolean;
    lostCount: number;
    maxLost: number;
    particles: number;
    /** Why the probe was skipped, or the run's error summary. */
    message: string | null;
}

export interface VerifyResult {
    ok: boolean;
    version: string | null;
    planes: VerifyPlaneResult[];
    lost: LostParticleReport | null;
    warnings: string[];
    error: string | null;
}

/** True when nothing was detected at any sampled plane nor by the probe. */
export function isClean(result: VerifyResult): boolean {
    if (!result.ok) return false;
    if (result.planes.some((p) => p.overlapPixels > 0)) return false;
    if (result.lost?.ran && result.lost.lostCount > 0) return false;
    return true;
}

/** Parses + shape-checks owen_verify_result.json. Throws on garbage. */
export function parseVerifyResult(text: string): VerifyResult {
    const raw = JSON.parse(text) as Partial<VerifyResult>;
    if (typeof raw.ok !== 'boolean' || !Array.isArray(raw.planes)) {
        throw new Error('owen_verify_result.json is missing required fields');
    }
    const planes = raw.planes
        .filter((p): p is VerifyPlaneResult => !!p && typeof p.id === 'string')
        .map((p) => ({
            id: p.id,
            basis: typeof p.basis === 'string' ? p.basis : 'xy',
            origin: Array.isArray(p.origin) && p.origin.length === 3
                ? [Number(p.origin[0]), Number(p.origin[1]), Number(p.origin[2])] as [number, number, number]
                : [0, 0, 0] as [number, number, number],
            width: Array.isArray(p.width) && p.width.length === 2
                ? [Number(p.width[0]), Number(p.width[1])] as [number, number]
                : [0, 0] as [number, number],
            // Basenames only — reject anything that could escape outDir.
            file: typeof p.file === 'string' && !p.file.includes('/') && !p.file.includes('\\') ? p.file : '',
            overlapPixels: Number.isFinite(Number(p.overlapPixels)) ? Math.max(0, Number(p.overlapPixels)) : 0,
            totalPixels: Number.isFinite(Number(p.totalPixels)) ? Math.max(0, Number(p.totalPixels)) : 0,
            uncounted: !!p.uncounted,
        }));
    let lost: LostParticleReport | null = null;
    if (raw.lost && typeof raw.lost === 'object') {
        const l = raw.lost as Partial<LostParticleReport>;
        lost = {
            ran: !!l.ran,
            lostCount: Number.isFinite(Number(l.lostCount)) ? Math.max(0, Number(l.lostCount)) : 0,
            maxLost: Number.isFinite(Number(l.maxLost)) ? Number(l.maxLost) : 0,
            particles: Number.isFinite(Number(l.particles)) ? Number(l.particles) : 0,
            message: typeof l.message === 'string' ? l.message : null,
        };
    }
    return {
        ok: raw.ok,
        version: typeof raw.version === 'string' ? raw.version : null,
        planes,
        lost,
        warnings: Array.isArray(raw.warnings) ? raw.warnings.map(String) : [],
        error: typeof raw.error === 'string' ? raw.error : null,
    };
}

/**
 * The Python helper OWEN writes to a temp dir and runs with the resolved
 * interpreter: `python owen_openmc_verify.py <request.json>`.
 *
 * Shares its design with the render helper (`preview/openmcNative/core.ts`):
 * the deck runs with `openmc.run`/`Model.run` no-op'd, cwd is the throwaway
 * out dir, plotting goes through plots.xml + `openmc --plot`, results are
 * written as JSON with image basenames. ASCII-only on purpose.
 */
export function buildVerifyHelperScript(): string {
    return VERIFY_HELPER_SCRIPT;
}

const VERIFY_HELPER_SCRIPT = `# Generated by the OWEN VS Code extension ("Verify Geometry with OpenMC"). Safe to delete.
import glob
import json
import os
import re
import runpy
import sys
import traceback

RESULT = {
    'ok': False,
    'version': None,
    'planes': [],
    'lost': None,
    'warnings': [],
    'error': None,
}

OVERLAP_RGB = (${OVERLAP_COLOR[0]}, ${OVERLAP_COLOR[1]}, ${OVERLAP_COLOR[2]})


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
    lo = [finite(lower[i], -50.0) for i in range(3)]
    hi = [finite(upper[i], 50.0) for i in range(3)]
    for i in range(3):
        if hi[i] <= lo[i]:
            lo[i], hi[i] = -50.0, 50.0
    return lo, hi


def plane_view(geometry, basis, fraction):
    axes = {'xy': (0, 1), 'xz': (0, 2), 'yz': (1, 2)}[basis]
    normal = {'xy': 2, 'xz': 1, 'yz': 0}[basis]
    origin = [0.0, 0.0, 0.0]
    width = [100.0, 100.0]
    if geometry is not None:
        try:
            lo, hi = bounds_of(geometry)
        except Exception:
            return origin, width
        for i in range(3):
            origin[i] = (lo[i] + hi[i]) / 2.0
        origin[normal] = lo[normal] + (hi[normal] - lo[normal]) * fraction
        width = [max(hi[axes[0]] - lo[axes[0]], 0.1) * 1.02,
                 max(hi[axes[1]] - lo[axes[1]], 0.1) * 1.02]
    return origin, width


def count_overlap_pixels(image_path):
    try:
        from PIL import Image
    except Exception:
        return None, None
    img = Image.open(image_path).convert('RGB')
    w, h = img.size
    count = 0
    for pixel in img.getdata():
        if pixel == OVERLAP_RGB:
            count += 1
    return count, w * h


def find_image(stem, out_dir):
    png = os.path.join(out_dir, stem + '.png')
    if os.path.exists(png):
        return png
    ppm = os.path.join(out_dir, stem + '.ppm')
    if os.path.exists(ppm):
        try:
            from PIL import Image
            Image.open(ppm).save(png)
            return png
        except Exception:
            return ppm
    candidates = sorted(glob.glob(os.path.join(out_dir, stem + '*')))
    return candidates[0] if candidates else None


def main():
    with open(sys.argv[1], 'r') as fh:
        req = json.load(fh)
    out_dir = req['outDir']
    try:
        verify(req, out_dir)
        RESULT['ok'] = RESULT['error'] is None
    except Exception:
        RESULT['error'] = traceback.format_exc()
    with open(os.path.join(out_dir, 'owen_verify_result.json'), 'w') as fh:
        json.dump(RESULT, fh, indent=1)
    sys.stdout.write('OWEN_VERIFY_WRITTEN' + chr(10))
    sys.exit(0 if RESULT['ok'] else 3)


def load_model(req, out_dir):
    import openmc

    RESULT['version'] = str(getattr(openmc, '__version__', 'unknown'))
    captured = {'model': None}
    real_run = openmc.run

    def _skip_run(*args, **kwargs):
        RESULT['warnings'].append('openmc.run() in the deck was skipped (verify-only pass).')

    openmc.run = _skip_run
    if hasattr(openmc, 'plot_geometry'):
        real_plot_geometry = openmc.plot_geometry
        openmc.plot_geometry = lambda *a, **k: None
    else:
        real_plot_geometry = None
    if hasattr(openmc, 'plot_inline'):
        openmc.plot_inline = lambda *a, **k: None

    model_cls = getattr(openmc, 'Model', None)
    if model_cls is None and hasattr(openmc, 'model'):
        model_cls = getattr(openmc.model, 'Model', None)
    if model_cls is not None:
        def _capture_run(self, *args, **kwargs):
            captured['model'] = self
            RESULT['warnings'].append('model.run() in the deck was skipped (verify-only pass).')
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
    if model is not None:
        geometry = getattr(model, 'geometry', None)
        materials = getattr(model, 'materials', None)
    else:
        for value in namespace.values():
            if geometry is None and isinstance(value, openmc.Geometry):
                geometry = value
            elif materials is None and isinstance(value, openmc.Materials):
                materials = value

    have_xml = os.path.exists('geometry.xml') or os.path.exists('model.xml')
    if geometry is None and not have_xml:
        raise RuntimeError(
            'No OpenMC model found: the deck defined no openmc.Model/openmc.Geometry '
            'and exported no geometry.xml/model.xml.')

    if geometry is not None:
        if os.path.exists('model.xml'):
            os.remove('model.xml')
        geometry.export_to_xml()
        if materials is None or len(materials) == 0:
            try:
                mats = geometry.get_all_materials()
                materials = openmc.Materials(mats.values())
            except Exception:
                materials = None
        if materials is not None and len(materials) > 0:
            materials.export_to_xml()

    return openmc, geometry, real_run, real_plot_geometry


def overlap_scan(openmc, geometry, req, out_dir, real_plot_geometry):
    plots = []
    meta = []
    for spec in req['planes']:
        basis = spec.get('basis', 'xy')
        origin, width = plane_view(geometry, basis, float(spec.get('fraction', 0.5)))
        stem = 'owen_verify_' + str(spec['id'])
        plot = openmc.Plot()
        plot.filename = stem
        plot.basis = basis
        plot.origin = origin
        plot.width = width
        plot.pixels = spec.get('pixels', [600, 600])
        plot.color_by = 'material'
        plot.show_overlaps = True
        try:
            plot.overlap_color = list(OVERLAP_RGB)
        except Exception:
            RESULT['warnings'].append(
                'overlap_color not settable on this OpenMC; overlap pixels may use the default red.')
        plots.append(plot)
        meta.append({'id': spec['id'], 'basis': basis, 'stem': stem,
                     'origin': origin, 'width': width})

    if not plots:
        raise RuntimeError('No verification planes were requested.')

    # A minimal settings.xml so 'openmc --plot' has everything it needs.
    settings = openmc.Settings()
    settings.batches = 1
    settings.particles = 1
    settings.inactive = 0
    try:
        settings.export_to_xml()
    except Exception:
        RESULT['warnings'].append('settings.xml export failed; relying on defaults.')

    openmc.Plots(plots).export_to_xml()

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

    for m in meta:
        image = find_image(m['stem'], out_dir)
        entry = {
            'id': m['id'],
            'basis': m['basis'],
            'origin': m['origin'],
            'width': m['width'],
            'file': os.path.basename(image) if image else '',
            'overlapPixels': 0,
            'totalPixels': 0,
            'uncounted': False,
        }
        if image is None:
            RESULT['warnings'].append('No image produced for plane ' + str(m['id']) + '.')
        else:
            count, total = count_overlap_pixels(image)
            if count is None:
                entry['uncounted'] = True
                RESULT['warnings'].append(
                    'Pillow not available - overlap pixels for plane ' + str(m['id']) +
                    ' were not counted (inspect the image manually).')
            else:
                entry['overlapPixels'] = count
                entry['totalPixels'] = total
        RESULT['planes'].append(entry)


def lost_particle_probe(openmc, req, out_dir, real_run):
    report = {
        'ran': False,
        'lostCount': 0,
        'maxLost': int(req.get('maxLostParticles', 10)),
        'particles': int(req.get('probeParticles', 1000)),
        'message': None,
    }
    RESULT['lost'] = report
    if not req.get('particleProbe', False):
        report['message'] = 'Particle probe disabled.'
        return
    if not os.environ.get('OPENMC_CROSS_SECTIONS') and not os.path.exists('cross_sections.xml'):
        report['message'] = ('Skipped: no cross sections configured '
                             '(set OPENMC_CROSS_SECTIONS to enable the lost-particle probe).')
        return

    settings = openmc.Settings()
    settings.run_mode = 'fixed source'
    settings.batches = 1
    settings.particles = report['particles']
    try:
        settings.max_lost_particles = report['maxLost']
    except Exception:
        pass
    try:
        settings.export_to_xml()
    except Exception:
        report['message'] = 'Skipped: could not export probe settings.'
        return

    import io
    import contextlib
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            real_run(cwd=out_dir, output=False)
        report['ran'] = True
    except Exception as exc:
        text = buf.getvalue() + chr(10) + str(exc)
        lost = re.findall(r'([0-9]+)\\s+particles?\\s+(?:were|was)?\\s*lost', text, re.IGNORECASE)
        if lost:
            report['ran'] = True
            report['lostCount'] = max(int(n) for n in lost)
            report['message'] = 'Lost particles detected during the probe run.'
        elif 'lost' in text.lower():
            report['ran'] = True
            report['lostCount'] = report['maxLost']
            report['message'] = 'Run aborted after reaching max_lost_particles.'
        else:
            report['message'] = 'Skipped: probe run failed (' + str(exc)[:200] + ')'
        return
    text = buf.getvalue()
    lost = re.findall(r'([0-9]+)\\s+particles?\\s+(?:were|was)?\\s*lost', text, re.IGNORECASE)
    if lost:
        report['lostCount'] = max(int(n) for n in lost)
        report['message'] = 'Lost particles detected during the probe run.'


def verify(req, out_dir):
    openmc, geometry, real_run, real_plot_geometry = load_model(req, out_dir)
    overlap_scan(openmc, geometry, req, out_dir, real_plot_geometry)
    lost_particle_probe(openmc, req, out_dir, real_run)


if __name__ == '__main__':
    main()
`;
