# hypnagogia: results

*Generated 2026-09-12T01:21:06+00:00 by `scripts/make_results.py`. Every number is read from a file under `results/`; nothing in this document is written by hand. Stages that have not run say so.*

**Question.** Can a whole-brain *Drosophila* connectome model spontaneously reactivate a learned memory during a simulated sleep state? Encode an odour memory through dopamine-gated plasticity at Kenyon-cell to mushroom-body-output-neuron synapses, then look for the same Kenyon-cell ensemble switching on again, by itself, during an offline period with no odour input.

## Headline

**The replay test as specified cannot be run on this model, and the reason is itself the result.**

Two independent findings block it, and neither came from tuning anything:

1. *There is no critical regime, because the network is bistable.* Sweeping the background noise never produces a sustained intermediate activity level. Seeds at the same noise amplitude either stay silent or ignite into a saturated state. The Kenyon-cell firing rate measured in a real fly, about 0.1 Hz, falls inside a gap of more than four orders of magnitude that the model cannot occupy.
2. *There is no sparse odour code to encode a memory in.* Every olfactory stimulus tested, down to a single glomerulus driven at 10 Hz, makes more than half of all Kenyon cells fire, and the activity outlasts the stimulus because the network ignites. In a real fly about 5 to 10 per cent of Kenyon cells respond to an odour, each with a few spikes.

A memory needs a sparse, odour-specific ensemble, and a replay test needs a quiet background for that ensemble to reappear against. This model, at this scale and with the published parameters, provides neither. Reporting that is the honest outcome; the alternative would have been to change parameters until the plots looked right, which this project does not do.

## What was simulated

- Dataset: male CNS connectome v1.0 (Janelia FlyEM / Google Research / Cambridge Connectomics, *Cell* 2026), brain-only scope.
- **Neurons actually simulated: 144,209.** This is the count after filtering, not a headline figure. The filtering chain is:
  - bodies in body-annotations table: 211,577 -> 211,577 neurons, 25,563,197 -> 25,563,197 connections
  - status == 'Traced' (proofread neurons): 211,577 -> 165,122 neurons, 25,563,197 -> 25,563,197 connections
  - scope == 'brain': drop superclass vnc_* (VNC), ENS, and Traced bodies with no superclass: 165,122 -> 144,209 neurons, 25,563,197 -> 21,868,062 connections
- Connections: 21,868,062. Raw synapses: 101,079,336. After the 0.581 FlyWire-equivalence scaling that the male CNS release specifies, the effective synapse count entering the model is 58,727,094.
- Excitatory connections 13,502,767, inhibitory 8,365,295, signed per presynaptic neuron from its predicted neurotransmitter.
- Neurotransmitter assignment: acetylcholine 92,610, glutamate 27,132, gaba 16,783, histamine 5,902, unknown 952, dopamine 395, serotonin 352, octopamine 83.
- Ventral nerve cord neurons are excluded. Loading them is behind `dataset.scope: cns` for later motor work.

## Stage 0 - does the engine reproduce the published model, and does the male CNS network behave?

**Engine check: passed.** Our Brian2 implementation was run on the *same* data the published model ships (FlyWire v630) with the same protocol, and compared against the output file in the paper's own repository.

| sugar-GRN drive | MN9 rate, ours | MN9 rate, published output | active neurons, ours | published | per-neuron rate correlation |
|---|---|---|---|---|---|
| 100 Hz | 67.47 Hz | 67.03 Hz | 428 | 404 | r = 0.9997 |
| 200 Hz | 92.80 Hz | 93.27 Hz | 447 | 448 | r = 0.9999 |

One discrepancy worth recording: the example output shipped in the repository was generated at 200 Hz (its sugar neurons fire at about 199 Hz), not at the 150 Hz that the current `model.py` has as its default. We compared at 200 Hz and at 100 Hz, the two frequencies for which shipped outputs exist.

**Male CNS validation gate: passed.** gate = propagation benchmark (the response-magnitude test); the two scale-factor statistics are reported alongside (one fails, one passes) and did not lead to any retuning

