"""Stage 6 - REPLAY TEST. Does the odour-A Kenyon-cell ensemble reactivate above chance during simulated sleep?

All four required comparisons are computed as paired effects across seeds:
  1. trained (A) vs unpaired (B) ensemble reactivation, in sleep
  2. sleep vs wake, for the A ensemble
  3. real connectome vs degree-preserving shuffled connectome, for the A ensemble in sleep
  4. A ensemble vs size-matched random KC ensembles, in sleep
Outputs results/stage6_replay/stage6.json plus downsampled rasters and correlation traces for the viewer.
"""
import argparse, json, time
from pathlib import Path
import numpy as np
from hypnagogia import RESULTS
from hypnagogia.config import load_config, dump_config
from hypnagogia.connectome import load_connectome
from hypnagogia.model import load_spikes
from hypnagogia.analysis.replay import analyse_sleep_epoch, binned_matrix, template_correlation
from hypnagogia.analysis.stats import paired_effect
from hypnagogia.atlas import export_activity

OUT = RESULTS / "stage6_replay"


def epoch_window(meta, name):
    for e in meta["epochs"]:
        if e["name"] == name:
            return e["t_start_s"], e["t_end_s"]
    return None


def run_dir(tag, cond, seed):
    return RESULTS / "stage5_sleep" / tag / f"{cond}_seed{seed}"


