import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { checkAtlasIdentity, loadActivity, loadAtlas, type ActivityData, type AtlasData, type BinLoad, type Loadable } from '../lib/binary';
import { CHART_FONT, resolveColors, useThemeVersion } from '../lib/colors';
import { useCanvasPixelRatio } from '../lib/media';
import { fmtInt, fmtNum, fmtPct } from '../lib/format';
import type { AtlasViewBox, Manifest, Provenance } from '../types';

/**
 * A canvas map of the simulated neurons at their soma positions, which lights up the neurons that
 * spike inside the current scrub window.
 *
 * Everything drawn comes from `neuron_atlas.json` + `neuron_atlas.bin` (positions, groups, counts,
 * framing boxes) and, when the map is animated, from one `replay/activity_<cond>_seed<k>.json` +
 * `.bin`. No count, label or position is written into this file; when a file is absent the caller
 * renders the explicit "not yet run" panel instead of a map.
 *
 * Framing, colours, radii, alphas and draw order follow web/MAP_SPEC.md exactly.
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
 * Group presentation, verbatim from MAP_SPEC.md. `r` is the point radius in CSS pixels at a canvas
 * width of REF_W and is scaled linearly with the canvas width (no floor: on a phone the points get
 * genuinely smaller rather than merging into a single mush). `order` is the painting order, low
 * first, so the 32 dFB cells land on top of the 90,805 optic-lobe cells rather than under them.
 * `rLight` overrides the radius in the light theme where the spec gives a second figure.
 */
interface GroupSpec {
  dark: string;
  light: string;
  r: number;
  rLight?: number;
  alpha: number;
  order: number;
}
const GROUP_SPEC: Record<string, GroupSpec> = {
  optic: { dark: '#38342e', light: '#d6d2c8', r: 0.32, alpha: 0.55, order: 1 },
  other: { dark: '#413e38', light: '#cdc9bf', r: 0.4, alpha: 0.55, order: 2 },
  ALPN: { dark: '#a49d90', light: '#6f695e', r: 0.8, alpha: 0.95, order: 3 },
  CX: { dark: '#8fb3d4', light: '#2f5575', r: 0.8, alpha: 0.95, order: 4 },
  ORN: { dark: '#a49d90', light: '#6f695e', r: 0.8, alpha: 0.95, order: 5 },
  KC: { dark: '#e8e6df', light: '#3a3632', r: 1.2, rLight: 0.85, alpha: 0.95, order: 6 },
  DAN: { dark: '#8fbf88', light: '#4f7a4a', r: 1.9, alpha: 1.0, order: 7 },
  MBON: { dark: '#d98b82', light: '#9a3f35', r: 2.6, alpha: 1.0, order: 8 },
  dFB: { dark: '#e0b96a', light: '#b07d15', r: 3.3, alpha: 1.0, order: 9 },
};
/** A group code the sidecar lists with a label the spec does not cover, and unlisted codes. */
const GROUP_FALLBACK: GroupSpec = { dark: '#413e38', light: '#cdc9bf', r: 0.4, alpha: 0.55, order: 2.5 };
const specFor = (label: string): GroupSpec => GROUP_SPEC[label] ?? GROUP_FALLBACK;
const specColor = (s: GroupSpec, dark: boolean) => (dark ? s.dark : s.light);
const specRadius = (s: GroupSpec, dark: boolean) => (dark ? s.r : s.rLight ?? s.r);

/** The accent a spiking neuron is drawn in (`--color-link`), per MAP_SPEC.md. */
const ACCENT = { dark: '#8fb3d4', light: '#2f5575' };
/** Point radii are quoted at this canvas width and scale linearly with it. */
const REF_W = 400;
/** Fraction of the view box padded onto each side, so an edge soma is not clipped by the frame. */
const BOX_PAD = 0.015;
/**
 * A spiking neuron is drawn at this multiple of its group radius, decaying back to 1x.
 *
 * There is no floor under it. A floor was here, and it lied: at the rail's scale an optic-lobe
 * point is 0.27px and the spec's lit radius is 0.60px, but a 1.15px floor drew it at 2.53px - four
 * times the radius, eight times the area - and optic is 90,805 of the 124,289 somata in the brain
 * view, so the animation systematically exaggerated how much of the brain was firing.
 */
const LIT_GAIN = 2.2;
const TAU = Math.PI * 2;

