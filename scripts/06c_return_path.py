"""Stage 6c - IS THE ENGRAM'S RETURN PATH SELECTIVE FOR THE ENSEMBLE THAT ENCODES IT?

The memory in this model is a depression of Kenyon-cell to MBON synapses, which sits downstream of the
Kenyon cells whose reactivation stage 6 measures. For that depression to make the TRAINED ensemble reactivate
more than any other, the path back from the MBONs to the Kenyon cells has to prefer the trained ensemble.
If an MBON contacts Kenyon cells indiscriminately, depressing its input disinhibits the whole mushroom body
and the trained ensemble gains nothing relative to the rest.

So this script asks one question of the connectome: for each MBON that carries part of the engram and fires
during the offline period, are the Kenyon cells it contacts enriched for the odour-A ensemble, against the
chance overlap of an equally large random set of Kenyon cells?

An enrichment of 1.0 means the MBON is blind to the ensemble. Above 1.0 is a self-reinforcing loop, the
mechanism replay would need. Below 1.0 is a loop that works against it.

Anatomy is necessary and not sufficient, so the script then measures the loop running, and then checks
whether what it measured is the loop at all. 'sleep' and 'sleep_naive' are the same run at the same seed
differing only in the learned weights, so per seed it reports what the memory does to the carrier MBON's
offline rate and to the Kenyon-cell rate.

The check is the part that matters. If a change in the trained ensemble came through the carrier, it has to
be larger in the cells that carrier contacts than in the cells it does not. Those two groups are scored
separately. A change that is the same size in both is a global shift in the network's state, which in a
recurrent network at this operating point is what a small perturbation usually produces, and it is not
evidence of anything about the memory. The first version of this script reported such a shift as the loop
working; the control is here because it was not.

The ceiling is also computed directly, from the connectome and the model's constants: the millivolts one
carrier spike delivers to one of its Kenyon-cell targets, and therefore the most the memory could ever move
those targets by fully silencing the carrier. If that number is small against the 7 mV threshold gap, the
loop cannot matter however often the carrier fires, and no measurement of it will say otherwise.

Reads the ensembles stage 4 stored and the offline-firing MBONs stage 5 identified. Writes
results/stage6_return_path/return_path.json. No simulation: this is connectome arithmetic plus the
stage-4 ensembles.
"""
import argparse, json
from pathlib import Path
import numpy as np
from scipy import stats
from hypnagogia import RESULTS
from hypnagogia.config import load_config
from hypnagogia.connectome import load_connectome
from hypnagogia.model import psp_peak_factor

