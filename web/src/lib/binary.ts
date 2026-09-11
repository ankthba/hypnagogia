import { fetchBinary, fetchJson } from './data';
import type { RasterSidecar, TraceSidecar } from '../types';

export interface RasterData {
  sidecar: RasterSidecar;
  /** interleaved [t_ms, neuron_row] pairs, length = n_spikes*2 */
  values: Uint32Array;
  nSpikes: number;
}

export interface TraceData {
  sidecar: TraceSidecar;
  /** interleaved rows of `columns`, length = n_bins*ncol */
  values: Float32Array;
  nBins: number;
  nCols: number;
}

export type BinLoad<T> = { ok: true; data: T } | { ok: false; missing: boolean; message: string; path: string };

function dirOf(p: string) {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(0, i + 1) : '';
}

/** Loads sidecar JSON + raw little-endian binary described by it. Returns an explicit failure when absent. */
export async function loadRaster(sidecarPath: string): Promise<BinLoad<RasterData>> {
  const sc = await fetchJson<RasterSidecar & { byte_offset?: number }>(sidecarPath);
  if (!sc.ok) return { ok: false, missing: sc.missing, message: sc.message, path: sidecarPath };
  const binPath = dirOf(sidecarPath) + sc.data.bin;
  const buf = await fetchBinary(binPath);
  if (!buf) return { ok: false, missing: true, message: `${binPath} not found`, path: binPath };
  const off = sc.data.byte_offset ?? 0;
  if (sc.data.dtype !== 'uint32') return { ok: false, missing: false, message: `unexpected dtype ${sc.data.dtype} (contract: uint32)`, path: binPath };
  const usable = Math.floor((buf.byteLength - off) / 4);
  const values = new Uint32Array(buf, off, usable);
  const nCols = sc.data.shape?.[1] ?? 2;
  const nSpikes = Math.floor(usable / nCols);
  if (nCols !== 2) return { ok: false, missing: false, message: `unexpected shape ${JSON.stringify(sc.data.shape)} (contract: [n_spikes, 2])`, path: binPath };
  return { ok: true, data: { sidecar: sc.data, values, nSpikes } };
}

export async function loadTrace(sidecarPath: string): Promise<BinLoad<TraceData>> {
  const sc = await fetchJson<TraceSidecar & { byte_offset?: number }>(sidecarPath);
  if (!sc.ok) return { ok: false, missing: sc.missing, message: sc.message, path: sidecarPath };
  const binPath = dirOf(sidecarPath) + sc.data.bin;
  const buf = await fetchBinary(binPath);
  if (!buf) return { ok: false, missing: true, message: `${binPath} not found`, path: binPath };
  const off = sc.data.byte_offset ?? 0;
  if (sc.data.dtype !== 'float32') return { ok: false, missing: false, message: `unexpected dtype ${sc.data.dtype} (contract: float32)`, path: binPath };
  const usable = Math.floor((buf.byteLength - off) / 4);
  const values = new Float32Array(buf, off, usable);
  const nCols = sc.data.shape?.[1] ?? sc.data.columns?.length ?? 3;
  const nBins = Math.floor(usable / nCols);
  return { ok: true, data: { sidecar: sc.data, values, nBins, nCols } };
}
