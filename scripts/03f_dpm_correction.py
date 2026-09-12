"""Stage 3f - THE DPM TRANSMITTER CORRECTION.

DPM (dorsal paired medial, one cell per hemisphere) is the mushroom body's second brain-wide feedback neuron.
It collects 95,527 synapses from 4,042 of the 4,064 Kenyon cells and returns 32,795 synapses onto 3,989 of
them. The male CNS v1.0 consensus transmitter calls it dopaminergic, and the model's transmitter-to-sign rule
maps dopamine to +1, so in the published model that whole return path is excitatory: Kenyon cells excite DPM,
DPM excites every Kenyon cell back.

The measurement says the opposite. Haynes, Christmann & Waddell (2015) eLife 4:e03868 show DPM cell bodies
stain for Gad1, that DPM contains GABA and 5-HT, and that activating DPM drives a large chloride increase in
mushroom-body neurons with no detectable calcium or cAMP increase. Lee et al. (2011) PNAS 108:13794 report DPM
as serotonergic. Neither transmitter is dopamine and the postsynaptic effect is inhibition.

This script measures what the substitution does. The model's rule is untouched: the measured transmitter is
put in place of the predicted one and the same rule is applied, so no parameter is introduced. Nothing else
changes: same connectome, same parameters, same stimulus, same seeds.

Outputs results/stage3f_dpm/stage3f.json.
"""
import argparse, json, time
import numpy as np
from hypnagogia import RESULTS
from hypnagogia.config import load_config, dump_config
from hypnagogia.connectome import load_connectome
from hypnagogia.jobs import run_jobs
from hypnagogia.model import load_spikes, spikes_in_epoch
from hypnagogia.populations import NT_CORRECTIONS

