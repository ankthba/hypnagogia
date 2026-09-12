"""Reactivation ("replay") metrics for a Kenyon-cell ensemble during a simulated sleep epoch.

Definitions follow the hippocampal literature, adapted to sparse KC spiking (Turner et al. 2008: KCs fire a
few spikes per odour, spontaneous rate ~0.1 Hz; Honegger et al. 2011: ~5% of KCs respond):

* template correlation - Pearson correlation, per time bin, between the population activity vector over all
  recorded KCs and the odour's template vector (Tatsuno et al. 2006 J Neurosci 26:10727 template matching;
  bin 100 ms as in Kudrimoti et al. 1999 J Neurosci 19:4090, with 50 and 200 ms as robustness checks).
* co-activation z - mean pairwise co-activation (Pearson, zero-lag) among ensemble members during sleep,
  standardised against the distribution over size-matched random KC ensembles (Wilson & McNaughton 1994).
* sequence-order preservation - Spearman rank correlation between each neuron's mean first-spike time inside a
  candidate reactivation event and its rank in the odour response, with a cell-identity shuffle null
  (Foster & Wilson 2006 Nature 440:680; Tingley & Peyrache 2020 Phil Trans R Soc B 375:20190231).
* reactivation events - bins whose template correlation exceeds the 95th percentile of the matched null.
"""
from __future__ import annotations

import numpy as np
from scipy import stats


def binned_matrix(i: np.ndarray, t_step: np.ndarray, dt_s: float, neurons: np.ndarray, t0: float, t1: float, bin_s: float) -> np.ndarray:
    """[n_neurons, n_bins] spike-count matrix for `neurons` over [t0, t1)."""
    n_bins = max(int(np.floor((t1 - t0) / bin_s)), 1)
    pos = np.full(int(neurons.max()) + 2 if len(neurons) else 1, -1, dtype=np.int64)
    pos[neurons] = np.arange(len(neurons))
    t = t_step.astype(np.float64) * dt_s
    m = (t >= t0) & (t < t1) & (i < len(pos))
    ii, tt = i[m], t[m]
    row = pos[ii]
    ok = row >= 0
    col = np.floor((tt[ok] - t0) / bin_s).astype(np.int64)
    keep = col < n_bins
    M = np.zeros((len(neurons), n_bins), dtype=np.float32)
    np.add.at(M, (row[ok][keep], col[keep]), 1.0)
    return M


def template_correlation(M: np.ndarray, template: np.ndarray) -> np.ndarray:
    """Pearson correlation of each column of M with the template vector. Bins with no spikes give NaN."""
    t = template.astype(np.float64)
    t = t - t.mean()
    tn = np.sqrt((t ** 2).sum())
    X = M.astype(np.float64)
    X = X - X.mean(axis=0, keepdims=True)
    xn = np.sqrt((X ** 2).sum(axis=0))
    with np.errstate(invalid="ignore", divide="ignore"):
        r = (X * t[:, None]).sum(axis=0) / (xn * tn)
    return r


def coactivation(M: np.ndarray, members: np.ndarray) -> float:
    """Mean zero-lag pairwise correlation among ensemble members (Wilson & McNaughton 1994)."""
    if len(members) < 2:
        return float("nan")
    X = M[members].astype(np.float64)
    keep = X.std(axis=1) > 0
    X = X[keep]
    if len(X) < 2:
        return float("nan")
    C = np.corrcoef(X)
    iu = np.triu_indices(len(C), k=1)
    return float(np.nanmean(C[iu]))


