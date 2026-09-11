import type { ReactNode } from 'react';
import type { Loaded } from '../lib/data';
import { stageMeta } from '../lib/data';
import type { StageKey } from '../types';
import NotRunPanel from './NotRunPanel';

/**
 * Renders children only when a stage file is loaded. Otherwise renders the explicit
 * NotRunPanel (missing / error) or a loading indicator. Never substitutes data.
 */
export default function StageGate<T>({
  stage,
  loaded,
  children,
}: {
  stage: StageKey;
  loaded: Loaded<T>;
  children: (data: T) => ReactNode;
}) {
  const meta = stageMeta(stage);
  if (loaded.state === 'loading') {
    return <div className="text-sm text-slate-500 py-6">loading {meta.file} …</div>;
  }
  if (loaded.state === 'missing') {
    return <NotRunPanel file={meta.file} script={meta.script} reason="missing" title={meta.label} />;
  }
  if (loaded.state === 'error') {
    return (
      <div>
        <NotRunPanel file={meta.file} script={meta.script} reason="error" title={meta.label} />
        <div className="mt-2 text-xs text-red-300 mono">{loaded.message}</div>
      </div>
    );
  }
  return <>{children(loaded.data)}</>;
}
