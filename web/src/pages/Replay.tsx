import { useEffect, useMemo, useState } from 'react';
import { useDataFile } from '../lib/data';
import { loadRaster, loadTrace, type RasterData, type TraceData, type BinLoad } from '../lib/binary';
import type { Comparison, Stage5, Stage6 } from '../types';
import StageGate from '../components/StageGate';
import StatusBanner from '../components/StatusBanner';
import Figure from '../components/Figure';
import DataTable from '../components/DataTable';
import ErrorBoundary from '../components/ErrorBoundary';
import ProvenanceFooter from '../components/ProvenanceFooter';
import ForestPlot, { REQUIRED_COMPARISONS } from '../components/charts/ForestPlot';
import RasterViewer from '../components/charts/RasterViewer';
import { fmtNum, fmtInt, fmtP, fmtCI, fmtPct } from '../lib/format';

type Cond = 'sleep' | 'wake';

export default function Replay() {
  const s6 = useDataFile<Stage6>('stage6_replay.json');
  const s5 = useDataFile<Stage5>('stage5_sleep.json');
  const [cond, setCond] = useState<Cond>('sleep');

  return (
    <div>
      <h1 className="page-title">Replay</h1>
      <div className="measure mb-4 flex flex-wrap items-center gap-4">
        <span className="label">condition</span>
        <div className="segmented" role="tablist" aria-label="condition">
          {(['sleep', 'wake'] as Cond[]).map((c) => (
            <button key={c} type="button" role="tab" aria-selected={cond === c} onClick={() => setCond(c)} className="segmented__option" data-text={c}>
              {c}
            </button>
          ))}
        </div>
      </div>
      <div className="prose"><p>
        Does the odor-A Kenyon-cell ensemble learned in Stage 4 reactivate spontaneously during the simulated sleep state
        from Stage 5, more than the unpaired ensemble, more than in wake, more than in a shuffled connectome, and more than
        random ensembles of the same size? Selected condition: <em>{cond}</em>.
      </p></div>

      <section className="mt-6">
        <ErrorBoundary label="Stage 6">
          <StageGate stage="stage6_replay" loaded={s6}>
            {(d) => <Stage6View d={d} cond={cond} />}
          </StageGate>
        </ErrorBoundary>
      </section>

      <section className="mt-10">
        <h2>Stage 5 · sleep state</h2>
        <ErrorBoundary label="Stage 5">
          <StageGate stage="stage5_sleep" loaded={s5}>
            {(d) => <Stage5View d={d} />}
          </StageGate>
        </ErrorBoundary>
      </section>
    </div>
  );
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
      loadRaster(rasterEntry.file)
        .then((r) => !cancel && setRaster(r))
        .catch((e) => !cancel && setRaster({ ok: false, missing: false, message: e instanceof Error ? e.message : String(e), path: rasterEntry.file }));
    } else setRaster(null);
    if (traceEntry) {
      setTrace('loading');
      loadTrace(traceEntry.file)
        .then((r) => !cancel && setTrace(r))
        .catch((e) => !cancel && setTrace({ ok: false, missing: false, message: e instanceof Error ? e.message : String(e), path: traceEntry.file }));
    } else setTrace(null);
    return () => {
      cancel = true;
    };
  }, [rasterEntry, traceEntry]);

  const perSeedRows = (d.per_seed ?? []).filter((r) => r.condition === cond);

  // Verdict summary computed from the file, never from the status enum.
  const comparisons: Comparison[] = d.comparisons ?? [];
  const nSurvive = comparisons.filter((c) => c.survives === true).length;
  const presentNames = new Set(comparisons.map((c) => c.name));
  const missingRequired = REQUIRED_COMPARISONS.filter((n) => !presentNames.has(n));
  const unexpected = comparisons.filter((c) => !(REQUIRED_COMPARISONS as readonly string[]).includes(c.name));
  type CompRow = { kind: 'present'; c: Comparison } | { kind: 'missing'; name: string };
  const compRows: CompRow[] = [
    ...REQUIRED_COMPARISONS.map<CompRow>((n) => {
      const c = comparisons.find((x) => x.name === n);
      return c ? { kind: 'present', c } : { kind: 'missing', name: n };
    }),
    ...unexpected.map<CompRow>((c) => ({ kind: 'present', c })),
  ];

  return (
    <div className="space-y-6">
      <div className="measure" style={{ borderTop: '1px solid var(--color-fg)', paddingTop: '1rem' }}>
        <div className="banner__title" style={{ fontSize: '1.6rem' }}>{d.headline}</div>
        <div className="mt-2 smaller muted">
          headline sentence from <span className="mono">stage6_replay.json</span> · window {fmtNum(d.window_ms)} ms · {fmtInt(d.n_seeds)} seeds
        </div>
      </div>

      <StatusBanner status={d.status} title="Replay verdict" criterion={d.criterion} reasons={d.reasons}>
        <div>
          {fmtInt(nSurvive)} of {fmtInt(comparisons.length)} comparisons listed in the file survive
          {missingRequired.length > 0 && (
            <span className="tone-failed"> · {missingRequired.length} of the 4 pre-registered comparisons missing from the file</span>
          )}
          .
        </div>
      </StatusBanner>

      <Figure
        title="Four pre-registered comparisons - effect sizes"
        provenance={d.provenance}
        caption={
          <>
            Each row is one pre-registered null comparison ({REQUIRED_COMPARISONS.join(', ')}). 'Survives' / 'does not' is the
            pipeline's own verdict for that comparison. A positive g means the first-named condition scored higher on the metric.
            {missingRequired.length > 0 && (
              <span className="tone-failed"> {missingRequired.length} required comparison(s) are missing from the file and are shown as missing rows.</span>
            )}
            {unexpected.length > 0 && (
              <span className="tone-failed"> {unexpected.length} comparison(s) in the file are not among the four pre-registered names and are labelled unexpected.</span>
            )}
          </>
        }
      >
        <ForestPlot comparisons={comparisons} />
      </Figure>

      <div className="card">
        <div className="label label--ink mb-2">Comparison values</div>
        <DataTable<CompRow>
          columns={[
            {
              key: 'l',
              header: 'comparison',
              render: (r) =>
                r.kind === 'missing' ? (
                  <span className="whitespace-normal tone-failed">
                    comparison <span className="mono">{r.name}</span> missing from stage6_replay.json
                  </span>
                ) : (
                  <span className="whitespace-normal">
                    {r.c.label}
                    {!(REQUIRED_COMPARISONS as readonly string[]).includes(r.c.name) && (
                      <span className="badge badge--failed ml-2">unexpected</span>
                    )}
                  </span>
                ),
            },
            { key: 'n', header: 'name', render: (r) => <span className="mono">{r.kind === 'missing' ? r.name : r.c.name}</span> },
            { key: 'm', header: 'metric', render: (r) => (r.kind === 'missing' ? '—' : r.c.metric) },
            { key: 'x', header: 'x mean', render: (r) => (r.kind === 'missing' ? '—' : fmtNum(r.c.x_mean, 4)) },
            { key: 'y', header: 'y mean', render: (r) => (r.kind === 'missing' ? '—' : fmtNum(r.c.y_mean, 4)) },
            { key: 'd', header: 'diff', render: (r) => (r.kind === 'missing' ? '—' : fmtNum(r.c.diff, 4)) },
            { key: 'ci', header: 'diff CI95', render: (r) => (r.kind === 'missing' ? '—' : fmtCI(r.c.ci95, 4)) },
            { key: 'g', header: 'Hedges g', render: (r) => (r.kind === 'missing' ? '—' : fmtNum(r.c.hedges_g, 3)) },
            { key: 'gci', header: 'g CI95', render: (r) => (r.kind === 'missing' ? '—' : fmtCI(r.c.g_ci95, 3)) },
            { key: 'p', header: 'p', render: (r) => (r.kind === 'missing' ? '—' : fmtP(r.c.p)) },
            { key: 'nn', header: 'n', render: (r) => (r.kind === 'missing' ? '—' : fmtInt(r.c.n)) },
            {
              key: 's',
              header: 'survives',
              render: (r) =>
                r.kind === 'missing' ? (
                  <span className="tone-failed">MISSING</span>
                ) : (
                  <span className={r.c.survives ? 'tone-passed' : 'tone-failed'}>{r.c.survives ? 'yes' : 'NO'}</span>
                ),
            },
          ]}
          rows={compRows}
          rowKey={(r) => (r.kind === 'missing' ? `missing-${r.name}` : r.c.name)}
          rowClass={(r) => (r.kind === 'missing' ? 'row--flag' : '')}
        />
        <ProvenanceFooter provenance={d.provenance} />
      </div>

      <Figure
        title={`KC ensemble raster - ${cond}${seed !== null ? `, seed ${seed}` : ''}`}
        provenance={d.provenance}
        right={
          <label className="small muted flex items-center gap-2">
            seed
            <select className="control" value={seed ?? ''} onChange={(e) => setSeedSel(Number(e.target.value))} disabled={seedsForCond.length === 0}>
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
          <div className="notrun small" style={{ maxWidth: 'none' }}>
            No raster or trace sidecar is listed in <span className="mono">stage6_replay.json</span> for condition "{cond}". Expected entries under{' '}
            <span className="mono">rasters[]</span> / <span className="mono">traces[]</span> pointing at <span className="mono">data/replay/raster_{cond}_seed&lt;k&gt;.json</span>; produced by{' '}
            <span className="mono">scripts/06_replay.py</span> + <span className="mono">scripts/export_web.py</span>.
          </div>
        ) : (
          <>
            {raster !== null && raster !== 'loading' && !raster.ok && (
              <div className="mb-2 notrun small" style={{ maxWidth: 'none' }}>
                raster not available: <span className="mono">{raster.path}</span> - {raster.message}
              </div>
            )}
            {trace !== null && trace !== 'loading' && !trace.ok && (
              <div className="mb-2 notrun small" style={{ maxWidth: 'none' }}>
                trace not available: <span className="mono">{trace.path}</span> - {trace.message}
              </div>
            )}
            {(raster === 'loading' || trace === 'loading') && <div className="small muted mb-2">loading binary data …</div>}
            <RasterViewer raster={raster && raster !== 'loading' && raster.ok ? raster.data : null} trace={trace && trace !== 'loading' && trace.ok ? trace.data : null} />
          </>
        )}
      </Figure>

      <div className="card">
        <div className="label label--ink mb-2">Per-seed metrics - {cond}</div>
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
        <div className="label label--ink mb-2">Metric definitions (from the stage file)</div>
        <dl className="kv">
          {Object.entries(d.metrics ?? {}).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="mono">{k}</dt>
              <dd className="whitespace-normal">{v}</dd>
            </div>
          ))}
        </dl>
        <ProvenanceFooter provenance={d.provenance} />
      </div>
    </div>
  );
}

function Stage5View({ d }: { d: Stage5 }) {
  return (
    <div className="space-y-4">
      <StatusBanner status={d.status} title="Sleep-state induction" criterion={d.criterion} reasons={d.reasons} />
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="card">
          <div className="label label--ink mb-2">Dorsal fan-shaped body clamp</div>
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
          <div className="label label--ink mt-5 mb-1">Conditions</div>
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
          <div className="label label--ink mb-2">Population rates by condition</div>
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
          <div className="label label--ink mt-5 mb-2">Per seed</div>
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

