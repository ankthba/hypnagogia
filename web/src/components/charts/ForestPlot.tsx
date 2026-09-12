import { memo } from 'react';
import type { Comparison } from '../../types';
import { fmtNum, fmtCI, fmtP, fmtInt, isNum } from '../../lib/format';
import { SERIES } from '../../lib/colors';
import { useNarrowBox } from '../../lib/media';

const INK = SERIES.ink;
const MUTED = SERIES.axis;
const BAD = SERIES.failed;
const GOOD = SERIES.passed;
const STRIPE = 'var(--color-bg-alt)';
const BAD_WASH = 'var(--color-failed-wash)';
const GOOD_WASH = 'var(--color-passed-wash)';

/** The four comparisons DATA_CONTRACT.md names for stage6_replay.json, used when the file lists none. */
export const CONTRACT_COMPARISONS = ['A_vs_B_sleep', 'sleep_vs_wake_A', 'real_vs_shuffled', 'A_vs_random_ensembles'] as const;

/**
 * The pre-registered set: the stage file's own `required_four` when it carries one, otherwise the
 * four names the data contract fixes. `fromFile` says which, so the page can be honest about it.
 */
export function preregistered(required?: string[] | null): { names: string[]; fromFile: boolean } {
  const listed = (required ?? []).filter((n): n is string => typeof n === 'string' && n.trim() !== '');
  return listed.length > 0 ? { names: listed, fromFile: true } : { names: [...CONTRACT_COMPARISONS], fromFile: false };
}

type Row = { kind: 'present'; c: Comparison; prereg: boolean } | { kind: 'missing'; name: string };

// ---------------------------------------------------------------- the axis

/**
 * A symmetric log axis.
 *
 * One comparison here has a g of 6.7 with a 95% CI reaching 62.5, and a linear axis over that
 * range puts every other point and every other whisker inside three pixels of zero. The axis is
 * therefore linear inside +/-`LIN` (where the small effects live and where a log axis has no zero)
 * and logarithmic beyond it, which is the standard symlog construction. `LIN` is 1, i.e. exactly
 * one unit of Hedges g, which is a large effect: nothing that matters is compressed.
 */
const LIN = 1;
/** Fraction of the plot width the linear middle gets. */
const LIN_FRAC = 0.42;

function makeScale(lo: number, hi: number, plotW: number, x0: number) {
  const logMax = Math.max(Math.abs(lo), Math.abs(hi), LIN * 1.2);
  const decades = Math.max(1e-6, Math.log10(logMax / LIN));
  const half = plotW / 2;
  const linHalf = half * LIN_FRAC;
  const logHalf = half - linHalf;
  /** value -> pixel, with 0 at the middle of the plot */
  const x = (v: number) => {
    const s = v < 0 ? -1 : 1;
    const a = Math.abs(v);
    if (a <= LIN) return x0 + half + s * (a / LIN) * linHalf;
    const t = Math.min(1, Math.log10(a / LIN) / decades);
    return x0 + half + s * (linHalf + t * logHalf);
  };
  return { x, logMax, zero: x0 + half };
}

/** Ticks for the symlog axis: the linear part evenly, then one per decade. */
function symlogTicks(logMax: number): number[] {
  const out = [-LIN, -LIN / 2, 0, LIN / 2, LIN];
  for (let d = 1; Math.pow(10, d) * LIN <= logMax * 1.0001; d++) {
    out.push(LIN * Math.pow(10, d), -LIN * Math.pow(10, d));
  }
  return [...new Set(out)].filter((t) => Math.abs(t) <= logMax * 1.02).sort((a, b) => a - b);
}

/**
 * Greedy word wrap for SVG text, which has no wrapping of its own.
 *
 * `maxPx` is the width of the column the text must stay inside, and the character width is the
 * measured average for EB Garamond at the given size. It matters that this errs narrow: a label
 * that overflowed its column landed on top of the whiskers, which is exactly the defect this plot
 * is being rebuilt to remove. Anything past `maxLines` is cut with an ellipsis, and the caller puts
 * the full string in a <title> so nothing is actually lost.
 */
