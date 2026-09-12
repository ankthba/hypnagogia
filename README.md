# hypnagogia

**Can a whole-brain *Drosophila* connectome model spontaneously reactivate a learned memory during a simulated sleep state?**

An operational test for memory replay ("dreaming") in a leaky integrate-and-fire model of the male CNS
connectome v1.0 (Janelia FlyEM, Google Research and Cambridge, *Cell* 2026), brain-only scope, 144,209 neurons
after filtering. Base model: Shiu et al. 2024, *Nature*. Brian2, C++ standalone. FlyWire v630 and v783 appear
only in the engine check and the cross-dataset control.

Pipeline stages (each is a script under `scripts/`, config under `configs/`, outputs under `results/`):

| stage | what | script |
|---|---|---|
| 0a | reproduce the published model on its own data (engine check) | `scripts/00_engine_check.py` |
| 0b | validate the male CNS network: weight scaling and sensory→motor propagation | `scripts/00_validate_malecns.py` |
| 1 | add background noise (Gaussian membrane noise or Poisson drive) | `scripts/01_noise.py` |
| 2 | sweep the noise, classify silent / critical / saturated / bistable | `scripts/02_criticality.py` |
| 3 | dopamine-gated Kenyon-cell → MBON plasticity, calibrated against Hige et al. 2015 | `scripts/03_plasticity.py` |
| 3a | the APL correction: what modelling a non-spiking neuron as spiking does | `scripts/03a_apl_correction.py` |
| 3b | is there a sparse odour code to encode a memory in? | `scripts/03b_odor_calibration.py` |
| 3c | is the runaway the model or this dataset? (cross-dataset, cross-pathway control) | `scripts/03c_dataset_control.py` |
| 3d | how far from the published parameters would sparse coding require? (labelled deviation) | `scripts/03d_gain_sensitivity.py` |
| 3e | do two different odours leave two different ensembles? | `scripts/03e_discriminability.py` |
| 3f | the DPM correction: the measured transmitter in place of the predicted one | `scripts/03f_dpm_correction.py` |
| 4 | encode an odour memory, verify learning | `scripts/04_encode.py` |
| 5 | sleep (dFB clamped) vs wake, noise-driven, no odour | `scripts/05_sleep.py` |
| 6 | replay test with four null comparisons | `scripts/06_replay.py` |
| 6b | is reactivation explained by wiring rather than by memory? | `scripts/06b_structure.py` |

## Two corrections to the published model

Two mushroom-body cells are modelled differently here from the way Shiu et al. treat them. Both follow from a
direct measurement on the identified cell, both apply the model's own existing rules rather than adding one,
and neither introduces a numeric parameter. Every stage downstream of 3a runs with them; stage 3c is pinned to
the published model on purpose, because its question is whether the runaway belongs to that model.

1. **APL does not spike.** It releases transmitter in proportion to membrane depolarisation (Amin et al. 2020,
   *eLife* 9:e56954). Modelling it with a threshold replaces the mushroom body's one graded gain control with a
   switch. Correcting it, at the published parameters, takes odour coding from 67.7% of Kenyon cells at 40.1 Hz
   to 4.5% at 0.79 Hz, and the offline rate from 32.3 Hz to 0.134 Hz, against 6 +/- 5% and 0.1 Hz measured.
   Set `graded_release.populations: []` in `configs/base.yaml` to run without it.
2. **DPM is inhibitory, not dopaminergic.** The connectome predicts dopamine, which the sign rule makes
   excitatory onto 3,989 of the 4,064 Kenyon cells. Haynes, Christmann & Waddell 2015 (*eLife* 4:e03868) show
   DPM is Gad1-positive and that activating it drives chloride influx in mushroom-body neurons; Lee et al. 2011
   (*PNAS* 108:13794) report it as serotonergic. Set `nt_corrections.populations: []` to run without it.

Run the whole downstream pipeline at a given synaptic gain with `scripts/run_variant.sh <gain>`; `1.0` is the
published model and anything below it is a labelled deviation that is reported as such.

Results are exported to `web/public/data/` and rendered by the static viewer in `web/`
(**viewer shows real outputs only; missing results render as "not yet run"**).
Plain-language findings, including negative ones, live in `results.md`.

## Setup
```bash
python3.12 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt && pip install -e .
python scripts/fetch_data.py      # pulls the male CNS v1.0 tables plus FlyWire v630/v783 for the controls
```
