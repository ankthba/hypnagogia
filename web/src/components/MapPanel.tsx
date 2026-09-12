import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import BrainMap, { AtlasCaption, VncToggle, atlasProvenance, useActivity, useAtlas, type MapSourceLabel, type TimeSource } from './BrainMap';
import NotRunPanel from './NotRunPanel';
import ProvenanceFooter from './ProvenanceFooter';
import { useDataFile } from '../lib/data';
import { useMediaQuery, useViewportHeight } from '../lib/media';
import { activityPath, activityRefs, useMapSelection, type ActivityRef } from '../lib/mapSource';
import { fmtInt, fmtNum } from '../lib/format';
import { checkAtlasIdentity, type ActivityData, type AtlasData, type IdentityCheck } from '../lib/binary';
import type { Manifest } from '../types';

/**
 * The persistent neuron map in the right-hand rail (and, where there is no rail, in the page's own
 * map slot). It is on every page, and it is never blank while `neuron_atlas.json` is readable: the
 * atlas alone draws the populations.
 *
 * There is exactly one thing it can animate, and it is the experiment's own output: the file
 * `replay/activity_<condition>_seed<k>.json` for the seed and condition selected here (the same
 * selection the Replay page's controls read and write). If that file is absent, unreadable, or
 * paired with a different atlas, the panel says so, names the file and the script that writes it,
 * and lights nothing. There is no second source and no demo mode: every spike drawn here was read
 * out of a binary the pipeline wrote.
 */

/** A spike stays lit for this long on the panel map, fading out (MAP_SPEC.md: a 150 ms tail). */
const DECAY_MS = 150;
/** Fixed simulation step for the loop, so the playback rate does not depend on the frame rate. */
const STEP_MS = 1000 / 60;
/** The script that writes the activity files, named wherever one is missing. */
const REPLAY_SCRIPT = 'scripts/06_replay.py';

// ---------------------------------------------------------------- the loop clock

/**
 * The playback clock, as a mutable store rather than as state.
 *
 * This panel is mounted by the Layout on every page, so its loop runs site-wide and permanently.
 * Holding the time in `useState` here would reconcile the whole subtree, the selectors, the play
 * button, the source text, the provenance footer, sixty times a second for a value none of them
 * reads. The map reads the store directly inside its own draw loop; only the small clock readout
 * subscribes.
 */
interface Clock extends TimeSource {
  subscribe: (cb: () => void) => () => void;
  get: () => number;
}

