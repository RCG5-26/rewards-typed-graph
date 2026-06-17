# MVP Database Schema — Rewards Typed Graph

This schema is the pared-down MVP version of the rewards typed graph.

The MVP goal is to prove one loop:

```text
build plan -> record dependencies -> mutate balance -> detect stale plan -> re-plan
```

The graph is stored in Postgres using two primary tables:

- `nodes`: things in the graph
- `edges`: typed relationships between those things

Agents do not pass free-text messages to each other. They commit typed graph mutations through the shared write path.

---

## 1. Design Choices

| Choice | MVP Decision |
|---|---|
| Storage model | One `nodes` table and one `edges` table |
| Attribute storage | Type-specific fields live in JSONB `attributes` |
| IDs | UUID primary keys |
| Graph tiers | `world`, `personal`, `plan` |
| Concurrency | Integer `version` on nodes and edges |
| Dependency tracking | `DEPENDS_ON` edges store observed versions and values |
| Effective dating | Deferred from MVP |
| Ingestion/verifier | Deferred from MVP |
| Transfer partners | Programs connected to programs by `TRANSFERS_TO` |

---

## 2. PostgreSQL Extensions

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

`pgcrypto` is used for `gen_random_uuid()`.

---

## 3. Enum Values

These may be implemented as Postgres enums, check constraints, or application-level constants.

### Node Types

```text
User
Card
Program
MerchantCategory
Balance
Goal
PlanQuery
PlanStep
```

### Edge Types

```text
HOLDS
ASSOCIATED_WITH
EARNS
HAS_BALANCE
BALANCE_FOR
HAS_GOAL
FOR_USER
TRANSFERS_TO
TARGETS
STEP_OF
DEPENDS_ON
```

### Graph Tiers

```text
world
personal
plan
```

### Program Kinds

```text
transferable
airline
hotel
cashback
```

### Plan Statuses

```text
active
stale
superseded
completed
failed
```

---

## 4. Tables

### 4.1 `nodes`

Stores all graph entities.

```sql
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
```

Recommended indexes:

```sql
CREATE UNIQUE INDEX nodes_slug_unique
  ON nodes (slug)
  WHERE slug IS NOT NULL;

CREATE INDEX nodes_type_idx ON nodes (type);
CREATE INDEX nodes_tier_idx ON nodes (tier);
CREATE INDEX nodes_user_id_idx ON nodes (user_id);
CREATE INDEX nodes_attributes_gin_idx ON nodes USING gin (attributes);
```

### 4.2 `edges`

Stores all graph relationships.

```sql
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
```

Recommended indexes:

```sql
CREATE INDEX edges_type_idx ON edges (type);
CREATE INDEX edges_source_idx ON edges (source_id);
CREATE INDEX edges_target_idx ON edges (target_id);
CREATE INDEX edges_source_type_idx ON edges (source_id, type);
CREATE INDEX edges_target_type_idx ON edges (target_id, type);
CREATE INDEX edges_attributes_gin_idx ON edges USING gin (attributes);

CREATE UNIQUE INDEX edges_unique_active_relationship
  ON edges (type, source_id, target_id);
```

### 4.3 `mutation_log`

Append-only audit/event log. This powers the demo sidebar and helps debug graph changes.

```sql
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
```

Recommended indexes:

```sql
CREATE INDEX mutation_log_created_at_idx ON mutation_log (created_at);
CREATE INDEX mutation_log_target_idx ON mutation_log (target_kind, target_id);
CREATE INDEX mutation_log_actor_idx ON mutation_log (actor);
```

---

## 5. Node Attribute Schemas

The database stores node-specific fields in `nodes.attributes`.
The application write layer must validate these shapes before commit.

### 5.1 `User`

Tier: `personal`

```json
{
  "name": "Demo User",
  "optimization_goal": "maximize_redemption_value"
}
```

Required attributes:

| Attribute | Type | Notes |
|---|---|---|
| `name` | string | Display name |
| `optimization_goal` | string | Example: `maximize_redemption_value`, `maximize_cashback`, `minimize_fees` |

### 5.2 `Card`

Tier: `world`

```json
{
  "name": "Chase Sapphire Preferred",
  "issuer": "Chase",
  "network": "Visa",
  "annual_fee_cents": 9500,
  "signup_bonus_points": 60000,
  "signup_bonus_spend_cents": 400000
}
```

