# 0001 — Schema Lock

- **Status:** Accepted — June 18, 2026 (v3.1 ratified at architecture closeout).
- **Owner:** Raq (Graph/Persistence lead); Alan (DDL author)
- **Index:** [`context/decisions-log.md`](../../context/decisions-log.md) (D027)
- **Canonical spec:** [`schema-final.md` v3.1](../architecture/schema-final.md) · [`schema/schema.sql`](../../schema/schema.sql)
- **Historical source:** [`schema-v2.md`](../architecture/schema-v2.md) · [`schema-prepdoc-meeting1.md`](../meetings/schema-prepdoc-meeting1.md)

## Context

Agents coordinate only by committing typed, schema-validated graph mutations. Dependency tracking, the verifier, and the redemption agent are all defined relative to the schema, so schema drift mid-sprint breaks the architecture and the demo. We lock the schema on Day 1 and allow only additive changes after.

The v2 meeting doc established eight locked decisions and B1–B5 / I1–I5 resolutions. Architecture closeout (D019–D027) refined the plan model, write-path infrastructure, and hosted-runtime assumptions without changing the table-per-type core.

## Decision

**Storage & types (unchanged from v2 lock)**
- PostgreSQL, **table-per-type** physical layout, `node_type` discriminator, three tiers via `graph_tier`.
- Money in integer cents; ratios in integer basis points; no floats. `toBasisPoints()` / `fromBasisPoints()` ship Day 1.
- OCC via integer `version` on mutable tables.

**The eight locked decisions from v2** (ratified; override only with cause + new ADR)
1. MCC-mapped category hierarchy, seed top 50
2. `TransferBonus` as its own node; no bonus fields on `TransferPartner`
3. Integer basis points everywhere
4. Rich `state_dependencies` edge, no cycles, topo-sort at insert
5. OCC fail-fast + exponential backoff, max 3 retries
6. `node_type` discriminated-union runtime tag, exact class-name strings
7. `agent_runs.state` checkpoint blob with `last_read_versions`
8. Serializable verifier path (Layer 4 stretch)

**v2 review resolutions (B1–B5, I1–I5)** — ratified as written in the v2 prep doc.

**v3.1 closeout additions** (see [schema-final v3.1](../architecture/schema-final.md) §changelog)
- `plan_lineage_id` + revision model; `plans.status` lifecycle; no `is_current` / `is_stale` booleans (ADR [0005](0005-plan-lineage-replan-jobs.md)).
- `graph_mutations` (audit + SSE replay), `replan_jobs` (durable queue with leases), `idempotency_records` (scoped dedup).
- Per-user `pg_advisory_xact_lock` before graph-write + mutation insert (ADR [0008](0008-per-user-serialization-sse.md)).
- Hosted demo uses managed PostgreSQL; eval never deployed (ADR [0004](0004-runtime-topology.md)).

## Consequences

- **Additive-only after lock.** Renames, removals, retypes, or breaking property changes require a new ADR, Raq's sign-off, and an impact check against existing `state_dependencies`.
- **Canonical artifacts:** `docs/architecture/schema-final.md` (v3.1) + `schema/schema.sql`. JSON Schema contracts in `schema/contracts/` follow in Phase A3 (ADR [0007](0007-contract-ownership-codegen.md)).
- Node-reference integrity on polymorphic refs is enforced in application code (graph-write + graph-query).
- Generic `nodes`/`edges` MVP layouts are **out of scope** for the locked schema.

## Sign-off

- [x] Alan  [x] Raq  [x] Michael  [x] Val
- Accepted on: **2026-06-18**
