# Schema v2 — Staff Review

Reviewer pass on [`schema-v2.md`](../architecture/schema-v2.md) (Person A / Alan) ahead of the Day 1 lock. Lens: staff SWE + senior product engineer. Goal: catch what would bite us mid-sprint or in the demo, while the schema can still change cheaply.

## Verdict

Lock it, with the blocker gaps below resolved in the room. v2 is genuinely strong and already closes most of the first-pass risks: `UserBalance` as a real node, `DEPENDS_ON_STATE` with `snapshot_value`, `MutationProposal` lifecycle, `PlanStep` staleness fields, integer basis points everywhere, OCC scoped to the right tables, and an index list. The gaps that remain are mostly "decide and write it down," not "the model is wrong." Four of them sit directly on the hero path, the Layer 4 path, or benchmark integrity, so they are worth 30 focused minutes today.

## What v2 got right (so we don't relitigate it)

Integer money and basis points, no floats. `timestamptz` UTC throughout. OCC `version` on exactly the mutable nodes. `TransferBonus` as a separate node with provenance instead of a mutated field (clean accept/reject and a clean ingestion story). `DEPENDS_ON_STATE.snapshot_value` as the drift-detection primitive. `node_type` discriminator. Temporal validity on `RedemptionOption`. Typed benchmark columns on `Evaluation`. The gap log (G1–G19) is honest and the severity calls are right.

---

## Blocker gaps — resolve in the meeting (on the hero / Layer 4 / integrity paths)

### B1. Staleness propagation: name the mechanism and the single chokepoint

The staleness UPDATE in §2.5 is written as raw SQL but never assigned to a _mechanism_. Who runs it, and what guarantees every mutation path triggers it? If it lives in hand-called application code, the first writer who forgets to call it ships a plan that looks fresh but is stale, and the entire architectural claim quietly breaks in the demo.

**Recommendation:** every node mutation goes through one graph-write service function (it already owns the no-cycle and topo-sort checks per Decisions 1 and 4). That function runs the staleness propagation in the _same transaction_ as the mutation. Consider a Postgres trigger on `user_balances` as a belt-and-suspenders backstop so staleness cannot be bypassed even from a manual write. Decide: trigger, app chokepoint, or both. Owner: Alan, with Raq (orchestrator) signing off on the contract.

### B2. `DEPENDS_ON_STATE` covers nodes but not edge-valued facts (earn rates, transfer ratios)

`DEPENDS_ON_STATE` targets a node (`target_node_id` + `target_node_type`). But earn rates live on the `EARNS` edge (§2.2) and the base transfer ratio lives on `TransferPartner` (a node, OK) while promotional ratios live on `TransferBonus` (a node, OK). A plan step that relies on "Chase Sapphire earns 3x dining" depends on an **edge**, which today cannot be a staleness target. So an earn-rate change or a `TRANSFERS_TO` edge change would not invalidate dependent plans.

**Recommendation:** for the MVP, scope staleness to node-valued dependencies (balance, status, transfer bonus) and **explicitly document** that edge-valued dependencies (earn rate, base ratio) are out of staleness scope for the sprint. The hero moment is a balance change, which is a node, so the demo is safe. But say so out loud, because "we track all dependencies" is not what the schema does. If we want edge coverage later, add `target_edge_id` / `target_edge_type` to `DEPENDS_ON_STATE`. Owner: Alan + Michael (redemption agent depends on this).

### B3. TransferPartner vs RewardProgram: the multi-hop bridge for the redemption hero path

This is the most important modeling question in the document. A transfer destination (Hyatt) is modeled as a `TransferPartner` node (§1.8). But to _redeem_ after transferring, the redemption agent needs Hyatt's `RedemptionOption`s, which hang off `RewardProgram` (§1.7, `RedemptionOption.program_id → RewardProgram`). There is no link from `TransferPartner` to the `RewardProgram` you land in. The redemption agent's core traversal — "transfer Chase UR → Hyatt, then book Park Hyatt Tokyo" — has a missing edge in the middle.

