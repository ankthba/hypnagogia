import { useEffect, useMemo, useRef, useState } from 'react';
import BrainMap, {
  PROJECTIONS,
  PROJECTION_SHORT,
  VncToggle,
  atlasProvenance,
  useActivity,
  useAtlas,
  type Projection,
} from './BrainMap';
import NotRunPanel from './NotRunPanel';
import ProvenanceFooter from './ProvenanceFooter';
import { useDataFile } from '../lib/data';
import { useMediaQuery } from '../lib/media';
import { useReplayActivity } from '../lib/mapSource';
import { fmtInt, fmtNum } from '../lib/format';
import type { ActivityData } from '../lib/binary';
import type { Manifest, Provenance, ReferenceClip, ReferenceClipsFile } from '../types';

/**
 * The persistent neuron map in the right-hand rail. It is on every page, and it is never blank
 * while `neuron_atlas.json` is readable: the atlas alone draws the populations.
 *
 * What it plays, in the order the data contract fixes:
 *   1. the activity of the seed/condition selected on the Replay page, when
 *      `replay/activity_<cond>_seed<k>.json` exists for it (published through MapSourceContext);
 *   2. otherwise one of the reference clips listed in `reference_clips.json` - real simulations of
 *      this model written by `scripts/07_reference_clips.py`, looped, and labelled on screen as a
 *      reference simulation rather than the replay result;
 *   3. otherwise nothing animates, and the panel says so and names the script that would fix it.
 *
 * There is no demo mode: every spike drawn here was read out of a binary the pipeline wrote.
 */

/** A spike stays lit for this long on the panel map, fading out. */
const DECAY_MS = 160;
/** Fixed simulation step for the loop, so the playback rate does not depend on the frame rate. */
const STEP_MS = 1000 / 60;

