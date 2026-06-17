# 0001 — Schema Lock (v2)

- **Status:** Proposed — ratify at the Day 1 meeting (June 17, 2026). Flip to Accepted with date + sign-offs below.
- **Owner:** Raq (Graph/Persistence)
- **Source:** [`schema-v2.md`](../architecture/schema-v2.md) · [`schema-prepdoc-meeting1.md`](../meetings/schema-prepdoc-meeting1.md)

## Context
Agents coordinate only by committing typed, schema-validated graph mutations. Dependency tracking, the verifier, and the redemption agent are all defined relative to the schema, so schema drift mid-sprint breaks the architecture and the demo. We lock the schema on Day 1 and allow only additive changes after.

## Decision

**Storage & types**
- Postgres, table-per-type physical layout, `node_type` discriminator (Decision 7), three tiers via `graph_tier`.
- Money in integer cents, ratios in integer basis points, no floats. `toBasisPoints()` / `fromBasisPoints()` ship Day 1 (Decision 3).
- OCC via integer `version` on mutable tables; serializable transactions on the verifier read-validate-commit path (Decision 5).

**The eight locked decisions from v2** (ratify; override only with cause)
1. MCC-mapped category hierarchy, seed top 50 (D1)
2. `TransferBonus` as its own node; no bonus fields on `TransferPartner` (D2)
3. Integer basis points everywhere (D3)
4. Rich `DEPENDS_ON` edge, no cycles, topo-sort at insert (D4)
5. OCC fail-fast + exponential backoff, max 3 retries (D5)
6. `node_type` discriminated-union runtime tag, exact class-name strings (D7)
7. `AgentRun.state` checkpoint blob with `last_read_versions` (D8)
8. Serializable verifier path

**Resolutions adopted from the v2 review** (proposed defaults; confirm in the meeting)
- **B1** Staleness propagation runs inside the single graph-write service, in the same transaction as the mutation; `user_balances` trigger as backstop.
- **B2** MVP staleness covers node-valued dependencies only (balance, status, bonus); edge-valued (earn rate, base ratio) explicitly deferred.
- **B3** Add `TransferPartner.lands_in_program_id → RewardProgram` so the redemption agent can traverse transfer → redeem.
- **B4** Unique `(user_id, program_id)` on `UserBalance`; WalletAgent updates in place (version++).
- **B5** Keep table-per-type; `DEPENDS_ON_STATE.target_node_id` is a polymorphic ref with app-level node-reference integrity + orphan sweep (not an FK).
- **I1** Baselines persist final `Plan`/`PlanStep` only; they do not use `DEPENDS_ON_STATE` (benchmark integrity).
- **I2** Add `Plan.benchmark_query_id` to join one query across architectures.
- **I3** Add a minimal `ExternalQuote` node (provenance: `source_tool`, `fetched_at`) so tool results merge as graph fragments.
- **I4** Cut the "business class" demo beat unless I3 is trivial; keep the balance-change re-plan as the single hero moment.
- **I5** Add `valid_from` / `valid_until` to the base transfer ratio for temporal consistency.

## Consequences
- Additive-only after lock. Renames, removals, retypes, or `Plan`/`PlanStep` property changes require a new ADR, Raq's sign-off, and an impact check against existing `DEPENDS_ON_STATE` edges.
- Downstream lanes are unblocked only once Alan ships `schema/schema.sql` + the basis-point utils + the seed fixture, and the `DEPENDS_ON_STATE` shape and `node_type` strings are frozen.
- Node-reference integrity is enforced in application code, so the verifier and the write service must both check it.

## Sign-off (complete at the meeting)
- [ ] Alan  [ ] Raq  [ ] Michael  [ ] Val
- Accepted on: __________
