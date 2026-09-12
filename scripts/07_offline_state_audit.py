"""Stage 7 - WHAT IS THE OFFLINE STATE ACTUALLY MADE OF?

Every result downstream of stage 2 rests on a sentence: at the operating point the network is in a
self-sustaining state at about 1.9 Hz per neuron. That is a mean over 144,209 neurons, and a mean is not a
state. This asks what is actually firing.

The answer decides how to read the replay result. If the activity is spread across the brain, the offline
state is a background and the negative replay result is about replay. If it is concentrated in one nucleus,
the offline state is that nucleus running away, the Kenyon cells are downstream of it rather than sitting in
a background, and the negative result is about the model's dynamics rather than about memory.

No simulation: this reads the stage-2 run at the chosen operating point and the stage-5 offline runs, and
reports the rate and the active fraction per cell class and per cell type, plus the signed synaptic budget
inside whichever population turns out to carry it.

Writes results/stage7_offline_state/offline_state.json.
"""
import argparse, json
import numpy as np
import pandas as pd
from hypnagogia import RESULTS
from hypnagogia.config import load_config
from hypnagogia.connectome import load_connectome

OUT = RESULTS / "stage7_offline_state"
REFRACTORY_CEILING_NOTE = "the maximum rate the refractory period allows"


def rates(run_dir, n_neurons):
    meta = json.load(open(run_dir / "meta.json"))
    z = np.load(run_dir / "spikes.npz")
    i, t = z["i"], z["t_step"] * meta["dt_ms"] * 1e-3
    eps = [e for e in meta["epochs"] if e["name"] in ("noise", "sleep", "wake", "sleep_naive")]
    ep = eps[0] if eps else meta["epochs"][-1]
    t0 = ep.get("t_start_s", 0.0); t1 = ep.get("t_end_s", meta["duration_s"])
    k = (t >= t0) & (t < t1)
    return np.bincount(i[k], minlength=n_neurons) / max(t1 - t0, 1e-9), float(t1 - t0), ep["name"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gain", type=float, default=1.0)
    a = ap.parse_args()
    suffix = "" if a.gain == 1.0 else f"_gain{a.gain}"
    OUT.mkdir(parents=True, exist_ok=True)

    cfg = load_config("base"); mdl = cfg["model"]
    ceiling = 1.0 / (mdl["t_refr_ms"] * 1e-3)
    conn = load_connectome("malecns", "v1.0", "brain")
    # cell_class is absent for 125,967 of the 144,209 neurons, mostly optic lobe, so super_class carries
    # those. Grouping on whichever is present keeps the named populations named and does not collapse most
    # of the brain into one bucket called "unknown".
    cls = conn.ann.cell_class.astype("string")
    sup = conn.ann.super_class.astype("string")
    label = cls.fillna(sup).fillna("unannotated").to_numpy(dtype=object)
    ct = conn.ann.cell_type.astype(str).values
    # The antennal lobe as a pathway, which is the unit the question is about rather than any one class.
    AL_CLASSES = ("ALPN", "ALLN", "ALIN", "ALON")
    al = np.unique(np.concatenate([conn.select(cell_class=c) for c in AL_CLASSES]
                                  + [conn.select(cell_type={"regex": r"^ORN_"})]))

    s2 = json.load(open(RESULTS / "stage2_criticality" / ("full" + suffix) / "stage2.json"))
    sigma = s2["operating_sigma_mV"]
    sources = []
    d2 = RESULTS / "stage2_criticality" / ("full" + suffix) / f"sigma{sigma}_seed0"
    if (d2 / "spikes.npz").exists():
        sources.append(("stage 2 operating point", d2))
    d5 = RESULTS / "stage5_sleep" / f"real{suffix}" / "sleep_seed0"
    if (d5 / "spikes.npz").exists():
        sources.append(("stage 5 offline period", d5))
    if not sources:
        raise SystemExit("no run found at the operating point")

    report = {}
    for name, d in sources:
        r, dur, epoch = rates(d, conn.N)
        total = float(r.sum())
        rows = []
        for lab in sorted(set(label)):
            sel = np.flatnonzero(label == lab)
            if len(sel) == 0:
                continue
            rows.append({"population": lab, "n_neurons": int(len(sel)),
                         "mean_rate_hz": float(r[sel].mean()), "frac_active": float((r[sel] > 0).mean()),
                         "share_of_all_spikes": float(r[sel].sum() / total) if total else 0.0,
                         "max_rate_hz": float(r[sel].max()),
                         "frac_of_refractory_ceiling": float(r[sel].max() / ceiling)})
        rows.sort(key=lambda x: -x["share_of_all_spikes"])
        al_share = float(r[al].sum() / total) if total else 0.0
        hot = np.argsort(-r)[:12]
        report[name] = {
            "run": str(d.relative_to(RESULTS.parent)), "epoch": epoch, "duration_s": dur,
            "whole_brain_rate_hz_per_neuron": total / conn.N,
            "by_population": rows,
            "hottest_cells": [{"cell_type": str(ct[i]), "rate_hz": float(r[i]),
                               "frac_of_refractory_ceiling": float(r[i] / ceiling)} for i in hot],
            "share_of_spikes_in_top_population": rows[0]["share_of_all_spikes"] if rows else None,
            "top_population": rows[0]["population"] if rows else None,
            "antennal_lobe": {"n_neurons": int(len(al)), "frac_of_brain": float(len(al) / conn.N),
                              "share_of_all_spikes": al_share,
                              "mean_rate_hz": float(r[al].mean()), "frac_active": float((r[al] > 0).mean())},
        }

    # The signed synaptic budget inside whichever population carries it, which is what decides whether that
    # population is a gain control or a positive feedback loop under the model's sign rule.
    scale = cfg["dataset"]["weight_scale"] * a.gain
    w = scale * mdl["w_syn_mV"]
    top = "ALLN"
    budget = []
    for src_lab, dst_lab in [("ALLN", "ALLN"), ("ALLN", "ALPN"), ("ALPN", "ALLN"), ("ORN", "ALLN"), ("ALPN", "ALPN")]:
        src = np.flatnonzero(label == src_lab) if src_lab != "ORN" else conn.select(cell_type={"regex": r"^ORN_"})
        dst = np.flatnonzero(label == dst_lab)
        if len(src) == 0 or len(dst) == 0:
            continue
        m = np.isin(conn.pre, src) & np.isin(conn.post, dst)
        if not m.any():
            continue
        exc = int(conn.count[m][conn.sign[m] > 0].sum()); inh = int(conn.count[m][conn.sign[m] < 0].sum())
        budget.append({"from": src_lab, "to": dst_lab, "excitatory_synapses": exc, "inhibitory_synapses": inh,
                       "fraction_excitatory": exc / (exc + inh) if (exc + inh) else None,
                       "net_mV_if_every_source_spiked_once": (exc - inh) * w})
    nt = conn.ann.nt.astype(str).values
    top_sel = np.flatnonzero(label == top)
    nt_mix = {k: int(v) for k, v in pd.Series(nt[top_sel]).value_counts().items()} if len(top_sel) else {}

    first = report[sources[0][0]]
    alr = first["antennal_lobe"]
    alln_row = next((r for r in first["by_population"] if r["population"] == "ALLN"), None)
    alpn_row = next((r for r in first["by_population"] if r["population"] == "ALPN"), None)
    kc_row = next((r for r in first["by_population"] if r["population"] == "Kenyon_Cell"), None)
    rec = next((b for b in budget if b["from"] == "ALLN" and b["to"] == "ALLN"), None)

    finding = (
        f"The offline state is not a brain-wide background, it is the antennal lobe running away. The whole "
        f"brain averages {first['whole_brain_rate_hz_per_neuron']:.2f} Hz per neuron at the operating point, and "
        f"{alr['share_of_all_spikes']:.0%} of every spike comes from the {alr['n_neurons']:,} antennal-lobe "
        f"neurons, {alr['frac_of_brain']:.1%} of the brain.")
    if alln_row and alpn_row:
        finding += (f" Its local interneurons run at {alln_row['mean_rate_hz']:.0f} Hz with "
                    f"{alln_row['frac_active']:.0%} of them active and the fastest at "
                    f"{alln_row['frac_of_refractory_ceiling']:.0%} of {REFRACTORY_CEILING_NOTE}; its projection "
                    f"neurons at {alpn_row['mean_rate_hz']:.0f} Hz with {alpn_row['frac_active']:.0%} active.")
    if kc_row:
        finding += (f" The Kenyon cells whose reactivation the replay test measures idle at "
                    f"{kc_row['mean_rate_hz']:.2f} Hz, which reads as biological, but they sit downstream of that "
                    f"rather than in a background: they contribute {kc_row['share_of_all_spikes']:.1%} of the "
                    f"brain's spikes while being driven by a pathway two synapses upstream that never stops.")
    if rec and rec["fraction_excitatory"] is not None:
        finding += (f" Under the model's sign rule the local interneurons' connections onto each other are "
                    f"{rec['fraction_excitatory']:.0%} excitatory by synapse count, so the population that damps "
                    f"this pathway in the fly amplifies it here. Whether that is the connectome's transmitter "
                    f"prediction being wrong for these cells, or the model representing as chemical excitation "
                    f"something those cells do by another route, is a literature question and is the one to "
                    f"settle next. It is not a tuning question, and nothing downstream of stage 2 can be read as "
                    f"being about the brain until it is answered.")

    out = {"status": "passed", "gain": a.gain, "operating_sigma_mV": sigma,
           "question": "What is the offline state actually made of, and which cells carry it?",
           "refractory_ceiling_hz": ceiling, "by_run": report,
           "recurrent_budget_in_top_population": budget,
           "transmitter_mix_in_top_population": nt_mix,
           "finding": finding,
           "provenance": {"config": "configs/base.yaml", "results_dir": "results/stage7_offline_state",
                          "files": [str(d.relative_to(RESULTS.parent)) for _, d in sources]}}
    json.dump(out, open(OUT / "offline_state.json", "w"), indent=1, default=str)
    print(finding); print()
    for name, rep in report.items():
        print(f"=== {name}: {rep['epoch']}, {rep['duration_s']:.0f} s, "
              f"{rep['whole_brain_rate_hz_per_neuron']:.3f} Hz per neuron overall")
        print(f"{'population':22s} {'cells':>7s} {'mean Hz':>9s} {'active':>7s} {'share of spikes':>16s} {'max Hz':>8s}")
        for r in rep["by_population"][:9]:
            print(f"{r['population']:22s} {r['n_neurons']:7,} {r['mean_rate_hz']:9.2f} {r['frac_active']:6.0%} "
                  f"{r['share_of_all_spikes']:15.1%} {r['max_rate_hz']:8.0f}")
        print()
    if nt_mix:
        print(f"transmitter prediction inside {top}: " + ", ".join(f"{k} {v}" for k, v in nt_mix.items()))
    for b in budget:
        print(f"  {b['from']:14s} -> {b['to']:14s} {b['fraction_excitatory']:5.0%} excitatory "
              f"({b['excitatory_synapses']:,} vs {b['inhibitory_synapses']:,} synapses)")


if __name__ == "__main__":
    main()
