import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import BrainMap, {
  AtlasCaption,
  PROJECTIONS,
  PROJECTION_SHORT,
  VncToggle,
  atlasProvenance,
  useActivity,
  useAtlas,
  type MapSourceLabel,
  type Projection,
} from './BrainMap';
import NotRunPanel from './NotRunPanel';
import ProvenanceFooter from './ProvenanceFooter';
import { useDataFile } from '../lib/data';
import { useMediaQuery, useViewportHeight } from '../lib/media';
import { useReplayActivity, type ReplayActivitySelection } from '../lib/mapSource';
import { fmtInt, fmtNum } from '../lib/format';
import type { ActivityData, AtlasData } from '../lib/binary';
import type { Manifest, Provenance, ReferenceClip, ReferenceClipEpoch, ReferenceClipsFile } from '../types';

/**
 * The persistent neuron map in the right-hand rail (and, where there is no rail, in the page's own
 * map slot). It is on every page, and it is never blank while `neuron_atlas.json` is readable: the
 * atlas alone draws the populations.
 *
 * What it plays, in the order the data contract fixes:
 *   1. the activity of the seed/condition selected on the Replay page, whenever that page has named
 *      one (published through MapSourceContext). If that file is missing, unreadable or paired with
 *      a different atlas, the panel says so and lights nothing. A named-but-broken file is a finding
 *      the reader must see, not an absence a reference clip may fill;
 *   2. otherwise one of the reference clips listed in `reference_clips.json` - real simulations of
 *      this model written by `scripts/07_reference_clips.py`, looped, and named on the canvas itself
 *      as a reference simulation rather than the replay result;
 *   3. otherwise nothing animates, and the panel says so and names the script that would fix it.
 *
 * There is no demo mode: every spike drawn here was read out of a binary the pipeline wrote.
 */

/** A spike stays lit for this long on the panel map, fading out (MAP_SPEC.md:38: a 150 ms tail). */
const DECAY_MS = 150;
/** Fixed simulation step for the loop, so the playback rate does not depend on the frame rate. */
const STEP_MS = 1000 / 60;

// ---------------------------------------------------------------- the loop clock

/**
 * The playback clock, as a subscription rather than as state.
 *
 * This panel is mounted by the Layout on every page, so its loop runs site-wide and permanently.
 * Holding the time in `useState` here would reconcile the whole subtree - the projection control,
 * the play button, the clip picker, the source text, the provenance footer - sixty times a second
 * for a value none of them reads. Instead the tick writes into a store, and only the two leaves that
 * actually render a time subscribe to it. (The Replay page already does the equivalent by scoping
 * its timeline to ReplayWindow.)
 */
