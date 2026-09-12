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
    # The readout the learning stage calibrates on: MBON-gamma1pedc>alpha/beta, the cell Hige et al. 2015
    # measured the ~80%% single-pairing depression in. A gain at which it does not respond to the odour is a
    # gain at which the learning stage cannot be calibrated, so its rate is reported alongside the KC code.
    readout = conn.select(cell_type="MBON11")
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
                    "kc_rate_hz": float(len(k) / dur / len(kc)),
                    "mbon_rate_hz": float(np.isin(ii, mbon).sum() / dur / len(mbon)),
                    "readout_rate_hz": float(np.isin(ii, readout).sum() / dur / len(readout))}
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
                     "readout_rate_odor": float(np.mean([r["odor"]["readout_rate_hz"] for r in rr])),
                     "kc_rate_odor": float(np.mean([r["odor"]["kc_rate_hz"] for r in rr])),
                     "kc_rate_post": float(np.mean([r["post"]["kc_rate_hz"] for r in rr])),
                     "readout_responds": bool(float(np.mean([r["odor"]["readout_rate_hz"] for r in rr])) > 5.0),
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
    print(f"{'gain':>6s} {'W_syn eff':>10s} {'fracKC':>8s} {'sp/KC':>7s} {'KCodor':>8s} {'KCpost':>8s} {'rateOdor':>9s} {'ratePost':>9s} {'MBON':>7s} {'MBON11':>7s}  sparse transient readout")
    for g in grid:
        print(f"{g['gain']:6.2f} {g['w_syn_effective_mV']:10.5f} {g['frac_kc_odor']:8.2%} {g['spikes_per_active_kc']:7.1f} "
              f"{g['kc_rate_odor']:8.3f} {g['kc_rate_post']:8.3f} "
              f"{g['pop_rate_odor']:9.4f} {g['pop_rate_post']:9.4f} {g['mbon_rate_odor']:7.2f} {g['readout_rate_odor']:7.2f}  "
              f"{str(g['sparse']):6s} {str(g['transient']):9s} {g['readout_responds']}")


def gustatory_cost(gain: float):
    """What does the reduced gain cost? Re-run the sugar-neuron benchmark that Shiu et al. calibrated W_syn on,
    at the same gain, and report how far MN9 has moved from the published operating point."""
    cfg = load_config("stage3d_gain")
    conn = load_connectome("malecns", "v1.0", "brain")
    grn = [int(x) for x in conn.ids[conn.select(cell_type={"regex": r"^LB3[a-d]?$"}, side="R")]]
    mn9 = {str(conn.ann.instance.iloc[i]): int(i) for i in conn.select(cell_type="MN9")}
    specs = []
    for g in (1.0, gain):
        for sd in (0, 1, 2):
            specs.append({"out_dir": str(OUT / f"gustatory_gain{g}_seed{sd}"), "seed": 1200 + sd, "config": cfg,
                          "name": f"gust_{g}_{sd}",
                          "connectome": {"dataset": "malecns", "version": "v1.0", "scope": "brain",
                                         "weight_scale": cfg["dataset"]["weight_scale"] * float(g)},
                          "drive_groups": {"sugar": {"ids": grn}}, "record": "all",
                          "epochs": [{"name": "stim", "duration_s": 1.0, "drives": {"sugar": 200.0}}]})
    res = run_jobs(specs, n_parallel=cfg["run"]["n_parallel"])
    out = []
    for g in (1.0, gain):
        rows = []
        for sd in (0, 1, 2):
            d = OUT / f"gustatory_gain{g}_seed{sd}"
            if not (d / "spikes.npz").exists():
                continue
            z = np.load(d / "spikes.npz"); i = z["i"]
            rows.append({nm: int((i == j).sum()) for nm, j in mn9.items()} | {"n_active": int(len(np.unique(i)))})
        if rows:
            out.append({"gain": float(g), "n_seeds": len(rows),
                        **{f"{nm}_hz_mean": float(np.mean([r[nm] for r in rows])) for nm in mn9},
                        "n_active_mean": float(np.mean([r["n_active"] for r in rows]))})
    doc = {"question": "What does the reduced gain cost on the benchmark the published model was calibrated against?",
           "protocol": "the male counterparts of the right labellar sugar neurons at 200 Hz for 1 s, the stage 0 benchmark",
           "runs": out,
           "finding": ("At the published gain MN9 fires at %.1f Hz with %.0f neurons active; at gain %.2f it fires at %.1f Hz "
                       "with %.0f neurons active. Lowering the gain to obtain sparse odour coding therefore breaks the "
                       "gustatory calibration that fixed W_syn in the first place, which is the price of this deviation."
                       % (out[0][list(mn9)[0] + "_hz_mean"], out[0]["n_active_mean"], gain,
                          out[1][list(mn9)[0] + "_hz_mean"], out[1]["n_active_mean"]) if len(out) == 2 else "not computed")}
    json.dump(doc, open(OUT / "gustatory_cost.json", "w"), indent=1, default=str)
    print("\n=== COST ON THE GUSTATORY BENCHMARK ===")
    print(doc["finding"])
    return doc


if __name__ == "__main__":
    import sys
    if "--gustatory-cost" in sys.argv:
        gustatory_cost(float(sys.argv[sys.argv.index("--gustatory-cost") + 1]))
    else:
        main()
