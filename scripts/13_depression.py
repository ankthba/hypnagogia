"""Stage 13 - THE DREAM ATTEMPT: measured short-term depression, and whether the brain then has episodes.

Stage 11 established that the published model cannot represent an episode: with nothing slower than the
5 ms synaptic time constant, an active state has nothing that can end it, and over 18 runs at four noise
levels and injected recurrence up to 300x the network was silent, permanently on, or ignited exactly once.
Stage 12 confirmed the diagnosis from the other side: give every neuron an adaptation term and episodes
appear, at 1 of 12 scanned settings for the brain and 4 of 12 for the trained ensemble. But both of stage
12's constants were unsourced, so its episodes were a demonstration and not a claim.

This stage uses a mechanism whose constants are measured. Short-term synaptic depression at antennal-lobe
excitatory synapses has been fit three times, in two laboratories, onto two postsynaptic cell types:

    ORN->PN  DM6/VM2   f = 0.78  tau = 893 ms    Nagel, Hong & Wilson 2015 Nat Neurosci 18:56-65
    ORN->LN            f = 0.75  tau = 1566 ms   Nagel & Wilson 2016 J Neurosci 36:4325-4338
    ORN->PN  DM4       f = 0.72  tau = 2400 ms   Kazama & Wilson 2009 Nat Neurosci 12:1136-1144

The per-spike factor agrees to within 8 per cent; the recovery time constant spans 2.7x, which is a bracket
between measured endpoints rather than a free parameter. All three pairs are run.

What is NOT measured is which synapses to apply it to, because the recordings are at ORN->PN and ORN->LN and
nowhere else. Scope is therefore an arm of the experiment, and every arm that is run is reported:

    orn_only     exactly the measured synapses: ORN -> (ALPN, ALLN)
    al_local     every excitatory synapse whose presynaptic AND postsynaptic cell is in the antennal lobe
    al_all       every excitatory synapse onto an antennal-lobe cell, whatever the source
    brain        every excitatory synapse in the brain

Why this mechanism for this failure: depression is rate-selective and the failure is a rate. At the measured
constants, the steady-state scaling A* = (1 - exp(-1/(r*tau))) / (1 - f*exp(-1/(r*tau))) takes 94 to 99 per
cent off the drive of the antennal-lobe populations running at 122 and 75 Hz and 2 to 14 per cent off the
Kenyon cells at 0.42 Hz, whose reactivation is the thing being measured. That selectivity was not chosen; it
follows from the measured constants and this model's own measured rates.

Writes results/stage13_depression/.
"""
import argparse, json
import numpy as np
from hypnagogia import RESULTS
from hypnagogia.config import load_config, dump_config
from hypnagogia.connectome import load_connectome
from hypnagogia.jobs import run_jobs
from hypnagogia.populations import MECHANISM_DEVIATIONS, POPULATIONS, SLEEP_OBSERVABLES

OUT = RESULTS / "stage13_depression"
DEV = MECHANISM_DEVIATIONS["short_term_depression_excitatory"]
BANNER = ("LABELLED DEVIATION, NOT THE PUBLISHED MODEL. Excitatory synapses depress with use. The two "
          "constants are measured (" + "; ".join(f"{x['synapse']}: f={x['f']}, tau={x['tau_ms']} ms"
                                                 for x in DEV["measurement"]) + "). "
          + DEV["why_it_is_a_deviation_and_not_a_correction"])

# The measured pairs, named by the paper they come from.
FITS = {f"{x['f']}_{x['tau_ms']}": x for x in DEV["measurement"]}

# Antennal-lobe cell classes, as the male CNS v1.0 annotation names them.
AL_CLASSES = ("ALPN", "ALLN", "ALIN", "ALON")


def scopes(conn):
    """pre_idx / post_idx for each scope arm. Only the first is what was actually measured."""
    orn = conn.select(**POPULATIONS["ORN"]["selector"])
    al = np.unique(np.concatenate([conn.select(cell_class=c) for c in AL_CLASSES] + [np.array([], dtype=np.int64)]))
    everything = np.arange(conn.N, dtype=np.int64)
    return {
        "orn_only": {"pre": orn, "post": al,
                     "what": "exactly the synapses the constants were measured at: ORN onto antennal-lobe cells"},
        "al_local": {"pre": al, "post": al,
                     "what": "every excitatory synapse inside the antennal lobe, which is the loop that runs away"},
        "al_all": {"pre": everything, "post": al,
                   "what": "every excitatory synapse onto an antennal-lobe cell, whatever the source"},
        "brain": {"pre": everything, "post": everything,
                  "what": "every excitatory synapse in the brain"},
    }


