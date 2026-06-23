# Schema Decisions — Typed Knowledge Graph

## Finalized for Team Discussion · v2.0

> **Rule:** This schema is frozen after the Day 1 meeting. No node type additions,
> no edge type renames, no property renames on `Plan` or `PlanStep` without a
> full-team migration plan. Breaking changes = blocked sprint.
>
> **v2.0 changes from original draft:** 4 critical nodes added (`UserBalance`, `UserProgramStatus`, `MutationProposal`, `TransferBonus`), `StateDependency` edge added, `PlanStep` extended with staleness fields, `AgentRun.agent_type` enum realigned, `Plan` extended with `query_text` + `plan_type`, `PlanStep` extended with `step_order`. See Analysis Gap Log at end of document.

**Storage:** Postgres with JSON columns and recursive CTEs. No graph DB. OCC via Postgres MVCC with **serializable transactions** wrapping the verifier read-validate-commit path.

**Three graph tiers (all in the same Postgres schema, distinguished by `graph_tier` on every node):**

- **World graph** — cards, programs, transfer partners, alliances; ratios and multipliers as typed edges with `version` + `updated_at`
- **Personal graph** — per-user balances, status, goals
- **Plan graph** — per-query; plan nodes carry explicit dependency edges back to world/personal state nodes they rely on

**Six agents (Layers 2 + 4):** Orchestrator, WalletAgent, EarningAgent, RedemptionAgent (hero), IngestionAgent (stretch), VerifierAgent (stretch). Agents do not exchange free text — they commit typed mutations to the shared graph, validated against schema before commit. Tools return **graph fragments (typed subgraphs)**, not JSON blobs.

---

## Section 1: Node Types

### 1.1 User

| Property            | Type        | Notes                                                                          |
| ------------------- | ----------- | ------------------------------------------------------------------------------ |
| `id`                | UUID        | Primary key                                                                    |
| `name`              | string      | Display                                                                        |
| `optimization_goal` | enum        | `maximize_points`, `maximize_cashback`, `specific_redemption`, `minimize_fees` |
| `credit_score_tier` | enum        | `excellent` / `good` / `fair`                                                  |
| `graph_tier`        | enum        | Always `personal` for User                                                     |
| `node_type`         | string      | Always `'User'` — runtime type tag (Decision 7)                                |
| `version`           | integer     | OCC — starts at 0, incremented on every write                                  |
| `created_at`        | timestamptz | Immutable, UTC                                                                 |
| `updated_at`        | timestamptz | UTC                                                                            |

---

### 1.2 CreditCard

| Property                     | Type                    | Notes                                            |
| ---------------------------- | ----------------------- | ------------------------------------------------ |
| `id`                         | UUID                    |                                                  |
| `name`                       | string                  | e.g. "Chase Sapphire Preferred"                  |
| `issuer`                     | string                  | e.g. "Chase"                                     |
| `network`                    | enum                    | `visa` / `mastercard` / `amex` / `discover`      |
| `annual_fee_cents`           | integer                 | Stored in cents, never float                     |
| `reward_program_id`          | UUID FK → RewardProgram |                                                  |
| `signup_bonus_points`        | integer                 | nullable                                         |
| `signup_bonus_spend_cents`   | integer                 | nullable                                         |
| `signup_bonus_deadline_days` | integer                 | nullable                                         |
| `graph_tier`                 | enum                    | Always `world`                                   |
| `node_type`                  | string                  | Always `'CreditCard'`                            |
| `is_active`                  | boolean                 | default true — allows disabling without deleting |
| `created_at`                 | timestamptz             | UTC                                              |
| `updated_at`                 | timestamptz             | UTC                                              |

---

### 1.3 SpendCategory

| Property     | Type                    | Notes                                       |
| ------------ | ----------------------- | ------------------------------------------- |
| `id`         | UUID                    |                                             |
| `name`       | string                  | "Dining", "Travel", "Groceries"             |
| `parent_id`  | UUID FK → SpendCategory | nullable — hierarchy                        |
| `mcc_codes`  | integer[]               | MCC codes mapping here. GIN index required. |
| `graph_tier` | enum                    | Always `world`                              |
| `node_type`  | string                  | Always `'SpendCategory'`                    |

> **Decision 1 — LOCKED: Option B (MCC-mapped hierarchy).** Seed top 50 MCCs covering demo merchants on Day 1 — not all 200+. Enforce no-cycle constraint at insert time in graph write service.

---

### 1.4 Merchant

