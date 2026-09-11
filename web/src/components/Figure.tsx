import type { ReactNode } from 'react';
import type { Provenance } from '../types';
import ProvenanceFooter from './ProvenanceFooter';

export default function Figure({
  title,
  caption,
  provenance,
  children,
  right,
}: {
  title: string;
  caption?: ReactNode;
  provenance: Provenance | undefined;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <figure className="card">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <figcaption className="font-semibold text-slate-100">{title}</figcaption>
        {right}
      </div>
      <div className="w-full overflow-x-auto">{children}</div>
      {caption && <div className="mt-2 text-sm text-slate-400">{caption}</div>}
      <ProvenanceFooter provenance={provenance} />
    </figure>
  );
}
