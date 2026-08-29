/**
 * The Python fragment both native-OpenMC features embed: run the user's deck,
 * get a model out of it, and decide what part of the model to frame.
 *
 * It lives in one place because "Render with OpenMC (authoritative)" and
 * "Verify Geometry with OpenMC" had separate copies that drifted, and both
 * copies failed on the same real decks:
 *
 *  - `OPENMC_CROSS_SECTIONS` is normally exported from a shell profile, and
 *    OWEN spawns the interpreter without a login shell (`wsl --exec python3`),
 *    so a deck that checks the variable exits before building anything. Plot
 *    mode needs no nuclear data at all, so the loader finds a library if one
 *    exists and otherwise lends the deck an empty stand-in for the duration of
 *    the run.
 *  - A deck whose model is a local variable inside `main()` was invisible: the
 *    old code only scanned the module globals after the run. The loader now
 *    captures models as they are constructed, run, or exported.
 *  - Framing used the whole geometry, so a model wrapped in a 2000 cm vacuum
 *    sphere rendered as a dot. `fit: 'materials'` frames the filled cells.
 *
 * Everything is prefixed `owen_` to stay clear of deck namespaces, ASCII-only,
 * and free of backslashes so it survives embedding in a TS template literal.
 */

/** Fixed paths checked for a cross-section library, in order. */
export const OPENMC_XS_CANDIDATES = [
    '/opt/openmc-data/cross_sections.xml',
    '/opt/openmc/cross_sections.xml',
    '/usr/share/openmc/cross_sections.xml',
    '~/openmc-data/cross_sections.xml',
    '~/nndc_hdf5/cross_sections.xml',
    '~/openmc/cross_sections.xml',
];

/**
 * Glob patterns checked alongside the fixed paths. Two levels deep because the
 * openmc-data download scripts nest the library under a release directory
 * (`~/openmc-data-endfb80/endfb-viii.0-hdf5/cross_sections.xml`).
 */
export const OPENMC_XS_GLOBS = [
    '~/*/cross_sections.xml',
    '~/*/*/cross_sections.xml',
    '/opt/*/cross_sections.xml',
    '/opt/*/*/cross_sections.xml',
];

/** How the helper picks the bounding box it frames. */
export type ViewFit = 'materials' | 'geometry';

/** Deck-execution options shared by the render and verify requests. */
export interface DeckLoadOptions {
    /** Explicit cross_sections.xml (`owen.openmc.crossSections`), if set. */
    crossSections?: string;
    /** Argv passed to the deck, e.g. `['--preset', 'seventy_thirty_base']`. */
    deckArgs?: string[];
    /** Which bounding box automatic views frame. Defaults to `materials`. */
    fit?: ViewFit;
}

/** Normalizes user-supplied deck options for embedding in a request JSON. */
export function normalizeDeckOptions(opts: DeckLoadOptions | undefined): Required<DeckLoadOptions> {
    const args = Array.isArray(opts?.deckArgs) ? opts!.deckArgs.map(String).filter((a) => a.length > 0) : [];
    return {
        crossSections: typeof opts?.crossSections === 'string' ? opts.crossSections.trim() : '',
        deckArgs: args,
        fit: opts?.fit === 'geometry' ? 'geometry' : 'materials',
    };
}

/**
 * Splits a deck-argument string the way a shell would for the simple cases:
 * whitespace separated, with single or double quotes grouping. Deliberately
 * not a full shell parser — the arguments go to `sys.argv`, never to a shell.
 */
export function parseDeckArgs(text: string | undefined): string[] {
    if (!text) return [];
    const out: string[] = [];
    let current = '';
    let quote: string | null = null;
    let started = false;
    for (const ch of text) {
        if (quote) {
            if (ch === quote) quote = null;
            else current += ch;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            started = true;
            continue;
        }
        if (/\s/.test(ch)) {
            if (started || current.length > 0) out.push(current);
            current = '';
            started = false;
            continue;
        }
        current += ch;
    }
    if (started || current.length > 0) out.push(current);
    return out;
}

const XS_EXACT_PY = OPENMC_XS_CANDIDATES.map((p) => `    '${p}',`).join('\n');
const XS_GLOBS_PY = OPENMC_XS_GLOBS.map((p) => `    '${p}',`).join('\n');