Required attributes:

| Attribute | Type | Notes |
|---|---|---|
| `name` | string | Card name |
| `issuer` | string | Bank or issuer |
| `network` | string | Visa, Mastercard, Amex, Discover |
| `annual_fee_cents` | integer | Store money as cents |

Optional attributes:

| Attribute | Type | Notes |
|---|---|---|
| `signup_bonus_points` | integer | Signup bonus amount |
| `signup_bonus_spend_cents` | integer | Spend required for bonus |

### 5.3 `Program`

Tier: `world`

```json
{
  "name": "Chase Ultimate Rewards",
  "kind": "transferable",
  "currency_name": "points"
}
```

Required attributes:

| Attribute | Type | Notes |
|---|---|---|
| `name` | string | Program name |
| `kind` | string | `transferable`, `airline`, `hotel`, or `cashback` |
| `currency_name` | string | points, miles, cashback |

### 5.4 `MerchantCategory`

Tier: `world`

```json
{
  "name": "Dining",
  "mcc_codes": [5812, 5814]
}
```

Required attributes:

| Attribute | Type | Notes |
|---|---|---|
| `name` | string | Category display name |

Optional attributes:

| Attribute | Type | Notes |
|---|---|---|
| `mcc_codes` | integer[] | Small MVP seed list only |

### 5.5 `Balance`

Tier: `personal`

```json
{
  "program_id": "00000000-0000-0000-0000-000000000000",
  "amount_points": 240000,
  "as_of": "2026-06-17T00:00:00Z",
  "source": "manual_entry"
}
```

Required attributes:

| Attribute | Type | Notes |
|---|---|---|
| `program_id` | UUID string | Program this balance belongs to |
| `amount_points` | integer | Current point balance |
| `as_of` | ISO timestamp | When balance was confirmed |
| `source` | string | Example: `manual_entry`, `agent_computed` |

MVP rule:

```text
One active Balance per User + Program.
```

Enforce this in the write layer by checking:

```text
User --HAS_BALANCE--> Balance --BALANCE_FOR--> Program
```

### 5.6 `Goal`

Tier: `personal`

```json
{
  "goal_type": "specific_redemption",
  "description": "Book Tokyo trip in October",
  "target_location": "Tokyo",
  "target_date": "2026-10"
}
```

Required attributes:

| Attribute | Type | Notes |
|---|---|---|
| `goal_type` | string | Example: `specific_redemption`, `maximize_points`, `maximize_cashback` |
| `description` | string | Human-readable goal |

Optional attributes:

| Attribute | Type | Notes |
|---|---|---|
| `target_program_id` | UUID string | Optional preferred program |
| `target_location` | string | Optional destination |
| `target_date` | string | Optional date or month |

### 5.7 `PlanQuery`

Tier: `plan`

```json
{
  "query_text": "How should I use my points for Tokyo?",
  "status": "active",
  "summary": null
}
```

Required attributes:

| Attribute | Type | Notes |
|---|---|---|
| `query_text` | string | Original user query |
| `status` | string | `active`, `completed`, or `failed` |

Optional attributes:

| Attribute | Type | Notes |
|---|---|---|
| `summary` | string/null | Final plan summary |

### 5.8 `PlanStep`

Tier: `plan`

```json
{
  "step_order": 1,
  "agent": "redemption_agent",
  "claim": "Transfer Chase points to Hyatt for the hotel stay.",
  "inputs": {
    "from_program": "Chase Ultimate Rewards",
    "to_program": "World of Hyatt"
  },
  "output": {
    "recommendation": "Transfer 120000 points to Hyatt."
  },
  "status": "active",
  "stale_reason": null
}
```

Required attributes:

| Attribute | Type | Notes |
|---|---|---|
| `step_order` | integer | Display/order inside the plan |
| `agent` | string | Agent that created the step |
| `claim` | string | Human-readable plan step |
| `inputs` | object | Structured inputs used by the step |
| `output` | object | Structured result |
| `status` | string | `active`, `stale`, `superseded`, `completed`, `failed` |

Optional attributes:

| Attribute | Type | Notes |
|---|---|---|
| `stale_reason` | string/null | Why the step became stale |

---

## 6. Edge Attribute Schemas

The database stores edge-specific fields in `edges.attributes`.
The application write layer must validate source and target node types.

