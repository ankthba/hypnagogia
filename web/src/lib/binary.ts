import { fetchBinary, fetchJson } from './data';
import type { ActivitySidecar, AtlasSidecar, RasterSidecar, TraceSidecar } from '../types';

export interface RasterData {
  sidecar: RasterSidecar;
  /** interleaved rows of `sidecar.columns` (contract: [t_ms, neuron_row]), length = nSpikes*nCols */
  values: Uint32Array;
  nSpikes: number;
  nCols: number;
}

export interface TraceData {
  sidecar: TraceSidecar;
  /** interleaved rows of `columns`, length = nBins*nCols */
  values: Float32Array;
  nBins: number;
  nCols: number;
}

/** Atlas: soma positions of the simulated neurons, quantised to uint16 with the sidecar's lo/hi bounds. */
export interface AtlasData {
  sidecar: AtlasSidecar;
  n: number;
  /** dequantised soma position in micrometres, one entry per atlas row */
  xUm: Float32Array;
  yUm: Float32Array;
  zUm: Float32Array;
  /** group code per atlas row (uint16, as the contract and the writer declare it); the label is sidecar.groups[code] */
  group: Uint16Array;
  /** label per group code, from the sidecar (index = code) */
  groupLabels: string[];
  lo: [number, number, number];
  hi: [number, number, number];
}

/**
 * Whether an activity (or clip) file can be shown to index the atlas that is loaded.
 *
 * `atlas_row` values are plain row numbers: a file exported against a different atlas still lands in
 * range and still lights real somata, just the wrong ones, so an out-of-range check cannot catch it.
 * The only thing that can is the identity the exporter stamps into both sidecars.
 */
export type IdentityCheck =
  | { state: 'verified' }
  | { state: 'unverified'; message: string }
  | { state: 'mismatch'; message: string };

export function checkAtlasIdentity(sidecar: ActivitySidecar, atlas: AtlasData): IdentityCheck {
  const rows = sidecar.n_atlas_rows;
  const fp = sidecar.atlas_fingerprint;
  const atlasFp = atlas.sidecar.atlas_fingerprint;
  if (typeof rows === 'number' && rows !== atlas.n) {
    return {
      state: 'mismatch',
      message: `the spike file was exported against an atlas of ${rows} rows, but neuron_atlas.bin holds ${atlas.n}; its atlas_row values would light the wrong neurons`,
    };
  }
  if (typeof fp === 'string' && typeof atlasFp === 'string' && fp !== atlasFp) {
    return {
      state: 'mismatch',
      message: `the spike file names atlas ${fp} but the loaded neuron_atlas.json is ${atlasFp}; the atlas was re-exported since these spikes were written, so their atlas_row values index a different row order`,
    };
  }
  if (typeof rows !== 'number' && typeof fp !== 'string') {
    return {
      state: 'unverified',
      message: 'the spike sidecar carries neither n_atlas_rows nor atlas_fingerprint, so nothing ties its atlas_row values to this atlas',
    };
  }
  if (typeof fp === 'string' && typeof atlasFp !== 'string') {
    return { state: 'unverified', message: 'neuron_atlas.json carries no atlas_fingerprint, so the spike file\'s own fingerprint cannot be checked against it' };
  }
  return { state: 'verified' };
}

/** Activity: spikes as (t_ms, atlas_row), sorted ascending in time so a window is a range. */
export interface ActivityData {
  sidecar: ActivitySidecar;
  n: number;
  tMs: Uint32Array;
  atlasRow: Uint32Array;
  maxTMs: number;
  /** true when the file was not already time-sorted and was sorted on load */
  sortedOnLoad: boolean;
}

export type BinLoad<T> = { ok: true; data: T } | { ok: false; missing: boolean; message: string; path: string };

/**
 * A file the viewer is in the middle of loading. It lives here rather than in a component because
 * the map-source channel carries it too: the rail panel has to know that a replay activity file was
 * *selected and failed*, which is a different fact from no file having been selected at all.
 */
export type Loadable<T> =
  | { state: 'loading' }
  | { state: 'ready'; data: T }
  | { state: 'failed'; missing: boolean; path: string; message: string };

export const RASTER_COLUMNS = ['t_ms', 'neuron_row'] as const;
export const TRACE_COLUMNS = ['t_s', 'corr_A', 'corr_B'] as const;
export const ATLAS_COLUMNS = ['x_q', 'y_q', 'z_q', 'group'] as const;
export const ACTIVITY_COLUMNS = ['t_ms', 'atlas_row'] as const;


