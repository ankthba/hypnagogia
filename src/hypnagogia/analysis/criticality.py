"""Criticality metrics for a population spike train.

Implements, per the pre-registered protocol in docs/literature_findings.md (criticality-methods):
  * branching ratio by the multistep-regression (MR) estimator of Wilting & Priesemann 2018
    (Nat Commun 9:2325): slopes r_k of a_{t+k} on a_t for k = 1..k_max, then fit r_k = b m^k (+ offset);
    tau = -dt/ln(m). Bootstrap CI by resampling contiguous segments.
  * naive one-step branching ratio sigma* = <a_{t+1}/a_t> over bins with a_t > 0 (Priesemann 2014).
  * avalanches (Beggs & Plenz 2003; Priesemann 2014): bin width = mean inter-event interval 1/(population
    rate); an avalanche is a maximal run of non-empty bins; size = spikes, duration = bins.
  * power-law fits with the `powerlaw` package (Alstott 2014; Clauset 2009): discrete MLE, xmin by KS
    minimisation, loglikelihood-ratio tests vs exponential, lognormal and truncated power law.
  * regime classification with explicit, pre-registered thresholds (see classify()).
"""
from __future__ import annotations

import warnings

import numpy as np


# ------------------------------------------------------------------------------------------------
def bin_counts(t_step: np.ndarray, dt_s: float, bin_s: float, t0_s: float, t1_s: float) -> np.ndarray:
    """Population spike counts per bin of width bin_s over [t0, t1)."""
    t = t_step.astype(np.float64) * dt_s
    m = (t >= t0_s) & (t < t1_s)
    n_bins = int(np.floor((t1_s - t0_s) / bin_s))
    idx = np.floor((t[m] - t0_s) / bin_s).astype(np.int64)
    idx = idx[idx < n_bins]
    return np.bincount(idx, minlength=n_bins)


def _rk(a: np.ndarray, k_max: int) -> np.ndarray:
    """Linear-regression slopes r_k of a[t+k] on a[t] (Wilting & Priesemann 2018, Eq. 15)."""
    a = a.astype(np.float64)
    r = np.empty(k_max)
    for k in range(1, k_max + 1):
        x, y = a[:-k], a[k:]
        vx = np.var(x)
        r[k - 1] = np.cov(x, y, bias=True)[0, 1] / vx if vx > 0 else np.nan
    return r


def _fit_exp_offset(k: np.ndarray, r: np.ndarray) -> tuple[float, float, float]:
    """Fit r_k = b * m**k + O by nonlinear least squares. Returns (m, b, O)."""
    from scipy.optimize import curve_fit
    ok = np.isfinite(r)
    if ok.sum() < 5:
        return np.nan, np.nan, np.nan
    kk, rr = k[ok], r[ok]
    best = None
    for m0 in (0.99, 0.9, 0.7, 0.5, 0.2):
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                p, _ = curve_fit(lambda x, b, m, o: b * m ** x + o, kk, rr, p0=(max(rr[0], 1e-6), m0, 0.0),
                                 bounds=([-np.inf, 0.0, -np.inf], [np.inf, 1.5, np.inf]), maxfev=20000)
            sse = float(np.sum((rr - (p[0] * p[1] ** kk + p[2])) ** 2))
            if best is None or sse < best[0]:
                best = (sse, p)
        except Exception:
            continue
    if best is None:
        return np.nan, np.nan, np.nan
    b, m, o = best[1]
    return float(m), float(b), float(o)


def mr_estimator(a: np.ndarray, bin_s: float, k_max: int, n_boot: int = 200, n_segments: int = 20, seed: int = 0) -> dict:
    """MR branching ratio with segment-bootstrap 95% CI.

    a: population counts per bin (single stationary series). k_max in bins.
    """
    a = np.asarray(a, dtype=np.float64)
    k = np.arange(1, k_max + 1, dtype=np.float64)
    if len(a) < 5 * k_max or a.sum() == 0 or np.var(a) == 0:
        return {"m": None, "tau_s": None, "ci95": [None, None], "b": None, "offset": None, "k_max": k_max, "bin_s": bin_s,
                "r_k": [], "n_bins": int(len(a)), "note": "series too short or constant"}
    r = _rk(a, k_max)
    m, b, o = _fit_exp_offset(k, r)
    note = ""
    # degenerate (input-driven) case: no autocorrelation to fit -> the exp fit is ill-posed; report m = r_1 (~0)
    if not np.isfinite(r[0]) or r[0] < 0.05 or not np.isfinite(m) or (np.isfinite(b) and abs(b) < 1e-3):
        m, b, o = float(max(r[0], 0.0)) if np.isfinite(r[0]) else np.nan, np.nan, np.nan
        note = "r_1 < 0.05: no measurable propagation; m set to r_1 (input-driven regime)"
    rng = np.random.default_rng(seed)
    seg_len = len(a) // n_segments
    segs = [a[i * seg_len:(i + 1) * seg_len] for i in range(n_segments)]
    boots = []
    for _ in range(n_boot):
        pick = rng.integers(0, n_segments, n_segments)
        ab = np.concatenate([segs[p] for p in pick])
        if np.var(ab) == 0:
            continue
        rb = _rk(ab, k_max)
        if note:
            mb = float(max(rb[0], 0.0)) if np.isfinite(rb[0]) else np.nan
        else:
            mb, _, _ = _fit_exp_offset(k, rb)
        if np.isfinite(mb):
            boots.append(mb)
    ci = [float(np.percentile(boots, 2.5)), float(np.percentile(boots, 97.5))] if len(boots) >= 20 else [None, None]
    tau = float(-bin_s / np.log(m)) if (m is not None and 0 < m < 1) else None
    return {"m": (float(m) if np.isfinite(m) else None), "tau_s": tau, "ci95": ci, "b": (float(b) if np.isfinite(b) else None),
            "offset": (float(o) if np.isfinite(o) else None), "k_max": k_max, "bin_s": bin_s,
            "r_k": [float(x) if np.isfinite(x) else None for x in r], "n_bins": int(len(a)), "n_boot_ok": int(len(boots)), "note": note}


