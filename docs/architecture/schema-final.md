# Schema — Final · v3.1

> **Status:** Locked v3.1 architecture. [ADR 0004](../adr/0004-mvp-polymorphic-graph-schema.md) changes the MVP physical storage layout to polymorphic `nodes` / `edges`, but it does not supersede the plan lifecycle, dependency invalidation, or re-plan semantics in this file.
> **Reflects:** ADR 0001 (schema lock), ADR 0002 (research apparatus kept), ADR 0003 (four-person team; ingestion + verifier are stretch; Layer 4 cut-by-default).
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

| Table | Tier | node_type | OCC | Writer |
|---|---|---|---|---|
| `users` | personal | `User` | yes | seed / wallet |
| `credit_cards` | world | `CreditCard` | no | seed |
| `reward_programs` | world | `RewardProgram` | no | seed |
| `spend_categories` | world | `SpendCategory` | no | seed |
| `redemption_options` | world | `RedemptionOption` | no | seed |
| `user_balances` | personal | `UserBalance` | **yes** | **wallet agent (sole)** |
| `user_program_statuses` | personal | `UserProgramStatus` | yes | wallet agent |
| `user_goals` | personal | `UserGoal` | no | wallet agent |
| `plans` | plan | `Plan` | **yes** | orchestrator |
| `plan_steps` | plan | `PlanStep` | **yes** | **redemption agent (sole)** |
| `agent_runs` | plan | `AgentRun` | yes | each agent (own row) |
| `external_quotes` | world | `ExternalQuote` | no | graph-typed tools |

### Infrastructure tables (not graph nodes)

| Table | Purpose |
|---|---|
| `graph_mutations` | Append-only audit + SSE replay log (user-scoped MVP) |
| `replan_jobs` | Durable async re-plan work queue with lease recovery |
| `idempotency_records` | Scoped mutation deduplication |
| `evaluations` | Benchmark/eval metric rows (FK to `plans`; not a graph node) |

### Edge inventory (locked core)

| Table | From → To | Mutable | Purpose |
|---|---|---|---|
| `holds` | User → CreditCard | no | wallet membership |
| `earns` | CreditCard → SpendCategory | no | earn rate per category |
| `transfers_to` | RewardProgram → RewardProgram | **yes** | transfer route + ratio |
| `redeems_via` | RewardProgram → RedemptionOption | no | redemption surfaces |
| `targets` | Plan → UserGoal | no | plan intent |
| `state_dependencies` | PlanStep → (any node, polymorphic) | **yes** | dependency-tracking edge |

> **Unified transfers (locked):** Transfers are `transfers_to` edges between two `reward_programs`. No separate `TransferPartner` node.

---

## 1. World graph (shared, seeded)

### 1.1 `credit_cards`

| Column | Type | Constraints / notes |
|---|---|---|
| id | uuid | PK |
| slug | text | UNIQUE |
| name | text | NOT NULL |
| issuer | text | NOT NULL |
| network | text | CHECK in (`visa`,`mastercard`,`amex`,`discover`) |
| annual_fee_cents | integer | NOT NULL DEFAULT 0 |
| reward_program_id | uuid | FK → reward_programs(id) |
| signup_bonus_points | integer | nullable |
| signup_bonus_spend_cents | integer | nullable |
| signup_bonus_deadline_days | integer | nullable |
| is_active | boolean | NOT NULL DEFAULT true |
| graph_tier | text | CHECK = `world` |
| node_type | text | CHECK = `CreditCard` |
| created_at / updated_at | timestamptz | UTC |

### 1.2 `reward_programs`

| Column | Type | Constraints / notes |
|---|---|---|
| id | uuid | PK |
| slug | text | UNIQUE |
| name | text | NOT NULL |
| issuer | text | nullable |
| program_kind | text | CHECK in (`issuer_transferable`,`airline`,`hotel`,`cashback`) |
| currency_name | text | NOT NULL |
| min_redemption_points | integer | nullable |
| points_expire_months | integer | nullable |
| is_active | boolean | NOT NULL DEFAULT true |
| graph_tier | text | CHECK = `world` |
| node_type | text | CHECK = `RewardProgram` |
| created_at / updated_at | timestamptz | UTC |

### 1.3 `spend_categories`

| Column | Type | Constraints / notes |
|---|---|---|
| id | uuid | PK |
| slug | text | UNIQUE |
| name | text | NOT NULL |
| parent_id | uuid | FK → spend_categories(id), nullable; no cycles (app-enforced) |
| mcc_codes | integer[] | GIN index |
| graph_tier | text | CHECK = `world` |
| node_type | text | CHECK = `SpendCategory` |

