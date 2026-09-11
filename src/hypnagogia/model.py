"""Brian2 network construction and C++-standalone protocol execution.

One `Simulation` = one standalone build = one seed = a sequence of epochs. Each epoch sets the
Poisson drive rates of the driven neurons, the plasticity gate, and optionally the noise level,
then runs for its duration. Spikes of the recorded neurons are saved for the whole run with
epoch boundaries in the metadata.

Model (Shiu et al. 2024 Nature 634:210, model.py of github.com/philshiu/Drosophila_brain_model):
    dv/dt = (v_rest - v + g)/tau_m [+ sigma*sqrt(2/tau_m)*xi]   (unless refractory)
    dg/dt = -g/tau_syn                                           (unless refractory)
    spike if v > v_th; reset v = v_reset, g = 0; refractory t_refr (0 for Poisson-driven neurons)
    synapse: g_post += w, delay 1.8 ms, w = sign * n_syn * weight_scale * W_syn
The bracketed Gaussian term is this project's Stage-1 addition (mode 'gaussian'); mode 'poisson'
adds an independent Poisson background onto g instead; mode 'none' is the published model.
"""
from __future__ import annotations

import json
import os
import shutil
import time
from pathlib import Path

import numpy as np

from .connectome import Connectome


def _brian():
    import brian2
    return brian2


