# hypnagogia: results

*Generated 2026-09-12T05:19:19+00:00 by `scripts/make_results.py`. Every number is read from a file under `results/`; nothing in this document is written by hand. Stages that have not run say so.*

**Question.** Can a whole-brain *Drosophila* connectome model spontaneously reactivate a learned memory during a simulated sleep state? Encode an odour memory through dopamine-gated plasticity at Kenyon-cell to mushroom-body-output-neuron synapses, then look for the same Kenyon-cell ensemble switching on again, by itself, during an offline period with no odour input.

## Headline

**Stage 6 (failed).** In the real network 95% of all time bins clear the reactivation threshold. The ensemble is effectively on continuously, so 'reactivation events' are not discrete episodes and the template correlation mostly reflects how active those particular Kenyon cells are rather than whether a memory reappeared. Every comparison below must be read with that in mind. No evidence of memory replay: the odour-A ensemble did not reactivate above chance during simulated sleep. Comparisons that did not show the predicted effect: A_vs_B_sleep, sleep_vs_wake_A. The learned weights did increase reactivation relative to the identical run with unlearned weights (difference +0.14072, 95% CI [+0.10463, +0.17492]).

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

## Stage 3e - do two different odours leave two different ensembles?

**passed.** Do two different odours leave two different Kenyon-cell ensembles, or the same attractor?

The two odours remain discriminable at gain(s) [0.4, 0.5, 0.6, 0.8] in the self-sustaining state after the stimulus.

Overlap is reported against the chance overlap of two random ensembles of the same sizes. When both ensembles contain most of the Kenyon cells, a high raw overlap is arithmetic, not odour specificity.

| gain | epoch | Kenyon cells in ensemble A | in ensemble B | overlap (Jaccard) | chance overlap | excess | discriminable |
|---|---|---|---|---|---|---|---|
| 1.00 (published) | odor | 68.2% | 64.8% | 0.943 | 0.499 | +0.444 | **no** |
| 1.00 (published) | post | 61.0% | 59.3% | 0.941 | 0.430 | +0.511 | **no** |
| 0.80 | odor | 34.4% | 21.0% | 0.582 | 0.150 | +0.432 | yes |
| 0.80 | post | 20.0% | 17.6% | 0.827 | 0.102 | +0.725 | yes |
| 0.60 | odor | 7.8% | 5.0% | 0.496 | 0.032 | +0.464 | yes |
| 0.60 | post | 4.9% | 4.6% | 0.879 | 0.023 | +0.856 | yes |
| 0.50 | odor | 2.8% | 1.6% | 0.343 | 0.010 | +0.333 | yes |
| 0.50 | post | 1.5% | 1.4% | 0.855 | 0.009 | +0.846 | yes |
| 0.40 | odor | 0.4% | 0.1% | 0.111 | 0.001 | +0.111 | yes |
| 0.40 | post | 0.1% | 0.1% | 0.606 | 0.000 | +0.606 | yes |

## Stage 3d - how far from the published model would you have to go?

**This section is a labelled deviation from the published parameters.** The gain multiplier is an UNCITED free parameter introduced by this project. It has no source in Shiu et al. 2024, in the connectome data, or in the mushroom-body plasticity literature. gain = 1.0 is the published model and is the primary result everywhere else in this project. Any stage run at gain < 1 is a labelled deviation and is reported as such.

Question asked: How far from the published parameters would the model have to be for sparse Kenyon-cell odour coding to exist?

No gain in the scan produced sparse, transient Kenyon-cell coding.

| gain | effective W_syn | Kenyon cells responding | spikes per responding cell | rate during | rate after | sparse | transient |
|---|---|---|---|---|---|---|---|
| 1.00 (published) | 0.15978 mV | 67.5% | 59.4 | 3.4492 | 2.8774 | no | no |
| 0.80 | 0.12782 mV | 36.8% | 23.8 | 1.8183 | 1.2726 | no | no |
| 0.60 | 0.09586 mV | 8.2% | 17.0 | 1.1573 | 0.8307 | yes | no |
| 0.50 | 0.07989 mV | 2.8% | 14.9 | 0.9516 | 0.6472 | no | no |
| 0.40 | 0.06391 mV | 0.4% | 10.5 | 0.7607 | 0.4695 | no | no |
| 0.35 | 0.05592 mV | 0.0% | 0.0 | 0.6757 | 0.3922 | no | no |
| 0.30 | 0.04793 mV | 0.0% | 0.0 | 0.5955 | 0.3161 | no | no |
| 0.25 | 0.03994 mV | 0.0% | 0.0 | 0.5201 | 0.2460 | no | no |
| 0.20 | 0.03196 mV | 0.0% | 0.0 | 0.4454 | 0.1737 | no | no |
| 0.15 | 0.02397 mV | 0.0% | 0.0 | 0.3702 | 0.0978 | no | no |
| 0.10 | 0.01598 mV | 0.0% | 0.0 | 0.2665 | 0.0000 | no | yes |