### 1.4 `redemption_options`

| Column | Type | Constraints / notes |
|---|---|---|
| id | uuid | PK |
| program_id | uuid | FK → reward_programs(id) |
| option_type | text | CHECK in (`travel_portal`,`transfer_partner`,`statement_credit`,`gift_card`,`check`,`merchandise`) |
| cpp_basis_points | integer | NOT NULL |
| min_points | integer | nullable |
| description | text | nullable |
| valid_from / valid_until | date | nullable |
| graph_tier | text | CHECK = `world` |
| node_type | text | CHECK = `RedemptionOption` |

### 1.5 `external_quotes`

| Column | Type | Constraints / notes |
|---|---|---|
| id | uuid | PK |
| quote_type | text | CHECK in (`cash_price`,`award_availability`) |
| program_id | uuid | FK → reward_programs(id), nullable |
| redemption_option_id | uuid | FK → redemption_options(id), nullable |
| subject | text | NOT NULL |
| value_cents | integer | nullable |
| points_cost | integer | nullable |
| source_tool | text | NOT NULL |
| fetched_at | timestamptz | NOT NULL |
| valid_until | timestamptz | nullable |
| plan_id | uuid | FK → plans(id), nullable |
| payload | jsonb | NOT NULL |
| graph_tier | text | CHECK = `world` |
| node_type | text | CHECK = `ExternalQuote` |

---

## 2. Transfer routes

### `transfers_to` — RewardProgram → RewardProgram

| Column | Type | Constraints / notes |
|---|---|---|
| id | uuid | PK |
| source_program_id | uuid | FK → reward_programs(id) |
| dest_program_id | uuid | FK → reward_programs(id) |
| transfer_ratio_basis_points | integer | NOT NULL; `10000` = 1:1 |
| transfer_time_days | integer | nullable |
| valid_from / valid_until | timestamptz | nullable |
| is_active | boolean | NOT NULL DEFAULT true |
| version | integer | NOT NULL DEFAULT 0 |
| created_at / updated_at | timestamptz | UTC |
| | | UNIQUE (source_program_id, dest_program_id) WHERE is_active |

Traversal: `source -transfers_to-> dest -redeems_via-> option`.

---

## 3. Personal graph (per-user)

### 3.1 `users`

| Column | Type | Constraints / notes |
|---|---|---|
| id | uuid | PK |
| clerk_id | text | **UNIQUE NOT NULL** — Clerk identity mapping |
| display_name | text | nullable |
| graph_tier | text | CHECK = `personal` |
| node_type | text | CHECK = `User` |
| version | integer | NOT NULL DEFAULT 0 |
| created_at / updated_at | timestamptz | UTC |

First login clones **bootstrap template** (demo persona) into this user's personal graph — not a shared global user row.

### 3.2 `user_balances`