/**
 * Cross-section discovery, shared by the deck loader and the standalone probe.
 *
 * Two rules, and the split between them matters. A path the user named -- the
 * `owen.openmc.crossSections` setting, `OPENMC_CROSS_SECTIONS`, or the openmc
 * config file -- is authoritative even if it is a two-nuclide test library.
 * Anything OWEN merely *finds* is a guess, and the first existing path is a bad
 * way to settle a guess: machines that run OpenMC often carry a slim depletion
 * or test library beside the real evaluation, and a transport run against the
 * slim one dies on the first nuclide it lacks. So the guesses are ranked by how
 * many nuclides they list and the richest wins.
 */
export const OPENMC_XS_DISCOVERY_PY = `OWEN_XS_CANDIDATES = [
${XS_EXACT_PY}
]

OWEN_XS_GLOBS = [
${XS_GLOBS_PY}
]


def owen_xs_named(hint):
    """Libraries the user pointed at, in order of precedence."""
    paths = []
    if hint:
        paths.append(hint)
    env = os.environ.get('OPENMC_CROSS_SECTIONS')
    if env:
        paths.append(env)
    try:
        import openmc
        cfg = getattr(openmc, 'config', None)
        if cfg is not None and hasattr(cfg, 'get'):
            value = cfg.get('cross_sections')
            if value:
                paths.append(str(value))
    except Exception:
        pass
    return paths


def owen_xs_found():
    """Libraries OWEN discovered on its own."""
    paths = list(OWEN_XS_CANDIDATES)
    for pattern in OWEN_XS_GLOBS:
        try:
            paths.extend(sorted(glob.glob(os.path.expanduser(pattern))))
        except Exception:
            pass
    return paths


def owen_xs_size(path):
    """How many nuclides and thermal tables a library lists, or -1 if unreadable."""
    try:
        import xml.etree.ElementTree as ET
        root = ET.parse(path).getroot()
        return len({e.get('materials') for e in root if e.get('materials')})
    except Exception:
        return -1


def owen_xs_exists(path):
    try:
        full = os.path.expanduser(str(path))
    except Exception:
        return None
    return full if full and os.path.exists(full) else None


def owen_find_cross_sections(hint):
    """A named library if there is one, else the richest library found."""
    for candidate in owen_xs_named(hint):
        full = owen_xs_exists(candidate)
        if full:
            return full
    best = None
    best_size = -2
    seen = set()
    for candidate in owen_xs_found():
        full = owen_xs_exists(candidate)
        if not full:
            continue
        key = os.path.realpath(full)
        if key in seen:
            continue
        seen.add(key)
        size = owen_xs_size(full)
        if size > best_size:
            best, best_size = full, size
    return best
`;

/**
 * A one-line Python program that prints the cross-section library OWEN would
 * lend a deck, or nothing. Used by "Run Simulation": a transport run needs the
 * real library, and the variable that names it is exported from the user's
 * shell profile, which neither `sh -c` nor `bash -lc` reads for a
 * non-interactive shell — so OWEN has to find the library and pass it in.
 */
export function buildCrossSectionProbe(hint?: string): string {
    const hintPy = hint && hint.trim() ? JSON.stringify(hint.trim()) : 'None';
    return (
        'import glob,os,sys\n' +
        `${OPENMC_XS_DISCOVERY_PY}\n` +
        `found=owen_find_cross_sections(${hintPy})\n` +
        'if found: sys.stdout.write(found)\n'
    );
}