| Property      | Type                    | Notes                      |
| ------------- | ----------------------- | -------------------------- |
| `id`          | UUID                    |                            |
| `name`        | string                  |                            |
| `mcc_code`    | integer                 | nullable                   |
| `category_id` | UUID FK → SpendCategory | Derived from MCC, nullable |
| `graph_tier`  | enum                    | Always `world`             |
| `node_type`   | string                  | Always `'Merchant'`        |

> **MVP note:** No writes to Merchant in MVP — table is schema-present but the manual wallet entry flow does not require merchant records. Seed a handful of demo merchants for the Tokyo scenario.

---

### 1.5 Transaction

| Property        | Type                    | Notes                         |
| --------------- | ----------------------- | ----------------------------- |
| `id`            | UUID                    |                               |
| `user_id`       | UUID FK → User          |                               |
| `card_id`       | UUID FK → CreditCard    | nullable                      |
| `merchant_id`   | UUID FK → Merchant      | nullable                      |
| `category_id`   | UUID FK → SpendCategory | nullable                      |
| `amount_cents`  | integer                 | Always integers, never float  |
| `currency`      | char(3)                 | ISO 4217                      |
| `transacted_at` | timestamptz             | UTC                           |
| `points_earned` | integer                 | nullable — computed post-fact |
| `graph_tier`    | enum                    | Always `personal`             |
| `node_type`     | string                  | Always `'Transaction'`        |

> **⚠️ MVP SCOPE NOTE:** Transaction is schema-present but **no writes in MVP**. Plaid-linked transaction ingestion is explicitly out of scope. No agent writes to this table during the sprint. Mark in code with `// MVP: no writes`. Revisit in ambitious version.

---

### 1.6 RewardProgram

| Property                | Type        | Notes                          |
| ----------------------- | ----------- | ------------------------------ |
| `id`                    | UUID        |                                |
| `name`                  | string      | "Chase Ultimate Rewards"       |
| `issuer`                | string      | "Chase"                        |
| `currency_name`         | string      | "points", "miles", "cash back" |
| `min_redemption_points` | integer     | nullable                       |
| `points_expire_months`  | integer     | nullable — null = no expiry    |
| `graph_tier`            | enum        | Always `world`                 |
| `node_type`             | string      | Always `'RewardProgram'`       |
| `is_active`             | boolean     | default true                   |
| `created_at`            | timestamptz | UTC                            |
| `updated_at`            | timestamptz | UTC                            |

---

### 1.7 RedemptionOption

| Property           | Type                    | Notes                                                                                        |
| ------------------ | ----------------------- | -------------------------------------------------------------------------------------------- |
| `id`               | UUID                    |                                                                                              |
| `program_id`       | UUID FK → RewardProgram |                                                                                              |
| `option_type`      | enum                    | `travel_portal`, `transfer_partner`, `statement_credit`, `gift_card`, `check`, `merchandise` |
| `cpp_basis_points` | integer                 | Cents per point × 10,000. e.g. 15000 = 1.5cpp                                                |
| `min_points`       | integer                 |                                                                                              |
| `description`      | string                  |                                                                                              |
| `valid_from`       | date                    | nullable — redemption options expire and change                                              |
| `valid_until`      | date                    | nullable                                                                                     |
| `graph_tier`       | enum                    | Always `world`                                                                               |
| `node_type`        | string                  | Always `'RedemptionOption'`                                                                  |

> **v2.0 addition:** `valid_from` / `valid_until` added. Redemption option valuations change (portal CPP, gift card rates) — without temporal tracking the world graph will silently return stale valuations.

---

### 1.8 TransferPartner

| Property                      | Type                    | Notes                                                                  |
| ----------------------------- | ----------------------- | ---------------------------------------------------------------------- |
| `id`                          | UUID                    |                                                                        |
| `program_id`                  | UUID FK → RewardProgram | **v2.0 addition** — needed to query "which programs transfer to Hyatt" |
| `name`                        | string                  | "Hyatt World of Hyatt"                                                 |
| `partner_type`                | enum                    | `airline` / `hotel`                                                    |
| `transfer_ratio_basis_points` | integer                 | e.g. 10000 = 1:1 (basis ratio, not bonus)                              |
| `transfer_time_days`          | integer                 |                                                                        |
| `is_active`                   | boolean                 | default true — disables without deleting when partner removed          |
| `graph_tier`                  | enum                    | Always `world`                                                         |
| `node_type`                   | string                  | Always `'TransferPartner'`                                             |
| `created_at`                  | timestamptz             | UTC                                                                    |
| `updated_at`                  | timestamptz             | UTC                                                                    |

