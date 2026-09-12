# hypnagogia: results

*Generated 2026-09-12T23:46:58+00:00 by `scripts/make_results.py`. Every number is read from a file under `results/`; nothing in this document is written by hand. Stages that have not run say so.*

**Question.** Can a whole-brain *Drosophila* connectome model spontaneously reactivate a learned memory during a simulated sleep state? Encode an odour memory through dopamine-gated plasticity at Kenyon-cell to mushroom-body-output-neuron synapses, then look for the same Kenyon-cell ensemble switching on again, by itself, during an offline period with no odour input.

## Headline

**Before anything else: the published model treats APL as a spiking neuron, and it is not one.** APL is the mushroom body's feedback inhibitory neuron and it releases transmitter in proportion to its membrane potential rather than in spikes (Amin et al. 2020 eLife 9:e56954). Modelling it with a threshold turns the one graded control of Kenyon-cell sparseness into a switch. At the published parameters, with that threshold in place, an odour drives 52.6% of Kenyon cells at 23.0 Hz and they idle afterwards at 18.1 Hz. Without it, at the same parameters, 4.54% respond at 0.79 Hz and idle at 0.134 Hz. Real Kenyon cells respond at 6 plus or minus 5 per cent and idle near 0.1 Hz. Nothing was tuned to get there: the only difference between the two is whether APL is allowed to fire. A second correction, DPM's transmitter, is reported alongside it in *Stage 3f*.

**Stage 6 (failed).** No evidence of memory replay, and no basis for calling what was measured an artifact either. The odour-A ensemble does score above size-matched random ensembles, but the comparison that would say whether that is structure rather than memory, the degree-preserving shuffled connectome, cannot answer it here. The two arms differ by 3.8 times in ensemble size and 10.7 times in Kenyon-cell rate. Standardising against size-matched random ensembles corrects the first and not the second: the arms are in different states, so this comparison does not isolate the variable its name refers to and its result should not be read as evidence about that variable in either direction. On this measure the memory contributed nothing: the identical sleep run with unlearned weights gave the same reactivation (learned minus unlearned = +0.01628, 95% CI [-0.01104, +0.04429]). That is not because the memory does nothing offline: stage 5 compared the two runs spike for spike and found the Kenyon-cell activity differs in every seed. It is that the difference is not an increase in how much the trained ensemble reactivates. One of the four, sleep against wake, is being asked to find a difference this model does not have: stage 5 measured clamping the 32 dorsal fan-shaped body neurons as changing the rest of the brain by 0.2 per cent in population rate and 0.2 per cent in Kenyon-cell rate. Its failing is a fact about the manipulation, not about replay.

**Read that verdict with Stage 11 next to it.** No detector in this project has ever been shown to find replay when replay is present, so none of them can certify that replay is absent. Stage 11 tried to establish that by handing the model the mechanism it lacks: the recurrent connections between members of the trained ensemble were multiplied by a factor the experimenter chose, which is the arrangement hippocampal replay has and this connectome does not. Over 18 runs at 4 noise levels (1.4, 1.47, 1.5, 1.55 mV) and factors from 1 to 300, not one run produced a repeated episode. The ensemble was silent, or on continuously, or it switched on once and never switched off, and which of those happened was set by the noise rather than by the injection. So the detector could not be calibrated, because the model never produced the positive data to calibrate it on. Nothing in the published model is slower than the 5 ms synaptic time constant, so nothing can terminate an up state. Every failure below is therefore a property of this model class, which cannot represent an episode even when the mechanism for one is supplied directly, and is not evidence that the fly does not replay.

**Stage 12 (labelled deviation, both constants unsourced).** Adding one hyperpolarising term per neuron, stepping up by b on each of that cell's spikes and decaying with tau, produces episodes: 1 of 12 scanned settings give the brain repeated up and down states and 4 give them to the trained Kenyon-cell ensemble. That is the first repeated episode anywhere in this project, and it confirms Stage 11's diagnosis from the other side: the missing ingredient was a slow variable. Neither constant has a measurement behind it, so both are scanned over tau [200.0, 600.0, 2000.0] ms and b [0.05, 0.15, 0.5, 1.5] mV and the range is reported instead of a value.


**And the whole pre-registered test, re-run on the model that CAN hold an episode.** With adaptation switched on at tau 200.0 ms and b 0.5 mV, 80 whole-brain 40 s runs, 20 seeds in each of sleep, the unlearned-weights control, wake, and the shuffled connectome. The model becomes a better mushroom body while it is at it: Kenyon-cell activity falls from 0.42 Hz to 0.049 Hz and only about 4 per cent of Kenyon cells are active, which is close to the 5 to 6 per cent measured in real flies and far below where the published model sat. The trained ensemble fires at about 1.08 Hz against 0.049 Hz for Kenyon cells as a whole. And the memory still contributes nothing to it. The comparison that decides this, the identical run with unlearned weights, is properly matched on both ensemble size and Kenyon-cell rate for the first time in this project, and it gives +0.03990, 95% CI [-0.01001, +0.08952], p = 0.144: no effect. Giving the model the ability to have an episode did not give the memory the ability to appear in one, and the reason is the one stages 6c and 6d measured: the only plastic synapses in the model sit downstream of the cells whose reactivation is being scored, so learning cannot change which of them switch on.