/** Height reserved under the plot for the axis note and the scale bar. */
const BOTTOM = 24;
const FONT_SM = `10.5px ${CHART_FONT}`;
const FONT_XS = `9.5px ${CHART_FONT}`;
/** Time bucket for the spike index; a scrub window is then a range of buckets, not a rescan. */
const BIN_MS = 16;

/** Perceived lightness of a resolved `rgb(...)` string, used only to pick the spec's dark or light column. */
function isDarkColor(css: string): boolean {
  const m = css.match(/-?[\d.]+/g);
  if (!m || m.length < 3) return false;
  const [r, g, b] = m.slice(0, 3).map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
}

/** Linear blend of two `rgb(...)`/hex colours, used for the spike tail. */
function parseRgb(css: string): [number, number, number] {
  if (css.startsWith('#')) {
    const h = css.slice(1);
    const n = h.length === 3 ? h.split('').map((c) => parseInt(c + c, 16)) : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    return [n[0], n[1], n[2]];
  }
  const m = css.match(/-?[\d.]+/g);
  if (!m || m.length < 3) return [128, 128, 128];
  return [Number(m[0]), Number(m[1]), Number(m[2])];
}

// ---------------------------------------------------------------- loading hooks

export type { Loadable };

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

/** A provenance object plus whatever the footer has to say about where its fields came from. */
export interface FigureProvenance {
  provenance: Provenance;
  /** shown in place of the commit when no file states one */
  commitNote?: ReactNode;
  /** a further clause about the block itself */
  note?: ReactNode;
}

const ATLAS_WEB_FILES = ['web/public/data/neuron_atlas.json', 'web/public/data/neuron_atlas.bin'];

/**
 * Provenance for a figure drawn from the atlas.
 *
 * `neuron_atlas.json` carries its own `provenance` block, and that block is what is shown: the
 * config it was actually written from, its results directory, and the upstream annotation file the
 * soma positions came from - which nothing else on the page names. The two web copies (and any
 * activity file the figure also draws) are appended, because they are what the browser read.
 *
 * The block states no commit and no time, so neither is invented: the footer says so and names the
 * commit the *site* was built at as a separate, clearly-labelled fact. An atlas exported before the
 * block existed falls back to the manifest's `base_config` and says that too, rather than letting a
 * config the atlas never named read as one it did.
 */
export function atlasProvenance(atlas: AtlasData | null, m: Manifest | null, extraFiles: string[] = []): FigureProvenance {
  const p = atlas?.sidecar.provenance;
  const siteCommit = m?.git_commit;
  const files = [...ATLAS_WEB_FILES, ...extraFiles];
  if (!p) {
    return {
      provenance: {
        config: m?.model?.base_config ?? 'null',
        files,
        git_commit: siteCommit ?? '',
        generated_at: m?.generated_at,
      },
      note: (
        <span className="tone-failed">
          neuron_atlas.json states no provenance block: the config above is the manifest's model.base_config, not one the atlas names
        </span>
      ),
    };
  }
  return {
    provenance: {
      config: p.config ?? 'null',
      config_hash: p.config_hash,
      results_dir: p.results_dir,
      files: [...(p.files ?? []), ...files],
      git_commit: p.git_commit ?? '',
      generated_at: p.generated_at,
    },
    commitNote: p.git_commit ? undefined : (
      <>commit not stated by neuron_atlas.json{siteCommit ? <> (this site was built at {siteCommit})</> : null}</>
    ),
    note: p.written_by ? (
      <>
        written by <span className="mono">{p.written_by}</span>
      </>
    ) : undefined,
  };
}

// ---------------------------------------------------------------- the map

/** A framing box the map can be fitted to, and where the sidecar states it came from. */
type Frame = { lo: [number, number, number]; hi: [number, number, number]; from: 'view_box' | 'quantisation'; box: AtlasViewBox | null };

function frameFor(atlas: AtlasData, key: 'brain' | 'all'): Frame {
  const box = atlas.sidecar.view_boxes?.[key] ?? null;
  const ok = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
  if (box && ok(box.lo_um) && ok(box.hi_um)) return { lo: box.lo_um, hi: box.hi_um, from: 'view_box', box };
  // No view_boxes in this export: the quantisation bounds are the only framing the file states.
  return { lo: atlas.lo, hi: atlas.hi, from: 'quantisation', box: null };
}

