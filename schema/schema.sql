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
