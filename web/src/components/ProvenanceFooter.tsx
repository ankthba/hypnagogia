import type { Provenance } from '../types';

/** Required under every figure: "config: … · data: … · commit …", built from the stage's provenance object. */
export default function ProvenanceFooter({ provenance }: { provenance: Provenance | undefined }) {
  if (!provenance) {
    return <div className="mt-2 text-xs text-red-300">provenance object missing from stage file</div>;
  }
  const files = provenance.files && provenance.files.length > 0 ? provenance.files.join(', ') : '(none listed)';
  return (
    <div className="mt-2 text-[11px] leading-relaxed text-slate-500 mono break-words">
      config: {provenance.config} · data: {files} · commit {provenance.git_commit}
    </div>
  );
}
