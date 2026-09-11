"""Stage 0a - ENGINE CHECK: reproduce Shiu et al. 2024 on their own data (FlyWire v630).

Drives the paper's 21 right-labellar sugar GRNs with 150 Hz Poisson input for 1 s, 30 trials, and
compares MN9 firing, number of active neurons and total spikes against the output file shipped in
the paper's repository (results/example/sugarR.parquet: same protocol, same data). This isolates
our Brian2 standalone implementation from any data-version question.
"""
import json, sys, time
from pathlib import Path
import numpy as np, pandas as pd
from hypnagogia import RESULTS, ROOT
from hypnagogia.config import load_config, dump_config
from hypnagogia.connectome import load_connectome
from hypnagogia.jobs import run_jobs

SUGAR = [720575940624963786, 720575940630233916, 720575940637568838, 720575940638202345, 720575940617000768,
         720575940630797113, 720575940632889389, 720575940621754367, 720575940621502051, 720575940640649691,
         720575940639332736, 720575940616885538, 720575940639198653, 720575940620900446, 720575940617937543,
         720575940632425919, 720575940633143833, 720575940612670570, 720575940628853239, 720575940629176663,
         720575940611875570]
MN9_L = 720575940660219265
REF_DIR = Path("/private/tmp/claude-501/-Users-ankthba-Developer-fly/7e6576e9-242d-401d-b195-48c23468abaa/scratchpad/shiu/results/example")
# The repo's shipped outputs: sugarR.parquet was generated at the notebook's stated default of 200 Hz
# (its sugar GRNs fire at ~199 Hz), sugarR_100Hz.parquet at 100 Hz. model.py's current default is 150 Hz.
REFS = {200: REF_DIR / "sugarR.parquet", 100: REF_DIR / "sugarR_100Hz.parquet"}

def run_freq(freq: int, n_trials: int):
    REF = REFS[freq]
    out = RESULTS / "stage0_engine_check" / f"{freq}Hz"; out.mkdir(parents=True, exist_ok=True)
    cfg = load_config("base", overrides={"dataset": {"name": "flywire", "version": "630", "scope": "brain", "weight_scale": 1.0}})
    dump_config(cfg, out / "config.resolved.yaml")
    specs = [{"out_dir": str(out / f"v630_trial{k}"), "seed": 1000 + k, "config": cfg, "name": f"v630_sugar{freq}_t{k}",
              "connectome": {"dataset": "flywire", "version": "630", "scope": "brain", "weight_scale": 1.0},
              "drive_groups": {"sugar": {"ids": SUGAR}}, "record": "all",
              "epochs": [{"name": "stim", "duration_s": 1.0, "drives": {"sugar": float(freq)}}]} for k in range(n_trials)]
    t0 = time.time()
    res = run_jobs(specs, n_parallel=cfg["run"]["n_parallel"])
    errs = [r for r in res if r and "error" in r]
    if errs:
        print("ERRORS:", errs[:2]); sys.exit(1)
    conn = load_connectome("flywire", "630")
    mn9 = conn.index_of([MN9_L])[0]
    ours = []
    for k in range(n_trials):
        z = np.load(out / f"v630_trial{k}" / "spikes.npz"); i = z["i"]
        ours.append({"trial": k, "mn9_spikes": int((i == mn9).sum()), "n_active": int(len(np.unique(i))), "n_spikes": int(len(i))})
    ours = pd.DataFrame(ours)
    # reference (shipped output of the paper's own code on the same data)
    ref = pd.read_parquet(REF)
    ref_tr = ref.groupby("trial").agg(n_spikes=("t", "size"), n_active=("flywire_id", "nunique"))
    ref_mn9 = ref[ref.flywire_id == MN9_L].groupby("trial").size().reindex(range(30), fill_value=0)
    # per-neuron mean rate comparison over the union of active neurons
    ref_rate = ref.groupby("flywire_id").size() / 30.0
    all_i = np.concatenate([np.load(out / f"v630_trial{k}" / "spikes.npz")["i"] for k in range(n_trials)])
    our_rate = pd.Series(np.bincount(all_i, minlength=conn.N) / n_trials, index=conn.ids)
    our_rate = our_rate[our_rate > 0]
    both = pd.concat([ref_rate.rename("ref"), our_rate.rename("ours")], axis=1).fillna(0)
    r = np.corrcoef(both["ref"], both["ours"])[0, 1]
    summary = {
        "status": None, "n_trials": n_trials, "sugar_rate_hz": freq,
        "criterion": "MN9 mean rate within the shipped 30-trial range +/- 10%, per-trial active-neuron count and spike count within 15% of the shipped means, per-neuron rate correlation r > 0.95 over the union of active neurons",
        "ours": {"mn9_rate_hz_mean": float(ours.mn9_spikes.mean()), "mn9_rate_hz_sd": float(ours.mn9_spikes.std(ddof=1)),
                 "mn9_per_trial": ours.mn9_spikes.tolist(), "n_active_per_trial_mean": float(ours.n_active.mean()),
                 "n_active_union": int(len(np.unique(all_i))), "n_spikes_per_trial_mean": float(ours.n_spikes.mean())},
        "reference": {"source": f"philshiu/Drosophila_brain_model results/example/{REF.name} (v630, 21 sugar GRNs, {freq} Hz, 30 x 1 s)",
                      "mn9_rate_hz_mean": float(ref_mn9.mean()), "mn9_rate_hz_sd": float(ref_mn9.std(ddof=1)), "mn9_per_trial": ref_mn9.tolist(),
                      "n_active_per_trial_mean": float(ref_tr.n_active.mean()), "n_active_union": int(ref.flywire_id.nunique()),
                      "n_spikes_per_trial_mean": float(ref_tr.n_spikes.mean())},
        "per_neuron_rate_correlation": float(r), "n_neurons_compared": int(len(both)),
        "top_neurons": [{"root_id": str(rid), "ref_hz": float(row.ref), "ours_hz": float(row.ours)} for rid, row in both.sort_values("ref", ascending=False).head(25).iterrows()],
        "walltime_s": round(time.time() - t0, 1),
    }
    o, f = summary["ours"], summary["reference"]
    checks = {
        "mn9_within_range": (min(f["mn9_per_trial"]) * 0.9 <= o["mn9_rate_hz_mean"] <= max(f["mn9_per_trial"]) * 1.1),
        "active_within_15pct": abs(o["n_active_per_trial_mean"] - f["n_active_per_trial_mean"]) / f["n_active_per_trial_mean"] < 0.15,
        "spikes_within_15pct": abs(o["n_spikes_per_trial_mean"] - f["n_spikes_per_trial_mean"]) / f["n_spikes_per_trial_mean"] < 0.15,
        "rate_corr_gt_0.95": r > 0.95,
    }
    checks = {k: bool(v) for k, v in checks.items()}
    summary["checks"] = checks
    summary["status"] = "passed" if all(checks.values()) else "failed"
    with open(out / "engine_check.json", "w") as fh:
        json.dump(summary, fh, indent=1)
    print(json.dumps({k: v for k, v in summary.items() if k not in ("top_neurons",)}, indent=1))
    return summary


def main():
    n_trials = int(sys.argv[1]) if len(sys.argv) > 1 else 30
    res = {f: run_freq(f, n_trials) for f in (200, 100)}
    status = "passed" if all(r["status"] == "passed" for r in res.values()) else "failed"
    with open(RESULTS / "stage0_engine_check" / "engine_check.json", "w") as fh:
        json.dump({"status": status, "runs": res}, fh, indent=1)
    print("ENGINE CHECK:", status)

if __name__ == "__main__":
    main()
