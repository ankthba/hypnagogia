"""Run simulations as isolated subprocesses (one standalone build each) with a simple parallel pool.

A job spec is a JSON-serialisable dict:
  {"out_dir": str, "seed": int, "config": <resolved cfg dict>,
   "connectome": {"dataset": "malecns", "version": "v1.0", "scope": "brain", "weight_scale": 0.581,
                  "subset": {name, selectors} | null, "shuffle": {"seed": int, "strata": "cell_class"} | null},
   "drive_groups": {"odor_A": {"selector": {...}} | {"ids": [...]} | {"index": [...]}, ...},
   "record": "all" | {"selector": ...} | {"index": [...]},
   "epochs": [{"name", "duration_s", "drives": {group: rate_hz}, "plastic": bool, "sigma_mV": null}],
   "plasticity": null | {..., "pre": {"selector"}, "post": {"selector"}, "dan": {"selector"}},
   "init_plastic_w": path | null, "name": str}
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np

from .connectome import Connectome, load_connectome, subset_from_config


def resolve_group(conn: Connectome, spec: dict) -> np.ndarray:
    if "index" in spec:
        return np.asarray(spec["index"], dtype=np.int64)
    if "ids" in spec:
        return conn.index_of(spec["ids"], missing=spec.get("missing", "error"))
    if "selector" in spec:
        return conn.select(**spec["selector"])
    if "selectors" in spec:
        return conn.select_union(spec["selectors"])
    raise ValueError(f"cannot resolve group spec {spec}")


def build_connectome(cspec: dict) -> Connectome:
    conn = load_connectome(cspec.get("dataset", "malecns"), cspec.get("version"), scope=cspec.get("scope", "brain"),
                           weight_scale=cspec.get("weight_scale"))
    if cspec.get("subset"):
        conn = subset_from_config(conn, cspec["subset"])
    if cspec.get("shuffle"):
        sh = cspec["shuffle"]
        conn = conn.degree_preserving_shuffle(int(sh["seed"]), strata=sh.get("strata", "cell_class"),
                                              swaps_per_edge=int(sh.get("swaps_per_edge", 10)))
    return conn


def run_job(spec: dict) -> dict:
    from .model import Simulation
    conn = build_connectome(spec["connectome"])
    groups = {k: resolve_group(conn, v) for k, v in spec.get("drive_groups", {}).items()}
    rec = spec.get("record", "all")
    record = "all" if rec == "all" else resolve_group(conn, rec)
    pl = None
    if spec.get("plasticity"):
        pl = dict(spec["plasticity"])
        pl["pre_idx"] = resolve_group(conn, pl.pop("pre"))
        pl["post_idx"] = resolve_group(conn, pl.pop("post"))
        pl["dan_idx"] = resolve_group(conn, pl.pop("dan"))
    init_w = None
    if spec.get("init_plastic_w"):
        init_w = np.load(spec["init_plastic_w"])["w_final_mV"].astype(np.float64)
    sim = Simulation(conn, spec["config"], spec["out_dir"], spec["seed"], groups, record=record, plasticity=pl,
                     init_plastic_w=init_w, name=spec.get("name", "sim"))
    for ep in spec["epochs"]:
        sim.add_epoch(ep["name"], ep["duration_s"], ep.get("drives"), ep.get("plastic", False), ep.get("sigma_mV"), ep.get("note", ""))
    out = sim.run(clean=True)
    out["group_sizes"] = {k: int(len(v)) for k, v in groups.items()}
    return out


def run_jobs(specs: list[dict], n_parallel: int = 8, skip_existing: bool = True) -> list[dict]:
    """Run each spec in its own python subprocess; returns per-job result dicts (with 'error' on failure)."""
    results = [None] * len(specs)
    py = sys.executable
    env = dict(os.environ, OMP_NUM_THREADS="1", PYTHONUNBUFFERED="1")

    def _one(k: int, spec: dict):
        out_dir = Path(spec["out_dir"]); out_dir.mkdir(parents=True, exist_ok=True)
        if skip_existing and (out_dir / "spikes.npz").exists() and (out_dir / "meta.json").exists():
            return k, {"spikes": str(out_dir / "spikes.npz"), "meta": str(out_dir / "meta.json"), "skipped": True}
        spec_path = out_dir / "job.json"
        with open(spec_path, "w") as f:
            json.dump(spec, f, default=str)
        t0 = time.time()
        p = subprocess.run([py, "-m", "hypnagogia.jobs", str(spec_path)], env=env, capture_output=True, text=True)
        (out_dir / "job.log").write_text(p.stdout + "\n--- stderr ---\n" + p.stderr)
        if p.returncode != 0:
            return k, {"error": p.stderr[-3000:], "returncode": p.returncode, "walltime_s": time.time() - t0}
        try:
            with open(out_dir / "job.result.json") as f:
                r = json.load(f)
        except Exception as e:  # pragma: no cover
            r = {"error": f"no result file: {e}"}
        r["walltime_s"] = round(time.time() - t0, 1)
        return k, r

    with ThreadPoolExecutor(max_workers=max(1, int(n_parallel))) as ex:
        futs = [ex.submit(_one, k, s) for k, s in enumerate(specs)]
        for f in as_completed(futs):
            k, r = f.result()
            results[k] = r
    return results


def main(argv=None):
    argv = argv or sys.argv[1:]
    spec_path = Path(argv[0])
    with open(spec_path) as f:
        spec = json.load(f)
    out = run_job(spec)
    with open(spec_path.parent / "job.result.json", "w") as f:
        json.dump(out, f, default=str)
    print(json.dumps({k: v for k, v in out.items() if k != "group_sizes"}))


if __name__ == "__main__":
    main()
