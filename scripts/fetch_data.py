"""Download the raw connectome + annotation files this pipeline uses.

Sources (all public):
  * Shiu et al. 2024 model repo (github.com/philshiu/Drosophila_brain_model) ships the
    FlyWire v783 (and v630) completeness + signed connectivity tables that the paper's
    model consumes.  We use those files verbatim so the base model is the published one.
  * Schlegel et al. 2024 (Nature) hierarchical annotations for FlyWire v783 root IDs
    (github.com/flyconnectome/flywire_annotations), used for cell-type selection
    (Kenyon cells, MBONs, DANs, ORNs, dFB tangential neurons, ...).

codex.flywire.ai (Info > Download Data, v783) serves the same tables but requires a
Google login, so it cannot be scripted; the GitHub mirrors above are used instead.
SHA-256 checksums are pinned so a run is reproducible against exactly these bytes.
"""
import hashlib
import sys
import urllib.request
from pathlib import Path

RAW = Path(__file__).resolve().parents[1] / "data" / "raw"
SHIU = "https://raw.githubusercontent.com/philshiu/Drosophila_brain_model/main/"
SCHLEGEL = ("https://raw.githubusercontent.com/flyconnectome/flywire_annotations/main/"
            "supplemental_files/Supplemental_file1_neuron_annotations.tsv")

FILES = {
    "Completeness_783.csv": (SHIU + "Completeness_783.csv",
        "bbb847a4cc2caaa7a16349722d220c087317b946d148d4d592d94d250617a311"),
    "Connectivity_783.parquet": (SHIU + "Connectivity_783.parquet",
        "efeb23fb99098e9c390f6869969b2a121a2ee92c833cfc45ecb2c1d8e1af0347"),
    "2023_03_23_completeness_630_final.csv": (SHIU + "2023_03_23_completeness_630_final.csv",
        "e6b71e17671a9bdb05f55e4bc6774640a1418cb7a05125e0fc994ad40f9bfdfb"),
    "2023_03_23_connectivity_630_final.parquet": (SHIU + "2023_03_23_connectivity_630_final.parquet",
        "94db8c650533bc36ffa3223f2e62325d5648b8d6bd31c3a4e1c804628c7557b3"),
    "Supplemental_file1_neuron_annotations.tsv": (SCHLEGEL,
        "9a4f8b2f843196074431ebd7cd883536afa1be86c8a4ce90970441e8be81d1be"),
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    bad = 0
    for name, (url, digest) in FILES.items():
        dest = RAW / name
        if dest.exists() and sha256(dest) == digest:
            print(f"ok       {name}")
            continue
        print(f"fetching {name} <- {url}")
        urllib.request.urlretrieve(url, dest)
        got = sha256(dest)
        if got != digest:
            print(f"CHECKSUM MISMATCH for {name}: expected {digest}, got {got}")
            bad += 1
        else:
            print(f"ok       {name}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
