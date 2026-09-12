/**
 * Number formatting for the viewer.
 *
 * The one rule these all share: a value the data files do not carry is never printed as the
 * strings "null", "undefined" or "NaN". Those are JavaScript leaking through into the page, and a
 * reader has no way to tell them from a result. An absent value is printed as `NOT_MEASURED`, or
 * omitted entirely by the caller (`fmtOrNull` returns null so a label can be dropped rather than
 * rendered with a placeholder after it).
 */

/** What the page says where a file carries no value. Never "null", "undefined" or "NaN". */
export const NOT_MEASURED = 'not measured';

/** True when a value is a real, finite number the file actually carries. */
export function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function fmtInt(n: number | null | undefined): string {
  if (!isNum(n)) return NOT_MEASURED;
  return new Intl.NumberFormat('en-US').format(n);
}

export function fmtNum(n: number | null | undefined, digits = 3): string {
  if (!isNum(n)) return NOT_MEASURED;
  if (n === 0) return '0';
  const a = Math.abs(n);
  // Only tiny values use exponential notation; large (count-like) values keep thousands separators.
  if (a < 1e-3) return n.toExponential(Math.max(1, digits - 1));
  return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function fmtP(p: number | null | undefined): string {
  if (!isNum(p)) return NOT_MEASURED;
  // An exact 0 is what a permutation test writes when no permutation reached the observed value.
  // "0.0e+0" is that same number dressed up as a measurement; the plain 0 is the honest rendering.
  if (p === 0) return '0';
  if (p < 1e-4) return p.toExponential(1);
  return p.toFixed(4);
}

export function fmtCI(ci: [number | null, number | null] | null | undefined, digits = 3): string {
  if (!ci || !isNum(ci[0]) || !isNum(ci[1])) return NOT_MEASURED;
  return `[${fmtNum(ci[0], digits)}, ${fmtNum(ci[1], digits)}]`;
}

export function fmtPct(f: number | null | undefined, digits = 2): string {
  if (!isNum(f)) return NOT_MEASURED;
  return `${(f * 100).toFixed(digits)}%`;
}

export function fmtAny(v: unknown): string {
  if (v === null || v === undefined) return NOT_MEASURED;
  if (typeof v === 'number') return Number.isFinite(v) ? (Number.isInteger(v) ? fmtInt(v) : fmtNum(v, 4)) : NOT_MEASURED;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.length === 0 ? NOT_MEASURED : v.map(fmtAny).join(', ');
  const s = String(v);
  // A file that literally holds the text "null" / "NaN" is still not a measurement.
  return s === '' || s === 'null' || s === 'undefined' || s === 'NaN' ? NOT_MEASURED : s;
}

/**
 * A number with its unit, or the marker on its own.
 *
 * Never "not measured mV": the unit belongs to a measurement, and there is not one.
 */
export function fmtUnit(v: number | null | undefined, unit: string, digits = 3): string {
  return isNum(v) ? `${fmtNum(v, digits)} ${unit}` : NOT_MEASURED;
}

/**
 * "mean ± s.d.", collapsing to one marker when the file carries no mean.
 *
 * A cell reading "not measured ± 0" is worse than either half of it: it looks like a measurement
 * of zero spread around something. When the mean is absent the whole cell is the marker, and when
 * only the spread is absent the cell says which part is missing.
 */
export function fmtMeanSd(mean: number | null | undefined, sd: number | null | undefined, digits = 3): string {
  if (!isNum(mean)) return NOT_MEASURED;
  return isNum(sd) ? `${fmtNum(mean, digits)} ± ${fmtNum(sd, digits)}` : `${fmtNum(mean, digits)} (no s.d. in the file)`;
}

/** "value [lo, hi]", collapsing to one marker when the file carries no value. */
export function fmtValueCI(v: number | null | undefined, ci: [number | null, number | null] | null | undefined, digits = 3): string {
  if (!isNum(v)) return NOT_MEASURED;
  const c = fmtCI(ci, digits);
  return c === NOT_MEASURED ? `${fmtNum(v, digits)} (no interval in the file)` : `${fmtNum(v, digits)} ${c}`;
}

/**
 * The formatted number, or `null` when the file carries none, so the caller can drop the whole
 * label instead of printing "p = not measured" in a place where the label only makes sense with a
 * value beside it.
 */
export function fmtOrNull(n: number | null | undefined, fmt: (v: number) => string): string | null {
  return isNum(n) ? fmt(n) : null;
}

/**
 * A string field from a data file, or `NOT_MEASURED` when it is absent or empty. Used for the
 * free-text fields (a source, a note, a config path) that a stale export can leave out.
 */
export function fmtText(s: string | null | undefined, fallback = 'not stated'): string {
  if (typeof s !== 'string') return fallback;
  const t = s.trim();
  return t === '' || t === 'null' || t === 'undefined' ? fallback : t;
}

/** A list of strings from a data file, or `fallback` when the file lists none. */
export function fmtList(xs: readonly string[] | null | undefined, fallback = 'not stated'): string {
  const list = (xs ?? []).filter((x) => typeof x === 'string' && x.trim() !== '');
  return list.length > 0 ? list.join(', ') : fallback;
}
