import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useDataFile } from '../lib/data';
import { checkAtlasIdentity, loadRaster, loadTrace, rasterMaxTimeMs, type ActivityData, type RasterData, type TraceData, type BinLoad } from '../lib/binary';
import type { Comparison, Manifest, Stage5, Stage6, Stage6PerSeed } from '../types';
import StageGate from '../components/StageGate';
import { MapSlot } from '../components/Layout';
import StatusBanner from '../components/StatusBanner';
import Figure from '../components/Figure';
import DataTable from '../components/DataTable';
import ErrorBoundary from '../components/ErrorBoundary';
import ProvenanceFooter from '../components/ProvenanceFooter';
import ForestPlot, { preregistered } from '../components/charts/ForestPlot';
import RasterViewer from '../components/charts/RasterViewer';
import NotRunPanel from '../components/NotRunPanel';
import BrainMap, { AtlasCaption, atlasProvenance, useActivity, useAtlas, type Loadable, type TimeSource } from '../components/BrainMap';
import type { AtlasData } from '../lib/binary';
import { fmtNum, fmtInt, fmtP, fmtCI, fmtPct, isNum, NOT_MEASURED } from '../lib/format';
import { activityPath, activityRefs, useMapSelection } from '../lib/mapSource';

/** How long a spike stays lit on the map after it fires. */
const DECAY_MS = 150;

interface Timeline {
  /** the window start, as a subscription: only the leaves that render a time re-render on a frame */
  clock: Clock;
  setStart: (v: number) => void;
  windowS: number;
  setWindowS: (v: number) => void;
  playing: boolean;
  setPlaying: (v: boolean) => void;
  maxStart: number;
  durationS: number;
  /** false when no loaded file reports a duration; the controls then say so instead of showing one */
  durationKnown: boolean;
}

/**
 * The window start, held in a mutable store rather than in state.
 *
 * The play loop advances it on every animation frame. As `useState` on this component it
 * reconciled the whole scrubbed subtree sixty times a second, including the map figure's title,
 * its atlas caption (a fifty-node prose block quoting every sidecar count) and its provenance
 * footer, none of which reads the clock. Only the scrubber's readout subscribes; the map reads the
 * store directly inside its own draw loop.
 */
interface Clock {
  subscribe: (cb: () => void) => () => void;
  get: () => number;
}

function useClockValue(clock: Clock): number {
  return useSyncExternalStore(clock.subscribe, clock.get, clock.get);
}

/**
 * The single clock of the Replay page. It was previously private to the raster; it is lifted here
 * so the raster, the correlation trace and the brain map are scrubbed and played together.
 */
function useTimeline(duration: number | null): Timeline {
  const durationKnown = duration !== null && Number.isFinite(duration) && duration > 0;
  const durationS = durationKnown ? (duration as number) : 0;
  const [windowS, setWindowS] = useState(2);
  const [playing, setPlaying] = useState(false);
  const maxStart = Math.max(0, durationS - windowS);

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
  const setStart = useCallback(
    (v: number) => {
      if (store.t === v) return;
      store.t = v;
      store.subs.forEach((cb) => cb());
    },
    [store],
  );

  // A shorter file, or a longer window, cannot leave the playhead past the end of the data.
  useEffect(() => {
    const cap = Math.max(0, durationS - windowS);
    if (store.t > cap) setStart(cap);
  }, [durationS, windowS, store, setStart]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    // the readout shows hundredths of a second; notifying subscribers faster than that renders
    // the same string again
    let lastNotify = 0;
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const next = store.t + dt; // 1x real time
      if (next >= maxStart) {
        setStart(maxStart);
        setPlaying(false);
        return;
      }
      store.t = next;
      if (now - lastNotify > 50) {
        lastNotify = now;
        store.subs.forEach((cb) => cb());
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, maxStart, store, setStart]);

  return { clock, setStart, windowS, setWindowS, playing, setPlaying, maxStart, durationS, durationKnown };
}

