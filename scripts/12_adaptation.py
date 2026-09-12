"""Stage 12 - CAN THE BRAIN HAVE AN EPISODE AT ALL? Spike-frequency adaptation as a labelled deviation.

Stage 11 established the blocker. The published model has no state variable slower than its 5 ms synaptic
time constant, so an active state has nothing that can end it: handed the mechanism for replay directly, at
four noise levels and injected recurrence from 1x to 300x, the network was silent, or permanently on, or it
ignited exactly once and never switched off. Eighteen runs, zero repeated episodes. A model that cannot
represent an episode cannot be asked whether a memory reappears in one.

So this stage adds the missing ingredient and nothing else: one hyperpolarising term per neuron that steps up
by b_mV on each of that cell's own spikes and decays with tau_ms. That is spike-triggered adaptation, and it
is a LABELLED DEVIATION, recorded in populations.MECHANISM_DEVIATIONS. It is not a correction and no run with
it switched on is a property of the published model.

The two constants have no measurement behind them yet, so they are SCANNED, not chosen. A scan reported as a
scan is not an invented parameter; one value picked because the plots looked right would be. If the
literature search finds a measured value, the scan says whether the measured point is one that produces
episodes, which is a stronger statement than starting from the value would have been.

What is measured here, per run:
  - whether the brain has up and down states, and their duration and duty cycle
  - the same for the antennal lobe, which stage 7 showed IS the offline state (2.6% of neurons, 41% of spikes)
  - the same for the Kenyon cells and for the trained odour-A ensemble
  - whether the ensemble's episodes coincide with the brain's, or are its own

Writes results/stage12_adaptation/.
"""
import argparse, json
import numpy as np
from hypnagogia import RESULTS
from hypnagogia.config import load_config, dump_config
from hypnagogia.connectome import load_connectome
from hypnagogia.jobs import run_jobs
from hypnagogia.populations import MECHANISM_DEVIATIONS, POPULATIONS

OUT = RESULTS / "stage12_adaptation"
DEV = MECHANISM_DEVIATIONS["spike_frequency_adaptation"]
BANNER = ("LABELLED DEVIATION, NOT THE PUBLISHED MODEL. Every neuron carries a spike-triggered adaptation "
          "term the Shiu et al. 2024 model does not have. " + DEV["why_it_is_a_deviation_and_not_a_correction"])


def constants_note(sourced: bool) -> str:
    if sourced:
        return "The adaptation constants are the measured values recorded in MECHANISM_DEVIATIONS."
    return ("Neither adaptation constant has a measurement behind it, so both are SCANNED and the range is "
            "reported instead of a value. " + DEV["how_it_must_be_reported"])


def build(cfg, s5, sd, tau_ms, b_mV, out_dir, duration_s, sigma, ens_idx=None):
    c = json.loads(json.dumps(cfg))
    c["noise"] = {"mode": "gaussian" if sigma > 0 else "none", "sigma_mV": sigma, "poisson": cfg["noise"]["poisson"]}
    c["adaptation"] = {"tau_ms": float(tau_ms), "b_mV": float(b_mV),
                       "deviation": "spike_frequency_adaptation", "status": DEV["status"]}
    wfile = RESULTS / "stage4_learning" / "real" / f"seed{sd}" / "plastic_w.npz"
    spec = {"out_dir": str(out_dir), "seed": 700 + sd, "config": c, "name": f"adapt_{tau_ms:g}_{b_mV:g}_{sd}",
            "connectome": {"dataset": "malecns", "version": "v1.0", "scope": "brain",
                           "weight_scale": cfg["dataset"]["weight_scale"]},
            "drive_groups": {"dfb": {"selector": POPULATIONS[s5["dfb_population"]]["selector"]}},
            "record": "all", "init_plastic_w": str(wfile), "plasticity": None,
            "epochs": [{"name": "warmup", "duration_s": s5["warmup_s"], "drives": {"dfb": s5["dfb_clamp_rate_hz"]},
                        "reset": True},
                       {"name": "sleep", "duration_s": duration_s, "drives": {"dfb": s5["dfb_clamp_rate_hz"]}}]}
    return spec


