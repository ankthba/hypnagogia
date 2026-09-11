import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { SERIES } from '../../lib/colors';
import { fmtNum } from '../../lib/format';

export interface CcdfSeries {
  name: string;
  color: string;
  x: number[];
  y: number[];
}

const PALETTE = ['#34d399', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#22d3ee', '#fb923c', '#e2e8f0'];
export function seedColor(i: number) {
  return PALETTE[i % PALETTE.length];
}

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
  const dropped = prepared.reduce((a, s) => a + s.dropped, 0);
  if (total === 0) {
    return <div className="text-sm text-slate-500 py-8 text-center">CCDF arrays are empty for this selection (no avalanches to plot).</div>;
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
            domain={['auto', 'auto']}
            stroke={SERIES.axis}
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => fmtNum(v, 2)}
            label={{ value: xLabel, position: 'insideBottom', offset: -16, fill: SERIES.axis, fontSize: 12 }}
          />
          <YAxis
            type="number"
            dataKey="y"
            scale="log"
            domain={['auto', 'auto']}
            stroke={SERIES.axis}
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => fmtNum(v, 2)}
            label={{ value: 'P(X ≥ x)', angle: -90, position: 'insideLeft', fill: SERIES.axis, fontSize: 12 }}
          />
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid #334155', fontSize: 12 }}
            formatter={(v: number) => fmtNum(v, 4)}
          />
          <Legend verticalAlign="top" height={24} wrapperStyle={{ fontSize: 12 }} />
          {prepared.map((s) => (
            <Scatter key={s.name} name={s.name} data={s.pts} fill={s.color} line={{ stroke: s.color, strokeWidth: 1 }} shape={<circle r={2} />} isAnimationActive={false} />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
      {dropped > 0 && <div className="text-xs text-slate-500">{dropped} point(s) with x ≤ 0 or y ≤ 0 not drawable on log axes.</div>}
    </div>
  );
}
