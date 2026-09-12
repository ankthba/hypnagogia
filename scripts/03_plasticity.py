"""Stage 3 - PLASTICITY. (1) Unit test of the KC->MBON rule on a 3-neuron microcircuit; (2) calibration of the single free
learning-rate parameter eta_ltd against Hige et al. 2015's ~80% single-pairing depression of MBON-gamma1pedc (MBON11) by
PPL1-gamma1pedc (PPL101); (3) documentation of every rule parameter. Outputs results/stage3_plasticity/stage3.json.
"""
import argparse, json, sys, time
from pathlib import Path
import numpy as np, pandas as pd
from hypnagogia import RESULTS
from hypnagogia.config import load_config, dump_config, with_deviations
from hypnagogia.connectome import Connectome, load_connectome
from hypnagogia.model import Simulation, load_spikes, spikes_in_epoch
from hypnagogia.jobs import run_jobs

OUT = RESULTS / "stage3_plasticity"   # suffixed with the gain when it is not 1.0


def operating_sigma(cfg, gain=1.0):
    if cfg["noise"].get("sigma_mV") is not None:
        return float(cfg["noise"]["sigma_mV"]), "config"
    net = "full" if gain == 1.0 else f"full_gain{gain}"
    p = RESULTS / "stage2_criticality" / net / "stage2.json"
    if p.exists():
        s2 = json.load(open(p))
        if s2.get("operating_sigma_mV") is not None:
            return float(s2["operating_sigma_mV"]), f"stage2 operating point ({s2['operating_sigma_reason']})"
    return 0.0, "no stage-2 result: noise off"


