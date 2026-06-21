# Alan — Person A · Graph / Persistence

**Lane:** graph substrate (world / personal / plan), Postgres schema, mutation atomicity, dependency tracking, optimistic concurrency. **You are the critical path: everyone is blocked until the schema is locked and the mutation layer works.**

Update Today / Next / Blockers daily. Mirror your one-liner into the STATUS.md grid before standup.

## Today
- Build the postgres database and deploy it.  Deployment options are up to the discretion of implementer (RCG-9)
- Align PR #2 plan lifecycle with v3.1 lineage/revision semantics.
- Add v3.1 operational tables/write paths flagged by PR #2 review.
- Align PR #2 operational table/column names with v3.1 vocabulary.
- Restore canonical schema artifacts to v3.1 table-per-type and preserve the polymorphic implementation only as an experimental path.
- Add direct-successor validation to `promote_replan_job_success`.
- Enforce `max_attempts` when claiming `replan_jobs`.
- Reject duplicate `TransferPoints` calls while an idempotency record is still `in_progress`.
- Replace canonical `TransferPoints` idempotency select-then-insert claim with an upsert claim.
- Complete RCG-10 canonical mutation layer for plan, plan-step, dependency, and transfer writes.
- Remove residual v3.1 DDL drift around plan-step staleness and direct balance-update invalidation.

## Next
- Lock the seed fixture with stable IDs (RCG-8).
- Wire redemption re-plan code to canonical v3.1 `plans` / `plan_steps` promotion semantics.
- Add recursive traversal/query helpers (RCG-12).

## Blocked on
- nothing

---

## Schema references

- **Current spec:** [`schema-final.md`](../docs/architecture/schema-final.md) v3.1
- **Canonical DDL:** [`schema/schema.sql`](../schema/schema.sql)
- Historical: [`schema-v2.md`](../docs/architecture/schema-v2.md), [ADR 0001](../docs/adr/0001-schema-lock.md)

---

## My tickets

| ID | Task | Phase | Done when |
|---|---|---|---|
| RCG-6 | Draft schema spec (node/edge types, attrs, versioning, validation) | Day 1 | reviewed; feeds the lock |
| RCG-5 | Schema lock (co-own with Raq) | Day 1 | all four lanes sign off |
| RCG-7 | Canonical schema artifact (DDL + TS/Python types) | Day 1 | committed; both stacks validate against it |
| RCG-8 | Seed fixture (5 cards, 3 programs, 240k pts), stable IDs | Day 1 | committed |
| RCG-9 | Postgres v3.1 table-per-type schema (version cols, FKs) | Day 1-5 | migrations run clean |
| RCG-10 | Mutation layer with schema validation (structural + referential + domain) | Day 1-5 | invalid mutations rejected before commit |
| RCG-11 | Optimistic-concurrency commit (read-set versions, reject, bounded retry) | Day 1-5 | stale-version commit rejected; retries bounded |
| RCG-12 | Recursive-CTE traversal + query helpers | Day 1-5 | multi-hop paths returned at MVP scale |
| RCG-13 | Dependency-edge tracking on plan nodes (~250 lines, plan nodes only) | Day 3-5 | stale detection works; no transitive propagation |
| RCG-14 | Append-only mutation/event log (powers sidebar + audit) | Day 1-5 | every commit logged; Val can subscribe |

## My open schema decisions to drive
A1 storage model · A3 transfer-partner-as-role + balance-as-node · B4 rational ratios · C2 concurrency version vs effective-dating · D2 observed-version placement · D3 staleness computed vs stored · E3 retry numbers · E4 mutation ownership matrix.

## My risk
Dependency-tracking scope creep. Hold the cut: plan nodes only, explicit reads only, no transitive propagation, 200-300 lines. Postgres serializable isolation handles concurrent writes at this scale; document the locking strategy so Michael knows the consistency model.