/** The shared Python source. Embed once, then call `owen_load_deck`. */
export const OPENMC_DECK_LOADER_PY = `# --- OWEN shared deck loader (generated from deckLoader.ts) ---
import glob
import inspect
import os
import runpy
import shutil
import sys
import traceback

${OPENMC_XS_DISCOVERY_PY}

OWEN_BUILDER_NAMES = ('build_model', 'make_model', 'build', 'create_model',
                      'model', 'build_geometry', 'make_geometry', 'main')

OWEN_EXPORT_ONLY_FLAGS = ('--no-run', '--dry-run', '--export-only', '--plot-only')


def owen_is_finite(value):
    try:
        v = float(value)
    except Exception:
        return False
    if v != v:
        return False
    return v not in (float('inf'), float('-inf'))


def owen_finite(value, fallback):
    return float(value) if owen_is_finite(value) else fallback


def owen_box(obj):
    """(lower, upper) of anything with a .bounding_box, old or new API."""
    bb = obj.bounding_box
    lower = getattr(bb, 'lower_left', None)
    upper = getattr(bb, 'upper_right', None)
    if lower is None or upper is None:
        lower, upper = bb[0], bb[1]
    return [lower[0], lower[1], lower[2]], [upper[0], upper[1], upper[2]]


def owen_prepare_cross_sections(req, out_dir, warnings):
    """Make OPENMC_CROSS_SECTIONS resolvable for the deck.

    OWEN starts the interpreter without a login shell, so the variable the
    user exports from .bashrc (or conda activate) is absent and decks that
    gate on it exit immediately. Geometry plotting needs no nuclear data, so
    when no library exists an empty stand-in keeps such decks running; it is
    withdrawn again before OpenMC is invoked.
    """
    state = {
        'previous': os.environ.get('OPENMC_CROSS_SECTIONS'),
        'path': None,
        'standIn': None,
    }
    found = owen_find_cross_sections(req.get('crossSections'))
    if found:
        state['path'] = found
        if state['previous'] != found:
            os.environ['OPENMC_CROSS_SECTIONS'] = found
            warnings.append('OPENMC_CROSS_SECTIONS was not set for this process; '
                            'using the library found at ' + found + '.')
        return state
    stand_in = os.path.join(out_dir, 'owen_empty_cross_sections.xml')
    try:
        with open(stand_in, 'w') as fh:
            fh.write('<?xml version="1.0"?>' + chr(10) + '<cross_sections/>' + chr(10))
    except Exception:
        warnings.append('No cross-section library was found and the stand-in could not be written; '
                        'a deck that requires OPENMC_CROSS_SECTIONS will exit.')
        return state
    os.environ['OPENMC_CROSS_SECTIONS'] = stand_in
    state['standIn'] = stand_in
    warnings.append('No cross-section library was found, so OPENMC_CROSS_SECTIONS points at an empty '
                    'stand-in while the deck runs. Geometry plots need no nuclear data; transport does. '
                    'Set owen.openmc.crossSections to silence this.')
    return state


def owen_release_cross_sections(state):
    if state.get('standIn') is None:
        return
    previous = state.get('previous')
    if previous is None:
        os.environ.pop('OPENMC_CROSS_SECTIONS', None)
    else:
        os.environ['OPENMC_CROSS_SECTIONS'] = previous


def owen_install_capture(openmc, warnings, label):
    """Patch OpenMC so running a deck yields its model without running transport.

    Capture happens on construction, on run, and on export, so a model built
    inside a function and never returned is still found.
    """
    captured = {'model': None, 'geometry': None, 'source': None, 'intercepted': False}
    real = {'run': getattr(openmc, 'run', None),
            'plot_geometry': getattr(openmc, 'plot_geometry', None),
            'geometry_export': getattr(getattr(openmc, 'Geometry', None), 'export_to_xml', None)}
    noted = {'export': False}

    def _skip_run(*args, **kwargs):
        captured['intercepted'] = True
        warnings.append('openmc.run() in the deck was skipped (' + label + ').')

    openmc.run = _skip_run
    if real['plot_geometry'] is not None:
        openmc.plot_geometry = lambda *a, **k: None
    if hasattr(openmc, 'plot_inline'):
        openmc.plot_inline = lambda *a, **k: None

    def _note_export():
        if noted['export']:
            return
        noted['export'] = True
        warnings.append('An export_to_xml() call in the deck was intercepted so it could not overwrite '
                        'files next to the deck; OWEN exports the captured model itself.')

    model_cls = getattr(openmc, 'Model', None)
    if model_cls is None:
        model_cls = getattr(getattr(openmc, 'model', None), 'Model', None)
    if model_cls is not None:
        model_init = model_cls.__init__

        def _model_init(self, *args, **kwargs):
            model_init(self, *args, **kwargs)
            captured['model'] = self
            if captured['source'] is None:
                captured['source'] = 'constructed'

        model_cls.__init__ = _model_init

        def _model_run(self, *args, **kwargs):
            captured['model'] = self
            captured['source'] = 'run'
            captured['intercepted'] = True
            warnings.append('model.run() in the deck was skipped (' + label + ').')
            # Decks routinely do Path(model.run()); hand back a path-like so
            # they get further than a TypeError on None.
            import pathlib
            return pathlib.Path(os.path.join(os.getcwd(), 'owen_skipped_statepoint.h5'))

        model_cls.run = _model_run

        def _model_export(self, *args, **kwargs):
            captured['model'] = self
            if captured['source'] in (None, 'constructed'):
                captured['source'] = 'export'
            captured['intercepted'] = True
            _note_export()

        for name in ('export_to_xml', 'export_to_model_xml'):
            if getattr(model_cls, name, None) is not None:
                setattr(model_cls, name, _model_export)

    geometry_cls = getattr(openmc, 'Geometry', None)
    if geometry_cls is not None:
        geometry_init = geometry_cls.__init__

        def _geometry_init(self, *args, **kwargs):
            geometry_init(self, *args, **kwargs)
            captured['geometry'] = self
            if captured['source'] is None:
                captured['source'] = 'constructed'

        geometry_cls.__init__ = _geometry_init

        def _geometry_export(self, *args, **kwargs):
            captured['geometry'] = self
            captured['intercepted'] = True
            _note_export()

        if getattr(geometry_cls, 'export_to_xml', None) is not None:
            geometry_cls.export_to_xml = _geometry_export

    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        plt.show = lambda *a, **k: None
    except Exception:
        pass

    return captured, real


def owen_deck_attempts(req, deck):
    """Argv lists to try, in order. The second adds the deck's own export-only
    flag when it has one, which is how a deck that would otherwise run
    transport (or exit for a missing library) still yields a model."""
    base = [str(a) for a in (req.get('deckArgs') or [])]
    attempts = [base]
    try:
        with open(deck, 'r', errors='replace') as fh:
            text = fh.read()
    except Exception:
        text = ''
    for flag in OWEN_EXPORT_ONLY_FLAGS:
        if flag in text and flag not in base:
            attempts.append(base + [flag])
            break
    return attempts


def owen_run_deck(req, captured, warnings):
    deck = req['deckPath']
    deck_dir = os.path.dirname(os.path.abspath(deck))
    if deck_dir and deck_dir not in sys.path:
        sys.path.insert(0, deck_dir)
    namespace = {}
    for argv in owen_deck_attempts(req, deck):
        sys.argv = [deck] + argv
        if argv:
            warnings.append('Ran the deck as: ' + ' '.join([os.path.basename(deck)] + argv))
        try:
            namespace = runpy.run_path(deck, run_name='__main__')
        except SystemExit as exc:
            code = getattr(exc, 'code', None)
            if code not in (0, None):
                warnings.append('The deck exited early: SystemExit(' + str(code) + ').')
        except Exception as exc:
            if captured['intercepted']:
                # Everything after the intercepted run/export is code OWEN
                # deliberately starved of a real result; the model is already
                # in hand, so this is expected rather than a deck defect.
                warnings.append('The deck continued past the point OWEN stopped it and raised ' +
                                type(exc).__name__ + ': ' + str(exc)[:200] +
                                ' - expected, the model was already captured.')
            else:
                warnings.append('The deck raised while running:' + chr(10) + traceback.format_exc())
        if captured['model'] is not None or captured['geometry'] is not None:
            break
    return namespace


def owen_adopt_result(value, openmc, captured):
    """Record a Model/Geometry returned by a builder, unwrapping tuples."""
    model_cls = getattr(openmc, 'Model', None)
    if model_cls is not None and isinstance(value, model_cls):
        captured['model'] = value
        return True
    if isinstance(value, openmc.Geometry):
        captured['geometry'] = value
        return True
    if isinstance(value, (tuple, list)):
        for item in value:
            if owen_adopt_result(item, openmc, captured):
                return True
    return False


def owen_call_builders(openmc, namespace, captured, warnings):
    """Last resort: call a zero-argument builder the deck defined."""
    for name in OWEN_BUILDER_NAMES:
        fn = namespace.get(name)
        if not callable(fn) or isinstance(fn, type):
            continue
        try:
            params = inspect.signature(fn).parameters.values()
        except Exception:
            continue
        required = [p for p in params
                    if p.default is inspect.Parameter.empty
                    and p.kind in (inspect.Parameter.POSITIONAL_ONLY,
                                   inspect.Parameter.POSITIONAL_OR_KEYWORD,
                                   inspect.Parameter.KEYWORD_ONLY)]
        if required:
            continue
        try:
            result = fn()
        except SystemExit:
            continue
        except Exception:
            warnings.append('Calling ' + name + '() from the deck failed:' + chr(10) + traceback.format_exc())
            continue
        owen_adopt_result(result, openmc, captured)
        if captured['model'] is not None or captured['geometry'] is not None:
            warnings.append('Running the deck built no model, so OWEN called ' + name + '() directly.')
            if captured['source'] is None:
                captured['source'] = 'builder'
            return


def owen_adopt_xml(out_dir, warnings):
    """Promote XML a deck wrote in a subdirectory up to out_dir, so OpenMC
    reads it alongside the plots.xml OWEN writes."""
    for name in ('model.xml', 'geometry.xml'):
        if os.path.exists(os.path.join(out_dir, name)):
            return True
    found = None
    for name in ('model.xml', 'geometry.xml'):
        matches = [p for p in glob.glob(os.path.join(out_dir, '*', '**', name), recursive=True)]
        if matches:
            matches.sort(key=lambda p: (p.count(os.sep), -os.path.getmtime(p)))
            found = matches[0]
            break
    if found is None:
        return False
    source_dir = os.path.dirname(found)
    for name in ('model.xml', 'geometry.xml', 'materials.xml', 'settings.xml'):
        src = os.path.join(source_dir, name)
        if os.path.exists(src):
            try:
                shutil.copyfile(src, os.path.join(out_dir, name))
            except Exception:
                pass
    warnings.append('Using the XML the deck exported to ' + source_dir + ' (no in-memory model was captured).')
    return True


def owen_no_model_error(req, warnings):
    tried = ['ran it as __main__ with model.run() and export_to_xml() intercepted']
    attempts = owen_deck_attempts(req, req['deckPath'])
    if len(attempts) > 1:
        tried.append('retried with ' + ' '.join(attempts[-1][len(attempts[0]):]))
    tried.append('called the zero-argument builders it defines')
    return ('No OpenMC model found in this deck. OWEN ' + '; '.join(tried) + '. '
            'Nothing constructed an openmc.Model or openmc.Geometry, and no geometry.xml/model.xml '
            'was written. If the model is built inside a function that needs arguments, either pass '
            'them as deck arguments or add a module-level model = ... assignment. The warnings above '
            'record what the deck did.')


def owen_load_deck(req, out_dir, warnings, label):
    """Run the deck and return everything the callers need to plot it."""
    os.environ.setdefault('MPLBACKEND', 'Agg')
    import openmc

    xs = owen_prepare_cross_sections(req, out_dir, warnings)
    captured, real = owen_install_capture(openmc, warnings, label)

    os.chdir(out_dir)
    namespace = owen_run_deck(req, captured, warnings)
    if captured['model'] is None and captured['geometry'] is None:
        owen_call_builders(openmc, namespace, captured, warnings)

    model = captured['model']
    geometry = captured['geometry']
    materials = None
    settings = None
    source = captured['source']

    if model is None:
        model_cls = getattr(openmc, 'Model', None)
        for value in namespace.values():
            if model_cls is not None and isinstance(value, model_cls):
                model = value
                source = source or 'namespace'
                break
    if model is not None:
        geometry = getattr(model, 'geometry', None) or geometry
        materials = getattr(model, 'materials', None)
        settings = getattr(model, 'settings', None)
    for value in namespace.values():
        if geometry is None and isinstance(value, openmc.Geometry):
            geometry = value
            source = source or 'namespace'
        elif materials is None and isinstance(value, openmc.Materials):
            materials = value
        elif settings is None and isinstance(value, openmc.Settings):
            settings = value

    have_xml = False
    if geometry is None:
        have_xml = owen_adopt_xml(out_dir, warnings)
        if have_xml:
            source = 'xml'
    owen_release_cross_sections(xs)
    if geometry is None and not have_xml:
        raise RuntimeError(owen_no_model_error(req, warnings))

    return {
        'openmc': openmc,
        'model': model,
        'geometry': geometry,
        'materials': materials,
        'settings': settings,
        'source': source or 'unknown',
        'realRun': real['run'],
        'realPlotGeometry': real['plot_geometry'],
        'realGeometryExport': real['geometry_export'],
        'crossSections': xs.get('path'),
        'haveXml': have_xml,
    }


def owen_export_model(ctx, out_dir, warnings):
    """Write the geometry/materials/settings XML OpenMC will read.

    Geometry.export_to_xml is intercepted for the deck's benefit, so the
    export here goes through the original saved before patching.
    """
    openmc = ctx['openmc']
    geometry = ctx['geometry']
    if geometry is None:
        return
    model_xml = os.path.join(out_dir, 'model.xml')
    if os.path.exists(model_xml):
        # A stale model.xml wins over separate XMLs, and would hide our plots.
        os.remove(model_xml)
    export = ctx['realGeometryExport']
    if export is None:
        raise RuntimeError('This OpenMC build has no Geometry.export_to_xml.')
    export(geometry)
    materials = ctx['materials']
    if materials is None or len(materials) == 0:
        # Model(geometry=..., settings=...) often carries no materials list.
        try:
            materials = openmc.Materials(geometry.get_all_materials().values())
        except Exception:
            materials = None
    if materials is not None and len(materials) > 0:
        try:
            materials.export_to_xml()
        except Exception:
            warnings.append('materials.xml export failed; OpenMC can only colour by cell.')
    settings = ctx['settings']
    if settings is None:
        settings = openmc.Settings()
        settings.batches = 1
        settings.particles = 1
        settings.inactive = 0
    try:
        settings.export_to_xml()
    except Exception:
        warnings.append('settings.xml export failed; relying on defaults.')


def owen_geometry_bounds(geometry, fit, warnings):
    """The box automatic views frame.

    fit='materials' (default) unions the material-filled cells, so a model
    wrapped in a large vacuum sphere still fills the frame. Cells unbounded on
    an axis simply do not constrain it; an axis nothing constrains falls back
    to the whole geometry, then to +/-50 cm.
    """
    whole_lo, whole_hi = None, None
    try:
        whole_lo, whole_hi = owen_box(geometry)
    except Exception:
        pass
    lo = [float('inf'), float('inf'), float('inf')]
    hi = [float('-inf'), float('-inf'), float('-inf')]
    if fit == 'materials':
        try:
            cells = geometry.get_all_cells().values()
        except Exception:
            cells = []
        for cell in cells:
            if getattr(cell, 'fill', None) is None:
                continue
            try:
                clo, chi = owen_box(cell)
            except Exception:
                continue
            for i in range(3):
                if owen_is_finite(clo[i]) and clo[i] < lo[i]:
                    lo[i] = float(clo[i])
                if owen_is_finite(chi[i]) and chi[i] > hi[i]:
                    hi[i] = float(chi[i])
    for i in range(3):
        if lo[i] < hi[i]:
            continue
        fallback_lo = owen_finite(whole_lo[i], -50.0) if whole_lo is not None else -50.0
        fallback_hi = owen_finite(whole_hi[i], 50.0) if whole_hi is not None else 50.0
        if fallback_hi <= fallback_lo:
            fallback_lo, fallback_hi = -50.0, 50.0
        lo[i], hi[i] = fallback_lo, fallback_hi
    if fit == 'materials' and whole_lo is not None and whole_hi is not None:
        for i in range(3):
            span = hi[i] - lo[i]
            whole = owen_finite(whole_hi[i], hi[i]) - owen_finite(whole_lo[i], lo[i])
            if span > 0 and whole > span * 4.0:
                warnings.append('Framed on the material-filled cells (' + str(round(span, 3)) +
                                ' cm across axis ' + 'xyz'[i] + ') because the full geometry spans ' +
                                str(round(whole, 3)) + ' cm. Set Fit to "geometry" to see all of it.')
                break
    return lo, hi


def owen_slice_view(geometry, basis, fit, warnings, fraction=0.5):
    """(origin, width) for a slice plot: centred, 2% margin, fraction along
    the axis normal to the basis (0.5 = through the middle)."""
    axes = {'xy': (0, 1), 'xz': (0, 2), 'yz': (1, 2)}[basis]
    normal = {'xy': 2, 'xz': 1, 'yz': 0}[basis]
    origin = [0.0, 0.0, 0.0]
    if geometry is None:
        return origin, [100.0, 100.0]
    lo, hi = owen_geometry_bounds(geometry, fit, warnings)
    for i in range(3):
        origin[i] = (lo[i] + hi[i]) / 2.0
    origin[normal] = lo[normal] + (hi[normal] - lo[normal]) * float(fraction)
    width = [max(hi[axes[0]] - lo[axes[0]], 0.1) * 1.02,
             max(hi[axes[1]] - lo[axes[1]], 0.1) * 1.02]
    return origin, width
# --- end OWEN shared deck loader ---
`;
