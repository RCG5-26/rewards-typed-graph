-- Rewards Agent — canonical DDL · schema-final v3.1
-- Apply: psql $DATABASE_URL -f schema/schema.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- World graph
-- ---------------------------------------------------------------------------

CREATE TABLE reward_programs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                    text NOT NULL UNIQUE,
  name                    text NOT NULL,
  issuer                  text,
  program_kind            text NOT NULL CHECK (program_kind IN ('issuer_transferable','airline','hotel','cashback')),
  currency_name           text NOT NULL,
  min_redemption_points   integer,
  points_expire_months    integer,
  is_active               boolean NOT NULL DEFAULT true,
  graph_tier              text NOT NULL DEFAULT 'world' CHECK (graph_tier = 'world'),
  node_type               text NOT NULL DEFAULT 'RewardProgram' CHECK (node_type = 'RewardProgram'),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE credit_cards (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                        text NOT NULL UNIQUE,
  name                        text NOT NULL,
  issuer                      text NOT NULL,
  network                     text NOT NULL CHECK (network IN ('visa','mastercard','amex','discover')),
  annual_fee_cents            integer NOT NULL DEFAULT 0,
  reward_program_id           uuid NOT NULL REFERENCES reward_programs(id),
  signup_bonus_points         integer,
  signup_bonus_spend_cents    integer,
  signup_bonus_deadline_days  integer,
  is_active                   boolean NOT NULL DEFAULT true,
  graph_tier                  text NOT NULL DEFAULT 'world' CHECK (graph_tier = 'world'),
  node_type                   text NOT NULL DEFAULT 'CreditCard' CHECK (node_type = 'CreditCard'),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE spend_categories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL,
  parent_id     uuid REFERENCES spend_categories(id),
  mcc_codes     integer[] NOT NULL DEFAULT '{}',
  graph_tier    text NOT NULL DEFAULT 'world' CHECK (graph_tier = 'world'),
  node_type     text NOT NULL DEFAULT 'SpendCategory' CHECK (node_type = 'SpendCategory')
);

CREATE TABLE redemption_options (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id        uuid NOT NULL REFERENCES reward_programs(id),
  option_type       text NOT NULL CHECK (option_type IN ('travel_portal','transfer_partner','statement_credit','gift_card','check','merchandise')),
  cpp_basis_points  integer NOT NULL,
  min_points        integer,
  description       text,
  valid_from        date,
  valid_until       date,
  graph_tier        text NOT NULL DEFAULT 'world' CHECK (graph_tier = 'world'),
  node_type         text NOT NULL DEFAULT 'RedemptionOption' CHECK (node_type = 'RedemptionOption')
);

CREATE TABLE transfers_to (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_program_id           uuid NOT NULL REFERENCES reward_programs(id),
  dest_program_id             uuid NOT NULL REFERENCES reward_programs(id),
  transfer_ratio_basis_points integer NOT NULL CHECK (transfer_ratio_basis_points > 0),
  transfer_time_days          integer,
  valid_from                  timestamptz,
  valid_until                 timestamptz,
  is_active                   boolean NOT NULL DEFAULT true,
  version                     integer NOT NULL DEFAULT 0,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX transfers_to_active_route
  ON transfers_to (source_program_id, dest_program_id)
  WHERE is_active;

CREATE TABLE redeems_via (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id            uuid NOT NULL REFERENCES reward_programs(id),
  redemption_option_id  uuid NOT NULL REFERENCES redemption_options(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, redemption_option_id)
);

CREATE TABLE earns (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_card_id          uuid NOT NULL REFERENCES credit_cards(id),
  spend_category_id       uuid NOT NULL REFERENCES spend_categories(id),
  earn_rate_basis_points  integer NOT NULL CHECK (earn_rate_basis_points >= 0),
  earn_type               text NOT NULL CHECK (earn_type IN ('points','miles','cashback_pct')),
  cap_amount_cents        integer,
  cap_period              text CHECK (cap_period IN ('annual','quarterly','monthly')),
  valid_from              date,
  valid_until             date,
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (credit_card_id, spend_category_id)
);

-- ---------------------------------------------------------------------------
-- Personal graph
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id      text NOT NULL UNIQUE,
  display_name  text,
  graph_tier    text NOT NULL DEFAULT 'personal' CHECK (graph_tier = 'personal'),
  node_type     text NOT NULL DEFAULT 'User' CHECK (node_type = 'User'),
  version       integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_balances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id),
  program_id      uuid NOT NULL REFERENCES reward_programs(id),
  balance_points  integer NOT NULL DEFAULT 0 CHECK (balance_points >= 0),
  as_of           timestamptz NOT NULL DEFAULT now(),
  source          text NOT NULL DEFAULT 'manual_entry' CHECK (source IN ('manual_entry','agent_computed')),
  graph_tier      text NOT NULL DEFAULT 'personal' CHECK (graph_tier = 'personal'),
  node_type       text NOT NULL DEFAULT 'UserBalance' CHECK (node_type = 'UserBalance'),
  version         integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, program_id)
);

