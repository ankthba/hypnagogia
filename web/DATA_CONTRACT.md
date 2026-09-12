# Data contract: simulation pipeline -> web viewer

The viewer at `web/` renders ONLY files under `web/public/data/`, all written by
`scripts/export_web.py` from real simulation outputs. Nothing in the viewer may
contain hard-coded, mocked, demo, or placeholder numbers. If a file is missing,
or a stage's `status` is `not_run`, the page renders an explicit "not yet run"
state (with the command that would produce it). If `status` is `failed`, the
failure is rendered as prominently as a success would be, with the `reasons`.

All JSON numbers are plain (no NaN; use null). Binary arrays are raw
little-endian typed arrays with a JSON sidecar giving `dtype`, `shape`,
`byte_offset`, and meaning of each dimension.

## `manifest.json`  (always present once export has run at least once)
```json
{
  "generated_at": "2026-09-11T20:00:00Z",
  "git_commit": "abc1234",
  "pipeline_version": "0.1.0",
  "model": {
    "data_version": "783",
    "neurons_in_source_table": 138639,
    "neurons_simulated_full": 138639,
    "neurons_simulated_subset": 12345,
    "connections_full": 15091983,
    "synapses_full": 54492922,
    "connections_subset": 0,
    "synapses_subset": 0,
    "filtering_steps": [{"step": "...", "n_neurons_before": 0, "n_neurons_after": 0, "n_connections_before": 0, "n_connections_after": 0, "n_synapses_before": null, "n_synapses_after": 0}],
    "params": [{"name": "V_rest", "value": "-52 mV", "source": "Kakaria & de Bivort 2017 (via Shiu 2024)", "cited": true}],
    "base_config": "configs/base.yaml"
  },
  "stages": {
    "stage0_reproduction": {"status": "passed|failed|not_run|running", "file": "stage0_reproduction.json", "title": "Reproduce Shiu et al. sugar GRN -> MN9", "summary": "one line"},
    "stage1_noise":        {"status": "...", "file": "stage1_noise.json", ...},
    "stage2_criticality":  {"status": "...", "file": "stage2_criticality.json", ...},
    "stage3_plasticity":   {"status": "...", "file": "stage3_plasticity.json", ...},
    "stage4_learning":     {"status": "...", "file": "stage4_learning.json", ...},
    "stage5_sleep":        {"status": "...", "file": "stage5_sleep.json", ...},
    "stage6_replay":       {"status": "...", "file": "stage6_replay.json", ...}
  }
}
```
`status` semantics: `passed` = ran and met its pre-registered criterion; `failed` =
ran and did NOT meet it (still a real result - show it); `not_run` = no output
exists; `running` = partial outputs exist. Stage files may exist while status is
`failed`. Every stage file carries `provenance`:
```json
"provenance": {"config": "configs/stage2_criticality.yaml", "config_hash": "..", "results_dir": "results/stage2_criticality", "files": ["results/.../sweep.parquet"], "git_commit": "..", "generated_at": ".."}
```
Every figure in the viewer shows a footer link "config: <config> · data: <files>".

## `stage0_reproduction.json`
```json
{
  "status": "passed|failed",
  "criterion": "text of the pre-registered pass criterion",
  "target": {"source": "philshiu/Drosophila_brain_model results/example/sugarR.parquet (v630, 21 sugar GRNs @150 Hz Poisson)",
             "mn9_rate_hz_mean": 93.27, "mn9_rate_hz_per_trial": [86, 94], "n_trials": 30, "n_active_neurons": 448, "total_spikes": 511566},
  "runs": [
    {"name": "ours_v630", "data_version": "630", "n_neurons": 0, "n_connections": 0, "n_sugar_grns": 21,
     "mn9_rate_hz_mean": 0, "mn9_rate_hz_per_trial": [], "n_trials": 30, "n_active_neurons": 0, "total_spikes": 0,
     "top_active": [{"root_id": "7205...", "rate_hz": 0, "target_rate_hz": 0}]},
    {"name": "ours_v783", "data_version": "783", "n_sugar_grns": 20, ...}
  ],
  "discrepancies": ["plain-language list"],
  "provenance": {...}
}
```

## `stage1_noise.json`
```json
{ "status": "passed|failed", "criterion": "...",
  "noise_models": [{"name": "gaussian", "equation": "dv/dt = ...", "param": "sigma"}, {"name": "poisson", "equation": "...", "param": "rate_hz"}],
  "runs": [{"noise_model": "gaussian", "sigma_mV": 2.0, "seed": 0, "pop_rate_hz": 0.1, "frac_active": 0.01, "mean_v_std_mV": 0}],
  "provenance": {...} }
```