> **Decision 2 — LOCKED: Option A (no bonus fields on TransferPartner).** Transfer bonuses are handled by the new `TransferBonus` node (1.8a below). This keeps the base ratio clean and allows the ingestion agent to create bonus records without mutating the partner node.

---

### 1.8a TransferBonus _(new in v2.0 — deferred write in MVP, required for Layer 4 demo)_

| Property                        | Type                       | Notes                                           |
| ------------------------------- | -------------------------- | ----------------------------------------------- |
| `id`                            | UUID                       |                                                 |
| `transfer_partner_id`           | UUID FK → TransferPartner  |                                                 |
| `bonus_multiplier_basis_points` | integer                    | e.g. 13000 = 1.3× (30% bonus)                   |
| `valid_from`                    | timestamptz                | UTC                                             |
| `valid_until`                   | timestamptz                | nullable — null = until revoked                 |
| `source_url`                    | text                       | nullable — press release / announcement URL     |
| `mutation_proposal_id`          | UUID FK → MutationProposal | nullable — traces to the ingestion event        |
| `graph_tier`                    | enum                       | Always `world`                                  |
| `node_type`                     | string                     | Always `'TransferBonus'`                        |
| `is_active`                     | boolean                    | Computed or manually set; partial index on this |
| `created_at`                    | timestamptz                | UTC                                             |

> **Why added:** The ingestion agent demo moment ("Citi just added Wyndham as 1:2 partner") creates a new edge, not a mutated field. If the original schema stored bonus on TransferPartner, the verifier would need to do a field-level merge — harder to audit. A separate node gives each bonus a provenance edge and a clean accept/reject lifecycle via MutationProposal.

---

### 1.9 UserBalance _(new in v2.0 — CRITICAL for WalletAgent demo)_

| Property         | Type                    | Notes                                          |
| ---------------- | ----------------------- | ---------------------------------------------- |
| `id`             | UUID                    |                                                |
| `user_id`        | UUID FK → User          |                                                |
| `program_id`     | UUID FK → RewardProgram |                                                |
| `balance_points` | integer                 | Current redeemable balance                     |
| `as_of`          | timestamptz             | When this balance was last confirmed, UTC      |
| `source`         | enum                    | `manual_entry`, `plaid_sync`, `agent_computed` |
| `graph_tier`     | enum                    | Always `personal`                              |
| `node_type`      | string                  | Always `'UserBalance'`                         |
| `version`        | integer                 | **OCC — mandatory.** WalletAgent writes here.  |
| `created_at`     | timestamptz             | UTC                                            |
| `updated_at`     | timestamptz             | UTC                                            |

> **Why critical:** The demo's dependency-tracking moment — "I transferred 60k Chase to Hyatt yesterday" — requires the WalletAgent to mutate a balance node. Without `UserBalance`, there is no node to mutate, no state change to observe, and no staleness to propagate. This node is the trigger for the entire re-planning sequence. **Person A must create this table on Day 1.**

---

### 1.10 UserProgramStatus _(new in v2.0 — required for redemption agent reasoning)_

| Property        | Type                    | Notes                                              |
| --------------- | ----------------------- | -------------------------------------------------- |
| `id`            | UUID                    |                                                    |
| `user_id`       | UUID FK → User          |                                                    |
| `program_id`    | UUID FK → RewardProgram |                                                    |
| `status_tier`   | string                  | "Explorist", "Globalist", "Gold", "Platinum", etc. |
| `tier_benefits` | JSON                    | nullable — key perks that affect redemption value  |
| `valid_through` | date                    | nullable                                           |
| `graph_tier`    | enum                    | Always `personal`                                  |
| `node_type`     | string                  | Always `'UserProgramStatus'`                       |
| `version`       | integer                 | OCC                                                |
| `created_at`    | timestamptz             | UTC                                                |
| `updated_at`    | timestamptz             | UTC                                                |

> **Why added:** The proposal explicitly calls out "status with each chain" as a factor in the optimization. The redemption agent needs to know if the user is Hyatt Explorist (free breakfast, room upgrades) to compute the true value of a Hyatt redemption vs. a cash booking. Without this, the redemption agent ignores a first-order input.

---

### 1.11 MutationProposal _(new in v2.0 — required for Layer 4 verifier demo)_

