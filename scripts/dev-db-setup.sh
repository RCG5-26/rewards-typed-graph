#!/usr/bin/env bash
# Apply schema/schema.sql and load fixtures/demo-seed.json into local Postgres.
# Requires: docker compose, psql, python3. Run from repo root.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${DATABASE_URL:?Set DATABASE_URL (copy .env.example to .env)}"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required (install PostgreSQL client tools)." >&2
  exit 1
fi

docker compose up -d postgres

echo "Waiting for Postgres at ${DATABASE_URL}..."
ready=0
for _ in $(seq 1 30); do
  if psql "$DATABASE_URL" -c "SELECT 1" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" -ne 1 ]]; then
  echo "Postgres did not become ready within 30s." >&2
  exit 1
fi

echo "Resetting public schema..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"

echo "Applying schema/schema.sql..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f schema/schema.sql

echo "Loading demo persona (RCG-8)..."
python3 scripts/load_seed.py fixtures/demo-seed.json

echo "Done. Verify with: psql \"\$DATABASE_URL\" -c \"SELECT count(*) FROM user_balances;\""