def steady_state_scaling(rate_hz, f, tau_ms):
    """A* for a Poisson-ish train at this rate: what fraction of the synapse's weight survives."""
    if rate_hz <= 0:
        return 1.0
    e = np.exp(-1.0 / (rate_hz * tau_ms * 1e-3))
    return float((1 - e) / (1 - f * e))


def build(cfg, s5, sd, fit, scope_name, sc, out_dir, duration_s, sigma):
    c = json.loads(json.dumps(cfg))
    c["noise"] = {"mode": "gaussian" if sigma > 0 else "none", "sigma_mV": sigma, "poisson": cfg["noise"]["poisson"]}
    c["depression"] = {"f": float(fit["f"]), "tau_ms": float(fit["tau_ms"]), "scope": scope_name,
                       "source": fit["source"], "synapse_measured_at": fit["synapse"],
                       "pre_idx": [int(x) for x in sc["pre"]], "post_idx": [int(x) for x in sc["post"]]}
    wfile = RESULTS / "stage4_learning" / "real" / f"seed{sd}" / "plastic_w.npz"
    return {"out_dir": str(out_dir), "seed": 800 + sd, "config": c,
            "name": f"dep_{scope_name}_{fit['f']}_{fit['tau_ms']}_{sd}",
            "connectome": {"dataset": "malecns", "version": "v1.0", "scope": "brain",
                           "weight_scale": cfg["dataset"]["weight_scale"]},
            "drive_groups": {"dfb": {"selector": POPULATIONS[s5["dfb_population"]]["selector"]}},
            "record": "all", "init_plastic_w": str(wfile), "plasticity": None,
            "epochs": [{"name": "warmup", "duration_s": s5["warmup_s"], "drives": {"dfb": s5["dfb_clamp_rate_hz"]},
                        "reset": True},
                       {"name": "sleep", "duration_s": duration_s, "drives": {"dfb": s5["dfb_clamp_rate_hz"]}}]}


def episodes(rate, bin_s, floor_hz):
    if rate.size == 0 or rate.max() <= 0:
        return {"frac_on": 0.0, "n_episodes": 0, "mean_s": 0.0, "max_s": 0.0, "one_way": False,
                "cv": 0.0, "rate_hz": 0.0}
    # An absolute floor as well as a relative one. Without it a population firing at 0.003 Hz gets credited
    # with a dozen "episodes", because a relative threshold on almost nothing is crossed by single spikes.
    # 0.02 Hz per cell over a 20 s window is one spike per cell per run: below that there is nothing to call
    # an episode, whatever shape the crossings make.
    thr = max(0.25 * float(rate.max()), floor_hz)
    on = rate > thr
    edges = np.diff(np.concatenate([[0], on.astype(int), [0]]))
    starts, ends = np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)
    durs = (ends - starts) * bin_s
    return {"frac_on": float(on.mean()), "n_episodes": int(len(durs)),
            "mean_s": float(durs.mean()) if len(durs) else 0.0,
            "max_s": float(durs.max()) if len(durs) else 0.0,
            "one_way": bool(len(durs) == 1 and on[-1] and not on[0]),
            "too_sparse": bool(rate.mean() < 0.02),
            "cv": float(rate.std() / rate.mean()) if rate.mean() > 0 else 0.0,
            "rate_hz": float(rate.mean())}


