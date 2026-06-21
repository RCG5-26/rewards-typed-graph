CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id TEXT NOT NULL UNIQUE,
  email TEXT NULL,
  display_name TEXT NULL,
  graph_tier TEXT NOT NULL DEFAULT 'personal',
  node_type TEXT NOT NULL DEFAULT 'User',
  version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT users_graph_tier_check CHECK (graph_tier = 'personal'),
  CONSTRAINT users_node_type_check CHECK (node_type = 'User'),
  CONSTRAINT users_version_nonnegative CHECK (version >= 0)
);

CREATE TABLE reward_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  issuer TEXT NULL,
  program_kind TEXT NOT NULL,
  currency_name TEXT NOT NULL,
  min_redemption_points INTEGER NULL,
  points_expire_months INTEGER NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  graph_tier TEXT NOT NULL DEFAULT 'world',
  node_type TEXT NOT NULL DEFAULT 'RewardProgram',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT reward_programs_kind_check CHECK (
    program_kind IN ('issuer_transferable', 'airline', 'hotel', 'cashback')
  ),
  CONSTRAINT reward_programs_graph_tier_check CHECK (graph_tier = 'world'),
  CONSTRAINT reward_programs_node_type_check CHECK (node_type = 'RewardProgram')
);

CREATE TABLE credit_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  issuer TEXT NOT NULL,
  network TEXT NOT NULL,
  annual_fee_cents INTEGER NOT NULL DEFAULT 0,
  reward_program_id UUID NOT NULL REFERENCES reward_programs(id),
  signup_bonus_points INTEGER NULL,
  signup_bonus_spend_cents INTEGER NULL,
  signup_bonus_deadline_days INTEGER NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  graph_tier TEXT NOT NULL DEFAULT 'world',
  node_type TEXT NOT NULL DEFAULT 'CreditCard',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT credit_cards_network_check CHECK (
    network IN ('visa', 'mastercard', 'amex', 'discover')
  ),
  CONSTRAINT credit_cards_annual_fee_nonnegative CHECK (annual_fee_cents >= 0),
  CONSTRAINT credit_cards_graph_tier_check CHECK (graph_tier = 'world'),
  CONSTRAINT credit_cards_node_type_check CHECK (node_type = 'CreditCard')
);

CREATE TABLE spend_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  parent_id UUID NULL REFERENCES spend_categories(id),
  mcc_codes INTEGER[] NOT NULL DEFAULT '{}',
  graph_tier TEXT NOT NULL DEFAULT 'world',
  node_type TEXT NOT NULL DEFAULT 'SpendCategory',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT spend_categories_node_type_check CHECK (node_type = 'SpendCategory'),
  CONSTRAINT spend_categories_graph_tier_check CHECK (graph_tier = 'world')
);

CREATE TABLE redemption_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID NOT NULL REFERENCES reward_programs(id),
  option_type TEXT NOT NULL,
  cpp_basis_points INTEGER NOT NULL,
  min_points INTEGER NULL,
  description TEXT NULL,
  valid_from DATE NULL,
  valid_until DATE NULL,
  graph_tier TEXT NOT NULL DEFAULT 'world',
  node_type TEXT NOT NULL DEFAULT 'RedemptionOption',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT redemption_options_type_check CHECK (
    option_type IN (
      'travel_portal',
      'transfer_partner',
      'statement_credit',
      'gift_card',
      'check',
      'merchandise'
    )
  ),
  CONSTRAINT redemption_options_cpp_positive CHECK (cpp_basis_points > 0),
  CONSTRAINT redemption_options_min_points_nonnegative CHECK (
    min_points IS NULL OR min_points >= 0
  ),
  CONSTRAINT redemption_options_graph_tier_check CHECK (graph_tier = 'world'),
  CONSTRAINT redemption_options_node_type_check CHECK (node_type = 'RedemptionOption')
);

