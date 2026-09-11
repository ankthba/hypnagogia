"""hypnagogia: does a whole-brain Drosophila connectome LIF model replay a learned memory during simulated sleep?"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_RAW = ROOT / "data" / "raw"
DATA_CACHE = ROOT / "data" / "cache"
RESULTS = ROOT / "results"
CONFIGS = ROOT / "configs"
WEB_DATA = ROOT / "web" / "public" / "data"
