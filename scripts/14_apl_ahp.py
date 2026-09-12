"""Stage 14 - THE MUSHROOM BODY'S OWN SLOW VARIABLE, with a measured time constant.

Stage 12 showed that a slow variable makes episodes possible but both its constants were invented. Stage 13
used a mechanism whose constants are measured and found that applying it where it was measured does nothing
offline, and that extrapolating it to the antennal-lobe loop removes the runaway and the Kenyon-cell activity
together, leaving nothing in the mushroom body to reactivate.

This stage puts the slow variable in the mushroom body itself, where the memory is, using a time constant
that is measured in exactly the cell it is applied to.

    Chen CC, Huang YC, Ortega A, Suarez-Grimalt R, Tedre E, Baz ES, Wu Y, Lin AC, Liu S (2026)
    "Sleep facilitates pattern separation through SK channel-mediated sparse coding"
    Current Biology 36(7):1633-1643.e6, PMID 41844155, PMC13075853

    "The decay time constant of the enhanced AHP is 491.1 +/- 72.17 ms (mean +/- SEM)"

That is an SK-channel afterhyperpolarisation in APL, the mushroom body's single feedback inhibitory neuron,
recorded whole-cell in an adult ex vivo brain. It is a sleep mechanism: sleep deprivation enhances it and
recovery sleep reduces it. The same recordings independently confirm the correction this project already
applies to APL, that it is non-spiking and graded.

Why this is the right place for it. APL is the gain control on Kenyon-cell sparseness. A slow
hyperpolarisation on APL is a delayed release of that gain: Kenyon cells fire, APL is driven, APL slowly
hyperpolarises itself, its inhibition falls, Kenyon cells are released, and the loop closes with a lag of
about half a second. A bistable switch with a slow negative feedback on the loop that makes it bistable is a
relaxation oscillator, and half a second is inside the 0.67 to 2 s period of the up and down states
Raccuglia et al. measured in a sleeping fly.

What is NOT measured is the magnitude: no amplitude for the APL afterhyperpolarisation appears anywhere in
that paper, in mV or in nS. So the gain is SCANNED and reported as a range, never chosen. The time constant
is held at the measured value and is also run at the edges of its own reported error bar.

Writes results/stage14_apl_ahp/.
"""
import argparse, json
import numpy as np
from hypnagogia import RESULTS
from hypnagogia.config import load_config, dump_config
from hypnagogia.connectome import load_connectome
from hypnagogia.jobs import run_jobs
from hypnagogia.populations import MECHANISM_DEVIATIONS, POPULATIONS, SLEEP_OBSERVABLES

OUT = RESULTS / "stage14_apl_ahp"
DEV = MECHANISM_DEVIATIONS["apl_slow_ahp"]
TAU_MEASURED = DEV["constants"]["tau_ms"]["value"]
TAU_SEM = DEV["constants"]["tau_ms"]["sem"]
BANNER = ("LABELLED DEVIATION, NOT THE PUBLISHED MODEL. APL carries a slow afterhyperpolarisation. Its time "
          f"constant is the measured {TAU_MEASURED} +/- {TAU_SEM} ms of " + DEV["measurement"] + " Its "
          "magnitude is NOT measured and is scanned. " + DEV["why_it_is_a_deviation_and_not_a_correction"])


def build(cfg, s5, sd, tau_ms, gain, apl_idx, out_dir, duration_s, sigma, depression=None):
    c = json.loads(json.dumps(cfg))
    c["noise"] = {"mode": "gaussian" if sigma > 0 else "none", "sigma_mV": sigma, "poisson": cfg["noise"]["poisson"]}
    c["slow_ahp"] = {"tau_ms": float(tau_ms), "gain": float(gain),
                     "index": [int(x) for x in apl_idx], "deviation": "apl_slow_ahp",
                     "tau_is": "measured", "gain_is": "scanned"}
    if depression is not None:
        c["depression"] = depression
    wfile = RESULTS / "stage4_learning" / "real" / f"seed{sd}" / "plastic_w.npz"
    return {"out_dir": str(out_dir), "seed": 900 + sd, "config": c, "name": f"ahp_{tau_ms:g}_{gain:g}_{sd}",
            "connectome": {"dataset": "malecns", "version": "v1.0", "scope": "brain",
                           "weight_scale": cfg["dataset"]["weight_scale"]},
            "drive_groups": {"dfb": {"selector": POPULATIONS[s5["dfb_population"]]["selector"]}},
            "record": "all", "init_plastic_w": str(wfile), "plasticity": None,
            "epochs": [{"name": "warmup", "duration_s": s5["warmup_s"], "drives": {"dfb": s5["dfb_clamp_rate_hz"]},
                        "reset": True},
                       {"name": "sleep", "duration_s": duration_s, "drives": {"dfb": s5["dfb_clamp_rate_hz"]}}]}


