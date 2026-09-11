"""Validate male-CNS target populations against their FlyWire v783 counterparts.

Uses the NBLAST cross-matching tables shipped with the male CNS release
(gs://flyem-male-cns/v1.0/nblasts/matches_{mcns_v1.0_flywire783,flywire783_mcns_v1.0}.feather: top-5
morphological matches in each direction, min(forward, reverse) NBLAST score; male CNS neurons were
truncated to the brain (z < 281 um) for this NBLAST) and the type-level `flywireType` column of the
male CNS annotations.

For each population we report: counts in both datasets, the fraction of male-CNS members whose best
FlyWire match falls inside the FlyWire population, the same in reverse, type-name agreement, and an
'ambiguous' flag when either direction agrees < 80% or the counts differ by > 40%.  Ambiguous
populations are reported, not silently used.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from .connectome import Connectome, MALECNS_DIR, MALECNS_FILES
from .populations import POPULATIONS


def load_matches(direction: str = "mcns_to_fw") -> pd.DataFrame:
    import pyarrow.feather as pf
    key = "matches_mcns_to_fw" if direction == "mcns_to_fw" else "matches_fw_to_mcns"
    return pf.read_feather(MALECNS_DIR / MALECNS_FILES[key]).set_index("id")


def _best_in_target(m: pd.DataFrame, src_ids: np.ndarray, target_ids: set, k_max: int = 5) -> pd.DataFrame:
    """For each source id: best match id, its score, and the rank (1..k_max) of the first candidate inside the
    target set (NaN if none). Vectorised and int64-safe (never let ids pass through float64)."""
    sub = m.reindex(np.asarray(src_ids, dtype=np.int64))
    tgt = np.fromiter(target_ids, dtype=np.int64) if target_ids else np.array([], dtype=np.int64)
    has = sub["match_1"].notna().to_numpy()
    rank = np.full(len(sub), np.nan)
    for k in range(k_max, 0, -1):
        col = sub[f"match_{k}"]
        ok = col.notna().to_numpy()
        vals = np.zeros(len(sub), dtype=np.int64); vals[ok] = col[ok].to_numpy(dtype=np.int64)
        hit = ok & np.isin(vals, tgt)
        rank[hit] = k
    best = np.full(len(sub), -1, dtype=np.int64); best[has] = sub["match_1"][has].to_numpy(dtype=np.int64)
    return pd.DataFrame({"best": np.where(has, best, np.nan), "best_int": best, "score": sub["score_1"].to_numpy(dtype=float),
                         "rank_in_target": rank}, index=sub.index)


def population_report(conn_m: Connectome, conn_f: Connectome, names: list[str] | None = None, min_agree: float = 0.8) -> dict:
    m2f = load_matches("mcns_to_fw"); f2m = load_matches("fw_to_mcns")
    fw_ids = pd.Index(conn_f.ids); m_ids = pd.Index(conn_m.ids)
    out = []
    for name in names or list(POPULATIONS):
        p = POPULATIONS[name]
        mi = conn_m.select(**p["selector"]); fi = conn_f.select(**p["flywire_selector"])
        m_set = set(conn_m.ids[mi].tolist()); f_set = set(conn_f.ids[fi].tolist())
        fwd = _best_in_target(m2f, conn_m.ids[mi], f_set)
        rev = _best_in_target(f2m, conn_f.ids[fi], m_set)
        fwd_has = fwd["best"].notna(); rev_has = rev["best"].notna()
        fwd_top1 = float((fwd["rank_in_target"] == 1).sum() / max(1, fwd_has.sum()))
        fwd_top5 = float(fwd["rank_in_target"].notna().sum() / max(1, fwd_has.sum()))
        rev_top1 = float((rev["rank_in_target"] == 1).sum() / max(1, rev_has.sum()))
        rev_top5 = float(rev["rank_in_target"].notna().sum() / max(1, rev_has.sum()))
        # FlyWire cell types of the best matches of male members (what does the male population look like in FlyWire?)
        bi = fwd["best_int"].to_numpy(); bi = bi[bi >= 0]
        best_fw_types = conn_f.ann["cell_type"].astype("string").reindex(fw_ids.get_indexer(bi))
        fw_type_counts = best_fw_types.fillna("NA").value_counts().head(8).to_dict()
        # type-name agreement via the male annotations' flywireType column
        ft = conn_m.ann["flywire_type"].astype("string").iloc[mi]
        fw_types_in_pop = set(conn_f.ann["cell_type"].astype("string").iloc[fi].dropna().tolist())
        type_agree = float(ft.isin(fw_types_in_pop).sum() / max(1, len(ft)))
        count_ratio = len(mi) / max(1, len(fi))
        ambiguous = (fwd_top1 < min_agree) or (rev_top1 < min_agree) or not (0.6 <= count_ratio <= 1.4)
        reasons = []
        if fwd_top1 < min_agree: reasons.append(f"only {fwd_top1:.0%} of male-CNS members have their best NBLAST match inside the FlyWire population")
        if rev_top1 < min_agree: reasons.append(f"only {rev_top1:.0%} of FlyWire members have their best NBLAST match inside the male-CNS population")
        if not (0.6 <= count_ratio <= 1.4): reasons.append(f"count ratio male/FlyWire = {count_ratio:.2f}")
        out.append({"population": name, "source": p["source"], "male_selector": p["selector"], "flywire_selector": p["flywire_selector"],
                    "n_male": int(len(mi)), "n_flywire": int(len(fi)), "count_ratio": round(count_ratio, 3),
                    "n_male_with_match_row": int(fwd_has.sum()), "n_flywire_with_match_row": int(rev_has.sum()),
                    "male_to_flywire_top1_in_pop": round(fwd_top1, 3), "male_to_flywire_top5_in_pop": round(fwd_top5, 3),
                    "flywire_to_male_top1_in_pop": round(rev_top1, 3), "flywire_to_male_top5_in_pop": round(rev_top5, 3),
                    "median_nblast_score_male_to_flywire": (round(float(fwd["score"].median()), 3) if fwd_has.any() else None),
                    "flywireType_column_agreement": round(type_agree, 3),
                    "flywire_types_of_best_matches": {str(k): int(v) for k, v in fw_type_counts.items()},
                    "male_types": {str(k): int(v) for k, v in conn_m.ann["cell_type"].astype("string").iloc[mi].fillna("NA").value_counts().head(12).items()},
                    "ambiguous": bool(ambiguous), "reasons": reasons})
    return {"method": __doc__.strip(), "min_agree": min_agree, "populations": out,
            "n_ambiguous": int(sum(o["ambiguous"] for o in out))}


def match_ids(fw_root_ids, conn_m: Connectome, restrict_selector: dict | None = None, one_to_one: bool = True) -> pd.DataFrame:
    """Map explicit FlyWire root ids to male-CNS bodies via the top-5 NBLAST candidates, optionally restricted to a
    male population, with a greedy one-to-one assignment by score (highest score first). Returns int64 columns;
    unmatched FlyWire ids are in .attrs['unmatched']."""
    f2m = load_matches("fw_to_mcns")
    allowed = set(conn_m.ids[conn_m.select(**restrict_selector)].tolist()) if restrict_selector else set(conn_m.ids.tolist())
    cands = []
    for rid in [int(x) for x in fw_root_ids]:
        if rid not in f2m.index:
            continue
        for k in range(1, 6):
            mid = f2m.at[rid, f"match_{k}"]
            if pd.notna(mid) and int(mid) in allowed:
                cands.append((rid, int(mid), float(f2m.at[rid, f"score_{k}"]), k))
    c = pd.DataFrame(cands, columns=["flywire_id", "male_body", "score", "rank"]).sort_values("score", ascending=False)
    if not one_to_one:
        return c
    used_f, used_m, rows = set(), set(), []
    for t in c.itertuples(index=False):
        if t.flywire_id in used_f or t.male_body in used_m:
            continue
        used_f.add(t.flywire_id); used_m.add(t.male_body); rows.append(t)
    res = pd.DataFrame(rows, columns=["flywire_id", "male_body", "score", "rank"]).astype({"flywire_id": np.int64, "male_body": np.int64})
    res.attrs["unmatched"] = [int(x) for x in fw_root_ids if int(x) not in used_f]
    return res