OUT = RESULTS / "stage3f_dpm"
ODOR = ["ORN_DM1", "ORN_DM4", "ORN_VA2", "ORN_DM2"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gain", type=float, default=1.0)
    ap.add_argument("--seeds", default="0,1,2")
    a = ap.parse_args()
    seeds = [int(x) for x in a.seeds.split(",") if x.strip() != ""]

    cfg = load_config("base")
    OUT.mkdir(parents=True, exist_ok=True); dump_config(cfg, OUT / "config.resolved.yaml")
    conn = load_connectome("malecns", "v1.0", "brain")
    kc = conn.select(cell_class="Kenyon_Cell"); dpm = conn.select(cell_type="DPM")
    apl = conn.select(cell_type="APL"); mbon = conn.select(cell_class="MBON")
    readout = conn.select(cell_type="MBON11")
    w_syn = cfg["model"]["w_syn_mV"]; scale = conn.weight_scale * a.gain
    gap = cfg["model"]["v_th_mV"] - cfg["model"]["v_rest_mV"]

    out_m = np.isin(conn.pre, dpm) & np.isin(conn.post, kc)
    in_m = np.isin(conn.post, dpm) & np.isin(conn.pre, kc)
    all_to_kc = int(conn.count[np.isin(conn.post, kc)].sum())
    per_kc = {}
    for p, c in zip(conn.post[out_m], conn.count[out_m]):
        per_kc[int(p)] = per_kc.get(int(p), 0) + int(c)
    why = {
        "threshold_gap_mV": gap,
        "n_DPM_neurons": int(len(dpm)),
        "DPM_synapses_onto_KCs": int(conn.count[out_m].sum()),
        "n_KCs_contacted_by_DPM": int(len(per_kc)),
        "n_KCs_total": int(len(kc)),
        "KC_synapses_onto_DPM": int(conn.count[in_m].sum()),
        "n_KCs_presynaptic_to_DPM": int(len(np.unique(conn.pre[in_m]))),
        "DPM_share_of_all_input_onto_KCs": float(conn.count[out_m].sum() / all_to_kc),
        "one_DPM_spike_delivers_to_each_KC_mV": float(np.mean(list(per_kc.values())) * scale * w_syn) if per_kc else 0.0,
        "DPM_spike_as_fraction_of_KC_threshold_gap": float(np.mean(list(per_kc.values())) * scale * w_syn / gap) if per_kc else 0.0,
        "annotated_nt": NT_CORRECTIONS["DPM"]["annotated_nt"],
        "measured_nt": NT_CORRECTIONS["DPM"]["measured_nt"],
        "source": NT_CORRECTIONS["DPM"]["source"],
        "APL_graded_drive_onto_DPM_mV": None,   # filled below
        "note": ("With the predicted transmitter the Kenyon-cell population drives DPM and DPM drives the whole "
                 "Kenyon-cell population back, so the mushroom body carries a second brain-wide POSITIVE feedback "
                 "loop on top of the recurrent Kenyon-cell wiring, in parallel with the one negative loop (APL) "
                 "that is supposed to keep the code sparse. With the measured transmitter it is a second negative "
                 "loop, which is what the chloride measurement shows."),
    }

    # What the corrected APL delivers to DPM. APL is modelled as non-spiking (Amin et al. 2020), so its release is
    # a steady offset: a cell held at threshold delivers what a spiking synapse delivers at the maximum rate the
    # refractory period allows, i.e. tau_syn / t_refr times the per-spike weight.
    k_graded = cfg["model"]["tau_syn_ms"] / cfg["model"]["t_refr_ms"]
    apl_dpm = np.isin(conn.pre, apl) & np.isin(conn.post, dpm)
    apl_drive_dpm = float(conn.count[apl_dpm].sum() * scale * w_syn * k_graded / max(len(dpm), 1))
    why["APL_graded_drive_onto_DPM_mV"] = -apl_drive_dpm
    why["APL_graded_drive_onto_DPM_as_threshold_gaps"] = -apl_drive_dpm / gap
    why["APL_synapses_onto_DPM"] = int(conn.count[apl_dpm].sum())

    specs, meta = [], []
    for label, pops in (("dpm_annotated", []), ("dpm_corrected", ["DPM"])):
        for sd in seeds:
            c = json.loads(json.dumps(cfg))
            c["noise"] = {"mode": "none", "sigma_mV": 0.0, "poisson": cfg["noise"]["poisson"]}
            c["nt_corrections"] = {"populations": pops}
            specs.append({"out_dir": str(OUT / f"{label}_seed{sd}"), "seed": 1600 + sd, "config": c,
                          "name": f"{label}_{sd}",
                          "connectome": {"dataset": "malecns", "version": "v1.0", "scope": "brain", "weight_scale": scale},
                          "drive_groups": {"odor": {"selector": {"cell_type": ODOR}}}, "record": "all",
                          "epochs": [{"name": "pre", "duration_s": 0.5},
                                     {"name": "odor", "duration_s": 1.0, "drives": {"odor": 150.0}},
                                     {"name": "post", "duration_s": 2.0}]})
            meta.append({"condition": label, "seed": sd})

    t0 = time.time()
    res = run_jobs(specs, n_parallel=cfg["run"]["n_parallel"])
    rows = []
    for sp, mm, r in zip(specs, meta, res):
        if r is None or "error" in r:
            rows.append({**mm, "error": (r or {}).get("error", "")[-200:]}); continue
        i, ts, m = load_spikes(sp["out_dir"])

        def stat(ep):
            ii, _, eps = spikes_in_epoch(i, ts, m, ep)
            dur = sum(e["duration_s"] for e in eps)
            k = ii[np.isin(ii, kc)]
            return {"pop_rate_hz": float(len(ii) / dur / m["n_neurons"]),
                    "kc_rate_hz": float(len(k) / dur / len(kc)),
                    "frac_kc": float(len(np.unique(k)) / len(kc)),
                    "mbon_rate_hz": float(np.isin(ii, mbon).sum() / dur / len(mbon)),
                    "readout_rate_hz": float(np.isin(ii, readout).sum() / dur / max(len(readout), 1)),
                    "dpm_rate_hz": float(np.isin(ii, dpm).sum() / dur / max(len(dpm), 1)),
                    "dpm_spikes": int(np.isin(ii, dpm).sum()),
                    "apl_rate_hz": float(np.isin(ii, apl).sum() / dur / max(len(apl), 1))}
        rows.append({**mm, "odor": stat("odor"), "post": stat("post")})

    ok = [r for r in rows if "error" not in r]
    summ = {}
    for cond in ("dpm_annotated", "dpm_corrected"):
        g = [r for r in ok if r["condition"] == cond]
        if g:
            summ[cond] = {k: {kk: float(np.mean([r[k][kk] for r in g])) for kk in g[0][k]} for k in ("odor", "post")}
            summ[cond]["n_seeds"] = len(g)

    both = len(summ) == 2
    finding = "not computed"
    silent = bool(both and summ["dpm_annotated"]["odor"]["dpm_spikes"] == 0 and summ["dpm_corrected"]["odor"]["dpm_spikes"] == 0)
    if both and silent:
        finding = (f"The substitution changes nothing measurable, because DPM never fires a single spike in either "
                   f"condition and so never releases anything for the sign to apply to. The reason is the other "
                   f"correction: APL modelled as non-spiking sits at its saturating release level and delivers a steady "
                   f"{-why['APL_graded_drive_onto_DPM_mV']:.0f} mV of hyperpolarising drive to DPM through "
                   f"{why['APL_synapses_onto_DPM']:,} synapses, which is "
                   f"{-why['APL_graded_drive_onto_DPM_as_threshold_gaps']:.0f} times DPM's threshold gap. Both runs give "
                   f"{summ['dpm_annotated']['odor']['frac_kc']:.2%} of Kenyon cells at "
                   f"{summ['dpm_annotated']['odor']['kc_rate_hz']:.3f} Hz during the odour and "
                   f"{summ['dpm_annotated']['post']['kc_rate_hz']:.3f} Hz after it. The transmitter assignment is still "
                   f"wrong and is still corrected everywhere, but in this model it is inert: DPM is one of the cells the "
                   f"corrected APL switches off. The same happens to the readout MBON. Both cells have measured odour "
                   f"responses in the fly, so a model in which APL silences them is not reproducing them.")
    elif both:
        an, co = summ["dpm_annotated"], summ["dpm_corrected"]
        finding = (f"Substituting the measured transmitter for the predicted one on DPM takes the odour response "
                   f"from {an['odor']['frac_kc']:.2%} of Kenyon cells at {an['odor']['kc_rate_hz']:.3f} Hz to "
                   f"{co['odor']['frac_kc']:.2%} at {co['odor']['kc_rate_hz']:.3f} Hz, and the offline Kenyon-cell "
                   f"rate from {an['post']['kc_rate_hz']:.3f} Hz to {co['post']['kc_rate_hz']:.3f} Hz. The readout "
                   f"MBON goes from {an['odor']['readout_rate_hz']:.2f} Hz to {co['odor']['readout_rate_hz']:.2f} Hz "
                   f"and the whole brain from {an['post']['pop_rate_hz']:.3f} Hz to {co['post']['pop_rate_hz']:.3f} Hz "
                   f"after the odour. The correction changes {why['DPM_synapses_onto_KCs']} synapses onto "
                   f"{why['n_KCs_contacted_by_DPM']} of {why['n_KCs_total']} Kenyon cells from excitatory to "
                   f"inhibitory, which is {why['DPM_share_of_all_input_onto_KCs']:.2%} of all input onto Kenyon cells.")
    out = {"status": "passed" if both else "failed",
           "dpm_is_silent": silent,
           "gain": a.gain,
           "gain_note": "published parameters" if a.gain == 1.0 else f"synaptic gain {a.gain} (labelled deviation)",
           "question": "What does the connectome's predicted transmitter for DPM do to the mushroom body?",
           "correction": NT_CORRECTIONS["DPM"]["source"],
           "why_it_matters": why, "per_run": rows, "summary": summ, "finding": finding,
           "walltime_s": round(time.time() - t0, 1),
           "provenance": {"config": "configs/base.yaml", "results_dir": "results/stage3f_dpm",
                          "files": [s["out_dir"] for s in specs]}}
    json.dump(out, open(OUT / "stage3f.json", "w"), indent=1, default=str)
    print(finding); print()
    for k, v in why.items():
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            print(f"  {k}: {v:,.4f}" if isinstance(v, float) else f"  {k}: {v:,}")
    print()
    for cond, v in summ.items():
        print(f"  {cond:14s} odour: {v['odor']['frac_kc']:6.2%} of KCs at {v['odor']['kc_rate_hz']:7.3f} Hz, "
              f"MBON11 {v['odor']['readout_rate_hz']:6.2f} Hz | after: {v['post']['frac_kc']:6.2%} at "
              f"{v['post']['kc_rate_hz']:7.3f} Hz, brain {v['post']['pop_rate_hz']:6.3f} Hz")


if __name__ == "__main__":
    main()
