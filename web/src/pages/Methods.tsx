import { useDataFile } from '../lib/data';
import type { Manifest, Provenance } from '../types';
import ParamTable from '../components/ParamTable';
import NotRunPanel from '../components/NotRunPanel';
import ErrorBoundary from '../components/ErrorBoundary';
import ProvenanceFooter from '../components/ProvenanceFooter';
import { MapSlot } from '../components/Layout';

/**
 * Static documentation. Prose here describes the method and contains no results.
 * Every parameter value on this page is read from manifest.model.params so it cannot drift from the pipeline.
 */
export default function Methods() {
  const m = useDataFile<Manifest>('manifest.json');
  return (
    <div>
      <h1 className="page-title">Methods</h1>
      <MapSlot />

      <div className="prose">
        <h2 style={{ marginTop: 0, borderTop: 0, paddingTop: 0 }}>Model</h2>
        <p>
          The network is the leaky integrate-and-fire model of Shiu et al. 2024 (<i>Nature</i>, "A Drosophila computational brain
          model reveals sensorimotor processing"), run in Brian2 over the male CNS connectome (Janelia FlyEM, Google Research
          and Cambridge; <i>Cell</i> 2026). Only the brain is simulated: the connectome covers the whole central nervous system, and
          the brain-only scope used here is recorded in the manifest's filtering steps. The data version actually used is recorded in{' '}
          <span className="mono">manifest.model.data_version</span> and shown on the Overview page. Every reconstructed neuron is a
          single point-neuron compartment; every connection is a current-based synapse whose weight is the synapse count times a
          single global scale factor, with sign taken from the predicted neurotransmitter.
        </p>
        <p>
          Shiu et al.'s constants were fitted on FlyWire, whose synapse detection counts differently from the CNS reconstruction.
          To keep those constants meaningful, every CNS synapse count is multiplied by the <span className="mono">weight_scale</span>{' '}
          factor recorded in the parameter table below (FlyWire-equivalent units) before the synaptic weight{' '}
          <span className="mono">W_syn</span> is formed. FlyWire itself (v630) appears in exactly one place: the Stage 0 engine check, which re-runs the published example
          on the substrate Shiu et al. shipped it with and compares against their released output.
        </p>
        <p className="small muted">
          The model's membrane, synaptic, and scaling constants are not repeated here; the values the pipeline actually used, with
          their recorded sources, are in the table at the bottom of this page (read from <span className="mono">manifest.json</span>).
        </p>

        <h2>What this is not</h2>
        <div className="callout callout--warning">
          <p className="callout__body" style={{ marginTop: 0 }}>
            Keep these limitations in mind when reading any result on this site.
          </p>
          <ul className="mt-2 space-y-1">
            <li>point neurons</li>
            <li>uniform biophysics across all cell types</li>
            <li>predicted (not measured) neurotransmitters</li>
            <li>no morphology</li>
            <li>no body</li>
            <li>no sensory feedback</li>
            <li>no ripple analog</li>
            <li>single plasticity locus (KC→MBON only)</li>
            <li>brain only: the ventral nerve cord is present in the CNS connectome but its neurons are excluded here</li>
            <li>a male brain, while much of the physiology cited for the parameters and the sleep circuitry was measured in females</li>
          </ul>
        </div>

        <h2>Two corrections to the published model</h2>
        <p>
          Two cells in the mushroom body are modelled differently here from the way the published model treats them,
          and both changes follow from a direct measurement on the identified cell rather than from anything this
          project chose. Neither introduces a numeric parameter. Stage 3b on the Learning page reports what each one
          does, measured, with everything else held identical.
        </p>
        <ol className="space-y-4 list-decimal pl-5">
          <li>
            <em>APL releases transmitter continuously, not in spikes.</em> APL is the mushroom body's feedback
            inhibitory neuron, one per hemisphere, and it does not fire action potentials: it releases in proportion to
            its membrane depolarisation (Amin et al. 2020, eLife 9:e56954). The published model gives every neuron a
            spike threshold, which turns the one graded controller of Kenyon-cell sparseness into a threshold device.
            APL is therefore given no threshold here, and its release is rectified at rest and saturates at the spike
            threshold. The scaling introduces nothing new: a cell held at threshold delivers exactly what a spiking
            synapse delivers at the fastest rate the refractory period allows, and proportionally less below it.
          </li>
          <li>
            <em>DPM is inhibitory, not dopaminergic.</em> The connectome's predicted transmitter for DPM is dopamine,
            which the model's sign rule makes excitatory, so its 32,795 synapses onto 3,989 of the 4,064 Kenyon cells
            excite them. Haynes, Christmann and Waddell 2015 (eLife 4:e03868) show DPM cell bodies are Gad1-positive,
            that DPM contains GABA and 5-HT, and that activating it drives a large chloride increase in mushroom-body
            neurons with no detectable calcium or cAMP increase; Lee et al. 2011 (PNAS 108:13794) report it as
            serotonergic. The sign rule is untouched: the measured transmitter is put in place of the predicted one and
            the same rule applied to it.
          </li>
        </ol>
        <p>
          The two pull against each other, which is itself a result rather than a nuisance. Correcting APL is the only
          thing that puts Kenyon-cell coding where it is measured, and the same correction holds DPM and the readout
          MBON below threshold, though both have measured odour responses in the fly. The model gives every neuron the
          same millivolts per synapse, and APL has 234,026 input and 209,913 output synapses.
        </p>

        <h2>Pipeline stages</h2>
        <ol className="space-y-4 list-decimal pl-5">
          <li>
            <em>Stage 0 · Engine check.</em> Re-run Shiu et al.'s published sugar-sensing example (sugar gustatory receptor neurons
            driven with Poisson input, read out at motor neuron MN9) on the FlyWire v630 substrate their result files were produced
            with, and compare against those files; the drive rate and source file are recorded in{' '}
            <span className="mono">stage0_reproduction.json</span> (<span className="mono">target.source</span>). This checks that
            the simulation engine is implemented correctly before the substrate is swapped for the male CNS connectome and anything
            is changed. Rendered on the Overview page.
          </li>
          <li>
            <em>Stage 1 · Noise.</em> The published model is silent without input. To have spontaneous activity at all, a
            membrane-noise term is added (Gaussian voltage noise or Poisson background input) and its effect on population rate and
            the fraction of active neurons is measured.
          </li>
          <li>
            <em>Stage 2 · Criticality.</em> Sweep the noise amplitude sigma. For each value and seed, estimate the branching ratio
            (multistep-regression estimator with a confidence interval), detect neuronal avalanches, and fit power laws to their
            size and duration distributions with likelihood-ratio comparisons against exponential, lognormal, and truncated
            power-law alternatives. Each sigma is classified silent / subcritical / critical / saturated / indeterminate by
            pre-registered rules. The chosen operating sigma is the background state for the remaining stages; if no critical
            regime exists that is reported as a finding.
          </li>
          <li>
            <em>Stage 3 · Plasticity.</em> Install a dopamine-gated plasticity rule on Kenyon-cell → mushroom-body-output-neuron
            (KC→MBON) synapses only. Each MBON compartment is gated by its anatomically matched dopaminergic neuron (DAN) types. An
            isolated pairing unit test confirms the rule moves the weight in the expected direction.
          </li>
          <li>
            <em>Stage 4 · Learning.</em> Present two odors as olfactory-receptor-neuron activation patterns. Pair odor A with DAN
            activation over repeated trials; present odor B without pairing. Compare the readout-MBON response to each odor before
            and after conditioning across seeds. The Kenyon cells active for odor A define the "memory" ensemble whose reactivation
            Stage 6 tests.
          </li>
          <li>
            <em>Stage 5 · Sleep.</em> Induce a sleep-like state by clamping the sleep-promoting dorsal fan-shaped body (dFB) neurons
            at a cited firing rate, and compare population, KC, and MBON rates between the sleep and wake conditions.
          </li>
          <li>
            <em>Stage 6 · Replay.</em> Let the trained network run with no odor input in the sleep and wake states and quantify
            reactivation of the ensemble-A template. Three metrics: template correlation (correlation of each time-bin population
            vector with the ensemble template), coactivation (z-scored pairwise co-firing of ensemble members against a shuffle),
            and sequence (rank correlation of firing order against the order during the odor). The verdict depends on four null
            comparisons.
          </li>
        </ol>

        <h2>The four null comparisons</h2>
        <ul className="space-y-3 list-disc pl-5">
          <li>
            <em>Trained (A) vs unpaired (B), sleep.</em> Is the paired ensemble reactivated more than the unpaired one in the same
            sleep recordings? Controls for generic Kenyon-cell activity.
          </li>
          <li>
            <em>Sleep vs wake, ensemble A.</em> Is reactivation of A stronger in the sleep state than in the wake state? Controls for
            reactivation that has nothing to do with the sleep state.
          </li>
          <li>
            <em>Real vs shuffled connectome.</em> The same protocol run on a network whose connections were shuffled
            (degree-preserving). If the signal is equally strong there it is a property of the statistics, not the wiring, and the
            result is labelled an <em>artifact</em>.
          </li>
          <li>
            <em>A vs random ensembles.</em> Random Kenyon-cell sets of the same size as A. Controls for effects of ensemble size and
            cell-type sampling on the metric.
          </li>
        </ul>
        <p className="mt-4">
          A stage is <em>passed</em> only if its pre-registered criterion is met; <em>failed</em> if it ran and did not meet it;{' '}
          <em>artifact</em> (Stage 6) if a positive result did not survive the shuffled-connectome null. All three are real
          outcomes and are displayed with equal prominence.
        </p>

        <h2>Provenance</h2>
        <p>
          Every number on the other pages is read at load time from the JSON and binary files listed in each figure's provenance
          footer ("config · data · commit"). The site embeds no results. When a file is absent or a stage has not run, the page
          says so and names the script that would produce it.
        </p>
      </div>

      <h2>Parameters as used by the pipeline</h2>
      <ErrorBoundary label="parameter table">
        {m.state === 'loading' && <div className="small muted measure">loading manifest.json …</div>}
        {m.state === 'missing' && <NotRunPanel file="manifest.json" script="scripts/export_web.py" reason="missing" />}
        {m.state === 'error' && <NotRunPanel file="manifest.json" script="scripts/export_web.py" reason="error" />}
        {m.state === 'ready' && (
          <>
            <ParamTable params={m.data.model.params ?? []} />
            <ProvenanceFooter provenance={manifestProvenance(m.data)} />
          </>
        )}
      </ErrorBoundary>
    </div>
  );
}

/** Provenance for a figure whose only source is manifest.json itself. */
function manifestProvenance(m: Manifest): Provenance {
  return { config: m.model?.base_config ?? 'not stated', files: ['web/public/data/manifest.json'], git_commit: m.git_commit, generated_at: m.generated_at };
}
