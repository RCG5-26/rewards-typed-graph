# 0004 — Proposed MVP Polymorphic Storage

- **Status:** Superseded — not accepted as canonical. Polymorphic storage is preserved only under `schema/experimental/polymorphic/`; v3.1 table-per-type remains canonical.
- **Owner:** Alan (Graph/Persistence)
- **Related:** [0001 — Schema Lock](0001-schema-lock.md), [`schema-final.md`](../architecture/schema-final.md), [`schemaMVP.md`](../architecture/schemaMVP.md), [`schema/schema.sql`](../../schema/schema.sql)

## Context
The previously locked v3 schema in `docs/architecture/schema-final.md` uses a table-per-type physical layout: separate tables for users, cards, programs, balances, plans, plan steps, and typed edge tables.

The implementation in PR #2 originally used the pared-down MVP storage shape described in `docs/architecture/schemaMVP.md`: one polymorphic `nodes` table and one polymorphic `edges` table, with type-specific payloads in JSONB `attributes`.

That is an intentional physical-storage substitution, not a small migration detail. It changes the database contract that the graph, orchestrator, redemption, and frontend lanes build against, so it needs an ADR and explicit lane sign-off.

This ADR does **not** replace the v3.1 plan lifecycle / re-plan semantics. PR #2 keeps lineage and revision behavior: plan revisions share `plan_lineage_id`, successful re-plans create a successor revision, the prior stale step moves to `superseded` only after the successor exists, and failed re-plans leave the source step `stale`.

## Decision
Do **not** use polymorphic typed-graph storage as the canonical MVP implementation. Keep v3.1 table-per-type storage as the default in `schema/schema.sql`, `schema/contracts/`, and generated shared types.

The polymorphic implementation remains available only as an explicit experimental path:

- `schema/experimental/polymorphic/schema.sql`
- `schema/experimental/polymorphic/graph.schema.json`
- `schema/experimental/polymorphic/types.py`
- `schema/experimental/polymorphic/mutations.py`

The experimental path retains these characteristics:

- `nodes` stores all node types with `type`, `tier`, `user_id`, `slug`, `attributes`, and `version`.
- `edges` stores all edge types with `type`, `source_id`, `target_id`, `attributes`, and `version`.
- `schema/experimental/polymorphic/graph.schema.json` is its local schema contract for node/edge enums, required attributes, attribute types, and source/target edge rules.
- `schema/experimental/polymorphic/types.py` layers lightweight validation helpers on top of the preserved experimental constants.
- `schema/experimental/polymorphic/mutations.py` is the optional write path for schema-validated polymorphic graph mutations.
- `schema/experimental/polymorphic/schema.sql` is the optional DDL for the experimental database.
- `PlanQuery` and `PlanStep` attributes carry v3.1-compatible lifecycle fields: `plan_lineage_id`, `revision_number`, and step supersession links.
- `supersede_plan_step()` creates the successor `PlanStep` and marks the stale source step `superseded` atomically.
- `users.clerk_id` maps Clerk identities and scopes graph data, SSE replay, jobs, and benchmark rows.
- `graph_mutations` is the user-scoped append-only audit/SSE replay log; it carries `mutation_txn_id` and is not a work queue.
- `replan_jobs` is the async work queue for stale-plan re-planning, with v3.1 names (`source_plan_id`, `trigger_mutation_txn_id`, `available_at`, `locked_by`, `result_plan_id`) and `FOR UPDATE SKIP LOCKED` claims.
- `idempotency_records` protects side-effecting writes such as `TransferPoints` from duplicate retries using v3.1 names (`operation_type`, `mutation_txn_id`, `result_reference`).
- `agent_runs`, `benchmark_queries`, and `evaluations` preserve the ADR 0002 benchmark apparatus.

The MVP keeps the architectural core that matters for the demo:

- typed graph mutations instead of free-text inter-agent messages;
- Postgres-only persistence;
- JSONB payloads for type-specific attributes;
- version columns for optimistic concurrency;
- `DEPENDS_ON` edges for plan-step dependency tracking;
- stale-plan detection from observed dependency versions;
- write-path invalidation followed by successor revision creation for re-plans;
- append-only graph mutation logging for audit/sidebar use;
- atomic `TransferPoints` writes that update balances, log events, invalidate dependent plan steps, and enqueue re-plan jobs in one transaction.

## Why This Schema
The polymorphic `nodes`/`edges` model is smaller to implement and easier to evolve during the MVP sprint. It lets the team add node and edge attributes in the shared Python validator without coordinating table migrations for every type-specific field.

It also matches the preserved experimental implementation and tests: the DDL, JSON Schema contract, mutation service, staleness view, lifecycle/supersession function, `TransferPoints` function, operational queue/idempotency/eval tables, and optimistic update functions all assume the polymorphic model.

## Consequences
- `docs/architecture/schema-final.md`, `schema/schema.sql`, and `schema/contracts/graph.schema.json` remain authoritative for the MVP physical table layout and lifecycle semantics.
- `docs/architecture/schemaMVP.md` is historical/experimental context.
- Downstream lanes should depend on v3.1 table-per-type storage unless a later accepted ADR replaces this decision.
- Python and TypeScript type artifacts are generated from the v3.1 shared contract; hand-maintained type forks are not canonical.
- The experimental path carries more responsibility in Python validators for type-specific attributes and polymorphic referential rules.
- Experimental re-plan consumers should use `supersede_plan_step`, not update stale steps in place.
- Canonical frontend/sidebar and worker consumers should use the v3.1 `graph_mutations` and `replan_jobs` tables in `schema/schema.sql`.
- The experimental operational tables intentionally use v3.1 field names even though plan and step rows live in polymorphic `nodes`.
- Experimental wallet transfer code should use its local `transfer_points` with an idempotency key; canonical wallet code should use the v3.1 `transfer_points` function in `schema/schema.sql`.
- Future schema changes remain additive-only unless recorded in a new ADR.

## Sign-off
No all-lane sign-off was received for replacing v3.1. The proposal is therefore superseded by the canonical v3.1 path.