function wrapText(text: string, maxPx: number, fontPx: number, maxLines: number): string[] {
  const perChar = fontPx * 0.435;
  const maxChars = Math.max(8, Math.floor(maxPx / perChar));
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars) {
      cur = next;
      continue;
    }
    if (cur) lines.push(cur);
    cur = w;
    if (lines.length === maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines) {
    // did everything fit?
    const used = lines.join(' ');
    if (used.length < text.length) lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, Math.max(4, maxChars - 1))}…`;
  }
  return lines.length > 0 ? lines : [text];
}

/**
 * Effect sizes (Hedges g) with 95% CI whiskers and a zero line, one row per comparison.
 *
 * Three things the earlier version got wrong are fixed here and must stay fixed:
 *  - the value column and the verdict badge have their own columns and can never overlap;
 *  - the axis is symlog, so a CI reaching 62.5 does not squash every other row onto zero, and a
 *    whisker that leaves the drawn range ends in an explicit out-of-range arrow;
 *  - a p value the file does not carry is omitted, not printed as the word "null".
 * A comparison outside the pre-registered set is labelled an additional comparison and carries the
 * file's own note about it; it is not an anomaly and is not drawn as one.
 */
function ForestPlotInner({ comparisons, required, note }: { comparisons: Comparison[]; required?: string[] | null; note?: string }) {
  // Below ~700px of *container* (not window: the mat this is drawn into is ~400px wide beside the
  // map rail) there is no room for three columns beside the whiskers, so the row is stacked.
  const { ref: boxRef, narrow, width: boxW } = useNarrowBox();
  const present = comparisons ?? [];
  const prereg = preregistered(required);
  const preSet = new Set(prereg.names);
  const rows: Row[] = [
    ...prereg.names.map<Row>((n) => {
      const c = present.find((x) => x.name === n);
      return c ? { kind: 'present', c, prereg: true } : { kind: 'missing', name: n };
    }),
    ...present.filter((c) => !preSet.has(c.name)).map<Row>((c) => ({ kind: 'present', c, prereg: false })),
  ];
  const extras = rows.filter((r) => r.kind === 'present' && !r.prereg).length;

  const vals = present
    .flatMap((c) => [c.hedges_g, c.g_ci95?.[0], c.g_ci95?.[1]])
    .filter((v): v is number => isNum(v));
  const lo = Math.min(0, ...(vals.length ? vals : [0]));
  const hi = Math.max(0, ...(vals.length ? vals : [0]));

  // One SVG unit is one CSS pixel: the viewBox is the box the plot is actually drawn into, so a
  // `w-full` scale factor cannot shrink the type below the size it is set at.
  const W = narrow ? Math.max(260, boxW || 340) : Math.max(700, boxW || 700);
  // Three fixed columns on the right of the plot, so nothing can ever land on top of anything else:
  // the whiskers, then the value and its CI, then the verdict badge.
  const badgeW = 86;
  const valueW = narrow ? 0 : 128;
  const gutter = 10;
  const labelW = narrow ? W - 16 : 244;
  const plotW = narrow ? W - 24 : W - labelW - valueW - badgeW - 2 * gutter - 8;
  const rowH = narrow ? 116 : 66;
  const top = narrow ? 24 : 28;
  const H = top + rows.length * rowH + 34;
  const plotX = narrow ? 12 : labelW;
  const scale = makeScale(lo, hi, plotW, plotX);
  const valueX = plotX + plotW + gutter;
  const badgeX = narrow ? W - badgeW - 6 : valueX + valueW + gutter;
  /** vertical offset of the whisker line inside a row: centred when wide, below the text when stacked */
  const barDy = narrow ? 98 : rowH / 2;
  /** the width the label column has for text; the wrap keeps every string inside it */
  const textW = narrow ? W - 20 : labelW - 14;
  const ticks = symlogTicks(scale.logMax);

  /** an endpoint outside the drawn range is clipped and gets an arrow at the edge */
  const clampX = (v: number) => Math.max(plotX + 1, Math.min(plotX + plotW - 1, scale.x(v)));

  return (
    <div ref={boxRef} className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className={narrow ? 'w-full' : 'w-full min-w-[660px]'} role="img" aria-label="Effect sizes with 95% confidence intervals">
        <line x1={scale.zero} x2={scale.zero} y1={top - 8} y2={H - 30} stroke={INK} strokeDasharray="4 4" />
        {/* the edge of the linear middle: beyond these two rules the axis is logarithmic */}
        {[-LIN, LIN].map((v) => (
          <line key={`lin${v}`} x1={scale.x(v)} x2={scale.x(v)} y1={top - 8} y2={H - 30} stroke={MUTED} strokeOpacity={0.35} strokeDasharray="2 5" />
        ))}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={scale.x(t)} x2={scale.x(t)} y1={H - 30} y2={H - 25} stroke={MUTED} />
            <text x={scale.x(t)} y={H - 13} textAnchor="middle" fontSize={11.5} fill={MUTED}>
              {fmtNum(t, 2)}
            </text>
          </g>
        ))}
        <text x={plotX + plotW / 2} y={12} textAnchor="middle" fontSize={12} fill={MUTED}>
          Hedges g (95% CI) · dashed line = no effect
        </text>
        <text x={plotX + plotW / 2} y={H - 2} textAnchor="middle" fontSize={11} fill={MUTED}>
          symmetric log axis: linear within ±{LIN}, logarithmic beyond it
        </text>

        {rows.map((r, i) => {
          const y0 = top + i * rowH;
          const cy = y0 + barDy;
          const badgeY = narrow ? y0 + 62 : y0 + rowH / 2 - 9;
          if (r.kind === 'missing') {
            return (
              <g key={`missing-${r.name}`}>
                <rect x={0} y={y0} width={W} height={rowH} fill={BAD_WASH} />
                <text x={8} y={y0 + 17} fontSize={narrow ? 12 : 13} fill={BAD} fontWeight={500}>
                  {r.name}
                </text>
                {wrapText('pre-registered comparison missing from stage6_replay.json', textW, 11.5, 2).map((ln, k) => (
                  <text key={k} x={8} y={y0 + 33 + k * 14} fontSize={11.5} fill={BAD}>
                    {ln}
                  </text>
                ))}
                <rect x={badgeX} y={badgeY} width={badgeW} height={18} rx={2} fill="none" stroke={BAD} />
                <text x={badgeX + badgeW / 2} y={badgeY + 13} fontSize={11.5} letterSpacing="0.08em" textAnchor="middle" fill={BAD}>
                  MISSING
                </text>
              </g>
            );
          }
          const c = r.c;
          const color = c.survives ? GOOD : BAD;
          const g = c.hedges_g;
          const [cl, ch] = c.g_ci95 ?? [null, null];
          const finite = isNum(g);
          const p = isNum(c.p) ? c.p : isNum(c.p_permutation) ? c.p_permutation : isNum(c.p_wilcoxon) ? c.p_wilcoxon : null;
          const loOut = isNum(cl) && scale.x(cl) < plotX + 1;
          const hiOut = isNum(ch) && scale.x(ch) > plotX + plotW - 1;
          const labelLines = wrapText(c.label, textW, narrow ? 12.5 : 13, 2);
          const meta = `${c.metric} · n = ${fmtInt(c.n)}${p !== null ? ` · p = ${fmtP(p)}` : ''}${
            r.prereg ? '' : ' · additional comparison, outside the pre-registered set'
          }`;
          const metaLines = wrapText(meta, textW, 11.5, r.prereg ? 1 : 2);
          return (
            <g key={c.name}>
              {i % 2 === 1 && <rect x={0} y={y0} width={W} height={rowH} fill={STRIPE} />}
              {/* The label and the metadata are wrapped inside the label column's own width. They
                  used to be single lines drawn across the whole row, which put them straight over
                  the whiskers on any row whose label was long. */}
              {labelLines.map((ln, k) => (
                <text key={`l${k}`} x={8} y={y0 + 16 + k * 14} fontSize={narrow ? 12.5 : 13} fill={INK}>
                  {ln}
                  {k === 0 && <title>{c.label}</title>}
                </text>
              ))}
              {metaLines.map((ln, k) => (
                <text key={`m${k}`} x={8} y={y0 + 16 + (labelLines.length + k) * 14} fontSize={11.5} fill={r.prereg ? MUTED : INK}>
                  {ln}
                </text>
              ))}
              {finite && isNum(cl) && isNum(ch) && (
                <>
                  <line x1={clampX(cl)} x2={clampX(ch)} y1={cy} y2={cy} stroke={color} strokeWidth={2} />
                  {loOut ? (
                    <OutArrow x={plotX + 1} y={cy} dir={-1} color={color} />
                  ) : (
                    <line x1={clampX(cl)} x2={clampX(cl)} y1={cy - 6} y2={cy + 6} stroke={color} strokeWidth={2} />
                  )}
                  {hiOut ? (
                    <OutArrow x={plotX + plotW - 1} y={cy} dir={1} color={color} />
                  ) : (
                    <line x1={clampX(ch)} x2={clampX(ch)} y1={cy - 6} y2={cy + 6} stroke={color} strokeWidth={2} />
                  )}
                </>
              )}
              {finite ? (
                <circle cx={clampX(g)} cy={cy} r={narrow ? 5 : 5.5} fill={color} stroke={SERIES.mat} strokeWidth={1.5} />
              ) : (
                <text x={plotX + plotW / 2} y={cy + 4} fontSize={12} fill={BAD} textAnchor="middle">
                  no effect size in the file
                </text>
              )}
              {narrow ? (
                <text x={8} y={y0 + 76} fontSize={12} fill={INK}>
                  g = {fmtNum(g, 3)} <tspan fill={MUTED}>{fmtCI(c.g_ci95, 2)}</tspan>
                </text>
              ) : (
                <>
                  <text x={valueX} y={cy - 2} fontSize={12} fill={INK}>
                    g = {fmtNum(g, 3)}
                  </text>
                  <text x={valueX} y={cy + 11} fontSize={11} fill={MUTED}>
                    {fmtCI(c.g_ci95, 2)}
                  </text>
                </>
              )}
              <rect x={badgeX} y={badgeY} width={badgeW} height={18} rx={2} fill={c.survives ? GOOD_WASH : BAD_WASH} stroke={color} />
              <text x={badgeX + badgeW / 2} y={badgeY + 13} fontSize={11.5} letterSpacing="0.08em" textAnchor="middle" fill={color}>
                {c.survives ? 'SURVIVES' : 'DOES NOT'}
              </text>
            </g>
          );
        })}
      </svg>
      {extras > 0 && (
        <p className="smaller mt-2">
          {extras === 1 ? 'One comparison is' : `${fmtInt(extras)} comparisons are`} outside the{' '}
          {prereg.fromFile ? "stage file's own pre-registered list" : 'four comparisons the data contract pre-registers'}, and{' '}
          {extras === 1 ? 'is' : 'are'} labelled as additional above.{' '}
          {note ? note : <span className="muted">stage6_replay.json carries no note explaining it, so none is shown.</span>}
        </p>
      )}
    </div>
  );
}

/** The head of a whisker that runs off the drawn range, so a clipped CI is never read as a closed one. */
function OutArrow({ x, y, dir, color }: { x: number; y: number; dir: 1 | -1; color: string }) {
  const t = 6 * dir;
  return (
    <g>
      <polygon points={`${x},${y} ${x - t},${y - 5} ${x - t},${y + 5}`} fill={color} />
      <title>the confidence interval continues past the drawn range</title>
    </g>
  );
}

/** Memoised: it is a static SVG beside a 60 fps scrubber and depends on none of the scrubber's state. */
const ForestPlot = memo(ForestPlotInner);
export default ForestPlot;
