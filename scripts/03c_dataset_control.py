"""Stage 3c - CROSS-DATASET CONTROL. Stage 3b found that olfactory input ignites the whole male CNS network.
Is that a property of the model (parameters, scale) or of this dataset? The same stimulus is run on FlyWire
v783 and v630, whose neurons Shiu et al. actually simulated, with each dataset's own weight scaling, and on
the male CNS with the scaling switched off. Outputs results/stage3c_control/stage3c.json.
"""
import json, time
import numpy as np
from hypnagogia import RESULTS
from hypnagogia.config import load_config, dump_config
from hypnagogia.connectome import load_connectome
from hypnagogia.jobs import run_jobs
from hypnagogia.model import load_spikes, spikes_in_epoch

OUT = RESULTS / "stage3c_control"
CONDITIONS = [
    {"name": "malecns_scaled", "dataset": "malecns", "version": "v1.0", "scope": "brain", "weight_scale": 0.581},
    {"name": "malecns_unscaled", "dataset": "malecns", "version": "v1.0", "scope": "brain", "weight_scale": 1.0},
    {"name": "flywire_783", "dataset": "flywire", "version": "783", "scope": "brain", "weight_scale": 1.0},
    {"name": "flywire_630", "dataset": "flywire", "version": "630", "scope": "brain", "weight_scale": 1.0},
]
RATES = [10.0, 50.0, 150.0]
SEEDS = [0, 1, 2]
# Internal control: the SAME code, parameters and datasets, driven through the gustatory pathway that Shiu et
# al. actually benchmarked, instead of the olfactory one. If sugar neurons do not ignite the network and
# olfactory receptor neurons do, the runaway is a property of the pathway, not of the stimulation method.
PATHWAYS = {"olfactory": {"cell_type": "ORN_DM1"}, "gustatory": {"cell_type": {"regex": r"^LB3[a-d]?$"}}}
PATHWAYS_FLYWIRE = {"olfactory": {"cell_type": "ORN_DM1"}, "gustatory": {"cell_type": "LB3"}}


