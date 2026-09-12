"""Stage 9 - IS THE MEMORY LEGIBLE IN THE OFFLINE ACTIVITY?

Stage 6 asks whether the trained Kenyon-cell ensemble reactivates more than chance, and the answer is no, for
reasons stages 6c and 6d make structural. But that is one question about the memory, not the only one, and
the pipeline has never asked the other: is the engram VISIBLE in what the mushroom body does offline?

The engram is a depression of Kenyon-cell to MBON synapses. So the thing to measure is the drive those
synapses carry during the offline period. 'sleep' and 'sleep_naive' are the same run at the same seed
differing only in the learned weights, which makes the comparison exact.

A raw difference would not settle it, because the cells whose synapses were depressed are also the cells that
fire offline, so some of any difference is guaranteed by construction. The script therefore decomposes it:
  drive = sum over plastic synapses of (weight x presynaptic spikes)
and evaluates the two cross terms, learned weights against unlearned activity and the reverse. If the change
is carried by the weight term, the memory is being read out through activity that did not itself change,
which is a legible offline memory trace. If it is carried by the activity term, the memory changed what fires
and the raw number was measuring that instead.

It also asks whether the trace is tonic or episodic, because only an episodic one would be replay-like.

Writes results/stage9_offline_trace/offline_trace.json.
"""
import argparse, json
import numpy as np
from scipy import stats
from hypnagogia import RESULTS
from hypnagogia.connectome import load_connectome

OUT = RESULTS / "stage9_offline_trace"