CREATE TABLE transfers_to (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_program_id UUID NOT NULL REFERENCES reward_programs(id),
  dest_program_id UUID NOT NULL REFERENCES reward_programs(id),
  transfer_ratio_basis_points INTEGER NOT NULL,
  transfer_time_days INTEGER NULL,
  valid_from TIMESTAMPTZ NULL,
  valid_until TIMESTAMPTZ NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT transfers_to_no_self_loop CHECK (source_program_id <> dest_program_id),
  CONSTRAINT transfers_to_ratio_positive CHECK (transfer_ratio_basis_points > 0),
  CONSTRAINT transfers_to_time_nonnegative CHECK (
    transfer_time_days IS NULL OR transfer_time_days >= 0
  ),
  CONSTRAINT transfers_to_version_nonnegative CHECK (version >= 0)
);

CREATE UNIQUE INDEX transfers_to_active_route_unique
  ON transfers_to (source_program_id, dest_program_id)
  WHERE is_active;

CREATE TABLE user_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_id UUID NOT NULL REFERENCES reward_programs(id),
  balance_points INTEGER NOT NULL,
  as_of TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'manual_entry',
  graph_tier TEXT NOT NULL DEFAULT 'personal',
  node_type TEXT NOT NULL DEFAULT 'UserBalance',
  version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT user_balances_points_nonnegative CHECK (balance_points >= 0),
  CONSTRAINT user_balances_version_nonnegative CHECK (version >= 0),
  CONSTRAINT user_balances_graph_tier_check CHECK (graph_tier = 'personal'),
  CONSTRAINT user_balances_node_type_check CHECK (node_type = 'UserBalance'),
  UNIQUE (user_id, program_id)
);

CREATE TABLE user_program_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_id UUID NOT NULL REFERENCES reward_programs(id),
  status_tier TEXT NOT NULL,
  status_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  graph_tier TEXT NOT NULL DEFAULT 'personal',
  node_type TEXT NOT NULL DEFAULT 'UserProgramStatus',
  version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT user_program_statuses_version_nonnegative CHECK (version >= 0),
  CONSTRAINT user_program_statuses_graph_tier_check CHECK (graph_tier = 'personal'),
  CONSTRAINT user_program_statuses_node_type_check CHECK (
    node_type = 'UserProgramStatus'
  ),
  UNIQUE (user_id, program_id)
);

CREATE TABLE user_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_type TEXT NOT NULL,
  description TEXT NOT NULL,
  target_program_id UUID NULL REFERENCES reward_programs(id),
  target_location TEXT NULL,
  target_date DATE NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  graph_tier TEXT NOT NULL DEFAULT 'personal',
  node_type TEXT NOT NULL DEFAULT 'UserGoal',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT user_goals_graph_tier_check CHECK (graph_tier = 'personal'),
  CONSTRAINT user_goals_node_type_check CHECK (node_type = 'UserGoal')
);

CREATE TABLE holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credit_card_id UUID NOT NULL REFERENCES credit_cards(id),
  opened_date DATE NULL,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id, credit_card_id)
);

CREATE TABLE earns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_card_id UUID NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
  spend_category_id UUID NOT NULL REFERENCES spend_categories(id),
  earn_rate_basis_points INTEGER NOT NULL,
  earn_type TEXT NOT NULL,
  cap_amount_cents INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT earns_rate_nonnegative CHECK (earn_rate_basis_points >= 0),
  CONSTRAINT earns_type_check CHECK (earn_type IN ('points', 'miles', 'cashback_pct')),
  CONSTRAINT earns_cap_nonnegative CHECK (
    cap_amount_cents IS NULL OR cap_amount_cents >= 0
  ),
  UNIQUE (credit_card_id, spend_category_id, earn_type)
);

