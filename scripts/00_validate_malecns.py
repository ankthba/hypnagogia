"""Stage 0b - VALIDATION GATE on the male CNS connectome (brain scope, weight_scale 0.581).

(a) Weight-scale check. For every (presynaptic type, postsynaptic type) pair present in BOTH datasets
    (male types mapped to FlyWire nomenclature through the male annotations' `flywireType` column),
    compare the mean synapse count per connected pair: ratio = FlyWire / male. If the male CNS paper's
    0.581 is right for our tables, the count-weighted median ratio should be close to 0.581.
(b) Sensory -> motor propagation: port the Shiu et al. 2024 sugar-GRN -> MN9 benchmark. Drive the male
    counterparts of the paper's right-labellar sugar GRNs (one-to-one NBLAST matches restricted to LB3a-d;
    plus the full right LB3a-d set as a second variant) with Poisson input at 100 and 200 Hz for 1 s,
    30 trials, and read out MN9 (both sides) and the number of activated neurons. Reference: our
    engine-checked FlyWire v630 runs (same protocol) and the paper's shipped outputs.
    Control: same runs with weight_scale = 1.0 (unscaled male counts).
Pre-registered pass criteria (written before running):
    scale: count-weighted median FlyWire/male ratio within [0.45, 0.75] (i.e. 0.581 +/- ~25%);
    propagation: at 200 Hz the matched-set MN9 (side matched to Shiu's MN9) fires in >= 90% of trials,
    its mean rate is within a factor of 2 of the FlyWire v630 value at 200 Hz, and the number of activated
    neurons is within a factor of 2 of the FlyWire v630 count. If either fails: STOP and report; W_syn is
    NOT retuned.
"""
import json, sys, time
from pathlib import Path
import numpy as np, pandas as pd
from hypnagogia import RESULTS
from hypnagogia.config import load_config, dump_config
from hypnagogia.connectome import load_connectome
from hypnagogia.crossmatch import match_ids
from hypnagogia.jobs import run_jobs

SUGAR_FW = [720575940624963786, 720575940630233916, 720575940637568838, 720575940638202345, 720575940617000768,
            720575940630797113, 720575940632889389, 720575940621754367, 720575940621502051, 720575940640649691,
            720575940639332736, 720575940616885538, 720575940639198653, 720575940620900446, 720575940617937543,
            720575940632425919, 720575940633143833, 720575940612670570, 720575940628853239, 720575940629176663,
            720575940611875570]
MN9_FW = 720575940660219265
OUT = RESULTS / "stage0_validate_malecns"


def weight_scale_check(cm, cf, min_pairs=20):
    m_t = cm.ann["flywire_type"].astype("string").to_numpy(dtype=object)
    f_t = cf.ann["cell_type"].astype("string").to_numpy(dtype=object)
    def pair_stats(conn, types):
        pre_t, post_t = types[conn.pre], types[conn.post]
        ok = pd.notna(pre_t) & pd.notna(post_t)
        df = pd.DataFrame({"pre": pre_t[ok], "post": post_t[ok], "w": conn.count[ok]})
        g = df.groupby(["pre", "post"], sort=False)["w"].agg(["mean", "size", "sum"])
        return g
    gm, gf = pair_stats(cm, m_t), pair_stats(cf, f_t)
    both = gm.join(gf, lsuffix="_m", rsuffix="_f", how="inner")
    both = both[(both["size_m"] >= min_pairs) & (both["size_f"] >= min_pairs)]
    both["ratio"] = both["mean_f"] / both["mean_m"]
    w = np.minimum(both["size_m"], both["size_f"]).to_numpy(dtype=float)
    lr = np.log(both["ratio"].to_numpy())
    order = np.argsort(lr); cw = np.cumsum(w[order]) / w.sum()
    wmedian = float(np.exp(lr[order][np.searchsorted(cw, 0.5)]))
    q = np.exp(np.percentile(lr, [25, 50, 75]))
    # a second estimate: ratio of totals over the shared type pairs
    tot = float(both["sum_f"].sum() / both["sum_m"].sum())
    top = both.sort_values("size_m", ascending=False).head(30)
    return {"n_type_pairs": int(len(both)), "min_pairs_per_type_pair": min_pairs,
            "ratio_weighted_median": round(wmedian, 4), "ratio_quartiles": [round(float(x), 4) for x in q],
            "ratio_of_totals": round(tot, 4), "expected": 0.581,
            "examples": [{"pre": p, "post": q_, "mean_syn_male": round(float(r["mean_m"]), 2), "mean_syn_flywire": round(float(r["mean_f"]), 2),
                          "n_pairs_male": int(r["size_m"]), "n_pairs_flywire": int(r["size_f"]), "ratio": round(float(r["ratio"]), 3)}
                         for (p, q_), r in top.iterrows()]}


