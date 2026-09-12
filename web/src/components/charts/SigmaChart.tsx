import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
  ErrorBar,
  Cell,
  Legend,
} from 'recharts';
import { CLASS_LABELS, classColor, classBand, SERIES, type ClassLabel } from '../../lib/colors';
import { fmtNum } from '../../lib/format';
import { useNarrowViewport } from '../../lib/media';

export interface SigmaPoint {
  sigma: number;
  y: number;
  /** classification label from the file; anything outside the known set is drawn as indeterminate */
  cls: ClassLabel | string;
  seed: number;
  /** [downOffset, upOffset] for error bars (offsets from y, per Recharts ErrorBar). */
  err?: [number, number];
  ciText?: string;
}

export interface SigmaBand {
  sigma: number;
  cls: ClassLabel | string;
}

const TICK = { fontSize: 12, fill: SERIES.axis };
const TICK_SM = { fontSize: 10, fill: SERIES.axis };

/** Keep at most `max` ticks, both ends included, so sigma labels cannot collide on a phone. */
function thinTicks(ticks: number[], max: number): number[] {
  if (ticks.length <= max) return ticks;
  const step = Math.ceil((ticks.length - 1) / (max - 1));
  const out = ticks.filter((_, i) => i % step === 0);
  if (out[out.length - 1] !== ticks[ticks.length - 1]) out.push(ticks[ticks.length - 1]);
  return out;
}

/** Geometric band edges around each sigma on a log axis. */
function bandEdges(sigmas: number[]): { s: number; lo: number; hi: number }[] {
  const s = [...new Set(sigmas)].filter((v) => v > 0).sort((a, b) => a - b);
  return s.map((v, i) => {
    const prev = i > 0 ? s[i - 1] : null;
    const next = i < s.length - 1 ? s[i + 1] : null;
    const lo = prev !== null ? Math.sqrt(prev * v) : next !== null ? v / Math.sqrt(next / v) : v / 1.3;
    const hi = next !== null ? Math.sqrt(next * v) : prev !== null ? v * Math.sqrt(v / prev) : v * 1.3;
    return { s: v, lo, hi };
  });
}

