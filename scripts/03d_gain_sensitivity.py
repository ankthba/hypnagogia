"""Stage 3d - GAIN SENSITIVITY (clearly-labelled deviation from the published parameters).

How far from the published model would you have to move for sparse Kenyon-cell odour coding to exist? A single
multiplier on every synaptic weight is swept; gain = 1.0 is the published model. The multiplier is an UNCITED
free parameter introduced by this project and is reported as such everywhere it appears.
"""
import json, time
import numpy as np, pandas as pd
from hypnagogia import RESULTS
from hypnagogia.config import load_config, dump_config
from hypnagogia.connectome import load_connectome
from hypnagogia.jobs import run_jobs
from hypnagogia.model import load_spikes, spikes_in_epoch

OUT = RESULTS / "stage3d_gain"


def main():
    cfg = load_config("stage3d_gain"); gs = cfg["gain_sensitivity"]
    OUT.mkdir(parents=True, exist_ok=True); dump_config(cfg, OUT / "config.resolved.yaml")
    conn = load_connectome("malecns", "v1.0", "brain")
    kc = conn.select(cell_class="Kenyon_Cell"); mbon = conn.select(cell_class="MBON")
    base_scale = cfg["dataset"]["weight_scale"]
    specs, meta = [], []
    for g in gs["gains"]:
        for sd in gs["seeds"]:
            specs.append({"out_dir": str(OUT / f"gain{g}_seed{sd}"), "seed": 1100 + sd, "config": cfg, "name": f"gain_{g}_{sd}",
                          "connectome": {"dataset": "malecns", "version": "v1.0", "scope": "brain", "weight_scale": base_scale * float(g)},
                          "drive_groups": {"odor": {"selector": {"cell_type": gs["glomerulus_set"]}}}, "record": "all",
                          "epochs": [{"name": "pre", "duration_s": 0.5},
                                     {"name": "odor", "duration_s": gs["odor_s"], "drives": {"odor": float(gs["rate_hz"])}},
                                     {"name": "post", "duration_s": gs["post_s"]}]})
            meta.append({"gain": float(g), "seed": sd})
    t0 = time.time()
    res = run_jobs(specs, n_parallel=cfg["run"]["n_parallel"])
    rows = []
    for sp, mm, r in zip(specs, meta, res):
        if r is None or "error" in r:
            rows.append({**mm, "error": (r or {}).get("error", "")[-250:]}); continue
        i, ts, m = load_spikes(sp["out_dir"])
        def stat(ep):
            ii, _, eps = spikes_in_epoch(i, ts, m, ep)
            dur = sum(e["duration_s"] for e in eps)
            k = ii[np.isin(ii, kc)]
            cnt = pd.Series(k).value_counts() if len(k) else pd.Series(dtype=int)
            return {"pop_rate_hz": float(len(ii) / dur / m["n_neurons"]), "frac_kc": float(len(cnt) / len(kc)),
                    "spikes_per_active_kc": float(cnt.mean()) if len(cnt) else 0.0,
                    "mbon_rate_hz": float(np.isin(ii, mbon).sum() / dur / len(mbon))}
        od, po = stat("odor"), stat("post")
        rows.append({**mm, "odor": od, "post": po,
                     "outlasts": bool(od["pop_rate_hz"] > 0 and po["pop_rate_hz"] > 0.01 * od["pop_rate_hz"])})
    ok = [r for r in rows if "error" not in r]
    grid = []
    for g in gs["gains"]:
        rr = [r for r in ok if r["gain"] == float(g)]
        if not rr:
            continue
        fr = float(np.mean([r["odor"]["frac_kc"] for r in rr]))
        pr = float(np.mean([r["odor"]["pop_rate_hz"] for r in rr])); po = float(np.mean([r["post"]["pop_rate_hz"] for r in rr]))
        sparse = bool(gs["target_frac_kc"][0] <= fr <= gs["target_frac_kc"][1])
        transient = bool(pr == 0 or po <= 0.01 * pr)
        grid.append({"gain": float(g), "w_syn_effective_mV": round(cfg["model"]["w_syn_mV"] * base_scale * float(g), 5),
                     "n_seeds": len(rr), "frac_kc_odor": fr, "n_kc_active": fr * len(kc),
                     "spikes_per_active_kc": float(np.mean([r["odor"]["spikes_per_active_kc"] for r in rr])),
                     "pop_rate_odor": pr, "pop_rate_post": po,
                     "mbon_rate_odor": float(np.mean([r["odor"]["mbon_rate_hz"] for r in rr])),
                     "sparse": sparse, "transient": transient, "usable": bool(sparse and transient)})
    usable = [g for g in grid if g["usable"]]
    chosen = max(usable, key=lambda g: g["gain"]) if usable else None
    out = {"status": "passed" if usable else "failed",
           "WARNING": ("The gain multiplier is an UNCITED free parameter introduced by this project. It has no source in "
                       "Shiu et al. 2024, in the connectome data, or in the mushroom-body plasticity literature. gain = 1.0 "
                       "is the published model and is the primary result everywhere else in this project. Any stage run at "
                       "gain < 1 is a labelled deviation and is reported as such."),
           "question": "How far from the published parameters would the model have to be for sparse Kenyon-cell odour coding to exist?",
           "target_frac_kc": gs["target_frac_kc"], "protocol": gs, "grid": grid, "per_run": rows,
           "chosen_gain": (chosen["gain"] if chosen else None),
           "finding": (f"Sparse odour coding appears only when every synaptic weight is scaled to {chosen['gain']:.2f} of its "
                       f"published value (effective W_syn {chosen['w_syn_effective_mV']} mV instead of "
                       f"{cfg['model']['w_syn_mV'] * base_scale:.4f} mV): {chosen['frac_kc_odor']:.1%} of Kenyon cells respond, "
                       f"{chosen['spikes_per_active_kc']:.1f} spikes each, and the activity stops when the odour stops."
                       if chosen else
                       "No gain in the scan produced sparse, transient Kenyon-cell coding."),
           "walltime_s": round(time.time() - t0, 1),
           "provenance": {"config": "configs/stage3d_gain.yaml", "results_dir": "results/stage3d_gain",
                          "files": [s["out_dir"] for s in specs][:40]}}
    json.dump(out, open(OUT / "stage3d.json", "w"), indent=1, default=str)
    print(out["finding"]); print()
    print(f"{'gain':>6s} {'W_syn eff':>10s} {'fracKC':>8s} {'sp/KC':>7s} {'rateOdor':>9s} {'ratePost':>9s} {'MBON':>8s}  sparse transient")
    for g in grid:
        print(f"{g['gain']:6.2f} {g['w_syn_effective_mV']:10.5f} {g['frac_kc_odor']:8.2%} {g['spikes_per_active_kc']:7.1f} "
              f"{g['pop_rate_odor']:9.4f} {g['pop_rate_post']:9.4f} {g['mbon_rate_odor']:8.2f}  {str(g['sparse']):6s} {g['transient']}")


if __name__ == "__main__":
    main()