## Stage 3c - is the runaway the model, or this dataset?

Olfactory input ignites EVERY network tested, at every rate, including the FlyWire v630 and v783 datasets that Shiu et al. published on. The runaway is a property of the model, not of the male CNS connectome. The gustatory pathway behaves completely differently with the same code and parameters: it never ignites the male CNS at any rate tested, and ignites the FlyWire networks only at the highest rate (150 Hz) when all 122 labellar neurons are driven at once. The 21-neuron stimulus the paper actually used stays well below that (stage 0). So the instability is specific to the olfactory pathway, and the published benchmark was never in a position to reveal it. Without the 0.581 FlyWire-equivalence scaling the male CNS ignites on everything, including the gustatory pathway, which is independent evidence that the scaling belongs there.

**Pathway control.** Ignition probability by pathway: olfactory 100% of conditions, gustatory 42%. Same code, same parameters, same networks, same rates.

| network | pathway | neurons driven | drive | probability of ignition | Kenyon cells responding | neurons active | rate during | rate after |
|---|---|---|---|---|---|---|---|---|
| malecns_scaled | olfactory | 74 | 10 Hz | 100% | 57.2% | 7905 | 2.7494 | 2.8835 |
| malecns_scaled | olfactory | 74 | 50 Hz | 100% | 59.5% | 8038 | 2.8467 | 2.8797 |
| malecns_scaled | olfactory | 74 | 150 Hz | 100% | 61.5% | 8171 | 2.9998 | 2.8796 |
| malecns_scaled | gustatory | 78 | 10 Hz | 0% | 0.0% | 90 | 0.0062 | 0.0000 |
| malecns_scaled | gustatory | 78 | 50 Hz | 0% | 0.0% | 215 | 0.0456 | 0.0000 |
| malecns_scaled | gustatory | 78 | 150 Hz | 0% | 0.0% | 717 | 0.1925 | 0.0005 |
| malecns_unscaled | olfactory | 74 | 10 Hz | 100% | 100.0% | 14651 | 7.1775 | 7.3960 |
| malecns_unscaled | olfactory | 74 | 50 Hz | 100% | 100.0% | 14736 | 7.2923 | 7.3947 |
| malecns_unscaled | olfactory | 74 | 150 Hz | 100% | 100.0% | 14810 | 7.4469 | 7.3961 |
| malecns_unscaled | gustatory | 78 | 10 Hz | 100% | 100.0% | 14973 | 5.4568 | 7.3922 |
| malecns_unscaled | gustatory | 78 | 50 Hz | 100% | 66.9% | 11847 | 4.5660 | 7.1849 |
| malecns_unscaled | gustatory | 78 | 150 Hz | 100% | 100.0% | 14903 | 6.4915 | 7.3968 |
| flywire_783 | olfactory | 68 | 10 Hz | 100% | 65.0% | 8431 | 3.3454 | 3.4361 |
| flywire_783 | olfactory | 68 | 50 Hz | 100% | 65.2% | 8473 | 3.4094 | 3.4332 |
| flywire_783 | olfactory | 68 | 150 Hz | 100% | 65.3% | 8513 | 3.4947 | 3.4364 |
| flywire_783 | gustatory | 122 | 10 Hz | 0% | 0.0% | 159 | 0.0109 | 0.0000 |
| flywire_783 | gustatory | 122 | 50 Hz | 0% | 0.0% | 520 | 0.1047 | 0.0002 |
| flywire_783 | gustatory | 122 | 150 Hz | 100% | 65.0% | 8878 | 3.4065 | 3.4382 |
| flywire_630 | olfactory | 63 | 10 Hz | 100% | 64.0% | 8218 | 3.4872 | 3.5761 |
| flywire_630 | olfactory | 63 | 50 Hz | 100% | 64.2% | 8222 | 3.5515 | 3.5807 |
| flywire_630 | olfactory | 63 | 150 Hz | 100% | 64.6% | 8258 | 3.6447 | 3.5800 |
| flywire_630 | gustatory | 112 | 10 Hz | 0% | 0.0% | 151 | 0.0108 | 0.0000 |
| flywire_630 | gustatory | 112 | 50 Hz | 0% | 0.0% | 493 | 0.1087 | 0.0006 |
| flywire_630 | gustatory | 112 | 150 Hz | 100% | 63.9% | 8598 | 3.6603 | 3.5786 |

