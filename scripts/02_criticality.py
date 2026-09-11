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
    per = []
    for sp in specs:
        try:
            i, ts, meta = load_spikes(sp["out_dir"])
        except Exception as e:
            per.append({"sigma_mV": sp["config"]["noise"]["sigma_mV"], "seed": sp["seed"], "error": str(e)}); continue
        sg, sd = sp["config"]["noise"]["sigma_mV"], sp["seed"]
        r = analyse_population(ts, conn.N, meta["dt_ms"] * 1e-3, s2["warmup_s"], T, mr_bin_s=s2["mr_bin_ms"] * 1e-3,
                               mr_kmax_s=s2["mr_kmax_ms"] * 1e-3, aval_bin_mult=s2["avalanche_bin_mult"], seed=sd, i=i)
        # robustness: avalanche bin x0.5 and x2 (classification only reported, not used for the operating point)
        rob = {}
        for mult in (0.5, 2.0):
            rr = analyse_population(ts, conn.N, meta["dt_ms"] * 1e-3, s2["warmup_s"], T, mr_bin_s=s2["mr_bin_ms"] * 1e-3,
                                    mr_kmax_s=s2["mr_kmax_ms"] * 1e-3, aval_bin_mult=mult, seed=sd, i=i)
            rob[str(mult)] = {"classification": rr["classification"], "n_avalanches": rr["avalanches"]["n"], "alpha": rr["size_fit"]["alpha"],
                              "R_vs_exponential": rr["size_fit"]["R_vs_exponential"], "R_vs_lognormal": rr["size_fit"]["R_vs_lognormal"]}
        per.append({"sigma_mV": sg, "seed": sd, "file": f"results/stage2_criticality/{tag}/sigma{sg}_seed{sd}/spikes.npz", **r, "robustness_bin_mult": rob,
                    "walltime_s": meta.get("walltime_total_s")})
        print(f"sigma={sg} seed={sd}: rate={r['pop_rate_hz']:.3f} Hz/neuron active={r['frac_active']:.3f} m={r['branching_ratio_mr']['m']} "
              f"n_aval={r['avalanches']['n']} alpha={r['size_fit']['alpha']} -> {r['classification']}", flush=True)
    # summary by sigma
    summ = []
    for sg in sigmas:
        rows = [p for p in per if p["sigma_mV"] == sg and "error" not in p]
        if not rows:
            summ.append({"sigma_mV": sg, "n_seeds": 0, "classification": "not_run"}); continue
        ms = [p["branching_ratio_mr"]["m"] for p in rows if p["branching_ratio_mr"]["m"] is not None]
        labels = [p["classification"] for p in rows]
        maj = max(set(labels), key=labels.count)
        summ.append({"sigma_mV": sg, "n_seeds": len(rows), "pop_rate_hz_mean": float(np.mean([p["pop_rate_hz"] for p in rows])),
                     "pop_rate_hz_sd": float(np.std([p["pop_rate_hz"] for p in rows], ddof=1)) if len(rows) > 1 else 0.0,
                     "frac_active_mean": float(np.mean([p["frac_active"] for p in rows])),
                     "m_mean": float(np.mean(ms)) if ms else None, "m_sd": float(np.std(ms, ddof=1)) if len(ms) > 1 else 0.0,
                     "classification": maj, "labels": labels})
    crit = [s for s in summ if s["classification"] == "critical" and s["m_mean"] is not None]
    if crit:
        op = min(crit, key=lambda s: abs(s["m_mean"] - 1.0)); has_crit = True
        reason = f"critical regime found at sigma = {op['sigma_mV']} mV (mean m = {op['m_mean']:.3f}); operating point = critical sigma with m closest to 1"
    else:
        cand = [s for s in summ if s["classification"] in ("subcritical",) and s["m_mean"] is not None and s["m_mean"] < 1.0]
        has_crit = False
        if cand:
            op = min(cand, key=lambda s: 1.0 - s["m_mean"])
            reason = (f"NO critical regime found in the sweep (no sigma satisfied all criteria). Operating point = the non-saturated sigma with m closest to 1 "
                      f"from below: sigma = {op['sigma_mV']} mV (mean m = {op['m_mean']:.3f}). Downstream stages use it as a background state, not as a critical state.")
        else:
            op = None; reason = "NO critical regime and no active non-saturated sigma: every sigma is silent or saturated."
    out = {"status": "passed" if per and not any("error" in p for p in per) else "failed", "has_critical_regime": has_crit,
           "criterion": "sweep completes for all sigma x seeds; classification per CRITERIA; a missing critical band is a finding, not a failure",
           "network": tag, "n_neurons": conn.N, "n_connections": conn.E, "duration_s": s2["duration_s"], "warmup_s": s2["warmup_s"], "seeds": seeds,
           "criteria": CRITERIA, "sigma_values_mV": sigmas, "mr_bin_ms": s2["mr_bin_ms"], "mr_kmax_ms": s2["mr_kmax_ms"],
           "per_sigma": per, "summary_by_sigma": summ,
           "operating_sigma_mV": (op["sigma_mV"] if op else None), "operating_sigma_reason": reason, "operating_rule": s2["operating_rule"],
           "walltime_s": round(time.time() - t0, 1),
           "provenance": {"config": "configs/stage2_criticality.yaml", "results_dir": f"results/stage2_criticality/{tag}",
                          "files": [p.get("file") for p in per if p.get("file")]}}
    with open(OUT / "stage2.json", "w") as f:
        json.dump(out, f, indent=1, default=str)
    print(json.dumps({k: v for k, v in out.items() if k not in ("per_sigma", "provenance", "criteria")}, indent=1, default=str))


if __name__ == "__main__":
    main()
