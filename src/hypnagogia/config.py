"""YAML config loading with a single-level `extends:` merge and provenance tracking.

Every run records the fully-resolved config it used (results/<run>/config.resolved.yaml)
so a figure can always be traced back to exact parameter values.
"""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
from typing import Any

import yaml

from . import CONFIGS


def _deep_merge(base: dict, over: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def load_config(path: str | Path, overrides: dict | None = None) -> dict:
    """Load a YAML config; if it has `extends: <name-or-path>` merge onto that first."""
    path = Path(path)
    if not path.exists() and (CONFIGS / path).exists():
        path = CONFIGS / path
    if not path.exists() and (CONFIGS / f"{path}.yaml").exists():
        path = CONFIGS / f"{path}.yaml"
    with open(path) as f:
        cfg = yaml.safe_load(f) or {}
    parent = cfg.pop("extends", None)
    if parent:
        ppath = Path(parent)
        if not ppath.is_absolute():
            ppath = (path.parent / parent) if (path.parent / parent).exists() else (CONFIGS / parent)
        cfg = _deep_merge(load_config(ppath), cfg)
    if overrides:
        cfg = _deep_merge(cfg, overrides)
    cfg.setdefault("_provenance", {})
    cfg["_provenance"]["config_file"] = str(path)
    return cfg


def config_hash(cfg: dict) -> str:
    c = {k: v for k, v in cfg.items() if not k.startswith("_")}
    return hashlib.sha1(json.dumps(c, sort_keys=True, default=str).encode()).hexdigest()[:10]


def dump_config(cfg: dict, path: str | Path) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        yaml.safe_dump(cfg, f, sort_keys=False, default_flow_style=False)


def get(cfg: dict, dotted: str, default: Any = None) -> Any:
    cur: Any = cfg
    for part in dotted.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return default
        cur = cur[part]
    return cur
