export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return 'null';
  return new Intl.NumberFormat('en-US').format(n);
}

export function fmtNum(n: number | null | undefined, digits = 3): string {
  if (n === null || n === undefined || Number.isNaN(n)) return 'null';
  if (n === 0) return '0';
  const a = Math.abs(n);
  // Only tiny values use exponential notation; large (count-like) values keep thousands separators.
  if (a < 1e-3) return n.toExponential(Math.max(1, digits - 1));
  return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function fmtP(p: number | null | undefined): string {
  if (p === null || p === undefined || Number.isNaN(p)) return 'null';
  if (p < 1e-4) return p.toExponential(1);
  return p.toFixed(4);
}

export function fmtCI(ci: [number | null, number | null] | null | undefined, digits = 3): string {
  if (!ci) return 'null';
  return `[${fmtNum(ci[0], digits)}, ${fmtNum(ci[1], digits)}]`;
}

export function fmtPct(f: number | null | undefined, digits = 2): string {
  if (f === null || f === undefined || Number.isNaN(f)) return 'null';
  return `${(f * 100).toFixed(digits)}%`;
}

export function fmtAny(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return Number.isInteger(v) ? fmtInt(v) : fmtNum(v, 4);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(fmtAny).join(', ');
  return String(v);
}
