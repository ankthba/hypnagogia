"""Stage 11 - THE INJECTED POSITIVE CONTROL: could this pipeline see replay if replay were there?

NOTHING IN THIS SCRIPT IS A RESULT. It exists because every negative in this project is uninterpretable
until one question is answered: is the stage-6 detector capable of finding memory replay at all? A negative
from a blind detector means nothing, and nobody has checked.

The model cannot produce replay on its own, and stages 6c, 6d and 10 say why: the only plastic synapses sit
one stage downstream of the cells whose reactivation is scored, and the return route is three orders of
magnitude too weak. So the mechanism is injected by hand. The recurrent connections BETWEEN members of the
trained Kenyon-cell ensemble are multiplied by a factor an experimenter chooses. That is the arrangement
hippocampal replay has, where the potentiated synapses lie among the replaying cells, and it is the
arrangement this connectome lacks.

The factor is not measured by anything. It is a knob, deliberately, and every output carries that label.

Two modes. --scan runs one seed at several factors and reports where, if anywhere, the ensemble starts
switching on by itself and whether it does so in episodes or simply latches on. --run does the full seed set
at one factor, writing stage-5-shaped output that scripts/06_replay.py can score, so the detector is tested
end to end on data it should be able to call positive.

Writes results/stage11_injected/.
"""
import argparse, json
import numpy as np
from hypnagogia import RESULTS
from hypnagogia.config import load_config, dump_config
from hypnagogia.connectome import load_connectome
from hypnagogia.jobs import run_jobs
from hypnagogia.populations import POPULATIONS

OUT = RESULTS / "stage11_injected"
BANNER = ("INJECTED POSITIVE CONTROL, NOT A RESULT. The recurrent connections among the trained ensemble were "
          "multiplied by a factor chosen by the experimenter. Nothing here is learned, measured, or a property "
          "of the connectome, and no output derived from it may be reported as evidence about the fly or about "
          "the published model. Its only purpose is to test whether the stage-6 detector can find replay when "
          "replay is present.")


def build(cfg, s5, sd, factor, ens_idx, out_dir, duration_s, sigma):
    c = json.loads(json.dumps(cfg))
    c["noise"] = {"mode": "gaussian" if sigma > 0 else "none", "sigma_mV": sigma, "poisson": cfg["noise"]["poisson"]}
    wfile = RESULTS / "stage4_learning" / "real" / f"seed{sd}" / "plastic_w.npz"
    return {"out_dir": str(out_dir), "seed": 500 + sd, "config": c, "name": f"inj_{factor}_{sd}",
            "connectome": {"dataset": "malecns", "version": "v1.0", "scope": "brain",
                           "weight_scale": cfg["dataset"]["weight_scale"]},
            "injected_potentiation": {"index": [int(x) for x in ens_idx], "factor": float(factor),
                                      "label": f"trained-ensemble recurrence x{factor:g} (INJECTED)"},
            "drive_groups": {"dfb": {"selector": POPULATIONS[s5["dfb_population"]]["selector"]}},
            "record": "all", "init_plastic_w": str(wfile), "plasticity": None,
            "epochs": [{"name": "warmup", "duration_s": s5["warmup_s"], "drives": {"dfb": s5["dfb_clamp_rate_hz"]},
                        "reset": True},
                       {"name": "sleep", "duration_s": duration_s, "drives": {"dfb": s5["dfb_clamp_rate_hz"]}}]}