function useMapClock(durationMs: number, playing: boolean, sourceKey: string): Clock {
  const store = useRef<{ t: number; subs: Set<() => void> }>({ t: 0, subs: new Set() }).current;
  const clock = useMemo<Clock>(
    () => ({
      subscribe: (cb) => {
        store.subs.add(cb);
        return () => {
          store.subs.delete(cb);
        };
      },
      get: () => store.t,
    }),
    [store],
  );

  // a new file starts at its own beginning, not where the last one happened to be
  useEffect(() => {
    store.t = 0;
    store.subs.forEach((cb) => cb());
  }, [sourceKey, store]);

  useEffect(() => {
    if (!playing || durationMs <= 0) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    // The readout is 2 decimal places of seconds, so notifying its subscriber more than about
    // twenty times a second changes nothing on screen and costs a React render each time.
    let lastNotify = 0;
    const tick = (now: number) => {
      acc += Math.min(250, now - last);
      last = now;
      let t = store.t;
      while (acc >= STEP_MS) {
        t += STEP_MS;
        acc -= STEP_MS;
      }
      // Loop by wrapping rather than resetting. The map is told the loop length too, so its decay
      // window wraps with the clock and the seam is one frame like any other.
      if (t >= durationMs) t -= Math.floor(t / durationMs) * durationMs;
      store.t = t;
      if (now - lastNotify > 50) {
        lastNotify = now;
        store.subs.forEach((cb) => cb());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, durationMs, store]);

  return clock;
}

function useClockTime(clock: Clock): number {
  return useSyncExternalStore(clock.subscribe, clock.get, clock.get);
}

/**
 * True once `ready` is true and the browser has had an idle moment since.
 *
 * It is how the panel keeps a three-megabyte fetch off the critical path without giving up
 * MAP_SPEC.md's rule that the map plays on every route: the request is made, just not while the
 * page is still laying itself out and parsing the atlas. The timeout is the ceiling, so a browser
 * that is never idle still gets there.
 */
function useIdleAfter(ready: boolean): boolean {
  const [go, setGo] = useState(false);
  useEffect(() => {
    if (!ready || go) return;
    const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(() => setGo(true), { timeout: 1500 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(() => setGo(true), 300);
    return () => window.clearTimeout(t);
  }, [ready, go]);
  return go;
}

// ---------------------------------------------------------------- the panel

export default function MapPanel() {
  // The wrapper is state rather than a ref: the panel returns a different tree while the atlas is
  // still loading, so the node the observers below are attached to is replaced on the way to the
  // map, and an effect that only ran on mount would be left watching a detached element.
  const [wrap, setWrap] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(380);
  // Coalesced to one update per frame, like the map's own observer: dragging a window edge
  // otherwise re-renders the whole panel once per observed pixel.
  useEffect(() => {
    if (!wrap) return;
    let raf = 0;
    let pending = 0;
    const ro = new ResizeObserver((e) => {
      pending = Math.max(240, Math.floor(e[0].contentRect.width));
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setWidth((w) => (Math.abs(w - pending) < 2 ? w : pending));
      });
    });
    ro.observe(wrap);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [wrap]);

  /**
   * Whether the panel has come within reach of the viewport.
   *
   * The activity binary is 3 MB, and this panel is mounted by the Layout on every route. On a
   * phone the map sits inside the page, often well below the fold, and on a short window the rail
   * can start off screen too; fetching three megabytes of spikes for a picture nobody has scrolled
   * to is the reader's bandwidth spent on nothing. Once the panel has been near the viewport the
   * flag stays set: scrolling past the map must not cancel a run that is already playing.
   */
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (!wrap || near) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: '600px' },
    );
    io.observe(wrap);
    return () => io.disconnect();
  }, [wrap, near]);
  const narrow = useMediaQuery('(max-width: 699px)');
  const railed = useMediaQuery('(min-width: 1100px)');
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const viewportH = useViewportHeight();

  const m = useDataFile<Manifest>('manifest.json');
  const manifest = m.state === 'ready' ? m.data : null;
  const atlas = useAtlas();
  const atlasData: AtlasData | null = atlas.state === 'ready' ? atlas.data : null;

  // Which runs exist is the stage file's own statement. It is fetched when the browser is idle:
  // on a page that is not about replay it must not compete with the atlas or the first paint.
  const s6 = useDataFile<unknown>('stage6_replay.json', { defer: true });
  const refs: ActivityRef[] = useMemo(() => (s6.state === 'ready' ? activityRefs(s6.data) : []), [s6]);

  const { selection, setSelection } = useMapSelection();
  /**
   * The default run: the sleep condition at its lowest seed, which is the state this whole project
   * is about, and the first condition the file lists at its lowest seed if this export has no
   * sleep condition at all. It holds only until something selects another, here or on the Replay
   * page, and nothing is ever assembled that the stage file does not list.
   */
  useEffect(() => {
    if (selection || refs.length === 0) return;
    const preferred = refs.filter((r) => r.condition === 'sleep');
    const pool = preferred.length > 0 ? preferred : refs.filter((r) => r.condition === refs[0].condition);
    const seed = Math.min(...pool.map((r) => r.seed));
    setSelection({ condition: pool[0].condition, seed });
  }, [selection, refs, setSelection]);

  const conditions = useMemo(() => [...new Set(refs.map((r) => r.condition))], [refs]);
  const seedsForCond = useMemo(
    () => (selection ? refs.filter((r) => r.condition === selection.condition).map((r) => r.seed) : []),
    [refs, selection],
  );

  /** the stage file's own entry for the selected pair, when it lists one */
  const exact = useMemo(
    () => (selection ? (refs.find((r) => r.condition === selection.condition && r.seed === selection.seed) ?? null) : null),
    [refs, selection],
  );
  const listed = exact !== null;
  const path = selection ? (exact?.file ?? activityPath(selection.condition, selection.seed)) : null;

  /**
   * Changing the condition keeps the seed when that seed exists for it and otherwise falls back to
   * the first seed the stage file lists for the new condition. A pair the file does not list is
   * never assembled here.
   */
  const setCondition = (c: string) => {
    const forC = refs.filter((r) => r.condition === c).map((r) => r.seed);
    if (forC.length === 0) return;
    const keep = selection && forC.includes(selection.seed) ? selection.seed : forC[0];
    setSelection({ condition: c, seed: keep });
  };
  const setSeed = (s: number) => {
    if (selection) setSelection({ condition: selection.condition, seed: s });
  };
  /**
   * When the run is actually fetched.
   *
   * MAP_SPEC.md requires the map to be live on every route, so the run is still loaded everywhere
   * and still starts playing by itself; what changed is that its three megabytes are no longer on
   * the critical path of the first paint. Two gates: the panel has to be within reach of the
   * viewport, and the atlas (985 kB, and the thing that draws the picture) has to be parsed and the
   * browser idle. Before the pipeline of the first paint has drained, nothing asks for the spikes.
   */
  const idle = useIdleAfter(atlas.state !== 'loading');
  const wantRun = near && idle;
  const load = useActivity(wantRun ? path : null);
  const activity: ActivityData | null = load?.state === 'ready' ? load.data : null;
  const sourceKey = path ?? 'none';
  /** the run is selected but its bytes are not here yet: queued behind the gates, or on the wire */
  const pending = path !== null && (load === null || load.state === 'loading');

  /**
   * Whether the loaded spike file belongs to the loaded atlas.
   *
   * `atlas_row` values from a different atlas are all in range and all land on real somata, so
   * nothing but the identity the exporter stamps into both sidecars can tell a current pairing from
   * a stale one. BrainMap refuses to light anything on a mismatch; this panel has to stop saying
   * that the spikes on the map are this run's, and stop printing a "neurons lit" count for neurons
   * that are not lit.
   */
  const identity: IdentityCheck | null = useMemo(
    () => (activity && atlasData ? checkAtlasIdentity(activity.sidecar, atlasData) : null),
    [activity, atlasData],
  );
  const mismatched = identity?.state === 'mismatch';

  // The loop length: the sidecar's own duration, never shorter than the last spike it holds.
  const durationMs = activity ? Math.max(Math.round((activity.sidecar.duration_s ?? 0) * 1000), activity.maxTMs + 1) : 0;
  const canPlay = durationMs > 0;

  const [playing, setPlaying] = useState(!reduceMotion);
  useEffect(() => {
    if (reduceMotion) setPlaying(false);
  }, [reduceMotion]);

  const clock = useMapClock(durationMs, playing && canPlay, sourceKey);
  /** what the map's draw loop reads: the clock while something is playing, nothing otherwise */
  const time = useMemo<TimeSource>(() => ({ get: () => (activity && durationMs > 0 ? clock.get() : null) }), [clock, activity, durationMs]);

  // Framed on view_boxes.brain by default; the switch below opens it out to view_boxes.all.
  const [showVnc, setShowVnc] = useState(false);

  /**
   * The canvas takes the frame's own aspect; this is only the ceiling it may not pass. It is
   * budgeted against the viewport rather than fixed, so on a short screen the panel does not grow
   * taller than the page wants to give it.
   */
  const mapHeight = narrow
    ? Math.round(Math.min(width * 1.5, 460))
    : railed
      ? Math.round(Math.max(260, Math.min(620, viewportH * 0.42)))
      : Math.round(Math.max(280, Math.min(520, viewportH * 0.5)));

  /** Neurons that actually spike in the loaded file, counted from the binary rather than trusted. */
  const activeCounted = useMemo(() => (activity ? countDistinctRows(activity.atlasRow) : null), [activity]);

  /**
   * What the header says the map is showing. While the run's several megabytes are still on the
   * wire the map is already drawn and simply has nothing lit yet, and saying "not loaded" there
   * reads as a failure rather than as a wait, which is what it looked like on every page that is
   * not Replay. The three states are now distinct: loading, loaded, and could not be loaded.
   */
  const source: MapSourceLabel = useMemo(() => {
    if (!selection) return { text: 'atlas only · no run selected' };
    const head = `replay activity · ${selection.condition}, seed ${selection.seed}`;
    if (activity) return { text: mismatched ? `${head} · exported against a different atlas, nothing is lit` : head };
    if (load?.state === 'failed') return { text: `${head} · could not be loaded, nothing is lit` };
    if (!wantRun) return { text: `${head} · the atlas is drawn; the run loads next` };
    return { text: `${head} · loading the run …` };
  }, [selection, activity, load, mismatched, wantRun]);

  const prov = useMemo(() => atlasProvenance(atlasData, manifest, path ? [`web/public/data/${path}`] : []), [atlasData, manifest, path]);

  if (atlas.state === 'loading') {
    return (
      <div ref={setWrap} className="map-panel">
        <PanelHead source={source} />
        <div className="small muted py-6">loading neuron_atlas.json …</div>
      </div>
    );
  }

  if (atlas.state === 'failed') {
    return (
      <div ref={setWrap} className="map-panel">
        <PanelHead source={source} />
        <NotRunPanel
          file={atlas.path}
          script="scripts/export_web.py"
          reason={atlas.missing ? 'missing' : 'error'}
          title="Neuron atlas (soma positions)"
          note={<span>No map is drawn in its place.</span>}
        />
        {!atlas.missing && <div className="mt-2 smaller tone-failed mono">{atlas.message}</div>}
      </div>
    );
  }

  return (
    <div ref={setWrap} className="map-panel">
      <PanelHead source={source} />

      <BrainMap
        atlas={atlas.data}
        activity={activity}
        activityLoading={pending}
        source={source}
        time={time}
        decayMs={DECAY_MS}
        // the panel loops, so the decay window wraps at the seam instead of being cut off at 0
        loopMs={durationMs > 0 ? durationMs : undefined}
        height={mapHeight}
        showVnc={showVnc}
        onShowVncChange={setShowVnc}
        variant="panel"
        background="page"
        showVncControl={false}
        showLegend
        showStatus
      />

      {/* Which run is on screen, and the controls that change it. Both are in the panel itself, so
          the map is a usable instrument on every page and not only on the Replay page. */}
      <RunPicker
        conditions={conditions}
        seeds={seedsForCond}
        selection={selection}
        setCondition={setCondition}
        setSeed={setSeed}
        state={s6.state}
        nRuns={refs.length}
      />

      <SourceLine
        condition={selection?.condition ?? null}
        seed={selection?.seed ?? null}
        path={path}
        listed={listed}
        load={load}
        requested={wantRun}
        identity={identity}
        s6State={s6.state}
        nRuns={refs.length}
        activeCounted={activeCounted}
        canPlay={canPlay}
        playing={playing}
        reduceMotion={reduceMotion}
      />

      <div className="map-panel__controls">
        <button
          type="button"
          className="control map-panel__play"
          onClick={() => setPlaying((v) => !v)}
          disabled={!canPlay}
          aria-pressed={playing}
          title={canPlay ? (playing ? 'pause the map' : 'play the map') : 'nothing to play'}
        >
          {playing ? '❙❙ pause' : '▶ play'}
        </button>
        {canPlay && <ClockReadout clock={clock} durationMs={durationMs} />}
        {atlas.data.sidecar.view_boxes?.brain && <VncToggle atlas={atlas.data} on={showVnc} set={setShowVnc} compact />}
      </div>

      {/* MAP_SPEC.md attaches this caption to the map, and this is the map that is on every page:
          soma positions and not morphology, and the receptor neurons that are simulated but have no
          soma in the volume. It is folded because the rail has a height budget, never omitted, and
          every number in it is the sidecar's own. */}
      <details className="map-panel__more map-panel__caption">
        <summary className="smaller">what these dots are</summary>
        <p className="smaller">
          <AtlasCaption atlas={atlas.data} activity={activity} />
        </p>
      </details>

      <ProvenanceFooter provenance={prov.provenance} commitNote={prov.commitNote} note={prov.note} />
    </div>
  );
}

