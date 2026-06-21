CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id TEXT NOT NULL UNIQUE,
  email TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  tier TEXT NOT NULL,
  user_id UUID NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NULL,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT nodes_type_check CHECK (
    type IN (
      'User',
      'Card',
      'Program',
      'MerchantCategory',
      'Balance',
      'Goal',
      'PlanQuery',
      'PlanStep'
    )
  ),

  CONSTRAINT nodes_tier_check CHECK (
    tier IN ('world', 'personal', 'plan')
  ),

  CONSTRAINT nodes_version_nonnegative CHECK (version >= 0)
);

CREATE UNIQUE INDEX nodes_slug_unique
  ON nodes (slug)
  WHERE slug IS NOT NULL;

CREATE INDEX nodes_type_idx ON nodes (type);
CREATE INDEX nodes_tier_idx ON nodes (tier);
CREATE INDEX nodes_user_id_idx ON nodes (user_id);
CREATE INDEX nodes_attributes_gin_idx ON nodes USING gin (attributes);

CREATE UNIQUE INDEX balance_one_per_user_program_unique
  ON nodes (user_id, (attributes->>'program_id'))
  WHERE type = 'Balance';

CREATE TABLE edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  source_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT edges_type_check CHECK (
    type IN (
      'HOLDS',
      'ASSOCIATED_WITH',
      'EARNS',
      'HAS_BALANCE',
      'BALANCE_FOR',
      'HAS_GOAL',
      'FOR_USER',
      'TRANSFERS_TO',
      'TARGETS',
      'STEP_OF',
      'DEPENDS_ON'
    )
  ),

  CONSTRAINT edges_version_nonnegative CHECK (version >= 0),
  CONSTRAINT edges_no_self_loop CHECK (source_id <> target_id)
);

CREATE INDEX edges_type_idx ON edges (type);
CREATE INDEX edges_source_idx ON edges (source_id);
CREATE INDEX edges_target_idx ON edges (target_id);
CREATE INDEX edges_source_type_idx ON edges (source_id, type);
CREATE INDEX edges_target_type_idx ON edges (target_id, type);
CREATE INDEX edges_attributes_gin_idx ON edges USING gin (attributes);

CREATE UNIQUE INDEX edges_unique_active_relationship
  ON edges (type, source_id, target_id);

CREATE TABLE graph_mutations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence BIGINT GENERATED ALWAYS AS IDENTITY,
  mutation_txn_id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  event_type TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id UUID NOT NULL,
  target_type TEXT NOT NULL,
  before_value JSONB NULL,
  after_value JSONB NULL,
  resulting_version INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT graph_mutations_event_type_check CHECK (
    event_type IN (
      'create_node',
      'update_node',
      'create_edge',
      'update_edge',
      'mark_stale',
      'supersede_plan_step',
      'transfer_points'
    )
  ),

  CONSTRAINT graph_mutations_target_kind_check CHECK (
    target_kind IN ('node', 'edge')
  )
);

CREATE INDEX graph_mutations_user_sequence_idx ON graph_mutations (user_id, sequence);
CREATE INDEX graph_mutations_created_at_idx ON graph_mutations (created_at);
CREATE INDEX graph_mutations_target_idx ON graph_mutations (target_kind, target_id);
CREATE INDEX graph_mutations_actor_idx ON graph_mutations (actor);

CREATE TABLE replan_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_lineage_id TEXT NOT NULL,
  source_plan_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  trigger_mutation_txn_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ NULL,
  locked_by TEXT NULL,
  lease_expires_at TIMESTAMPTZ NULL,
  result_plan_id UUID NULL REFERENCES nodes(id),
  error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL,

  CONSTRAINT replan_jobs_status_check CHECK (
    status IN ('pending', 'processing', 'completed', 'failed', 'superseded')
  ),
  CONSTRAINT replan_jobs_attempt_count_nonnegative CHECK (attempt_count >= 0),
  CONSTRAINT replan_jobs_max_attempts_positive CHECK (max_attempts > 0)
);

CREATE INDEX replan_jobs_claim_idx
  ON replan_jobs (status, available_at, lease_expires_at);
CREATE INDEX replan_jobs_user_status_idx ON replan_jobs (user_id, status);
CREATE UNIQUE INDEX replan_jobs_open_source_unique
  ON replan_jobs (source_plan_id)
  WHERE status IN ('pending', 'processing');
CREATE UNIQUE INDEX replan_jobs_idempotency_key_unique
  ON replan_jobs (user_id, plan_lineage_id, trigger_mutation_txn_id, idempotency_key);

