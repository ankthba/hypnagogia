import { Link } from 'react-router-dom';
import { useDataFile, STAGES } from '../lib/data';
import type { Manifest, StageEntry, Stage0 } from '../types';
import StageGate from '../components/StageGate';
import StatusBanner from '../components/StatusBanner';
import ProvenanceFooter from '../components/ProvenanceFooter';
import { fmtNum } from '../lib/format';
import NotRunPanel from '../components/NotRunPanel';
import StatusBadge from '../components/StatusBadge';
import DataTable from '../components/DataTable';
import ParamTable from '../components/ParamTable';
import ErrorBoundary from '../components/ErrorBoundary';
import { STATUS_STYLE } from '../lib/colors';
import { fmtInt } from '../lib/format';
import type { StageStatus } from '../types';

export default function Overview() {
  const m = useDataFile<Manifest>('manifest.json');
  const s0 = useDataFile<Stage0>('stage0_reproduction.json');

  return (
    <div>
      <h1 className="h1">Overview</h1>
      <p className="mt-2 text-slate-400 max-w-3xl">
        A leaky integrate-and-fire simulation of the whole Drosophila brain (FlyWire v783 connectome, Brian2) asking whether a
        learned odor memory - a Kenyon-cell ensemble - spontaneously reactivates during a simulated sleep state. This page
        reports what was actually run. Everything below is read from <span className="mono">data/manifest.json</span>.
      </p>

      {m.state === 'loading' && <div className="mt-6 text-sm text-slate-500">loading manifest.json …</div>}
      {m.state === 'missing' && (
        <div className="mt-6">
          <NotRunPanel file="manifest.json" script="scripts/export_web.py" reason="missing" title="pipeline manifest" />
          <StageBoard stages={{}} />
        </div>
      )}
      {m.state === 'error' && (
        <div className="mt-6">
          <NotRunPanel file="manifest.json" script="scripts/export_web.py" reason="error" title="pipeline manifest" />
          <div className="mt-2 text-xs text-red-300 mono">{m.message}</div>
        </div>
      )}
      {m.state === 'ready' && (
        <ErrorBoundary label="Overview">
          <ManifestView m={m.data} />
        </ErrorBoundary>
      )}

      <section className="mt-10">
        <h2 className="h2">Stage 0 - reproduction of Shiu et al. sugar GRN → MN9</h2>
        <ErrorBoundary label="Stage 0">
          <StageGate stage="stage0_reproduction" loaded={s0}>
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
    { key: 'act', header: 'active neurons', render: (r: RepRow) => fmtInt(r.n_active_neurons) },
    { key: 'sp', header: 'total spikes', render: (r: RepRow) => fmtInt(r.total_spikes) },
  ];
  const rows: RepRow[] = [
    {
      name: `TARGET: ${t?.source ?? 'null'}`,
      data_version: '',
      n_neurons: null,
      n_connections: null,
      n_sugar_grns: null,
      mn9_rate_hz_mean: t?.mn9_rate_hz_mean ?? null,
      n_trials: t?.n_trials ?? null,
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
      n_active_neurons: r.n_active_neurons,
      total_spikes: r.total_spikes,
    })),
  ];
  return (
    <div className="space-y-4">
      <StatusBanner status={d.status} title="Reproduction of the published example" criterion={d.criterion} reasons={d.reasons} />
      <div className="card">
        <DataTable columns={cols} rows={rows} rowKey={(r) => r.name} rowClass={(_, i) => (i === 0 ? 'bg-slate-800/40' : '')} />
        {d.discrepancies && d.discrepancies.length > 0 && (
          <div className="mt-3">
            <div className="text-sm font-semibold text-orange-300">Discrepancies recorded by the pipeline</div>
            <ul className="list-disc pl-5 text-sm text-slate-200 mt-1 space-y-0.5">
              {d.discrepancies.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </div>
        )}
        {(d.runs ?? []).some((r) => r.top_active && r.top_active.length > 0) && (
          <div className="mt-4">
            <div className="text-sm font-semibold text-slate-200 mb-1">Most active neurons (ours vs target)</div>
            {(d.runs ?? []).map(
              (r) =>
                r.top_active &&
                r.top_active.length > 0 && (
                  <div key={r.name} className="mb-3">
                    <div className="text-xs text-slate-400 mb-1">{r.name}</div>
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
  n_active_neurons: number | null;
  total_spikes: number | null;
}

function ManifestView({ m }: { m: Manifest }) {
  const model = m.model;
  return (
    <div className="mt-6 space-y-8">
      <section className="card">
        <dl className="kv">
          <dt>generated</dt>
          <dd className="mono">{m.generated_at}</dd>
          <dt>git commit</dt>
          <dd className="mono">{m.git_commit}</dd>
          <dt>pipeline version</dt>
          <dd className="mono">{m.pipeline_version}</dd>
          <dt>connectome</dt>
          <dd>FlyWire FAFB v{model.data_version}</dd>
          <dt>base config</dt>
          <dd className="mono">{model.base_config}</dd>
        </dl>
      </section>

      <section>
        <h2 className="h2">Stage status board</h2>
        <StageBoard stages={m.stages} />
      </section>

      <section>
        <h2 className="h2">What was simulated</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="neurons in source table" value={fmtInt(model.neurons_in_source_table)} />
          <Stat label="neurons simulated (full)" value={fmtInt(model.neurons_simulated_full)} emphasis />
          <Stat label="neurons simulated (subset)" value={fmtInt(model.neurons_simulated_subset)} />
          <Stat label="connections (full)" value={fmtInt(model.connections_full)} />
          <Stat label="synapses (full)" value={fmtInt(model.synapses_full)} />
          <Stat label="connections (subset)" value={fmtInt(model.connections_subset)} />
          <Stat label="synapses (subset)" value={fmtInt(model.synapses_subset)} />
        </div>
        <p className="mt-2 text-xs text-slate-500">
          "full" is the entire connectome after filtering; "subset" is the reduced network some stages use when noted on
          their page. A value of 0 means the subset was not built.
        </p>

        <h3 className="h3">Filtering steps</h3>
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
      </section>

      <section>
        <h2 className="h2">Model parameters</h2>
        <p className="text-sm text-slate-400 mb-3">
          Read from <span className="mono">manifest.model.params</span>. Sources are those recorded by the pipeline.
        </p>
        <ParamTable params={model.params ?? []} />
      </section>
    </div>
  );
}

function Stat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${emphasis ? 'border-slate-600 bg-slate-800/60' : 'border-slate-800 bg-slate-900/60'}`}>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 tabular-nums ${emphasis ? 'text-2xl text-slate-50' : 'text-xl text-slate-100'}`}>{value}</div>
    </div>
  );
}

function StageBoard({ stages }: { stages: Partial<Record<string, StageEntry>> }) {
  return (
    <div className="space-y-2">
      {STAGES.map((s) => {
        const e = stages[s.key];
        const status: StageStatus = e?.status ?? 'not_run';
        const st = STATUS_STYLE[status] ?? STATUS_STYLE.not_run;
        return (
          <Link
            key={s.key}
            to={s.route}
            className={`block rounded-lg border-l-4 border border-slate-800 bg-slate-900/60 p-3 hover:bg-slate-900 transition-colors ${st.banner
              .split(' ')
              .filter((c) => c.startsWith('border-'))
              .join(' ')}`}
          >
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={status} />
              <div className="font-medium text-slate-100">{e?.title ?? s.label}</div>
              <div className="ml-auto text-xs mono text-slate-500">{e?.file ?? s.file}</div>
            </div>
            <div className="mt-1 text-sm text-slate-300">
              {e ? (
                e.summary || <span className="text-slate-500">(no summary in manifest)</span>
              ) : (
                <span className="text-slate-500">
                  not present in manifest - produced by <span className="mono">{s.script}</span>
                </span>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
