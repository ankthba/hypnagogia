import { Link } from 'react-router-dom';
import { useDataFile, STAGES } from '../lib/data';
import type { Manifest, StageEntry, Stage0, Provenance } from '../types';
import StageGate from '../components/StageGate';
import StatusBanner from '../components/StatusBanner';
import ProvenanceFooter from '../components/ProvenanceFooter';
import { fmtNum } from '../lib/format';
import NotRunPanel from '../components/NotRunPanel';
import StatusBadge from '../components/StatusBadge';
import DataTable from '../components/DataTable';
import ParamTable from '../components/ParamTable';
import ErrorBoundary from '../components/ErrorBoundary';
import { fmtInt } from '../lib/format';

export default function Overview() {
  const m = useDataFile<Manifest>('manifest.json');
  const s0 = useDataFile<Stage0>('stage0_reproduction.json');

  return (
    <div>
      <h1 className="page-title">Overview</h1>
      <div className="prose">
        <p>
          A leaky integrate-and-fire simulation of the <i>Drosophila</i> brain, built on the male CNS connectome (brain-only scope)
          in Brian2, asking whether a learned odor memory, a Kenyon-cell ensemble, spontaneously reactivates during a simulated
          sleep state. This page reports what was actually run. Everything below is read from{' '}
          <span className="mono">data/manifest.json</span>.
        </p>
      </div>

      {m.state === 'loading' && <div className="mt-6 small muted measure">loading manifest.json …</div>}
      {m.state === 'missing' && (
        <div className="mt-6 space-y-6">
          <NotRunPanel file="manifest.json" script="scripts/export_web.py" reason="missing" title="pipeline manifest" />
          <StageBoard stages={{}} />
        </div>
      )}
      {m.state === 'error' && (
        <div className="mt-6">
          <NotRunPanel file="manifest.json" script="scripts/export_web.py" reason="error" title="pipeline manifest" />
          <div className="mt-2 smaller tone-failed mono measure">{m.message}</div>
        </div>
      )}
      {m.state === 'ready' && (
        <ErrorBoundary label="Overview">
          <ManifestView m={m.data} />
        </ErrorBoundary>
      )}

      <section>
        <h2>Stage 0 · engine check against Shiu et al. (sugar GRN → MN9)</h2>
        <div className="prose mb-6">
          <p className="small muted">
            The published example is re-run on the FlyWire v630 substrate Shiu et al. released with it, so that our engine can be
            compared against their shipped output. This is the only stage that uses FlyWire; every later stage runs on the male
            CNS connectome.
          </p>
        </div>
        <ErrorBoundary label="Stage 0">
          <StageGate stage="stage0_reproduction" loaded={s0} manifest={m.state === 'ready' ? m.data.stages?.stage0_reproduction : undefined}>
            {(d) => <Stage0View d={d} />}
          </StageGate>
        </ErrorBoundary>
      </section>
    </div>
  );
}

