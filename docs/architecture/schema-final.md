# Schema — Final (Locked) · v3.1

> **Status:** Locked for the sprint. Supersedes `schema-v2.md` and **v3 closeout draft**. Additive-only after sign-off (new optional columns / new tables allowed; no renames, removals, or retypes without an ADR + lead sign-off).
> **Reflects:** ADR 0001 (schema lock, **Accepted** 2026-06-18), ADR 0002, ADR 0003, ADRs 0004–0008, architecture closeout D019–D027 (`context/architecture-context.md`).
> **Owner:** Alan (Graph/Persistence). Reviewed by Raq (lead).
> **Scope note:** Layers 1–3 are the locked core. **Layer 4 (§9) is stretch** — not Day-1 lock.

**Canonical artifact:** `schema/schema.sql` + JSON Schema in `schema/contracts/` + generated shared types.

---

## 0. Storage & conventions (read first)

- **Engine:** PostgreSQL only. No graph DB. Multi-hop traversal via recursive CTEs.
- **Physical layout:** **table-per-type** (one table per node type, one per edge type). `node_type` is a constant text discriminator on every node row.
- **Tiers:** every node row carries `graph_tier ∈ {world, personal, plan}`. World = shared; personal = per-user; plan = per-query/lineage.
- **IDs:** `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`. World nodes also carry unique `slug text` for idempotent seed.
- **Money:** integer **cents**. Never float.
- **Ratios / CPP:** integer **basis points** (`10000 = 1.0`). `toBasisPoints()` / `fromBasisPoints()` util ships Day 1.
- **Points / balances:** integer.
- **Time:** `timestamptz`, UTC.
- **Concurrency:** integer `version` (default 0, increment on write) on mutable tables. See §6.
- **Enums:** `text` + `CHECK` constraint (not native PG ENUM).
- **Plan lifecycle:** `plans.status` is **authoritative for UI actionability**. No `is_current` boolean. See §4.1.
- **Referential integrity:** real FKs everywhere except polymorphic `state_dependencies` (B5).

### Node inventory (locked core)

| Table                   | Tier     | node_type           | OCC     | Writer                      |
| ----------------------- | -------- | ------------------- | ------- | --------------------------- |
| `users`                 | personal | `User`              | yes     | seed / wallet               |
| `credit_cards`          | world    | `CreditCard`        | no      | seed                        |
| `reward_programs`       | world    | `RewardProgram`     | no      | seed                        |
| `spend_categories`      | world    | `SpendCategory`     | no      | seed                        |
| `redemption_options`    | world    | `RedemptionOption`  | no      | seed                        |
| `user_balances`         | personal | `UserBalance`       | **yes** | **wallet agent (sole)**     |
| `user_program_statuses` | personal | `UserProgramStatus` | yes     | wallet agent                |
| `user_goals`            | personal | `UserGoal`          | no      | wallet agent                |
| `plans`                 | plan     | `Plan`              | **yes** | orchestrator                |
| `plan_steps`            | plan     | `PlanStep`          | **yes** | **redemption agent (sole)** |
| `agent_runs`            | plan     | `AgentRun`          | yes     | each agent (own row)        |
| `external_quotes`       | world    | `ExternalQuote`     | no      | graph-typed tools           |

### Infrastructure tables (not graph nodes)

| Table                 | Purpose                                                      |
| --------------------- | ------------------------------------------------------------ |
| `graph_mutations`     | Append-only audit + SSE replay log (user-scoped MVP)         |
| `replan_jobs`         | Durable async re-plan work queue with lease recovery         |
| `idempotency_records` | Scoped mutation deduplication                                |
| `evaluations`         | Benchmark/eval metric rows (FK to `plans`; not a graph node) |

### Edge inventory (locked core)

| Table                | From → To                          | Mutable | Purpose                  |
| -------------------- | ---------------------------------- | ------- | ------------------------ |
| `holds`              | User → CreditCard                  | no      | wallet membership        |
| `earns`              | CreditCard → SpendCategory         | no      | earn rate per category   |
| `transfers_to`       | RewardProgram → RewardProgram      | **yes** | transfer route + ratio   |
| `redeems_via`        | RewardProgram → RedemptionOption   | no      | redemption surfaces      |
| `targets`            | Plan → UserGoal                    | no      | plan intent              |
| `state_dependencies` | PlanStep → (any node, polymorphic) | **yes** | dependency-tracking edge |