class Simulation:
    def __init__(self, conn: Connectome, cfg: dict, run_dir: str | Path, seed: int,
                 drive_groups: dict[str, np.ndarray], record: str | np.ndarray = "all",
                 plasticity: dict | None = None, init_plastic_w: np.ndarray | None = None,
                 name: str = "sim"):
        self.conn, self.cfg, self.name = conn, cfg, name
        self.run_dir = Path(run_dir)
        self.seed = int(seed)
        self.drive_groups = {k: np.unique(np.asarray(v, dtype=np.int64)) for k, v in drive_groups.items()}
        self.record = record
        self.plasticity = plasticity
        self.init_plastic_w = init_plastic_w
        self.epochs: list[dict] = []

    def add_epoch(self, name: str, duration_s: float, drives: dict[str, float] | None = None,
                  plastic: bool = False, sigma_mV: float | None = None, note: str = ""):
        drives = drives or {}
        for k in drives:
            if k not in self.drive_groups:
                raise KeyError(f"epoch '{name}' drives unknown group '{k}'; known: {list(self.drive_groups)}")
        self.epochs.append({"name": name, "duration_s": float(duration_s), "drives": {k: float(v) for k, v in drives.items()},
                            "plastic": bool(plastic), "sigma_mV": sigma_mV, "note": note})

    # ---------------------------------------------------------------------------------------
    def run(self, clean: bool = True) -> dict:
        b2 = _brian()
        from brian2 import (NeuronGroup, Synapses, PoissonGroup, PoissonInput, SpikeMonitor, StateMonitor, Network,
                            set_device, get_device, defaultclock, ms, mV, Hz, second, volt)
        cfg, conn = self.cfg, self.conn
        m, noise, drive = cfg["model"], cfg["noise"], cfg["drive"]
        run_cfg = cfg.get("run", {})
        self.run_dir.mkdir(parents=True, exist_ok=True)
        sa_dir = self.run_dir / "standalone"
        t_wall0 = time.time()

        # ---- device ------------------------------------------------------------------
        dev = get_device()
        if getattr(dev, "__class__", type(None)).__name__ == "CPPStandaloneDevice" or b2.prefs.codegen.target != "numpy" and get_device().__class__.__name__ != "RuntimeDevice":
            dev.reinit()
            dev.activate(build_on_run=False, directory=str(sa_dir))
        else:
            set_device("cpp_standalone", directory=str(sa_dir), build_on_run=False)
        b2.prefs.devices.cpp_standalone.openmp_threads = int(run_cfg.get("openmp_threads", 0))
        b2.prefs.codegen.cpp.extra_compile_args_gcc = list(run_cfg.get("extra_compile_args", ["-O3", "-ffast-math", "-march=native"]))
        dt = float(m["dt_ms"]) * ms
        defaultclock.dt = dt
        b2.seed(self.seed)
        np.random.seed(self.seed)

        # ---- parameters -----------------------------------------------------------------
        ns = dict(v_rest=m["v_rest_mV"] * mV, v_reset=m["v_reset_mV"] * mV, v_th=m["v_th_mV"] * mV,
                  tau_m=m["tau_m_ms"] * ms, tau_syn=m["tau_syn_ms"] * ms)
        pl = self.plasticity or {}
        if pl:
            ns.update(tau_e=pl["tau_e_s"] * second, tau_da=pl["tau_da_s"] * second,
                      eta_ltd=float(pl["eta_ltd"]), eta_ltp=float(pl.get("eta_ltp", 0.0)),
                      w_min_frac=float(pl.get("w_min_frac", 0.0)), w_max_frac=float(pl.get("w_max_frac", 1.0)))
        gauss = noise["mode"] == "gaussian"
        eqs = ["dv/dt = (v_rest - v + g)/tau_m" + (" + sigma*sqrt(2/tau_m)*xi" if gauss else "") + " : volt (unless refractory)",
               "dg/dt = -g/tau_syn : volt (unless refractory)",
               "rfc : second", "sigma : volt"]
        if pl:
            eqs.append("dda/dt = -da/tau_da : 1")                 # dopamine trace, driven on MBONs by DAN->MBON synapses
        N = conn.N
        neu = NeuronGroup(N, "\n".join(eqs), method="euler" if gauss else "linear",
                          threshold="v > v_th", reset="v = v_reset; g = 0*mV", refractory="rfc", namespace=ns, name="neu")
        neu.v = ns["v_rest"]; neu.g = 0 * mV; neu.rfc = m["t_refr_ms"] * ms
        sigma0 = float(noise.get("sigma_mV", 0.0)) if gauss else 0.0
        neu.sigma = sigma0 * mV
        if pl:
            neu.da = 0.0

        # ---- synapses -------------------------------------------------------------------
        w_syn = float(m["w_syn_mV"])
        w_all_mV = conn.sign.astype(np.float64) * conn.count.astype(np.float64) * float(conn.weight_scale) * w_syn
        plastic_mask = np.zeros(conn.E, dtype=bool)
        objs = []
        if pl:
            kc = np.zeros(N, bool); kc[np.asarray(pl["pre_idx"], dtype=np.int64)] = True
            mbon = np.zeros(N, bool); mbon[np.asarray(pl["post_idx"], dtype=np.int64)] = True
            plastic_mask = kc[conn.pre] & mbon[conn.post]
        syn = Synapses(neu, neu, "w : volt", on_pre="g += w", delay=m["delay_ms"] * ms, name="syn")
        syn.connect(i=conn.pre[~plastic_mask], j=conn.post[~plastic_mask])
        syn.w = w_all_mV[~plastic_mask] * mV
        objs.append(syn)

        psyn = dsyn = ltd = wmon = None
        n_plastic = int(plastic_mask.sum())
        if pl:
            # --- dopamine-gated, anti-Hebbian two-factor rule at KC->MBON (see configs/base.yaml 'plasticity') ---
            psyn = Synapses(neu, neu, model="""w : volt
                                              w0 : volt (constant)
                                              de/dt = -e/tau_e : 1 (clock-driven)
                                              plastic : 1 (shared)""",
                            on_pre="g_post += w; e += 1; w = clip(w + plastic*eta_ltp*da_post*w0, w_min_frac*w0, w_max_frac*w0)",
                            delay=m["delay_ms"] * ms, name="psyn")
            ppre, ppost = conn.pre[plastic_mask], conn.post[plastic_mask]
            psyn.connect(i=ppre, j=ppost)
            psyn.w0 = w_all_mV[plastic_mask] * mV
            psyn.w = (self.init_plastic_w if self.init_plastic_w is not None else w_all_mV[plastic_mask]) * mV
            psyn.e = 0.0; psyn.plastic = 0.0
            # DAN -> MBON synapses in the connectome define the compartment gating
            dan = np.zeros(N, bool); dan[np.asarray(pl["dan_idx"], dtype=np.int64)] = True
            dm = dan[conn.pre] & mbon[conn.post] & (conn.count >= int(pl.get("dan_mbon_min_synapses", 1)))
            d_pre, d_post = conn.pre[dm], conn.post[dm]
            dsyn = Synapses(neu, neu, on_pre="da_post += 1", delay=m["delay_ms"] * ms, name="dsyn")
            dsyn.connect(i=d_pre, j=d_post)
            # LTD: a DAN spike depresses every eligible KC->MBON synapse onto the MBONs it innervates
            # (Synapses whose target is the plastic Synapses object; Brian2 'Izhikevich_2007' pattern)
            order = np.argsort(ppost, kind="stable")
            post_sorted = ppost[order]
            starts = np.searchsorted(post_sorted, d_post, side="left"); ends = np.searchsorted(post_sorted, d_post, side="right")
            counts = ends - starts
            li = np.repeat(d_pre, counts)
            lj = np.concatenate([order[s:e] for s, e in zip(starts, ends)]) if counts.sum() else np.array([], dtype=np.int64)
            ltd = Synapses(neu, psyn, on_pre="w_post = clip(w_post - plastic_post*eta_ltd*e_post*w0_post, w_min_frac*w0_post, w_max_frac*w0_post)",
                           delay=m["delay_ms"] * ms, name="ltd")
            ltd.connect(i=li.astype(np.int64), j=lj.astype(np.int64))
            objs += [psyn, dsyn, ltd]
            if pl.get("record_w_dt_s"):
                wmon = StateMonitor(psyn, "w", record=True, dt=float(pl["record_w_dt_s"]) * second, name="wmon")
                objs.append(wmon)
            self._plastic_info = {"n_plastic_synapses": n_plastic, "n_dan_mbon_gates": int(dm.sum()), "n_ltd_links": int(len(li)),
                                  "pre": ppre, "post": ppost}

        # ---- drives ---------------------------------------------------------------------
        all_driven = np.unique(np.concatenate(list(self.drive_groups.values()))) if self.drive_groups else np.array([], dtype=np.int64)
        drv = None
        if len(all_driven):
            drv = PoissonGroup(len(all_driven), rates=0 * Hz, name="drv")
            dsy = Synapses(drv, neu, on_pre="v_post += w_drive", namespace={"w_drive": w_syn * float(drive["f_poi"]) * mV}, name="drvsyn")
            dsy.connect(i=np.arange(len(all_driven)), j=all_driven)
            if drive.get("no_refractory_when_driven", True):
                rfc = np.full(N, float(m["t_refr_ms"]))
                rfc[all_driven] = 0.0
                neu.rfc = rfc * ms
            objs += [drv, dsy]
        pos_in_driven = {k: np.searchsorted(all_driven, v) for k, v in self.drive_groups.items()}
        if noise["mode"] == "poisson":
            pz = noise["poisson"]
            objs.append(PoissonInput(neu, "g", N=int(pz["n_inputs"]), rate=float(pz["rate_hz"]) * Hz, weight=float(pz["weight_mV"]) * mV))

        # ---- monitors -------------------------------------------------------------------
        if isinstance(self.record, str) and self.record == "all":
            spk = SpikeMonitor(neu, record=True, name="spk"); rec_idx = None
        else:
            rec_idx = np.unique(np.asarray(self.record, dtype=np.int64))
            spk = SpikeMonitor(neu, record=rec_idx, name="spk")
        objs.append(spk)

        net = Network(neu, *objs)
        # ---- epochs ---------------------------------------------------------------------
        t = 0.0
        epoch_table = []
        for ep in self.epochs:
            if drv is not None:
                rates = np.zeros(len(all_driven))
                for k, r in ep["drives"].items():
                    rates[pos_in_driven[k]] = r
                drv.rates = rates * Hz
            if psyn is not None:
                psyn.plastic = 1.0 if ep["plastic"] else 0.0
            if gauss and ep.get("sigma_mV") is not None:
                neu.sigma = float(ep["sigma_mV"]) * mV
            net.run(ep["duration_s"] * second)
            epoch_table.append(dict(ep, t_start_s=t, t_end_s=t + ep["duration_s"]))
            t += ep["duration_s"]

        # ---- build + execute ------------------------------------------------------------
        t_b = time.time()
        dev = get_device()
        dev.build(directory=str(sa_dir), compile=True, run=True, debug=False, clean=clean, with_output=False)
        t_run = time.time() - t_b

        # ---- collect --------------------------------------------------------------------
        si = np.asarray(spk.i[:], dtype=np.int32)
        st = np.asarray(spk.t[:] / second, dtype=np.float64)
        t_step = np.round(st / float(m["dt_ms"] * 1e-3)).astype(np.int32)
        out = {"spikes": str(self.run_dir / "spikes.npz"), "meta": str(self.run_dir / "meta.json")}
        np.savez_compressed(self.run_dir / "spikes.npz", i=si, t_step=t_step)
        meta = {"name": self.name, "seed": self.seed, "dataset": conn.dataset, "version": conn.version, "network": conn.name,
                "n_neurons": N, "n_connections": conn.E, "n_synapses_raw": conn.n_synapses, "weight_scale": conn.weight_scale,
                "dt_ms": m["dt_ms"], "duration_s": t, "epochs": epoch_table, "noise": noise, "model": m, "drive": drive,
                "drive_groups": {k: [int(x) for x in v] for k, v in self.drive_groups.items()},
                "drive_group_ids": {k: [int(conn.ids[x]) for x in v] for k, v in self.drive_groups.items()},
                "record": "all" if rec_idx is None else [int(x) for x in rec_idx],
                "n_spikes": int(len(si)), "n_active": int(len(np.unique(si))), "walltime_build_run_s": round(t_run, 1),
                "walltime_total_s": round(time.time() - t_wall0, 1), "brian2": b2.__version__,
                "filtering_steps": conn.filtering_steps, "connectome_provenance": {k: v for k, v in conn.provenance.items() if k != "cache"}}
        if psyn is not None:
            info = self._plastic_info
            wz = {"pre": info["pre"].astype(np.int32), "post": info["post"].astype(np.int32),
                  "w0_mV": np.asarray(psyn.w0[:] / mV, dtype=np.float32), "w_final_mV": np.asarray(psyn.w[:] / mV, dtype=np.float32)}
            if wmon is not None:
                wz["w_t_s"] = np.asarray(wmon.t[:] / second, dtype=np.float32)
                wz["w_samples_mV"] = np.asarray(wmon.w[:] / mV, dtype=np.float32)  # [n_syn, n_samples]
            np.savez_compressed(self.run_dir / "plastic_w.npz", **wz)
            out["plastic_w"] = str(self.run_dir / "plastic_w.npz")
            meta["plasticity"] = {k: v for k, v in pl.items() if k not in ("pre_idx", "post_idx", "dan_idx")}
            meta["plasticity"].update({k: info[k] for k in ("n_plastic_synapses", "n_dan_mbon_gates", "n_ltd_links")})
        with open(self.run_dir / "meta.json", "w") as f:
            json.dump(meta, f, indent=1, default=str)
        if run_cfg.get("delete_standalone", True):
            shutil.rmtree(sa_dir, ignore_errors=True)
        return out


# ---------------------------------------------------------------------------------------------
def load_spikes(run_dir: str | Path) -> tuple[np.ndarray, np.ndarray, dict]:
    run_dir = Path(run_dir)
    z = np.load(run_dir / "spikes.npz")
    with open(run_dir / "meta.json") as f:
        meta = json.load(f)
    return z["i"], z["t_step"], meta


def spikes_in_epoch(i: np.ndarray, t_step: np.ndarray, meta: dict, epoch_name: str, dt_s: float | None = None):
    dt_s = dt_s or meta["dt_ms"] * 1e-3
    eps = [e for e in meta["epochs"] if e["name"] == epoch_name]
    masks = [(t_step * dt_s >= e["t_start_s"]) & (t_step * dt_s < e["t_end_s"]) for e in eps]
    m = np.logical_or.reduce(masks) if masks else np.zeros(len(i), bool)
    return i[m], t_step[m], eps


def rates_per_neuron(i: np.ndarray, n_neurons: int, duration_s: float) -> np.ndarray:
    return np.bincount(i, minlength=n_neurons) / duration_s