def main():
    import importlib.util
    from pathlib import Path
    spec = importlib.util.spec_from_file_location("s12", Path(__file__).with_name("12_adaptation.py"))
    s12 = importlib.util.module_from_spec(spec); spec.loader.exec_module(s12)

    ap = argparse.ArgumentParser()
    ap.add_argument("--gains", default="0.25,0.5,1,2,4",
                    help="the UNSOURCED constant. Scanned, never chosen: no amplitude for the APL "
                         "afterhyperpolarisation is printed anywhere in the paper the time constant comes from.")
    ap.add_argument("--taus-ms", default=None,
                    help=f"default: the measured {TAU_MEASURED} ms and the two edges of its reported SEM")
    ap.add_argument("--seeds", default="0")
    ap.add_argument("--duration-s", type=float, default=20.0)
    ap.add_argument("--sigma", type=float, default=None)
    ap.add_argument("--with-depression", default=None, metavar="SCOPE:F:TAU_MS",
                    help="also switch on stage 13's depression, to test the mushroom body's slow variable in "
                         "a brain whose antennal-lobe runaway has been removed. Both deviations are then "
                         "labelled on every output.")
    ap.add_argument("--tag", default="scan")
    a = ap.parse_args()
    gains = [float(x) for x in a.gains.split(",")]
    taus = ([float(x) for x in a.taus_ms.split(",")] if a.taus_ms
            else [TAU_MEASURED - TAU_SEM, TAU_MEASURED, TAU_MEASURED + TAU_SEM])
    seeds = [int(x) for x in a.seeds.split(",")]
    OUT.mkdir(parents=True, exist_ok=True)

    cfg = load_config("stage5_sleep"); s5 = cfg["stage5"]
    dump_config(cfg, OUT / "config.resolved.yaml")
    conn = load_connectome(dataset="malecns", version="v1.0", scope="brain",
                           weight_scale=cfg["dataset"]["weight_scale"])
    apl = conn.select(**POPULATIONS["APL"]["selector"])
    groups = {"brain": np.arange(conn.N, dtype=np.int64), "KC": conn.select(cell_class="Kenyon_Cell"),
              "ALLN": conn.select(cell_class="ALLN"), "ALPN": conn.select(cell_class="ALPN"),
              "MBON": conn.select(cell_class="MBON")}
    tpl = json.load(open(RESULTS / "stage4_learning" / "real" / "kc_templates.json"))
    sigma = a.sigma if a.sigma is not None else float(
        json.load(open(RESULTS / "stage5_sleep" / "real" / "stage5.json"))["sigma_mV"])

    dep = None
    if a.with_depression:
        spec13 = importlib.util.spec_from_file_location("s13", Path(__file__).with_name("13_depression.py"))
        s13 = importlib.util.module_from_spec(spec13); spec13.loader.exec_module(s13)
        scope_name, f_str, tau_str = a.with_depression.split(":")
        sc = s13.scopes(conn)[scope_name]
        dep = {"f": float(f_str), "tau_ms": float(tau_str), "scope": scope_name,
               "pre_idx": [int(x) for x in sc["pre"]], "post_idx": [int(x) for x in sc["post"]]}

    banner = BANNER + ("" if dep is None else " ALSO CARRIES stage 13's depression deviation, scope arm "
                                              f"{dep['scope']}, f={dep['f']}, tau={dep['tau_ms']} ms.")
    print(banner, flush=True)
    print(f"APL cells with the afterhyperpolarisation: {len(apl)}", flush=True)

    specs, meta = [], []
    for tau in taus:
        for g in gains:
            for sd in seeds:
                d = OUT / f"{a.tag}_t{tau:g}_g{g:g}_seed{sd}"
                specs.append(build(cfg, s5, sd, tau, g, apl, d, a.duration_s, sigma, depression=dep))
                meta.append({"tau_ms": tau, "gain": g, "seed": sd, "dir": d,
                             "tau_is_measured": bool(abs(tau - TAU_MEASURED) < 1e-9)})

    res = run_jobs(specs, n_parallel=cfg["run"]["n_parallel"])
    rows = []
    for mm, r in zip(meta, res):
        base = {k: v for k, v in mm.items() if k != "dir"}
        if r is None or "error" in r:
            rows.append({**base, "error": (r or {}).get("error", "")[-300:]})
            continue
        ens = np.array([int(x) for x in tpl[str(mm["seed"])]["_index"]["A_pre"]])
        try:
            rows.append({**base, "pop": s12.score(mm["dir"], groups, ens)})
        except Exception as e:
            rows.append({**base, "error": f"{type(e).__name__}: {e}"})

    ok = [r for r in rows if "error" not in r]

    def episodic(r, pop):
        p = r["pop"].get(pop, {})
        return bool(0.02 <= p.get("frac_on", 0) <= 0.95 and p.get("n_episodes", 0) >= 3
                    and not p.get("one_way") and not p.get("too_sparse"))

    r5 = SLEEP_OBSERVABLES["r5_slow_wave"]
    lo_s, hi_s = r5["period_s"]
    for r in ok:
        p = r["pop"].get("ensemble", {})
        n = p.get("n_episodes", 0)
        r["ensemble_episode_period_s"] = float(a.duration_s / n) if n else None
        r["ensemble_period_in_measured_band"] = bool(episodic(r, "ensemble") and n
                                                     and lo_s <= a.duration_s / n <= hi_s)
    ens_ep = [r for r in ok if episodic(r, "ensemble")]
    in_band = [r for r in ok if r.get("ensemble_period_in_measured_band")]
    at_measured_tau = [r for r in ens_ep if r["tau_is_measured"]]

    finding = banner + " " + (
        (f"The trained Kenyon-cell ensemble switches on and off repeatedly in {len(ens_ep)} of {len(ok)} runs, "
         f"{len(at_measured_tau)} of them at the measured time constant itself, and in {len(in_band)} the "
         f"period falls inside the {r5['frequency_hz'][0]} to {r5['frequency_hz'][1]} Hz band measured in a "
         f"sleeping fly. Whether any of that is the MEMORY rather than the ensemble's own excitability is not "
         f"decided here: it is what the pre-registered comparisons in stage 6 exist to decide, and they need "
         f"the unlearned-weights arm and the shuffled connectome, which this scan does not run.")
        if ens_ep else
        (f"No gain produced repeated episodes in the trained ensemble, at the measured time constant or at "
         f"either edge of its error bar. A slow variable in the mushroom body's own inhibitory gate is not "
         f"sufficient on its own."))

    out = {"status": "passed" if ens_ep else "failed", "IS_A_LABELLED_DEVIATION": banner,
           "deviation": DEV, "also_depression": dep and {k: v for k, v in dep.items()
                                                         if k not in ("pre_idx", "post_idx")},
           "tau_measured_ms": TAU_MEASURED, "tau_sem_ms": TAU_SEM, "taus_run_ms": taus,
           "gains_scanned": gains, "gain_is": "NOT MEASURED, scanned",
           "n_apl_cells": int(len(apl)), "sigma_mV": sigma, "duration_s": a.duration_s, "seeds": seeds,
           "measured_target": r5,
           "n_runs_with_ensemble_episodes": len(ens_ep),
           "n_runs_at_measured_tau_with_episodes": len(at_measured_tau),
           "n_runs_in_measured_r5_band": len(in_band),
           "per_run": rows, "finding": finding,
           "provenance": {"config": "configs/stage5_sleep.yaml", "results_dir": str(OUT.relative_to(RESULTS.parent)),
                          "files": [str(m["dir"]) for m in meta]}}
    json.dump(out, open(OUT / f"apl_ahp_{a.tag}.json", "w"), indent=1, default=str)

    print(finding); print()
    print(f"{'tau ms':>8s} {'gain':>6s} {'brain Hz':>9s} {'KC Hz':>7s} {'ens Hz':>7s} {'ens on%':>8s} "
          f"{'ens eps':>8s} {'period s':>9s} {'ratio':>7s} {'verdict':>10s}")
    for r in ok:
        b, kc, e = r["pop"]["brain"], r["pop"]["KC"], r["pop"]["ensemble"]
        v = ("EPISODIC" if episodic(r, "ensemble") else "sparse" if e.get("too_sparse")
             else "one-way" if e.get("one_way") else "-")
        per = r.get("ensemble_episode_period_s")
        print(f"{r['tau_ms']:8.1f}{'*' if r['tau_is_measured'] else ' '} {r['gain']:5g} {b['rate_hz']:9.3f} "
              f"{kc['rate_hz']:7.3f} {e['rate_hz']:7.3f} {e['frac_on']:7.1%} {e['n_episodes']:8d} "
              f"{(per if per else float('nan')):9.2f} {e.get('ratio_to_other_kcs', 0):7.1f} {v:>10s}")
    print("* the measured time constant; the other two rows are the edges of its reported SEM")
    for r in rows:
        if "error" in r:
            print(f"  tau {r['tau_ms']:g} gain {r['gain']:g}: {r['error']}")


if __name__ == "__main__":
    main()
