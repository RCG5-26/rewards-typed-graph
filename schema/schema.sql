CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  tier TEXT NOT NULL,
  user_id UUID NULL,
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

CREATE TABLE mutation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id UUID NOT NULL,
  target_type TEXT NOT NULL,
  before_value JSONB NULL,
  after_value JSONB NULL,
  resulting_version INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT mutation_log_action_check CHECK (
    action IN (
      'create_node',
      'update_node',
      'create_edge',
      'update_edge',
      'mark_stale',
      'supersede_plan_step'
    )
  ),

  CONSTRAINT mutation_log_target_kind_check CHECK (
    target_kind IN ('node', 'edge')
  )
);

CREATE INDEX mutation_log_created_at_idx ON mutation_log (created_at);
CREATE INDEX mutation_log_target_idx ON mutation_log (target_kind, target_id);
CREATE INDEX mutation_log_actor_idx ON mutation_log (actor);

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