> **Unified transfers (locked):** Transfers are `transfers_to` edges between two `reward_programs`. No separate `TransferPartner` node.

---

## 1. World graph (shared, seeded)

### 1.1 `credit_cards`

| Column                     | Type        | Constraints / notes                              |
| -------------------------- | ----------- | ------------------------------------------------ |
| id                         | uuid        | PK                                               |
| slug                       | text        | UNIQUE                                           |
| name                       | text        | NOT NULL                                         |
| issuer                     | text        | NOT NULL                                         |
| network                    | text        | CHECK in (`visa`,`mastercard`,`amex`,`discover`) |
| annual_fee_cents           | integer     | NOT NULL DEFAULT 0                               |
| reward_program_id          | uuid        | FK → reward_programs(id)                         |
| signup_bonus_points        | integer     | nullable                                         |
| signup_bonus_spend_cents   | integer     | nullable                                         |
| signup_bonus_deadline_days | integer     | nullable                                         |
| is_active                  | boolean     | NOT NULL DEFAULT true                            |
| graph_tier                 | text        | CHECK = `world`                                  |
| node_type                  | text        | CHECK = `CreditCard`                             |
| created_at / updated_at    | timestamptz | UTC                                              |

### 1.2 `reward_programs`

| Column                  | Type        | Constraints / notes                                           |
| ----------------------- | ----------- | ------------------------------------------------------------- |
| id                      | uuid        | PK                                                            |
| slug                    | text        | UNIQUE                                                        |
| name                    | text        | NOT NULL                                                      |
| issuer                  | text        | nullable                                                      |
| program_kind            | text        | CHECK in (`issuer_transferable`,`airline`,`hotel`,`cashback`) |
| currency_name           | text        | NOT NULL                                                      |
| min_redemption_points   | integer     | nullable                                                      |
| points_expire_months    | integer     | nullable                                                      |
| is_active               | boolean     | NOT NULL DEFAULT true                                         |
| graph_tier              | text        | CHECK = `world`                                               |
| node_type               | text        | CHECK = `RewardProgram`                                       |
| created_at / updated_at | timestamptz | UTC                                                           |

### 1.3 `spend_categories`

| Column     | Type      | Constraints / notes                                           |
| ---------- | --------- | ------------------------------------------------------------- |
| id         | uuid      | PK                                                            |
| slug       | text      | UNIQUE                                                        |
| name       | text      | NOT NULL                                                      |
| parent_id  | uuid      | FK → spend_categories(id), nullable; no cycles (app-enforced) |
| mcc_codes  | integer[] | GIN index                                                     |
| graph_tier | text      | CHECK = `world`                                               |
| node_type  | text      | CHECK = `SpendCategory`                                       |

### 1.4 `redemption_options`

| Column                   | Type    | Constraints / notes                                                                                |
| ------------------------ | ------- | -------------------------------------------------------------------------------------------------- |
| id                       | uuid    | PK                                                                                                 |
| program_id               | uuid    | FK → reward_programs(id)                                                                           |
| option_type              | text    | CHECK in (`travel_portal`,`transfer_partner`,`statement_credit`,`gift_card`,`check`,`merchandise`) |
| cpp_basis_points         | integer | NOT NULL                                                                                           |
| min_points               | integer | nullable                                                                                           |
| description              | text    | nullable                                                                                           |
| valid_from / valid_until | date    | nullable                                                                                           |
| graph_tier               | text    | CHECK = `world`                                                                                    |
| node_type                | text    | CHECK = `RedemptionOption`                                                                         |

### 1.5 `external_quotes`

