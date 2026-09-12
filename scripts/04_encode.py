"""Stage 4 - ENCODE A MEMORY. Conditioning: odour A paired with DAN activation; control: odour B, unpaired.
Verifies that the MBON response to A shifts relative to B (before vs after) across seeds, and records the KC
ensemble of each odour as a template for the replay test. If learning does not occur, the stage FAILS and says so.
Outputs results/stage4_learning/stage4.json plus per-seed learned weights for stages 5-6.
"""
import argparse, json, sys, time
from pathlib import Path
import numpy as np, pandas as pd
from hypnagogia import RESULTS
from hypnagogia.config import load_config, dump_config
from hypnagogia.connectome import load_connectome
from hypnagogia.jobs import run_jobs
from hypnagogia.model import load_spikes, spikes_in_epoch
from hypnagogia.analysis.stats import paired_effect

OUT = RESULTS / "stage4_learning"


def operating_sigma(cfg, network="full", gain=1.0):
    network = network if gain == 1.0 else f"{network}_gain{gain}"
    if cfg["noise"].get("sigma_mV") is not None:
        return float(cfg["noise"]["sigma_mV"]), "config"
    p = RESULTS / "stage2_criticality" / network / "stage2.json"
    if p.exists():
        s2 = json.load(open(p))
        if s2.get("operating_sigma_mV") is not None:
            return float(s2["operating_sigma_mV"]), f"stage 2 operating point: {s2['operating_sigma_reason']}"
    return 0.0, "no stage-2 result available: background noise off"


def eta_from_stage3(cfg):
    p = RESULTS / "stage3_plasticity" / "stage3.json"
    if p.exists():
        s3 = json.load(open(p))
        e = s3.get("calibration", {}).get("chosen_eta_ltd")
        if e is not None:
            return float(e), "stage 3 calibration against Hige et al. 2015"
    if cfg["plasticity"].get("eta_ltd") is not None:
        return float(cfg["plasticity"]["eta_ltd"]), "config"
    raise SystemExit("no eta_ltd: run scripts/03_plasticity.py first")