## `stage2_criticality.json`
```json
{ "status": "passed|failed", "criterion": "...",
  "network": "full|subset", "n_neurons": 0, "duration_s": 0, "warmup_s": 0, "seeds": [0,1,2],
  "criteria": {"silent": "...", "critical": "...", "saturated": "..."},
  "sigma_values_mV": [0.5, 0.7, 1.0],
  "per_sigma": [
    {"sigma_mV": 1.0, "seed": 0,
     "pop_rate_hz": 0.0, "frac_active": 0.0,
     "branching_ratio_mr": {"m": 0.0, "ci95": [0,0], "k_max": 0, "bin_ms": 0},
     "branching_ratio_naive": 0.0,
     "avalanches": {"bin_ms": 0.0, "n": 0, "max_size": 0, "frac_time_active": 0.0},
     "size_fit": {"alpha": 0, "xmin": 0, "n_tail": 0, "R_vs_exponential": 0, "p_vs_exponential": 0, "R_vs_lognormal": 0, "p_vs_lognormal": 0, "R_vs_truncated_power_law": 0, "p_vs_truncated_power_law": 0},
     "duration_fit": {"alpha": 0, "xmin": 0, "n_tail": 0, "R_vs_exponential": 0, "p_vs_exponential": 0, "R_vs_lognormal": 0, "p_vs_lognormal": 0, "R_vs_truncated_power_law": 0, "p_vs_truncated_power_law": 0},
     "size_ccdf": {"x": [1,2], "y": [1.0, 0.5]},
     "duration_ccdf": {"x": [], "y": []},
     "classification": "silent|critical|saturated|indeterminate",
     "reasons": ["m=0.3 < 0.9", "..."]}
  ],
  "summary_by_sigma": [{"sigma_mV": 1.0, "pop_rate_hz_mean": 0, "pop_rate_hz_sd": 0, "m_mean": 0, "m_sd": 0, "frac_active_mean": 0, "classification": "..."}],
  "has_critical_regime": false,
  "operating_sigma_mV": 1.0,
  "operating_sigma_reason": "plain language",
  "provenance": {...} }
```

## `stage3_plasticity.json`
```json
{ "status": "passed|failed", "criterion": "...",
  "rule": {"equations": ["..."], "description": "...",
           "parameters": [{"name": "tau_e", "value": "..", "source": "..", "cited": true}]},
  "n_plastic_synapses": 0, "n_kc": 0, "n_mbon": 0, "n_dan": 0,
  "dan_to_mbon_map": [{"mbon_type": "MBON01", "dan_types": ["PPL101"], "n_syn": 0}],
  "unit_test": {"description": "isolated KC->MBON pairing test", "w_before": 0, "w_after": 0, "expected_direction": "depression", "passed": true},
  "provenance": {...} }
```

## `stage4_learning.json`
```json
{ "status": "passed|failed", "criterion": "...",
  "protocol": {"odor_A": {"orn_types": [], "n_orns": 0, "rate_hz": 0}, "odor_B": {...}, "dans": {"types": [], "n": 0, "rate_hz": 0},
               "n_pairings": 0, "odor_s": 0, "iti_s": 0, "test_s": 0, "sigma_mV": 0},
  "readout_mbons": [{"root_id": "..", "type": ".."}],
  "seeds": [0],
  "per_seed": [{"seed": 0, "A_pre": 0.0, "A_post": 0.0, "B_pre": 0.0, "B_post": 0.0,
                "per_mbon": [{"root_id": "..", "type": "..", "A_pre": 0, "A_post": 0, "B_pre": 0, "B_post": 0}],
                "kc_ensemble_A_size": 0, "kc_ensemble_B_size": 0, "kc_overlap": 0,
                "w_kc_mbon_A_mean_before": 0, "w_kc_mbon_A_mean_after": 0}],
  "effect": {"delta_A_mean": 0, "delta_B_mean": 0, "diff_of_deltas": 0, "ci95": [0,0], "hedges_g": 0, "p_paired": 0, "n_seeds": 0},
  "learning_verified": false,
  "kc_ensemble_summary": {"A_size_mean": 0, "B_size_mean": 0, "overlap_mean": 0, "frac_kc_active_A": 0},
  "provenance": {...} }
```

## `stage5_sleep.json`
```json
{ "status": "passed|failed", "criterion": "...",
  "dfb": {"cell_types": [], "n_neurons": 0, "selection_source": "citation", "clamp_rate_hz": 0, "rate_source": "citation"},
  "conditions": {"sleep": {"description": ".."}, "wake": {"description": ".."}},
  "per_seed": [{"seed": 0, "condition": "sleep", "pop_rate_hz": 0, "kc_rate_hz": 0, "mbon_rate_hz": 0, "dfb_rate_hz": 0, "frac_active": 0}],
  "summary": [{"condition": "sleep", "pop_rate_hz_mean": 0, "kc_rate_hz_mean": 0, "dfb_rate_hz_mean": 0}],
  "provenance": {...} }
```

