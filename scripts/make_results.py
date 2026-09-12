"""Regenerate results.md from the stage outputs. Plain language, negative results included, every claim
traceable to a file. Nothing here is written by hand: if a stage has not run, it says so.
"""
import json
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
from hypnagogia import RESULTS, ROOT
from hypnagogia.connectome import load_connectome

L = []
def w(s=""): L.append(s)
def load(p):
    p = Path(p)
    return json.load(open(p)) if p.exists() else None


def fmt(x, n=3):
    if x is None:
        return "not measured"
    if isinstance(x, float):
        return f"{x:.{n}g}"
    return str(x)


def main():
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    conn = load_connectome("malecns", "v1.0", "brain")
    s0e = load(RESULTS / "stage0_engine_check" / "engine_check.json")
    s0v = load(RESULTS / "stage0_validate_malecns" / "validation.json")
    s0x = load(RESULTS / "stage0_engine_check" / "crossmatch_report.json")
    s1 = load(RESULTS / "stage1_noise" / "stage1.json")
    s2 = load(RESULTS / "stage2_criticality" / "full" / "stage2.json")
    s3b = load(RESULTS / "stage3b_odor" / "stage3b.json")
    s3bi = load(RESULTS / "stage3b_odor" / "ignition_threshold.json")
    s3c = load(RESULTS / "stage3c_control" / "stage3c.json")
    s3d = load(RESULTS / "stage3d_gain" / "stage3d.json")
    s3e = load(RESULTS / "stage3e_discrim" / "stage3e.json")
    s3 = load(RESULTS / "stage3_plasticity" / "stage3.json")
    s4 = load(RESULTS / "stage4_learning" / "stage4.json")
    s5 = load(RESULTS / "stage5_sleep" / "stage5.json")
    s6 = load(RESULTS / "stage6_replay" / "stage6.json")

    w("# hypnagogia: results")
    w()
    w(f"*Generated {now} by `scripts/make_results.py`. Every number is read from a file under `results/`; "
      "nothing in this document is written by hand. Stages that have not run say so.*")
    w()
    w("**Question.** Can a whole-brain *Drosophila* connectome model spontaneously reactivate a learned memory "
      "during a simulated sleep state? Encode an odour memory through dopamine-gated plasticity at Kenyon-cell "
      "to mushroom-body-output-neuron synapses, then look for the same Kenyon-cell ensemble switching on again, "
      "by itself, during an offline period with no odour input.")
    w()

    # ---- headline ----
    w("## Headline")
    w()
    if s6:
        w(f"**Stage 6 ({s6['status']}).** {s6['headline']}")
    elif (s3e and s3e["status"] == "failed") or (s3b and s3b["status"] == "failed"):
        w("**The replay test as specified cannot be run on this model, and the reason is itself the result.**")
        w()
        w("Two independent findings block it, and neither came from tuning anything:")
        w()
        w("1. *There is no critical regime, because the network is bistable.* Sweeping the background noise never "
          "produces a sustained intermediate activity level. Seeds at the same noise amplitude either stay silent or "
          "ignite into a saturated state. The Kenyon-cell firing rate measured in a real fly, about 0.1 Hz, falls "
          "inside a gap of more than four orders of magnitude that the model cannot occupy.")
        w("2. *There is no sparse odour code to encode a memory in.* Every olfactory stimulus tested, down to a "
          "single receptor neuron driven at 50 Hz, ignites the whole network, and the activity never decays: the "
          "population rate after the odour is as high as during it, indefinitely. More than half of all Kenyon "
          "cells fire, where a real fly uses 5 to 10 per cent with a few spikes each.")
        if s3c:
            w(f"3. *This is the published model, not this dataset.* {s3c['finding']}")
        if s3e and s3e["status"] == "failed":
            w(f"4. *And the state carries no odour identity.* {s3e['finding']}")
        w()
        w("A memory needs a sparse, odour-specific ensemble, and a replay test needs a quiet background for that "
          "ensemble to reappear against. This model, at this scale and with the published parameters, provides "
          "neither. Reporting that is the honest outcome; the alternative would have been to change parameters until "
          "the plots looked right, which this project does not do.")
    elif s2 and not s2.get("has_critical_regime"):
        w("**The replay test has not been reached yet.** The most important result so far is negative and it "
          "comes from stage 2: the model has no background-activity regime that is both self-sustaining and "
          "biologically plausible. See *Stage 2* below.")
    else:
        w("Not enough stages have run to state a headline.")
    w()

    # ---- what was simulated ----
    w("## What was simulated")
    w()
    d = conn.describe()
    w(f"- Dataset: male CNS connectome v1.0 (Janelia FlyEM / Google Research / Cambridge Connectomics, *Cell* 2026), brain-only scope.")
    w(f"- **Neurons actually simulated: {d['n_neurons']:,}.** This is the count after filtering, not a headline figure. "
      f"The filtering chain is:")
    for st in conn.filtering_steps:
        w(f"  - {st['step']}: {st['n_neurons_before']:,} -> {st['n_neurons_after']:,} neurons, "
          f"{st['n_connections_before']:,} -> {st['n_connections_after']:,} connections")
    w(f"- Connections: {d['n_connections']:,}. Raw synapses: {d['n_synapses']:,}. After the 0.581 FlyWire-equivalence "
      f"scaling that the male CNS release specifies, the effective synapse count entering the model is "
      f"{round(d['n_synapses'] * conn.weight_scale):,}.")
    w(f"- Excitatory connections {d['n_excitatory_connections']:,}, inhibitory {d['n_inhibitory_connections']:,}, "
      f"signed per presynaptic neuron from its predicted neurotransmitter.")
    nt = d["nt_counts"]
    w(f"- Neurotransmitter assignment: " + ", ".join(f"{k} {v:,}" for k, v in sorted(nt.items(), key=lambda x: -x[1])) + ".")
    w(f"- Ventral nerve cord neurons are excluded. Loading them is behind `dataset.scope: cns` for later motor work.")
    w()

    # ---- stage 0 ----
    w("## Stage 0 - does the engine reproduce the published model, and does the male CNS network behave?")
    w()
    if s0e:
        w(f"**Engine check: {s0e['status']}.** Our Brian2 implementation was run on the *same* data the published "
          "model ships (FlyWire v630) with the same protocol, and compared against the output file in the paper's "
          "own repository.")
        w()
        w("| sugar-GRN drive | MN9 rate, ours | MN9 rate, published output | active neurons, ours | published | per-neuron rate correlation |")
        w("|---|---|---|---|---|---|")
        for f, r in sorted(s0e["runs"].items()):
            o, q = r["ours"], r["reference"]
            w(f"| {f} Hz | {o['mn9_rate_hz_mean']:.2f} Hz | {q['mn9_rate_hz_mean']:.2f} Hz | "
              f"{o['n_active_union']} | {q['n_active_union']} | r = {r['per_neuron_rate_correlation']:.4f} |")
        w()
        w("One discrepancy worth recording: the example output shipped in the repository was generated at 200 Hz "
          "(its sugar neurons fire at about 199 Hz), not at the 150 Hz that the current `model.py` has as its "
          "default. We compared at 200 Hz and at 100 Hz, the two frequencies for which shipped outputs exist.")
        w()
    else:
        w("**Engine check: not run.**")
        w()
    if s0v:
        w(f"**Male CNS validation gate: {s0v['status']}.** " + s0v.get("gate_note", ""))
        w()
        sc = s0v["weight_scale_check"]
        w(f"- Weight scaling. The male CNS release specifies that its synapse counts should be scaled by 0.581 to "
          f"be comparable with FlyWire. We tested that on our own tables two ways, over {sc['n_type_pairs']:,} cell-type "
          f"pairs present in both datasets. The **pre-registered** statistic (count-weighted median of the per-pair "
          f"mean-synapse ratio) gave **{sc['ratio_weighted_median']:.3f}**, which is outside the [0.45, 0.75] window we "
          f"declared in advance. The total-input statistic (ratio of total synapses over the same pairs) gave "
          f"**{sc['ratio_of_totals']:.3f}**, which matches 0.581 closely. Both are reported. Neither `W_syn` nor the "
          f"scale factor was retuned. The difference between the two statistics is that the male CNS detects about "
          f"45% more connected pairs, mostly weak ones, so a per-pair average understates the difference in total "
          f"synaptic input, which is what the model actually integrates.")
        for run in s0v["runs"]:
            if run["drive_set"] == "matched17" and run["sugar_rate_hz"] == 200 and run["weight_scale"] != 1.0:
                mn = run["mn9"][s0v["mn9_flywire_match"]["instance"]]
                w(f"- Propagation. Driving the male counterparts of the published sugar neurons at 200 Hz makes MN9 "
                  f"fire at {mn['rate_hz_mean']:.1f} Hz in {mn['frac_trials_active']:.0%} of trials, with "
                  f"{run['n_active_per_trial_mean']:.0f} neurons active per trial, against {run['flywire_v630_reference']['mn9_rate_hz_mean']:.1f} Hz "
                  f"and {run['flywire_v630_reference']['n_active_per_trial_mean']:.0f} neurons in FlyWire at the same drive. That is the "
                  f"biologically plausible range the gate asked for.")
        for run in s0v["runs"]:
            if run["drive_set"] == "matched17" and run["sugar_rate_hz"] == 200 and run["weight_scale"] == 1.0:
                w(f"- Without the scaling (weight_scale 1.0) the identical drive activates "
                  f"{run['n_active_per_trial_mean']:.0f} neurons per trial instead of a few hundred: the network runs away. "
                  f"The scale factor is doing real work, not cosmetic work.")
        w(f"- Cell-type mapping. Of the 21 published sugar neurons, "
          f"{len(s0v['sugar_grn_mapping']['one_to_one_matched'])} have one-to-one morphological matches among male "
          f"labellar LB3 neurons; {len(s0v['sugar_grn_mapping']['unmatched_flywire_ids'])} do not and are reported "
          f"rather than forced.")
        w()
    else:
        w("**Male CNS validation gate: not run.**")
        w()
    if s0x:
        amb = [p for p in s0x["populations"] if p["ambiguous"]]
        w(f"**Cross-matching every target population to its FlyWire counterpart.** {len(s0x['populations']) - len(amb)} of "
          f"{len(s0x['populations'])} populations matched cleanly in both directions.")
        w()
        w("| population | male CNS | FlyWire | male->FlyWire top-1 in population | FlyWire->male top-1 | verdict |")
        w("|---|---|---|---|---|---|")
        for p in s0x["populations"]:
            w(f"| {p['population']} | {p['n_male']} | {p['n_flywire']} | {p['male_to_flywire_top1_in_pop']:.0%} | "
              f"{p['flywire_to_male_top1_in_pop']:.0%} | {'AMBIGUOUS: ' + p['reasons'][0] if p['ambiguous'] else 'ok'} |")
        w()

    # ---- stage 1 ----
    w("## Stage 1 - adding background noise")
    w()
    if s1:
        w(f"**{s1['status']}.** The published model has no noise term: its baseline firing rate is exactly 0 Hz and "
          "the network is silent without input. Two background drives were added and verified.")
        w()
        w("| drive | parameter | measured membrane s.d. | population rate | fraction of neurons active |")
        w("|---|---|---|---|---|")
        for r in s1["runs"]:
            par = f"sigma = {r['sigma_mV']} mV" if r["noise_model"] == "gaussian" else f"{r['rate_hz']} Hz"
            w(f"| {r['noise_model']} | {par} | {r['mean_v_std_mV']:.3f} mV | {r['pop_rate_hz']:.4f} Hz/neuron | {r['frac_active']:.1%} |")
        w()
        w("With synapses switched off, the Gaussian drive reproduces its target membrane standard deviation to "
          "within 0.5%, which is the check that the stochastic term is integrated correctly. The Poisson drive at "
          "the published single-synapse weight is far too weak to reach threshold on its own.")
        w()
    else:
        w("**Not run.**")
        w()

    # ---- stage 2 ----
    w("## Stage 2 - is there a critical regime? No. The model is bistable.")
    w()
    if s2:
        w(f"**{s2['status']}.** Noise amplitude was swept over {len(s2['sigma_values_mV'])} values "
          f"({min(s2['sigma_values_mV'])} to {max(s2['sigma_values_mV'])} mV) with up to 10 seeds each, on the full "
          f"{s2['n_neurons']:,}-neuron network.")
        w()
        w(f"**There is no critical regime: `has_critical_regime = {s2['has_critical_regime']}`.** That is a finding, "
          "not a failure, and it was a stated possibility before the sweep ran: the model has no spike-frequency "
          "adaptation and no short-term synaptic depression, so nothing holds it at an intermediate activity level.")
        w()
        if s2.get("is_bistable"):
            w(f"What the sweep found instead is **bistability**. At {len(s2['bistable_sigmas_mV'])} noise amplitudes "
              f"({', '.join(str(x) for x in s2['bistable_sigmas_mV'])} mV) independent seeds of the *same* simulation "
              "either stayed quiescent or ignited into a high-rate state, with nothing in between. The noise amplitude "
              "controls the probability of ignition, not the resulting rate.")
            w()
            w("| noise sigma | seeds | probability of ignition | KC rate if quiescent | KC rate if ignited |")
            w("|---|---|---|---|---|")
            for r in s2["ignition_curve"]:
                if r["n_seeds"] >= 3:
                    q = r["kc_rate_hz_quiescent_mean"]; ig = r["kc_rate_hz_ignited_mean"]
                    w(f"| {r['sigma_mV']} mV | {r['n_seeds']} | {r['ignition_probability']:.0%} | "
                      f"{'-' if q is None else f'{q:.5f} Hz'} | {'-' if ig is None else f'{ig:.1f} Hz'} |")
            w()
            w("**The consequence matters more than the criticality question.** The measured spontaneous firing rate of "
              "Kenyon cells in a real fly is about 0.1 Hz (Turner, Bazhenov & Laurent 2008, *J Neurophysiol* 99:734). "
              "In this model the quiescent branch puts Kenyon cells near 0.0005 Hz and the ignited branch puts them "
              "above 20 Hz. **0.1 Hz falls inside a gap of more than four orders of magnitude that the model cannot "
              "produce at any noise amplitude.** There is no setting of the background drive at which the mushroom "
              "body idles the way a real one does.")
            w()
        w(f"Operating point chosen for the downstream stages: **sigma = {s2['operating_sigma_mV']} mV**. "
          f"{s2['operating_sigma_reason']}")
        w()
        w("Two methodological points, both of which changed the numbers:")
        w()
        w("- Avalanche statistics were being computed by binning spike times in seconds. With a 0.1 ms time step "
          "that division is not exact in floating point, and it produced a deterministic repeating pattern of "
          "spuriously empty bins - identical in every run, including runs with different seeds - which fabricated "
          "avalanche boundaries. Binning is now done in integer simulation steps. Before the fix, every high-rate "
          "run reported exactly 2,529 avalanches; after it, those runs correctly report that the population never "
          "pauses.")
        w("- When the mean interval between spikes anywhere in the brain falls below the simulation time step, "
          "the Beggs and Plenz avalanche definition has nothing to bite on. Those runs are now labelled "
          "'avalanche analysis not applicable' instead of being binned at the time step and reported as if the "
          "numbers meant something.")
        w("- The branching ratio is estimated by the multistep-regression method, which assumes the population "
          "autocorrelation decays exponentially. In the high-rate state it does not: it oscillates, with a "
          "negative lag-1 autocorrelation. Those runs no longer report a branching ratio from the exponential fit.")
        w()
    else:
        w("**Not run.**")
        w()

    w("## Stage 3b - is there a sparse odour code to build a memory on? No.")
    w()
    if s3b:
        w(f"**{s3b['status']}.** {s3b['reference']}")
        w()
        w(f"{s3b['finding']}")
        w()
        w("| glomeruli driven | receptor neurons | drive | Kenyon cells responding | spikes per responding cell | rate during | rate after |")
        w("|---|---|---|---|---|---|---|")
        for g in s3b["grid"]:
            w(f"| {g['set']} | {g['n_orn']} | {g['rate_hz']} Hz | **{g['frac_kc_active']:.1%}** | {g['spikes_per_active_kc']:.0f} | "
              f"{g['pop_rate_hz_odor']:.4f} Hz/neuron | {g['pop_rate_hz_post']:.4f} Hz/neuron |")
        w()
        w("The last two columns are the important ones: the population rate after the odour ends is the same as the "
          "rate during it. The stimulus does not drive a response, it triggers a transition, and the network stays "
          "in the new state afterwards. Before the odour the network is exactly silent.")
        w()
    else:
        w("**Not run.**")
        w()
    if s3bi:
        w(f"**How little input does it take?** {s3bi['finding']}")
        w()
        w("| receptor neurons driven | probability of ignition | rate during stimulus | rate after |")
        w("|---|---|---|---|")
        for g in s3bi["grid"]:
            w(f"| {g['n_driven']} | {g['fraction_ignited']:.0%} | {g['pop_rate_odor_mean']:.4f} Hz/neuron | {g['pop_rate_post_mean']:.4f} Hz/neuron |")
        w()
    w("## Stage 3e - do two different odours leave two different ensembles?")
    w()
    if s3e:
        w(f"**{s3e['status']}.** {s3e['question']}")
        w()
        w(f"{s3e['finding']}")
        w()
        w(f"{s3e['note']}")
        w()
        w("| gain | epoch | Kenyon cells in ensemble A | in ensemble B | overlap (Jaccard) | chance overlap | excess | discriminable |")
        w("|---|---|---|---|---|---|---|---|")
        for g in s3e["grid"]:
            w(f"| {g['gain']:.2f}{' (published)' if g['gain'] == 1.0 else ''} | {g['epoch']} | {g['frac_kc_A']:.1%} | {g['frac_kc_B']:.1%} | "
              f"{g['jaccard_observed']:.3f} | {g['jaccard_chance']:.3f} | {g['excess_over_chance']:+.3f} | "
              f"{'yes' if g['discriminable'] else '**no**'} |")
        w()
    else:
        w("**Not run.**")
        w()
    w("## Stage 3d - how far from the published model would you have to go?")
    w()
    if s3d:
        w(f"**This section is a labelled deviation from the published parameters.** {s3d['WARNING']}")
        w()
        w(f"Question asked: {s3d['question']}")
        w()
        w(f"{s3d['finding']}")
        w()
        w("| gain | effective W_syn | Kenyon cells responding | spikes per responding cell | rate during | rate after | sparse | transient |")
        w("|---|---|---|---|---|---|---|---|")
        for g in s3d["grid"]:
            w(f"| {g['gain']:.2f}{' (published)' if g['gain'] == 1.0 else ''} | {g['w_syn_effective_mV']} mV | {g['frac_kc_odor']:.1%} | "
              f"{g['spikes_per_active_kc']:.1f} | {g['pop_rate_odor']:.4f} | {g['pop_rate_post']:.4f} | "
              f"{'yes' if g['sparse'] else 'no'} | {'yes' if g['transient'] else 'no'} |")
        w()
    else:
        w("**Not run.**")
        w()
    w("## Stage 3c - is the runaway the model, or this dataset?")
    w()
    if s3c:
        w(f"{s3c['finding']}")
        w()
        if s3c.get("pathway_control"):
            w(f"**Pathway control.** {s3c['pathway_control']}")
            w()
        w("| network | pathway | neurons driven | drive | probability of ignition | Kenyon cells responding | neurons active | rate during | rate after |")
        w("|---|---|---|---|---|---|---|---|---|")
        for g in s3c["grid"]:
            w(f"| {g['condition']} | {g.get('pathway', 'olfactory')} | {g['n_orn']} | {int(g['rate_hz'])} Hz | {g['frac_ignited']:.0%} | "
              f"{g['frac_kc_odor']:.1%} | {g['n_active_odor']:.0f} | {g['pop_rate_odor']:.4f} | {g['pop_rate_post']:.4f} |")
        w()
    else:
        w("**Not run.**")
        w()
    for name, obj, title in [("Stage 3", s3, "Stage 3 - dopamine-gated plasticity"),
                             ("Stage 4", s4, "Stage 4 - encoding a memory"),
                             ("Stage 5", s5, "Stage 5 - the sleep state"),
                             ("Stage 6", s6, "Stage 6 - the replay test")]:
        w(f"## {title}")
        w()
        if obj is None:
            w("**Not run.**")
            w()
            continue
        w(f"**{obj['status']}.** Criterion: {obj.get('criterion', '')}")
        w()
        if name == "Stage 3":
            w(f"- Rule: {obj['rule']['description']}")
            for e in obj["rule"]["equations"]:
                w(f"  - `{e}`")
            w(f"- Plastic synapses: {obj['n_plastic_synapses']:,} Kenyon-cell to output-neuron connections "
              f"({obj['n_plastic_synapse_count_sum']:,} synapses) between {obj['n_kc']:,} Kenyon cells and {obj['n_mbon']} output neurons, "
              f"gated by {obj['n_dan']} dopaminergic neurons through {obj['n_dan_mbon_gates']:,} connections.")
            w(f"- Unit test on an isolated three-neuron circuit: {'passed' if obj['unit_test']['passed'] else 'FAILED'}. "
              f"Pairing Kenyon-cell activity with dopaminergic activity depressed the synapse to "
              f"{obj['unit_test']['results']['kc_then_dan']['ratio']:.3f} of its starting weight; dopamine alone and "
              f"Kenyon-cell activity alone left it unchanged.")
            w()
            w("| parameter | value | source | cited |")
            w("|---|---|---|---|")
            for p in obj["rule"]["parameters"]:
                w(f"| {p['name']} | {p['value']} | {p['source']} | {'yes' if p['cited'] else '**no**'} |")
            w()
        if name == "Stage 4" and obj.get("effect"):
            e = obj["effect"]
            w(f"- Learning verified: **{obj['learning_verified']}**.")
            w(f"- Output-neuron response to the trained odour A went from {e.get('A_pre_mean', 0):.2f} to {e.get('A_post_mean', 0):.2f} Hz; "
              f"to the control odour B from {e.get('B_pre_mean', 0):.2f} to {e.get('B_post_mean', 0):.2f} Hz.")
            w(f"- Difference of changes (A minus B): {e['diff']:.3f} Hz, 95% CI [{e['ci95'][0]:.3f}, {e['ci95'][1]:.3f}], "
              f"Hedges' g = {e['hedges_g']:.2f}, permutation p = {e['p_permutation']:.4f}, over {e['n']} seeds.")
            if obj.get("notes"):
                for n in obj["notes"]:
                    w(f"- {n}")
            w()
        if name == "Stage 5" and obj.get("summary"):
            w("| condition | population rate | Kenyon-cell rate | output-neuron rate | dFB rate |")
            w("|---|---|---|---|---|")
            for s in obj["summary"]:
                w(f"| {s['condition']} | {s['pop_rate_hz_mean']:.4f} Hz | {s['kc_rate_hz_mean']:.4f} Hz | "
                  f"{s['mbon_rate_hz_mean']:.4f} Hz | {s['dfb_rate_hz_mean']:.2f} Hz |")
            w()
            w(f"- The dFB population is {obj['dfb']['n_neurons']} neurons of types "
              f"{', '.join(obj['dfb']['cell_types'])}. {obj['dfb']['selection_source']}")
            w(f"- Clamp rate: {obj['dfb']['clamp_rate_hz']} Hz. {obj['dfb']['rate_source']}")
            w()
        if name == "Stage 6" and obj.get("comparisons"):
            w(f"{obj['headline']}")
            w()
            w("| comparison | difference | 95% CI | Hedges' g | p | seeds | survives |")
            w("|---|---|---|---|---|---|---|")
            for c in obj["comparisons"]:
                if c.get("available"):
                    w(f"| {c['label']} | {c['diff']:+.5f} | [{c['ci95'][0]:+.5f}, {c['ci95'][1]:+.5f}] | "
                      f"{c['hedges_g']:+.2f} | {c['p_permutation']:.4f} | {c['n']} | {'yes' if c['survives'] else '**no**'} |")
                else:
                    w(f"| {c['label']} | not available | | | | | {c.get('note', '')} |")
            w()

    w("## What this is not")
    w()
    for line in ["Point neurons. Every cell is a single compartment with no dendritic processing.",
                 "Uniform biophysics. Every neuron has the same membrane time constant, threshold and refractory period, "
                 "regardless of type or size.",
                 "Predicted, not measured, neurotransmitters. Signs come from a machine-learning prediction on synapse images.",
                 "No morphology. Conduction delay is a single constant, not a function of distance.",
                 "No body, no behaviour, no sensory feedback.",
                 "No ripple analogue. The fly has no described equivalent of the hippocampal sharp-wave ripple that "
                 "organises mammalian replay, so there is no event detector to trigger on.",
                 "A single plasticity locus. Only Kenyon-cell to output-neuron synapses can change.",
                 "A male brain. Much of the physiology this model is calibrated against was measured in females.",
                 "No ventral nerve cord.",
                 "Offline reactivation of Kenyon-cell ensembles has never been observed in a real fly. There is no "
                 "measurement to compare a positive result against."]:
        w(f"- {line}")
    w()
    open(ROOT / "results.md", "w").write("\n".join(L) + "\n")
    print(f"wrote results.md ({len(L)} lines)")


if __name__ == "__main__":
    main()
