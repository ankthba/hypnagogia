import { useState } from 'react';
import { useDataFile } from '../lib/data';
import type { Stage3, Stage4, Stage3bFeasibility } from '../types';
import StageGate from '../components/StageGate';
import { MapSlot } from '../components/Layout';
import StatusBanner from '../components/StatusBanner';
import Figure from '../components/Figure';
import DataTable from '../components/DataTable';
import Callout from '../components/Callout';
import ParamTable from '../components/ParamTable';
import ErrorBoundary from '../components/ErrorBoundary';
import ProvenanceFooter from '../components/ProvenanceFooter';
import PairedPlot from '../components/charts/PairedPlot';
import FeasibilityView from '../components/Feasibility';
import { SERIES } from '../lib/colors';
import { fmtNum, fmtInt, fmtP, fmtCI, fmtPct, NOT_MEASURED, fmtUnit } from '../lib/format';

export default function Learning() {
  const s3 = useDataFile<Stage3>('stage3_plasticity.json');
  const s4 = useDataFile<Stage4>('stage4_learning.json');
  const s3b = useDataFile<Stage3bFeasibility>('stage3b_feasibility.json');
  return (
    <div>
      <h1 className="page-title">Learning</h1>
      <div className="prose"><p>
        Stage 3 adds a dopamine-gated plasticity rule at the single plastic locus (KC → MBON). Stage 4 pairs odor A with
        DAN activation and checks that the MBON response to A, but not to the unpaired odor B, changes. Only if learning
        is verified here does the replay test in Stage 6 have a memory to look for.
      </p><p>
        Before any of that, Stage 3b asks whether there is a sparse Kenyon-cell odour code for a memory to live in. Two
        modelling corrections decide the answer, and they are reported first because everything below inherits them.
      </p></div>
      <MapSlot />

      <section className="mt-8">
        <h2>Stage 3b · is there a code to encode a memory in?</h2>
        <ErrorBoundary label="Stage 3b">
          <StageGate stage="stage3b_feasibility" loaded={s3b}>
            {(d) => <FeasibilityView d={d} />}
          </StageGate>
        </ErrorBoundary>
      </section>

      <section className="mt-10">
        <h2>Stage 4 · associative conditioning</h2>
        <ErrorBoundary label="Stage 4">
          <StageGate stage="stage4_learning" loaded={s4}>
            {(d) => <Stage4View d={d} />}
          </StageGate>
        </ErrorBoundary>
      </section>

      <section className="mt-10">
        <h2>Stage 3 · plasticity rule</h2>
        <ErrorBoundary label="Stage 3">
          <StageGate stage="stage3_plasticity" loaded={s3}>
            {(d) => <Stage3View d={d} />}
          </StageGate>
        </ErrorBoundary>
      </section>
    </div>
  );
}