*How often the ensemble actually switches on and off, across all 20 seeds.* Across 20 seeds the trained ensemble's episode count per 40 s run runs from 1 to 103, median 1. 13 of 20 seeds have it on continuously and 1 of 20 fall inside the 0.5 to 1.5 Hz band measured in a sleeping fly. So the episodic behaviour is real in the seeds that show it and it is NOT the typical behaviour of this configuration: a three-seed look suggested otherwise and was wrong. Reported because the difference between one seed in twenty and a phenomenon is the whole question.
**Stage 13 (labelled deviation, both constants measured).** The one mechanism whose magnitude is measured is short-term synaptic depression at antennal-lobe synapses, fit three times in two laboratories: f = 0.78, tau = 893 ms (Nagel, Hong & Wilson 2015), f = 0.75, tau = 1566 ms (Nagel & Wilson 2016), f = 0.72, tau = 2.4 s (Kazama & Wilson 2009). What is not measured is which synapses to apply it to, so scope is an arm and every arm is reported. Applied exactly where the constants were measured, at ORN synapses, it does nothing: the antennal lobe still runs at 126.6 Hz, because offline there is no odour and those synapses carry almost no traffic. Extrapolated to the antennal-lobe loop it works as predicted and takes the mushroom body with it: the runaway falls to 2.8 Hz and Kenyon-cell activity falls with it, from 0.42 Hz to 0.003 Hz. That is a finding about the model rather than a failed manipulation: the offline Kenyon-cell activity this project has measured for ten stages was the antennal-lobe runaway driving it, and with the runaway gone there is nothing left in the mushroom body to reactivate. No arm of Stage 13 produced an episode.

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

**passed.** Noise amplitude was swept over 13 values (0.5 to 4.0 mV) with up to 10 seeds each, on the full 144,209-neuron network.

**There is no critical regime: `has_critical_regime = False`.** That is a finding, not a failure, and it was a stated possibility before the sweep ran: the model has no spike-frequency adaptation and no short-term synaptic depression, so nothing holds it at an intermediate activity level.

What the sweep found instead is **bistability**. At 2 noise amplitudes (1.45, 1.5 mV) independent seeds of the *same* simulation either stayed quiescent or ignited into a high-rate state, with nothing in between. The noise amplitude controls the probability of ignition, not the resulting rate.

| noise sigma | seeds | probability of ignition | KC rate if quiescent | KC rate if ignited |
|---|---|---|---|---|
| 0.5 mV | 3 | 0% | 0.00000 Hz | - |
| 1.0 mV | 3 | 0% | 0.00000 Hz | - |
| 1.4 mV | 3 | 0% | 0.00008 Hz | - |
| 1.45 mV | 3 | 33% | 0.00012 Hz | 0.2 Hz |
| 1.5 mV | 3 | 67% | 0.00031 Hz | 0.3 Hz |
| 1.55 mV | 3 | 100% | - | 0.4 Hz |
| 1.6 mV | 3 | 100% | - | 0.5 Hz |
| 1.7 mV | 3 | 100% | - | 0.5 Hz |
| 1.8 mV | 3 | 100% | - | 0.6 Hz |
| 2.0 mV | 3 | 100% | - | 0.7 Hz |
| 2.4 mV | 3 | 100% | - | 1.0 Hz |
| 3.2 mV | 3 | 100% | - | 2.2 Hz |
| 4.0 mV | 3 | 100% | - | 4.4 Hz |

**The consequence matters more than the criticality question.** The measured spontaneous firing rate of Kenyon cells in a real fly is about 0.1 Hz (Turner, Bazhenov & Laurent 2008, *J Neurophysiol* 99:734). In this model the quiescent branch puts Kenyon cells near 0.0005 Hz and the ignited branch puts them above 20 Hz. **0.1 Hz falls inside a gap of more than four orders of magnitude that the model cannot produce at any noise amplitude.** There is no setting of the background drive at which the mushroom body idles the way a real one does.

Operating point chosen for the downstream stages: **sigma = 1.55 mV**. NO critical regime found in the sweep (no sigma satisfied all criteria; the network is bistable - silent below the transition and continuously active above it). The operating point for the downstream stages is therefore NOT a critical point: it is the sigma whose Kenyon-cell population rate is closest to the measured KC spontaneous rate of 0.1 Hz (Turner, Bazhenov & Laurent 2008 J Neurophysiol 99:734), i.e. sigma = 1.55 mV (KC rate 0.3802 Hz, whole-brain rate 1.6367 Hz/neuron, m = 0.6619055704202556). Sigmas whose outcome depends on the seed are excluded, because the rate reported for one of those is an average of two different states rather than the rate of a state. The chosen sigma is classified 'saturated', which in this pipeline means the whole brain's activity never pauses (1.637 Hz per neuron) and the avalanche analysis is therefore not applicable there. That is a property of the model and is reported as one. It is not a statement about the Kenyon cells, which idle at 0.380 Hz inside that state against the 0.1 Hz measured. Excluding the continuously active states, as an earlier version of this rule did, would have chosen sigma = 1.4 mV instead, where the Kenyon cells fire at 0.00008 Hz and the whole brain at 0.00026 Hz per neuron, which is further from the measurement, not closer.

Two methodological points, both of which changed the numbers:

