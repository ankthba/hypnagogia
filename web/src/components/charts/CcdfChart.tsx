import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { SERIES, TOOLTIP_STYLE, seedColor } from '../../lib/colors';
import { fmtNum, fmtInt } from '../../lib/format';

export { seedColor };

/** Decade tick label for a log axis: 1, 10, 100 … above 1; 0.1, 0.01 down to 1e-2; exponential below. Never "0". */
function decadeLabel(v: number): string {
  if (!(v > 0)) return '';
  if (v >= 1) return fmtInt(Math.round(v));
  if (v >= 1e-2) return String(v);
  return v.toExponential(0);
}

export interface CcdfSeries {
  name: string;
  color: string;
  x: number[];
  y: number[];
}

const TICK = { fontSize: 12, fill: SERIES.axis };

/** Log-log CCDF. Points with x<=0 or y<=0 are not drawable on log axes and are dropped (count reported). */
export default function CcdfChart({ series, xLabel, height = 280 }: { series: CcdfSeries[]; xLabel: string; height?: number }) {
  const prepared = series.map((s) => {
    const pts: { x: number; y: number }[] = [];
    let dropped = 0;
    for (let i = 0; i < Math.min(s.x.length, s.y.length); i++) {
      const x = s.x[i];
      const y = s.y[i];
      if (x > 0 && y > 0 && Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
      else dropped++;
    }
    return { ...s, pts, dropped };
  });
  const total = prepared.reduce((a, s) => a + s.pts.length, 0);
  const allX = prepared.flatMap((s) => s.pts.map((p) => p.x));
  const allY = prepared.flatMap((s) => s.pts.map((p) => p.y));
  const xd = decadeDomain(allX);
  const yd = decadeDomain(allY);
  const dropped = prepared.reduce((a, s) => a + s.dropped, 0);
  if (total === 0) {
    return <div className="small muted py-8 text-center">CCDF arrays are empty for this selection (no avalanches to plot).</div>;
  }
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart margin={{ top: 10, right: 16, bottom: 28, left: 8 }}>
          <CartesianGrid stroke={SERIES.grid} />
          <XAxis
            type="number"
            dataKey="x"
            scale="log"
            domain={xd.domain}
            ticks={xd.ticks}
            stroke={SERIES.axis}
            tick={TICK}
            tickFormatter={(v) => decadeLabel(Number(v))}
            label={{ value: xLabel, position: 'insideBottom', offset: -16, fill: SERIES.axis, fontSize: 13 }}
          />
          <YAxis
            type="number"
            dataKey="y"
            scale="log"
            domain={yd.domain}
            ticks={yd.ticks}
            stroke={SERIES.axis}
            tick={TICK}
            tickFormatter={(v) => decadeLabel(Number(v))}
            label={{ value: 'P(X ≥ x)', angle: -90, position: 'insideLeft', fill: SERIES.axis, fontSize: 13 }}
          />
          <Tooltip cursor={{ stroke: SERIES.axis }} contentStyle={TOOLTIP_STYLE} formatter={(v: number) => fmtNum(v, 4)} />
          <Legend verticalAlign="top" height={24} wrapperStyle={{ fontSize: 13, color: SERIES.axis }} />
          {prepared.map((s) => (
            <Scatter key={s.name} name={s.name} data={s.pts} fill={s.color} line={{ stroke: s.color, strokeWidth: 1 }} shape={<circle r={2} />} isAnimationActive={false} />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
      {dropped > 0 && <div className="smaller muted">{dropped} point(s) with x ≤ 0 or y ≤ 0 not drawable on log axes.</div>}
    </div>
  );
}

/** Decade (power-of-ten) domain and ticks spanning the positive data. */
function decadeDomain(vals: number[]): { domain: [number, number]; ticks: number[] } {
  if (vals.length === 0) return { domain: [1, 10], ticks: [1, 10] };
  const lo = Math.floor(Math.log10(Math.min(...vals)));
  let hi = Math.ceil(Math.log10(Math.max(...vals)));
  if (hi === lo) hi = lo + 1; // always span at least one decade (single-point series)
  const ticks: number[] = [];
  for (let e = lo; e <= hi; e++) ticks.push(Math.pow(10, e));
  return { domain: [Math.pow(10, lo), Math.pow(10, hi)], ticks };
}
