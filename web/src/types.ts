// Types mirror web/DATA_CONTRACT.md exactly. Nothing here is data; it is only shape.

export type StageStatus = 'passed' | 'failed' | 'artifact' | 'not_run' | 'running';

export interface Provenance {
  config: string;
  config_hash?: string;
  results_dir?: string;
  files: string[];
  git_commit: string;
  generated_at?: string;
}

export interface ModelParam {
  name: string;
  value: string | number;
  source: string;
  cited: boolean;
}

/** One row of the connectome filter chain as the pipeline writes it (src/hypnagogia/connectome.py); a count the step did not measure is null. */
export interface FilteringStep {
  step: string;
  n_neurons_before: number | null;
  n_neurons_after: number | null;
  n_connections_before: number | null;
  n_connections_after: number | null;
  n_synapses_before: number | null;
  n_synapses_after: number | null;
}

export interface StageEntry {
  status: StageStatus;
  file: string;
  title?: string;
  summary?: string;
}

export type StageKey =
  | 'stage0_reproduction'
  | 'stage1_noise'
  | 'stage2_criticality'
  | 'stage3_plasticity'
  | 'stage4_learning'
  | 'stage5_sleep'
  | 'stage6_replay';

export interface Manifest {
  generated_at: string;
  git_commit: string;
  pipeline_version: string;
  model: {
    data_version: string;
    neurons_in_source_table: number;
    neurons_simulated_full: number;
    neurons_simulated_subset: number;
    connections_full: number;
    synapses_full: number;
    /** synapses_full times weight_scale, as the exporter writes it; absent from older manifests. */
    synapses_full_scaled?: number;
    connections_subset: number;
    synapses_subset: number;
    filtering_steps: FilteringStep[];
    params: ModelParam[];
    base_config: string;
  };
  stages: Partial<Record<StageKey, StageEntry>>;
}

export interface StageBase {
  status: StageStatus;
  criterion: string;
  reasons?: string[];
  provenance: Provenance;
}

// stage0
export interface Stage0Run {
  name: string;
  data_version: string;
  n_neurons: number;
  n_connections: number;
  n_sugar_grns: number;
  mn9_rate_hz_mean: number;
  mn9_rate_hz_per_trial: number[];
  n_trials: number;
  n_active_neurons: number;
  total_spikes: number;
  top_active?: { root_id: string; rate_hz: number; target_rate_hz: number }[];
}
export interface Stage0 extends StageBase {
  target: {
    source: string;
    mn9_rate_hz_mean: number;
    mn9_rate_hz_per_trial: number[];
    n_trials: number;
    n_active_neurons: number;
    total_spikes: number;
  };
  runs: Stage0Run[];
  discrepancies: string[];
}

// stage1
export interface Stage1 extends StageBase {
  noise_models: { name: string; equation: string; param: string }[];
  runs: {
    noise_model: string;
    /** the export writes both keys and nulls the one the model does not use */
    sigma_mV?: number | null;
    rate_hz?: number | null;
    seed: number;
    pop_rate_hz: number;
    frac_active: number;
    mean_v_std_mV: number;
  }[];
}

// stage2
export type Classification = 'silent' | 'critical' | 'saturated' | 'indeterminate';
export interface PowerLawFit {
  alpha: number | null;
  xmin: number | null;
  n_tail: number | null;
  R_vs_exponential: number | null;
  p_vs_exponential: number | null;
  R_vs_lognormal: number | null;
  p_vs_lognormal: number | null;
  R_vs_truncated_power_law: number | null;
  p_vs_truncated_power_law: number | null;
}
export interface PerSigma {
  sigma_mV: number;
  seed: number;
  pop_rate_hz: number;
  frac_active: number;
  branching_ratio_mr: { m: number | null; ci95: [number | null, number | null]; k_max: number; bin_ms: number };
  branching_ratio_naive: number | null;
  avalanches: { bin_ms: number; n: number; max_size: number; frac_time_active: number };
  size_fit: PowerLawFit;
  duration_fit: PowerLawFit;
  size_ccdf: { x: number[]; y: number[] };
  duration_ccdf: { x: number[]; y: number[] };
  classification: Classification;
  reasons: string[];
}
export interface Stage2 extends StageBase {
  network: 'full' | 'subset';
  n_neurons: number;
  duration_s: number;
  warmup_s: number;
  seeds: number[];
  criteria: { silent: string; critical: string; saturated: string };
  sigma_values_mV: number[];
  per_sigma: PerSigma[];
  summary_by_sigma: {
    sigma_mV: number;
    pop_rate_hz_mean: number;
    pop_rate_hz_sd: number;
    m_mean: number | null;
    m_sd: number | null;
    frac_active_mean: number;
    classification: Classification;
  }[];
  has_critical_regime: boolean;
  operating_sigma_mV: number | null;
  operating_sigma_reason: string;
}

// stage3
export interface Stage3 extends StageBase {
  rule: { equations: string[]; description: string; parameters: ModelParam[] };
  n_plastic_synapses: number;
  n_kc: number;
  n_mbon: number;
  n_dan: number;
  dan_to_mbon_map: { mbon_type: string; dan_types: string[]; n_syn: number }[];
  unit_test: {
    description: string;
    w_before: number;
    w_after: number;
    expected_direction: string;
    passed: boolean;
  };
}

