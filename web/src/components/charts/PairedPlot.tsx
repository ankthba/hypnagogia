import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { SERIES, TOOLTIP_STYLE } from '../../lib/colors';
import { fmtNum } from '../../lib/format';
import { useNarrowBox } from '../../lib/media';

export interface PairedSeed {
  seed: number;
  pre: number;
  post: number;
}

const TICK = { fontSize: 12, fill: SERIES.axis };
/** Axis names and legend entries, narrow / wide. Nothing here goes below 12px. */
const LABEL_FS = { sm: 12.5, lg: 13 };

/**
 * Pre vs post paired plot: one thin line per seed (spread visible), one thick line for the mean.
 */
export default function PairedPlot({ seeds, color, label, height = 260 }: { seeds: PairedSeed[]; color: string; label: string; height?: number }) {
  // narrow follows the width of the box the chart is drawn into, not the window's (see useNarrowBox)
  const { ref: boxRef, narrow } = useNarrowBox();
  const rows = [
    { phase: 'pre', ...Object.fromEntries(seeds.map((s) => [`s${s.seed}`, s.pre])) },
    { phase: 'post', ...Object.fromEntries(seeds.map((s) => [`s${s.seed}`, s.post])) },
  ] as Record<string, number | string>[];
  if (seeds.length > 0) {
    rows[0].mean = seeds.reduce((a, s) => a + s.pre, 0) / seeds.length;
    rows[1].mean = seeds.reduce((a, s) => a + s.post, 0) / seeds.length;
  }
  return (
    <div ref={boxRef}>
    <ResponsiveContainer width="100%" height={narrow ? Math.max(200, Math.round(height * 0.85)) : height} minHeight={190}>
      <LineChart data={rows} margin={narrow ? { top: 8, right: 12, bottom: 4, left: 0 } : { top: 10, right: 24, bottom: 8, left: 8 }}>
        <CartesianGrid stroke={SERIES.grid} />
        <XAxis
          dataKey="phase"
          type="category"
          stroke={SERIES.axis}
          tick={{ ...TICK, fontSize: narrow ? 12 : 13 }}
          padding={{ left: narrow ? 24 : 40, right: narrow ? 24 : 40 }}
        />
        <YAxis
          stroke={SERIES.axis}
          tick={TICK}
          width={narrow ? 46 : 66}
          tickCount={narrow ? 4 : undefined}
          tickFormatter={(v) => fmtNum(v, 3)}
          label={narrow ? undefined : { value: label, angle: -90, position: 'insideLeft', fill: SERIES.axis, fontSize: LABEL_FS.lg }}
        />
        <Tooltip cursor={{ stroke: SERIES.axis }} contentStyle={TOOLTIP_STYLE} formatter={(v: number) => fmtNum(v, 4)} />
        <Legend wrapperStyle={{ fontSize: narrow ? LABEL_FS.sm : LABEL_FS.lg, color: SERIES.axis, lineHeight: 1.4 }} />
        {seeds.map((s) => (
          <Line key={s.seed} type="linear" dataKey={`s${s.seed}`} name={`seed ${s.seed}`} stroke={color} strokeOpacity={0.4} strokeWidth={1.2} dot={{ r: 3, fill: color, strokeWidth: 0 }} isAnimationActive={false} />
        ))}
        {seeds.length > 0 && <Line type="linear" dataKey="mean" name="mean" stroke={color} strokeWidth={2.5} dot={{ r: 5, fill: color, stroke: SERIES.mat, strokeWidth: 1.5 }} isAnimationActive={false} />}
      </LineChart>
    </ResponsiveContainer>
    {narrow && <div className="smaller muted">vertical axis: {label}.</div>}
    </div>
  );
}
