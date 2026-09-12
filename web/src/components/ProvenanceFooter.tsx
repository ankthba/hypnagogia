import type { ReactNode } from 'react';
import type { Provenance } from '../types';
import { REPO_URL } from '../lib/data';

const HEX = /^[0-9a-f]{7,40}$/i;

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
  return (
    <div className="provenance">
      config: <RepoLink path={provenance.config} commit={commit} /> · data:{' '}
      {files.length === 0
        ? '(none listed)'
        : files.map((f, i) => (
            <span key={`${f}-${i}`}>
              {i > 0 && ', '}
              <RepoLink path={f} commit={commit} />
            </span>
          ))}{' '}
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
