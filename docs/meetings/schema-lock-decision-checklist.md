# Schema Lock: Decision Checklist

**Meeting:** Day 1 Schema Lock (RCG-5) | **Date:** June 17, 2026 | **Owner:** Person A drafts, Raq reviews, all lanes sign off
**Status:** locked after this meeting and additive-only thereafter (new optional attributes and new edge types allowed; no renames, removals, or retypes without lead sign-off)

Why this matters: schema drift mid-project makes dependency tracking unreliable and turns the redemption agent into a moving target. Every decision below must be either ratified (clear call) or closed (design choice) before anyone writes a line of agent code.

Each item is tagged:

- **[CLEAR CALL]** the recommendation is the obvious choice; ratify and move on.
- **[DECIDE]** a genuine design choice with real tradeoffs; the team must close it in the room.

---

## How to run the room (read first)

There are **9 decisions that actually need debate**. Everything else is a clear call to ratify quickly. Spend the meeting on the nine. The clear calls are listed so nothing is silently assumed.

The nine to close:

1. Single-table + JSONB vs. table-per-type (A1)
2. Transfer partner as role vs. type, and balance as node vs. property (A3)
3. Ratio representation: rational vs. float (B4)
4. Two kinds of versioning: concurrency `version` vs. effective-dating (C2)
5. Dependency-edge structure and where the observed read-version lives (D2)
6. Staleness computed-on-read vs. stored flag (D3)
7. Mutation ownership matrix: who may mutate what (E4)
8. One canonical schema artifact for TS + Python (G1)
9. Ratio-transitivity invariant and tolerance (F3)

---

## A. Node types

**A1. Storage model: single `nodes` table with a `type` discriminator + JSONB attributes, vs. a table per node type. [DECIDE]**
Recommendation: single `nodes` table, `type` enum column, `attributes` JSONB, plus typed columns only for things you filter/join on hot (id, type, tier, user_id, version). Rationale: matches the Postgres-JSON approach, keeps the mutation and validation layer uniform, and makes adding a node type additive. Cost: validation moves to the app layer rather than the DB. This decision cascades into B3 (edges) and F1 (validation placement).

**A2. Node type enumeration. [CLEAR CALL]**
World tier: `Card`, `Program`, `MerchantCategory`. Personal tier: `User`, `Balance`, `Status`, `Goal`. Plan tier: `PlanQuery` (root), `PlanStep`. Freeze this list today; new types are additive later.

**A3. Two modeling questions to settle now. [DECIDE]**

- *Transfer partner: node type or role?* Recommendation: programs are nodes; "transfer partner" is a **role expressed by a `TRANSFERS_TO` edge** between two `Program` nodes, not a separate type. Avoids a redundant entity.
- *Balance: first-class node or property on a (User, Program) pair?* Recommendation: **first-class `Balance` node.** Dependency tracking needs something concrete to point at and to version. A balance buried as a JSON property on `User` cannot be a dependency target without tracking the whole `User` node, which over-invalidates. This is the node Hero Moment 1 mutates.

**A4. Program subtyping. [CLEAR CALL]**
`Program.kind` enum: `transferable` (Chase UR, Amex MR), `airline`, `hotel`, `cashback`. Needed so the redemption agent knows what can transfer where. Freeze the enum.

**A5. Node identity. [CLEAR CALL]**
UUID primary key + a stable, unique natural-key `slug` for world nodes (e.g., `program:chase_ur`, `card:csr`). Fixtures, tools, and ingestion upsert by slug idempotently; everything else references UUID.

**A6. Tier + user scoping. [CLEAR CALL]**
`tier` enum column (`world` | `personal` | `plan`) and a nullable `user_id` (null for world nodes). Personal and plan nodes are always user-scoped.

**A7. Required attribute schema per type. [CLEAR CALL once A1–A4 land]**
Enumerate required attributes per type in the spec, e.g. `Balance {user_id, program_id, amount, as_of}`, `Card {issuer, annual_fee, slug}`, `Program {kind, display_name, slug}`. The mutation layer rejects nodes missing required attributes.

---

## B. Edge types

**B1. Edge type enumeration. [CLEAR CALL]**
`TRANSFERS_TO` (Program to Program), `EARNS` (Card to MerchantCategory), `HOLDS` (User to Card), `HAS_BALANCE` (User to Balance), `HAS_STATUS` (User to Status), `DEPENDS_ON` (PlanStep to any state node), `STEP_OF` (PlanStep to PlanQuery). Freeze; new edge types are additive.

**B2. Directionality and cardinality. [CLEAR CALL]**
All edges directed. Transfers are directed and asymmetric (UR to Hyatt does not imply the reverse). Document expected cardinality per type in the spec.