/**
 * A sidecar field as it should appear in an error message.
 *
 * `JSON.stringify(undefined)` is the JavaScript value `undefined`, which lands in a template
 * literal as the word "undefined": a reader cannot tell that from a file that literally contains
 * that string. An absent field says it is absent.
 */
function describe(v: unknown): string {
  if (v === undefined) return 'no value (the field is absent)';
  return JSON.stringify(v) ?? 'no value';
}

function dirOf(p: string) {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(0, i + 1) : '';
}

type Fail = { ok: false; missing: boolean; message: string; path: string };
const fail = (path: string, message: string, missing = false): Fail => ({ ok: false, missing, message, path });

/**
 * Validates the sidecar's shape/columns against the contract and the buffer length.
 * Returns the number of rows/cols or an explicit failure. Never guesses a layout.
 */
function checkLayout(
  sc: { shape?: unknown; columns?: unknown; byte_offset?: unknown },
  buf: ArrayBuffer,
  required: readonly string[],
  binPath: string,
  /** bytes per element of the sidecar's dtype */
  bytes = 4,
): { off: number; nRows: number; nCols: number; columns: string[] } | Fail {
  const shape = sc.shape;
  if (!Array.isArray(shape) || shape.length !== 2 || !shape.every((v) => Number.isInteger(v) && v >= 0)) {
    return fail(binPath, `shape missing or malformed in sidecar (contract: [n, ${required.length}]), got ${describe(shape)}`);
  }
  const columns = sc.columns;
  if (!Array.isArray(columns) || !columns.every((c) => typeof c === 'string')) {
    return fail(binPath, `columns missing from sidecar (contract: ${JSON.stringify(required)})`);
  }
  const missingCols = required.filter((c) => !columns.includes(c));
  if (missingCols.length > 0) {
    return fail(binPath, `sidecar columns ${describe(columns)} lack ${missingCols.join(', ')} (contract: ${JSON.stringify(required)})`);
  }
  const [nRows, nCols] = shape as [number, number];
  if (nCols !== columns.length) {
    return fail(binPath, `shape[1] = ${nCols} does not match columns.length = ${columns.length}`);
  }
  const off = sc.byte_offset === undefined ? 0 : sc.byte_offset;
  if (!Number.isInteger(off) || (off as number) < 0) {
    return fail(binPath, `byte_offset malformed in sidecar: ${describe(sc.byte_offset)}`);
  }
  const n = nRows * nCols;
  if ((off as number) + n * bytes > buf.byteLength) {
    return fail(
      binPath,
      `binary is truncated: need ${(off as number) + n * bytes} bytes for shape ${describe(shape)} at byte_offset ${off}, file has ${buf.byteLength}`,
    );
  }
  return { off: off as number, nRows, nCols, columns: columns as string[] };
}

/** Decode exactly `n` little-endian uint32 values starting at `off`; any byte offset is allowed. */
function readUint32LE(buf: ArrayBuffer, off: number, n: number): Uint32Array {
  const out = new Uint32Array(n);
  const dv = new DataView(buf);
  for (let i = 0; i < n; i++) out[i] = dv.getUint32(off + 4 * i, true);
  return out;
}

/** Decode exactly `n` little-endian uint16 values starting at `off`; any byte offset is allowed. */
function readUint16LE(buf: ArrayBuffer, off: number, n: number): Uint16Array {
  const out = new Uint16Array(n);
  const dv = new DataView(buf);
  for (let i = 0; i < n; i++) out[i] = dv.getUint16(off + 2 * i, true);
  return out;
}

/** Decode exactly `n` little-endian float32 values starting at `off`; any byte offset is allowed. */
function readFloat32LE(buf: ArrayBuffer, off: number, n: number): Float32Array {
  const out = new Float32Array(n);
  const dv = new DataView(buf);
  for (let i = 0; i < n; i++) out[i] = dv.getFloat32(off + 4 * i, true);
  return out;
}

