import { useEffect, useMemo, useRef, useState } from 'react';
import type { RasterData, TraceData } from '../../lib/binary';
import { SERIES } from '../../lib/colors';
import { fmtNum, fmtInt } from '../../lib/format';

const LEFT = 56;
const RIGHT = 12;
const GROUP_COLOR: Record<string, string> = { ensemble_A: SERIES.A, ensemble_B: SERIES.B, other_kc: SERIES.other };

/**
 * Spike raster (canvas) over a scrubbable window, with the template-correlation trace
 * drawn beneath on an identically-mapped time axis.
 */
export default function RasterViewer({ raster, trace }: { raster: RasterData | null; trace: TraceData | null }) {
  const durationS = useMemo(() => {
    const cands = [raster?.sidecar.duration_s ?? 0];
    if (trace) cands.push(trace.nBins * (trace.sidecar.dt_s || 0));
    if (raster && raster.nSpikes > 0) {
      let maxT = 0;
      for (let i = 0; i < raster.nSpikes; i++) maxT = Math.max(maxT, raster.values[i * 2]);
      cands.push(maxT / 1000);
    }
    return Math.max(...cands, 0.001);
  }, [raster, trace]);

  const [windowS, setWindowS] = useState(2);
  const [start, setStart] = useState(0);
  const [playing, setPlaying] = useState(false);
  const maxStart = Math.max(0, durationS - windowS);

  useEffect(() => {
    setStart((s) => Math.min(s, Math.max(0, durationS - windowS)));
  }, [durationS, windowS]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setStart((s) => {
        const n = s + dt; // 1x real time
        if (n >= maxStart) {
          setPlaying(false);
          return maxStart;
        }
        return n;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, maxStart]);

  // Row ordering: ensemble_A first, then ensemble_B, then other_kc; sorted stably by original row.
  const rowOrder = useMemo(() => {
    const rows = raster?.sidecar.neuron_rows ?? [];
    const rank = (g: string) => (g === 'ensemble_A' ? 0 : g === 'ensemble_B' ? 1 : 2);
    const sorted = [...rows].sort((a, b) => rank(a.group) - rank(b.group) || a.row - b.row);
    const pos = new Map<number, number>();
    sorted.forEach((r, i) => pos.set(r.row, i));
    const counts = { ensemble_A: 0, ensemble_B: 0, other_kc: 0 } as Record<string, number>;
    rows.forEach((r) => (counts[r.group] = (counts[r.group] ?? 0) + 1));
    return { sorted, pos, counts };
  }, [raster]);

  // Spike indices are sorted by time in the export; if not, we still scan (O(n) per frame, fine at 2e5).
  const rasterRef = useRef<HTMLCanvasElement>(null);
  const traceRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(Math.max(320, Math.floor(entries[0].contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rasterH = 300;
  const traceH = 150;

  useEffect(() => {
    const cv = rasterRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = width * dpr;
    cv.height = rasterH * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, width, rasterH);
    const plotW = width - LEFT - RIGHT;
    const t0 = start;
    const t1 = start + windowS;
    const x = (tS: number) => LEFT + ((tS - t0) / (t1 - t0)) * plotW;

    // group bands
    const nRows = rowOrder.sorted.length;
    const rowH = nRows > 0 ? (rasterH - 20) / nRows : 1;
    let y0 = 10;
    for (const g of ['ensemble_A', 'ensemble_B', 'other_kc']) {
      const n = rowOrder.counts[g] ?? 0;
      if (n === 0) continue;
      ctx.fillStyle = g === 'ensemble_A' ? 'rgba(244,114,182,0.06)' : g === 'ensemble_B' ? 'rgba(34,211,238,0.06)' : 'rgba(100,116,139,0.05)';
      ctx.fillRect(LEFT, y0, plotW, n * rowH);
      ctx.fillStyle = GROUP_COLOR[g];
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(g === 'ensemble_A' ? 'A' : g === 'ensemble_B' ? 'B' : 'KC', LEFT - 6, y0 + Math.min(12, n * rowH));
      y0 += n * rowH;
    }
    // gridlines
    ctx.strokeStyle = SERIES.grid;
    ctx.lineWidth = 1;
    for (let k = 0; k <= 4; k++) {
      const xx = LEFT + (plotW * k) / 4;
      ctx.beginPath();
      ctx.moveTo(xx, 10);
      ctx.lineTo(xx, rasterH - 10);
      ctx.stroke();
    }
    // spikes
    if (raster) {
      const v = raster.values;
      const groupOf = new Map<number, string>();
      raster.sidecar.neuron_rows.forEach((r) => groupOf.set(r.row, r.group));
      const t0ms = t0 * 1000;
      const t1ms = t1 * 1000;
      const h = Math.max(1, Math.min(3, rowH));
      const byGroup: Record<string, number[]> = { ensemble_A: [], ensemble_B: [], other_kc: [] };
      for (let i = 0; i < raster.nSpikes; i++) {
        const t = v[i * 2];
        if (t < t0ms || t >= t1ms) continue;
        const row = v[i * 2 + 1];
        const pos = rowOrder.pos.get(row);
        if (pos === undefined) continue;
        const g = groupOf.get(row) ?? 'other_kc';
        (byGroup[g] ??= []).push(x(t / 1000), 10 + pos * rowH);
      }
      for (const g of Object.keys(byGroup)) {
        const arr = byGroup[g];
        ctx.fillStyle = GROUP_COLOR[g] ?? SERIES.other;
        for (let i = 0; i < arr.length; i += 2) ctx.fillRect(arr[i], arr[i + 1], 1.5, h);
      }
    }
    ctx.fillStyle = SERIES.axis;
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${nRows} rows`, LEFT, rasterH - 1);
  }, [raster, rowOrder, start, windowS, width]);

  useEffect(() => {
    const cv = traceRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = width * dpr;
    cv.height = traceH * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, width, traceH);
    const plotW = width - LEFT - RIGHT;
    const t0 = start;
    const t1 = start + windowS;
    const x = (tS: number) => LEFT + ((tS - t0) / (t1 - t0)) * plotW;
    const top = 8;
    const bottom = traceH - 22;
    if (!trace) {
      ctx.fillStyle = SERIES.axis;
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillText('trace file not loaded', LEFT, traceH / 2);
      return;
    }
    const cols = trace.sidecar.columns;
    const iT = cols.indexOf('t_s');
    const iA = cols.indexOf('corr_A');
    const iB = cols.indexOf('corr_B');
    const nc = trace.nCols;
    // y range over visible window (fallback to whole)
    let lo = Infinity;
    let hi = -Infinity;
    const thr = trace.sidecar.threshold_corr;
    for (let i = 0; i < trace.nBins; i++) {
      const t = iT >= 0 ? trace.values[i * nc + iT] : i * trace.sidecar.dt_s;
      if (t < t0 || t > t1) continue;
      for (const c of [iA, iB]) {
        if (c < 0) continue;
        const yv = trace.values[i * nc + c];
        if (Number.isFinite(yv)) {
          lo = Math.min(lo, yv);
          hi = Math.max(hi, yv);
        }
      }
    }
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
    lo -= padY;
    hi += padY;
    const y = (v: number) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);

    ctx.strokeStyle = SERIES.grid;
    for (let k = 0; k <= 4; k++) {
      const xx = LEFT + (plotW * k) / 4;
      ctx.beginPath();
      ctx.moveTo(xx, top);
      ctx.lineTo(xx, bottom);
      ctx.stroke();
    }
    // zero + threshold
    if (lo < 0 && hi > 0) {
      ctx.strokeStyle = '#334155';
      ctx.beginPath();
      ctx.moveTo(LEFT, y(0));
      ctx.lineTo(LEFT + plotW, y(0));
      ctx.stroke();
    }
    if (Number.isFinite(thr)) {
      ctx.strokeStyle = SERIES.threshold;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(LEFT, y(thr));
      ctx.lineTo(LEFT + plotW, y(thr));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const drawLine = (ci: number, color: string) => {
      if (ci < 0) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < trace.nBins; i++) {
        const t = iT >= 0 ? trace.values[i * nc + iT] : i * trace.sidecar.dt_s;
        if (t < t0 - trace.sidecar.dt_s || t > t1 + trace.sidecar.dt_s) continue;
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
    drawLine(iB, SERIES.B);
    drawLine(iA, SERIES.A);
    // axes labels
    ctx.fillStyle = SERIES.axis;
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(fmtNum(hi, 2), LEFT - 4, top + 9);
    ctx.fillText(fmtNum(lo, 2), LEFT - 4, bottom);
    ctx.textAlign = 'center';
    for (let k = 0; k <= 4; k++) {
      const tt = t0 + (windowS * k) / 4;
      ctx.fillText(`${fmtNum(tt, 2)} s`, LEFT + (plotW * k) / 4, traceH - 6);
    }
  }, [trace, start, windowS, width]);

  return (
    <div ref={wrapRef} className="w-full">
      <div className="flex flex-wrap items-center gap-3 mb-2 text-sm">
        <button
          className="rounded border border-slate-600 bg-slate-800 px-3 py-1 text-slate-100 hover:bg-slate-700"
          onClick={() => {
            if (!playing && start >= maxStart) setStart(0);
            setPlaying((p) => !p);
          }}
          disabled={!raster && !trace}
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
          className="flex-1 min-w-[160px] accent-slate-300"
          aria-label="window start (s)"
        />
        <span className="mono text-slate-300 tabular-nums">
          {fmtNum(start, 2)} – {fmtNum(start + windowS, 2)} s / {fmtNum(durationS, 2)} s
        </span>
        <label className="flex items-center gap-1 text-slate-400">
          window
          <select className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-slate-100" value={windowS} onChange={(e) => setWindowS(Number(e.target.value))}>
            {[0.5, 1, 2, 5, 10].map((w) => (
              <option key={w} value={w}>
                {w} s
              </option>
            ))}
          </select>
        </label>
      </div>
      <canvas ref={rasterRef} style={{ width, height: rasterH }} className="block rounded-t border border-slate-800" />
      <canvas ref={traceRef} style={{ width, height: traceH }} className="block rounded-b border border-t-0 border-slate-800" />
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-400">
        <span>
          <i className="inline-block h-2 w-2 rounded-sm mr-1" style={{ background: SERIES.A }} /> ensemble A ({fmtInt(rowOrder.counts.ensemble_A ?? 0)} rows) / corr_A
        </span>
        <span>
          <i className="inline-block h-2 w-2 rounded-sm mr-1" style={{ background: SERIES.B }} /> ensemble B ({fmtInt(rowOrder.counts.ensemble_B ?? 0)} rows) / corr_B
        </span>
        <span>
          <i className="inline-block h-2 w-2 rounded-sm mr-1" style={{ background: SERIES.other }} /> other KC ({fmtInt(rowOrder.counts.other_kc ?? 0)} rows)
        </span>
        <span>
          <i className="inline-block h-0.5 w-3 align-middle mr-1" style={{ background: SERIES.threshold }} /> threshold
          {trace ? ` = ${fmtNum(trace.sidecar.threshold_corr, 3)} (${trace.sidecar.threshold_source})` : ''}
        </span>
        {raster && <span>{fmtInt(raster.nSpikes)} spikes in file (1 ms resolution, ensemble neurons only)</span>}
      </div>
    </div>
  );
}
