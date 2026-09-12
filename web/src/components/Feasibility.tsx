import type { ReactNode } from 'react';
import type { CorrectionSummary, Stage3bFeasibility } from '../types';
import Callout from './Callout';
import DataTable, { type Column } from './DataTable';
import Figure from './Figure';
import StatusBanner from './StatusBanner';
import { fmtInt, fmtNum, fmtPct, NOT_MEASURED } from '../lib/format';

/**
 * Stage 3b: whether there is a sparse Kenyon-cell odour code for a memory to live in, and the two
 * modelling corrections that decide the answer.
 *
 * Nothing here is computed in the browser. Every number is read out of `stage3b_feasibility.json`,
 * which the exporter assembles from the six stage files it names in its own provenance block. A
 * section whose source file has not been written is not rendered at all, rather than rendered empty.
 */

const yn = (v: unknown) => (v === true ? 'yes' : v === false ? 'no' : NOT_MEASURED);
const num = (v: unknown, d = 3) => (typeof v === 'number' && Number.isFinite(v) ? fmtNum(v, d) : NOT_MEASURED);
const pct = (v: unknown, d = 2) => (typeof v === 'number' && Number.isFinite(v) ? fmtPct(v, d) : NOT_MEASURED);

/** A row of the small before/after table that both corrections use. */
function CorrectionTable({ summary, labels }: { summary: Record<string, CorrectionSummary>; labels: Record<string, string> }) {
  const rows = Object.entries(summary)
    .filter(([, v]) => v && v.odor && v.post)
    .map(([k, v]) => ({ key: k, label: labels[k] ?? k, ...v }));
  const cols: Column<(typeof rows)[number]>[] = [
    { key: 'label', header: 'condition', render: (r) => r.label },
    { key: 'frac', header: 'KCs responding', render: (r) => pct(r.odor.frac_kc) },
    { key: 'kco', header: 'KC rate, odour', render: (r) => `${num(r.odor.kc_rate_hz)} Hz` },
    { key: 'kcp', header: 'KC rate, after', render: (r) => `${num(r.post.kc_rate_hz)} Hz` },
    { key: 'brain', header: 'whole brain, after', render: (r) => `${num(r.post.pop_rate_hz)} Hz` },
    { key: 'n', header: 'seeds', render: (r) => fmtInt(r.n_seeds) },
  ];
  return <DataTable columns={cols} rows={rows} rowKey={(r) => r.key} empty="the stage file lists no conditions" />;
}

/** The measured values a correction is being read against, so the reader is not asked to take it on trust. */
function Measured({ children }: { children: ReactNode }) {
  return <p className="smaller muted measure">{children}</p>;
}