def tagged(base, suffix):
    return base + suffix


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--seeds", default=None); ap.add_argument("--bin-ms", type=float, default=None)
    ap.add_argument("--gain", type=float, default=1.0)
    a = ap.parse_args()
    suffix = "" if a.gain == 1.0 else f"_gain{a.gain}"
    cfg = load_config("stage6_replay"); s6 = cfg["stage6"]
    seeds = [int(x) for x in a.seeds.split(",")] if a.seeds else s6["seeds"]
    bin_s = (a.bin_ms or s6["bin_ms"]) / 1e3
    global OUT
    if a.gain != 1.0:
        OUT = RESULTS / f"stage6_replay_gain{a.gain}"
    OUT.mkdir(parents=True, exist_ok=True); dump_config(cfg, OUT / "config.resolved.yaml")
    conn = load_connectome("malecns", "v1.0", "brain")
    kc = conn.select(cell_class="Kenyon_Cell")
    t0 = time.time()
    tmpl = {}
    for tag in (f"real{suffix}", f"shuffled{suffix}"):
        p = RESULTS / "stage4_learning" / tag / "kc_templates.json"
        if p.exists():
            tmpl[tag] = json.load(open(p))
    if f"real{suffix}" not in tmpl:
        raise SystemExit("stage 4 templates missing: run scripts/04_encode.py first")
    id2idx = {int(conn.ids[x]): int(x) for x in kc}
    rows, exports = [], {"traces": [], "rasters": []}
    for tag in (f"real{suffix}", f"shuffled{suffix}"):
        if tag not in tmpl:
            continue
        for sd in seeds:
            t = tmpl[tag].get(str(sd))
            if t is None:
                continue
            ens = {nm: np.array([id2idx[x] for x in t[f"{nm}_pre"] if x in id2idx], dtype=np.int64) for nm in ("A", "B")}
            # rank of each ensemble member in the odour response, for the sequence test
            ordr = {}
            for nm in ("A", "B"):
                ids_all = t[f"{nm}_pre"]; rk = (t.get("_order") or {}).get(f"{nm}_pre")
                if rk and len(rk) == len(ids_all):
                    ordr[nm] = np.array([r for x, r in zip(ids_all, rk) if x in id2idx], dtype=np.int64)
            for cond in ("sleep", "wake", "sleep_naive"):
                d = run_dir(tag, cond, sd)
                if not (d / "spikes.npz").exists():
                    continue
                i, ts, meta = load_spikes(d)
                w = epoch_window(meta, cond)
                if w is None:
                    continue
                res = analyse_sleep_epoch(i, ts, meta["dt_ms"] * 1e-3, kc, w[0], w[1], ens,
                                          bin_s=bin_s, n_random=s6["n_random_ensembles"], seed=sd,
                                          order_rank=(ordr or None))
                for nm, e in res["ensembles"].items():
                    rows.append({"network": tag, "condition": cond, "seed": sd, "ensemble": nm, "bin_ms": bin_s * 1e3,
                                 "kc_rate_hz": res["kc_rate_hz"], "n_active_bins": res["n_active_bins"], "n_bins": res["n_bins"],
                                 "file": str(d / "spikes.npz").replace(str(RESULTS.parent) + "/", ""), **e})
                if tag == f"real{suffix}" and sd in s6["export_seeds"]:
                    M = binned_matrix(i, ts, meta["dt_ms"] * 1e-3, kc, w[0], min(w[1], w[0] + s6["export_window_s"]), bin_s)
                    pos = np.full(int(kc.max()) + 2, -1, dtype=np.int64); pos[kc] = np.arange(len(kc))
                    tr = {}
                    for nm in ("A", "B"):
                        v = np.zeros(len(kc)); r_ = pos[ens[nm]]; v[r_[r_ >= 0]] = 1.0
                        tr[nm] = np.nan_to_num(template_correlation(M, v), nan=0.0)
                    n_b = M.shape[1]
                    arr = np.stack([np.arange(n_b) * bin_s, tr["A"], tr["B"]], axis=1).astype(np.float32)
                    sub = OUT / "replay"; sub.mkdir(parents=True, exist_ok=True)
                    arr.tofile(sub / f"trace_{cond}_seed{sd}.bin")
                    thr = next((r["threshold_corr"] for r in rows if r["network"] == "real" and r["condition"] == cond and r["seed"] == sd and r["ensemble"] == "A"), None)
                    json.dump({"bin": f"trace_{cond}_seed{sd}.bin", "dtype": "float32", "shape": [int(n_b), 3],
                               "columns": ["t_s", "corr_A", "corr_B"], "dt_s": bin_s,
                               "threshold_corr": thr, "threshold_source": "95th percentile of the per-bin 95th percentiles over size-matched random KC ensembles"},
                              open(sub / f"trace_{cond}_seed{sd}.json", "w"))
                    exports["traces"].append({"seed": sd, "condition": cond, "file": f"replay/trace_{cond}_seed{sd}.json"})
                    # raster: ensemble A, ensemble B, and a sample of other KCs
                    other = np.setdiff1d(kc, np.concatenate([ens["A"], ens["B"]]))
                    rng = np.random.default_rng(sd)
                    other = rng.choice(other, size=min(len(other), 400), replace=False) if len(other) else other
                    order = np.concatenate([ens["A"], ens["B"], np.sort(other)])
                    grp = ["ensemble_A"] * len(ens["A"]) + ["ensemble_B"] * len(ens["B"]) + ["other_kc"] * len(other)
                    rpos = {int(n): k for k, n in enumerate(order)}
                    t_arr = ts * meta["dt_ms"] * 1e-3
                    m = (t_arr >= w[0]) & (t_arr < min(w[1], w[0] + s6["export_window_s"])) & np.isin(i, order)
                    ii, tt = i[m], t_arr[m] - w[0]
                    if len(ii) > s6["export_max_spikes"]:
                        pick = rng.choice(len(ii), s6["export_max_spikes"], replace=False); ii, tt = ii[pick], tt[pick]
                    sp = np.stack([np.round(tt * 1000).astype(np.uint32), np.array([rpos[int(x)] for x in ii], dtype=np.uint32)], axis=1)
                    sp = sp[np.argsort(sp[:, 0])]
                    sp.tofile(sub / f"raster_{cond}_seed{sd}.bin")
                    json.dump({"bin": f"raster_{cond}_seed{sd}.bin", "dtype": "uint32", "shape": [int(len(sp)), 2],
                               "columns": ["t_ms", "neuron_row"],
                               "neuron_rows": [{"row": k, "root_id": str(conn.ids[n]), "group": g} for k, (n, g) in enumerate(zip(order, grp))],
                               "duration_s": float(min(w[1], w[0] + s6["export_window_s"]) - w[0])},
                              open(sub / f"raster_{cond}_seed{sd}.json", "w"))
                    exports["rasters"].append({"seed": sd, "condition": cond, "file": f"replay/raster_{cond}_seed{sd}.json"})
                    # whole-brain activity for the viewer's neuron map, over the same window
                    atlas_idx_file = Path("web/public/data/neuron_atlas_index.bin")
                    if atlas_idx_file.exists():
                        aidx = np.fromfile(atlas_idx_file, dtype=np.uint32).astype(np.int64)
                        side = export_activity(i, ts, meta["dt_ms"] * 1e-3, aidx, w[0], min(w[1], w[0] + s6["export_window_s"]),
                                               sub, f"activity_{cond}_seed{sd}", max_spikes=s6.get("export_max_activity_spikes", 400000), seed=sd)
                        exports.setdefault("activity", []).append({"seed": sd, "condition": cond, "file": f"replay/activity_{cond}_seed{sd}.json",
                                                                   "n_spikes_exported": side["n_spikes_exported"], "downsampled": side["downsampled"]})
    # ---- the four comparisons ----
    def pick(net, cond, ens, metric="template_corr_mean"):
        d = {r["seed"]: r.get(metric) for r in rows if r["network"] == net and r["condition"] == cond and r["ensemble"] == ens}
        return d

    def paired(dx, dy, name, label, direction, metric):
        common = sorted(set(dx) & set(dy))
        common = [s for s in common if dx[s] is not None and dy[s] is not None]
        if len(common) < 3:
            return {"name": name, "label": label, "metric": metric, "n": len(common), "available": False,
                    "note": "fewer than 3 paired seeds available"}
        x = np.array([dx[s] for s in common]); y = np.array([dy[s] for s in common])
        e = paired_effect(x, y, name=name)
        surv = (e["ci95"][0] > 0) if direction == "greater" else (e["ci95"][1] < 0)
        return {**e, "label": label, "metric": metric, "direction": direction, "available": True,
                "survives": bool(surv), "seeds": common}

    comparisons = []
    REAL, SHUF = f"real{suffix}", f"shuffled{suffix}"
    A_sleep = pick(REAL, "sleep", "A"); B_sleep = pick(REAL, "sleep", "B")
    A_wake = pick(REAL, "wake", "A"); A_sleep_sh = pick(SHUF, "sleep", "A")
    A_naive = pick(REAL, "sleep_naive", "A")
    A_rand = {r["seed"]: r.get("null_corr_mean") for r in rows if r["network"] == REAL and r["condition"] == "sleep" and r["ensemble"] == "A"}
    comparisons.append(paired(A_sleep, B_sleep, "A_vs_B_sleep", "trained (A) vs unpaired (B) ensemble, during sleep", "greater", "template_corr_mean"))
    comparisons.append(paired(A_sleep, A_wake, "sleep_vs_wake_A", "sleep vs wake, odour-A ensemble", "greater", "template_corr_mean"))
    comparisons.append(paired(A_sleep, A_sleep_sh, "real_vs_shuffled", "real vs degree-preserving shuffled connectome, odour-A ensemble in sleep", "greater", "template_corr_mean"))
    comparisons.append(paired(A_sleep, A_rand, "A_vs_random_ensembles", "odour-A ensemble vs size-matched random KC ensembles, during sleep", "greater", "template_corr_mean"))
    # Fifth comparison, not in the original four but necessary here: does the MEMORY contribute anything? The
    # learned weights sit on Kenyon-cell -> output-neuron synapses, which are downstream of the Kenyon cells being
    # measured, so learning may be unable to change which cells reactivate. This compares the identical sleep run
    # with learned versus unlearned weights.
    comparisons.append(paired(A_sleep, A_naive, "trained_vs_naive_weights",
                              "learned vs unlearned synaptic weights, odour-A ensemble in sleep", "greater", "template_corr_mean"))
    # sequence-order preservation, reported when the reactivation events contain enough ordered members to score
    seq = [r for r in rows if r["network"] == REAL and r["condition"] == "sleep" and r["ensemble"] == "A"
           and isinstance(r.get("sequence"), dict) and r["sequence"].get("rho_mean") is not None]
    sequence_summary = None
    if seq:
        rho = np.array([r["sequence"]["rho_abs_mean"] for r in seq])
        nul = np.array([r["sequence"]["null_mean"] for r in seq if r["sequence"].get("null_mean") is not None])
        sequence_summary = {"n_seeds_scored": len(seq),
                            "n_events_scored_total": int(sum(r["sequence"]["n_events_scored"] for r in seq)),
                            "rho_abs_mean": float(rho.mean()),
                            "null_abs_mean": (float(nul.mean()) if len(nul) else None),
                            "per_seed_p": [r["sequence"].get("p") for r in seq],
                            "note": ("Spearman rank correlation between within-event first-spike order and the order of the "
                                     "odour response, against a cell-identity shuffle (Foster & Wilson 2006). Reported only "
                                     "where events contained at least four ensemble members with distinct template ranks.")}
        if len(nul) == len(rho) and len(rho) >= 3:
            sequence_summary["effect_vs_shuffle"] = paired_effect(rho, nul, name="sequence_vs_shuffle")
    FOUR = ("A_vs_B_sleep", "sleep_vs_wake_A", "real_vs_shuffled", "A_vs_random_ensembles")
    avail = [c for c in comparisons if c.get("available")]
    core = [c for c in avail if c["name"] in FOUR]
    naive_c = next((c for c in comparisons if c["name"] == "trained_vs_naive_weights"), None)
    all_survive = len(core) == 4 and all(c["survives"] for c in core)
    shuffled_c = next((c for c in comparisons if c["name"] == "real_vs_shuffled"), None)
    others_pos = [c for c in core if c["name"] != "real_vs_shuffled" and c["survives"]]
    memory_note = ""
    if naive_c and naive_c.get("available"):
        memory_note = (" The memory itself contributed nothing measurable: the identical sleep run with unlearned weights "
                       "gave the same reactivation (learned minus unlearned = "
                       f"{naive_c['diff']:+.5f}, 95% CI [{naive_c['ci95'][0]:+.5f}, {naive_c['ci95'][1]:+.5f}]). That is "
                       "expected in this model, because the learned synapses lie downstream of the Kenyon cells being "
                       "measured and cannot change which of them switch on."
                       if not naive_c["survives"] else
                       " The learned weights did increase reactivation relative to the identical run with unlearned "
                       f"weights (difference {naive_c['diff']:+.5f}, 95% CI [{naive_c['ci95'][0]:+.5f}, {naive_c['ci95'][1]:+.5f}]).")
    if all_survive:
        status, headline = "passed", ("The odour-A Kenyon-cell ensemble reactivated above chance during simulated sleep, and the "
                                      "effect survived all four null comparisons including the degree-preserving shuffled "
                                      "connectome." + memory_note)
    elif others_pos and shuffled_c and shuffled_c.get("available") and not shuffled_c["survives"]:
        status, headline = "artifact", ("A positive reactivation signal was measured, but it did NOT survive the "
                                        "degree-preserving shuffled-connectome null: it is an artifact of network structure, "
                                        "not evidence of replay." + memory_note)
    elif not avail:
        status, headline = "not_run", "The replay comparisons could not be computed: the required sleep and wake runs are not available."
    else:
        failed = [c["name"] for c in core if not c["survives"]]
        status, headline = "failed", ("No evidence of memory replay: the odour-A ensemble did not reactivate above chance during "
                                      "simulated sleep. Comparisons that did not show the predicted effect: "
                                      f"{', '.join(failed) if failed else 'none'}." + memory_note)
    out_d = {"status": status, "criterion": s6["criterion"], "headline": headline,
             "metrics": {"template_correlation": "Pearson correlation, per time bin, between the Kenyon-cell population activity vector and the odour's KC ensemble template (Tatsuno et al. 2006 template matching; bin as stated)",
                         "coactivation": "mean zero-lag pairwise correlation among ensemble members, standardised against size-matched random KC ensembles (Wilson & McNaughton 1994)",
                         "sequence": "Spearman rank correlation between within-event first-spike order and the odour-response order, with a cell-identity shuffle null (Foster & Wilson 2006)",
                         "reactivation_event": "a bin whose template correlation exceeds the 95th percentile of the size-matched random-ensemble null"},
             "window_ms": bin_s * 1e3, "n_seeds": len(set(r["seed"] for r in rows)), "gain": a.gain,
             "gain_note": ("published parameters" if a.gain == 1.0 else
                           f"DEVIATION: every synaptic weight scaled to {a.gain} of its published value, because at the "
                           f"published value the network has neither a sparse odour code nor a quiet background (stages 2 "
                           f"and 3b). This is an uncited free parameter introduced by this project."),
             "comparisons": comparisons, "sequence": sequence_summary, "per_seed": rows, "traces": exports["traces"], "rasters": exports["rasters"],
             "activity": exports.get("activity", []),
             "networks_analysed": sorted(set(r["network"] for r in rows)),
             "walltime_s": round(time.time() - t0, 1),
             "provenance": {"config": "configs/stage6_replay.yaml", "results_dir": "results/stage6_replay",
                            "files": sorted(set(r["file"] for r in rows))[:40]}}
    json.dump(out_d, open(OUT / "stage6.json", "w"), indent=1, default=str)
    print(json.dumps({k: v for k, v in out_d.items() if k in ("status", "headline", "walltime_s", "networks_analysed")}, indent=1, default=str))
    for c in comparisons:
        if c.get("available"):
            print(f"  {c['name']:24s} diff={c['diff']:+.5f} CI=[{c['ci95'][0]:+.5f},{c['ci95'][1]:+.5f}] g={c['hedges_g']:+.2f} p={c['p_permutation']:.4f} n={c['n']} survives={c['survives']}")
        else:
            print(f"  {c['name']:24s} NOT AVAILABLE: {c.get('note')}")


if __name__ == "__main__":
    main()