**B3. Edge storage model. [CLEAR CALL, follows A1]**
Single `edges` table mirroring `nodes`: `type` enum, `source_id`, `target_id`, `attributes` JSONB, `version`, timestamps. If A1 goes table-per-type, this follows suit.

**B4. Ratio and multiplier representation. [DECIDE]**
Recommendation: store transfer ratios as **rational integers** (`ratio_num`, `ratio_den`), not floats. Rationale: the verifier's ratio-transitivity check (F3) must compare `r1 * r2` against a direct edge exactly; floats accumulate error and make "is this transitive?" ambiguous. Earning multipliers can be decimal but pick fixed precision. This is a small decision with outsized downstream impact on Layer 4 and the gold corpus, so close it explicitly.

**B5. Edge attribute schemas. [CLEAR CALL once B4 lands]**
`TRANSFERS_TO {ratio_num, ratio_den, min_increment, transfer_time, effective_from, effective_to?}`. `EARNS {multiplier, category, cap?, effective_from, effective_to?}`. Bonuses are modeled as a time-boxed edge version (see C2/B6), not a magic attribute.

**B6. Multi-edge policy. [CLEAR CALL, depends on C2]**
At most one **active** edge per `(type, source, target)` at a time. Transfer bonuses and devaluations are new effective-dated versions that supersede the prior active edge, not a second concurrent edge. Keeps traversal unambiguous.

**B7. Referential integrity. [CLEAR CALL]**
FK constraints from `edges.source_id` and `edges.target_id` to `nodes.id`. This is what makes the verifier's "node-reference violation" a real, catchable failure mode rather than a silent dangling edge.

---

## C. Versioning and timestamps

**C1. Concurrency version + timestamps on every node and edge. [CLEAR CALL]**
Integer `version`, incremented on every mutation, plus `created_at` and `updated_at`. The `version` integer is the optimistic-concurrency token (see E1).

**C2. Two different kinds of "version" that must not be conflated. [DECIDE]**
There are two needs and they are not the same thing:

- **Concurrency `version`** (integer, C1): "has this row changed since I read it?" Used by optimistic concurrency.
- **Effective dating** (`effective_from`, `effective_to`): "what was true about the world on a given date?" Used for world-fact history (bonuses, devaluations).

Recommendation: keep both, explicitly. For world-fact history, decide the mechanism now: **append a new effective-dated edge version and soft-supersede the prior one** (recommended; preserves history and powers the Layer 4 narrative) vs. update in place with an audit log. Pick one; do not let the integer `version` quietly stand in for history.

**C3. Mutation / event log. [CLEAR CALL]**
Append-only `mutations` log: agent, target node/edge, old to new value, resulting version, timestamp. This powers the demo's streaming sidebar **and** is the audit trail the verifier reads. It is load-bearing for the demo, so treat it as schema, not an afterthought (RCG-14).

---

## D. Plan graph and dependency-edge structure (Layer 3 core)

**D1. Plan node schema. [CLEAR CALL]**
`PlanStep {plan_query_id, step_index, agent, claim, inputs, output, status, version}` with `status` in `active | stale | superseded`. `PlanQuery` is the root the steps attach to via `STEP_OF`.

**D2. Dependency-edge structure: where does the observed read-version live? [DECIDE]**
A plan step records, for each piece of world/personal state it read, both the node it depended on and the version it observed at read time. Two ways to store the observed version:

- On the `DEPENDS_ON` edge as an attribute: `DEPENDS_ON {observed_version}` (recommended; keeps the read-set as graph structure, which is the whole architectural point).
- In a separate read-set table keyed by plan step.

Recommendation: put `observed_version` on the `DEPENDS_ON` edge. Close this explicitly because it defines the exact shape Person A implements and Person B visualizes.

**D3. Staleness: computed-on-read or stored flag? [DECIDE]**
A plan step is stale iff any `DEPENDS_ON` target's current `version` differs from the edge's `observed_version`.

- Computed-on-read via a join/CTE (recommended for correctness; one query answers "is this step stale?").
- Denormalized `status = stale` flag flipped by the mutation layer when a depended-on node changes (faster for the live sidebar, more moving parts).

Recommendation: compute-on-read as the source of truth; optionally also flip a denormalized flag in the mutation path purely to drive the sidebar animation. Decide whether you want both today.

**D4. Scope of dependency tracking. [CLEAR CALL, hard constraint]**
`DEPENDS_ON` edges originate from plan steps only. No transitive propagation, no world-to-world or plan-to-plan dependency chains in the MVP. Bounded to roughly 250 lines (RCG-13).

**D5. Re-plan semantics. [DECIDE, lightweight]**
On invalidation, does the redemption agent mutate the stale step in place or write a new step version and mark the old `superseded`? Recommendation: **new version, old marked superseded.** The sidebar can then show the re-plan happening, which is the visible payoff of Hero Moment 1.

---

## E. Optimistic concurrency (the commit protocol, Person A)