/**
 * What the map is showing.
 *
 * It is a required prop, and it is plain text rather than a node, because it is the canvas's
 * `aria-label` as well as the words the panel prints above and below the picture. It is NOT drawn
 * into the bitmap: MAP_SPEC.md:54-57 keeps the canvas to the scale bar and the axis note, and a
 * caption burned into the image washed out the small populations the draw order exists to protect.
 * `reference` marks the case the contract cares about most - a real reference simulation standing
 * in for a result that does not exist yet - and the panel renders that line in the failed tone.
 */
export interface MapSourceLabel {
  text: string;
  reference?: boolean;
}

function BrainMapInner({
  atlas,
  activity = null,
  source,
  timeMs = null,
  decayMs = 150,
  loopMs,
  height = 480,
  projection: projectionProp,
  onProjectionChange,
  showVnc: showVncProp,
  onShowVncChange,
  variant = 'figure',
  background = 'page',
  showProjectionControl = true,
  showVncControl = true,
  showLegend = true,
  showStatus = true,
}: {
  atlas: AtlasData;
  /** spikes to light up; null renders the populations only (no activity) */
  activity?: ActivityData | null;
  /** required: what this map is showing; carried to a screen reader as the canvas's aria-label */
  source: MapSourceLabel;
  /** current scrub time in milliseconds; null means no activity is shown */
  timeMs?: number | null;
  /** a spike stays lit for this long, fading out */
  decayMs?: number;
  /**
   * Length of the loop when the caller is playing this file on repeat. The decay window then wraps
   * across the seam instead of being truncated at 0, so the lit set does not collapse to the first
   * frame's worth of spikes and rebuild over the next `decayMs`. Omit it (the Replay page does) when
   * the timeline runs once and 0 really is the beginning.
   */
  loopMs?: number;
  /** the tallest the plot area may be; the canvas takes the projection's aspect within it */
  height?: number;
  projection?: Projection;
  onProjectionChange?: (p: Projection) => void;
  /** frame on `view_boxes.all` (somata in the ventral nerve cord included) rather than `.brain` */
  showVnc?: boolean;
  onShowVncChange?: (v: boolean) => void;
  /** 'panel' is the compact instrument in the right-hand rail: smaller type */
  variant?: 'figure' | 'panel';
  /** 'mat' paints the white figure mat behind the points, 'page' paints the page background */
  background?: 'mat' | 'page';
  showProjectionControl?: boolean;
  showVncControl?: boolean;
  showLegend?: boolean;
  showStatus?: boolean;
}) {
  const [projInner, setProjInner] = useState<Projection>('frontal');
  const projection = projectionProp ?? projInner;
  const setProjection = (p: Projection) => (onProjectionChange ? onProjectionChange(p) : setProjInner(p));

  const [vncInner, setVncInner] = useState(false);
  const showVnc = showVncProp ?? vncInner;
  const setShowVnc = (v: boolean) => (onShowVncChange ? onShowVncChange(v) : setVncInner(v));

  // The wrapper is state, not a ref, so the colour resolution below can depend on it existing.
  const [wrap, setWrap] = useState<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgRef = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(400);
  const themeVersion = useThemeVersion();
  const dpr = useDevicePixelRatio();

  // Width changes are coalesced to one per frame: dragging a window edge otherwise rebuilds the
  // whole background layer once per pixel.
  useEffect(() => {
    if (!wrap) return;
    let raf = 0;
    let pending = 0;
    const ro = new ResizeObserver((entries) => {
      pending = Math.max(200, Math.floor(entries[0].contentRect.width));
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

  /** The box the map is framed on: the brain by default, everything when the VNC toggle is on. */
  const frame = useMemo(() => frameFor(atlas, showVnc ? 'all' : 'brain'), [atlas, showVnc]);
  const brainFrame = useMemo(() => frameFor(atlas, 'brain'), [atlas]);
  /** true when this export actually carries the boxes; false means the map is framed on the quantisation bounds. */
  const hasBoxes = brainFrame.from === 'view_box';

  /**
   * Rows inside the current frame, gathered per group in the spec's painting order. Drawing then
   * touches each row once per repaint instead of scanning all n rows per group, and a neuron
   * outside the box is neither drawn nor counted in the legend.
   */
  const groups = useMemo(() => {
    const inBox = new Uint8Array(atlas.n);
    // The box edges are the sidecar's own micrometres, computed from the exact positions; what is in
    // the binary is those positions quantised to uint16, so a soma sitting exactly on an edge can
    // dequantise up to half a quantisation step past it. Half a step is therefore the tolerance: it
    // is the precision the file actually carries, and without it the boundary soma of a group is
    // dropped and the legend disagrees with the sidecar by one.
    const q = atlas.sidecar.quantisation;
    const eps = (i: 0 | 1 | 2) => 0.5 * ((q.hi_um[i] - q.lo_um[i]) / q.scale) + 1e-6;
    const [ex, ey, ez] = [eps(0), eps(1), eps(2)];
    const [lx, ly, lz] = [frame.lo[0] - ex, frame.lo[1] - ey, frame.lo[2] - ez];
    const [hx, hy, hz] = [frame.hi[0] + ex, frame.hi[1] + ey, frame.hi[2] + ez];
    let outside = 0;
    for (let i = 0; i < atlas.n; i++) {
      const ok = atlas.xUm[i] >= lx && atlas.xUm[i] <= hx && atlas.yUm[i] >= ly && atlas.yUm[i] <= hy && atlas.zUm[i] >= lz && atlas.zUm[i] <= hz;
      if (ok) inBox[i] = 1;
      else outside++;
    }
    const counts = new Map<number, number>();
    for (let i = 0; i < atlas.n; i++) if (inBox[i]) counts.set(atlas.group[i], (counts.get(atlas.group[i]) ?? 0) + 1);

    const sc = atlas.sidecar;
    // Which of the sidecar's own count blocks corroborates the legend depends on the frame in view.
    const stated = showVnc ? sc.group_counts : sc.group_counts_in_brain_view ?? (hasBoxes ? undefined : sc.group_counts);
    const list = (sc.groups ?? []).map((g) => ({
      code: g.code,
      label: g.label,
      spec: specFor(g.label),
      /** neurons of this group inside the current frame, counted from the binary itself */
      inView: counts.get(g.code) ?? 0,
      /** what the sidecar states for this group in this frame; null when it states nothing */
      sidecarCount: stated && Object.prototype.hasOwnProperty.call(stated, g.label) ? stated[g.label] : null,
    }));
    const known = new Set(list.map((g) => g.code));
    const unknown = [...counts.keys()].filter((c) => !known.has(c)).sort((a, b) => a - b);
    const unknownSet = new Set(unknown);

    const rows = new Map<number, Uint32Array>();
    const fill = new Map<number, number>();
    for (const g of list) rows.set(g.code, new Uint32Array(g.inView));
    const unknownTotal = unknown.reduce((sum, c) => sum + (counts.get(c) ?? 0), 0);
    const unknownRows = new Uint32Array(unknownTotal);
    let uk = 0;
    for (let i = 0; i < atlas.n; i++) {
      if (!inBox[i]) continue;
      const code = atlas.group[i];
      const arr = rows.get(code);
      if (arr) {
        const k = fill.get(code) ?? 0;
        arr[k] = i;
        fill.set(code, k + 1);
      } else if (unknownSet.has(code)) unknownRows[uk++] = i;
    }
    const inViewTotal = atlas.n - outside;
    return { list, byPaint: [...list].sort((a, b) => a.spec.order - b.spec.order), unknown, unknownTotal, rows, unknownRows, inBox, inViewTotal, outside };
  }, [atlas, frame, showVnc, hasBoxes]);

  /**
   * Projection and fit. The canvas takes the aspect of the selected projection of the framing box
   * (frontal ~1.87:1, dorsal ~2.68:1, sagittal ~0.70:1 for the brain box), so the brain fills the
   * frame in every projection instead of sitting in a fixed rectangle. One scale is applied to both
   * axes, the box is padded by 1.5% of its own extent on each side, and the vertical axis always
   * increases downward. `height` is the tallest the plot may be; beyond that the canvas narrows.
   */
  const view = useMemo(() => {
    const [ui, vi] = PROJECTION_AXES[projection];
    const uSpan = Math.max(1e-6, frame.hi[ui] - frame.lo[ui]);
    const vSpan = Math.max(1e-6, frame.hi[vi] - frame.lo[vi]);
    const uRange = uSpan * (1 + 2 * BOX_PAD);
    const vRange = vSpan * (1 + 2 * BOX_PAD);
    const uLo = frame.lo[ui] - uSpan * BOX_PAD;
    const vLo = frame.lo[vi] - vSpan * BOX_PAD;
    const aspect = uRange / vRange;
    const maxH = Math.max(120, height);
    let plotW = Math.max(160, width);
    let plotH = plotW / aspect;
    if (plotH > maxH) {
      plotH = maxH;
      plotW = maxH * aspect;
    }
    const scale = plotW / uRange;
    const cw = Math.round(plotW);
    const ch = Math.round(plotH + BOTTOM);
    const arr = (i: 0 | 1 | 2) => (i === 0 ? atlas.xUm : i === 1 ? atlas.yUm : atlas.zUm);
    const uArr = arr(ui);
    const vArr = arr(vi);
    return {
      ui,
      vi,
      cw,
      ch,
      plotH,
      aspect,
      px: (i: number) => (uArr[i] - uLo) * scale,
      py: (i: number) => (vArr[i] - vLo) * scale,
      scale,
      /** the spec's radii are quoted at REF_W and scale linearly with the canvas */
      rScale: plotW / REF_W,
    };
  }, [atlas, frame, projection, width, height]);
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

  /**
   * What ties this activity file to this atlas, if anything: `atlas_row` values exported against a
   * different atlas are all in range and all land on real somata, so no bounds check can tell a
   * current pairing from a stale one - only the identity the exporter stamps into both sidecars.
   * A mismatch lights nothing here, whatever the caller does with it; an unstamped file is drawn but
   * is reported as unverifiable.
   */
  const identity = useMemo(() => (activity ? checkAtlasIdentity(activity.sidecar, atlas) : null), [activity, atlas]);
  const staleActivity = identity?.state === 'mismatch';

  // Neurons lit in the current window, deduplicated, each at the alpha of its most recent spike.
  // The stamp array marks which neurons are already in the list for this frame, so the dedupe
  // costs one array write per spike instead of a set lookup.
  const stampRef = useRef<{ gen: Int32Array; pos: Int32Array; n: number; counter: number } | null>(null);
  const lit = useMemo(() => {
    if (!activity || !index || timeMs === null || !Number.isFinite(timeMs)) return null;
    if (staleActivity) return null; // the file indexes a different atlas: nothing here is lit
    if (!stampRef.current || stampRef.current.n !== atlas.n) {
      stampRef.current = { gen: new Int32Array(atlas.n), pos: new Int32Array(atlas.n), n: atlas.n, counter: 0 };
    }
    const stamp = stampRef.current;
    stamp.counter += 1;
    const generation = stamp.counter;
    const t1 = timeMs;
    const t0 = timeMs - decayMs;
    const rows: number[] = [];
    const alphas: number[] = [];
    let spikes = 0;
    let oob = 0;
    let offView = 0;
    const inBox = groups.inBox;

    /**
     * Every spike in [lo, hi], lit at the alpha its age gives it. `age` is how long ago the spike
     * fired *on the clock the viewer is watching*, which for the wrapped half of a looped window is
     * not `t1 - t`: those spikes are at the end of the file and the playhead has just passed 0.
     */
    const scan = (lo: number, hi: number, age: (t: number) => number) => {
      const b0 = Math.max(0, Math.floor(lo / BIN_MS));
      const b1 = Math.min(index.nBins - 1, Math.floor(hi / BIN_MS));
      if (b1 < b0) return;
      const from = index.starts[b0];
      const to = index.starts[b1 + 1];
      for (let k = from; k < to; k++) {
        const t = activity.tMs[k];
        if (t < lo || t > hi) continue;
        spikes++;
        const row = activity.atlasRow[k];
        if (row >= atlas.n) {
          oob++;
          continue;
        }
        // a spike on a soma outside the framed box is counted, but there is nowhere to draw it
        if (!inBox[row]) {
          offView++;
          continue;
        }
        const a = decayMs > 0 ? Math.max(0, 1 - age(t) / decayMs) : 1;
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
    };

    // The tail of the loop, when the playhead has wrapped and the window reaches back past 0. Without
    // this the window is truncated at 0 and the lit set collapses to whatever sits at the very start
    // of the file, then rebuilds over the next decayMs: a visible blink on every repeat.
    if (loopMs && loopMs > 0 && t0 < 0) scan(loopMs + t0, loopMs, (t) => t1 + loopMs - t);
    scan(Math.max(0, t0), t1, (t) => t1 - t);

    return { rows, alphas, spikes, oob, offView, nNeurons: rows.length };
  }, [activity, index, timeMs, decayMs, loopMs, atlas.n, staleActivity, groups]);

  /**
   * The palette as literal canvas colours. Only the background and the axis ink are tokens; the
   * group colours are the spec's own hexes, chosen by whether the background this canvas sits on
   * is dark or light (which the white figure mat forces to light in both themes).
   */
  const C = useMemo(() => {
    if (!wrap) return null;
    const resolved = resolveColors(wrap, { bg: background === 'page' ? 'var(--color-bg)' : SERIES.mat, axis: SERIES.axis });
    const dark = isDarkColor(resolved.bg);
    return {
      bg: resolved.bg,
      axis: resolved.axis,
      dark,
      accent: dark ? ACCENT.dark : ACCENT.light,
      // the stamp is picked by the canvas's own background, like every other colour here: the white
      // figure mat is light in both themes, so a token would be invisible on it in the dark theme
      ink: dark ? STAMP_INK.dark : STAMP_INK.light,
      failed: dark ? STAMP_FAILED.dark : STAMP_FAILED.light,
    };
    // themeVersion is the signal that the same var() now resolves to a different colour
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrap, background, themeVersion]);

  // Background layer: every neuron in the frame, drawn once per size / projection / frame / theme.
  useEffect(() => {
    if (!C) return;
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

    /** One group: sub-pixel points as rects (cheap, and an arc that small is invisible anyway). */
    const paint = (rows: Uint32Array, spec: GroupSpec) => {
      if (rows.length === 0) return;
      const r = specRadius(spec, C.dark) * view.rScale;
      ctx.fillStyle = specColor(spec, C.dark);
      ctx.globalAlpha = spec.alpha;
      if (r >= 1.1) {
        ctx.beginPath();
        for (let k = 0; k < rows.length; k++) {
          const i = rows[k];
          const x = view.px(i);
          const y = view.py(i);
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, TAU);
        }
        ctx.fill();
      } else {
        const d = 2 * r;
        for (let k = 0; k < rows.length; k++) {
          const i = rows[k];
          ctx.fillRect(view.px(i) - r, view.py(i) - r, d, d);
        }
      }
    };

    // the spec's draw order: the big background populations first, the small named ones last and
    // largest, so 32 dFB neurons are not lost among 90,805 optic-lobe cells
    let unknownDrawn = false;
    for (const g of groups.byPaint) {
      if (!unknownDrawn && g.spec.order > GROUP_FALLBACK.order) {
        paint(groups.unknownRows, GROUP_FALLBACK);
        unknownDrawn = true;
      }
      paint(groups.rows.get(g.code) ?? new Uint32Array(0), g.spec);
    }
    if (!unknownDrawn) paint(groups.unknownRows, GROUP_FALLBACK);
    ctx.globalAlpha = 1;

    // Axis note and a scale bar, both in the sidecar's own micrometres.
    ctx.fillStyle = C.axis;
    ctx.font = variant === 'panel' || canvasW < 340 ? FONT_XS : FONT_SM;
    ctx.textAlign = 'left';
    ctx.fillText(`horizontal: ${AXIS_KEY[view.ui]} · vertical: ${AXIS_KEY[view.vi]} (increasing downward)`, 0, canvasH - 8);
    const nice = [1000, 500, 200, 100, 50, 20].find((u) => u * view.scale < canvasW / 3);
    if (nice) {
      const barPx = nice * view.scale;
      const x1 = canvasW;
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
  }, [groups, view, canvasW, canvasH, C, variant, dpr]);

  // Foreground: blit the background, draw the lit neurons on top, then stamp the source identity so
  // it is part of the image and survives a crop of it.
  useEffect(() => {
    const cv = canvasRef.current;
    const bg = bgRef.current;
    if (!cv || !C) return;
    const w = Math.round(canvasW * dpr);
    const h = Math.round(canvasH * dpr);
    if (cv.width !== w) cv.width = w;
    if (cv.height !== h) cv.height = h;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    // The blit is in CSS pixels, not backing-store pixels: a background cached at a previous device
    // pixel ratio is then rescaled to fit rather than painting 60,000 points at the wrong scale.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvasW, canvasH);
    if (bg) ctx.drawImage(bg, 0, 0, canvasW, canvasH);
    if (lit && lit.rows.length > 0) {
      const [ar, ag, ab] = parseRgb(C.accent);
      // a is 1 at the instant of the spike and 0 at the end of the tail, so nothing stays lit
      for (let k = 0; k < lit.rows.length; k++) {
        const i = lit.rows[k];
        const a = lit.alphas[k];
        const spec = specFor(atlas.groupLabels[atlas.group[i]] ?? '');
        const [gr, gg, gb] = parseRgb(specColor(spec, C.dark));
        const base = Math.max(specRadius(spec, C.dark) * view.rScale, LIT_MIN_R);
        const r = base * (1 + (LIT_GAIN - 1) * a);
        ctx.fillStyle = `rgb(${Math.round(gr + (ar - gr) * a)}, ${Math.round(gg + (ag - gg) * a)}, ${Math.round(gb + (ab - gb) * a)})`;
        ctx.globalAlpha = spec.alpha + (1 - spec.alpha) * a;
        ctx.beginPath();
        ctx.arc(view.px(i), view.py(i), r, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    drawSourceStamp(ctx, source, C, canvasW);
  }, [lit, view, canvasW, canvasH, atlas, C, dpr, source]);

  const sc = atlas.sidecar;
  /** the fraction of its spikes the activity file actually carries, when it carries a sample */
  const sampleFrac =
    activity && activity.sidecar.downsampled && activity.sidecar.n_spikes_total > 0
      ? activity.sidecar.n_spikes_exported / activity.sidecar.n_spikes_total
      : null;
  const rowsDisagree = atlas.n !== sc.n_neurons_in_map;
  const legendClass = variant === 'panel' ? 'legend legend--tight mt-2' : 'legend mt-3';
  const statusClass = variant === 'panel' ? 'legend legend--tight mt-1' : 'legend mt-1';

  return (
    <div ref={setWrap} className="w-full">
      {(showProjectionControl || showVncControl) && (
        <div className="map-controls mb-3 small">
          {showProjectionControl && (
            <div className="map-controls__group">
              <span className="label">projection</span>
              <div className="segmented" role="tablist" aria-label="projection">
                {PROJECTIONS.map((p) => (
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
          {showVncControl && hasBoxes && <VncToggle atlas={atlas} on={showVnc} set={setShowVnc} />}
        </div>
      )}
      {/* The identity is drawn into the top-left of the canvas itself by the foreground effect, not
          printed under it: this map animates beside a verdict, and the text saying what it is must
          not be separated from the picture by a legend, a status line and a row of controls - nor
          lost when someone crops a screenshot to the picture. `aria-label` carries the same words to
          a screen reader, which cannot read pixels. */}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={source.text}
        style={{ width: canvasW, height: canvasH }}
        className="block mx-auto max-w-full"
      />
      {showLegend && (
        <div className={legendClass}>
          {groups.list.map((g) => (
            <span key={g.code}>
              <i className="swatch swatch--map" style={{ ['--sw-l' as string]: g.spec.light, ['--sw-d' as string]: g.spec.dark }} /> {g.label} ({fmtInt(g.inView)})
              {/* the count is the binary's own, inside the framed box; a differing sidecar figure is shown too */}
              {g.sidecarCount !== null && g.sidecarCount !== g.inView && (
                <span className="tone-failed"> · neuron_atlas.json says {fmtInt(g.sidecarCount)}</span>
              )}
            </span>
          ))}
          {groups.unknown.length > 0 && (
            <span className="tone-failed">
              <i className="swatch swatch--map" style={{ ['--sw-l' as string]: GROUP_FALLBACK.light, ['--sw-d' as string]: GROUP_FALLBACK.dark }} /> group codes{' '}
              {groups.unknown.join(', ')} not listed in the sidecar's groups[] ({fmtInt(groups.unknownTotal)} neurons)
            </span>
          )}
        </div>
      )}
      {showStatus && (
        <div className={statusClass}>
          {activity && staleActivity && identity ? (
            <span className="tone-failed">nothing is lit: this spike file does not belong to this atlas — {identity.message}</span>
          ) : activity && lit ? (
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
              {lit.offView > 0 && (
                <span>
                  {fmtInt(lit.offView)} of those spikes are on somata outside the framed box and are not drawn
                  {!showVnc && hasBoxes ? ' (turn on the ventral-nerve-cord somata to see them)' : ''}
                </span>
              )}
              {lit.oob > 0 && (
                <span className="tone-failed">
                  {fmtInt(lit.oob)} spikes reference an atlas_row outside the {fmtInt(atlas.n)} rows of neuron_atlas.bin and are not drawn
                </span>
              )}
              {/* the caption discloses this too, but the rail panel renders no caption and this map
                  animates there permanently, so the always-visible instrument has to say it */}
              {activity.sortedOnLoad && (
                <span className="tone-failed">
                  this spike file was not in time order and was sorted on load, so what is drawn is the viewer's ordering of it
                </span>
              )}
            </>
          ) : (
            <span>no activity file loaded: populations only, nothing is lit</span>
          )}
          <span>
            {fmtInt(groups.inViewTotal)} somata drawn
            {groups.outside > 0 && <> · {fmtInt(groups.outside)} outside this box</>} · {fmtInt(rowsDisagree ? atlas.n : sc.n_neurons_in_map)} in the map of{' '}
            {fmtInt(sc.n_neurons_simulated)} neurons simulated
            {rowsDisagree && (
              <span className="tone-failed"> · the binary holds {fmtInt(atlas.n)} rows, not the {fmtInt(sc.n_neurons_in_map)} the sidecar states</span>
            )}
          </span>
          {!hasBoxes && (
            <span className="tone-failed">
              neuron_atlas.json states no view_boxes, so the map is framed on the quantisation bounds and cannot exclude the somata below the brain.
            </span>
          )}
          {showVnc && hasBoxes && <span className="tone-muted">{sc.soma_outside_brain_note}</span>}
        </div>
      )}
    </div>
  );
}

/**
 * The ventral-nerve-cord switch. It says how many somata it adds, taken from the sidecar's own
 * `n_somata_below_brain_plane` (or, absent that, the difference between the two boxes' counts).
 */
export function VncToggle({ atlas, on, set, compact = false }: { atlas: AtlasData; on: boolean; set: (v: boolean) => void; compact?: boolean }) {
  const sc = atlas.sidecar;
  const brainN = sc.view_boxes?.brain?.n_neurons;
  const allN = sc.view_boxes?.all?.n_neurons;
  const extra = typeof sc.n_somata_below_brain_plane === 'number' ? sc.n_somata_below_brain_plane : typeof brainN === 'number' && typeof allN === 'number' ? allN - brainN : null;
  return (
    <label className="map-controls__group map-toggle">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      <span>
        {compact ? 'VNC somata' : 'show ventral nerve cord somata'}
        {extra !== null && <span className="muted"> ({fmtInt(extra)})</span>}
      </span>
    </label>
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
  const brainBox = sc.view_boxes?.brain;
  return (
    <>
      Each dot is one neuron's <em>soma position</em> — the cell body, not the neurites: this is not a morphology rendering, and a
      neuron's arbours may be far from its dot. Positions are {sc.source}, dequantised with the sidecar's own bounds ({fmtNum(atlas.lo[0], 1)}–
      {fmtNum(atlas.hi[0], 1)} µm in x, {fmtNum(atlas.lo[1], 1)}–{fmtNum(atlas.hi[1], 1)} µm in y, {fmtNum(atlas.lo[2], 1)}–{fmtNum(atlas.hi[2], 1)} µm in z);{' '}
      {sc.axes?.note}.{' '}
      {brainBox && typeof brainBox.n_neurons === 'number' && (
        <>
          The default framing is the sidecar's <span className="mono">view_boxes.brain</span>, which holds {fmtInt(brainBox.n_neurons)} somata
          {typeof sc.brain_z_max_um === 'number' && <> above the brain / ventral-nerve-cord plane at z = {fmtNum(sc.brain_z_max_um, 1)} µm</>}
          {typeof sc.n_somata_below_brain_plane === 'number' && (
            <>; the {fmtInt(sc.n_somata_below_brain_plane)} somata below that plane are drawn only with the toggle on</>
          )}
          .{' '}
        </>
      )}
      {sc.subsampled ? (
        <>
          The map is <em>subsampled</em>: it shows {fmtInt(atlas.n)} of the {fmtInt(sc.n_neurons_simulated)} neurons simulated.
        </>
      ) : (
        <>It holds all {fmtInt(atlas.n)} neurons that have a soma position, of {fmtInt(sc.n_neurons_simulated)} simulated.</>
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
          {emptyGroups.length === 1 ? `The group ${emptyGroups[0]} has` : `The groups ${emptyGroups.join(', ')} have`} a count of 0 in this
          export, so {emptyGroups.length === 1 ? 'it appears' : 'they appear'} in the legend with no dots on the map.
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
