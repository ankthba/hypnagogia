"""Stage 1 - NOISE. Verify the two background-drive implementations on the male CNS brain network.

Gaussian: dv/dt = (v_rest - v + g)/tau_m + sigma*sqrt(2/tau_m)*xi (Euler-Maruyama). With synapses off the
stationary s.d. of v must equal sigma (Ornstein-Uhlenbeck). Poisson: independent Poisson input streams
onto g (weight W_syn). Outputs results/stage1_noise/stage1.json (viewer: stage1_noise.json).
"""
import json, sys, time
import numpy as np
from hypnagogia import RESULTS
from hypnagogia.config import load_config, dump_config
from hypnagogia.connectome import load_connectome
from hypnagogia.jobs import run_jobs
from hypnagogia.model import load_spikes

OUT = RESULTS / "stage1_noise"


def main():
    cfg = load_config("stage1_noise"); s1 = cfg["stage1"]
    OUT.mkdir(parents=True, exist_ok=True); dump_config(cfg, OUT / "config.resolved.yaml")
    conn = load_connectome("malecns", "v1.0", "brain")
    rng = np.random.default_rng(0)
    rec_v = sorted(int(x) for x in rng.choice(conn.N, s1["n_record_v"], replace=False))
    ws = 0.0 if s1["isolated"] else cfg["dataset"]["weight_scale"]
    specs = []
    for sg in s1["gaussian_sigmas_mV"]:
        c = json.loads(json.dumps(cfg)); c["noise"] = {"mode": "gaussian", "sigma_mV": float(sg), "poisson": cfg["noise"]["poisson"]}
        specs.append({"out_dir": str(OUT / f"gauss_{sg}mV"), "seed": 10, "config": c, "name": f"gauss{sg}",
                      "connectome": {"dataset": "malecns", "version": "v1.0", "scope": "brain", "weight_scale": ws},
                      "drive_groups": {}, "record": "all", "record_v": {"index": rec_v}, "record_v_dt_s": 0.001,
                      "epochs": [{"name": "noise", "duration_s": s1["duration_s"]}]})
    for r in s1["poisson_rates_hz"]:
        c = json.loads(json.dumps(cfg)); c["noise"] = {"mode": "poisson", "sigma_mV": 0.0, "poisson": {"rate_hz": float(r), "n_inputs": 1, "weight_mV": cfg["model"]["w_syn_mV"]}}
        specs.append({"out_dir": str(OUT / f"poisson_{r}Hz"), "seed": 10, "config": c, "name": f"poisson{r}",
                      "connectome": {"dataset": "malecns", "version": "v1.0", "scope": "brain", "weight_scale": ws},
                      "drive_groups": {}, "record": "all", "record_v": {"index": rec_v}, "record_v_dt_s": 0.001,
                      "epochs": [{"name": "noise", "duration_s": s1["duration_s"]}]})
    t0 = time.time()
    res = run_jobs(specs, n_parallel=cfg["run"]["n_parallel"])
    runs, ok = [], True
    for sp, r in zip(specs, res):
        if r is None or "error" in r:
            runs.append({"name": sp["name"], "error": (r or {}).get("error", "no result")}); ok = False; continue
        i, ts, meta = load_spikes(sp["out_dir"]); vz = np.load(sp["out_dir"] + "/voltage.npz")
        v = vz["v_mV"]; t_ = vz["t_s"]; v = v[:, t_ > 0.5]   # discard OU transient (25 tau_m)
        noise = sp["config"]["noise"]
        runs.append({"noise_model": noise["mode"], "sigma_mV": noise["sigma_mV"] if noise["mode"] == "gaussian" else None,
                     "rate_hz": noise["poisson"]["rate_hz"] if noise["mode"] == "poisson" else None, "seed": sp["seed"],
                     "pop_rate_hz": float(len(i) / meta["duration_s"] / conn.N), "frac_active": float(len(np.unique(i)) / conn.N),
                     "mean_v_mV": float(v.mean()), "mean_v_std_mV": float(np.mean(v.std(axis=1))), "n_neurons_recorded_v": int(v.shape[0]),
                     "walltime_s": r.get("walltime_s")})
    checks = []
    for r in runs:
        if r.get("noise_model") == "gaussian" and r["sigma_mV"] <= 2.0:
            checks.append(abs(r["mean_v_std_mV"] - r["sigma_mV"]) / r["sigma_mV"] < 0.05)
    status = "passed" if ok and checks and all(checks) else "failed"
    out = {"status": status, "criterion": s1["criterion"], "isolated": s1["isolated"], "n_neurons": conn.N,
           "noise_models": [{"name": "gaussian", "equation": "dv/dt = (v_rest - v + g)/tau_m + sigma*sqrt(2/tau_m)*xi", "param": "sigma_mV"},
                            {"name": "poisson", "equation": "dv/dt = (v_rest - v + g)/tau_m; g += w_bg on each event of an independent Poisson stream at rate_hz", "param": "rate_hz"}],
           "runs": runs, "walltime_s": round(time.time() - t0, 1),
           "provenance": {"config": "configs/stage1_noise.yaml", "results_dir": "results/stage1_noise", "files": [f"results/stage1_noise/{s['name']}/spikes.npz" for s in specs]}}
    with open(OUT / "stage1.json", "w") as f:
        json.dump(out, f, indent=1)
    print(json.dumps({k: v for k, v in out.items() if k != "runs"}, indent=1))
    for r in runs: print(r)


if __name__ == "__main__":
    main()