| Property               | Type               | Notes                                                                                                                                             |
| ---------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                   | UUID               |                                                                                                                                                   |
| `proposed_by_run_id`   | UUID FK → AgentRun | The ingestion agent run that proposed this                                                                                                        |
| `mutation_type`        | enum               | `new_transfer_partner`, `update_transfer_ratio`, `new_transfer_bonus`, `deactivate_transfer_partner`, `update_earn_rate`, `new_category`, `other` |
| `status`               | enum               | `pending`, `accepted`, `rejected`, `superseded`                                                                                                   |
| `payload`              | JSON               | The proposed graph change — node/edge to create or modify                                                                                         |
| `rejection_reason`     | text               | nullable — populated by VerifierAgent on reject                                                                                                   |
| `source_document_url`  | text               | nullable — URL of press release or source                                                                                                         |
| `source_document_text` | text               | nullable — raw text fed to ingestion agent                                                                                                        |
| `reviewed_by_run_id`   | UUID FK → AgentRun | nullable — the verifier agent run                                                                                                                 |
| `reviewed_at`          | timestamptz        | nullable, UTC                                                                                                                                     |
| `graph_tier`           | enum               | Always `world` (mutations target world graph)                                                                                                     |
| `node_type`            | string             | Always `'MutationProposal'`                                                                                                                       |
| `created_at`           | timestamptz        | UTC                                                                                                                                               |
| `version`              | integer            | OCC — verifier reads, validates, then commits status update                                                                                       |

> **Why critical:** The verifier demo moment requires persisting the proposed mutation, the accept/reject decision, and the rejection reason. Without this node, the verifier agent's output is stateless — it exists only in the LLM's response, with no queryable record of what changed, why, and what was rejected. This node is also the adversarial test surface (Decision Risk 5 in the proposal).

---

### 1.12 Plan _(updated in v2.0)_

| Property       | Type               | Notes                                                                                                             |
| -------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `id`           | UUID               |                                                                                                                   |
| `user_id`      | UUID FK → User     |                                                                                                                   |
| `query_text`   | text               | **v2.0 addition** — the original NL query; shown in demo sidebar                                                  |
| `status`       | enum               | `pending`, `in_progress`, `completed`, `failed`                                                                   |
| `plan_type`    | enum               | **v2.0 addition** — `agent_generated`, `baseline_single_agent`, `baseline_free_text_multiagent`, `baseline_naive` |
| `version`      | integer            | **OCC — mandatory**                                                                                               |
| `agent_run_id` | UUID FK → AgentRun | nullable at creation                                                                                              |
| `summary`      | text               | nullable — human-readable output                                                                                  |
| `graph_tier`   | enum               | Always `plan`                                                                                                     |
| `node_type`    | string             | Always `'Plan'`                                                                                                   |
| `created_at`   | timestamptz        | UTC                                                                                                               |
| `updated_at`   | timestamptz        | UTC                                                                                                               |

> **v2.0 changes:** `query_text` added (demo requirement — sidebar shows what query produced this plan); `plan_type` enum added (Decision 6 was recommended but omitted from original table). `plan_type` enables Person C to mark baseline plans without adding a separate node.

---

### 1.13 PlanStep _(updated in v2.0 — HIGHEST RISK NODE)_

| Property       | Type           | Notes                                                                                       |
| -------------- | -------------- | ------------------------------------------------------------------------------------------- |
| `id`           | UUID           |                                                                                             |
| `plan_id`      | UUID FK → Plan |                                                                                             |
| `step_order`   | integer        | **v2.0 addition** — sequence within plan; enables ordered rendering                         |
| `step_type`    | enum           | `card_assignment`, `redemption_recommendation`, `spend_analysis`, `transfer_recommendation` |
| `payload`      | JSON           | Step-specific data                                                                          |
| `status`       | enum           | `pending`, `ready`, `in_progress`, `completed`, `failed`, `skipped`, **`stale`**            |
| `is_stale`     | boolean        | default false — set true when any depended-on state node changes                            |
| `staled_at`    | timestamptz    | nullable — when staleness was detected                                                      |
| `stale_reason` | text           | nullable — "UserBalance:abc123 mutated from 180000 to 120000"                               |
| `version`      | integer        | **OCC — mandatory**                                                                         |
| `result`       | JSON           | nullable — populated on completion                                                          |
| `error`        | text           | nullable                                                                                    |
| `graph_tier`   | enum           | Always `plan`                                                                               |
| `node_type`    | string         | Always `'PlanStep'`                                                                         |
| `created_at`   | timestamptz    | UTC                                                                                         |
| `updated_at`   | timestamptz    | UTC                                                                                         |

