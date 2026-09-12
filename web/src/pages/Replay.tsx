import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useDataFile } from '../lib/data';
import { checkAtlasIdentity, loadRaster, loadTrace, rasterMaxTimeMs, type ActivityData, type RasterData, type TraceData, type BinLoad } from '../lib/binary';
import type { Comparison, Manifest, Stage5, Stage6 } from '../types';
import StageGate from '../components/StageGate';
import StatusBanner from '../components/StatusBanner';
import Figure from '../components/Figure';
import DataTable from '../components/DataTable';
import ErrorBoundary from '../components/ErrorBoundary';
import ProvenanceFooter from '../components/ProvenanceFooter';
import ForestPlot, { REQUIRED_COMPARISONS } from '../components/charts/ForestPlot';
import RasterViewer from '../components/charts/RasterViewer';
import NotRunPanel from '../components/NotRunPanel';
import BrainMap, { AtlasCaption, atlasProvenance, useActivity, useAtlas, type Loadable } from '../components/BrainMap';
import type { AtlasData } from '../lib/binary';
import { fmtNum, fmtInt, fmtP, fmtCI, fmtPct } from '../lib/format';
import { usePublishReplayActivity } from '../lib/mapSource';

type Cond = 'sleep' | 'wake';

/** How long a spike stays lit on the map after it fires. */
const DECAY_MS = 150;

interface Timeline {
  start: number;
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
 * The single clock of the Replay page. It was previously private to the raster; it is lifted here
 * so the raster, the correlation trace and the brain map are scrubbed and played together.
 */
function useTimeline(duration: number | null): Timeline {
  const durationKnown = duration !== null && Number.isFinite(duration) && duration > 0;
  const durationS = durationKnown ? (duration as number) : 0;
  const [windowS, setWindowS] = useState(2);
  const [start, setStart] = useState(0);
  const [playing, setPlaying] = useState(false);
  const maxStart = Math.max(0, durationS - windowS);
  const startRef = useRef(start);
  useEffect(() => {
    startRef.current = start;
  }, [start]);

  useEffect(() => {
    setStart((v) => Math.min(v, Math.max(0, durationS - windowS)));
  }, [durationS, windowS]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const next = startRef.current + dt; // 1x real time
      if (next >= maxStart) {
        setStart(maxStart);
        setPlaying(false);
        return;
      }
      setStart(next);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, maxStart]);

  return { start, setStart, windowS, setWindowS, playing, setPlaying, maxStart, durationS, durationKnown };
}

