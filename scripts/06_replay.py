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
    ap.add_argument("--gain", type=float, default=1.0); ap.add_argument("--tag", default="")
    # --tag selects which stage-5 directories to read. --out-tag changes only where the result is written, so
    # the same runs can be re-analysed at a different bin without overwriting the primary, pre-registered one.
    ap.add_argument("--out-tag", default="")
    a = ap.parse_args()
    gain_suffix = "" if a.gain == 1.0 else f"_gain{a.gain}"
    suffix = gain_suffix + (a.tag or "")     # stage 5 directories carry the tag; stage 4 directories do not
    cfg = load_config("stage6_replay"); s6 = cfg["stage6"]
    seeds = [int(x) for x in a.seeds.split(",")] if a.seeds else s6["seeds"]
    bin_s = (a.bin_ms or s6["bin_ms"]) / 1e3
    global OUT
    if a.gain != 1.0 or a.tag or a.out_tag:
        OUT = RESULTS / (f"stage6_replay" + ("" if a.gain == 1.0 else f"_gain{a.gain}") + (a.tag or "") + (a.out_tag or ""))
    OUT.mkdir(parents=True, exist_ok=True); dump_config(cfg, OUT / "config.resolved.yaml")
    conn = load_connectome("malecns", "v1.0", "brain")
    kc = conn.select(cell_class="Kenyon_Cell")
    t0 = time.time()
    tmpl = {}
    for tag in (f"real{suffix}", f"shuffled{suffix}"):
        p = RESULTS / "stage4_learning" / (tag[: len(tag) - len(a.tag)] if a.tag else tag) / "kc_templates.json"
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
        return {r["seed"]: r.get(metric) for r in rows if r["network"] == net and r["condition"] == cond and r["ensemble"] == ens}

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
    # Ensemble sizes differ between odours (about 326 vs 205 Kenyon cells) and between the real and shuffled
    # networks (about 326 vs 152), and the raw template correlation depends on template size. Comparisons that
    # cross those boundaries therefore use z_vs_random_ensembles, which standardises each measurement against
    # size-matched random ensembles drawn from that same run. The raw correlation is reported alongside.
    Z = "z_vs_random_ensembles"
    SH = "spike_share_z"   # robust at the low spike counts of a genuinely sparse offline state
    A_sleep_z, B_sleep_z = pick(REAL, "sleep", "A", Z), pick(REAL, "sleep", "B", Z)
    A_wake_z, A_sh_z, A_naive_z = pick(REAL, "wake", "A", Z), pick(SHUF, "sleep", "A", Z), pick(REAL, "sleep_naive", "A", Z)
    A_sleep = pick(REAL, "sleep", "A")
    A_rand = {r["seed"]: r.get("null_corr_mean") for r in rows if r["network"] == REAL and r["condition"] == "sleep" and r["ensemble"] == "A"}
    comparisons.append(paired(A_sleep_z, B_sleep_z, "A_vs_B_sleep", "trained (A) vs unpaired (B) ensemble, during sleep", "greater", Z))
    comparisons.append(paired(A_sleep_z, A_wake_z, "sleep_vs_wake_A", "sleep vs wake, odour-A ensemble", "greater", Z))
    comparisons.append(paired(A_sleep_z, A_sh_z, "real_vs_shuffled", "real vs degree-preserving shuffled connectome, odour-A ensemble in sleep", "greater", Z))
    comparisons.append(paired(A_sleep, A_rand, "A_vs_random_ensembles", "odour-A ensemble vs size-matched random KC ensembles, during sleep", "greater", "template_corr_mean"))
    # Fifth comparison, not in the original four but necessary here: does the MEMORY contribute anything? The
    # learned weights sit on Kenyon-cell -> output-neuron synapses, which are downstream of the Kenyon cells being
    # measured, so learning may be unable to change which cells reactivate. This compares the identical sleep run
    # with learned versus unlearned weights.
    comparisons.append(paired(A_sleep_z, A_naive_z, "trained_vs_naive_weights",
                              "learned vs unlearned synaptic weights, odour-A ensemble in sleep", "greater", Z))
    # the same memory-specific test on the low-count-robust metric
    comparisons.append(paired(pick(REAL, "sleep", "A", SH), pick(REAL, "sleep_naive", "A", SH),
                              "trained_vs_naive_spike_share",
                              "learned vs unlearned weights, share of offline Kenyon-cell spikes falling in the odour-A ensemble",
                              "greater", SH))
    # WHETHER A COMPARISON'S TWO ARMS ARE COMPARABLE AT ALL.
    #
    # z_vs_random_ensembles standardises each arm against random ensembles drawn from that same run, which
    # handles a difference in ensemble SIZE. It does not handle a difference in the state the two arms are in.
    # The degree-preserving shuffle destroys the Kenyon-cell feedback that keeps the odour code sparse, so the
    # shuffled network encodes a much larger ensemble and idles at a much higher rate, and a comparison across
    # that gap is not measuring what its name says. This reports the gap so a reader can see it, and the
    # verdict below refuses to draw the word "artifact" from a comparison whose arms are this far apart.
    def arm_state(net, cond, ens):
        r = [x for x in rows if x["network"] == net and x["condition"] == cond and x["ensemble"] == ens]
        if not r:
            return None
        return {"n_seeds": len(r),
                "ensemble_size_mean": float(np.mean([x["size"] for x in r if x.get("size")])) if any(x.get("size") for x in r) else None,
                "kc_rate_hz_mean": float(np.mean([x["kc_rate_hz"] for x in r])),
                "n_spikes_total_kc_mean": float(np.mean([x["n_spikes_total_kc"] for x in r]))}

    def matching(name, a_arm, b_arm, tol=1.5):
        A, B = arm_state(*a_arm), arm_state(*b_arm)
        if not A or not B:
            return None
        def ratio(k):
            x, y = A.get(k), B.get(k)
            return (max(x, y) / min(x, y)) if (x and y and min(x, y) > 0) else None
        rs, rr = ratio("ensemble_size_mean"), ratio("kc_rate_hz_mean")
        ok = all(v is None or v <= tol for v in (rs, rr))
        return {"comparison": name, "arm_a": {"arm": list(a_arm), **A}, "arm_b": {"arm": list(b_arm), **B},
                "ensemble_size_ratio": rs, "kc_rate_ratio": rr, "tolerance": tol, "arms_are_matched": bool(ok),
                "note": (f"The two arms differ by {rs:.1f} times in ensemble size and {rr:.1f} times in "
                         f"Kenyon-cell rate. Standardising against size-matched random ensembles corrects the "
                         f"first and not the second: the arms are in different states, so this comparison does "
                         f"not isolate the variable its name refers to and its result should not be read as "
                         f"evidence about that variable in either direction."
                         if not ok and rs and rr else
                         "The two arms are within tolerance on ensemble size and Kenyon-cell rate.")}

    arm_checks = [c for c in (
        matching("A_vs_B_sleep", (REAL, "sleep", "A"), (REAL, "sleep", "B")),
        matching("sleep_vs_wake_A", (REAL, "sleep", "A"), (REAL, "wake", "A")),
        matching("real_vs_shuffled", (REAL, "sleep", "A"), (SHUF, "sleep", "A")),
        matching("trained_vs_naive_weights", (REAL, "sleep", "A"), (REAL, "sleep_naive", "A")),
    ) if c]
    unmatched = {c["comparison"] for c in arm_checks if not c["arms_are_matched"]}

    # WHICH HALF OF A Z-SCORE MOVED.
    #
    # A z against a null is (observed minus null mean) over null sd, so it can rise because the effect grew or
    # because the null's spread shrank, and those mean opposite things. For the two memory comparisons, which
    # are the only ones that speak to the memory at all, both halves are reported separately.
    def decompose(name, obs_key, mu_key, sd_key, cond_a="sleep", cond_b="sleep_naive"):
        out = {"comparison": name, "observed_minus_null": None, "null_sd": None}
        for lab, cond in (("trained", cond_a), ("naive", cond_b)):
            r = [x for x in rows if x["network"] == REAL and x["condition"] == cond and x["ensemble"] == "A"]
            if not r:
                return None
            num = [x[obs_key] - x[mu_key] for x in r if x.get(obs_key) is not None and x.get(mu_key) is not None]
            sd = [x[sd_key] for x in r if x.get(sd_key)]
            out[f"{lab}_numerator_mean"] = float(np.mean(num)) if num else None
            out[f"{lab}_null_sd_mean"] = float(np.mean(sd)) if sd else None
        for half, a, b in (("observed_minus_null", out.get("trained_numerator_mean"), out.get("naive_numerator_mean")),
                           ("null_sd", out.get("trained_null_sd_mean"), out.get("naive_null_sd_mean"))):
            out[half] = {"trained": a, "naive": b, "difference": (a - b) if (a is not None and b is not None) else None,
                         "relative": ((a - b) / abs(b)) if (a is not None and b) else None}
        n_rel = (out["observed_minus_null"] or {}).get("relative")
        d_rel = (out["null_sd"] or {}).get("relative")
        out["carried_by"] = ("the numerator" if (n_rel is not None and d_rel is not None and abs(n_rel) > abs(d_rel))
                             else "the null's spread" if (n_rel is not None and d_rel is not None) else "not determined")
        out["note"] = ("A z-score rises when the effect grows OR when the null's spread shrinks. Here it is "
                       f"carried by {out['carried_by']}."
                       + (" A difference carried by the null's spread is not evidence that the memory changed "
                          "the offline activity; it is evidence that the random ensembles became more alike."
                          if out["carried_by"] == "the null's spread" else ""))
        return out

    z_decomposition = [d for d in (
        decompose("trained_vs_naive_weights", "template_corr_mean", "null_corr_mean", "null_corr_sd"),
        decompose("trained_vs_naive_spike_share", "spike_share_observed", "spike_share_null_mean", "spike_share_null_sd"),
    ) if d]

    # the same three comparisons on the raw correlation, reported so the size-normalisation can be checked
    secondary = [paired(pick(REAL, "sleep", "A"), pick(REAL, "sleep", "B"), "A_vs_B_sleep_raw", "same, raw template correlation", "greater", "template_corr_mean"),
                 paired(pick(REAL, "sleep", "A"), pick(REAL, "wake", "A"), "sleep_vs_wake_A_raw", "same, raw template correlation", "greater", "template_corr_mean"),
                 paired(pick(REAL, "sleep", "A"), pick(SHUF, "sleep", "A"), "real_vs_shuffled_raw", "same, raw template correlation", "greater", "template_corr_mean")]
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
    # Is "reactivation" even a discrete event here? If most time bins clear the threshold, the ensemble is
    # simply on all the time and the event framing is meaningless: a template correlation measured against a
    # continuously active population reflects how active those particular cells are, not whether a memory
    # reappeared. This is computed before any comparison is interpreted.
    def frac_bins(net, cond, ens):
        g = [r for r in rows if r["network"] == net and r["condition"] == cond and r["ensemble"] == ens
             and r.get("n_bins")]
        return (float(np.mean([r["n_reactivation_events"] / r["n_bins"] for r in g])) if g else None)
    continuity = {"bin_ms": bin_s * 1e3,
                  "fraction_of_bins_called_events": {f"{n}/{c}/{e}": frac_bins(n, c, e)
                                                     for n in sorted(set(r["network"] for r in rows))
                                                     for c in sorted(set(r["condition"] for r in rows if r["network"] == n))
                                                     for e in ("A", "B") if frac_bins(n, c, e) is not None},
                  "kc_fraction_active_during_offline": float(np.mean([r["kc_rate_hz"] for r in rows if r.get("kc_rate_hz")]))}
    worst = max([v for v in continuity["fraction_of_bins_called_events"].values() if v is not None] or [0.0])
    continuity["events_are_discrete"] = bool(worst < 0.25)
    continuity["note"] = (
        (f"In the real network {100 * worst:.0f}% of all time bins clear the reactivation threshold. The ensemble is "
         f"effectively on continuously, so 'reactivation events' are not discrete episodes and the template "
         f"correlation mostly reflects how active those particular Kenyon cells are rather than whether a memory "
         f"reappeared. Every comparison below must be read with that in mind.")
        if not continuity["events_are_discrete"] else
        f"At most {100 * worst:.0f}% of time bins clear the reactivation threshold, so events are discrete episodes.")
    FOUR = ("A_vs_B_sleep", "sleep_vs_wake_A", "real_vs_shuffled", "A_vs_random_ensembles")
    ADDITIONAL = ("trained_vs_naive_weights", "trained_vs_naive_spike_share")
    avail = [c for c in comparisons if c.get("available")]
    core = [c for c in avail if c["name"] in FOUR]
    naive_c = next((c for c in comparisons if c["name"] == "trained_vs_naive_weights"), None)
    all_survive = len(core) == 4 and all(c["survives"] for c in core)
    shuffled_c = next((c for c in comparisons if c["name"] == "real_vs_shuffled"), None)
    others_pos = [c for c in core if c["name"] != "real_vs_shuffled" and c["survives"]]
    causal, manip = None, None
    try:
        s5f = RESULTS / "stage5_sleep" / ("real" + ("" if a.gain == 1.0 else f"_gain{a.gain}")) / "stage5.json"
        if s5f.exists():
            s5d = json.load(open(s5f)) or {}
            causal = s5d.get("engram_reaches_the_kenyon_cells")
            manip = s5d.get("manipulation_strength")
    except Exception:
        causal, manip = None, None
    # One of the four required comparisons is sleep against wake. If stage 5 measured the two states as
    # indistinguishable outside the clamped cells themselves, that comparison is being asked to find a
    # difference the model does not have, and its failing says nothing about replay. Recorded next to the
    # verdict rather than left for the reader to work out from stage 5.
    wake_arm_is_empty = bool(manip and manip.get("state_is_distinguishable") is False)
    wake_note = ""
    if wake_arm_is_empty:
        pr = manip.get("pop_rate_relative_change")
        kr = manip.get("kc_rate_relative_change")
        nd = manip.get("n_dfb_clamped")
        wake_note = (f" One of the four, sleep against wake, is being asked to find a difference this model does not "
                     f"have: stage 5 measured clamping the {nd} dorsal fan-shaped body neurons as changing the rest of "
                     f"the brain by {100 * pr:.1f} per cent in population rate and {100 * kr:.1f} per cent in "
                     f"Kenyon-cell rate. Its failing is a fact about the manipulation, not about replay.")

    memory_note = ""
    if naive_c and naive_c.get("available"):
        reaches = bool((causal or {}).get("engram_reaches_the_kenyon_cells"))
        memory_note = (" On this measure the memory contributed nothing: the identical sleep run with unlearned "
                       "weights gave the same reactivation (learned minus unlearned = "
                       f"{naive_c['diff']:+.5f}, 95% CI [{naive_c['ci95'][0]:+.5f}, {naive_c['ci95'][1]:+.5f}]). "
                       + ("That is not because the memory does nothing offline: stage 5 compared the two runs spike "
                          "for spike and found the Kenyon-cell activity differs in every seed. It is that the "
                          "difference is not an increase in how much the trained ensemble reactivates."
                          if reaches else
                          "The learned synapses lie downstream of the Kenyon cells being measured, and stage 5 found "
                          "the offline Kenyon-cell activity identical with and without them, so there was no route "
                          "by which they could have contributed.")
                       if not naive_c["survives"] else
                       " The learned weights did increase reactivation relative to the identical run with unlearned "
                       f"weights (difference {naive_c['diff']:+.5f}, 95% CI [{naive_c['ci95'][0]:+.5f}, "
                       f"{naive_c['ci95'][1]:+.5f}]).")
    # A hard guard from stage 5. If the offline Kenyon-cell spike train is identical, spike for spike, with the
    # learned weights and without them, the memory had no causal effect on the state being measured, and no
    # comparison computed on that state can be evidence of replay however it comes out. That is checked before
    # the comparisons are read, not after, because it does not depend on them.
    disconnected = bool(causal and causal.get("engram_reaches_the_kenyon_cells") is False)
    causal_note = (" " + causal["note"] if disconnected and causal.get("note") else "")

    if disconnected:
        status = "artifact" if all_survive or others_pos else "failed"
        headline = (("All four null comparisons showed the predicted effect, but the result cannot be read as replay. "
                     if all_survive else
                     "Some comparisons showed the predicted effect, but none of them can be read as replay. "
                     if others_pos else
                     "No evidence of memory replay, and none was possible. ")
                    + causal_note.strip() + memory_note + wake_note)
    elif all_survive and not continuity["events_are_discrete"]:
        status = "artifact"
        headline = ("All four null comparisons showed the predicted effect, but the result cannot be read as replay: "
                    + continuity["note"] + memory_note + wake_note)
    elif all_survive:
        status, headline = "passed", ("The odour-A Kenyon-cell ensemble reactivated above chance during simulated sleep, and the "
                                      "effect survived all four null comparisons including the degree-preserving shuffled "
                                      "connectome." + memory_note + wake_note)
    elif others_pos and shuffled_c and shuffled_c.get("available") and not shuffled_c["survives"]:
        # "Artifact" is a claim about WHY a signal is there, and the shuffled-connectome null is the only
        # comparison that can support it. If that null's two arms sit in different states, it cannot, and
        # saying it anyway would assert a mechanism on the strength of a comparison that does not isolate one.
        # The verdict stays negative, because the four required comparisons did not all survive; what it stops
        # doing is naming a cause it has not established.
        shuffle_check = next((c for c in arm_checks if c["comparison"] == "real_vs_shuffled"), None)
        if "real_vs_shuffled" in unmatched:
            status = "failed"
            headline = ("No evidence of memory replay, and no basis for calling what was measured an artifact "
                        "either. The odour-A ensemble does score above size-matched random ensembles, but the "
                        "comparison that would say whether that is structure rather than memory, the "
                        "degree-preserving shuffled connectome, cannot answer it here. "
                        + (shuffle_check["note"] if shuffle_check else "Its two arms are not matched.")
                        + memory_note + wake_note)
        else:
            status, headline = "artifact", ("A positive reactivation signal was measured, but it did NOT survive the "
                                            "degree-preserving shuffled-connectome null: it is an artifact of network structure, "
                                            "not evidence of replay." + memory_note + wake_note)
    elif not avail:
        status, headline = "not_run", "The replay comparisons could not be computed: the required sleep and wake runs are not available."
    else:
        failed = [c["name"] for c in core if not c["survives"]]
        status, headline = "failed", (("" if continuity["events_are_discrete"] else continuity["note"] + " ") +
                                      "No evidence of memory replay: the odour-A ensemble did not reactivate above chance during "
                                      "simulated sleep. Comparisons that did not show the predicted effect: "
                                      f"{', '.join(failed) if failed else 'none'}." + memory_note + wake_note)
    for c in comparisons:
        if c.get("name") in unmatched:
            chk = next((x for x in arm_checks if x["comparison"] == c["name"]), None)
            c["arms_are_matched"] = False
            c["arms_note"] = chk["note"] if chk else "the two arms are not matched"
        elif any(x["comparison"] == c.get("name") for x in arm_checks):
            c["arms_are_matched"] = True
        dz = next((x for x in z_decomposition if x["comparison"] == c.get("name")), None)
        if dz:
            c["z_carried_by"] = dz["carried_by"]
            if dz["carried_by"] == "the null's spread" and c.get("survives"):
                c["survives_note"] = ("This comparison clears its criterion on a shrinking null rather than a "
                                      "moving effect, so it should not be read as the memory having changed the "
                                      "offline activity. See z_decomposition.")

    out_d = {"status": status, "criterion": s6["criterion"], "headline": headline,
             "engram_reaches_the_kenyon_cells": causal,
             "arm_matching": arm_checks,
             "comparisons_with_unmatched_arms": sorted(unmatched),
             "z_decomposition": z_decomposition,
             "sleep_state_is_distinguishable": (None if manip is None else manip.get("state_is_distinguishable")),
             "sleep_vs_wake_arm_note": (wake_note.strip() or
                                        "Stage 5 measured the sleep and wake states as distinguishable, so the "
                                        "sleep-versus-wake comparison is testing a difference the model has."),
             "engram_guard": {"applied": disconnected,
                              "rule": ("If stage 5 finds the offline Kenyon-cell spike train identical with and without the "
                                       "learned weights, the memory had no causal effect on the state being measured and no "
                                       "comparison computed on that state can be evidence of replay, whichever way it comes "
                                       "out. The verdict is then 'artifact' if anything looked positive and 'failed' "
                                       "otherwise, regardless of the four comparisons.")},
             "metrics": {"template_correlation": "Pearson correlation, per time bin, between the Kenyon-cell population activity vector and the odour's KC ensemble template (Tatsuno et al. 2006 template matching; bin as stated)",
                         "coactivation": "mean zero-lag pairwise correlation among ensemble members, standardised against size-matched random KC ensembles (Wilson & McNaughton 1994)",
                         "sequence": "Spearman rank correlation between within-event first-spike order and the odour-response order, with a cell-identity shuffle null (Foster & Wilson 2006)",
                         "reactivation_event": "a bin whose template correlation exceeds the 95th percentile of the size-matched random-ensemble null"},
             "continuity_check": continuity,
           "window_ms": bin_s * 1e3, "n_seeds": len(set(r["seed"] for r in rows)), "gain": a.gain,
             "gain_note": ("published parameters" if a.gain == 1.0 else
                           f"DEVIATION: every synaptic weight scaled to {a.gain} of its published value, because at the "
                           f"published value the network has neither a sparse odour code nor a quiet background (stages 2 "
                           f"and 3b). This is an uncited free parameter introduced by this project."),
             "required_four": list(FOUR),
             "additional_comparisons": list(ADDITIONAL),
             "fifth_comparison_note": ("Beyond the four pre-registered comparisons the file carries additional ones, and they are "
                                       "labelled as additional rather than counted towards the verdict. 'trained_vs_naive_weights' "
                                       "repeats the sleep run with the UNLEARNED weights at the same seed and compares the two: it "
                                       "asks whether the memory contributed anything at all, which the four required comparisons "
                                       "cannot ask because all four are computed inside the trained network. "
                                       "'trained_vs_naive_spike_share' is the same contrast read on the share of offline spikes the "
                                       "ensemble accounts for rather than on the template correlation. Neither was pre-registered, "
                                       "so neither can turn a negative verdict positive; they are reported because a reader is "
                                       "entitled to see them."),
             "comparisons": comparisons, "comparisons_raw_metric": secondary, "sequence": sequence_summary, "per_seed": rows,
             "ensemble_sizes": {n: {c: float(np.mean([r["size"] for r in rows if r["network"] == n and r["condition"] == c and r["ensemble"] == "A" and r.get("size")]))
                                    for c in ("sleep", "wake", "sleep_naive")
                                    if [r for r in rows if r["network"] == n and r["condition"] == c and r["ensemble"] == "A"]}
                                for n in sorted(set(r["network"] for r in rows))},
             "metric_note": ("The four required comparisons use z_vs_random_ensembles, each run standardised against "
                             "size-matched random Kenyon-cell ensembles drawn from that same run, because ensemble sizes "
                             "differ between odours and between the real and shuffled networks and the raw template "
                             "correlation depends on template size. comparisons_raw_metric repeats three of them on the "
                             "raw correlation so the effect of that choice can be seen."), "traces": exports["traces"], "rasters": exports["rasters"],
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
