"""Null-model helpers (numba-accelerated degree-preserving rewiring)."""
from __future__ import annotations

import numpy as np
from numba import njit, types
from numba.typed import Dict


@njit(cache=True)
def _rewire(pre, post, edges, n_attempts, seed):
    np.random.seed(seed)
    n = len(edges)
    N = np.int64(max(pre.max(), post.max()) + 1)
    existing = Dict.empty(key_type=types.int64, value_type=types.int8)
    for k in range(n):
        e = edges[k]
        existing[np.int64(pre[e]) * N + np.int64(post[e])] = np.int8(1)
    n_ok = 0
    for _ in range(n_attempts):
        e1 = edges[np.random.randint(0, n)]
        e2 = edges[np.random.randint(0, n)]
        a, b = np.int64(pre[e1]), np.int64(post[e1])
        c, d = np.int64(pre[e2]), np.int64(post[e2])
        if e1 == e2 or b == d or a == d or c == b:
            continue
        k1 = a * N + d
        k2 = c * N + b
        if k1 in existing or k2 in existing:
            continue
        del existing[a * N + b]
        del existing[c * N + d]
        existing[k1] = np.int8(1)
        existing[k2] = np.int8(1)
        post[e1] = d
        post[e2] = b
        n_ok += 1
    return n_ok


def maslov_sneppen_rewire(pre: np.ndarray, post: np.ndarray, edges: np.ndarray, n_attempts: int, seed: int) -> int:
    """In-place swap of postsynaptic targets among `edges` (indices into pre/post).
    Rejects self-loops and duplicate pairs. Returns number of successful swaps."""
    return int(_rewire(pre.astype(np.int64), post, edges.astype(np.int64), int(n_attempts), int(seed)))