def build_epochs(s4, plastic_conditioning=True):
    """Conditioning protocol.

    Every odour presentation is preceded by a reset of membrane potentials and synaptic conductances (learned
    weights are untouched). This is necessary, not cosmetic: the model has no adaptation or short-term
    depression, so the first odour drives it into a self-sustaining state it never leaves (stage 3b). Without a
    reset, the second odour would be delivered into the first odour's ongoing activity and every measurement
    after the first presentation would be contaminated. Each reset is recorded in the epoch table.
    """
    g, od, w = s4["gap_s"], s4["odor_duration_s"], s4["warmup_s"]
    dl, dd = s4["dan_delay_s"], s4["dan_duration_s"]
    R = bool(s4.get("reset_between_presentations", True))
    ep = [{"name": "warmup", "duration_s": w},
          {"name": "pre_test_A", "duration_s": od, "drives": {"odor_A": s4["odor_rate_hz"]}, "reset": R},
          {"name": "gap", "duration_s": g},
          {"name": "pre_test_B", "duration_s": od, "drives": {"odor_B": s4["odor_rate_hz"]}, "reset": R},
          {"name": "gap", "duration_s": g}]
    for k in range(s4["n_pairings"]):
        ep += [{"name": "pair_A_only", "duration_s": dl, "drives": {"odor_A": s4["odor_rate_hz"]}, "plastic": plastic_conditioning, "reset": R},
               {"name": "pair_A_dan", "duration_s": od - dl, "drives": {"odor_A": s4["odor_rate_hz"], "dan": s4["dan_rate_hz"]}, "plastic": plastic_conditioning},
               {"name": "pair_dan_only", "duration_s": max(dd - (od - dl), 0.0), "drives": {"dan": s4["dan_rate_hz"]}, "plastic": plastic_conditioning},
               {"name": "iti", "duration_s": s4["iti_s"], "plastic": plastic_conditioning},
               {"name": "unpaired_B", "duration_s": od, "drives": {"odor_B": s4["odor_rate_hz"]}, "plastic": plastic_conditioning, "reset": R},
               {"name": "iti", "duration_s": s4["iti_s"], "plastic": plastic_conditioning}]
    ep += [{"name": "post_test_A", "duration_s": od, "drives": {"odor_A": s4["odor_rate_hz"]}, "reset": R},
           {"name": "gap", "duration_s": g},
           {"name": "post_test_B", "duration_s": od, "drives": {"odor_B": s4["odor_rate_hz"]}, "reset": R}]
    return ep


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--seeds", default=None); ap.add_argument("--shuffled", action="store_true")
    ap.add_argument("--analyse-only", action="store_true"); ap.add_argument("--gain", type=float, default=1.0)
    a = ap.parse_args()
    cfg = load_config("stage4_encode"); s4 = cfg["stage4"]; pl = cfg["plasticity"]
    seeds = [int(x) for x in a.seeds.split(",")] if a.seeds else s4["seeds"]
    tag = ("shuffled" if a.shuffled else "real") + ("" if a.gain == 1.0 else f"_gain{a.gain}")
    out = OUT / tag; out.mkdir(parents=True, exist_ok=True); dump_config(cfg, out / "config.resolved.yaml")
    # Conditioning happens against a quiet mushroom body, not against the offline background. In a real fly the
    # Kenyon-cell spontaneous rate is about 0.1 Hz (Turner, Bazhenov & Laurent 2008), so an odour-evoked ensemble
    # stands out against near-silence. Conditioning at the offline background instead would leave every Kenyon
    # cell with a large eligibility trace when the dopaminergic neurons fire, and the plasticity would not be
    # odour-specific. The offline background is used in stage 5, where it belongs.
    sigma_offline, sigma_src = operating_sigma(cfg, gain=a.gain)
    sigma = float(s4["conditioning_sigma_mV"]) if s4.get("conditioning_sigma_mV") is not None else sigma_offline
    sigma_src = (f"conditioning_sigma_mV in configs/stage4_encode.yaml ({sigma} mV); the offline background "
                 f"({sigma_offline} mV, from {sigma_src}) is applied in stage 5"
                 if s4.get("conditioning_sigma_mV") is not None else sigma_src)
    eta, eta_src = eta_from_stage3(cfg)
    conn = load_connectome("malecns", "v1.0", "brain")
    kc, mbon = conn.select(cell_class="Kenyon_Cell"), conn.select(cell_class="MBON")
    ro = conn.select(cell_type=s4["readout_mbon_type"])
    c = json.loads(json.dumps(cfg)); c["noise"] = {"mode": "gaussian" if sigma > 0 else "none", "sigma_mV": sigma, "poisson": cfg["noise"]["poisson"]}
    p = {k: v for k, v in pl.items() if k not in ("pre", "post", "dan")}; p["eta_ltd"] = eta
    p["pre"], p["post"], p["dan"] = pl["pre"], pl["post"], pl["dan"]
    specs = []
    for sd in seeds:
        cspec = {"dataset": "malecns", "version": "v1.0", "scope": "brain", "weight_scale": cfg["dataset"]["weight_scale"] * a.gain}
        if a.shuffled:
            cspec["shuffle"] = {"seed": sd, "strata": "cell_class", "swaps_per_edge": 10}
        specs.append({"out_dir": str(out / f"seed{sd}"), "seed": 400 + sd, "config": c, "name": f"encode_{tag}_{sd}",
                      "connectome": cspec,
                      "drive_groups": {"odor_A": {"selector": {"cell_type": s4["odor_A_orn_types"]}},
                                       "odor_B": {"selector": {"cell_type": s4["odor_B_orn_types"]}},
                                       "dan": {"selector": {"cell_type": s4["dan_type"]}}},
                      "record": {"selectors": [{"cell_class": "Kenyon_Cell"}, {"cell_class": "MBON"}, {"cell_class": "DAN"}, {"cell_type": {"regex": r"^ORN_"}}]},
                      "plasticity": p, "epochs": build_epochs(s4)})
    t0 = time.time()
    if not a.analyse_only:
        res = run_jobs(specs, n_parallel=cfg["run"]["n_parallel"])
        errs = [(s["name"], (r or {}).get("error", "")[-400:]) for s, r in zip(specs, res) if r is None or "error" in r]
        if errs:
            print("ERRORS:", errs[:3])
    rows, templates = [], {}
    for sp, sd in zip(specs, seeds):
        try:
            i, ts, meta = load_spikes(sp["out_dir"])
        except Exception as e:
            rows.append({"seed": sd, "error": str(e)}); continue
        def count(ep, idx):
            ii, _, eps = spikes_in_epoch(i, ts, meta, ep)
            dur = sum(e["duration_s"] for e in eps)
            return float(np.isin(ii, idx).sum() / dur), ii
        A_pre, iApre = count("pre_test_A", ro); A_post, iApost = count("post_test_A", ro)
        B_pre, iBpre = count("pre_test_B", ro); B_post, iBpost = count("post_test_B", ro)
        allm_pre = float(np.isin(iApre, mbon).sum()); allm_post = float(np.isin(iApost, mbon).sum())
        ens, order = {}, {}
        for nm, ep in (("A_pre", "pre_test_A"), ("B_pre", "pre_test_B"), ("A_post", "post_test_A"), ("B_post", "post_test_B")):
            spk, tt, eps = spikes_in_epoch(i, ts, meta, ep)
            km = np.isin(spk, kc)
            k, kt = spk[km], tt[km].astype(np.float64) * meta["dt_ms"] * 1e-3
            cnt = pd.Series(k).value_counts()
            members = np.sort(cnt[cnt >= s4["kc_template_threshold_spikes"]].index.to_numpy()).astype(np.int64)
            ens[nm] = members
            # template order: each member's FIRST spike time in the odour response, ranked. Stage 6 uses this as
            # the reference sequence for the rank-order replay test (Foster & Wilson 2006).
            if len(members):
                first = {}
                for nid, t_ in zip(k, kt):
                    if nid not in first or t_ < first[nid]:
                        first[nid] = t_
                lat = np.array([first.get(int(m), np.inf) for m in members])
                order[nm] = np.argsort(np.argsort(lat)).astype(np.int32)
            else:
                order[nm] = np.array([], dtype=np.int32)
        z = np.load(sp["out_dir"] + "/plastic_w.npz")
        ro_mask = np.isin(z["post"], ro)
        inA = np.isin(z["pre"], ens["A_pre"]); inB = np.isin(z["pre"], ens["B_pre"])
        per_mbon = []
        for m_i in mbon:
            per_mbon.append({"id": int(conn.ids[m_i]), "type": str(conn.ann.cell_type.iloc[m_i]), "side": str(conn.ann.side.iloc[m_i]),
                             "A_pre": float(np.sum(iApre == m_i)), "A_post": float(np.sum(iApost == m_i)),
                             "B_pre": float(np.sum(iBpre == m_i)), "B_post": float(np.sum(iBpost == m_i))})
        rows.append({"seed": sd, "A_pre": A_pre, "A_post": A_post, "B_pre": B_pre, "B_post": B_post,
                     "delta_A": A_post - A_pre, "delta_B": B_post - B_pre,
                     "all_mbon_pre": allm_pre, "all_mbon_post": allm_post,
                     "kc_ensemble_A_size": int(len(ens["A_pre"])), "kc_ensemble_B_size": int(len(ens["B_pre"])),
                     "kc_overlap": int(len(np.intersect1d(ens["A_pre"], ens["B_pre"]))),
                     "frac_kc_active_A": float(len(ens["A_pre"]) / len(kc)), "frac_kc_active_B": float(len(ens["B_pre"]) / len(kc)),
                     "w_kc_mbon_readout_before": float(z["w0_mV"][ro_mask].sum()), "w_kc_mbon_readout_after": float(z["w_final_mV"][ro_mask].sum()),
                     "w_A_ensemble_ratio": float(z["w_final_mV"][ro_mask & inA].sum() / max(abs(z["w0_mV"][ro_mask & inA].sum()), 1e-9)),
                     "w_B_ensemble_ratio": float(z["w_final_mV"][ro_mask & inB].sum() / max(abs(z["w0_mV"][ro_mask & inB].sum()), 1e-9)),
                     "per_mbon": per_mbon})
        templates[str(sd)] = {k: [int(conn.ids[x]) for x in v] for k, v in ens.items()}
        templates[str(sd)]["_index"] = {k: [int(x) for x in v] for k, v in ens.items()}
        templates[str(sd)]["_order"] = {k: [int(x) for x in v] for k, v in order.items()}
    np.savez_compressed(out / "kc_templates.npz", **{f"{sd}_{k}": np.asarray(v, dtype=np.int64)
                                                     for sd, d in templates.items() for k, v in d.items()
                                                     if k not in ("_index", "_order")})
    json.dump(templates, open(out / "kc_templates.json", "w"))
    ok = [r for r in rows if "error" not in r]
    eff = {}
    if ok:
        dA = np.array([r["delta_A"] for r in ok]); dB = np.array([r["delta_B"] for r in ok])
        eff = paired_effect(dA, dB, name="deltaA_minus_deltaB")
        eff["delta_A_mean"] = float(dA.mean()); eff["delta_B_mean"] = float(dB.mean())
        eff["A_pre_mean"] = float(np.mean([r["A_pre"] for r in ok])); eff["A_post_mean"] = float(np.mean([r["A_post"] for r in ok]))
        eff["B_pre_mean"] = float(np.mean([r["B_pre"] for r in ok])); eff["B_post_mean"] = float(np.mean([r["B_post"] for r in ok]))
        eff["n_seeds"] = len(ok)
    learned = bool(eff and eff["diff"] < 0 and eff["ci95"][1] < 0)
    responds = bool(ok and np.mean([r["A_pre"] for r in ok]) > 1.0)
    status = "passed" if learned and responds else "failed"
    note = []
    if not responds: note.append(f"the readout MBON ({s4['readout_mbon_type']}) does not respond to odour A before conditioning (mean {np.mean([r['A_pre'] for r in ok]) if ok else 0:.2f} Hz): no learning can be measured")
    if ok and not learned: note.append("conditioning did not shift the odour-A response relative to odour B (the 95% CI of the difference of deltas includes or exceeds 0)")
    out_d = {"status": status, "criterion": s4["criterion"], "learning_verified": learned, "network": tag,
             "reset_between_presentations": bool(s4.get("reset_between_presentations", True)),
             "reset_note": ("Membrane potentials and synaptic conductances are reset to rest before every odour "
                            "presentation; learned weights are not. The model never returns to baseline on its own "
                            "(stage 3b), so without this the second odour would be delivered into the first odour's "
                            "ongoing activity and every later measurement would be contaminated."),
             "protocol": {"odor_A": {"orn_types": s4["odor_A_orn_types"], "n_orns": int(len(conn.select(cell_type=s4["odor_A_orn_types"]))), "rate_hz": s4["odor_rate_hz"]},
                          "odor_B": {"orn_types": s4["odor_B_orn_types"], "n_orns": int(len(conn.select(cell_type=s4["odor_B_orn_types"]))), "rate_hz": s4["odor_rate_hz"]},
                          "dans": {"types": [s4["dan_type"]], "n": int(len(conn.select(cell_type=s4["dan_type"]))), "rate_hz": s4["dan_rate_hz"]},
                          "n_pairings": s4["n_pairings"], "odor_s": s4["odor_duration_s"], "iti_s": s4["iti_s"], "test_s": s4["odor_duration_s"],
                          "sigma_mV": sigma, "sigma_source": sigma_src, "sigma_offline_mV": sigma_offline,
                          "eta_ltd": eta, "eta_source": eta_src,
                          "total_duration_s": sum(e["duration_s"] for e in build_epochs(s4))},
             "readout_mbons": [{"root_id": str(conn.ids[x]), "type": s4["readout_mbon_type"], "side": str(conn.ann.side.iloc[x])} for x in ro],
             "seeds": seeds, "per_seed": rows, "effect": eff, "notes": note,
             "kc_ensemble_summary": ({"A_size_mean": float(np.mean([r["kc_ensemble_A_size"] for r in ok])),
                                      "B_size_mean": float(np.mean([r["kc_ensemble_B_size"] for r in ok])),
                                      "overlap_mean": float(np.mean([r["kc_overlap"] for r in ok])),
                                      "frac_kc_active_A": float(np.mean([r["frac_kc_active_A"] for r in ok])),
                                      "n_kc": int(len(kc))} if ok else {}),
             "walltime_s": round(time.time() - t0, 1),
             "provenance": {"config": "configs/stage4_encode.yaml", "results_dir": f"results/stage4_learning/{tag}",
                            "files": [f"results/stage4_learning/{tag}/seed{sd}/plastic_w.npz" for sd in seeds]}}
    json.dump(out_d, open(out / "stage4.json", "w"), indent=1, default=str)
    if tag == "real":
        json.dump(out_d, open(OUT / "stage4.json", "w"), indent=1, default=str)
    print(json.dumps({k: v for k, v in out_d.items() if k in ("status", "learning_verified", "effect", "kc_ensemble_summary", "notes", "walltime_s")}, indent=1, default=str))


if __name__ == "__main__":
    main()
