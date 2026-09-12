import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { checkAtlasIdentity, loadActivity, loadAtlas, type ActivityData, type AtlasData, type BinLoad } from '../lib/binary';
import { CHART_FONT, SERIES, resolveColors, useThemeVersion } from '../lib/colors';
import { fmtInt, fmtNum, fmtPct } from '../lib/format';
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
/** The three projections in a fixed order, and their one-word names for the narrow rail control. */
export const PROJECTIONS: Projection[] = ['frontal', 'dorsal', 'sagittal'];
export const PROJECTION_SHORT: Record<Projection, string> = { frontal: 'frontal', dorsal: 'dorsal', sagittal: 'sagittal' };
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

/**
 * Ink curve for the background layer. The raw `dim` values above are a painting order as much as an
 * opacity, and applied literally they leave the map almost blank: two thirds of the atlas rows are
 * optic lobe at 0.05. A gamma lifts the faint groups into view while keeping their order, so the
 * named populations still read through the background instead of being flattened into it.
 */
const dimCurve = (dim: number, gamma: number) => Math.min(1, Math.pow(dim, gamma));

const PAD = 10;
const BOTTOM = 26;
const FONT_SM = `10.5px ${CHART_FONT}`;
const FONT_XS = `9.5px ${CHART_FONT}`;
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

