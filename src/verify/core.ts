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
import {
    DeckLoadOptions,
    normalizeDeckOptions,
    OPENMC_DECK_LOADER_PY,
    ViewFit,
} from '../preview/openmcNative/deckLoader';

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
    /** cross_sections.xml to lend the deck; '' lets the helper look for one. */
    crossSections: string;
    /** Argv handed to the deck (presets, thicknesses, …). */
    deckArgs: string[];
    /** Which bounding box the sampled planes span. */
    fit: ViewFit;
}

export function buildVerifyRequest(
    deckPath: string,
    outDir: string,
    planes: VerifyPlaneSpec[] = defaultPlaneSpecs(),
    particleProbe = true,
    opts?: DeckLoadOptions,
): VerifyRequest {
    return {
        deckPath,
        outDir,
        planes,
        particleProbe,
        probeParticles: 1000,
        maxLostParticles: 10,
        ...normalizeDeckOptions(opts),
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
import sys
import traceback

${OPENMC_DECK_LOADER_PY}

RESULT = {
    'ok': False,
    'version': None,
    'planes': [],
    'lost': None,
    'warnings': [],
    'error': None,
}

OVERLAP_RGB = (${OVERLAP_COLOR[0]}, ${OVERLAP_COLOR[1]}, ${OVERLAP_COLOR[2]})


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
    ctx = owen_load_deck(req, out_dir, RESULT['warnings'], 'verify-only pass')
    owen_export_model(ctx, out_dir, RESULT['warnings'])
    return ctx


def overlap_scan(openmc, geometry, req, out_dir, real_plot_geometry):
    plots = []
    meta = []
    fit = 'geometry' if req.get('fit') == 'geometry' else 'materials'
    for spec in req['planes']:
        basis = spec.get('basis', 'xy')
        origin, width = owen_slice_view(geometry, basis, fit, RESULT['warnings'],
                                        float(spec.get('fraction', 0.5)))
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

    # 'openmc --plot' needs a settings.xml. The loader writes the deck's own;
    # this covers the XML-adoption path, where there may not be one.
    if not os.path.exists(os.path.join(out_dir, 'settings.xml')):
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


def lost_particle_probe(openmc, req, out_dir, real_run, cross_sections, deck_settings):
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
    if not cross_sections and not os.path.exists('cross_sections.xml'):
        report['message'] = ('Skipped: no cross-section library found '
                             '(set owen.openmc.crossSections or OPENMC_CROSS_SECTIONS '
                             'to enable the lost-particle probe).')
        return
    if cross_sections:
        # The loader withdraws its stand-in before plotting; transport needs
        # the real library back in the environment.
        os.environ['OPENMC_CROSS_SECTIONS'] = cross_sections

    # Probe with the deck's own source when it has one: a default point source
    # at the origin would sample a quite different set of paths.
    settings = deck_settings if deck_settings is not None else openmc.Settings()
    if getattr(settings, 'run_mode', None) is None:
        settings.run_mode = 'fixed source'
    if str(getattr(settings, 'run_mode', '')) == 'eigenvalue':
        settings.inactive = 0
        settings.batches = 2
    else:
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
    ctx = load_model(req, out_dir)
    overlap_scan(ctx['openmc'], ctx['geometry'], req, out_dir, ctx['realPlotGeometry'])
    lost_particle_probe(ctx['openmc'], req, out_dir, ctx['realRun'], ctx['crossSections'],
                        ctx['settings'])


if __name__ == '__main__':
    main()
`;