CREATE TABLE user_program_statuses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id),
  program_id      uuid NOT NULL REFERENCES reward_programs(id),
  status_tier     text NOT NULL,
  tier_benefits   jsonb,
  valid_through   date,
  graph_tier      text NOT NULL DEFAULT 'personal' CHECK (graph_tier = 'personal'),
  node_type       text NOT NULL DEFAULT 'UserProgramStatus' CHECK (node_type = 'UserProgramStatus'),
  version         integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, program_id)
);

CREATE TABLE user_goals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES users(id),
  goal_type             text NOT NULL CHECK (goal_type IN ('maximize_points','maximize_cashback','specific_redemption','minimize_fees')),
  target_redemption_id  uuid REFERENCES redemption_options(id),
  description           text,
  priority              integer NOT NULL DEFAULT 1,
  graph_tier            text NOT NULL DEFAULT 'personal' CHECK (graph_tier = 'personal'),
  node_type             text NOT NULL DEFAULT 'UserGoal' CHECK (node_type = 'UserGoal'),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE holds (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id),
  credit_card_id  uuid NOT NULL REFERENCES credit_cards(id),
  opened_date     date,
  is_primary      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, credit_card_id)
);

-- ---------------------------------------------------------------------------
-- Plan graph
-- ---------------------------------------------------------------------------

CREATE TABLE plans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id),
  plan_lineage_id     uuid NOT NULL,
  revision_number     integer NOT NULL DEFAULT 1 CHECK (revision_number >= 1),
  supersedes_plan_id  uuid REFERENCES plans(id),
  query_text          text NOT NULL DEFAULT '',
  status              text NOT NULL,
  stale_reason        text,
  plan_type           text NOT NULL CHECK (plan_type IN ('agent_generated','baseline_single_agent','baseline_free_text_multiagent')),
  benchmark_query_id  uuid,
  raw_output          jsonb,
  summary             text,
  version             integer NOT NULL DEFAULT 0,
  graph_tier          text NOT NULL DEFAULT 'plan' CHECK (graph_tier = 'plan'),
  node_type           text NOT NULL DEFAULT 'Plan' CHECK (node_type = 'Plan'),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plans_status_agent_generated CHECK (
    plan_type <> 'agent_generated'
    OR status IN ('generating','current','stale','failed','superseded')
  ),
  CONSTRAINT plans_status_baseline CHECK (
    plan_type = 'agent_generated'
    OR status IN ('completed','failed')
  )
);

CREATE UNIQUE INDEX plans_one_current_revision
  ON plans (plan_lineage_id)
  WHERE status = 'current';