CREATE TABLE redeems_via (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID NOT NULL REFERENCES reward_programs(id) ON DELETE CASCADE,
  redemption_option_id UUID NOT NULL REFERENCES redemption_options(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (program_id, redemption_option_id)
);

CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_lineage_id UUID NOT NULL,
  revision_number INTEGER NOT NULL DEFAULT 1,
  supersedes_plan_id UUID NULL REFERENCES plans(id),
  query_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'generating',
  plan_type TEXT NOT NULL DEFAULT 'agent_generated',
  benchmark_query_id UUID NULL,
  raw_output JSONB NULL,
  summary TEXT NULL,
  stale_reason TEXT NULL,
  graph_tier TEXT NOT NULL DEFAULT 'plan',
  node_type TEXT NOT NULL DEFAULT 'Plan',
  version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT plans_revision_positive CHECK (revision_number > 0),
  CONSTRAINT plans_status_check CHECK (
    status IN ('generating', 'current', 'stale', 'failed', 'superseded')
  ),
  CONSTRAINT plans_type_check CHECK (
    plan_type IN (
      'agent_generated',
      'baseline_single_agent',
      'baseline_free_text_multiagent'
    )
  ),
  CONSTRAINT plans_version_nonnegative CHECK (version >= 0),
  CONSTRAINT plans_graph_tier_check CHECK (graph_tier = 'plan'),
  CONSTRAINT plans_node_type_check CHECK (node_type = 'Plan'),
  UNIQUE (plan_lineage_id, revision_number)
);

CREATE UNIQUE INDEX plans_one_current_revision
  ON plans (plan_lineage_id)
  WHERE status = 'current';

CREATE TABLE plan_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  plan_lineage_id UUID NOT NULL,
  revision_number INTEGER NOT NULL,
  supersedes_plan_step_id UUID NULL REFERENCES plan_steps(id),
  superseded_by_plan_step_id UUID NULL REFERENCES plan_steps(id),
  step_order INTEGER NOT NULL,
  step_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'proposed',
  stale_reason TEXT NULL,
  result JSONB NULL,
  error TEXT NULL,
  graph_tier TEXT NOT NULL DEFAULT 'plan',
  node_type TEXT NOT NULL DEFAULT 'PlanStep',
  version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT plan_steps_revision_positive CHECK (revision_number > 0),
  CONSTRAINT plan_steps_order_positive CHECK (step_order > 0),
  CONSTRAINT plan_steps_type_check CHECK (
    step_type IN (
      'card_assignment',
      'redemption_recommendation',
      'spend_analysis',
      'transfer_recommendation'
    )
  ),
  CONSTRAINT plan_steps_status_check CHECK (
    status IN ('proposed', 'current', 'stale', 'superseded')
  ),
  CONSTRAINT plan_steps_version_nonnegative CHECK (version >= 0),
  CONSTRAINT plan_steps_graph_tier_check CHECK (graph_tier = 'plan'),
  CONSTRAINT plan_steps_node_type_check CHECK (node_type = 'PlanStep'),
  UNIQUE (plan_id, step_order)
);

CREATE TABLE targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  user_goal_id UUID NOT NULL REFERENCES user_goals(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (plan_id, user_goal_id)
);

CREATE TABLE state_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_step_id UUID NOT NULL REFERENCES plan_steps(id) ON DELETE CASCADE,
  target_node_id UUID NOT NULL,
  target_node_type TEXT NOT NULL,
  target_table TEXT NOT NULL,
  depended_property TEXT NULL,
  observed_version INTEGER NOT NULL,
  snapshot_value JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT state_dependencies_observed_version_nonnegative CHECK (
    observed_version >= 0
  ),
  CONSTRAINT state_dependencies_target_table_check CHECK (
    target_table IN (
      'users',
      'credit_cards',
      'reward_programs',
      'spend_categories',
      'redemption_options',
      'user_balances',
      'user_program_statuses',
      'user_goals',
      'plans',
      'plan_steps',
      'agent_runs',
      'external_quotes',
      'transfers_to'
    )
  )
);

CREATE TABLE agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_type TEXT NOT NULL,
  plan_id UUID NULL REFERENCES plans(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL,
  status TEXT NOT NULL DEFAULT 'running',
  state JSONB NULL,
  token_count INTEGER NULL,
  error TEXT NULL,
  graph_tier TEXT NOT NULL DEFAULT 'plan',
  node_type TEXT NOT NULL DEFAULT 'AgentRun',
  version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT agent_runs_agent_type_check CHECK (
    agent_type IN ('orchestrator', 'wallet_agent', 'earning_agent', 'redemption_agent')
  ),
  CONSTRAINT agent_runs_status_check CHECK (
    status IN ('running', 'completed', 'failed', 'timed_out')
  ),
  CONSTRAINT agent_runs_version_nonnegative CHECK (version >= 0),
  CONSTRAINT agent_runs_graph_tier_check CHECK (graph_tier = 'plan'),
  CONSTRAINT agent_runs_node_type_check CHECK (node_type = 'AgentRun')
);