| Column               | Type        | Constraints / notes                          |
| -------------------- | ----------- | -------------------------------------------- |
| id                   | uuid        | PK                                           |
| quote_type           | text        | CHECK in (`cash_price`,`award_availability`) |
| program_id           | uuid        | FK → reward_programs(id), nullable           |
| redemption_option_id | uuid        | FK → redemption_options(id), nullable        |
| subject              | text        | NOT NULL                                     |
| value_cents          | integer     | nullable                                     |
| points_cost          | integer     | nullable                                     |
| source_tool          | text        | NOT NULL                                     |
| fetched_at           | timestamptz | NOT NULL                                     |
| valid_until          | timestamptz | nullable                                     |
| plan_id              | uuid        | FK → plans(id), nullable                     |
| payload              | jsonb       | NOT NULL                                     |
| graph_tier           | text        | CHECK = `world`                              |
| node_type            | text        | CHECK = `ExternalQuote`                      |

---

## 2. Transfer routes

### `transfers_to` — RewardProgram → RewardProgram

| Column                      | Type        | Constraints / notes                                         |
| --------------------------- | ----------- | ----------------------------------------------------------- |
| id                          | uuid        | PK                                                          |
| source_program_id           | uuid        | FK → reward_programs(id)                                    |
| dest_program_id             | uuid        | FK → reward_programs(id)                                    |
| transfer_ratio_basis_points | integer     | NOT NULL; `10000` = 1:1                                     |
| transfer_time_days          | integer     | nullable                                                    |
| valid_from / valid_until    | timestamptz | nullable                                                    |
| is_active                   | boolean     | NOT NULL DEFAULT true                                       |
| version                     | integer     | NOT NULL DEFAULT 0                                          |
| created_at / updated_at     | timestamptz | UTC                                                         |
|                             |             | UNIQUE (source_program_id, dest_program_id) WHERE is_active |

Traversal: `source -transfers_to-> dest -redeems_via-> option`.

---

## 3. Personal graph (per-user)

### 3.1 `users`

| Column                  | Type        | Constraints / notes                          |
| ----------------------- | ----------- | -------------------------------------------- |
| id                      | uuid        | PK                                           |
| clerk_id                | text        | **UNIQUE NOT NULL** — Clerk identity mapping |
| display_name            | text        | nullable                                     |
| graph_tier              | text        | CHECK = `personal`                           |
| node_type               | text        | CHECK = `User`                               |
| version                 | integer     | NOT NULL DEFAULT 0                           |
| created_at / updated_at | timestamptz | UTC                                          |

First login clones **bootstrap template** (demo persona) into this user's personal graph — not a shared global user row.

### 3.2 `user_balances`

| Column                  | Type        | Constraints / notes                                                 |
| ----------------------- | ----------- | ------------------------------------------------------------------- |
| id                      | uuid        | PK                                                                  |
| user_id                 | uuid        | FK → users(id)                                                      |
| program_id              | uuid        | FK → reward_programs(id)                                            |
| balance_points          | integer     | NOT NULL DEFAULT 0; CHECK >= 0                                      |
| as_of                   | timestamptz | NOT NULL DEFAULT now()                                              |
| source                  | text        | CHECK in (`manual_entry`,`agent_computed`) — no `plaid_sync` in MVP |
| graph_tier              | text        | CHECK = `personal`                                                  |
| node_type               | text        | CHECK = `UserBalance`                                               |
| version                 | integer     | NOT NULL DEFAULT 0                                                  |
| created_at / updated_at | timestamptz | UTC                                                                 |
|                         |             | UNIQUE (user_id, program_id) — B4                                   |

### 3.3 `user_program_statuses`

| Column                  | Type        | Constraints / notes          |
| ----------------------- | ----------- | ---------------------------- |
| id                      | uuid        | PK                           |
| user_id                 | uuid        | FK → users(id)               |
| program_id              | uuid        | FK → reward_programs(id)     |
| status_tier             | text        | NOT NULL                     |
| tier_benefits           | jsonb       | nullable                     |
| valid_through           | date        | nullable                     |
| graph_tier              | text        | CHECK = `personal`           |
| node_type               | text        | CHECK = `UserProgramStatus`  |
| version                 | integer     | NOT NULL DEFAULT 0           |
| created_at / updated_at | timestamptz | UTC                          |
|                         |             | UNIQUE (user_id, program_id) |

### 3.4 `user_goals`