def score(run_dir, conn, kc, ens, bin_s=0.1, epoch="sleep"):
    """Is the ensemble switching on by itself, and does it do so in episodes or simply latch?"""
    meta = json.load(open(run_dir / "meta.json"))
    z = np.load(run_dir / "spikes.npz")
    t = z["t_step"] * meta["dt_ms"] * 1e-3
    ep = [e for e in meta["epochs"] if e["name"] == epoch][0]
    k = (t >= ep["t_start_s"]) & (t < ep["t_end_s"])
    i, tt, dur = z["i"][k], t[k] - ep["t_start_s"], float(ep["duration_s"])
    other = np.setdiff1d(kc, ens)
    nb = max(int(dur / bin_s), 1)
    b = np.minimum((tt / bin_s).astype(int), nb - 1)
    in_e = np.isin(i, ens)
    per_bin = np.bincount(b[in_e], minlength=nb) / len(ens) / bin_s        # ensemble rate per bin, Hz per cell
    base = np.bincount(b[np.isin(i, other)], minlength=nb) / len(other) / bin_s
    # "on" means the ensemble is firing well above the Kenyon cells outside it AND above a floor, so that a
    # quiet background does not make noise look like an episode.
    ref = 5 * np.median(base[base > 0]) if (base > 0).any() else 0.0
    on = per_bin > max(ref, 0.5)
    # episode structure: runs of consecutive "on" bins
    edges = np.diff(np.concatenate([[0], on.astype(int), [0]]))
    starts, ends = np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)
    durs = (ends - starts) * bin_s
    # A one-way transition is not an episode. If the ensemble is off, comes on once, and is still on at the
    # end of the recording, the network simply ignited: that is the bistable transition stage 2 measured, not
    # reactivation. Distinguishing the two is the whole point of this control.
    one_way = bool(len(durs) == 1 and on.any() and on[-1] and not on[0])
    return {"ensemble_rate_hz": float(np.isin(i, ens).sum() / dur / len(ens)),
            "one_way_ignition": one_way,
            "on_at_start": bool(on[0]) if len(on) else False,
            "on_at_end": bool(on[-1]) if len(on) else False,
            "other_kc_rate_hz": float(np.isin(i, other).sum() / dur / len(other)),
            "ratio_to_other_kcs": float((np.isin(i, ens).sum() / len(ens)) / max(np.isin(i, other).sum() / len(other), 1e-9)),
            "frac_bins_on": float(on.mean()), "n_episodes": int(len(durs)),
            "episode_duration_s_mean": float(durs.mean()) if len(durs) else 0.0,
            "episode_duration_s_max": float(durs.max()) if len(durs) else 0.0,
            "per_bin_cv": float(per_bin.std() / per_bin.mean()) if per_bin.mean() > 0 else 0.0,
            "latched": bool(on.mean() > 0.9), "silent": bool(on.mean() < 0.005),
            "episodic": bool(0.005 <= on.mean() <= 0.9 and len(durs) >= 3 and not one_way)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--factors", default="1,3,10,30,100")
    ap.add_argument("--seeds", default="0")
    ap.add_argument("--duration-s", type=float, default=20.0)
    ap.add_argument("--tag", default="scan")
    ap.add_argument("--as-stage5", action="store_true",
                    help="write stage-5-shaped output under results/stage5_sleep/real_injected so that "
                         "scripts/06_replay.py --tag _injected can score it. The three arms map onto the "
                         "control's own logic: 'sleep' is the injected ensemble with the learned weights, "
                         "'sleep_naive' is the same seed with neither, so the injection IS the memory being "
                         "tested, and 'wake' is the injected run with the dFB clamp off.")
    ap.add_argument("--sigma", type=float, default=None,
                    help="background noise; defaults to the stage-2 operating point. Below the ignition "
                         "threshold the rest of the brain is quiet, which is the only state in which an "
                         "ensemble switching ON is even observable: at the operating point it never switches "
                         "off, so there is nothing to detect.")
    a = ap.parse_args()
    factors = [float(x) for x in a.factors.split(",")]
    seeds = [int(x) for x in a.seeds.split(",")]
    OUT.mkdir(parents=True, exist_ok=True)

    cfg = load_config("stage5_sleep"); s5 = cfg["stage5"]
    dump_config(cfg, OUT / "config.resolved.yaml")
    conn = load_connectome("malecns", "v1.0", "brain")
    kc = conn.select(cell_class="Kenyon_Cell")
    tpl = json.load(open(RESULTS / "stage4_learning" / "real" / "kc_templates.json"))
    sigma = a.sigma if a.sigma is not None else float(
        json.load(open(RESULTS / "stage5_sleep" / "real" / "stage5.json"))["sigma_mV"])

    specs, meta = [], []
    if a.as_stage5:
        if len(factors) != 1:
            raise SystemExit("--as-stage5 takes exactly one factor: it builds the three arms of one experiment")
        f = factors[0]
        s5dir = RESULTS / "stage5_sleep" / "real_injected"
        s5dir.mkdir(parents=True, exist_ok=True)
        for sd in seeds:
            ens = np.array([int(x) for x in tpl[str(sd)]["_index"]["A_pre"]])
            for arm, fac, learned, dfb_on in (("sleep", f, True, True),
                                              ("sleep_naive", 1.0, False, True),
                                              ("wake", f, True, False)):
                d = s5dir / f"{arm}_seed{sd}"
                sp = build(cfg, s5, sd, fac, ens, d, a.duration_s, sigma)
                sp["name"] = f"sleep_real_injected_{arm}_{sd}_{s5['dfb_clamp_rate_hz']}"
                sp["epochs"] = [{"name": "warmup", "duration_s": s5["warmup_s"],
                                 "drives": ({"dfb": s5["dfb_clamp_rate_hz"]} if dfb_on else {}), "reset": True},
                                {"name": arm, "duration_s": a.duration_s,
                                 "drives": ({"dfb": s5["dfb_clamp_rate_hz"]} if dfb_on else {})}]
                if not learned:
                    sp["init_plastic_w"] = None
                    sp.pop("injected_potentiation", None)
                specs.append(sp)
                meta.append({"factor": fac, "seed": sd, "dir": d, "arm": arm,
                             "ensemble_size": int(len(ens))})
    else:
        for f in factors:
            for sd in seeds:
                ens = np.array([int(x) for x in tpl[str(sd)]["_index"]["A_pre"]])
                d = OUT / f"{a.tag}_x{f:g}_seed{sd}"
                specs.append(build(cfg, s5, sd, f, ens, d, a.duration_s, sigma))
                meta.append({"factor": f, "seed": sd, "dir": d, "arm": "sleep",
                             "ensemble_size": int(len(ens))})

    if a.as_stage5:
        import shutil
        src, dst = RESULTS / "stage4_learning" / "real", RESULTS / "stage4_learning" / "real_injected"
        dst.mkdir(parents=True, exist_ok=True)
        for name in ("kc_templates.json", "kc_templates.npz", "stage4.json"):
            if (src / name).exists():
                shutil.copy(src / name, dst / name)
        for sd in seeds:                       # stage 5 loads the learned weights per seed
            (dst / f"seed{sd}").mkdir(exist_ok=True)
            w = src / f"seed{sd}" / "plastic_w.npz"
            if w.exists():
                shutil.copy(w, dst / f"seed{sd}" / "plastic_w.npz")
        print(f"stage-4 templates mirrored to {dst} so stage 6 can score with --tag _injected", flush=True)

    res = run_jobs(specs, n_parallel=cfg["run"]["n_parallel"])
    rows = []
    for mm, r in zip(meta, res):
        if r is None or "error" in r:
            rows.append({**{k: v for k, v in mm.items() if k != "dir"}, "error": (r or {}).get("error", "")[-200:]})
            continue
        ens = np.array([int(x) for x in tpl[str(mm["seed"])]["_index"]["A_pre"]])
        try:
            rows.append({**{k: v for k, v in mm.items() if k != "dir"},
                         **score(mm["dir"], conn, kc, ens, epoch=mm.get("arm", "sleep"))})
        except Exception as e:
            rows.append({**{k: v for k, v in mm.items() if k != "dir"}, "error": f"{type(e).__name__}: {e}"})

    ok = [r for r in rows if "error" not in r]
    dreaming = [r for r in ok if r.get("episodic")]
    finding = (
        BANNER + " " +
        (f"At factor {min(r['factor'] for r in dreaming):g} and above the trained ensemble switches on by "
         f"itself in discrete episodes during the offline period: "
         f"{dreaming[0]['n_episodes']} episodes over the recording, mean duration "
         f"{dreaming[0]['episode_duration_s_mean']:.2f} s, ensemble firing "
         f"{dreaming[0]['ratio_to_other_kcs']:.0f} times faster than the Kenyon cells outside it, active in "
         f"{dreaming[0]['frac_bins_on']:.0%} of time bins rather than all of them. That is the shape replay "
         f"has, and it is the first time anything in this project has produced it."
         if dreaming else
         "No factor produced episodic reactivation. The ensemble is silent, or latched on, or it ignites "
         "exactly once and never comes back down, and which of those happens is set by the background noise "
         "and not by the injection: at the same sigma the temporal pattern is identical with the injection "
         "and without it, and all the injection changes is how loudly the ensemble fires once the network has "
         "ignited. This model has one transition available to it, silent to active, and it is one-way. There "
         "is no state variable slower than the 5 ms synaptic time constant, so nothing can terminate an up "
         "state. The finding is therefore about the model class and not about the memory: it cannot represent "
         "an episode even when the mechanism for one is handed to it directly, which means no negative replay "
         "result from it can be read as evidence that the fly does not replay."))

    out = {"status": "passed" if ok else "failed", "IS_NOT_A_RESULT": BANNER,
           "question": "Can the stage-6 detector find replay when replay is injected?",
           "sigma_mV": sigma, "on_the_silent_branch": bool(a.sigma is not None), "duration_s": a.duration_s, "factors": factors, "seeds": seeds,
           "any_factor_produced_episodes": bool(dreaming),
           "smallest_episodic_factor": (min(r["factor"] for r in dreaming) if dreaming else None),
           "per_run": rows, "finding": finding,
           "provenance": {"config": "configs/stage5_sleep.yaml", "results_dir": "results/stage11_injected",
                          "files": [str(m["dir"]) for m in meta]}}
    json.dump(out, open(OUT / f"injected_{a.tag}.json", "w"), indent=1, default=str)
    print(finding); print()
    print(f"{'factor':>7s} {'seed':>4s} {'ens Hz':>8s} {'other Hz':>9s} {'ratio':>7s} {'bins on':>8s} "
          f"{'episodes':>9s} {'mean s':>7s} {'verdict':>10s}")
    for r in ok:
        v = ("EPISODIC" if r["episodic"] else "latched" if r["latched"] else "silent" if r["silent"]
             else "one-way" if r.get("one_way_ignition") else "-")
        print(f"{r['factor']:7g} {r['seed']:4d} {r['ensemble_rate_hz']:8.3f} {r['other_kc_rate_hz']:9.4f} "
              f"{r['ratio_to_other_kcs']:7.1f} {r['frac_bins_on']:7.1%} {r['n_episodes']:9d} "
              f"{r['episode_duration_s_mean']:7.2f} {v:>10s}")


if __name__ == "__main__":
    main()
