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


def psp_peak_factor(tau_m_ms: float, tau_syn_ms: float) -> float:
    """Peak membrane deflection produced by one unit of synaptic conductance, in this model's own units.

    A synaptic event adds w to g, and the membrane follows dv/dt = (v_rest - v + g)/tau_m while g decays with
    tau_syn. So w is NOT the size of the postsynaptic potential: the membrane is still charging while g is
    already decaying, and the peak is w times this factor. For the published constants, tau_m = 20 ms and
    tau_syn = 5 ms, the factor is 0.157, so a synapse the connectome gives a weight of 7 mV produces a
    postsynaptic potential of about 1.1 mV.

    This exists because that distinction was got wrong once, in a headline sentence, by a factor of 6.3. Any
    statement of the form "one spike from X delivers N mV to Y" has to say which of the two it means, and if
    it means the potential it has to come through here.
    """
    tm, ts = float(tau_m_ms), float(tau_syn_ms)
    if ts <= 0 or tm <= 0 or abs(tm - ts) < 1e-12:
        raise ValueError(f"need distinct positive time constants, got tau_m={tm}, tau_syn={ts}")
    t_peak = np.log(tm / ts) / (1.0 / ts - 1.0 / tm)
    return float((ts / (tm - ts)) * (np.exp(-t_peak / tm) - np.exp(-t_peak / ts)))


def _brian():
    import brian2
    return brian2