def main():
    n_trials = int(sys.argv[1]) if len(sys.argv) > 1 else 30
    OUT.mkdir(parents=True, exist_ok=True)
    cfg = load_config("base"); dump_config(cfg, OUT / "config.resolved.yaml")
    cm = load_connectome("malecns", "v1.0", "brain"); cf = load_connectome("flywire", "783")
    t0 = time.time()
    scale = weight_scale_check(cm, cf)
    scale["passed"] = bool(0.45 <= scale["ratio_weighted_median"] <= 0.75)
    print("scale check:", {k: v for k, v in scale.items() if k != "examples"})
    # drive sets
    mm = match_ids(SUGAR_FW, cm, restrict_selector={"cell_type": {"regex": r"^LB3[a-d]?$"}})
    matched = [int(x) for x in mm.male_body]
    allR = [int(x) for x in cm.ids[cm.select(cell_type={"regex": r"^LB3[a-d]?$"}, side="R")]]
    mn9_ids = {str(cm.ann.instance.iloc[i]): int(cm.ids[i]) for i in cm.select(cell_type="MN9")}
    mn9_fw_match = int(match_ids([MN9_FW], cm, restrict_selector={"cell_type": "MN9"}).male_body.iloc[0])
    sets = {"matched17": matched, "allR": allR}
    specs = []
    for sname, ids in sets.items():
        for freq in (100, 200):
            for ws in (0.581, 1.0):
                for k in range(n_trials):
                    specs.append({"out_dir": str(OUT / f"{sname}_{freq}Hz_ws{ws}" / f"trial{k}"), "seed": 2000 + k,
                                  "config": cfg, "name": f"mcns_{sname}_{freq}_{ws}_t{k}",
                                  "connectome": {"dataset": "malecns", "version": "v1.0", "scope": "brain", "weight_scale": ws},
                                  "drive_groups": {"sugar": {"ids": ids}}, "record": "all",
                                  "epochs": [{"name": "stim", "duration_s": 1.0, "drives": {"sugar": float(freq)}}]})
    res = run_jobs(specs, n_parallel=cfg["run"]["n_parallel"])
    errs = [r for r in res if r and "error" in r]
    if errs:
        print("ERRORS:", errs[:2]); sys.exit(1)
    idx_mn9 = {k: int(cm.index_of([v])[0]) for k, v in mn9_ids.items()}
    ref = json.load(open(RESULTS / "stage0_engine_check" / "engine_check.json"))["runs"]
    runs = []
    for sname, ids in sets.items():
        for freq in (100, 200):
            for ws in (0.581, 1.0):
                rows = []
                for k in range(n_trials):
                    z = np.load(OUT / f"{sname}_{freq}Hz_ws{ws}" / f"trial{k}" / "spikes.npz"); i = z["i"]
                    rows.append({**{f"mn9_{n}": int((i == j).sum()) for n, j in idx_mn9.items()}, "n_active": int(len(np.unique(i))), "n_spikes": int(len(i))})
                df = pd.DataFrame(rows)
                fw = ref[str(freq)]["ours"]
                runs.append({"drive_set": sname, "n_driven": len(ids), "sugar_rate_hz": freq, "weight_scale": ws, "n_trials": n_trials,
                             "mn9": {n: {"rate_hz_mean": float(df[f"mn9_{n}"].mean()), "rate_hz_sd": float(df[f"mn9_{n}"].std(ddof=1)),
                                        "frac_trials_active": float((df[f"mn9_{n}"] > 0).mean()), "per_trial": df[f"mn9_{n}"].tolist()} for n in idx_mn9},
                             "n_active_per_trial_mean": float(df.n_active.mean()), "n_spikes_per_trial_mean": float(df.n_spikes.mean()),
                             "flywire_v630_reference": {"mn9_rate_hz_mean": fw["mn9_rate_hz_mean"], "n_active_per_trial_mean": fw["n_active_per_trial_mean"]}})
    # criteria on matched17 @200 Hz, scaled, MN9 = male match of Shiu's MN9
    tgt_name = [n for n, v in mn9_ids.items() if v == mn9_fw_match][0]
    r200 = [r for r in runs if r["drive_set"] == "matched17" and r["sugar_rate_hz"] == 200 and r["weight_scale"] == 0.581][0]
    fw200 = ref["200"]["ours"]
    m = r200["mn9"][tgt_name]
    checks = {"mn9_active_in_90pct_trials": bool(m["frac_trials_active"] >= 0.9),
              "mn9_rate_within_2x_of_flywire": bool(fw200["mn9_rate_hz_mean"] / 2 <= m["rate_hz_mean"] <= fw200["mn9_rate_hz_mean"] * 2),
              "n_active_within_2x_of_flywire": bool(fw200["n_active_per_trial_mean"] / 2 <= r200["n_active_per_trial_mean"] <= fw200["n_active_per_trial_mean"] * 2),
              "scale_factor_consistent": scale["passed"]}
    summary = {"status": "passed" if all(checks.values()) else "failed", "checks": checks, "criterion": __doc__.split("Pre-registered pass criteria")[1].strip(),
               "network": cm.describe(), "weight_scale_check": scale,
               "sugar_grn_mapping": {"flywire_ids": SUGAR_FW, "n_flywire": len(SUGAR_FW), "one_to_one_matched": mm.astype(str).to_dict(orient="records"),
                                     "unmatched_flywire_ids": [str(x) for x in mm.attrs["unmatched"]], "allR_n": len(allR),
                                     "male_types_matched": cm.ann.cell_type.iloc[cm.index_of(matched)].value_counts().to_dict()},
               "mn9_male": mn9_ids, "mn9_flywire_match": {"flywire": str(MN9_FW), "male_body": mn9_fw_match, "instance": tgt_name},
               "runs": runs, "walltime_s": round(time.time() - t0, 1)}
    with open(OUT / "validation.json", "w") as f:
        json.dump(summary, f, indent=1, default=str)
    print("VALIDATION:", summary["status"], checks)
    for r in runs:
        print(f"  {r['drive_set']:9s} n={r['n_driven']:2d} {r['sugar_rate_hz']}Hz ws={r['weight_scale']}: " +
              " ".join(f"{n}={v['rate_hz_mean']:.1f}Hz({v['frac_trials_active']:.0%})" for n, v in r["mn9"].items()) +
              f" active={r['n_active_per_trial_mean']:.0f} (FlyWire v630: MN9 {r['flywire_v630_reference']['mn9_rate_hz_mean']:.1f} Hz, active {r['flywire_v630_reference']['n_active_per_trial_mean']:.0f})")


if __name__ == "__main__":
    main()