## Stage 3 - dopamine-gated plasticity

**passed.** Criterion: unit test passes (depression only when Kenyon-cell activity precedes dopamine); the readout MBON responds to the calibration odour before pairing (> 5 spikes/s); and some learning rate in the grid produces a clear depression. Whether that depression can be made GRADED, as Hige et al. measured, is reported separately rather than being required.

**Run at a synaptic gain of 0.6, a labelled deviation from the published parameters.** DEVIATION: every synaptic weight scaled to 0.6 of its published value, because at the published value the network has no sparse odour code to store a memory in (stage 3b). This is an uncited free parameter introduced by this project; see configs/stage3d_gain.yaml.

- Rule: dopamine-gated anti-Hebbian two-factor LTD at KC->MBON; no MBON postsynaptic term (Hige 2015 showed LTD with MBON spikes blocked); compartment specificity from connectome DAN->MBON synapses
  - `de/dt = -e/tau_e (per KC->MBON synapse); on KC spike: e += 1`
  - `on DAN spike (DAN presynaptic to the MBON, >= dan_mbon_min_synapses): w -= eta_ltd * e * w0`
  - `dda/dt = -da/tau_da (per MBON); on DAN spike: da += 1; on KC spike: w += eta_ltp * da * w0 (eta_ltp = 0 here)`
  - `w in [w_min_frac*w0, w_max_frac*w0]; w(0) = w0 = sign*count*0.581*W_syn`
- Plastic synapses: 61,210 Kenyon-cell to output-neuron connections (463,640 synapses) between 4,064 Kenyon cells and 97 output neurons, gated by 340 dopaminergic neurons through 1,408 connections.
- **The readout is all-or-none, not graded.** The readout MBON's odour response is all-or-none here: every learning rate in the grid, including the smallest, takes it from its full response to exactly zero, with nothing in between. Hige et al. measured a graded 80% reduction in a real fly, so that endpoint is not reproducible in this model. The depression is still odour-specific, which is what the memory test needs, and stage 4 tests that directly.
- Learning rate chosen: 0.0005 - the readout MBON is all-or-none in this model, so Hige's graded endpoint cannot be matched; the SMALLEST learning rate that still produces a clear depression is used instead, to keep the plasticity as weak as possible while remaining measurable
- Unit test on an isolated three-neuron circuit: passed. Pairing Kenyon-cell activity with dopaminergic activity depressed the synapse to 0.000 of its starting weight; dopamine alone and Kenyon-cell activity alone left it unchanged.