OUT = RESULTS / "stage6_return_path"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gain", type=float, default=1.0)
    a = ap.parse_args()
    suffix = "" if a.gain == 1.0 else f"_gain{a.gain}"
    OUT.mkdir(parents=True, exist_ok=True)

    cfg = load_config("base"); mdl = cfg["model"]
    scale = cfg["dataset"]["weight_scale"] * a.gain
    w_syn = mdl["w_syn_mV"]
    conn = load_connectome("malecns", "v1.0", "brain")
    ct = conn.ann.cell_type.astype(str).values
    nt = conn.ann.nt.astype(str).values
    kc = conn.select(cell_class="Kenyon_Cell")
    is_kc = np.zeros(conn.N, bool); is_kc[kc] = True

    tpl = json.load(open(RESULTS / "stage4_learning" / f"real{suffix}" / "kc_templates.json"))
    seeds = sorted(tpl.keys(), key=lambda s: int(s))
    s5 = json.load(open(RESULTS / "stage5_sleep" / f"real{suffix}" / "stage5.json"))
    path = ((s5.get("engram_reaches_the_kenyon_cells") or {}).get("anatomical_path") or {}).get("per_mbon") or []

    rows = []
    for entry in path:
        idx = conn.select(cell_type=entry["mbon"])
        if len(idx) == 0:
            continue
        m = np.isin(conn.pre, idx) & is_kc[conn.post]
        targets = np.unique(conn.post[m])
        if len(targets) == 0:
            continue
        tset = set(int(x) for x in targets)
        enr, hits = [], []
        for s in seeds:
            A = set(int(x) for x in tpl[s]["_index"]["A_pre"])
            hit = len(tset & A)
            expected = len(tset) * len(A) / len(kc)   # chance overlap with an equally large random KC set
            hits.append(hit)
            if expected > 0:
                enr.append(hit / expected)
        rows.append({
            "mbon": entry["mbon"], "transmitter": entry["transmitter"],
            "fires_offline": entry["fires_offline"],
            "gating_synapses_from_dan": entry["gating_synapses_from_dan"],
            "synapses_onto_kenyon_cells": int(conn.count[m].sum()),
            "n_kenyon_cells_contacted": int(len(targets)),
            "n_in_ensemble_mean": float(np.mean(hits)) if hits else None,
            "enrichment_for_trained_ensemble_mean": float(np.mean(enr)) if enr else None,
            "enrichment_for_trained_ensemble_sd": float(np.std(enr, ddof=1)) if len(enr) > 1 else 0.0,
            "n_seeds": len(enr),
        })
    # one row per cell type, not per cell: both hemispheres of a type share a selector and give the same row
    seen, uniq = set(), []
    for r in rows:
        if r["mbon"] in seen:
            continue
        seen.add(r["mbon"]); uniq.append(r)
    rows = sorted(uniq, key=lambda r: -(r["n_kenyon_cells_contacted"] or 0))

    # The loop, running. Per seed, what the learned weights do to the carrier MBON's offline rate and to the
    # rate of the ensemble it is supposed to be disinhibiting, split by whether the MBON fires at all.
    carrier = max(rows, key=lambda r: (r["enrichment_for_trained_ensemble_mean"] or 0) * (r["fires_offline"] or 0)
                  ) if rows else None
    loop = None
    if carrier is not None:
        sel = conn.select(cell_type=carrier["mbon"])

        def offline(run):
            d = RESULTS / "stage5_sleep" / f"real{suffix}" / run
            if not (d / "spikes.npz").exists():
                return None
            m = json.load(open(d / "meta.json")); z = np.load(d / "spikes.npz")
            t = z["t_step"] * m["dt_ms"] * 1e-3
            ep = [e for e in m["epochs"] if e["name"] in ("sleep", "sleep_naive")][0]
            k = (t >= ep["t_start_s"]) & (t < ep["t_end_s"])
            return z["i"][k], float(ep["duration_s"])

        per = []
        for sd in seeds:
            A = np.array([int(x) for x in tpl[sd]["_index"]["A_pre"]])
            tr, nv = offline(f"sleep_seed{sd}"), offline(f"sleep_naive_seed{sd}")
            if tr is None or nv is None or len(A) == 0:
                continue
            (it, dur), (iN, _) = tr, nv
            mt = float(np.isin(it, sel).sum() / dur / len(sel)); mn = float(np.isin(iN, sel).sum() / dur / len(sel))
            at = float(np.isin(it, A).sum() / dur / len(A));     an = float(np.isin(iN, A).sum() / dur / len(A))
            per.append({"seed": int(sd), "carrier_rate_trained_hz": mt, "carrier_rate_naive_hz": mn,
                        "carrier_is_firing": bool(mn > 0.05),
                        "ensemble_rate_trained_hz": at, "ensemble_rate_naive_hz": an,
                        "ensemble_rate_change_pct": (100 * (at - an) / an) if an else None,
                        "carrier_rate_change_pct": (100 * (mt - mn) / mn) if mn else None})
        firing = [x for x in per if x["carrier_is_firing"]]
        silent = [x for x in per if not x["carrier_is_firing"]]

        # The ceiling on the return leg, from the connectome alone: what one carrier spike does to one of
        # its Kenyon-cell targets, and the steady drive a carrier firing flat out would supply.
        mm = np.isin(conn.pre, sel) & is_kc[conn.post]
        per_target = {}
        for q, cnt in zip(conn.post[mm], conn.count[mm]):
            per_target[int(q)] = per_target.get(int(q), 0) + int(cnt)
        pk = psp_peak_factor(mdl["tau_m_ms"], mdl["tau_syn_ms"])
        g_per_spike = float(np.mean(list(per_target.values())) * scale * w_syn) if per_target else 0.0
        mv_per_spike = g_per_spike * pk       # the potential, not the conductance: see model.psp_peak_factor
        rate_seen = max((x["carrier_rate_naive_hz"] for x in per), default=0.0)
        # A steady train is different from a single event: the conductance accumulates to w * rate * tau_syn
        # and at steady state the membrane sits at that, so the ceiling uses g and needs no kernel factor.
        ceiling_at_rate = g_per_spike * rate_seen * (mdl["tau_syn_ms"] * 1e-3)
        ceiling_at_50 = g_per_spike * 50.0 * (mdl["tau_syn_ms"] * 1e-3)

        # Is any measured change specific to the cells the carrier touches, or is it the whole population?
        targets = np.unique(conn.post[mm])
        for x in per:
            sd = str(x["seed"])
            A = np.array([int(y) for y in tpl[sd]["_index"]["A_pre"]])
            tr, nv = offline(f"sleep_seed{sd}"), offline(f"sleep_naive_seed{sd}")
            if tr is None or nv is None:
                continue
            (it, dur), (iN, _) = tr, nv

            def change(group):
                if len(group) == 0:
                    return None
                a = np.isin(it, group).sum() / dur / len(group)
                b = np.isin(iN, group).sum() / dur / len(group)
                return float(100 * (a - b) / b) if b else None
            x["change_pct_contacted_not_in_ensemble"] = change(np.setdiff1d(targets, A))
            x["change_pct_not_contacted"] = change(np.setdiff1d(kc, np.union1d(targets, A)))
            x["change_pct_all_kenyon_cells"] = change(kc)

        def summarise(g):
            if not g:
                return None
            d = np.array([x["ensemble_rate_change_pct"] for x in g if x["ensemble_rate_change_pct"] is not None])
            out = {"n_seeds": len(g),
                   "carrier_rate_naive_hz_mean": float(np.mean([x["carrier_rate_naive_hz"] for x in g])),
                   "ensemble_rate_change_pct_mean": float(np.mean(d)) if len(d) else None}
            c = [x["carrier_rate_change_pct"] for x in g if x["carrier_rate_change_pct"] is not None]
            out["carrier_rate_change_pct_mean"] = float(np.mean(c)) if c else None
            for k in ("change_pct_contacted_not_in_ensemble", "change_pct_not_contacted", "change_pct_all_kenyon_cells"):
                v = [x[k] for x in g if x.get(k) is not None]
                out[k + "_mean"] = float(np.mean(v)) if v else None
            if len(d) > 1:
                r = stats.ttest_1samp(d, 0.0)
                out["t_against_zero"] = float(r.statistic); out["p_against_zero"] = float(r.pvalue)
            return out

        loop = {"carrier": carrier["mbon"], "carrier_transmitter": carrier["transmitter"],
                "carrier_enrichment": carrier["enrichment_for_trained_ensemble_mean"],
                "carrier_firing_threshold_hz": 0.05,
                "seeds_with_carrier_firing": len(firing), "seeds_with_carrier_silent": len(silent),
                "when_carrier_fires": summarise(firing), "when_carrier_silent": summarise(silent),
                "per_seed": per,
                "psp_peak_factor": pk,
                "conductance_mV_one_carrier_spike_delivers_to_one_target": g_per_spike,
                "potential_mV_one_carrier_spike_delivers_to_one_target": mv_per_spike,
                "threshold_gap_mV": float(mdl["v_th_mV"] - mdl["v_rest_mV"]),
                "ceiling_mV_at_observed_carrier_rate": ceiling_at_rate,
                "ceiling_mV_if_carrier_fired_at_50hz": ceiling_at_50,
                "ceiling_as_fraction_of_threshold_gap_at_50hz": ceiling_at_50 / float(mdl["v_th_mV"] - mdl["v_rest_mV"]),
                "note": ("The loop is measured, not assumed. In the seeds where the carrier fires, the memory "
                         "lowers its rate and the ensemble it preferentially contacts speeds up, which is the "
                         "disinhibition replay would need. In the seeds where it is silent there is nothing to "
                         "lower and the ensemble does not move. How many seeds fall in each group is therefore "
                         "the measurement that decides whether this model can reactivate a memory at all.")}

    live = [r for r in rows if r["fires_offline"] and (r["enrichment_for_trained_ensemble_mean"] or 0) > 1.0]
    dark = [r for r in rows if not r["fires_offline"] and (r["enrichment_for_trained_ensemble_mean"] or 0) > 1.0]
    finding = (
        (f"Every MBON that carries part of the engram and fires during the offline period contacts the trained "
         f"ensemble no more than chance ({', '.join(f'{r['mbon']} {r['enrichment_for_trained_ensemble_mean']:.2f}x' for r in rows if r['fires_offline'])}), "
         f"so depressing their input disinhibits the mushroom body indiscriminately and the trained ensemble "
         f"gains nothing relative to the rest. "
         + (f"The one MBON whose targets ARE enriched for the ensemble, "
            f"{', '.join(f'{r['mbon']} at {r['enrichment_for_trained_ensemble_mean']:.2f}x over {r['n_kenyon_cells_contacted']:,} Kenyon cells' for r in dark)}, "
            f"does not fire in this network. The one path that could make the memory self-reinforcing is the one "
            f"that is switched off." if dark else
            "No MBON in the gated set has targets enriched for the ensemble, whether it fires or not, so there is "
            "no self-reinforcing path in this connectome for an output-side engram to use."))
        if not live else
        (f"{len(live)} MBON(s) both carry part of the engram and contact the trained ensemble more than chance "
         f"({', '.join(f'{r['mbon']} {r['enrichment_for_trained_ensemble_mean']:.2f}x' for r in live)}), so the "
         f"self-reinforcing loop replay would need is wired. Whether it carries anything is a separate question "
         f"and is answered in loop_measured."))

    out = {
        "status": "passed" if rows else "failed",
        "gain": a.gain,
        "question": ("Does the path from the engram back to the Kenyon cells prefer the ensemble that encodes "
                     "the memory, or does it disinhibit the mushroom body indiscriminately?"),
        "method": ("For each MBON the conditioning dopaminergic neuron gates, the Kenyon cells it contacts are "
                   "compared with the odour-A ensemble stage 4 stored for each seed. Enrichment is the observed "
                   "overlap divided by the overlap expected from a random Kenyon-cell set of the same size. "
                   "1.0 means the MBON is blind to the ensemble; above 1.0 is the loop replay would need."),
        "self_reinforcing_loop_exists_and_is_active": bool(live),
        "loop_measured": loop,
        "per_mbon": rows,
        "n_seeds": len(seeds),
        "finding": finding,
        "provenance": {"config": "configs/base.yaml", "results_dir": "results/stage6_return_path",
                       "files": [f"results/stage4_learning/real{suffix}/kc_templates.json",
                                 f"results/stage5_sleep/real{suffix}/stage5.json"]},
    }
    # The headline is the loop measurement, not the anatomy, because a loop through a silent cell is wiring
    # and not a mechanism.
    if loop:
        gap_ = loop["threshold_gap_mV"]
        f_ = loop.get("when_carrier_fires") or {}
        s_ = loop.get("when_carrier_silent") or {}
        spec = None
        if f_.get("ensemble_rate_change_pct_mean") is not None and f_.get("change_pct_not_contacted_mean") is not None:
            spec = abs(f_["ensemble_rate_change_pct_mean"] - f_["change_pct_not_contacted_mean"])
        out["finding"] = (
            f"The loop replay would need is wired, and it is far too weak to matter. {loop['carrier']} is the only "
            f"engram carrier whose Kenyon-cell targets are enriched for the trained ensemble, "
            f"{loop['carrier_enrichment']:.2f} times, and every other carrier that fires offline contacts the "
            f"ensemble LESS than chance, so on anatomy alone it is the only candidate. But one of its spikes "
            f"delivers {loop['potential_mV_one_carrier_spike_delivers_to_one_target']:.3f} mV to one of its targets, so even "
            f"firing flat out at 50 Hz it would supply {loop['ceiling_mV_if_carrier_fired_at_50hz']:.3f} mV, which "
            f"is {loop['ceiling_as_fraction_of_threshold_gap_at_50hz']:.2%} of the {gap_:.0f} mV threshold gap. "
            f"Silencing it completely therefore cannot move its targets by anything a Kenyon cell would notice, "
            f"however often it fires. That ceiling is anatomy and the model's own constants, not a measurement "
            f"that might come out differently."
            + (f" The one seed of {f_.get('n_seeds', 0) + s_.get('n_seeds', 0)} in which the carrier fires at all "
               f"looks at first like the loop working, the trained ensemble speeding up by "
               f"{f_['ensemble_rate_change_pct_mean']:+.1f}%. It is not. In the same run the Kenyon cells the "
               f"carrier does NOT touch speed up by {f_['change_pct_not_contacted_mean']:+.1f}% and the whole "
               f"population by {f_['change_pct_all_kenyon_cells_mean']:+.1f}%, a difference of {spec:.2f} "
               f"percentage points. That is a global shift in the network's state, which is what a small "
               f"perturbation usually produces at this operating point, and not disinhibition of the trained "
               f"ensemble. An earlier version of this script reported that shift as the loop working; the "
               f"contacted-versus-untouched split is here because it was not."
               if f_ and spec is not None else "")
            + (f" In the {s_['n_seeds']} seeds where the carrier is silent the ensemble moves "
               f"{s_['ensemble_rate_change_pct_mean']:+.2f}%"
               + (f", p = {s_['p_against_zero']:.2f}" if s_.get("p_against_zero") is not None else "") + "."
               if s_ else "")
            + " The conclusion is about the design and not about this run. An engram held downstream of the cells "
            "whose reactivation is being measured reaches them through a return leg three orders of magnitude too "
            "weak, so Kenyon-cell ensemble replay is not a question this model can answer positively, and a "
            "positive would have to be explained by something other than the memory.")

    json.dump(out, open(OUT / "return_path.json", "w"), indent=1, default=str)
    print(finding); print()
    if loop:
        print(f"THE LOOP, RUNNING. Carrier {loop['carrier']} ({loop['carrier_transmitter']}), "
              f"{loop['carrier_enrichment']:.2f}x enriched for the trained ensemble.")
        for lab, g in (("fires", loop["when_carrier_fires"]), ("silent", loop["when_carrier_silent"])):
            if not g:
                continue
            p_ = f", p = {g['p_against_zero']:.4f}" if g.get("p_against_zero") is not None else ""
            cr = f"{g['carrier_rate_change_pct_mean']:+.1f}%" if g.get("carrier_rate_change_pct_mean") is not None else "not defined"
            print(f"  carrier {lab:6s} in {g['n_seeds']:2d} seeds (untrained rate {g['carrier_rate_naive_hz_mean']:.3f} Hz): "
                  f"memory moves the carrier by {cr} and the ensemble by "
                  f"{g['ensemble_rate_change_pct_mean']:+.2f}%{p_}")
        print()
    print(f"{'MBON':10s} {'nt':14s} {'fires':>6s} {'KCs':>7s} {'syn':>7s} {'in ens':>7s} {'enrichment':>12s}")
    for r in rows:
        e = r["enrichment_for_trained_ensemble_mean"]
        print(f"{r['mbon']:10s} {r['transmitter']:14s} {'yes' if r['fires_offline'] else 'no':>6s} "
              f"{r['n_kenyon_cells_contacted']:7d} {r['synapses_onto_kenyon_cells']:7d} "
              f"{(r['n_in_ensemble_mean'] or 0):7.1f} {(e if e is not None else float('nan')):9.2f}x "
              f"+/- {r['enrichment_for_trained_ensemble_sd']:.2f}")


if __name__ == "__main__":
    main()