CREATE TABLE idempotency_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  mutation_txn_id UUID NULL,
  status TEXT NOT NULL DEFAULT 'in_progress',
  result_reference JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT idempotency_records_status_check CHECK (
    status IN ('in_progress', 'completed', 'failed')
  ),
  UNIQUE (user_id, operation_type, idempotency_key)
);

CREATE TABLE agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_lineage_id TEXT NULL,
  agent_type TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  token_count INTEGER NULL,
  error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT agent_runs_status_check CHECK (
    status IN ('running', 'completed', 'failed', 'timed_out')
  )
);

CREATE INDEX agent_runs_user_lineage_idx ON agent_runs (user_id, plan_lineage_id);

CREATE TABLE benchmark_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  query_text TEXT NOT NULL,
  ground_truth JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  benchmark_query_id UUID NULL REFERENCES benchmark_queries(id),
  plan_lineage_id TEXT NULL,
  baseline_plan_lineage_id TEXT NULL,
  total_value_cents INTEGER NULL,
  baseline_value_cents INTEGER NULL,
  improvement_basis_points INTEGER NULL,
  accuracy_score BOOLEAN NULL,
  hallucination_count INTEGER NULL,
  token_cost_total INTEGER NULL,
  plan_invalidation_correct BOOLEAN NULL,
  domain_extension_correct BOOLEAN NULL,
  metric_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  evaluator_version TEXT NOT NULL DEFAULT 'mvp-v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX evaluations_benchmark_query_idx ON evaluations (benchmark_query_id);
CREATE INDEX evaluations_user_lineage_idx ON evaluations (user_id, plan_lineage_id);

CREATE VIEW stale_plan_steps AS
WITH dependency_versions AS MATERIALIZED (
  SELECT
    plan_step.id AS plan_step_id,
    plan_step.attributes AS plan_step_attributes,
    depended_node.id AS depended_node_id,
    depended_node.type AS depended_node_type,
    depended_node.version AS current_version,
    CASE
      WHEN jsonb_typeof(dep.attributes->'observed_version') IN ('number', 'string')
        AND dep.attributes->>'observed_version' ~ '^-?[0-9]+$'
      THEN (dep.attributes->>'observed_version')::integer
    END AS observed_version
  FROM edges dep
  JOIN nodes plan_step
    ON plan_step.id = dep.source_id
  JOIN nodes depended_node
    ON depended_node.id = dep.target_id
  WHERE dep.type = 'DEPENDS_ON'
    AND plan_step.type = 'PlanStep'
    AND COALESCE(plan_step.attributes->>'status', '') NOT IN (
      'stale',
      'superseded',
      'completed',
      'failed'
    )
)
SELECT
  plan_step_id,
  plan_step_attributes,
  depended_node_id,
  depended_node_type,
  current_version,
  observed_version
FROM dependency_versions
WHERE observed_version IS NOT NULL
  AND current_version <> observed_version;

