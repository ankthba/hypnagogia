"""Reference activity clips for the viewer's neuron map.

These are real simulations of this model, run with their own config and exported with full provenance. They
exist because the map would otherwise be a still image until the replay stage finishes. They are labelled in
the viewer as reference simulations, never as the replay result, and no part of them is synthetic.
"""
import json, time
from pathlib import Path
import numpy as np
from hypnagogia import RESULTS, WEB_DATA
from hypnagogia.config import load_config, dump_config
from hypnagogia.connectome import load_connectome
from hypnagogia.atlas import export_activity
from hypnagogia.jobs import run_jobs

OUT = RESULTS / "reference_clips"


def main():
    cfg = load_config("reference_clips")
    OUT.mkdir(parents=True, exist_ok=True); dump_config(cfg, OUT / "config.resolved.yaml")
    conn = load_connectome("malecns", "v1.0", "brain")
    specs, meta = [], []
    for clip in cfg["clips"]:
        c = json.loads(json.dumps(cfg))
        sg = float(clip["sigma_mV"])
        c["noise"] = {"mode": ("gaussian" if sg > 0 else "none"), "sigma_mV": sg, "poisson": cfg["noise"]["poisson"]}
        groups, epochs = {}, [{"name": "warmup", "duration_s": 0.5}]
        if clip.get("drive"):
            groups["drive"] = {"selector": clip["drive"]["population_selector"]}
            p = clip["pattern"]
            for k in range(int(p["n_cycles"])):
                epochs.append({"name": "on", "duration_s": p["on_s"], "drives": {"drive": clip["drive"]["rate_hz"]}})
                epochs.append({"name": "off", "duration_s": p["off_s"]})
        else:
            epochs.append({"name": "spontaneous", "duration_s": clip["duration_s"]})
        specs.append({"out_dir": str(OUT / clip["name"]), "seed": clip["seed"], "config": c, "name": clip["name"],
                      "connectome": {"dataset": "malecns", "version": "v1.0", "scope": "brain", "weight_scale": cfg["dataset"]["weight_scale"]},
                      "drive_groups": groups, "record": "all", "epochs": epochs})
        meta.append(clip)
    t0 = time.time()
    res = run_jobs(specs, n_parallel=min(len(specs), cfg["run"]["n_parallel"]))
    aidx_file = WEB_DATA / "neuron_atlas_index.bin"
    if not aidx_file.exists():
        raise SystemExit("run scripts/export_web.py first to build the neuron atlas")
    aidx = np.fromfile(aidx_file, dtype=np.uint32).astype(np.int64)
    sub = WEB_DATA / "clips"; sub.mkdir(parents=True, exist_ok=True)
    out = []
    for sp, clip, r in zip(specs, meta, res):
        if r is None or "error" in r:
            print("FAILED", clip["name"], (r or {}).get("error", "")[-300:]); continue
        z = np.load(sp["out_dir"] + "/spikes.npz"); m = json.load(open(sp["out_dir"] + "/meta.json"))
        i, ts = z["i"], z["t_step"]
        t_start = 0.5
        side = export_activity(i, ts, m["dt_ms"] * 1e-3, aidx, t_start, m["duration_s"], sub, clip["name"],
                               max_spikes=300000, seed=clip["seed"])
        out.append({"name": clip["name"], "title": clip["title"], "description": clip["description"],
                    "file": f"clips/{clip['name']}.json", "duration_s": side["duration_s"],
                    "n_spikes_total": side["n_spikes_total"], "n_spikes_exported": side["n_spikes_exported"],
                    "downsampled": side["downsampled"], "sigma_mV": clip["sigma_mV"], "seed": clip["seed"],
                    "n_neurons_simulated": m["n_neurons"], "n_active_neurons": m["n_active"],
                    "epochs": [{"name": e["name"], "t_start_s": e["t_start_s"], "t_end_s": e["t_end_s"],
                                "drives": e.get("drives", {})} for e in m["epochs"]],
                    "provenance": {"config": "configs/reference_clips.yaml", "results_dir": f"results/reference_clips/{clip['name']}",
                                   "files": [f"results/reference_clips/{clip['name']}/spikes.npz"]}})
        print(f"{clip['name']}: {side['n_spikes_total']:,} spikes over {side['duration_s']:.1f}s, "
              f"{m['n_active']:,} neurons active, exported {side['n_spikes_exported']:,}")
    doc = {"clips": out, "note": ("Real simulations of this model, not demonstrations. Each was run by "
                                  "scripts/07_reference_clips.py with configs/reference_clips.yaml and carries its own "
                                  "provenance. The map plays one of these only when the replay stage has no activity of "
                                  "its own, and always says which simulation is on screen."),
           "walltime_s": round(time.time() - t0, 1)}
    json.dump(doc, open(WEB_DATA / "reference_clips.json", "w"), indent=1)
    print(json.dumps({k: v for k, v in doc.items() if k != "clips"}, indent=1))


if __name__ == "__main__":
    main()
