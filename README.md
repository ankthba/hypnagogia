# hypnagogia

**Can a whole-brain *Drosophila* connectome model spontaneously reactivate a learned memory during a simulated sleep state?**

An operational test for memory replay ("dreaming") in a leaky integrate-and-fire model of the
FlyWire FAFB v783 connectome (base model: Shiu et al. 2024, *Nature*; Brian2, C++ standalone).

Pipeline stages (each is a script under `scripts/`, config under `configs/`, outputs under `results/`):

| stage | what | script |
|---|---|---|
| 0 | reproduce the paper's sugar-GRN → MN9 result (correctness gate) | `scripts/00_reproduce_shiu.py` |
| 1 | add noise (Gaussian membrane noise or Poisson background) | `scripts/01_noise.py` |
| 2 | sweep noise, classify silent / critical / saturated with proper power-law fits | `scripts/02_criticality.py` |
| 3 | dopamine-gated KC→MBON plasticity | `scripts/03_plasticity.py` |
| 4 | encode an odor memory, verify learning | `scripts/04_encode.py` |
| 5 | sleep (dFB clamped) vs wake, noise-driven, no odor | `scripts/05_sleep.py` |
| 6 | replay test with four null comparisons | `scripts/06_replay.py` |

Results are exported to `web/public/data/` and rendered by the static viewer in `web/`
(**viewer shows real outputs only; missing results render as "not yet run"**).
Plain-language findings, including negative ones, live in `results.md`.

## Setup
```bash
python3.12 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt && pip install -e .
python scripts/fetch_data.py      # pulls the v783/v630 tables + Schlegel annotations (checksummed)
```
