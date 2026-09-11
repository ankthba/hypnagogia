import { useDataFile } from '../lib/data';
import type { Manifest } from '../types';
import ParamTable from '../components/ParamTable';
import NotRunPanel from '../components/NotRunPanel';
import ErrorBoundary from '../components/ErrorBoundary';

/**
 * Static documentation. Prose here is documentation of the method, not a result.
 * The parameter table at the bottom is read from manifest.json so its sources come from the pipeline.
 */
export default function Methods() {
  const m = useDataFile<Manifest>('manifest.json');
  return (
    <div className="max-w-3xl">
      <h1 className="h1">Methods</h1>

      <h2 className="h2">Model</h2>
      <p className="text-slate-300 leading-relaxed">
        The network is the leaky integrate-and-fire model of Shiu et al. 2024 (<i>Nature</i>, "A Drosophila computational brain
        model reveals sensorimotor processing") run over the FlyWire FAFB v783 connectome in Brian2. Every reconstructed
        neuron is a single point-neuron compartment; every connection is a current-based synapse whose weight is the
        synapse count times a single global scale factor, with sign taken from the predicted neurotransmitter.
      </p>
      <div className="table-wrap mt-3">
        <table className="data-table">
          <thead>
            <tr>
              <th>quantity</th>
              <th>value</th>
              <th>note</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>resting potential V_rest</td><td>−52 mV</td><td /></tr>
            <tr><td>reset potential V_reset</td><td>−52 mV</td><td>reset to rest after a spike</td></tr>
            <tr><td>spike threshold V_threshold</td><td>−45 mV</td><td /></tr>
            <tr><td>membrane time constant</td><td>20 ms</td><td /></tr>
            <tr><td>absolute refractory period</td><td>2.2 ms</td><td /></tr>
            <tr><td>synaptic decay time constant</td><td>5 ms</td><td>exponential current</td></tr>
            <tr><td>synaptic delay</td><td>1.8 ms</td><td /></tr>
            <tr><td>W_syn</td><td>0.275 mV per synapse</td><td>Shiu et al.'s single free parameter; multiplied by synapse count</td></tr>
            <tr><td>synaptic sign</td><td>from predicted neurotransmitter</td><td>ACh (+), glutamate (−, treated as inhibitory), GABA (−), others as in Shiu et al.</td></tr>
            <tr><td>baseline activity</td><td>0 Hz, no noise term</td><td>the unmodified model is silent without input</td></tr>
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-slate-400">
        The values above describe the published model and are documentation. The values the pipeline actually used, with
        their recorded sources, are in the table at the bottom of this page (read from <span className="mono">manifest.json</span>).
      </p>

      <h2 className="h2">What this is not</h2>
      <div className="rounded-lg border-2 border-orange-500/60 bg-orange-500/10 p-4">
        <p className="text-sm text-orange-100 mb-2">Keep these limitations in mind when reading any result on this site.</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-100">
          <li>point neurons</li>
          <li>uniform biophysics across all cell types</li>
          <li>predicted (not measured) neurotransmitters</li>
          <li>no morphology</li>
          <li>no body</li>
          <li>no sensory feedback</li>
          <li>no ripple analog</li>
          <li>single plasticity locus (KC→MBON only)</li>
        </ul>
      </div>

      <h2 className="h2">Pipeline stages</h2>
      <ol className="space-y-3 text-slate-300 leading-relaxed list-decimal pl-5">
        <li>
          <span className="font-semibold text-slate-100">Stage 0 - Reproduction.</span> Re-run Shiu et al.'s published sugar-sensing
          example (sugar gustatory receptor neurons driven at 150 Hz, read out at motor neuron MN9) on our build of the model and
          compare against their released result files. This checks that the model was implemented correctly before anything is
          changed. Rendered on the Overview page.
        </li>
        <li>
          <span className="font-semibold text-slate-100">Stage 1 - Noise.</span> The published model is silent without input. To have
          spontaneous activity at all, a membrane-noise term is added (Gaussian voltage noise or Poisson background input) and its
          effect on population rate and the fraction of active neurons is measured.
        </li>
        <li>
          <span className="font-semibold text-slate-100">Stage 2 - Criticality.</span> Sweep the noise amplitude sigma. For each value
          and seed, estimate the branching ratio (multistep-regression estimator with a confidence interval), detect neuronal
          avalanches, and fit power laws to their size and duration distributions with likelihood-ratio comparisons against
          exponential, lognormal, and truncated power-law alternatives. Each sigma is classified silent / critical / saturated /
          indeterminate by pre-registered rules. The chosen operating sigma is the background state for the remaining stages;
          if no critical regime exists that is reported as a finding.
        </li>
        <li>
          <span className="font-semibold text-slate-100">Stage 3 - Plasticity.</span> Install a dopamine-gated plasticity rule on
          Kenyon-cell → mushroom-body-output-neuron (KC→MBON) synapses only. Each MBON compartment is gated by its anatomically
          matched dopaminergic neuron (DAN) types. An isolated pairing unit test confirms the rule moves the weight in the
          expected direction.
        </li>
        <li>
          <span className="font-semibold text-slate-100">Stage 4 - Learning.</span> Present two odors as olfactory-receptor-neuron
          activation patterns. Pair odor A with DAN activation over repeated trials; present odor B without pairing. Compare the
          readout-MBON response to each odor before and after conditioning across seeds. The Kenyon cells active for odor A
          define the "memory" ensemble whose reactivation Stage 6 tests.
        </li>
        <li>
          <span className="font-semibold text-slate-100">Stage 5 - Sleep.</span> Induce a sleep-like state by clamping the
          sleep-promoting dorsal fan-shaped body (dFB) neurons at a cited firing rate, and compare population, KC, and MBON
          rates between the sleep and wake conditions.
        </li>
        <li>
          <span className="font-semibold text-slate-100">Stage 6 - Replay.</span> Let the trained network run with no odor input in
          the sleep and wake states and quantify reactivation of the ensemble-A template. Three metrics: template correlation
          (correlation of each time-bin population vector with the ensemble template), coactivation (z-scored pairwise
          co-firing of ensemble members against a shuffle), and sequence (rank correlation of firing order against the order
          during the odor). The verdict depends on four null comparisons.
        </li>
      </ol>

      <h2 className="h2">The four null comparisons</h2>
      <ul className="space-y-2 text-slate-300 leading-relaxed list-disc pl-5">
        <li>
          <span className="font-semibold text-slate-100">Trained (A) vs unpaired (B), sleep.</span> Is the paired ensemble reactivated
          more than the unpaired one in the same sleep recordings? Controls for generic Kenyon-cell activity.
        </li>
        <li>
          <span className="font-semibold text-slate-100">Sleep vs wake, ensemble A.</span> Is reactivation of A stronger in the sleep
          state than in the wake state? Controls for reactivation that has nothing to do with the sleep state.
        </li>
        <li>
          <span className="font-semibold text-slate-100">Real vs shuffled connectome.</span> The same protocol run on a network whose
          connections were shuffled (degree-preserving). If the signal is equally strong there it is a property of the statistics,
          not the wiring, and the result is labelled an <span className="font-semibold">artifact</span>.
        </li>
        <li>
          <span className="font-semibold text-slate-100">A vs random ensembles.</span> Random Kenyon-cell sets of the same size as A.
          Controls for effects of ensemble size and cell-type sampling on the metric.
        </li>
      </ul>
      <p className="mt-3 text-slate-300">
        A stage is <span className="font-semibold">passed</span> only if its pre-registered criterion is met; <span className="font-semibold">failed</span>{' '}
        if it ran and did not meet it; <span className="font-semibold">artifact</span> (Stage 6) if a positive result did not survive the
        shuffled-connectome null. All three are real outcomes and are displayed with equal prominence.
      </p>

      <h2 className="h2">Provenance</h2>
      <p className="text-slate-300 leading-relaxed">
        Every number on the other pages is read at load time from the JSON and binary files listed in each figure's provenance
        footer ("config · data · commit"). The site embeds no results. When a file is absent or a stage has not run, the page
        says so and names the script that would produce it.
      </p>

      <h2 className="h2">Parameters as used by the pipeline</h2>
      <ErrorBoundary label="parameter table">
        {m.state === 'loading' && <div className="text-sm text-slate-500">loading manifest.json …</div>}
        {m.state === 'missing' && <NotRunPanel file="manifest.json" script="scripts/export_web.py" reason="missing" />}
        {m.state === 'error' && <NotRunPanel file="manifest.json" script="scripts/export_web.py" reason="error" />}
        {m.state === 'ready' && <ParamTable params={m.data.model.params ?? []} />}
      </ErrorBoundary>
    </div>
  );
}