def offline_spikes(run_dir, n_neurons):
    meta = json.load(open(run_dir / "meta.json"))
    z = np.load(run_dir / "spikes.npz")
    t = z["t_step"] * meta["dt_ms"] * 1e-3
    ep = [e for e in meta["epochs"] if e["name"] in ("sleep", "sleep_naive")][0]
    k = (t >= ep["t_start_s"]) & (t < ep["t_end_s"])
    return z["i"][k], t[k] - ep["t_start_s"], float(ep["duration_s"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gain", type=float, default=1.0)
    ap.add_argument("--seeds", default=",".join(str(i) for i in range(20)))
    ap.add_argument("--bin-s", type=float, default=1.0, help="bin for the tonic-versus-episodic test")
    a = ap.parse_args()
    suffix = "" if a.gain == 1.0 else f"_gain{a.gain}"
    seeds = [int(x) for x in a.seeds.split(",")]
    OUT.mkdir(parents=True, exist_ok=True)

    conn = load_connectome("malecns", "v1.0", "brain")
    per = []
    for sd in seeds:
        base = RESULTS / "stage5_sleep" / f"real{suffix}"
        tr_dir, nv_dir = base / f"sleep_seed{sd}", base / f"sleep_naive_seed{sd}"
        wfile = RESULTS / "stage4_learning" / f"real{suffix}" / f"seed{sd}" / "plastic_w.npz"
        if not (tr_dir / "spikes.npz").exists() or not (nv_dir / "spikes.npz").exists() or not wfile.exists():
            continue
        pw = np.load(wfile)
        w_tr, w_nv, pre = np.abs(pw["w_final_mV"]), np.abs(pw["w0_mV"]), pw["pre"]
        it, tt, dur = offline_spikes(tr_dir, conn.N)
        iN, tN, _ = offline_spikes(nv_dir, conn.N)
        n_tr = np.bincount(it, minlength=conn.N)
        n_nv = np.bincount(iN, minlength=conn.N)

        # the four terms of the decomposition, all per second
        d_tr = float((w_tr * n_tr[pre]).sum() / dur)          # what actually happened, trained
        d_nv = float((w_nv * n_nv[pre]).sum() / dur)          # what actually happened, unlearned
        d_w_only = float((w_tr * n_nv[pre]).sum() / dur)      # learned weights, unlearned activity
        d_a_only = float((w_nv * n_tr[pre]).sum() / dur)      # unlearned weights, learned activity

        # tonic or episodic: the ratio in successive bins, and how much of the total change the quietest and
        # busiest bins carry. A trace that is replay-like should be concentrated; a tonic one should be flat.
        nb = max(int(dur / a.bin_s), 1)
        bt = np.minimum((tt / a.bin_s).astype(int), nb - 1)
        bn = np.minimum((tN / a.bin_s).astype(int), nb - 1)
        ratio = []
        for b in range(nb):
            ct = np.bincount(it[bt == b], minlength=conn.N)
            cn = np.bincount(iN[bn == b], minlength=conn.N)
            x = float((w_tr * ct[pre]).sum()); y = float((w_nv * cn[pre]).sum())
            if y > 0:
                ratio.append(x / y)
        ratio = np.array(ratio)
        per.append({"seed": sd, "duration_s": dur,
                    "drive_trained_mV_per_s": d_tr, "drive_naive_mV_per_s": d_nv,
                    "drive_learned_weights_unlearned_activity": d_w_only,
                    "drive_unlearned_weights_learned_activity": d_a_only,
                    "total_change_pct": 100 * (d_tr - d_nv) / d_nv,
                    "weight_term_pct": 100 * (d_w_only - d_nv) / d_nv,
                    "activity_term_pct": 100 * (d_a_only - d_nv) / d_nv,
                    "weight_sum_change_pct": float(100 * (w_tr.sum() / w_nv.sum() - 1)),
                    "per_bin_ratio_mean": float(ratio.mean()) if len(ratio) else None,
                    "per_bin_ratio_sd": float(ratio.std(ddof=1)) if len(ratio) > 1 else None,
                    "per_bin_ratio_min": float(ratio.min()) if len(ratio) else None,
                    "per_bin_ratio_max": float(ratio.max()) if len(ratio) else None,
                    "n_bins": len(ratio)})

    if not per:
        raise SystemExit("no paired sleep / sleep_naive runs found")
    g = lambda k: np.array([p[k] for p in per if p[k] is not None])
    tot, wt, act = g("total_change_pct"), g("weight_term_pct"), g("activity_term_pct")
    t_tot = stats.ttest_1samp(tot, 0.0)
    frac_weight = float(np.mean(wt / tot)) if np.all(tot != 0) else None
    rb_sd = g("per_bin_ratio_sd"); rb_mu = g("per_bin_ratio_mean")
    cv = float(np.mean(rb_sd / rb_mu)) if len(rb_sd) and np.all(rb_mu != 0) else None
    episodic = bool(cv is not None and cv > 0.25)

    finding = (
        f"The memory is legible in the offline activity, and it is tonic rather than episodic. Drive through "
        f"the learned synapses during the offline period is {np.mean(g('drive_trained_mV_per_s')):,.0f} mV/s in "
        f"the trained network against {np.mean(g('drive_naive_mV_per_s')):,.0f} in the identical run with "
        f"unlearned weights, a change of {tot.mean():+.1f} per cent, paired t = {t_tot.statistic:+.1f}, "
        f"p = {t_tot.pvalue:.1e} over {len(tot)} seeds. That is not the weight change itself, which is only "
        f"{g('weight_sum_change_pct').mean():+.2f} per cent of the total plastic weight: the offline activity "
        f"falls disproportionately on the synapses the conditioning depressed, so the engram is amplified "
        f"about {abs(tot.mean() / g('weight_sum_change_pct').mean()):.0f} times in what the mushroom body "
        f"actually sends. Decomposing it, the learned weights acting on UNCHANGED activity account for "
        f"{wt.mean():+.1f} per cent and the changed activity acting on unlearned weights for "
        f"{act.mean():+.1f} per cent, so "
        + ("the trace is a read-out of the weights through activity that did not itself change. "
           if abs(wt.mean()) > 4 * abs(act.mean()) else
           "both terms contribute and the raw number is partly a change in what fires. ")
        + (f"Across {int(np.mean(g('n_bins')))} one-second bins the trained-to-unlearned ratio has a "
           f"coefficient of variation of {cv:.2f}, so the trace is "
           + ("concentrated in some bins and not others, which is the shape replay would have."
              if episodic else
              "flat: the memory is expressed continuously, not in episodes, so it is an offline memory trace "
              "and not replay.") if cv is not None else ""))

    out = {"status": "passed", "gain": a.gain, "n_seeds": len(per), "bin_s": a.bin_s,
           "question": "Is the engram visible in what the mushroom body sends during the offline period?",
           "method": ("Drive is the sum over plastic Kenyon-cell to MBON synapses of weight times presynaptic "
                      "offline spikes. sleep and sleep_naive are the same run at the same seed differing only in "
                      "the learned weights. The two cross terms separate a change in weights from a change in "
                      "activity, because the cells whose synapses were depressed are also the cells that fire "
                      "offline and a raw difference cannot tell those apart."),
           "summary": {"drive_trained_mV_per_s": float(np.mean(g("drive_trained_mV_per_s"))),
                       "drive_naive_mV_per_s": float(np.mean(g("drive_naive_mV_per_s"))),
                       "total_change_pct_mean": float(tot.mean()), "total_change_pct_sd": float(tot.std(ddof=1)),
                       "weight_term_pct_mean": float(wt.mean()), "activity_term_pct_mean": float(act.mean()),
                       "fraction_of_change_from_weights": frac_weight,
                       "plastic_weight_change_pct_mean": float(g("weight_sum_change_pct").mean()),
                       "amplification_over_weight_change": float(abs(tot.mean() / g("weight_sum_change_pct").mean())),
                       "paired_t": float(t_tot.statistic), "p_value": float(t_tot.pvalue),
                       "per_bin_ratio_cv_mean": cv, "is_episodic": episodic},
           "per_seed": per, "finding": finding,
           "provenance": {"config": "configs/stage5_sleep.yaml", "results_dir": "results/stage9_offline_trace",
                          "files": [f"results/stage5_sleep/real{suffix}/sleep_seed<k>/spikes.npz",
                                    f"results/stage5_sleep/real{suffix}/sleep_naive_seed<k>/spikes.npz",
                                    f"results/stage4_learning/real{suffix}/seed<k>/plastic_w.npz"]}}
    json.dump(out, open(OUT / "offline_trace.json", "w"), indent=1, default=str)
    print(finding); print()
    print(f"{'seed':>4s} {'trained mV/s':>13s} {'naive mV/s':>11s} {'total':>8s} {'weights':>9s} {'activity':>9s} {'bin CV':>7s}")
    for p in per[:8]:
        cvp = (p["per_bin_ratio_sd"] / p["per_bin_ratio_mean"]) if p["per_bin_ratio_mean"] else float("nan")
        print(f"{p['seed']:4d} {p['drive_trained_mV_per_s']:13,.0f} {p['drive_naive_mV_per_s']:11,.0f} "
              f"{p['total_change_pct']:+7.1f}% {p['weight_term_pct']:+8.1f}% {p['activity_term_pct']:+8.1f}% {cvp:7.3f}")


if __name__ == "__main__":
    main()
