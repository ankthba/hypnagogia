import type { ReactNode } from 'react';

/**
 * Explicit "not yet run" state. Names the missing file and the script that produces it.
 * This is the ONLY thing rendered when data is absent; no substitute data ever appears.
 */
export default function NotRunPanel({
  file,
  script,
  reason,
  title,
  note,
}: {
  file: string;
  script: string;
  reason: 'missing' | 'not_run' | 'error' | 'running';
  title?: string;
  /** optional extra line (e.g. where the status came from) */
  note?: ReactNode;
}) {
  const heading =
    reason === 'running'
      ? 'Stage is running - partial outputs only'
      : reason === 'error'
        ? 'Data file could not be read'
        : 'Not yet run';
  return (
    <div className="notrun measure">
      <div className="notrun__title">
        {heading}
        {title && <em> · {title}</em>}
      </div>
      <dl className="kv mt-3">
        <dt>expected file</dt>
        <dd className="mono">web/public/data/{file}</dd>
        <dt>produced by</dt>
        <dd className="mono">{script}</dd>
        <dt>state</dt>
        <dd>
          {reason === 'missing' && 'file is absent (HTTP 404)'}
          {reason === 'not_run' && 'status "not_run"'}
          {reason === 'running' && 'status "running" (partial outputs exist)'}
          {reason === 'error' && 'fetch or parse error'}
        </dd>
      </dl>
      {note && <div className="mt-2 small">{note}</div>}
      <p className="mt-3 small muted">
        Run <span className="mono">python {script}</span> (the stage script documented in the repository README) and then{' '}
        <span className="mono">python scripts/export_web.py</span> to populate this panel. Nothing is shown in its place.
      </p>
    </div>
  );
}
