import type { Comparison } from '../../types';
import { fmtNum, fmtCI, fmtP, fmtInt } from '../../lib/format';

/**
 * Effect sizes (Hedges g) with 95% CI whiskers and a zero line, one row per comparison.
 * Each row is marked survives / does not survive from the file, never inferred.
 */
export default function ForestPlot({ comparisons }: { comparisons: Comparison[] }) {
  const rows = comparisons ?? [];
  if (rows.length === 0) return <div className="text-sm text-slate-500">no comparisons in file</div>;

  const vals = rows.flatMap((c) => [c.hedges_g, c.g_ci95?.[0], c.g_ci95?.[1]]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  let lo = Math.min(0, ...vals);
  let hi = Math.max(0, ...vals);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.1;
  lo -= pad;
  hi += pad;

  const W = 720;
  const labelW = 250;
  const plotW = W - labelW - 130;
  const rowH = 44;
  const top = 26;
  const H = top + rows.length * rowH + 30;
  const x = (v: number) => labelW + ((v - lo) / (hi - lo)) * plotW;

  const ticks = niceTicks(lo, hi, 6);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[640px]" role="img" aria-label="Effect sizes with 95% confidence intervals">
      <line x1={x(0)} x2={x(0)} y1={top - 8} y2={H - 26} stroke="#e2e8f0" strokeDasharray="4 4" />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={H - 26} y2={H - 21} stroke="#94a3b8" />
          <text x={x(t)} y={H - 8} textAnchor="middle" fontSize={11} fill="#94a3b8">
            {fmtNum(t, 2)}
          </text>
        </g>
      ))}
      <text x={labelW + plotW / 2} y={12} textAnchor="middle" fontSize={11} fill="#94a3b8">
        Hedges g (95% CI) · dashed line = no effect
      </text>
      {rows.map((c, i) => {
        const cy = top + i * rowH + rowH / 2;
        const color = c.survives ? '#34d399' : '#f87171';
        const g = c.hedges_g;
        const [cl, ch] = c.g_ci95 ?? [null, null];
        const finite = typeof g === 'number' && Number.isFinite(g);
        return (
          <g key={c.name}>
            {i % 2 === 1 && <rect x={0} y={cy - rowH / 2} width={W} height={rowH} fill="rgba(148,163,184,0.05)" />}
            <text x={8} y={cy - 4} fontSize={12} fill="#e2e8f0">
              {c.label}
            </text>
            <text x={8} y={cy + 12} fontSize={10.5} fill="#94a3b8">
              {c.metric} · n = {fmtInt(c.n)} · p = {fmtP(c.p)}
            </text>
            {finite && typeof cl === 'number' && typeof ch === 'number' && (
              <>
                <line x1={x(cl)} x2={x(ch)} y1={cy} y2={cy} stroke={color} strokeWidth={2} />
                <line x1={x(cl)} x2={x(cl)} y1={cy - 6} y2={cy + 6} stroke={color} strokeWidth={2} />
                <line x1={x(ch)} x2={x(ch)} y1={cy - 6} y2={cy + 6} stroke={color} strokeWidth={2} />
              </>
            )}
            {finite ? (
              <circle cx={x(g)} cy={cy} r={6} fill={color} stroke="#0f172a" strokeWidth={1.5} />
            ) : (
              <text x={labelW + plotW / 2} y={cy + 4} fontSize={11} fill="#f87171" textAnchor="middle">
                g = null
              </text>
            )}
            <text x={labelW + plotW + 10} y={cy - 2} fontSize={11} fill="#e2e8f0">
              g = {fmtNum(g, 3)}
            </text>
            <text x={labelW + plotW + 10} y={cy + 11} fontSize={10.5} fill="#94a3b8">
              {fmtCI(c.g_ci95, 2)}
            </text>
            <rect x={W - 78} y={cy - 9} width={74} height={18} rx={3} fill={c.survives ? 'rgba(52,211,153,0.15)' : 'rgba(248,113,113,0.15)'} stroke={color} />
            <text x={W - 41} y={cy + 4} fontSize={10} fontWeight={600} textAnchor="middle" fill={color}>
              {c.survives ? 'SURVIVES' : 'DOES NOT'}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function niceTicks(lo: number, hi: number, n: number): number[] {
  const span = hi - lo;
  const raw = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-12; v += step) out.push(Number(v.toFixed(10)));
  return out;
}
