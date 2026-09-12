"""Anatomical atlas of the simulated neurons, for the viewer's brain map.

Soma positions come from the male CNS v1.0 annotation table (`somaLocation`, voxel coordinates at 8 nm
isotropic; converted to micrometres). Neurons without a soma position (mostly sensory afferents whose soma
lies outside the imaged volume) are omitted from the map and counted in the sidecar, never silently dropped.

Exported as a compact binary so the browser can draw ~10^5 points: positions are quantised to uint16 over the
bounding box given in the JSON sidecar, plus one uint8 group code per neuron.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

from .connectome import Connectome, MALECNS_DIR, MALECNS_FILES

VOXEL_NM = 8.0

# group code -> (label, selector). The code is the value written into the binary's `group` column and
# the code the sidecar's groups[] publishes; it is NOT the precedence. Precedence is PAINT_ORDER below,
# because several selectors overlap (every dFB neuron is also cell_class CX). 0 is the fallback.
GROUPS = [
    ("other", None),
    ("KC", {"cell_class": "Kenyon_Cell"}),
    ("MBON", {"cell_class": "MBON"}),
    ("DAN", {"cell_class": "DAN"}),
    ("dFB", {"cell_type": {"regex": r"^(FB6A(_[abc])?|FB6C(_[ab])?|FB6E|FB6G|FB6I|FB6Z|FB7A|FB7K)$"}}),
    ("ORN", {"cell_type": {"regex": r"^ORN_"}}),
    ("ALPN", {"cell_class": "ALPN"}),
    ("CX", {"cell_class": "CX"}),
    ("optic", {"super_class": ["ol_intrinsic", "ol_sensory", "visual_projection", "visual_centrifugal"]}),
]


def soma_positions(conn: Connectome) -> tuple[np.ndarray, np.ndarray]:
    """[N, 3] soma positions in micrometres (NaN where unknown), aligned to the simulation index."""
    import pyarrow.feather as pf
    a = pf.read_feather(MALECNS_DIR / MALECNS_FILES["annotations"], columns=["bodyId", "somaLocation"])
    a = a.drop_duplicates("bodyId").set_index("bodyId").reindex(conn.ids)
    pos = np.full((conn.N, 3), np.nan, dtype=np.float64)
    for k, v in enumerate(a["somaLocation"].to_numpy()):
        if v is not None and not isinstance(v, float) and len(v) == 3:
            pos[k] = v
    return pos * VOXEL_NM / 1000.0, np.isfinite(pos[:, 0])


# Broad groups are painted first and specific ones last, so a neuron that belongs to several (a dFB tangential
# neuron is also a central-complex neuron) ends up labelled with the most specific group.
PAINT_ORDER = ["optic", "CX", "ALPN", "ORN", "DAN", "MBON", "KC", "dFB"]


def group_codes(conn: Connectome) -> np.ndarray:
    """One group code per neuron: the LAST group in PAINT_ORDER that matches, i.e. the most specific.

    Assigning in code order instead would let the broad selectors overwrite the narrow ones they contain
    (dFB is a subset of cell_class CX, so every dFB neuron would be relabelled CX and the sidecar would
    report dFB: 0 for a population that is present).
    """
    by_name = {name: (code, sel) for code, (name, sel) in enumerate(GROUPS)}
    unordered = [n for n, (_c, sel) in by_name.items() if sel is not None and n not in PAINT_ORDER]
    if unordered:
        raise ValueError(f"groups {unordered} have a selector but no place in PAINT_ORDER, so their precedence "
                         f"against the others is undefined; add them to PAINT_ORDER")
    g = np.zeros(conn.N, dtype=np.uint8)
    for name in PAINT_ORDER:
        code, sel = by_name[name]
        if sel is not None:
            g[conn.select(**sel)] = code
    return g


def atlas_fingerprint(atlas_index: np.ndarray) -> str:
    """Identity of one atlas row numbering: sha256 over the exact bytes of neuron_atlas_index.bin.

    Any change to the filtering, the scope or max_neurons permutes the rows while leaving every row number
    in range, so a spike file that indexes those rows must carry this for the viewer to be able to tell a
    stale pairing from a current one.
    """
    return "sha256:" + hashlib.sha256(np.asarray(atlas_index, dtype=np.uint32).tobytes()).hexdigest()


def build_atlas(conn: Connectome, out_dir: Path, max_neurons: int | None = None, seed: int = 0) -> dict:
    """Write neuron_atlas.bin + neuron_atlas.json. Returns the sidecar dict."""
    out_dir.mkdir(parents=True, exist_ok=True)
    pos_um, has = soma_positions(conn)
    grp = group_codes(conn)
    idx = np.flatnonzero(has)
    n_with_soma = int(len(idx))
    n_missing = int((~has).sum())
    missing_by_group = {GROUPS[c][0]: int(((~has) & (grp == c)).sum()) for c in range(len(GROUPS))}
    if max_neurons and len(idx) > max_neurons:
        rng = np.random.default_rng(seed)
        # keep every neuron of the named groups, subsample only the 'other'/'optic' background
        named = idx[(grp[idx] != 0) & (np.array([GROUPS[c][0] for c in grp[idx]]) != "optic")]
        rest = np.setdiff1d(idx, named)
        take = max(max_neurons - len(named), 0)
        idx = np.sort(np.concatenate([named, rng.choice(rest, size=min(take, len(rest)), replace=False)]))
    P = pos_um[idx]
    lo, hi = P.min(axis=0), P.max(axis=0)
    q = np.clip(np.round((P - lo) / np.maximum(hi - lo, 1e-9) * 65535.0), 0, 65535).astype(np.uint16)
    buf = np.concatenate([q, grp[idx].astype(np.uint16)[:, None]], axis=1)     # [n, 4] uint16: x, y, z, group
    buf.tofile(out_dir / "neuron_atlas.bin")
    side = {
        "bin": "neuron_atlas.bin", "dtype": "uint16", "shape": [int(len(idx)), 4],
        "columns": ["x_q", "y_q", "z_q", "group"],
        "quantisation": {"lo_um": [float(x) for x in lo], "hi_um": [float(x) for x in hi], "scale": 65535,
                         "formula": "um = lo + q / 65535 * (hi - lo)"},
        "axes": {"x": "medial-lateral (image x)", "y": "dorsal-ventral (image y)", "z": "anterior-posterior (image z)",
                 "note": "male CNS v1.0 image coordinates, 8 nm voxels, converted to micrometres; not registered to a standard template"},
        "groups": [{"code": c, "label": GROUPS[c][0]} for c in range(len(GROUPS))],
        "group_counts": {GROUPS[c][0]: int((grp[idx] == c).sum()) for c in range(len(GROUPS))},
        "n_neurons_in_map": int(len(idx)), "n_neurons_simulated": int(conn.N),
        "n_without_soma_position": n_missing, "n_without_soma_position_by_group": missing_by_group,
        "soma_outside_brain_note": ("Ascending neurons are part of the brain-scope network because they carry input into the "
                                    "brain, but their somata sit in the ventral nerve cord, so they appear below the brain in the "
                                    "map. Olfactory receptor neurons have no soma in the volume at all and are absent from the map "
                                    "while still being simulated."),
        # true only when rows were actually dropped: the test that ran is on the neurons that HAVE a soma
        # position, not on every simulated neuron
        "subsampled": bool(max_neurons and n_with_soma > max_neurons),
        "n_with_soma_position": n_with_soma,
        "source": "male CNS v1.0 body-annotations somaLocation (8 nm voxels)",
        "row_to_sim_index": "see neuron_atlas_index.bin (uint32, one simulation index per atlas row)",
        "atlas_fingerprint": atlas_fingerprint(idx),
        "n_atlas_rows": int(len(idx)),
    }
    idx.astype(np.uint32).tofile(out_dir / "neuron_atlas_index.bin")
    json.dump(side, open(out_dir / "neuron_atlas.json", "w"), indent=1)
    return side


def export_activity(i: np.ndarray, t_step: np.ndarray, dt_s: float, atlas_index: np.ndarray, t0: float, t1: float,
                    out_dir: Path, name: str, max_spikes: int = 400000, seed: int = 0) -> dict:
    """Spikes of the mapped neurons over [t0, t1), as (t_ms uint32, atlas_row uint32), downsampled if needed."""
    out_dir.mkdir(parents=True, exist_ok=True)
    row = np.full(int(atlas_index.max()) + 2, -1, dtype=np.int64)
    row[atlas_index] = np.arange(len(atlas_index))
    t = t_step.astype(np.float64) * dt_s
    m = (t >= t0) & (t < t1) & (i < len(row))
    ii, tt = i[m], t[m]
    r = row[ii]
    ok = r >= 0
    ii, tt, r = ii[ok], tt[ok], r[ok]
    n_total = int(len(r))
    if n_total > max_spikes:
        rng = np.random.default_rng(seed)
        pick = np.sort(rng.choice(n_total, max_spikes, replace=False))
        tt, r = tt[pick], r[pick]
    arr = np.stack([np.round((tt - t0) * 1000).astype(np.uint32), r.astype(np.uint32)], axis=1)
    arr = arr[np.argsort(arr[:, 0])]
    arr.tofile(out_dir / f"{name}.bin")
    side = {"bin": f"{name}.bin", "dtype": "uint32", "shape": [int(len(arr)), 2], "columns": ["t_ms", "atlas_row"],
            # identity of the atlas whose rows these atlas_row values index: the viewer refuses to animate a
            # spike file whose fingerprint or row count disagrees with the neuron_atlas.bin it has loaded
            "n_atlas_rows": int(len(atlas_index)), "atlas_fingerprint": atlas_fingerprint(atlas_index),
            "duration_s": float(t1 - t0), "n_spikes_total": n_total, "n_spikes_exported": int(len(arr)),
            "downsampled": bool(n_total > max_spikes),
            "downsample_note": (f"{n_total} spikes fell in the window; a uniform random sample of {max_spikes} is shown"
                                if n_total > max_spikes else "all spikes in the window are shown")}
    json.dump(side, open(out_dir / f"{name}.json", "w"), indent=1)
    return side