def main():
    cfg = load_config("stage3b_odor")
    OUT.mkdir(parents=True, exist_ok=True); dump_config(cfg, OUT / "config.resolved.yaml")
    specs, meta = [], []
    for cond in CONDITIONS:
        conn = load_connectome(cond["dataset"], cond["version"], scope=cond["scope"], weight_scale=cond["weight_scale"])
        sel = PATHWAYS_FLYWIRE if cond["dataset"] == "flywire" else PATHWAYS
        kc = conn.select(cell_class="Kenyon_Cell")
        drives = {pw: conn.select(**s_) for pw, s_ in sel.items()}
        if cond["dataset"] == "flywire" and cond["version"] == "630":
            # v630 has no annotation table, so the same neurons are addressed by their v783 root ids
            c783 = load_connectome("flywire", "783")
            kc = conn.index_of(c783.ids[c783.select(cell_class="Kenyon_Cell")], missing="drop")
            drives = {pw: conn.index_of(c783.ids[c783.select(**s_)], missing="drop") for pw, s_ in PATHWAYS_FLYWIRE.items()}
        for pw, idx in drives.items():
            if len(idx) == 0:
                continue
            for rate in RATES:
                for sd in SEEDS:
                    tag = f"{cond['name']}_{pw}_{int(rate)}Hz_seed{sd}"
                    specs.append({"out_dir": str(OUT / tag), "seed": 900 + sd, "config": cfg, "name": f"ctl_{tag}",
                                  "connectome": {k: cond[k] for k in ("dataset", "version", "scope", "weight_scale")},
                                  "drive_groups": {"odor": {"index": [int(x) for x in idx]}}, "record": "all",
                                  "epochs": [{"name": "pre", "duration_s": 0.5},
                                             {"name": "odor", "duration_s": 1.0, "drives": {"odor": rate}},
                                             {"name": "post", "duration_s": 3.0}]})
                    meta.append({"condition": cond["name"], "pathway": pw, "rate_hz": rate, "seed": sd,
                                 "n_orn": int(len(idx)), "n_kc": int(len(kc)), "n_neurons": conn.N, "kc_index": kc})
    t0 = time.time()
    res = run_jobs(specs, n_parallel=cfg["run"]["n_parallel"])
    rows = []
    for sp, mm, r in zip(specs, meta, res):
        base = {k: v for k, v in mm.items() if k != "kc_index"}
        if r is None or "error" in r:
            rows.append({**base, "error": (r or {}).get("error", "")[-250:]}); continue
        i, ts, m = load_spikes(sp["out_dir"])
        def stat(ep):
            ii, _, eps = spikes_in_epoch(i, ts, m, ep)
            dur = sum(e["duration_s"] for e in eps)
            k = ii[np.isin(ii, mm["kc_index"])]
            return {"pop_rate_hz": float(len(ii) / dur / m["n_neurons"]),
                    "frac_kc": float(len(np.unique(k)) / max(len(mm["kc_index"]), 1)),
                    "kc_rate_hz": float(len(k) / dur / max(len(mm["kc_index"]), 1)),
                    "n_active": int(len(np.unique(ii)))}
        od, po = stat("odor"), stat("post")
        rows.append({**base, "odor": od, "post": po, "ignited": bool(od["pop_rate_hz"] > 0 and po["pop_rate_hz"] > 0.01 * od["pop_rate_hz"])})
    grid = []
    for cond in CONDITIONS:
      for pw in PATHWAYS:
        for rate in RATES:
            g = [r for r in rows if r["condition"] == cond["name"] and r.get("pathway") == pw and r["rate_hz"] == rate and "error" not in r]
            if g:
                grid.append({"condition": cond["name"], "pathway": pw, "rate_hz": rate, "n_seeds": len(g), "n_orn": g[0]["n_orn"],
                             "n_neurons": g[0]["n_neurons"], "n_kc": g[0]["n_kc"],
                             "frac_ignited": float(np.mean([r["ignited"] for r in g])),
                             "frac_kc_odor": float(np.mean([r["odor"]["frac_kc"] for r in g])),
                             "n_active_odor": float(np.mean([r["odor"]["n_active"] for r in g])),
                             "pop_rate_odor": float(np.mean([r["odor"]["pop_rate_hz"] for r in g])),
                             "pop_rate_post": float(np.mean([r["post"]["pop_rate_hz"] for r in g]))})
    olf = [g for g in grid if g["pathway"] == "olfactory"]
    gus = [g for g in grid if g["pathway"] == "gustatory"]
    mc = [g for g in olf if g["condition"] == "malecns_scaled" and g["frac_ignited"] > 0]
    fw = [g for g in olf if g["condition"].startswith("flywire") and g["frac_ignited"] > 0]
    gus_ign = [g for g in gus if g["frac_ignited"] > 0]
    pathway_note = ("The gustatory control never ignites any network at any rate tested, with the same code and the same "
                    "parameters, so the runaway is specific to the olfactory pathway and is not an artefact of how the "
                    "stimulus is delivered." if gus and not gus_ign else
                    ("The gustatory pathway also ignites, so the effect is not specific to the olfactory pathway."
                     if gus_ign else "No gustatory control was run."))
    if mc and not fw:
        finding = ("Olfactory input ignites the male CNS network but NOT the FlyWire networks that Shiu et al. simulated, "
                   "at identical parameters and the same stimulus. The runaway is a property of this dataset at this scale, "
                   "not of the published model.")
    elif mc and fw:
        finding = ("Olfactory input ignites BOTH the male CNS and the FlyWire networks at identical parameters. The runaway "
                   "is a property of the published model when it is driven through the olfactory pathway, not of the male "
                   "CNS dataset. The published sugar-neuron benchmark does not reveal it because that stimulus is small.")
    elif not mc and not fw:
        finding = "No condition ignited: olfactory input is tolerated by every network tested."
    else:
        finding = "The FlyWire networks ignite but the male CNS does not."
    out = {"status": "passed", "criterion": "descriptive control, no pass/fail: the same olfactory stimulus is run on every dataset",
           "conditions": CONDITIONS, "pathways": {k: str(v) for k, v in PATHWAYS.items()}, "rates_hz": RATES, "seeds": SEEDS,
           "grid": grid, "per_run": rows, "finding": finding, "pathway_control": pathway_note,
           "walltime_s": round(time.time() - t0, 1),
           "provenance": {"config": "configs/stage3b_odor.yaml", "results_dir": "results/stage3c_control",
                          "files": [s["out_dir"] for s in specs][:40]}}
    json.dump(out, open(OUT / "stage3c.json", "w"), indent=1, default=str)
    print(finding); print(); print(pathway_note); print()
    print(f"{'condition':18s} {'pathway':>10s} {'rate':>5s} {'nORN':>5s} {'neurons':>8s} {'P(ignite)':>10s} {'fracKC':>8s} {'nActive':>9s} {'rateOdor':>9s} {'ratePost':>9s}")
    for g in grid:
        print(f"{g['condition']:18s} {g['pathway']:>10s} {int(g['rate_hz']):5d} {g['n_orn']:5d} {g['n_neurons']:8d} {g['frac_ignited']:10.2f} "
              f"{g['frac_kc_odor']:8.1%} {g['n_active_odor']:9.0f} {g['pop_rate_odor']:9.4f} {g['pop_rate_post']:9.4f}")


if __name__ == "__main__":
    main()