## `stage6_replay.json`
```json
{ "status": "passed|failed|artifact", "criterion": "...",
  "headline": "one plain-language sentence",
  "metrics": {"template_correlation": "definition", "coactivation": "definition", "sequence": "definition"},
  "window_ms": 0, "n_seeds": 0,
  "comparisons": [
    {"name": "A_vs_B_sleep", "label": "trained (A) vs unpaired (B), sleep", "metric": "template_correlation",
     "x_mean": 0, "y_mean": 0, "diff": 0, "ci95": [0,0], "hedges_g": 0, "g_ci95": [0,0], "p": 0, "n": 0, "survives": true},
    {"name": "sleep_vs_wake_A", ...}, {"name": "real_vs_shuffled", ...}, {"name": "A_vs_random_ensembles", ...}
  ],
  "per_seed": [{"seed": 0, "condition": "sleep", "network": "real|shuffled", "ensemble": "A|B|random",
                "template_corr_mean": 0, "template_corr_p95": 0, "n_reactivation_events": 0,
                "coactivation_z": 0, "sequence_rho": null, "sequence_p": null}],
  "traces": [{"seed": 0, "condition": "sleep", "file": "replay/trace_sleep_seed0.json"}],
  "rasters": [{"seed": 0, "condition": "sleep", "file": "replay/raster_sleep_seed0.json"}],
  "provenance": {...} }
```
Trace sidecar `replay/trace_<cond>_seed<k>.json`:
```json
{"bin": "trace_sleep_seed0.bin", "dtype": "float32", "shape": [n_bins, 3], "columns": ["t_s", "corr_A", "corr_B"], "dt_s": 0.05,
 "threshold_corr": 0.0, "threshold_source": "95th percentile of random-ensemble null"}
```
Raster sidecar `replay/raster_<cond>_seed<k>.json` (downsampled: ensemble neurons only, 1 ms resolution, max ~2e5 spikes):
```json
{"bin": "raster_sleep_seed0.bin", "dtype": "uint32", "shape": [n_spikes, 2], "columns": ["t_ms", "neuron_row"],
 "neuron_rows": [{"row": 0, "root_id": "..", "group": "ensemble_A|ensemble_B|other_kc"}], "duration_s": 0.0}
```

## `neuron_atlas.json` + `neuron_atlas.bin` (+ `neuron_atlas_index.bin`)
The anatomical map of the simulated neurons, written by `scripts/export_web.py` from male CNS soma positions.
```json
{"bin": "neuron_atlas.bin", "dtype": "uint16", "shape": [n, 4], "columns": ["x_q", "y_q", "z_q", "group"],
 "quantisation": {"lo_um": [x,y,z], "hi_um": [x,y,z], "scale": 65535, "formula": "um = lo + q / 65535 * (hi - lo)"},
 "axes": {"x": "medial-lateral", "y": "dorsal-ventral", "z": "anterior-posterior", "note": "..."},
 "groups": [{"code": 0, "label": "other"}, {"code": 1, "label": "KC"}, ...],
 "group_counts": {...}, "n_neurons_in_map": 60000, "n_neurons_simulated": 144209,
 "n_without_soma_position": 18100, "n_without_soma_position_by_group": {...}, "subsampled": true,
 "soma_outside_brain_note": "...", "source": "..."}
```
`neuron_atlas_index.bin` is `uint32[n]`: the simulation index of each atlas row (not needed by the viewer).
Default projection: x (horizontal) vs y (vertical), y increasing downward, which gives the frontal view of
the brain. The map must state that it shows soma positions, not neurites or morphology.

## `replay/activity_<condition>_seed<k>.json` + `.bin`
Whole-brain spikes for the map animation, for the same window as the raster and trace of that seed.
```json
{"bin": "activity_sleep_seed0.bin", "dtype": "uint32", "shape": [n_spikes, 2], "columns": ["t_ms", "atlas_row"],
 "duration_s": 60.0, "n_spikes_total": 812344, "n_spikes_exported": 400000, "downsampled": true,
 "downsample_note": "..."}
```
`atlas_row` indexes `neuron_atlas.bin`. When `downsampled` is true the viewer must say so, because the map
then shows a uniform random sample of the spikes, not all of them.

## `reference_clips.json` + `clips/<name>.json` + `clips/<name>.bin`
Real simulations of this model, exported so the neuron map has something true to show before the replay
stage produces activity of its own. They are NOT demo or synthetic data: each is a normal run of the
pipeline (`scripts/07_reference_clips.py`, `configs/reference_clips.yaml`) with its own provenance.
```json
{"clips": [{"name": "sugar_pulses", "title": "...", "description": "...", "file": "clips/sugar_pulses.json",
            "duration_s": 12.5, "n_spikes_total": 0, "n_spikes_exported": 0, "downsampled": false,
            "sigma_mV": 0.0, "seed": 11, "n_neurons_simulated": 144209, "n_active_neurons": 0,
            "epochs": [{"name": "on", "t_start_s": 0.5, "t_end_s": 1.5, "drives": {"drive": 200.0}}],
            "provenance": {"config": "...", "results_dir": "...", "files": ["..."]}}],
 "note": "..."}
```
Each `clips/<name>.json` has the same shape as `replay/activity_*.json` (uint32 `[n, 2]` of `t_ms`,
`atlas_row`). **Viewer rule:** a clip may play in the neuron map only when the selected seed/condition has no
`replay/activity_*` file. Whenever a clip is on screen the map must name it and show its title, so a reader
can never mistake a reference simulation for the replay result. A clip is never used on the Replay page's
result figures, only as the map's ambient state.