CREATE TABLE external_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_type TEXT NOT NULL,
  program_id UUID NULL REFERENCES reward_programs(id),
  redemption_option_id UUID NULL REFERENCES redemption_options(id),
  subject TEXT NOT NULL,
  value_cents INTEGER NULL,
  points_cost INTEGER NULL,
  source_tool TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until TIMESTAMPTZ NULL,
  plan_id UUID NULL REFERENCES plans(id) ON DELETE SET NULL,
  payload JSONB NOT NULL,
  graph_tier TEXT NOT NULL DEFAULT 'world',
  node_type TEXT NOT NULL DEFAULT 'ExternalQuote',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT external_quotes_type_check CHECK (
    quote_type IN ('cash_price', 'award_availability')
  ),
  CONSTRAINT external_quotes_value_nonnegative CHECK (
    value_cents IS NULL OR value_cents >= 0
  ),
  CONSTRAINT external_quotes_points_nonnegative CHECK (
    points_cost IS NULL OR points_cost >= 0
  ),
  CONSTRAINT external_quotes_graph_tier_check CHECK (graph_tier = 'world'),
  CONSTRAINT external_quotes_node_type_check CHECK (node_type = 'ExternalQuote')
);

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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_lineage_id UUID NOT NULL,
  source_plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  trigger_mutation_txn_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ NULL,
  locked_by TEXT NULL,
  lease_expires_at TIMESTAMPTZ NULL,
  result_plan_id UUID NULL REFERENCES plans(id),
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

CREATE TABLE benchmark_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  query_text TEXT NOT NULL,
  ground_truth JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE plans
  ADD CONSTRAINT plans_benchmark_query_fk
  FOREIGN KEY (benchmark_query_id) REFERENCES benchmark_queries(id);

CREATE TABLE evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  baseline_plan_id UUID NULL REFERENCES plans(id) ON DELETE SET NULL,
  benchmark_query_id UUID NOT NULL REFERENCES benchmark_queries(id),
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

CREATE INDEX credit_cards_reward_program_idx ON credit_cards (reward_program_id);
CREATE INDEX redemption_options_program_idx ON redemption_options (program_id);
CREATE INDEX transfers_to_source_idx ON transfers_to (source_program_id);
CREATE INDEX transfers_to_dest_idx ON transfers_to (dest_program_id);
CREATE INDEX user_balances_user_program_idx ON user_balances (user_id, program_id);
CREATE INDEX user_program_statuses_user_program_idx
  ON user_program_statuses (user_id, program_id);
CREATE INDEX plans_lineage_revision_idx ON plans (plan_lineage_id, revision_number);
CREATE INDEX plans_user_status_idx ON plans (user_id, status);
CREATE INDEX plan_steps_plan_order_idx ON plan_steps (plan_id, step_order);
CREATE INDEX plan_steps_lineage_revision_idx
  ON plan_steps (plan_lineage_id, revision_number);
CREATE INDEX plan_steps_status_idx ON plan_steps (status);
CREATE INDEX state_dependencies_target_idx
  ON state_dependencies (target_table, target_node_id);
CREATE INDEX state_dependencies_step_idx ON state_dependencies (plan_step_id);
CREATE INDEX agent_runs_plan_idx ON agent_runs (plan_id);
CREATE INDEX external_quotes_plan_idx ON external_quotes (plan_id);
CREATE INDEX evaluations_benchmark_query_idx ON evaluations (benchmark_query_id);
CREATE INDEX graph_mutations_user_id_idx ON graph_mutations (user_id, id);
CREATE INDEX graph_mutations_committed_at_idx ON graph_mutations (committed_at);
CREATE INDEX graph_mutations_target_idx
  ON graph_mutations (target_table, target_node_id);
CREATE INDEX replan_jobs_claim_idx
  ON replan_jobs (status, available_at, lease_expires_at);