> **v2.0 changes:** `step_order` added (ordering was unspecified — redemption agent needs deterministic step sequence); `stale` added to status enum; `is_stale`, `staled_at`, `stale_reason` added. These three fields ARE the dependency-tracking demo. Without them there is no mechanism to flag a plan as invalidated and no data to show the user in the sidebar.

---

### 1.14 AgentRun _(updated in v2.0)_

| Property       | Type           | Notes                                                                                                                        |
| -------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `id`           | UUID           |                                                                                                                              |
| `agent_type`   | enum           | **v2.0 realigned:** `orchestrator`, `wallet_agent`, `earning_agent`, `redemption_agent`, `ingestion_agent`, `verifier_agent` |
| `plan_id`      | UUID FK → Plan | nullable                                                                                                                     |
| `started_at`   | timestamptz    | UTC                                                                                                                          |
| `completed_at` | timestamptz    | nullable                                                                                                                     |
| `status`       | enum           | `running`, `completed`, `failed`, `timed_out`                                                                                |
| `state`        | JSON           | Agent handoff checkpoints — Decision 8 Option A                                                                              |
| `token_count`  | integer        | nullable — **v2.0 addition**; needed for token cost benchmark metric                                                         |
| `error`        | text           | nullable                                                                                                                     |
| `graph_tier`   | enum           | Always `plan`                                                                                                                |
| `node_type`    | string         | Always `'AgentRun'`                                                                                                          |

> **v2.0 changes:** `agent_type` enum values realigned to match proposal agent names (original used `spend_analyzer`, `card_selector` etc. which mapped to nothing in the proposal). `token_count` added — the benchmark reports token cost per query, which requires summing `AgentRun.token_count` across all runs for a given plan.

---

### 1.15 Evaluation _(updated in v2.0)_

| Property                    | Type           | Notes                                                                    |
| --------------------------- | -------------- | ------------------------------------------------------------------------ |
| `id`                        | UUID           |                                                                          |
| `plan_id`                   | UUID FK → Plan |                                                                          |
| `baseline_plan_id`          | UUID FK → Plan | nullable                                                                 |
| `total_value_cents`         | integer        | Estimated value of the plan                                              |
| `baseline_value_cents`      | integer        | nullable                                                                 |
| `improvement_basis_points`  | integer        | nullable                                                                 |
| `accuracy_score`            | boolean        | nullable — does plan match ground truth?                                 |
| `hallucination_count`       | integer        | nullable — number of hallucinated facts in plan                          |
| `token_cost_total`          | integer        | nullable — summed from AgentRun.token_count                              |
| `plan_invalidation_correct` | boolean        | nullable — did architecture catch the state-change implication?          |
| `domain_extension_correct`  | boolean        | nullable — did ingestion+verifier loop convert the update correctly?     |
| `metric_scores`             | JSON           | Full breakdown — authoritative for any metric not in typed columns above |
| `evaluator_version`         | string         |                                                                          |
| `created_at`                | timestamptz    | UTC                                                                      |

> **v2.0 changes:** The 5 benchmark metrics from the proposal (accuracy, hallucination_rate, token_cost, plan_invalidation_correctness, domain_extension_correctness) are now typed columns, not buried in a JSON blob. Person C should define the canonical JSON schema for `metric_scores` for extended metrics.

---

### 1.16 UserGoal _(unchanged)_

| Property               | Type                       | Notes                                                                          |
| ---------------------- | -------------------------- | ------------------------------------------------------------------------------ |
| `id`                   | UUID                       |                                                                                |
| `user_id`              | UUID FK → User             |                                                                                |
| `goal_type`            | enum                       | `maximize_points`, `maximize_cashback`, `specific_redemption`, `minimize_fees` |
| `target_redemption_id` | UUID FK → RedemptionOption | nullable                                                                       |
| `priority`             | integer                    | 1 = highest                                                                    |
| `graph_tier`           | enum                       | Always `personal`                                                              |
| `node_type`            | string                     | Always `'UserGoal'`                                                            |

---

## Section 2: Edge Types

### 2.1 HOLDS — User → CreditCard

| Property      | Type    | Notes         |
| ------------- | ------- | ------------- |
| `opened_date` | date    |               |
| `closed_date` | date    | nullable      |
| `is_primary`  | boolean | default false |

---

### 2.2 EARNS — CreditCard → SpendCategory

