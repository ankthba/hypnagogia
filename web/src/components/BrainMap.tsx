import { useEffect, useMemo, useRef, useState } from 'react';
import { loadActivity, loadAtlas, type ActivityData, type AtlasData, type BinLoad } from '../lib/binary';
import { CHART_FONT, SERIES, resolveColors, useThemeVersion } from '../lib/colors';
import { fmtInt, fmtNum } from '../lib/format';
import type { Manifest, Provenance } from '../types';

/**
 * A canvas map of the simulated neurons at their soma positions, which lights up the neurons that
 * spike inside the current scrub window.
 *
 * Everything drawn comes from `neuron_atlas.json` + `neuron_atlas.bin` (positions, groups, counts)
 * and, when the map is animated, from one `replay/activity_<cond>_seed<k>.json` + `.bin`. No count,
 * label or position is written into this file; when a file is absent the caller renders the
 * explicit "not yet run" panel instead of a map.
 */

export type Projection = 'frontal' | 'dorsal' | 'sagittal';

/** Axis indices into the [x, y, z] triples of the sidecar, per projection: [horizontal, vertical]. */
const PROJECTION_AXES: Record<Projection, [0 | 1 | 2, 0 | 1 | 2]> = {
  frontal: [0, 1], // x vs y, y downward: looking at the front of the brain
  dorsal: [0, 2], // x vs z: looking down on it
  sagittal: [2, 1], // z vs y: looking at it from the side
};
const PROJECTION_LABEL: Record<Projection, string> = { frontal: 'frontal (x, y)', dorsal: 'dorsal (x, z)', sagittal: 'sagittal (z, y)' };
const AXIS_KEY = ['x', 'y', 'z'] as const;

/**
 * Group presentation. The named populations of this experiment (KC, MBON, DAN, dFB) carry the
 * palette's ink / Prussian blue / status colours; everything else is background and is drawn very
 * faint, 'other' and 'optic' faintest of all, so the named cells read through them. `z` is the
 * painting order (low first). Labels come from the sidecar; an unlisted label gets the fallback.
 */
const GROUP_STYLE: Record<string, { color: string; dim: number; z: number }> = {
  optic: { color: 'var(--color-muted)', dim: 0.05, z: 0 },
  other: { color: 'var(--color-muted)', dim: 0.1, z: 1 },
  CX: { color: 'var(--color-class-silent)', dim: 0.3, z: 2 },
  ORN: { color: 'var(--color-class-subcritical)', dim: 0.4, z: 3 },
  ALPN: { color: 'var(--color-link-hover)', dim: 0.5, z: 4 },
  KC: { color: 'var(--color-fg)', dim: 0.55, z: 5 },
  dFB: { color: 'var(--color-passed)', dim: 0.9, z: 6 },
  DAN: { color: 'var(--color-failed)', dim: 0.9, z: 7 },
  MBON: { color: 'var(--color-link)', dim: 0.9, z: 8 },
};
const GROUP_FALLBACK = { color: 'var(--color-muted)', dim: 0.3, z: 2 };
const styleFor = (label: string) => GROUP_STYLE[label] ?? GROUP_FALLBACK;

const PAD = 10;
const BOTTOM = 26;
const FONT_SM = `10.5px ${CHART_FONT}`;
/** Time bucket for the spike index; a scrub window is then a range of buckets, not a rescan. */
const BIN_MS = 16;

// ---------------------------------------------------------------- loading hooks

export type Loadable<T> = { state: 'loading' } | { state: 'ready'; data: T } | { state: 'failed'; missing: boolean; path: string; message: string };

/** Loads the atlas once (module-level promise cache: both pages share the parse). */
let atlasPromise: Promise<BinLoad<AtlasData>> | null = null;

