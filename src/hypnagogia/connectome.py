"""Connectome loading, on-disk caching, cell-type selection, subsetting and null models.

Primary dataset: the male CNS connectome v1.0 (Janelia FlyEM / Google Research / Cambridge, 2026),
bulk files from gs://flyem-male-cns/v1.0/connectome-data/flat-connectome/ (public HTTPS mirror
https://storage.googleapis.com/flyem-male-cns/v1.0/...).
Secondary dataset (engine correctness check only): FlyWire v630/v783 tables shipped with the
Shiu et al. 2024 model repo.

All loaders produce the same `Connectome` object: an ordered list of neuron ids (the simulation
index), integer edge arrays (pre, post, synapse count, sign), and an annotation table with a
normalised column set so downstream code never touches dataset-specific column names.

Cached artefacts (data/cache): one npz + one parquet + one json per (dataset, version). Never
re-parse the feather/parquet sources per run.
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

# --------------------------------------------------------------------------------------------
# raw file registry
# --------------------------------------------------------------------------------------------
MALECNS_DIR = DATA_RAW / "malecns"
MALECNS_FILES = {
    "annotations": "body-annotations-male-cns-v1.0-minconf-0.5.feather",
    "nt": "body-neurotransmitters-male-cns-v1.0.feather",
    "weights": "connectome-weights-male-cns-v1.0-minconf-0.5-traced-only.feather",
    "matches_mcns_to_fw": "matches_mcns_v1.0_flywire783.feather",
    "matches_fw_to_mcns": "matches_flywire783_mcns_v1.0.feather",
}
FLYWIRE_FILES = {
    "783": ("Completeness_783.csv", "Connectivity_783.parquet"),
    "630": ("2023_03_23_completeness_630_final.csv", "2023_03_23_connectivity_630_final.parquet"),
}
FLYWIRE_ANNOTATION_FILE = "Supplemental_file1_neuron_annotations.tsv"

# Sign rule of Shiu et al. 2024 (Nature 634:210, Methods 'Neurotransmitter predictions'): GABA and
# glutamate are inhibitory (Liu & Wilson 2013 PNAS), acetylcholine/dopamine/octopamine/serotonin
# excitatory, one sign per presynaptic neuron.  Histamine is not a FlyWire prediction class but is
# predicted for ~5,900 male-CNS neurons (photoreceptors); histamine-gated chloride channels make it
# inhibitory at fly photoreceptor synapses (Hardie 1989 Nature 339:704; Gengs et al. 2002 JBC) ->
# -1.  This histamine choice is a pipeline decision beyond Shiu et al. and is flagged in the manifest.
NT_SIGN = {"acetylcholine": 1, "dopamine": 1, "octopamine": 1, "serotonin": 1,
           "gaba": -1, "glutamate": -1, "histamine": -1}

ANN_COLS = ["super_class", "cell_class", "cell_sub_class", "cell_type", "hemibrain_type", "flywire_type",
            "side", "nt", "nt_source", "status", "region", "instance", "flow"]


# --------------------------------------------------------------------------------------------
@dataclass
class Connectome:
    ids: np.ndarray                 # int64 [N] simulation index -> dataset neuron id (bodyId / root_id)
    pre: np.ndarray                 # int32 [E]
    post: np.ndarray                # int32 [E]
    count: np.ndarray               # int32 [E] raw synapse count of the pair (unscaled)
    sign: np.ndarray                # int8  [E] +1 / -1 (sign of the presynaptic neuron)
    ann: pd.DataFrame               # [N] normalised annotations (ANN_COLS)
    dataset: str = "malecns"        # 'malecns' | 'flywire'
    version: str = "v1.0"
    name: str = "full"
    weight_scale: float = 1.0       # multiply raw counts by this before applying W_syn (0.581 for male CNS)
    provenance: dict = field(default_factory=dict)
    filtering_steps: list = field(default_factory=list)

    # ---- basic properties ---------------------------------------------------------------
    @property
    def N(self) -> int:
        return int(len(self.ids))

    @property
    def E(self) -> int:
        return int(len(self.pre))

    @property
    def n_synapses(self) -> int:
        return int(self.count.sum())

    def signed_counts(self) -> np.ndarray:
        return self.count.astype(np.int64) * self.sign.astype(np.int64)

    def csr(self) -> sp.csr_matrix:
        """Sparse [N, N] matrix of signed raw synapse counts, row = presynaptic."""
        return sp.csr_matrix((self.signed_counts().astype(np.float64), (self.pre, self.post)), shape=(self.N, self.N))

    def describe(self) -> dict:
        return {"name": self.name, "dataset": self.dataset, "version": self.version, "n_neurons": self.N,
                "n_connections": self.E, "n_synapses": self.n_synapses, "weight_scale": self.weight_scale,
                "n_excitatory_connections": int((self.sign > 0).sum()),
                "n_inhibitory_connections": int((self.sign < 0).sum()),
                "nt_counts": {k: int(v) for k, v in self.ann["nt"].value_counts(dropna=False).items()} if "nt" in self.ann else {},
                "filtering_steps": list(self.filtering_steps)}

    # ---- lookup ---------------------------------------------------------------------------
    def index_of(self, ids, missing: str = "error") -> np.ndarray:
        """Dataset ids -> simulation indices. missing: 'error' | 'drop'."""
        rid = np.asarray(list(ids), dtype=np.int64)
        order = np.argsort(self.ids)
        pos = np.clip(np.searchsorted(self.ids, rid, sorter=order), 0, self.N - 1)
        idx = order[pos]
        ok = self.ids[idx] == rid
        if not ok.all():
            if missing == "error":
                raise KeyError(f"{int((~ok).sum())} ids not in connectome {self.dataset} {self.version}: {rid[~ok][:5]}...")
            idx = idx[ok]
        return idx.astype(np.int64)

    def select(self, **crit) -> np.ndarray:
        """Indices of neurons matching ALL criteria.

        Values: str (equality), list (membership), {'regex': pattern}. Special key `ids` = explicit ids.
        Examples: conn.select(cell_class='Kenyon_Cell'); conn.select(cell_type={'regex': r'^ORN_'}).
        """
        mask = np.ones(self.N, dtype=bool)
        for col, val in crit.items():
            if col == "ids":
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
            mask &= np.asarray(m, dtype=bool)
        return np.flatnonzero(mask)

    def select_union(self, selectors: list[dict]) -> np.ndarray:
        idx = [self.select(**s) for s in selectors]
        return np.unique(np.concatenate(idx)) if idx else np.array([], dtype=np.int64)

    # ---- derived connectomes -------------------------------------------------------------
    def subset(self, keep: np.ndarray, name: str, step_label: str | None = None) -> "Connectome":
        """Induced sub-network on `keep` (simulation indices); edges re-indexed 0..len(keep)-1."""
        keep = np.unique(np.asarray(keep, dtype=np.int64))
        remap = np.full(self.N, -1, dtype=np.int64)
        remap[keep] = np.arange(len(keep))
        em = (remap[self.pre] >= 0) & (remap[self.post] >= 0)
        return Connectome(
            ids=self.ids[keep], pre=remap[self.pre[em]].astype(np.int32), post=remap[self.post[em]].astype(np.int32),
            count=self.count[em].copy(), sign=self.sign[em].copy(), ann=self.ann.iloc[keep].reset_index(drop=True),
            dataset=self.dataset, version=self.version, name=name, weight_scale=self.weight_scale,
            provenance=dict(self.provenance, parent=self.name),
            filtering_steps=list(self.filtering_steps) + [{
                "step": step_label or f"induced subnetwork '{name}'",
                "n_neurons_before": self.N, "n_neurons_after": int(len(keep)),
                "n_connections_before": self.E, "n_connections_after": int(em.sum()),
                "n_synapses_before": self.n_synapses, "n_synapses_after": int(self.count[em].sum())}],
        )

    def stratum_labels(self, by: str = "cell_class") -> np.ndarray:
        lab = self.ann[by].astype("string")
        if by == "cell_class" and "super_class" in self.ann:
            lab = lab.fillna(self.ann["super_class"].astype("string"))
        return lab.fillna("unknown").to_numpy(dtype=object)

    def degree_preserving_shuffle(self, seed: int, strata: str | None = "cell_class",
                                  swaps_per_edge: int = 10, name: str | None = None) -> "Connectome":
        """Degree-preserving (Maslov-Sneppen) rewiring. Every neuron keeps its exact in- and out-degree
        (number of connections); each connection keeps its presynaptic neuron, so its sign and synapse
        count travel with it; no self-loops or duplicate pairs are created. With `strata`, swaps happen
        only between connections with the same (pre stratum, post stratum) labels, so cell-class block
        structure (e.g. the number of KC->MBON connections) is preserved while the specific wiring
        inside each block is randomised. strata=None rewires globally."""
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
        n_swapped, t0 = 0, time.time()
        for g in groups:
            if len(g) < 2:
                continue
            n_swapped += maslov_sneppen_rewire(self.pre, new_post, g.astype(np.int64),
                                               int(swaps_per_edge * len(g)), int(rng.integers(0, 2**31 - 1)))
        out = Connectome(ids=self.ids, pre=self.pre.copy(), post=new_post, count=self.count.copy(), sign=self.sign.copy(),
                         ann=self.ann, dataset=self.dataset, version=self.version, weight_scale=self.weight_scale,
                         name=name or f"{self.name}_shuffled_s{seed}",
                         provenance=dict(self.provenance, parent=self.name, shuffle_seed=seed, shuffle_strata=strata,
                                         swaps_per_edge=swaps_per_edge, n_successful_swaps=int(n_swapped),
                                         shuffle_walltime_s=round(time.time() - t0, 1)),
                         filtering_steps=list(self.filtering_steps) + [{
                             "step": f"degree-preserving shuffle (strata={strata}, seed={seed}, {n_swapped} swaps)",
                             "n_neurons_before": self.N, "n_neurons_after": self.N, "n_connections_before": self.E,
                             "n_connections_after": self.E, "n_synapses_before": self.n_synapses, "n_synapses_after": self.n_synapses}])
        assert np.array_equal(np.bincount(out.pre, minlength=self.N), np.bincount(self.pre, minlength=self.N))
        assert np.array_equal(np.bincount(out.post, minlength=self.N), np.bincount(self.post, minlength=self.N))
        return out


# --------------------------------------------------------------------------------------------
# cache building
# --------------------------------------------------------------------------------------------
def _cache_paths(dataset: str, version: str) -> tuple[Path, Path, Path]:
    DATA_CACHE.mkdir(parents=True, exist_ok=True)
    stem = DATA_CACHE / f"{dataset}_{version}"
    return stem.with_suffix(".npz"), stem.with_name(stem.name + "_annotations.parquet"), stem.with_suffix(".json")


def _region_from_superclass(sc: str | None) -> str:
    if sc is None or (isinstance(sc, float) and np.isnan(sc)) or sc == "" or pd.isna(sc):
        return "unknown"
    s = str(sc)
    if s.startswith("vnc_"):
        return "vnc"
    if s == "ENS":
        return "other"
    return "brain"   # ol_*, cb_*, visual_*, ascending/descending, sensory_ascending/descending, efferent_*


def build_cache_malecns(version: str = "v1.0") -> None:
    import pyarrow.feather as pf
    t0 = time.time()
    a = pf.read_feather(MALECNS_DIR / MALECNS_FILES["annotations"])
    n_bodies = len(a)
    # neurons = bodies with status 'Traced' (fully proofread neurons; Orphan/Glia/Unimportant/Assign/Anchor excluded)
    a = a[a["status"] == "Traced"].copy()
    n_traced = len(a)
    a = a.sort_values("bodyId").reset_index(drop=True)
    ids = a["bodyId"].to_numpy(dtype=np.int64)
    # neurotransmitter -> sign (per neuron)
    nt = pf.read_feather(MALECNS_DIR / MALECNS_FILES["nt"]).set_index("body")
    nt = nt[~nt.index.duplicated()]
    j = nt.reindex(ids)
    nt_final = np.full(len(ids), "unknown", dtype=object)
    nt_src = np.full(len(ids), "none", dtype=object)
    for col in ["consensus_nt", "celltype_predicted_nt", "predicted_nt"]:
        vals = j[col].astype("string").fillna("").to_numpy(dtype=object)
        take = (nt_final == "unknown") & np.isin(vals, list(NT_SIGN))
        nt_final[take] = vals[take]
        nt_src[take] = col
    # annotations, normalised
    side = a["somaSide"].astype("string")
    if "rootSide" in a:
        side = side.fillna(a["rootSide"].astype("string"))
    ann = pd.DataFrame({
        "super_class": a["superclass"].astype("string"),
        "cell_class": a["class"].astype("string"),
        "cell_sub_class": a["subclass"].astype("string"),
        "cell_type": a["type"].astype("string"),
        "hemibrain_type": a["hemibrainType"].astype("string"),
        "flywire_type": a["flywireType"].astype("string"),
        "side": side,
        "nt": pd.Series(nt_final, dtype="string"),
        "nt_source": pd.Series(nt_src, dtype="string"),
        "status": a["status"].astype("string"),
        "region": pd.Series([_region_from_superclass(s) for s in a["superclass"]], dtype="string"),
        "instance": a["instance"].astype("string"),
        "flow": pd.Series([None] * len(a), dtype="string"),
    })
    # edges (traced-only table: connections between Traced bodies)
    w = pf.read_table(MALECNS_DIR / MALECNS_FILES["weights"], columns=["body_pre", "body_post", "weight"])
    bpre = w.column("body_pre").to_numpy(); bpost = w.column("body_post").to_numpy(); cnt = w.column("weight").to_numpy()
    n_rows = len(cnt)
    pos = {b: i for i, b in enumerate(ids.tolist())}
    idx_pre = pd.Index(ids).get_indexer(bpre)
    idx_post = pd.Index(ids).get_indexer(bpost)
    keep = (idx_pre >= 0) & (idx_post >= 0) & (cnt > 0)
    pre = idx_pre[keep].astype(np.int32); post = idx_post[keep].astype(np.int32); cnt = cnt[keep].astype(np.int32)
    nt_sign = np.array([NT_SIGN.get(x, 1) for x in nt_final], dtype=np.int8)   # unknown -> +1 (flagged)
    sign = nt_sign[pre]
    steps = [
        {"step": "bodies in body-annotations table", "n_neurons_before": n_bodies, "n_neurons_after": n_bodies,
         "n_connections_before": n_rows, "n_connections_after": n_rows, "n_synapses_before": None, "n_synapses_after": None},
        {"step": "status == 'Traced' (proofread neurons)", "n_neurons_before": n_bodies, "n_neurons_after": n_traced,
         "n_connections_before": n_rows, "n_connections_after": int(keep.sum()),
         "n_synapses_before": None, "n_synapses_after": int(cnt.sum())},
    ]
    npz, annp, meta = _cache_paths("malecns", version)
    np.savez(npz, ids=ids, pre=pre, post=post, count=cnt, sign=sign)
    ann.to_parquet(annp)
    with open(meta, "w") as f:
        json.dump({"dataset": "malecns", "version": version,
                   "source_files": [MALECNS_FILES["annotations"], MALECNS_FILES["nt"], MALECNS_FILES["weights"]],
                   "nt_rule": NT_SIGN, "n_nt_unknown_sign_plus": int((nt_final == "unknown").sum()),
                   "nt_source_counts": {k: int(v) for k, v in pd.Series(nt_src).value_counts().items()},
                   "n_histamine_neurons": int((nt_final == "histamine").sum()),
                   "filtering_steps": steps, "n_neurons": int(len(ids)), "n_connections": int(len(pre)),
                   "n_synapses": int(cnt.sum()), "build_walltime_s": round(time.time() - t0, 1)}, f, indent=1)


def build_cache_flywire(version: str = "783") -> None:
    comp_name, con_name = FLYWIRE_FILES[version]
    comp = pd.read_csv(DATA_RAW / comp_name, index_col=0)
    con = pd.read_parquet(DATA_RAW / con_name)
    ids = comp.index.to_numpy(dtype=np.int64)
    n_before = len(ids)
    if "Completed" in comp:
        ids = ids[comp["Completed"].to_numpy(dtype=bool)]
    pre = con["Presynaptic_Index"].to_numpy(dtype=np.int64)
    post = con["Postsynaptic_Index"].to_numpy(dtype=np.int64)
    cnt = con["Connectivity"].to_numpy(dtype=np.int64)
    sign = con["Excitatory"].to_numpy(dtype=np.int64)
    assert np.array_equal(comp.index.to_numpy(dtype=np.int64)[pre], con["Presynaptic_ID"].to_numpy(dtype=np.int64))
    assert np.array_equal(comp.index.to_numpy(dtype=np.int64)[post], con["Postsynaptic_ID"].to_numpy(dtype=np.int64))
    assert set(np.unique(sign).tolist()) <= {-1, 1} and (cnt > 0).all()
    assert np.array_equal(con["Excitatory x Connectivity"].to_numpy(dtype=np.int64), cnt * sign)
    steps = [{"step": f"neurons listed in {comp_name} (Completed == True)", "n_neurons_before": n_before,
              "n_neurons_after": int(len(ids)), "n_connections_before": int(len(pre)), "n_connections_after": int(len(pre)),
              "n_synapses_before": int(cnt.sum()), "n_synapses_after": int(cnt.sum())}]
    ann = pd.DataFrame({c: pd.Series([None] * len(ids), dtype="string") for c in ANN_COLS})
    ann_meta = {"source": None, "n_annotated": 0}
    if version == "783" and (DATA_RAW / FLYWIRE_ANNOTATION_FILE).exists():
        a = pd.read_csv(DATA_RAW / FLYWIRE_ANNOTATION_FILE, sep="\t", low_memory=False, dtype={"root_id": np.int64})
        a = a.drop_duplicates("root_id").set_index("root_id").reindex(ids)
        ann = pd.DataFrame({
            "super_class": a["super_class"].astype("string"), "cell_class": a["cell_class"].astype("string"),
            "cell_sub_class": a["cell_sub_class"].astype("string"), "cell_type": a["cell_type"].astype("string"),
            "hemibrain_type": a["hemibrain_type"].astype("string"), "flywire_type": a["cell_type"].astype("string"),
            "side": a["side"].astype("string"), "nt": a["top_nt"].astype("string"),
            "nt_source": pd.Series(["top_nt"] * len(ids), dtype="string"), "status": a["status"].astype("string"),
            "region": pd.Series(["brain"] * len(ids), dtype="string"), "instance": pd.Series([None] * len(ids), dtype="string"),
            "flow": a["flow"].astype("string")}).reset_index(drop=True)
        ann_meta = {"source": FLYWIRE_ANNOTATION_FILE, "n_annotated": int(a.index.notna().sum())}
    npz, annp, meta = _cache_paths("flywire", version)
    np.savez(npz, ids=ids, pre=pre.astype(np.int32), post=post.astype(np.int32), count=cnt.astype(np.int32), sign=sign.astype(np.int8))
    ann.to_parquet(annp)
    with open(meta, "w") as f:
        json.dump({"dataset": "flywire", "version": version, "source_files": [comp_name, con_name], "annotations": ann_meta,
                   "filtering_steps": steps, "n_neurons": int(len(ids)), "n_connections": int(len(pre)), "n_synapses": int(cnt.sum())}, f, indent=1)


def load_connectome(dataset: str = "malecns", version: str | None = None, scope: str = "brain",
                    weight_scale: float | None = None, rebuild: bool = False) -> Connectome:
    """Load a cached connectome.

    dataset 'malecns' (version 'v1.0'): scope 'brain' drops VNC neurons (superclass vnc_*), ENS and
    bodies without a superclass; scope 'cns' keeps everything Traced (VNC behind this flag).
    dataset 'flywire' (version '783' | '630'): scope ignored (brain-only dataset).
    weight_scale defaults to 0.581 for malecns (male-CNS synapse counts -> FlyWire-equivalent; see
    configs/base.yaml) and 1.0 for flywire.
    """
    if version is None:
        version = "v1.0" if dataset == "malecns" else "783"
    npz, annp, meta = _cache_paths(dataset, version)
    if rebuild or not (npz.exists() and annp.exists() and meta.exists()):
        (build_cache_malecns if dataset == "malecns" else build_cache_flywire)(version)
    z = np.load(npz)
    with open(meta) as f:
        m = json.load(f)
    ann = pd.read_parquet(annp)
    if weight_scale is None:
        weight_scale = 0.581 if dataset == "malecns" else 1.0
    conn = Connectome(ids=z["ids"], pre=z["pre"], post=z["post"], count=z["count"], sign=z["sign"], ann=ann,
                      dataset=dataset, version=version, name="cns" if dataset == "malecns" else "full",
                      weight_scale=float(weight_scale),
                      provenance={"source_files": m["source_files"], "cache": str(npz),
                                  **{k: m[k] for k in ("nt_rule", "n_nt_unknown_sign_plus", "nt_source_counts", "n_histamine_neurons", "annotations") if k in m}},
                      filtering_steps=m["filtering_steps"])
    if dataset == "malecns" and scope == "brain":
        keep = conn.select(region="brain")
        conn = conn.subset(keep, "brain", step_label="scope == 'brain': drop superclass vnc_* (VNC), ENS, and Traced bodies with no superclass")
    return conn


def subset_from_config(conn: Connectome, sub_cfg: dict) -> Connectome:
    """sub_cfg: {'name': str, 'selectors': [ {cell_class: 'Kenyon_Cell'}, {cell_type: {regex: '^ORN_'}}, ... ]}"""
    idx = conn.select_union(sub_cfg["selectors"])
    return conn.subset(idx, sub_cfg.get("name", "subset"))
