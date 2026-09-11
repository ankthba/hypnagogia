import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { SERIES } from '../../lib/colors';
import { fmtNum } from '../../lib/format';

export interface PairedSeed {
  seed: number;
  pre: number;
  post: number;
}

/**
 * Pre vs post paired plot: one thin line per seed (spread visible), one thick line for the mean.
 */
export default function PairedPlot({ seeds, color, label, height = 260 }: { seeds: PairedSeed[]; color: string; label: string; height?: number }) {
  const rows = [
    { phase: 'pre', ...Object.fromEntries(seeds.map((s) => [`s${s.seed}`, s.pre])) },
    { phase: 'post', ...Object.fromEntries(seeds.map((s) => [`s${s.seed}`, s.post])) },
  ] as Record<string, number | string>[];
  if (seeds.length > 0) {
    rows[0].mean = seeds.reduce((a, s) => a + s.pre, 0) / seeds.length;
    rows[1].mean = seeds.reduce((a, s) => a + s.post, 0) / seeds.length;
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={{ top: 10, right: 24, bottom: 8, left: 8 }}>
        <CartesianGrid stroke={SERIES.grid} />
        <XAxis dataKey="phase" type="category" stroke={SERIES.axis} tick={{ fontSize: 12 }} padding={{ left: 40, right: 40 }} />
        <YAxis stroke={SERIES.axis} tick={{ fontSize: 11 }} tickFormatter={(v) => fmtNum(v, 3)} label={{ value: label, angle: -90, position: 'insideLeft', fill: SERIES.axis, fontSize: 12 }} />
        <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', fontSize: 12 }} formatter={(v: number) => fmtNum(v, 4)} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {seeds.map((s) => (
          <Line key={s.seed} type="linear" dataKey={`s${s.seed}`} name={`seed ${s.seed}`} stroke={color} strokeOpacity={0.45} strokeWidth={1.2} dot={{ r: 3, fill: color, strokeWidth: 0 }} isAnimationActive={false} />
        ))}
        {seeds.length > 0 && <Line type="linear" dataKey="mean" name="mean" stroke={color} strokeWidth={3} dot={{ r: 5, fill: color, stroke: '#0f172a' }} isAnimationActive={false} />}
      </LineChart>
    </ResponsiveContainer>
  );
}
