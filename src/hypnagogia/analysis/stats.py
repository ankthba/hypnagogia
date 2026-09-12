"""Effect sizes and confidence intervals (bootstrap, no distributional assumptions beyond exchangeability)."""
from __future__ import annotations

import numpy as np
from scipy import stats


def hedges_g(x: np.ndarray, y: np.ndarray, paired: bool = True) -> float:
    x, y = np.asarray(x, float), np.asarray(y, float)
    if paired:
        d = x - y
        g = d.mean() / d.std(ddof=1) if d.std(ddof=1) > 0 else 0.0
        n = len(d)
    else:
        nx, ny = len(x), len(y)
        sp = np.sqrt(((nx - 1) * x.var(ddof=1) + (ny - 1) * y.var(ddof=1)) / max(nx + ny - 2, 1))
        g = (x.mean() - y.mean()) / sp if sp > 0 else 0.0
        n = nx + ny
    J = 1 - 3 / (4 * (n - 1) - 1) if n > 2 else 1.0     # Hedges' small-sample correction
    return float(g * J)


def _boot_ci(fn, n: int, rng, n_boot: int, *arrays) -> list:
    vals = []
    for _ in range(n_boot):
        idx = rng.integers(0, n, n)
        vals.append(fn(*[a[idx] for a in arrays]))
    return [float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5))]


def paired_effect(x: np.ndarray, y: np.ndarray, name: str = "", n_boot: int = 10000, seed: int = 0) -> dict:
    """Paired comparison of x vs y (same seeds). Returns mean difference with bootstrap CI, Hedges' g with CI,
    the Wilcoxon signed-rank p, and a paired-permutation p (sign flips)."""
    x, y = np.asarray(x, float), np.asarray(y, float)
    d = x - y; n = len(d)
    rng = np.random.default_rng(seed)
    ci = _boot_ci(lambda a: float(a.mean()), n, rng, n_boot, d)
    gci = _boot_ci(lambda a, b: hedges_g(a, b, paired=True), n, rng, min(n_boot, 2000), x, y)
    try:
        p_w = float(stats.wilcoxon(x, y).pvalue) if n >= 6 and np.any(d != 0) else None
    except Exception:
        p_w = None
    flips = rng.choice([-1.0, 1.0], size=(min(n_boot, 20000), n))
    null = (flips * d).mean(axis=1)
    p_perm = float((np.abs(null) >= abs(d.mean())).mean())
    return {"name": name, "x_mean": float(x.mean()), "y_mean": float(y.mean()), "diff": float(d.mean()),
            "ci95": ci, "hedges_g": hedges_g(x, y, paired=True), "g_ci95": gci,
            "p_wilcoxon": p_w, "p_permutation": p_perm, "n": int(n)}


def unpaired_effect(x: np.ndarray, y: np.ndarray, name: str = "", n_boot: int = 10000, seed: int = 0) -> dict:
    x, y = np.asarray(x, float), np.asarray(y, float)
    rng = np.random.default_rng(seed)
    vals = [float(x[rng.integers(0, len(x), len(x))].mean() - y[rng.integers(0, len(y), len(y))].mean()) for _ in range(n_boot)]
    ci = [float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5))]
    gv = [hedges_g(x[rng.integers(0, len(x), len(x))], y[rng.integers(0, len(y), len(y))], paired=False) for _ in range(min(n_boot, 2000))]
    try:
        p_m = float(stats.mannwhitneyu(x, y).pvalue)
    except Exception:
        p_m = None
    pooled = np.concatenate([x, y]); obs = abs(x.mean() - y.mean()); nx = len(x)
    null = []
    for _ in range(min(n_boot, 20000)):
        pp = rng.permutation(pooled); null.append(abs(pp[:nx].mean() - pp[nx:].mean()))
    return {"name": name, "x_mean": float(x.mean()), "y_mean": float(y.mean()), "diff": float(x.mean() - y.mean()),
            "ci95": ci, "hedges_g": hedges_g(x, y, paired=False), "g_ci95": [float(np.percentile(gv, 2.5)), float(np.percentile(gv, 97.5))],
            "p_mannwhitney": p_m, "p_permutation": float((np.array(null) >= obs).mean()), "n": int(len(x) + len(y)), "n_x": int(len(x)), "n_y": int(len(y))}