**Recommendation:** add `TransferPartner.lands_in_program_id UUID FK → RewardProgram` (nullable for partners we don't model redemptions for), or unify transfer partners into `RewardProgram` and make `TRANSFERS_TO` go program→program. Unifying is cleaner long-term; the FK bridge is the smaller change today. Either way, decide now — the redemption agent (the hero) cannot traverse without it. Owner: Alan + Michael.

### B4. `UserBalance` needs a uniqueness rule, or the hero OCC moment breaks

The demo's marquee beat mutates _the_ balance node and bumps its `version`. But there is no unique constraint on `UserBalance (user_id, program_id)`, and `source` allows `manual_entry` / `plaid_sync` / `agent_computed`. Without a single canonical row per (user, program), "mutate the balance" becomes "which of the three balance rows?" and the version-increment story is ambiguous on screen.

**Recommendation:** unique constraint on `(user_id, program_id)` for the active balance; WalletAgent updates in place (version++), never inserts a second row for the same program. If we want history, add a separate `balance_history` append table later. Owner: Alan.

### B5. Polymorphic `DEPENDS_ON_STATE` reference has no FK — name the integrity strategy

The index list (§6) shows table-per-type physical storage (`credit_cards`, `user_balances`, `plan_steps`, …), with `node_type` as the app-level discriminator. That is a fine choice, but it means `DEPENDS_ON_STATE.target_node_id` is a **polymorphic reference with no foreign key** (you cannot FK one column to many tables). So the verifier's "node-reference violation" failure mode (a core Layer 4 deliverable) is _not_ DB-enforced; it must be an application check, and orphaned dependency edges are possible after a delete.

**Recommendation:** accept the polymorphic ref (don't contort into a single table this late), but (a) make node-reference validation an explicit step in the graph-write service and the verifier, (b) add a cheap periodic orphan check, and (c) write it down so Michael builds the verifier knowing integrity is app-level, not FK-level. Owner: Alan + Michael. Note: this also slightly contradicts the intro's "Postgres with JSON columns" framing — the model is mostly typed columns with a few JSON fields, which is good; just align the wording.

---

## Important gaps — decide today or assign an owner

### I1. Benchmark integrity: baselines must use the schema as an output sink only

`Plan.plan_type` marks baselines (`baseline_single_agent`, `baseline_free_text_multiagent`, `baseline_naive`). Be explicit: the free-text baseline must **not** use `DEPENDS_ON_STATE` or the typed coordination layer internally — if it does, we have handed it dependency tracking and contaminated the wins-by-kind result. Baselines should persist only their final `Plan` / `PlanStep` rows for scoring. Owner: Michael. This is a benchmark-honesty issue, not a schema bug, but it lives in this schema so it belongs in the lock.

### I2. No benchmark-query identity to join the same query across architectures

`Evaluation` pairs `plan_id` with one `baseline_plan_id`. But the benchmark is 30 queries × 3–4 architectures. There is no `benchmark_query_id` tying the four runs of one query together for apples-to-apples reporting. **Recommendation:** add a `benchmark_query_id` (UUID or stable slug) to `Plan`, or a small `BenchmarkQuery` node. Owner: Michael, schema support from Alan.

### I3. Graph-typed tool results have no target node type

The award-search and cash-price tools "return graph fragments, not JSON" (intro, and a first-class claim in the deliverables). But there is no node type for a fetched award or cash price to merge into. The Tokyo plan's "pay cash for night 5 at $380" has nowhere to live except `PlanStep.payload`. **Recommendation:** add a minimal `ExternalQuote` / `AwardAvailability` node with provenance (`source_tool`, `fetched_at`) so tool results compose into the world model as the architecture claims. Fixture-based is fine; the node just needs to exist. Owner: Michael + Alan.

### I4. "Business class" demo beat has no schema support

The deliverables' Phase 3 includes a second re-plan: "what if I want business class instead?" That implies cabin class and award availability, which the schema does not model. **Recommendation (product call):** either cut the business-class beat from the demo and keep the balance-change re-plan as the single hero moment, or add a minimal cabin/availability field to the award node from I3. Recommend cutting for the MVP unless I3 lands easily. Owner: Raq (demo script) + Michael.

### I5. Temporal model is inconsistent across world facts

`RedemptionOption` and `EARNS` have `valid_from` / `valid_until`; the base `TransferPartner.transfer_ratio_basis_points` does not. A base-ratio devaluation cannot be temporally represented, while a redemption change can. For an "honest benchmark / gold corpus at a point in time," pick one convention. **Recommendation:** add `valid_from` / `valid_until` to the base ratio (or document that base-ratio changes are modeled only via `TransferBonus` + `is_active`). Owner: Alan.

---

## Moderate / hygiene — fix in the DDL, no meeting time needed

- **Alliances claimed but absent.** The intro lists "alliances" as world-graph nodes; there is no Alliance node or edge. Cut the word from the intro for the MVP, or add a stub. (Recommend cut.)
- **Enum governance.** Many enums. Decide native Postgres `ENUM` vs `text` + `CHECK` vs lookup table. Given "additive-only, no renames," `text` + `CHECK` (or a lookup table) lets you add values without a type migration. Recommend `text` + `CHECK` for fields likely to grow (`mutation_type`, `step_type`, `option_type`).
- **`last_read_versions` (§5) vs `snapshot_value` (§2.5) overlap.** Two records of "what version did I read." Document which is authoritative for the re-plan decision (recommend: `DEPENDS_ON_STATE` is the persistent source of truth; `AgentRun.state.last_read_versions` is a transient crash-recovery checkpoint).
- **`updated_at` consistency.** Missing on several world/plan nodes (`SpendCategory`, `Merchant`, `RedemptionOption`, `TransferBonus`, `UserGoal`) and on edges the ingestion agent may touch. Add for anything mutable.
- **`is_active` vs `valid_from/until` mixed soft-delete conventions.** Pick one "is this fact in effect now" pattern and apply consistently, or document why both exist.
- **`Evaluation.graph_tier = 'plan'`** is a slight category error (it is cross-plan benchmark metadata, not part of a user's plan graph). Harmless; flag only.

---

## What to add to the repo, and how

| Add                      | Path                                                        | Owner          | How                                                                                                                       |
| ------------------------ | ----------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| This review              | `docs/meetings/schema-prepdoc-meeting1.md`                  | Raq            | committed directly (done)                                                                                                 |
| Locked schema v2         | `docs/architecture/schema-v2.md`                            | Alan           | committed (done)                                                                                                          |
| Canonical DDL            | `schema/schema.sql`                                         | Alan           | the single source of truth; generated from v2 after the lock. PR + 1 review                                               |
| Shared types             | `schema/types.ts` (+ Python `schema/types.py` or generated) | Alan           | one artifact both stacks import, so TS orchestrator and Python agents validate identically. PR                            |
| Seed fixture             | `schema/seed.sql` or `seed/`                                | Alan + Michael | 20 cards, top 50 MCCs, Chase UR + Amex MR partners (Hyatt/United/ANA), demo persona with stable IDs                       |
| Gold corpus (as-of date) | `benchmark/gold/`                                           | Michael        | ground-truth ratios/CPP frozen at a stated date; powers the hallucination metric                                          |
| ADR decision log         | `docs/adr/`                                                 | Raq            | lightweight ADRs; seeded with the schema-lock decisions. This is how post-lock changes get recorded (they go through Raq) |
| `.gitignore`             | repo root                                                   | Raq            | created (keeps `.env`, build output, secrets out)                                                                         |

The non-negotiable sequencing (matches v2 §7): Alan ships `schema.sql` + the basis-point utils + the seed fixture before anyone writes business logic. The `DEPENDS_ON_STATE` shape and the `node_type` strings are frozen at the lock; nothing downstream is safe until they are.

## Pre-filled resolution recommendations (so the meeting is ratify, not debate)

- B1: graph-write-service chokepoint, staleness in the same transaction, plus a `user_balances` trigger as backstop.
- B2: MVP staleness = node-valued only; edge-valued explicitly deferred and documented.
- B3: add `TransferPartner.lands_in_program_id FK → RewardProgram`.
- B4: unique `(user_id, program_id)` on `UserBalance`; update in place.
- B5: keep table-per-type; node-ref integrity is app-level + orphan check; align the "JSON columns" wording.
- I1: baselines write final Plan/PlanStep only, no `DEPENDS_ON_STATE`.
- I2: add `Plan.benchmark_query_id`.
- I3: add minimal `ExternalQuote` node with provenance.
- I4: cut the business-class beat unless I3 is trivial.
- I5: add `valid_from/until` to the base transfer ratio.

If the team agrees with these ten, the lock is a 30-minute ratification, not a redesign.