def naive_branching(a: np.ndarray) -> float | None:
    a = np.asarray(a, dtype=np.float64)
    ok = a[:-1] > 0
    return float(np.mean(a[1:][ok] / a[:-1][ok])) if ok.any() else None


# ------------------------------------------------------------------------------------------------
def avalanches(a: np.ndarray) -> tuple[np.ndarray, np.ndarray, dict]:
    """Sizes and durations of maximal runs of non-empty bins."""
    a = np.asarray(a)
    active = a > 0
    if not active.any():
        return np.array([], dtype=np.int64), np.array([], dtype=np.int64), {"n": 0, "frac_time_active": 0.0}
    d = np.diff(np.concatenate([[0], active.astype(np.int8), [0]]))
    starts, ends = np.flatnonzero(d == 1), np.flatnonzero(d == -1)
    sizes = np.array([a[s:e].sum() for s, e in zip(starts, ends)], dtype=np.int64)
    durs = (ends - starts).astype(np.int64)
    return sizes, durs, {"n": int(len(sizes)), "frac_time_active": float(active.mean()), "max_size": int(sizes.max()),
                         "max_duration": int(durs.max()), "mean_size": float(sizes.mean())}


def fit_powerlaw(data: np.ndarray, discrete: bool = True, xmin: int | None = None, xmax: int | None = None, min_n: int = 50) -> dict:
    """powerlaw.Fit with LLR comparisons. R > 0 favours the power law; p < 0.05 makes the sign reliable."""
    import powerlaw
    data = np.asarray(data)
    out = {"n": int(len(data)), "alpha": None, "xmin": None, "xmax": xmax, "sigma": None, "n_tail": 0,
           "R_vs_exponential": None, "p_vs_exponential": None, "R_vs_lognormal": None, "p_vs_lognormal": None,
           "R_vs_truncated_power_law": None, "p_vs_truncated_power_law": None, "truncated_lambda": None, "note": ""}
    if len(data) < min_n or len(np.unique(data)) < 5:
        out["note"] = f"fewer than {min_n} avalanches or <5 distinct values: no fit"
        return out
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            f = powerlaw.Fit(data, discrete=discrete, xmin=xmin, xmax=xmax, verbose=False)
            out.update(alpha=float(f.power_law.alpha), xmin=float(f.power_law.xmin), sigma=float(f.power_law.sigma),
                       n_tail=int((data >= f.power_law.xmin).sum()))
            for name, key in (("exponential", "exponential"), ("lognormal", "lognormal"), ("truncated_power_law", "truncated_power_law")):
                try:
                    R, p = f.distribution_compare("power_law", name, normalized_ratio=True)
                    out[f"R_vs_{key}"] = float(R) if np.isfinite(R) else None
                    out[f"p_vs_{key}"] = float(p) if np.isfinite(p) else None
                except Exception as e:  # pragma: no cover
                    out["note"] += f"{name}: {e}; "
            try:
                out["truncated_lambda"] = float(f.truncated_power_law.parameter2)
            except Exception:
                pass
    except Exception as e:
        out["note"] = f"fit failed: {e}"
    return out


def ccdf(data: np.ndarray, n_points: int = 60) -> dict:
    data = np.asarray(data)
    if len(data) == 0:
        return {"x": [], "y": []}
    xs = np.unique(data)
    if len(xs) > n_points:
        xs = np.unique(np.round(np.logspace(np.log10(xs.min()), np.log10(xs.max()), n_points)).astype(np.int64))
    y = [float((data >= x).mean()) for x in xs]
    return {"x": [int(x) for x in xs], "y": y}