| Column                  | Type        | Constraints / notes                                                                    |
| ----------------------- | ----------- | -------------------------------------------------------------------------------------- |
| id                      | uuid        | PK                                                                                     |
| user_id                 | uuid        | FK → users(id)                                                                         |
| goal_type               | text        | CHECK in (`maximize_points`,`maximize_cashback`,`specific_redemption`,`minimize_fees`) |
| target_redemption_id    | uuid        | FK → redemption_options(id), nullable                                                  |
| description             | text        | nullable — e.g. "Tokyo trip October"                                                   |
| priority                | integer     | NOT NULL DEFAULT 1                                                                     |
| graph_tier              | text        | CHECK = `personal`                                                                     |
| node_type               | text        | CHECK = `UserGoal`                                                                     |
| created_at / updated_at | timestamptz | UTC                                                                                    |

### 3.5 `holds` — User → CreditCard

| Column         | Type        | Constraints / notes              |
| -------------- | ----------- | -------------------------------- |
| id             | uuid        | PK                               |
| user_id        | uuid        | FK → users(id)                   |
| credit_card_id | uuid        | FK → credit_cards(id)            |
| opened_date    | date        | nullable                         |
| is_primary     | boolean     | NOT NULL DEFAULT false           |
| created_at     | timestamptz | UTC                              |
|                |             | UNIQUE (user_id, credit_card_id) |

### 3.6 `earns` — CreditCard → SpendCategory

| Column                   | Type        | Constraints / notes                                 |
| ------------------------ | ----------- | --------------------------------------------------- |
| id                       | uuid        | PK                                                  |
| credit_card_id           | uuid        | FK → credit_cards(id)                               |
| spend_category_id        | uuid        | FK → spend_categories(id)                           |
| earn_rate_basis_points   | integer     | NOT NULL; CHECK >= 0                                |
| earn_type                | text        | CHECK in (`points`,`miles`,`cashback_pct`)          |
| cap_amount_cents         | integer     | nullable                                            |
| cap_period               | text        | CHECK in (`annual`,`quarterly`,`monthly`), nullable |
| valid_from / valid_until | date        | nullable                                            |
| created_at               | timestamptz | UTC                                                 |
|                          |             | UNIQUE (credit_card_id, spend_category_id)          |

### 3.7 `redeems_via` — RewardProgram → RedemptionOption

| Column               | Type        | Constraints / notes                       |
| -------------------- | ----------- | ----------------------------------------- |
| id                   | uuid        | PK                                        |
| program_id           | uuid        | FK → reward_programs(id)                  |
| redemption_option_id | uuid        | FK → redemption_options(id)               |
| created_at           | timestamptz | UTC                                       |
|                      |             | UNIQUE (program_id, redemption_option_id) |

---

## 4. Plan graph + dependency tracking

### 4.1 Plan lifecycle (authoritative)

**Plan revision status** (`plans.status` for `plan_type = agent_generated`):

| Status       | Meaning                                                |
| ------------ | ------------------------------------------------------ |
| `generating` | Initial creation or re-plan revision being built       |
| `current`    | **Only actionable revision** for this lineage          |
| `stale`      | Invalidated by personal-state change; awaiting re-plan |
| `failed`     | Generation or re-plan failed                           |
| `superseded` | Replaced by newer revision; historical                 |

**Plan-step status** (`plan_steps.status`):

| Status       | Meaning                                    |
| ------------ | ------------------------------------------ |
| `proposed`   | Created during generation; not yet final   |
| `current`    | Active step on current/generating revision |
| `stale`      | Invalidated by personal-state change       |
| `superseded` | Belongs to superseded plan revision        |

**Rules:**

1. Only `plans.status = 'current'` is actionable in the UI.
2. Only one revision per **`plan_lineage_id`** may have `status = 'current'`.
3. A user may have **many lineages** (separate goals/trips) — **no** per-user single-current-plan constraint.
4. On invalidation: current revision → `stale`; steps → `stale`; `replan_jobs` row inserted (same txn).
5. Re-plan creates new revision `generating` → on success `current`; prior → `superseded`.
6. On re-plan failure: stale revision stays `stale`; never restored to `current`.
7. **No `is_current` boolean. No `plan_steps.is_stale` boolean.**