// stage4
export interface Stage4PerMbon {
  root_id: string;
  type: string;
  A_pre: number;
  A_post: number;
  B_pre: number;
  B_post: number;
}
export interface Stage4PerSeed {
  seed: number;
  A_pre: number;
  A_post: number;
  B_pre: number;
  B_post: number;
  per_mbon: Stage4PerMbon[];
  kc_ensemble_A_size: number;
  kc_ensemble_B_size: number;
  kc_overlap: number;
  w_kc_mbon_A_mean_before: number;
  w_kc_mbon_A_mean_after: number;
}
export interface Stage4 extends StageBase {
  protocol: {
    odor_A: { orn_types: string[]; n_orns: number; rate_hz: number };
    odor_B: { orn_types: string[]; n_orns: number; rate_hz: number };
    dans: { types: string[]; n: number; rate_hz: number };
    n_pairings: number;
    odor_s: number;
    iti_s: number;
    test_s: number;
    sigma_mV: number;
  };
  readout_mbons: { root_id: string; type: string }[];
  seeds: number[];
  per_seed: Stage4PerSeed[];
  effect: {
    delta_A_mean: number;
    delta_B_mean: number;
    diff_of_deltas: number;
    ci95: [number, number];
    hedges_g: number;
    p_paired: number;
    n_seeds: number;
  };
  learning_verified: boolean;
  kc_ensemble_summary: {
    A_size_mean: number;
    B_size_mean: number;
    overlap_mean: number;
    frac_kc_active_A: number;
  };
}

// stage5
export interface Stage5 extends StageBase {
  dfb: {
    cell_types: string[];
    n_neurons: number;
    selection_source: string;
    clamp_rate_hz: number;
    rate_source: string;
  };
  conditions: Record<string, { description: string }>;
  per_seed: {
    seed: number;
    condition: string;
    pop_rate_hz: number;
    kc_rate_hz: number;
    mbon_rate_hz: number;
    dfb_rate_hz: number;
    frac_active: number;
  }[];
  summary: {
    condition: string;
    pop_rate_hz_mean: number;
    kc_rate_hz_mean: number;
    dfb_rate_hz_mean: number;
  }[];
}

// stage6
export interface Comparison {
  name: string;
  label: string;
  metric: string;
  x_mean: number;
  y_mean: number;
  diff: number;
  ci95: [number, number];
  hedges_g: number;
  g_ci95: [number, number];
  p: number;
  n: number;
  survives: boolean;
}
export interface Stage6PerSeed {
  seed: number;
  condition: string;
  network: 'real' | 'shuffled';
  ensemble: 'A' | 'B' | 'random';
  template_corr_mean: number;
  template_corr_p95: number;
  n_reactivation_events: number;
  coactivation_z: number | null;
  sequence_rho: number | null;
  sequence_p: number | null;
}
export interface Stage6 extends StageBase {
  headline: string;
  metrics: Record<string, string>;
  window_ms: number;
  n_seeds: number;
  comparisons: Comparison[];
  per_seed: Stage6PerSeed[];
  traces: { seed: number; condition: string; file: string }[];
  rasters: { seed: number; condition: string; file: string }[];
}

export interface TraceSidecar {
  bin: string;
  dtype: 'float32';
  shape: [number, number];
  /** byte offset of the first element in `bin` (contract: little-endian raw array) */
  byte_offset: number;
  columns: string[];
  dt_s: number;
  threshold_corr: number;
  threshold_source: string;
}

/**
 * `neuron_atlas.json`: the anatomical map of the simulated neurons (soma positions only).
 * Every count the map states about itself comes from these fields, never from the viewer.
 */
export interface AtlasSidecar {
  bin: string;
  dtype: 'uint16';
  shape: [number, number];
  /** byte offset of the first element in `bin`; absent means 0 */
  byte_offset?: number;
  columns: string[];
  quantisation: {
    lo_um: [number, number, number];
    hi_um: [number, number, number];
    scale: number;
    formula: string;
  };
  axes: { x: string; y: string; z: string; note?: string };
  groups: { code: number; label: string }[];
  group_counts: Record<string, number>;
  n_neurons_in_map: number;
  n_neurons_simulated: number;
  n_without_soma_position: number;
  n_without_soma_position_by_group: Record<string, number>;
  subsampled: boolean;
  soma_outside_brain_note: string;
  source: string;
  row_to_sim_index?: string;
}

/** `replay/activity_<condition>_seed<k>.json`: whole-brain spikes for the map animation. */
export interface ActivitySidecar {
  bin: string;
  dtype: 'uint32';
  shape: [number, number];
  /** byte offset of the first element in `bin`; absent means 0 */
  byte_offset?: number;
  columns: string[];
  duration_s: number;
  n_spikes_total: number;
  n_spikes_exported: number;
  downsampled: boolean;
  downsample_note?: string;
}

export interface RasterSidecar {
  bin: string;
  dtype: 'uint32';
  shape: [number, number];
  /** byte offset of the first element in `bin` (contract: little-endian raw array) */
  byte_offset: number;
  columns: string[];
  neuron_rows: { row: number; root_id: string; group: 'ensemble_A' | 'ensemble_B' | 'other_kc' }[];
  duration_s: number;
}