CREATE INDEX replan_jobs_user_status_idx ON replan_jobs (user_id, status);
CREATE UNIQUE INDEX replan_jobs_open_source_unique
  ON replan_jobs (source_plan_id)
  WHERE status IN ('pending', 'processing');
CREATE UNIQUE INDEX replan_jobs_idempotency_key_unique
  ON replan_jobs (user_id, plan_lineage_id, trigger_mutation_txn_id, idempotency_key);
CREATE INDEX spend_categories_mcc_codes_idx ON spend_categories USING gin (mcc_codes);
CREATE INDEX user_balances_id_version_idx ON user_balances (id, version);
CREATE INDEX plan_steps_plan_version_idx ON plan_steps (plan_id, version);

CREATE VIEW stale_plan_steps AS
SELECT
  ps.id AS plan_step_id,
  ps.plan_id,
  ps.plan_lineage_id,
  ps.revision_number,
  sd.target_node_id,
  sd.target_node_type,
  sd.target_table,
  sd.observed_version,
  CASE sd.target_table
    WHEN 'user_balances' THEN ub.version
    WHEN 'user_program_statuses' THEN ups.version
    WHEN 'plans' THEN p.version
    WHEN 'plan_steps' THEN depended_step.version
    WHEN 'transfers_to' THEN tt.version
  END AS current_version
FROM state_dependencies sd
JOIN plan_steps ps ON ps.id = sd.plan_step_id
LEFT JOIN user_balances ub
  ON sd.target_table = 'user_balances'
 AND ub.id = sd.target_node_id
LEFT JOIN user_program_statuses ups
  ON sd.target_table = 'user_program_statuses'
 AND ups.id = sd.target_node_id
LEFT JOIN plans p
  ON sd.target_table = 'plans'
 AND p.id = sd.target_node_id
LEFT JOIN plan_steps depended_step
  ON sd.target_table = 'plan_steps'
 AND depended_step.id = sd.target_node_id
LEFT JOIN transfers_to tt
  ON sd.target_table = 'transfers_to'
 AND tt.id = sd.target_node_id
WHERE ps.status NOT IN ('stale', 'superseded')
  AND CASE sd.target_table
    WHEN 'user_balances' THEN ub.version
    WHEN 'user_program_statuses' THEN ups.version
    WHEN 'plans' THEN p.version
    WHEN 'plan_steps' THEN depended_step.version
    WHEN 'transfers_to' THEN tt.version
  END IS NOT NULL
  AND CASE sd.target_table
    WHEN 'user_balances' THEN ub.version
    WHEN 'user_program_statuses' THEN ups.version
    WHEN 'plans' THEN p.version
    WHEN 'plan_steps' THEN depended_step.version
    WHEN 'transfers_to' THEN tt.version
  END <> sd.observed_version;

