#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

psql \
  --set ON_ERROR_STOP=1 \
  --file "${repo_root}/schema/schema.sql"

psql --set ON_ERROR_STOP=1 <<'SQL'
INSERT INTO nodes (id, type, tier, attributes, version)
VALUES
  (
    '00000000-0000-0000-0000-000000000101',
    'PlanStep',
    'plan',
    '{"plan_lineage_id": "plan-lineage-1", "revision_number": 1, "step_order": 1, "agent": "redemption_agent", "claim": "Malformed dependency test", "inputs": {}, "output": {}, "status": "active"}',
    0
  ),
  (
    '00000000-0000-0000-0000-000000000102',
    'Balance',
    'personal',
    '{"program_id": "00000000-0000-0000-0000-000000000201", "amount_points": 240000, "as_of": "2026-06-17T00:00:00Z", "source": "manual_entry"}',
    1
  ),
  (
    '00000000-0000-0000-0000-000000000103',
    'PlanStep',
    'plan',
    '{"plan_lineage_id": "plan-lineage-2", "revision_number": 1, "step_order": 2, "agent": "redemption_agent", "claim": "Valid dependency test", "inputs": {}, "output": {}, "status": "active"}',
    0
  ),
  (
    '00000000-0000-0000-0000-000000000104',
    'Balance',
    'personal',
    '{"program_id": "00000000-0000-0000-0000-000000000202", "amount_points": 180000, "as_of": "2026-06-20T00:00:00Z", "source": "manual_entry"}',
    1
  );

INSERT INTO edges (type, source_id, target_id, attributes)
VALUES
  (
    'DEPENDS_ON',
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000102',
    '{"observed_version": "not-an-integer", "observed_value": 240000}'
  ),
  (
    'DEPENDS_ON',
    '00000000-0000-0000-0000-000000000103',
    '00000000-0000-0000-0000-000000000104',
    '{"observed_version": 0, "observed_value": 240000}'
  );

DO $$
DECLARE
  stale_count integer;
  malformed_count integer;
BEGIN
  SELECT count(*) INTO stale_count
  FROM stale_plan_steps;

  IF stale_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly one stale plan step, got %', stale_count;
  END IF;

  SELECT count(*) INTO malformed_count
  FROM stale_plan_steps
  WHERE plan_step_id = '00000000-0000-0000-0000-000000000101';

  IF malformed_count <> 0 THEN
    RAISE EXCEPTION 'malformed observed_version row should be excluded from stale_plan_steps';
  END IF;
END;
$$;

SELECT id, version
FROM mark_plan_step_stale(
  '00000000-0000-0000-0000-000000000103',
  'Balance:00000000-0000-0000-0000-000000000104 version changed from 0 to 1'
);

DO $$
DECLARE
  supersede_count integer;
  source_status text;
  source_successor text;
BEGIN
  SELECT count(*) INTO supersede_count
  FROM supersede_plan_step(
    '00000000-0000-0000-0000-000000000103',
    '{
      "plan_lineage_id": "plan-lineage-2",
      "revision_number": 2,
      "step_order": 2,
      "agent": "redemption_agent",
      "claim": "Replacement dependency test",
      "inputs": {},
      "output": {},
      "status": "active",
      "stale_reason": null,
      "supersedes_plan_step_id": "00000000-0000-0000-0000-000000000103",
      "superseded_by_plan_step_id": null
    }'
  );

  IF supersede_count <> 1 THEN
    RAISE EXCEPTION 'expected supersede_plan_step to create one successor, got %', supersede_count;
  END IF;

  SELECT
    attributes->>'status',
    attributes->>'superseded_by_plan_step_id'
  INTO source_status, source_successor
  FROM nodes
  WHERE id = '00000000-0000-0000-0000-000000000103';

  IF source_status <> 'superseded' THEN
    RAISE EXCEPTION 'expected source step to be superseded, got %', source_status;
  END IF;

  IF source_successor IS NULL THEN
    RAISE EXCEPTION 'expected source step to point at successor';
  END IF;
END;
$$;
SQL
