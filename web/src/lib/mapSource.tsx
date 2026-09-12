import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ActivityData, Loadable } from './binary';

/**
 * The channel between the Replay page and the persistent neuron-map panel in the right-hand rail.
 *
 * The panel lives in the Layout, outside the routed Outlet, so it cannot see which seed/condition
 * the Replay page has selected. The Replay page publishes that *selection* here, together with the
 * state of the file it names; the panel plays it in preference to anything else.
 *
 * What is published is the selection, not only the payload. That distinction is the contract: a
 * reference clip may stand in only when the selected seed/condition has no `replay/activity_*` file
 * at all. A file that exists but is missing from disk, truncated, malformed, or refused for a stale
 * atlas fingerprint is not an absent file - it is the finding the reader has to see, and the rail
 * must report it rather than quietly lighting up a different simulation beside it.
 *
 * Nothing is fabricated by this module: it carries a file path and, when the parse succeeded, the
 * typed arrays that came out of that file. The panel runs its own clock: it is not slaved to the
 * Replay page's scrubber, so scrubbing there does not re-render the whole layout.
 */

export interface ReplayActivitySelection {
  /** the sidecar this selection names, e.g. "replay/activity_sleep_seed0.json" */
  path: string;
  condition: string;
  seed: number;
  /** the state of that file: loading, parsed, or a failure the panel must report */
  load: Loadable<ActivityData>;
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

/** Read the currently published replay selection (the panel). */
export function useReplayActivity(): ReplayActivitySelection | null {
  return useContext(MapSourceContext).replay;
}

/**
 * Publish the replay selection for the map panel (the Replay page). Publish it whenever a concrete
 * activity path is identified, whatever state that file is in; publish `null` only when stage 6 has
 * named no seed/condition, which is the one case in which a reference clip may play instead. The
 * publication is cleared when the page unmounts.
 */
export function usePublishReplayActivity(sel: ReplayActivitySelection | null) {
  const { publish } = useContext(MapSourceContext);
  const path = sel?.path ?? null;
  const condition = sel?.condition ?? null;
  const seed = sel?.seed ?? null;
  const load = sel?.load ?? null;
  useEffect(() => {
    if (path && condition !== null && seed !== null && load) {
      publish({ path, condition, seed, load });
    } else {
      publish(null);
    }
  }, [publish, path, condition, seed, load]);
  useEffect(() => () => publish(null), [publish]);
}
