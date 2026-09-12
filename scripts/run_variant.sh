#!/usr/bin/env bash
# Run the full downstream pipeline at a given synaptic-gain multiplier.
#   scripts/run_variant.sh 0.3        # the reduced-gain variant (a labelled deviation)
#   scripts/run_variant.sh 1.0        # the published model
# Every stage writes to its own gain-tagged directory, so the two tracks never mix.
set -uo pipefail   # deliberately NOT -e: a failing stage is reported and the run continues
cd "$(dirname "$0")/.."
source .venv/bin/activate
G="${1:?usage: run_variant.sh <gain> [seeds]}"
SEEDS="${2:-0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19}"
SIGMAS="${3:-0.5,1.0,1.41,1.6,1.8,2.0,2.4,2.8,3.2,4.0}"
log() { echo; echo "=== $* ==="; date; }

if [ "${SKIP_STAGE2:-0}" != "1" ]; then
log "cost of gain $G on the gustatory benchmark the published model was calibrated on"
python -u scripts/03d_gain_sensitivity.py --gustatory-cost "$G" 2>&1 | tail -6
fi

if [ "${SKIP_STAGE2:-0}" != "1" ]; then
log "stage 2 background sweep at gain $G"
python -u scripts/02_criticality.py --gain "$G" --sigmas "$SIGMAS" --seeds 0,1,2 2>&1 | tail -30
fi

if [ "${SKIP_STAGE3:-0}" != "1" ]; then
log "stage 3 plasticity calibration at gain $G"
python -u scripts/03_plasticity.py --gain "$G" 2>&1 | tail -20
fi

log "stage 4 encoding at gain $G (real network)"
python -u scripts/04_encode.py --gain "$G" --seeds "$SEEDS" 2>&1 | tail -25

log "stage 4 encoding at gain $G (degree-preserving shuffled network)"
python -u scripts/04_encode.py --gain "$G" --seeds "$SEEDS" --shuffled 2>&1 | tail -15

log "stage 5 sleep vs wake at gain $G (real)"
python -u scripts/05_sleep.py --gain "$G" --seeds "$SEEDS" 2>&1 | tail -20

log "stage 5 sleep vs wake at gain $G (shuffled)"
python -u scripts/05_sleep.py --gain "$G" --seeds "$SEEDS" --shuffled 2>&1 | tail -15

log "stage 6 replay test at gain $G"
python -u scripts/06_replay.py --gain "$G" --seeds "$SEEDS" 2>&1 | tail -25

log "export + results.md"
python -u scripts/export_web.py 2>&1 | tail -12
python -u scripts/make_results.py 2>&1 | tail -3
log "variant $G complete"