| parameter | value | source | cited |
|---|---|---|---|
| direction (KC+DAN -> LTD) | depression | Hige et al. 2015 Neuron 88:985 (80% spike, 90% EPSC reduction after one pairing) | yes |
| no postsynaptic factor | MBON spiking not required | Hige et al. 2015 'Plasticity is Independent of Postsynaptic Spiking' | yes |
| tau_e | 5.0 s | Jiang & Litwin-Kumar 2021 PLoS Comput Biol code (tau = 5); Handler 2019 window suggests 1-2 s | yes |
| tau_da | 5.0 s | Jiang & Litwin-Kumar 2021 code | yes |
| eta_ltd | 0.0005 (calibrated) | FREE: fit to Hige 2015 single-pairing endpoint (post/pre = 0.20) | **no** |
| eta_ltp | 0.0 | Hige 2015: no backward-pairing potentiation in gamma1pedc (Handler 2019 finds it in gamma2/4/5) | yes |
| w bounds | [0.0, 1.0] x w0, init at w0 | Jiang & Litwin-Kumar 2021; Eschbach 2020 (init at w_max) | yes |
| dan_mbon_min_synapses | 5 | uncited pipeline choice (compartment gating threshold) | **no** |
| DAN pairing rate | 20.0 Hz for 2.0 s from +0.2 s | timing from Hige 2015; rate uncited (absorbed by eta_ltd) | **no** |
| background sigma during calibration | 0.0 mV | conditioning_sigma_mV in configs/stage4_encode.yaml (0.0 mV), matching stage 4; the offline background is 1.6 mV from stage2 operating point (NO critical regime found in the sweep (no sigma satisfied all criteria; the network is bistable - silent below the transition and continuously active above it). The operating point for the downstream stages is therefore NOT a critical point: it is the non-saturated sigma whose Kenyon-cell population rate is closest to the measured KC spontaneous rate of 0.1 Hz (Turner, Bazhenov & Laurent 2008 J Neurophysiol 99:734), i.e. sigma = 1.6 mV (KC rate 1.9667 Hz, whole-brain rate 0.7866 Hz/neuron, m = 0.9999994021964815).) | **no** |

## Stage 4 - encoding a memory

**passed.** Criterion: MBON11 response to odour A must fall relative to odour B from before to after conditioning: the paired difference of deltas (deltaA - deltaB) must be negative with a 95% CI excluding 0 across >= 20 seeds

**Run at a synaptic gain of 0.6, a labelled deviation from the published parameters.** DEVIATION: every synaptic weight scaled to 0.6 of its published value, because at the published value there is no sparse odour code to store a memory in (stage 3b) and two odours leave indistinguishable ensembles (stage 3e).

*Membrane potentials and synaptic conductances are reset to rest before every odour presentation; learned weights are not. The model never returns to baseline on its own (stage 3b), so without this the second odour would be delivered into the first odour's ongoing activity and every later measurement would be contaminated.*

- Learning verified: **True**.
- Output-neuron response to the trained odour A went from 16.95 to 0.00 Hz; to the control odour B from 0.00 to 0.00 Hz.
- Difference of changes (A minus B): -16.950 Hz, 95% CI [-18.800, -15.200], Hedges' g = -3.84, permutation p = 0.0000, over 20 seeds.
- The control odour never drove the readout MBON before conditioning (mean 0.00 Hz), so 'no change in the control' is a floor effect and carries no information. The specificity of the plasticity is therefore established synaptically instead: see synaptic_specificity, which splits the weight change by which odour drove the presynaptic Kenyon cell.

## Stage 5 - the sleep state

**passed.** Criterion: both conditions run to completion for every seed with the learned weights loaded, dFB neurons fire in the sleep condition and not in the wake condition, and KC activity is non-zero in at least one condition (otherwise the replay test has no data)

**Run at a synaptic gain of 0.6, a labelled deviation from the published parameters.** DEVIATION: every synaptic weight scaled to 0.6 of its published value (stage 3b/3d).

*Membrane potentials and synaptic conductances are reset to rest at the start of the offline period; learned synaptic weights are not touched. The model has no adaptation or short-term depression, so once conditioning has pushed it into its self-sustaining state it never returns to baseline (stage 3b). Without the reset the offline period would inherit the conditioning activity and any apparent reactivation would be persistence, not replay. The 'carryover' epoch measures the state that was discarded, so the size of that confound is on the record.*

| condition | population rate | Kenyon-cell rate | output-neuron rate | dFB rate |
|---|---|---|---|---|
| sleep | 0.9622 Hz | 2.3112 Hz | 5.4706 Hz | 16.92 Hz |
| wake | 0.9543 Hz | 2.3165 Hz | 5.5001 Hz | 0.01 Hz |
| sleep_naive | 0.9670 Hz | 2.3764 Hz | 6.6385 Hz | 16.92 Hz |