**Baseline plans** (`plan_type ∈ {baseline_single_agent, baseline_free_text_multiagent}`):

- Use simplified status: `completed` or `failed` only.
- `plan_lineage_id` = `id` (self); no replan jobs; no `plan_steps`.
- CHECK enforced in DDL (see `schema/schema.sql`).

### 4.2 `plans`

| Column                  | Type        | Constraints / notes                                                                  |
| ----------------------- | ----------- | ------------------------------------------------------------------------------------ |
| id                      | uuid        | PK                                                                                   |
| user_id                 | uuid        | FK → users(id)                                                                       |
| plan_lineage_id         | uuid        | NOT NULL — stable across revisions                                                   |
| revision_number         | integer     | NOT NULL DEFAULT 1                                                                   |
| supersedes_plan_id      | uuid        | FK → plans(id), nullable                                                             |
| query_text              | text        | NOT NULL for agent_generated                                                         |
| status                  | text        | See §4.1 + baseline exception                                                        |
| stale_reason            | text        | nullable — populated when status → stale                                             |
| plan_type               | text        | CHECK in (`agent_generated`,`baseline_single_agent`,`baseline_free_text_multiagent`) |
| benchmark_query_id      | uuid        | nullable                                                                             |
| raw_output              | jsonb       | nullable — baselines only                                                            |
| summary                 | text        | nullable                                                                             |
| version                 | integer     | NOT NULL DEFAULT 0                                                                   |
| graph_tier              | text        | CHECK = `plan`                                                                       |
| node_type               | text        | CHECK = `Plan`                                                                       |
| created_at / updated_at | timestamptz | UTC                                                                                  |

```sql
CREATE UNIQUE INDEX plans_one_current_revision
  ON plans (plan_lineage_id)
  WHERE status = 'current';
```

### 4.3 `plan_steps`

| Column                  | Type        | Constraints / notes                                                                                 |
| ----------------------- | ----------- | --------------------------------------------------------------------------------------------------- |
| id                      | uuid        | PK                                                                                                  |
| plan_id                 | uuid        | FK → plans(id) ON DELETE CASCADE                                                                    |
| step_order              | integer     | NOT NULL                                                                                            |
| step_type               | text        | CHECK in (`card_assignment`,`redemption_recommendation`,`spend_analysis`,`transfer_recommendation`) |
| payload                 | jsonb       | NOT NULL DEFAULT '{}'                                                                               |
| status                  | text        | CHECK in (`proposed`,`current`,`stale`,`superseded`)                                                |
| staled_at               | timestamptz | nullable                                                                                            |
| stale_reason            | text        | nullable                                                                                            |
| result                  | jsonb       | nullable                                                                                            |
| error                   | text        | nullable                                                                                            |
| version                 | integer     | NOT NULL DEFAULT 0                                                                                  |
| graph_tier              | text        | CHECK = `plan`                                                                                      |
| node_type               | text        | CHECK = `PlanStep`                                                                                  |
| created_at / updated_at | timestamptz | UTC                                                                                                 |
|                         |             | UNIQUE (plan_id, step_order)                                                                        |

### 4.4 `state_dependencies`

| Column            | Type        | Constraints / notes                   |
| ----------------- | ----------- | ------------------------------------- |
| id                | uuid        | PK                                    |
| plan_step_id      | uuid        | FK → plan_steps(id) ON DELETE CASCADE |
| target_node_id    | uuid        | NOT NULL — polymorphic, no FK         |
| target_node_type  | text        | NOT NULL                              |
| target_table      | text        | NOT NULL                              |
| depended_property | text        | nullable                              |
| observed_version  | integer     | NOT NULL                              |
| snapshot_value    | jsonb       | NOT NULL                              |
| created_at        | timestamptz | UTC                                   |

**MVP staleness scope (B2):** personal-tier nodes only — `user_balances`, `user_program_statuses`. World edges out of scope.

### 4.5 `targets` — Plan → UserGoal