export default function SigmaChart({
  points,
  bands,
  yLabel,
  refY,
  height = 260,
  yDomain,
}: {
  points: SigmaPoint[];
  bands: SigmaBand[];
  yLabel: string;
  refY?: { y: number; label: string }[];
  height?: number;
  yDomain?: [number | 'auto', number | 'auto'];
}) {
  const narrow = useNarrowViewport();
  const edges = bandEdges(bands.map((b) => b.sigma));
  const bandCls = new Map(bands.map((b) => [b.sigma, b.cls]));
  const xs = edges.map((e) => e.s);
  const xMin = edges.length ? Math.min(...edges.map((e) => e.lo)) : 0.1;
  const xMax = edges.length ? Math.max(...edges.map((e) => e.hi)) : 10;
  // sigma <= 0 (e.g. a no-noise baseline) and non-finite y cannot be drawn on a log x axis; they are
  // dropped from the plot and counted below so the omission is visible.
  const drawable = points.filter((p) => typeof p.sigma === 'number' && p.sigma > 0 && typeof p.y === 'number' && Number.isFinite(p.y));
  const dropped = points.length - drawable.length;
  const droppedSigma0 = points.filter((p) => !(typeof p.sigma === 'number' && p.sigma > 0)).length;
  const known = new Set<string>(CLASS_LABELS);
  const present: string[] = [
    ...CLASS_LABELS.filter((c) => drawable.some((p) => p.cls === c)),
    ...[...new Set(drawable.map((p) => String(p.cls)).filter((c) => !known.has(c)))],
  ];

  // Narrow: at most four sigma ticks, smaller type, no rotated labels needed, and the y-axis name
  // moves out of the SVG into a line of text under it so the plot keeps its width.
  const tick = narrow ? TICK_SM : TICK;
  const h = narrow ? Math.max(200, Math.round(height * 0.82)) : height;
  const xTicks = narrow ? thinTicks(xs, 4) : xs;
  return (
    <div>
      <ResponsiveContainer width="100%" height={h} minHeight={190}>
        <ScatterChart margin={narrow ? { top: 8, right: 10, bottom: 24, left: 0 } : { top: 10, right: 16, bottom: 28, left: 8 }}>
          <CartesianGrid stroke={SERIES.grid} />
          {edges.map((e) => (
            <ReferenceArea key={e.s} x1={e.lo} x2={e.hi} fill={classBand(bandCls.get(e.s))} fillOpacity={1} stroke="none" ifOverflow="hidden" />
          ))}
          <XAxis
            type="number"
            dataKey="sigma"
            scale="log"
            domain={[xMin, xMax]}
            allowDataOverflow
            ticks={xTicks}
            tickFormatter={(v) => fmtNum(v, 3)}
            stroke={SERIES.axis}
            tick={tick}
            minTickGap={narrow ? 12 : 5}
            label={{ value: 'noise sigma (mV)', position: 'insideBottom', offset: narrow ? -14 : -16, fill: SERIES.axis, fontSize: narrow ? 11 : 13 }}
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={yDomain ?? ['auto', 'auto']}
            stroke={SERIES.axis}
            tick={tick}
            width={narrow ? 42 : 66}
            tickCount={narrow ? 4 : undefined}
            tickFormatter={(v) => fmtNum(v, 3)}
            label={narrow ? undefined : { value: yLabel, angle: -90, position: 'insideLeft', fill: SERIES.axis, fontSize: 13 }}
          />
          {refY?.map((r) => (
            <ReferenceLine key={r.label} y={r.y} stroke={SERIES.ink} strokeDasharray="4 4" label={{ value: r.label, fill: SERIES.ink, fontSize: 12, position: 'right' }} />
          ))}
          <Tooltip
            cursor={{ stroke: SERIES.axis }}
            formatter={(v: number) => fmtNum(v, 4)}
            labelFormatter={() => ''}
            content={({ payload }) => {
              const p = payload?.[0]?.payload as SigmaPoint | undefined;
              if (!p) return null;
              return (
                <div className="mat" style={{ padding: '4px 8px', fontSize: 13, lineHeight: 1.4 }}>
                  <div>sigma = {fmtNum(p.sigma, 3)} mV · seed {p.seed}</div>
                  <div>
                    {yLabel}: {fmtNum(p.y, 4)}
                    {p.ciText ? ` ${p.ciText}` : ''}
                  </div>
                  <div style={{ color: classColor(p.cls) }}>{p.cls}</div>
                </div>
              );
            }}
          />
          <Legend
            verticalAlign="top"
            height={narrow ? 40 : 24}
            payload={present.map((c) => ({ value: c, type: 'circle', color: classColor(c), id: c }))}
            wrapperStyle={{ fontSize: narrow ? 11 : 13, color: SERIES.axis, lineHeight: 1.4 }}
          />
          <Scatter data={drawable} isAnimationActive={false}>
            {drawable.some((p) => p.err) && <ErrorBar dataKey="err" width={4} strokeWidth={1.2} stroke={SERIES.ink} direction="y" />}
            {drawable.map((p, i) => (
              <Cell key={i} fill={classColor(p.cls)} stroke={SERIES.mat} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      {narrow && <div className="smaller muted">vertical axis: {yLabel}.</div>}
      {dropped > 0 && (
        <div className="smaller tone-failed">
          {dropped} point(s) not drawn: {droppedSigma0 > 0 && `${droppedSigma0} at sigma ≤ 0 (not drawable on a log axis)`}
          {droppedSigma0 > 0 && dropped - droppedSigma0 > 0 && '; '}
          {dropped - droppedSigma0 > 0 && `${dropped - droppedSigma0} with a null / non-finite y value`}.
        </div>
      )}
    </div>
  );
}
