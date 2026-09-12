#!/usr/bin/env bash
# Resume the pipeline from stage 5 after an interrupted run. Completed simulations are reused; only the
# missing ones are recomputed. Runs stages 5, 6 and 6b, then the export, the contract check and results.md.
set -uo pipefail
cd "$(dirname "$0")/.."
source .venv/bin/activate
G=1.0
SEEDS="0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19"
log() { echo; echo "=== $* ==="; date; }

log "stage 5 sleep vs wake at gain $G (real)"
python -u scripts/05_sleep.py --gain "$G" --seeds "$SEEDS" 2>&1 | tail -20

log "stage 5 sleep vs wake at gain $G (shuffled)"
python -u scripts/05_sleep.py --gain "$G" --seeds "$SEEDS" --shuffled 2>&1 | tail -15

log "stage 6 replay test at gain $G"
python -u scripts/06_replay.py --gain "$G" --seeds "$SEEDS" 2>&1 | tail -25

log "stage 6b structural confound"
python -u scripts/06b_structure.py --gain "$G" 2>&1 | tail -8

log "stage 3a: the APL correction"
python -u scripts/03a_apl_correction.py 2>&1 | tail -12

log "stage 3f: the DPM transmitter correction"
python -u scripts/03f_dpm_correction.py --gain 1.0 2>&1 | tail -4

log "stage 3e: do two odours leave two ensembles, on the corrected network?"
python -u scripts/03e_discriminability.py 2>&1 | tail -10

log "export + contract check + results.md"
python -u scripts/export_web.py 2>&1 | tail -12
python -u scripts/validate_export.py 2>&1 | tail -16
python -u scripts/make_results.py 2>&1 | tail -2

log "resume complete"
