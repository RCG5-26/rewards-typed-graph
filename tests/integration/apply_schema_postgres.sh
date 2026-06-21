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

INSERT INTO plans (
  id,
  user_id,
  plan_lineage_id,
  revision_number,
  query_text,
  status
)
VALUES (
  '00000000-0000-0000-0000-000000000498',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000498',
  1,
  'Backstop trigger coverage plan.',
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
  '00000000-0000-0000-0000-000000000598',
  '00000000-0000-0000-0000-000000000498',
  '00000000-0000-0000-0000-000000000498',
  1,
  1,
  'transfer_recommendation',
  'current',
  '{"claim": "Watch the Hyatt balance."}'
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
  '00000000-0000-0000-0000-000000000698',
  '00000000-0000-0000-0000-000000000598',
  '00000000-0000-0000-0000-000000000302',
  'UserBalance',
  'user_balances',
  'balance_points',
  1,
  '{"balance_points": 0}'
);

UPDATE user_balances
   SET balance_points = 5,
       version = version + 1,
       updated_at = now()
 WHERE id = '00000000-0000-0000-0000-000000000302';

DO $$
DECLARE
  plan_status text;
  step_status text;
  job_count integer;
BEGIN
  SELECT status INTO plan_status
  FROM plans
  WHERE id = '00000000-0000-0000-0000-000000000498';

  SELECT status INTO step_status
  FROM plan_steps
  WHERE id = '00000000-0000-0000-0000-000000000598';

  SELECT count(*) INTO job_count
  FROM replan_jobs
  WHERE source_plan_id = '00000000-0000-0000-0000-000000000498';

  IF plan_status <> 'stale' THEN
    RAISE EXCEPTION 'expected trigger-backstop plan stale, got %', plan_status;
  END IF;

  IF step_status <> 'stale' THEN
    RAISE EXCEPTION 'expected trigger-backstop step stale, got %', step_status;
  END IF;

  IF job_count <> 0 THEN
    RAISE EXCEPTION 'expected trigger backstop to skip job enqueue, got %', job_count;
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
  2,
  'transfer-123',
  'request-hash-123',
  'wallet_agent'
);

INSERT INTO idempotency_records (
  user_id,
  operation_type,
  idempotency_key,
  request_hash,
  status
)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'TransferPoints',
  'transfer-in-progress',
  'request-hash-in-progress',
  'in_progress'
);

DO $$
BEGIN
  BEGIN
    PERFORM transfer_points(
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000301',
      '00000000-0000-0000-0000-000000000302',
      1000,
      2,
      2,
      'transfer-in-progress',
      'request-hash-in-progress',
      'wallet_agent'
    );
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%idempotency request already in progress%' THEN
        RETURN;
      END IF;

      RAISE;
  END;

  RAISE EXCEPTION 'expected in-progress idempotency request to fail';
END;
$$;

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

INSERT INTO plans (
  id,
  user_id,
  plan_lineage_id,
  revision_number,
  query_text,
  status,
  created_at
)
VALUES (
  '00000000-0000-0000-0000-000000000497',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000490',
  1,
  'Already exhausted re-plan.',
  'stale',
  now() - interval '1 day'
);

INSERT INTO replan_jobs (
  id,
  user_id,
  plan_lineage_id,
  source_plan_id,
  trigger_mutation_txn_id,
  idempotency_key,
  status,
  attempt_count,
  max_attempts,
  available_at,
  created_at
)
VALUES (
  '00000000-0000-0000-0000-000000000701',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000490',
  '00000000-0000-0000-0000-000000000497',
  '00000000-0000-0000-0000-000000000702',
  'exhausted-replan-job',
  'pending',
  3,
  3,
  now() - interval '1 day',
  now() - interval '1 day'
);

SELECT *
FROM claim_replan_jobs('worker-1', 1, interval '5 minutes');

DO $$
DECLARE
  exhausted_status text;
  exhausted_attempts integer;
  active_status text;
BEGIN
  SELECT status, attempt_count
    INTO exhausted_status, exhausted_attempts
  FROM replan_jobs
  WHERE id = '00000000-0000-0000-0000-000000000701';

  SELECT status INTO active_status
  FROM replan_jobs
  WHERE source_plan_id = '00000000-0000-0000-0000-000000000401';

  IF exhausted_status <> 'pending' THEN
    RAISE EXCEPTION 'expected exhausted job to remain pending, got %', exhausted_status;
  END IF;

  IF exhausted_attempts <> 3 THEN
    RAISE EXCEPTION 'expected exhausted job attempt_count to remain 3, got %', exhausted_attempts;
  END IF;

  IF active_status <> 'processing' THEN
    RAISE EXCEPTION 'expected claimable job processing, got %', active_status;
  END IF;
END;
$$;

INSERT INTO plans (
  id,
  user_id,
  plan_lineage_id,
  revision_number,
  query_text,
  status
)
VALUES (
  '00000000-0000-0000-0000-000000000499',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000400',
  99,
  'Find the best Tokyo redemption.',
  'generating'
);

DO $$
DECLARE
  active_job_id uuid;
BEGIN
  SELECT id INTO active_job_id
  FROM replan_jobs
  WHERE source_plan_id = '00000000-0000-0000-0000-000000000401';

  BEGIN
    PERFORM promote_replan_job_success(
      active_job_id,
      'worker-1',
      '00000000-0000-0000-0000-000000000499'
    );

    RAISE EXCEPTION 'expected invalid successor promotion to fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%result plan is not direct successor of source plan%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

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