- Weight scaling. The male CNS release specifies that its synapse counts should be scaled by 0.581 to be comparable with FlyWire. We tested that on our own tables two ways, over 39,307 cell-type pairs present in both datasets. The **pre-registered** statistic (count-weighted median of the per-pair mean-synapse ratio) gave **0.795**, which is outside the [0.45, 0.75] window we declared in advance. The total-input statistic (ratio of total synapses over the same pairs) gave **0.547**, which matches 0.581 closely. Both are reported. Neither `W_syn` nor the scale factor was retuned. The difference between the two statistics is that the male CNS detects about 45% more connected pairs, mostly weak ones, so a per-pair average understates the difference in total synaptic input, which is what the model actually integrates.
- Propagation. Driving the male counterparts of the published sugar neurons at 200 Hz makes MN9 fire at 80.4 Hz in 100% of trials, with 431 neurons active per trial, against 92.8 Hz and 402 neurons in FlyWire at the same drive. That is the biologically plausible range the gate asked for.
- Without the scaling (weight_scale 1.0) the identical drive activates 11064 neurons per trial instead of a few hundred: the network runs away. The scale factor is doing real work, not cosmetic work.
- Cell-type mapping. Of the 21 published sugar neurons, 17 have one-to-one morphological matches among male labellar LB3 neurons; 4 do not and are reported rather than forced.

**Cross-matching every target population to its FlyWire counterpart.** 13 of 14 populations matched cleanly in both directions.

| population | male CNS | FlyWire | male->FlyWire top-1 in population | FlyWire->male top-1 | verdict |
|---|---|---|---|---|---|
| KC | 4064 | 5177 | 100% | 100% | ok |
| MBON | 97 | 96 | 99% | 99% | ok |
| PAM | 316 | 307 | 97% | 99% | ok |
| PPL1 | 16 | 16 | 100% | 100% | ok |
| DAN | 340 | 331 | 97% | 99% | ok |
| ORN | 2635 | 2275 | 99% | 100% | ok |
| dFB | 32 | 33 | 97% | 100% | ok |
| dFB_core | 22 | 23 | 100% | 96% | ok |
| dFB_wake_DAN | 6 | 6 | 100% | 100% | ok |
| MN9 | 2 | 2 | 100% | 50% | AMBIGUOUS: only 50% of FlyWire members have their best NBLAST match inside the male-CNS population |
| sugar_GRN | 78 | 122 | 92% | 88% | ok |
| APL | 2 | 2 | 100% | 100% | ok |
| ALPN | 686 | 685 | 100% | 99% | ok |
| CX | 2950 | 2875 | 100% | 99% | ok |

## Stage 1 - adding background noise

**passed.** The published model has no noise term: its baseline firing rate is exactly 0 Hz and the network is silent without input. Two background drives were added and verified.

| drive | parameter | measured membrane s.d. | population rate | fraction of neurons active |
|---|---|---|---|---|
| gaussian | sigma = 1.0 mV | 0.995 mV | 0.0000 Hz/neuron | 0.0% |
| gaussian | sigma = 2.0 mV | 1.967 mV | 0.1154 Hz/neuron | 29.3% |
| gaussian | sigma = 3.0 mV | 2.734 mV | 2.3167 Hz/neuron | 99.9% |
| gaussian | sigma = 4.0 mV | 3.338 mV | 6.5750 Hz/neuron | 100.0% |
| poisson | 50.0 Hz | 0.042 mV | 0.0000 Hz/neuron | 0.0% |
| poisson | 100.0 Hz | 0.060 mV | 0.0000 Hz/neuron | 0.0% |
| poisson | 200.0 Hz | 0.085 mV | 0.0000 Hz/neuron | 0.0% |

With synapses switched off, the Gaussian drive reproduces its target membrane standard deviation to within 0.5%, which is the check that the stochastic term is integrated correctly. The Poisson drive at the published single-synapse weight is far too weak to reach threshold on its own.

## Stage 2 - is there a critical regime? No. The model is bistable.

**passed.** Noise amplitude was swept over 26 values (0.5 to 8.0 mV) with up to 10 seeds each, on the full 144,209-neuron network.