| Column       | Type        | Constraints / notes              |
| ------------ | ----------- | -------------------------------- |
| id           | uuid        | PK                               |
| plan_id      | uuid        | FK → plans(id) ON DELETE CASCADE |
| user_goal_id | uuid        | FK → user_goals(id)              |
| created_at   | timestamptz | UTC                              |
|              |             | UNIQUE (plan_id, user_goal_id)   |

### 4.6 `agent_runs`

| Column       | Type        | Constraints / notes                                                         |
| ------------ | ----------- | --------------------------------------------------------------------------- |
| id           | uuid        | PK                                                                          |
| agent_type   | text        | CHECK in (`orchestrator`,`wallet_agent`,`earning_agent`,`redemption_agent`) |
| plan_id      | uuid        | FK → plans(id), nullable                                                    |
| user_id      | uuid        | FK → users(id) — scope for audit                                            |
| started_at   | timestamptz | NOT NULL DEFAULT now()                                                      |
| completed_at | timestamptz | nullable                                                                    |
| status       | text        | CHECK in (`running`,`completed`,`failed`,`timed_out`)                       |
| state        | jsonb       | nullable — incl. `last_read_versions`                                       |
| token_count  | integer     | nullable                                                                    |
| error        | text        | nullable                                                                    |
| graph_tier   | text        | CHECK = `plan`                                                              |
| node_type    | text        | CHECK = `AgentRun`                                                          |

---

## 5. Write-path infrastructure

### 5.1 `graph_mutations` _(audit + SSE replay — NOT a work queue)_

| Column          | Type        | Constraints / notes                                             |
| --------------- | ----------- | --------------------------------------------------------------- |
| id              | bigserial   | PK — SSE `event_id`; monotonic **per user** when §6.3 lock held |
| mutation_txn_id | uuid        | NOT NULL — groups rows in one commit                            |
| user_id         | uuid        | FK → users(id), **NOT NULL** — MVP user-scoped only             |
| plan_lineage_id | uuid        | nullable                                                        |
| plan_id         | uuid        | FK → plans(id), nullable                                        |
| agent_run_id    | uuid        | FK → agent_runs(id), nullable                                   |
| mutation_type   | text        | NOT NULL — e.g. `TransferPoints`, `CreatePlanStep`              |
| target_table    | text        | nullable                                                        |
| target_node_id  | uuid        | nullable                                                        |
| summary         | text        | NOT NULL                                                        |
| before          | jsonb       | nullable                                                        |
| after           | jsonb       | nullable                                                        |
| committed_at    | timestamptz | NOT NULL DEFAULT now()                                          |

MVP: all rows require `user_id`. Layer 4 global events excluded from sidebar until stretch adds `visibility_scope`.

### 5.2 `replan_jobs` _(durable work queue)_

| Column                  | Type        | Constraints / notes                                                 |
| ----------------------- | ----------- | ------------------------------------------------------------------- |
| id                      | uuid        | PK                                                                  |
| user_id                 | uuid        | FK → users(id)                                                      |
| plan_lineage_id         | uuid        | NOT NULL                                                            |
| source_plan_id          | uuid        | FK → plans(id) — stale revision at enqueue                          |
| trigger_mutation_txn_id | uuid        | NOT NULL                                                            |
| idempotency_key         | text        | NOT NULL UNIQUE — e.g. `{plan_lineage_id}:{mutation_txn_id}`        |
| status                  | text        | CHECK in (`pending`,`processing`,`completed`,`failed`,`superseded`) |
| attempt_count           | integer     | NOT NULL DEFAULT 0                                                  |
| max_attempts            | integer     | NOT NULL DEFAULT 3                                                  |
| available_at            | timestamptz | NOT NULL DEFAULT now()                                              |
| locked_at               | timestamptz | nullable                                                            |
| locked_by               | text        | nullable — `hostname:pid`                                           |
| lease_expires_at        | timestamptz | nullable                                                            |
| result_plan_id          | uuid        | FK → plans(id), nullable                                            |
| error                   | text        | nullable                                                            |
| created_at / updated_at | timestamptz | UTC                                                                 |
| completed_at            | timestamptz | nullable                                                            |