/** Loads sidecar JSON + raw little-endian binary described by it. Returns an explicit failure when absent or malformed. */
export async function loadRaster(sidecarPath: string): Promise<BinLoad<RasterData>> {
  let binPath = sidecarPath;
  try {
    const sc = await fetchJson<RasterSidecar>(sidecarPath);
    if (!sc.ok) return fail(sidecarPath, sc.message, sc.missing);
    if (typeof sc.data.bin !== 'string') return fail(sidecarPath, 'sidecar has no "bin" field');
    binPath = dirOf(sidecarPath) + sc.data.bin;
    if (sc.data.dtype !== 'uint32') return fail(binPath, `unexpected dtype ${describe(sc.data.dtype)} (contract: uint32)`);
    const buf = await fetchBinary(binPath);
    if (!buf) return fail(binPath, `${binPath} not found`, true);
    const layout = checkLayout(sc.data, buf, RASTER_COLUMNS, binPath);
    if ('ok' in layout) return layout;
    const values = readUint32LE(buf, layout.off, layout.nRows * layout.nCols);
    return { ok: true, data: { sidecar: sc.data, values, nSpikes: layout.nRows, nCols: layout.nCols } };
  } catch (e) {
    return fail(binPath, e instanceof Error ? e.message : String(e));
  }
}

export async function loadTrace(sidecarPath: string): Promise<BinLoad<TraceData>> {
  let binPath = sidecarPath;
  try {
    const sc = await fetchJson<TraceSidecar>(sidecarPath);
    if (!sc.ok) return fail(sidecarPath, sc.message, sc.missing);
    if (typeof sc.data.bin !== 'string') return fail(sidecarPath, 'sidecar has no "bin" field');
    binPath = dirOf(sidecarPath) + sc.data.bin;
    if (sc.data.dtype !== 'float32') return fail(binPath, `unexpected dtype ${describe(sc.data.dtype)} (contract: float32)`);
    // dt_s is the trace's bin width; without it the time axis has no length, so it is reported rather
    // than silently treated as 0 (which would collapse every bin onto t = 0).
    if (typeof sc.data.dt_s !== 'number' || !Number.isFinite(sc.data.dt_s) || sc.data.dt_s <= 0) {
      return fail(sidecarPath, `dt_s missing or not a positive number in the sidecar: ${describe(sc.data.dt_s)} (contract: the bin width in seconds)`);
    }
    const buf = await fetchBinary(binPath);
    if (!buf) return fail(binPath, `${binPath} not found`, true);
    const layout = checkLayout(sc.data, buf, TRACE_COLUMNS, binPath);
    if ('ok' in layout) return layout;
    const values = readFloat32LE(buf, layout.off, layout.nRows * layout.nCols);
    return { ok: true, data: { sidecar: sc.data, values, nBins: layout.nRows, nCols: layout.nCols } };
  } catch (e) {
    return fail(binPath, e instanceof Error ? e.message : String(e));
  }
}

/**
 * Loads the neuron atlas: `neuron_atlas.json` + the uint16 [n, 4] binary it names. The quantised
 * columns are dequantised to micrometres with the sidecar's own lo_um / hi_um and scale (the
 * formula the sidecar states: um = lo + q / scale * (hi - lo)). Nothing is inferred: a missing or
 * malformed sidecar field is an explicit failure, never a guessed default.
 */
export async function loadAtlas(sidecarPath = 'neuron_atlas.json'): Promise<BinLoad<AtlasData>> {
  let binPath = sidecarPath;
  try {
    const sc = await fetchJson<AtlasSidecar>(sidecarPath);
    if (!sc.ok) return fail(sidecarPath, sc.message, sc.missing);
    const s = sc.data;
    if (typeof s.bin !== 'string') return fail(sidecarPath, 'sidecar has no "bin" field');
    binPath = dirOf(sidecarPath) + s.bin;
    if (s.dtype !== 'uint16') return fail(binPath, `unexpected dtype ${describe(s.dtype)} (contract: uint16)`);
    const q = s.quantisation;
    const okTriple = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
    if (!q || !okTriple(q.lo_um) || !okTriple(q.hi_um) || typeof q.scale !== 'number' || !(q.scale > 0)) {
      return fail(sidecarPath, 'quantisation.lo_um / hi_um / scale missing or malformed; positions cannot be dequantised');
    }
    if (!Array.isArray(s.groups) || s.groups.some((g) => typeof g?.code !== 'number' || typeof g?.label !== 'string')) {
      return fail(sidecarPath, 'groups[] missing or malformed (contract: [{code, label}])');
    }
    const buf = await fetchBinary(binPath);
    if (!buf) return fail(binPath, `${binPath} not found`, true);
    const layout = checkLayout(s, buf, ATLAS_COLUMNS, binPath, 2);
    if ('ok' in layout) return layout;
    const { off, nRows, nCols, columns } = layout;
    const iX = columns.indexOf('x_q');
    const iY = columns.indexOf('y_q');
    const iZ = columns.indexOf('z_q');
    const iG = columns.indexOf('group');
    const raw = readUint16LE(buf, off, nRows * nCols);
    const xUm = new Float32Array(nRows);
    const yUm = new Float32Array(nRows);
    const zUm = new Float32Array(nRows);
    const group = new Uint16Array(nRows);
    const sx = (q.hi_um[0] - q.lo_um[0]) / q.scale;
    const sy = (q.hi_um[1] - q.lo_um[1]) / q.scale;
    const sz = (q.hi_um[2] - q.lo_um[2]) / q.scale;
    for (let i = 0; i < nRows; i++) {
      const b = i * nCols;
      xUm[i] = q.lo_um[0] + raw[b + iX] * sx;
      yUm[i] = q.lo_um[1] + raw[b + iY] * sy;
      zUm[i] = q.lo_um[2] + raw[b + iZ] * sz;
      group[i] = raw[b + iG];
    }
    const maxCode = s.groups.reduce((m, g) => Math.max(m, g.code), 0);
    const groupLabels: string[] = new Array(maxCode + 1).fill('');
    for (const g of s.groups) groupLabels[g.code] = g.label;
    return {
      ok: true,
      data: { sidecar: s, n: nRows, xUm, yUm, zUm, group, groupLabels, lo: q.lo_um, hi: q.hi_um },
    };
  } catch (e) {
    return fail(binPath, e instanceof Error ? e.message : String(e));
  }
}

