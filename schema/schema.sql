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
SELECT
  plan_step.id AS plan_step_id,
  plan_step.attributes AS plan_step_attributes,
  depended_node.id AS depended_node_id,
  depended_node.type AS depended_node_type,
  depended_node.version AS current_version,
  (dep.attributes->>'observed_version')::integer AS observed_version
FROM edges dep
JOIN nodes plan_step
  ON plan_step.id = dep.source_id
JOIN nodes depended_node
  ON depended_node.id = dep.target_id
WHERE dep.type = 'DEPENDS_ON'
  AND plan_step.type = 'PlanStep'
  AND depended_node.version <> (dep.attributes->>'observed_version')::integer;

CREATE FUNCTION mark_plan_step_stale(
  p_plan_step_id UUID,
  p_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  updated_id UUID;
BEGIN
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
  RETURNING id INTO updated_id;

  RETURN updated_id;
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