function Stage4View({ d }: { d: Stage4 }) {
  const seeds = d.per_seed ?? [];
  const [mbonSeed, setMbonSeed] = useState<number | null>(null);
  const seedForMbon = mbonSeed ?? seeds[0]?.seed ?? null;
  const mbonRows = seeds.find((s) => s.seed === seedForMbon)?.per_mbon ?? [];
  const e = d.effect;

  return (
    <div className="space-y-6">
      <StatusBanner status={d.status} title="Conditioning outcome" criterion={d.criterion} reasons={d.reasons} />

      {typeof d.learning_verified !== 'boolean' ? (
        <Callout tone="negative" title="Field missing from stage file">
          <span className="mono">learning_verified</span> is absent (or not a boolean) in <span className="mono">stage4_learning.json</span>
          {d.learning_verified === undefined ? ' (the field is not present at all)' : <>; it holds <span className="mono">{JSON.stringify(d.learning_verified)}</span></>}. No
          verdict can be shown.
        </Callout>
      ) : d.learning_verified ? (
        <Callout tone="positive" title="Learning verified">
          The paired odor (A) changed the MBON readout relative to the unpaired odor (B) under the pre-registered criterion.
          Δ(A) − Δ(B) = {fmtNum(e?.diff_of_deltas, 4)}, 95% CI {fmtCI(e?.ci95, 4)}, n = {fmtInt(e?.n_seeds)} seeds.
        </Callout>
      ) : (
        <Callout tone="negative" title="Learning NOT verified">
          <p>
            The change in MBON response to the paired odor did not meet the pre-registered criterion relative to the unpaired odor.
            Δ(A) − Δ(B) = {fmtNum(e?.diff_of_deltas, 4)}, 95% CI {fmtCI(e?.ci95, 4)}, p = {fmtP(e?.p_paired)}, n = {fmtInt(e?.n_seeds)}{' '}
            seeds. Downstream replay results should be read with this in mind.
          </p>
          {d.reasons && d.reasons.length > 0 ? (
            <ul className="mt-1.5 list-disc pl-5 space-y-0.5">
              {d.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 muted">(no reasons recorded in the stage file)</p>
          )}
        </Callout>
      )}

      <div className="cols-2">
        <Figure title="MBON response to odor A (paired) - before vs after" provenance={d.provenance} caption="Thin lines: individual seeds; thick line: mean across seeds. Response = mean readout-MBON rate during the test window.">
          <PairedPlot seeds={seeds.map((s) => ({ seed: s.seed, pre: s.A_pre, post: s.A_post }))} color={SERIES.A} label="MBON rate (Hz)" />
        </Figure>
        <Figure title="MBON response to odor B (unpaired) - before vs after" provenance={d.provenance} caption="Same seeds and readout; odor B was presented but never paired with DAN activation.">
          <PairedPlot seeds={seeds.map((s) => ({ seed: s.seed, pre: s.B_pre, post: s.B_post }))} color={SERIES.B} label="MBON rate (Hz)" />
        </Figure>
      </div>

      <div className="card">
        <div className="label label--ink mb-3">Effect</div>
        <div className="stats">
          <Stat label="Δ A mean (post − pre)" value={fmtNum(e?.delta_A_mean, 4)} />
          <Stat label="Δ B mean (post − pre)" value={fmtNum(e?.delta_B_mean, 4)} />
          <Stat label="diff of deltas" value={fmtNum(e?.diff_of_deltas, 4)} emphasis />
          <Stat label="95% CI" value={fmtCI(e?.ci95, 4)} />
          <Stat label="Hedges g" value={fmtNum(e?.hedges_g, 3)} emphasis />
          <Stat label="p (paired)" value={fmtP(e?.p_paired)} />
          <Stat label="n seeds" value={fmtInt(e?.n_seeds)} />
        </div>
        <ProvenanceFooter provenance={d.provenance} />
      </div>

      <div className="cols-2">
        <div className="card">
          <div className="label label--ink mb-2">Protocol</div>
          <DataTable
            columns={[
              { key: 'k', header: 'field', render: (r) => r[0] },
              { key: 'v', header: 'value', render: (r) => <span className="whitespace-normal">{r[1]}</span> },
            ]}
            rows={[
              ['odor A ORN types', (d.protocol?.odor_A?.orn_types ?? []).join(', ') || 'not stated'],
              ['odor A n ORNs / rate', `${fmtInt(d.protocol?.odor_A?.n_orns)} / ${fmtUnit(d.protocol?.odor_A?.rate_hz, 'Hz')}`],
              ['odor B ORN types', (d.protocol?.odor_B?.orn_types ?? []).join(', ') || 'not stated'],
              ['odor B n ORNs / rate', `${fmtInt(d.protocol?.odor_B?.n_orns)} / ${fmtUnit(d.protocol?.odor_B?.rate_hz, 'Hz')}`],
              ['DAN types', (d.protocol?.dans?.types ?? []).join(', ') || 'not stated'],
              ['DAN n / rate', `${fmtInt(d.protocol?.dans?.n)} / ${fmtUnit(d.protocol?.dans?.rate_hz, 'Hz')}`],
              ['n pairings', fmtInt(d.protocol?.n_pairings)],
              ['odor duration', fmtUnit(d.protocol?.odor_s, 's')],
              ['inter-trial interval', fmtUnit(d.protocol?.iti_s, 's')],
              ['test window', fmtUnit(d.protocol?.test_s, 's')],
              ['background noise sigma', fmtUnit(d.protocol?.sigma_mV, 'mV')],
              ['seeds', (d.seeds ?? []).join(', ') || 'not stated'],
              ['readout MBONs', (d.readout_mbons ?? []).map((m) => `${m.type} (${m.root_id})`).join(', ') || 'not stated'],
            ]}
            rowKey={(r) => r[0]}
          />
          <ProvenanceFooter provenance={d.provenance} />
        </div>
        <div className="card">
          <div className="label label--ink mb-2">KC ensembles</div>
          <div className="stats stats--2">
            <Stat label="ensemble A size (mean)" value={fmtNum(d.kc_ensemble_summary?.A_size_mean, 1)} />
            <Stat label="ensemble B size (mean)" value={fmtNum(d.kc_ensemble_summary?.B_size_mean, 1)} />
            <Stat label="A ∩ B overlap (mean)" value={fmtNum(d.kc_ensemble_summary?.overlap_mean, 1)} />
            <Stat label="fraction of KCs active for A" value={fmtPct(d.kc_ensemble_summary?.frac_kc_active_A)} />
          </div>
          <div className="label label--ink mt-5 mb-2">Per seed</div>
          <DataTable
            columns={[
              { key: 'seed', header: 'seed', render: (r) => r.seed },
              { key: 'ap', header: 'A pre', render: (r) => fmtNum(r.A_pre, 4) },
              { key: 'aq', header: 'A post', render: (r) => fmtNum(r.A_post, 4) },
              { key: 'bp', header: 'B pre', render: (r) => fmtNum(r.B_pre, 4) },
              { key: 'bq', header: 'B post', render: (r) => fmtNum(r.B_post, 4) },
              { key: 'ka', header: '|A|', render: (r) => fmtInt(r.kc_ensemble_A_size) },
              { key: 'kb', header: '|B|', render: (r) => fmtInt(r.kc_ensemble_B_size) },
              { key: 'ov', header: 'overlap', render: (r) => fmtInt(r.kc_overlap) },
              { key: 'wb', header: 'w(A→MBON) before', render: (r) => fmtNum(r.w_kc_mbon_A_mean_before, 4) },
              { key: 'wa', header: 'w(A→MBON) after', render: (r) => fmtNum(r.w_kc_mbon_A_mean_after, 4) },
            ]}
            rows={seeds}
            rowKey={(r) => r.seed}
          />
          <ProvenanceFooter provenance={d.provenance} />
        </div>
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <div className="label label--ink">Per-MBON responses</div>
          <label className="ml-auto small muted flex items-center gap-2">
            seed
            <select className="control" value={seedForMbon ?? ''} onChange={(ev) => setMbonSeed(Number(ev.target.value))}>
              {seeds.map((s) => (
                <option key={s.seed} value={s.seed}>
                  {s.seed}
                </option>
              ))}
            </select>
          </label>
        </div>
        <DataTable
          columns={[
            { key: 't', header: 'type', render: (r) => r.type },
            { key: 'id', header: 'root id', render: (r) => <span className="mono">{r.root_id}</span> },
            { key: 'ap', header: 'A pre', render: (r) => fmtNum(r.A_pre, 4) },
            { key: 'aq', header: 'A post', render: (r) => fmtNum(r.A_post, 4) },
            { key: 'da', header: 'Δ A', render: (r) => fmtNum(r.A_post - r.A_pre, 4) },
            { key: 'bp', header: 'B pre', render: (r) => fmtNum(r.B_pre, 4) },
            { key: 'bq', header: 'B post', render: (r) => fmtNum(r.B_post, 4) },
            { key: 'db', header: 'Δ B', render: (r) => fmtNum(r.B_post - r.B_pre, 4) },
          ]}
          rows={mbonRows}
          rowKey={(r) => r.root_id}
          empty="no per-MBON rows for this seed"
          pageSize={20}
        />
        <ProvenanceFooter provenance={d.provenance} />
      </div>
    </div>
  );
}

function Stage3View({ d }: { d: Stage3 }) {
  const ut = d.unit_test;
  return (
    <div className="space-y-6">
      <StatusBanner status={d.status} title="Plasticity rule installed" criterion={d.criterion} reasons={d.reasons} />
      {ut && (
        <Callout tone={ut.passed ? 'positive' : 'negative'} title={`Unit test ${ut.passed ? 'passed' : 'FAILED'}: ${ut.description}`}>
          w before = {fmtNum(ut.w_before, 5)} → w after = {fmtNum(ut.w_after, 5)} (expected direction: {ut.expected_direction}; observed:{' '}
          {ut.w_after < ut.w_before ? 'depression' : ut.w_after > ut.w_before ? 'potentiation' : 'no change'})
        </Callout>
      )}
      <div className="card">
        <div className="label label--ink mb-2">Rule</div>
        <p className="small mb-3">{d.rule?.description}</p>
        <pre className="equations">{(d.rule?.equations ?? []).join('\n')}</pre>
        <dl className="kv mt-4">
          <dt>plastic synapses</dt>
          <dd>{fmtInt(d.n_plastic_synapses)}</dd>
          <dt>KCs</dt>
          <dd>{fmtInt(d.n_kc)}</dd>
          <dt>MBONs</dt>
          <dd>{fmtInt(d.n_mbon)}</dd>
          <dt>DANs</dt>
          <dd>{fmtInt(d.n_dan)}</dd>
        </dl>
        <div className="label label--ink mt-5 mb-2">Rule parameters</div>
        <ParamTable params={d.rule?.parameters ?? []} />
        <div className="label label--ink mt-5 mb-2">DAN → MBON compartment map</div>
        <DataTable
          columns={[
            { key: 'm', header: 'MBON type', render: (r) => r.mbon_type },
            { key: 'side', header: 'side', render: (r) => r.side ?? NOT_MEASURED },
            { key: 'd', header: 'gating DAN types', render: (r) => <span className="whitespace-normal">{danTypes(r.dan_types)}</span> },
            { key: 'n', header: 'n plastic synapses', render: (r) => fmtInt(r.n_syn) },
          ]}
          rows={d.dan_to_mbon_map ?? []}
          rowKey={(r, i) => `${r.mbon ?? r.mbon_type}-${r.side ?? ''}-${i}`}
          pageSize={20}
        />
        <div className="smaller muted mt-2">
          Where the file gives each gating DAN type a synapse count, the count is printed with the name; where it gives a bare list of
          names, the names are printed alone.
        </div>
        <ProvenanceFooter provenance={d.provenance} />
      </div>
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

/**
 * The gating DAN types of one MBON compartment, in whichever shape the stage file wrote them: a
 * list of names, or an object mapping each name to the number of synapses it contributes (which is
 * what the file actually holds, and is more than the contract's list, so the counts are shown).
 */
function danTypes(v: string[] | Record<string, number> | null | undefined): string {
  if (Array.isArray(v)) return v.length > 0 ? v.join(', ') : NOT_MEASURED;
  if (v && typeof v === 'object') {
    const es = Object.entries(v).filter(([, n]) => typeof n === 'number');
    if (es.length === 0) return NOT_MEASURED;
    return es
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} (${fmtInt(n)})`)
      .join(', ');
  }
  return NOT_MEASURED;
}
