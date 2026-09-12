#!/usr/bin/env bash
# The Kenyon-cell recurrence arm: a LABELLED DEVIATION, run alongside the published model, not instead of it.
# Removes the fast excitatory conductance from KC->KC synapses in the mushroom body lobes whose postsynaptic
# cell is an alpha/beta or gamma Kenyon cell, which is 763,745 synapses and 36.7% of everything landing on
# Kenyon cells. Every stage writes to its own _kckc directory so the two tracks never mix.
set -uo pipefail
cd "$(dirname "$0")/.."
source .venv/bin/activate
export HYPNAGOGIA_DEVIATION=kc_kc_axonal_not_nicotinic
SEEDS="0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19"
log() { echo; echo "=== $* ==="; date; }

log "stage 2 background sweep, recurrence arm"
python -u scripts/02_criticality.py --gain 1.0 --sigmas "0.5,1.0,1.4,1.5,1.6,1.8,2.0,2.4,3.0,4.0,5.0,6.0" --seeds 0,1,2 --tag _kckc 2>&1 | tail -26

log "stage 3 plasticity calibration, recurrence arm"
python -u scripts/03_plasticity.py --gain 1.0 --tag _kckc 2>&1 | tail -12

log "stage 4 encoding, recurrence arm"
python -u scripts/04_encode.py --gain 1.0 --seeds "$SEEDS" --tag _kckc 2>&1 | tail -18

log "stage 5 sleep vs wake, recurrence arm"
python -u scripts/05_sleep.py --gain 1.0 --seeds "$SEEDS" --tag _kckc 2>&1 | tail -18

log "stage 6 replay test, recurrence arm"
python -u scripts/06_replay.py --gain 1.0 --seeds "$SEEDS" --tag _kckc --out-tag _kckc 2>&1 | tail -22

log "recurrence arm complete"
