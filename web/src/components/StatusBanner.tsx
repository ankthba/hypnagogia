import type { ReactNode } from 'react';
import type { StageStatus } from '../types';
import { STATUS_STYLE } from '../lib/colors';
import StatusBadge from './StatusBadge';

/**
 * Full-width status banner. Failures and artifacts are rendered with the same weight
 * as successes (the same rule, the same wash, a different hue), never collapsed.
 */
export default function StatusBanner({
  status,
  title,
  criterion,
  reasons,
  children,
}: {
  status: StageStatus | string;
  title: string;
  criterion?: string;
  reasons?: string[] | null;
  children?: ReactNode;
}) {
  const s = STATUS_STYLE[status as StageStatus];
  const tone = s ? s.tone : 'unknown';
  return (
    <div className={`banner banner--${tone} measure`} role="status">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={status} size="lg" />
        <div className="banner__title">{title}</div>
      </div>
      {criterion && (
        <p className="banner__body">
          <em>Pre-registered criterion:</em> {criterion}
        </p>
      )}
      {reasons && reasons.length > 0 && (
        <ul className="banner__body">
          {reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      {children && <div className="banner__body">{children}</div>}
    </div>
  );
}
