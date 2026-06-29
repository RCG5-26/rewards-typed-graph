#!/usr/bin/env bash
#
# Reset the canonical demo persona (a001) to its seeded "transfer-required"
# state BETWEEN live comparison/replan runs.
#
# Why: the "Complete 15,000-point transfer" replan mutates a001's balances
# (Chase -15k / Hyatt +15k). After a full demo cycle Hyatt is 45k, so the next
# run's "transfer-required" scenario no longer holds (the award is already
# affordable). Re-seeding restores Chase 180k / Hyatt 30k / United 30k (v1).
#
# Usage:  ./scripts/reset-demo-run.sh        (or: npm run demo:reset)
#
set -euo pipefail
cd "$(dirname "$0")/.."

# Load DB credentials from .env (values are never printed).
set -a
# shellcheck disable=SC1091
. ./.env
set +a

PYTHON_BIN="${PYTHON_BIN:-python3.12}"
DBURL="${DATABASE_URL:-${PG_DATABASE_URL:-}}"
if [ -z "${DBURL}" ]; then
  echo "error: DATABASE_URL not set (check .env)" >&2
  exit 1
fi

echo "Resetting demo persona a001 to canonical (Chase 180k / Hyatt 30k / United 30k)…"
"${PYTHON_BIN}" scripts/ensure_schema_seed.py --include-demo-persona >/dev/null

echo "Balances after reset:"
psql "${DBURL}" -tA -F' | ' -c "
  SELECT p.name, b.balance_points, b.version
  FROM user_balances b
  JOIN reward_programs p ON p.id = b.program_id
  WHERE b.user_id = '00000000-0000-0000-0000-00000000a001'
  ORDER BY b.balance_points DESC;"

echo "Reset complete — start the next comparison run."
