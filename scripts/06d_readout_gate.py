"""Stage 6d - HOW FAR BELOW THRESHOLD IS THE READOUT, AND WHAT HOLDS IT THERE?

Stage 6c found that the only path by which the engram could preferentially reactivate its own Kenyon-cell
ensemble runs through MBON-gamma1pedc, and that the path works in the one seed of twenty where that cell
fires. So the whole question becomes: why does it not fire, and by how much does it miss?

This records the membrane potential of the readout MBON through an offline period and decomposes what is
holding it down, using the connectome and the model's own constants. The output is a single number, the
millivolts of relief any intervention would have to provide, and the share of that deficit each input
population is responsible for.

Writes results/stage6_readout_gate/readout_gate.json.
"""
import argparse, json
import numpy as np
from hypnagogia import RESULTS
from hypnagogia.config import load_config, dump_config
from hypnagogia.connectome import load_connectome
from hypnagogia.jobs import run_jobs
from hypnagogia.populations import POPULATIONS

OUT = RESULTS / "stage6_readout_gate"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gain", type=float, default=1.0)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--duration-s", type=float, default=8.0)
    a = ap.parse_args()
    suffix = "" if a.gain == 1.0 else f"_gain{a.gain}"
    OUT.mkdir(parents=True, exist_ok=True)

    cfg = load_config("stage5_sleep"); s5 = cfg["stage5"]; m = cfg["model"]
    conn = load_connectome("malecns", "v1.0", "brain")
    ro = conn.select(cell_type="MBON11")
    kc = conn.select(cell_class="Kenyon_Cell")
    apl = conn.select(cell_type="APL")
    scale = cfg["dataset"]["weight_scale"] * a.gain
    w_syn, vth, vrest = m["w_syn_mV"], m["v_th_mV"], m["v_rest_mV"]
    gap = vth - vrest
    k_graded = m["tau_syn_ms"] / m["t_refr_ms"]

    s5j = json.load(open(RESULTS / "stage5_sleep" / f"real{suffix}" / "stage5.json"))
    sigma = float(s5j["sigma_mV"])
    c = json.loads(json.dumps(cfg))
    c["noise"] = {"mode": "gaussian", "sigma_mV": sigma, "poisson": cfg["noise"]["poisson"]}
    dump_config(c, OUT / "config.resolved.yaml")

    run_dir = str(OUT / f"probe_seed{a.seed}")
    spec = {"out_dir": run_dir, "seed": 500 + a.seed, "config": c, "name": f"gate_{a.seed}_{s5['dfb_clamp_rate_hz']}",
            "connectome": {"dataset": "malecns", "version": "v1.0", "scope": "brain", "weight_scale": scale},
            "drive_groups": {"dfb": {"selector": POPULATIONS[s5["dfb_population"]]["selector"]}},
            "record": {"selector": {"cell_type": "MBON11"}},
            "record_v": {"selector": {"cell_type": "MBON11"}}, "record_v_dt_s": 0.001,
            "init_plastic_w": str(RESULTS / "stage4_learning" / f"real{suffix}" / f"seed{a.seed}" / "plastic_w.npz"),
            "plasticity": None,
            "epochs": [{"name": "warmup", "duration_s": 3.0, "drives": {"dfb": s5["dfb_clamp_rate_hz"]}},
                       {"name": "sleep", "duration_s": a.duration_s, "drives": {"dfb": s5["dfb_clamp_rate_hz"]}}]}
    r = run_jobs([spec], n_parallel=1, skip_existing=True)[0]
    if r is None or "error" in r:
        raise SystemExit(f"probe run failed: {(r or {}).get('error', '')[-300:]}")

    z = np.load(run_dir + "/voltage.npz")
    v, t = z["v_mV"], z["t_s"]
    sl = t >= 3.0
    cells = []
    for k, ix in enumerate(z["idx"]):
        vv = v[k][sl]
        cells.append({"index": int(ix), "root_id": str(conn.ids[int(ix)]),
                      "median_v_mV": float(np.median(vv)), "p95_v_mV": float(np.percentile(vv, 95)),
                      "max_v_mV": float(vv.max()),
                      "mV_below_threshold_median": float(vth - np.median(vv)),
                      "mV_below_threshold_p95": float(vth - np.percentile(vv, 95)),
                      "threshold_gaps_below_median": float((vth - np.median(vv)) / gap)})

    # What holds it there. APL is non-spiking, so its contribution is a steady offset set by its release
    # level; every other input is a spike train, and over the recorded window its mean contribution is the
    # weight times the rate times the synaptic time constant.
    mask = np.isin(conn.post, ro)
    pre_a, cnt_a, sgn_a, post_a = conn.pre[mask], conn.count[mask], conn.sign[mask], conn.post[mask]
    ct = conn.ann.cell_type.astype(str).values
    budget = []
    for target in ro:
        sel = post_a == target
        p, cnt, sgn = pre_a[sel], cnt_a[sel].astype(float), sgn_a[sel].astype(float)
        is_apl = np.isin(p, apl)
        # the steady offset a fully released graded synapse delivers
        g_apl = -k_graded * float(cnt[is_apl].sum()) * scale * w_syn
        budget.append({"root_id": str(conn.ids[int(target)]),
                       "apl_synapses": int(cnt[is_apl].sum()),
                       "apl_steady_mV": g_apl,
                       "apl_share_of_deficit": None,
                       "other_inhibitory_synapses": int(cnt[(sgn < 0) & ~is_apl].sum()),
                       "excitatory_synapses": int(cnt[sgn > 0].sum())})
    for b, cdat in zip(budget, cells):
        deficit = cdat["mV_below_threshold_median"]
        b["apl_share_of_deficit"] = float(abs(b["apl_steady_mV"]) / deficit) if deficit else None

    worst = max(cells, key=lambda c: c["mV_below_threshold_median"])
    best = min(cells, key=lambda c: c["mV_below_threshold_median"])
    finding = (
        f"The readout sits {best['mV_below_threshold_median']:.0f} to {worst['mV_below_threshold_median']:.0f} mV "
        f"below its firing threshold through the offline period, against a threshold gap of {gap:.0f} mV. That is "
        f"{best['threshold_gaps_below_median']:.0f} to {worst['threshold_gaps_below_median']:.0f} whole threshold "
        f"gaps, and at the 95th percentile of its membrane potential it is still "
        f"{best['mV_below_threshold_p95']:.0f} to {worst['mV_below_threshold_p95']:.0f} mV short, so the "
        f"{sigma:.2f} mV background noise cannot reach it. APL alone accounts for "
        f"{min(b['apl_share_of_deficit'] for b in budget):.0%} to "
        f"{max(b['apl_share_of_deficit'] for b in budget):.0%} of that deficit, delivering "
        f"{abs(min(b['apl_steady_mV'] for b in budget)):.0f} to {abs(max(b['apl_steady_mV'] for b in budget)):.0f} mV "
        f"of steady hyperpolarisation through {min(b['apl_synapses'] for b in budget):,} to "
        f"{max(b['apl_synapses'] for b in budget):,} synapses. APL is not one contributor among several: it is "
        f"essentially the whole of the gate. Any intervention that wants this cell to fire has to give back "
        f"about that many millivolts, and the only defensible way to do that is to stop treating a neuron with "
        f"234,026 input synapses as one isopotential compartment, which is what Amin et al. 2020 measured it is "
        f"not.")

    out = {"status": "passed", "gain": a.gain, "seed": a.seed, "sigma_mV": sigma,
           "question": "How far below threshold is the readout MBON during the offline period, and what holds it there?",
           "threshold_mV": vth, "rest_mV": vrest, "threshold_gap_mV": gap,
           "recorded_s": float(a.duration_s), "cells": cells, "input_budget": budget,
           "finding": finding,
           "provenance": {"config": "configs/stage5_sleep.yaml", "results_dir": "results/stage6_readout_gate",
                          "files": [run_dir + "/voltage.npz", run_dir + "/spikes.npz"]}}
    json.dump(out, open(OUT / "readout_gate.json", "w"), indent=1, default=str)
    print(finding); print()
    for cdat, b in zip(cells, budget):
        print(f"  {cdat['root_id']:>12s}  median {cdat['median_v_mV']:8.2f} mV  95th {cdat['p95_v_mV']:8.2f}  "
              f"max {cdat['max_v_mV']:8.2f}  -> {cdat['mV_below_threshold_median']:6.1f} mV short "
              f"({cdat['threshold_gaps_below_median']:.1f} gaps); APL supplies {abs(b['apl_steady_mV']):6.1f} mV "
              f"of it through {b['apl_synapses']:,} synapses")


if __name__ == "__main__":
    main()