| Property                 | Type    | Notes                                      |
| ------------------------ | ------- | ------------------------------------------ |
| `earn_rate_basis_points` | integer | e.g. 30000 = 3×                            |
| `earn_type`              | enum    | `points`, `miles`, `cashback_pct`          |
| `cap_amount_cents`       | integer | nullable — annual spend cap                |
| `cap_period`             | enum    | nullable: `annual`, `quarterly`, `monthly` |
| `valid_from`             | date    | nullable                                   |
| `valid_until`            | date    | nullable                                   |

> **Decision 3 — LOCKED: Integer basis points everywhere.** `toBasisPoints()` / `fromBasisPoints()` utility ships with the graph lib on Day 1 (Person A owns this).

---

### 2.3 TRANSFERS_TO — RewardProgram → TransferPartner

| Property        | Type                       | Notes                                            |
| --------------- | -------------------------- | ------------------------------------------------ |
| `is_active`     | boolean                    | Disables edge without deleting                   |
| `version`       | integer                    | OCC on this edge — ingestion agent may update it |
| `provenance_id` | UUID FK → MutationProposal | nullable — traces to the ingestion event         |

> **v2.0 note:** `transfer_ratio_basis_points` and `transfer_time_days` removed from this edge. They live on the `TransferPartner` node (base ratio) and `TransferBonus` node (promotional ratio). Single source of truth. If the team disagrees, the edge can carry the ratio — but then the node field must be deprecated and queries must join to the edge, not the node.

---

### 2.4 DEPENDS_ON — PlanStep → PlanStep _(intra-plan ordering and data dependencies)_

| Property          | Type    | Notes                                 |
| ----------------- | ------- | ------------------------------------- |
| `dependency_type` | enum    | `data`, `approval`, `ordering`        |
| `is_blocking`     | boolean | false = soft ordering preference only |
| `required_status` | enum    | `completed`, `any_terminal`           |
| `timeout_seconds` | integer | nullable                              |

> **Decision 4 — LOCKED: Option B (rich dependency edge).** Hard constraint: no cycles — topological sort check enforced in graph write service at insert time.

---

### 2.5 DEPENDS_ON_STATE — PlanStep → (any node in world or personal graph) _(new in v2.0 — CRITICAL)_

This is the edge type that makes the architectural claim real. It connects a plan step to the specific world or personal state nodes it relied on when it was generated.

| Property            | Type    | Notes                                                                 |
| ------------------- | ------- | --------------------------------------------------------------------- |
| `target_node_id`    | UUID    | ID of the depended-on node (UserBalance, TransferPartner, etc.)       |
| `target_node_type`  | string  | Runtime type tag of the depended-on node                              |
| `depended_property` | string  | nullable — specific property observed, e.g. `'balance_points'`        |
| `snapshot_value`    | JSON    | **The value at plan-generation time** — enables drift detection       |
| `is_stale`          | boolean | default false — set true when target node's relevant property changes |

> **Why this is the most important edge in the schema:** Without `DEPENDS_ON_STATE`, the only way to know a plan is stale is to re-read all world/personal state and compare. With it, any mutation to `UserBalance` can trigger a targeted query: "which DEPENDS_ON_STATE edges point to this node?" → mark those PlanSteps stale → emit staleness events to the frontend sidebar. This is 20-50 lines of SQL, not a full re-query. Person A owns this edge table.

> **Implementation note:** The `snapshot_value` + current value comparison IS the staleness check. Serialize as JSON. Equality check on the specific `depended_property`. On UserBalance mutation: `UPDATE plan_steps SET is_stale=true, staled_at=NOW(), stale_reason=... FROM state_dependencies WHERE target_node_id=$1 AND target_node_type='UserBalance' AND (snapshot_value->>'balance_points')::int != $new_balance`.

---

### 2.6 PART_OF — RedemptionOption → RewardProgram

No edge properties.

---

### 2.7 ASSOCIATED_WITH — CreditCard → RewardProgram

No edge properties.

---

### 2.8 CATEGORIZED_AS — Transaction → SpendCategory

No edge properties. MVP note: no writes.

---

### 2.9 PAID_WITH — Transaction → CreditCard

| Property        | Type    | Notes    |
| --------------- | ------- | -------- |
| `points_earned` | integer | nullable |

MVP note: no writes.

---

### 2.10 GENERATES — AgentRun → Plan

No edge properties.

---

### 2.11 TARGETS — Plan → UserGoal

No edge properties.

---