- Avalanche statistics were being computed by binning spike times in seconds. With a 0.1 ms time step that division is not exact in floating point, and it produced a deterministic repeating pattern of spuriously empty bins - identical in every run, including runs with different seeds - which fabricated avalanche boundaries. Binning is now done in integer simulation steps. Before the fix, every high-rate run reported exactly 2,529 avalanches; after it, those runs correctly report that the population never pauses.
- When the mean interval between spikes anywhere in the brain falls below the simulation time step, the Beggs and Plenz avalanche definition has nothing to bite on. Those runs are now labelled 'avalanche analysis not applicable' instead of being binned at the time step and reported as if the numbers meant something.
- The branching ratio is estimated by the multistep-regression method, which assumes the population autocorrelation decays exponentially. In the high-rate state it does not: it oscillates, with a negative lag-1 autocorrelation. Those runs no longer report a branching ratio from the exponential fit.

## Stage 3a - a modelling error in the mushroom body's gain control

**passed.** APL does not fire action potentials; it releases transmitter in proportion to membrane depolarisation (Amin et al. 2020 eLife 9:e56954). It is modelled here as non-spiking, with release rectified at rest and saturating at the spike threshold. The scaling introduces no free parameter: a neuron held at threshold delivers exactly what a spiking synapse delivers at its maximum refractory-limited rate.

With APL modelled as a spiking neuron, as the published model does, an odour drives 52.6% of Kenyon cells at 23.0 Hz and they idle afterwards at 18.1 Hz. Correcting APL to non-spiking release gives 4.54% at 0.79 Hz, idling at 0.134 Hz. Real Kenyon cells respond at 6 +/- 5% of the population and idle near 0.1 Hz, so the corrected model lands on the measurement and the published one misses it by more than two orders of magnitude. Nothing else differs between the two: same connectome, same parameters, same stimulus, same seeds.

Why the substitution is not neutral, measured in this connectome:

| quantity | value |
|---|---|
| threshold gap | 7.0 mV |
| one Kenyon-cell spike delivers to APL | 1.13 mV of membrane potential (7.16 mV of conductance), 16% of a threshold gap |
| Kenyon-cell spikes needed to fire APL | 6.2 |
| one APL spike delivers to each Kenyon cell | 1.07 mV, 15% of a full threshold gap |
| conductance-to-potential factor for these time constants | 0.157 |
| APL's maximum rate, set by the refractory period | 455 Hz |
| APL's share of all inhibition onto Kenyon cells | 79.8% |

Six Kenyon-cell spikes carry APL to threshold and a single APL spike removes about a sixth of a threshold gap from every Kenyon cell it touches, so a per-spike account does not by itself make APL a switch. What does is the standing input: APL collects from 4,063 Kenyon cells, so at any Kenyon-cell rate above a fraction of a hertz its membrane sits far past threshold and its release, capped by the refractory period, is pinned at the ceiling. A graded controller has become a saturated one, and it is the only feedback that keeps the odour code sparse. An earlier version of this note said one Kenyon-cell spike suffices, which confused the conductance a synapse delivers with the potential it produces, a factor of 6.3.

| APL | Kenyon cells responding | rate during odour | rate after odour | APL rate |
|---|---|---|---|---|
| spiking, as published | 52.6% | 23.05 Hz | 18.06 Hz | 305.7 Hz |
| graded, corrected | 4.5% | 0.79 Hz | 0.13 Hz | 0.0 Hz |

Real Kenyon cells respond at 6 plus or minus 5 per cent of the population and idle near 0.1 Hz (Turner, Bazhenov & Laurent 2008). The corrected model lands on both; the published one misses each by more than two orders of magnitude. No parameter was changed to obtain this: the only difference between the two rows is whether APL is allowed to fire action potentials.

## Stage 3f - the DPM transmitter correction

**The substitution changes nothing measurable, because DPM never fires a single spike in either condition and so never releases anything for the sign to apply to. The reason is the other correction: APL modelled as non-spiking sits at its saturating release level and delivers a steady 290 mV of hyperpolarising drive to DPM through 1,595 synapses, which is 41 times DPM's threshold gap. Both runs give 4.45% of Kenyon cells at 0.778 Hz during the odour and 0.138 Hz after it. The transmitter assignment is still wrong and is still corrected everywhere, but in this model it is inert: DPM is one of the cells the corrected APL switches off. The same happens to the readout MBON. Both cells have measured odour responses in the fly, so a model in which APL silences them is not reproducing them.**

Haynes PR, Christmann BL, Waddell S (2015) eLife 4:e03868: DPM cell bodies are Gad1-positive, DPM contains GABA and 5-HT, and DPM activation evokes a large chloride increase in mushroom-body neurons with no detectable calcium or cAMP increase; Lee P-T et al. (2011) PNAS 108:13794 report DPM as serotonergic. The connectome's consensus transmitter for DPM is 'dopamine'.

| quantity | value |
|---|---|
| DPM synapses onto Kenyon cells | 32,795 onto 3,989 of 4,064 |
| Kenyon-cell synapses onto DPM | 95,527 from 4,042 cells |
| DPM's share of all input onto Kenyon cells | 1.57% |
| one DPM spike delivers to each Kenyon cell | 1.31 mV, 19% of a full threshold gap |
| what the corrected APL delivers to DPM | -290 mV through 1,595 synapses, 41 times its threshold gap |
| transmitter the connectome predicts | dopamine |
| transmitter that was measured | gaba |