def sequence_score(i: np.ndarray, t_step: np.ndarray, dt_s: float, members: np.ndarray, order_rank: np.ndarray,
                   events: list[tuple[float, float]], n_shuffle: int = 200, seed: int = 0) -> dict:
    """Spearman rho between within-event first-spike order and the template order, averaged over events, with a
    cell-identity shuffle null.

    The per-event first-spike times are extracted ONCE and reused for every shuffle; only the rank assignment is
    permuted. Recomputing them inside the shuffle loop makes this quadratic in the number of events and was the
    dominant cost of the whole replay analysis.
    """
    rng = np.random.default_rng(seed)
    pos = np.full(int(members.max()) + 2, -1, dtype=np.int64) if len(members) else np.zeros(1, dtype=np.int64)
    if len(members):
        pos[members] = np.arange(len(members))
    t = t_step.astype(np.float64) * dt_s
    keep = np.isin(i, members)
    ii, tt = i[keep], t[keep]
    order_t = np.argsort(tt, kind="stable")
    ii, tt = ii[order_t], tt[order_t]

    # one pass per event: the member index and first spike time of each participating neuron
    per_event = []
    for (a, b) in events:
        lo, hi = np.searchsorted(tt, a), np.searchsorted(tt, b)
        if hi - lo < 4:
            continue
        ev_i, ev_t = ii[lo:hi], tt[lo:hi]
        # spikes are time-sorted, so the first occurrence of each neuron is its first spike
        _, first_idx = np.unique(ev_i, return_index=True)
        rows = pos[ev_i[first_idx]]
        times = ev_t[first_idx]
        ok = rows >= 0
        if ok.sum() < 4:
            continue
        per_event.append((rows[ok], times[ok]))
    if not per_event:
        return {"rho_mean": None, "n_events_scored": 0, "p": None,
                "note": "no event had at least four ensemble members with distinct template ranks"}

    def score(ranks_of_member: np.ndarray) -> list[float]:
        out = []
        for rows, times in per_event:
            r = ranks_of_member[rows]
            if len(np.unique(r)) < 3:
                continue
            out.append(float(stats.spearmanr(times, r).statistic))
        return out

    rhos = score(order_rank)
    if not rhos:
        return {"rho_mean": None, "n_events_scored": 0, "p": None,
                "note": "no event had at least three distinct template ranks among its participating members"}
    obs = float(np.mean(np.abs(rhos)))
    null = []
    for _ in range(n_shuffle):
        v = score(rng.permutation(order_rank))
        if v:
            null.append(float(np.mean(np.abs(v))))
    p = float((np.array(null) >= obs).mean()) if null else None
    return {"rho_mean": float(np.mean(rhos)), "rho_abs_mean": obs, "n_events_scored": len(rhos), "p": p,
            "null_mean": (float(np.mean(null)) if null else None), "n_shuffle": len(null)}


