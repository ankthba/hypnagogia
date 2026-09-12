import type { ModelParam } from '../types';
import DataTable from './DataTable';
import { fmtAny } from '../lib/format';

/** Parameter table with source and a visible cited / UNCITED flag. */
export default function ParamTable({ params }: { params: ModelParam[] }) {
  const nUncited = params.filter((p) => !p.cited).length;
  return (
    <div>
      {nUncited > 0 && (
        <div className="mb-2 small tone-failed">
          {nUncited} of {params.length} parameters have no citation and are flagged below.
        </div>
      )}
      <DataTable
        columns={[
          { key: 'name', header: 'parameter', render: (p) => <span className="mono">{p.name}</span> },
          { key: 'value', header: 'value', render: (p) => fmtAny(p.value) },
          { key: 'source', header: 'source', render: (p) => <span className="whitespace-normal">{p.source || '(none)'}</span> },
          {
            key: 'cited',
            header: 'cited',
            render: (p) => (p.cited ? <span className="badge badge--passed">cited</span> : <span className="badge badge--failed">uncited</span>),
          },
        ]}
        rows={params}
        rowKey={(p, i) => `${p.name}-${i}`}
        rowClass={(p) => (p.cited ? '' : 'row--flag')}
      />
    </div>
  );
}