export default function FeasibilityView({ d }: { d: Stage3bFeasibility }) {
  const apl = d.apl_correction;
  const dpm = d.dpm_correction;
  const cal = d.odor_calibration;
  const ign = d.ignition_threshold;
  const ctl = d.dataset_control;
  const gain = d.gain_sensitivity;
  const cost = d.gain_cost_on_gustatory_benchmark;
  const dis = d.discriminability;

  return (
    <div className="space-y-6">
      <StatusBanner status={d.status} title="Is there a sparse odour code to encode a memory in?" criterion={d.criterion} />

      {apl && (
        <Figure
          title="The APL correction"
          provenance={apl.provenance}
          flat
          caption={apl.finding}
        >
          <div className="prose">
            <p>{apl.correction}</p>
          </div>
          {apl.why_it_matters && <WhyTable why={apl.why_it_matters} />}
          {apl.summary && (
            <CorrectionTable
              summary={apl.summary}
              labels={{ apl_spiking: 'APL modelled as a spiking neuron (published model)', apl_graded: 'APL modelled as non-spiking (corrected)' }}
            />
          )}
          <Measured>
            Measured in the fly, for comparison: an odour drives 6 ± 5% of Kenyon cells (Turner, Bazhenov and Laurent 2008,
            J Neurophysiol 99:734), and a Kenyon cell idles near 0.1 Hz.
          </Measured>
        </Figure>
      )}

      {dpm && (
        <Figure title="The DPM transmitter correction" provenance={dpm.provenance} flat caption={dpm.finding}>
          <div className="prose">
            <p>{dpm.correction}</p>
          </div>
          {dpm.why_it_matters && <WhyTable why={dpm.why_it_matters} />}
          {dpm.summary && (
            <CorrectionTable
              summary={dpm.summary}
              labels={{ dpm_annotated: "DPM as the connectome predicts it (dopamine, excitatory)", dpm_corrected: 'DPM as measured (GABA, inhibitory)' }}
            />
          )}
          {dpm.dpm_is_silent && (
            <Callout tone="warning" title="The correction is right and inert">
              DPM never fires in either condition, so the sign of a transmitter it never releases changes nothing. It is one of
              the cells the corrected APL holds below threshold. The assignment is still corrected everywhere, and this is
              recorded rather than dropped.
            </Callout>
          )}
        </Figure>
      )}

      {cal && (
        <Figure title="Odour drive that gives a sparse Kenyon-cell code" provenance={cal.provenance} flat caption={cal.finding}>
          {cal.reference && <Measured>{cal.reference}</Measured>}
          <DataTable
            columns={[
              { key: 'set', header: 'glomeruli', render: (r) => (r.set == null ? NOT_MEASURED : String(r.set)) },
              { key: 'rate', header: 'ORN rate', render: (r) => `${num(r.rate_hz, 0)} Hz` },
              { key: 'n_orn', header: 'ORNs', render: (r) => fmtInt(Number(r.n_orn ?? 0)) },
              { key: 'frac', header: 'KCs responding', render: (r) => pct(r.frac_kc_active) },
              { key: 'spk', header: 'spikes per active KC', render: (r) => num(r.spikes_per_active_kc, 1) },
              { key: 'kco', header: 'KC rate, odour', render: (r) => `${num(r.kc_rate_hz_odor)} Hz` },
              { key: 'kcp', header: 'KC rate, after', render: (r) => `${num(r.kc_rate_hz_post)} Hz` },
              { key: 'sparse', header: 'sparse', render: (r) => yn(r.sparse) },
              { key: 'usable', header: 'usable', render: (r) => yn(r.usable) },
            ]}
            rows={cal.grid ?? []}
            rowKey={(r, i) => `${r.set}-${r.rate_hz}-${i}`}
            rowClass={(r) => (r.usable ? 'row--emph' : '')}
            empty="the stage file lists no drive levels"
            pageSize={20}
          />
        </Figure>
      )}

      {ign && (
        <Figure title="How little drive ignites the whole brain" provenance={undefined} flat caption={ign.finding}>
          <DataTable
            columns={[
              { key: 'n', header: 'receptor neurons driven', render: (r) => fmtInt(Number(r.n_driven ?? 0)) },
              { key: 'p', header: 'fraction of seeds that ignite', render: (r) => pct(r.fraction_ignited, 0) },
              { key: 'during', header: 'brain rate during', render: (r) => `${num(r.pop_rate_odor_mean)} Hz` },
              { key: 'after', header: 'brain rate after', render: (r) => `${num(r.pop_rate_post_mean)} Hz` },
            ]}
            rows={ign.grid ?? []}
            rowKey={(r, i) => `ign-${r.n_driven}-${i}`}
            empty="the stage file lists no drive levels"
          />
        </Figure>
      )}

      {ctl && (
        <Figure title="Is the runaway the dataset or the model?" provenance={ctl.provenance} flat caption={ctl.finding}>
          {ctl.pathway_control && <Measured>{ctl.pathway_control}</Measured>}
          <DataTable
            columns={[
              { key: 'cond', header: 'network', render: (r) => (r.condition == null ? NOT_MEASURED : String(r.condition)) },
              { key: 'path', header: 'pathway', render: (r) => (r.pathway == null ? NOT_MEASURED : String(r.pathway)) },
              { key: 'rate', header: 'drive', render: (r) => `${num(r.rate_hz, 0)} Hz` },
              { key: 'n', header: 'neurons', render: (r) => fmtInt(Number(r.n_neurons ?? 0)) },
              { key: 'ign', header: 'fraction ignited', render: (r) => pct(r.frac_ignited, 0) },
              { key: 'kc', header: 'KCs responding', render: (r) => pct(r.frac_kc_odor) },
              { key: 'after', header: 'brain rate after', render: (r) => `${num(r.pop_rate_post)} Hz` },
            ]}
            rows={ctl.grid ?? []}
            rowKey={(_r, i) => `ctl-${i}`}
            empty="the stage file lists no conditions"
            pageSize={12}
          />
        </Figure>
      )}

      {gain && (
        <Figure title="Would a weaker synapse fix it?" provenance={gain.provenance} flat caption={gain.finding}>
          {gain.WARNING && (
            <Callout tone="warning" title="The gain multiplier is not a cited parameter">
              {gain.WARNING}
            </Callout>
          )}
          <DataTable
            columns={[
              { key: 'g', header: 'gain', render: (r) => num(r.gain, 2) },
              { key: 'w', header: 'effective W_syn', render: (r) => `${num(r.w_syn_effective_mV, 5)} mV` },
              { key: 'frac', header: 'KCs responding', render: (r) => pct(r.frac_kc_odor) },
              { key: 'kco', header: 'KC rate, odour', render: (r) => `${num(r.kc_rate_odor)} Hz` },
              { key: 'kcp', header: 'KC rate, after', render: (r) => `${num(r.kc_rate_post)} Hz` },
              { key: 'ro', header: 'readout MBON', render: (r) => `${num(r.readout_rate_odor, 2)} Hz` },
              { key: 'sparse', header: 'sparse', render: (r) => yn(r.sparse) },
            ]}
            rows={gain.grid ?? []}
            rowKey={(r, i) => `gain-${r.gain}-${i}`}
            rowClass={(r) => (gain.chosen_gain !== null && gain.chosen_gain !== undefined && r.gain === gain.chosen_gain ? 'row--emph' : '')}
            empty="the stage file lists no gains"
          />
          {cost?.finding && <Measured>{cost.finding}</Measured>}
        </Figure>
      )}

      {dis && (
        <Figure title="Do two odours leave two different ensembles?" provenance={dis.provenance} flat caption={dis.finding}>
          {dis.note && <Measured>{dis.note}</Measured>}
          <DataTable
            columns={[
              { key: 'g', header: 'gain', render: (r) => num(r.gain, 2) },
              { key: 'ep', header: 'epoch', render: (r) => (r.epoch == null ? NOT_MEASURED : String(r.epoch)) },
              { key: 'a', header: 'KCs for odour A', render: (r) => pct(r.frac_kc_A) },
              { key: 'b', header: 'KCs for odour B', render: (r) => pct(r.frac_kc_B) },
              { key: 'j', header: 'overlap', render: (r) => num(r.jaccard_observed) },
              { key: 'c', header: 'overlap by chance', render: (r) => num(r.jaccard_chance) },
              { key: 'd', header: 'discriminable', render: (r) => yn(r.discriminable) },
            ]}
            rows={dis.grid ?? []}
            rowKey={(_r, i) => `dis-${i}`}
            empty="the stage file lists no gains"
            pageSize={12}
          />
        </Figure>
      )}
    </div>
  );
}

/** The connectome arithmetic behind a correction, as a two-column list. */
function WhyTable({ why }: { why: Record<string, number | string | null> }) {
  const rows = Object.entries(why)
    .filter(([k, v]) => k !== 'note' && k !== 'source' && v !== null && v !== undefined)
    .map(([k, v]) => ({ k, label: k.replace(/_/g, ' '), v }));
  const note = typeof why.note === 'string' ? why.note : null;
  const source = typeof why.source === 'string' ? why.source : null;
  return (
    <>
      <DataTable
        columns={[
          { key: 'k', header: 'quantity', render: (r) => r.label },
          {
            key: 'v',
            header: 'value',
            render: (r) =>
              typeof r.v === 'number' ? (Number.isInteger(r.v) ? fmtInt(r.v) : fmtNum(r.v, 4)) : r.v == null ? NOT_MEASURED : String(r.v),
          },
        ]}
        rows={rows}
        rowKey={(r) => r.k}
        empty="the stage file states no figures"
        pageSize={12}
      />
      {note && <p className="smaller muted measure">{note}</p>}
      {source && <p className="smaller muted measure">Source: {source}</p>}
    </>
  );
}