def episodes(rate, bin_s, floor_hz, rel=0.25):
    """Up and down states in one population's binned rate.

    'On' is above a fraction of that population's own peak AND above an absolute floor, so a population that
    never really switches off does not get episodes attributed to ripples in its baseline. The relative part
    is what makes this work across populations whose rates differ by three orders of magnitude.
    """
    if rate.size == 0 or rate.max() <= 0:
        return {"frac_on": 0.0, "n_episodes": 0, "mean_s": 0.0, "max_s": 0.0,
                "one_way": False, "cv": 0.0, "rate_hz": 0.0}
    thr = max(rel * float(rate.max()), floor_hz)
    on = rate > thr
    edges = np.diff(np.concatenate([[0], on.astype(int), [0]]))
    starts, ends = np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)
    durs = (ends - starts) * bin_s
    return {"frac_on": float(on.mean()), "n_episodes": int(len(durs)),
            "mean_s": float(durs.mean()) if len(durs) else 0.0,
            "max_s": float(durs.max()) if len(durs) else 0.0,
            # off, on once, still on at the end: an ignition, which stage 11 showed is all this model had
            "one_way": bool(len(durs) == 1 and on[-1] and not on[0]),
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
        sel = np.isin(i, idx)
        rate = np.bincount(b[sel], minlength=nb) / len(idx) / bin_s
        series[name] = rate
        # The floor scales with the population: a Kenyon cell firing at 2 Hz is a lot, an antennal-lobe local
        # neuron at 2 Hz is asleep.
        out[name] = episodes(rate, bin_s, floor_hz=0.05 * max(float(rate.max()), 1e-9) + 0.02)

    other = np.setdiff1d(groups["KC"], ens) if "KC" in groups else np.array([], dtype=np.int64)
    if len(ens) and len(other):
        r_ens = np.bincount(b[np.isin(i, ens)], minlength=nb) / len(ens) / bin_s
        r_oth = np.bincount(b[np.isin(i, other)], minlength=nb) / len(other) / bin_s
        out["ensemble"] = episodes(r_ens, bin_s, floor_hz=0.05 * max(float(r_ens.max()), 1e-9) + 0.02)
        out["ensemble"]["ratio_to_other_kcs"] = float(r_ens.mean() / max(r_oth.mean(), 1e-9))
        # Does the ensemble come on when the brain does, or on its own? A memory reappearing inside a global
        # up state is not the same claim as a memory reappearing by itself, and the correlation says which.
        if "brain" in series and series["brain"].std() > 0 and r_ens.std() > 0:
            out["ensemble"]["corr_with_brain"] = float(np.corrcoef(r_ens, series["brain"])[0, 1])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tau-ms", default="200,600,2000")
    ap.add_argument("--b-mv", default="0.05,0.15,0.5,1.5")
    ap.add_argument("--seeds", default="0")
    ap.add_argument("--duration-s", type=float, default=20.0)
    ap.add_argument("--sigma", type=float, default=None, help="defaults to the stage-2 operating point")
    ap.add_argument("--tag", default="scan")
    a = ap.parse_args()
    taus = [float(x) for x in a.tau_ms.split(",")]
    bs = [float(x) for x in a.b_mv.split(",")]
    seeds = [int(x) for x in a.seeds.split(",")]
    OUT.mkdir(parents=True, exist_ok=True)

    cfg = load_config("stage5_sleep"); s5 = cfg["stage5"]
    dump_config(cfg, OUT / "config.resolved.yaml")
    conn = load_connectome(dataset="malecns", version="v1.0", scope="brain",
                           weight_scale=cfg["dataset"]["weight_scale"])
    groups = {"brain": np.arange(conn.N, dtype=np.int64),
              "KC": conn.select(cell_class="Kenyon_Cell"),
              "ALLN": conn.select(cell_class="ALLN"),
              "ALPN": conn.select(cell_class="ALPN"),
              "MBON": conn.select(cell_class="MBON")}
    tpl = json.load(open(RESULTS / "stage4_learning" / "real" / "kc_templates.json"))
    sigma = a.sigma if a.sigma is not None else float(
        json.load(open(RESULTS / "stage5_sleep" / "real" / "stage5.json"))["sigma_mV"])

    specs, meta = [], []
    for tau in taus:
        for bb in bs:
            for sd in seeds:
                d = OUT / f"{a.tag}_t{tau:g}_b{bb:g}_seed{sd}"
                specs.append(build(cfg, s5, sd, tau, bb, d, a.duration_s, sigma))
                meta.append({"tau_ms": tau, "b_mV": bb, "seed": sd, "dir": d})

    print(BANNER, flush=True)
    print(constants_note(DEV["status"] == "sourced"), flush=True)
    res = run_jobs(specs, n_parallel=cfg["run"]["n_parallel"])

    rows = []
    for mm, r in zip(meta, res):
        base = {k: v for k, v in mm.items() if k != "dir"}
        if r is None or "error" in r:
            rows.append({**base, "error": (r or {}).get("error", "")[-200:]})
            continue
        ens = np.array([int(x) for x in tpl[str(mm["seed"])]["_index"]["A_pre"]])
        try:
            rows.append({**base, **{"pop": score(mm["dir"], groups, ens)}})
        except Exception as e:
            rows.append({**base, "error": f"{type(e).__name__}: {e}"})

    ok = [r for r in rows if "error" not in r]
    # A brain that has up and down states: on for some of the time, off for some of the time, more than once.
    def episodic(r, pop="brain"):
        p = r["pop"].get(pop, {})
        return bool(0.02 <= p.get("frac_on", 0) <= 0.95 and p.get("n_episodes", 0) >= 3 and not p.get("one_way"))
    dreaming = [r for r in ok if episodic(r, "brain")]
    ens_dreaming = [r for r in ok if episodic(r, "ensemble")]

    finding = BANNER + " " + constants_note(DEV["status"] == "sourced") + " " + (
        (f"With adaptation the brain does have up and down states: {len(dreaming)} of {len(ok)} scanned "
         f"settings produce repeated global episodes, and {len(ens_dreaming)} produce repeated episodes in "
         f"the trained Kenyon-cell ensemble. This is the first configuration in the project in which an "
         f"episode exists at all, which is the precondition for asking whether a memory reappears in one.")
        if dreaming else
        ("Adaptation did not produce episodes at any scanned setting. If that holds over the whole range the "
         "conclusion is stronger than stage 11's, because the mechanism that terminates an up state was "
         "present and the up state still did not terminate, which would point at the drive rather than at "
         "the cell model."))

    out = {"status": "passed" if dreaming else "failed", "IS_A_LABELLED_DEVIATION": BANNER,
           "constants_are": DEV["status"], "constants_note": constants_note(DEV["status"] == "sourced"),
           "deviation": DEV, "sigma_mV": sigma, "duration_s": a.duration_s,
           "tau_ms_scanned": taus, "b_mV_scanned": bs, "seeds": seeds,
           "any_setting_gave_brain_episodes": bool(dreaming),
           "any_setting_gave_ensemble_episodes": bool(ens_dreaming),
           "per_run": rows, "finding": finding,
           "provenance": {"config": "configs/stage5_sleep.yaml", "results_dir": str(OUT.relative_to(RESULTS.parent)),
                          "files": [str(m["dir"]) for m in meta]}}
    json.dump(out, open(OUT / f"adaptation_{a.tag}.json", "w"), indent=1, default=str)

    print(finding); print()
    hdr = f"{'tau ms':>7s} {'b mV':>6s} {'brain Hz':>9s} {'on%':>6s} {'eps':>4s} {'mean s':>7s} " \
          f"{'KC Hz':>7s} {'ALLN Hz':>8s} {'ens Hz':>7s} {'ens on%':>8s} {'ens eps':>8s} {'verdict':>10s}"
    print(hdr)
    for r in ok:
        p, kc, al = r["pop"].get("brain", {}), r["pop"].get("KC", {}), r["pop"].get("ALLN", {})
        e = r["pop"].get("ensemble", {})
        v = "EPISODIC" if episodic(r, "brain") else "one-way" if p.get("one_way") else \
            "latched" if p.get("frac_on", 0) > 0.95 else "silent" if p.get("rate_hz", 0) < 1e-3 else "-"
        print(f"{r['tau_ms']:7g} {r['b_mV']:6g} {p.get('rate_hz', 0):9.3f} {p.get('frac_on', 0):5.1%} "
              f"{p.get('n_episodes', 0):4d} {p.get('mean_s', 0):7.2f} {kc.get('rate_hz', 0):7.3f} "
              f"{al.get('rate_hz', 0):8.2f} {e.get('rate_hz', 0):7.3f} {e.get('frac_on', 0):7.1%} "
              f"{e.get('n_episodes', 0):8d} {v:>10s}")
    for r in rows:
        if "error" in r:
            print(f"  tau {r['tau_ms']:g} b {r['b_mV']:g}: {r['error']}")


if __name__ == "__main__":
    main()
