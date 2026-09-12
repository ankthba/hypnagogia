import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { checkAtlasIdentity, loadActivity, loadAtlas, type ActivityData, type AtlasData, type BinLoad, type Loadable } from '../lib/binary';
import { resolveColors, useThemeVersion } from '../lib/colors';
import { useCanvasPixelRatio, usePrefersReducedMotion } from '../lib/media';
import { createRenderer, FOV_Y, type Camera, type CloudRenderer, type GroupDraw, type LitPoints } from '../lib/pointcloud';
import { fmtInt, fmtNum, fmtPct } from '../lib/format';
import type { AtlasViewBox, Manifest, Provenance } from '../types';

/**
 * An interactive 3D map of the simulated neurons at their soma positions, which lights up the
 * neurons that spike inside the current window.
 *
 * Everything drawn comes from `neuron_atlas.json` + `neuron_atlas.bin` (positions, groups, counts,
 * framing boxes) and, when the map is animated, from one `replay/activity_<cond>_seed<k>.json` +
 * `.bin` written by the replay stage. No count, label or position is written into this file; when a
 * file is absent the caller renders the explicit "not yet run" panel instead of a map. Nothing else
 * ever animates here.
 *
 * Colours, radii, alphas and paint order follow web/MAP_SPEC.md; the framing box is the sidecar's
 * own `view_boxes.brain`, dequantised with the formula the sidecar states.
 */

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
 * point is 0.27px and the spec's lit radius is 0.60px, but a 1.15px floor drew it at 2.53px, four
 * times the radius and eight times the area, and optic is 90,805 of the 124,289 somata in the brain
 * view, so the animation systematically exaggerated how much of the brain was firing.
 */
const LIT_GAIN = 2.2;
/** Time bucket for the spike index; a scrub window is then a range of buckets, not a rescan. */
const BIN_MS = 16;
/**
 * Pitch is clamped just short of the poles: exactly at a pole the fixed up vector (0, 1, 0) and the
 * view direction coincide and the view basis is undefined.
 *
 * 1.5697 rad is 89.95 degrees, which is the dorsal (x, z) view MAP_SPEC.md promises the orbit
 * reaches, to within a twentieth of a degree. The old 1.45 was 83.1 degrees and stopped the camera
 * seven degrees short of ever looking down the atlas y axis, so one of the three named projections
 * was not actually reachable. At 89.95 degrees the cross product still has a length of 8.7e-4 of a
 * unit vector, which is thousands of times the resolution of the doubles it is computed in.
 */
const MAX_PITCH = 1.5697;
/** Zoom range, as a multiple of the framing distance. */
const MIN_ZOOM = 0.55;
const MAX_ZOOM = 14;
/** Idle time before the map starts turning again by itself, milliseconds. */
const IDLE_MS = 3500;
/** Idle rotation rate, radians per second. Slow enough to read, fast enough to show it is 3D. */
const AUTO_RATE = 0.085;

/** Perceived lightness of a resolved `rgb(...)` string, used only to pick the spec's dark or light column. */
function isDarkColor(css: string): boolean {
  const m = css.match(/-?[\d.]+/g);
  if (!m || m.length < 3) return false;
  const [r, g, b] = m.slice(0, 3).map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
}

/** A `#rgb`, `#rrggbb` or `rgb(...)` string as three 0..1 components. */
function parseRgb01(css: string): [number, number, number] {
  if (css.startsWith('#')) {
    const h = css.slice(1);
    const n =
      h.length === 3
        ? h.split('').map((c) => parseInt(c + c, 16))
        : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    return [n[0] / 255, n[1] / 255, n[2] / 255];
  }
  const m = css.match(/-?[\d.]+/g);
  if (!m || m.length < 3) return [0.5, 0.5, 0.5];
  return [Number(m[0]) / 255, Number(m[1]) / 255, Number(m[2]) / 255];
}

// ---------------------------------------------------------------- loading hooks

export type { Loadable };

/** Loads the atlas once (module-level promise cache: every page shares the parse). */
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

/**
 * One activity file, parsed once per path.
 *
 * The parsed result is cached at module level and keyed by path: the same seed and condition is
 * asked for by the Replay page and by the rail panel, and the binaries are 3.2 MB each, so parsing
 * one twice is 3.2 MB of decode and 3.2 MB of resident arrays for nothing. A failure is not cached:
 * a file that 404s now may exist after the pipeline is re-run, and a network error must be retryable.
 */
const activityCache = new Map<string, Promise<BinLoad<ActivityData>>>();
/**
 * How many parsed runs the cache keeps.
 *
 * Two, because there are at most two askers for the same instant: the Replay page and the rail
 * panel, and they share one selection, so they ask for the same path. It used to be unbounded, and
 * each entry holds two Uint32Arrays of about 400,000 spikes: clicking through the three conditions
 * and three seeds fetched all nine binaries (27.5 MB) and left every one of them resident, so the
 * heap climbed from 15 MB to 40 MB and never came back down. Only the current run is ever animated;
 * everything else is a page the reader has left.
 */
const ACTIVITY_CACHE_MAX = 2;

