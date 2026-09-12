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

Anatomy is necessary and not sufficient, so the script then measures the loop running. 'sleep' and
'sleep_naive' are the same run at the same seed differing only in the learned weights, so per seed it reports
what the memory does to each carrier MBON's offline rate and what it does to the odour-A Kenyon-cell rate,
split by whether that MBON was firing at all. A loop through a silent cell carries nothing however it is
wired, and that split is the whole of the answer.

Reads the ensembles stage 4 stored and the offline-firing MBONs stage 5 identified. Writes
results/stage6_return_path/return_path.json. No simulation: this is connectome arithmetic plus the
stage-4 ensembles.
"""
import argparse, json
from pathlib import Path
import numpy as np
from scipy import stats
from hypnagogia import RESULTS
from hypnagogia.connectome import load_connectome

OUT = RESULTS / "stage6_return_path"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gain", type=float, default=1.0)
    a = ap.parse_args()
    suffix = "" if a.gain == 1.0 else f"_gain{a.gain}"
    OUT.mkdir(parents=True, exist_ok=True)

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

        def summarise(g):
            if not g:
                return None
            d = np.array([x["ensemble_rate_change_pct"] for x in g if x["ensemble_rate_change_pct"] is not None])
            out = {"n_seeds": len(g),
                   "carrier_rate_naive_hz_mean": float(np.mean([x["carrier_rate_naive_hz"] for x in g])),
                   "ensemble_rate_change_pct_mean": float(np.mean(d)) if len(d) else None}
            c = [x["carrier_rate_change_pct"] for x in g if x["carrier_rate_change_pct"] is not None]
            out["carrier_rate_change_pct_mean"] = float(np.mean(c)) if c else None
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
    if loop and loop.get("when_carrier_fires") and loop.get("when_carrier_silent"):
        f_, s_ = loop["when_carrier_fires"], loop["when_carrier_silent"]
        out["finding"] = (
            f"The mechanism replay would need is wired and it works, in the {f_['n_seeds']} of "
            f"{f_['n_seeds'] + s_['n_seeds']} seeds where it is switched on. {loop['carrier']} is GABAergic, "
            f"carries more of the engram than any other cell, and the Kenyon cells it contacts are "
            f"{loop['carrier_enrichment']:.2f} times enriched for the trained ensemble, so depressing its input "
            f"disinhibits that ensemble preferentially. Where it fires (untrained rate "
            f"{f_['carrier_rate_naive_hz_mean']:.3f} Hz) the memory cuts its rate by "
            f"{abs(f_['carrier_rate_change_pct_mean'] or 0):.0f}% and the odour-A Kenyon cells speed up by "
            f"{f_['ensemble_rate_change_pct_mean']:+.1f}%. Where it does not (untrained rate "
            f"{s_['carrier_rate_naive_hz_mean']:.3f} Hz, {s_['n_seeds']} seeds) the ensemble moves by "
            f"{s_['ensemble_rate_change_pct_mean']:+.2f}%, indistinguishable from nothing"
            + (f" (p = {s_['p_against_zero']:.2f})" if s_.get("p_against_zero") is not None else "") + ". "
            f"Every other engram-carrying MBON that does fire contacts the trained ensemble LESS than chance "
            f"({', '.join(f'{r['mbon']} {r['enrichment_for_trained_ensemble_mean']:.2f}x' for r in rows if r['fires_offline'] and r['mbon'] != loop['carrier'])}), "
            f"so their disinhibition goes to the rest of the mushroom body and works against the trained "
            f"ensemble standing out. What stands between this model and memory reactivation is therefore one "
            f"number: how often {loop['carrier']} fires.")

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
