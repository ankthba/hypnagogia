"""Stage 2 - CRITICALITY. Sweep the Gaussian noise amplitude sigma on the male CNS brain network and
classify each value as silent / subcritical / critical / saturated with pre-registered criteria
(hypnagogia.analysis.criticality.CRITERIA). Outputs results/stage2_criticality/stage2.json.
Usage: python scripts/02_criticality.py [--subset] [--seeds 0,1,2] [--sigmas 1,2,4]
"""
import argparse, json, sys, time
import numpy as np
from hypnagogia import RESULTS
from hypnagogia.config import load_config, dump_config, with_deviations
from hypnagogia.connectome import load_connectome, subset_from_config
from hypnagogia.populations import SUBSET_MB_CX
from hypnagogia.jobs import run_jobs
from hypnagogia.model import load_spikes
from hypnagogia.analysis.criticality import analyse_population, CRITERIA


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--subset", action="store_true"); ap.add_argument("--seeds", default=None); ap.add_argument("--sigmas", default=None)
    ap.add_argument("--analyse-only", action="store_true"); ap.add_argument("--tag", default="")
    ap.add_argument("--gain", type=float, default=1.0,
                    help="multiplier on every synaptic weight; 1.0 is the published model. Values below 1 are a "
                         "labelled deviation (see configs/stage3d_gain.yaml) and are written to a separate directory.")
    a = ap.parse_args()
    cfg = load_config("stage2_criticality"); s2 = cfg["stage2"]
    cfg = with_deviations(cfg)
    sigmas = [float(x) for x in a.sigmas.split(",")] if a.sigmas else s2["sigma_values_mV"]
    seeds = [int(x) for x in a.seeds.split(",")] if a.seeds else s2["seeds"]
    tag = ("subset" if a.subset else "full") + ("" if a.gain == 1.0 else f"_gain{a.gain}") + (a.tag or "")
    OUT = RESULTS / "stage2_criticality" / tag; OUT.mkdir(parents=True, exist_ok=True); dump_config(cfg, OUT / "config.resolved.yaml")
    cspec = {"dataset": "malecns", "version": "v1.0", "scope": "brain",
             "weight_scale": cfg["dataset"]["weight_scale"] * a.gain,
             "subset": SUBSET_MB_CX if a.subset else None}
    conn = load_connectome("malecns", "v1.0", "brain")
    if a.subset:
        conn = subset_from_config(conn, SUBSET_MB_CX)
    subpops = {"KC": conn.select(cell_class="Kenyon_Cell"), "MBON": conn.select(cell_class="MBON"),
               "DAN": conn.select(cell_class="DAN"), "ORN": conn.select(cell_type={"regex": r"^ORN_"})}
    T = s2["warmup_s"] + s2["duration_s"]
    specs = []
    for sg in sigmas:
        for sd in seeds:
            c = json.loads(json.dumps(cfg)); c["noise"] = {"mode": "gaussian", "sigma_mV": float(sg), "poisson": cfg["noise"]["poisson"]}
            specs.append({"out_dir": str(OUT / f"sigma{sg}_seed{sd}"), "seed": 100 + sd, "config": c, "name": f"crit_{sg}_{sd}",
                          "connectome": cspec, "drive_groups": {}, "record": "all",
                          "epochs": [{"name": "noise", "duration_s": T}]})
    t0 = time.time()
    if not a.analyse_only:
        res = run_jobs(specs, n_parallel=cfg["run"]["n_parallel"])
        errs = [(s["name"], r.get("error")) for s, r in zip(specs, res) if r is None or "error" in r]
        if errs:
            print("ERRORS:", errs[:3])
    # Analyse EVERY run present in the output directory, not only the ones requested on this invocation, so that
    # successive calls with extra --sigmas accumulate into one combined sweep. Per-run analyses are cached.
    import re as _re

    def network_signature(meta: dict) -> tuple:
        """What network a run was actually simulated on, beyond the connectome and the gain.

        Runs accumulate in this directory across invocations, and a run left over from before a correction to the
        network is not comparable with a fresh one. Mixing them silently would put two different networks in one
        sweep and pick an operating point off the mixture, so a run whose signature does not match the current
        one is dropped from the analysis and counted.
        """
        g = meta.get("graded_release") or {}
        nt = tuple(sorted(x.get("population", "") for x in (meta.get("connectome_provenance", {}) or {}).get("nt_corrections", []) or []))
        return (int(g.get("n_neurons") or 0), tuple(sorted(g.get("ids") or [])), nt,
                int(meta.get("n_neurons", 0)), float(meta.get("weight_scale") or 0.0))

    want_sig, dropped = None, []
    run_dirs = sorted(p for p in OUT.glob("sigma*_seed*") if (p / "spikes.npz").exists())
    for rd in run_dirs:                                   # the signature of the runs this invocation just made
        if not (rd / "meta.json").exists():
            continue
        mm0 = _re.match(r"sigma([0-9.]+)_seed(\d+)$", rd.name)
        if mm0 and float(mm0.group(1)) in [float(x) for x in sigmas] and int(mm0.group(2)) in seeds:
            want_sig = network_signature(json.load(open(rd / "meta.json")))
            break
    per = []
    for rd in run_dirs:
        mm = _re.match(r"sigma([0-9.]+)_seed(\d+)$", rd.name)
        if not mm:
            continue
        sg, sd = float(mm.group(1)), int(mm.group(2))
        if want_sig is not None and (rd / "meta.json").exists():
            got = network_signature(json.load(open(rd / "meta.json")))
            if got != want_sig:
                dropped.append({"run": rd.name, "sigma_mV": sg, "seed": sd})
                continue
        cache = rd / "analysis.json"
        if cache.exists():
            per.append(json.load(open(cache)))
            print(f"sigma={sg} seed={sd}: cached -> {per[-1]['classification']}", flush=True)
            continue
        try:
            i, ts, meta = load_spikes(str(rd))
        except Exception as e:
            per.append({"sigma_mV": sg, "seed": sd, "error": str(e)}); continue
        dur = meta["duration_s"]
        r = analyse_population(ts, conn.N, meta["dt_ms"] * 1e-3, s2["warmup_s"], dur, mr_bin_s=s2["mr_bin_ms"] * 1e-3,
                               mr_kmax_s=s2["mr_kmax_ms"] * 1e-3, aval_bin_mult=s2["avalanche_bin_mult"], seed=sd, i=i,
                               subpopulations=subpops)
        # robustness: avalanche bin x0.5 and x2 (classification only reported, not used for the operating point)
        rob = {}
        for mult in (0.5, 2.0):
            rr = analyse_population(ts, conn.N, meta["dt_ms"] * 1e-3, s2["warmup_s"], dur, mr_bin_s=s2["mr_bin_ms"] * 1e-3,
                                    mr_kmax_s=s2["mr_kmax_ms"] * 1e-3, aval_bin_mult=mult, seed=sd, i=i)
            rob[str(mult)] = {"classification": rr["classification"], "n_avalanches": rr["avalanches"]["n"], "alpha": rr["size_fit"]["alpha"],
                              "R_vs_exponential": rr["size_fit"]["R_vs_exponential"], "R_vs_lognormal": rr["size_fit"]["R_vs_lognormal"]}
        rec = {"sigma_mV": sg, "seed": sd, "file": f"results/stage2_criticality/{tag}/{rd.name}/spikes.npz", **r, "robustness_bin_mult": rob,
               "walltime_s": meta.get("walltime_total_s")}
        json.dump(rec, open(cache, "w"), indent=1, default=str)
        per.append(rec)
        print(f"sigma={sg} seed={sd}: rate={r['pop_rate_hz']:.3f} Hz/neuron active={r['frac_active']:.3f} m={r['branching_ratio_mr']['m']} "
              f"n_aval={r['avalanches']['n']} alpha={r['size_fit']['alpha']} -> {r['classification']}", flush=True)
    # summary by sigma (over every sigma present in the directory)
    summ = []
    all_sigmas = sorted({p["sigma_mV"] for p in per})
    for sg in all_sigmas:
        rows = [p for p in per if p["sigma_mV"] == sg and "error" not in p]
        if not rows:
            summ.append({"sigma_mV": sg, "n_seeds": 0, "classification": "not_run"}); continue
        ms = [p["branching_ratio_mr"]["m"] for p in rows if p["branching_ratio_mr"]["m"] is not None]
        labels = [p["classification"] for p in rows]
        maj = max(set(labels), key=labels.count)
        # Bistability: at one sigma some seeds stay quiescent and others ignite into the high-rate state. That is a
        # bimodal ignition probability, not a continuous approach to a critical point, so it gets its own label.
        rates = [p["pop_rate_hz"] for p in rows]
        quiescent = [r for r in rates if r < 0.05]
        ignited = [r for r in rates if r >= 0.05]
        if quiescent and ignited:
            maj = "bistable"
        kcr = [p.get("subpopulation_rates", {}).get("KC", {}).get("rate_hz") for p in rows]
        kcr = [x for x in kcr if x is not None]
        summ.append({"sigma_mV": sg, "n_seeds": len(rows),
                     "kc_rate_hz_mean": (float(np.mean(kcr)) if kcr else None),
                     "avalanche_analysis_applicable": bool(all(p["avalanches"].get("applicable", True) for p in rows)),
                     "pop_rate_hz_mean": float(np.mean([p["pop_rate_hz"] for p in rows])),
                     "pop_rate_hz_sd": float(np.std([p["pop_rate_hz"] for p in rows], ddof=1)) if len(rows) > 1 else 0.0,
                     "frac_active_mean": float(np.mean([p["frac_active"] for p in rows])),
                     "m_mean": float(np.mean(ms)) if ms else None, "m_sd": float(np.std(ms, ddof=1)) if len(ms) > 1 else 0.0,
                     "classification": maj, "labels": labels,
                     "n_ignited": len(ignited), "n_quiescent": len(quiescent),
                     "ignition_probability": float(len(ignited) / len(rates)),
                     "pop_rate_hz_ignited_mean": (float(np.mean(ignited)) if ignited else None),
                     "pop_rate_hz_quiescent_mean": (float(np.mean(quiescent)) if quiescent else None),
                     "kc_rate_hz_ignited_mean": (float(np.mean([p["subpopulation_rates"]["KC"]["rate_hz"] for p in rows if p["pop_rate_hz"] >= 0.05])) if ignited else None),
                     "kc_rate_hz_quiescent_mean": (float(np.mean([p["subpopulation_rates"]["KC"]["rate_hz"] for p in rows if p["pop_rate_hz"] < 0.05])) if quiescent else None)})
    # transition sharpness: the narrowest bracket between the highest silent sigma and the lowest saturated sigma
    sil = [s["sigma_mV"] for s in summ if s["classification"] == "silent"]
    sat = [s["sigma_mV"] for s in summ if s["classification"] in ("saturated", "bistable")]
    bracket = {"highest_silent_sigma_mV": (max(sil) if sil else None), "lowest_saturated_sigma_mV": (min(sat) if sat else None)}
    if bracket["highest_silent_sigma_mV"] and bracket["lowest_saturated_sigma_mV"]:
        lo, hi = bracket["highest_silent_sigma_mV"], bracket["lowest_saturated_sigma_mV"]
        bracket["width_mV"] = round(hi - lo, 4); bracket["width_relative"] = round((hi - lo) / lo, 4)
        inter = [s for s in summ if lo < s["sigma_mV"] < hi]
        bracket["n_sigmas_inside_bracket"] = len(inter)
        bracket["classifications_inside_bracket"] = [{"sigma_mV": s["sigma_mV"], "classification": s["classification"],
                                                      "pop_rate_hz_mean": s.get("pop_rate_hz_mean")} for s in inter]
    KC_SPONTANEOUS_HZ = 0.1   # Turner, Bazhenov & Laurent 2008 J Neurophysiol 99:734: KC spontaneous rate 0.1 +/- 0.4 spikes/s
    bist = [s for s in summ if s["classification"] == "bistable"]
    ignition = [{"sigma_mV": s["sigma_mV"], "ignition_probability": s.get("ignition_probability"), "n_seeds": s["n_seeds"],
                 "pop_rate_hz_quiescent_mean": s.get("pop_rate_hz_quiescent_mean"), "pop_rate_hz_ignited_mean": s.get("pop_rate_hz_ignited_mean"),
                 "kc_rate_hz_quiescent_mean": s.get("kc_rate_hz_quiescent_mean"), "kc_rate_hz_ignited_mean": s.get("kc_rate_hz_ignited_mean")} for s in summ]
    crit = [s for s in summ if s["classification"] == "critical" and s["m_mean"] is not None]
    old_rule_pick = None
    if crit:
        op = min(crit, key=lambda s: abs(s["m_mean"] - 1.0)); has_crit = True
        reason = f"critical regime found at sigma = {op['sigma_mV']} mV (mean m = {op['m_mean']:.3f}); operating point = critical sigma with m closest to 1"
    else:
        # Two exclusions, and one that used to be here and is not any more.
        #
        # A bistable sigma is excluded. At one of those the outcome depends on the seed: some runs stay silent and
        # some ignite, so the population rate reported for it is the average of two different states rather than the
        # rate of any state the network is ever in, and every downstream stage would inherit that mixture. Only
        # sigmas whose outcome is the same in every seed are eligible.
        #
        # A sigma with no Kenyon-cell activity at all is excluded, because the criterion is about the Kenyon-cell
        # rate and a rate of exactly zero has no log distance to anything.
        #
        # 'saturated' is NOT excluded any more, and the change is deliberate and worth stating. In this pipeline
        # that label means the WHOLE-BRAIN activity never pauses, which makes the avalanche analysis inapplicable;
        # it says nothing about the Kenyon cells, and the criterion here is the Kenyon-cell rate. Before APL was
        # corrected the two went together, because a brain that never paused had Kenyon cells firing at tens of Hz,
        # and excluding it was right. With APL modelled as it is measured the Kenyon cells stay sparse inside a
        # continuously active brain, so the exclusion now throws away every state with any Kenyon-cell activity in
        # it and leaves an operating point where the whole brain fires roughly once per neuron per hour. That is
        # further from any measurement than the state it was rejecting. What the old rule would have chosen is
        # recorded below so the change can be audited.
        active = [s for s in summ if (s.get("kc_rate_hz_mean") or 0) > 0]
        elig = [s for s in active if s["classification"] != "bistable"]
        cand = elig or active
        mixed = not elig and bool(cand)
        old_rule_cand = [s for s in elig if s["classification"] != "saturated"]
        old_rule_pick = (min(old_rule_cand, key=lambda s: abs(np.log10(max(s["kc_rate_hz_mean"], 1e-9)) - np.log10(KC_SPONTANEOUS_HZ)))
                         if old_rule_cand else None)
        has_crit = False
        if cand:
            op = min(cand, key=lambda s: abs(np.log10(max(s["kc_rate_hz_mean"], 1e-9)) - np.log10(KC_SPONTANEOUS_HZ)))
            reason = (f"NO critical regime found in the sweep (no sigma satisfied all criteria; the network is bistable - silent below the "
                      f"transition and continuously active above it). The operating point for the downstream stages is therefore NOT a critical "
                      f"point: it is the sigma whose Kenyon-cell population rate is closest to the measured KC spontaneous rate of "
                      f"{KC_SPONTANEOUS_HZ} Hz (Turner, Bazhenov & Laurent 2008 J Neurophysiol 99:734), i.e. sigma = {op['sigma_mV']} mV "
                      f"(KC rate {op['kc_rate_hz_mean']:.4f} Hz, whole-brain rate {op['pop_rate_hz_mean']:.4f} Hz/neuron, m = {op['m_mean']}). "
                      f"Sigmas whose outcome depends on the seed are excluded, because the rate reported for one of those is an average of two "
                      f"different states rather than the rate of a state.")
            if mixed:
                reason += (" WARNING: every active sigma in this sweep is seed-dependent, so the operating point IS one of those "
                           "and the downstream stages inherit a mixture of an ignited and a silent network. This is reported, not worked around.")
            if op.get("classification") == "saturated":
                reason += (f" The chosen sigma is classified 'saturated', which in this pipeline means the whole brain's activity never "
                           f"pauses ({op.get('pop_rate_hz_mean', 0):.3f} Hz per neuron) and the avalanche analysis is therefore not "
                           f"applicable there. That is a property of the model and is reported as one. It is not a statement about the "
                           f"Kenyon cells, which idle at {op['kc_rate_hz_mean']:.3f} Hz inside that state against the 0.1 Hz measured.")
            if old_rule_pick is not None and old_rule_pick["sigma_mV"] != op["sigma_mV"]:
                reason += (f" Excluding the continuously active states, as an earlier version of this rule did, would have chosen "
                           f"sigma = {old_rule_pick['sigma_mV']} mV instead, where the Kenyon cells fire at "
                           f"{old_rule_pick['kc_rate_hz_mean']:.5f} Hz and the whole brain at "
                           f"{old_rule_pick['pop_rate_hz_mean']:.5f} Hz per neuron, which is further from the measurement, not closer.")
        else:
            op = None; reason = "NO critical regime and no active non-saturated sigma: every sigma is silent or saturated."
    out = {"status": "passed" if per and not any("error" in p for p in per) else "failed", "has_critical_regime": has_crit,
           "is_bistable": bool(bist), "bistable_sigmas_mV": [s["sigma_mV"] for s in bist], "ignition_curve": ignition,
           "bistability_note": ("At one or more noise amplitudes, independent seeds either stayed quiescent or ignited into the "
                                "high-rate state, with nothing in between. The transition is therefore a stochastic ignition of a "
                                "bistable network, not a continuous approach to a critical point. This is the expected behaviour of a "
                                "network with no spike-frequency adaptation and no short-term synaptic depression."),
           "criterion": "sweep completes for all sigma x seeds; classification per CRITERIA; a missing critical band is a finding, not a failure",
           "network": tag, "gain": a.gain,
           "gain_note": ("published parameters" if a.gain == 1.0 else
                         f"DEVIATION: every synaptic weight scaled to {a.gain} of its published value (an uncited free "
                         f"parameter introduced by this project; see configs/stage3d_gain.yaml)"),
           "n_neurons": conn.N, "n_connections": conn.E, "duration_s": s2["duration_s"], "warmup_s": s2["warmup_s"], "seeds": seeds,
           "criteria": CRITERIA, "sigma_values_mV": all_sigmas, "sigma_values_requested_this_run": sigmas,
           "runs_dropped_wrong_network": dropped,
           "runs_dropped_note": ("Runs left in the output directory from before a correction to the network are not "
                                 "comparable with the current ones, so any whose network signature (non-spiking "
                                 "populations, transmitter corrections, neuron count, weight scale) differs from this "
                                 "invocation's is dropped rather than merged into the sweep."), "mr_bin_ms": s2["mr_bin_ms"], "mr_kmax_ms": s2["mr_kmax_ms"],
           "per_sigma": per, "summary_by_sigma": summ,
           "transition_bracket": bracket, "operating_sigma_mV": (op["sigma_mV"] if op else None), "operating_sigma_reason": reason,
           "operating_sigma_is_seed_dependent": bool(op is not None and op.get("classification") == "bistable"),
           "operating_sigma_classification": (op.get("classification") if op else None),
           "operating_sigma_kc_rate_hz": (op.get("kc_rate_hz_mean") if op else None),
           "operating_sigma_pop_rate_hz": (op.get("pop_rate_hz_mean") if op else None),
           "operating_sigma_under_the_previous_rule_mV": (old_rule_pick["sigma_mV"] if old_rule_pick else None), "operating_rule": s2["operating_rule"],
           "walltime_s": round(time.time() - t0, 1),
           "provenance": {"config": "configs/stage2_criticality.yaml", "results_dir": f"results/stage2_criticality/{tag}",
                          "files": [p.get("file") for p in per if p.get("file")]}}
    with open(OUT / "stage2.json", "w") as f:
        json.dump(out, f, indent=1, default=str)
    print(json.dumps({k: v for k, v in out.items() if k not in ("per_sigma", "provenance", "criteria")}, indent=1, default=str))


if __name__ == "__main__":
    main()
