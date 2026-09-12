import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * The one seed and condition the whole site is looking at.
 *
 * The neuron-map panel lives in the Layout, outside the routed Outlet, and the Replay page has its
 * own condition and seed controls; before this they were two independent selections and the rail
 * could be playing a different run from the one the page was describing. There is now one
 * selection, held here, that both of them read and both of them write.
 *
 * The selection is a pair of names, not a payload: the file it implies is
 * `replay/activity_<condition>_seed<seed>.json`, and whether that file exists, parses, and belongs
 * to the loaded atlas is decided where it is loaded. A file that is named but missing or stale is
 * the finding the reader has to see, and nothing else is ever animated in its place.
 */

export interface MapSelection {
  condition: string;
  seed: number;
}

/** One `(condition, seed)` the replay stage says it exported activity for. */
export interface ActivityRef extends MapSelection {
  /** the sidecar path the stage file states, relative to public/data */
  file: string;
}

interface Ctx {
  selection: MapSelection | null;
  setSelection: (s: MapSelection) => void;
}

const MapSelectionContext = createContext<Ctx>({ selection: null, setSelection: () => {} });

export function MapSourceProvider({ children }: { children: ReactNode }) {
  const [selection, setSel] = useState<MapSelection | null>(null);
  const setSelection = useCallback((s: MapSelection) => {
    setSel((prev) => (prev && prev.condition === s.condition && prev.seed === s.seed ? prev : s));
  }, []);
  const value = useMemo(() => ({ selection, setSelection }), [selection, setSelection]);
  return <MapSelectionContext.Provider value={value}>{children}</MapSelectionContext.Provider>;
}

export function useMapSelection(): Ctx {
  return useContext(MapSelectionContext);
}

/**
 * The `(condition, seed)` pairs the replay stage states it exported whole-brain activity for, read
 * out of `stage6_replay.json`'s own `activity[]` list. Nothing is assumed: a stage file that lists
 * none yields none, and the panel then renders the "not yet run" state.
 */
export function activityRefs(stage: unknown): ActivityRef[] {
  const list = (stage as { activity?: unknown } | null)?.activity;
  if (!Array.isArray(list)) return [];
  const out: ActivityRef[] = [];
  for (const e of list) {
    const r = e as { condition?: unknown; seed?: unknown; file?: unknown };
    if (typeof r?.condition !== 'string' || typeof r?.seed !== 'number' || !Number.isFinite(r.seed)) continue;
    out.push({ condition: r.condition, seed: r.seed, file: typeof r.file === 'string' ? r.file : activityPath(r.condition, r.seed) });
  }
  out.sort((a, b) => (a.condition === b.condition ? a.seed - b.seed : a.condition.localeCompare(b.condition)));
  return out;
}

/** The contract's filename for one run's whole-brain activity. */
export function activityPath(condition: string, seed: number): string {
  return `replay/activity_${condition}_seed${seed}.json`;
}