**Claiming:** `pending` where `available_at <= now()`, or `processing` where `lease_expires_at < now()`. Use `FOR UPDATE SKIP LOCKED`. Increment `attempt_count` on claim. Job completion + new revision `current` + prior `superseded` in **one transaction**.

### 5.3 `idempotency_records`

| Column           | Type        | Constraints / notes                               |
| ---------------- | ----------- | ------------------------------------------------- |
| id               | uuid        | PK                                                |
| user_id          | uuid        | FK → users(id)                                    |
| operation_type   | text        | NOT NULL — e.g. `TransferPoints`                  |
| idempotency_key  | text        | NOT NULL                                          |
| request_hash     | text        | NOT NULL — canonical hash of request body         |
| mutation_txn_id  | uuid        | NOT NULL                                          |
| result_reference | jsonb       | NOT NULL                                          |
| created_at       | timestamptz | NOT NULL DEFAULT now()                            |
|                  |             | UNIQUE (user_id, operation_type, idempotency_key) |

Same key + same hash → replay outcome. Same key + different hash → **409 conflict**.

---

## 6. Graph-write contract

### 6.1 Optimistic concurrency

```sql
UPDATE user_balances
   SET balance_points = $new, version = version + 1, updated_at = now()
 WHERE id = $id AND version = $expected_version;
-- rowcount = 0 -> ConflictError -> retry (max 3)
```

### 6.2 Mutation ownership

| Writer              | May write                                                                      |
| ------------------- | ------------------------------------------------------------------------------ |
| wallet agent        | personal-tier nodes                                                            |
| redemption agent    | `plan_steps`, `state_dependencies`                                             |
| earning agent       | own plan-step contributions only                                               |
| orchestrator        | `plans`, `targets`                                                             |
| graph-write service | `graph_mutations`, `replan_jobs`, `idempotency_records`, staleness propagation |

### 6.3 Per-user write serialization (SSE ordering)

Before mutating graph state or inserting `graph_mutations`:

```sql
SELECT pg_advisory_xact_lock(
  hashtextextended('graph_write:' || $user_id::text, 0)
);
```

Guarantees `graph_mutations.id` commit order matches **per-user** mutation stream. Not global cross-user ordering.

### 6.4 Invalidation + job enqueue (same transaction)

On personal-tier mutation (example: balance change):

```sql
-- 1. Apply balance change (or TransferPoints debit/credit)
-- 2. Mark current plan revision stale
UPDATE plans p
   SET status = 'stale', stale_reason = $reason, updated_at = now(), version = version + 1
 WHERE p.plan_lineage_id = $lineage_id AND p.status = 'current';

UPDATE plan_steps ps
   SET status = 'stale', staled_at = now(), stale_reason = $reason, updated_at = now()
  FROM plans p
 WHERE ps.plan_id = p.id AND p.id = $source_plan_id AND ps.status = 'current';

-- 3. Insert graph_mutations rows
-- 4. Insert replan_jobs (status = pending, source_plan_id = $source_plan_id)
-- 5. Insert idempotency_records if key present
```

### 6.5 Re-plan flow

1. Worker claims job → creates new `plans` row (`generating`, `revision_number + 1`).
2. Redemption agent subprocess writes new steps.
3. **Atomic promotion:** new → `current`; source → `superseded`; job → `completed`; `result_plan_id` set.
4. Failure after max attempts: job → `failed`; source stays `stale`.

### 6.6 `TransferPoints` domain validation

Enforced in graph-write before commit:

- `amount_points > 0`
- `source_program_id <> dest_program_id`
- Both balance rows belong to authenticated `user_id`
- Source `balance_points >= amount_points`
- Active `transfers_to` route exists (or domain error)
- Debit, credit, `graph_mutations`, invalidation, job enqueue, idempotency record — **one transaction**

### 6.7 Trigger backstop

`user_balances` AFTER UPDATE trigger re-applies plan/step staleness if write path bypassed in dev (does not enqueue jobs — application responsibility).

---

## 7. Validation taxonomy

