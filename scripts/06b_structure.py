"""Stage 6b - IS REACTIVATION EXPLAINED BY WIRING RATHER THAN BY MEMORY?

The replay test compares how strongly the trained (A) and untrained (B) Kenyon-cell ensembles reactivate. That
comparison is only meaningful if the two ensembles are otherwise alike. They are not: each is defined by which
cells an odour drives, and those cells are not a random sample of the mushroom body. This script measures how
tightly each ensemble is wired to itself through Kenyon-cell to Kenyon-cell synapses, and asks whether that
structure, rather than the memory, predicts how much it reactivates.

If it does, then the odour-A versus odour-B comparison is confounded, and the memory-specific test is the one
that holds the ensemble fixed and changes only the weights: trained versus unlearned.
"""
import argparse, json
from pathlib import Path
import numpy as np
from scipy import stats
from hypnagogia import RESULTS
from hypnagogia.connectome import load_connectome

OUT = RESULTS / "stage6_structure"


def within_ensemble_synapses(pre_k, post_k, cnt_k, n_neurons, members):
    m = np.zeros(n_neurons, bool); m[members] = True
    return int(cnt_k[m[pre_k] & m[post_k]].sum())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gain", type=float, default=0.6)
    ap.add_argument("--tag", default="")
    ap.add_argument("--n-null", type=int, default=400)
    a = ap.parse_args()
    gain_suffix = "" if a.gain == 1.0 else f"_gain{a.gain}"
    OUT.mkdir(parents=True, exist_ok=True)
    conn = load_connectome("malecns", "v1.0", "brain")
    kc = conn.select(cell_class="Kenyon_Cell")
    kcm = np.zeros(conn.N, bool); kcm[kc] = True
    kk = kcm[conn.pre] & kcm[conn.post]
    pre_k, post_k, cnt_k = conn.pre[kk], conn.post[kk], conn.count[kk]
    id2idx = {int(conn.ids[x]): int(x) for x in kc}
    tpl = json.load(open(RESULTS / "stage4_learning" / f"real{gain_suffix}" / "kc_templates.json"))
    s6p = RESULTS / f"stage6_replay{gain_suffix}{a.tag}" / "stage6.json"
    s6 = json.load(open(s6p)) if s6p.exists() else None
    rng = np.random.default_rng(0)
    rows = []
    for sd, t in sorted(tpl.items(), key=lambda x: int(x[0])):
        row = {"seed": int(sd)}
        for nm in ("A", "B"):
            E = np.array([id2idx[x] for x in t[f"{nm}_pre"] if x in id2idx], dtype=np.int64)
            if len(E) == 0:
                continue
            obs = within_ensemble_synapses(pre_k, post_k, cnt_k, conn.N, E)
            nulls = [within_ensemble_synapses(pre_k, post_k, cnt_k, conn.N, rng.choice(kc, len(E), replace=False))
                     for _ in range(a.n_null)]
            mu, sd_ = float(np.mean(nulls)), float(np.std(nulls))
            row[f"{nm}_size"] = int(len(E))
            row[f"{nm}_within_synapses"] = obs
            row[f"{nm}_expected_by_chance"] = mu
            row[f"{nm}_z"] = float((obs - mu) / sd_) if sd_ else None
            row[f"{nm}_density_per_cell"] = float(obs / len(E))
        rows.append(row)
    zA = np.array([r["A_z"] for r in rows if r.get("A_z") is not None])
    zB = np.array([r["B_z"] for r in rows if r.get("B_z") is not None])
    dA = np.array([r["A_density_per_cell"] for r in rows])
    dB = np.array([r["B_density_per_cell"] for r in rows])
    out = {
        "question": "Is reactivation explained by how tightly an ensemble is wired to itself, rather than by the memory?",
        "method": ("For each seed, count the Kenyon-cell to Kenyon-cell synapses that fall inside the ensemble, and "
                   "compare with the count for random ensembles of the same size drawn from the same population."),
        "per_seed": rows,
        "summary": {
            "A_z_mean": float(zA.mean()), "B_z_mean": float(zB.mean()),
            "A_within_synapses_mean": float(np.mean([r["A_within_synapses"] for r in rows])),
            "B_within_synapses_mean": float(np.mean([r["B_within_synapses"] for r in rows])),
            "A_density_per_cell_mean": float(dA.mean()), "B_density_per_cell_mean": float(dB.mean()),
            "density_B_minus_A": float(dB.mean() - dA.mean()),
            "paired_p_density": float(stats.wilcoxon(dA, dB).pvalue) if len(dA) >= 6 else None,
        },
    }
    both_cliquey = out["summary"]["A_z_mean"] > 3 and out["summary"]["B_z_mean"] > 3
    b_denser = out["summary"]["density_B_minus_A"] > 0
    out["finding"] = (
        (f"Both ensembles are strongly wired to themselves: the trained ensemble has "
         f"{out['summary']['A_z_mean']:.0f} standard deviations more within-ensemble synapses than random ensembles of "
         f"the same size, the untrained one {out['summary']['B_z_mean']:.0f}. An odour-driven Kenyon-cell ensemble is "
         f"not a random subset of the mushroom body, it is a structural clique. "
         + (f"The untrained ensemble is the DENSER of the two, {out['summary']['B_density_per_cell_mean']:.1f} versus "
            f"{out['summary']['A_density_per_cell_mean']:.1f} within-ensemble synapses per cell. That alone predicts it "
            f"will reactivate more, so the trained-versus-untrained comparison is confounded by wiring and cannot on its "
            f"own decide whether the memory drives reactivation. The comparison that holds the ensemble and its wiring "
            f"fixed and changes only the learned weights is trained versus unlearned."
            if b_denser else
            f"The trained ensemble is the denser of the two, so the comparison is confounded in the direction that would "
            f"favour a positive result, and any positive must be read with that in mind."))
        if both_cliquey else
        "Neither ensemble is more interconnected than chance, so the comparison between them is not confounded by wiring.")
    if s6:
        cmp_map = {c["name"]: c for c in s6.get("comparisons", []) if c.get("available")}
        out["replay_comparisons_for_context"] = {
            k: {"hedges_g": cmp_map[k]["hedges_g"], "diff": cmp_map[k]["diff"], "survives": cmp_map[k]["survives"]}
            for k in ("A_vs_B_sleep", "trained_vs_naive_weights") if k in cmp_map}
        # The decisive test of the confound: across every seed and both ensembles, does how tightly an ensemble is
        # wired to itself predict how much it reactivates? If it does, the ensemble comparison is measuring wiring.
        per = s6.get("per_seed", [])
        real = f"real{gain_suffix}"
        xs, ys, lab = [], [], []
        by_seed = {r["seed"]: r for r in rows}
        for rec in per:
            if rec.get("network") != real or rec.get("condition") != "sleep":
                continue
            nm = rec.get("ensemble")
            st = by_seed.get(rec.get("seed"))
            if nm in ("A", "B") and st and st.get(f"{nm}_z") is not None and rec.get("z_vs_random_ensembles") is not None:
                xs.append(st[f"{nm}_z"]); ys.append(rec["z_vs_random_ensembles"]); lab.append(nm)
        if len(xs) >= 6:
            xs_, ys_ = np.array(xs), np.array(ys)
            r_, p_ = stats.pearsonr(xs_, ys_)
            rho, prho = stats.spearmanr(xs_, ys_)
            out["structure_predicts_reactivation"] = {
                "n_points": int(len(xs_)), "pearson_r": float(r_), "pearson_p": float(p_),
                "spearman_rho": float(rho), "spearman_p": float(prho),
                "x": "within-ensemble wiring, z against size-matched random ensembles",
                "y": "reactivation, z against size-matched random ensembles, sleep condition",
                "interpretation": (
                    (f"How tightly an ensemble is wired to itself predicts how much it reactivates (Pearson r = "
                     f"{r_:.3f}, p = {p_:.2g}, n = {len(xs_)} ensemble-by-seed points). The comparison between the "
                     f"trained and untrained ensembles is therefore largely a comparison of their wiring, and cannot "
                     f"on its own establish that a memory drives reactivation. The test that holds wiring fixed and "
                     f"changes only the learned weights is trained versus unlearned.")
                    if p_ < 0.05 and r_ > 0 else
                    (f"Within-ensemble wiring does NOT predict reactivation across ensembles and seeds (Pearson r = "
                     f"{r_:.3f}, p = {p_:.2g}, n = {len(xs_)}), so the difference between the trained and untrained "
                     f"ensembles is not explained by their wiring."))}
    json.dump(out, open(OUT / f"structure{gain_suffix}{a.tag}.json", "w"), indent=1)
    print(out["finding"])
    print()
    print(f"  trained ensemble:   {out['summary']['A_within_synapses_mean']:8.0f} within-ensemble synapses, "
          f"z = {out['summary']['A_z_mean']:+.1f}, {out['summary']['A_density_per_cell_mean']:.1f} per cell")
    print(f"  untrained ensemble: {out['summary']['B_within_synapses_mean']:8.0f} within-ensemble synapses, "
          f"z = {out['summary']['B_z_mean']:+.1f}, {out['summary']['B_density_per_cell_mean']:.1f} per cell")
    if out["summary"]["paired_p_density"] is not None:
        print(f"  paired difference in density, Wilcoxon p = {out['summary']['paired_p_density']:.4g}")


if __name__ == "__main__":
    main()