### 6.1 `HOLDS`

From: `User`  
To: `Card`

```json
{
  "opened_date": "2024-01-01",
  "is_primary": true
}
```

Attributes:

| Attribute | Type | Notes |
|---|---|---|
| `opened_date` | date string | Optional |
| `is_primary` | boolean | Optional, default false |

### 6.2 `ASSOCIATED_WITH`

From: `Card`  
To: `Program`

```json
{}
```

Meaning:

```text
This card earns rewards into this program.
```

### 6.3 `EARNS`

From: `Card`  
To: `MerchantCategory`

```json
{
  "earn_rate_basis_points": 30000,
  "earn_type": "points",
  "cap_amount_cents": null
}
```

Attributes:

| Attribute | Type | Notes |
|---|---|---|
| `earn_rate_basis_points` | integer | `30000` means 3x |
| `earn_type` | string | `points`, `miles`, or `cashback_pct` |
| `cap_amount_cents` | integer/null | Optional spend cap |

### 6.4 `HAS_BALANCE`

From: `User`  
To: `Balance`

```json
{}
```

Meaning:

```text
This user owns this balance node.
```

### 6.5 `BALANCE_FOR`

From: `Balance`  
To: `Program`

```json
{}
```

Meaning:

```text
This balance is denominated in this program.
```

### 6.6 `HAS_GOAL`

From: `User`  
To: `Goal`

```json
{}
```

Meaning:

```text
This goal belongs to this user.
```

### 6.7 `FOR_USER`

From: `PlanQuery`  
To: `User`

```json
{}
```

Meaning:

```text
This plan query was created for this user.
```

### 6.8 `TRANSFERS_TO`

From: `Program`  
To: `Program`

```json
{
  "ratio_num": 1,
  "ratio_den": 1,
  "transfer_time_days": 1,
  "is_active": true
}
```

Attributes:

| Attribute | Type | Notes |
|---|---|---|
| `ratio_num` | integer | Transfer numerator |
| `ratio_den` | integer | Transfer denominator |
| `transfer_time_days` | integer | Expected transfer time |
| `is_active` | boolean | Whether this transfer path is available |

Example:

```text
Chase Ultimate Rewards --TRANSFERS_TO--> World of Hyatt
ratio_num = 1
ratio_den = 1
```

### 6.9 `TARGETS`

From: `PlanQuery`  
To: `Goal`

```json
{}
```

Meaning:

```text
This plan query targets this goal.
```

### 6.10 `STEP_OF`

From: `PlanStep`  
To: `PlanQuery`

```json
{}
```

Meaning:

```text
This step belongs to this plan query.
```

### 6.11 `DEPENDS_ON`

From: `PlanStep`  
To: any node read by the plan step

```json
{
  "observed_version": 0,
  "observed_property": "amount_points",
  "observed_value": 240000
}
```

Attributes:

| Attribute | Type | Notes |
|---|---|---|
| `observed_version` | integer | Version seen when the step was generated |
| `observed_property` | string/null | Specific property read, if applicable |
| `observed_value` | any JSON value | Value seen when the step was generated |

Meaning:

```text
This plan step relied on this node being at this version/value.
```

Staleness rule:

```text
A PlanStep is stale if any DEPENDS_ON target node has a current version
different from the edge's observed_version.
```

Optional stronger rule:

```text
If observed_property is set, compare observed_value to the current value of
that property in the target node's attributes.
```

---

## 7. Required Edge Type Validation

The write layer must enforce valid source and target types.

| Edge Type | Source Type | Target Type |
|---|---|---|
| `HOLDS` | `User` | `Card` |
| `ASSOCIATED_WITH` | `Card` | `Program` |
| `EARNS` | `Card` | `MerchantCategory` |
| `HAS_BALANCE` | `User` | `Balance` |
| `BALANCE_FOR` | `Balance` | `Program` |
| `HAS_GOAL` | `User` | `Goal` |
| `FOR_USER` | `PlanQuery` | `User` |
| `TRANSFERS_TO` | `Program` | `Program` |
| `TARGETS` | `PlanQuery` | `Goal` |
| `STEP_OF` | `PlanStep` | `PlanQuery` |
| `DEPENDS_ON` | `PlanStep` | any node |

---

## 8. Orphan Node Rule

Every meaningful node should have at least one edge connection.

Exceptions:

- A node may be temporarily orphaned inside a transaction while related edges are being created.
- Seeded world data may be temporarily orphaned during setup, but demo seed data should be connected.

Expected connections:

| Node Type | Expected Connection |
|---|---|
| `User` | `FOR_USER`, `HOLDS`, `HAS_BALANCE`, or `HAS_GOAL` |
| `Card` | `HOLDS`, `ASSOCIATED_WITH`, or `EARNS` |
| `Program` | `ASSOCIATED_WITH`, `BALANCE_FOR`, or `TRANSFERS_TO` |
| `MerchantCategory` | `EARNS` |
| `Balance` | `HAS_BALANCE` and `BALANCE_FOR` |
| `Goal` | `HAS_GOAL` or `TARGETS` |
| `PlanQuery` | `FOR_USER`, `TARGETS`, or `STEP_OF` |
| `PlanStep` | `STEP_OF` and at least one `DEPENDS_ON` |

---

## 9. Optimistic Concurrency

Every node and edge has a `version` integer.

Write rule:

```sql
UPDATE nodes
SET
  attributes = $new_attributes,
  version = version + 1,
  updated_at = now()
WHERE id = $node_id
  AND version = $expected_version;
```

If zero rows are updated, the writer hit a conflict and must re-read before retrying.

MVP retry policy:

```text
Retry at most 3 times with small jitter.
After 3 failures, mark the relevant PlanStep as failed or conflicted.
```

---

## 10. Staleness Query

Find stale plan steps by comparing dependency edges to current node versions.

```sql
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
```

Mark a plan step stale:

```sql
UPDATE nodes
SET
  attributes = jsonb_set(
    jsonb_set(attributes, '{status}', '"stale"'::jsonb),
    '{stale_reason}',
    to_jsonb($reason::text)
  ),
  version = version + 1,
  updated_at = now()
WHERE id = $plan_step_id
  AND type = 'PlanStep';
```

---

## 11. MVP Seed Shape

Minimal connected seed graph:

```text
User --HOLDS--> Card
Card --ASSOCIATED_WITH--> Program
Card --EARNS--> MerchantCategory
User --HAS_BALANCE--> Balance
Balance --BALANCE_FOR--> Program
User --HAS_GOAL--> Goal
PlanQuery --FOR_USER--> User
PlanQuery --TARGETS--> Goal
PlanStep --STEP_OF--> PlanQuery
PlanStep --DEPENDS_ON--> Balance
PlanStep --DEPENDS_ON--> Program
Program --TRANSFERS_TO--> Program
```

Example world graph:

```text
Chase Sapphire Preferred --ASSOCIATED_WITH--> Chase Ultimate Rewards
Chase Sapphire Preferred --EARNS 3x--> Dining
Chase Ultimate Rewards --TRANSFERS_TO 1:1--> World of Hyatt
```

Example personal graph:

```text
Demo User --HOLDS--> Chase Sapphire Preferred
Demo User --HAS_BALANCE--> 240,000 Chase Ultimate Rewards points
Demo User --HAS_GOAL--> Book Tokyo trip in October
```

Example plan graph:

```text
PlanQuery: "How should I use my points for Tokyo?"
PlanStep: "Transfer Chase points to Hyatt."
PlanStep --DEPENDS_ON--> Chase balance at version 0 / 240000 points
```

If the Chase balance changes from `240000` to `180000`, the `Balance` node version increments.
The dependency query then marks the old plan step stale and the redemption agent can create a superseding step.

---

## 12. Cut From MVP

These are intentionally deferred:

| Deferred Item | Reason |
|---|---|
| `IngestionAgent` | Not required to prove dependency tracking |
| `VerifierAgent` | Only needed for external world updates |
| `MutationProposal` node | Verifier-specific |
| Ratio transitivity checks | Layer 4 / verifier concern |
| Effective-dated world facts | Adds temporal complexity |
| Transfer bonuses | Nice detail, not required for hero loop |
| Full benchmark suite | Comes after MVP works |
| Single-agent baseline | Benchmark phase |
| Free-text multi-agent baseline | Benchmark phase |
| Real external tools | Fixtures are enough |
| Transaction ingestion | Manual balances are enough |
| Merchant node | Categories are enough for MVP |
| Full MCC hierarchy | Seed only a few categories |
| Multi-agent concurrency stress tests | Simple version checks are enough |