**There is no critical regime: `has_critical_regime = False`.** That is a finding, not a failure, and it was a stated possibility before the sweep ran: the model has no spike-frequency adaptation and no short-term synaptic depression, so nothing holds it at an intermediate activity level.

What the sweep found instead is **bistability**. At 7 noise amplitudes (1.41, 1.43, 1.44, 1.45, 1.46, 1.47, 1.5 mV) independent seeds of the *same* simulation either stayed quiescent or ignited into a high-rate state, with nothing in between. The noise amplitude controls the probability of ignition, not the resulting rate.

| noise sigma | seeds | probability of ignition | KC rate if quiescent | KC rate if ignited |
|---|---|---|---|---|
| 0.5 mV | 3 | 0% | 0.00000 Hz | - |
| 0.71 mV | 3 | 0% | 0.00000 Hz | - |
| 1.0 mV | 3 | 0% | 0.00000 Hz | - |
| 1.41 mV | 10 | 20% | 0.00038 Hz | 25.6 Hz |
| 1.42 mV | 3 | 0% | 0.00043 Hz | - |
| 1.43 mV | 10 | 20% | 0.00048 Hz | 25.7 Hz |
| 1.44 mV | 3 | 33% | 0.00068 Hz | 23.2 Hz |
| 1.45 mV | 10 | 40% | 0.00059 Hz | 28.3 Hz |
| 1.46 mV | 3 | 33% | 0.00086 Hz | 23.4 Hz |
| 1.47 mV | 10 | 40% | 0.00087 Hz | 28.4 Hz |
| 1.48 mV | 3 | 100% | - | 28.6 Hz |
| 1.5 mV | 10 | 70% | 0.00131 Hz | 30.8 Hz |
| 1.55 mV | 3 | 100% | - | 33.8 Hz |
| 1.6 mV | 3 | 100% | - | 39.2 Hz |
| 1.65 mV | 3 | 100% | - | 39.5 Hz |
| 1.7 mV | 3 | 100% | - | 39.7 Hz |
| 1.75 mV | 3 | 100% | - | 40.0 Hz |
| 1.8 mV | 3 | 100% | - | 40.3 Hz |
| 1.85 mV | 3 | 100% | - | 40.6 Hz |
| 1.9 mV | 3 | 100% | - | 40.7 Hz |
| 1.95 mV | 3 | 100% | - | 40.9 Hz |
| 2.0 mV | 3 | 100% | - | 41.3 Hz |
| 2.83 mV | 3 | 100% | - | 45.0 Hz |
| 4.0 mV | 3 | 100% | - | 53.0 Hz |
| 5.66 mV | 3 | 100% | - | 68.6 Hz |
| 8.0 mV | 3 | 100% | - | 82.2 Hz |

**The consequence matters more than the criticality question.** The measured spontaneous firing rate of Kenyon cells in a real fly is about 0.1 Hz (Turner, Bazhenov & Laurent 2008, *J Neurophysiol* 99:734). In this model the quiescent branch puts Kenyon cells near 0.0005 Hz and the ignited branch puts them above 20 Hz. **0.1 Hz falls inside a gap of more than four orders of magnitude that the model cannot produce at any noise amplitude.** There is no setting of the background drive at which the mushroom body idles the way a real one does.

Operating point chosen for the downstream stages: **sigma = 1.41 mV**. NO critical regime found in the sweep (no sigma satisfied all criteria; the network is bistable - silent below the transition and continuously active above it). The operating point for the downstream stages is therefore NOT a critical point: it is the non-saturated sigma whose Kenyon-cell population rate is closest to the measured KC spontaneous rate of 0.1 Hz (Turner, Bazhenov & Laurent 2008 J Neurophysiol 99:734), i.e. sigma = 1.41 mV (KC rate 5.1292 Hz, whole-brain rate 0.4367 Hz/neuron, m = 0.9983271721650149).

Two methodological points, both of which changed the numbers:

