import { useMemo, useState } from 'react';
import { useDataFile } from '../lib/data';
import type { Stage1, Stage2, PerSigma, PowerLawFit } from '../types';
import StageGate from '../components/StageGate';
import StatusBanner from '../components/StatusBanner';
import Figure from '../components/Figure';
import DataTable from '../components/DataTable';
import Callout from '../components/Callout';
import ErrorBoundary from '../components/ErrorBoundary';
import ProvenanceFooter from '../components/ProvenanceFooter';
import SigmaChart, { type SigmaPoint } from '../components/charts/SigmaChart';
import CcdfChart, { seedColor } from '../components/charts/CcdfChart';
import { CLASS_COLORS } from '../lib/colors';
import { fmtNum, fmtInt, fmtP, fmtCI, fmtPct } from '../lib/format';

export default function Criticality() {
  const s1 = useDataFile<Stage1>('stage1_noise.json');
  const s2 = useDataFile<Stage2>('stage2_criticality.json');
  return (
    <div>
      <h1 className="h1">Criticality</h1>
      <p className="mt-2 text-slate-400 max-w-3xl">
        Stage 1 adds a noise term to the otherwise silent Shiu et al. model. Stage 2 sweeps the noise amplitude sigma and asks
        whether any value puts the network in a critical regime (branching ratio near 1, power-law avalanches). The regime
        chosen here is the background state for every later stage.
      </p>

      <section className="mt-8">
        <h2 className="h2">Stage 1 - noise models</h2>
        <ErrorBoundary label="Stage 1">
          <StageGate stage="stage1_noise" loaded={s1}>
            {(d) => <Stage1View d={d} />}
          </StageGate>
        </ErrorBoundary>
      </section>

      <section className="mt-10">
        <h2 className="h2">Stage 2 - sigma sweep</h2>
        <ErrorBoundary label="Stage 2">
          <StageGate stage="stage2_criticality" loaded={s2}>
            {(d) => <Stage2View d={d} />}
          </StageGate>
        </ErrorBoundary>
      </section>
    </div>
  );
}

function Stage1View({ d }: { d: Stage1 }) {
  return (
    <div className="space-y-4">
      <StatusBanner status={d.status} title="Noise model characterisation" criterion={d.criterion} reasons={d.reasons} />
      <div className="card">
        <div className="font-semibold text-slate-100 mb-2">Noise models</div>
        <DataTable
          columns={[
            { key: 'name', header: 'model', render: (r) => r.name },
            { key: 'eq', header: 'equation', render: (r) => <span className="mono whitespace-normal">{r.equation}</span> },
            { key: 'param', header: 'swept parameter', render: (r) => <span className="mono">{r.param}</span> },
          ]}
          rows={d.noise_models ?? []}
          rowKey={(r) => r.name}
        />
        <div className="font-semibold text-slate-100 mt-4 mb-2">Runs</div>
        <DataTable
          columns={[
            { key: 'model', header: 'model', render: (r) => r.noise_model },
            {
              key: 'param',
              header: 'parameter',
              render: (r) => (r.sigma_mV !== undefined ? `sigma = ${fmtNum(r.sigma_mV)} mV` : r.rate_hz !== undefined ? `rate = ${fmtNum(r.rate_hz)} Hz` : 'null'),
            },
            { key: 'seed', header: 'seed', render: (r) => r.seed },
            { key: 'rate', header: 'pop. rate (Hz)', render: (r) => fmtNum(r.pop_rate_hz, 4) },
            { key: 'frac', header: 'fraction active', render: (r) => fmtPct(r.frac_active) },
            { key: 'vstd', header: 'mean V std (mV)', render: (r) => fmtNum(r.mean_v_std_mV, 3) },
          ]}
          rows={d.runs ?? []}
          rowKey={(_, i) => i}
        />
        <ProvenanceFooter provenance={d.provenance} />
      </div>
    </div>
  );
}

