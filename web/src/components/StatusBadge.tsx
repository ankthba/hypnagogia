import type { StageStatus } from '../types';
import { STATUS_STYLE } from '../lib/colors';

export default function StatusBadge({ status, size = 'sm' }: { status: StageStatus | string; size?: 'sm' | 'lg' }) {
  const s = STATUS_STYLE[status as StageStatus] ?? { label: String(status), icon: '?', tone: 'unknown' };
  return (
    <span className={`badge badge--${s.tone} ${size === 'lg' ? 'badge--lg' : ''}`}>
      <span aria-hidden>{s.icon}</span>
      {s.label}
    </span>
  );
}