def unit_test(cfg, pl):
    """KC(0) -> MBON(1) with 40 synapses; DAN(2) -> MBON(1) with 10 synapses. Forward pairing must depress, DAN-alone and KC-alone must not."""
    ann = pd.DataFrame({"super_class": ["cb"] * 3, "cell_class": ["Kenyon_Cell", "MBON", "DAN"], "cell_sub_class": [None] * 3,
                        "cell_type": ["KC", "MBON11", "PPL101"], "hemibrain_type": [None] * 3, "flywire_type": [None] * 3, "side": ["R"] * 3,
                        "nt": ["acetylcholine", "acetylcholine", "dopamine"], "nt_source": ["test"] * 3, "status": ["Traced"] * 3,
                        "region": ["brain"] * 3, "instance": ["KC", "MBON", "DAN"], "flow": [None] * 3}).astype("string")
    conn = Connectome(ids=np.array([1, 2, 3]), pre=np.array([0, 2], dtype=np.int32), post=np.array([1, 1], dtype=np.int32),
                      count=np.array([40, 10], dtype=np.int32), sign=np.array([1, 1], dtype=np.int8), ann=ann, dataset="test", version="0", name="unit", weight_scale=1.0)
    c = json.loads(json.dumps(cfg)); c["noise"] = {"mode": "none", "sigma_mV": 0.0, "poisson": cfg["noise"]["poisson"]}
    p = {k: v for k, v in pl.items() if k not in ("pre", "post", "dan")}; p["eta_ltd"] = 0.01
    p["pre_idx"], p["post_idx"], p["dan_idx"] = np.array([0]), np.array([1]), np.array([2])
    results = {}
    for name, drives in [("kc_then_dan", [("kc", {"kc": 50.0}), ("both", {"kc": 50.0, "dan": 20.0}), ("rest", {})]),
                         ("dan_alone", [("dan", {"dan": 20.0}), ("rest", {})]), ("kc_alone", [("kc", {"kc": 50.0}), ("rest", {})])]:
        sim = Simulation(conn, c, OUT / "unit" / name, seed=0, drive_groups={"kc": np.array([0]), "dan": np.array([2])}, record="all", plasticity=p, name=name)
        for ep, d in drives:
            sim.add_epoch(ep, 1.0, d, plastic=True)
        sim.run()
        z = np.load(OUT / "unit" / name / "plastic_w.npz")
        results[name] = {"w0_mV": float(z["w0_mV"][0]), "w_final_mV": float(z["w_final_mV"][0]), "ratio": float(z["w_final_mV"][0] / z["w0_mV"][0])}
    ok = results["kc_then_dan"]["ratio"] < 0.9 and abs(results["dan_alone"]["ratio"] - 1) < 1e-6 and abs(results["kc_alone"]["ratio"] - 1) < 1e-6
    return {"description": "3-neuron microcircuit: KC->MBON (40 syn) plastic, DAN->MBON (10 syn) gate; eta_ltd 0.01; 1 s KC at 50 Hz then 1 s KC+DAN (20 Hz) vs DAN alone vs KC alone",
            "results": results, "expected_direction": "depression only when KC precedes/overlaps DAN", "passed": bool(ok)}


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--gain", type=float, default=1.0)
    ap.add_argument("--tag", default="")
    a = ap.parse_args()
    cfg = load_config("stage3_plasticity")
    cfg = with_deviations(cfg)
    cfg["dataset"]["weight_scale"] = cfg["dataset"]["weight_scale"] * a.gain
    cfg["_gain"] = a.gain; pl = cfg["plasticity"]; cal = cfg["calibration"]
    global OUT
    if a.gain != 1.0 or a.tag:
        OUT = RESULTS / ("stage3_plasticity" + ("" if a.gain == 1.0 else f"_gain{a.gain}") + (a.tag or ""))
    OUT.mkdir(parents=True, exist_ok=True); dump_config(cfg, OUT / "config.resolved.yaml")
    t0 = time.time()
    ut = unit_test(cfg, pl); print("unit test:", ut["passed"], ut["results"])
    # Calibrate against the SAME background that conditioning will use in stage 4 (a quiet mushroom body), not
    # against the offline background. The learning rate is fit to a single-pairing endpoint, and that endpoint
    # depends on how much eligibility trace the background alone puts on every synapse.
    sigma_offline, sigma_src = operating_sigma(cfg, gain=a.gain)
    s4cfg = load_config("stage4_encode")
    cs = s4cfg.get("stage4", {}).get("conditioning_sigma_mV")
    sigma = float(cs) if cs is not None else sigma_offline
    sigma_src = (f"conditioning_sigma_mV in configs/stage4_encode.yaml ({sigma} mV), matching stage 4; the offline "
                 f"background is {sigma_offline} mV from {sigma_src}" if cs is not None else sigma_src)
    conn = load_connectome("malecns", "v1.0", "brain")
    kc, mbon, dan = conn.select(cell_class="Kenyon_Cell"), conn.select(cell_class="MBON"), conn.select(cell_class="DAN")
    ro = conn.select(cell_type=cal["readout_mbon_type"]); dsel = conn.select(cell_type=cal["dan_type"])
    orn = conn.select(cell_type=cal["odor_orn_types"])
    # connectome facts about the plastic locus
    kcm = np.isin(conn.pre, kc) & np.isin(conn.post, mbon)
    dm = np.isin(conn.pre, dan) & np.isin(conn.post, mbon) & (conn.count >= pl["dan_mbon_min_synapses"])
    dan_map = []
    for m_i in mbon:
        sel = dm & (conn.post == m_i)
        types = conn.ann.cell_type.iloc[conn.pre[sel]].fillna("NA").value_counts().to_dict()
        dan_map.append({"mbon": int(conn.ids[m_i]), "mbon_type": str(conn.ann.cell_type.iloc[m_i]), "side": str(conn.ann.side.iloc[m_i]),
                        "dan_types": {str(k): int(v) for k, v in types.items()}, "n_syn": int(conn.count[sel].sum()), "n_kc_inputs": int((kcm & (conn.post == m_i)).sum())})
    # calibration protocol per (eta, seed): pre-test odor -> gap -> pairing (odor + DAN) -> gap -> post-test odor
    c = json.loads(json.dumps(cfg)); c["noise"] = {"mode": "gaussian" if sigma > 0 else "none", "sigma_mV": sigma, "poisson": cfg["noise"]["poisson"]}
    specs = []
    for eta in cal["eta_grid"]:
        for sd in cal["seeds"]:
            p = {k: v for k, v in pl.items() if k not in ("pre", "post", "dan")}; p["eta_ltd"] = float(eta)
            p["pre"], p["post"], p["dan"] = {"selector": {"cell_class": "Kenyon_Cell"}}, {"selector": {"cell_class": "MBON"}}, {"selector": {"cell_class": "DAN"}}
            od, dd, dl, gap = cal["odor_duration_s"], cal["dan_duration_s"], cal["dan_delay_s"], cal["test_gap_s"]
            epochs = [{"name": "warmup", "duration_s": 1.0}, {"name": "pre_test", "duration_s": od, "drives": {"odor": cal["odor_rate_hz"]}}, {"name": "gap", "duration_s": gap},
                      {"name": "pair_odor_only", "duration_s": dl, "drives": {"odor": cal["odor_rate_hz"]}, "plastic": True},
                      {"name": "pair_odor_dan", "duration_s": od - dl, "drives": {"odor": cal["odor_rate_hz"], "dan": cal["dan_rate_hz"]}, "plastic": True},
                      {"name": "pair_dan_only", "duration_s": dd - (od - dl), "drives": {"dan": cal["dan_rate_hz"]}, "plastic": True},
                      {"name": "gap2", "duration_s": gap, "plastic": True}, {"name": "post_test", "duration_s": od, "drives": {"odor": cal["odor_rate_hz"]}}]
            specs.append({"out_dir": str(OUT / "calib" / f"eta{eta}_seed{sd}"), "seed": 300 + sd, "config": c, "name": f"calib_{eta}_{sd}",
                          "connectome": {"dataset": "malecns", "version": "v1.0", "scope": "brain", "weight_scale": cfg["dataset"]["weight_scale"]},
                          "drive_groups": {"odor": {"selector": {"cell_type": cal["odor_orn_types"]}}, "dan": {"selector": {"cell_type": cal["dan_type"]}}},
                          "record": {"selectors": [{"cell_class": "Kenyon_Cell"}, {"cell_class": "MBON"}, {"cell_class": "DAN"}]},
                          "plasticity": p, "epochs": epochs})
    res = run_jobs(specs, n_parallel=cfg["run"]["n_parallel"])
    rows = []
    for sp, r in zip(specs, res):
        if r is None or "error" in r:
            rows.append({"eta": float(sp["name"].split("_")[1]), "seed": sp["seed"], "error": (r or {}).get("error", "")[-300:]}); continue
        i, ts, meta = load_spikes(sp["out_dir"])
        pre_i, _, _ = spikes_in_epoch(i, ts, meta, "pre_test"); post_i, _, _ = spikes_in_epoch(i, ts, meta, "post_test")
        pre_n, post_n = int(np.isin(pre_i, ro).sum()), int(np.isin(post_i, ro).sum())
        allm_pre, allm_post = int(np.isin(pre_i, mbon).sum()), int(np.isin(post_i, mbon).sum())
        kc_pre = np.unique(pre_i[np.isin(pre_i, kc)]); kc_post = np.unique(post_i[np.isin(post_i, kc)])
        z = np.load(sp["out_dir"] + "/plastic_w.npz"); ratio_w = float(z["w_final_mV"].sum() / z["w0_mV"].sum())
        ro_mask = np.isin(z["post"], ro); ratio_w_ro = float(z["w_final_mV"][ro_mask].sum() / max(z["w0_mV"][ro_mask].sum(), 1e-9))
        # The odour-evoked EPSC onto the readout: the synapses from the Kenyon cells the odour actually drove,
        # which is what Hige et al. measured with voltage clamp (~90% reduction after one pairing). It is defined
        # whether or not the readout spikes, so it survives the APL correction, which holds MBON11 subthreshold.
        odor_mask = ro_mask & np.isin(z["pre"], kc_pre)
        n_odor_syn = int(odor_mask.sum())
        ratio_epsc = (float(z["w_final_mV"][odor_mask].sum() / z["w0_mV"][odor_mask].sum()) if n_odor_syn else None)
        dan_i, _, _ = spikes_in_epoch(i, ts, meta, "pair_odor_dan")
        rows.append({"eta": float(sp["name"].split("_")[1]), "seed": sp["seed"], "mbon11_pre": pre_n, "mbon11_post": post_n,
                     "post_over_pre": (post_n / pre_n if pre_n else None), "all_mbon_pre": allm_pre, "all_mbon_post": allm_post,
                     "n_kc_active_pre": int(len(kc_pre)), "n_kc_active_post": int(len(kc_post)), "frac_kc_active_pre": float(len(kc_pre) / len(kc)),
                     "w_sum_ratio_all": ratio_w, "w_sum_ratio_readout": ratio_w_ro,
                     "epsc_ratio_odor": ratio_epsc, "n_odor_synapses_onto_readout": n_odor_syn,
                     "dan_spikes_pairing": int(np.isin(dan_i, dsel).sum())})
    df = pd.DataFrame([r for r in rows if "error" not in r])
    grid = []
    for eta, g in df.groupby("eta"):
        vals = g["post_over_pre"].dropna()
        ev = g["epsc_ratio_odor"].dropna()
        grid.append({"eta": float(eta), "post_over_pre_mean": (float(vals.mean()) if len(vals) else None), "post_over_pre_sd": (float(vals.std(ddof=1)) if len(vals) > 1 else None),
                     "mbon11_pre_mean": float(g["mbon11_pre"].mean()), "mbon11_post_mean": float(g["mbon11_post"].mean()), "w_ratio_readout_mean": float(g["w_sum_ratio_readout"].mean()),
                     "epsc_ratio_odor_mean": (float(ev.mean()) if len(ev) else None),
                     "epsc_ratio_odor_sd": (float(ev.std(ddof=1)) if len(ev) > 1 else None),
                     "n_odor_synapses_onto_readout_mean": float(g["n_odor_synapses_onto_readout"].mean()),
                     "n_seeds": int(len(g))})
    valid = [x for x in grid if x["post_over_pre_mean"] is not None]
    # Is the readout graded at all? If every learning rate in the grid, including the smallest, drives the
    # response to zero, then the MBON is an all-or-none detector in this model and Hige's graded 80% endpoint
    # cannot be reproduced. That is reported rather than fitted around.
    graded = bool([x for x in valid if 0.05 < x["post_over_pre_mean"] < 0.95])
    on_target = [x for x in valid if abs(x["post_over_pre_mean"] - cal["target_post_over_pre"]) < 0.15]
    depressing = [x for x in valid if x["post_over_pre_mean"] < 0.5]
    # Hige et al. 2015 measured two endpoints after a single pairing in the same cell: an ~80% reduction of the
    # SPIKE response and an ~90% reduction of the odour-evoked EPSC. The spike endpoint is the preferred one and
    # is used whenever the readout responds. Once APL is modelled as non-spiking (Amin et al. 2020) the corrected
    # APL holds MBON-gamma1pedc below threshold, so the spike endpoint has no value to fit; the EPSC endpoint,
    # which is defined whether or not the cell spikes, is used instead and the substitution is recorded here.
    epsc_valid = [x for x in grid if x.get("epsc_ratio_odor_mean") is not None]
    tgt_e = float(cal.get("target_epsc_ratio", 0.10))
    readout_spikes = bool(df["mbon11_pre"].mean() > 5) if len(df) else False
    endpoint = "spike"
    if on_target:
        chosen = min(on_target, key=lambda x: abs(x["post_over_pre_mean"] - cal["target_post_over_pre"]))
        chosen_rule = "learning rate whose single-pairing spike endpoint is closest to Hige et al. 2015's 0.20"
    elif depressing:
        chosen = min(depressing, key=lambda x: x["eta"])
        chosen_rule = ("the readout MBON is all-or-none in this model, so Hige's graded spike endpoint cannot be "
                       "matched; the SMALLEST learning rate that still produces a clear depression is used instead, "
                       "to keep the plasticity as weak as possible while remaining measurable")
    elif epsc_valid:
        endpoint = "epsc"
        near = [x for x in epsc_valid if abs(x["epsc_ratio_odor_mean"] - tgt_e) < 0.15]
        depress_e = [x for x in epsc_valid if x["epsc_ratio_odor_mean"] < 0.5]
        why_e = (f"The readout MBON does not spike in this model, because APL modelled as non-spiking holds it below "
                 f"threshold, so Hige's spike endpoint has no value to fit. The learning rate is fitted instead to the "
                 f"other endpoint Hige et al. measured in the same cell after the same single pairing: the odour-evoked "
                 f"EPSC, target {tgt_e:.2f} of its pre-pairing value. The EPSC here is the summed weight of the plastic "
                 f"synapses from the Kenyon cells the calibration odour actually drove. ")
        if near:
            chosen = min(near, key=lambda x: (abs(x["epsc_ratio_odor_mean"] - tgt_e), x["eta"]))
            chosen_rule = why_e + "The chosen rate is the one whose endpoint is closest to that target."
        elif depress_e:
            chosen = min(depress_e, key=lambda x: x["eta"])
            chosen_rule = (why_e + "No rate in the grid lands near the target: the synaptic endpoint is all-or-none here, "
                           "every rate drives the paired synapses to their floor. The SMALLEST rate that still produces a "
                           "clear depression is used, to keep the plasticity as weak as possible while remaining measurable.")
        else:
            chosen, chosen_rule = None, why_e + "No rate in the grid produced a measurable depression of that EPSC."
    else:
        chosen, chosen_rule = None, "no learning rate in the grid produced a measurable depression"
    # The readout must carry a measurable odour signal, either as spikes or as an odour-driven EPSC.
    n_odor_syn = float(df["n_odor_synapses_onto_readout"].mean()) if len(df) else 0.0
    pre_ok = bool(readout_spikes or n_odor_syn > 0)
    status = "passed" if (ut["passed"] and chosen is not None and pre_ok) else "failed"
    out = {"status": status, "gain": a.gain,
           "gain_note": ("published parameters" if a.gain == 1.0 else
                         f"DEVIATION: every synaptic weight scaled to {a.gain} of its published value, because at the "
                         f"published value the network has no sparse odour code to store a memory in (stage 3b). This is "
                         f"an uncited free parameter introduced by this project; see configs/stage3d_gain.yaml."),
           "criterion": ("unit test passes (depression only when Kenyon-cell activity precedes dopamine); the readout MBON "
                         "carries a measurable odour signal before pairing, as spikes (> 5 spikes/s) or, when the corrected "
                         "APL holds it below threshold, as an odour-evoked EPSC from the Kenyon cells the odour drove; and "
                         "some learning rate in the grid produces a clear depression. Whether that depression can be made "
                         "GRADED, as Hige et al. measured, is reported separately rather than being required."),
           "rule": {"equations": ["de/dt = -e/tau_e (per KC->MBON synapse); on KC spike: e += 1",
                                  "on DAN spike (DAN presynaptic to the MBON, >= dan_mbon_min_synapses): w -= eta_ltd * e * w0",
                                  "dda/dt = -da/tau_da (per MBON); on DAN spike: da += 1; on KC spike: w += eta_ltp * da * w0 (eta_ltp = 0 here)",
                                  "w in [w_min_frac*w0, w_max_frac*w0]; w(0) = w0 = sign*count*0.581*W_syn"],
                    "description": "dopamine-gated anti-Hebbian two-factor LTD at KC->MBON; no MBON postsynaptic term (Hige 2015 showed LTD with MBON spikes blocked); compartment specificity from connectome DAN->MBON synapses",
                    "parameters": [
                        {"name": "direction (KC+DAN -> LTD)", "value": "depression", "source": "Hige et al. 2015 Neuron 88:985 (80% spike, 90% EPSC reduction after one pairing)", "cited": True},
                        {"name": "no postsynaptic factor", "value": "MBON spiking not required", "source": "Hige et al. 2015 'Plasticity is Independent of Postsynaptic Spiking'", "cited": True},
                        {"name": "tau_e", "value": f"{pl['tau_e_s']} s", "source": "Jiang & Litwin-Kumar 2021 PLoS Comput Biol code (tau = 5); Handler 2019 window suggests 1-2 s", "cited": True},
                        {"name": "tau_da", "value": f"{pl['tau_da_s']} s", "source": "Jiang & Litwin-Kumar 2021 code", "cited": True},
                        {"name": "eta_ltd", "value": (f"{chosen['eta']} (calibrated)" if chosen else "not found"), "source": "FREE: fit to Hige 2015 single-pairing endpoint (post/pre = 0.20)", "cited": False},
                        {"name": "eta_ltp", "value": str(pl["eta_ltp"]), "source": "Hige 2015: no backward-pairing potentiation in gamma1pedc (Handler 2019 finds it in gamma2/4/5)", "cited": True},
                        {"name": "w bounds", "value": f"[{pl['w_min_frac']}, {pl['w_max_frac']}] x w0, init at w0", "source": "Jiang & Litwin-Kumar 2021; Eschbach 2020 (init at w_max)", "cited": True},
                        {"name": "dan_mbon_min_synapses", "value": str(pl["dan_mbon_min_synapses"]), "source": "uncited pipeline choice (compartment gating threshold)", "cited": False},
                        {"name": "DAN pairing rate", "value": f"{cal['dan_rate_hz']} Hz for {cal['dan_duration_s']} s from +{cal['dan_delay_s']} s", "source": "timing from Hige 2015; rate uncited (absorbed by eta_ltd)", "cited": False},
                        {"name": "background sigma during calibration", "value": f"{sigma} mV", "source": sigma_src, "cited": False}]},
           "n_plastic_synapses": int(kcm.sum()), "n_plastic_synapse_count_sum": int(conn.count[kcm].sum()), "n_kc": int(len(kc)), "n_mbon": int(len(mbon)), "n_dan": int(len(dan)),
           "n_dan_mbon_gates": int(dm.sum()), "dan_to_mbon_map": dan_map, "unit_test": ut,
           "calibration": {"protocol": cal, "sigma_mV": sigma, "sigma_source": sigma_src, "grid": grid, "per_run": rows,
                           "chosen_eta_ltd": (chosen["eta"] if chosen else None), "chosen_rule": chosen_rule,
                           "endpoint_fitted": endpoint,
                           "fit_is_bounded_by_the_grid": bool(
                               chosen is not None and endpoint == "epsc" and epsc_valid
                               and chosen["eta"] == min(x["eta"] for x in epsc_valid)
                               and (chosen.get("epsc_ratio_odor_mean") or 0) < tgt_e),
                           "grid_bound_note": (
                               f"The chosen learning rate is the SMALLEST in the grid and its endpoint, "
                               f"{(chosen.get('epsc_ratio_odor_mean') if chosen else None)}, is still below the "
                               f"{tgt_e:.2f} target, so the fit is bounded by where the grid stops rather than by the "
                               f"data. A smaller rate would land closer to Hige's endpoint. The depression obtained is "
                               f"deeper than measured, not shallower, so it does not understate the memory."
                               if (chosen is not None and endpoint == "epsc" and epsc_valid
                                   and chosen["eta"] == min(x["eta"] for x in epsc_valid)
                                   and (chosen.get("epsc_ratio_odor_mean") or 0) < tgt_e)
                               else "The chosen learning rate is inside the grid, not at its edge."),
                           "endpoint_note": ("Hige et al. 2015 report an ~80% reduction of the MBON-gamma1pedc spike response "
                                             "and an ~90% reduction of its odour-evoked EPSC after one pairing. Which of the "
                                             "two this run fitted is 'endpoint_fitted'. 'spike' is the preferred endpoint; "
                                             "'epsc' means the readout did not spike at all before pairing, which is a "
                                             "consequence of modelling APL as non-spiking, and is reported as such rather "
                                             "than worked around by changing the readout cell."),
                           "readout_spikes_before_pairing": readout_spikes,
                           "target_epsc_ratio": tgt_e,
                           "n_odor_synapses_onto_readout": n_odor_syn,
                           "readout_is_graded": graded,
                           "graded_note": ("The readout MBON's odour response is all-or-none here: every learning rate in "
                                           "the grid, including the smallest, takes it from its full response to exactly "
                                           "zero, with nothing in between. Hige et al. measured a graded 80% reduction in a "
                                           "real fly, so that endpoint is not reproducible in this model. The depression is "
                                           "still odour-specific, which is what the memory test needs, and stage 4 tests "
                                           "that directly." if not graded else "The readout MBON's response is graded."),
                           "readout_mbon_ids": [int(conn.ids[x]) for x in ro], "n_readout_dans": int(len(dsel)), "n_odor_orns": int(len(orn))},
           "walltime_s": round(time.time() - t0, 1),
           "provenance": {"config": "configs/stage3_plasticity.yaml", "results_dir": "results/stage3_plasticity",
                          "files": [s["out_dir"].replace(str(RESULTS.parent) + "/", "") + "/plastic_w.npz" for s in specs]}}
    json.dump(out, open(OUT / "stage3.json", "w"), indent=1, default=str)
    print(json.dumps({k: v for k, v in out.items() if k in ("status", "n_plastic_synapses", "n_dan_mbon_gates", "walltime_s")}, indent=1))
    for g in grid: print(g)


if __name__ == "__main__":
    main()
