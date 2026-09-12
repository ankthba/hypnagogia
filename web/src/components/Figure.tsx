import type { ReactNode } from 'react';
import type { Provenance } from '../types';
import ProvenanceFooter from './ProvenanceFooter';

/**
 * A figure: small-caps title, the plot on a white mat (which forces the light palette on
 * everything drawn inside it, in both themes), caption, and the required provenance line.
 */
export default function Figure({
  title,
  caption,
  provenance,
  provenanceCommitNote,
  provenanceNote,
  children,
  right,
  flat = false,
}: {
  title: string;
  caption?: ReactNode;
  provenance: Provenance | undefined;
  /** shown in place of the commit when the source file states none (see ProvenanceFooter) */
  provenanceCommitNote?: ReactNode;
  /** a further clause about where the provenance fields came from */
  provenanceNote?: ReactNode;
  children: ReactNode;
  right?: ReactNode;
  /** draw the content on the page rather than on a mat (for content that is not a plot) */
  flat?: boolean;
}) {
  return (
    <figure className="figure">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <figcaption className="label label--ink">{title}</figcaption>
        {right}
      </div>
      <div className={flat ? 'w-full overflow-x-auto' : 'mat'}>{children}</div>
      {caption && <div className="figure__caption">{caption}</div>}
      <ProvenanceFooter provenance={provenance} commitNote={provenanceCommitNote} note={provenanceNote} />
    </figure>
  );
}