/**
 * Loads one `replay/activity_<cond>_seed<k>.json` + its uint32 [n_spikes, 2] binary. The spikes are
 * materialised into two typed arrays sorted by time, so the map can take a window as a contiguous
 * range instead of rescanning the file on every frame.
 */
export async function loadActivity(sidecarPath: string): Promise<BinLoad<ActivityData>> {
  let binPath = sidecarPath;
  try {
    const sc = await fetchJson<ActivitySidecar>(sidecarPath);
    if (!sc.ok) return fail(sidecarPath, sc.message, sc.missing);
    const s = sc.data;
    if (typeof s.bin !== 'string') return fail(sidecarPath, 'sidecar has no "bin" field');
    binPath = dirOf(sidecarPath) + s.bin;
    if (s.dtype !== 'uint32') return fail(binPath, `unexpected dtype ${describe(s.dtype)} (contract: uint32)`);
    const buf = await fetchBinary(binPath);
    if (!buf) return fail(binPath, `${binPath} not found`, true);
    const layout = checkLayout(s, buf, ACTIVITY_COLUMNS, binPath, 4);
    if ('ok' in layout) return layout;
    const { off, nRows, nCols, columns } = layout;
    const iT = columns.indexOf('t_ms');
    const iR = columns.indexOf('atlas_row');
    const raw = readUint32LE(buf, off, nRows * nCols);
    let tMs = new Uint32Array(nRows);
    let atlasRow = new Uint32Array(nRows);
    let sorted = true;
    for (let i = 0; i < nRows; i++) {
      tMs[i] = raw[i * nCols + iT];
      atlasRow[i] = raw[i * nCols + iR];
      if (i > 0 && tMs[i] < tMs[i - 1]) sorted = false;
    }
    if (!sorted) {
      const order = new Uint32Array(nRows);
      for (let i = 0; i < nRows; i++) order[i] = i;
      order.sort((a, b) => tMs[a] - tMs[b]);
      const t2 = new Uint32Array(nRows);
      const r2 = new Uint32Array(nRows);
      for (let k = 0; k < nRows; k++) {
        t2[k] = tMs[order[k]];
        r2[k] = atlasRow[order[k]];
      }
      tMs = t2;
      atlasRow = r2;
    }
    return {
      ok: true,
      data: { sidecar: s, n: nRows, tMs, atlasRow, maxTMs: nRows > 0 ? tMs[nRows - 1] : 0, sortedOnLoad: !sorted },
    };
  } catch (e) {
    return fail(binPath, e instanceof Error ? e.message : String(e));
  }
}

/** Largest t_ms in a raster file (the file need not be time-sorted); 0 when empty. */
export function rasterMaxTimeMs(r: RasterData): number {
  const iT = r.sidecar.columns.indexOf('t_ms');
  if (iT < 0) return 0;
  let m = 0;
  for (let i = 0; i < r.nSpikes; i++) {
    const t = r.values[i * r.nCols + iT];
    if (t > m) m = t;
  }
  return m;
}
