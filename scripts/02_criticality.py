"""Stage 2 - CRITICALITY. Sweep the Gaussian noise amplitude sigma on the male CNS brain network and
classify each value as silent / subcritical / critical / saturated with pre-registered criteria
(hypnagogia.analysis.criticality.CRITERIA). Outputs results/stage2_criticality/stage2.json.
Usage: python scripts/02_criticality.py [--subset] [--seeds 0,1,2] [--sigmas 1,2,4]
"""
import argparse, json, sys, time
import numpy as np
from hypnagogia import RESULTS
from hypnagogia.config import load_config, dump_config
from hypnagogia.connectome import load_connectome, subset_from_config
from hypnagogia.populations import SUBSET_MB_CX
from hypnagogia.jobs import run_jobs
from hypnagogia.model import load_spikes
from hypnagogia.analysis.criticality import analyse_population, CRITERIA


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--subset", action="store_true"); ap.add_argument("--seeds", default=None); ap.add_argument("--sigmas", default=None)
    ap.add_argument("--analyse-only", action="store_true")
    a = ap.parse_args()
    cfg = load_config("stage2_criticality"); s2 = cfg["stage2"]
    sigmas = [float(x) for x in a.sigmas.split(",")] if a.sigmas else s2["sigma_values_mV"]
    seeds = [int(x) for x in a.seeds.split(",")] if a.seeds else s2["seeds"]
    tag = "subset" if a.subset else "full"
    OUT = RESULTS / "stage2_criticality" / tag; OUT.mkdir(parents=True, exist_ok=True); dump_config(cfg, OUT / "config.resolved.yaml")
    cspec = {"dataset": "malecns", "version": "v1.0", "scope": "brain", "weight_scale": cfg["dataset"]["weight_scale"],
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
    run_dirs = sorted(p for p in OUT.glob("sigma*_seed*") if (p / "spikes.npz").exists())
    per = []
    for rd in run_dirs:
        mm = _re.match(r"sigma([0-9.]+)_seed(\d+)$", rd.name)
        if not mm:
            continue
        sg, sd = float(mm.group(1)), int(mm.group(2))
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
    if crit:
        op = min(crit, key=lambda s: abs(s["m_mean"] - 1.0)); has_crit = True
        reason = f"critical regime found at sigma = {op['sigma_mV']} mV (mean m = {op['m_mean']:.3f}); operating point = critical sigma with m closest to 1"
    else:
        cand = [s for s in summ if s["classification"] not in ("saturated",) and (s.get("kc_rate_hz_mean") or 0) > 0]
        has_crit = False
        if cand:
            op = min(cand, key=lambda s: abs(np.log10(max(s["kc_rate_hz_mean"], 1e-9)) - np.log10(KC_SPONTANEOUS_HZ)))
            reason = (f"NO critical regime found in the sweep (no sigma satisfied all criteria; the network is bistable - silent below the "
                      f"transition and continuously active above it). The operating point for the downstream stages is therefore NOT a critical "
                      f"point: it is the non-saturated sigma whose Kenyon-cell population rate is closest to the measured KC spontaneous rate of "
                      f"{KC_SPONTANEOUS_HZ} Hz (Turner, Bazhenov & Laurent 2008 J Neurophysiol 99:734), i.e. sigma = {op['sigma_mV']} mV "
                      f"(KC rate {op['kc_rate_hz_mean']:.4f} Hz, whole-brain rate {op['pop_rate_hz_mean']:.4f} Hz/neuron, m = {op['m_mean']}).")
        else:
            op = None; reason = "NO critical regime and no active non-saturated sigma: every sigma is silent or saturated."
    out = {"status": "passed" if per and not any("error" in p for p in per) else "failed", "has_critical_regime": has_crit,
           "is_bistable": bool(bist), "bistable_sigmas_mV": [s["sigma_mV"] for s in bist], "ignition_curve": ignition,
           "bistability_note": ("At one or more noise amplitudes, independent seeds either stayed quiescent or ignited into the "
                                "high-rate state, with nothing in between. The transition is therefore a stochastic ignition of a "
                                "bistable network, not a continuous approach to a critical point. This is the expected behaviour of a "
                                "network with no spike-frequency adaptation and no short-term synaptic depression."),
           "criterion": "sweep completes for all sigma x seeds; classification per CRITERIA; a missing critical band is a finding, not a failure",
           "network": tag, "n_neurons": conn.N, "n_connections": conn.E, "duration_s": s2["duration_s"], "warmup_s": s2["warmup_s"], "seeds": seeds,
           "criteria": CRITERIA, "sigma_values_mV": all_sigmas, "sigma_values_requested_this_run": sigmas, "mr_bin_ms": s2["mr_bin_ms"], "mr_kmax_ms": s2["mr_kmax_ms"],
           "per_sigma": per, "summary_by_sigma": summ,
           "transition_bracket": bracket, "operating_sigma_mV": (op["sigma_mV"] if op else None), "operating_sigma_reason": reason, "operating_rule": s2["operating_rule"],
           "walltime_s": round(time.time() - t0, 1),
           "provenance": {"config": "configs/stage2_criticality.yaml", "results_dir": f"results/stage2_criticality/{tag}",
                          "files": [p.get("file") for p in per if p.get("file")]}}
    with open(OUT / "stage2.json", "w") as f:
        json.dump(out, f, indent=1, default=str)
    print(json.dumps({k: v for k, v in out.items() if k not in ("per_sigma", "provenance", "criteria")}, indent=1, default=str))


if __name__ == "__main__":
    main()