CREATE TABLE plan_steps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id       uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  step_order    integer NOT NULL CHECK (step_order >= 1),
  step_type     text NOT NULL CHECK (step_type IN ('card_assignment','redemption_recommendation','spend_analysis','transfer_recommendation')),
  payload       jsonb NOT NULL DEFAULT '{}',
  status        text NOT NULL CHECK (status IN ('proposed','current','stale','superseded')),
  staled_at     timestamptz,
  stale_reason  text,
  result        jsonb,
  error         text,
  version       integer NOT NULL DEFAULT 0,
  graph_tier    text NOT NULL DEFAULT 'plan' CHECK (graph_tier = 'plan'),
  node_type     text NOT NULL DEFAULT 'PlanStep' CHECK (node_type = 'PlanStep'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, step_order)
);

CREATE TABLE state_dependencies (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_step_id      uuid NOT NULL REFERENCES plan_steps(id) ON DELETE CASCADE,
  target_node_id    uuid NOT NULL,
  target_node_type  text NOT NULL,
  target_table      text NOT NULL,
  depended_property text,
  observed_version  integer NOT NULL,
  snapshot_value    jsonb NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE targets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id         uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  user_goal_id    uuid NOT NULL REFERENCES user_goals(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, user_goal_id)
);

CREATE TABLE agent_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_type    text NOT NULL CHECK (agent_type IN ('orchestrator','wallet_agent','earning_agent','redemption_agent')),
  plan_id       uuid REFERENCES plans(id),
  user_id       uuid NOT NULL REFERENCES users(id),
  started_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  status        text NOT NULL CHECK (status IN ('running','completed','failed','timed_out')),
  state         jsonb,
  token_count   integer,
  error         text,
  graph_tier    text NOT NULL DEFAULT 'plan' CHECK (graph_tier = 'plan'),
  node_type     text NOT NULL DEFAULT 'AgentRun' CHECK (node_type = 'AgentRun')
);

CREATE TABLE external_quotes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_type            text NOT NULL CHECK (quote_type IN ('cash_price','award_availability')),
  program_id            uuid REFERENCES reward_programs(id),
  redemption_option_id  uuid REFERENCES redemption_options(id),
  subject               text NOT NULL,
  value_cents           integer,
  points_cost           integer,
  source_tool           text NOT NULL,
  fetched_at            timestamptz NOT NULL DEFAULT now(),
  valid_until           timestamptz,
  plan_id               uuid REFERENCES plans(id),
  payload               jsonb NOT NULL,
  graph_tier            text NOT NULL DEFAULT 'world' CHECK (graph_tier = 'world'),
  node_type             text NOT NULL DEFAULT 'ExternalQuote' CHECK (node_type = 'ExternalQuote')
);

