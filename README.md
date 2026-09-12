# hypnagogia

**Can a whole-brain *Drosophila* connectome model spontaneously reactivate a learned memory during a simulated sleep state?**

An operational test for memory replay ("dreaming") in a leaky integrate-and-fire model of the
FlyWire FAFB v783 connectome (base model: Shiu et al. 2024, *Nature*; Brian2, C++ standalone).

Pipeline stages (each is a script under `scripts/`, config under `configs/`, outputs under `results/`):

| stage | what | script |
|---|---|---|
| 0a | reproduce the published model on its own data (engine check) | `scripts/00_engine_check.py` |
| 0b | validate the male CNS network: weight scaling and sensory→motor propagation | `scripts/00_validate_malecns.py` |
| 1 | add background noise (Gaussian membrane noise or Poisson drive) | `scripts/01_noise.py` |
| 2 | sweep the noise, classify silent / critical / saturated / bistable | `scripts/02_criticality.py` |
| 3 | dopamine-gated Kenyon-cell → MBON plasticity, calibrated against Hige et al. 2015 | `scripts/03_plasticity.py` |
| 3b | is there a sparse odour code to encode a memory in? | `scripts/03b_odor_calibration.py` |
| 3c | is the runaway the model or this dataset? (cross-dataset, cross-pathway control) | `scripts/03c_dataset_control.py` |
| 3d | how far from the published parameters would sparse coding require? (labelled deviation) | `scripts/03d_gain_sensitivity.py` |
| 3e | do two different odours leave two different ensembles? | `scripts/03e_discriminability.py` |
| 4 | encode an odour memory, verify learning | `scripts/04_encode.py` |
| 5 | sleep (dFB clamped) vs wake, noise-driven, no odour | `scripts/05_sleep.py` |
| 6 | replay test with four null comparisons | `scripts/06_replay.py` |

Run the whole downstream pipeline at a given synaptic gain with `scripts/run_variant.sh <gain>`; `1.0` is the
published model and anything below it is a labelled deviation that is reported as such.

Results are exported to `web/public/data/` and rendered by the static viewer in `web/`
(**viewer shows real outputs only; missing results render as "not yet run"**).
Plain-language findings, including negative ones, live in `results.md`.

## Setup
```bash
python3.12 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt && pip install -e .
python scripts/fetch_data.py      # pulls the v783/v630 tables + Schlegel annotations (checksummed)
```
