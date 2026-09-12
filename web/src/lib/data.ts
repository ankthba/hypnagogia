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

/** Fetch a raw binary under public/data. Returns null when absent or unreachable (never throws). */
export async function fetchBinary(relPath: string): Promise<ArrayBuffer | null> {
  const url = dataUrl(relPath);
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') ?? '';
    if (ct.includes('text/html')) return null;
    return await r.arrayBuffer();
  } catch {
    return null;
  }
}

/** Repository URL used by provenance footers to link config/data paths at a commit. */
export const REPO_URL = 'https://github.com/ankthba/hypnagogia';

/**
 * Load a JSON file under public/data. Never substitutes any default data.
 *
 * `defer` holds the request back until the browser is idle. The site-wide map panel needs
 * `stage6_replay.json` only to know which seeds and conditions exist, and that file is 179 kB; on
 * a page that is not about replay it must not compete with the atlas, the page's own stage file or
 * the first paint. It is the same cached promise the Replay page uses, so nothing is fetched twice.
 */
export function useDataFile<T>(relPath: string | null, opts?: { defer?: boolean }): Loaded<T> {
  const defer = opts?.defer ?? false;
  const [state, setState] = useState<Loaded<T>>({ state: 'loading' });
  useEffect(() => {
    let cancelled = false;
    if (!relPath) {
      setState({ state: 'loading' });
      return;
    }
    setState({ state: 'loading' });
    const run = () => {
      if (cancelled) return;
      fetchJson<T>(relPath).then((res) => {
        if (cancelled) return;
        if (res.ok) setState({ state: 'ready', data: res.data, path: relPath });
        else if (res.missing) setState({ state: 'missing', path: relPath });
        else setState({ state: 'error', path: relPath, message: res.message });
      });
    };
    let cancelIdle: (() => void) | null = null;
    if (defer && !jsonCache.has(dataUrl(relPath))) {
      const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (typeof ric === 'function') {
        const id = ric(run, { timeout: 2500 });
        const cic = (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
        cancelIdle = () => cic?.(id);
      } else {
        const t = window.setTimeout(run, 400);
        cancelIdle = () => window.clearTimeout(t);
      }
    } else {
      run();
    }
    return () => {
      cancelled = true;
      cancelIdle?.();
    };
  }, [relPath, defer]);
  return state;
}

/**
 * Canonical stage list (order, default filenames, producing scripts). Metadata only; no results.
 * Script names follow the stage table in the repository README.md; they are the documented
 * (planned) pipeline entry points and must be kept in sync as the scripts land.
 */
export const STAGES: { key: StageKey; file: string; script: string; route: string; label: string }[] = [
  { key: 'stage0_reproduction', file: 'stage0_reproduction.json', script: 'scripts/00_reproduce_shiu.py', route: '/', label: 'Stage 0 - Reproduction' },
  { key: 'stage1_noise', file: 'stage1_noise.json', script: 'scripts/01_noise.py', route: '/criticality', label: 'Stage 1 - Noise' },
  { key: 'stage2_criticality', file: 'stage2_criticality.json', script: 'scripts/02_criticality.py', route: '/criticality', label: 'Stage 2 - Criticality' },
  { key: 'stage3b_feasibility', file: 'stage3b_feasibility.json', script: 'scripts/03b_odor_calibration.py', route: '/learning', label: 'Stage 3b - Odour code feasibility' },
  { key: 'stage3_plasticity', file: 'stage3_plasticity.json', script: 'scripts/03_plasticity.py', route: '/learning', label: 'Stage 3 - Plasticity' },
  { key: 'stage4_learning', file: 'stage4_learning.json', script: 'scripts/04_encode.py', route: '/learning', label: 'Stage 4 - Learning' },
  { key: 'stage5_sleep', file: 'stage5_sleep.json', script: 'scripts/05_sleep.py', route: '/replay', label: 'Stage 5 - Sleep' },
  { key: 'stage6_replay', file: 'stage6_replay.json', script: 'scripts/06_replay.py', route: '/replay', label: 'Stage 6 - Replay' },
];

export function stageMeta(key: StageKey) {
  return STAGES.find((s) => s.key === key)!;
}
