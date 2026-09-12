import type { StageStatus } from '../types';
import { STATUS_STYLE } from '../lib/colors';

export default function StatusBadge({ status, size = 'sm' }: { status: StageStatus | string; size?: 'sm' | 'lg' }) {
  // A status outside the contract's enum is shown verbatim, except that an absent one says so
  // rather than printing the word "undefined" where a reader would read it as a status.
  const s = STATUS_STYLE[status as StageStatus] ?? { label: status == null ? 'no status in the file' : String(status), icon: '?', tone: 'unknown' };
  return (
    <span className={`badge badge--${s.tone} ${size === 'lg' ? 'badge--lg' : ''}`}>
      <span aria-hidden>{s.icon}</span>
      {s.label}
    </span>
  );
}