With the predicted transmitter the Kenyon-cell population drives DPM and DPM drives the whole Kenyon-cell population back, so the mushroom body carries a second brain-wide POSITIVE feedback loop on top of the recurrent Kenyon-cell wiring, in parallel with the one negative loop (APL) that is supposed to keep the code sparse. With the measured transmitter it is a second negative loop, which is what the chloride measurement shows.

| DPM | Kenyon cells responding | rate during odour | rate after odour | readout MBON | DPM rate |
|---|---|---|---|---|---|
| as predicted (dopamine, excitatory) | 4.45% | 0.778 Hz | 0.138 Hz | 0.00 Hz | 0.00 Hz |
| as measured (GABA, inhibitory) | 4.45% | 0.778 Hz | 0.138 Hz | 0.00 Hz | 0.00 Hz |

## Stage 3b - is there a sparse odour code to build a memory on?

**passed.** In a real fly about 5-10% of Kenyon cells respond to a given odour, each firing a few spikes (Honegger, Campbell & Turner 2011 J Neurosci 31:11772: mean responding fraction <= 0.10; Turner, Bazhenov & Laurent 2008 J Neurophysiol 99:734: 6 +/- 5% of KCs, 2-5 spikes per response).

Sparse, transient Kenyon-cell odour coding is reproduced at 4 glomeruli / 150 Hz: 4.4% of Kenyon cells respond at 0.77 Hz, falling to 0.14 Hz once the odour stops. The rest of the network does not return to baseline (1.69 vs 2.00 Hz per neuron), so the mushroom body recovers while the wider brain does not.

| glomeruli driven | receptor neurons | drive | Kenyon cells responding | spikes per responding cell | rate during | rate after |
|---|---|---|---|---|---|---|
| 1 glomerulus | 74 | 10 Hz | **1.1%** | 12 | 1.5880 Hz/neuron | 1.6931 Hz/neuron |
| 1 glomerulus | 74 | 20 Hz | **1.2%** | 13 | 1.5736 Hz/neuron | 1.6765 Hz/neuron |
| 1 glomerulus | 74 | 50 Hz | **1.4%** | 14 | 1.6521 Hz/neuron | 1.6928 Hz/neuron |
| 1 glomerulus | 74 | 100 Hz | **1.8%** | 14 | 1.7066 Hz/neuron | 1.6922 Hz/neuron |
| 1 glomerulus | 74 | 150 Hz | **2.2%** | 15 | 1.7370 Hz/neuron | 1.6943 Hz/neuron |
| 2 glomeruli | 106 | 10 Hz | **1.1%** | 12 | 1.5576 Hz/neuron | 1.6900 Hz/neuron |
| 2 glomeruli | 106 | 20 Hz | **1.2%** | 13 | 1.6402 Hz/neuron | 1.6967 Hz/neuron |
| 2 glomeruli | 106 | 50 Hz | **1.6%** | 13 | 1.6905 Hz/neuron | 1.6921 Hz/neuron |
| 2 glomeruli | 106 | 100 Hz | **2.0%** | 15 | 1.7414 Hz/neuron | 1.6962 Hz/neuron |
| 2 glomeruli | 106 | 150 Hz | **2.4%** | 16 | 1.8048 Hz/neuron | 1.6935 Hz/neuron |
| 4 glomeruli | 243 | 10 Hz | **1.2%** | 13 | 1.5977 Hz/neuron | 1.6666 Hz/neuron |
| 4 glomeruli | 243 | 20 Hz | **1.4%** | 13 | 1.5247 Hz/neuron | 1.6470 Hz/neuron |
| 4 glomeruli | 243 | 50 Hz | **2.2%** | 14 | 1.7317 Hz/neuron | 1.6931 Hz/neuron |
| 4 glomeruli | 243 | 100 Hz | **3.4%** | 16 | 1.9041 Hz/neuron | 1.6927 Hz/neuron |
| 4 glomeruli | 243 | 150 Hz | **4.4%** | 18 | 1.9977 Hz/neuron | 1.6904 Hz/neuron |

The last two columns are the important ones: the population rate after the odour ends is the same as the rate during it. The stimulus does not drive a response, it triggers a transition, and the network stays in the new state afterwards. Before the odour the network is exactly silent.

**How little input does it take?** As few as 1 receptor neurons driven at 50.0 Hz are enough to ignite the whole network into a self-sustaining state.

| receptor neurons driven | probability of ignition | rate during stimulus | rate after |
|---|---|---|---|
| 1 | 100% | 1.4310 Hz/neuron | 1.6770 Hz/neuron |
| 2 | 100% | 1.4708 Hz/neuron | 1.6926 Hz/neuron |
| 3 | 100% | 1.5478 Hz/neuron | 1.6925 Hz/neuron |
| 5 | 100% | 1.5237 Hz/neuron | 1.6954 Hz/neuron |
| 8 | 100% | 1.4513 Hz/neuron | 1.6035 Hz/neuron |
| 12 | 100% | 1.5661 Hz/neuron | 1.6288 Hz/neuron |
| 20 | 100% | 1.5208 Hz/neuron | 1.6858 Hz/neuron |
| 35 | 100% | 1.5829 Hz/neuron | 1.6926 Hz/neuron |
| 74 | 100% | 1.6631 Hz/neuron | 1.6908 Hz/neuron |

## Stage 3e - do two different odours leave two different ensembles?

