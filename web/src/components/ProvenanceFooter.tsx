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

/** Required under every figure: "config: … · data: … · commit …", built from the stage's provenance object; each path links to the repository at that commit. */
export default function ProvenanceFooter({ provenance }: { provenance: Provenance | undefined }) {
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
      · commit{' '}
      {HEX.test(commit) ? (
        <a className="mono" href={`${REPO_URL}/commit/${commit}`} target="_blank" rel="noreferrer">
          {commit}
        </a>
      ) : (
        <span className="mono">{commit || 'null'}</span>
      )}
    </div>
  );
}
