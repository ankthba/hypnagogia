"""Stage 5 - SLEEP. Noise-driven offline period with NO odour input, in two conditions: dFB sleep-promoting
neurons clamped active ("sleep") and dFB off ("wake"). Starts from the per-seed learned KC->MBON weights of
stage 4, with plasticity frozen. Outputs results/stage5_sleep/stage5.json and the spike trains stage 6 reads.
"""
import argparse, json, time
from pathlib import Path
import numpy as np
from hypnagogia import RESULTS
from hypnagogia.config import load_config, dump_config
from hypnagogia.connectome import load_connectome
from hypnagogia.populations import POPULATIONS
from hypnagogia.jobs import run_jobs
from hypnagogia.model import load_spikes

OUT = RESULTS / "stage5_sleep"


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--seeds", default=None); ap.add_argument("--shuffled", action="store_true")
    ap.add_argument("--rates", default=None, help="comma-separated dFB clamp rates (default: the configured rate)")
    ap.add_argument("--analyse-only", action="store_true"); ap.add_argument("--gain", type=float, default=1.0)
    a = ap.parse_args()
    cfg = load_config("stage5_sleep"); s5 = cfg["stage5"]; s4 = cfg["stage4"]
    seeds = [int(x) for x in a.seeds.split(",")] if a.seeds else s5["seeds"]
    rates = [float(x) for x in a.rates.split(",")] if a.rates else [s5["dfb_clamp_rate_hz"]]
    tag = ("shuffled" if a.shuffled else "real") + ("" if a.gain == 1.0 else f"_gain{a.gain}")
    out = OUT / tag; out.mkdir(parents=True, exist_ok=True); dump_config(cfg, out / "config.resolved.yaml")
    s4dir = RESULTS / "stage4_learning" / tag
    if not (s4dir / "stage4.json").exists():
        raise SystemExit(f"no stage-4 result at {s4dir}: run scripts/04_encode.py with the same --gain first")
    s4j = json.load(open(s4dir / "stage4.json"))
    sigma = s4j["protocol"]["sigma_mV"]; eta = s4j["protocol"]["eta_ltd"]
    conn = load_connectome("malecns", "v1.0", "brain")
    dfb = conn.select(**POPULATIONS[s5["dfb_population"]]["selector"])
    kc, mbon = conn.select(cell_class="Kenyon_Cell"), conn.select(cell_class="MBON")
    c = json.loads(json.dumps(cfg)); c["noise"] = {"mode": "gaussian" if sigma > 0 else "none", "sigma_mV": sigma, "poisson": cfg["noise"]["poisson"]}
    pl = cfg["plasticity"]; p = {k: v for k, v in pl.items() if k not in ("pre", "post", "dan")}
    p["eta_ltd"] = eta; p["pre"], p["post"], p["dan"] = pl["pre"], pl["post"], pl["dan"]
    specs = []
    for sd in seeds:
        wfile = str(s4dir / f"seed{sd}" / "plastic_w.npz")
        if not Path(wfile).exists():
            print(f"seed {sd}: no stage-4 weights ({wfile}); skipped"); continue
        cspec = {"dataset": "malecns", "version": "v1.0", "scope": "brain", "weight_scale": cfg["dataset"]["weight_scale"] * a.gain}
        if a.shuffled:
            cspec["shuffle"] = {"seed": sd, "strata": "cell_class", "swaps_per_edge": 10}
        for cond in s5["conditions"]:
            for rate in (rates if cond == "sleep" else [0.0]):
                sub = f"{cond}_seed{sd}" + (f"_rate{rate}" if cond == "sleep" and rate != s5["dfb_clamp_rate_hz"] else "")
                specs.append({"out_dir": str(out / sub), "seed": 500 + sd, "config": c, "name": f"sleep_{tag}_{cond}_{sd}_{rate}",
                              "connectome": cspec, "init_plastic_w": wfile,
                              "drive_groups": {"dfb": {"selector": POPULATIONS[s5["dfb_population"]]["selector"]}},
                              "record": "all",   # whole brain: needed for the viewer's activity map and for population statistics
                              "plasticity": p,
                              "epochs": [{"name": "warmup", "duration_s": s5["warmup_s"], "drives": ({"dfb": rate} if cond == "sleep" else {})},
                                         {"name": cond, "duration_s": s5["duration_s"], "drives": ({"dfb": rate} if cond == "sleep" else {}),
                                          "plastic": s5["plastic_during_sleep"]}]})
    t0 = time.time()
    if not a.analyse_only:
        res = run_jobs(specs, n_parallel=cfg["run"]["n_parallel"])
        errs = [(s["name"], (r or {}).get("error", "")[-400:]) for s, r in zip(specs, res) if r is None or "error" in r]
        if errs: print("ERRORS:", errs[:3])
    rows = []
    for sp in specs:
        try:
            i, ts, meta = load_spikes(sp["out_dir"])
        except Exception as e:
            rows.append({"name": sp["name"], "error": str(e)}); continue
        ep = [e for e in meta["epochs"] if e["name"] in ("sleep", "wake")][0]
        dur = ep["duration_s"]; t = ts * meta["dt_ms"] * 1e-3
        m = (t >= ep["t_start_s"]) & (t < ep["t_end_s"]); ii = i[m]
        rows.append({"seed": int(sp["name"].split("_")[-2]), "condition": ep["name"], "dfb_rate_clamp_hz": float(sp["name"].split("_")[-1]),
                     "pop_rate_hz": float(len(ii) / dur / meta["n_neurons"]), "n_spikes": int(len(ii)),
                     "kc_rate_hz": float(np.isin(ii, kc).sum() / dur / len(kc)), "n_kc_active": int(len(np.unique(ii[np.isin(ii, kc)]))),
                     "mbon_rate_hz": float(np.isin(ii, mbon).sum() / dur / len(mbon)),
                     "dfb_rate_hz": float(np.isin(ii, dfb).sum() / dur / max(len(dfb), 1)),
                     "frac_kc_active": float(len(np.unique(ii[np.isin(ii, kc)])) / len(kc)), "file": sp["out_dir"] + "/spikes.npz"})
    ok = [r for r in rows if "error" not in r]
    summary = []
    for cond in s5["conditions"]:
        g = [r for r in ok if r["condition"] == cond and (cond == "wake" or r["dfb_rate_clamp_hz"] == s5["dfb_clamp_rate_hz"])]
        if g:
            summary.append({"condition": cond, "n_seeds": len(g), **{f"{k}_mean": float(np.mean([r[k] for r in g])) for k in ("pop_rate_hz", "kc_rate_hz", "mbon_rate_hz", "dfb_rate_hz", "frac_kc_active")},
                            **{f"{k}_sd": float(np.std([r[k] for r in g], ddof=1)) if len(g) > 1 else 0.0 for k in ("pop_rate_hz", "kc_rate_hz")}})
    sl = next((s for s in summary if s["condition"] == "sleep"), None); wk = next((s for s in summary if s["condition"] == "wake"), None)
    checks = {"all_runs_completed": len(ok) == len(specs),
              "dfb_active_in_sleep": bool(sl and sl["dfb_rate_hz_mean"] > 1.0),
              "dfb_silent_in_wake": bool(wk and wk["dfb_rate_hz_mean"] < 0.5),
              "kc_activity_present": bool((sl and sl["kc_rate_hz_mean"] > 0) or (wk and wk["kc_rate_hz_mean"] > 0))}
    out_d = {"status": "passed" if all(checks.values()) else "failed", "criterion": s5["criterion"], "checks": checks, "network": tag,
             "dfb": {"population": s5["dfb_population"], "cell_types": sorted(set(conn.ann.cell_type.iloc[dfb].dropna().tolist())),
                     "n_neurons": int(len(dfb)), "selection_source": POPULATIONS[s5["dfb_population"]]["source"],
                     "clamp_rate_hz": s5["dfb_clamp_rate_hz"],
                     "rate_source": "no dFB firing rate exists in the literature (Donlea 2014 / Pimentel 2016 report a binary ON/OFF switch); 17 Hz is taken from the UP state of the connected helicon cells ExR1, 16.9 +/- 3.6 Hz (Donlea et al. 2018 Neuron 97:378) - an approximation, not a dFB measurement",
                     "nt_in_model": {str(k): int(v) for k, v in conn.ann.nt.iloc[dfb].value_counts().items()}},
             "conditions": {"sleep": {"description": f"dFB clamped active at {s5['dfb_clamp_rate_hz']} Hz Poisson drive, background noise on, no odour input"},
                            "wake": {"description": "dFB off, background noise on, no odour input (identical in every other respect)"}},
             "sigma_mV": sigma, "plastic_during_sleep": s5["plastic_during_sleep"], "duration_s": s5["duration_s"],
             "seeds": seeds, "per_seed": rows, "summary": summary, "walltime_s": round(time.time() - t0, 1),
             "provenance": {"config": "configs/stage5_sleep.yaml", "results_dir": f"results/stage5_sleep/{tag}",
                            "files": [s["out_dir"] + "/spikes.npz" for s in specs]}}
    json.dump(out_d, open(out / "stage5.json", "w"), indent=1, default=str)
    if tag == "real":
        json.dump(out_d, open(OUT / "stage5.json", "w"), indent=1, default=str)
    print(json.dumps({k: v for k, v in out_d.items() if k in ("status", "checks", "summary", "walltime_s")}, indent=1, default=str))


if __name__ == "__main__":
    main()