1. **Structural** — types, required columns, CHECK enums.
2. **Referential** — FKs; polymorphic `state_dependencies` validated in-app + orphan sweep.
3. **Domain** — non-negative balances; unique natural keys; TransferPoints rules (§6.6).
4. **Ratio transitivity** — Layer 4 verifier only (§9).

---

## 8. Benchmark & evaluation

### `evaluations` _(infrastructure — not a graph node)_

| Column                                   | Type        | Notes                    |
| ---------------------------------------- | ----------- | ------------------------ |
| id                                       | uuid        | PK                       |
| plan_id                                  | uuid        | FK → plans(id)           |
| baseline_plan_id                         | uuid        | FK → plans(id), nullable |
| benchmark_query_id                       | uuid        | NOT NULL                 |
| total_value_cents / baseline_value_cents | integer     | nullable                 |
| improvement_basis_points                 | integer     | nullable                 |
| accuracy_score                           | boolean     | nullable                 |
| hallucination_count                      | integer     | nullable                 |
| token_cost_total                         | integer     | nullable                 |
| plan_invalidation_correct                | boolean     | nullable                 |
| domain_extension_correct                 | boolean     | nullable                 |
| metric_scores                            | jsonb       | nullable                 |
| evaluator_version                        | text        | NOT NULL                 |
| created_at                               | timestamptz | UTC                      |

**Benchmark integrity (I1):** Baselines write **only** `plans` (`raw_output`, status `completed`/`failed`) + `evaluations`. No `plan_steps`, `state_dependencies`, or coordination `agent_runs`. Same `serialize_world_graph(user_id)` read path.

---

## 9. STRETCH — Layer 4 · NOT Day-1 lock

> Cut-by-default per ADR 0003. Nothing in §1–8 depends on this.

- `mutation_proposals`, `transfer_bonuses`, verifier agent — see v3 §7 narrative.
- Future: `graph_mutations.visibility_scope = 'global'` for verified world-graph events.

---

## 10. Required indexes

See `schema/schema.sql`. Highlights:

- `plans_one_current_revision` on `(plan_lineage_id) WHERE status = 'current'`
- `graph_mutations (user_id, id)`
- `replan_jobs (status, available_at) WHERE status IN ('pending','processing')`
- `state_dependencies (target_table, target_node_id)`
- `plan_steps (status) WHERE status = 'stale'` — replaces v3 `is_stale` index
- All §8 v3 FK/OCC indexes retained

---

## 11. Seed fixture

- 20 `credit_cards` + programs; Chase UR + Amex MR transfer routes (Tokyo: Hyatt, United, ANA).
- Top ~50 MCC `spend_categories`.
- **Bootstrap template** (not one global user): 5 cards, ~240k points, Tokyo October goal — cloned per Clerk user on first login.

---

## 12. Changes from v3 → v3.1

1. **`plan_lineage_id`** + revision model; dropped `is_current`.
2. **Authoritative plan/step status lifecycle** (§4.1); dropped `plan_steps.is_stale`.
3. **`graph_mutations`**, **`replan_jobs`**, **`idempotency_records`** added.
4. **`users.clerk_id`** added.
5. **Personal graph tables** documented (§3).
6. **Per-user advisory lock** for SSE ordering (§6.3).
7. **Re-plan job leases** + atomic promotion (§5.2, §6.5).
8. **Scoped idempotency** with request fingerprint (§5.3).
9. **Baseline status exception** (§4.1).
10. Re-plan narrative: revision replacement, not in-place step refresh.

---

## 13. Sign-off

Locked when each lane confirms v3.1 shapes:

- [x] Alan (Graph) — DDL, write service, OCC, staleness, jobs, indexes, seed.
- [x] Raq (Orchestrator/lead) — contracts, idempotency, eval tables.
- [x] Michael (Redemption/Eval) — traversal, tool quotes, benchmark columns.
- [x] Val (Frontend) — SSE event shape, plan lifecycle UI, stale/superseded display.

Date locked: **2026-06-18** (ADR 0001 Accepted) · Canonical artifact: `schema/schema.sql` + `schema/contracts/` + generated types · DDL clean-DB apply test: **passed** (PostgreSQL 16, 22 tables, `psql -f schema/schema.sql`).
