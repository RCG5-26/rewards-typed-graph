# 0004 — MVP Storage Uses Polymorphic Nodes and Edges

- **Status:** Proposed — accept in PR #2 with all-four lane sign-off.
- **Owner:** Alan (Graph/Persistence)
- **Related:** [0001 — Schema Lock](0001-schema-lock.md), [`schema-final.md`](../architecture/schema-final.md), [`schemaMVP.md`](../architecture/schemaMVP.md), [`schema/schema.sql`](../../schema/schema.sql)

## Context
The previously locked v3 schema in `docs/architecture/schema-final.md` uses a table-per-type physical layout: separate tables for users, cards, programs, balances, plans, plan steps, and typed edge tables.

The implementation in PR #2 uses the pared-down MVP storage shape described in `docs/architecture/schemaMVP.md` and implemented in `schema/schema.sql`: one polymorphic `nodes` table and one polymorphic `edges` table, with type-specific payloads in JSONB `attributes`.

That is an intentional physical-storage substitution, not a small migration detail. It changes the database contract that the graph, orchestrator, redemption, and frontend lanes build against, so it needs an ADR and explicit lane sign-off.

This ADR does **not** replace the v3.1 plan lifecycle / re-plan semantics. PR #2 keeps lineage and revision behavior: plan revisions share `plan_lineage_id`, successful re-plans create a successor revision, the prior stale step moves to `superseded` only after the successor exists, and failed re-plans leave the source step `stale`.

## Decision
For the MVP implementation, use polymorphic typed-graph storage instead of the v3 table-per-type physical layout:

- `nodes` stores all node types with `type`, `tier`, `user_id`, `slug`, `attributes`, and `version`.
- `edges` stores all edge types with `type`, `source_id`, `target_id`, `attributes`, and `version`.
- `schema/contracts/graph.schema.json` is the canonical schema contract for node/edge enums, required attributes, attribute types, and source/target edge rules.
- `schema/generated/types.py` and `schema/generated/types.ts` are generated from that contract so the Python and TypeScript stacks do not hand-maintain separate schemas.
- `schema/types.py` imports generated Python constants and layers lightweight validation helpers on top.
- `schema/mutations.py` is the write path for schema-validated graph mutations.
- `schema/schema.sql` is the canonical DDL for the MVP database.
- `PlanQuery` and `PlanStep` attributes carry v3.1-compatible lifecycle fields: `plan_lineage_id`, `revision_number`, and step supersession links.
- `supersede_plan_step()` creates the successor `PlanStep` and marks the stale source step `superseded` atomically.

The MVP keeps the architectural core that matters for the demo:

- typed graph mutations instead of free-text inter-agent messages;
- Postgres-only persistence;
- JSONB payloads for type-specific attributes;
- version columns for optimistic concurrency;
- `DEPENDS_ON` edges for plan-step dependency tracking;
- stale-plan detection from observed dependency versions;
- write-path invalidation followed by successor revision creation for re-plans;
- append-only mutation logging for audit/sidebar use.

## Why This Schema
The polymorphic `nodes`/`edges` model is smaller to implement and easier to evolve during the MVP sprint. It lets the team add node and edge attributes in the shared Python validator without coordinating table migrations for every type-specific field.

It also matches the current implementation and tests: the DDL, JSON Schema contract, generated Python/TypeScript types, mutation service, staleness view, lifecycle/supersession function, optimistic update functions, and Postgres integration script all assume the polymorphic model.

## Consequences
- `docs/architecture/schema-final.md` remains authoritative for plan lifecycle semantics, but not for the MVP physical table layout.
- `docs/architecture/schemaMVP.md`, `schema/schema.sql`, and `schema/contracts/graph.schema.json` become the MVP schema contract.
- Downstream lanes should depend on the `nodes`/`edges` contract unless a later ADR replaces this decision.
- Python and TypeScript type artifacts are generated from the shared contract; hand-maintained type forks are not canonical.
- Table-per-type benefits are deferred: stronger per-table FK modeling, narrower table schemas, and more conventional relational shape.
- Application/schema validators carry more responsibility for type-specific attributes and polymorphic referential rules.
- Re-plan consumers should use `supersede_plan_step`, not update stale steps in place.
- Future schema changes remain additive-only unless recorded in a new ADR.

## Sign-off
This ADR intentionally changes the v3/v3.1 storage direction while preserving the v3.1 plan lifecycle, so acceptance requires all four lanes.

- [ ] Alan — Graph/Persistence
- [ ] Raq — Orchestrator/Lead
- [ ] Michael — Redemption/Eval
- [ ] Val — Frontend/Demo

- Accepted on: __________
