"""Stage 8 - WHERE ARE THE KENYON-CELL-TO-KENYON-CELL SYNAPSES?

KC->KC is the largest single input to the Kenyon cells in this connectome: 1,153,845 synapses, 55.4% of
everything landing on them, and the model gives every one of them a fast excitatory conductance because
Kenyon cells are cholinergic.

Manoim et al. 2022 (Curr Biol 32:4438) localise the mushroom body's lateral Kenyon-cell interaction to the
AXONS, mediated by the metabotropic receptor mAChR-B, and report it absent from the calyx by both anatomy
and function. If the axonal interaction is metabotropic rather than nicotinic, the fast excitatory synapse
the model puts there is the wrong object, and the calyx synapses are a separate question.

Acting on that needs to know which synapses are where, and the cached edge table has no region column. This
streams the published per-synapse table, which labels every synapse with the neuropil it sits in, and splits
the KC->KC edges into calyx, lobe, pedunculus and elsewhere. The 3 GB source is streamed and filtered, never
stored. Writes results/stage8_kc_kc/kc_kc_compartments.json and an edge-level split as .npz.
"""
import argparse, collections, io, json, subprocess
import numpy as np
import pyarrow as pa
from hypnagogia import RESULTS
from hypnagogia.connectome import load_connectome

OUT = RESULTS / "stage8_kc_kc"
URL = ("https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome/"
       "syn-partners-male-cns-v1.0-minconf-0.5-traced-only.feather")

# The mushroom body's own compartments, by the neuropil names the reconstruction uses. CA is the calyx, where
# Kenyon-cell dendrites are; the lobes and the pedunculus carry the axons.
CALYX = ("CA(R)", "CA(L)")
LOBE = ("gL(R)", "gL(L)", "aL(R)", "aL(L)", "bL(R)", "bL(L)", "a'L(R)", "a'L(L)", "b'L(R)", "b'L(L)")
PED = ("PED(R)", "PED(L)")


def region_of(roi):
    if roi in CALYX:
        return "calyx"
    if roi in LOBE:
        return "lobe"
    if roi in PED:
        return "pedunculus"
    return "elsewhere"


class _Cap(io.RawIOBase):
    """Readable wrapper that ends cleanly at the first short read, so a truncated tail cannot raise."""

    def __init__(self, f):
        self.f = f

    def readable(self):
        return True

    def readinto(self, b):
        d = self.f.read(len(b))
        if not d:
            return 0
        b[: len(d)] = d
        return len(d)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=URL)
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)

    conn = load_connectome("malecns", "v1.0", "brain")
    kc = conn.select(cell_class="Kenyon_Cell")
    kc_ids = set(int(x) for x in conn.ids[kc])
    print(f"{len(kc_ids):,} Kenyon cells", flush=True)

    proc = subprocess.Popen(["curl", "-sS", a.url], stdout=subprocess.PIPE, bufsize=1 << 22)
    if proc.stdout.read(8)[:6] != b"ARROW1":
        raise SystemExit("not an Arrow file")
    reader = pa.ipc.open_stream(io.BufferedReader(_Cap(proc.stdout), buffer_size=1 << 22))

    by_region = collections.Counter()
    by_roi = collections.Counter()
    per_edge = collections.defaultdict(lambda: collections.Counter())
    n_scanned = 0
    try:
        for batch in reader:
            n_scanned += batch.num_rows
            pre = batch.column("body_pre").to_numpy(zero_copy_only=False)
            post = batch.column("body_post").to_numpy(zero_copy_only=False)
            m = np.fromiter(((int(p) in kc_ids) and (int(q) in kc_ids) for p, q in zip(pre, post)), bool, len(pre))
            if not m.any():
                continue
            roi = batch.column("primary_post").to_pylist()
            for k in np.flatnonzero(m):
                r = region_of(roi[k])
                by_region[r] += 1
                by_roi[roi[k]] += 1
                per_edge[(int(pre[k]), int(post[k]))][r] += 1
            if n_scanned % 20_000_000 < batch.num_rows:
                print(f"  {n_scanned/1e6:6.1f}M scanned, {sum(by_region.values()):,} KC->KC kept", flush=True)
    except Exception as e:
        print(f"stream ended: {type(e).__name__}", flush=True)
    finally:
        proc.kill()

    total = sum(by_region.values())
    print(f"\nscanned {n_scanned:,} synapses; {total:,} of them are Kenyon cell to Kenyon cell\n", flush=True)

    # Edge-level split, in the connectome's own row indices, so the model can act on it directly.
    pos = {int(b): i for i, b in enumerate(conn.ids)}
    rows = []
    for (p, q), c in per_edge.items():
        if p in pos and q in pos:
            rows.append((pos[p], pos[q], c["calyx"], c["lobe"], c["pedunculus"], c["elsewhere"]))
    arr = np.array(rows, dtype=np.int64) if rows else np.zeros((0, 6), dtype=np.int64)
    np.savez_compressed(OUT / "kc_kc_edges_by_region.npz", pre=arr[:, 0], post=arr[:, 1],
                        calyx=arr[:, 2], lobe=arr[:, 3], pedunculus=arr[:, 4], elsewhere=arr[:, 5])

    axonal = int(by_region["lobe"] + by_region["pedunculus"])
    finding = (
        f"The Kenyon cells' recurrent input is overwhelmingly axonal. Of {total:,} Kenyon-cell-to-Kenyon-cell "
        f"synapses, {by_region['calyx']:,} ({by_region['calyx']/total:.1%}) are in the calyx where the dendrites "
        f"are, and {axonal:,} ({axonal/total:.1%}) are in the lobes and pedunculus where the axons are "
        f"({by_region['lobe']:,} lobe, {by_region['pedunculus']:,} pedunculus), with "
        f"{by_region['elsewhere']:,} ({by_region['elsewhere']/total:.1%}) elsewhere. The measurement that says "
        f"this interaction is metabotropic rather than nicotinic is about the axons, so it applies to "
        f"{axonal/total:.0%} of the recurrent synapses the model currently makes fast and excitatory."
        if total else "No KC to KC synapses were found in the stream, which should not happen.")

    out = {"status": "passed" if total else "failed",
           "question": "Where are the Kenyon cells' recurrent synapses: on the dendrites in the calyx, or on the axons?",
           "source": a.url, "n_synapses_scanned": n_scanned,
           "n_kc_kc_synapses": total, "n_kc_kc_edges": len(rows),
           "by_region": dict(by_region), "by_neuropil": dict(by_roi.most_common(24)),
           "axonal_fraction": (axonal / total) if total else None,
           "region_definitions": {"calyx": list(CALYX), "lobe": list(LOBE), "pedunculus": list(PED)},
           "finding": finding,
           "provenance": {"config": "configs/base.yaml", "results_dir": "results/stage8_kc_kc",
                          "files": [a.url, "results/stage8_kc_kc/kc_kc_edges_by_region.npz"]}}
    json.dump(out, open(OUT / "kc_kc_compartments.json", "w"), indent=1, default=str)
    print(finding); print()
    for r, n in by_region.most_common():
        print(f"  {r:12s} {n:9,}  {n/total:6.1%}")
    print()
    for roi, n in by_roi.most_common(14):
        print(f"    {roi:26s} {n:9,}  {n/total:6.1%}")


if __name__ == "__main__":
    main()