def analyse_sleep_epoch(i: np.ndarray, t_step: np.ndarray, dt_s: float, kc: np.ndarray, t0: float, t1: float,
                        ensembles: dict[str, np.ndarray], bin_s: float = 0.1, n_random: int = 200, seed: int = 0,
                        order_rank: dict | None = None) -> dict:
    """Template correlation, co-activation and random-ensemble null for each named ensemble in one epoch."""
    rng = np.random.default_rng(seed)
    M = binned_matrix(i, t_step, dt_s, kc, t0, t1, bin_s)
    pos = np.full(int(kc.max()) + 2, -1, dtype=np.int64); pos[kc] = np.arange(len(kc))
    n_bins = M.shape[1]
    active_bins = int((M.sum(axis=0) > 0).sum())
    out = {"bin_s": bin_s, "n_bins": n_bins, "n_kc": int(len(kc)), "n_active_bins": active_bins,
           "kc_rate_hz": float(M.sum() / max(t1 - t0, 1e-9) / len(kc)), "ensembles": {}}
    for name, members_idx in ensembles.items():
        rows = pos[members_idx[members_idx < len(pos)]]
        rows = rows[rows >= 0]
        tmpl = np.zeros(len(kc), dtype=np.float64); tmpl[rows] = 1.0
        if rows.size == 0 or tmpl.sum() == 0:
            out["ensembles"][name] = {"size": 0, "note": "ensemble empty"}
            continue
        r = template_correlation(M, tmpl)
        finite = np.isfinite(r)
        # size-matched random ensembles drawn from the same KC population
        null_means, null_p95 = [], []
        for _ in range(n_random):
            pick = rng.choice(len(kc), size=int(tmpl.sum()), replace=False)
            t2 = np.zeros(len(kc)); t2[pick] = 1.0
            r2 = template_correlation(M, t2)
            f2 = np.isfinite(r2)
            if f2.any():
                null_means.append(float(np.mean(r2[f2]))); null_p95.append(float(np.percentile(r2[f2], 95)))
        nm = float(np.mean(null_means)) if null_means else float("nan")
        ns = float(np.std(null_means)) if len(null_means) > 1 else float("nan")
        thr = float(np.percentile(null_p95, 95)) if null_p95 else float("nan")
        ev_bins = np.flatnonzero(finite & (r > thr)) if np.isfinite(thr) else np.array([], dtype=int)
        events = [(t0 + b * bin_s, t0 + (b + 1) * bin_s) for b in ev_bins]
        co = coactivation(M, rows)
        co_null = []
        for _ in range(min(n_random, 100)):
            pick = rng.choice(len(kc), size=len(rows), replace=False)
            v = coactivation(M, pick)
            if np.isfinite(v):
                co_null.append(v)
        # Over-representation: what share of the offline Kenyon-cell spikes come from ensemble members, against
        # the share expected from the ensemble's size? A per-bin correlation is noisy when a bin holds one or two
        # spikes, which is the situation in a genuinely sparse offline state, whereas a share of total spikes is
        # stable at low counts. Reported alongside, never instead of, the template correlation.
        tot = float(M.sum())
        share_obs = float(M[rows].sum() / tot) if tot > 0 else None
        share_exp = float(len(rows) / len(kc))
        share_null = []
        for _ in range(min(n_random, 200)):
            pick = rng.choice(len(kc), size=len(rows), replace=False)
            if tot > 0:
                share_null.append(float(M[pick].sum() / tot))
        sn_mu = float(np.mean(share_null)) if share_null else None
        sn_sd = float(np.std(share_null)) if len(share_null) > 1 else None
        ent = {"size": int(tmpl.sum()),
               "spike_share_observed": share_obs, "spike_share_expected_from_size": share_exp,
               "spike_share_null_mean": sn_mu, "spike_share_null_sd": sn_sd,
               "spike_share_ratio": (share_obs / sn_mu if (share_obs is not None and sn_mu) else None),
               "spike_share_z": ((share_obs - sn_mu) / sn_sd if (share_obs is not None and sn_sd) else None),
               "n_spikes_total_kc": int(tot), "n_spikes_in_ensemble": int(M[rows].sum()), "template_corr_mean": (float(np.mean(r[finite])) if finite.any() else None),
               "template_corr_p95": (float(np.percentile(r[finite], 95)) if finite.any() else None),
               "template_corr_max": (float(np.max(r[finite])) if finite.any() else None),
               "null_corr_mean": nm, "null_corr_sd": ns, "threshold_corr": thr,
               "z_vs_random_ensembles": (float((np.mean(r[finite]) - nm) / ns) if finite.any() and np.isfinite(ns) and ns > 0 else None),
               "n_reactivation_events": int(len(ev_bins)), "event_rate_hz": float(len(ev_bins) / max(t1 - t0, 1e-9)),
               "coactivation": co, "coactivation_null_mean": (float(np.mean(co_null)) if co_null else None),
               "coactivation_z": (float((co - np.mean(co_null)) / np.std(co_null)) if len(co_null) > 2 and np.std(co_null) > 0 and np.isfinite(co) else None),
               "n_random_ensembles": len(null_means)}
        if order_rank is not None and name in order_rank and len(events):
            ent["sequence"] = sequence_score(i, t_step, dt_s, members_idx, order_rank[name], events[:200], seed=seed)
        out["ensembles"][name] = ent
    return out