class Simulation:
    def __init__(self, conn: Connectome, cfg: dict, run_dir: str | Path, seed: int,
                 drive_groups: dict[str, np.ndarray], record: str | np.ndarray = "all",
                 plasticity: dict | None = None, init_plastic_w: np.ndarray | None = None,
                 name: str = "sim", record_v: np.ndarray | None = None, record_v_dt_s: float = 0.001):
        self.conn, self.cfg, self.name = conn, cfg, name
        self.run_dir = Path(run_dir)
        self.seed = int(seed)
        self.drive_groups = {k: np.unique(np.asarray(v, dtype=np.int64)) for k, v in drive_groups.items()}
        self.record = record
        self.plasticity = plasticity
        self.init_plastic_w = init_plastic_w
        self.record_v = None if record_v is None else np.unique(np.asarray(record_v, dtype=np.int64))
        self.record_v_dt_s = float(record_v_dt_s)
        self.epochs: list[dict] = []

    def add_epoch(self, name: str, duration_s: float, drives: dict[str, float] | None = None,
                  plastic: bool = False, sigma_mV: float | None = None, note: str = "", reset: bool = False):
        drives = drives or {}
        for k in drives:
            if k not in self.drive_groups:
                raise KeyError(f"epoch '{name}' drives unknown group '{k}'; known: {list(self.drive_groups)}")
        self.epochs.append({"name": name, "duration_s": float(duration_s), "drives": {k: float(v) for k, v in drives.items()},
                            "plastic": bool(plastic), "sigma_mV": sigma_mV, "note": note, "reset": bool(reset)})

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
        defaultclock.dt = float(m["dt_ms"]) * ms
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
        graded_idx = np.unique(np.asarray(cfg.get("graded", {}).get("index", []), dtype=np.int64))
        use_graded = len(graded_idx) > 0
        # Spike-triggered adaptation, when a caller asks for it. It is NOT part of the published model and
        # nothing in the connectome implies it: see MECHANISM_DEVIATIONS["spike_frequency_adaptation"] for
        # what it is, where its two constants come from, and why it is a deviation and not a correction.
        # It is absent from base.yaml deliberately, so that a run without it hashes exactly as it did before
        # this existed and no completed simulation is invalidated by the mere possibility of adaptation.
        adapt = cfg.get("adaptation") or None
        if adapt is not None:
            for k in ("tau_ms", "b_mV"):
                if adapt.get(k) is None:
                    raise ValueError(f"adaptation.{k} has no default: an unset adaptation constant must be "
                                     f"supplied explicitly and labelled, never inferred")
        # Named drive_expr and not drive: `drive` is already the config's Poisson-drive block, three lines up.
        drive_expr = "v_rest - v + g" + (" + g_graded" if use_graded else "") + (" - adapt" if adapt else "")
        eqs = ["dv/dt = (" + drive_expr + ")/tau_m"
               + (" + sigma*sqrt(2/tau_m)*xi" if gauss else "") + " : volt (unless refractory)",
               "dg/dt = -g/tau_syn : volt (unless refractory)",
               "rfc : second", "sigma : volt", "v_th_i : volt"]
        if use_graded:
            # Graded (non-spiking) release. APL, the mushroom body's feedback inhibitory neuron, does not fire
            # action potentials; it releases transmitter continuously in proportion to its membrane potential
            # (Amin, Aso et al. 2020 eLife 9:e56954). Modelling it as a spiking neuron replaces a continuously
            # graded gain control with a saturated binary relay, because one Kenyon-cell spike already exceeds
            # its threshold and its output is then capped by the refractory period.
            eqs.append("g_graded : volt")
        if pl:
            eqs.append("dda/dt = -da/tau_da : 1")                 # dopamine trace, driven on MBONs by DAN->MBON synapses
        if adapt:
            # One extra state variable per neuron: a hyperpolarising conductance that steps up by b_adapt on
            # every spike this cell fires and decays with tau_adapt. It is the only thing in the model slower
            # than tau_syn, and it is what allows an active state to end. The variable is named `adapt` and
            # not `a` because `da` is already the dopamine trace and Brian2 would read `da/dt` as its
            # derivative.
            ns.update(tau_adapt=float(adapt["tau_ms"]) * ms, b_adapt=float(adapt["b_mV"]) * mV)
            eqs.append("dadapt/dt = -adapt/tau_adapt : volt (unless refractory)")
        N = conn.N
        reset = "v = v_reset; g = 0*mV" + ("; adapt += b_adapt" if adapt else "")
        neu = NeuronGroup(N, "\n".join(eqs), method="euler" if gauss else "linear",
                          threshold="v > v_th_i", reset=reset, refractory="rfc", namespace=ns, name="neu")
        neu.v = ns["v_rest"]; neu.g = 0 * mV; neu.rfc = m["t_refr_ms"] * ms
        if adapt:
            neu.adapt = 0 * mV
        th = np.full(N, float(m["v_th_mV"]))
        if use_graded:
            th[graded_idx] = 1e6          # never spikes: release is graded, handled by the graded synapses below
        neu.v_th_i = th * mV
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
        graded_mask = np.isin(conn.pre, graded_idx) if use_graded else np.zeros(conn.E, dtype=bool)
        spiking_mask = (~plastic_mask) & (~graded_mask)

        # Short-term synaptic depression, when a caller asks for it. NOT part of the published model: see
        # MECHANISM_DEVIATIONS["short_term_depression_excitatory"]. Both constants are measured, at the
        # antennal-lobe synapses named in that entry; the SCOPE it is applied to is not measured and is
        # reported as an arm rather than assumed. Absent from base.yaml on purpose, so that a run without
        # it hashes exactly as it did before this existed.
        std = cfg.get("depression") or None
        if std is not None:
            for k in ("f", "tau_ms", "scope"):
                if std.get(k) is None:
                    raise ValueError(f"depression.{k} has no default: an unset depression constant or scope "
                                     f"must be supplied explicitly and labelled, never inferred")
        depress_mask = np.zeros(conn.E, dtype=bool)
        if std is not None:
            dep_pre = np.zeros(N, bool); dep_pre[np.asarray(std["pre_idx"], dtype=np.int64)] = True
            dep_post = np.zeros(N, bool); dep_post[np.asarray(std["post_idx"], dtype=np.int64)] = True
            # Excitatory only: every confirmed measurement is at a cholinergic excitatory synapse, and
            # nothing measured says an inhibitory synapse in this brain depresses the same way.
            depress_mask = spiking_mask & dep_pre[conn.pre] & dep_post[conn.post] & (conn.sign > 0)
        static_mask = spiking_mask & (~depress_mask)

        syn = Synapses(neu, neu, "w : volt", on_pre="g += w", delay=m["delay_ms"] * ms, name="syn")
        syn.connect(i=conn.pre[static_mask], j=conn.post[static_mask])
        syn.w = w_all_mV[static_mask] * mV
        objs.append(syn)
        self._n_depressing = int(depress_mask.sum())
        if self._n_depressing:
            # A is the fraction of the releasable resource left. Each arriving spike delivers w * A and
            # then multiplies A by f; between spikes A recovers exponentially toward 1 with tau. That is
            # the two-parameter model the three antennal-lobe papers fit, in their own parameterisation,
            # so f and tau enter as measured rather than converted.
            dsyn = Synapses(neu, neu, model="""w : volt
                                               dA/dt = (1 - A)/tau_std : 1 (event-driven)""",
                            on_pre="g_post += w * A; A = A * f_std",
                            delay=m["delay_ms"] * ms,
                            namespace={"tau_std": float(std["tau_ms"]) * ms, "f_std": float(std["f"])},
                            name="dsynstd")
            dsyn.connect(i=conn.pre[depress_mask], j=conn.post[depress_mask])
            dsyn.w = w_all_mV[depress_mask] * mV
            dsyn.A = 1.0
            objs.append(dsyn)
        gsyn = None
        if use_graded and graded_mask.any():
            # The conversion introduces NO new free parameter. A spiking synapse of weight w driven at the
            # maximum rate the refractory period allows, 1/t_refr, settles at a conductance of w/t_refr*tau_syn.
            # The graded synapse is scaled so that a presynaptic neuron depolarised to threshold delivers exactly
            # that, and proportionally less below it. Release is rectified at rest: no depolarisation, no release.
            k_graded = float(m["tau_syn_ms"] / m["t_refr_ms"])
            gns = dict(ns, v_span=(m["v_th_mV"] - m["v_rest_mV"]) * mV, k_graded=k_graded)
            gsyn = Synapses(neu, neu, model="""w_g : volt
                                               g_graded_post = k_graded * w_g * clip((v_pre - v_rest) / v_span, 0, 1) : volt (summed)""",
                            namespace=gns, name="gsyn")
            gsyn.connect(i=conn.pre[graded_mask], j=conn.post[graded_mask])
            gsyn.w_g = w_all_mV[graded_mask] * mV
            objs.append(gsyn)

        psyn = dsyn = ltd = wmon = None
        n_plastic = int(plastic_mask.sum())
        if pl:
            # --- dopamine-gated, anti-Hebbian two-factor rule at KC->MBON (see configs/base.yaml 'plasticity') ---
            psyn = Synapses(neu, neu, model="""w : volt
                                              w0 : volt (constant)
                                              delig/dt = -elig/tau_e : 1 (event-driven)
                                              plastic : 1 (shared)""",
                            on_pre="g_post += w; elig += 1; w = clip(w + plastic*eta_ltp*da_post*w0, w_min_frac*w0, w_max_frac*w0)",
                            delay=m["delay_ms"] * ms, namespace=ns, name="psyn")
            ppre, ppost = conn.pre[plastic_mask], conn.post[plastic_mask]
            psyn.connect(i=ppre, j=ppost)
            psyn.w0 = w_all_mV[plastic_mask] * mV
            psyn.w = (self.init_plastic_w if self.init_plastic_w is not None else w_all_mV[plastic_mask]) * mV
            psyn.elig = 0.0; psyn.plastic = 0.0
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
            # The eligibility trace is event-driven, so Brian2 only integrates it at this synapse's own pre-spikes.
            # A dopaminergic spike arrives through a different pathway, so the trace has to be decayed to the
            # present time explicitly, using the lastupdate that the event-driven machinery maintains. Doing this
            # clock-driven instead would integrate 61,210 synapses on every 0.1 ms step, which dominated the runtime.
            ltd = Synapses(neu, psyn, on_pre="w_post = clip(w_post - plastic_post*eta_ltd*elig_post*exp(-(t - lastupdate_post)/tau_e)*w0_post, w_min_frac*w0_post, w_max_frac*w0_post)",
                           delay=m["delay_ms"] * ms, namespace=ns, name="ltd")
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
                refr_arr = np.full(N, float(m["t_refr_ms"]))
                refr_arr[all_driven] = 0.0
                neu.rfc = refr_arr * ms
            objs += [drv, dsy]
        pos_in_driven = {k: np.searchsorted(all_driven, v) for k, v in self.drive_groups.items()}
        if noise["mode"] == "poisson":
            pz = noise["poisson"]
            objs.append(PoissonInput(neu, "g", N=int(pz["n_inputs"]), rate=float(pz["rate_hz"]) * Hz, weight=float(pz["weight_mV"]) * mV))

        # ---- monitors -------------------------------------------------------------------
        # Brian2's SpikeMonitor records the whole group it is attached to (its `record` flag is a boolean, and a
        # subset would need a contiguous subgroup). So we always record every neuron and, when a subset was asked
        # for, filter the spikes afterwards. `record_all_spikes` in the metadata says which happened.
        spk = SpikeMonitor(neu, record=True, name="spk")
        rec_idx = None if (isinstance(self.record, str) and self.record == "all") else np.unique(np.asarray(self.record, dtype=np.int64))
        objs.append(spk)
        vmon = None
        if self.record_v is not None and len(self.record_v):
            vmon = StateMonitor(neu, "v", record=self.record_v, dt=self.record_v_dt_s * second, name="vmon")
            objs.append(vmon)

        net = Network(neu, *objs)
        # ---- epochs ---------------------------------------------------------------------
        t = 0.0
        epoch_table = []
        for ep in self.epochs:
            if ep.get("reset"):
                # Return the network to its resting state before this epoch. The model has no adaptation or
                # synaptic depression, so once a stimulus has pushed it into its self-sustaining state it stays
                # there indefinitely (stage 3b). Without this reset an offline period would simply inherit the
                # stimulus-driven activity, and any "reactivation" measured in it would be persistence, not
                # replay. Learned synaptic weights are NOT touched; only membrane potentials, synaptic
                # conductances and the dopamine trace are cleared.
                neu.v = ns["v_rest"]; neu.g = 0 * mV
                if pl:
                    neu.da = 0.0
            if drv is not None:
                rate_arr = np.zeros(len(all_driven))
                for k, r in ep["drives"].items():
                    rate_arr[pos_in_driven[k]] = r
                drv.rates = rate_arr * Hz
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
        n_spikes_all = int(len(si))
        if rec_idx is not None:
            keep = np.isin(si, rec_idx)
            si, st = si[keep], st[keep]
        t_step = np.round(st / float(m["dt_ms"] * 1e-3)).astype(np.int32)
        out = {"spikes": str(self.run_dir / "spikes.npz"), "meta": str(self.run_dir / "meta.json")}
        np.savez_compressed(self.run_dir / "spikes.npz", i=si, t_step=t_step)
        meta = {"name": self.name, "seed": self.seed, "dataset": conn.dataset, "version": conn.version, "network": conn.name,
                "n_neurons": N, "n_connections": conn.E, "n_synapses_raw": conn.n_synapses, "weight_scale": conn.weight_scale,
                "dt_ms": m["dt_ms"], "duration_s": t, "epochs": epoch_table, "noise": noise, "model": m, "drive": drive,
                "drive_groups": {k: [int(x) for x in v] for k, v in self.drive_groups.items()},
                "drive_group_ids": {k: [int(conn.ids[x]) for x in v] for k, v in self.drive_groups.items()},
                "graded_release": {"n_neurons": int(len(graded_idx)), "n_connections": int(graded_mask.sum()),
                                   "ids": [int(conn.ids[x]) for x in graded_idx],
                                   "note": ("These neurons do not fire action potentials; they release transmitter in "
                                            "proportion to membrane depolarisation, rectified at rest and saturating at "
                                            "the spike threshold. Scaling is fixed by matching a spiking synapse driven "
                                            "at its maximum refractory-limited rate, so no free parameter is introduced.")}
                if use_graded else None,
                "record": "all" if rec_idx is None else [int(x) for x in rec_idx],
                "record_all_spikes": bool(rec_idx is None), "n_spikes_whole_network": n_spikes_all,
                "n_spikes": int(len(si)), "n_active": int(len(np.unique(si))), "walltime_build_run_s": round(t_run, 1),
                "walltime_total_s": round(time.time() - t_wall0, 1), "brian2": b2.__version__,
                "filtering_steps": conn.filtering_steps, "connectome_provenance": {k: v for k, v in conn.provenance.items() if k != "cache"}}
        if vmon is not None:
            np.savez_compressed(self.run_dir / "voltage.npz", idx=self.record_v.astype(np.int32),
                                t_s=np.asarray(vmon.t[:] / second, dtype=np.float32), v_mV=np.asarray(vmon.v[:] / mV, dtype=np.float32))
            out["voltage"] = str(self.run_dir / "voltage.npz")
        if getattr(self, "_n_depressing", 0):
            # The count goes in the run's own metadata: how many synapses a deviation actually touched is
            # part of what the deviation is, and it is not recoverable from the config alone.
            meta["depression"] = {k: v for k, v in (cfg.get("depression") or {}).items()
                                  if k not in ("pre_idx", "post_idx")}
            meta["depression"]["n_depressing_synapses"] = int(self._n_depressing)
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
