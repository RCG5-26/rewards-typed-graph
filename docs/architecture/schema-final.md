# Schema — Final · v3.1

> **Status:** Locked v3.1 architecture. [ADR 0004](../adr/0004-mvp-polymorphic-graph-schema.md) changes the MVP physical storage layout to polymorphic `nodes` / `edges`, but it does not supersede the plan lifecycle, dependency invalidation, or re-plan semantics in this file.
> **Reflects:** ADR 0001 (schema lock), ADR 0002 (research apparatus kept), ADR 0003 (four-person team; ingestion + verifier are stretch; Layer 4 cut-by-default).
> **Owner:** Alan (Graph/Persistence). Reviewed by Raq (lead).
> **Scope note:** Layers 1–3 are the locked core. **Ingestion + Verifier (Layer 4) are stretch** and live in a clearly fenced section; their tables are documented but are *not* part of the Day-1 lock and may be cut at the Day 10 go/no-go.

---

## 0. Storage & conventions (read first)

- **Engine:** PostgreSQL only. No graph DB. Multi-hop traversal via recursive CTEs.
- **Physical layout:** **table-per-type** (one table per node type, one per edge type). `node_type` is a constant text discriminator on every node row for generic traversal, debug tooling, and the mutation log. (ADR 0001, Decision 7.)
- **Tiers:** every node row carries `graph_tier ∈ {world, personal, plan}`. World = shared; personal = per-user; plan = per-query.
- **IDs:** `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`. World nodes also carry a unique `slug text` for idempotent seed/upsert and stable cross-lane references.
- **Money:** integer **cents** (`*_cents`). Never float.
- **Ratios / multipliers / CPP:** integer **basis points** (`*_basis_points`), where `10000 = 1.0` (1:1 transfer, 1.0× earn) and CPP is cents-per-point × 10000 (`15000` = 1.5 cpp). A `toBasisPoints()` / `fromBasisPoints()` util ships Day 1 (Alan). No business logic touches raw ratio numbers.
- **Points / balances:** integer.
- **Time:** `timestamptz`, UTC. `created_at` immutable; `updated_at` on mutable rows.
- **Concurrency:** integer `version` (default 0, `++` on every write) on all mutable tables. See §4.
- **Enums:** stored as `text` + `CHECK` constraint (not native PG `ENUM`) so values can be added additively without a type migration. Enumerated values are listed per column.
- **"In effect now":** two conventions, applied deliberately — `is_active boolean` for entities you disable/enable (cards, programs, transfer routes); `valid_from` / `valid_until` for time-bounded facts (earn rates, transfer ratios, redemption valuations). A fact is current when `is_active` and `now()` ∈ `[valid_from, valid_until)`.
- **Referential integrity:** real FKs everywhere except the one deliberately polymorphic edge (`state_dependencies`, §3) — see B5.

### Node inventory (locked core)

| Table | Tier | node_type | OCC | Writer (mutation-ownership) |
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
| `evaluations` | plan | `Evaluation` | no | eval harness (Raq DRI) |

### Edge inventory (locked core)

| Table | From → To | Mutable | Purpose |
|---|---|---|---|
| `holds` | User → CreditCard | no | wallet membership |
| `earns` | CreditCard → SpendCategory | no | earn rate per category |
| `transfers_to` | RewardProgram → RewardProgram | **yes** | transfer route + ratio (see §2) |
| `redeems_via` | RewardProgram → RedemptionOption | no | program's redemption surfaces |
| `targets` | Plan → UserGoal | no | plan intent |
| `state_dependencies` | PlanStep → (any node, polymorphic) | **yes** | **the dependency-tracking edge (§3)** |

