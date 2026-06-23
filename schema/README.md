# Canonical v3.1 Schema Artifacts

These files are the machine-usable schema artifacts for the MVP described in
[`docs/architecture/schema-final.md`](../docs/architecture/schema-final.md).

- `schema.sql` defines the canonical v3.1 table-per-type Postgres tables,
  constraints, indexes, and write-path functions.
- `contracts/graph.schema.json` is the shared JSON Schema contract and source
  for generated dual-stack type artifacts.
- `generated/types.py` and `generated/types.ts` are generated from the shared
  contract.
- `types.py` imports generated Python constants and adds lightweight validators
  for node and edge payloads.
- `../fixtures/demo-seed.json` is the RCG-8 demo seed fixture with stable IDs
  for the five-card / three-program / 240k-point bootstrap persona.
- `../scripts/load_seed.py` loads that fixture into a database that already has
  `schema.sql` applied.

Regenerate contract artifacts after editing `contracts/graph.schema.json`:

```bash
python3 scripts/generate_schema_types.py
```

CI/test checks should run:

```bash
python3 scripts/generate_schema_types.py --check
```

Keep these artifacts aligned with schema-final v3.1. After schema lock, changes
should be additive unless the team records and approves a migration decision.

The old polymorphic MVP implementation is preserved for experiments only:

- `experimental/polymorphic/schema.sql`
- `experimental/polymorphic/graph.schema.json`
- `experimental/polymorphic/types.py`
- `experimental/polymorphic/mutations.py`

Do not build app lanes against the experimental path unless a new accepted ADR
explicitly changes the canonical storage model.

Plan lifecycle follows the locked v3.1 semantics: `plans.status` is the source
of truth for actionability, successful re-plans create successor revisions, and
failed re-plans leave the source revision `stale`.

Operational support tables are part of the canonical schema:

- `users` maps app users to Clerk identities.
- `graph_mutations` is user-scoped audit/SSE replay, not a worker queue.
- `replan_jobs` is the async re-plan queue with leases.
- `idempotency_records` protects side-effecting writes such as `TransferPoints`.
- `agent_runs`, `benchmark_queries`, and `evaluations` store the ADR 0002 benchmark apparatus.

Use `transfer_points` for point transfers. It updates source/destination
balances, writes graph mutations, invalidates dependent plan revisions/steps,
and enqueues re-plan jobs in one transaction.

Direct `user_balances` updates are protected by a trigger backstop that marks
dependent current plans and plan steps stale without enqueuing re-plan jobs.

`schema.mutations.V31GraphWriteService` is the current schema-lane graph-write
adapter for RCG-10. It validates plan creation, plan-step creation, state
dependency recording, and `TransferPoints` before executing write SQL.

## Demo Seed

Load the RCG-8 demo seed after applying `schema.sql`:

```bash
python3 scripts/load_seed.py fixtures/demo-seed.json
```

The fixture is idempotent by stable UUID primary keys. It includes the hero demo
user, five held cards, three reward programs, three balances totaling 240,000
points, the Chase-to-Hyatt transfer route, and the Tokyo goal used by the hero
flow tests.

## Still Not Fully Implemented

- Broader world catalog seed coverage from schema-final §11: about 20 cards and
  top MCC categories. RCG-8 locks the demo bootstrap slice only.
- Retry/backoff orchestration around optimistic update conflicts.
