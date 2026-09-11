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
import type { Classification } from '../../types';
import { CLASS_COLORS, CLASS_BAND, SERIES } from '../../lib/colors';
import { fmtNum } from '../../lib/format';

export interface SigmaPoint {
  sigma: number;
  y: number;
  cls: Classification;
  seed: number;
  /** [downOffset, upOffset] for error bars (offsets from y, per Recharts ErrorBar). */
  err?: [number, number];
  ciText?: string;
}

export interface SigmaBand {
  sigma: number;
  cls: Classification;
}

const CLASSES: Classification[] = ['silent', 'critical', 'saturated', 'indeterminate'];

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
  const edges = bandEdges(bands.map((b) => b.sigma));
  const bandCls = new Map(bands.map((b) => [b.sigma, b.cls]));
  const xs = edges.map((e) => e.s);
  const xMin = edges.length ? Math.min(...edges.map((e) => e.lo)) : 0.1;
  const xMax = edges.length ? Math.max(...edges.map((e) => e.hi)) : 10;
  const present = CLASSES.filter((c) => points.some((p) => p.cls === c));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 10, right: 16, bottom: 28, left: 8 }}>
        <CartesianGrid stroke={SERIES.grid} />
        {edges.map((e) => {
          const cls = bandCls.get(e.s) ?? 'indeterminate';
          return <ReferenceArea key={e.s} x1={e.lo} x2={e.hi} fill={CLASS_BAND[cls]} stroke="none" ifOverflow="hidden" />;
        })}
        <XAxis
          type="number"
          dataKey="sigma"
          scale="log"
          domain={[xMin, xMax]}
          ticks={xs}
          tickFormatter={(v) => fmtNum(v, 3)}
          stroke={SERIES.axis}
          tick={{ fontSize: 11 }}
          label={{ value: 'noise sigma (mV)', position: 'insideBottom', offset: -16, fill: SERIES.axis, fontSize: 12 }}
        />
        <YAxis
          type="number"
          dataKey="y"
          domain={yDomain ?? ['auto', 'auto']}
          stroke={SERIES.axis}
          tick={{ fontSize: 11 }}
          tickFormatter={(v) => fmtNum(v, 3)}
          label={{ value: yLabel, angle: -90, position: 'insideLeft', fill: SERIES.axis, fontSize: 12 }}
        />
        {refY?.map((r) => (
          <ReferenceLine key={r.label} y={r.y} stroke="#e2e8f0" strokeDasharray="4 4" label={{ value: r.label, fill: '#cbd5e1', fontSize: 11, position: 'right' }} />
        ))}
        <Tooltip
          cursor={{ stroke: '#475569' }}
          contentStyle={{ background: '#0f172a', border: '1px solid #334155', fontSize: 12 }}
          formatter={(v: number) => fmtNum(v, 4)}
          labelFormatter={() => ''}
          content={({ payload }) => {
            const p = payload?.[0]?.payload as SigmaPoint | undefined;
            if (!p) return null;
            return (
              <div className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs">
                <div>sigma = {fmtNum(p.sigma, 3)} mV · seed {p.seed}</div>
                <div>
                  {yLabel}: {fmtNum(p.y, 4)}
                  {p.ciText ? ` ${p.ciText}` : ''}
                </div>
                <div style={{ color: CLASS_COLORS[p.cls] }}>{p.cls}</div>
              </div>
            );
          }}
        />
        <Legend
          verticalAlign="top"
          height={24}
          payload={present.map((c) => ({ value: c, type: 'circle', color: CLASS_COLORS[c], id: c }))}
          wrapperStyle={{ fontSize: 12 }}
        />
        <Scatter data={points} isAnimationActive={false}>
          {points.some((p) => p.err) && <ErrorBar dataKey="err" width={4} strokeWidth={1.2} stroke="#cbd5e1" direction="y" />}
          {points.map((p, i) => (
            <Cell key={i} fill={CLASS_COLORS[p.cls]} stroke="#0f172a" />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}