function Stage0View({ d }: { d: Stage0 }) {
  const t = d.target;
  const cols = [
    { key: 'name', header: 'run', render: (r: RepRow) => r.name },
    { key: 'ver', header: 'data version', render: (r: RepRow) => r.data_version },
    { key: 'nn', header: 'n neurons', render: (r: RepRow) => fmtInt(r.n_neurons) },
    { key: 'nc', header: 'n connections', render: (r: RepRow) => fmtInt(r.n_connections) },
    { key: 'grn', header: 'sugar GRNs', render: (r: RepRow) => fmtInt(r.n_sugar_grns) },
    { key: 'mn9', header: 'MN9 rate mean (Hz)', render: (r: RepRow) => fmtNum(r.mn9_rate_hz_mean, 3) },
    { key: 'trials', header: 'trials', render: (r: RepRow) => fmtInt(r.n_trials) },
    { key: 'pt', header: 'MN9 rate per trial (Hz)', render: (r: RepRow) => <PerTrial values={r.mn9_rate_hz_per_trial} /> },
    { key: 'act', header: 'active neurons', render: (r: RepRow) => fmtInt(r.n_active_neurons) },
    { key: 'sp', header: 'total spikes', render: (r: RepRow) => fmtInt(r.total_spikes) },
  ];
  const rows: RepRow[] = [
    {
      name: 'TARGET',
      data_version: '',
      n_neurons: null,
      n_connections: null,
      n_sugar_grns: null,
      mn9_rate_hz_mean: t?.mn9_rate_hz_mean ?? null,
      n_trials: t?.n_trials ?? null,
      mn9_rate_hz_per_trial: t?.mn9_rate_hz_per_trial ?? null,
      n_active_neurons: t?.n_active_neurons ?? null,
      total_spikes: t?.total_spikes ?? null,
    },
    ...(d.runs ?? []).map((r) => ({
      name: r.name,
      data_version: r.data_version,
      n_neurons: r.n_neurons,
      n_connections: r.n_connections,
      n_sugar_grns: r.n_sugar_grns,
      mn9_rate_hz_mean: r.mn9_rate_hz_mean,
      n_trials: r.n_trials,
      mn9_rate_hz_per_trial: r.mn9_rate_hz_per_trial ?? null,
      n_active_neurons: r.n_active_neurons,
      total_spikes: r.total_spikes,
    })),
  ];
  return (
    <div className="space-y-6">
      <StatusBanner status={d.status} title="Reproduction of the published example" criterion={d.criterion} reasons={d.reasons} />
      <div className="card">
        <div className="mb-3 small">
          <span className="label label--ink">target</span> = <span className="mono break-all">{t?.source ?? 'null'}</span>
        </div>
        <DataTable columns={cols} rows={rows} rowKey={(r) => r.name} rowClass={(_, i) => (i === 0 ? 'row--emph' : '')} />
        {d.discrepancies && d.discrepancies.length > 0 && (
          <div className="mt-4">
            <div className="label tone-failed">Discrepancies recorded by the pipeline</div>
            <ul className="list-disc pl-5 small mt-1 space-y-0.5">
              {d.discrepancies.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </div>
        )}
        {(d.runs ?? []).some((r) => r.top_active && r.top_active.length > 0) && (
          <div className="mt-5">
            <div className="label label--ink mb-2">Most active neurons (ours vs target)</div>
            {(d.runs ?? []).map(
              (r) =>
                r.top_active &&
                r.top_active.length > 0 && (
                  <div key={r.name} className="mb-4">
                    <div className="smaller muted mb-1">{r.name}</div>
                    <DataTable
                      columns={[
                        { key: 'id', header: 'root id', render: (x) => <span className="mono">{x.root_id}</span> },
                        { key: 'r', header: 'rate (Hz)', render: (x) => fmtNum(x.rate_hz, 3) },
                        { key: 't', header: 'target rate (Hz)', render: (x) => fmtNum(x.target_rate_hz, 3) },
                      ]}
                      rows={r.top_active}
                      rowKey={(x) => x.root_id}
                    />
                  </div>
                ),
            )}
          </div>
        )}
        <ProvenanceFooter provenance={d.provenance} />
      </div>
    </div>
  );
}

interface RepRow {
  name: string;
  data_version: string;
  n_neurons: number | null;
  n_connections: number | null;
  n_sugar_grns: number | null;
  mn9_rate_hz_mean: number | null;
  n_trials: number | null;
  mn9_rate_hz_per_trial: number[] | null;
  n_active_neurons: number | null;
  total_spikes: number | null;
}

/** Per-trial values from the file: min–max summary with the full list underneath (never truncated). */
function PerTrial({ values }: { values: number[] | null }) {
  if (!values) return <span className="muted">null</span>;
  if (values.length === 0) return <span className="muted">[] (empty)</span>;
  const finite = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  const mn = finite.length ? Math.min(...finite) : null;
  const mx = finite.length ? Math.max(...finite) : null;
  return (
    <span className="whitespace-normal">
      <span>
        {fmtNum(mn, 3)} – {fmtNum(mx, 3)} (n = {fmtInt(values.length)})
      </span>
      <span className="block mono muted max-w-[28rem]" style={{ fontSize: '0.75rem' }}>
        {values.map((v) => fmtNum(v, 3)).join(', ')}
      </span>
    </span>
  );
}

/** Provenance for figures whose only source is manifest.json itself. */
function manifestProvenance(m: Manifest): Provenance {
  return { config: m.model?.base_config ?? 'null', files: ['web/public/data/manifest.json'], git_commit: m.git_commit, generated_at: m.generated_at };
}

function ManifestView({ m }: { m: Manifest }) {
  const model = m.model;
  const prov = manifestProvenance(m);
  return (
    <div className="mt-8">
      <section className="card measure">
        <dl className="kv">
          <dt>generated</dt>
          <dd className="mono">{m.generated_at}</dd>
          <dt>git commit</dt>
          <dd className="mono">{m.git_commit}</dd>
          <dt>pipeline version</dt>
          <dd className="mono">{m.pipeline_version}</dd>
          <dt>connectome</dt>
          <dd>
            male CNS, brain-only scope · data version <span className="mono">{model.data_version}</span>
          </dd>
          <dt>base config</dt>
          <dd className="mono">{model.base_config}</dd>
        </dl>
        <ProvenanceFooter provenance={prov} />
      </section>

      <section>
        <h2>Stage status board</h2>
        <StageBoard stages={m.stages} />
      </section>

      <section>
        <h2>What was simulated</h2>
        <div className="stats">
          <Stat label="neurons in source table" value={fmtInt(model.neurons_in_source_table)} />
          <Stat label="neurons simulated (full)" value={fmtInt(model.neurons_simulated_full)} emphasis />
          <Stat label="neurons simulated (subset)" value={fmtInt(model.neurons_simulated_subset)} />
          <Stat label="connections (full)" value={fmtInt(model.connections_full)} />
          <Stat label="synapses (full)" value={fmtInt(model.synapses_full)} />
          <Stat label="connections (subset)" value={fmtInt(model.connections_subset)} />
          <Stat label="synapses (subset)" value={fmtInt(model.synapses_subset)} />
        </div>
        <p className="mt-3 smaller muted">
          "full" is the entire brain-scope connectome after filtering; "subset" is the reduced network some stages use when noted on
          their page. Synapse counts are the connectome's counts after the scaling to FlyWire-equivalent units recorded in the
          parameter table.
          {model.neurons_simulated_subset === 0 && ' neurons simulated (subset) is 0: no subset network was built.'}
        </p>
        <ProvenanceFooter provenance={prov} />

        <h3>Filtering steps</h3>
        <DataTable
          columns={[
            { key: 'step', header: 'step', render: (s) => <span className="whitespace-normal">{s.step}</span> },
            { key: 'before', header: 'n before', render: (s) => fmtInt(s.n_before) },
            { key: 'after', header: 'n after', render: (s) => fmtInt(s.n_after) },
            { key: 'removed', header: 'removed', render: (s) => fmtInt(s.n_before - s.n_after) },
          ]}
          rows={model.filtering_steps ?? []}
          rowKey={(_, i) => i}
          empty="no filtering steps recorded"
        />
        <ProvenanceFooter provenance={prov} />
      </section>

      <section>
        <h2>Model parameters</h2>
        <div className="prose mb-4">
          <p className="small muted">
            Read from <span className="mono">manifest.model.params</span>. Sources are those recorded by the pipeline.
          </p>
        </div>
        <ParamTable params={model.params ?? []} />
        <ProvenanceFooter provenance={prov} />
      </section>
    </div>
  );
}

function Stat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={`stat ${emphasis ? 'stat--emph' : ''}`}>
      <div className="label">{label}</div>
      <div className="stat__value">{value}</div>
    </div>
  );
}

function StageBoard({ stages }: { stages: Partial<Record<string, StageEntry>> }) {
  return (
    <div className="board measure">
      {STAGES.map((s) => {
        const e = stages[s.key];
        // A stage absent from the manifest has an UNKNOWN status; it is never defaulted to the contract's not_run.
        const status: string = e ? e.status : 'unknown';
        return (
          <Link key={s.key} to={s.route} className="board__row">
            <div className="board__head">
              <StatusBadge status={status} />
              <div className="board__title">{e?.title ?? s.label}</div>
              <div className="ml-auto mono muted" style={{ fontSize: '0.75rem' }}>
                {e?.file ?? s.file}
              </div>
            </div>
            <div className="board__summary">
              {e ? (
                e.summary || <span>(no summary in manifest)</span>
              ) : (
                <span>
                  status unknown: not present in manifest · produced by <span className="mono">{s.script}</span>
                </span>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