| Column | Type | Constraints / notes |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK → users(id) |
| plan_lineage_id | uuid | stable lineage shared by all revisions of this query |
| revision_number | integer | starts at 1; increments on successful re-plan |
| query_text | text | the NL query (shown in the demo sidebar) |
| status | text | CHECK in (`pending`,`in_progress`,`completed`,`failed`,`stale`,`superseded`) |
| plan_type | text | CHECK in (`agent_generated`,`baseline_single_agent`,`baseline_free_text_multiagent`) — partitions benchmark results by architecture |
| benchmark_query_id | uuid | nullable — joins the same benchmark query across architectures (review item I2) |
| raw_output | jsonb | nullable — full response for **baseline** plans (they don't write plan_steps; see §6) |
| summary | text | nullable |
| version | integer | NOT NULL DEFAULT 0 |
| graph_tier | text | CHECK = `plan` |
| node_type | text | CHECK = `Plan` |
| created_at / updated_at | timestamptz | UTC |

```sql
CREATE UNIQUE INDEX plans_one_current_revision
  ON plans (plan_lineage_id)
  WHERE status = 'current';
```

### 4.3 `plan_steps`

| Column | Type | Constraints / notes |
|---|---|---|
| id | uuid | PK |
| plan_id | uuid | FK → plans(id) |
| plan_lineage_id | uuid | copied from parent plan lineage for easy revision queries |
| revision_number | integer | starts at 1; successor steps increment the source revision |
| supersedes_plan_step_id | uuid | nullable FK → plan_steps(id), prior stale step this revision replaced |
| superseded_by_plan_step_id | uuid | nullable FK → plan_steps(id), successor that replaced this stale step |
| step_order | integer | NOT NULL — deterministic sequence |
| step_type | text | CHECK in (`card_assignment`,`redemption_recommendation`,`spend_analysis`,`transfer_recommendation`) |
| payload | jsonb | step-specific data |
| status | text | CHECK in (`pending`,`ready`,`in_progress`,`completed`,`failed`,`skipped`,**`stale`**,**`superseded`**) |
| is_stale | boolean | NOT NULL DEFAULT false |
| staled_at | timestamptz | nullable |
| stale_reason | text | nullable |
| result | jsonb | nullable |
| error | text | nullable |
| version | integer | NOT NULL DEFAULT 0 |
| graph_tier | text | CHECK = `plan` |
| node_type | text | CHECK = `PlanStep` |
| created_at / updated_at | timestamptz | UTC |
| | | UNIQUE (plan_id, step_order) |

### 4.4 `state_dependencies`

| Column | Type | Constraints / notes |
|---|---|---|
| id | uuid | PK |
| plan_step_id | uuid | FK → plan_steps(id) ON DELETE CASCADE |
| target_node_id | uuid | NOT NULL — polymorphic, no FK |
| target_node_type | text | NOT NULL |
| target_table | text | NOT NULL |
| depended_property | text | nullable |
| observed_version | integer | NOT NULL |
| snapshot_value | jsonb | NOT NULL |
| created_at | timestamptz | UTC |

**MVP staleness scope (B2):** personal-tier nodes only — `user_balances`, `user_program_statuses`. World edges out of scope.

### 4.5 `targets` — Plan → UserGoal

| Column | Type | Constraints / notes |
|---|---|---|
| id | uuid | PK |
| plan_id | uuid | FK → plans(id) ON DELETE CASCADE |
| user_goal_id | uuid | FK → user_goals(id) |
| created_at | timestamptz | UTC |
| | | UNIQUE (plan_id, user_goal_id) |

### 4.6 `agent_runs`

| Column | Type | Constraints / notes |
|---|---|---|
| id | uuid | PK |
| agent_type | text | CHECK in (`orchestrator`,`wallet_agent`,`earning_agent`,`redemption_agent`) |
| plan_id | uuid | FK → plans(id), nullable |
| user_id | uuid | FK → users(id) — scope for audit |
| started_at | timestamptz | NOT NULL DEFAULT now() |
| completed_at | timestamptz | nullable |
| status | text | CHECK in (`running`,`completed`,`failed`,`timed_out`) |
| state | jsonb | nullable — incl. `last_read_versions` |
| token_count | integer | nullable |
| error | text | nullable |
| graph_tier | text | CHECK = `plan` |
| node_type | text | CHECK = `AgentRun` |

---

## 5. Write-path infrastructure

### 5.1 `graph_mutations` *(audit + SSE replay — NOT a work queue)*

| Column | Type | Constraints / notes |
|---|---|---|
| id | bigserial | PK — SSE `event_id`; monotonic **per user** when §6.3 lock held |
| mutation_txn_id | uuid | NOT NULL — groups rows in one commit |
| user_id | uuid | FK → users(id), **NOT NULL** — MVP user-scoped only |
| plan_lineage_id | uuid | nullable |
| plan_id | uuid | FK → plans(id), nullable |
| agent_run_id | uuid | FK → agent_runs(id), nullable |
| mutation_type | text | NOT NULL — e.g. `TransferPoints`, `CreatePlanStep` |
| target_table | text | nullable |
| target_node_id | uuid | nullable |
| summary | text | NOT NULL |
| before | jsonb | nullable |
| after | jsonb | nullable |
| committed_at | timestamptz | NOT NULL DEFAULT now() |

MVP: all rows require `user_id`. Layer 4 global events excluded from sidebar until stretch adds `visibility_scope`.

### 5.2 `replan_jobs` *(durable work queue)*

| Column | Type | Constraints / notes |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK → users(id) |
| plan_lineage_id | uuid | NOT NULL |
| source_plan_id | uuid | FK → plans(id) — stale revision at enqueue |
| trigger_mutation_txn_id | uuid | NOT NULL |
| idempotency_key | text | NOT NULL UNIQUE — e.g. `{plan_lineage_id}:{mutation_txn_id}` |
| status | text | CHECK in (`pending`,`processing`,`completed`,`failed`,`superseded`) |
| attempt_count | integer | NOT NULL DEFAULT 0 |
| max_attempts | integer | NOT NULL DEFAULT 3 |
| available_at | timestamptz | NOT NULL DEFAULT now() |
| locked_at | timestamptz | nullable |
| locked_by | text | nullable — `hostname:pid` |
| lease_expires_at | timestamptz | nullable |
| result_plan_id | uuid | FK → plans(id), nullable |
| error | text | nullable |
| created_at / updated_at | timestamptz | UTC |
| completed_at | timestamptz | nullable |

**Claiming:** `pending` where `available_at <= now()`, or `processing` where `lease_expires_at < now()`. Use `FOR UPDATE SKIP LOCKED`. Increment `attempt_count` on claim. Job completion + new revision `current` + prior `superseded` in **one transaction**.

### 5.3 `idempotency_records`

| Column | Type | Constraints / notes |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK → users(id) |
| operation_type | text | NOT NULL — e.g. `TransferPoints` |
| idempotency_key | text | NOT NULL |
| request_hash | text | NOT NULL — canonical hash of request body |
| mutation_txn_id | uuid | NOT NULL |
| result_reference | jsonb | NOT NULL |
| created_at | timestamptz | NOT NULL DEFAULT now() |
| | | UNIQUE (user_id, operation_type, idempotency_key) |

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

| Writer | May write |
|---|---|
| wallet agent | personal-tier nodes |
| redemption agent | `plan_steps`, `state_dependencies` |
| earning agent | own plan-step contributions only |
| orchestrator | `plans`, `targets` |
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
The redemption agent subscribes to stale steps and re-plans with no orchestrator message — that is the hero loop. A successful re-plan creates a new revision in the same `plan_lineage_id`, increments `revision_number`, points the successor at the stale source via `supersedes_plan_step_id`, and only then marks the source `superseded` with `superseded_by_plan_step_id`. If successor creation fails, the source remains `stale`. This is bounded, plan-nodes-only, no transitive propagation.

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

### `evaluations` *(infrastructure — not a graph node)*

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| plan_id | uuid | FK → plans(id) |
| baseline_plan_id | uuid | FK → plans(id), nullable |
| benchmark_query_id | uuid | NOT NULL |
| total_value_cents / baseline_value_cents | integer | nullable |
| improvement_basis_points | integer | nullable |
| accuracy_score | boolean | nullable |
| hallucination_count | integer | nullable |
| token_cost_total | integer | nullable |
| plan_invalidation_correct | boolean | nullable |
| domain_extension_correct | boolean | nullable |
| metric_scores | jsonb | nullable |
| evaluator_version | text | NOT NULL |
| created_at | timestamptz | UTC |

**Benchmark integrity (I1):** Baselines write **only** `plans` (`raw_output`, status `completed`/`failed`) + `evaluations`. No `plan_steps`, `state_dependencies`, or coordination `agent_runs`. Same `serialize_world_graph(user_id)` read path.

---

## 9. STRETCH — Layer 4 · NOT Day-1 lock

> Cut-by-default per ADR 0003. Nothing in §1–8 depends on this.

- `mutation_proposals`, `transfer_bonuses`, verifier agent — see v3 §7 narrative.
- Future: `graph_mutations.visibility_scope = 'global'` for verified world-graph events.

---

## 10. Required indexes

```sql
-- FK / lookup
CREATE INDEX ON credit_cards (reward_program_id);
CREATE INDEX ON redemption_options (program_id);
CREATE INDEX ON transfers_to (source_program_id);
CREATE INDEX ON transfers_to (dest_program_id);
CREATE UNIQUE INDEX ON user_balances (user_id, program_id);      -- B4: one canonical balance row
CREATE INDEX ON user_program_statuses (user_id, program_id);
CREATE INDEX ON plans (plan_lineage_id, revision_number);
CREATE INDEX ON plan_steps (plan_id, step_order);
CREATE INDEX ON plan_steps (plan_lineage_id, revision_number);
CREATE INDEX ON agent_runs (plan_id);
CREATE INDEX ON external_quotes (plan_id);
CREATE INDEX ON evaluations (benchmark_query_id);

-- dependency tracking — the hot path
CREATE INDEX ON state_dependencies (target_table, target_node_id);
CREATE INDEX ON state_dependencies (plan_step_id);
CREATE INDEX ON plan_steps (is_stale) WHERE is_stale = true;

-- category MCC lookup
CREATE INDEX ON spend_categories USING GIN (mcc_codes);

-- OCC hot paths
CREATE INDEX ON user_balances (id, version);
CREATE INDEX ON plan_steps (plan_id, version);
```

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
