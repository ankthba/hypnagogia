import type { Comparison } from '../../types';
import { fmtNum, fmtCI, fmtP, fmtInt } from '../../lib/format';
import { SERIES } from '../../lib/colors';

const INK = SERIES.ink;
const MUTED = SERIES.axis;
const BAD = SERIES.failed;
const GOOD = SERIES.passed;
const STRIPE = 'var(--color-bg-alt)';
const BAD_WASH = 'var(--color-failed-wash)';
const GOOD_WASH = 'var(--color-passed-wash)';

/** The four comparisons named in DATA_CONTRACT.md for stage6_replay.json. */
export const REQUIRED_COMPARISONS = ['A_vs_B_sleep', 'sleep_vs_wake_A', 'real_vs_shuffled', 'A_vs_random_ensembles'] as const;

type Row = { kind: 'present'; c: Comparison } | { kind: 'missing'; name: string };

/**
 * Effect sizes (Hedges g) with 95% CI whiskers and a zero line, one row per comparison.
 * Each row is marked survives / does not survive from the file, never inferred. Every contract-required
 * comparison absent from the file is drawn as an explicit red "missing" row; names outside the contract
 * are labelled unexpected.
 */
export default function ForestPlot({ comparisons }: { comparisons: Comparison[] }) {
  const present = comparisons ?? [];
  const rows: Row[] = [
    ...REQUIRED_COMPARISONS.map<Row>((n) => {
      const c = present.find((x) => x.name === n);
      return c ? { kind: 'present', c } : { kind: 'missing', name: n };
    }),
    ...present.filter((c) => !(REQUIRED_COMPARISONS as readonly string[]).includes(c.name)).map<Row>((c) => ({ kind: 'present', c })),
  ];

  const vals = present.flatMap((c) => [c.hedges_g, c.g_ci95?.[0], c.g_ci95?.[1]]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
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
      <line x1={x(0)} x2={x(0)} y1={top - 8} y2={H - 26} stroke={INK} strokeDasharray="4 4" />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={H - 26} y2={H - 21} stroke={MUTED} />
          <text x={x(t)} y={H - 8} textAnchor="middle" fontSize={12} fill={MUTED}>
            {fmtNum(t, 2)}
          </text>
        </g>
      ))}
      <text x={labelW + plotW / 2} y={12} textAnchor="middle" fontSize={12} fill={MUTED}>
        Hedges g (95% CI) · dashed line = no effect
      </text>
      {rows.map((r, i) => {
        const cy = top + i * rowH + rowH / 2;
        if (r.kind === 'missing') {
          return (
            <g key={`missing-${r.name}`}>
              <rect x={0} y={cy - rowH / 2} width={W} height={rowH} fill={BAD_WASH} />
              <text x={8} y={cy - 4} fontSize={13} fill={BAD} fontWeight={500}>
                {r.name}
              </text>
              <text x={8} y={cy + 12} fontSize={11.5} fill={BAD}>
                comparison missing from stage6_replay.json
              </text>
              <rect x={W - 78} y={cy - 9} width={74} height={18} rx={2} fill="none" stroke={BAD} />
              <text x={W - 41} y={cy + 4} fontSize={10} letterSpacing="0.12em" textAnchor="middle" fill={BAD}>
                MISSING
              </text>
            </g>
          );
        }
        const c = r.c;
        const unexpected = !(REQUIRED_COMPARISONS as readonly string[]).includes(c.name);
        const color = c.survives ? GOOD : BAD;
        const g = c.hedges_g;
        const [cl, ch] = c.g_ci95 ?? [null, null];
        const finite = typeof g === 'number' && Number.isFinite(g);
        return (
          <g key={c.name}>
            {i % 2 === 1 && <rect x={0} y={cy - rowH / 2} width={W} height={rowH} fill={STRIPE} />}
            <text x={8} y={cy - 4} fontSize={13} fill={INK}>
              {c.label}
            </text>
            <text x={8} y={cy + 12} fontSize={11.5} fill={MUTED}>
              {c.metric} · n = {fmtInt(c.n)} · p = {fmtP(c.p)}
              {unexpected && (
                <tspan fill={BAD} fontWeight={500}>
                  {' '}
                  · UNEXPECTED name "{c.name}"
                </tspan>
              )}
            </text>
            {finite && typeof cl === 'number' && typeof ch === 'number' && (
              <>
                <line x1={x(cl)} x2={x(ch)} y1={cy} y2={cy} stroke={color} strokeWidth={2} />
                <line x1={x(cl)} x2={x(cl)} y1={cy - 6} y2={cy + 6} stroke={color} strokeWidth={2} />
                <line x1={x(ch)} x2={x(ch)} y1={cy - 6} y2={cy + 6} stroke={color} strokeWidth={2} />
              </>
            )}
            {finite ? (
              <circle cx={x(g)} cy={cy} r={6} fill={color} stroke={SERIES.mat} strokeWidth={1.5} />
            ) : (
              <text x={labelW + plotW / 2} y={cy + 4} fontSize={12} fill={BAD} textAnchor="middle">
                g = null
              </text>
            )}
            <text x={labelW + plotW + 10} y={cy - 2} fontSize={12} fill={INK}>
              g = {fmtNum(g, 3)}
            </text>
            <text x={labelW + plotW + 10} y={cy + 11} fontSize={11.5} fill={MUTED}>
              {fmtCI(c.g_ci95, 2)}
            </text>
            <rect x={W - 78} y={cy - 9} width={74} height={18} rx={2} fill={c.survives ? GOOD_WASH : BAD_WASH} stroke={color} />
            <text x={W - 41} y={cy + 4} fontSize={10} letterSpacing="0.12em" textAnchor="middle" fill={color}>
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
