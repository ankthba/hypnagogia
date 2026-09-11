import { useEffect, useMemo, useState } from 'react';
import { useDataFile } from '../lib/data';
import { loadRaster, loadTrace, type RasterData, type TraceData, type BinLoad } from '../lib/binary';
import type { Stage5, Stage6 } from '../types';
import StageGate from '../components/StageGate';
import StatusBanner from '../components/StatusBanner';
import Figure from '../components/Figure';
import DataTable from '../components/DataTable';
import ErrorBoundary from '../components/ErrorBoundary';
import ProvenanceFooter from '../components/ProvenanceFooter';
import ForestPlot from '../components/charts/ForestPlot';
import RasterViewer from '../components/charts/RasterViewer';
import { fmtNum, fmtInt, fmtP, fmtCI, fmtPct } from '../lib/format';

type Cond = 'sleep' | 'wake';

export default function Replay() {
  const s6 = useDataFile<Stage6>('stage6_replay.json');
  const s5 = useDataFile<Stage5>('stage5_sleep.json');
  const [cond, setCond] = useState<Cond>('sleep');

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="h1">Replay</h1>
        <div className="ml-auto inline-flex rounded-md border border-slate-700 overflow-hidden" role="tablist" aria-label="condition">
          {(['sleep', 'wake'] as Cond[]).map((c) => (
            <button
              key={c}
              role="tab"
              aria-selected={cond === c}
              onClick={() => setCond(c)}
              className={`px-4 py-1.5 text-sm font-medium ${cond === c ? 'bg-slate-200 text-slate-900' : 'bg-slate-900 text-slate-300 hover:bg-slate-800'}`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 text-slate-400 max-w-3xl">
        Does the odor-A Kenyon-cell ensemble learned in Stage 4 reactivate spontaneously during the simulated sleep state
        from Stage 5, more than the unpaired ensemble, more than in wake, more than in a shuffled connectome, and more than
        random ensembles of the same size? Selected condition: <span className="font-semibold text-slate-200">{cond}</span>.
      </p>

      <section className="mt-6">
        <ErrorBoundary label="Stage 6">
          <StageGate stage="stage6_replay" loaded={s6}>
            {(d) => <Stage6View d={d} cond={cond} />}
          </StageGate>
        </ErrorBoundary>
      </section>

      <section className="mt-10">
        <h2 className="h2">Stage 5 - sleep state</h2>
        <ErrorBoundary label="Stage 5">
          <StageGate stage="stage5_sleep" loaded={s5}>
            {(d) => <Stage5View d={d} />}
          </StageGate>
        </ErrorBoundary>
      </section>
    </div>
  );
}

function statusSentence(status: string): string {
  switch (status) {
    case 'passed':
      return 'Result: the pre-registered replay criterion was met and the effect survived every null comparison.';
    case 'failed':
      return 'Result: the pre-registered replay criterion was NOT met. There is no evidence of replay in this run.';
    case 'artifact':
      return 'Result: ARTIFACT. A positive signal was observed, but it did NOT survive the shuffled-connectome null - the same signal appears in a network whose wiring has been randomised, so it cannot be attributed to the learned memory.';
    default:
      return `Result status "${status}".`;
  }
}

function Stage6View({ d, cond }: { d: Stage6; cond: Cond }) {
  const seedsForCond = useMemo(() => {
    const s = new Set<number>();
    (d.rasters ?? []).filter((r) => r.condition === cond).forEach((r) => s.add(r.seed));
    (d.traces ?? []).filter((r) => r.condition === cond).forEach((r) => s.add(r.seed));
    return [...s].sort((a, b) => a - b);
  }, [d, cond]);
  const [seedSel, setSeedSel] = useState<number | null>(null);
  const seed = seedSel !== null && seedsForCond.includes(seedSel) ? seedSel : (seedsForCond[0] ?? null);

  const rasterEntry = (d.rasters ?? []).find((r) => r.condition === cond && r.seed === seed) ?? null;
  const traceEntry = (d.traces ?? []).find((r) => r.condition === cond && r.seed === seed) ?? null;

  const [raster, setRaster] = useState<BinLoad<RasterData> | 'loading' | null>(null);
  const [trace, setTrace] = useState<BinLoad<TraceData> | 'loading' | null>(null);

  useEffect(() => {
    let cancel = false;
    if (rasterEntry) {
      setRaster('loading');
      loadRaster(rasterEntry.file).then((r) => !cancel && setRaster(r));
    } else setRaster(null);
    if (traceEntry) {
      setTrace('loading');
      loadTrace(traceEntry.file).then((r) => !cancel && setTrace(r));
    } else setTrace(null);
    return () => {
      cancel = true;
    };
  }, [rasterEntry, traceEntry]);

  const perSeedRows = (d.per_seed ?? []).filter((r) => r.condition === cond);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-700 bg-slate-900 p-5">
        <div className="text-xl sm:text-2xl font-semibold leading-snug text-slate-50">{d.headline}</div>
        <div className="mt-2 text-xs text-slate-500">
          headline sentence from <span className="mono">stage6_replay.json</span> · window {fmtNum(d.window_ms)} ms · {fmtInt(d.n_seeds)} seeds
        </div>
      </div>

      <StatusBanner status={d.status} title={statusSentence(d.status)} criterion={d.criterion} reasons={d.reasons} />

      <Figure
        title="Four comparisons - effect sizes"
        provenance={d.provenance}
        caption="Each row is one pre-registered null comparison. 'Survives' / 'does not' is the pipeline's own verdict for that comparison. A positive g means the first-named condition scored higher on the metric."
      >
        <ForestPlot comparisons={d.comparisons} />
      </Figure>

      <div className="card">
        <div className="font-semibold text-slate-100 mb-2">Comparison values</div>
        <DataTable
          columns={[
            { key: 'l', header: 'comparison', render: (c) => <span className="whitespace-normal">{c.label}</span> },
            { key: 'n', header: 'name', render: (c) => <span className="mono">{c.name}</span> },
            { key: 'm', header: 'metric', render: (c) => c.metric },
            { key: 'x', header: 'x mean', render: (c) => fmtNum(c.x_mean, 4) },
            { key: 'y', header: 'y mean', render: (c) => fmtNum(c.y_mean, 4) },
            { key: 'd', header: 'diff', render: (c) => fmtNum(c.diff, 4) },
            { key: 'ci', header: 'diff CI95', render: (c) => fmtCI(c.ci95, 4) },
            { key: 'g', header: 'Hedges g', render: (c) => fmtNum(c.hedges_g, 3) },
            { key: 'gci', header: 'g CI95', render: (c) => fmtCI(c.g_ci95, 3) },
            { key: 'p', header: 'p', render: (c) => fmtP(c.p) },
            { key: 'nn', header: 'n', render: (c) => fmtInt(c.n) },
            {
              key: 's',
              header: 'survives',
              render: (c) => <span className={c.survives ? 'text-emerald-300' : 'text-red-300 font-semibold'}>{c.survives ? 'yes' : 'NO'}</span>,
            },
          ]}
          rows={d.comparisons ?? []}
          rowKey={(c) => c.name}
        />
        <ProvenanceFooter provenance={d.provenance} />
      </div>

      <Figure
        title={`KC ensemble raster - ${cond}${seed !== null ? `, seed ${seed}` : ''}`}
        provenance={d.provenance}
        right={
          <label className="text-sm text-slate-400 flex items-center gap-2">
            seed
            <select className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100" value={seed ?? ''} onChange={(e) => setSeedSel(Number(e.target.value))} disabled={seedsForCond.length === 0}>
              {seedsForCond.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        }
        caption="Top: spikes of the ensemble neurons (rows grouped A / B / other KC). Bottom: Pearson correlation between the population vector in each bin and the A and B templates, with the reactivation threshold. Both panels share the time axis; drag the slider or press Play."
      >
        {seedsForCond.length === 0 ? (
          <div className="rounded border-2 border-dashed border-slate-600 p-4 text-sm text-slate-300">
            No raster or trace sidecar is listed in <span className="mono">stage6_replay.json</span> for condition "{cond}". Expected entries under{' '}
            <span className="mono">rasters[]</span> / <span className="mono">traces[]</span> pointing at <span className="mono">data/replay/raster_{cond}_seed&lt;k&gt;.json</span>; produced by{' '}
            <span className="mono">scripts/stage6_replay.py</span> + <span className="mono">scripts/export_web.py</span>.
          </div>
        ) : (
          <>
            {raster !== null && raster !== 'loading' && !raster.ok && (
              <div className="mb-2 rounded border-2 border-dashed border-slate-600 p-3 text-sm text-slate-300">
                raster not available: <span className="mono">{raster.path}</span> - {raster.message}
              </div>
            )}
            {trace !== null && trace !== 'loading' && !trace.ok && (
              <div className="mb-2 rounded border-2 border-dashed border-slate-600 p-3 text-sm text-slate-300">
                trace not available: <span className="mono">{trace.path}</span> - {trace.message}
              </div>
            )}
            {(raster === 'loading' || trace === 'loading') && <div className="text-sm text-slate-500 mb-2">loading binary data …</div>}
            <RasterViewer raster={raster && raster !== 'loading' && raster.ok ? raster.data : null} trace={trace && trace !== 'loading' && trace.ok ? trace.data : null} />
          </>
        )}
      </Figure>

      <div className="card">
        <div className="font-semibold text-slate-100 mb-2">Per-seed metrics - {cond}</div>
        <DataTable
          columns={[
            { key: 'seed', header: 'seed', render: (r) => r.seed },
            { key: 'net', header: 'network', render: (r) => r.network },
            { key: 'ens', header: 'ensemble', render: (r) => r.ensemble },
            { key: 'tc', header: 'template corr mean', render: (r) => fmtNum(r.template_corr_mean, 4) },
            { key: 'tp', header: 'template corr p95', render: (r) => fmtNum(r.template_corr_p95, 4) },
            { key: 'ev', header: 'reactivation events', render: (r) => fmtInt(r.n_reactivation_events) },
            { key: 'cz', header: 'coactivation z', render: (r) => fmtNum(r.coactivation_z, 3) },
            { key: 'sr', header: 'sequence rho', render: (r) => fmtNum(r.sequence_rho, 3) },
            { key: 'sp', header: 'sequence p', render: (r) => fmtP(r.sequence_p) },
          ]}
          rows={perSeedRows}
          rowKey={(r, i) => `${r.seed}-${r.network}-${r.ensemble}-${i}`}
          empty={`no per-seed rows for condition "${cond}"`}
        />
        <ProvenanceFooter provenance={d.provenance} />
      </div>

      <div className="card">
        <div className="font-semibold text-slate-100 mb-2">Metric definitions (from the stage file)</div>
        <dl className="kv">
          {Object.entries(d.metrics ?? {}).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="mono">{k}</dt>
              <dd className="whitespace-normal">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

function Stage5View({ d }: { d: Stage5 }) {
  return (
    <div className="space-y-4">
      <StatusBanner status={d.status} title="Sleep-state induction" criterion={d.criterion} reasons={d.reasons} />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="font-semibold text-slate-100 mb-2">Dorsal fan-shaped body clamp</div>
          <dl className="kv">
            <dt>dFB cell types</dt>
            <dd className="whitespace-normal">{(d.dfb?.cell_types ?? []).join(', ') || 'null'}</dd>
            <dt>n neurons</dt>
            <dd>{fmtInt(d.dfb?.n_neurons)}</dd>
            <dt>selection source</dt>
            <dd className="whitespace-normal">{d.dfb?.selection_source}</dd>
            <dt>clamp rate</dt>
            <dd>{fmtNum(d.dfb?.clamp_rate_hz)} Hz</dd>
            <dt>rate source</dt>
            <dd className="whitespace-normal">{d.dfb?.rate_source}</dd>
          </dl>
          <div className="font-semibold text-slate-100 mt-4 mb-1">Conditions</div>
          <dl className="kv">
            {Object.entries(d.conditions ?? {}).map(([k, v]) => (
              <div key={k} className="contents">
                <dt>{k}</dt>
                <dd className="whitespace-normal">{v.description}</dd>
              </div>
            ))}
          </dl>
          <ProvenanceFooter provenance={d.provenance} />
        </div>
        <div className="card">
          <div className="font-semibold text-slate-100 mb-2">Population rates by condition</div>
          <DataTable
            columns={[
              { key: 'c', header: 'condition', render: (r) => r.condition },
              { key: 'p', header: 'pop. rate (Hz)', render: (r) => fmtNum(r.pop_rate_hz_mean, 4) },
              { key: 'k', header: 'KC rate (Hz)', render: (r) => fmtNum(r.kc_rate_hz_mean, 4) },
              { key: 'd', header: 'dFB rate (Hz)', render: (r) => fmtNum(r.dfb_rate_hz_mean, 4) },
            ]}
            rows={d.summary ?? []}
            rowKey={(r) => r.condition}
          />
          <div className="font-semibold text-slate-100 mt-4 mb-2">Per seed</div>
          <DataTable
            columns={[
              { key: 's', header: 'seed', render: (r) => r.seed },
              { key: 'c', header: 'condition', render: (r) => r.condition },
              { key: 'p', header: 'pop. rate', render: (r) => fmtNum(r.pop_rate_hz, 4) },
              { key: 'k', header: 'KC rate', render: (r) => fmtNum(r.kc_rate_hz, 4) },
              { key: 'm', header: 'MBON rate', render: (r) => fmtNum(r.mbon_rate_hz, 4) },
              { key: 'd', header: 'dFB rate', render: (r) => fmtNum(r.dfb_rate_hz, 4) },
              { key: 'f', header: 'frac active', render: (r) => fmtPct(r.frac_active) },
            ]}
            rows={d.per_seed ?? []}
            rowKey={(r, i) => `${r.seed}-${r.condition}-${i}`}
          />
          <ProvenanceFooter provenance={d.provenance} />
        </div>
      </div>
    </div>
  );
}