CREATE FUNCTION mark_user_balance_dependents_stale_backstop()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('rewards.skip_user_balance_staleness_backstop', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.balance_points IS NOT DISTINCT FROM OLD.balance_points
     AND NEW.version IS NOT DISTINCT FROM OLD.version THEN
    RETURN NEW;
  END IF;

  UPDATE plan_steps ps
     SET status = 'stale',
         stale_reason = 'Balance dependency changed',
         version = ps.version + 1,
         updated_at = now()
    FROM plans p,
         state_dependencies sd
   WHERE ps.plan_id = p.id
     AND sd.plan_step_id = ps.id
     AND p.user_id = NEW.user_id
     AND p.status = 'current'
     AND ps.status = 'current'
     AND sd.target_table = 'user_balances'
     AND sd.target_node_id = NEW.id;

  UPDATE plans p
     SET status = 'stale',
         stale_reason = 'Balance dependency changed',
         version = p.version + 1,
         updated_at = now()
   WHERE p.user_id = NEW.user_id
     AND p.status = 'current'
     AND EXISTS (
       SELECT 1
         FROM plan_steps ps
         JOIN state_dependencies sd ON sd.plan_step_id = ps.id
        WHERE ps.plan_id = p.id
          AND sd.target_table = 'user_balances'
          AND sd.target_node_id = NEW.id
     );

  RETURN NEW;
END;
$$;

CREATE TRIGGER user_balances_staleness_backstop
AFTER UPDATE OF balance_points, version ON user_balances
FOR EACH ROW
EXECUTE FUNCTION mark_user_balance_dependents_stale_backstop();

CREATE FUNCTION claim_replan_jobs(
  p_worker_id TEXT,
  p_limit INTEGER DEFAULT 10,
  p_lease_duration INTERVAL DEFAULT interval '30 seconds'
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  plan_lineage_id UUID,
  source_plan_id UUID,
  attempt_count INTEGER
)
LANGUAGE sql
AS $$
  WITH claimable AS (
    SELECT job.id
      FROM replan_jobs job
     WHERE job.available_at <= now()
       AND job.attempt_count < job.max_attempts
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
  source_balance user_balances%ROWTYPE;
  dest_balance user_balances%ROWTYPE;
  new_source_version INTEGER;
  new_dest_version INTEGER;
  v_mutation_txn_id UUID := gen_random_uuid();
  response_payload JSONB;
  stale_plan RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('graph_write:' || p_user_id::text, 0));

  IF p_amount_points <= 0 THEN
    RAISE EXCEPTION 'amount_points must be greater than 0';
  END IF;

  IF p_source_balance_id = p_dest_balance_id THEN
    RAISE EXCEPTION 'source and destination balances must differ';
  END IF;

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
  )
  ON CONFLICT (user_id, operation_type, idempotency_key)
  DO UPDATE
     SET updated_at = idempotency_records.updated_at;

  SELECT *
    INTO existing_idempotency
    FROM idempotency_records
   WHERE user_id = p_user_id
     AND operation_type = 'TransferPoints'
     AND idempotency_key = p_idempotency_key
   FOR UPDATE;

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
  ELSIF existing_idempotency.status = 'in_progress'
        AND existing_idempotency.mutation_txn_id IS DISTINCT FROM v_mutation_txn_id THEN
    RAISE EXCEPTION 'idempotency request already in progress';
  END IF;

  SELECT *
    INTO source_balance
    FROM user_balances
   WHERE id = p_source_balance_id
     AND user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'source balance does not exist';
  END IF;

  SELECT *
    INTO dest_balance
    FROM user_balances
   WHERE id = p_dest_balance_id
     AND user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'destination balance does not exist';
  END IF;

  IF source_balance.program_id = dest_balance.program_id THEN
    RAISE EXCEPTION 'source and destination programs must differ';
  END IF;

  IF source_balance.version <> p_source_expected_version THEN
    RAISE EXCEPTION 'source balance version conflict';
  END IF;

  IF dest_balance.version <> p_dest_expected_version THEN
    RAISE EXCEPTION 'destination balance version conflict';
  END IF;

  IF source_balance.balance_points < p_amount_points THEN
    RAISE EXCEPTION 'insufficient source balance';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM transfers_to route
     WHERE route.source_program_id = source_balance.program_id
       AND route.dest_program_id = dest_balance.program_id
       AND route.is_active
       AND (route.valid_from IS NULL OR route.valid_from <= now())
       AND (route.valid_until IS NULL OR route.valid_until > now())
  ) THEN
    RAISE EXCEPTION 'active transfer route does not exist';
  END IF;

  PERFORM set_config('rewards.skip_user_balance_staleness_backstop', 'on', true);

  UPDATE user_balances
     SET balance_points = balance_points - p_amount_points,
         version = version + 1,
         updated_at = now()
   WHERE id = p_source_balance_id
  RETURNING version INTO new_source_version;

  UPDATE user_balances
     SET balance_points = balance_points + p_amount_points,
         version = version + 1,
         updated_at = now()
   WHERE id = p_dest_balance_id
  RETURNING version INTO new_dest_version;

  INSERT INTO graph_mutations (
    mutation_txn_id,
    user_id,
    mutation_type,
    target_table,
    target_node_id,
    summary,
    before,
    after
  )
  VALUES
    (
      v_mutation_txn_id,
      p_user_id,
      'TransferPoints',
      'user_balances',
      p_source_balance_id,
      'Transferred points from source balance',
      to_jsonb(source_balance),
      jsonb_build_object(
        'balance_points',
        source_balance.balance_points - p_amount_points,
        'version',
        new_source_version,
        'actor',
        p_actor
      )
    ),
    (
      v_mutation_txn_id,
      p_user_id,
      'TransferPoints',
      'user_balances',
      p_dest_balance_id,
      'Transferred points to destination balance',
      to_jsonb(dest_balance),
      jsonb_build_object(
        'balance_points',
        dest_balance.balance_points + p_amount_points,
        'version',
        new_dest_version,
        'actor',
        p_actor
      )
    );

  FOR stale_plan IN
    SELECT DISTINCT p.id, p.plan_lineage_id
      FROM plans p
      JOIN plan_steps ps ON ps.plan_id = p.id
      JOIN state_dependencies sd ON sd.plan_step_id = ps.id
     WHERE p.user_id = p_user_id
       AND p.status = 'current'
       AND sd.target_table = 'user_balances'
       AND sd.target_node_id IN (p_source_balance_id, p_dest_balance_id)
  LOOP
    UPDATE plans
       SET status = 'stale',
           stale_reason = 'Balance dependency changed during TransferPoints',
           version = version + 1,
           updated_at = now()
     WHERE id = stale_plan.id
       AND status = 'current';

    UPDATE plan_steps
       SET status = 'stale',
           stale_reason = 'Balance dependency changed during TransferPoints',
           version = version + 1,
           updated_at = now()
     WHERE plan_id = stale_plan.id
       AND status = 'current';

    INSERT INTO graph_mutations (
      mutation_txn_id,
      user_id,
      plan_lineage_id,
      plan_id,
      mutation_type,
      target_table,
      target_node_id,
      summary,
      before,
      after
    )
    VALUES (
      v_mutation_txn_id,
      p_user_id,
      stale_plan.plan_lineage_id,
      stale_plan.id,
      'MarkStale',
      'plans',
      stale_plan.id,
      'Marked plan stale after balance dependency changed during TransferPoints',
      NULL,
      jsonb_build_object('status', 'stale', 'actor', p_actor)
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
      stale_plan.plan_lineage_id,
      stale_plan.id,
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

CREATE FUNCTION promote_replan_job_success(
  p_job_id UUID,
  p_worker_id TEXT,
  p_result_plan_id UUID
)
RETURNS TABLE (
  job_id UUID,
  source_plan_id UUID,
  result_plan_id UUID
)
LANGUAGE plpgsql
AS $$
DECLARE
  job replan_jobs%ROWTYPE;
BEGIN
  SELECT *
    INTO job
    FROM replan_jobs
   WHERE id = p_job_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'replan job does not exist';
  END IF;

  IF job.status <> 'processing'
     OR job.locked_by <> p_worker_id
     OR job.lease_expires_at <= now() THEN
    RAISE EXCEPTION 'replan job lease is not active for worker';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM plans result_plan
     WHERE result_plan.id = p_result_plan_id
       AND result_plan.supersedes_plan_id = job.source_plan_id
  ) THEN
    RAISE EXCEPTION 'result plan is not direct successor of source plan';
  END IF;

  UPDATE plans
     SET status = 'current',
         version = version + 1,
         updated_at = now()
   WHERE id = p_result_plan_id
     AND status = 'generating';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'result plan must be generating before promotion';
  END IF;

  UPDATE plans
     SET status = 'superseded',
         version = version + 1,
         updated_at = now()
   WHERE id = job.source_plan_id
     AND status = 'stale';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'source plan must be stale before promotion';
  END IF;

  UPDATE plan_steps
     SET status = 'current',
         version = version + 1,
         updated_at = now()
   WHERE plan_id = p_result_plan_id
     AND status = 'proposed';

  UPDATE plan_steps
     SET status = 'superseded',
         version = version + 1,
         updated_at = now()
   WHERE plan_id = job.source_plan_id
     AND status = 'stale';

  UPDATE replan_jobs
     SET status = 'completed',
         result_plan_id = p_result_plan_id,
         completed_at = now(),
         updated_at = now()
   WHERE id = p_job_id;

  job_id := p_job_id;
  source_plan_id := job.source_plan_id;
  result_plan_id := p_result_plan_id;
  RETURN NEXT;
END;
$$;