**E1. Commit protocol. [CLEAR CALL, already specified]**
A mutation carries the read-set it relied on as `{node_id: observed_version}`. Commit succeeds iff all observed versions are still current, else reject. This is the contract every agent commits through.

**E2. Isolation levels. [CLEAR CALL]**
Optimistic version-check on the hot agent path; `SERIALIZABLE` transactions for the verifier path (Layer 4) only. Stated in the proposal; ratify.

**E3. Retry policy. [CLEAR CALL, set the numbers]**
Bounded retries with exponential backoff. Recommend max 3 retries; on exhaustion, mark the step conflicted and re-read rather than spin. Pin the actual numbers today so the conflict-resolution path (RCG-19) is not guesswork.

**E4. Mutation ownership matrix: who may mutate what? [DECIDE]**
The review flagged concurrent writes as the one underspecified risk. Define ownership now to shrink the write surface:

- Wallet agent: sole writer of personal-tier nodes (balances, status, goals).
- Redemption agent: sole writer of plan nodes and `DEPENDS_ON` edges.
- Earning agent: reads world, writes only its own plan-step contributions.
- Ingestion/verifier (Layer 4): the only writers of world-tier edges, and only via the verified `SERIALIZABLE` path.

Recommendation: adopt this matrix. It is the single cheapest mitigation for concurrent-write thrashing. Close it explicitly so no two agents claim the same write.

---

## F. Validation contract and verifier taxonomy

**F1. Where validation runs. [DECIDE, then mostly clear]**
Recommendation: structural, referential, and basic-domain validation run in the **shared mutation layer** for every agent (Person A owns this). Cross-edge consistency and transitivity run in the **verifier** (Layer 4) only. Decide the split today so nobody assumes the verifier will catch a class of error the hot path actually needs to reject.

**F2. Verifier rejection taxonomy. [CLEAR CALL, adopt now even though Layer 4 is stretch]**
Three distinct failure modes, per the proposal review: **schema violation**, **node-reference violation**, **ratio-transitivity violation**. Encode the invariants the verifier will check now, so the schema supports them even if Layer 4 is cut. The adversarial set (RCG-43) must cover all three separately.

**F3. Ratio-transitivity invariant and tolerance. [DECIDE]**
Define precisely what must hold, e.g.: if `A to B = r1` and `B to C = r2`, then any direct `A to C` edge must equal `r1 * r2` (exact, using rational arithmetic from B4), and a proposed edge that contradicts an implied ratio is rejected. Decide the exact rule and any tolerance today. This feeds both the verifier and the gold corpus, so it matters even under a Layer 4 no-go.

---

## G. Cross-cutting

**G1. One canonical schema artifact for TS and Python. [DECIDE]**
Raq's orchestrator is TypeScript; Person C's agents are Python. If each hand-writes its own types, they drift, which reintroduces exactly the failure the lock is meant to prevent. Recommendation: one source-of-truth artifact (SQL DDL plus a shared spec such as JSON Schema) from which both sides validate; generate or sync types from it (RCG-7). Close the mechanism today.

**G2. Graph-typed tool fragment contract. [DECIDE]**
Tools return typed subgraph fragments (`{nodes, edges}` conforming to this schema), not arbitrary JSON, so results compose into the shared world model. Define the fragment envelope and the merge rule (upsert by slug + version) with provenance attributes (`source_tool`, `fetched_at`). Touches the shared schema, so settle it at the lock (RCG-23), not later.

**G3. Demo seed fixture. [CLEAR CALL]**
Commit the canonical persona as a fixture with stable IDs: five cards, 240k points across three programs, Tokyo in October. All four lanes build against the same IDs (RCG-8). Treat the fixture as part of the lock.

**G4. Enum freeze. [CLEAR CALL]**
Freeze every enum today: program kinds, edge types, plan states, mutation event types, agent identifiers. Adding values later is additive; changing meaning is not.

**G5. Migration policy after lock. [CLEAR CALL]**
Additive-only. New optional attributes and new edge types are fine. Renames, removals, retypes, and semantic changes require explicit lead sign-off. This is what "locked, not revisited" means in practice.

---

## Sign-off

The schema is locked when every lane can answer yes:

- [ ] Graph/Persistence (Person A): I can build the tables, mutation layer, concurrency, and dependency tracking from this with no open questions.
- [ ] Orchestrator/Agents (Raq): the wallet and earning agents have a stable mutation contract and a shared type artifact.
- [ ] Redemption/Eval (Person C): the redemption agent's traversal targets, the tool fragment contract, and the gold-corpus ratio representation are fixed.
- [ ] Frontend/Demo (Person B): the mutation-log event shape and the plan-node/dependency-edge shape are fixed enough to render.

Date locked: ________   Recorded in: canonical schema artifact (RCG-7) + seed fixture (RCG-8)
