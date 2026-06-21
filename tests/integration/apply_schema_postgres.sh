#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

psql \
  --set ON_ERROR_STOP=1 \
  --file "${repo_root}/schema/schema.sql"

psql --set ON_ERROR_STOP=1 <<'SQL'
INSERT INTO users (id, clerk_id, email)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'clerk_user_demo',
  'demo@example.com'
);

INSERT INTO reward_programs (
  id,
  slug,
  name,
  program_kind,
  currency_name
)
VALUES
  (
    '00000000-0000-0000-0000-000000000101',
    'chase-ultimate-rewards',
    'Chase Ultimate Rewards',
    'issuer_transferable',
    'points'
  ),
  (
    '00000000-0000-0000-0000-000000000102',
    'world-of-hyatt',
    'World of Hyatt',
    'hotel',
    'points'
  );

INSERT INTO transfers_to (
  id,
  source_program_id,
  dest_program_id,
  transfer_ratio_basis_points,
  transfer_time_days
)
VALUES (
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000102',
  10000,
  1
);

INSERT INTO user_balances (
  id,
  user_id,
  program_id,
  balance_points,
  version
)
VALUES
  (
    '00000000-0000-0000-0000-000000000301',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000101',
    240000,
    1
  ),
  (
    '00000000-0000-0000-0000-000000000302',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000102',
    0,
    1
  );

INSERT INTO plans (
  id,
  user_id,
  plan_lineage_id,
  revision_number,
  query_text,
  status
)
VALUES (
  '00000000-0000-0000-0000-000000000401',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000400',
  1,
  'Find the best Tokyo redemption.',
  'current'
);

INSERT INTO plan_steps (
  id,
  plan_id,
  plan_lineage_id,
  revision_number,
  step_order,
  step_type,
  status,
  payload
)
VALUES (
  '00000000-0000-0000-0000-000000000501',
  '00000000-0000-0000-0000-000000000401',
  '00000000-0000-0000-0000-000000000400',
  1,
  1,
  'transfer_recommendation',
  'current',
  '{"claim": "Transfer Chase points to Hyatt."}'
);

INSERT INTO state_dependencies (
  id,
  plan_step_id,
  target_node_id,
  target_node_type,
  target_table,
  depended_property,
  observed_version,
  snapshot_value
)
VALUES (
  '00000000-0000-0000-0000-000000000601',
  '00000000-0000-0000-0000-000000000501',
  '00000000-0000-0000-0000-000000000301',
  'UserBalance',
  'user_balances',
  'balance_points',
  0,
  '{"balance_points": 240000}'
);

DO $$
DECLARE
  stale_count integer;
BEGIN
  SELECT count(*) INTO stale_count
  FROM stale_plan_steps;

  IF stale_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly one stale plan step, got %', stale_count;
  END IF;
END;
$$;

SELECT *
FROM transfer_points(
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000301',
  '00000000-0000-0000-0000-000000000302',
  60000,
  1,
  1,
  'transfer-123',
  'request-hash-123',
  'wallet_agent'
);

DO $$
DECLARE
  plan_status text;
  step_status text;
  job_count integer;
BEGIN
  SELECT status INTO plan_status
  FROM plans
  WHERE id = '00000000-0000-0000-0000-000000000401';

  SELECT status INTO step_status
  FROM plan_steps
  WHERE id = '00000000-0000-0000-0000-000000000501';

  SELECT count(*) INTO job_count
  FROM replan_jobs
  WHERE source_plan_id = '00000000-0000-0000-0000-000000000401'
    AND status = 'pending';

  IF plan_status <> 'stale' THEN
    RAISE EXCEPTION 'expected source plan stale, got %', plan_status;
  END IF;

  IF step_status <> 'stale' THEN
    RAISE EXCEPTION 'expected source step stale, got %', step_status;
  END IF;

  IF job_count <> 1 THEN
    RAISE EXCEPTION 'expected one pending replan job, got %', job_count;
  END IF;
END;
$$;

SELECT *
FROM claim_replan_jobs('worker-1', 1, interval '5 minutes');

INSERT INTO plans (
  id,
  user_id,
  plan_lineage_id,
  revision_number,
  supersedes_plan_id,
  query_text,
  status
)
VALUES (
  '00000000-0000-0000-0000-000000000402',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000400',
  2,
  '00000000-0000-0000-0000-000000000401',
  'Find the best Tokyo redemption.',
  'generating'
);

INSERT INTO plan_steps (
  id,
  plan_id,
  plan_lineage_id,
  revision_number,
  supersedes_plan_step_id,
  step_order,
  step_type,
  status,
  payload
)
VALUES (
  '00000000-0000-0000-0000-000000000502',
  '00000000-0000-0000-0000-000000000402',
  '00000000-0000-0000-0000-000000000400',
  2,
  '00000000-0000-0000-0000-000000000501',
  1,
  'transfer_recommendation',
  'proposed',
  '{"claim": "Transfer fewer Chase points to Hyatt after balance update."}'
);

SELECT *
FROM promote_replan_job_success(
  (
    SELECT id
    FROM replan_jobs
    WHERE source_plan_id = '00000000-0000-0000-0000-000000000401'
  ),
  'worker-1',
  '00000000-0000-0000-0000-000000000402'
);

DO $$
DECLARE
  source_status text;
  result_status text;
  source_step_status text;
  result_step_status text;
  job_status text;
BEGIN
  SELECT status INTO source_status
  FROM plans
  WHERE id = '00000000-0000-0000-0000-000000000401';

  SELECT status INTO result_status
  FROM plans
  WHERE id = '00000000-0000-0000-0000-000000000402';

  SELECT status INTO source_step_status
  FROM plan_steps
  WHERE id = '00000000-0000-0000-0000-000000000501';

  SELECT status INTO result_step_status
  FROM plan_steps
  WHERE id = '00000000-0000-0000-0000-000000000502';

  SELECT status INTO job_status
  FROM replan_jobs
  WHERE source_plan_id = '00000000-0000-0000-0000-000000000401';

  IF source_status <> 'superseded' THEN
    RAISE EXCEPTION 'expected source plan superseded, got %', source_status;
  END IF;

  IF result_status <> 'current' THEN
    RAISE EXCEPTION 'expected result plan current, got %', result_status;
  END IF;

  IF source_step_status <> 'superseded' THEN
    RAISE EXCEPTION 'expected source step superseded, got %', source_step_status;
  END IF;

  IF result_step_status <> 'current' THEN
    RAISE EXCEPTION 'expected result step current, got %', result_step_status;
  END IF;

  IF job_status <> 'completed' THEN
    RAISE EXCEPTION 'expected job completed, got %', job_status;
  END IF;
END;
$$;
SQL