- Avalanche statistics were being computed by binning spike times in seconds. With a 0.1 ms time step that division is not exact in floating point, and it produced a deterministic repeating pattern of spuriously empty bins - identical in every run, including runs with different seeds - which fabricated avalanche boundaries. Binning is now done in integer simulation steps. Before the fix, every high-rate run reported exactly 2,529 avalanches; after it, those runs correctly report that the population never pauses.
- When the mean interval between spikes anywhere in the brain falls below the simulation time step, the Beggs and Plenz avalanche definition has nothing to bite on. Those runs are now labelled 'avalanche analysis not applicable' instead of being binned at the time step and reported as if the numbers meant something.
- The branching ratio is estimated by the multistep-regression method, which assumes the population autocorrelation decays exponentially. In the high-rate state it does not: it oscillates, with a negative lag-1 autocorrelation. Those runs no longer report a branching ratio from the exponential fit.

## Stage 3b - is there a sparse odour code to build a memory on? No.

**failed.** In a real fly about 5-10% of Kenyon cells respond to a given odour, each firing a few spikes (Honegger, Campbell & Turner 2011 J Neurosci 31:11772: mean responding fraction <= 0.10; Turner, Bazhenov & Laurent 2008 J Neurophysiol 99:734: 6 +/- 5% of KCs, 2-5 spikes per response).

NO odour drive in the scan produced a sparse, transient Kenyon-cell response. Either the response fraction is far above the 5-10% measured in real flies, or the activity outlasts the odour because the network ignites. This is a property of the published model at this scale, not a tuning failure: no parameter was changed to obtain it.

| glomeruli driven | receptor neurons | drive | Kenyon cells responding | spikes per responding cell | rate during | rate after |
|---|---|---|---|---|---|---|
| 1 glomerulus | 74 | 10 Hz | **57.4%** | 54 | 2.7319 Hz/neuron | 2.8782 Hz/neuron |
| 1 glomerulus | 74 | 20 Hz | **58.5%** | 54 | 2.7972 Hz/neuron | 2.8806 Hz/neuron |
| 1 glomerulus | 74 | 50 Hz | **59.3%** | 54 | 2.8501 Hz/neuron | 2.8840 Hz/neuron |
| 1 glomerulus | 74 | 100 Hz | **60.2%** | 55 | 2.9214 Hz/neuron | 2.8814 Hz/neuron |
| 1 glomerulus | 74 | 150 Hz | **61.1%** | 56 | 2.9870 Hz/neuron | 2.8738 Hz/neuron |
| 2 glomeruli | 106 | 10 Hz | **57.9%** | 54 | 2.7657 Hz/neuron | 2.8816 Hz/neuron |
| 2 glomeruli | 106 | 20 Hz | **58.5%** | 54 | 2.8080 Hz/neuron | 2.8872 Hz/neuron |
| 2 glomeruli | 106 | 50 Hz | **60.3%** | 55 | 2.8905 Hz/neuron | 2.8759 Hz/neuron |
| 2 glomeruli | 106 | 100 Hz | **62.3%** | 56 | 2.9968 Hz/neuron | 2.8780 Hz/neuron |
| 2 glomeruli | 106 | 150 Hz | **63.2%** | 56 | 3.0895 Hz/neuron | 2.8802 Hz/neuron |
| 4 glomeruli | 243 | 10 Hz | **58.9%** | 54 | 2.8077 Hz/neuron | 2.8829 Hz/neuron |
| 4 glomeruli | 243 | 20 Hz | **61.2%** | 54 | 2.8896 Hz/neuron | 2.8762 Hz/neuron |
| 4 glomeruli | 243 | 50 Hz | **63.4%** | 56 | 3.0422 Hz/neuron | 2.8819 Hz/neuron |
| 4 glomeruli | 243 | 100 Hz | **66.5%** | 58 | 3.2756 Hz/neuron | 2.8758 Hz/neuron |
| 4 glomeruli | 243 | 150 Hz | **67.7%** | 59 | 3.4441 Hz/neuron | 2.8838 Hz/neuron |

The last two columns are the important ones: the population rate after the odour ends is the same as the rate during it. The stimulus does not drive a response, it triggers a transition, and the network stays in the new state afterwards. Before the odour the network is exactly silent.

**How little input does it take?** As few as 1 receptor neurons driven at 50.0 Hz are enough to ignite the whole network into a self-sustaining state.