interface Clock {
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
      store.subs.forEach((cb) => cb());
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

// ---------------------------------------------------------------- the panel

export default function MapPanel() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(380);
  // Coalesced to one update per frame, like the map's own observer and the raster's: dragging a
  // window edge otherwise re-renders the whole panel once per observed pixel, and each of those
  // renders rebuilds the props of the canvas below.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let raf = 0;
    let pending = 0;
    const ro = new ResizeObserver((e) => {
      pending = Math.max(240, Math.floor(e[0].contentRect.width));
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setWidth((w) => (w === pending ? w : pending));
      });
    });
    ro.observe(el);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);
  const narrow = useMediaQuery('(max-width: 699px)');
  const railed = useMediaQuery('(min-width: 1100px)');
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const viewportH = useViewportHeight();

  const m = useDataFile<Manifest>('manifest.json');
  const manifest = m.state === 'ready' ? m.data : null;
  const atlas = useAtlas();
  const atlasData: AtlasData | null = atlas.state === 'ready' ? atlas.data : null;
  const clipsFile = useDataFile<ReferenceClipsFile>('reference_clips.json');
  const replay = useReplayActivity();

  const clips: ReferenceClip[] = clipsFile.state === 'ready' && Array.isArray(clipsFile.data.clips) ? clipsFile.data.clips : [];

  /**
   * Source choice. A clip may stand in only when the Replay page has named no activity file at all.
   * `replay` is published whenever a file *is* named, in whatever state it loaded, so a named file
   * that is missing or stale suppresses the clips exactly as a loaded one does - the panel reports
   * the failure instead of animating something else beside the page's "nothing is lit".
   */
  const [clipName, setClipName] = useState<string | null>(null);
  const clip: ReferenceClip | null = replay ? null : (clips.find((c) => c.name === clipName) ?? clips[0] ?? null);
  const clipLoad = useActivity(clip ? clip.file : null);

  const replayData = replay && replay.load.state === 'ready' ? replay.load.data : null;
  const clipData = clipLoad?.state === 'ready' ? clipLoad.data : null;
  const activity: ActivityData | null = replay ? replayData : clipData;
  const sourceKey = replay ? `replay:${replay.path}` : clip ? `clip:${clip.name}` : 'none';

  // The loop length: the sidecar's own duration, never shorter than the last spike it holds.
  const durationMs = activity ? Math.max(Math.round((activity.sidecar.duration_s ?? 0) * 1000), activity.maxTMs + 1) : 0;
  const canPlay = durationMs > 0;

  const [playing, setPlaying] = useState(!reduceMotion);
  useEffect(() => {
    if (reduceMotion) setPlaying(false);
  }, [reduceMotion]);

  const clock = useMapClock(durationMs, playing && canPlay, sourceKey);

  const [projection, setProjection] = useState<Projection>('frontal');
  // Framed on view_boxes.brain by default; the switch below opens it out to view_boxes.all.
  const [showVnc, setShowVnc] = useState(false);

  /**
   * The canvas takes the projection's own aspect; this is only the ceiling it may not pass. It is
   * budgeted against the viewport rather than fixed, because in the rail the whole panel has to fit
   * inside `calc(100dvh - 2rem)`: a constant tall enough for a large screen gives a small one a
   * nested scrollbar, which then eats the wheel over the map and hides the provenance below it.
   */
  const mapHeight = narrow
    ? Math.round(Math.min(width * 1.5, 460))
    : railed
      ? Math.round(Math.max(260, Math.min(620, viewportH * 0.42)))
      : Math.round(Math.max(280, Math.min(520, viewportH * 0.5)));

  /** Neurons that actually spike in the loaded file, counted from the binary rather than trusted. */
  const activeCounted = useMemo(() => (activity ? countDistinctRows(activity.atlasRow) : null), [activity]);

  // Memoised so a re-render that changes nothing about the source (a resize, the clock's own
  // subscribers) hands MapCanvas the same object and its memo() actually holds.
  const source: MapSourceLabel = useMemo(
    () =>
      replay
        ? {
            text: `replay result · ${replay.condition}, seed ${replay.seed}${replayData ? '' : ' · not loaded, nothing is lit'}`,
          }
        : clip
          ? { text: `REFERENCE SIMULATION · ${clip.title} · not the replay result`, reference: true }
          : { text: 'atlas only · no spikes loaded' },
    [replay, replayData, clip],
  );

  const prov = useMemo(
    () => panelProvenance({ clip, clipData, replay, atlas: atlasData, manifest }),
    [clip, clipData, replay, atlasData, manifest],
  );

  if (atlas.state === 'loading') {
    return (
      <div ref={wrapRef} className="map-panel">
        <PanelHead source={source} />
        <div className="small muted py-6">loading neuron_atlas.json …</div>
      </div>
    );
  }

  if (atlas.state === 'failed') {
    return (
      <div ref={wrapRef} className="map-panel">
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
    <div ref={wrapRef} className="map-panel">
      <PanelHead source={source} />

      <MapCanvas
        clock={clock}
        atlas={atlas.data}
        activity={activity}
        source={source}
        durationMs={durationMs}
        mapHeight={mapHeight}
        projection={projection}
        setProjection={setProjection}
        showVnc={showVnc}
        setShowVnc={setShowVnc}
      />

      {/* The identity of what is on screen sits immediately under the picture (and on it), not at
          the far end of the panel below the legend, the status line and the controls. */}
      <SourceLine
        replay={replay}
        clip={clip}
        clipActivity={clipData}
        clipFailed={clipLoad?.state === 'failed' ? clipLoad : null}
        clipsState={clipsFile.state}
        clipsCount={clips.length}
        note={clipsFile.state === 'ready' ? clipsFile.data.note : undefined}
        activeCounted={activeCounted}
        canPlay={canPlay}
        playing={playing}
        reduceMotion={reduceMotion}
      />

      <div className="map-panel__controls">
        <div className="segmented" role="tablist" aria-label="projection">
          {PROJECTIONS.map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={projection === p}
              className="segmented__option"
              data-text={PROJECTION_SHORT[p]}
              onClick={() => setProjection(p)}
            >
              {PROJECTION_SHORT[p]}
            </button>
          ))}
        </div>
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
        {canPlay && <ClockReadout clock={clock} durationMs={durationMs} epochs={clip?.epochs} />}
        {atlas.data.sidecar.view_boxes?.brain && <VncToggle atlas={atlas.data} on={showVnc} set={setShowVnc} compact />}
      </div>

      {/* MAP_SPEC.md:46-47 attaches this caption to the map, and this is the map that is on every
          page: soma positions and not morphology, and the receptor neurons that are simulated but
          have no soma in the volume. It is folded because the rail has a height budget, never
          omitted, and every number in it is the sidecar's own. */}
      <details className="map-panel__more map-panel__caption">
        <summary className="smaller">what these dots are</summary>
        <p className="smaller">
          <AtlasCaption atlas={atlas.data} activity={activity} />
        </p>
      </details>

      {!replay && clips.length > 1 && (
        <label className="map-panel__select small muted">
          reference simulation
          <select className="control" value={clip?.name ?? ''} onChange={(e) => setClipName(e.target.value)}>
            {clips.map((c) => (
              <option key={c.name} value={c.name}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
      )}

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

/** The directory part of a sidecar path, so its `bin` resolves the way the loader resolves it. */
function dirOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(0, i + 1) : '';
}

/**
 * The footer's provenance, and what has to be said about it.
 *
 * A reference clip's block states a config, a results directory and the run's own outputs, but no
 * commit and no time. Those are not filled in from the manifest: the manifest's commit is when the
 * *web export* ran, and printing it here - with every file in the list hyperlinked to it - would
 * claim the run was made at a commit `reference_clips.json` never mentions. The footer says the
 * commit is not stated, and names the site's build commit as the separate fact that it is.
 */
function panelProvenance({
  clip,
  clipData,
  replay,
  atlas,
  manifest,
}: {
  clip: ReferenceClip | null;
  clipData: ActivityData | null;
  replay: ReplayActivitySelection | null;
  atlas: AtlasData | null;
  manifest: Manifest | null;
}): { provenance: Provenance; commitNote?: ReactNode; note?: ReactNode } {
  if (clip) {
    const p = clip.provenance;
    // the binary is what drives every frame, so it belongs in the list beside its sidecar
    const bin = clipData?.sidecar.bin ? `${dirOf(clip.file)}${clipData.sidecar.bin}` : clip.file.replace(/\.json$/, '.bin');
    return {
      provenance: {
        config: p?.config ?? 'null',
        config_hash: p?.config_hash,
        results_dir: p?.results_dir,
        files: [
          ...(p?.files ?? []),
          `web/public/data/${clip.file}`,
          `web/public/data/${bin}`,
          'web/public/data/reference_clips.json',
          'web/public/data/neuron_atlas.json',
          'web/public/data/neuron_atlas.bin',
        ],
        git_commit: p?.git_commit ?? '',
        generated_at: p?.generated_at,
      },
      commitNote: p?.git_commit ? undefined : (
        <>
          commit not stated by reference_clips.json
          {manifest?.git_commit ? <> (this site was built at {manifest.git_commit})</> : null}
        </>
      ),
    };
  }
  return atlasProvenance(atlas, manifest, replay ? [`web/public/data/${replay.path}`] : []);
}

/**
 * The panel's head. It names the instrument and, on the same rule, what the instrument is currently
 * showing - so the identity is above the picture as well as on it.
 */
function PanelHead({ source }: { source: MapSourceLabel }) {
  return (
    <div className="map-panel__head">
      <div className="map-panel__head-row">
        <span className="label label--ink">neuron map</span>
        <span className="smaller muted">soma positions</span>
      </div>
      <div className={`smaller map-panel__head-source${source.reference ? ' tone-failed' : ' muted'}`}>{source.text}</div>
    </div>
  );
}

/**
 * The canvas, and nothing else. It subscribes to the clock, so it is the only part of the panel that
 * re-renders on a frame.
 */
const MapCanvas = memo(function MapCanvas({
  clock,
  atlas,
  activity,
  source,
  durationMs,
  mapHeight,
  projection,
  setProjection,
  showVnc,
  setShowVnc,
}: {
  clock: Clock;
  atlas: AtlasData;
  activity: ActivityData | null;
  source: MapSourceLabel;
  durationMs: number;
  mapHeight: number;
  projection: Projection;
  setProjection: (p: Projection) => void;
  showVnc: boolean;
  setShowVnc: (v: boolean) => void;
}) {
  const timeMs = useClockTime(clock);
  return (
    <BrainMap
      atlas={atlas}
      activity={activity}
      source={source}
      timeMs={activity && durationMs > 0 ? timeMs : null}
      decayMs={DECAY_MS}
      // the panel loops, so the decay window wraps at the seam instead of being cut off at 0
      loopMs={durationMs > 0 ? durationMs : undefined}
      height={mapHeight}
      projection={projection}
      onProjectionChange={setProjection}
      showVnc={showVnc}
      onShowVncChange={setShowVnc}
      variant="panel"
      background="page"
      showProjectionControl={false}
      showVncControl={false}
      showLegend
      showStatus
    />
  );
});

/**
 * The time readout and, for a clip that has them, the stimulation epochs.
 *
 * The second half matters as much as the first: `sugar_pulses` is a *driven* clip, so the cascade a
 * reader watches sweep across the brain is stimulus-locked. Next to a page asking whether an
 * ensemble reactivates spontaneously, a driven frame must never be readable as a spontaneous one.
 * The schedule is otherwise buried in the clip's prose description.
 */
function ClockReadout({ clock, durationMs, epochs }: { clock: Clock; durationMs: number; epochs?: ReferenceClipEpoch[] }) {
  const timeMs = useClockTime(clock);
  const usable = (epochs ?? []).filter((e) => Number.isFinite(e.t_start_s) && Number.isFinite(e.t_end_s) && e.t_end_s > e.t_start_s);
  const span = Math.max(durationMs, ...usable.map((e) => e.t_end_s * 1000));
  const tS = timeMs / 1000;
  const current = usable.find((e) => tS >= e.t_start_s && tS < e.t_end_s) ?? null;
  const drives = Object.entries(current?.drives ?? {});
  return (
    <div className="map-panel__clock">
      <span className="smaller muted mono">
        {fmtNum(timeMs / 1000, 2)} / {fmtNum(durationMs / 1000, 2)} s
      </span>
      {usable.length > 0 && (
        <>
          <div className="epoch-strip" aria-hidden="true">
            {usable.map((e, i) => {
              const on = Object.keys(e.drives ?? {}).length > 0;
              return (
                <span
                  key={`${e.name}-${i}`}
                  className={`epoch-strip__seg${on ? ' epoch-strip__seg--on' : ''}${e === current ? ' epoch-strip__seg--now' : ''}`}
                  style={{
                    left: `${(100 * e.t_start_s * 1000) / span}%`,
                    width: `${(100 * (e.t_end_s - e.t_start_s) * 1000) / span}%`,
                  }}
                />
              );
            })}
            <span className="epoch-strip__head" style={{ left: `${(100 * timeMs) / span}%` }} />
          </div>
          <span className={`smaller mono ${drives.length > 0 ? 'tone-failed' : 'muted'}`}>
            {current ? `${current.name}: ` : 'between epochs: '}
            {/* the numbers are the file's own; reference_clips.json states no unit for them, so none is asserted */}
            {drives.length > 0 ? `driven — ${drives.map(([k, v]) => `${k} ${fmtNum(v)}`).join(', ')}` : 'no drive'}
          </span>
        </>
      )}
    </div>
  );
}

/**
 * What is on screen, said plainly. A reference clip is always announced as a reference simulation
 * and never as the replay result, and it carries its own config and results directory.
 */
function SourceLine({
  replay,
  clip,
  clipActivity,
  clipFailed,
  clipsState,
  clipsCount,
  note,
  activeCounted,
  canPlay,
  playing,
  reduceMotion,
}: {
  replay: ReplayActivitySelection | null;
  clip: ReferenceClip | null;
  clipActivity: ActivityData | null;
  clipFailed: { missing: boolean; path: string; message: string } | null;
  clipsState: 'loading' | 'missing' | 'error' | 'ready';
  clipsCount: number;
  note?: string;
  activeCounted: number | null;
  /** false when no file is loaded: there is then nothing to say about playback */
  canPlay: boolean;
  playing: boolean;
  reduceMotion: boolean;
}) {
  if (replay) {
    const load = replay.load;
    return (
      <div className="map-panel__source">
        <div className="label label--ink">
          replay activity · {replay.condition}, seed {replay.seed}
        </div>
        {load.state === 'ready' ? (
          <>
            <p className="smaller">
              The spikes on the map are the replay window of the selected seed and condition, as stage 6 exported it. This is the replay
              result itself, not a reference simulation.
            </p>
            <SpikeFacts sc={load.data.sidecar} counted={activeCounted} stated={null} />
          </>
        ) : load.state === 'loading' ? (
          <p className="smaller muted">loading the activity binary for this seed …</p>
        ) : (
          <p className="smaller tone-failed">
            Nothing is lit: <span className="mono">web/public/data/{load.path || replay.path}</span>{' '}
            {load.missing ? 'has not been exported (HTTP 404)' : `could not be used — ${load.message}`}. No reference clip is played in its
            place: this seed and condition name a file, and a file that is named but unusable is the finding, not an absence of one.
          </p>
        )}
        <div className="smaller mono muted">web/public/data/{replay.path}</div>
        {canPlay && <LoopNote playing={playing} reduceMotion={reduceMotion} />}
      </div>
    );
  }

  if (clipsState === 'loading') return <div className="map-panel__source small muted">loading reference_clips.json …</div>;

  if (clipsState !== 'ready' || clipsCount === 0 || !clip) {
    return (
      <div className="map-panel__source">
        <div className="label tone-failed">no activity has been simulated yet</div>
        <p className="smaller">
          The map shows the atlas only: the populations are real, and nothing is lit because no spikes exist to light them. The replay
          stage has exported no <span className="mono">replay/activity_&lt;cond&gt;_seed&lt;k&gt;.json</span>, and{' '}
          <span className="mono">reference_clips.json</span>{' '}
          {clipsState === 'missing' ? 'is absent' : clipsState === 'error' ? 'could not be read' : 'lists no clips'}. Run{' '}
          <span className="mono">python scripts/07_reference_clips.py</span> (then{' '}
          <span className="mono">python scripts/export_web.py</span>) to give the map something true to play.
        </p>
      </div>
    );
  }

  const sc = clipActivity?.sidecar ?? null;
  return (
    <div className="map-panel__source">
      {/* The clip's title is on the head rule and stamped into the canvas; this is the claim that
          goes with it, kept in the body where the numbers are. */}
      <div className="label tone-failed">reference simulation · not the replay result</div>
      {clipFailed && (
        <p className="smaller tone-failed">
          Nothing is lit: <span className="mono">web/public/data/{clipFailed.path}</span>{' '}
          {clipFailed.missing ? 'is absent (HTTP 404)' : `could not be read - ${clipFailed.message}`}.
        </p>
      )}
      {sc && <SpikeFacts sc={sc} counted={activeCounted} stated={clip.n_active_neurons} />}
      {canPlay && <LoopNote playing={playing} reduceMotion={reduceMotion} />}
      {/* The prose is folded away so the resting panel fits the rail's height: what a reader must
          not miss - that this is a reference simulation and not the result - is above, on the
          canvas and in the head. The config and every file are in the provenance line below, which
          is never folded. */}
      <details className="map-panel__more">
        <summary className="smaller">what this simulation is</summary>
        <p className="smaller">{clip.description}</p>
        {note && <p className="smaller muted">{note}</p>}
      </details>
    </div>
  );
}

/**
 * Counts read out of the activity sidecar itself, and one counted out of the binary.
 *
 * The active-neuron figure the panel prints is counted from the file that is on screen - distinct
 * `atlas_row` values - the way the legend counts the populations from the atlas binary rather than
 * trusting the sidecar. `reference_clips.json`'s own figure is printed beside it, labelled as the
 * different quantity it is: a neuron that spiked but has no soma position has no row in the atlas
 * and no dot to light, so the manifest's count is legitimately the larger of the two. Only the
 * impossible direction - more rows lit than the run says fired - is flagged as a disagreement.
 */
function SpikeFacts({ sc, counted, stated }: { sc: ActivityData['sidecar']; counted: number | null; stated: number | null }) {
  return (
    <dl className="map-panel__facts">
      <dt>spikes</dt>
      <dd>
        {fmtInt(sc.n_spikes_total)} total
        {sc.n_spikes_exported !== sc.n_spikes_total && <> · {fmtInt(sc.n_spikes_exported)} exported</>}
      </dd>
      <dt>downsampled</dt>
      <dd className={sc.downsampled ? 'tone-failed' : undefined}>
        {sc.downsampled ? `yes - the map shows a sample of the spikes, not all of them${sc.downsample_note ? ` (${sc.downsample_note})` : ''}` : 'no'}
      </dd>
      {counted !== null && (
        <>
          <dt>neurons lit</dt>
          <dd>
            {fmtInt(counted)} <span className="muted">atlas rows, counted in this file</span>
            {stated !== null && (
              <span className={counted > stated ? 'tone-failed' : 'muted'}>
                {' '}
                · reference_clips.json states {fmtInt(stated)} active in the run
                {counted > stated
                  ? ' — more rows are lit than the run says fired, so one of the two files is stale'
                  : counted < stated
                    ? ' (a neuron with no soma position has no row here to light)'
                    : ''}
              </span>
            )}
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
  return (
    <p className="smaller muted">
      Paused{reduceMotion ? ' (this browser asks for reduced motion)' : ''}. Press play to run it.
    </p>
  );
}