**passed.** Do two different odours leave two different Kenyon-cell ensembles, or the same attractor?

The two odours remain discriminable at gain(s) [0.8, 1.0] in the self-sustaining state after the stimulus.

Overlap is reported against the chance overlap of two random ensembles of the same sizes. When both ensembles contain most of the Kenyon cells, a high raw overlap is arithmetic, not odour specificity.

| gain | epoch | Kenyon cells in ensemble A | in ensemble B | overlap (Jaccard) | chance overlap | excess | discriminable |
|---|---|---|---|---|---|---|---|
| 1.00 (published) | odor | 4.3% | 1.5% | 0.278 | 0.011 | +0.267 | yes |
| 1.00 (published) | post | 1.4% | 1.2% | 0.768 | 0.006 | +0.762 | yes |
| 0.80 | odor | 1.2% | 0.2% | 0.146 | 0.001 | +0.145 | yes |
| 0.80 | post | 0.3% | 0.1% | 0.502 | 0.002 | +0.500 | yes |
| 0.60 | odor | 0.0% | 0.0% | 0.000 | 0.000 | +0.000 | yes |

## Stage 3d - how far from the published model would you have to go?

**This section is a labelled deviation from the published parameters.** The gain multiplier is an UNCITED free parameter introduced by this project. It has no source in Shiu et al. 2024, in the connectome data, or in the mushroom-body plasticity literature. gain = 1.0 is the published model and is the primary result everywhere else in this project. Any stage run at gain < 1 is a labelled deviation and is reported as such.

Question asked: How far from the published parameters would the model have to be for sparse Kenyon-cell odour coding to exist?

No gain in the scan produced sparse, transient Kenyon-cell coding.

| gain | effective W_syn | Kenyon cells responding | spikes per responding cell | rate during | rate after | sparse | transient |
|---|---|---|---|---|---|---|---|
| 1.00 (published) | 0.15978 mV | 4.4% | 17.8 | 2.0240 | 1.6975 | no | no |
| 0.80 | 0.12782 mV | 1.2% | 14.4 | 1.4354 | 1.0944 | no | no |
| 0.60 | 0.09586 mV | 0.0% | 11.7 | 1.0721 | 0.7602 | no | no |
| 0.50 | 0.07989 mV | 0.0% | 0.0 | 0.9017 | 0.6002 | no | no |
| 0.40 | 0.06391 mV | 0.0% | 0.0 | 0.7299 | 0.4375 | no | no |
| 0.35 | 0.05592 mV | 0.0% | 0.0 | 0.6495 | 0.3635 | no | no |
| 0.30 | 0.04793 mV | 0.0% | 0.0 | 0.5738 | 0.2932 | no | no |
| 0.25 | 0.03994 mV | 0.0% | 0.0 | 0.5029 | 0.2272 | no | no |
| 0.20 | 0.03196 mV | 0.0% | 0.0 | 0.4322 | 0.1571 | no | no |
| 0.15 | 0.02397 mV | 0.0% | 0.0 | 0.3612 | 0.0873 | no | no |
| 0.10 | 0.01598 mV | 0.0% | 0.0 | 0.2661 | 0.0000 | no | yes |

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

**passed.** Criterion: unit test passes (depression only when Kenyon-cell activity precedes dopamine); the readout MBON carries a measurable odour signal before pairing, as spikes (> 5 spikes/s) or, when the corrected APL holds it below threshold, as an odour-evoked EPSC from the Kenyon cells the odour drove; and some learning rate in the grid produces a clear depression. Whether that depression can be made GRADED, as Hige et al. measured, is reported separately rather than being required.

- Rule: dopamine-gated anti-Hebbian two-factor LTD at KC->MBON; no MBON postsynaptic term (Hige 2015 showed LTD with MBON spikes blocked); compartment specificity from connectome DAN->MBON synapses
  - `de/dt = -e/tau_e (per KC->MBON synapse); on KC spike: e += 1`
  - `on DAN spike (DAN presynaptic to the MBON, >= dan_mbon_min_synapses): w -= eta_ltd * e * w0`
  - `dda/dt = -da/tau_da (per MBON); on DAN spike: da += 1; on KC spike: w += eta_ltp * da * w0 (eta_ltp = 0 here)`
  - `w in [w_min_frac*w0, w_max_frac*w0]; w(0) = w0 = sign*count*0.581*W_syn`
- Plastic synapses: 61,210 Kenyon-cell to output-neuron connections (463,640 synapses) between 4,064 Kenyon cells and 97 output neurons, gated by 340 dopaminergic neurons through 1,408 connections.
- **The readout is all-or-none, not graded.** The readout MBON's odour response is all-or-none here: every learning rate in the grid, including the smallest, takes it from its full response to exactly zero, with nothing in between. Hige et al. measured a graded 80% reduction in a real fly, so that endpoint is not reproducible in this model. The depression is still odour-specific, which is what the memory test needs, and stage 4 tests that directly.
- Learning rate chosen: 0.0005 - The readout MBON does not spike in this model, because APL modelled as non-spiking holds it below threshold, so Hige's spike endpoint has no value to fit. The learning rate is fitted instead to the other endpoint Hige et al. measured in the same cell after the same single pairing: the odour-evoked EPSC, target 0.10 of its pre-pairing value. The EPSC here is the summed weight of the plastic synapses from the Kenyon cells the calibration odour actually drove. The chosen rate is the one whose endpoint is closest to that target.
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
| background sigma during calibration | 0.0 mV | conditioning_sigma_mV in configs/stage4_encode.yaml (0.0 mV), matching stage 4; the offline background is 1.4 mV from stage2 operating point (NO critical regime found in the sweep (no sigma satisfied all criteria; the network is bistable - silent below the transition and continuously active above it). The operating point for the downstream stages is therefore NOT a critical point: it is the non-saturated sigma whose Kenyon-cell population rate is closest to the measured KC spontaneous rate of 0.1 Hz (Turner, Bazhenov & Laurent 2008 J Neurophysiol 99:734), i.e. sigma = 1.4 mV (KC rate 0.0001 Hz, whole-brain rate 0.0003 Hz/neuron, m = None). Sigmas whose outcome depends on the seed are excluded, because the rate reported for one of those is an average of two different states rather than the rate of a state.) | **no** |