export function loadActivityCached(path: string): Promise<BinLoad<ActivityData>> {
  const hit = activityCache.get(path);
  if (hit) {
    // re-insert so the Map's insertion order is least-recently-used first
    activityCache.delete(path);
    activityCache.set(path, hit);
    return hit;
  }
  const p = loadActivity(path);
  activityCache.set(path, p);
  // A failure is not cached: a file that 404s now may exist after the pipeline is re-run, and a
  // network error must be retryable.
  p.then((r) => {
    if (!r.ok) activityCache.delete(path);
  }).catch(() => activityCache.delete(path));
  while (activityCache.size > ACTIVITY_CACHE_MAX) {
    const oldest = activityCache.keys().next();
    if (oldest.done || oldest.value === path) break;
    activityCache.delete(oldest.value);
  }
  return p;
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
    loadActivityCached(path)
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
 * soma positions came from, which nothing else on the page names. The two web copies (and any
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
        config: m?.model?.base_config ?? 'not stated',
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
      config: p.config ?? 'not stated',
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
 * into the bitmap: MAP_SPEC.md keeps text out of the canvas, and a caption burned into the image
 * washed out the small populations the draw order exists to protect.
 */
export interface MapSourceLabel {
  text: string;
}

/**
 * The playhead, as something the draw loop reads rather than as a prop that changes sixty times a
 * second. Both callers already hold a mutable clock of this shape; handing it in means the map's
 * React subtree (the legend, the counts, the controls) is reconciled when the *source* changes and
 * not once per frame of playback, and the few numbers that do change per frame are written into
 * their own DOM nodes by the loop itself.
 */
export interface TimeSource {
  /** the current window time in milliseconds, or null when nothing is being played */
  get: () => number | null;
}

const STILL_TIME: TimeSource = { get: () => null };

function BrainMapInner({
  atlas,
  activity = null,
  source,
  time = null,
  decayMs = 150,
  loopMs,
  height = 480,
  showVnc: showVncProp,
  onShowVncChange,
  variant = 'figure',
  background = 'page',
  showVncControl = true,
  showLegend = true,
  showStatus = true,
  activityLoading = false,
}: {
  atlas: AtlasData;
  /** spikes to light up; null renders the populations only (no activity) */
  activity?: ActivityData | null;
  /** the run's file is still on the wire: the status line says so instead of reading as a failure */
  activityLoading?: boolean;
  /** required: what this map is showing; carried to a screen reader as the canvas's aria-label */
  source: MapSourceLabel;
  /** the playhead, as a subscription; null means no activity is shown */
  time?: TimeSource | null;
  /** a spike stays lit for this long, fading out */
  decayMs?: number;
  /**
   * Length of the loop when the caller is playing this file on repeat. The decay window then wraps
   * across the seam instead of being truncated at 0, so the lit set does not collapse to the first
   * frame's worth of spikes and rebuild over the next `decayMs`. Omit it (the Replay page does) when
   * the timeline runs once and 0 really is the beginning.
   */
  loopMs?: number;
  /** the tallest the plot area may be; the canvas takes the frame's frontal aspect within it */
  height?: number;
  /** frame on `view_boxes.all` (somata in the ventral nerve cord included) rather than `.brain` */
  showVnc?: boolean;
  onShowVncChange?: (v: boolean) => void;
  /** 'panel' is the compact instrument in the right-hand rail: smaller type */
  variant?: 'figure' | 'panel';
  /**
   * MAP_SPEC.md fixes this: the canvas background is the page background token, so the map reads as
   * part of the page and the spec's dark / light colour column follows the theme. 'mat' remains only
   * for a caller that deliberately mounts the map on the white figure mat.
   */
  background?: 'mat' | 'page';
  showVncControl?: boolean;
  showLegend?: boolean;
  showStatus?: boolean;
}) {
  const [vncInner, setVncInner] = useState(false);
  const showVnc = showVncProp ?? vncInner;
  const setShowVnc = (v: boolean) => (onShowVncChange ? onShowVncChange(v) : setVncInner(v));

  // The wrapper is state, not a ref, so the colour resolution below can depend on it existing.
  const [wrap, setWrap] = useState<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(400);
  const themeVersion = useThemeVersion();
  const dpr = useCanvasPixelRatio();
  const reduceMotion = usePrefersReducedMotion();

  /**
   * The wrapper's width, measured synchronously before the first paint. The ResizeObserver below
   * coalesces to one update per frame, which is right for a drag but wrong for the mount: for that
   * one frame the canvas would be sized 400 wide and its CSS `max-width: 100%` would cap the width
   * without touching the height, so the map would be drawn at the wrong aspect ratio.
   */
  useLayoutEffect(() => {
    if (!wrap) return;
    const w = Math.max(200, Math.floor(wrap.getBoundingClientRect().width));
    setWidth((prev) => (prev === w ? prev : w));
  }, [wrap]);

  // Width changes are coalesced to one per frame, and a change under 2px is ignored: dragging a
  // window edge otherwise rebuilds the whole vertex buffer once per observed pixel.
  useEffect(() => {
    if (!wrap) return;
    let raf = 0;
    let pending = 0;
    const ro = new ResizeObserver((entries) => {
      pending = Math.max(200, Math.floor(entries[0].contentRect.width));
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

  /** The box the map is framed on: the brain by default, everything when the VNC toggle is on. */
  const frame = useMemo(() => frameFor(atlas, showVnc ? 'all' : 'brain'), [atlas, showVnc]);
  const brainFrame = useMemo(() => frameFor(atlas, 'brain'), [atlas]);
  /** true when this export actually carries the boxes; false means the map is framed on the quantisation bounds. */
  const hasBoxes = brainFrame.from === 'view_box';

  /**
   * Rows inside the current frame, gathered per group in the spec's painting order, and the legend
   * counts. A neuron outside the box is neither drawn nor counted.
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
    // Which of the sidecar's own count blocks the legend states depends on the frame in view.
    const stated = showVnc ? sc.group_counts : sc.group_counts_in_brain_view ?? (hasBoxes ? undefined : sc.group_counts);
    const list = (sc.groups ?? []).map((g) => ({
      code: g.code,
      label: g.label,
      spec: specFor(g.label),
      /** neurons of this group inside the current frame, counted from the binary itself */
      inView: counts.get(g.code) ?? 0,
      /**
       * What the sidecar states for this group in this frame; null when it states nothing.
       * MAP_SPEC.md makes this the number the legend shows, with `inView` as the check on it: the
       * stated figure is the export's own, while counting the binary depends on reproducing the
       * exporter's box test through a quantisation the file only carries to half a step.
       */
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
   * The geometry handed to the renderer: every soma in the frame, centred on the box, ordered so
   * each population is one contiguous run.
   *
   * The world is the atlas's own micrometres with two axes flipped: y so that the atlas's
   * dorsal-ventral axis increases *downward* on screen (the frontal view a reader recognises), and z
   * so that an increasing anterior-posterior coordinate goes away from the eye. At yaw 0, pitch 0
   * the picture is therefore exactly the frontal projection MAP_SPEC.md asks for as the default.
   */
  const geometry = useMemo(() => {
    const cx = (frame.lo[0] + frame.hi[0]) / 2;
    const cy = (frame.lo[1] + frame.hi[1]) / 2;
    const cz = (frame.lo[2] + frame.hi[2]) / 2;
    const n = groups.inViewTotal;
    const pos = new Float32Array(n * 3);
    const runs: { code: number; label: string; spec: GroupSpec; start: number; count: number }[] = [];
    let at = 0;
    const push = (rows: Uint32Array, code: number, label: string, spec: GroupSpec) => {
      const start = at;
      for (let k = 0; k < rows.length; k++) {
        const i = rows[k];
        const b = at * 3;
        pos[b] = atlas.xUm[i] - cx;
        pos[b + 1] = -(atlas.yUm[i] - cy);
        pos[b + 2] = -(atlas.zUm[i] - cz);
        at++;
      }
      runs.push({ code, label, spec, start, count: rows.length });
    };
    // the spec's draw order: the big background populations first, the small named ones last and
    // largest, so 32 dFB neurons are not lost among 90,805 optic-lobe cells
    let unknownDrawn = false;
    for (const g of groups.byPaint) {
      if (!unknownDrawn && g.spec.order > GROUP_FALLBACK.order) {
        push(groups.unknownRows, -1, 'unlisted group codes', GROUP_FALLBACK);
        unknownDrawn = true;
      }
      push(groups.rows.get(g.code) ?? new Uint32Array(0), g.code, g.label, g.spec);
    }
    if (!unknownDrawn) push(groups.unknownRows, -1, 'unlisted group codes', GROUP_FALLBACK);

    const half: [number, number, number] = [
      ((frame.hi[0] - frame.lo[0]) / 2) * (1 + 2 * BOX_PAD),
      ((frame.hi[1] - frame.lo[1]) / 2) * (1 + 2 * BOX_PAD),
      ((frame.hi[2] - frame.lo[2]) / 2) * (1 + 2 * BOX_PAD),
    ];
    return { pos, runs, half, centre: [cx, cy, cz] as [number, number, number], radius: Math.hypot(half[0], half[1], half[2]) };
  }, [atlas, frame, groups]);

  /**
   * Canvas geometry. It takes the frontal aspect of the framing box, which is what MAP_SPEC.md asks
   * of the default view (1.87:1 for the brain box), capped by the caller's height budget, and the
   * framing distance is the eye distance at which that frontal view exactly fills the frame.
   */
  const view = useMemo(() => {
    const aspect = Math.max(0.5, Math.min(2.6, geometry.half[0] / Math.max(1e-6, geometry.half[1])));
    const maxH = Math.max(140, height);
    let cw = Math.max(180, width);
    let ch = cw / aspect;
    if (ch > maxH) {
      ch = maxH;
      cw = maxH * aspect;
    }
    cw = Math.round(cw);
    ch = Math.round(ch);
    const t = Math.tan(FOV_Y / 2);
    // far enough that both the height and the width of the frontal face fit, plus the half depth so
    // the near face is inside the frustum rather than pushed through the eye
    const fitDist = Math.max(geometry.half[1] / t, geometry.half[0] / (t * (cw / ch))) + geometry.half[2];
    return { cw, ch, fitDist, rScale: cw / REF_W };
  }, [geometry, width, height]);

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
   * current pairing from a stale one, only the identity the exporter stamps into both sidecars.
   * A mismatch lights nothing here, whatever the caller does with it; an unstamped file is drawn but
   * is reported as unverifiable.
   */
  const identity = useMemo(() => (activity ? checkAtlasIdentity(activity.sidecar, atlas) : null), [activity, atlas]);
  const staleActivity = identity?.state === 'mismatch';

  /**
   * The palette as literal colours. Only the background is a token; the group colours are the
   * spec's own hexes, chosen by whether the background this canvas sits on is dark or light (which
   * the white figure mat forces to light in both themes).
   */
  const C = useMemo(() => {
    if (!wrap) return null;
    const resolved = resolveColors(wrap, { bg: background === 'page' ? 'var(--color-bg)' : 'var(--color-mat)' });
    const dark = isDarkColor(resolved.bg);
    return { bgCss: resolved.bg, bg: parseRgb01(resolved.bg), dark, accent: parseRgb01(dark ? ACCENT.dark : ACCENT.light) };
    // themeVersion is the signal that the same var() now resolves to a different colour
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrap, background, themeVersion]);

  /** Per-group draw parameters, and the per-group-code lookups the lit pass needs. */
  const draws = useMemo(() => {
    if (!C) return null;
    const list: GroupDraw[] = geometry.runs.map((r) => ({
      start: r.start,
      count: r.count,
      color: parseRgb01(specColor(r.spec, C.dark)),
      radius: specRadius(r.spec, C.dark),
      alpha: r.spec.alpha,
    }));
    const labels = atlas.groupLabels ?? [];
    const nCodes = Math.max(1, labels.length);
    const colorByCode = new Float32Array(nCodes * 3);
    const radiusByCode = new Float32Array(nCodes);
    // A lit point fades back to its group's own alpha, not to full opacity, so the lit pass needs
    // the group alpha per point exactly as it needs the group colour and radius.
    const alphaByCode = new Float32Array(nCodes);
    for (let code = 0; code < nCodes; code++) {
      const spec = specFor(labels[code] ?? '');
      const [r, g, b] = parseRgb01(specColor(spec, C.dark));
      colorByCode[code * 3] = r;
      colorByCode[code * 3 + 1] = g;
      colorByCode[code * 3 + 2] = b;
      radiusByCode[code] = specRadius(spec, C.dark);
      alphaByCode[code] = spec.alpha;
    }
    return {
      list,
      colorByCode,
      radiusByCode,
      alphaByCode,
      fallbackColor: parseRgb01(specColor(GROUP_FALLBACK, C.dark)),
      fallbackRadius: specRadius(GROUP_FALLBACK, C.dark),
      fallbackAlpha: GROUP_FALLBACK.alpha,
    };
  }, [C, geometry, atlas.groupLabels]);

  // ---------------------------------------------------------------- renderer and loop

  const rendererRef = useRef<CloudRenderer | null>(null);
  const [rendererKind, setRendererKind] = useState<'webgl' | 'canvas2d' | 'none' | null>(null);
  const [drawnPoints, setDrawnPoints] = useState<number | null>(null);
  /** yaw / pitch / zoom, plus the inertia and the idle clock: mutated by the loop, never state */
  const cam = useRef({ yaw: 0, pitch: 0, zoom: 1, zoomTarget: 1, velYaw: 0, velPitch: 0, dragging: false, lastInteract: -1e9, auto: 0 });

  /** Everything the loop reads that React owns; rewritten on every commit, read on every frame. */
  const live = useRef({
    activity,
    index,
    decayMs,
    loopMs,
    inBox: groups.inBox,
    atlas,
    draws,
    C,
    view,
    geometry,
    time: time ?? STILL_TIME,
    stale: staleActivity,
    reduceMotion,
  });
  live.current = {
    activity,
    index,
    decayMs,
    loopMs,
    inBox: groups.inBox,
    atlas,
    draws,
    C,
    view,
    geometry,
    time: time ?? STILL_TIME,
    stale: staleActivity,
    reduceMotion,
  };

  /** Scratch buffers for the lit pass, grown rather than reallocated on every frame. */
  const litBuf = useRef<LitPoints>({
    pos: new Float32Array(0),
    age: new Float32Array(0),
    radius: new Float32Array(0),
    color: new Float32Array(0),
    alpha: new Float32Array(0),
    n: 0,
  });
  /** Dedupe stamps: one array write per spike instead of a Set lookup. */
  const stampRef = useRef<{ gen: Int32Array; pos: Int32Array; n: number; counter: number } | null>(null);

  // The status counts change on every frame. They are written straight into the DOM rather than
  // through React: a 60 Hz setState here would reconcile the legend, the controls and the caption
  // for numbers that only these few nodes read.
  const nLitRef = useRef<HTMLElement>(null);
  const nSpikesRef = useRef<HTMLElement>(null);
  const tRef = useRef<HTMLElement>(null);
  const offViewRef = useRef<HTMLSpanElement>(null);
  const oobRef = useRef<HTMLSpanElement>(null);
  const scaleBarRef = useRef<HTMLDivElement>(null);
  const orientRef = useRef<HTMLElement>(null);

  const resetView = useCallback(() => {
    const c = cam.current;
    c.yaw = 0;
    c.pitch = 0;
    c.zoom = 1;
    c.zoomTarget = 1;
    c.velYaw = 0;
    c.velPitch = 0;
    c.lastInteract = performance.now();
    c.auto = 0;
  }, []);

  // Create the renderer once per canvas element, and rebuild it if the GPU drops the context.
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const r = createRenderer(cv);
    rendererRef.current = r;
    setRendererKind(r ? r.kind : 'none');
    const onLost = (e: Event) => {
      e.preventDefault();
      rendererRef.current = null;
      setRendererKind(null);
    };
    const onRestored = () => {
      const again = createRenderer(cv);
      rendererRef.current = again;
      setRendererKind(again ? again.kind : 'none');
    };
    cv.addEventListener('webglcontextlost', onLost);
    cv.addEventListener('webglcontextrestored', onRestored);
    return () => {
      cv.removeEventListener('webglcontextlost', onLost);
      cv.removeEventListener('webglcontextrestored', onRestored);
      r?.dispose();
      rendererRef.current = null;
    };
  }, []);

  // Upload the cloud whenever the geometry or the palette changes (a resize does not touch it).
  useEffect(() => {
    const r = rendererRef.current;
    if (!r || !draws) return;
    r.setStatic(geometry.pos, draws.list);
    setDrawnPoints(r.drawnPoints());
  }, [geometry, draws, rendererKind]);

  useEffect(() => {
    rendererRef.current?.resize(view.cw, view.ch, dpr);
  }, [view.cw, view.ch, dpr, rendererKind]);

  /** Paused while the map is scrolled out of sight: an offscreen canvas is pure heat. */
  const visibleRef = useRef(true);
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((es) => {
      visibleRef.current = es[0].isIntersecting;
    });
    io.observe(cv);
    return () => io.disconnect();
  }, []);

  // The single animation loop. It owns the camera, the lit set and the draw; React owns everything
  // that has words in it.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let prevKey = '';
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const L = live.current;
      const r = rendererRef.current;
      const c = cam.current;

      // camera integration: inertia after a drag, then a slow idle turn
      if (!c.dragging) {
        if (Math.abs(c.velYaw) > 1e-4 || Math.abs(c.velPitch) > 1e-4) {
          c.yaw += c.velYaw * dt;
          c.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, c.pitch + c.velPitch * dt));
          const damp = Math.exp(-dt * 3.6);
          c.velYaw *= damp;
          c.velPitch *= damp;
        } else {
          c.velYaw = 0;
          c.velPitch = 0;
        }
        const idle = now - c.lastInteract > IDLE_MS && !L.reduceMotion;
        // eased in and out, so the idle turn never starts with a jolt
        c.auto += ((idle ? 1 : 0) - c.auto) * Math.min(1, dt * 2.2);
        if (c.auto > 0.001) c.yaw += AUTO_RATE * c.auto * dt;
      }
      c.zoom += (c.zoomTarget - c.zoom) * Math.min(1, dt * 14);
      if (Math.abs(c.zoomTarget - c.zoom) < 1e-4) c.zoom = c.zoomTarget;

      if (!visibleRef.current || !r || !L.draws || !L.C) return;

      // the lit set for this frame, read from the caller's clock
      const timeMs = L.time.get();
      const lit = buildLit(L, timeMs, litBuf, stampRef);

      const camera: Camera = { yaw: c.yaw, pitch: c.pitch, dist: L.view.fitDist / c.zoom };
      r.draw(camera, lit && lit.n > 0 ? litBuf.current : null, {
        sceneRadius: L.geometry.radius,
        bg: L.C.bg,
        accent: L.C.accent,
        litGain: LIT_GAIN,
        radiusScale: L.view.rScale,
        fitDist: L.view.fitDist,
      });

      // the readouts, written only when the text they would carry has actually changed
      const key = `${lit ? lit.n : -1}|${lit ? lit.spikes : -1}|${timeMs === null ? '' : Math.round(timeMs / 10)}|${Math.round(c.yaw * 30)}|${Math.round(
        c.pitch * 30,
      )}|${Math.round(c.zoom * 100)}`;
      if (key !== prevKey) {
        prevKey = key;
        if (nLitRef.current) nLitRef.current.textContent = lit ? fmtInt(lit.n) : '0';
        if (nSpikesRef.current) nSpikesRef.current.textContent = lit ? fmtInt(lit.spikes) : '0';
        if (tRef.current) tRef.current.textContent = timeMs === null ? '' : fmtNum(timeMs / 1000, 2);
        const off = offViewRef.current;
        if (off) {
          const v = lit && lit.offView > 0 ? fmtInt(lit.offView) : '';
          if (off.textContent !== v) off.textContent = v;
          off.parentElement?.toggleAttribute('hidden', v === '');
        }
        const oob = oobRef.current;
        if (oob) {
          const v = lit && lit.oob > 0 ? fmtInt(lit.oob) : '';
          if (oob.textContent !== v) oob.textContent = v;
          oob.parentElement?.toggleAttribute('hidden', v === '');
        }
        if (orientRef.current) {
          const az = ((((c.yaw * 180) / Math.PI) % 360) + 360) % 360;
          const el = (c.pitch * 180) / Math.PI;
          orientRef.current.textContent = `azimuth ${az.toFixed(0)}°, elevation ${el.toFixed(0)}°, ${c.zoom.toFixed(2)}×`;
        }
        if (scaleBarRef.current) {
          // valid at the centre of the box: with a perspective camera a bar is true at one depth only
          const dist = L.view.fitDist / c.zoom;
          const pxPerUm = L.view.ch / 2 / (dist * Math.tan(FOV_Y / 2));
          const nice = [500, 200, 100, 50, 20, 10].find((u) => u * pxPerUm < L.view.cw / 3) ?? 10;
          scaleBarRef.current.style.width = `${(nice * pxPerUm).toFixed(1)}px`;
          scaleBarRef.current.dataset.label = `${nice} µm at the centre`;
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---------------------------------------------------------------- pointer interaction

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const active = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;
    const c = cam.current;

    const mark = () => {
      c.lastInteract = performance.now();
      c.auto = 0;
    };

    const onDown = (e: PointerEvent) => {
      active.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (active.size === 1) {
        c.dragging = true;
        c.velYaw = 0;
        c.velPitch = 0;
      }
      if (active.size === 2) {
        const [a, b] = [...active.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
      mark();
      try {
        cv.setPointerCapture(e.pointerId);
      } catch {
        /* a pointer the browser has already cancelled cannot be captured */
      }
    };

    const onMove = (e: PointerEvent) => {
      const prev = active.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      active.set(e.pointerId, { x: e.clientX, y: e.clientY });
      mark();
      if (active.size >= 2) {
        const [a, b] = [...active.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0 && d > 0) {
          const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, c.zoomTarget * (d / pinchDist)));
          c.zoomTarget = next;
          c.zoom = next; // a pinch is direct, not eased: it has to track the fingers
        }
        pinchDist = d;
        e.preventDefault();
        return;
      }
      // 0.006 rad per CSS pixel: a drag across a 400px canvas is about 140 degrees
      const dyaw = dx * 0.006;
      const dpitch = dy * 0.006;
      c.yaw += dyaw;
      c.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, c.pitch + dpitch));
      // velocity for the throw, in radians per second, smoothed over the last few moves
      c.velYaw = c.velYaw * 0.6 + dyaw * 60 * 0.4;
      c.velPitch = c.velPitch * 0.6 + dpitch * 60 * 0.4;
      e.preventDefault();
    };

    const onUp = (e: PointerEvent) => {
      active.delete(e.pointerId);
      if (active.size === 0) c.dragging = false;
      if (active.size < 2) pinchDist = 0;
      mark();
      try {
        cv.releasePointerCapture(e.pointerId);
      } catch {
        /* the browser may already have released the capture */
      }
    };

    /**
     * The wheel zooms, but it must never trap the page.
     *
     * This map sits in a sticky rail that a reader's pointer passes over constantly, so a wheel
     * that always zoomed would stop the page dead every time the cursor crossed it. The rule:
     *  - a pinch on a trackpad arrives as ctrl+wheel, and always zooms;
     *  - a wheel that arrives while the page is already scrolling passes straight through, so a
     *    scroll that happens to sweep over the map keeps scrolling the page;
     *  - a wheel that starts with the pointer resting on the map zooms;
     *  - at either end of the zoom range the wheel is not swallowed at all.
     */
    let lastPageScroll = 0;
    const onPageScroll = () => {
      lastPageScroll = performance.now();
    };
    const onWheel = (e: WheelEvent) => {
      // A trackpad pinch arrives as ctrl+wheel on every platform. Cmd+wheel is the browser's own
      // page zoom on macOS, and treating it as a pinch here called preventDefault and swallowed it.
      const pinch = e.ctrlKey;
      if (!pinch && performance.now() - lastPageScroll < 260) return; // the page is mid-scroll
      const before = c.zoomTarget;
      const factor = Math.exp(-(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY) * (pinch ? 0.01 : 0.0016));
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, before * factor));
      c.zoomTarget = next;
      mark();
      if (Math.abs(next - before) > 1e-6) e.preventDefault();
    };

    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove, { passive: false });
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('scroll', onPageScroll, { passive: true });
    return () => {
      cv.removeEventListener('pointerdown', onDown);
      cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerup', onUp);
      cv.removeEventListener('pointercancel', onUp);
      cv.removeEventListener('wheel', onWheel);
      window.removeEventListener('scroll', onPageScroll);
    };
  }, []);

  const nudge = useCallback((dyaw: number, dpitch: number) => {
    const c = cam.current;
    c.yaw += dyaw;
    c.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, c.pitch + dpitch));
    c.lastInteract = performance.now();
    c.auto = 0;
  }, []);

  const zoomBy = useCallback((f: number) => {
    const c = cam.current;
    c.zoomTarget = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, c.zoomTarget * f));
    c.lastInteract = performance.now();
    c.auto = 0;
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.4 : 0.12;
    if (e.key === 'ArrowLeft') nudge(-step, 0);
    else if (e.key === 'ArrowRight') nudge(step, 0);
    else if (e.key === 'ArrowUp') nudge(0, -step);
    else if (e.key === 'ArrowDown') nudge(0, step);
    else if (e.key === '+' || e.key === '=') zoomBy(1.25);
    else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.25);
    else if (e.key === '0') resetView();
    else return;
    e.preventDefault();
  };

  // ---------------------------------------------------------------- panel furniture

  const sc = atlas.sidecar;
  /** the fraction of its spikes the activity file actually carries, when it carries a sample */
  const sampleFrac =
    activity && activity.sidecar.downsampled && activity.sidecar.n_spikes_total > 0
      ? activity.sidecar.n_spikes_exported / activity.sidecar.n_spikes_total
      : null;
  const rowsDisagree = atlas.n !== sc.n_neurons_in_map;
  const legendClass = variant === 'panel' ? 'legend legend--tight mt-2' : 'legend mt-3';
  const statusClass = variant === 'panel' ? 'legend legend--tight mt-1' : 'legend mt-1';
  const subsampled = drawnPoints !== null && drawnPoints < groups.inViewTotal;

  return (
    <div ref={setWrap} className="w-full map3d">
      <div className="map3d__stage" style={{ maxWidth: view.cw }}>
        <canvas
          ref={canvasRef}
          role="img"
          tabIndex={0}
          aria-label={`${source.text}. Interactive 3D view: drag to orbit, scroll or pinch to zoom, arrow keys to turn, 0 to reset.`}
          style={{ width: view.cw, height: 'auto', aspectRatio: `${view.cw} / ${view.ch}`, maxWidth: '100%', background: C?.bgCss }}
          className="map3d__canvas block mx-auto"
          onKeyDown={onKeyDown}
        />
        {/* Only the scale bar and the orientation readout sit over the picture, and they are HTML,
            not pixels: MAP_SPEC.md keeps text out of the bitmap so it stays selectable. */}
        <div className="map3d__scale" ref={scaleBarRef} aria-hidden="true" />
        <div className="map3d__orient">
          <span ref={orientRef}>azimuth 0°, elevation 0°, 1.00×</span>
        </div>
      </div>

      <div className="map3d__controls small">
        <span className="muted">drag to orbit · scroll or pinch to zoom</span>
        <span className="map3d__buttons">
          <button type="button" className="control" onClick={() => zoomBy(1.3)} title="zoom in" aria-label="zoom in">
            +
          </button>
          <button type="button" className="control" onClick={() => zoomBy(1 / 1.3)} title="zoom out" aria-label="zoom out">
            &minus;
          </button>
          <button type="button" className="control" onClick={resetView} title="back to the frontal view at the framing distance">
            reset view
          </button>
        </span>
        {showVncControl && hasBoxes && <VncToggle atlas={atlas} on={showVnc} set={setShowVnc} compact={variant === 'panel'} />}
      </div>

      {rendererKind === 'none' && (
        <div className="mt-2 smaller tone-failed">
          This browser gave neither a WebGL nor a 2D canvas context, so the map cannot be drawn at all. Nothing is shown in its place.
        </div>
      )}
      {rendererKind === 'canvas2d' && (
        <div className="mt-2 smaller tone-failed">
          No WebGL in this browser, so the map is projected and painted point by point in JavaScript instead.
          {subsampled && (
            <>
              {' '}
              To hold a smooth frame rate it draws {fmtInt(drawnPoints)} of the {fmtInt(groups.inViewTotal)} somata in this box, sampled at an
              even stride through the two background populations. Every named population (KC, MBON, DAN, dFB, ALPN, CX, ORN) is drawn in full.
            </>
          )}
        </div>
      )}

      {showLegend && (
        <div className={legendClass}>
          {groups.list.map((g) => (
            <span key={g.code}>
              <i className="swatch swatch--map" style={{ ['--sw-l' as string]: g.spec.light, ['--sw-d' as string]: g.spec.dark }} /> {g.label} (
              {fmtInt(g.sidecarCount ?? g.inView)})
              {/* The count is the sidecar's own, per MAP_SPEC.md. What was drawn is counted from the
                  binary and printed only when the two disagree; when the sidecar states no count for
                  this group the figure IS the binary's, and says so. */}
              {g.sidecarCount === null ? (
                <span className="tone-failed"> · counted in neuron_atlas.bin; the sidecar states no count for this group</span>
              ) : (
                g.sidecarCount !== g.inView && <span className="tone-failed"> · {fmtInt(g.inView)} drawn from neuron_atlas.bin</span>
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
            <span className="tone-failed">nothing is lit: this spike file does not belong to this atlas: {identity.message}</span>
          ) : activity ? (
            <>
              <span>
                <strong ref={nLitRef}>0</strong> neurons spiking in the last {fmtInt(decayMs)} ms at t = <span ref={tRef} className="tabular-nums" /> s ·{' '}
                <span ref={nSpikesRef}>0</span> spikes in that window
                {/* both counts are counts of what the file holds; when it holds a sample, they are sample counts */}
                {sampleFrac !== null && (
                  <>
                    , counted in the {fmtPct(sampleFrac)} of the spikes this file carries ({fmtInt(activity.sidecar.n_spikes_exported)} of{' '}
                    {fmtInt(activity.sidecar.n_spikes_total)}), so the true numbers are higher
                  </>
                )}
              </span>
              {identity && identity.state === 'unverified' && (
                <span className="tone-failed">activity not verified against this atlas: {identity.message}</span>
              )}
              <span hidden>
                <span ref={offViewRef} /> of those spikes are on somata outside the framed box and are not drawn
                {!showVnc && hasBoxes ? ' (turn on the ventral-nerve-cord somata to see them)' : ''}
              </span>
              <span className="tone-failed" hidden>
                <span ref={oobRef} /> spikes reference an atlas_row outside the {fmtInt(atlas.n)} rows of neuron_atlas.bin and are not drawn
              </span>
              {/* the caption discloses this too, but the rail panel renders no caption and this map
                  animates there permanently, so the always-visible instrument has to say it */}
              {activity.sortedOnLoad && (
                <span className="tone-failed">
                  this spike file was not in time order and was sorted on load, so what is drawn is the viewer's ordering of it
                </span>
              )}
            </>
          ) : activityLoading ? (
            <span>loading the run's spikes; the populations are drawn, nothing is lit yet</span>
          ) : (
            <span>no activity file loaded: populations only, nothing is lit</span>
          )}
          <span>
            {fmtInt(groups.inViewTotal)} somata in this box
            {subsampled && <span className="tone-failed"> · {fmtInt(drawnPoints)} of them drawn</span>}
            {groups.outside > 0 && <> · {fmtInt(groups.outside)} outside it</>} · {fmtInt(rowsDisagree ? atlas.n : sc.n_neurons_in_map)} in the map of{' '}
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

/** The shape the draw loop reads out of React; see `live` above. */
interface LiveState {
  activity: ActivityData | null;
  index: { starts: Int32Array; nBins: number } | null;
  decayMs: number;
  loopMs?: number;
  inBox: Uint8Array;
  atlas: AtlasData;
  draws: {
    colorByCode: Float32Array;
    radiusByCode: Float32Array;
    alphaByCode: Float32Array;
    fallbackColor: [number, number, number];
    fallbackRadius: number;
    fallbackAlpha: number;
  } | null;
  geometry: { centre: [number, number, number] };
  stale: boolean;
}

/**
 * The neurons lit in the current window, written into the caller's scratch buffers.
 *
 * Returns the counts the status line prints, or null when nothing is being played. Both the buffers
 * and the dedupe stamps are reused between frames: this runs sixty times a second over a window
 * that can hold a few thousand spikes.
 */
function buildLit(
  L: LiveState,
  timeMs: number | null,
  buf: { current: LitPoints },
  stampRef: { current: { gen: Int32Array; pos: Int32Array; n: number; counter: number } | null },
): { n: number; spikes: number; oob: number; offView: number } | null {
  const { activity, index, atlas, draws } = L;
  if (!activity || !index || !draws || timeMs === null || !Number.isFinite(timeMs)) {
    buf.current.n = 0;
    return null;
  }
  if (L.stale) {
    buf.current.n = 0;
    return { n: 0, spikes: 0, oob: 0, offView: 0 };
  }
  if (!stampRef.current || stampRef.current.n !== atlas.n) {
    stampRef.current = { gen: new Int32Array(atlas.n), pos: new Int32Array(atlas.n), n: atlas.n, counter: 0 };
  }
  const stamp = stampRef.current;
  stamp.counter += 1;
  const generation = stamp.counter;
  const decayMs = L.decayMs;
  const t1 = timeMs;
  const t0 = timeMs - decayMs;
  const inBox = L.inBox;
  const [cx, cy, cz] = L.geometry.centre;
  const nCodes = draws.radiusByCode.length;

  let out = buf.current;
  let n = 0;
  let spikes = 0;
  let oob = 0;
  let offView = 0;

  const ensure = (need: number) => {
    if (out.age.length >= need) return;
    const cap = Math.max(1024, Math.ceil(need * 1.6));
    const grown: LitPoints = {
      pos: new Float32Array(cap * 3),
      age: new Float32Array(cap),
      radius: new Float32Array(cap),
      color: new Float32Array(cap * 3),
      alpha: new Float32Array(cap),
      n: 0,
    };
    grown.pos.set(out.pos.subarray(0, n * 3));
    grown.age.set(out.age.subarray(0, n));
    grown.radius.set(out.radius.subarray(0, n));
    grown.color.set(out.color.subarray(0, n * 3));
    grown.alpha.set(out.alpha.subarray(0, n));
    buf.current = grown;
    out = grown;
  };

  /**
   * Every spike in [lo, hi], lit at the alpha its age gives it. `ageOf` is how long ago the spike
   * fired *on the clock the viewer is watching*, which for the wrapped half of a looped window is
   * not `t1 - t`: those spikes are at the end of the file and the playhead has just passed 0.
   */
  const scan = (lo: number, hi: number, ageOf: (t: number) => number) => {
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
      const a = decayMs > 0 ? Math.max(0, 1 - ageOf(t) / decayMs) : 1;
      if (stamp.gen[row] === generation) {
        const p = stamp.pos[row];
        if (a > out.age[p]) out.age[p] = a;
        continue;
      }
      ensure(n + 1);
      stamp.gen[row] = generation;
      stamp.pos[row] = n;
      const b3 = n * 3;
      out.pos[b3] = atlas.xUm[row] - cx;
      out.pos[b3 + 1] = -(atlas.yUm[row] - cy);
      out.pos[b3 + 2] = -(atlas.zUm[row] - cz);
      out.age[n] = a;
      const code = atlas.group[row];
      if (code < nCodes) {
        out.radius[n] = draws.radiusByCode[code];
        out.color[b3] = draws.colorByCode[code * 3];
        out.color[b3 + 1] = draws.colorByCode[code * 3 + 1];
        out.color[b3 + 2] = draws.colorByCode[code * 3 + 2];
        out.alpha[n] = draws.alphaByCode[code];
      } else {
        out.radius[n] = draws.fallbackRadius;
        out.color[b3] = draws.fallbackColor[0];
        out.color[b3 + 1] = draws.fallbackColor[1];
        out.color[b3 + 2] = draws.fallbackColor[2];
        out.alpha[n] = draws.fallbackAlpha;
      }
      n++;
    }
  };

  // The tail of the loop, when the playhead has wrapped and the window reaches back past 0. Without
  // this the window is truncated at 0 and the lit set collapses to whatever sits at the very start
  // of the file, then rebuilds over the next decayMs: a visible blink on every repeat.
  const loopMs = L.loopMs;
  if (loopMs && loopMs > 0 && t0 < 0) scan(loopMs + t0, loopMs, (t) => t1 + loopMs - t);
  scan(Math.max(0, t0), t1, (t) => t1 - t);

  out.n = n;
  return { n, spikes, oob, offView };
}

/**
 * The ventral-nerve-cord switch. It says how many somata it adds, taken from the sidecar's own
 * `n_somata_below_brain_plane` (or, absent that, the difference between the two boxes' counts).
 */
export function VncToggle({ atlas, on, set, compact = false }: { atlas: AtlasData; on: boolean; set: (v: boolean) => void; compact?: boolean }) {
  const sc = atlas.sidecar;
  const brainN = sc.view_boxes?.brain?.n_neurons;
  const allN = sc.view_boxes?.all?.n_neurons;
  const extra =
    typeof sc.n_somata_below_brain_plane === 'number'
      ? sc.n_somata_below_brain_plane
      : typeof brainN === 'number' && typeof allN === 'number'
        ? allN - brainN
        : null;
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
 * Memoised: the caller's play loop must not re-render the map. The map follows the clock through
 * the `time` subscription instead, so this component renders when its source changes and not once
 * per frame.
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
  /**
   * The two populations the paint order exists to keep apart, as the sidecar counts them.
   *
   * These were written into the prose as "32 dFB cells" and "90,805 optic-lobe cells". They are
   * the right numbers for this export and the wrong kind of number to hard-code: every other
   * figure in this caption is the sidecar's own, and the next export would have left these two
   * silently stale. A group the sidecar states nothing about is not a zero, so when either count
   * is absent the sentence is written without the numbers rather than with an invented one.
   */
  const inBrain = sc.group_counts_in_brain_view ?? sc.group_counts;
  const stated = (label: string): number | null =>
    inBrain && Object.prototype.hasOwnProperty.call(inBrain, label) && typeof inBrain[label] === 'number' ? (inBrain[label] as number) : null;
  const nSmallest = stated('dFB');
  const nLargest = stated('optic');
  return (
    <>
      Each dot is one neuron's <em>soma position</em>, the cell body and not the neurites: this is not a morphology rendering, and a neuron's
      arbours may be far from its dot. Positions are {sc.source}, dequantised with the sidecar's own bounds ({fmtNum(atlas.lo[0], 1)} to{' '}
      {fmtNum(atlas.hi[0], 1)} µm in x, {fmtNum(atlas.lo[1], 1)} to {fmtNum(atlas.hi[1], 1)} µm in y, {fmtNum(atlas.lo[2], 1)} to{' '}
      {fmtNum(atlas.hi[2], 1)} µm in z); {sc.axes?.note}. The view is a 3D orbit: at azimuth 0° and elevation 0° it is the frontal view, with the
      atlas x axis horizontal and the atlas y axis increasing downward. Depth is carried by point size and fading, and the small named
      populations are painted over the two large background populations whatever their depth
      {nSmallest !== null && nLargest !== null ? (
        <>
          , so {fmtInt(nSmallest)} dFB cells are not lost among {fmtInt(nLargest)} optic-lobe cells
        </>
      ) : (
        <>, so the smallest named populations are not lost behind the two large background ones</>
      )}
      .{' '}
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
