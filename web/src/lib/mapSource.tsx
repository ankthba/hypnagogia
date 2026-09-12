import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ActivityData } from './binary';

/**
 * The channel between the Replay page and the persistent neuron-map panel in the right-hand rail.
 *
 * The panel lives in the Layout, outside the routed Outlet, so it cannot see which seed/condition
 * the Replay page has selected. The Replay page publishes its *loaded* activity here; the panel
 * plays it in preference to anything else. Nothing is fabricated by this module: it only carries a
 * file path and the typed arrays that were parsed from that file. When the Replay page has no
 * activity file for the selected seed/condition it publishes nothing, and the panel falls back to
 * a reference clip (which it labels as such). The panel runs its own clock: it is not slaved to the
 * Replay page's scrubber, so scrubbing there does not re-render the whole layout.
 */

export interface ReplayActivitySelection {
  /** the sidecar this came from, e.g. "replay/activity_sleep_seed0.json" */
  path: string;
  condition: string;
  seed: number;
  data: ActivityData;
}

interface Ctx {
  replay: ReplayActivitySelection | null;
  publish: (sel: ReplayActivitySelection | null) => void;
}

const MapSourceContext = createContext<Ctx>({ replay: null, publish: () => {} });

export function MapSourceProvider({ children }: { children: ReactNode }) {
  const [replay, setReplay] = useState<ReplayActivitySelection | null>(null);
  const publish = useCallback((sel: ReplayActivitySelection | null) => setReplay(sel), []);
  const value = useMemo(() => ({ replay, publish }), [replay, publish]);
  return <MapSourceContext.Provider value={value}>{children}</MapSourceContext.Provider>;
}

/** Read the currently published replay activity (the panel). */
export function useReplayActivity(): ReplayActivitySelection | null {
  return useContext(MapSourceContext).replay;
}

/**
 * Publish the replay activity for the map panel (the Replay page). Clears the publication when the
 * page unmounts or when the selection no longer has a loaded file.
 */
export function usePublishReplayActivity(sel: ReplayActivitySelection | null) {
  const { publish } = useContext(MapSourceContext);
  const path = sel?.path ?? null;
  const data = sel?.data ?? null;
  const condition = sel?.condition ?? null;
  const seed = sel?.seed ?? null;
  useEffect(() => {
    if (path && data && condition !== null && seed !== null) {
      publish({ path, condition, seed, data });
    } else {
      publish(null);
    }
  }, [publish, path, data, condition, seed]);
  useEffect(() => () => publish(null), [publish]);
}
