#!/usr/bin/env bash
# Sensitivity sweep over the Kenyon-cell axonal recurrence: a LABELLED DEVIATION, run alongside the published
# model and never instead of it. retained=1.0 is the published model, retained=0.0 is the literature's
# position that the axonal interaction is metabotropic and not fast nicotinic. Stage 2 only: the question at
# this stage is whether removing that recurrence gives the network a quiet, pausing background, which is the
# precondition for every replay statistic and which the published model does not have.
set -uo pipefail
cd "$(dirname "$0")/.."
source .venv/bin/activate
export HYPNAGOGIA_DEVIATION=kc_kc_axonal_not_nicotinic
SIGMAS="0.5,1.0,1.4,1.5,1.6,1.8,2.0,2.4,3.0,4.0"
for R in 0.0 0.5; do
  export HYPNAGOGIA_DEVIATION_RETAINED=$R
  echo; echo "=== stage 2, Kenyon-cell recurrence retained = $R ==="; date
  python -u scripts/02_criticality.py --gain 1.0 --sigmas "$SIGMAS" --seeds 0,1,2 --tag "_kckc$R" 2>&1 | tail -22
done
echo; echo "=== sweep complete ==="; date
