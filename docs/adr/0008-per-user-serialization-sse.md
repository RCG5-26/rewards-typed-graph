# 0008 — Per-User Write Serialization and SSE

- **Status:** Accepted — June 18, 2026.
- **Owner:** Alan (graph-write); Val (SSE client)
- **Index:** [`context/decisions-log.md`](../../context/decisions-log.md) (D004, D017, D024, D025)
- **Related:** [0005 — Plan Lineage](0005-plan-lineage-replan-jobs.md), [`schema-final.md`](../architecture/schema-final.md) §5.1

## Context

The demo sidebar shows coordination events live via Server-Sent Events. Clients reconnect; judges compare REST state to the stream. Concurrent writes for the same user must not reorder mutation log inserts in ways that confuse replay.

## Decision

**`graph_mutations` role**

- Append-only **audit + SSE replay log** — not a work queue (work queue = `replan_jobs`).
- `event_id` (bigserial) monotonic within the table; used for `GET /mutations?after=`.

**MVP visibility**

- Every row requires `user_id NOT NULL`.
- User-scoped only: no global Layer 4 / world-seed events in the sidebar for MVP.
- SSE handler filters `WHERE user_id = authenticated_user`.
- Future: optional `visibility_scope = 'global'` when Layer 4 ships.

**Per-user serialization**
Before mutating graph state or inserting `graph_mutations`, graph-write acquires:

```sql
SELECT pg_advisory_xact_lock(hashtextextended('graph_write:' || $user_id::text, 0));
```

- Serializes commits **per user**, not globally.
- Guarantees `graph_mutations.id` commit order matches **that user's mutation stream**.
- Does **not** guarantee global cross-user ordering by `event_id`.

**Client recovery**

- REST graph endpoints are **source of truth** for application state.
- SSE is observability only; on gap or reconnect, client catches up via REST + `after=` cursor.

**Transport**

- Server-Sent Events from long-lived API process (ADR [0004](0004-runtime-topology.md)); no WebSocket server in MVP.

## Consequences

- Graph-write must hold advisory lock for the full transaction including mutation insert and replan enqueue.
- Unrelated users write concurrently without blocking each other.
- UI must not treat SSE as the only state channel — always reconcile with REST on load/reconnect.
- Layer 4 global mutation events deferred until visibility model is designed.