## Stage 4 - encoding a memory

**passed.** Criterion: MBON11 response to odour A must fall relative to odour B from before to after conditioning: the paired difference of deltas (deltaA - deltaB) must be negative with a 95% CI excluding 0 across >= 20 seeds

*Membrane potentials and synaptic conductances are reset to rest before every odour presentation; learned weights are not. The model never returns to baseline on its own (stage 3b), so without this the second odour would be delivered into the first odour's ongoing activity and every later measurement would be contaminated.*

- Learning verified: **True**.
- Output-neuron response to the trained odour A went from 0.00 to 0.00 Hz; to the control odour B from 0.00 to 0.00 Hz.
- Difference of changes (A minus B): 0.000 Hz, 95% CI [0.000, 0.000], Hedges' g = 0.00, permutation p = 1.0000, over 20 seeds.
- The readout MBON does not spike at all in this network, before or after conditioning, because APL modelled as non-spiking holds it below threshold. The spike-level test therefore has no signal on either side and cannot be used. Conditioning is verified instead at the synapse, on the same cell and the same pairing: the synapses driven by odour A alone retain 0.019 of their weight against 0.061 for the synapses driven by odour B alone, paired across 20 seeds (Hedges g = -0.65, 95% CI [-0.069, -0.016], p = 0.0071).
- The control odour never drove the readout MBON before conditioning (mean 0.00 Hz), so 'no change in the control' is a floor effect and carries no information. The specificity of the plasticity is therefore established synaptically instead: see synaptic_specificity, which splits the weight change by which odour drove the presynaptic Kenyon cell.
- the readout MBON (MBON11) does not respond to odour A before conditioning (mean 0.00 Hz): no learning can be measured
- conditioning did not shift the odour-A response relative to odour B (the 95% CI of the difference of deltas includes or exceeds 0)
- The two odour ensembles are not disjoint: on average 53 of the 61 Kenyon cells odour B drives (86%) also respond to odour A, against 178 cells for A. The A-versus-B comparison in stage 6 is therefore largely a set against a subset of itself, which weakens it, and the size-matched random-ensemble comparison carries more of the weight.

## Stage 5 - the sleep state

**passed.** Criterion: both conditions run to completion for every seed with the learned weights loaded; the dFB clamp is applied in the sleep condition and not in the wake condition, which means the dFB cells fire above 1 Hz in sleep and are either silent in wake or at least three times slower there than in sleep (this network is self-sustaining, so nothing in it is silent and the wake rate is whatever the network gives the cells on its own); and KC activity is non-zero in at least one condition, or the replay test has no data

*Membrane potentials and synaptic conductances are reset to rest at the start of the offline period; learned synaptic weights are not touched. The model has no adaptation or short-term depression, so once conditioning has pushed it into its self-sustaining state it never returns to baseline (stage 3b). Without the reset the offline period would inherit the conditioning activity and any apparent reactivation would be persistence, not replay. The 'carryover' epoch measures the state that was discarded, so the size of that confound is on the record.*

| condition | population rate | Kenyon-cell rate | output-neuron rate | dFB rate |
|---|---|---|---|---|
| sleep | 1.8676 Hz | 0.4325 Hz | 6.4576 Hz | 17.31 Hz |
| wake | 1.8632 Hz | 0.4318 Hz | 6.4628 Hz | 2.64 Hz |
| sleep_naive | 1.8623 Hz | 0.4309 Hz | 6.6217 Hz | 17.30 Hz |

- The dFB population is 32 neurons of types FB6A_a, FB6A_b, FB6A_c, FB6C_a, FB6C_b, FB6E, FB6G, FB6I, FB6Z, FB7A, FB7K. Hulse et al. 2021 eLife 10:e66039 Fig. 48 (R23E10 -> FB6A, FB6C_a/b, FB6E, FB6G, FB6I, FB6Z, FB7A, FB7K)
- Clamp rate: 17.0 Hz. no dFB firing rate exists in the literature (Donlea 2014 / Pimentel 2016 report a binary ON/OFF switch); 17 Hz is taken from the UP state of the connected helicon cells ExR1, 16.9 +/- 3.6 Hz (Donlea et al. 2018 Neuron 97:378) - an approximation, not a dFB measurement

### Can the memory reach the Kenyon cells at all?

The memory is a depression of Kenyon-cell to MBON synapses, downstream of the Kenyon cells. It can only change which Kenyon cells reactivate through an MBON that carries some of it (the conditioning dopaminergic neuron PPL101 gates its compartment), fires during the offline period, and projects back onto Kenyon cells.