### 2.12 HOLDS_BALANCE — User → UserBalance _(new in v2.0)_

No edge properties. Navigational edge for the personal graph traversal pattern.

---

### 2.13 HAS_STATUS — User → UserProgramStatus _(new in v2.0)_

No edge properties. Navigational edge.

---

### 2.14 PROPOSED_BY — MutationProposal → AgentRun _(new in v2.0)_

No edge properties. Audit trail.

---

## Section 3: Optimistic Concurrency Control (OCC)

**Decision 5 — LOCKED: Fail-fast + exponential backoff with jitter (Option B)**

| Node              | OCC needed | Rationale                                                                  |
| ----------------- | ---------- | -------------------------------------------------------------------------- |
| Plan              | **Yes**    | Orchestrator + agents update status                                        |
| PlanStep          | **Yes**    | Each agent writes its result independently                                 |
| UserBalance       | **Yes**    | WalletAgent is the sole writer, but concurrent reads require version check |
| UserProgramStatus | Yes        | Infrequent but correctness matters                                         |
| User              | Yes        | Low-frequency but correctness matters                                      |
| MutationProposal  | **Yes**    | Verifier reads, validates, then commits — must be serializable             |
| TRANSFERS_TO edge | Yes        | Ingestion agent may update; OCC version on edge rows                       |
| Everything else   | No         | Read-heavy, single-writer                                                  |

**Conflict resolution:**

- Write: `UPDATE ... WHERE version = $expected_version`. If 0 rows, throw `ConflictError`.
- Retry: max 3 attempts, exponential backoff with jitter (base 50ms, max 400ms).
- After 3 failures: PlanStep goes to `failed`; orchestrator decides whether to requeue.
- `version` starts at 0, incremented on every write. Non-optional for all nodes in the "Yes" rows above.

**Verifier path specifically:** The read-validate-commit cycle for `MutationProposal` MUST run in a `SERIALIZABLE` transaction. Two concurrent ingestion agents proposing conflicting mutations must result in one accepted, one rejected — not both accepted. Postgres serializable isolation handles this; the application layer must not downgrade to `READ COMMITTED` on this path.

---

## Section 4: Type System

**Decision 7 — LOCKED: Option C (discriminated union + `node_type` runtime tag)**

- Every node has `node_type: string` in storage
- TypeScript types use discriminated unions on `node_type`
- Generic graph traversal functions and debug tooling use the runtime tag
- `node_type` values are the exact class names: `'User'`, `'CreditCard'`, `'TransferPartner'`, etc. — no abbreviation, no snake_case

---

## Section 5: Agent Handoff State

**Decision 8 — LOCKED: AgentRun.state blob (Option A)**

Each agent writes a `checkpoint` key to its `state` JSON before any side-effectful operation. Format:

```json
{
  "checkpoint": "after_award_search",
  "award_search_result_node_ids": ["uuid1", "uuid2"],
  "plan_step_ids_written": ["uuid3"],
  "last_read_versions": {
    "UserBalance:abc123": 4,
    "TransferPartner:def456": 2
  }
}
```

`last_read_versions` is critical: if an agent resumes after a crash, it can detect whether any depended-on state changed since its last checkpoint and decide whether to re-plan from the checkpoint or restart.

---

## Section 6: Required Indexes

> Person A owns index creation. These are not optional — recursive CTEs on unindexed FK columns will be unusably slow during the demo.

```sql
-- FK indexes (btree, all FK columns)
CREATE INDEX ON credit_cards (reward_program_id);
CREATE INDEX ON transfer_partners (program_id);
CREATE INDEX ON user_balances (user_id, program_id);
CREATE INDEX ON user_program_statuses (user_id, program_id);
CREATE INDEX ON plan_steps (plan_id);
CREATE INDEX ON plan_steps (plan_id, step_order);
CREATE INDEX ON agent_runs (plan_id);
CREATE INDEX ON mutation_proposals (status) WHERE status = 'pending';
CREATE INDEX ON mutation_proposals (proposed_by_run_id);

-- Staleness query — the hot path for dependency tracking
CREATE INDEX ON plan_steps (is_stale) WHERE is_stale = true;

-- State dependency traversal — the core of the architectural claim
CREATE INDEX ON state_dependencies (target_node_id, target_node_type);
CREATE INDEX ON state_dependencies (plan_step_id);

-- MCC lookup
CREATE INDEX ON spend_categories USING GIN (mcc_codes);

-- OCC hot paths
CREATE INDEX ON plan_steps (plan_id, version);
CREATE INDEX ON user_balances (id, version);
```