CREATE TABLE evaluations (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id                     uuid NOT NULL REFERENCES plans(id),
  baseline_plan_id            uuid REFERENCES plans(id),
  benchmark_query_id          uuid NOT NULL,
  total_value_cents           integer,
  baseline_value_cents        integer,
  improvement_basis_points    integer,
  accuracy_score              boolean,
  hallucination_count         integer,
  token_cost_total            integer,
  plan_invalidation_correct   boolean,
  domain_extension_correct    boolean,
  metric_scores               jsonb,
  evaluator_version           text NOT NULL,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Write-path infrastructure
-- ---------------------------------------------------------------------------

CREATE TABLE graph_mutations (
  id                  bigserial PRIMARY KEY,
  mutation_txn_id     uuid NOT NULL,
  user_id             uuid NOT NULL REFERENCES users(id),
  plan_lineage_id     uuid,
  plan_id             uuid REFERENCES plans(id),
  agent_run_id        uuid REFERENCES agent_runs(id),
  mutation_type       text NOT NULL,
  target_table        text,
  target_node_id      uuid,
  summary             text NOT NULL,
  before              jsonb,
  after               jsonb,
  committed_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE replan_jobs (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   uuid NOT NULL REFERENCES users(id),
  plan_lineage_id           uuid NOT NULL,
  source_plan_id            uuid NOT NULL REFERENCES plans(id),
  trigger_mutation_txn_id   uuid NOT NULL,
  idempotency_key           text NOT NULL UNIQUE,
  status                    text NOT NULL CHECK (status IN ('pending','processing','completed','failed','superseded')),
  attempt_count             integer NOT NULL DEFAULT 0,
  max_attempts              integer NOT NULL DEFAULT 3,
  available_at              timestamptz NOT NULL DEFAULT now(),
  locked_at                 timestamptz,
  locked_by                 text,
  lease_expires_at          timestamptz,
  result_plan_id            uuid REFERENCES plans(id),
  error                     text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  completed_at              timestamptz
);

CREATE TABLE idempotency_records (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id),
  operation_type    text NOT NULL,
  idempotency_key   text NOT NULL,
  request_hash      text NOT NULL,
  mutation_txn_id   uuid NOT NULL,
  result_reference  jsonb NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, operation_type, idempotency_key)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX ON credit_cards (reward_program_id);
CREATE INDEX ON redemption_options (program_id);
CREATE INDEX ON transfers_to (source_program_id);
CREATE INDEX ON transfers_to (dest_program_id);
CREATE INDEX ON user_program_statuses (user_id, program_id);
CREATE INDEX ON plan_steps (plan_id, step_order);
CREATE INDEX ON plan_steps (status) WHERE status = 'stale';
CREATE INDEX ON agent_runs (plan_id);
CREATE INDEX ON external_quotes (plan_id);
CREATE INDEX ON evaluations (benchmark_query_id);
CREATE INDEX ON state_dependencies (target_table, target_node_id);
CREATE INDEX ON state_dependencies (plan_step_id);
CREATE INDEX ON spend_categories USING GIN (mcc_codes);
CREATE INDEX ON user_balances (id, version);
CREATE INDEX ON plan_steps (plan_id, version);
CREATE INDEX ON graph_mutations (user_id, id);
CREATE INDEX replan_jobs_claim
  ON replan_jobs (status, available_at)
  WHERE status IN ('pending','processing');
CREATE INDEX ON plans (user_id, plan_lineage_id);

-- ---------------------------------------------------------------------------
-- Staleness backstop (dev safety — does not enqueue replan_jobs)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION backstop_balance_staleness()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE plan_steps ps
     SET status = 'stale',
         version = ps.version + 1,
         staled_at = now(),
         stale_reason = format('user_balances:%s balance_points %s -> %s', NEW.id, OLD.balance_points, NEW.balance_points),
         updated_at = now()
    FROM state_dependencies sd
    JOIN plans p ON p.id = ps.plan_id
   WHERE sd.plan_step_id = ps.id
     AND sd.target_table = 'user_balances'
     AND sd.target_node_id = NEW.id
     AND sd.depended_property = 'balance_points'
     AND (sd.snapshot_value->>'balance_points')::int IS DISTINCT FROM NEW.balance_points
     AND ps.status = 'current'
     AND p.status = 'current';

  UPDATE plans p
     SET status = 'stale',
         stale_reason = format('user_balances:%s changed', NEW.id),
         updated_at = now(),
         version = p.version + 1
    FROM plan_steps ps
    JOIN state_dependencies sd ON sd.plan_step_id = ps.id
   WHERE ps.plan_id = p.id
     AND p.status = 'current'
     AND sd.target_table = 'user_balances'
     AND sd.target_node_id = NEW.id
     AND sd.depended_property = 'balance_points'
     AND (sd.snapshot_value->>'balance_points')::int IS DISTINCT FROM NEW.balance_points;

  RETURN NEW;
END;
$$;

CREATE TRIGGER user_balances_staleness_backstop
  AFTER UPDATE OF balance_points ON user_balances
  FOR EACH ROW
  WHEN (OLD.balance_points IS DISTINCT FROM NEW.balance_points)
  EXECUTE FUNCTION backstop_balance_staleness();

COMMIT;