/** Play / pause, scrubber and window length: one set of controls for every panel below it. */
function TimelineControls({ timeline, disabled }: { timeline: Timeline; disabled: boolean }) {
  const { start, setStart, windowS, setWindowS, playing, setPlaying, maxStart, durationS, durationKnown } = timeline;
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
          className="flex-1 min-w-[160px]"
          aria-label="window start (s)"
          disabled={disabled}
        />
        <span className="tabular-nums muted">
          {durationKnown ? (
            <>
              {fmtNum(start, 2)} – {fmtNum(start + windowS, 2)} s / {fmtNum(durationS, 2)} s
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
  activityPath,
  timeMs,
  decayMs,
  height,
}: {
  activity: Loadable<ActivityData> | null;
  /**
   * The concrete activity sidecar this map would animate from, named in the panel when it is absent.
   * `null` means no concrete file is identified yet (stage 6 has listed no seed), and the panel then
   * shows the naming convention labelled as one rather than a path with a placeholder in it.
   */
  activityPath: string | null;
  timeMs: number | null;
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
  return (
    <Figure
      title="Brain map · soma positions, lit by spikes"
      provenance={atlasProvenance(manifest, act ? [`web/public/data/${activityPath}`, `web/public/data/replay/${act.sidecar.bin}`] : [])}
      caption={<AtlasCaption atlas={atlasData} activity={act} />}
    >
      {activity === null && (
        <div className="mb-3">
          <NotRunPanel
            file={activityPath ?? undefined}
            filePattern={activityPath === null ? ACTIVITY_PATTERN : undefined}
            patternSource={
              <>
                the <span className="mono">rasters[]</span> / <span className="mono">traces[]</span> entries of{' '}
                <span className="mono">stage6_replay.json</span>, which list the conditions and seeds that exist
              </>
            }
            script="scripts/06_replay.py"
            reason={activityPath === null ? 'unnamed' : 'not_run'}
            title="Brain-map activity"
            note={
              <span>
                No activity sidecar is loaded, so nothing on the map is lit. The populations below are the atlas itself and are real.
              </span>
            }
          />
        </div>
      )}
      {activity !== null && activity.state === 'loading' && <div className="small muted mb-2">loading activity binary …</div>}
      {activity !== null && activity.state === 'failed' && (
        <div className="mb-3">
          <NotRunPanel
            file={activity.missing ? activityPath ?? undefined : activity.path}
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
      <BrainMap atlas={atlasData} activity={act} timeMs={act ? timeMs : null} decayMs={decayMs} height={height} />
    </Figure>
  );
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
      return `status: ${String(status)}`;
  }
}

export default function Replay() {
  const s6 = useDataFile<Stage6>('stage6_replay.json');
  const s5 = useDataFile<Stage5>('stage5_sleep.json');
  const [cond, setCond] = useState<Cond>('sleep');
  // With stage 6 results the map lives beside the raster and shares its scrubber. Without them the
  // atlas is still a real file, so the populations are drawn on their own and the activity sidecar
  // that would animate them is reported as not yet exported.
  const s6HasResults = s6.state === 'ready' && (s6.data as Partial<Stage6>)?.status !== 'not_run';

  return (
    <div>
      <h1 className="page-title">Replay</h1>
      <div className="measure mb-4 flex flex-wrap items-center gap-4">
        <span className="label">condition</span>
        <div className="segmented" role="tablist" aria-label="condition">
          {(['sleep', 'wake'] as Cond[]).map((c) => (
            <button key={c} type="button" role="tab" aria-selected={cond === c} onClick={() => setCond(c)} className="segmented__option" data-text={c}>
              {c}
            </button>
          ))}
        </div>
      </div>
      <div className="prose"><p>
        Does the odor-A Kenyon-cell ensemble learned in Stage 4 reactivate spontaneously during the simulated sleep state
        from Stage 5, more than the unpaired ensemble, more than in wake, more than in a shuffled connectome, and more than
        random ensembles of the same size? Selected condition: <em>{cond}</em>.
      </p></div>

      <section className="mt-6">
        <ErrorBoundary label="Stage 6">
          <StageGate stage="stage6_replay" loaded={s6}>
            {(d) => <Stage6View d={d} cond={cond} />}
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
          <BrainMapBlock activity={null} activityPath={null} timeMs={null} decayMs={DECAY_MS} height={520} />
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

function Stage6View({ d, cond }: { d: Stage6; cond: Cond }) {
  const seedsForCond = useMemo(() => {
    const s = new Set<number>();
    (d.rasters ?? []).filter((r) => r.condition === cond).forEach((r) => s.add(r.seed));
    (d.traces ?? []).filter((r) => r.condition === cond).forEach((r) => s.add(r.seed));
    return [...s].sort((a, b) => a - b);
  }, [d, cond]);
  const [seedSel, setSeedSel] = useState<number | null>(null);
  const seed = seedSel !== null && seedsForCond.includes(seedSel) ? seedSel : (seedsForCond[0] ?? null);

  const rasterEntry = (d.rasters ?? []).find((r) => r.condition === cond && r.seed === seed) ?? null;
  const traceEntry = (d.traces ?? []).find((r) => r.condition === cond && r.seed === seed) ?? null;

  const [raster, setRaster] = useState<BinLoad<RasterData> | 'loading' | null>(null);
  const [trace, setTrace] = useState<BinLoad<TraceData> | 'loading' | null>(null);

  useEffect(() => {
    let cancel = false;
    if (rasterEntry) {
      setRaster('loading');
      loadRaster(rasterEntry.file)
        .then((r) => !cancel && setRaster(r))
        .catch((e) => !cancel && setRaster({ ok: false, missing: false, message: e instanceof Error ? e.message : String(e), path: rasterEntry.file }));
    } else setRaster(null);
    if (traceEntry) {
      setTrace('loading');
      loadTrace(traceEntry.file)
        .then((r) => !cancel && setTrace(r))
        .catch((e) => !cancel && setTrace({ ok: false, missing: false, message: e instanceof Error ? e.message : String(e), path: traceEntry.file }));
    } else setTrace(null);
    return () => {
      cancel = true;
    };
  }, [rasterEntry, traceEntry]);

  // The map's activity sidecar for the same condition/seed. The contract names the file
  // `replay/activity_<cond>_seed<k>.json`; stage6_replay.json does not list it, so it is derived.
  const activityPath = seed !== null ? `replay/activity_${cond}_seed${seed}.json` : null;
  const activityRaw = useActivity(activityPath);
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
      path: activityPath ?? '',
      message: `stale pairing with neuron_atlas.bin: ${chk.message}. Re-run scripts/export_web.py so the spikes and the atlas come from one export.`,
    };
  }, [activityRaw, atlas, activityPath]);
  const act = activity !== null && activity.state === 'ready' ? activity.data : null;

  // Hand the loaded activity to the persistent map panel in the rail. The contract gives this file
  // priority over the reference clips: while it is loaded the panel plays the replay result and
  // stops offering clips. Publishing nothing (no file for this seed/condition) leaves the panel on
  // a reference clip, which it labels as such.
  usePublishReplayActivity(act && activityPath && seed !== null ? { path: activityPath, condition: cond, seed, data: act } : null);

  const perSeedRows = (d.per_seed ?? []).filter((r) => r.condition === cond);

  // Verdict summary computed from the file, never from the status enum.
  const comparisons: Comparison[] = d.comparisons ?? [];
  const nSurvive = comparisons.filter((c) => c.survives === true).length;
  const presentNames = new Set(comparisons.map((c) => c.name));
  const missingRequired = REQUIRED_COMPARISONS.filter((n) => !presentNames.has(n));
  const unexpected = comparisons.filter((c) => !(REQUIRED_COMPARISONS as readonly string[]).includes(c.name));
  type CompRow = { kind: 'present'; c: Comparison } | { kind: 'missing'; name: string };
  const compRows: CompRow[] = [
    ...REQUIRED_COMPARISONS.map<CompRow>((n) => {
      const c = comparisons.find((x) => x.name === n);
      return c ? { kind: 'present', c } : { kind: 'missing', name: n };
    }),
    ...unexpected.map<CompRow>((c) => ({ kind: 'present', c })),
  ];

  return (
    <div className="space-y-6">
      <div className="measure" style={{ borderTop: '1px solid var(--color-fg)', paddingTop: '1rem' }}>
        <div className="banner__title" style={{ fontSize: '1.6rem' }}>{d.headline}</div>
        <div className="mt-2 smaller muted">
          headline sentence from <span className="mono">stage6_replay.json</span> · window {fmtNum(d.window_ms)} ms · {fmtInt(d.n_seeds)} seeds
        </div>
      </div>

      <StatusBanner status={d.status} title="Replay verdict" criterion={d.criterion} reasons={d.reasons}>
        <div>{statusSentence(d.status)}</div>
        <div>
          {fmtInt(nSurvive)} of {fmtInt(comparisons.length)} comparisons listed in the file survive
          {missingRequired.length > 0 && (
            <span className="tone-failed"> · {missingRequired.length} of the 4 pre-registered comparisons missing from the file</span>
          )}
          .
        </div>
      </StatusBanner>

      <Figure
        title="Four pre-registered comparisons - effect sizes"
        provenance={d.provenance}
        caption={
          <>
            Each row is one pre-registered null comparison ({REQUIRED_COMPARISONS.join(', ')}). 'Survives' / 'does not' is the
            pipeline's own verdict for that comparison. A positive g means the first-named condition scored higher on the metric.
            {missingRequired.length > 0 && (
              <span className="tone-failed"> {missingRequired.length} required comparison(s) are missing from the file and are shown as missing rows.</span>
            )}
            {unexpected.length > 0 && (
              <span className="tone-failed"> {unexpected.length} comparison(s) in the file are not among the four pre-registered names and are labelled unexpected.</span>
            )}
          </>
        }
      >
        <ForestPlot comparisons={comparisons} />
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
                    comparison <span className="mono">{r.name}</span> missing from stage6_replay.json
                  </span>
                ) : (
                  <span className="whitespace-normal">
                    {r.c.label}
                    {!(REQUIRED_COMPARISONS as readonly string[]).includes(r.c.name) && (
                      <span className="badge badge--failed ml-2">unexpected</span>
                    )}
                  </span>
                ),
            },
            { key: 'n', header: 'name', render: (r) => <span className="mono">{r.kind === 'missing' ? r.name : r.c.name}</span> },
            { key: 'm', header: 'metric', render: (r) => (r.kind === 'missing' ? '—' : r.c.metric) },
            { key: 'x', header: 'x mean', render: (r) => (r.kind === 'missing' ? '—' : fmtNum(r.c.x_mean, 4)) },
            { key: 'y', header: 'y mean', render: (r) => (r.kind === 'missing' ? '—' : fmtNum(r.c.y_mean, 4)) },
            { key: 'd', header: 'diff', render: (r) => (r.kind === 'missing' ? '—' : fmtNum(r.c.diff, 4)) },
            { key: 'ci', header: 'diff CI95', render: (r) => (r.kind === 'missing' ? '—' : fmtCI(r.c.ci95, 4)) },
            { key: 'g', header: 'Hedges g', render: (r) => (r.kind === 'missing' ? '—' : fmtNum(r.c.hedges_g, 3)) },
            { key: 'gci', header: 'g CI95', render: (r) => (r.kind === 'missing' ? '—' : fmtCI(r.c.g_ci95, 3)) },
            { key: 'p', header: 'p', render: (r) => (r.kind === 'missing' ? '—' : fmtP(r.c.p)) },
            { key: 'nn', header: 'n', render: (r) => (r.kind === 'missing' ? '—' : fmtInt(r.c.n)) },
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
        <ProvenanceFooter provenance={d.provenance} />
      </div>

      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <div className="label label--ink">Replay window · {cond}{seed !== null ? `, seed ${seed}` : ''}</div>
          <label className="small muted flex items-center gap-2">
            seed
            <select className="control" value={seed ?? ''} onChange={(e) => setSeedSel(Number(e.target.value))} disabled={seedsForCond.length === 0}>
              {seedsForCond.map((sd) => (
                <option key={sd} value={sd}>
                  {sd}
                </option>
              ))}
            </select>
          </label>
        </div>

        {seedsForCond.length === 0 ? (
          <div className="notrun">
            No raster or trace sidecar is listed in <span className="mono">stage6_replay.json</span> for condition "{cond}". Expected entries under{' '}
            <span className="mono">rasters[]</span> / <span className="mono">traces[]</span> pointing at{' '}
            <span className="mono">data/replay/raster_{cond}_seed&lt;k&gt;.json</span>; produced by <span className="mono">scripts/06_replay.py</span> +{' '}
            <span className="mono">scripts/export_web.py</span>.
          </div>
        ) : (
          <ReplayWindow
            cond={cond}
            seed={seed}
            activity={activity}
            activityPath={activityPath}
            raster={raster}
            trace={trace}
            provenance={d.provenance}
          />
        )}
      </section>

      <div className="card">
        <div className="label label--ink mb-2">Per-seed metrics - {cond}</div>
        <DataTable
          columns={[
            { key: 'seed', header: 'seed', render: (r) => r.seed },
            { key: 'net', header: 'network', render: (r) => r.network },
            { key: 'ens', header: 'ensemble', render: (r) => r.ensemble },
            { key: 'tc', header: 'template corr mean', render: (r) => fmtNum(r.template_corr_mean, 4) },
            { key: 'tp', header: 'template corr p95', render: (r) => fmtNum(r.template_corr_p95, 4) },
            { key: 'ev', header: 'reactivation events', render: (r) => fmtInt(r.n_reactivation_events) },
            { key: 'cz', header: 'coactivation z', render: (r) => fmtNum(r.coactivation_z, 3) },
            { key: 'sr', header: 'sequence rho', render: (r) => fmtNum(r.sequence_rho, 3) },
            { key: 'sp', header: 'sequence p', render: (r) => fmtP(r.sequence_p) },
          ]}
          rows={perSeedRows}
          rowKey={(r, i) => `${r.seed}-${r.network}-${r.ensemble}-${i}`}
          empty={`no per-seed rows for condition "${cond}"`}
        />
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

/**
 * The scrubbed window: the clock, the map and the raster/trace, and nothing else. The play loop sets
 * `start` ~60 times a second, so the state that holds it must not sit above the forest plot, the
 * tables and the provenance footers - all of which would reconcile on every frame for a value none
 * of them reads.
 */
function ReplayWindow({
  cond,
  seed,
  activity,
  activityPath,
  raster,
  trace,
  provenance,
}: {
  cond: Cond;
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
  // The map lights the leading edge of the visible window: spikes in the last DECAY_MS of it. Clamped
  // to the data, so a window longer than the file cannot push the map past the last spike while the
  // raster and the trace still show them.
  const mapTimeMs = Math.min(timeline.start + timeline.windowS, timeline.durationS) * 1000;

  return (
    <>
      <TimelineControls timeline={timeline} disabled={!timeline.durationKnown || (!rasterData && !traceData && !act)} />
      <div className="cols-2 mt-5">
        <BrainMapBlock
          activity={activity}
          activityPath={activityPath}
          timeMs={timeline.durationKnown ? mapTimeMs : null}
          decayMs={DECAY_MS}
          height={520}
        />
        <Figure
          title={`KC ensemble raster · ${cond}${seed !== null ? `, seed ${seed}` : ''}`}
          provenance={provenance}
          caption="Top: spikes of the ensemble neurons (rows grouped A / B / other KC). Bottom: Pearson correlation between the population vector in each bin and the A and B templates, with the reactivation threshold. Both panels, and the map beside them, share the scrubber above."
        >
          {raster !== null && raster !== 'loading' && !raster.ok && (
            <div className="mb-2 notrun small" style={{ maxWidth: 'none' }}>
              raster not available: <span className="mono">{raster.path}</span> - {raster.message}
            </div>
          )}
          {trace !== null && trace !== 'loading' && !trace.ok && (
            <div className="mb-2 notrun small" style={{ maxWidth: 'none' }}>
              trace not available: <span className="mono">{trace.path}</span> - {trace.message}
            </div>
          )}
          {(raster === 'loading' || trace === 'loading') && <div className="small muted mb-2">loading binary data …</div>}
          <RasterViewer raster={rasterData} trace={traceData} startS={timeline.start} windowS={timeline.windowS} />
        </Figure>
      </div>
    </>
  );
}

function Stage5View({ d }: { d: Stage5 }) {
  return (
    <div className="space-y-4">
      <StatusBanner status={d.status} title="Sleep-state induction" criterion={d.criterion} reasons={d.reasons} />
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="card">
          <div className="label label--ink mb-2">Dorsal fan-shaped body clamp</div>
          <dl className="kv">
            <dt>dFB cell types</dt>
            <dd className="whitespace-normal">{(d.dfb?.cell_types ?? []).join(', ') || 'null'}</dd>
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
          />
          <ProvenanceFooter provenance={d.provenance} />
        </div>
      </div>
    </div>
  );
}