---

## Section 7: What Must Be Done Before Anyone Writes Business Logic

1. **Person A — Day 1 morning:** Migrate and seed the schema. `UserBalance`, `UserProgramStatus`, `MutationProposal`, `TransferBonus`, and `state_dependencies` (the DEPENDS_ON_STATE edge table) must exist. `toBasisPoints()` / `fromBasisPoints()` utilities shipped.
2. **All decisions confirmed:** All 8 decisions are now locked with recommendations. Team needs 1 hour to ratify or override.
3. **`DEPENDS_ON_STATE` edge schema ratified:** The orchestrator and redemption agent are blocked until the shape of this edge is agreed — specifically `snapshot_value` structure and the staleness-trigger SQL.
4. **`node_type` string values agreed:** Exact strings listed in this document. No deviations — generic traversal breaks on mismatches.
5. **Basis-point utilities shipped first:** No business logic imports raw ratio values before these utilities exist.
6. **Seed data scope agreed:** 20 cards, top 50 MCCs, full transfer partner graph for Chase UR and Amex MR at minimum (Tokyo demo requires Hyatt, United, ANA).

---

## Gap Analysis Log — v1.0 → v2.0 Changes

| #   | Severity     | Gap                                                                                        | Resolution                                                                  |
| --- | ------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| G1  | 🔴 Critical  | `UserBalance` node missing — WalletAgent had no write target                               | Added as 1.9, OCC, navigational edge 2.12                                   |
| G2  | 🔴 Critical  | `DEPENDS_ON_STATE` edge missing — dependency tracking had no schema support                | Added as edge type 2.5 with snapshot_value and is_stale                     |
| G3  | 🔴 Critical  | `MutationProposal` node missing — verifier demo had no persistence layer                   | Added as 1.11 with full lifecycle fields                                    |
| G4  | 🔴 Critical  | `stale` status and staleness fields missing from `PlanStep`                                | Added `stale` to status enum; `is_stale`, `staled_at`, `stale_reason` added |
| G5  | 🟠 Important | `UserProgramStatus` missing — redemption agent ignores hotel/airline status                | Added as 1.10                                                               |
| G6  | 🟠 Important | `TransferBonus` missing — bonus fields on TransferPartner caused mutation model conflict   | Added as 1.8a; bonus fields removed from TransferPartner                    |
| G7  | 🟠 Important | `AgentRun.agent_type` enum misaligned with proposal agent names                            | Realigned to match: `wallet_agent`, `earning_agent`, etc.                   |
| G8  | 🟠 Important | `Plan` missing `query_text` and `plan_type` (Decision 6 not applied to table)              | Added both fields                                                           |
| G9  | 🟠 Important | `PlanStep` missing `step_order` — no deterministic step sequence                           | Added integer `step_order`                                                  |
| G10 | 🟡 Moderate  | `Transaction`/`Merchant` in schema but explicitly out-of-scope for MVP                     | Marked with MVP scope note; no writes                                       |
| G11 | 🟡 Moderate  | `TransferPartner` missing `program_id` FK — couldn't query by program                      | Added `program_id` FK                                                       |
| G12 | 🟡 Moderate  | `RedemptionOption` missing temporal validity — valuations change                           | Added `valid_from` / `valid_until`                                          |
| G13 | 🟡 Moderate  | `graph_tier` mentioned in intro but never on any node table                                | Added to all node tables                                                    |
| G14 | 🟡 Moderate  | `AgentRun` missing `token_count` — token cost metric uncomputable                          | Added `token_count integer nullable`                                        |
| G15 | 🟡 Moderate  | `Evaluation` had JSON blob for 5 benchmark metrics — unqueryable                           | Added 5 typed columns for primary metrics                                   |
| G16 | 🟢 Minor     | Duplicate `transfer_ratio_basis_points` on both TransferPartner node and TRANSFERS_TO edge | Removed from edge; lives on node only                                       |
| G17 | 🟢 Minor     | No index definitions specified                                                             | Added Section 6 with all required indexes                                   |
| G18 | 🟢 Minor     | `is_active` missing on CreditCard and RewardProgram                                        | Added to both                                                               |
| G19 | 🟢 Minor     | `AgentRun.state` checkpoint format undocumented                                            | Added canonical format with `last_read_versions`                            |

---

_Document owner: Person A (Graph/Persistence). v2.0 prepared for Day 1 team discussion. Freeze after ratification._