# ------------------------------------------------------------------------------------------------
CRITERIA = {
    "silent": "population mean rate < 0.01 Hz per neuron, or fewer than 50 avalanches, or fraction of neurons active < 1%",
    "saturated": "MR branching ratio m > 1.05 (supercritical), or activity never pauses (fraction of avalanche bins active > 0.95), or mean rate > 30 Hz per neuron",
    "critical": "0.9 <= m <= 1.1 AND size distribution: power law favoured over exponential (R > 0, p < 0.05) AND not significantly worse than lognormal (not (R < 0 and p < 0.05)) AND size exponent alpha in [1.2, 2.2]",
    "subcritical": "everything else that is active (typically 0 < m < 0.9: input-driven or reverberating regime)",
    "sources": "regime bands after Zierenberg, Wilting & Priesemann 2018 PRX (m <= 0.5 input-driven, 0.5 < m < 1 reverberating, m = 1 critical, m > 1 bursting); fit protocol Clauset 2009 / Alstott 2014; thresholds are this pipeline's operational choices (no published fixed cutoffs exist)",
}


def classify(pop_rate_hz: float, frac_active: float, mr: dict, aval_stats: dict, size_fit: dict) -> tuple[str, list[str]]:
    reasons = []
    m = mr.get("m")
    if pop_rate_hz < 0.01 or aval_stats.get("n", 0) < 50 or frac_active < 0.01:
        reasons.append(f"rate {pop_rate_hz:.4f} Hz/neuron, {aval_stats.get('n', 0)} avalanches, {frac_active:.1%} neurons active")
        return "silent", reasons
    if (m is not None and m > 1.05) or aval_stats.get("frac_time_active", 0) > 0.95 or pop_rate_hz > 30:
        reasons.append(f"m={m}, frac_time_active={aval_stats.get('frac_time_active'):.2f}, rate={pop_rate_hz:.2f} Hz/neuron")
        return "saturated", reasons
    if m is None:
        reasons.append("branching ratio undefined")
        return "subcritical", reasons
    pl_ok = (size_fit.get("R_vs_exponential") or 0) > 0 and (size_fit.get("p_vs_exponential") or 1) < 0.05
    ln_ok = not ((size_fit.get("R_vs_lognormal") or 0) < 0 and (size_fit.get("p_vs_lognormal") or 1) < 0.05)
    alpha = size_fit.get("alpha")
    alpha_ok = alpha is not None and 1.2 <= alpha <= 2.2
    reasons.append(f"m={m:.3f} (CI {mr.get('ci95')}), PL>exp: {pl_ok} (R={size_fit.get('R_vs_exponential')}, p={size_fit.get('p_vs_exponential')}), "
                   f"PL not < lognormal: {ln_ok} (R={size_fit.get('R_vs_lognormal')}, p={size_fit.get('p_vs_lognormal')}), alpha={alpha}")
    if 0.9 <= m <= 1.1 and pl_ok and ln_ok and alpha_ok:
        return "critical", reasons
    return "subcritical", reasons


def analyse_population(t_step: np.ndarray, n_neurons: int, dt_s: float, t0_s: float, t1_s: float,
                       mr_bin_s: float = 0.002, mr_kmax_s: float = 0.5, aval_bin_mult: float = 1.0, seed: int = 0,
                       i: np.ndarray | None = None) -> dict:
    """Full criticality analysis of one recording window."""
    dur = t1_s - t0_s
    t = t_step.astype(np.float64) * dt_s
    m = (t >= t0_s) & (t < t1_s)
    n_spikes = int(m.sum())
    pop_rate = n_spikes / dur / n_neurons
    frac_active = float(len(np.unique(i[m])) / n_neurons) if i is not None else None
    # branching ratio on fixed 2 ms bins
    a_mr = bin_counts(t_step, dt_s, mr_bin_s, t0_s, t1_s)
    mr = mr_estimator(a_mr, mr_bin_s, int(round(mr_kmax_s / mr_bin_s)), seed=seed)
    naive = naive_branching(a_mr)
    # avalanches at <IEI> bins
    iei = dur / max(n_spikes, 1)
    aval_bin = max(iei * aval_bin_mult, dt_s)
    a_av = bin_counts(t_step, dt_s, aval_bin, t0_s, t1_s)
    sizes, durs, st = avalanches(a_av)
    size_fit = fit_powerlaw(sizes) if len(sizes) else fit_powerlaw(np.array([]))
    dur_fit = fit_powerlaw(durs) if len(durs) else fit_powerlaw(np.array([]))
    label, reasons = classify(pop_rate, frac_active if frac_active is not None else 1.0, mr, st, size_fit)
    return {"n_spikes": n_spikes, "duration_s": dur, "pop_rate_hz": float(pop_rate), "frac_active": frac_active,
            "branching_ratio_mr": {k: v for k, v in mr.items() if k != "r_k"}, "r_k": mr.get("r_k", []),
            "branching_ratio_naive": naive,
            "avalanches": {"bin_ms": aval_bin * 1e3, "bin_mult": aval_bin_mult, **st},
            "size_fit": size_fit, "duration_fit": dur_fit, "size_ccdf": ccdf(sizes), "duration_ccdf": ccdf(durs),
            "classification": label, "reasons": reasons}
