# 02 — Graph write path (the single commit seam)

- **Status:** Draft
- **Owner:** Alan · **Lane:** Graph/Persistence
- **Linear:** RCG-10, RCG-11, RCG-13, RCG-14, RCG-58, RCG-59
- **Depends on:** RCG-7 (canonical schema artifact), RCG-9 (node/edge tables)
- **Related flows:** [Flow 1: Create a rewards plan](../project-overview.md), [Flow 2: Update state and automatically re-plan](../project-overview.md)

---

## Definition of ready (gate)

- [x] Goal and out-of-scope unambiguous
- [x] Acceptance criteria testable
- [x] Contracts linked
- [x] Touch list filled
- [x] Dependencies + Linear ids recorded
- [ ] Confirm `schema/schema.sql` exists (currently spec-only — see Open questions)

---

## Goal

One commit path that **every** agent calls to change the graph. It validates the mutation, enforces optimistic concurrency, serializes writes per user, appends to the audit/SSE log, deduplicates retries, and propagates staleness to dependent plan steps — all in a single transaction. This is the seam that makes the hard constraint ("coordination is typed graph mutations only") enforceable and keeps the graph from being corrupted by any single lane.

---

## Contracts touched (link — do not restate the schema)

- **Consumes:** node/edge tables, `version` columns, and conventions in [`../../docs/architecture/schema-final.md`](../../docs/architecture/schema-final.md) §0–§4; `user_balances`, `plan_steps`, `state_dependencies`.
- **Produces:** `graph_mutations` rows (audit + SSE replay) and `is_stale` flips on `plan_steps`; `idempotency_records` entries.
- **Invariants:** single write path; OCC on mutable tables; per-user serialization (ADR 0008); additive-only schema. See [`../architecture-context.md`](../architecture-context.md).

---

## Downstream behavior

- An agent submits a typed mutation plus the read-set it relied on: `{node_id: observed_version}` and an idempotency key.
- Commit succeeds only if every observed version is still current; otherwise it is rejected and retried with bounded backoff.
- On success: a `graph_mutations` row is appended and any `plan_steps` whose `state_dependencies` point at a changed node are marked stale — in the same transaction.

---

## Out of scope

- The redemption re-plan itself (spec 04) and the durable re-plan queue (`replan_jobs`, RCG-57).
- SSE delivery to the client (spec 03 — this spec only writes `graph_mutations`).
- Edge-valued staleness (earn-rate / ratio changes) — deferred per ADR 0003; MVP staleness is personal-state nodes only.
- The Layer 4 verified write path (stretch).

---

## Implementation plan

1. `commitMutation(userId, mutation, readSet, idempotencyKey)` entrypoint — the only public write API.
2. Acquire `pg_advisory_xact_lock(hashUser(userId))` (ADR 0008) so one user's writes serialize.
3. Idempotency: if `idempotencyKey` already in `idempotency_records`, return the prior result (no re-apply).
4. Validate: structural (type/required/enum), referential (FKs; polymorphic `state_dependencies` checked in app), domain (ratio > 0, multiplier ≥ 1, balance ≥ 0, one active row per natural key).
5. OCC: `UPDATE … SET …, version = version + 1 WHERE id = $id AND version = $expected`; 0 rows → `ConflictError`.
6. Append a `graph_mutations` row (agent, target type+id, old→new summary, resulting version, ts).
7. Staleness: mark dependent `plan_steps` stale by joining `state_dependencies` on the changed node (node-valued only).
8. Retry on `ConflictError`: max 3, exponential backoff with jitter (50→400ms); on exhaustion mark the step conflicted and surface to the orchestrator.

---

## Files / modules (expected touch list)

| Path | Change |
|---|---|
| `src/graph/write-path.*` | create — `commitMutation`, advisory lock, OCC, retry |
| `src/graph/validate.*` | create — structural/referential/domain validators |
| `src/graph/staleness.*` | create — dependency → stale propagation query |
| `schema/schema.sql` | modify — `graph_mutations`, `idempotency_records` if not present |
| `tests/graph/write-path.*` | create — see acceptance |

---

## Acceptance criteria

- [ ] A valid mutation commits, `version` increments, and a `graph_mutations` row is appended.
- [ ] A stale-version commit is rejected (no write), retried, and raises `ConflictError` after 3 attempts.
- [ ] Mutating a `user_balance` marks exactly the dependent `plan_steps` stale and no others.
- [ ] Two concurrent same-user mutations serialize (advisory lock); no lost update.
- [ ] Re-submitting the same `idempotencyKey` does not double-apply.
- [ ] Static check: no module writes graph state except through `write-path`.
- [ ] typecheck + tests pass.
- [ ] Hard constraint respected: no free-text inter-agent messages introduced.

---

## Verification

```bash
# test command TBD once stack is scaffolded, e.g.:
npm test -- graph/write-path
```

**Manual check:** load the seed persona → mutate the Chase balance → confirm the dependent plan steps flip to `stale` and a `graph_mutations` row appears.

---

## Open questions

| # | Question | Blocking? | Resolution |
|---|---|---|---|
| 1 | Is `schema/schema.sql` in the repo yet? | no | Treat `schema-final.md` v3.1 as the spec until DDL lands (RCG-7) |
