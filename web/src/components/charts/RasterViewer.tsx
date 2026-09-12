import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { RasterData, TraceData } from '../../lib/binary';
import { SERIES, CHART_FONT, resolveColors, useThemeVersion } from '../../lib/colors';
import { useCanvasPixelRatio } from '../../lib/media';
import { fmtNum, fmtInt } from '../../lib/format';

const LEFT = 56;
const RIGHT = 12;
const RASTER_TOP = 10;
const RASTER_BOTTOM = 24; // reserved for the row-count label and time ticks
/** var() references the canvas needs as literal colours; resolved against the wrapper at draw time so the mat's light palette applies. */
const CANVAS_VARS = {
  bg: SERIES.mat,
  A: SERIES.A,
  B: SERIES.B,
  other: SERIES.other,
  grid: SERIES.grid,
  axis: SERIES.axis,
  threshold: SERIES.threshold,
  zero: 'var(--color-border-hover)',
  bad: SERIES.failed,
  washA: 'var(--wash-ink)',
  washB: 'var(--wash-link)',
  washOther: 'var(--wash-muted)',
};
const FONT_SM = `10.5px ${CHART_FONT}`;
const FONT_MD = `12px ${CHART_FONT}`;

/** First index i in [0, n) with key(i) >= target, assuming key is non-decreasing. */
function lowerBound(n: number, key: (i: number) => number, target: number): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (key(mid) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Spike raster (canvas) over a scrubbable window, with the template-correlation trace
 * drawn beneath on an identically-mapped time axis. Columns are resolved by name from
 * each sidecar's `columns`, never assumed positionally.
 */
function RasterViewerInner({
  raster,
  trace,
  startS,
  windowS,
}: {
  raster: RasterData | null;
  trace: TraceData | null;
  /** left edge of the visible window, in seconds; owned by the page so the map and the raster share one clock */
  startS: number;
  /** width of the visible window, in seconds */
  windowS: number;
}) {
  const start = startS;
  // Column indices from the sidecars (the loaders guarantee presence; guarded again here).
  const rc = useMemo(() => {
    const cols = raster?.sidecar.columns ?? [];
    return { iT: cols.indexOf('t_ms'), iRow: cols.indexOf('neuron_row'), nCols: raster?.nCols ?? 0, tUnit: cols[0] ?? 't_ms' };
  }, [raster]);
  const tc = useMemo(() => {
    const cols = trace?.sidecar.columns ?? [];
    return { iT: cols.indexOf('t_s'), iA: cols.indexOf('corr_A'), iB: cols.indexOf('corr_B'), nCols: trace?.nCols ?? 0 };
  }, [trace]);

  // Spike ordering: use a binary search when the t column is non-decreasing; otherwise build a
  // sorted index once so per-frame work is proportional to the visible window, not the file.
  const spikeIndex = useMemo(() => {
    if (!raster || rc.iT < 0 || rc.iRow < 0) return null;
    const v = raster.values;
    const nc = rc.nCols;
    const n = raster.nSpikes;
    let sorted = true;
    for (let i = 1; i < n; i++) {
      if (v[i * nc + rc.iT] < v[(i - 1) * nc + rc.iT]) {
        sorted = false;
        break;
      }
    }
    let order: Uint32Array | null = null;
    if (!sorted) {
      order = new Uint32Array(n);
      for (let i = 0; i < n; i++) order[i] = i;
      order.sort((a, b) => v[a * nc + rc.iT] - v[b * nc + rc.iT]);
    }
    const at = (k: number) => (order ? order[k] : k);
    const tAt = (k: number) => v[at(k) * nc + rc.iT];
    const maxT = n > 0 ? tAt(n - 1) : 0;
    return { n, at, tAt, maxT, sorted };
  }, [raster, rc]);

  // Row ordering: ensemble_A first, then ensemble_B, then other_kc; sorted stably by original row.
  const rowOrder = useMemo(() => {
    const rows = raster?.sidecar.neuron_rows ?? [];
    const rank = (g: string) => (g === 'ensemble_A' ? 0 : g === 'ensemble_B' ? 1 : 2);
    const sorted = [...rows].sort((a, b) => rank(a.group) - rank(b.group) || a.row - b.row);
    const pos = new Map<number, number>();
    const groupOf = new Map<number, string>();
    sorted.forEach((r, i) => {
      pos.set(r.row, i);
      groupOf.set(r.row, r.group);
    });
    const counts = { ensemble_A: 0, ensemble_B: 0, other_kc: 0 } as Record<string, number>;
    rows.forEach((r) => (counts[r.group] = (counts[r.group] ?? 0) + 1));
    return { sorted, pos, groupOf, counts };
  }, [raster]);

  // Trace y-range over the WHOLE trace (including the threshold) so axis labels and the
  // threshold line do not move while playing.
  const traceRange = useMemo(() => {
    if (!trace) return null;
    let lo = Infinity;
    let hi = -Infinity;
    const nc = tc.nCols;
    for (let i = 0; i < trace.nBins; i++) {
      for (const c of [tc.iA, tc.iB]) {
        if (c < 0) continue;
        const yv = trace.values[i * nc + c];
        if (Number.isFinite(yv)) {
          lo = Math.min(lo, yv);
          hi = Math.max(hi, yv);
        }
      }
    }
    const thr = trace.sidecar.threshold_corr;
    if (Number.isFinite(thr)) {
      lo = Math.min(lo, thr);
      hi = Math.max(hi, thr);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      lo = -1;
      hi = 1;
    }
    if (hi - lo < 1e-9) {
      lo -= 0.5;
      hi += 0.5;
    }
    const padY = (hi - lo) * 0.08;
    return { lo: lo - padY, hi: hi + padY };
  }, [trace, tc]);

  const rasterRef = useRef<HTMLCanvasElement>(null);
  const traceRef = useRef<HTMLCanvasElement>(null);
  // state rather than a ref, so the colour resolution below can depend on the wrapper existing
  const [wrap, setWrap] = useState<HTMLDivElement | null>(null);
  // Starts at the narrowest box the mat can give it rather than at a desktop width: 800 inside a
  // ~301px phone mat flashed a horizontal scrollbar and re-rasterised both canvases on the next
  // frame. The observer below grows it immediately.
  const [width, setWidth] = useState(280);

  useEffect(() => {
    if (!wrap) return;
    let raf = 0;
    let pending = 0;
    const ro = new ResizeObserver((entries) => {
      // 280 is below the ~301px content box of the figure mat at a 375px viewport, so the canvas
      // does not overflow its mat on a phone; anything narrower still scrolls inside the mat.
      pending = Math.max(280, Math.floor(entries[0].contentRect.width));
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

  const rasterH = 300;
  const traceH = 150;
  const themeVersion = useThemeVersion();
  const dpr = useCanvasPixelRatio();

  /**
   * The palette as literal canvas colours. Each entry costs a DOM insertion and a forced style
   * recalculation, so it is resolved once per theme change rather than on every animation frame.
   */
  const C = useMemo(() => {
    if (!wrap) return null;
    return resolveColors(wrap, CANVAS_VARS);
    // themeVersion is the signal that the same var() now resolves to a different colour
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrap, themeVersion]);

  /** true when the canvas backing store already has this size: reassigning it clears the canvas. */
  const sizeCanvas = (cv: HTMLCanvasElement, w: number, h: number, dpr: number) => {
    if (cv.width !== Math.round(w * dpr)) cv.width = Math.round(w * dpr);
    if (cv.height !== Math.round(h * dpr)) cv.height = Math.round(h * dpr);
  };

  useEffect(() => {
    const cv = rasterRef.current;
    if (!cv || !C) return;
    const groupColor: Record<string, string> = { ensemble_A: C.A, ensemble_B: C.B, other_kc: C.other };
    sizeCanvas(cv, width, rasterH, dpr);
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, width, rasterH);
    const plotW = width - LEFT - RIGHT;
    const t0 = start;
    const t1 = start + windowS;
    const x = (tS: number) => LEFT + ((tS - t0) / (t1 - t0)) * plotW;
    const plotBottom = rasterH - RASTER_BOTTOM;

    // group bands
    const nRows = rowOrder.sorted.length;
    const rowH = nRows > 0 ? (plotBottom - RASTER_TOP) / nRows : 1;
    let y0 = RASTER_TOP;
    for (const g of ['ensemble_A', 'ensemble_B', 'other_kc']) {
      const n = rowOrder.counts[g] ?? 0;
      if (n === 0) continue;
      ctx.fillStyle = g === 'ensemble_A' ? C.washA : g === 'ensemble_B' ? C.washB : C.washOther;
      ctx.fillRect(LEFT, y0, plotW, n * rowH);
      ctx.fillStyle = groupColor[g];
      ctx.font = FONT_MD;
      ctx.textAlign = 'right';
      ctx.fillText(g === 'ensemble_A' ? 'A' : g === 'ensemble_B' ? 'B' : 'KC', LEFT - 6, y0 + Math.min(12, n * rowH));
      y0 += n * rowH;
    }
    // gridlines
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    for (let k = 0; k <= 4; k++) {
      const xx = LEFT + (plotW * k) / 4;
      ctx.beginPath();
      ctx.moveTo(xx, RASTER_TOP);
      ctx.lineTo(xx, plotBottom);
      ctx.stroke();
    }
    // spikes: only the visible window is scanned (binary search on the time column)
    if (raster && spikeIndex) {
      const v = raster.values;
      const nc = rc.nCols;
      const t0ms = t0 * 1000;
      const t1ms = t1 * 1000;
      const h = Math.max(1, Math.min(3, rowH));
      const byGroup: Record<string, number[]> = { ensemble_A: [], ensemble_B: [], other_kc: [] };
      const first = lowerBound(spikeIndex.n, spikeIndex.tAt, t0ms);
      for (let k = first; k < spikeIndex.n; k++) {
        const i = spikeIndex.at(k);
        const t = v[i * nc + rc.iT];
        if (t >= t1ms) break;
        const row = v[i * nc + rc.iRow];
        const pos = rowOrder.pos.get(row);
        if (pos === undefined) continue;
        const g = rowOrder.groupOf.get(row) ?? 'other_kc';
        (byGroup[g] ??= []).push(x(t / 1000), RASTER_TOP + pos * rowH);
      }
      for (const g of Object.keys(byGroup)) {
        const arr = byGroup[g];
        ctx.fillStyle = groupColor[g] ?? C.other;
        for (let i = 0; i < arr.length; i += 2) ctx.fillRect(arr[i], arr[i + 1], 1.5, h);
      }
    }
    // bottom margin: row count (left) and time ticks (so the raster has a time axis even without a trace)
    ctx.fillStyle = C.axis;
    ctx.font = FONT_SM;
    ctx.textAlign = 'left';
    ctx.fillText(`${nRows} rows`, 2, rasterH - 6);
    ctx.textAlign = 'center';
    for (let k = 0; k <= 4; k++) {
      const tt = t0 + (windowS * k) / 4;
      ctx.fillText(`${fmtNum(tt, 2)} s`, LEFT + (plotW * k) / 4, rasterH - 6);
    }
    // dpr is a dependency, not a value read at draw time: moving the window to a display of a
    // different density (or zooming) changes no CSS size, so without it the backing store would
    // stay at the old ratio and both canvases would render blurry until something else redrew them.
  }, [raster, rc, spikeIndex, rowOrder, start, windowS, width, C, dpr]);

  useEffect(() => {
    const cv = traceRef.current;
    if (!cv || !C) return;
    sizeCanvas(cv, width, traceH, dpr);
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, width, traceH);
    const plotW = width - LEFT - RIGHT;
    const t0 = start;
    const t1 = start + windowS;
    const x = (tS: number) => LEFT + ((tS - t0) / (t1 - t0)) * plotW;
    const top = 8;
    const bottom = traceH - 22;
    // time axis is drawn regardless of whether a trace is loaded
    const drawTimeTicks = () => {
      ctx.fillStyle = C.axis;
      ctx.font = FONT_SM;
      ctx.textAlign = 'center';
      for (let k = 0; k <= 4; k++) {
        const tt = t0 + (windowS * k) / 4;
        ctx.fillText(`${fmtNum(tt, 2)} s`, LEFT + (plotW * k) / 4, traceH - 6);
      }
    };
    if (!trace || !traceRange) {
      ctx.fillStyle = C.axis;
      ctx.font = FONT_MD;
      ctx.textAlign = 'left';
      ctx.fillText('trace file not loaded', LEFT, traceH / 2);
      drawTimeTicks();
      return;
    }
    const { iT, iA, iB } = tc;
    const nc = tc.nCols;
    if (iT < 0 || (iA < 0 && iB < 0)) {
      ctx.fillStyle = C.bad;
      ctx.font = FONT_MD;
      ctx.textAlign = 'left';
      ctx.fillText(`trace sidecar columns ${JSON.stringify(trace.sidecar.columns)} lack t_s / corr_A / corr_B`, LEFT, traceH / 2);
      drawTimeTicks();
      return;
    }
    const { lo, hi } = traceRange;
    const thr = trace.sidecar.threshold_corr;
    const y = (v: number) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);

    ctx.strokeStyle = C.grid;
    for (let k = 0; k <= 4; k++) {
      const xx = LEFT + (plotW * k) / 4;
      ctx.beginPath();
      ctx.moveTo(xx, top);
      ctx.lineTo(xx, bottom);
      ctx.stroke();
    }
    // zero + threshold
    if (lo < 0 && hi > 0) {
      ctx.strokeStyle = C.zero;
      ctx.beginPath();
      ctx.moveTo(LEFT, y(0));
      ctx.lineTo(LEFT + plotW, y(0));
      ctx.stroke();
    }
    if (Number.isFinite(thr)) {
      ctx.strokeStyle = C.threshold;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(LEFT, y(thr));
      ctx.lineTo(LEFT + plotW, y(thr));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // t_s is non-decreasing, so the first visible bin is found once and shared by both lines; the
    // loop then costs the visible window rather than the whole file, on every frame of playback.
    const dt = trace.sidecar.dt_s;
    const firstBin = lowerBound(trace.nBins, (i) => trace.values[i * nc + iT], t0 - dt);
    const drawLine = (ci: number, color: string) => {
      if (ci < 0) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let started = false;
      for (let i = firstBin; i < trace.nBins; i++) {
        const t = trace.values[i * nc + iT];
        if (t > t1 + dt) break;
        const yv = trace.values[i * nc + ci];
        if (!Number.isFinite(yv)) {
          started = false;
          continue;
        }
        if (!started) {
          ctx.moveTo(x(t), y(yv));
          started = true;
        } else ctx.lineTo(x(t), y(yv));
      }
      ctx.stroke();
    };
    drawLine(iB, C.B);
    drawLine(iA, C.A);
    // axes labels
    ctx.fillStyle = C.axis;
    ctx.font = FONT_SM;
    ctx.textAlign = 'right';
    ctx.fillText(fmtNum(hi, 2), LEFT - 4, top + 9);
    ctx.fillText(fmtNum(lo, 2), LEFT - 4, bottom);
    drawTimeTicks();
  }, [trace, tc, traceRange, start, windowS, width, C, dpr]);

  const rasterCols = raster?.sidecar.columns ?? [];

  return (
    <div ref={setWrap} className="w-full">
      <canvas ref={rasterRef} style={{ width, height: rasterH }} className="block border border-rule" />
      <canvas ref={traceRef} style={{ width, height: traceH }} className="block border border-t-0 border-rule" />
      <div className="legend mt-3">
        <span>
          <i className="swatch" style={{ background: SERIES.A }} /> ensemble A ({fmtInt(rowOrder.counts.ensemble_A ?? 0)} rows) / corr_A
        </span>
        <span>
          <i className="swatch" style={{ background: SERIES.B }} /> ensemble B ({fmtInt(rowOrder.counts.ensemble_B ?? 0)} rows) / corr_B
        </span>
        <span>
          <i className="swatch" style={{ background: SERIES.other }} /> other KC ({fmtInt(rowOrder.counts.other_kc ?? 0)} rows)
        </span>
        <span>
          <i className="swatch swatch--line" style={{ background: SERIES.threshold }} /> threshold
          {trace ? ` = ${fmtNum(trace.sidecar.threshold_corr, 3)} (${trace.sidecar.threshold_source})` : ''}
        </span>
        {raster && (
          <span>
            {fmtInt(raster.nSpikes)} spikes in file · columns <span className="mono">{rasterCols.join(', ')}</span> · {fmtInt(rowOrder.sorted.length)} neuron rows listed
            in sidecar
            {spikeIndex && !spikeIndex.sorted ? ' · (file not time-sorted; sorted on load)' : ''}
          </span>
        )}
      </div>
    </div>
  );
}

/** Memoised: the page's play loop re-renders its parent on every frame, this only on its own props. */
const RasterViewer = memo(RasterViewerInner);
export default RasterViewer;
