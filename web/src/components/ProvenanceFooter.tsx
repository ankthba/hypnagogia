import type { ReactNode } from 'react';
import type { Provenance } from '../types';
import { REPO_URL } from '../lib/data';

const HEX = /^[0-9a-f]{7,40}$/i;

/**
 * How many data paths are printed inline before the rest are folded into a disclosure.
 *
 * A stage's provenance can list every sweep output it wrote: the criticality figures list 115
 * files, which set inline is 4,939px tall under a 257px chart on a 375px phone. Folding is a
 * layout decision only - the disclosure is in the DOM, open on demand, and nothing is elided.
 */
const INLINE_FILES = 4;

function RepoLink({ path, commit }: { path: string; commit: string }) {
  if (!HEX.test(commit)) return <span className="mono">{path}</span>;
  return (
    <a className="mono" href={`${REPO_URL}/blob/${commit}/${path.replace(/^\//, '')}`} target="_blank" rel="noreferrer">
      {path}
    </a>
  );
}

/**
 * Required under every figure: "config: … · data: … · commit …", built from the stage's provenance
 * object; each path links to the repository at that commit.
 *
 * `commitNote` is for the files that state no commit of their own (the atlas sidecar, the reference
 * clips). Their footers say so, in place of a commit, rather than borrowing the manifest's - the
 * manifest's commit is when the *site* was exported, not when the run was made, and hyperlinking a
 * result file to it would claim a provenance the file never states. `note` is any further clause the
 * caller must add about where these fields came from.
 */
export default function ProvenanceFooter({
  provenance,
  commitNote,
  note,
}: {
  provenance: Provenance | undefined;
  commitNote?: ReactNode;
  note?: ReactNode;
}) {
  if (!provenance) {
    return <div className="provenance provenance--missing">provenance object missing from stage file</div>;
  }
  const commit = provenance.git_commit ?? '';
  const files = provenance.files ?? [];
  const shown = files.slice(0, INLINE_FILES);
  const rest = files.slice(INLINE_FILES);
  return (
    <div className="provenance">
      config: <RepoLink path={provenance.config} commit={commit} /> · data:{' '}
      {files.length === 0
        ? '(none listed)'
        : shown.map((f, i) => (
            <span key={`${f}-${i}`}>
              {i > 0 && ', '}
              <RepoLink path={f} commit={commit} />
            </span>
          ))}
      {/* Every file stays in the page - none is dropped and none is summarised away - but a stage
          that lists 115 of them must not bury the figure it belongs to under 4,900px of paths on a
          phone. The overflow is one click away and is still selectable, linked and printable. */}
      {rest.length > 0 && (
        <details className="provenance__more">
          <summary>
            {rest.length} more file{rest.length === 1 ? '' : 's'}
          </summary>
          <div className="provenance__files">
            {rest.map((f, i) => (
              <span key={`${f}-${i}`}>
                {i > 0 && ', '}
                <RepoLink path={f} commit={commit} />
              </span>
            ))}
          </div>
        </details>
      )}{' '}
      ·{' '}
      {HEX.test(commit) ? (
        <>
          commit{' '}
          <a className="mono" href={`${REPO_URL}/commit/${commit}`} target="_blank" rel="noreferrer">
            {commit}
          </a>
        </>
      ) : commitNote ? (
        <span className="tone-failed">{commitNote}</span>
      ) : (
        <>
          commit <span className="mono">{commit || 'null'}</span>
        </>
      )}
      {note && <> · {note}</>}
    </div>
  );
}