/** Distinct atlas rows in a spike array: how many neurons the file actually lights. */
function countDistinctRows(rows: Uint32Array): number {
  if (rows.length === 0) return 0;
  let max = 0;
  for (let i = 0; i < rows.length; i++) if (rows[i] > max) max = rows[i];
  const seen = new Uint8Array(max + 1);
  let n = 0;
  for (let i = 0; i < rows.length; i++) {
    if (!seen[rows[i]]) {
      seen[rows[i]] = 1;
      n++;
    }
  }
  return n;
}

/**
 * The panel's head. It names the instrument and, on the same rule, what the instrument is currently
 * showing, so the identity is above the picture as well as carried by it.
 */
function PanelHead({ source }: { source: MapSourceLabel }) {
  return (
    <div className="map-panel__head">
      <div className="map-panel__head-row">
        <span className="label label--ink">neuron map</span>
        <span className="smaller muted">soma positions, 3D</span>
      </div>
      <div className="smaller map-panel__head-source muted">{source.text}</div>
    </div>
  );
}

/**
 * Condition and seed. Both lists are read from `stage6_replay.json`'s own `activity[]`, so the
 * panel offers exactly the runs the pipeline says it exported and never a combination it invented.
 */
function RunPicker({
  conditions,
  seeds,
  selection,
  setCondition,
  setSeed,
  state,
  nRuns,
}: {
  conditions: string[];
  seeds: number[];
  selection: { condition: string; seed: number } | null;
  setCondition: (c: string) => void;
  setSeed: (s: number) => void;
  state: 'loading' | 'missing' | 'error' | 'ready';
  nRuns: number;
}) {
  if (state === 'loading') return <div className="map-panel__runs small muted">reading stage6_replay.json for the runs that exist …</div>;
  if (nRuns === 0) {
    return (
      <div className="map-panel__runs small tone-failed">
        {state === 'ready'
          ? 'stage6_replay.json lists no activity files, so there is no run to select.'
          : state === 'missing'
            ? 'stage6_replay.json is absent, so the runs that exist cannot be read.'
            : 'stage6_replay.json could not be read, so the runs that exist cannot be listed.'}
      </div>
    );
  }
  return (
    <div className="map-panel__runs">
      <label className="map-panel__runs-row">
        <span className="label">condition</span>
        <div className="segmented" role="tablist" aria-label="condition">
          {conditions.map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={selection?.condition === c}
              className="segmented__option"
              data-text={c}
              onClick={() => setCondition(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </label>
      <label className="map-panel__runs-row">
        <span className="label">seed</span>
        <select
          className="control"
          value={selection?.seed ?? ''}
          onChange={(e) => setSeed(Number(e.target.value))}
          disabled={seeds.length === 0}
          aria-label="seed"
        >
          {seeds.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** The time readout, the only part of the panel that re-renders while the map plays. */
function ClockReadout({ clock, durationMs }: { clock: Clock; durationMs: number }) {
  const timeMs = useClockTime(clock);
  return (
    <span className="smaller muted mono tabular-nums">
      {fmtNum(timeMs / 1000, 2)} / {fmtNum(durationMs / 1000, 2)} s
    </span>
  );
}

/**
 * What is on screen, said plainly: the run, the file it came out of, and the counts that file
 * states. When the file is missing this is the "not yet run" state, and it names the file and the
 * script that writes it.
 */
const SourceLine = memo(function SourceLine({
  condition,
  seed,
  path,
  listed,
  load,
  requested,
  identity,
  s6State,
  nRuns,
  activeCounted,
  canPlay,
  playing,
  reduceMotion,
}: {
  condition: string | null;
  seed: number | null;
  path: string | null;
  /** false when the selection names a run stage6_replay.json does not list */
  listed: boolean;
  load: ReturnType<typeof useActivity>;
  /** false while the fetch is still held behind the viewport and idle gates */
  requested: boolean;
  /** whether the loaded spike file's sidecar names the atlas that is loaded; null before it is */
  identity: IdentityCheck | null;
  s6State: 'loading' | 'missing' | 'error' | 'ready';
  nRuns: number;
  activeCounted: number | null;
  /** false when no file is loaded: there is then nothing to say about playback */
  canPlay: boolean;
  playing: boolean;
  reduceMotion: boolean;
}) {
  /**
   * stage6_replay.json is fetched when the browser is idle, so for the first moments of every page
   * there is no selection and no path yet. Printing "no replay activity has been exported" there
   * asserts a not-run state about a file nobody has read: the same claim the whole panel exists to
   * make only when it is true. While the stage file is in flight, the panel says exactly that.
   */
  if (!path && s6State === 'loading') {
    return (
      <div className="map-panel__source">
        <p className="smaller muted">reading stage6_replay.json to find the runs that exist …</p>
      </div>
    );
  }

  if (!path || condition === null || seed === null) {
    return (
      <div className="map-panel__source">
        <div className="label tone-failed">no replay activity has been exported</div>
        <p className="smaller">
          The map shows the atlas only: the populations are real, and nothing is lit because no spikes exist to light them. Expected files{' '}
          <span className="mono">web/public/data/replay/activity_&lt;condition&gt;_seed&lt;k&gt;.json</span> and their{' '}
          <span className="mono">.bin</span>, listed in <span className="mono">stage6_replay.json</span>'s{' '}
          <span className="mono">activity[]</span>
          {s6State === 'missing' ? ', which is itself absent' : s6State === 'error' ? ', which could not be read' : nRuns === 0 ? ', which lists none' : ''}.
          Run <span className="mono">python {REPLAY_SCRIPT}</span>, then <span className="mono">python scripts/export_web.py</span>.
        </p>
      </div>
    );
  }

  return (
    <div className="map-panel__source">
      <div className="label label--ink">
        replay activity · {condition}, seed {seed}
      </div>
      {!listed && (
        <p className="smaller tone-failed">
          <span className="mono">stage6_replay.json</span> does not list this condition and seed in its <span className="mono">activity[]</span>;
          the path below is the contract's naming convention applied to the selection, not a file the stage file names.
        </p>
      )}
      {load === null || load.state === 'loading' ? (
        <p className="smaller muted">
          {requested ? 'loading the activity binary for this run …' : 'the atlas is drawn; the activity binary for this run is requested next.'}
        </p>
      ) : load.state === 'ready' ? (
        <>
          {identity?.state === 'mismatch' ? (
            <p className="smaller tone-failed">
              Nothing is lit: this file was exported against a different atlas, so its <span className="mono">atlas_row</span> values would land on
              the wrong neurons. {identity.message}. Re-run <span className="mono">python {REPLAY_SCRIPT}</span> and then{' '}
              <span className="mono">python scripts/export_web.py</span> so the spikes and the atlas are exported together.
            </p>
          ) : (
            <p className="smaller">
              The spikes on the map are the whole-brain activity of this run, over the same window as its raster and its correlation trace, as
              stage 6 exported it. It is the experiment's own output; nothing else is ever animated here.
            </p>
          )}
          {identity?.state === 'unverified' && (
            <p className="smaller tone-failed">
              The pairing of this file with the loaded atlas could not be checked: {identity.message}. What is drawn is drawn on that
              unverified basis.
            </p>
          )}
          {/* on a mismatch nothing is lit, so there is no neuron count to print: the facts that
              remain are facts about the file itself, which are true whatever atlas it belongs to */}
          <SpikeFacts sc={load.data.sidecar} counted={identity?.state === 'mismatch' ? null : activeCounted} />
        </>
      ) : (
        <p className="smaller tone-failed">
          Nothing is lit: <span className="mono">web/public/data/{load.path || path}</span>{' '}
          {load.missing ? 'has not been exported (HTTP 404)' : `could not be used: ${load.message}`}. Nothing is played in its place. Run{' '}
          <span className="mono">python {REPLAY_SCRIPT}</span>, then <span className="mono">python scripts/export_web.py</span>.
        </p>
      )}
      <div className="map-panel__path mono">web/public/data/{path}</div>
      {canPlay && <LoopNote playing={playing} reduceMotion={reduceMotion} />}
    </div>
  );
});

/**
 * Counts read out of the activity sidecar itself, and one counted out of the binary.
 *
 * The active-neuron figure the panel prints is counted from the file that is on screen (distinct
 * `atlas_row` values), the way the legend counts the populations from the atlas binary rather than
 * trusting the sidecar.
 */
function SpikeFacts({ sc, counted }: { sc: ActivityData['sidecar']; counted: number | null }) {
  return (
    <dl className="map-panel__facts">
      <dt>spikes</dt>
      <dd>
        {fmtInt(sc.n_spikes_total)} total
        {sc.n_spikes_exported !== sc.n_spikes_total && <> · {fmtInt(sc.n_spikes_exported)} exported</>}
      </dd>
      <dt>downsampled</dt>
      <dd className={sc.downsampled ? 'tone-failed' : undefined}>
        {sc.downsampled
          ? `yes: the map shows a sample of the spikes, not all of them${sc.downsample_note ? ` (${sc.downsample_note})` : ''}`
          : 'no'}
      </dd>
      {counted !== null && (
        <>
          <dt>neurons lit</dt>
          <dd>
            {fmtInt(counted)} <span className="muted">atlas rows, counted in this file</span>
          </dd>
        </>
      )}
      <dt>duration</dt>
      <dd>{fmtNum(sc.duration_s, 2)} s, looped</dd>
    </dl>
  );
}

function LoopNote({ playing, reduceMotion }: { playing: boolean; reduceMotion: boolean }) {
  if (playing) return <p className="smaller muted">Playing at 1× real time; it restarts from 0 when it reaches the end.</p>;
  return <p className="smaller muted">Paused{reduceMotion ? ' (this browser asks for reduced motion)' : ''}. Press play to run it.</p>;
}
