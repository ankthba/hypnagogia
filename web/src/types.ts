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

/**
 * A provenance block on a *sidecar* rather than a stage file. Stage files always carry the full
 * object; the atlas and the reference clips carry a partial one - notably no `git_commit` and no
 * `generated_at`. Every field is therefore optional, so the viewer has to decide what to say about
 * an absent one instead of silently filling it in from somewhere else.
 */
export interface SidecarProvenance {
  config?: string;
  config_hash?: string;
  results_dir?: string;
  files?: string[];
  git_commit?: string;
  generated_at?: string;
  /** the module that wrote the file, when the block states one */
  written_by?: string;
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
  | 'stage3b_feasibility'
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
  /**
   * DATA_CONTRACT.md gives `dan_types` as a list of names; the stage file writes an object mapping
   * each DAN type to the number of synapses it contributes. Both shapes are accepted and the
   * viewer says which one it read, rather than crashing on `.join` (which it did) or silently
   * dropping the counts.
   */
  dan_to_mbon_map: {
    mbon_type: string;
    dan_types: string[] | Record<string, number>;
    n_syn: number;
    mbon?: number | string;
    side?: string;
    n_kc_inputs?: number;
  }[];
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
  /**
   * How much clamping the dorsal fan-shaped body actually changes the rest of the brain. If it changes
   * nothing outside the clamped cells, the sleep and wake conditions are the same state and the
   * sleep-versus-wake comparison in stage 6 is unanswerable. Written by scripts/05_sleep.py.
   */
  manipulation_strength?: {
    pop_rate_relative_change?: number | null;
    kc_rate_relative_change?: number | null;
    frac_kc_active_relative_change?: number | null;
    n_dfb_clamped?: number;
    n_neurons?: number;
    dfb_fraction_of_brain?: number;
    state_is_distinguishable?: boolean;
    note?: string;
  } | null;
  /** Whether the learned weights are visible offline in the output-neuron rate. Written by scripts/05_sleep.py. */
  memory_visible_offline?: { mbon_rate_trained?: number; mbon_rate_naive?: number; relative_reduction?: number | null; note?: string } | null;
  /**
   * Whether the learned weights change the offline Kenyon-cell activity at all, and the anatomy that
   * decides it. Written by scripts/05_sleep.py; absent from a stage file written before that check existed.
   */
  engram_reaches_the_kenyon_cells?: {
    engram_reaches_the_kenyon_cells?: boolean;
    n_seeds?: number;
    n_seeds_identical?: number;
    mean_jaccard_active_kcs?: number | null;
    note?: string;
    anatomical_path?: {
      conditioning_dan?: string;
      dan_mbon_min_synapses?: number;
      n_mbons_gated?: number;
      n_gated_that_fire_offline?: number;
      n_gated_that_fire_and_reach_kenyon_cells?: number;
      synapses_back_onto_kenyon_cells_from_those?: number;
      note?: string;
      per_mbon?: Array<{
        mbon: string;
        transmitter: string;
        gating_synapses_from_dan: number;
        fires_offline: boolean;
        synapses_back_onto_kenyon_cells: number;
        n_kenyon_cells_contacted: number;
      }>;
      error?: string;
    } | null;
    per_seed?: Array<{
      seed: number;
      n_kc_spikes_trained: number;
      n_kc_spikes_naive: number;
      spike_trains_identical: boolean;
      first_divergence_s: number | null;
      n_kc_active_trained: number;
      n_kc_active_naive: number;
      jaccard_active_kcs: number | null;
    }>;
  } | null;

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
  /**
   * The headline p value. It is optional because an export written before the field existed does
   * not carry one, and the viewer omits the label rather than printing a placeholder for it.
   * `p_wilcoxon` and `p_permutation` are the two tests behind it where the file states them.
   */
  p?: number | null;
  p_wilcoxon?: number | null;
  p_permutation?: number | null;
  n: number;
  survives: boolean;
  /** direction the comparison was pre-registered in, where the file states it */
  direction?: string;
  /** whether the run that would produce this comparison happened at all */
  available?: boolean;
}
export interface Stage6PerSeed {
  seed: number;
  condition: string;
  /** the network this row was run on, as the file names it (e.g. "real_gain0.6", "shuffled_gain0.6") */
  network: string;
  ensemble: string;
  template_corr_mean: number;
  template_corr_p95: number;
  n_reactivation_events: number;
  coactivation_z?: number | null;
  /**
   * The sequence score. DATA_CONTRACT.md gives it as two flat fields; the stage file writes a
   * `sequence` block instead. The viewer reads whichever the file it loaded actually carries, and
   * prints nothing where neither is present.
   */
  sequence_rho?: number | null;
  sequence_p?: number | null;
  sequence?: { rho_mean?: number | null; rho_abs_mean?: number | null; p?: number | null; n_events_scored?: number | null } | null;
  z_vs_random_ensembles?: number | null;
  size?: number | null;
}
export interface Stage6 extends StageBase {
  headline: string;
  metrics: Record<string, string>;
  window_ms: number;
  n_seeds: number;
  comparisons: Comparison[];
  /**
   * The names of the pre-registered comparisons, as the stage file itself states them. When the
   * file does not carry the list the viewer falls back to the four names DATA_CONTRACT.md fixes,
   * and says which of the two it used.
   */
  required_four?: string[];
  /** the file's own explanation of any comparison beyond the pre-registered set */
  fifth_comparison_note?: string;
  /** the synaptic-gain deviation this stage ran at, and the sentence that must travel with it */
  gain?: number;
  gain_note?: string;
  metric_note?: string;
  /**
   * Side analyses of the same offline period, attached by scripts/export_web.py from their own result
   * directories. None of them is replay; the first is the largest memory-specific effect in the project.
   */
  offline_memory_trace?: {
    finding?: string;
    summary?: {
      drive_trained_mV_per_s?: number; drive_naive_mV_per_s?: number;
      total_change_pct_mean?: number; total_change_pct_sd?: number;
      weight_term_pct_mean?: number; activity_term_pct_mean?: number;
      plastic_weight_change_pct_mean?: number; amplification_over_weight_change?: number;
      paired_t?: number; p_value?: number; per_bin_ratio_cv_mean?: number | null; is_episodic?: boolean;
    };
  } | null;
  /**
   * Stage 11, the injected positive control. NOT a result: the recurrence among the trained ensemble was
   * multiplied by a factor an experimenter chose. It sits with the replay verdict because it says how much
   * weight that verdict can carry.
   */
  detector_control?: {
    IS_NOT_A_RESULT?: string;
    question?: string;
    answer?: string;
    any_scan_produced_episodes?: boolean;
    scans?: Array<{
      sigma_mV?: number; duration_s?: number; factors?: number[]; n_runs?: number;
      verdicts?: string[]; produced_episodes?: boolean;
      runs?: Array<{ factor?: number; ensemble_rate_hz?: number; other_kc_rate_hz?: number;
                     frac_bins_on?: number; n_episodes?: number; episode_duration_s_mean?: number;
                     verdict?: string }>;
      source_file?: string;
    }>;
  } | null;
  /**
   * Stages 12 and 13: what it would take for this model to have an episode at all. Both are labelled
   * deviations and neither is a property of the published model; the banner travels with each.
   */
  slow_variable?: {
    why?: string;
    adaptation?: {
      IS_A_LABELLED_DEVIATION?: string; constants_are?: string; constants_note?: string; finding?: string;
      duration_s?: number; tau_ms_scanned?: number[]; b_mV_scanned?: number[];
      any_brain_episodes?: boolean; any_ensemble_episodes?: boolean;
      runs?: Array<{ tau_ms?: number; b_mV?: number; brain_rate_hz?: number; brain_frac_on?: number;
                     brain_episodes?: number; brain_mean_episode_s?: number; brain_one_way?: boolean;
                     kc_rate_hz?: number; alln_rate_hz?: number; ensemble_rate_hz?: number;
                     ensemble_frac_on?: number; ensemble_episodes?: number;
                     ensemble_ratio_to_other_kcs?: number }>;
      source_file?: string;
    };
    depression?: {
      IS_A_LABELLED_DEVIATION?: string; finding?: string; duration_s?: number; why_this_mechanism?: string;
      measurement?: Array<{ synapse?: string; f?: number; tau_ms?: number; n?: string; source?: string }>;
      scope_definitions?: Record<string, string>;
      predicted_steady_state_scaling?: Record<string, Record<string, number>>;
      measured_target?: { what?: string; frequency_hz?: number[]; period_s?: number[]; period_is_derived?: string;
                          up_down_amplitude_mV?: string; sleep_dependence?: string; source?: string } | null;
      n_runs_with_brain_episodes?: number; n_runs_with_ensemble_episodes?: number;
      runs?: Array<{ scope?: string; f?: number; tau_ms?: number; n_depressing_synapses?: number;
                     brain_rate_hz?: number; brain_frac_on?: number; brain_episodes?: number;
                     brain_one_way?: boolean; alln_rate_hz?: number; alpn_rate_hz?: number;
                     kc_rate_hz?: number; ensemble_rate_hz?: number; ensemble_too_sparse?: boolean }>;
      source_file?: string;
    };
  } | null;
  return_path?: { finding?: string } | null;
  readout_gate?: { finding?: string } | null;
  recurrence_census?: { finding?: string } | null;
  /** whether each comparison's two arms are in the same state, and which half of a z-score moved */
  arm_matching?: Array<{ comparison: string; arms_are_matched: boolean; ensemble_size_ratio?: number | null; kc_rate_ratio?: number | null; note?: string }>;
  comparisons_with_unmatched_arms?: string[];
  z_decomposition?: Array<{ comparison: string; carried_by: string; note?: string }>;
  /**
   * The same runs re-analysed at shorter time bins. The primary bin is the cited one; these say whether
   * the verdict depends on that choice. Written by scripts/export_web.py from the stage6_replay_bin<n> result directories.
   */
  bin_robustness?: Array<{
    bin_ms?: number;
    status?: string;
    events_are_discrete?: boolean | null;
    comparisons?: Array<{ name?: string; label?: string; diff?: number; ci95?: [number, number]; hedges_g?: number; p_permutation?: number; n?: number; survives?: boolean; available?: boolean }>;
    source_file?: string;
  }>;
  /** mean odour-A ensemble size per network and condition, written by scripts/06_replay.py */
  ensemble_sizes?: Record<string, { sleep?: number; wake?: number; sleep_naive?: number }>;
  per_seed: Stage6PerSeed[];
  traces: { seed: number; condition: string; file: string }[];
  rasters: { seed: number; condition: string; file: string }[];
  /** the whole-brain activity files the stage exported, one per condition and seed */
  activity?: { seed: number; condition: string; file: string; n_spikes_exported?: number; downsampled?: boolean }[];
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
/** One framing box from `neuron_atlas.json`'s `view_boxes`, in micrometres. */
export interface AtlasViewBox {
  lo_um: [number, number, number];
  hi_um: [number, number, number];
  n_neurons?: number;
  description?: string;
}

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
  /**
   * Framing boxes the exporter computed. `brain` is the default view: it excludes the ascending
   * neurons whose somata sit below the brain / ventral-nerve-cord plane, which otherwise stretch
   * the vertical extent to three times the brain's and squash the brain into the top of the frame.
   * `all` is every mapped soma. Absent in atlases exported before the boxes existed, in which case
   * the map falls back to the quantisation bounds and says so.
   */
  view_boxes?: Record<string, AtlasViewBox | undefined>;
  /** the plane the `brain` box cuts at, in micrometres */
  brain_z_max_um?: number;
  /** how many somata lie below that plane (i.e. are in `all` but not in `brain`) */
  n_somata_below_brain_plane?: number;
  groups: { code: number; label: string }[];
  group_counts: Record<string, number>;
  /** per-group counts inside `view_boxes.brain`; the legend's figure while the brain view is on */
  group_counts_in_brain_view?: Record<string, number>;
  n_neurons_in_map: number;
  n_neurons_simulated: number;
  n_without_soma_position: number;
  n_without_soma_position_by_group: Record<string, number>;
  subsampled: boolean;
  /** neurons that HAVE a soma position, i.e. the population `subsampled` was decided against */
  n_with_soma_position?: number;
  soma_outside_brain_note: string;
  source: string;
  /**
   * The atlas's own provenance block: the config that was read, the cache it was written into and
   * the upstream annotation file the soma positions came from. It carries no `git_commit` or
   * `generated_at` of its own, so the viewer states the absence rather than substituting the
   * manifest's. Absent in atlases exported before the block existed, in which case the footer says
   * so instead of quietly showing the manifest's `base_config` as though the atlas had named it.
   */
  provenance?: SidecarProvenance;
  row_to_sim_index?: string;
  /** identity of this row numbering (sha256 of neuron_atlas_index.bin); absent in atlases exported before it existed */
  atlas_fingerprint?: string;
  n_atlas_rows?: number;
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
  /**
   * Identity of the atlas whose rows `atlas_row` indexes, written by scripts/export_web.py. Absent in
   * files exported before it existed, which is why the viewer distinguishes "unverified" from "matches".
   */
  n_atlas_rows?: number;
  atlas_fingerprint?: string;
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

/*
 * Reference activity clips are gone. They existed only while the replay stage had produced no
 * activity of its own; `replay/activity_*` now exists, and DATA_CONTRACT.md fixes that the map
 * plays that and nothing else. The types, the loader and the panel that read `reference_clips.json`
 * were deleted with them, so no code path can reach for a second source again.
 */


/**
 * Stage 3b, the feasibility block: everything that has to be true before a memory can be encoded at
 * all, plus the two modelling corrections that decide whether it is. Written by scripts/export_web.py
 * from results/stage3a_apl, stage3f_dpm, stage3b_odor, stage3c_control, stage3d_gain and stage3e_discrim.
 * Every field is optional: a section whose source file has not been written yet is simply not shown.
 */
export interface CorrectionSummary {
  odor: { pop_rate_hz: number; kc_rate_hz: number; frac_kc: number; apl_rate_hz?: number; readout_rate_hz?: number; dpm_rate_hz?: number };
  post: { pop_rate_hz: number; kc_rate_hz: number; frac_kc: number; apl_rate_hz?: number; readout_rate_hz?: number; dpm_rate_hz?: number };
  n_seeds: number;
}

export interface Stage3bFeasibility {
  status: string;
  criterion?: string;
  headline?: string;
  apl_correction?: {
    status?: string;
    question?: string;
    correction?: string;
    finding?: string;
    why_it_matters?: Record<string, number | string | null>;
    summary?: Record<string, CorrectionSummary>;
    provenance?: Provenance;
  } | null;
  dpm_correction?: {
    status?: string;
    question?: string;
    correction?: string;
    finding?: string;
    dpm_is_silent?: boolean;
    why_it_matters?: Record<string, number | string | null>;
    summary?: Record<string, CorrectionSummary>;
    provenance?: Provenance;
  } | null;
  odor_calibration?: {
    status?: string;
    criterion?: string;
    reference?: string;
    finding?: string;
    n_kc?: number;
    target_frac_kc?: number[];
    grid?: Array<Record<string, number | string | boolean | null>>;
    chosen?: Record<string, number | string | boolean | null> | null;
    provenance?: Provenance;
  } | null;
  ignition_threshold?: {
    glomerulus?: string;
    rate_hz?: number;
    smallest_igniting_drive?: number | null;
    finding?: string;
    grid?: Array<Record<string, number | null>>;
  } | null;
  dataset_control?: {
    finding?: string;
    pathway_control?: string;
    grid?: Array<Record<string, number | string | boolean | null>>;
    provenance?: Provenance;
  } | null;
  gain_sensitivity?: {
    WARNING?: string;
    finding?: string;
    chosen_gain?: number | null;
    grid?: Array<Record<string, number | boolean | null>>;
    provenance?: Provenance;
  } | null;
  gain_cost_on_gustatory_benchmark?: { question?: string; protocol?: string; finding?: string; runs?: Array<Record<string, number>> } | null;
  discriminability?: { finding?: string; criterion?: string; note?: string; grid?: Array<Record<string, number | string | boolean | null>>; provenance?: Provenance } | null;
  provenance?: Provenance;
}