| MBON | transmitter | gating synapses | fires offline | synapses back onto KCs | KCs contacted |
|---|---|---|---|---|---|
| MBON11 | gaba | 1,391 | yes | 640 | 484 |
| MBON11 | gaba | 920 | yes | 514 | 405 |
| MBON30 | glutamate | 64 | yes | 110 | 82 |
| MBON20 | gaba | 62 | yes | 117 | 106 |
| MBON30 | glutamate | 37 | yes | 111 | 87 |
| MBON25 | glutamate | 36 | no | 23 | 20 |
| MBON25 | glutamate | 34 | no | 21 | 19 |
| MBON20 | gaba | 31 | yes | 140 | 126 |
| MBON35 | acetylcholine | 25 | yes | 30 | 19 |
| MBON35 | acetylcholine | 23 | yes | 2 | 2 |
| MBON25-like | glutamate | 17 | no | 47 | 38 |
| MBON25-like | glutamate | 14 | no | 14 | 12 |
| MBON25-like | glutamate | 12 | no | 13 | 11 |
| MBON32 | gaba | 11 | yes | 36 | 20 |
| MBON05 | glutamate | 11 | no | 1,237 | 566 |
| MBON05 | glutamate | 10 | no | 1,565 | 594 |
| MBON32 | gaba | 8 | yes | 32 | 26 |

10 of the 17 MBONs the conditioning dopaminergic neuron gates both fire during the offline period and project back onto Kenyon cells, with 1,732 synapses between them. A path from the engram to the Kenyon cells therefore exists, and whether it carries anything is what the spike-level comparison below measures.

**The learned weights change the offline Kenyon-cell activity in 20 of 20 seeds, so the engram does reach the Kenyon cells and a reactivation difference measured downstream can in principle be real.**

| seed | KC spikes, trained | KC spikes, naive | spike trains identical | active-KC overlap |
|---|---|---|---|---|
| 0 | 74,246 | 74,202 | no | 0.9125 |
| 1 | 68,279 | 68,413 | no | 0.9160 |
| 2 | 74,033 | 74,294 | no | 0.9098 |
| 3 | 70,082 | 69,688 | no | 0.9217 |
| 4 | 69,006 | 64,065 | no | 0.8373 |
| 5 | 76,638 | 76,722 | no | 0.9325 |
| 6 | 77,467 | 77,309 | no | 0.9084 |
| 7 | 67,149 | 66,967 | no | 0.9191 |
| 8 | 72,024 | 72,211 | no | 0.9051 |
| 9 | 77,153 | 76,934 | no | 0.9193 |
| 10 | 75,512 | 75,714 | no | 0.9105 |
| 11 | 70,874 | 70,688 | no | 0.9154 |
| 12 | 77,341 | 77,382 | no | 0.9102 |
| 13 | 69,021 | 68,755 | no | 0.9130 |
| 14 | 76,327 | 76,168 | no | 0.9111 |
| 15 | 71,017 | 70,791 | no | 0.8960 |
| 16 | 72,363 | 72,587 | no | 0.9058 |
| 17 | 74,423 | 74,277 | no | 0.8985 |
| 18 | 72,773 | 72,862 | no | 0.9119 |
| 19 | 76,835 | 77,099 | no | 0.9180 |

## Stage 6 - the replay test

**failed.** Criterion: a positive replay claim requires ALL FOUR: (1) odour-A ensemble reactivation above the odour-B ensemble, (2) sleep above wake, (3) the real connectome above the degree-preserving shuffled connectome, and (4) the odour-A ensemble above size-matched random KC ensembles - each as a paired effect across seeds whose 95% CI excludes zero in the predicted direction. A positive result that does not survive the shuffled-connectome null is an artifact of network structure, not replay, and is reported as such.

**No evidence of memory replay, and no basis for calling what was measured an artifact either. The odour-A ensemble does score above size-matched random ensembles, but the comparison that would say whether that is structure rather than memory, the degree-preserving shuffled connectome, cannot answer it here. The two arms differ by 3.8 times in ensemble size and 10.7 times in Kenyon-cell rate. Standardising against size-matched random ensembles corrects the first and not the second: the arms are in different states, so this comparison does not isolate the variable its name refers to and its result should not be read as evidence about that variable in either direction. On this measure the memory contributed nothing: the identical sleep run with unlearned weights gave the same reactivation (learned minus unlearned = +0.01628, 95% CI [-0.01104, +0.04429]). That is not because the memory does nothing offline: stage 5 compared the two runs spike for spike and found the Kenyon-cell activity differs in every seed. It is that the difference is not an increase in how much the trained ensemble reactivates. One of the four, sleep against wake, is being asked to find a difference this model does not have: stage 5 measured clamping the 32 dorsal fan-shaped body neurons as changing the rest of the brain by 0.2 per cent in population rate and 0.2 per cent in Kenyon-cell rate. Its failing is a fact about the manipulation, not about replay.**

*The four required comparisons use z_vs_random_ensembles, each run standardised against size-matched random Kenyon-cell ensembles drawn from that same run, because ensemble sizes differ between odours and between the real and shuffled networks and the raw template correlation depends on template size. comparisons_raw_metric repeats three of them on the raw correlation so the effect of that choice can be seen.*

