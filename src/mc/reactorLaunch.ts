/**
 * Turn a converted OpenMC script into a run, and read the run back.
 *
 * OpenMC prints one line per batch once an entropy mesh is set:
 *   batch/gen   k_generation   entropy   k_average +/- sigma
 * The wrapper then prints one REACTOR_JSON line with the statepoint k,
 * the entropy history, a flux-mesh plane, and the absorption / nu-fission
 * totals. Hand-copied to owen/src/mc/reactorLaunch.ts.
 */

export interface BatchSample {
  batch: number;
  k: number;
  entropy: number;
  mean: number;
  sigma: number;
}

export interface FluxPlane {
  width: number;
  height: number;
  values: number[][];
}

export interface ReactorResult {
  k: number;
  sigma: number;
  inactive: number;
  mean: number[];
  entropy: number[];
  absorption: number;
  production: number;
  leakage: number;
  mesh?: FluxPlane;
  depletion?: { status: string; reason: string };
}

const BATCH_LINE = /^\s*(\d+)\/\d+\s+([+-]?\d+\.\d+(?:[eE][+-]?\d+)?)\s+([+-]?\d+\.\d+(?:[eE][+-]?\d+)?)\s+([+-]?\d+\.\d+(?:[eE][+-]?\d+)?)\s+\+\/-\s+([+-]?\d+\.\d+(?:[eE][+-]?\d+)?)/;

export const DEPLETION_BLOCKED = "Depletion is not run: no chain file is installed. A burn curve is not shown.";

const BLOCKING_CODES = ["mcnp.unbounded-tally", "mcnp.tally-needs-sd"];

export function parseBatchLine(line: string): BatchSample | null {
  const match = line.match(BATCH_LINE);
  if (!match) return null;
  return {
    batch: Number(match[1]),
    k: Number(match[2]),
    entropy: Number(match[3]),
    mean: Number(match[4]),
    sigma: Number(match[5]),
  };
}

export function parseBatchLog(text: string): BatchSample[] {
  const samples: BatchSample[] = [];
  for (const line of text.split(/\r?\n/)) {
    const sample = parseBatchLine(line);
    if (sample) samples.push(sample);
  }
  return samples;
}

export function parseReactorResult(text: string): ReactorResult | null {
  const line = text.split(/\r?\n/).filter((row) => row.startsWith("REACTOR_JSON ")).pop();
  if (!line) return null;
  return JSON.parse(line.slice("REACTOR_JSON ".length)) as ReactorResult;
}

/** True when the hottest mesh bin is off the border. A corner peak means the plane was sliced through the wrong axis. */
export function meshPeaksInside(mesh: FluxPlane): boolean {
  let max = -Infinity;
  let mi = 0;
  let mj = 0;
  for (let j = 0; j < mesh.values.length; j++) {
    const row = mesh.values[j];
    for (let i = 0; i < row.length; i++) {
      if (row[i] > max) {
        max = row[i];
        mi = i;
        mj = j;
      }
    }
  }
  if (!(max > 0) || mesh.values.length < 2) return false;
  const height = mesh.values.length;
  const width = mesh.values[0].length;
  if (width < 2) return false;
  return mi > 0 && mj > 0 && mi < width - 1 && mj < height - 1;
}

export function launchBlocked(codes: string[]): string | null {
  const hit = codes.filter((code) => BLOCKING_CODES.includes(code));
  if (!hit.length) return null;
  return `Not launched. ${hit.join(", ")} is a fatal tally on this deck. Fix it before OpenMC runs; the run would not be the problem you wrote.`;
}

/**
 * Replace the converter's export-only main with a run that records entropy,
 * a flux mesh, and a balance tally. Batches, particles, and the source stay
 * as the converted script wrote them.
 */
export function armOpenmcScript(converted: string, openmcExec: string): string {
  const normalized = converted.replace(/\r\n/g, "\n");
  const marker = "if __name__ == '__main__':\n    model.export_to_model_xml()";
  if (!normalized.includes(marker)) {
    throw new Error("Converted script has no model.export_to_model_xml() main to arm.");
  }
  const exe = JSON.stringify(openmcExec);
  const main = `if __name__ == '__main__':
    import json, math
    import numpy as np
    ll, ur = model.geometry.bounding_box
    lower = [float(v) for v in ll]
    upper = [float(v) for v in ur]
    dim = []
    for i in range(3):
        lo, hi = lower[i], upper[i]
        if (not math.isfinite(lo)) or (not math.isfinite(hi)) or hi <= lo:
            lower[i], upper[i] = -200.0, 200.0
            dim.append(1)
        else:
            dim.append(4)
    mesh = openmc.RegularMesh()
    mesh.lower_left = lower
    mesh.upper_right = upper
    mesh.dimension = dim
    model.settings.entropy_mesh = mesh
    flux = openmc.Tally(name='owen-mesh')
    flux.filters = [openmc.MeshFilter(mesh)]
    flux.scores = ['flux']
    balance = openmc.Tally(name='owen-balance')
    balance.scores = ['absorption', 'nu-fission']
    existing = list(model.tallies) if model.tallies else []
    model.tallies = openmc.Tallies(existing + [flux, balance])
    path = model.run(threads=4, openmc_exec=${exe})
    sp = openmc.StatePoint(path)
    k = sp.keff
    if hasattr(k, 'nominal_value'):
        mean, sigma = float(k.nominal_value), float(k.std_dev)
    elif hasattr(k, 'n'):
        mean, sigma = float(k.n), float(k.s)
    else:
        mean, sigma = float(k[0]), float(k[1])
    flat = np.asarray(sp.get_tally(name='owen-mesh').mean).reshape(-1)
    expected = dim[0] * dim[1] * dim[2]
    if flat.size == expected:
        vol = flat.reshape((dim[0], dim[1], dim[2]))
        plane = vol[:, :, vol.shape[2] // 2]
    else:
        plane = flat.reshape((-1, 1))
    bal = sp.get_tally(name='owen-balance')
    scores = [str(item) for item in bal.scores]
    data = np.asarray(bal.mean)
    axes = [i for i, n in enumerate(data.shape) if n == len(scores)]
    moved = np.moveaxis(data, axes[0], 0)
    payload = {
        'k': mean,
        'sigma': sigma,
        'inactive': int(sp.n_inactive),
        'mean': [float(v) for v in sp.k_generation],
        'entropy': [float(v) for v in sp.entropy],
        'absorption': float(moved[scores.index('absorption')].sum()),
        'production': float(moved[scores.index('nu-fission')].sum()),
        'leakage': 0.0,
        'mesh': {
            'width': int(plane.shape[1]),
            'height': int(plane.shape[0]),
            'values': [[float(v) for v in row] for row in plane],
        },
        'depletion': {'status': 'blocked', 'reason': 'No depletion chain XML is installed. openmc.deplete was not run.'},
    }
    print('REACTOR_JSON ' + json.dumps(payload))`;
  return normalized.replace(marker, main);
}
