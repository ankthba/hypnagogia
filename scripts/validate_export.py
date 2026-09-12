"""Check the exported viewer files against web/DATA_CONTRACT.md.

The viewer renders whatever the contract promises. When the pipeline emits a field under a different name the
page shows "null" instead of a number, which is worse than an error because it looks like a legitimate missing
value. This script fails loudly on any promised field that is absent or null, so that class of bug cannot ship.
"""
import json
import sys
from pathlib import Path

from hypnagogia import WEB_DATA

# field -> required, per file. Nested paths use dots; [] means "every element of this list".
REQUIRED = {
    "manifest.json": ["generated_at", "git_commit", "pipeline_version", "model.neurons_simulated_full",
                      "model.connections_full", "model.synapses_full", "model.filtering_steps", "model.params",
                      "model.base_config", "stages"],
    "stage0_reproduction.json": ["status", "criterion", "runs", "discrepancies", "provenance"],
    "stage1_noise.json": ["status", "criterion", "noise_models", "runs", "provenance"],
    "stage2_criticality.json": ["status", "criterion", "criteria", "sigma_values_mV", "per_sigma",
                                "summary_by_sigma", "has_critical_regime", "operating_sigma_reason", "provenance"],
    "stage3_plasticity.json": ["status", "criterion", "rule.equations", "rule.description", "rule.parameters",
                               "n_plastic_synapses", "n_kc", "n_mbon", "n_dan", "unit_test", "provenance"],
    "stage4_learning.json": ["status", "criterion", "protocol", "readout_mbons", "seeds", "per_seed",
                             "effect.diff_of_deltas", "effect.ci95", "effect.hedges_g", "effect.p_paired",
                             "effect.n_seeds", "effect.delta_A_mean", "effect.delta_B_mean",
                             "learning_verified", "kc_ensemble_summary", "provenance"],
    "stage5_sleep.json": ["status", "criterion", "dfb.cell_types", "dfb.n_neurons", "dfb.selection_source",
                          "dfb.clamp_rate_hz", "dfb.rate_source", "conditions", "per_seed", "summary", "provenance"],
    "stage6_replay.json": ["status", "criterion", "headline", "metrics", "window_ms", "n_seeds",
                           "comparisons[].name", "comparisons[].label", "comparisons[].metric",
                           "comparisons[].diff", "comparisons[].ci95", "comparisons[].hedges_g",
                           "comparisons[].p", "comparisons[].n", "comparisons[].survives", "provenance"],
}
OPTIONAL_FILES = {"stage3b_feasibility.json", "reference_clips.json", "neuron_atlas.json"}


def get(obj, path):
    cur = obj
    for part in path.split("."):
        if part.endswith("[]"):
            key = part[:-2]
            if not isinstance(cur, dict) or key not in cur:
                return None, f"missing list '{key}'"
            return cur[key], None
        if not isinstance(cur, dict) or part not in cur:
            return None, f"missing '{part}'"
        cur = cur[part]
    return cur, None


def check(path_spec, doc):
    if "[]" in path_spec:
        head, tail = path_spec.split("[].", 1)
        lst, err = get(doc, head + "[]")
        if err:
            return [err]
        problems = []
        for k, item in enumerate(lst or []):
            v, e = get(item, tail)
            if e:
                problems.append(f"{head}[{k}]: {e}")
            elif v is None and not item.get("available", True) is False:
                problems.append(f"{head}[{k}].{tail} is null")
        return problems[:3]
    v, err = get(doc, path_spec)
    if err:
        return [err]
    if v is None:
        return [f"{path_spec} is null"]
    return []


def main() -> int:
    bad = 0
    for fname, fields in REQUIRED.items():
        p = WEB_DATA / fname
        if not p.exists():
            print(f"{fname}: not exported (stage has not run)")
            continue
        doc = json.load(open(p))
        if doc.get("status") == "not_run":
            print(f"{fname}: status not_run, skipped")
            continue
        problems = []
        for f in fields:
            problems += check(f, doc)
        if problems:
            bad += 1
            print(f"{fname}: {len(problems)} contract problem(s)")
            for pr in problems[:8]:
                print(f"    - {pr}")
        else:
            print(f"{fname}: ok ({len(fields)} fields)")
    for fname in sorted(OPTIONAL_FILES):
        p = WEB_DATA / fname
        print(f"{fname}: {'present' if p.exists() else 'absent'}")
    print()
    print("CONTRACT CHECK:", "FAILED" if bad else "passed")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