export function useAtlas(): Loadable<AtlasData> {
  const [st, setSt] = useState<Loadable<AtlasData>>({ state: 'loading' });
  useEffect(() => {
    let cancel = false;
    if (!atlasPromise) atlasPromise = loadAtlas('neuron_atlas.json');
    atlasPromise
      .then((r) => {
        if (cancel) return;
        setSt(r.ok ? { state: 'ready', data: r.data } : { state: 'failed', missing: r.missing, path: r.path, message: r.message });
      })
      .catch((e) => {
        if (cancel) return;
        atlasPromise = null;
        setSt({ state: 'failed', missing: false, path: 'neuron_atlas.json', message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancel = true;
    };
  }, []);
  return st;
}

export function useActivity(path: string | null): Loadable<ActivityData> | null {
  const [st, setSt] = useState<Loadable<ActivityData> | null>(null);
  useEffect(() => {
    let cancel = false;
    if (!path) {
      setSt(null);
      return;
    }
    setSt({ state: 'loading' });
    loadActivity(path)
      .then((r) => {
        if (cancel) return;
        setSt(r.ok ? { state: 'ready', data: r.data } : { state: 'failed', missing: r.missing, path: r.path, message: r.message });
      })
      .catch((e) => {
        if (cancel) return;
        setSt({ state: 'failed', missing: false, path, message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancel = true;
    };
  }, [path]);
  return st;
}

/**
 * Provenance for a figure whose sources are the atlas files themselves (they carry no provenance
 * block of their own). The config and commit are the manifest's, i.e. the export that wrote them.
 */
export function atlasProvenance(m: Manifest | null, extraFiles: string[] = []): Provenance {
  return {
    config: m?.model?.base_config ?? 'null',
    files: ['web/public/data/neuron_atlas.json', 'web/public/data/neuron_atlas.bin', ...extraFiles],
    git_commit: m?.git_commit ?? '',
    generated_at: m?.generated_at,
  };
}

// ---------------------------------------------------------------- the map

export default function BrainMap({
  atlas,
  activity = null,
  timeMs = null,
  decayMs = 150,
  height = 420,
  projection: projectionProp,
  onProjectionChange,
}: {
  atlas: AtlasData;
  /** spikes to light up; null renders the populations only (no activity) */
  activity?: ActivityData | null;
  /** current scrub time in milliseconds; null means no activity is shown */
  timeMs?: number | null;
  /** a spike stays lit for this long, fading out */
  decayMs?: number;
  height?: number;
  projection?: Projection;
  onProjectionChange?: (p: Projection) => void;
}) {
  const [projInner, setProjInner] = useState<Projection>('frontal');
  const projection = projectionProp ?? projInner;
  const setProjection = (p: Projection) => (onProjectionChange ? onProjectionChange(p) : setProjInner(p));

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgRef = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(600);
  const themeVersion = useThemeVersion();

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(Math.max(240, Math.floor(entries[0].contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Group codes actually present, in painting order, with the label the sidecar gives each code.
  const groups = useMemo(() => {
    const counts = new Map<number, number>();
    for (let i = 0; i < atlas.n; i++) counts.set(atlas.group[i], (counts.get(atlas.group[i]) ?? 0) + 1);
    const list = (atlas.sidecar.groups ?? []).map((g) => ({
      code: g.code,
      label: g.label,
      /** neurons of this group in the map, counted from the binary itself */
      inMap: counts.get(g.code) ?? 0,
      /** what the sidecar says it wrote for this group */
      sidecarCount: atlas.sidecar.group_counts?.[g.label] ?? null,
      noSoma: atlas.sidecar.n_without_soma_position_by_group?.[g.label] ?? null,
      ...styleFor(g.label),
    }));
    // codes present in the binary but absent from groups[] are reported, never silently dropped
    const known = new Set(list.map((g) => g.code));
    const unknown = [...counts.keys()].filter((c) => !known.has(c)).sort((a, b) => a - b);
    return { list, byPaint: [...list].sort((a, b) => a.z - b.z), unknown, unknownTotal: unknown.reduce((s, c) => s + (counts.get(c) ?? 0), 0) };
  }, [atlas]);

  /**
   * Projection and fit. One scale is applied to both axes (so the brain is never stretched) and the
   * canvas itself is sized to what that scale draws, rather than leaving a wide empty mat around a
   * height-fitted brain. `height` is the tallest the canvas may be; the width available is the
   * container's. The vertical axis always increases downward.
   */
  const view = useMemo(() => {
    const [ui, vi] = PROJECTION_AXES[projection];
    const uLo = atlas.lo[ui];
    const vLo = atlas.lo[vi];
    const uRange = Math.max(1e-6, atlas.hi[ui] - uLo);
    const vRange = Math.max(1e-6, atlas.hi[vi] - vLo);
    const availW = Math.max(200, width) - 2 * PAD;
    const availH = Math.max(160, height - PAD - BOTTOM);
    const scale = Math.min(availW / uRange, availH / vRange);
    const plotW = uRange * scale;
    const plotH = vRange * scale;
    const cw = Math.round(plotW + 2 * PAD);
    const ch = Math.round(plotH + PAD + BOTTOM);
    const arr = (i: 0 | 1 | 2) => (i === 0 ? atlas.xUm : i === 1 ? atlas.yUm : atlas.zUm);
    const uArr = arr(ui);
    const vArr = arr(vi);
    return {
      ui,
      vi,
      cw,
      ch,
      px: (i: number) => PAD + (uArr[i] - uLo) * scale,
      py: (i: number) => PAD + (vArr[i] - vLo) * scale,
      scale,
      uRange,
      vRange,
    };
  }, [atlas, projection, width, height]);
  const canvasW = view.cw;
  const canvasH = view.ch;

  // Spike index: bucket rows by time bin once per file, so a window is a contiguous range.
  const index = useMemo(() => {
    if (!activity) return null;
    const n = activity.n;
    const nBins = Math.floor(activity.maxTMs / BIN_MS) + 1;
    const starts = new Int32Array(nBins + 1);
    let k = 0;
    for (let b = 0; b < nBins; b++) {
      const edge = (b + 1) * BIN_MS;
      while (k < n && activity.tMs[k] < edge) k++;
      starts[b + 1] = k;
    }
    return { starts, nBins };
  }, [activity]);

  // Neurons lit in the current window, deduplicated, each at the alpha of its most recent spike.
  // The stamp array marks which neurons are already in the list for this frame, so the dedupe
  // costs one array write per spike instead of a set lookup.
  const stampRef = useRef<{ gen: Int32Array; pos: Int32Array; n: number; counter: number } | null>(null);
  const lit = useMemo(() => {
    if (!activity || !index || timeMs === null || !Number.isFinite(timeMs)) return null;
    if (!stampRef.current || stampRef.current.n !== atlas.n) {
      stampRef.current = { gen: new Int32Array(atlas.n), pos: new Int32Array(atlas.n), n: atlas.n, counter: 0 };
    }
    const stamp = stampRef.current;
    stamp.counter += 1;
    const generation = stamp.counter;
    const t1 = timeMs;
    const t0 = timeMs - decayMs;
    const b0 = Math.max(0, Math.floor(t0 / BIN_MS));
    const b1 = Math.min(index.nBins - 1, Math.floor(t1 / BIN_MS));
    const rows: number[] = [];
    const alphas: number[] = [];
    let spikes = 0;
    let oob = 0;
    if (b1 >= b0) {
      const from = index.starts[b0];
      const to = index.starts[b1 + 1];
      for (let k = from; k < to; k++) {
        const t = activity.tMs[k];
        if (t < t0 || t > t1) continue;
        spikes++;
        const row = activity.atlasRow[k];
        if (row >= atlas.n) {
          oob++;
          continue;
        }
        const a = decayMs > 0 ? Math.max(0.12, 1 - (t1 - t) / decayMs) : 1;
        if (stamp.gen[row] === generation) {
          const p = stamp.pos[row];
          if (a > alphas[p]) alphas[p] = a;
        } else {
          stamp.gen[row] = generation;
          stamp.pos[row] = rows.length;
          rows.push(row);
          alphas.push(a);
        }
      }
    }
    return { rows, alphas, spikes, oob, nNeurons: rows.length };
  }, [activity, index, timeMs, decayMs, atlas.n]);

  // Background layer: all atlas neurons, dim, drawn once per size / projection / theme.
  const [bgVersion, setBgVersion] = useState(0);
  useEffect(() => {
    const dpr = window.devicePixelRatio || 1;
    const off = document.createElement('canvas');
    off.width = Math.round(canvasW * dpr);
    off.height = Math.round(canvasH * dpr);
    const ctx = off.getContext('2d');
    const wrap = wrapRef.current;
    if (!ctx || !wrap) return;
    const vars: Record<string, string> = { bg: SERIES.mat, axis: SERIES.axis };
    for (const g of groups.list) vars[`g${g.code}`] = g.color;
    vars.fallback = GROUP_FALLBACK.color;
    const C = resolveColors(wrap, vars);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, canvasW, canvasH);
    const size = 1.4;
    for (const g of groups.byPaint) {
      ctx.fillStyle = C[`g${g.code}`] ?? C.fallback;
      ctx.globalAlpha = g.dim;
      for (let i = 0; i < atlas.n; i++) {
        if (atlas.group[i] !== g.code) continue;
        ctx.fillRect(view.px(i) - size / 2, view.py(i) - size / 2, size, size);
      }
    }
    if (groups.unknown.length > 0) {
      ctx.fillStyle = C.fallback;
      ctx.globalAlpha = GROUP_FALLBACK.dim;
      const unknownSet = new Set(groups.unknown);
      for (let i = 0; i < atlas.n; i++) {
        if (!unknownSet.has(atlas.group[i])) continue;
        ctx.fillRect(view.px(i) - size / 2, view.py(i) - size / 2, size, size);
      }
    }
    ctx.globalAlpha = 1;

    // Axis note and a scale bar, both in the sidecar's own micrometres.
    ctx.fillStyle = C.axis;
    ctx.font = FONT_SM;
    ctx.textAlign = 'left';
    const hAxis = AXIS_KEY[view.ui];
    const vAxis = AXIS_KEY[view.vi];
    ctx.fillText(`horizontal: ${hAxis} · vertical: ${vAxis} (increasing downward)`, PAD, canvasH - 8);
    const nice = [1000, 500, 200, 100, 50, 20].find((u) => u * view.scale < (canvasW - 2 * PAD) / 3);
    if (nice) {
      const barPx = nice * view.scale;
      const x1 = canvasW - PAD;
      const y = canvasH - 14;
      ctx.strokeStyle = C.axis;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x1 - barPx, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(`${nice} µm`, x1, canvasH - 3);
    }
    bgRef.current = off;
    // force the foreground pass to repaint against the new background
    setBgVersion((v) => v + 1);
  }, [atlas, groups, view, canvasW, canvasH, themeVersion]);

  // Foreground: blit the background, then draw only the lit neurons.
  useEffect(() => {
    const cv = canvasRef.current;
    const wrap = wrapRef.current;
    const bg = bgRef.current;
    if (!cv || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(canvasW * dpr);
    const h = Math.round(canvasH * dpr);
    if (cv.width !== w) cv.width = w;
    if (cv.height !== h) cv.height = h;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (bg) ctx.drawImage(bg, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!lit || lit.rows.length === 0) return;
    const vars: Record<string, string> = {};
    for (const g of groups.list) vars[`g${g.code}`] = g.color;
    vars.fallback = GROUP_FALLBACK.color;
    const C = resolveColors(wrap, vars);
    const size = 3.2;
    const halo = 5.2;
    for (let k = 0; k < lit.rows.length; k++) {
      const i = lit.rows[k];
      const a = lit.alphas[k];
      const color = C[`g${atlas.group[i]}`] ?? C.fallback;
      const x = view.px(i);
      const y = view.py(i);
      ctx.fillStyle = color;
      ctx.globalAlpha = a * 0.22;
      ctx.fillRect(x - halo / 2, y - halo / 2, halo, halo);
      ctx.globalAlpha = a;
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }, [lit, view, canvasW, canvasH, bgVersion, atlas, groups]);

  const sc = atlas.sidecar;

  return (
    <div ref={wrapRef} className="w-full">
      <div className="flex flex-wrap items-center gap-3 mb-3 small">
        <span className="label">projection</span>
        <div className="segmented" role="tablist" aria-label="projection">
          {(Object.keys(PROJECTION_AXES) as Projection[]).map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={projection === p}
              className="segmented__option"
              data-text={PROJECTION_LABEL[p]}
              onClick={() => setProjection(p)}
            >
              {PROJECTION_LABEL[p]}
            </button>
          ))}
        </div>
      </div>
      <canvas ref={canvasRef} style={{ width: canvasW, height: canvasH }} className="block mx-auto border border-rule" />
      <div className="legend mt-3">
        {groups.list.map((g) => (
          <span key={g.code}>
            <i className="swatch" style={{ background: g.color }} /> {g.label} ({fmtInt(g.inMap)})
          </span>
        ))}
        {groups.unknown.length > 0 && (
          <span className="tone-failed">
            <i className="swatch" style={{ background: GROUP_FALLBACK.color }} /> group codes {groups.unknown.join(', ')} not listed in the sidecar's groups[] (
            {fmtInt(groups.unknownTotal)} neurons)
          </span>
        )}
      </div>
      <div className="legend mt-1">
        {activity && lit ? (
          <>
            <span>
              <strong>{fmtInt(lit.nNeurons)}</strong> neurons spiking in the last {fmtInt(decayMs)} ms
              {timeMs !== null && <> at t = {fmtNum(timeMs / 1000, 2)} s</>} · {fmtInt(lit.spikes)} spikes in that window
            </span>
            {lit.oob > 0 && (
              <span className="tone-failed">
                {fmtInt(lit.oob)} spikes reference an atlas_row outside the {fmtInt(atlas.n)} rows of neuron_atlas.bin and are not drawn
              </span>
            )}
          </>
        ) : (
          <span>no activity file loaded: populations only, nothing is lit</span>
        )}
        <span>
          {fmtInt(sc.n_neurons_in_map)} somata in the map of {fmtInt(sc.n_neurons_simulated)} neurons simulated
          {atlas.n !== sc.n_neurons_in_map && (
            <span className="tone-failed"> · the binary holds {fmtInt(atlas.n)} rows, not the {fmtInt(sc.n_neurons_in_map)} the sidecar states</span>
          )}
        </span>
      </div>
    </div>
  );
}

/**
 * The caption that must accompany the map. Every number in it is read from the sidecar, and the
 * note about somata outside the volume is the sidecar's own sentence.
 */
export function AtlasCaption({ atlas, activity }: { atlas: AtlasData; activity?: ActivityData | null }) {
  const sc = atlas.sidecar;
  const noSoma = Object.entries(sc.n_without_soma_position_by_group ?? {})
    .filter(([, v]) => (v ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  const emptyGroups = (sc.groups ?? []).filter((g) => (sc.group_counts?.[g.label] ?? 0) === 0).map((g) => g.label);
  return (
    <>
      Each dot is one neuron's <em>soma position</em> — the cell body, not the neurites: this is not a morphology rendering, and a
      neuron's arbours may be far from its dot. Positions are {sc.source}, dequantised with the sidecar's own bounds ({fmtNum(atlas.lo[0], 1)}–
      {fmtNum(atlas.hi[0], 1)} µm in x, {fmtNum(atlas.lo[1], 1)}–{fmtNum(atlas.hi[1], 1)} µm in y, {fmtNum(atlas.lo[2], 1)}–{fmtNum(atlas.hi[2], 1)} µm in z);{' '}
      {sc.axes?.note}.{' '}
      {sc.subsampled ? (
        <>
          The map is <em>subsampled</em>: it shows {fmtInt(sc.n_neurons_in_map)} of the {fmtInt(sc.n_neurons_simulated)} neurons simulated.
        </>
      ) : (
        <>It shows all {fmtInt(sc.n_neurons_in_map)} neurons that have a soma position, of {fmtInt(sc.n_neurons_simulated)} simulated.</>
      )}{' '}
      {fmtInt(sc.n_without_soma_position)} simulated neurons have no soma position in the volume and are absent from the map although they are
      still simulated
      {noSoma.length > 0 && <> ({noSoma.map(([k, v]) => `${k} ${fmtInt(v)}`).join(', ')})</>}. {sc.soma_outside_brain_note}
      {emptyGroups.length > 0 && (
        <>
          {' '}
          The groups {emptyGroups.join(', ')} have a count of 0 in this export, so they appear in the legend with no dots on the map.
        </>
      )}
      {activity && (
        <>
          {' '}
          Activity: {fmtInt(activity.sidecar.n_spikes_exported)} of {fmtInt(activity.sidecar.n_spikes_total)} spikes over{' '}
          {fmtNum(activity.sidecar.duration_s, 2)} s.
          {activity.sidecar.downsampled && (
            <span>
              {' '}
              The spikes are <em>downsampled</em>: the map shows a sample of them, not all of them. {activity.sidecar.downsample_note}
            </span>
          )}
          {activity.sortedOnLoad && <span> (the activity file was not time-sorted and was sorted on load)</span>}
        </>
      )}
    </>
  );
}