def score(run_dir, groups, ens, bin_s=0.1, epoch="sleep"):
    meta = json.load(open(run_dir / "meta.json"))
    z = np.load(run_dir / "spikes.npz")
    t = z["t_step"] * meta["dt_ms"] * 1e-3
    ep = [e for e in meta["epochs"] if e["name"] == epoch][0]
    k = (t >= ep["t_start_s"]) & (t < ep["t_end_s"])
    i, tt, dur = z["i"][k], t[k] - ep["t_start_s"], float(ep["duration_s"])
    nb = max(int(dur / bin_s), 1)
    b = np.minimum((tt / bin_s).astype(int), nb - 1)
    out, series = {}, {}
    for name, idx in groups.items():
        if len(idx) == 0:
            continue
        rate = np.bincount(b[np.isin(i, idx)], minlength=nb) / len(idx) / bin_s
        series[name] = rate
        out[name] = episodes(rate, bin_s, floor_hz=0.05 * max(float(rate.max()), 1e-9) + 0.02)
    other = np.setdiff1d(groups["KC"], ens)
    r_ens = np.bincount(b[np.isin(i, ens)], minlength=nb) / len(ens) / bin_s
    r_oth = np.bincount(b[np.isin(i, other)], minlength=nb) / len(other) / bin_s
    out["ensemble"] = episodes(r_ens, bin_s, floor_hz=0.05 * max(float(r_ens.max()), 1e-9) + 0.02)
    out["ensemble"]["ratio_to_other_kcs"] = float(r_ens.mean() / max(r_oth.mean(), 1e-9))
    if "brain" in series and series["brain"].std() > 0 and r_ens.std() > 0:
        out["ensemble"]["corr_with_brain"] = float(np.corrcoef(r_ens, series["brain"])[0, 1])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scopes", default="orn_only,al_local,al_all")
    ap.add_argument("--fits", default="all", help="'all' or f_tau keys, e.g. 0.78_893")
    ap.add_argument("--seeds", default="0")
    ap.add_argument("--duration-s", type=float, default=20.0)
    ap.add_argument("--sigma", type=float, default=None)
    ap.add_argument("--tag", default="scan")
    a = ap.parse_args()
    seeds = [int(x) for x in a.seeds.split(",")]
    want_fits = list(FITS) if a.fits == "all" else a.fits.split(",")
    OUT.mkdir(parents=True, exist_ok=True)

    cfg = load_config("stage5_sleep"); s5 = cfg["stage5"]
    dump_config(cfg, OUT / "config.resolved.yaml")
    conn = load_connectome(dataset="malecns", version="v1.0", scope="brain",
                           weight_scale=cfg["dataset"]["weight_scale"])
    sc_all = scopes(conn)
    groups = {"brain": np.arange(conn.N, dtype=np.int64), "KC": conn.select(cell_class="Kenyon_Cell"),
              "ALLN": conn.select(cell_class="ALLN"), "ALPN": conn.select(cell_class="ALPN"),
              "MBON": conn.select(cell_class="MBON")}
    tpl = json.load(open(RESULTS / "stage4_learning" / "real" / "kc_templates.json"))
    sigma = a.sigma if a.sigma is not None else float(
        json.load(open(RESULTS / "stage5_sleep" / "real" / "stage5.json"))["sigma_mV"])

    print(BANNER, flush=True)
    # The prediction, before anything runs: what the measured constants do to each population's drive at
    # the rates stage 7 measured. Printed first so it cannot be written to match the outcome.
    offline = {"ALLN": 122.0, "ALPN": 75.0, "KC": 0.42, "optic": 0.03}
    print("\npredicted steady-state weight surviving, at the offline rates stage 7 measured:")
    print(f"{'population':>12s} {'rate Hz':>8s} " + " ".join(f"{k:>12s}" for k in want_fits))
    for pop, r in offline.items():
        print(f"{pop:>12s} {r:8.2f} " + " ".join(
            f"{steady_state_scaling(r, FITS[k]['f'], FITS[k]['tau_ms']):11.1%} " for k in want_fits))
    print(flush=True)

    specs, meta = [], []
    for scope_name in a.scopes.split(","):
        sc = sc_all[scope_name]
        for fk in want_fits:
            for sd in seeds:
                d = OUT / f"{a.tag}_{scope_name}_{fk}_seed{sd}"
                specs.append(build(cfg, s5, sd, FITS[fk], scope_name, sc, d, a.duration_s, sigma))
                meta.append({"scope": scope_name, "fit": fk, "f": FITS[fk]["f"], "tau_ms": FITS[fk]["tau_ms"],
                             "seed": sd, "dir": d, "n_pre": int(len(sc["pre"])), "n_post": int(len(sc["post"]))})

    res = run_jobs(specs, n_parallel=cfg["run"]["n_parallel"])
    rows = []
    for mm, r in zip(meta, res):
        base = {k: v for k, v in mm.items() if k != "dir"}
        if r is None or "error" in r:
            rows.append({**base, "error": (r or {}).get("error", "")[-300:]})
            continue
        ens = np.array([int(x) for x in tpl[str(mm["seed"])]["_index"]["A_pre"]])
        try:
            n_dep = json.load(open(mm["dir"] / "meta.json")).get("depression", {}).get("n_depressing_synapses")
            rows.append({**base, "n_depressing_synapses": n_dep, "pop": score(mm["dir"], groups, ens)})
        except Exception as e:
            rows.append({**base, "error": f"{type(e).__name__}: {e}"})

    ok = [r for r in rows if "error" not in r]

    def episodic(r, pop):
        p = r["pop"].get(pop, {})
        return bool(0.02 <= p.get("frac_on", 0) <= 0.95 and p.get("n_episodes", 0) >= 3
                    and not p.get("one_way") and not p.get("too_sparse"))

    # What the fly actually does, so a claimed episode is compared with a measurement and not with an
    # intuition. Raccuglia et al. 2019 measured 0.5 to 1.5 Hz slow-wave up and down states in R5.
    r5 = SLEEP_OBSERVABLES["r5_slow_wave"]
    lo_s, hi_s = r5["period_s"]
    for r in ok:
        p_ = r["pop"].get("brain", {})
        n, dur = p_.get("n_episodes", 0), a.duration_s
        r["episode_rate_hz"] = float(n / dur) if dur else 0.0
        r["in_measured_r5_band"] = bool(n >= 3 and lo_s <= (dur / max(n, 1)) <= hi_s)

    brain_ep = [r for r in ok if episodic(r, "brain")]
    ens_ep = [r for r in ok if episodic(r, "ensemble")]
    finding = BANNER + " " + (
        (f"The brain has up and down states in {len(brain_ep)} of {len(ok)} runs and the trained Kenyon-cell "
         f"ensemble in {len(ens_ep)}. Every constant behind the mechanism is measured; the scope is an arm "
         f"and the arms are reported separately, because the recordings are at ORN to PN and ORN to LN "
         f"synapses and say nothing about any other synapse.")
        if brain_ep or ens_ep else
        ("Depression at the measured constants did not produce episodes in any scope arm. The mechanism "
         "reduced the runaway as predicted or it did not, and the per-run rates below say which; either "
         "way the offline state remained a single continuous state."))

    out = {"status": "passed" if (brain_ep or ens_ep) else "failed", "IS_A_LABELLED_DEVIATION": BANNER,
           "deviation": DEV, "sigma_mV": sigma, "duration_s": a.duration_s,
           "scopes_run": a.scopes.split(","), "scope_definitions": {k: v["what"] for k, v in sc_all.items()},
           "fits_run": want_fits, "seeds": seeds,
           "predicted_steady_state_scaling": {k: {p: steady_state_scaling(r, FITS[k]["f"], FITS[k]["tau_ms"])
                                                  for p, r in offline.items()} for k in want_fits},
           "measured_target": r5,
           "n_runs_in_measured_r5_band": sum(1 for r in ok if r.get("in_measured_r5_band")),
           "n_runs_with_brain_episodes": len(brain_ep), "n_runs_with_ensemble_episodes": len(ens_ep),
           "per_run": rows, "finding": finding,
           "provenance": {"config": "configs/stage5_sleep.yaml", "results_dir": str(OUT.relative_to(RESULTS.parent)),
                          "files": [str(m["dir"]) for m in meta]}}
    json.dump(out, open(OUT / f"depression_{a.tag}.json", "w"), indent=1, default=str)

    print(finding); print()
    print(f"{'scope':>10s} {'f':>5s} {'tau ms':>7s} {'syn':>9s} {'brain Hz':>9s} {'on%':>6s} {'eps':>4s} "
          f"{'mean s':>7s} {'ALLN Hz':>8s} {'KC Hz':>7s} {'ens Hz':>7s} {'ens eps':>8s} {'verdict':>9s}")
    for r in ok:
        p, kc, al = r["pop"]["brain"], r["pop"]["KC"], r["pop"]["ALLN"]
        e = r["pop"]["ensemble"]
        v = "EPISODIC" if episodic(r, "brain") else "sparse" if p.get("too_sparse") else "one-way" if p["one_way"] else \
            "latched" if p["frac_on"] > 0.95 else "silent" if p["rate_hz"] < 1e-3 else "-"
        print(f"{r['scope']:>10s} {r['f']:5g} {r['tau_ms']:7g} {(r.get('n_depressing_synapses') or 0):9d} "
              f"{p['rate_hz']:9.3f} {p['frac_on']:5.1%} {p['n_episodes']:4d} {p['mean_s']:7.2f} "
              f"{al['rate_hz']:8.2f} {kc['rate_hz']:7.3f} {e['rate_hz']:7.3f} {e['n_episodes']:8d} {v:>9s}")
    for r in rows:
        if "error" in r:
            print(f"  {r['scope']} {r['fit']}: {r['error']}")


if __name__ == "__main__":
    main()
