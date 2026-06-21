# Canonical MVP Schema Artifacts

These files are the machine-usable schema artifacts for the MVP described in
[`docs/architecture/schemaMVP.md`](../docs/architecture/schemaMVP.md).

- `schema.sql` defines the Postgres tables, constraints, and indexes.
- `contracts/graph.schema.json` is the shared JSON Schema contract and source
  for generated dual-stack type artifacts.
- `generated/types.py` and `generated/types.ts` are generated from the shared
  contract.
- `types.py` imports generated Python constants and adds lightweight validators
  for node and edge payloads.

Regenerate contract artifacts after editing `contracts/graph.schema.json`:

```bash
python3 scripts/generate_schema_types.py
```

CI/test checks should run:

```bash
python3 scripts/generate_schema_types.py --check
```

Keep these artifacts aligned with the MVP doc. After schema lock, changes should
be additive unless the team records and approves a migration decision.

Plan lifecycle follows the locked v3.1 semantics even though storage is
polymorphic: `PlanQuery` and `PlanStep` attributes carry `plan_lineage_id` and
`revision_number`, and successful re-plans use `supersede_plan_step()` so the
old stale step is superseded only after its successor exists.

Operational support tables are part of the canonical schema:

- `users` maps app users to Clerk identities.
- `graph_mutations` is user-scoped audit/SSE replay, not a worker queue.
- `replan_jobs` is the async re-plan queue with leases.
- `idempotency_records` protects side-effecting writes such as `TransferPoints`.
- `agent_runs`, `benchmark_queries`, and `evaluations` store the ADR 0002 benchmark apparatus.

Use `transfer_points` for point transfers. It updates source/destination
balances, writes graph mutations, invalidates dependent plan steps, and enqueues
re-plan jobs in one transaction.

## Still Not Fully Implemented

- `seed.sql` fixture with stable IDs for the demo user, cards, programs,
  balances, goal, plan query, plan step, and dependency edges.
- Retry/backoff orchestration around optimistic update conflicts.
