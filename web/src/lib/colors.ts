import type { Classification, StageStatus } from '../types';

/** One accent colour per classification (Tailwind palette hex values, usable in SVG/canvas). */
export const CLASS_COLORS: Record<Classification, string> = {
  silent: '#60a5fa', // blue-400
  critical: '#34d399', // emerald-400
  saturated: '#fb923c', // orange-400
  indeterminate: '#a3a3a3', // neutral-400
};

export const CLASS_BAND: Record<Classification, string> = {
  silent: 'rgba(96,165,250,0.10)',
  critical: 'rgba(52,211,153,0.14)',
  saturated: 'rgba(251,146,60,0.12)',
  indeterminate: 'rgba(163,163,163,0.08)',
};

export const STATUS_STYLE: Record<StageStatus, { label: string; icon: string; badge: string; banner: string }> = {
  passed: {
    label: 'PASSED',
    icon: '✓',
    badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
    banner: 'border-emerald-500/60 bg-emerald-500/10 text-emerald-100',
  },
  failed: {
    label: 'FAILED',
    icon: '✗',
    badge: 'bg-red-500/15 text-red-300 border-red-500/50',
    banner: 'border-red-500/70 bg-red-500/15 text-red-100',
  },
  artifact: {
    label: 'ARTIFACT',
    icon: '!',
    badge: 'bg-orange-500/15 text-orange-300 border-orange-500/50',
    banner: 'border-orange-500/70 bg-orange-500/15 text-orange-100',
  },
  running: {
    label: 'RUNNING',
    icon: '…',
    badge: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
    banner: 'border-sky-500/60 bg-sky-500/10 text-sky-100',
  },
  not_run: {
    label: 'NOT RUN',
    icon: '—',
    badge: 'bg-slate-700/40 text-slate-300 border-slate-600',
    banner: 'border-slate-600 bg-slate-800/60 text-slate-200',
  },
};

export const SERIES = {
  A: '#f472b6', // pink-400  (ensemble A / odor A)
  B: '#22d3ee', // cyan-400  (ensemble B / odor B)
  other: '#64748b', // slate-500
  threshold: '#fbbf24', // amber-400
  sleep: '#a78bfa', // violet-400
  wake: '#fde68a', // amber-200
  grid: '#1e293b', // slate-800
  axis: '#94a3b8', // slate-400
};