function Stage2View({ d }: { d: Stage2 }) {
  const sigmas = useMemo(() => [...new Set(d.per_sigma.map((p) => p.sigma_mV))].sort((a, b) => a - b), [d.per_sigma]);
  const [selSigma, setSelSigma] = useState<number | null>(null);
  const sigmaSel = selSigma ?? d.operating_sigma_mV ?? sigmas[0] ?? null;

  const bands = d.summary_by_sigma.map((s) => ({ sigma: s.sigma_mV, cls: s.classification }));

  const mPoints: SigmaPoint[] = d.per_sigma
    .filter((p) => p.branching_ratio_mr && p.branching_ratio_mr.m !== null)
    .map((p) => {
      const m = p.branching_ratio_mr.m as number;
      const [lo, hi] = p.branching_ratio_mr.ci95 ?? [null, null];
      const err: [number, number] | undefined = lo !== null && hi !== null ? [Math.max(0, m - lo), Math.max(0, hi - m)] : undefined;
      return { sigma: p.sigma_mV, y: m, cls: p.classification, seed: p.seed, err, ciText: `CI95 ${fmtCI([lo, hi])}` };
    });
  const nMissingM = d.per_sigma.length - mPoints.length;
  const ratePoints: SigmaPoint[] = d.per_sigma.map((p) => ({ sigma: p.sigma_mV, y: p.pop_rate_hz, cls: p.classification, seed: p.seed }));
  const fracPoints: SigmaPoint[] = d.per_sigma.map((p) => ({ sigma: p.sigma_mV, y: p.frac_active, cls: p.classification, seed: p.seed }));

  const selRows = d.per_sigma.filter((p) => p.sigma_mV === sigmaSel);

  return (
    <div className="space-y-6">
      <StatusBanner status={d.status} title="Search for a critical regime" criterion={d.criterion} reasons={d.reasons} />

      <RegimeCallout d={d} />

      <div className="card">
        <dl className="kv">
          <dt>network</dt>
          <dd>
            {d.network} · {fmtInt(d.n_neurons)} neurons
          </dd>
          <dt>duration</dt>
          <dd>
            {fmtNum(d.duration_s)} s (warm-up {fmtNum(d.warmup_s)} s discarded)
          </dd>
          <dt>seeds</dt>
          <dd>{d.seeds.join(', ')}</dd>
          <dt>sigma values (mV)</dt>
          <dd>{d.sigma_values_mV.map((v) => fmtNum(v)).join(', ')}</dd>
        </dl>
        <div className="mt-4 font-semibold text-slate-100">Classification criteria (pre-registered)</div>
        <dl className="kv mt-2">
          {(['silent', 'critical', 'saturated'] as const).map((c) => (
            <div key={c} className="contents">
              <dt style={{ color: CLASS_COLORS[c] }}>{c}</dt>
              <dd className="whitespace-normal">{d.criteria?.[c] ?? 'null'}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Figure
          title="Branching ratio m (MR estimator) vs sigma"
          provenance={d.provenance}
          caption={
            <>
              Whiskers: 95% CI of the multistep-regression estimator; dashed line m = 1. Background band colour is the
              per-sigma classification from <span className="mono">summary_by_sigma</span>.
              {nMissingM > 0 && <span className="text-orange-300"> {nMissingM} run(s) have m = null and are not plotted.</span>}
            </>
          }
        >
          <SigmaChart points={mPoints} bands={bands} yLabel="branching ratio m" refY={[{ y: 1, label: 'm = 1' }]} />
        </Figure>
        <Figure title="Population rate vs sigma" provenance={d.provenance} caption="Mean rate over all simulated neurons after warm-up; log x axis.">
          <SigmaChart points={ratePoints} bands={bands} yLabel="population rate (Hz)" />
        </Figure>
        <Figure title="Fraction of neurons active vs sigma" provenance={d.provenance} caption="Fraction of neurons with at least one spike after warm-up.">
          <SigmaChart points={fracPoints} bands={bands} yLabel="fraction active" yDomain={[0, 'auto']} />
        </Figure>
        <div className="card">
          <div className="font-semibold text-slate-100 mb-2">Summary by sigma</div>
          <DataTable
            columns={[
              { key: 's', header: 'sigma (mV)', render: (r) => fmtNum(r.sigma_mV) },
              {
                key: 'c',
                header: 'class',
                render: (r) => <span style={{ color: CLASS_COLORS[r.classification] ?? '#a3a3a3' }}>{r.classification}</span>,
              },
              { key: 'm', header: 'm mean ± sd', render: (r) => `${fmtNum(r.m_mean)} ± ${fmtNum(r.m_sd)}` },
              { key: 'r', header: 'rate mean ± sd (Hz)', render: (r) => `${fmtNum(r.pop_rate_hz_mean, 4)} ± ${fmtNum(r.pop_rate_hz_sd, 4)}` },
              { key: 'f', header: 'frac active', render: (r) => fmtPct(r.frac_active_mean) },
            ]}
            rows={d.summary_by_sigma}
            rowKey={(r) => r.sigma_mV}
          />
          <ProvenanceFooter provenance={d.provenance} />
        </div>
      </div>

      <div className="card">
        <div className="font-semibold text-slate-100 mb-2">Per-run avalanche fits (powerlaw: Clauset-style MLE, likelihood ratio R and p vs alternatives)</div>
        <p className="text-sm text-slate-400 mb-3">
          R &gt; 0 favours the power law over the named alternative; p is the significance of that ratio. n_tail is the number
          of observations at or above xmin.
        </p>
        <FitTable rows={d.per_sigma} />
        <ProvenanceFooter provenance={d.provenance} />
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <div className="font-semibold text-slate-100">Avalanche CCDFs</div>
          <label className="ml-auto text-sm text-slate-400 flex items-center gap-2">
            sigma
            <select
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
              value={sigmaSel ?? ''}
              onChange={(e) => setSelSigma(Number(e.target.value))}
            >
              {sigmas.map((s) => (
                <option key={s} value={s}>
                  {fmtNum(s)} mV{s === d.operating_sigma_mV ? ' (operating)' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        {selRows.length === 0 ? (
          <div className="text-sm text-slate-500">no runs at this sigma</div>
        ) : (
          <>
            <div className="flex flex-wrap gap-3 text-sm mb-3">
              {selRows.map((r) => (
                <span key={r.seed} className="rounded border border-slate-700 px-2 py-0.5">
                  seed {r.seed}: <span style={{ color: CLASS_COLORS[r.classification] }}>{r.classification}</span> · n avalanches{' '}
                  {fmtInt(r.avalanches?.n)} · max size {fmtInt(r.avalanches?.max_size)} · bin {fmtNum(r.avalanches?.bin_ms)} ms
                </span>
              ))}
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <Figure title={`Avalanche size CCDF, sigma = ${fmtNum(sigmaSel)} mV`} provenance={d.provenance}>
                <CcdfChart
                  xLabel="avalanche size (spikes)"
                  series={selRows.map((r, i) => ({ name: `seed ${r.seed}`, color: seedColor(i), x: r.size_ccdf?.x ?? [], y: r.size_ccdf?.y ?? [] }))}
                />
              </Figure>
              <Figure title={`Avalanche duration CCDF, sigma = ${fmtNum(sigmaSel)} mV`} provenance={d.provenance}>
                <CcdfChart
                  xLabel="avalanche duration (bins)"
                  series={selRows.map((r, i) => ({ name: `seed ${r.seed}`, color: seedColor(i), x: r.duration_ccdf?.x ?? [], y: r.duration_ccdf?.y ?? [] }))}
                />
              </Figure>
            </div>
            <div className="mt-3">
              <div className="text-sm font-semibold text-slate-200 mb-1">Classification reasons at this sigma</div>
              <ul className="text-sm text-slate-300 list-disc pl-5">
                {selRows.map((r) => (
                  <li key={r.seed}>
                    seed {r.seed}: {r.reasons?.length ? r.reasons.join('; ') : '(no reasons recorded)'}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RegimeCallout({ d }: { d: Stage2 }) {
  if (d.has_critical_regime) {
    return (
      <Callout tone="positive" title={`Critical regime found · operating sigma = ${fmtNum(d.operating_sigma_mV)} mV`}>
        {d.operating_sigma_reason}
      </Callout>
    );
  }
  return (
    <Callout tone="warning" title="NO critical regime found in this sweep">
      <p>
        This is a finding, not an error: no sigma satisfied the pre-registered critical criterion. Later stages use{' '}
        {d.operating_sigma_mV === null || d.operating_sigma_mV === undefined ? (
          <span>no operating sigma (null)</span>
        ) : (
          <span>
            operating sigma = <span className="mono">{fmtNum(d.operating_sigma_mV)} mV</span>
          </span>
        )}
        .
      </p>
      <p className="mt-1">
        <span className="font-semibold">Reason recorded by the pipeline:</span> {d.operating_sigma_reason}
      </p>
    </Callout>
  );
}

function fitCells(prefix: string, f: PowerLawFit | undefined) {
  const g = (k: keyof PowerLawFit) => (f ? f[k] : null);
  return [
    { key: `${prefix}a`, header: `${prefix} alpha`, render: () => fmtNum(g('alpha')) },
    { key: `${prefix}x`, header: 'xmin', render: () => fmtNum(g('xmin')) },
    { key: `${prefix}n`, header: 'n_tail', render: () => fmtInt(g('n_tail')) },
    { key: `${prefix}re`, header: 'R vs exp', render: () => fmtNum(g('R_vs_exponential')) },
    { key: `${prefix}pe`, header: 'p', render: () => fmtP(g('p_vs_exponential')) },
    { key: `${prefix}rl`, header: 'R vs lognormal', render: () => fmtNum(g('R_vs_lognormal')) },
    { key: `${prefix}pl`, header: 'p', render: () => fmtP(g('p_vs_lognormal')) },
    { key: `${prefix}rt`, header: 'R vs trunc. PL', render: () => fmtNum(g('R_vs_truncated_power_law')) },
    { key: `${prefix}pt`, header: 'p', render: () => fmtP(g('p_vs_truncated_power_law')) },
  ];
}

function FitTable({ rows }: { rows: PerSigma[] }) {
  return (
    <DataTable
      columns={[
        { key: 'sigma', header: 'sigma (mV)', render: (r) => fmtNum(r.sigma_mV) },
        { key: 'seed', header: 'seed', render: (r) => r.seed },
        { key: 'cls', header: 'class', render: (r) => <span style={{ color: CLASS_COLORS[r.classification] ?? '#a3a3a3' }}>{r.classification}</span> },
        { key: 'm', header: 'm [CI95]', render: (r) => `${fmtNum(r.branching_ratio_mr?.m)} ${fmtCI(r.branching_ratio_mr?.ci95)}` },
        { key: 'mn', header: 'm naive', render: (r) => fmtNum(r.branching_ratio_naive) },
        { key: 'nav', header: 'n avalanches', render: (r) => fmtInt(r.avalanches?.n) },
        ...fitCells('size', undefined).map((c, i) => ({ ...c, render: (r: PerSigma) => fitCells('size', r.size_fit)[i].render() })),
        ...fitCells('dur', undefined).map((c, i) => ({ ...c, render: (r: PerSigma) => fitCells('dur', r.duration_fit)[i].render() })),
      ]}
      rows={rows}
      rowKey={(r) => `${r.sigma_mV}-${r.seed}`}
    />
  );
}