export default function MapPanel() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(380);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setWidth(Math.max(240, Math.floor(e[0].contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const narrow = useMediaQuery('(max-width: 699px)');
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  const m = useDataFile<Manifest>('manifest.json');
  const manifest = m.state === 'ready' ? m.data : null;
  const atlas = useAtlas();
  const clipsFile = useDataFile<ReferenceClipsFile>('reference_clips.json');
  const replay = useReplayActivity();

  const clips: ReferenceClip[] = clipsFile.state === 'ready' && Array.isArray(clipsFile.data.clips) ? clipsFile.data.clips : [];

  /**
   * Source choice. The contract forbids a reference clip whenever the selected seed/condition has
   * activity of its own, so when the Replay page has published one there is nothing to choose
   * between: the clip list is not offered at all.
   */
  const [clipName, setClipName] = useState<string | null>(null);
  const clip: ReferenceClip | null = replay ? null : (clips.find((c) => c.name === clipName) ?? clips[0] ?? null);
  const clipLoad = useActivity(clip ? clip.file : null);

  const activity: ActivityData | null = replay ? replay.data : clipLoad?.state === 'ready' ? clipLoad.data : null;
  const sourceKey = replay ? `replay:${replay.path}` : clip ? `clip:${clip.name}` : 'none';

  // The loop length: the sidecar's own duration, never shorter than the last spike it holds.
  const durationMs = activity ? Math.max(Math.round((activity.sidecar.duration_s ?? 0) * 1000), activity.maxTMs + 1) : 0;

  const [playing, setPlaying] = useState(!reduceMotion);
  useEffect(() => {
    if (reduceMotion) setPlaying(false);
  }, [reduceMotion]);

  const [timeMs, setTimeMs] = useState(0);
  const tRef = useRef(0);
  useEffect(() => {
    tRef.current = 0;
    setTimeMs(0);
  }, [sourceKey]);

  useEffect(() => {
    if (!playing || durationMs <= 0) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const tick = (now: number) => {
      acc += Math.min(250, now - last);
      last = now;
      let t = tRef.current;
      while (acc >= STEP_MS) {
        t += STEP_MS;
        acc -= STEP_MS;
      }
      // Loop by wrapping rather than resetting, so the seam is one frame like any other.
      if (t >= durationMs) t -= Math.floor(t / durationMs) * durationMs;
      tRef.current = t;
      setTimeMs(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, durationMs]);

  const [projection, setProjection] = useState<Projection>('frontal');
  // Framed on view_boxes.brain by default; the switch below opens it out to view_boxes.all.
  const [showVnc, setShowVnc] = useState(false);

  // The canvas takes the projection's own aspect; this is only the ceiling it may not pass, so a
  // sagittal view (taller than it is wide) does not run off a short screen.
  const mapHeight = narrow ? Math.round(Math.min(width * 1.5, 460)) : 620;

  const provenance: Provenance | undefined = useMemo(() => {
    if (clip) {
      const p = clip.provenance ?? { config: 'null', files: [] };
      return {
        config: p.config ?? 'null',
        results_dir: p.results_dir,
        files: [
          ...(p.files ?? []),
          `web/public/data/${clip.file}`,
          'web/public/data/reference_clips.json',
          'web/public/data/neuron_atlas.json',
          'web/public/data/neuron_atlas.bin',
        ],
        git_commit: p.git_commit ?? manifest?.git_commit ?? '',
        generated_at: manifest?.generated_at,
      };
    }
    if (replay) return atlasProvenance(manifest, [`web/public/data/${replay.path}`]);
    return atlasProvenance(manifest);
  }, [clip, replay, manifest]);

  if (atlas.state === 'loading') {
    return (
      <div ref={wrapRef} className="map-panel">
        <PanelHead />
        <div className="small muted py-6">loading neuron_atlas.json …</div>
      </div>
    );
  }

  if (atlas.state === 'failed') {
    return (
      <div ref={wrapRef} className="map-panel">
        <PanelHead />
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

  const canPlay = durationMs > 0;

  return (
    <div ref={wrapRef} className="map-panel">
      <PanelHead />

      <BrainMap
        atlas={atlas.data}
        activity={activity}
        timeMs={activity && canPlay ? timeMs : null}
        decayMs={DECAY_MS}
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
        {canPlay && (
          <span className="smaller muted mono">
            {fmtNum(timeMs / 1000, 2)} / {fmtNum(durationMs / 1000, 2)} s
          </span>
        )}
        {atlas.data.sidecar.view_boxes?.brain && <VncToggle atlas={atlas.data} on={showVnc} set={setShowVnc} compact />}
      </div>

      {!replay && clips.length > 1 && (
        <label className="map-panel__select small muted">
          simulation
          <select className="control" value={clip?.name ?? ''} onChange={(e) => setClipName(e.target.value)}>
            {clips.map((c) => (
              <option key={c.name} value={c.name}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
      )}

      <SourceLine
        replay={replay ? { path: replay.path, condition: replay.condition, seed: replay.seed, data: replay.data } : null}
        clip={clip}
        clipActivity={clipLoad?.state === 'ready' ? clipLoad.data : null}
        clipFailed={clipLoad?.state === 'failed' ? clipLoad : null}
        clipsState={clipsFile.state}
        clipsCount={clips.length}
        note={clipsFile.state === 'ready' ? clipsFile.data.note : undefined}
        playing={playing}
        reduceMotion={reduceMotion}
      />

      <ProvenanceFooter provenance={provenance} />
    </div>
  );
}

function PanelHead() {
  return (
    <div className="map-panel__head">
      <span className="label label--ink">neuron map</span>
      <span className="smaller muted">soma positions</span>
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
  playing,
  reduceMotion,
}: {
  replay: { path: string; condition: string; seed: number; data: ActivityData } | null;
  clip: ReferenceClip | null;
  clipActivity: ActivityData | null;
  clipFailed: { missing: boolean; path: string; message: string } | null;
  clipsState: 'loading' | 'missing' | 'error' | 'ready';
  clipsCount: number;
  note?: string;
  playing: boolean;
  reduceMotion: boolean;
}) {
  if (replay) {
    const sc = replay.data.sidecar;
    return (
      <div className="map-panel__source">
        <div className="label label--ink">replay activity · {replay.condition}, seed {replay.seed}</div>
        <p className="smaller">
          The spikes on the map are the replay window of the selected seed and condition, as stage 6 exported it. This is the replay
          result itself, not a reference simulation.
        </p>
        <SpikeFacts sc={sc} activeNeurons={null} />
        <div className="smaller mono muted">web/public/data/{replay.path}</div>
        <LoopNote playing={playing} reduceMotion={reduceMotion} />
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
      <div className="label tone-failed">reference simulation · not the replay result</div>
      <div className="map-panel__title">{clip.title}</div>
      <p className="smaller">{clip.description}</p>
      {clipFailed && (
        <p className="smaller tone-failed">
          Nothing is lit: <span className="mono">web/public/data/{clipFailed.path}</span>{' '}
          {clipFailed.missing ? 'is absent (HTTP 404)' : `could not be read - ${clipFailed.message}`}.
        </p>
      )}
      {sc && <SpikeFacts sc={sc} activeNeurons={clip.n_active_neurons} />}
      <div className="smaller mono muted">
        config: {clip.provenance?.config ?? 'null'}
        {clip.provenance?.results_dir ? ` · results: ${clip.provenance.results_dir}` : ''}
      </div>
      <LoopNote playing={playing} reduceMotion={reduceMotion} />
      {note && <p className="smaller muted">{note}</p>}
    </div>
  );
}

/** Counts read out of the activity sidecar itself (and, for active neurons, out of reference_clips.json). */
function SpikeFacts({ sc, activeNeurons }: { sc: ActivityData['sidecar']; activeNeurons: number | null }) {
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
      {activeNeurons !== null && (
        <>
          <dt>active neurons</dt>
          <dd>{fmtInt(activeNeurons)}</dd>
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
