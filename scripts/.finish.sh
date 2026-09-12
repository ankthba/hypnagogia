#!/usr/bin/env bash
# Final pass once the pipeline has produced stage 6: refresh the two correction measurements with the
# current wording and diagnostics, re-export, validate the contract, regenerate results.md.
set -uo pipefail
cd "$(dirname "$0")/.."
source .venv/bin/activate
log() { echo; echo "=== $* ==="; date; }

log "stage 3a: the APL correction"
python -u scripts/03a_apl_correction.py 2>&1 | tail -14

log "stage 3f: the DPM transmitter correction"
python -u scripts/03f_dpm_correction.py --gain 1.0 2>&1 | tail -6

log "export + contract check + results.md"
python -u scripts/export_web.py 2>&1 | tail -12
python -u scripts/validate_export.py 2>&1 | tail -16
python -u scripts/make_results.py 2>&1 | tail -2

log "finish complete"
