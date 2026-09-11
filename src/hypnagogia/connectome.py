"""Connectome loading, on-disk caching, cell-type selection, subsetting and null models.

Data flow
---------
raw (data/raw, fetched by scripts/fetch_data.py)
  Completeness_<v>.csv       : ordered list of FlyWire root IDs = simulation index (Shiu et al. 2024)
  Connectivity_<v>.parquet   : one row per (pre, post) pair: synapse count and sign (+1 / -1 from the
                               presynaptic neuron's predicted neurotransmitter; Shiu et al. 2024)
  Supplemental_file1_neuron_annotations.tsv : Schlegel et al. 2024 hierarchical annotations (v783 IDs)
cache (data/cache)
  connectome_v<v>.npz        : int32 edge arrays + int64 root ids  (never re-parse the parquet per run)
  annotations_v<v>.parquet   : annotations aligned to the simulation index
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
import scipy.sparse as sp

from . import DATA_CACHE, DATA_RAW

RAW_FILES = {
    "783": ("Completeness_783.csv", "Connectivity_783.parquet"),
    "630": ("2023_03_23_completeness_630_final.csv", "2023_03_23_connectivity_630_final.parquet"),
}
ANNOTATION_FILE = "Supplemental_file1_neuron_annotations.tsv"
ANN_COLS = ["super_class", "cell_class", "cell_sub_class", "cell_type", "hemibrain_type",
            "side", "top_nt", "top_nt_conf", "flow", "nerve", "ito_lee_hemilineage"]


@dataclass
class Connectome:
    root_ids: np.ndarray            # int64 [N]  simulation index -> FlyWire root id
    pre: np.ndarray                 # int32 [E]  presynaptic simulation index
    post: np.ndarray                # int32 [E]  postsynaptic simulation index
    count: np.ndarray               # int32 [E]  synapse count of the pair
    sign: np.ndarray                # int8  [E]  +1 excitatory / -1 inhibitory (from predicted NT of pre)
    ann: pd.DataFrame               # [N] annotations aligned to simulation index (may be all-NaN for v630)
    version: str = "783"
    name: str = "full"
    provenance: dict = field(default_factory=dict)
    filtering_steps: list = field(default_factory=list)

    # ---- basic properties -------------------------------------------------------
    @property
    def N(self) -> int:
        return int(len(self.root_ids))

    @property
    def E(self) -> int:
        return int(len(self.pre))

    @property
    def n_synapses(self) -> int:
        return int(self.count.sum())

    def signed_counts(self) -> np.ndarray:
        return self.count.astype(np.int64) * self.sign.astype(np.int64)

    def csr(self) -> sp.csr_matrix:
        """Sparse [N, N] matrix of signed synapse counts, row = presynaptic."""
        return sp.csr_matrix((self.signed_counts().astype(np.float64), (self.pre, self.post)), shape=(self.N, self.N))

    def describe(self) -> dict:
        return {"name": self.name, "data_version": self.version, "n_neurons": self.N,
                "n_connections": self.E, "n_synapses": self.n_synapses,
                "n_excitatory_connections": int((self.sign > 0).sum()),
                "n_inhibitory_connections": int((self.sign < 0).sum()),
                "filtering_steps": list(self.filtering_steps)}

    # ---- lookup -------------------------------------------------------------------
    def index_of(self, root_ids, missing="error") -> np.ndarray:
        """Map FlyWire root ids -> simulation indices. missing: 'error' | 'drop'."""
        rid = np.asarray(list(root_ids), dtype=np.int64)
        order = np.argsort(self.root_ids)
        pos = np.searchsorted(self.root_ids, rid, sorter=order)
        pos = np.clip(pos, 0, self.N - 1)
        idx = order[pos]
        ok = self.root_ids[idx] == rid
        if not ok.all():
            if missing == "error":
                raise KeyError(f"{(~ok).sum()} root ids not in connectome v{self.version}: {rid[~ok][:5]}...")
            idx = idx[ok]
        return idx.astype(np.int64)

    def select(self, **crit) -> np.ndarray:
        """Indices of neurons whose annotation matches ALL criteria.

        crit values: str (equality), list (membership), or {'regex': pattern} on that column.
        Special key `root_ids` selects explicit ids. Example:
            conn.select(cell_class='Kenyon_Cell', side='left')
            conn.select(cell_type={'regex': r'^ORN_'})
        """
        mask = np.ones(self.N, dtype=bool)
        for col, val in crit.items():
            if col == "root_ids":
                m = np.zeros(self.N, dtype=bool)
                m[self.index_of(val)] = True
            else:
                s = self.ann[col].astype("string")
                if isinstance(val, dict) and "regex" in val:
                    m = s.str.contains(val["regex"], regex=True, na=False).to_numpy()
                elif isinstance(val, (list, tuple, set, np.ndarray)):
                    m = s.isin([str(v) for v in val]).fillna(False).to_numpy()
                else:
                    m = (s == str(val)).fillna(False).to_numpy()
            mask &= m
        return np.flatnonzero(mask)

    def select_union(self, selectors: list[dict]) -> np.ndarray:
        idx = [self.select(**s) for s in selectors]
        return np.unique(np.concatenate(idx)) if idx else np.array([], dtype=np.int64)

    # ---- derived connectomes --------------------------------------------------------
    def subset(self, keep: np.ndarray, name: str) -> "Connectome":
        """Induced sub-network on `keep` (simulation indices); edges re-indexed 0..len(keep)-1."""
        keep = np.unique(np.asarray(keep, dtype=np.int64))
        remap = np.full(self.N, -1, dtype=np.int64)
        remap[keep] = np.arange(len(keep))
        em = (remap[self.pre] >= 0) & (remap[self.post] >= 0)
        sub = Connectome(
            root_ids=self.root_ids[keep], pre=remap[self.pre[em]].astype(np.int32),
            post=remap[self.post[em]].astype(np.int32), count=self.count[em].copy(), sign=self.sign[em].copy(),
            ann=self.ann.iloc[keep].reset_index(drop=True), version=self.version, name=name,
            provenance=dict(self.provenance, parent=self.name),
            filtering_steps=list(self.filtering_steps) + [{
                "step": f"induced subnetwork '{name}'", "n_neurons_before": self.N, "n_neurons_after": int(len(keep)),
                "n_connections_before": self.E, "n_connections_after": int(em.sum()),
                "n_synapses_before": self.n_synapses, "n_synapses_after": int(self.count[em].sum())}],
        )
        return sub

    def stratum_labels(self, by: str = "cell_class") -> np.ndarray:
        """Per-neuron stratum label for stratified shuffles: cell_class, falling back to super_class."""
        lab = self.ann[by].astype("string")
        if by == "cell_class" and "super_class" in self.ann:
            lab = lab.fillna(self.ann["super_class"].astype("string"))
        return lab.fillna("unknown").to_numpy(dtype=object)

    def degree_preserving_shuffle(self, seed: int, strata: str | None = "cell_class",
                                  swaps_per_edge: int = 10, name: str | None = None) -> "Connectome":
        """Degree-preserving (Maslov-Sneppen) rewiring: every neuron keeps its exact in- and out-degree
        (number of connections) and each connection keeps its presynaptic neuron, so its sign (which is
        a property of the presynaptic neuron's neurotransmitter) and synapse count travel with it.
        Self-loops and duplicate pairs are never created.  With `strata`, swaps are only made between
        connections whose (pre stratum, post stratum) labels match, so the block structure at the
        cell-class level (e.g. how many KC->MBON connections exist) is preserved while the specific
        wiring inside each block is randomised.  strata=None rewires globally.
        """
        from .nulls import maslov_sneppen_rewire
        rng = np.random.default_rng(seed)
        new_post = self.post.copy()
        if strata is None:
            groups = [np.arange(self.E)]
        else:
            lab = self.stratum_labels(strata)
            codes, _ = pd.factorize(pd.Series(lab))
            key = codes[self.pre].astype(np.int64) * (codes.max() + 1) + codes[self.post]
            order = np.argsort(key, kind="stable")
            bounds = np.flatnonzero(np.diff(key[order])) + 1
            groups = np.split(order, bounds)
        n_swapped = 0
        t0 = time.time()
        for g in groups:
            if len(g) < 2:
                continue
            n_swapped += maslov_sneppen_rewire(self.pre, new_post, g.astype(np.int64),
                                               int(swaps_per_edge * len(g)), int(rng.integers(0, 2**31 - 1)))
        out = Connectome(root_ids=self.root_ids, pre=self.pre.copy(), post=new_post, count=self.count.copy(),
                         sign=self.sign.copy(), ann=self.ann, version=self.version,
                         name=name or f"{self.name}_shuffled_s{seed}",
                         provenance=dict(self.provenance, parent=self.name, shuffle_seed=seed, shuffle_strata=strata,
                                         swaps_per_edge=swaps_per_edge, n_successful_swaps=int(n_swapped),
                                         shuffle_walltime_s=round(time.time() - t0, 1)),
                         filtering_steps=list(self.filtering_steps) + [{"step": f"degree-preserving shuffle (strata={strata}, seed={seed})",
                                                                        "n_neurons_before": self.N, "n_neurons_after": self.N,
                                                                        "n_connections_before": self.E, "n_connections_after": self.E,
                                                                        "n_synapses_before": self.n_synapses, "n_synapses_after": self.n_synapses}])
        # sanity: degrees preserved
        assert np.array_equal(np.bincount(out.pre, minlength=self.N), np.bincount(self.pre, minlength=self.N))
        assert np.array_equal(np.bincount(out.post, minlength=self.N), np.bincount(self.post, minlength=self.N))
        return out


# ---- loading ----------------------------------------------------------------------------
def _cache_paths(version: str) -> tuple[Path, Path]:
    DATA_CACHE.mkdir(parents=True, exist_ok=True)
    return DATA_CACHE / f"connectome_v{version}.npz", DATA_CACHE / f"annotations_v{version}.parquet"


def build_cache(version: str = "783") -> None:
    comp_name, con_name = RAW_FILES[version]
    comp = pd.read_csv(DATA_RAW / comp_name, index_col=0)
    con = pd.read_parquet(DATA_RAW / con_name)
    root_ids = comp.index.to_numpy(dtype=np.int64)
    n_before = len(root_ids)
    # Shiu's tables carry a 'Completed' flag; keep exactly what the paper's model keeps.
    if "Completed" in comp:
        keep = comp["Completed"].to_numpy(dtype=bool)
        root_ids = root_ids[keep]
    pre = con["Presynaptic_Index"].to_numpy(dtype=np.int64)
    post = con["Postsynaptic_Index"].to_numpy(dtype=np.int64)
    cnt = con["Connectivity"].to_numpy(dtype=np.int64)
    sign = con["Excitatory"].to_numpy(dtype=np.int64)
    # consistency checks against the id columns
    assert np.array_equal(comp.index.to_numpy(dtype=np.int64)[pre], con["Presynaptic_ID"].to_numpy(dtype=np.int64))
    assert np.array_equal(comp.index.to_numpy(dtype=np.int64)[post], con["Postsynaptic_ID"].to_numpy(dtype=np.int64))
    assert set(np.unique(sign).tolist()) <= {-1, 1}
    assert (cnt > 0).all() and pre.max() < n_before and post.max() < n_before
    assert np.array_equal(con["Excitatory x Connectivity"].to_numpy(dtype=np.int64), cnt * sign)
    steps = [{"step": f"neurons listed in {comp_name}", "n_neurons_before": n_before, "n_neurons_after": int(len(root_ids)),
              "n_connections_before": int(len(pre)), "n_connections_after": int(len(pre)),
              "n_synapses_before": int(cnt.sum()), "n_synapses_after": int(cnt.sum())}]
    # annotations (v783 ids only; other versions get an empty frame)
    ann = pd.DataFrame(index=np.arange(len(root_ids)), columns=ANN_COLS, dtype="string")
    ann_meta = {"source": None, "n_annotated": 0}
    if version == "783" and (DATA_RAW / ANNOTATION_FILE).exists():
        a = pd.read_csv(DATA_RAW / ANNOTATION_FILE, sep="\t", low_memory=False, dtype={"root_id": np.int64})
        a = a.drop_duplicates("root_id").set_index("root_id")
        ann = a.reindex(root_ids)[ANN_COLS].reset_index(drop=True)
        for c in ANN_COLS:
            ann[c] = ann[c].astype("string")
        ann_meta = {"source": ANNOTATION_FILE, "n_annotated": int(a.index.isin(root_ids).sum())}
    npz, annp = _cache_paths(version)
    np.savez(npz, root_ids=root_ids, pre=pre.astype(np.int32), post=post.astype(np.int32),
             count=cnt.astype(np.int32), sign=sign.astype(np.int8))
    ann.to_parquet(annp)
    with open(npz.with_suffix(".json"), "w") as f:
        json.dump({"version": version, "source_files": [comp_name, con_name], "annotations": ann_meta,
                   "filtering_steps": steps, "n_neurons": int(len(root_ids)), "n_connections": int(len(pre)),
                   "n_synapses": int(cnt.sum())}, f, indent=1)


def load_connectome(version: str = "783", rebuild: bool = False) -> Connectome:
    npz, annp = _cache_paths(version)
    if rebuild or not npz.exists() or not annp.exists():
        build_cache(version)
    z = np.load(npz)
    with open(npz.with_suffix(".json")) as f:
        meta = json.load(f)
    ann = pd.read_parquet(annp)
    return Connectome(root_ids=z["root_ids"], pre=z["pre"], post=z["post"], count=z["count"], sign=z["sign"],
                      ann=ann, version=version, name="full",
                      provenance={"source_files": meta["source_files"], "annotations": meta["annotations"], "cache": str(npz)},
                      filtering_steps=meta["filtering_steps"])


def subset_from_config(conn: Connectome, sub_cfg: dict) -> Connectome:
    """sub_cfg: {'name': str, 'selectors': [ {cell_class: 'Kenyon_Cell'}, {cell_type: {regex: '^ORN_'}}, ... ]}"""
    idx = conn.select_union(sub_cfg["selectors"])
    return conn.subset(idx, sub_cfg.get("name", "subset"))
