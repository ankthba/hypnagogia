/**
 * Explicit "not yet run" state. Names the missing file and the script that produces it.
 * This is the ONLY thing rendered when data is absent; no substitute data ever appears.
 */
export default function NotRunPanel({
  file,
  script,
  reason,
  title,
}: {
  file: string;
  script: string;
  reason: 'missing' | 'not_run' | 'error' | 'running';
  title?: string;
}) {
  const heading =
    reason === 'running'
      ? 'Stage is running - partial outputs only'
      : reason === 'error'
        ? 'Data file could not be read'
        : 'Not yet run';
  return (
    <div className="rounded-lg border-2 border-dashed border-slate-600 bg-slate-900/50 p-5">
      <div className="flex items-center gap-2 text-slate-200 font-semibold">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-500" aria-hidden />
        {heading}
        {title && <span className="text-slate-400 font-normal">- {title}</span>}
      </div>
      <dl className="kv mt-3">
        <dt>expected file</dt>
        <dd className="mono">web/public/data/{file}</dd>
        <dt>produced by</dt>
        <dd className="mono">{script}</dd>
        <dt>state</dt>
        <dd>
          {reason === 'missing' && 'file is absent (HTTP 404)'}
          {reason === 'not_run' && 'manifest reports status "not_run"'}
          {reason === 'running' && 'manifest reports status "running"'}
          {reason === 'error' && 'fetch or parse error'}
        </dd>
      </dl>
      <p className="mt-3 text-sm text-slate-400">
        Run <span className="mono">python {script}</span> and then <span className="mono">python scripts/export_web.py</span> to
        populate this panel. Nothing is shown in its place.
      </p>
    </div>
  );
}