| receptor neurons driven | probability of ignition | rate during stimulus | rate after |
|---|---|---|---|
| 1 | 100% | 2.5270 Hz/neuron | 2.8808 Hz/neuron |
| 2 | 100% | 2.5592 Hz/neuron | 2.8793 Hz/neuron |
| 3 | 100% | 2.7115 Hz/neuron | 2.8851 Hz/neuron |
| 5 | 100% | 2.6749 Hz/neuron | 2.8825 Hz/neuron |
| 8 | 100% | 2.7233 Hz/neuron | 2.8809 Hz/neuron |
| 12 | 100% | 2.7421 Hz/neuron | 2.8788 Hz/neuron |
| 20 | 100% | 2.7730 Hz/neuron | 2.8807 Hz/neuron |
| 35 | 100% | 2.7956 Hz/neuron | 2.8817 Hz/neuron |
| 74 | 100% | 2.8527 Hz/neuron | 2.8803 Hz/neuron |

## Stage 3d - how far from the published model would you have to go?

**Not run.**

## Stage 3c - is the runaway the model, or this dataset?

Olfactory input ignites BOTH the male CNS and the FlyWire networks at identical parameters. The runaway is a property of the published model when it is driven through the olfactory pathway, not of the male CNS dataset. The published sugar-neuron benchmark does not reveal it because that stimulus is small.

| network | pathway | neurons driven | drive | probability of ignition | Kenyon cells responding | neurons active | rate during | rate after |
|---|---|---|---|---|---|---|---|---|
| malecns_scaled | olfactory | 74 | 10 Hz | 100% | 57.2% | 7905 | 2.7494 | 2.8835 |
| malecns_scaled | olfactory | 74 | 50 Hz | 100% | 59.5% | 8038 | 2.8467 | 2.8797 |
| malecns_scaled | olfactory | 74 | 150 Hz | 100% | 61.5% | 8171 | 2.9998 | 2.8796 |
| malecns_unscaled | olfactory | 74 | 10 Hz | 100% | 100.0% | 14651 | 7.1775 | 7.3960 |
| malecns_unscaled | olfactory | 74 | 50 Hz | 100% | 100.0% | 14736 | 7.2923 | 7.3947 |
| malecns_unscaled | olfactory | 74 | 150 Hz | 100% | 100.0% | 14810 | 7.4469 | 7.3961 |
| flywire_783 | olfactory | 68 | 10 Hz | 100% | 65.0% | 8431 | 3.3454 | 3.4361 |
| flywire_783 | olfactory | 68 | 50 Hz | 100% | 65.2% | 8473 | 3.4094 | 3.4332 |
| flywire_783 | olfactory | 68 | 150 Hz | 100% | 65.3% | 8513 | 3.4947 | 3.4364 |
| flywire_630 | olfactory | 63 | 10 Hz | 100% | 64.0% | 8218 | 3.4872 | 3.5761 |
| flywire_630 | olfactory | 63 | 50 Hz | 100% | 64.2% | 8222 | 3.5515 | 3.5807 |
| flywire_630 | olfactory | 63 | 150 Hz | 100% | 64.6% | 8258 | 3.6447 | 3.5800 |

## Stage 3 - dopamine-gated plasticity

**Not run.**

## Stage 4 - encoding a memory

**Not run.**

## Stage 5 - the sleep state

**Not run.**

## Stage 6 - the replay test

**Not run.**

## What this is not

- Point neurons. Every cell is a single compartment with no dendritic processing.
- Uniform biophysics. Every neuron has the same membrane time constant, threshold and refractory period, regardless of type or size.
- Predicted, not measured, neurotransmitters. Signs come from a machine-learning prediction on synapse images.
- No morphology. Conduction delay is a single constant, not a function of distance.
- No body, no behaviour, no sensory feedback.
- No ripple analogue. The fly has no described equivalent of the hippocampal sharp-wave ripple that organises mammalian replay, so there is no event detector to trigger on.
- A single plasticity locus. Only Kenyon-cell to output-neuron synapses can change.
- A male brain. Much of the physiology this model is calibrated against was measured in females.
- No ventral nerve cord.
- Offline reactivation of Kenyon-cell ensembles has never been observed in a real fly. There is no measurement to compare a positive result against.

