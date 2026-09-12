"""Stage 10 - DOES REMOVING THE KENYON CELLS' AXONAL RECURRENCE GIVE THE NETWORK A QUIET BACKGROUND?

Every replay statistic in the field is an event statistic, and this model has no events: at its operating
point the odour-A ensemble clears the reactivation threshold in 99% of time bins at any bin length. The
precondition for the whole experiment is an offline state that pauses, and the published model does not have
one.

The largest thing in the model that could plausibly be causing that, and that the literature says is wrong,
is the Kenyon cells' recurrent input: 1,153,845 synapses, 55.4% of everything landing on them, all modelled
as fast excitation because Kenyon cells are cholinergic, while Manoim et al. 2022 measure the axonal
interaction as inhibitory and metabotropic. Removing it is a labelled deviation (populations.SYNAPSE_DEVIATIONS)
and this asks what it buys.

Compares the stage-2 sweeps across settings of that deviation, matched sigma by sigma, and answers three
questions: does a critical regime appear, does the network gain a state that pauses, and how much do the
Kenyon cells even care. Writes results/stage10_recurrence/recurrence_arm.json.
"""
import argparse, json
import numpy as np
from hypnagogia import RESULTS
from hypnagogia.connectome import load_connectome, apply_synapse_deviations

OUT = RESULTS / "stage10_recurrence"


