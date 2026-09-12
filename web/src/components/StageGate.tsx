import type { ReactNode } from 'react';
import type { Loaded } from '../lib/data';
import { stageMeta, useDataFile } from '../lib/data';
import type { Manifest, StageBase, StageEntry, StageKey } from '../types';
import NotRunPanel from './NotRunPanel';
import StatusBanner from './StatusBanner';

/**
 * Renders children only when a stage file is loaded AND neither the manifest nor the file itself
 * reports the stage as not_run. Otherwise renders the explicit NotRunPanel (missing / error /
 * not_run) or a loading indicator. `running` (partial outputs) is flagged with a banner above the
 * partial content. A disagreement between manifest and file status is shown, never hidden.
 * Never substitutes data.
 */
export default function StageGate<T>({
  stage,
  loaded,
  manifest,
  children,
}: {
  stage: StageKey;
  loaded: Loaded<T>;
  /** manifest.stages[stage]; when omitted, StageGate loads manifest.json itself (cached). */
  manifest?: StageEntry;
  children: (data: T) => ReactNode;
}) {
  const meta = stageMeta(stage);
  const m = useDataFile<Manifest>(manifest === undefined ? 'manifest.json' : null);
  const entry: StageEntry | undefined = manifest ?? (m.state === 'ready' ? m.data.stages?.[stage] : undefined);
  const manifestPending = manifest === undefined && m.state === 'loading';

  if (loaded.state === 'loading' || manifestPending) {
    return <div className="small muted py-6 measure">loading {meta.file} …</div>;
  }

  // Manifest is the authority on whether a stage produced output at all.
  if (entry?.status === 'not_run') {
    return (
      <NotRunPanel
        file={entry.file || meta.file}
        script={meta.script}
        reason="not_run"
        title={meta.label}
        note={
          loaded.state === 'ready' ? (
            <span className="tone-failed">
              manifest.json reports this stage as not_run, but <span className="mono">{loaded.path}</span> exists on disk. It is
              treated as stale and is not rendered.
            </span>
          ) : (
            <span>
              source: <span className="mono">manifest.json</span> stages.{stage}.status
            </span>
          )
        }
      />
    );
  }

  if (loaded.state === 'missing') {
    return <NotRunPanel file={meta.file} script={meta.script} reason="missing" title={meta.label} />;
  }
  if (loaded.state === 'error') {
    return (
      <div>
        <NotRunPanel file={meta.file} script={meta.script} reason="error" title={meta.label} />
        <div className="mt-2 smaller tone-failed mono measure">{loaded.message}</div>
      </div>
    );
  }

  const fileStatus = (loaded.data as Partial<StageBase>)?.status;

  // The file's own status can also say the stage did not produce a result.
  if (fileStatus === 'not_run') {
    return (
      <NotRunPanel
        file={meta.file}
        script={meta.script}
        reason="not_run"
        title={meta.label}
        note={
          <span>
            source: <span className="mono">{loaded.path}</span> status field
          </span>
        }
      />
    );
  }

  const running = entry?.status === 'running' || fileStatus === 'running';
  const mismatch = entry !== undefined && fileStatus !== undefined && entry.status !== fileStatus;

  return (
    <div className="space-y-6">
      {running && (
        <StatusBanner status="running" title="RUNNING - partial outputs">
          {entry?.status === 'running' && (
            <div>
              <span className="mono">manifest.json</span> reports stages.{stage}.status = "running".
            </div>
          )}
          {fileStatus === 'running' && (
            <div>
              <span className="mono">{loaded.path}</span> carries status "running".
            </div>
          )}
          <div>Everything below is a partial output of an unfinished run and may change; it is not a result.</div>
        </StatusBanner>
      )}
      {mismatch && (
        <div className="notice notice--warn measure">
          <em>Status mismatch:</em> <span className="mono">manifest.json</span> says "{entry.status}" for
          this stage but <span className="mono">{loaded.path}</span> says "{fileStatus == null ? 'no status at all' : String(fileStatus)}". The export is inconsistent; the
          file's own status is shown below.
        </div>
      )}
      {children(loaded.data)}
    </div>
  );
}