- The dFB population is 32 neurons of types FB6A_a, FB6A_b, FB6A_c, FB6C_a, FB6C_b, FB6E, FB6G, FB6I, FB6Z, FB7A, FB7K. Hulse et al. 2021 eLife 10:e66039 Fig. 48 (R23E10 -> FB6A, FB6C_a/b, FB6E, FB6G, FB6I, FB6Z, FB7A, FB7K)
- Clamp rate: 17.0 Hz. no dFB firing rate exists in the literature (Donlea 2014 / Pimentel 2016 report a binary ON/OFF switch); 17 Hz is taken from the UP state of the connected helicon cells ExR1, 16.9 +/- 3.6 Hz (Donlea et al. 2018 Neuron 97:378) - an approximation, not a dFB measurement

## Stage 6 - the replay test

**failed.** Criterion: a positive replay claim requires ALL FOUR: (1) odour-A ensemble reactivation above the odour-B ensemble, (2) sleep above wake, (3) the real connectome above the degree-preserving shuffled connectome, and (4) the odour-A ensemble above size-matched random KC ensembles - each as a paired effect across seeds whose 95% CI excludes zero in the predicted direction. A positive result that does not survive the shuffled-connectome null is an artifact of network structure, not replay, and is reported as such.

**Run at a synaptic gain of 0.6, a labelled deviation from the published parameters.** DEVIATION: every synaptic weight scaled to 0.6 of its published value, because at the published value the network has neither a sparse odour code nor a quiet background (stages 2 and 3b). This is an uncited free parameter introduced by this project.

**In the real network 95% of all time bins clear the reactivation threshold. The ensemble is effectively on continuously, so 'reactivation events' are not discrete episodes and the template correlation mostly reflects how active those particular Kenyon cells are rather than whether a memory reappeared. Every comparison below must be read with that in mind. No evidence of memory replay: the odour-A ensemble did not reactivate above chance during simulated sleep. Comparisons that did not show the predicted effect: A_vs_B_sleep, sleep_vs_wake_A. The learned weights did increase reactivation relative to the identical run with unlearned weights (difference +0.14072, 95% CI [+0.10463, +0.17492]).**

*The four required comparisons use z_vs_random_ensembles, each run standardised against size-matched random Kenyon-cell ensembles drawn from that same run, because ensemble sizes differ between odours and between the real and shuffled networks and the raw template correlation depends on template size. comparisons_raw_metric repeats three of them on the raw correlation so the effect of that choice can be seen.*

| comparison | required? | difference | 95% CI | Hedges' g | p | seeds | shows the predicted effect |
|---|---|---|---|---|---|---|---|
| trained (A) vs unpaired (B) ensemble, during sleep | additional | -2.85288 | [-4.54210, -1.20136] | -0.70 | 0.0037 | 20 | **no** |
| sleep vs wake, odour-A ensemble | additional | +0.00518 | [-0.01875, +0.03072] | +0.09 | 0.6954 | 20 | **no** |
| real vs degree-preserving shuffled connectome, odour-A ensemble in sleep | additional | +42.10297 | [+33.12256, +49.36840] | +2.18 | 0.0000 | 20 | yes |
| odour-A ensemble vs size-matched random KC ensembles, during sleep | additional | +0.61635 | [+0.57190, +0.64517] | +6.73 | 0.0000 | 20 | yes |
| learned vs unlearned synaptic weights, odour-A ensemble in sleep | additional | +0.14072 | [+0.10463, +0.17492] | +1.64 | 0.0000 | 20 | yes |

The same comparisons on the raw template correlation, without size normalisation:

| comparison | difference | 95% CI | Hedges' g | p |
|---|---|---|---|---|
| A_vs_B_sleep_raw | -0.02150 | [-0.02376, -0.01906] | -3.81 | 0.0000 |
| sleep_vs_wake_A_raw | +0.00011 | [-0.00005, +0.00027] | +0.29 | 0.1894 |
| real_vs_shuffled_raw | +0.58060 | [+0.52191, +0.62822] | +4.51 | 0.0000 |

Ensemble sizes actually used (Kenyon cells), which is why the size-normalised statistic is the primary one:

- real_gain0.6: sleep 326, wake 326, sleep_naive 326
- shuffled_gain0.6: sleep 152

**Sequence order.** Spearman rank correlation between within-event first-spike order and the order of the odour response, against a cell-identity shuffle (Foster & Wilson 2006). Reported only where events contained at least four ensemble members with distinct template ranks. Scored on 20 seeds over 3948 reactivation events: mean absolute rank correlation 0.158 against a cell-identity shuffle mean of 0.048.

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