> **Change from v2 (needs Alan's nod at lock):** v2's separate `TransferPartner` node + `TRANSFERS_TO` edge are **unified**. A transfer destination (e.g., Hyatt) is itself a `RewardProgram`, so transfers are a `transfers_to` **edge between two programs** carrying the ratio. This removes the v2 node/edge ratio duplication (gap G16) and the need for the B3 `lands_in_program_id` bridge — "transfer then redeem" becomes one clean traversal: `program -transfers_to-> program -redeems_via-> redemption_option`. *Minimal-change fallback if the team prefers v2: keep the `transfer_partners` node and add `lands_in_program_id → reward_programs`; drop the redundant edge either way.*

---

## 1. World graph (shared, seeded)

### 1.1 `credit_cards`
| Column | Type | Constraints / notes |
|---|---|---|
| id | uuid | PK |
| slug | text | UNIQUE, e.g. `card:csp` |
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
Currencies (issuer points, airline miles, hotel points, cashback). A transfer destination is a row here.
| Column | Type | Constraints / notes |
|---|---|---|
| id | uuid | PK |
| slug | text | UNIQUE, e.g. `program:chase_ur`, `program:hyatt` |
| name | text | NOT NULL |
| issuer | text | nullable |
| program_kind | text | CHECK in (`issuer_transferable`,`airline`,`hotel`,`cashback`) |
| currency_name | text | "points","miles","cash back" |
| min_redemption_points | integer | nullable |
| points_expire_months | integer | nullable (null = no expiry) |
| is_active | boolean | NOT NULL DEFAULT true |
| graph_tier | text | CHECK = `world` |
| node_type | text | CHECK = `RewardProgram` |
| created_at / updated_at | timestamptz | UTC |

### 1.3 `spend_categories`
Kept (the earning agent needs it). MCC-mapped hierarchy (Decision 1).
| Column | Type | Constraints / notes |
|---|---|---|
| id | uuid | PK |
| slug | text | UNIQUE, e.g. `cat:dining` |
| name | text | NOT NULL |
| parent_id | uuid | FK → spend_categories(id), nullable; **no cycles** (enforced in write service at insert) |
| mcc_codes | integer[] | GIN index; seed top ~50 MCCs covering demo merchants |
| graph_tier | text | CHECK = `world` |
| node_type | text | CHECK = `SpendCategory` |

### 1.4 `redemption_options`
| Column | Type | Constraints / notes |
|---|---|---|
| id | uuid | PK |
| program_id | uuid | FK → reward_programs(id) |
| option_type | text | CHECK in (`travel_portal`,`transfer_partner`,`statement_credit`,`gift_card`,`check`,`merchandise`) |
| cpp_basis_points | integer | cents-per-point × 10000 |
| min_points | integer | nullable |
| description | text | |
| valid_from / valid_until | date | nullable — valuations change over time |
| graph_tier | text | CHECK = `world` |
| node_type | text | CHECK = `RedemptionOption` |

### 1.5 `external_quotes` *(graph-typed tool results — resolves review item I3)*
Tools (cash-price, award-availability) **write a typed row here**, not a JSON blob to a variable, so results compose into the shared graph and downstream agents read them as state.
| Column | Type | Constraints / notes |
|---|---|---|
| id | uuid | PK |
| quote_type | text | CHECK in (`cash_price`,`award_availability`) |
| program_id | uuid | FK → reward_programs(id), nullable |
| redemption_option_id | uuid | FK → redemption_options(id), nullable |
| subject | text | free identifier, e.g. "Park Hyatt Tokyo, 5 nights, Oct" |
| value_cents | integer | nullable (cash price) |
| points_cost | integer | nullable (award cost) |
| source_tool | text | provenance — which tool produced this |
| fetched_at | timestamptz | UTC |
| valid_until | timestamptz | nullable |
| plan_id | uuid | FK → plans(id), nullable — which query fetched it |
| payload | jsonb | full typed fragment |
| graph_tier | text | CHECK = `world` |
| node_type | text | CHECK = `ExternalQuote` |

---

## 2. Transfer routes (the multi-hop edge)

### `transfers_to` — RewardProgram → RewardProgram
| Column | Type | Constraints / notes |
|---|---|---|
| id | uuid | PK |
| source_program_id | uuid | FK → reward_programs(id) |
| dest_program_id | uuid | FK → reward_programs(id) |
| transfer_ratio_basis_points | integer | NOT NULL; `10000` = 1:1 |
| transfer_time_days | integer | nullable |
| valid_from / valid_until | timestamptz | nullable — base ratio temporal validity (review item I5) |
| is_active | boolean | NOT NULL DEFAULT true |
| version | integer | NOT NULL DEFAULT 0 — OCC (a route can be re-rated) |
| created_at / updated_at | timestamptz | UTC |
| | | UNIQUE (source_program_id, dest_program_id) WHERE is_active |

Redemption surfaces hang off the destination program via `redeems_via`, so the redemption agent traverses `source -transfers_to-> dest -redeems_via-> option` in one CTE. Directed and asymmetric (UR→Hyatt does not imply the reverse).

---

## 3. Plan graph + dependency tracking (the architectural core)

### 3.1 `plans`
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
| version | integer | OCC |
| graph_tier | text | CHECK = `plan` |
| node_type | text | CHECK = `Plan` |
| created_at / updated_at | timestamptz | UTC |

### 3.2 `plan_steps` *(highest-risk table — the staleness fields ARE the demo)*
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
| stale_reason | text | nullable — e.g. "user_balances:abc balance_points 180000 → 120000" |
| result | jsonb | nullable |
| error | text | nullable |
| version | integer | OCC |
| graph_tier | text | CHECK = `plan` |
| node_type | text | CHECK = `PlanStep` |
| created_at / updated_at | timestamptz | UTC |

### 3.3 `state_dependencies` — PlanStep → (any node) *(the dependency edge)*
The edge that makes the architectural claim real. **Deliberately polymorphic** (target can be any node type), so it carries no FK — node-reference integrity is enforced in the write service + an orphan sweep (B5).
| Column | Type | Constraints / notes |
|---|---|---|
| id | uuid | PK |
| plan_step_id | uuid | FK → plan_steps(id) ON DELETE CASCADE |
| target_node_id | uuid | NOT NULL — no FK (polymorphic) |
| target_node_type | text | NOT NULL — e.g. `UserBalance` |
| target_table | text | NOT NULL — physical table for the orphan sweep, e.g. `user_balances` |
| depended_property | text | nullable — e.g. `balance_points` |
| observed_version | integer | the target's `version` at read time |
| snapshot_value | jsonb | the value at plan-generation time — enables drift detection |
| is_stale | boolean | NOT NULL DEFAULT false |
| created_at | timestamptz | UTC |

**MVP staleness scope (B2):** dependency targets are **node-valued, personal-tier only** — `user_balances` and `user_program_statuses`. Edge-valued dependencies (an `earns` rate, a `transfers_to` ratio) are **out of staleness scope for the MVP** and explicitly deferred. The hero moment is a balance change (a node), so the demo is covered. To extend later, add `target_edge_id` / `target_edge_table`.

### 3.4 `agent_runs`
| Column | Type | Constraints / notes |
|---|---|---|
| id | uuid | PK |
| agent_type | text | CHECK in (`orchestrator`,`wallet_agent`,`earning_agent`,`redemption_agent`) — plus `ingestion_agent`,`verifier_agent` when Layer 4 is in |
| plan_id | uuid | FK → plans(id), nullable |
| started_at / completed_at | timestamptz | UTC |
| status | text | CHECK in (`running`,`completed`,`failed`,`timed_out`) |
| state | jsonb | checkpoint blob incl. `last_read_versions` (crash recovery; Decision 8) |
| token_count | integer | nullable — summed into the token-cost benchmark metric |
| error | text | nullable |
| graph_tier | text | CHECK = `plan` |
| node_type | text | CHECK = `AgentRun` |

---

## 4. Optimistic concurrency (the commit contract)

Every mutable write is conditional on the version read (ADR 0001, Decision 5):

```sql
UPDATE user_balances
   SET balance_points = $new, version = version + 1, updated_at = now()
 WHERE id = $id AND version = $expected_version;
-- rowcount = 0  ->  raise ConflictError  ->  retry
```

- **Retries:** max 3, exponential backoff with jitter (base 50ms, cap 400ms). After 3 failures the `plan_step` goes `failed` and the orchestrator decides whether to requeue.
- **Mutation ownership matrix** (shrinks the concurrent-write surface): wallet agent is the **sole** writer of personal-tier nodes; redemption agent is the **sole** writer of `plan_steps` and `state_dependencies`; earning agent reads world and writes only its own plan-step contributions; orchestrator writes `plans`. World nodes are seed-only in the core (and, in the Layer-4 stretch, written only via the verified serializable path).
- **Single write path (B1):** all node mutations go through one graph-write-service function. It runs validation (§5), the version check above, **and** the staleness propagation below, in **one transaction**. No agent writes around it. A `user_balances` trigger is added as a backstop so staleness cannot be bypassed even by a manual write.

### Staleness propagation (runs in the same txn as a personal-tier mutation)
```sql
UPDATE plan_steps ps
   SET is_stale = true, status = 'stale', staled_at = now(),
       stale_reason = format('user_balances:%s balance_points %s -> %s', $id, $old, $new)
  FROM state_dependencies sd
 WHERE sd.plan_step_id = ps.id
   AND sd.target_table = 'user_balances'
   AND sd.target_node_id = $id
   AND sd.depended_property = 'balance_points'
   AND (sd.snapshot_value->>'balance_points')::int IS DISTINCT FROM $new
   AND ps.status NOT IN ('completed','failed','skipped');
```
The redemption agent subscribes to stale steps and re-plans with no orchestrator message — that is the hero loop. A successful re-plan creates a new revision in the same `plan_lineage_id`, increments `revision_number`, points the successor at the stale source via `supersedes_plan_step_id`, and only then marks the source `superseded` with `superseded_by_plan_step_id`. If successor creation fails, the source remains `stale`. This is bounded, plan-nodes-only, no transitive propagation.

---

## 5. Validation taxonomy (every mutation, before commit)

Enforced in the graph-write service for **all** agents:
1. **Structural** — node/edge type exists; required columns present and correctly typed; enum values in their `CHECK` set.
2. **Referential** — real FKs for everything except `state_dependencies`, whose `target_node_id` is validated in-app against `target_table` (no orphan), plus a periodic orphan sweep.
3. **Domain invariants** — `transfer_ratio_basis_points > 0`; `earn_rate_basis_points >= 0`; `balance_points >= 0`; at most one active row per natural key (e.g. `transfers_to` per source/dest, `user_balances` per user/program); no overlapping active validity windows.

The fourth class — **ratio transitivity** (e.g. `A→B × B→C` must agree with any direct `A→C`, exact via integer basis points) — is the **Verifier's** job and lives in the Layer-4 stretch (§7). Encoding the invariant now keeps the gold corpus honest even if Layer 4 is cut.

---

## 6. Benchmark & evaluation (research apparatus — kept, ADR 0002)

### `evaluations`
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| plan_id | uuid | FK → plans(id) |
| baseline_plan_id | uuid | FK → plans(id), nullable |
| benchmark_query_id | uuid | the query under test |
| total_value_cents / baseline_value_cents | integer | nullable |
| improvement_basis_points | integer | nullable |
| accuracy_score | boolean | nullable — matches ground truth? |
| hallucination_count | integer | nullable — hallucinated ratios/programs (taxonomy in `metric_scores`) |
| token_cost_total | integer | nullable — summed from `agent_runs.token_count` |
| plan_invalidation_correct | boolean | nullable — caught the mid-query state change? (categorical; baselines = false by construction) |
| domain_extension_correct | boolean | nullable — Layer-4-only metric |
| metric_scores | jsonb | authoritative breakdown for anything not a typed column |
| evaluator_version | text | |
| created_at | timestamptz | UTC |

**Benchmark integrity (review item I1):** baseline plans (`baseline_single_agent`, `baseline_free_text_multiagent`) write **only** a `plans` row (with `raw_output`) and an `evaluations` row. They do **not** write `plan_steps`, `state_dependencies`, or `agent_runs`-as-coordination — those are architecture-specific and writing fakes would contaminate the comparison. Baselines read the same world graph through Alan's `serialize_world_graph(user_id)` utility. Win thresholds are pre-committed before Day 7 (all four sign off).

---

## 7. STRETCH — Ingestion + Verifier (Layer 4) · NOT part of the Day-1 lock

> Fenced per ADR 0003: Layer 4 is unowned and cut-by-default with four people. These tables are documented so the core schema is forward-compatible, but they are **not built unless the team is ahead at the Day 10 go/no-go.** Nothing in Layers 1–3 depends on them.

- **`mutation_proposals`** — `id`, `mutation_type` (`new_transfer_route`,`update_transfer_ratio`,`new_transfer_bonus`,`update_earn_rate`,`other`), `status` (`pending`,`accepted`,`rejected`,`superseded`), `payload jsonb`, `rejection_reason`, `source_document_url`, `source_document_text`, `proposed_by_run_id` / `reviewed_by_run_id` (FK → agent_runs), `reviewed_at`, `version`. The verifier reads-validates-commits this in a **`SERIALIZABLE`** transaction so two conflicting proposals can't both be accepted.
- **`transfer_bonuses`** — `id`, `transfers_to_id` (FK → transfers_to), `bonus_multiplier_basis_points` (`13000` = +30%), `valid_from` / `valid_until`, `source_url`, `mutation_proposal_id`, `is_active`. A bonus is a time-boxed overlay on a route, created by the verified path — never a mutated base field.
- **Verifier checks:** schema violation, node-reference violation, ratio-transitivity violation — each a distinct rejection mode the adversarial set must cover (≥1 each) before the verifier appears in any demo.

---

## 8. Required indexes (not optional — recursive CTEs on unindexed FKs will be unusably slow live)

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

## 9. Seed fixture (part of the lock — all lanes build against the same IDs)

- 20 `credit_cards`, each linked to a `reward_program`; real earn rates verified against issuer pages at a documented snapshot date.
- Transfer routes for the two issuer programs at minimum: Chase UR and Amex MR, including the Tokyo demo destinations (Hyatt, United, ANA) with verified ratios.
- Top ~50 `spend_categories` MCCs covering demo merchants.
- Demo persona: 5 cards, 240k points across 3 programs, goal = Tokyo in October, with stable slugs/IDs.

---

## 10. Changes from v2 (so Alan can ratify the deltas, not re-read everything)

1. **Unified transfers** — dropped the `TransferPartner` node; transfers are now a `transfers_to` edge between two `reward_programs` (ratio on the edge). Removes the v2 node/edge ratio duplication (G16) and the B3 bridge. *(Fallback: keep the node + `lands_in_program_id` if the team prefers minimal change.)*
2. **Dropped `Merchant` + `Transaction`** (and `CATEGORIZED_AS` / `PAID_WITH`) — they were no-write MVP placeholders; manual wallet has no transactions. `SpendCategory` and `RedemptionOption` stay (earning + redemption agents need them).
3. **Added `external_quotes`** so graph-typed tool results are real nodes with provenance (review item I3).
4. **Added `plans.benchmark_query_id` + `plans.raw_output`**; baselines write Plan + Evaluation only (review item I1/I2).
5. **`transfers_to` is temporally validated** (`valid_from/until`) for base-ratio consistency (review item I5).
6. **`state_dependencies` made explicitly polymorphic + app-level integrity** (B5), with MVP staleness scoped to personal-tier nodes (B2).
7. **`UserBalance` uniqueness** on `(user_id, program_id)`, update-in-place (B4).
8. **Ingestion + Verifier (Layer 4) fenced to §7 as stretch** — not part of the Day-1 lock (ADR 0003).

## 11. Sign-off
Locked when each lane confirms it can build with no open questions:
- [ ] Alan (Graph) — tables, write service, OCC, staleness, indexes, seed.
- [ ] Raq (Orchestrator/lead) — mutation contract + shared type artifact; eval tables.
- [ ] Michael (Redemption/Eval) — traversal targets (`transfers_to` → `redeems_via`), `external_quotes` shape, benchmark/eval columns.
- [ ] Val (Frontend) — mutation-log event shape + plan/`state_dependencies` shape render-ready.

Date locked: __________  ·  Canonical artifact: `schema/schema.sql` + generated shared types (Alan, post-lock).
