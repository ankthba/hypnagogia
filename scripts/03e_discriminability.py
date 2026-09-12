"""Stage 3e - ODOUR DISCRIMINABILITY. Stages 3b-3d showed that any olfactory stimulus pushes this network into
a self-sustaining state that never decays. That is only fatal for a memory experiment if the state is the SAME
whichever odour caused it. This script asks directly: do two different odours leave two different Kenyon-cell
ensembles behind, or one common attractor? Run at several synaptic gains, including the published one.

Overlap is compared against the chance overlap of two random ensembles of the same sizes, so a high raw overlap
between two ensembles that each contain most of the Kenyon cells is not mistaken for odour specificity.
Outputs results/stage3e_discrim/stage3e.json.
"""
import argparse, json, time
import numpy as np, pandas as pd
from hypnagogia import RESULTS
from hypnagogia.config import load_config, dump_config
from hypnagogia.connectome import load_connectome
from hypnagogia.jobs import run_jobs
from hypnagogia.model import load_spikes, spikes_in_epoch

OUT = RESULTS / "stage3e_discrim"
ODORS = {"A": ["ORN_DM1", "ORN_DM4", "ORN_VA2", "ORN_DM2"], "B": ["ORN_DL5", "ORN_DM3", "ORN_VM7d", "ORN_DC2"]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gains", default="1.0,0.8,0.6,0.5,0.4")
    ap.add_argument("--rate", type=float, default=150.0)
    ap.add_argument("--seeds", default="0,1,2")
    a = ap.parse_args()
    gains = [float(x) for x in a.gains.split(",")]; seeds = [int(x) for x in a.seeds.split(",")]
    cfg = load_config("stage3d_gain")
    OUT.mkdir(parents=True, exist_ok=True); dump_config(cfg, OUT / "config.resolved.yaml")
    conn = load_connectome("malecns", "v1.0", "brain")
    kc = conn.select(cell_class="Kenyon_Cell"); n_kc = len(kc)
    base = cfg["dataset"]["weight_scale"]
    specs, meta = [], []
    for g in gains:
        for od, types in ODORS.items():
            for sd in seeds:
                specs.append({"out_dir": str(OUT / f"gain{g}_{od}_seed{sd}"), "seed": 1300 + sd, "config": cfg,
                              "name": f"disc_{g}_{od}_{sd}",
                              "connectome": {"dataset": "malecns", "version": "v1.0", "scope": "brain", "weight_scale": base * g},
                              "drive_groups": {"odor": {"selector": {"cell_type": types}}}, "record": "all",
                              "epochs": [{"name": "pre", "duration_s": 0.5},
                                         {"name": "odor", "duration_s": 1.0, "drives": {"odor": a.rate}},
                                         {"name": "post", "duration_s": 2.0}]})
                meta.append({"gain": g, "odor": od, "seed": sd})
    t0 = time.time()
    res = run_jobs(specs, n_parallel=cfg["run"]["n_parallel"])
    ens = {}
    for sp, mm, r in zip(specs, meta, res):
        if r is None or "error" in r:
            print("FAILED", mm, (r or {}).get("error", "")[-200:]); continue
        i, ts, m = load_spikes(sp["out_dir"])
        for ep in ("odor", "post"):
            ii, _, _ = spikes_in_epoch(i, ts, m, ep)
            k = ii[np.isin(ii, kc)]
            ens[(mm["gain"], mm["odor"], mm["seed"], ep)] = np.unique(k)
    rng = np.random.default_rng(0)
    grid = []
    for g in gains:
        for ep in ("odor", "post"):
            js, jc, sa, sb = [], [], [], []
            for sd in seeds:
                A = ens.get((g, "A", sd, ep)); B = ens.get((g, "B", sd, ep))
                if A is None or B is None or len(A) == 0 or len(B) == 0:
                    continue
                inter = len(np.intersect1d(A, B)); union = len(np.union1d(A, B))
                js.append(inter / union)
                # chance overlap of two random ensembles of the same sizes drawn from the same population
                ch = [len(np.intersect1d(rng.choice(n_kc, len(A), replace=False), rng.choice(n_kc, len(B), replace=False))) /
                      len(np.union1d(rng.choice(n_kc, len(A), replace=False), rng.choice(n_kc, len(B), replace=False))) for _ in range(20)]
                jc.append(float(np.mean(ch))); sa.append(len(A) / n_kc); sb.append(len(B) / n_kc)
            if js:
                grid.append({"gain": g, "epoch": ep, "n_seeds": len(js),
                             "frac_kc_A": float(np.mean(sa)), "frac_kc_B": float(np.mean(sb)),
                             "jaccard_observed": float(np.mean(js)), "jaccard_chance": float(np.mean(jc)),
                             "excess_over_chance": float(np.mean(js) - np.mean(jc)),
                             "discriminable": bool(np.mean(js) < 0.9 and np.mean(sa) < 0.5)})
    disc = [g for g in grid if g["epoch"] == "post" and g["discriminable"]]
    out = {"status": "passed" if disc else "failed",
           "question": "Do two different odours leave two different Kenyon-cell ensembles, or the same attractor?",
           "criterion": "the two ensembles overlap less than 90% (Jaccard) and each covers less than half of all Kenyon cells",
           "note": ("Overlap is reported against the chance overlap of two random ensembles of the same sizes. When both "
                    "ensembles contain most of the Kenyon cells, a high raw overlap is arithmetic, not odour specificity."),
           "odors": ODORS, "rate_hz": a.rate, "gains": gains, "n_kc": int(n_kc), "grid": grid,
           "finding": (f"The two odours remain discriminable at gain(s) {sorted({g['gain'] for g in disc})} in the "
                       f"self-sustaining state after the stimulus." if disc else
                       "At every gain tested, the two odours leave Kenyon-cell ensembles that are effectively the same: "
                       "the network has one stimulus-independent attractor, so no odour-specific memory can be stored in it."),
           "walltime_s": round(time.time() - t0, 1),
           "provenance": {"config": "configs/stage3d_gain.yaml", "results_dir": "results/stage3e_discrim",
                          "files": [s["out_dir"] for s in specs][:40]}}
    json.dump(out, open(OUT / "stage3e.json", "w"), indent=1, default=str)
    print(out["finding"]); print()
    print(f"{'gain':>6s} {'epoch':>6s} {'fracKC A':>9s} {'fracKC B':>9s} {'Jaccard':>8s} {'chance':>8s} {'excess':>8s}  discriminable")
    for g in grid:
        print(f"{g['gain']:6.2f} {g['epoch']:>6s} {g['frac_kc_A']:9.2%} {g['frac_kc_B']:9.2%} {g['jaccard_observed']:8.3f} "
              f"{g['jaccard_chance']:8.3f} {g['excess_over_chance']:+8.3f}  {g['discriminable']}")


if __name__ == "__main__":
    main()
