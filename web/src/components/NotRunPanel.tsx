import type { ReactNode } from 'react';

/**
 * Explicit "not yet run" state. Names the missing file and the script that produces it.
 * This is the ONLY thing rendered when data is absent; no substitute data ever appears.
 */
export default function NotRunPanel({
  file,
  filePattern,
  patternSource,
  script,
  reason,
  title,
  note,
}: {
  /** the concrete path that was requested; omit when no concrete path exists yet */
  file?: string;
  /**
   * The naming convention for a family of files, when no single file is identified yet. It is
   * labelled as a pattern, never as an "expected file": a reader must not copy a placeholder out of
   * this panel and go looking for a path that cannot exist.
   */
  filePattern?: string;
  /** where the concrete values that fill the pattern come from */
  patternSource?: ReactNode;
  script: string;
  reason: 'missing' | 'not_run' | 'unnamed' | 'error' | 'running';
  title?: string;
  /** optional extra line (e.g. where the status came from) */
  note?: ReactNode;
}) {
  const heading =
    reason === 'running'
      ? 'Stage is running - partial outputs only'
      : reason === 'error'
        ? 'Data file could not be read'
        : reason === 'unnamed'
          ? 'No file is named yet'
          : 'Not yet run';
  return (
    <div className="notrun measure">
      <div className="notrun__title">
        {heading}
        {title && <em> · {title}</em>}
      </div>
      <dl className="kv mt-3">
        {file !== undefined && (
          <>
            <dt>expected file</dt>
            <dd className="mono">web/public/data/{file}</dd>
          </>
        )}
        {file === undefined && filePattern !== undefined && (
          <>
            <dt>file naming convention</dt>
            <dd className="mono">web/public/data/{filePattern}</dd>
            {patternSource !== undefined && (
              <>
                <dt>names come from</dt>
                <dd className="whitespace-normal">{patternSource}</dd>
              </>
            )}
          </>
        )}
        <dt>produced by</dt>
        <dd className="mono">{script}</dd>
        <dt>state</dt>
        <dd>
          {reason === 'missing' && 'file is absent (HTTP 404)'}
          {reason === 'not_run' && 'status "not_run"'}
          {reason === 'unnamed' && 'no file is named: nothing loaded identifies a concrete path to request, so none was'}
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