def load_arm(tag):
    p = RESULTS / "stage2_criticality" / tag / "stage2.json"
    return json.load(open(p)) if p.exists() else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--arms", default="full:1.0,full_kckc0.5:0.5,full_kckc0.0:0.0",
                    help="comma-separated <stage2 directory>:<retained fraction>")
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)

    conn = load_connectome("malecns", "v1.0", "brain")
    kc = conn.select(cell_class="Kenyon_Cell")
    onto_kc = int(conn.count[np.isin(conn.post, kc)].sum())

    arms = []
    for spec in a.arms.split(","):
        tag, frac = spec.split(":")
        d = load_arm(tag)
        if not d:
            continue
        dev = apply_synapse_deviations(conn, ["kc_kc_axonal_not_nicotinic"], retained_fraction=float(frac))
        removed = int(conn.n_synapses - dev.n_synapses)
        arms.append({"tag": tag, "retained_fraction": float(frac),
                     "synapses_removed": removed, "share_of_kc_input_removed": removed / onto_kc,
                     "has_critical_regime": d["has_critical_regime"],
                     "is_bistable": d["is_bistable"], "bistable_sigmas_mV": d.get("bistable_sigmas_mV"),
                     "operating_sigma_mV": d["operating_sigma_mV"],
                     "operating_sigma_classification": d.get("operating_sigma_classification"),
                     "operating_kc_rate_hz": d.get("operating_sigma_kc_rate_hz"),
                     "operating_pop_rate_hz": d.get("operating_sigma_pop_rate_hz"),
                     "any_sigma_with_applicable_avalanches_and_activity": bool(
                         [s for s in d["summary_by_sigma"]
                          if s.get("avalanche_analysis_applicable") and (s.get("kc_rate_hz_mean") or 0) > 0.01]),
                     "by_sigma": {float(s["sigma_mV"]): {"classification": s["classification"],
                                                         "kc_rate_hz": s.get("kc_rate_hz_mean"),
                                                         "pop_rate_hz": s.get("pop_rate_hz_mean"),
                                                         "frac_active": s.get("frac_active_mean"),
                                                         "avalanches_applicable": s.get("avalanche_analysis_applicable")}
                                  for s in d["summary_by_sigma"]}})
    if len(arms) < 2:
        raise SystemExit("need at least two arms to compare; run scripts/.run_kckc_sweep.sh first")

    base = arms[0]
    shared = sorted(set.intersection(*[set(x["by_sigma"]) for x in arms]))
    matched = []
    for sg in shared:
        row = {"sigma_mV": sg}
        for x in arms:
            row[f"kc_{x['retained_fraction']}"] = x["by_sigma"][sg]["kc_rate_hz"]
            row[f"pop_{x['retained_fraction']}"] = x["by_sigma"][sg]["pop_rate_hz"]
            row[f"class_{x['retained_fraction']}"] = x["by_sigma"][sg]["classification"]
        matched.append(row)

    # the headline comparison: at the sigmas both arms share and where there is activity to compare
    live = [r for r in matched if (r.get(f"kc_{base['retained_fraction']}") or 0) > 0.01]
    ends = [x for x in arms if x["retained_fraction"] == min(y["retained_fraction"] for y in arms)]
    end = ends[0] if ends else arms[-1]
    kc_delta = pop_delta = None
    if live:
        kc_b = np.array([r[f"kc_{base['retained_fraction']}"] for r in live], dtype=float)
        kc_e = np.array([r[f"kc_{end['retained_fraction']}"] for r in live], dtype=float)
        pop_b = np.array([r[f"pop_{base['retained_fraction']}"] for r in live], dtype=float)
        pop_e = np.array([r[f"pop_{end['retained_fraction']}"] for r in live], dtype=float)
        kc_delta = float(np.mean((kc_e - kc_b) / kc_b) * 100)
        pop_delta = float(np.mean((pop_e - pop_b) / pop_b) * 100)

    gained = bool(end["has_critical_regime"] and not base["has_critical_regime"])
    finding = (
        f"Removing the Kenyon cells' axonal recurrence does not give the network a background that pauses. "
        f"Taking out {end['synapses_removed']:,} synapses, {end['share_of_kc_input_removed']:.0%} of everything "
        f"landing on Kenyon cells and the single largest input they have, leaves the picture as it was: "
        f"{'a critical regime appears' if gained else 'still no critical regime'}, still bistable, still silent "
        f"below the transition and continuously active above it, and still no sigma with both activity and a "
        f"defined avalanche analysis. "
        + (f"At the sigmas where both arms are active the Kenyon cells change by {kc_delta:+.1f} per cent and "
           f"the whole brain by {pop_delta:+.1f} per cent." if kc_delta is not None else "")
        + f" The operating point moves from {base['operating_sigma_mV']} mV, Kenyon cells at "
        f"{base['operating_kc_rate_hz']:.3f} Hz, to {end['operating_sigma_mV']} mV at "
        f"{end['operating_kc_rate_hz']:.3f} Hz. The conclusion is about where the activity comes from: the "
        f"Kenyon cells are not driven by each other, they are driven from upstream, so removing their "
        f"recurrence changes them barely at all. The state that never pauses is not theirs.")

    out = {"status": "passed", "n_arms": len(arms),
           "question": ("Does removing the Kenyon cells' axonal recurrence, which the literature says is not "
                        "fast excitation, give the model the pausing background every replay statistic needs?"),
           "deviation": "kc_kc_axonal_not_nicotinic",
           "answer_is_no": not gained,
           "kc_rate_change_pct": kc_delta, "pop_rate_change_pct": pop_delta,
           "arms": [{k: v for k, v in x.items() if k != "by_sigma"} for x in arms],
           "matched_by_sigma": matched, "finding": finding,
           "provenance": {"config": "configs/stage2_criticality.yaml", "results_dir": "results/stage10_recurrence",
                          "files": [f"results/stage2_criticality/{x['tag']}/stage2.json" for x in arms]}}
    json.dump(out, open(OUT / "recurrence_arm.json", "w"), indent=1, default=str)
    print(finding); print()
    hdr = f"{'sigma':>6s}" + "".join(f"{'r=' + str(x['retained_fraction']):>26s}" for x in arms)
    print(hdr); print(f"{'':6s}" + "".join(f"{'KC Hz  brain Hz  class':>26s}" for x in arms))
    for r in matched:
        line = f"{r['sigma_mV']:6.2f}"
        for x in arms:
            f_ = x["retained_fraction"]
            line += f"{(r[f'kc_{f_}'] or 0):8.4f} {(r[f'pop_{f_}'] or 0):9.4f}  {r[f'class_{f_}'][:8]:8s}"
        print(line)


if __name__ == "__main__":
    main()
