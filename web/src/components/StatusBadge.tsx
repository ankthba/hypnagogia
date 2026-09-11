import type { StageStatus } from '../types';
import { STATUS_STYLE } from '../lib/colors';

export default function StatusBadge({ status, size = 'sm' }: { status: StageStatus | string; size?: 'sm' | 'lg' }) {
  const s = STATUS_STYLE[status as StageStatus] ?? {
    label: String(status).toUpperCase(),
    icon: '?',
    badge: 'bg-slate-700/40 text-slate-300 border-slate-600',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border font-semibold tracking-wide ${s.badge} ${
        size === 'lg' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs'
      }`}
    >
      <span aria-hidden>{s.icon}</span>
      {s.label}
    </span>
  );
}