/** Play / pause, scrubber and window length: one set of controls for every panel below it. */
function TimelineControls({ timeline, disabled }: { timeline: Timeline; disabled: boolean }) {
  const { clock, setStart, windowS, setWindowS, playing, setPlaying, maxStart, durationS, durationKnown } = timeline;
  const start = useClockValue(clock);
  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-3 small">
        <button
          className="control"
          onClick={() => {
            if (!playing && start >= maxStart) setStart(0);
            setPlaying(!playing);
          }}
          disabled={disabled}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          min={0}
          max={maxStart}
          step={0.01}
          value={Math.min(start, maxStart)}
          onChange={(e) => {
            setPlaying(false);
            setStart(Number(e.target.value));
          }}
          className="timeline-scrub"
          aria-label="window start (s)"
          disabled={disabled}
        />
        <span className="tabular-nums muted">
          {durationKnown ? (
            <>
              {fmtNum(start, 2)} to {fmtNum(start + windowS, 2)} s of {fmtNum(durationS, 2)} s
            </>
          ) : (
            /* no raster, trace or activity file reports a duration: none is shown rather than a made-up one */
            <span className="tone-failed">duration unknown: no loaded file reports one</span>
          )}
        </span>
        <label className="flex items-center gap-2 muted">
          window
          <select className="control" value={windowS} onChange={(e) => setWindowS(Number(e.target.value))}>
            {[0.5, 1, 2, 5, 10].map((w) => (
              <option key={w} value={w}>
                {w} s
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-2 smaller muted">
        One scrubber drives the map, the raster and the correlation trace. The map lights the neurons that spiked in the last {DECAY_MS} ms of
        the window, fading them out over that time; the raster and the trace show the whole window.
      </div>
    </div>
  );
}

/**
 * The map figure: the atlas when it exists, and the explicit missing-file panel for whichever of
 * the two files is absent. It never draws a map from anything but the files it names.
 */
const ACTIVITY_PATTERN = 'replay/activity_<condition>_seed<k>.json';

function BrainMapBlockInner({
  activity,
  activityPath: path,
  sourceText,
  time,
  decayMs,
  height,
}: {
  activity: Loadable<ActivityData> | null;
  /** what this map is drawing; the canvas's aria-label and the figure's own identity line */
  sourceText: string;
  /**
   * The concrete activity sidecar this map would animate from, named in the panel when it is absent.
   * `null` means no concrete file is identified yet (stage 6 has listed no seed), and the panel then
   * shows the naming convention labelled as one rather than a path with a placeholder in it.
   */
  activityPath: string | null;
  /** the page's clock, mapped to the leading edge of the window; null when nothing is scrubbed */
  time: TimeSource | null;
  decayMs: number;
  height?: number;
}) {
  const m = useDataFile<Manifest>('manifest.json');
  const atlas = useAtlas();
  const manifest = m.state === 'ready' ? m.data : null;
  const act: ActivityData | null = activity !== null && activity.state === 'ready' ? activity.data : null;

  if (atlas.state === 'loading') return <div className="small muted py-6">loading neuron_atlas.json …</div>;
  if (atlas.state === 'failed') {
    return (
      <div>
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

  const atlasData: AtlasData = atlas.data;
  const prov = atlasProvenance(atlasData, manifest, act ? [`web/public/data/${path}`, `web/public/data/replay/${act.sidecar.bin}`] : []);
  return (
    <Figure
      title="Brain map · soma positions in 3D, lit by spikes"
      provenance={prov.provenance}
      provenanceCommitNote={prov.commitNote}
      provenanceNote={prov.note}
      caption={<AtlasCaption atlas={atlasData} activity={act} />}
      /* The map is drawn on the page background, not on the white figure mat: MAP_SPEC.md asks for
         the page token so the panel reads as part of the page, and the mat would also force the
         light colour column on the points in both themes. */
      flat
    >
      {activity === null && (
        <div className="mb-3">
          <NotRunPanel
            file={path ?? undefined}
            filePattern={path === null ? ACTIVITY_PATTERN : undefined}
            patternSource={
              <>
                the <span className="mono">activity[]</span> entries of <span className="mono">stage6_replay.json</span>, which list the
                conditions and seeds that exist
              </>
            }
            script="scripts/06_replay.py"
            reason={path === null ? 'unnamed' : 'not_run'}
            title="Brain-map activity"
            note={<span>No activity sidecar is loaded, so nothing on the map is lit. The populations below are the atlas itself and are real.</span>}
          />
        </div>
      )}
      {activity !== null && activity.state === 'loading' && <div className="small muted mb-2">loading activity binary …</div>}
      {activity !== null && activity.state === 'failed' && (
        <div className="mb-3">
          <NotRunPanel
            file={activity.missing ? (path ?? undefined) : activity.path}
            script="scripts/06_replay.py"
            reason={activity.missing ? 'missing' : 'error'}
            title="Brain-map activity for this condition and seed"
            note={
              <span>
                The populations below are the real atlas; nothing is lit, because the spikes that would light them{' '}
                {activity.missing ? 'have not been exported' : 'were not usable'}.{' '}
                {!activity.missing && <span className="tone-failed mono">{activity.message}</span>}
              </span>
            }
          />
        </div>
      )}
      {/* The source statement MAP_SPEC.md requires, as selectable HTML beside the picture rather
          than burned into the bitmap. */}
      <div className="map-figure__source smaller muted">{sourceText}</div>
      {/* no loopMs: this timeline runs once and stops, so 0 really is the start of the file */}
      <BrainMap atlas={atlasData} activity={act} source={{ text: sourceText }} time={act ? time : null} decayMs={decayMs} height={height} />
    </Figure>
  );
}

/** The raster and its trace, subscribed to the same clock as the map beside them. */
function RasterWindow({ clock, raster, trace, windowS }: { clock: Clock; raster: RasterData | null; trace: TraceData | null; windowS: number }) {
  const start = useClockValue(clock);
  return <RasterViewer raster={raster} trace={trace} startS={start} windowS={windowS} />;
}

/** Memoised so the play loop's clock, which lives below, cannot re-render the whole figure. */
const BrainMapBlock = memo(BrainMapBlockInner);

/** What the stage's status enum means for the memory claim; the raw string is shown for any value outside the contract. */
function statusSentence(status: Stage6['status'] | string): string {
  switch (status) {
    case 'passed':
      return 'The pre-registered replay criterion was met and every null comparison survived.';
    case 'failed':
      return 'The pre-registered replay criterion was not met.';
    case 'artifact':
      return 'A positive signal was observed but did not survive the shuffled-connectome null, so it cannot be attributed to the learned memory.';
    case 'not_run':
      return 'Stage 6 has not been run.';
    case 'running':
      return 'Stage 6 is still running; the file is provisional.';
    default:
      return status == null ? 'stage6_replay.json states no status.' : `status: ${String(status)}`;
  }
}

export default function Replay() {
  const s6 = useDataFile<Stage6>('stage6_replay.json');
  const s5 = useDataFile<Stage5>('stage5_sleep.json');
  const { selection } = useMapSelection();
  // With stage 6 results the map lives beside the raster and shares its scrubber. Without them the
  // atlas is still a real file, so the populations are drawn on their own and the activity sidecar
  // that would animate them is reported as not yet exported.
  const s6HasResults = s6.state === 'ready' && (s6.data as Partial<Stage6>)?.status !== 'not_run';

  return (
    <div>
      <h1 className="page-title">Replay</h1>
      <div className="prose">
        <p>
          Does the odor-A Kenyon-cell ensemble learned in Stage 4 reactivate spontaneously during the simulated sleep state from Stage 5, more
          than the unpaired ensemble, more than in wake, more than in a shuffled connectome, and more than random ensembles of the same size?
          {selection && (
            <>
              {' '}
              Selected run: <em>{selection.condition}</em>, seed {selection.seed}. The same selection drives the neuron map.
            </>
          )}
        </p>
      </div>
      <MapSlot />

      <section className="mt-6">
        <ErrorBoundary label="Stage 6">
          <StageGate stage="stage6_replay" loaded={s6}>
            {(d) => <Stage6View d={d} />}
          </StageGate>
        </ErrorBoundary>
      </section>

      {!s6HasResults && s6.state !== 'loading' && (
        <section className="mt-10">
          <h2>Brain map · what is simulated, and where</h2>
          <div className="prose mb-4">
            <p className="small muted">
              The map of the simulated neurons is exported independently of the replay stages, so it is drawn here even though stage 6 has
              produced no results yet. Nothing is lit: lighting the neurons needs the per-seed activity sidecar named below.
            </p>
          </div>
          {/* no seed is identified yet, so no concrete file is named: the panel shows the convention as one */}
          <BrainMapBlock activity={null} activityPath={null} sourceText="atlas only · no spikes loaded" time={null} decayMs={DECAY_MS} height={520} />
        </section>
      )}

      <section className="mt-10">
        <h2>Stage 5 · sleep state</h2>
        <ErrorBoundary label="Stage 5">
          <StageGate stage="stage5_sleep" loaded={s5}>
            {(d) => <Stage5View d={d} />}
          </StageGate>
        </ErrorBoundary>
      </section>
    </div>
  );
}

function Stage6View({ d }: { d: Stage6 }) {
  const { selection, setSelection } = useMapSelection();

  /**
   * Which runs exist. `activity[]` is what the map can play; `rasters[]` and `traces[]` are what
   * the panel beside it can draw. All three are the stage file's own lists, and the controls offer
   * exactly what they contain.
   */
  const refs = useMemo(() => activityRefs(d), [d]);
  const rasterSeeds = useMemo(() => {
    const s = new Map<string, Set<number>>();
    for (const r of [...(d.rasters ?? []), ...(d.traces ?? [])]) {
      if (!s.has(r.condition)) s.set(r.condition, new Set());
      s.get(r.condition)!.add(r.seed);
    }
    return s;
  }, [d]);
  const conditions = useMemo(() => {
    const set = new Set<string>([...refs.map((r) => r.condition), ...rasterSeeds.keys()]);
    return [...set].sort();
  }, [refs, rasterSeeds]);
  const seedsFor = useCallback(
    (c: string) => {
      const set = new Set<number>([...refs.filter((r) => r.condition === c).map((r) => r.seed), ...(rasterSeeds.get(c) ?? [])]);
      return [...set].sort((a, b) => a - b);
    },
    [refs, rasterSeeds],
  );

  // The page and the rail share one selection; this page seeds it when nothing has yet.
  useEffect(() => {
    if (selection) return;
    const c = conditions[0];
    if (c === undefined) return;
    const s = seedsFor(c)[0];
    if (s === undefined) return;
    setSelection({ condition: c, seed: s });
  }, [selection, conditions, seedsFor, setSelection]);

  const cond = selection?.condition ?? conditions[0] ?? null;
  const seedList = cond ? seedsFor(cond) : [];
  const seed = selection && seedList.includes(selection.seed) ? selection.seed : (seedList[0] ?? null);

  const rasterEntry = (d.rasters ?? []).find((r) => r.condition === cond && r.seed === seed) ?? null;
  const traceEntry = (d.traces ?? []).find((r) => r.condition === cond && r.seed === seed) ?? null;

  const [raster, setRaster] = useState<BinLoad<RasterData> | 'loading' | null>(null);
  const [trace, setTrace] = useState<BinLoad<TraceData> | 'loading' | null>(null);
  const rasterFile = rasterEntry?.file ?? null;
  const traceFile = traceEntry?.file ?? null;

  useEffect(() => {
    let cancel = false;
    if (rasterFile) {
      setRaster('loading');
      loadRaster(rasterFile)
        .then((r) => !cancel && setRaster(r))
        .catch((e) => !cancel && setRaster({ ok: false, missing: false, message: e instanceof Error ? e.message : String(e), path: rasterFile }));
    } else setRaster(null);
    if (traceFile) {
      setTrace('loading');
      loadTrace(traceFile)
        .then((r) => !cancel && setTrace(r))
        .catch((e) => !cancel && setTrace({ ok: false, missing: false, message: e instanceof Error ? e.message : String(e), path: traceFile }));
    } else setTrace(null);
    return () => {
      cancel = true;
    };
  }, [rasterFile, traceFile]);

  // The map's activity sidecar for the same condition and seed, from the stage file's own list.
  const listed = cond !== null && seed !== null ? (refs.find((r) => r.condition === cond && r.seed === seed) ?? null) : null;
  const path = cond !== null && seed !== null ? (listed?.file ?? activityPath(cond, seed)) : null;
  const activityRaw = useActivity(path);
  const atlas = useAtlas();

  /**
   * A spike file exported against a different atlas still indexes rows that exist, so it lights real
   * somata belonging to other neurons and no bounds check can tell. The export stamps the atlas
   * identity into both sidecars; a disagreement is refused here, before the map or the rail panel
   * can animate it, and rendered as a failure instead.
   */
  const activity = useMemo<Loadable<ActivityData> | null>(() => {
    if (!activityRaw || activityRaw.state !== 'ready' || atlas.state !== 'ready') return activityRaw;
    const chk = checkAtlasIdentity(activityRaw.data.sidecar, atlas.data);
    if (chk.state !== 'mismatch') return activityRaw;
    return {
      state: 'failed',
      missing: false,
      path: path ?? '',
      message: `stale pairing with neuron_atlas.bin: ${chk.message}. Re-run scripts/export_web.py so the spikes and the atlas come from one export.`,
    };
  }, [activityRaw, atlas, path]);

  const perSeedRows = (d.per_seed ?? []).filter((r) => r.condition === cond);

  // Verdict summary computed from the file, never from the status enum.
  const comparisons: Comparison[] = d.comparisons ?? [];
  const prereg = preregistered(d.required_four);
  const preSet = new Set(prereg.names);
  const nSurvive = comparisons.filter((c) => c.survives === true).length;
  const presentNames = new Set(comparisons.map((c) => c.name));
  const missingRequired = prereg.names.filter((n) => !presentNames.has(n));
  const additional = comparisons.filter((c) => !preSet.has(c.name));
  type CompRow = { kind: 'present'; c: Comparison; prereg: boolean } | { kind: 'missing'; name: string };
  const compRows: CompRow[] = [
    ...prereg.names.map<CompRow>((n) => {
      const c = comparisons.find((x) => x.name === n);
      return c ? { kind: 'present', c, prereg: true } : { kind: 'missing', name: n };
    }),
    ...additional.map<CompRow>((c) => ({ kind: 'present', c, prereg: false })),
  ];

  return (
    <div className="space-y-6">
      <div className="measure" style={{ borderTop: '1px solid var(--color-fg)', paddingTop: '1rem' }}>
        <div className="banner__title" style={{ fontSize: '1.6rem' }}>
          {d.headline}
        </div>
        <div className="mt-2 smaller muted">
          headline sentence from <span className="mono">stage6_replay.json</span> · window {fmtNum(d.window_ms)} ms · {fmtInt(d.n_seeds)} seeds
        </div>
      </div>

      <StatusBanner status={d.status} title="Replay verdict" criterion={d.criterion} reasons={d.reasons}>
        <div>{statusSentence(d.status)}</div>
        <div>
          {fmtInt(nSurvive)} of {fmtInt(comparisons.length)} comparisons listed in the file survive
          {missingRequired.length > 0 && (
            <span className="tone-failed">
              {' '}
              · {missingRequired.length} of the {prereg.names.length} pre-registered comparisons missing from the file
            </span>
          )}
          .
        </div>
      </StatusBanner>

      {/* The gain deviation travels with every number this stage produced, not in a footnote of its
          own somewhere else on the page. */}
      {typeof d.gain === 'number' && d.gain_note && (
        <div className="notrun" style={{ maxWidth: 'none' }}>
          <span className="label tone-failed">deviation from the published parameters</span>
          <p className="small mt-1">
            Every number on this page was produced at a synaptic gain of {fmtNum(d.gain)}. {d.gain_note}
          </p>
        </div>
      )}

      <Figure
        title={`Pre-registered comparisons · effect sizes${additional.length > 0 ? ', plus any additional comparison' : ''}`}
        provenance={d.provenance}
        caption={
          <>
            Each of the first {fmtInt(prereg.names.length)} rows is one pre-registered null comparison ({prereg.names.join(', ')}), taken from{' '}
            {prereg.fromFile ? (
              <>
                the stage file's own <span className="mono">required_four</span>
              </>
            ) : (
              <>
                <span className="mono">DATA_CONTRACT.md</span>, because this export states no <span className="mono">required_four</span> list of
                its own
              </>
            )}
            . 'Survives' / 'does not' is the pipeline's own verdict for that comparison. A positive g means the first-named condition scored
            higher on the metric. The axis is symmetric-log so that a confidence interval reaching {fmtNum(Math.max(...comparisons.map((c) => c.g_ci95?.[1] ?? 0)), 1)}{' '}
            does not squash the other rows onto zero; a whisker that runs past the drawn range ends in an arrow.
            {missingRequired.length > 0 && (
              <span className="tone-failed">
                {' '}
                {missingRequired.length} pre-registered comparison(s) are missing from the file and are shown as missing rows.
              </span>
            )}
            {additional.length > 0 && (
              <>
                {' '}
                {additional.length === 1 ? 'One further comparison is' : `${additional.length} further comparisons are`} in the file beyond that
                set and {additional.length === 1 ? 'is' : 'are'} labelled as additional.{' '}
                {d.fifth_comparison_note ?? (
                  <span className="muted">
                    stage6_replay.json carries no <span className="mono">fifth_comparison_note</span>, so no explanation of it is shown.
                  </span>
                )}
              </>
            )}
            {d.metric_note && <> {d.metric_note}</>}
          </>
        }
      >
        <ForestPlot comparisons={comparisons} required={d.required_four} note={d.fifth_comparison_note} />
      </Figure>

      <div className="card">
        <div className="label label--ink mb-2">Comparison values</div>
        <DataTable<CompRow>
          columns={[
            {
              key: 'l',
              header: 'comparison',
              render: (r) =>
                r.kind === 'missing' ? (
                  <span className="whitespace-normal tone-failed">
                    pre-registered comparison <span className="mono">{r.name}</span> missing from stage6_replay.json
                  </span>
                ) : (
                  <span className="whitespace-normal">
                    {r.c.label}
                    {!r.prereg && <span className="badge ml-2">additional</span>}
                  </span>
                ),
            },
            { key: 'n', header: 'name', render: (r) => <span className="mono">{r.kind === 'missing' ? r.name : r.c.name}</span> },
            { key: 'm', header: 'metric', render: (r) => (r.kind === 'missing' ? NOT_MEASURED : r.c.metric) },
            { key: 'x', header: 'x mean', render: (r) => (r.kind === 'missing' ? NOT_MEASURED : fmtNum(r.c.x_mean, 4)) },
            { key: 'y', header: 'y mean', render: (r) => (r.kind === 'missing' ? NOT_MEASURED : fmtNum(r.c.y_mean, 4)) },
            { key: 'd', header: 'diff', render: (r) => (r.kind === 'missing' ? NOT_MEASURED : fmtNum(r.c.diff, 4)) },
            { key: 'ci', header: 'diff CI95', render: (r) => (r.kind === 'missing' ? NOT_MEASURED : fmtCI(r.c.ci95, 4)) },
            { key: 'g', header: 'Hedges g', render: (r) => (r.kind === 'missing' ? NOT_MEASURED : fmtNum(r.c.hedges_g, 3)) },
            { key: 'gci', header: 'g CI95', render: (r) => (r.kind === 'missing' ? NOT_MEASURED : fmtCI(r.c.g_ci95, 3)) },
            { key: 'p', header: 'p', render: (r) => (r.kind === 'missing' ? NOT_MEASURED : fmtP(headlineP(r.c))) },
            { key: 'nn', header: 'n', render: (r) => (r.kind === 'missing' ? NOT_MEASURED : fmtInt(r.c.n)) },
            {
              key: 's',
              header: 'survives',
              render: (r) =>
                r.kind === 'missing' ? (
                  <span className="tone-failed">MISSING</span>
                ) : (
                  <span className={r.c.survives ? 'tone-passed' : 'tone-failed'}>{r.c.survives ? 'yes' : 'NO'}</span>
                ),
            },
          ]}
          rows={compRows}
          rowKey={(r) => (r.kind === 'missing' ? `missing-${r.name}` : r.c.name)}
          rowClass={(r) => (r.kind === 'missing' ? 'row--flag' : '')}
        />
        <div className="smaller muted mt-2">
          p is the file's own <span className="mono">p</span> where it carries one, otherwise its <span className="mono">p_permutation</span> and
          then its <span className="mono">p_wilcoxon</span>; a comparison that carries none prints "{NOT_MEASURED}".
        </div>
        <ProvenanceFooter provenance={d.provenance} />
      </div>

      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
          <div className="label label--ink">
            Replay window · {cond ?? 'no condition'}
            {seed !== null ? `, seed ${seed}` : ''}
          </div>
          <div className="flex flex-wrap items-center gap-3 small">
            <span className="label">condition</span>
            <div className="segmented" role="tablist" aria-label="condition">
              {conditions.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="tab"
                  aria-selected={cond === c}
                  onClick={() => {
                    const list = seedsFor(c);
                    setSelection({ condition: c, seed: seed !== null && list.includes(seed) ? seed : (list[0] ?? 0) });
                  }}
                  className="segmented__option"
                  data-text={c}
                >
                  {c}
                </button>
              ))}
            </div>
            <label className="muted flex items-center gap-2">
              seed
              <select
                className="control"
                value={seed ?? ''}
                onChange={(e) => cond && setSelection({ condition: cond, seed: Number(e.target.value) })}
                disabled={seedList.length === 0}
              >
                {seedList.map((sd) => (
                  <option key={sd} value={sd}>
                    {sd}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {conditions.length === 0 ? (
          <div className="notrun">
            No raster, trace or activity sidecar is listed in <span className="mono">stage6_replay.json</span>. Expected entries under{' '}
            <span className="mono">rasters[]</span>, <span className="mono">traces[]</span> and <span className="mono">activity[]</span>; produced
            by <span className="mono">scripts/06_replay.py</span> and <span className="mono">scripts/export_web.py</span>.
          </div>
        ) : (
          <ReplayWindow cond={cond} seed={seed} activity={activity} activityPath={path} raster={raster} trace={trace} provenance={d.provenance} />
        )}
      </section>

      <div className="card">
        <div className="label label--ink mb-2">Per-seed metrics · {cond ?? 'no condition'}</div>
        <DataTable<Stage6PerSeed>
          columns={[
            { key: 'seed', header: 'seed', render: (r) => r.seed },
            { key: 'net', header: 'network', render: (r) => r.network },
            { key: 'ens', header: 'ensemble', render: (r) => r.ensemble },
            { key: 'tc', header: 'template corr mean', render: (r) => fmtNum(r.template_corr_mean, 4) },
            { key: 'tp', header: 'template corr p95', render: (r) => fmtNum(r.template_corr_p95, 4) },
            { key: 'ev', header: 'reactivation events', render: (r) => fmtInt(r.n_reactivation_events) },
            { key: 'cz', header: 'coactivation z', render: (r) => fmtNum(r.coactivation_z, 3) },
            { key: 'sr', header: 'sequence rho', render: (r) => fmtNum(sequenceRho(r), 3) },
            { key: 'sp', header: 'sequence p', render: (r) => fmtP(sequenceP(r)) },
          ]}
          rows={perSeedRows}
          rowKey={(r, i) => `${r.seed}-${r.network}-${r.ensemble}-${i}`}
          empty={`no per-seed rows for condition "${cond ?? ''}"`}
          pageSize={20}
        />
        <div className="smaller muted mt-2">
          The sequence columns are the file's own <span className="mono">sequence.rho_mean</span> and <span className="mono">sequence.p</span>{' '}
          where the row carries a <span className="mono">sequence</span> block, and its flat{' '}
          <span className="mono">sequence_rho</span> / <span className="mono">sequence_p</span> where it carries those instead. A row with
          neither prints "{NOT_MEASURED}".
        </div>
        <ProvenanceFooter provenance={d.provenance} />
      </div>

      <div className="card">
        <div className="label label--ink mb-2">Metric definitions (from the stage file)</div>
        <dl className="kv">
          {Object.entries(d.metrics ?? {}).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="mono">{k}</dt>
              <dd className="whitespace-normal">{v}</dd>
            </div>
          ))}
        </dl>
        <ProvenanceFooter provenance={d.provenance} />
      </div>
    </div>
  );
}

/** The p value the file carries for a comparison, in the order the caption states. */
function headlineP(c: Comparison): number | null {
  return isNum(c.p) ? c.p : isNum(c.p_permutation) ? c.p_permutation : isNum(c.p_wilcoxon) ? c.p_wilcoxon : null;
}

/** The sequence score of a per-seed row, from whichever shape the file uses. */
function sequenceRho(r: Stage6PerSeed): number | null {
  if (isNum(r.sequence_rho)) return r.sequence_rho;
  const v = r.sequence?.rho_mean;
  return isNum(v) ? v : null;
}

function sequenceP(r: Stage6PerSeed): number | null {
  if (isNum(r.sequence_p)) return r.sequence_p;
  const v = r.sequence?.p;
  return isNum(v) ? v : null;
}

/**
 * The scrubbed window: the clock, the map and the raster/trace, and nothing else. The play loop
 * advances `start` ~60 times a second, so the store that holds it must not sit above the forest
 * plot, the tables and the provenance footers, all of which would reconcile on every frame for a
 * value none of them reads.
 */
function ReplayWindow({
  cond,
  seed,
  activity,
  activityPath: path,
  raster,
  trace,
  provenance,
}: {
  cond: string | null;
  seed: number | null;
  /** already checked against the atlas by the caller: a stale pairing arrives here as 'failed' */
  activity: Loadable<ActivityData> | null;
  activityPath: string | null;
  raster: BinLoad<RasterData> | 'loading' | null;
  trace: BinLoad<TraceData> | 'loading' | null;
  provenance: Stage6['provenance'];
}) {
  const act = activity !== null && activity.state === 'ready' ? activity.data : null;
  const rasterData = raster !== null && raster !== 'loading' && raster.ok ? raster.data : null;
  const traceData = trace !== null && trace !== 'loading' && trace.ok ? trace.data : null;

  // One clock for the raster, the correlation trace and the map. Its length is the longest span any
  // of the loaded files reports; when none of them reports one it stays null and the controls say so,
  // rather than showing a duration no file supplied.
  const durationS = useMemo(() => {
    const cands: number[] = [];
    if (rasterData) {
      if (typeof rasterData.sidecar.duration_s === 'number') cands.push(rasterData.sidecar.duration_s);
      cands.push(rasterMaxTimeMs(rasterData) / 1000);
    }
    // loadTrace refuses a sidecar without a positive dt_s, so this is the file's own bin width
    if (traceData) cands.push(traceData.nBins * traceData.sidecar.dt_s);
    if (act) {
      if (typeof act.sidecar.duration_s === 'number') cands.push(act.sidecar.duration_s);
      cands.push(act.maxTMs / 1000);
    }
    const usable = cands.filter((v) => Number.isFinite(v) && v > 0);
    return usable.length > 0 ? Math.max(...usable) : null;
  }, [rasterData, traceData, act]);

  const timeline = useTimeline(durationS);
  const { clock, windowS, durationS: durS, durationKnown } = timeline;
  /**
   * The map lights the leading edge of the visible window: spikes in the last decayMs of it,
   * clamped to the data so a window longer than the file cannot push the map past the last spike
   * while the raster and the trace still show them.
   */
  const mapTime = useMemo<TimeSource>(
    () => ({ get: () => (durationKnown ? Math.min(clock.get() + windowS, durS) * 1000 : null) }),
    [clock, windowS, durS, durationKnown],
  );

  return (
    <>
      <TimelineControls timeline={timeline} disabled={!timeline.durationKnown || (!rasterData && !traceData && !act)} />
      <div className="cols-2 mt-5">
        <BrainMapBlock
          activity={activity}
          activityPath={path}
          sourceText={
            act ? `replay result · ${cond ?? '?'}, seed ${seed ?? '?'}` : `replay result · ${cond ?? '?'}, seed ${seed ?? '?'} · not loaded, nothing is lit`
          }
          time={timeline.durationKnown ? mapTime : null}
          decayMs={DECAY_MS}
          height={520}
        />
        <Figure
          title={`KC ensemble raster · ${cond ?? 'no condition'}${seed !== null ? `, seed ${seed}` : ''}`}
          provenance={provenance}
          caption="Top: spikes of the ensemble neurons (rows grouped A / B / other KC). Bottom: Pearson correlation between the population vector in each bin and the A and B templates, with the reactivation threshold. Both panels, and the map beside them, share the scrubber above."
        >
          {raster !== null && raster !== 'loading' && !raster.ok && (
            <div className="mb-2 notrun small" style={{ maxWidth: 'none' }}>
              raster not available: <span className="mono">{raster.path}</span>: {raster.message}
            </div>
          )}
          {trace !== null && trace !== 'loading' && !trace.ok && (
            <div className="mb-2 notrun small" style={{ maxWidth: 'none' }}>
              trace not available: <span className="mono">{trace.path}</span>: {trace.message}
            </div>
          )}
          {(raster === 'loading' || trace === 'loading') && <div className="small muted mb-2">loading binary data …</div>}
          {/* the one child of this figure that reads the clock; it subscribes rather than being
              handed a time from above, so the figure around it is not rebuilt on every frame */}
          <RasterWindow clock={timeline.clock} raster={rasterData} trace={traceData} windowS={timeline.windowS} />
        </Figure>
      </div>
    </>
  );
}

function Stage5View({ d }: { d: Stage5 }) {
  return (
    <div className="space-y-4">
      <StatusBanner status={d.status} title="Sleep-state induction" criterion={d.criterion} reasons={d.reasons} />
      <div className="cols-2">
        <div className="card">
          <div className="label label--ink mb-2">Dorsal fan-shaped body clamp</div>
          <dl className="kv">
            <dt>dFB cell types</dt>
            <dd className="whitespace-normal">{(d.dfb?.cell_types ?? []).join(', ') || 'not stated'}</dd>
            <dt>n neurons</dt>
            <dd>{fmtInt(d.dfb?.n_neurons)}</dd>
            <dt>selection source</dt>
            <dd className="whitespace-normal">{d.dfb?.selection_source}</dd>
            <dt>clamp rate</dt>
            <dd>{fmtNum(d.dfb?.clamp_rate_hz)} Hz</dd>
            <dt>rate source</dt>
            <dd className="whitespace-normal">{d.dfb?.rate_source}</dd>
          </dl>
          <div className="label label--ink mt-5 mb-1">Conditions</div>
          <dl className="kv">
            {Object.entries(d.conditions ?? {}).map(([k, v]) => (
              <div key={k} className="contents">
                <dt>{k}</dt>
                <dd className="whitespace-normal">{v.description}</dd>
              </div>
            ))}
          </dl>
          <ProvenanceFooter provenance={d.provenance} />
        </div>
        <div className="card">
          <div className="label label--ink mb-2">Population rates by condition</div>
          <DataTable
            columns={[
              { key: 'c', header: 'condition', render: (r) => r.condition },
              { key: 'p', header: 'pop. rate (Hz)', render: (r) => fmtNum(r.pop_rate_hz_mean, 4) },
              { key: 'k', header: 'KC rate (Hz)', render: (r) => fmtNum(r.kc_rate_hz_mean, 4) },
              { key: 'd', header: 'dFB rate (Hz)', render: (r) => fmtNum(r.dfb_rate_hz_mean, 4) },
            ]}
            rows={d.summary ?? []}
            rowKey={(r) => r.condition}
          />
          <div className="label label--ink mt-5 mb-2">Per seed</div>
          <DataTable
            columns={[
              { key: 's', header: 'seed', render: (r) => r.seed },
              { key: 'c', header: 'condition', render: (r) => r.condition },
              { key: 'p', header: 'pop. rate', render: (r) => fmtNum(r.pop_rate_hz, 4) },
              { key: 'k', header: 'KC rate', render: (r) => fmtNum(r.kc_rate_hz, 4) },
              { key: 'm', header: 'MBON rate', render: (r) => fmtNum(r.mbon_rate_hz, 4) },
              { key: 'd', header: 'dFB rate', render: (r) => fmtNum(r.dfb_rate_hz, 4) },
              { key: 'f', header: 'frac active', render: (r) => fmtPct(r.frac_active) },
            ]}
            rows={d.per_seed ?? []}
            rowKey={(r, i) => `${r.seed}-${r.condition}-${i}`}
            pageSize={20}
          />
          <ProvenanceFooter provenance={d.provenance} />
        </div>
      </div>
    </div>
  );
}
