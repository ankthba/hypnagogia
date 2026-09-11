import type { ReactNode } from 'react';
import type { StageStatus } from '../types';
import { STATUS_STYLE } from '../lib/colors';
import StatusBadge from './StatusBadge';

/**
 * Full-width status banner. Failures and artifacts are rendered with the same weight
 * as successes (red / orange), never collapsed.
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
  const s = STATUS_STYLE[status as StageStatus] ?? STATUS_STYLE.not_run;
  return (
    <div className={`rounded-lg border-2 p-4 sm:p-5 ${s.banner}`} role="status">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={status} size="lg" />
        <div className="text-lg font-semibold">{title}</div>
      </div>
      {criterion && (
        <p className="mt-2 text-sm opacity-90">
          <span className="font-semibold">Pre-registered criterion:</span> {criterion}
        </p>
      )}
      {reasons && reasons.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-sm space-y-0.5">
          {reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      {children && <div className="mt-2 text-sm">{children}</div>}
    </div>
  );
}
