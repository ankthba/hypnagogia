import { useEffect, useState } from 'react';
import type { StageKey } from '../types';

/** Base URL for the data directory (same-origin; respects Vite base for GitHub Pages). */
export const DATA_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/data/`;

export function dataUrl(relPath: string): string {
  return DATA_BASE + relPath.replace(/^\//, '');
}

export type Loaded<T> =
  | { state: 'loading' }
  | { state: 'missing'; path: string }
  | { state: 'error'; path: string; message: string }
  | { state: 'ready'; data: T; path: string };

const jsonCache = new Map<string, Promise<unknown>>();

export async function fetchJson<T>(relPath: string): Promise<{ ok: true; data: T } | { ok: false; missing: boolean; message: string }> {
  const url = dataUrl(relPath);
  try {
    let p = jsonCache.get(url);
    if (!p) {
      p = fetch(url, { cache: 'no-cache' }).then(async (r) => {
        if (r.status === 404) throw new NotFound(url);
        if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
        const ct = r.headers.get('content-type') ?? '';
        const text = await r.text();
        // Vite dev / Pages return index.html for unknown paths in some setups; guard against parsing HTML.
        if (ct.includes('text/html') || text.trimStart().startsWith('<')) throw new NotFound(url);
        return JSON.parse(text);
      });
      jsonCache.set(url, p);
    }
    const data = (await p) as T;
    return { ok: true, data };
  } catch (e) {
    jsonCache.delete(url);
    if (e instanceof NotFound) return { ok: false, missing: true, message: `${url} not found (404)` };
    return { ok: false, missing: false, message: e instanceof Error ? e.message : String(e) };
  }
}

class NotFound extends Error {
  constructor(url: string) {
    super(`404 ${url}`);
  }
}

export async function fetchBinary(relPath: string): Promise<ArrayBuffer | null> {
  const url = dataUrl(relPath);
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) return null;
  const ct = r.headers.get('content-type') ?? '';
  if (ct.includes('text/html')) return null;
  return r.arrayBuffer();
}

/** Load a JSON file under public/data. Never substitutes any default data. */
export function useDataFile<T>(relPath: string | null): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ state: 'loading' });
  useEffect(() => {
    let cancelled = false;
    if (!relPath) {
      setState({ state: 'loading' });
      return;
    }
    setState({ state: 'loading' });
    fetchJson<T>(relPath).then((res) => {
      if (cancelled) return;
      if (res.ok) setState({ state: 'ready', data: res.data, path: relPath });
      else if (res.missing) setState({ state: 'missing', path: relPath });
      else setState({ state: 'error', path: relPath, message: res.message });
    });
    return () => {
      cancelled = true;
    };
  }, [relPath]);
  return state;
}

/** Canonical stage list (order, default filenames, producing scripts). Metadata only; no results. */
export const STAGES: { key: StageKey; file: string; script: string; route: string; label: string }[] = [
  { key: 'stage0_reproduction', file: 'stage0_reproduction.json', script: 'scripts/stage0_reproduction.py', route: '/', label: 'Stage 0 - Reproduction' },
  { key: 'stage1_noise', file: 'stage1_noise.json', script: 'scripts/stage1_noise.py', route: '/criticality', label: 'Stage 1 - Noise' },
  { key: 'stage2_criticality', file: 'stage2_criticality.json', script: 'scripts/stage2_criticality.py', route: '/criticality', label: 'Stage 2 - Criticality' },
  { key: 'stage3_plasticity', file: 'stage3_plasticity.json', script: 'scripts/stage3_plasticity.py', route: '/learning', label: 'Stage 3 - Plasticity' },
  { key: 'stage4_learning', file: 'stage4_learning.json', script: 'scripts/stage4_learning.py', route: '/learning', label: 'Stage 4 - Learning' },
  { key: 'stage5_sleep', file: 'stage5_sleep.json', script: 'scripts/stage5_sleep.py', route: '/replay', label: 'Stage 5 - Sleep' },
  { key: 'stage6_replay', file: 'stage6_replay.json', script: 'scripts/stage6_replay.py', route: '/replay', label: 'Stage 6 - Replay' },
];

export function stageMeta(key: StageKey) {
  return STAGES.find((s) => s.key === key)!;
}