CREATE FUNCTION transfer_points(
  p_user_id UUID,
  p_source_balance_id UUID,
  p_dest_balance_id UUID,
  p_amount_points INTEGER,
  p_source_expected_version INTEGER,
  p_dest_expected_version INTEGER,
  p_idempotency_key TEXT,
  p_request_hash TEXT,
  p_actor TEXT DEFAULT 'wallet_agent'
)
RETURNS TABLE (
  source_balance_id UUID,
  source_version INTEGER,
  dest_balance_id UUID,
  dest_version INTEGER,
  idempotency_replayed BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  existing_idempotency idempotency_records%ROWTYPE;
  source_balance nodes%ROWTYPE;
  dest_balance nodes%ROWTYPE;
  source_before JSONB;
  dest_before JSONB;
  source_after JSONB;
  dest_after JSONB;
  source_amount INTEGER;
  dest_amount INTEGER;
  new_source_version INTEGER;
  new_dest_version INTEGER;
  response_payload JSONB;
  v_mutation_txn_id UUID := gen_random_uuid();
  stale_step RECORD;
BEGIN
  IF p_amount_points <= 0 THEN
    RAISE EXCEPTION 'amount_points must be greater than 0';
  END IF;

  SELECT *
    INTO existing_idempotency
    FROM idempotency_records
   WHERE user_id = p_user_id
     AND operation_type = 'TransferPoints'
     AND idempotency_key = p_idempotency_key
   FOR UPDATE;

  IF FOUND THEN
    IF existing_idempotency.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'idempotency key reused with different request';
    END IF;

    IF existing_idempotency.status = 'completed' THEN
      source_balance_id := (existing_idempotency.result_reference->>'source_balance_id')::uuid;
      source_version := (existing_idempotency.result_reference->>'source_version')::integer;
      dest_balance_id := (existing_idempotency.result_reference->>'dest_balance_id')::uuid;
      dest_version := (existing_idempotency.result_reference->>'dest_version')::integer;
      idempotency_replayed := true;
      RETURN NEXT;
      RETURN;
    END IF;
  ELSE
    INSERT INTO idempotency_records (
      user_id,
      operation_type,
      idempotency_key,
      request_hash,
      mutation_txn_id,
      status
    )
    VALUES (
      p_user_id,
      'TransferPoints',
      p_idempotency_key,
      p_request_hash,
      v_mutation_txn_id,
      'in_progress'
    );
  END IF;

  SELECT *
    INTO source_balance
    FROM nodes
   WHERE id = p_source_balance_id
     AND type = 'Balance'
     AND user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'source balance does not exist';
  END IF;

  SELECT *
    INTO dest_balance
    FROM nodes
   WHERE id = p_dest_balance_id
     AND type = 'Balance'
     AND user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'destination balance does not exist';
  END IF;

  IF source_balance.version <> p_source_expected_version THEN
    RAISE EXCEPTION 'source balance version conflict';
  END IF;

  IF dest_balance.version <> p_dest_expected_version THEN
    RAISE EXCEPTION 'destination balance version conflict';
  END IF;

  source_amount := (source_balance.attributes->>'amount_points')::integer;
  dest_amount := (dest_balance.attributes->>'amount_points')::integer;

  IF source_amount < p_amount_points THEN
    RAISE EXCEPTION 'insufficient source balance';
  END IF;

  source_before := source_balance.attributes;
  dest_before := dest_balance.attributes;
  source_after := jsonb_set(
    source_before,
    '{amount_points}',
    to_jsonb(source_amount - p_amount_points)
  );
  dest_after := jsonb_set(
    dest_before,
    '{amount_points}',
    to_jsonb(dest_amount + p_amount_points)
  );

  UPDATE nodes
     SET attributes = source_after,
         version = version + 1,
         updated_at = now()
   WHERE id = p_source_balance_id
  RETURNING version INTO new_source_version;

  UPDATE nodes
     SET attributes = dest_after,
         version = version + 1,
         updated_at = now()
   WHERE id = p_dest_balance_id
  RETURNING version INTO new_dest_version;

  INSERT INTO graph_mutations (
    mutation_txn_id,
    user_id,
    actor,
    event_type,
    target_kind,
    target_id,
    target_type,
    before_value,
    after_value,
    resulting_version
  )
  VALUES
    (
      v_mutation_txn_id,
      p_user_id,
      p_actor,
      'transfer_points',
      'node',
      p_source_balance_id,
      'Balance',
      source_before,
      source_after,
      new_source_version
    ),
    (
      v_mutation_txn_id,
      p_user_id,
      p_actor,
      'transfer_points',
      'node',
      p_dest_balance_id,
      'Balance',
      dest_before,
      dest_after,
      new_dest_version
    );

  FOR stale_step IN
    SELECT DISTINCT
      stale.plan_step_id,
      step.user_id,
      step.attributes->>'plan_lineage_id' AS plan_lineage_id,
      plan_node.id AS source_plan_id
    FROM stale_plan_steps stale
    JOIN nodes step ON step.id = stale.plan_step_id
    JOIN edges step_of
      ON step_of.source_id = step.id
     AND step_of.type = 'STEP_OF'
    JOIN nodes plan_node
      ON plan_node.id = step_of.target_id
     AND plan_node.type = 'PlanQuery'
    WHERE stale.depended_node_id IN (p_source_balance_id, p_dest_balance_id)
      AND step.user_id = p_user_id
  LOOP
    PERFORM mark_plan_step_stale(
      stale_step.plan_step_id,
      'Balance dependency changed during TransferPoints'
    );

    INSERT INTO replan_jobs (
      user_id,
      plan_lineage_id,
      source_plan_id,
      trigger_mutation_txn_id,
      idempotency_key,
      status
    )
    VALUES (
      p_user_id,
      COALESCE(stale_step.plan_lineage_id, stale_step.source_plan_id::text),
      stale_step.source_plan_id,
      v_mutation_txn_id,
      p_idempotency_key,
      'pending'
    )
    ON CONFLICT (source_plan_id)
      WHERE status IN ('pending', 'processing')
      DO NOTHING;
  END LOOP;

  response_payload := jsonb_build_object(
    'source_balance_id', p_source_balance_id,
    'source_version', new_source_version,
    'dest_balance_id', p_dest_balance_id,
    'dest_version', new_dest_version
  );

  UPDATE idempotency_records
     SET status = 'completed',
         mutation_txn_id = v_mutation_txn_id,
         result_reference = response_payload,
         updated_at = now()
   WHERE user_id = p_user_id
     AND operation_type = 'TransferPoints'
     AND idempotency_key = p_idempotency_key;

  source_balance_id := p_source_balance_id;
  source_version := new_source_version;
  dest_balance_id := p_dest_balance_id;
  dest_version := new_dest_version;
  idempotency_replayed := false;
  RETURN NEXT;
END;
$$;

CREATE FUNCTION claim_replan_jobs(
  p_worker_id TEXT,
  p_limit INTEGER DEFAULT 10,
  p_lease_duration INTERVAL DEFAULT interval '30 seconds'
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  plan_lineage_id TEXT,
  source_plan_id UUID,
  attempt_count INTEGER
)
LANGUAGE sql
AS $$
  WITH claimable AS (
    SELECT job.id
     FROM replan_jobs job
     WHERE job.available_at <= now()
       AND (
         job.status = 'pending'
         OR (
           job.status = 'processing'
           AND job.lease_expires_at < now()
         )
       )
     ORDER BY job.created_at
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  )
  UPDATE replan_jobs job
     SET status = 'processing',
         locked_at = now(),
         locked_by = p_worker_id,
         lease_expires_at = now() + p_lease_duration,
         attempt_count = attempt_count + 1,
         updated_at = now()
    FROM claimable
   WHERE job.id = claimable.id
  RETURNING
    job.id,
    job.user_id,
    job.plan_lineage_id,
    job.source_plan_id,
    job.attempt_count;
$$;

CREATE VIEW node_connectivity_violations AS
SELECT
  n.id AS node_id,
  n.type AS node_type,
  'missing one of FOR_USER, HOLDS, HAS_BALANCE, HAS_GOAL' AS violation
FROM nodes n
WHERE n.type = 'User'
  AND NOT EXISTS (
    SELECT 1
    FROM edges e
    WHERE (e.source_id = n.id OR e.target_id = n.id)
      AND e.type IN ('FOR_USER', 'HOLDS', 'HAS_BALANCE', 'HAS_GOAL')
  )
UNION ALL
SELECT
  n.id AS node_id,
  n.type AS node_type,
  'missing one of HOLDS, ASSOCIATED_WITH, EARNS' AS violation
FROM nodes n
WHERE n.type = 'Card'
  AND NOT EXISTS (
    SELECT 1
    FROM edges e
    WHERE (e.source_id = n.id OR e.target_id = n.id)
      AND e.type IN ('HOLDS', 'ASSOCIATED_WITH', 'EARNS')
  )
UNION ALL
SELECT
  n.id AS node_id,
  n.type AS node_type,
  'missing one of ASSOCIATED_WITH, BALANCE_FOR, TRANSFERS_TO' AS violation
FROM nodes n
WHERE n.type = 'Program'
  AND NOT EXISTS (
    SELECT 1
    FROM edges e
    WHERE (e.source_id = n.id OR e.target_id = n.id)
      AND e.type IN ('ASSOCIATED_WITH', 'BALANCE_FOR', 'TRANSFERS_TO')
  )
UNION ALL
SELECT
  n.id AS node_id,
  n.type AS node_type,
  'missing EARNS edge' AS violation
FROM nodes n
WHERE n.type = 'MerchantCategory'
  AND NOT EXISTS (
    SELECT 1
    FROM edges e
    WHERE (e.source_id = n.id OR e.target_id = n.id)
      AND e.type = 'EARNS'
  )
UNION ALL
SELECT
  n.id AS node_id,
  n.type AS node_type,
  'missing HAS_BALANCE edge' AS violation
FROM nodes n
WHERE n.type = 'Balance'
  AND NOT EXISTS (
    SELECT 1
    FROM edges e
    WHERE (e.source_id = n.id OR e.target_id = n.id)
      AND e.type = 'HAS_BALANCE'
  )
UNION ALL
SELECT
  n.id AS node_id,
  n.type AS node_type,
  'missing BALANCE_FOR edge' AS violation
FROM nodes n
WHERE n.type = 'Balance'
  AND NOT EXISTS (
    SELECT 1
    FROM edges e
    WHERE (e.source_id = n.id OR e.target_id = n.id)
      AND e.type = 'BALANCE_FOR'
  )
UNION ALL
SELECT
  n.id AS node_id,
  n.type AS node_type,
  'missing one of HAS_GOAL, TARGETS' AS violation
FROM nodes n
WHERE n.type = 'Goal'
  AND NOT EXISTS (
    SELECT 1
    FROM edges e
    WHERE (e.source_id = n.id OR e.target_id = n.id)
      AND e.type IN ('HAS_GOAL', 'TARGETS')
  )
UNION ALL
SELECT
  n.id AS node_id,
  n.type AS node_type,
  'missing one of FOR_USER, TARGETS, STEP_OF' AS violation
FROM nodes n
WHERE n.type = 'PlanQuery'
  AND NOT EXISTS (
    SELECT 1
    FROM edges e
    WHERE (e.source_id = n.id OR e.target_id = n.id)
      AND e.type IN ('FOR_USER', 'TARGETS', 'STEP_OF')
  )
UNION ALL
SELECT
  n.id AS node_id,
  n.type AS node_type,
  'missing STEP_OF edge' AS violation
FROM nodes n
WHERE n.type = 'PlanStep'
  AND NOT EXISTS (
    SELECT 1
    FROM edges e
    WHERE (e.source_id = n.id OR e.target_id = n.id)
      AND e.type = 'STEP_OF'
  )
UNION ALL
SELECT
  n.id AS node_id,
  n.type AS node_type,
  'missing DEPENDS_ON edge' AS violation
FROM nodes n
WHERE n.type = 'PlanStep'
  AND NOT EXISTS (
    SELECT 1
    FROM edges e
    WHERE (e.source_id = n.id OR e.target_id = n.id)
      AND e.type = 'DEPENDS_ON'
  );

CREATE FUNCTION mark_plan_step_stale(
  p_plan_step_id UUID,
  p_reason TEXT
)
RETURNS TABLE (id UUID, version INTEGER)
LANGUAGE sql
AS $$
  UPDATE nodes
  SET
    attributes = jsonb_set(
      jsonb_set(attributes, '{status}', '"stale"'::jsonb),
      '{stale_reason}',
      to_jsonb(p_reason)
    ),
    version = version + 1,
    updated_at = now()
  WHERE id = p_plan_step_id
    AND type = 'PlanStep'
    AND COALESCE(attributes->>'status', '') NOT IN (
      'stale',
      'superseded',
      'completed',
      'failed'
    )
  RETURNING id, version;
$$;

CREATE FUNCTION supersede_plan_step(
  p_source_plan_step_id UUID,
  p_successor_attributes JSONB
)
RETURNS TABLE (
  source_id UUID,
  source_version INTEGER,
  successor_id UUID,
  successor_version INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
  source_step nodes%ROWTYPE;
  new_source_version INTEGER;
  new_successor_id UUID;
  new_successor_version INTEGER;
BEGIN
  SELECT *
    INTO source_step
    FROM nodes
   WHERE id = p_source_plan_step_id
     AND type = 'PlanStep'
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF COALESCE(source_step.attributes->>'status', '') <> 'stale' THEN
    RETURN;
  END IF;

  INSERT INTO nodes (type, tier, user_id, slug, attributes, version)
  VALUES ('PlanStep', 'plan', source_step.user_id, NULL, p_successor_attributes, 0)
  RETURNING id, version
    INTO new_successor_id, new_successor_version;

  UPDATE nodes
     SET attributes = jsonb_set(
           jsonb_set(attributes, '{status}', '"superseded"'::jsonb),
           '{superseded_by_plan_step_id}',
           to_jsonb(new_successor_id::text)
         ),
         version = version + 1,
         updated_at = now()
   WHERE id = p_source_plan_step_id
     AND type = 'PlanStep'
  RETURNING version
    INTO new_source_version;

  source_id := p_source_plan_step_id;
  source_version := new_source_version;
  successor_id := new_successor_id;
  successor_version := new_successor_version;
  RETURN NEXT;
END;
$$;

CREATE FUNCTION update_node_optimistic(
  p_node_id UUID,
  p_expected_version INTEGER,
  p_attributes JSONB
)
RETURNS TABLE (id UUID, version INTEGER)
LANGUAGE sql
AS $$
  UPDATE nodes
  SET
    attributes = p_attributes,
    version = version + 1,
    updated_at = now()
  WHERE id = p_node_id
    AND version = p_expected_version
  RETURNING id, version;
$$;

CREATE FUNCTION update_edge_optimistic(
  p_edge_id UUID,
  p_expected_version INTEGER,
  p_attributes JSONB
)
RETURNS TABLE (id UUID, version INTEGER)
LANGUAGE sql
AS $$
  UPDATE edges
  SET
    attributes = p_attributes,
    version = version + 1,
    updated_at = now()
  WHERE id = p_edge_id
    AND version = p_expected_version
  RETURNING id, version;
$$;