| comparison | required? | difference | 95% CI | Hedges' g | p | seeds | shows the predicted effect |
|---|---|---|---|---|---|---|---|
| trained (A) vs unpaired (B) ensemble, during sleep | one of the four | -9.09660 | [-10.64704, -7.59343] | -2.43 | 0.0000 | 20 | **no** |
| sleep vs wake, odour-A ensemble | one of the four | -0.03191 | [-0.05640, -0.00672] | -0.53 | 0.0253 | 20 | **no** |
| real vs degree-preserving shuffled connectome, odour-A ensemble in sleep | one of the four | -17.63699 | [-19.20478, -16.15238] | -4.74 | 0.0000 | 20 | **no** |
| odour-A ensemble vs size-matched random KC ensembles, during sleep | one of the four | +0.56288 | [+0.55985, +0.56585] | +77.08 | 0.0000 | 20 | yes |
| learned vs unlearned synaptic weights, odour-A ensemble in sleep | additional | +0.01628 | [-0.01104, +0.04429] | +0.24 | 0.2879 | 20 | **no** |
| learned vs unlearned weights, share of offline Kenyon-cell spikes falling in the odour-A ensemble | additional | +0.03797 | [+0.01253, +0.06360] | +0.60 | 0.0108 | 20 | yes |

Beyond the four pre-registered comparisons the file carries additional ones, and they are labelled as additional rather than counted towards the verdict. 'trained_vs_naive_weights' repeats the sleep run with the UNLEARNED weights at the same seed and compares the two: it asks whether the memory contributed anything at all, which the four required comparisons cannot ask because all four are computed inside the trained network. 'trained_vs_naive_spike_share' is the same contrast read on the share of offline spikes the ensemble accounts for rather than on the template correlation. Neither was pre-registered, so neither can turn a negative verdict positive; they are reported because a reader is entitled to see them.

The same comparisons on the raw template correlation, without size normalisation:

| comparison | difference | 95% CI | Hedges' g | p |
|---|---|---|---|---|
| A_vs_B_sleep_raw | -0.13309 | [-0.13738, -0.12879] | -12.61 | 0.0000 |
| sleep_vs_wake_A_raw | +0.00117 | [-0.00066, +0.00445] | +0.16 | 0.9677 |
| real_vs_shuffled_raw | -0.25784 | [-0.28421, -0.22435] | -3.49 | 0.0000 |

Ensemble sizes actually used (Kenyon cells), which is why the size-normalised statistic is the primary one:

- real: sleep 178, wake 178, sleep_naive 178
- shuffled: sleep 670

**Does the verdict depend on the time bin?** The primary bin is the cited one (Kudrimoti et al. 1999). The same runs re-analysed at shorter bins:

| bin | events are discrete | verdict | comparisons that showed the predicted effect |
|---|---|---|---|
| 10 ms | no | artifact | A_vs_random_ensembles, trained_vs_naive_spike_share |

### Is the memory legible offline, even though the ensemble does not reactivate?

**The memory is legible in the offline activity, and it is tonic rather than episodic. Drive through the learned synapses during the offline period is 18,664 mV/s in the trained network against 27,659 in the identical run with unlearned weights, a change of -32.5 per cent, paired t = -111.7, p = 3.1e-28 over 20 seeds. That is not the weight change itself, which is only -1.23 per cent of the total plastic weight: the offline activity falls disproportionately on the synapses the conditioning depressed, so the engram is amplified about 26 times in what the mushroom body actually sends. Decomposing it, the learned weights acting on UNCHANGED activity account for -32.8 per cent and the changed activity acting on unlearned weights for +0.4 per cent, so the trace is a read-out of the weights through activity that did not itself change. Across 39 one-second bins the trained-to-unlearned ratio has a coefficient of variation of 0.23, so the trace is flat: the memory is expressed continuously, not in episodes, so it is an offline memory trace and not replay.**

| quantity | value |
|---|---|
| drive through the learned synapses, trained | 18,664 mV/s |
| the same run with unlearned weights | 27,659 mV/s |
| change | -32.5% +/- 1.3, paired t = -111.7, p = 3.1e-28 |
| of which, learned weights on unchanged activity | -32.8% |
| of which, changed activity on unlearned weights | +0.4% |
| total plastic weight actually moved | -1.23% |
| amplification of the engram in the output | 26x |
| episodic? | no (bin-to-bin coefficient of variation 0.23) |

*Where the Kenyon cells' recurrent synapses are: The Kenyon cells' recurrent input is overwhelmingly axonal. Of 1,153,845 Kenyon-cell-to-Kenyon-cell synapses, 33,915 (2.9%) are in the calyx where the dendrites are, and 1,038,569 (90.0%) are in the lobes and pedunculus where the axons are (955,703 lobe, 82,866 pedunculus), with 81,361 (7.1%) elsewhere. The measurement that says this interaction is metabotropic rather than nicotinic is about the axons, so it applies to 90% of the recurrent synapses the model currently makes fast and excitatory.*

**Sequence order.** Spearman rank correlation between within-event first-spike order and the order of the odour response, against a cell-identity shuffle (Foster & Wilson 2006). Reported only where events contained at least four ensemble members with distinct template ranks. Scored on 20 seeds over 3999 reactivation events: mean absolute rank correlation 0.122 against a cell-identity shuffle mean of 0.087.

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