function BrainMapInner({
  atlas,
  activity = null,
  timeMs = null,
  decayMs = 150,
  height = 420,
  projection: projectionProp,
  onProjectionChange,
  variant = 'figure',
  background = 'mat',
  showProjectionControl = true,
  showLegend = true,
  showStatus = true,
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
  /** 'panel' is the compact instrument in the right-hand rail: smaller type, denser ink */
  variant?: 'figure' | 'panel';
  /** 'mat' paints the white figure mat behind the points, 'page' paints the page background */
  background?: 'mat' | 'page';
  showProjectionControl?: boolean;
  showLegend?: boolean;
  showStatus?: boolean;
}) {
  // The rail panel is small and sits on the page background rather than the white mat, so its
  // background layer is drawn with more ink; the figure variant keeps the quieter curve.
  const gamma = variant === 'panel' ? 0.5 : 0.62;

  const [projInner, setProjInner] = useState<Projection>('frontal');
  const projection = projectionProp ?? projInner;
  const setProjection = (p: Projection) => (onProjectionChange ? onProjectionChange(p) : setProjInner(p));

  // The wrapper is state, not a ref, so the colour resolution below can depend on it existing.
  const [wrap, setWrap] = useState<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgRef = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(600);
  const themeVersion = useThemeVersion();

  // Width changes are coalesced to one per frame: dragging a window edge otherwise rebuilds the
  // whole background layer once per pixel.
  useEffect(() => {
    if (!wrap) return;
    let raf = 0;
    let pending = 0;
    const ro = new ResizeObserver((entries) => {
      pending = Math.max(240, Math.floor(entries[0].contentRect.width));
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setWidth((w) => (w === pending ? w : pending));
      });
    });
    ro.observe(wrap);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [wrap]);

  /**
   * Group codes actually present, in painting order, with the label the sidecar gives each code, and
   * the rows of each group gathered once. Drawing then touches each row once per repaint instead of
   * scanning all n rows per group. Counts come from the binary; the sidecar's own figure is kept
   * beside them so the legend can report a disagreement rather than quietly preferring one.
   */
  const groups = useMemo(() => {
    const gc = atlas.sidecar.group_counts;
    const counts = new Map<number, number>();
    for (let i = 0; i < atlas.n; i++) counts.set(atlas.group[i], (counts.get(atlas.group[i]) ?? 0) + 1);
    const list = (atlas.sidecar.groups ?? []).map((g) => ({
      code: g.code,
      label: g.label,
      /** neurons of this group in the map, counted from the binary itself */
      inMap: counts.get(g.code) ?? 0,
      /** what the sidecar says it wrote for this group; null when the sidecar states nothing */
      sidecarCount: gc && Object.prototype.hasOwnProperty.call(gc, g.label) ? gc[g.label] : null,
      ...styleFor(g.label),
    }));
    // codes present in the binary but absent from groups[] are reported, never silently dropped
    const known = new Set(list.map((g) => g.code));
    const unknown = [...counts.keys()].filter((c) => !known.has(c)).sort((a, b) => a - b);
    const unknownSet = new Set(unknown);
    // one pass over the binary fills every group's row list (and the unknown-code list)
    const rows = new Map<number, Uint32Array>();
    const fill = new Map<number, number>();
    for (const g of list) rows.set(g.code, new Uint32Array(g.inMap));
    const unknownTotal = unknown.reduce((sum, c) => sum + (counts.get(c) ?? 0), 0);
    const unknownRows = new Uint32Array(unknownTotal);
    let uk = 0;
    for (let i = 0; i < atlas.n; i++) {
      const code = atlas.group[i];
      const arr = rows.get(code);
      if (arr) {
        const k = fill.get(code) ?? 0;
        arr[k] = i;
        fill.set(code, k + 1);
      } else if (unknownSet.has(code)) unknownRows[uk++] = i;
    }
    return { list, byPaint: [...list].sort((a, b) => a.z - b.z), unknown, unknownTotal, rows, unknownRows };
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

  /**
   * The palette as literal canvas colours. Resolving one `var()` costs a DOM insertion and a forced
   * style recalculation, so it happens once per theme / group / background change, never per frame.
   */
  const C = useMemo(() => {
    if (!wrap) return null;
    const vars: Record<string, string> = {
      bg: background === 'page' ? 'var(--color-bg)' : SERIES.mat,
      axis: SERIES.axis,
      fallback: GROUP_FALLBACK.color,
    };
    for (const g of groups.list) vars[`g${g.code}`] = g.color;
    return resolveColors(wrap, vars);
    // themeVersion is the signal that the same var() now resolves to a different colour
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrap, groups, background, themeVersion]);

  // Background layer: all atlas neurons, dim, drawn once per size / projection / theme.
  useEffect(() => {
    if (!C) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(canvasW * dpr);
    const h = Math.round(canvasH * dpr);
    // the offscreen canvas is reused: a theme or projection change at an unchanged size only repaints
    const off = bgRef.current ?? document.createElement('canvas');
    if (off.width !== w) off.width = w;
    if (off.height !== h) off.height = h;
    const ctx = off.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, canvasW, canvasH);
    const size = variant === 'panel' ? 1.5 : 1.4;
    // each group draws only its own rows (gathered once in the groups memo), so a repaint is one
    // pass over the atlas in total rather than one pass per group
    for (const g of groups.byPaint) {
      const rows = groups.rows.get(g.code);
      if (!rows || rows.length === 0) continue;
      ctx.fillStyle = C[`g${g.code}`] ?? C.fallback;
      ctx.globalAlpha = dimCurve(g.dim, gamma);
      for (let k = 0; k < rows.length; k++) {
        const i = rows[k];
        ctx.fillRect(view.px(i) - size / 2, view.py(i) - size / 2, size, size);
      }
    }
    if (groups.unknownRows.length > 0) {
      ctx.fillStyle = C.fallback;
      ctx.globalAlpha = dimCurve(GROUP_FALLBACK.dim, gamma);
      for (let k = 0; k < groups.unknownRows.length; k++) {
        const i = groups.unknownRows[k];
        ctx.fillRect(view.px(i) - size / 2, view.py(i) - size / 2, size, size);
      }
    }
    ctx.globalAlpha = 1;

    // Axis note and a scale bar, both in the sidecar's own micrometres.
    ctx.fillStyle = C.axis;
    ctx.font = variant === 'panel' ? FONT_XS : FONT_SM;
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
    // No version bump: this effect is declared before the foreground one, so within the same commit
    // the foreground blits the background this pass has just written.
  }, [groups, view, canvasW, canvasH, C, variant, gamma]);

  // Foreground: blit the background, then draw only the lit neurons.
  useEffect(() => {
    const cv = canvasRef.current;
    const bg = bgRef.current;
    if (!cv || !C) return;
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
    const size = variant === 'panel' ? 3.6 : 3.2;
    const halo = variant === 'panel' ? 6.4 : 5.2;
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
  }, [lit, view, canvasW, canvasH, atlas, C, variant]);

  const sc = atlas.sidecar;
  /**
   * What ties this activity file to this atlas, if anything: `atlas_row` values exported against a
   * different atlas are all in range and all land on real somata, so only the exporter's stamp can
   * tell a current pairing from a stale one. A mismatch is the caller's to refuse; an unstamped file
   * is reported here, because it cannot be checked either way.
   */
  const identity = useMemo(() => (activity ? checkAtlasIdentity(activity.sidecar, atlas) : null), [activity, atlas]);
  /** the fraction of its spikes the activity file actually carries, when it carries a sample */
  const sampleFrac =
    activity && activity.sidecar.downsampled && activity.sidecar.n_spikes_total > 0
      ? activity.sidecar.n_spikes_exported / activity.sidecar.n_spikes_total
      : null;
  const rowsDisagree = atlas.n !== sc.n_neurons_in_map;

  return (
    <div ref={setWrap} className="w-full">
      {showProjectionControl && (
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
      )}
      <canvas ref={canvasRef} style={{ width: canvasW, height: canvasH }} className="block mx-auto border border-rule" />
      {showLegend && (
      <div className={variant === 'panel' ? 'legend legend--tight mt-2' : 'legend mt-3'}>
        {groups.list.map((g) => (
          <span key={g.code}>
            <i className="swatch" style={{ background: g.color }} /> {g.label} ({fmtInt(g.inMap)})
            {/* the count is the binary's own; when the sidecar states a different one, both are shown */}
            {g.sidecarCount !== null && g.sidecarCount !== g.inMap && (
              <span className="tone-failed"> · neuron_atlas.json says {fmtInt(g.sidecarCount)}</span>
            )}
          </span>
        ))}
        {groups.unknown.length > 0 && (
          <span className="tone-failed">
            <i className="swatch" style={{ background: GROUP_FALLBACK.color }} /> group codes {groups.unknown.join(', ')} not listed in the sidecar's groups[] (
            {fmtInt(groups.unknownTotal)} neurons)
          </span>
        )}
      </div>
      )}
      {showStatus && (
      <div className={variant === 'panel' ? 'legend legend--tight mt-1' : 'legend mt-1'}>
        {activity && lit ? (
          <>
            <span>
              <strong>{fmtInt(lit.nNeurons)}</strong> neurons spiking in the last {fmtInt(decayMs)} ms
              {timeMs !== null && <> at t = {fmtNum(timeMs / 1000, 2)} s</>} · {fmtInt(lit.spikes)} spikes in that window
              {/* both counts are counts of what the file holds; when it holds a sample, they are sample counts */}
              {sampleFrac !== null && (
                <>
                  {' '}
                  — counted in the {fmtPct(sampleFrac)} of the spikes this file carries ({fmtInt(activity.sidecar.n_spikes_exported)} of{' '}
                  {fmtInt(activity.sidecar.n_spikes_total)}), so the true numbers are higher
                </>
              )}
            </span>
            {identity && identity.state === 'unverified' && (
              <span className="tone-failed">activity not verified against this atlas: {identity.message}</span>
            )}
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
          {fmtInt(rowsDisagree ? atlas.n : sc.n_neurons_in_map)} somata in the map of {fmtInt(sc.n_neurons_simulated)} neurons simulated
          {rowsDisagree && (
            <span className="tone-failed"> · the binary holds {fmtInt(atlas.n)} rows, not the {fmtInt(sc.n_neurons_in_map)} the sidecar states</span>
          )}
        </span>
      </div>
      )}
    </div>
  );
}

/**
 * Memoised: the Replay page's play loop re-renders the page ~60 times a second, and the map's own
 * work (the lit-neuron pass and the canvas blit) should run only when its own props change.
 */
const BrainMap = memo(BrainMapInner);
export default BrainMap;

/**
 * The caption that must accompany the map. Every number in it is read from the sidecar, and the
 * note about somata outside the volume is the sidecar's own sentence.
 */
export function AtlasCaption({ atlas, activity }: { atlas: AtlasData; activity?: ActivityData | null }) {
  const sc = atlas.sidecar;
  const noSoma = Object.entries(sc.n_without_soma_position_by_group ?? {})
    .filter(([, v]) => (v ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  const gc = sc.group_counts;
  const listed = sc.groups ?? [];
  // A group the sidecar states as 0 is a fact about the export. A group the sidecar says NOTHING
  // about is not a zero, and is never written up as one.
  const emptyGroups = gc ? listed.filter((g) => gc[g.label] === 0).map((g) => g.label) : [];
  const uncounted = listed.filter((g) => !gc || !Object.prototype.hasOwnProperty.call(gc, g.label)).map((g) => g.label);
  // the count the map is actually drawn from is the binary's row count
  const rowsDisagree = atlas.n !== sc.n_neurons_in_map;
  return (
    <>
      Each dot is one neuron's <em>soma position</em> — the cell body, not the neurites: this is not a morphology rendering, and a
      neuron's arbours may be far from its dot. Positions are {sc.source}, dequantised with the sidecar's own bounds ({fmtNum(atlas.lo[0], 1)}–
      {fmtNum(atlas.hi[0], 1)} µm in x, {fmtNum(atlas.lo[1], 1)}–{fmtNum(atlas.hi[1], 1)} µm in y, {fmtNum(atlas.lo[2], 1)}–{fmtNum(atlas.hi[2], 1)} µm in z);{' '}
      {sc.axes?.note}.{' '}
      {sc.subsampled ? (
        <>
          The map is <em>subsampled</em>: it shows {fmtInt(atlas.n)} of the {fmtInt(sc.n_neurons_simulated)} neurons simulated.
        </>
      ) : (
        <>It shows all {fmtInt(atlas.n)} neurons that have a soma position, of {fmtInt(sc.n_neurons_simulated)} simulated.</>
      )}{' '}
      {rowsDisagree && (
        <span className="tone-failed">
          That count is the {fmtInt(atlas.n)} rows neuron_atlas.bin actually holds; the sidecar states {fmtInt(sc.n_neurons_in_map)}, which does
          not match, so one of the two files is stale.{' '}
        </span>
      )}
      {fmtInt(sc.n_without_soma_position)} simulated neurons have no soma position in the volume and are absent from the map although they are
      still simulated
      {noSoma.length > 0 && <> ({noSoma.map(([k, v]) => `${k} ${fmtInt(v)}`).join(', ')})</>}. {sc.soma_outside_brain_note}
      {emptyGroups.length > 0 && (
        <>
          {' '}
          The groups {emptyGroups.join(', ')} have a count of 0 in this export, so they appear in the legend with no dots on the map.
        </>
      )}
      {uncounted.length > 0 && (
        <span className="tone-failed">
          {' '}
          neuron_atlas.json states no group_counts for {uncounted.join(', ')}: the counts in the legend are counted from neuron_atlas.bin and
          nothing in the sidecar corroborates them. This is an absent number, not a zero.
        </span>
      )}
      {activity && (
        <>
          {' '}
          Activity: {fmtInt(activity.sidecar.n_spikes_exported)} of {fmtInt(activity.sidecar.n_spikes_total)} spikes over{' '}
          {fmtNum(activity.sidecar.duration_s, 2)} s, indexing{' '}
          {typeof activity.sidecar.atlas_fingerprint === 'string' || typeof activity.sidecar.n_atlas_rows === 'number' ? (
            <>
              the atlas it names ({typeof activity.sidecar.n_atlas_rows === 'number' ? `${fmtInt(activity.sidecar.n_atlas_rows)} rows` : 'no row count'},{' '}
              {activity.sidecar.atlas_fingerprint ?? 'no fingerprint'})
            </>
          ) : (
            <span className="tone-failed">an atlas it does not name, so the pairing cannot be checked</span>
          )}
          .
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
