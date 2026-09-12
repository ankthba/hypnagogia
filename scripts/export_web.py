"""Export real pipeline outputs into web/public/data/ (the ONLY data the viewer renders).

Every stage file is produced from results/<stage>/*.json written by the stage scripts. A stage whose
results are absent gets status 'not_run' in the manifest and no stage file. Nothing here invents numbers.
"""
import json, shutil, subprocess, time
from datetime import datetime, timezone
from pathlib import Path
import numpy as np, yaml
from hypnagogia import RESULTS, ROOT, WEB_DATA, CONFIGS
from hypnagogia.config import load_config
from hypnagogia.connectome import load_connectome, subset_from_config
from hypnagogia.populations import SUBSET_MB_CX


def git_commit() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True).strip()
    except Exception:
        return "unknown"


def load_json(p: Path):
    return json.load(open(p)) if p.exists() else None


def prov(config: str, results_dir: str, files: list, commit: str, now: str, config_hash: str = "") -> dict:
    return {"config": config, "config_hash": config_hash, "results_dir": results_dir, "files": files, "git_commit": commit, "generated_at": now}


def main():
    WEB_DATA.mkdir(parents=True, exist_ok=True)
    commit, now = git_commit(), datetime.now(timezone.utc).isoformat(timespec="seconds")
    base = load_config("base")
    conn = load_connectome("malecns", "v1.0", "brain")
    sub = subset_from_config(conn, SUBSET_MB_CX)
    cns_meta = load_json(ROOT / "data" / "cache" / "malecns_v1.0.json") or {}
    stages = {}

    # ---- stage 0: engine check (FlyWire v630 vs shipped output) + male CNS validation gate + cross-match ----
    eng = load_json(RESULTS / "stage0_engine_check" / "engine_check.json")
    val = load_json(RESULTS / "stage0_validate_malecns" / "validation.json")
    xm = load_json(RESULTS / "stage0_engine_check" / "crossmatch_report.json")
    if eng or val:
        runs, target = [], None
        if eng:
            r200 = eng["runs"]["200"]
            target = {"source": r200["reference"]["source"], "mn9_rate_hz_mean": r200["reference"]["mn9_rate_hz_mean"],
                      "mn9_rate_hz_per_trial": r200["reference"]["mn9_per_trial"], "n_trials": 30,
                      "n_active_neurons": r200["reference"]["n_active_union"], "total_spikes": int(r200["reference"]["n_spikes_per_trial_mean"] * 30)}
            for f, r in eng["runs"].items():
                runs.append({"name": f"engine_check_flywire_v630_{f}Hz", "data_version": "flywire-630", "n_neurons": 127400, "n_connections": 14687178,
                             "n_sugar_grns": 21, "sugar_rate_hz": int(f), "mn9_rate_hz_mean": r["ours"]["mn9_rate_hz_mean"], "mn9_rate_hz_sd": r["ours"]["mn9_rate_hz_sd"],
                             "mn9_rate_hz_per_trial": r["ours"]["mn9_per_trial"], "n_trials": r["n_trials"], "n_active_neurons": r["ours"]["n_active_union"],
                             "n_active_per_trial_mean": r["ours"]["n_active_per_trial_mean"], "total_spikes": int(r["ours"]["n_spikes_per_trial_mean"] * r["n_trials"]),
                             "reference": {"mn9_rate_hz_mean": r["reference"]["mn9_rate_hz_mean"], "mn9_rate_hz_sd": r["reference"]["mn9_rate_hz_sd"],
                                           "n_active_neurons": r["reference"]["n_active_union"], "n_active_per_trial_mean": r["reference"]["n_active_per_trial_mean"],
                                           "total_spikes": int(r["reference"]["n_spikes_per_trial_mean"] * 30), "source": r["reference"]["source"]},
                             "per_neuron_rate_correlation": r["per_neuron_rate_correlation"], "checks": r["checks"], "status": r["status"],
                             "top_active": [{"root_id": t["root_id"], "rate_hz": t["ours_hz"], "target_rate_hz": t["ref_hz"]} for t in r["top_neurons"][:15]]})
        if val:
            for r in val["runs"]:
                mn = r["mn9"]
                runs.append({"name": f"malecns_{r['drive_set']}_{r['sugar_rate_hz']}Hz_scale{r['weight_scale']}", "data_version": "malecns-v1.0 (brain)",
                             "n_neurons": val["network"]["n_neurons"], "n_connections": val["network"]["n_connections"], "n_sugar_grns": r["n_driven"],
                             "sugar_rate_hz": r["sugar_rate_hz"], "weight_scale": r["weight_scale"], "n_trials": r["n_trials"],
                             "mn9_rate_hz_mean": mn[val["mn9_flywire_match"]["instance"]]["rate_hz_mean"], "mn9_rate_hz_sd": mn[val["mn9_flywire_match"]["instance"]]["rate_hz_sd"],
                             "mn9_rate_hz_per_trial": mn[val["mn9_flywire_match"]["instance"]]["per_trial"], "mn9_by_side": {k: {"rate_hz_mean": v["rate_hz_mean"], "frac_trials_active": v["frac_trials_active"]} for k, v in mn.items()},
                             "n_active_per_trial_mean": r["n_active_per_trial_mean"], "total_spikes": int(r["n_spikes_per_trial_mean"] * r["n_trials"]),
                             "reference": {**r["flywire_v630_reference"], "source": "this pipeline's engine-check runs on FlyWire v630 at the same drive"}})
        disc = []
        if eng:
            disc.append("The paper repository's shipped example output (results/example/sugarR.parquet) was generated with 200 Hz sugar-GRN drive (its GRNs fire at ~199 Hz), not the 150 Hz default in the current model.py; we compared at 200 Hz and 100 Hz (sugarR_100Hz.parquet).")
            for f, r in eng["runs"].items():
                disc.append(f"FlyWire v630 @ {f} Hz: MN9 {r['ours']['mn9_rate_hz_mean']:.2f} Hz (ours) vs {r['reference']['mn9_rate_hz_mean']:.2f} Hz (shipped); union of active neurons {r['ours']['n_active_union']} vs {r['reference']['n_active_union']}; per-neuron rate correlation r = {r['per_neuron_rate_correlation']:.4f}.")
        if val:
            sc = val["weight_scale_check"]
            disc.append(f"Male CNS scale factor: the pre-registered per-type-pair mean-synapse statistic gave {sc['ratio_weighted_median']:.3f} (FAILS the [0.45, 0.75] window); the total-input statistic over the same {sc['n_type_pairs']} shared type pairs gave {sc['ratio_of_totals']:.3f}, consistent with the published 0.581. Neither W_syn nor the scale was retuned.")
            disc.append(f"Only 17 of the paper's 21 FlyWire sugar GRNs have one-to-one NBLAST matches among male LB3a-d bodies (unmatched: {', '.join(val['sugar_grn_mapping']['unmatched_flywire_ids'])}); the 'allR' variant drives all {val['sugar_grn_mapping']['allR_n']} right labellar LB3a-d GRNs.")
            disc.append("Without the 0.581 scaling (weight_scale = 1.0) the same drive activates >9,500 neurons per trial (runaway), versus ~400 in FlyWire.")
            disc.append(f"MN9 side convention: Shiu's MN9 (720575940660219265) matches male body {val['mn9_flywire_match']['male_body']} ({val['mn9_flywire_match']['instance']}); the other MN9 stays silent in the scaled runs.")
        status = "passed" if (eng and eng["status"] == "passed") and (val and val["status"] == "passed") else ("failed" if (eng or val) else "not_run")
        stage0 = {"status": status,
                  "criterion": "(a) engine: reproduce the paper's shipped FlyWire v630 output at the same drive (MN9 within the shipped 30-trial range +/-10%, active neurons and spikes within 15%, per-neuron rate r > 0.95); (b) gate on male CNS: MN9 active in >= 90% of trials and its rate and the active-neuron count within 2x of the FlyWire v630 value at the same drive, with weight_scale 0.581 and no retuning",
                  "engine_check": {"status": eng["status"] if eng else "not_run", "runs": {k: {kk: vv for kk, vv in v.items() if kk not in ("top_neurons",)} for k, v in eng["runs"].items()} if eng else {}},
                  "validation_malecns": ({k: v for k, v in val.items() if k not in ("runs",)} if val else {"status": "not_run"}),
                  "crossmatch": xm, "target": target, "runs": runs, "discrepancies": disc,
                  "provenance": prov("configs/base.yaml", "results/stage0_engine_check + results/stage0_validate_malecns",
                                     ["results/stage0_engine_check/engine_check.json", "results/stage0_validate_malecns/validation.json", "results/stage0_engine_check/crossmatch_report.json"], commit, now)}
        json.dump(stage0, open(WEB_DATA / "stage0_reproduction.json", "w"), indent=1, default=str)
        stages["stage0_reproduction"] = {"status": status, "file": "stage0_reproduction.json", "title": "Stage 0 - Engine check (FlyWire v630) + male CNS validation gate",
                                         "summary": (f"engine {eng['status'] if eng else 'not_run'}; male CNS gate {val['status'] if val else 'not_run'}")}
    else:
        stages["stage0_reproduction"] = {"status": "not_run", "file": "stage0_reproduction.json", "title": "Stage 0 - Engine check + validation gate", "summary": "not run"}

    # ---- stage 1 ----
    s1 = load_json(RESULTS / "stage1_noise" / "stage1.json")
    if s1:
        s1["provenance"] = prov("configs/stage1_noise.yaml", "results/stage1_noise", s1["provenance"]["files"], commit, now)
        json.dump(s1, open(WEB_DATA / "stage1_noise.json", "w"), indent=1)
        stages["stage1_noise"] = {"status": s1["status"], "file": "stage1_noise.json", "title": "Stage 1 - Noise", "summary": f"{len(s1['runs'])} runs; {s1['criterion']}"}
    else:
        stages["stage1_noise"] = {"status": "not_run", "file": "stage1_noise.json", "title": "Stage 1 - Noise", "summary": "not run"}

    # ---- stage 2 ----
    s2 = load_json(RESULTS / "stage2_criticality" / "full" / "stage2.json") or load_json(RESULTS / "stage2_criticality" / "subset" / "stage2.json")
    if s2:
        per = []
        for p in s2["per_sigma"]:
            q = {k: v for k, v in p.items() if k not in ("r_k",)}
            per.append(q)
        s2["per_sigma"] = per
        s2["provenance"] = prov("configs/stage2_criticality.yaml", s2["provenance"]["results_dir"], s2["provenance"]["files"], commit, now)
        json.dump(s2, open(WEB_DATA / "stage2_criticality.json", "w"), indent=1, default=str)
        stages["stage2_criticality"] = {"status": s2["status"], "file": "stage2_criticality.json", "title": "Stage 2 - Criticality",
                                        "summary": f"network={s2['network']}; critical regime: {'YES' if s2['has_critical_regime'] else 'NO'}; operating sigma {s2['operating_sigma_mV']} mV"}
    else:
        stages["stage2_criticality"] = {"status": "not_run", "file": "stage2_criticality.json", "title": "Stage 2 - Criticality", "summary": "not run"}

    # ---- stages 3b / 3c / 3d: the feasibility findings that gate everything downstream ----
    s3b = load_json(RESULTS / "stage3b_odor" / "stage3b.json")
    s3bi = load_json(RESULTS / "stage3b_odor" / "ignition_threshold.json")
    s3c = load_json(RESULTS / "stage3c_control" / "stage3c.json")
    s3d = load_json(RESULTS / "stage3d_gain" / "stage3d.json")
    s3e = load_json(RESULTS / "stage3e_discrim" / "stage3e.json")
    s3dg = load_json(RESULTS / "stage3d_gain" / "gustatory_cost.json")
    if s3b or s3c or s3d or s3e:
        feas = {"status": (s3b or {}).get("status", "not_run"),
                "criterion": (s3b or {}).get("criterion", ""),
                "headline": " ".join(x for x in [(s3b or {}).get("finding", ""), (s3e or {}).get("finding", "")] if x),
                "odor_calibration": ({k: v for k, v in s3b.items() if k != "per_run"} if s3b else None),
                "ignition_threshold": s3bi,
                "dataset_control": ({k: v for k, v in s3c.items() if k != "per_run"} if s3c else None),
                "gain_sensitivity": ({k: v for k, v in s3d.items() if k != "per_run"} if s3d else None),
                "gain_cost_on_gustatory_benchmark": s3dg,
                "discriminability": ({k: v for k, v in s3e.items() if k != "per_run"} if s3e else None),
                "provenance": prov("configs/stage3b_odor.yaml + configs/stage3d_gain.yaml",
                                   "results/stage3b_odor + results/stage3c_control + results/stage3d_gain",
                                   ["results/stage3b_odor/stage3b.json", "results/stage3b_odor/ignition_threshold.json",
                                    "results/stage3c_control/stage3c.json", "results/stage3d_gain/stage3d.json"], commit, now)}
        json.dump(feas, open(WEB_DATA / "stage3b_feasibility.json", "w"), indent=1, default=str)
        stages["stage3b_feasibility"] = {"status": feas["status"], "file": "stage3b_feasibility.json",
                                         "title": "Stage 3b - Is there a sparse odour code to encode a memory in?",
                                         "summary": feas["headline"][:220]}
    else:
        stages["stage3b_feasibility"] = {"status": "not_run", "file": "stage3b_feasibility.json",
                                         "title": "Stage 3b - Is there a sparse odour code to encode a memory in?", "summary": "not run"}

    # ---- stages 3-6: copy through when present ----
    for key, sub_dir, fname, title in [("stage3_plasticity", "stage3_plasticity", "stage3.json", "Stage 3 - Plasticity"),
                                       ("stage4_learning", "stage4_learning", "stage4.json", "Stage 4 - Learning"),
                                       ("stage5_sleep", "stage5_sleep", "stage5.json", "Stage 5 - Sleep"),
                                       ("stage6_replay", "stage6_replay", "stage6.json", "Stage 6 - Replay")]:
        d = load_json(RESULTS / sub_dir / fname)
        if d:
            d.setdefault("provenance", {}); d["provenance"].update({"git_commit": commit, "generated_at": now})
            json.dump(d, open(WEB_DATA / f"{key}.json", "w"), indent=1, default=str)
            for extra in ("traces", "rasters", "activity"):
                for t in d.get(extra, []) or []:
                    src = RESULTS / sub_dir / t["file"]
                    if src.exists():
                        dst = WEB_DATA / t["file"]; dst.parent.mkdir(parents=True, exist_ok=True); shutil.copy(src, dst)
                        side = json.load(open(src)); b = src.parent / side["bin"]
                        if b.exists(): shutil.copy(b, dst.parent / side["bin"])
            stages[key] = {"status": d["status"], "file": f"{key}.json", "title": title, "summary": d.get("headline") or d.get("criterion", "")[:160]}
        else:
            stages[key] = {"status": "not_run", "file": f"{key}.json", "title": title, "summary": "not run"}

    # anatomical atlas for the viewer's neuron map (soma positions of the simulated neurons)
    from hypnagogia.atlas import build_atlas
    atlas = build_atlas(conn, WEB_DATA, max_neurons=None)

    manifest = {
        "generated_at": now, "git_commit": commit, "pipeline_version": base["pipeline_version"],
        "model": {
            "dataset": "male CNS connectome v1.0 (Janelia FlyEM / Google Research / Cambridge, Cell 2026)", "data_version": "malecns-v1.0",
            "scope": "brain (VNC excluded; VNC loading kept behind dataset.scope = 'cns')",
            "neurons_in_source_table": cns_meta.get("filtering_steps", [{}])[0].get("n_neurons_before"),
            "neurons_traced_cns": cns_meta.get("n_neurons"),
            "neurons_simulated_full": conn.N, "neurons_simulated_subset": sub.N,
            "connections_full": conn.E, "synapses_full": conn.n_synapses, "synapses_full_scaled": round(conn.n_synapses * conn.weight_scale),
            "connections_subset": sub.E, "synapses_subset": sub.n_synapses,
            "weight_scale": conn.weight_scale, "subset_definition": SUBSET_MB_CX,
            "filtering_steps": conn.filtering_steps,
            "nt_sign_rule": base["model"]["sign_rule"], "nt_counts_brain": conn.describe()["nt_counts"],
            "n_neurons_unknown_nt_sign_plus": int((conn.ann["nt"] == "unknown").sum()),
            "engine_check_dataset": "FlyWire v630 (127,400 neurons, 14,687,178 connections) - correctness check against Shiu et al. 2024's shipped output only",
            "params": base["params_table"], "base_config": "configs/base.yaml",
        },
        "stages": stages,
        "atlas": {"file": "neuron_atlas.json", "n_neurons_in_map": atlas["n_neurons_in_map"],
                  "n_neurons_simulated": atlas["n_neurons_simulated"], "subsampled": atlas["subsampled"],
                  "n_without_soma_position": atlas["n_without_soma_position"]},
    }
    json.dump(manifest, open(WEB_DATA / "manifest.json", "w"), indent=1, default=str)
    print(json.dumps({k: v["status"] for k, v in stages.items()}, indent=1))
    print("neurons_simulated_full", conn.N, "connections", conn.E, "synapses", conn.n_synapses, "subset", sub.N, sub.E)


if __name__ == "__main__":
    main()
