import { fetchBinary, fetchJson } from './data';
import type { RasterSidecar, TraceSidecar } from '../types';

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

export type BinLoad<T> = { ok: true; data: T } | { ok: false; missing: boolean; message: string; path: string };

export const RASTER_COLUMNS = ['t_ms', 'neuron_row'] as const;
export const TRACE_COLUMNS = ['t_s', 'corr_A', 'corr_B'] as const;

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
): { off: number; nRows: number; nCols: number; columns: string[] } | Fail {
  const shape = sc.shape;
  if (!Array.isArray(shape) || shape.length !== 2 || !shape.every((v) => Number.isInteger(v) && v >= 0)) {
    return fail(binPath, `shape missing or malformed in sidecar (contract: [n, ${required.length}]), got ${JSON.stringify(shape)}`);
  }
  const columns = sc.columns;
  if (!Array.isArray(columns) || !columns.every((c) => typeof c === 'string')) {
    return fail(binPath, `columns missing from sidecar (contract: ${JSON.stringify(required)})`);
  }
  const missingCols = required.filter((c) => !columns.includes(c));
  if (missingCols.length > 0) {
    return fail(binPath, `sidecar columns ${JSON.stringify(columns)} lack ${missingCols.join(', ')} (contract: ${JSON.stringify(required)})`);
  }
  const [nRows, nCols] = shape as [number, number];
  if (nCols !== columns.length) {
    return fail(binPath, `shape[1] = ${nCols} does not match columns.length = ${columns.length}`);
  }
  const off = sc.byte_offset === undefined ? 0 : sc.byte_offset;
  if (!Number.isInteger(off) || (off as number) < 0) {
    return fail(binPath, `byte_offset malformed in sidecar: ${JSON.stringify(sc.byte_offset)}`);
  }
  const n = nRows * nCols;
  if ((off as number) + n * 4 > buf.byteLength) {
    return fail(binPath, `binary is truncated: need ${(off as number) + n * 4} bytes for shape ${JSON.stringify(shape)} at byte_offset ${off}, file has ${buf.byteLength}`);
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
    if (sc.data.dtype !== 'uint32') return fail(binPath, `unexpected dtype ${JSON.stringify(sc.data.dtype)} (contract: uint32)`);
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
    if (sc.data.dtype !== 'float32') return fail(binPath, `unexpected dtype ${JSON.stringify(sc.data.dtype)} (contract: float32)`);
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
