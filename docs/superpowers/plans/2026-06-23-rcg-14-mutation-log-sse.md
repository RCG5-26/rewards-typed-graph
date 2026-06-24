# RCG-14 Mutation Log and SSE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish append-only mutation event delivery so every committed row can be replayed and Val can subscribe to a live per-user stream.

**Architecture:** Preserve `graph_mutations` as audit/SSE replay only. Add a minimal API route surface around the existing table: a REST catch-up endpoint and an SSE endpoint that both map rows to `schema/contracts/mutation-event.schema.json` without inventing a new event envelope.

**Tech Stack:** TypeScript Hono API scaffold, PostgreSQL `pg`, JSON Schema contract, existing `schema/schema.sql`.

---

**Branch:** `rcg-14-mutation-log-sse`

## Task 1: Add Event Mapping Contract Tests

**Files:**

- Create: `apps/api/src/mutations/events.ts`
- Create: `apps/api/src/mutations/events.test.ts`
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`

- [ ] **Step 1: Add minimal API test tooling**

Create `apps/api/package.json` with scripts:

```json
{
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "hono": "^4.4.0",
    "pg": "^8.12.0"
  },
  "devDependencies": {
    "@types/pg": "^8.11.6",
    "typescript": "^5.5.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Write mapper test**

Test that `toMutationEvent(row)` conforms to `schema/contracts/mutation-event.schema.json`, including all required fields and transformations: `id -> event_id`, string representations for bigint/UUID fields, and the canonical event fields `mutation_txn_id`, `user_id`, `plan_lineage_id`, `plan_id`, `agent_run_id`, `mutation_type`, `target_table`, `target_node_id`, `summary`, `before`, `after`, `committed_at`.

- [ ] **Step 3: Run focused test**

Run: `npm --prefix apps/api test -- events.test.ts`

Expected: failure until mapper exists.

- [ ] **Step 4: Implement mapper**

Implement `toMutationEvent(row)` with no field renames other than `id -> event_id`. Convert `bigint`, `number`, and decimal string IDs to string.

## Task 2: Add REST Replay Query

**Files:**

- Create: `apps/api/src/mutations/repository.ts`
- Create: `apps/api/src/mutations/repository.test.ts`

- [ ] **Step 1: Write repository SQL test**

With a fake `query(sql, params)` client, assert `listMutationEvents(client, userId, after)` executes:

```sql
SELECT id, mutation_txn_id, user_id, plan_lineage_id, plan_id, agent_run_id,
       mutation_type, target_table, target_node_id, summary, before, after,
       committed_at
  FROM graph_mutations
 WHERE user_id = $1
   AND id > $2
 ORDER BY id ASC
 LIMIT $3
```

- [ ] **Step 2: Run repository test**

Run: `npm --prefix apps/api test -- repository.test.ts`

Expected: failure until repository exists.

- [ ] **Step 3: Implement repository**

Use parameterized queries only. Default `after` to `0` and `limit` to `100`.

## Task 3: Add SSE and REST Routes

**Files:**

- Create: `apps/api/src/mutations/routes.ts`
- Create: `apps/api/src/mutations/routes.test.ts`

**Endpoints:**

- **REST:** `GET /mutations?after=<cursor>&limit=<count>` returns a JSON array.
- **SSE:** `GET /mutations/stream` returns `text/event-stream`.

- [ ] **Step 1: Write route tests**

Test `GET /mutations?after=123` returns JSON events, and `GET /mutations/stream` returns `text/event-stream` frames whose `id:` is `event_id`.

- [ ] **Step 2: Implement auth seam**

Define a small `getAuthenticatedUserId(c)` helper that reads `c.get("userId")`. Clerk verification can replace that seam in the orchestrator branch without changing route logic.

- [ ] **Step 3: Implement REST route**

Call `listMutationEvents(pool, userId, after)` and return the mapped events.

- [ ] **Step 4: Implement SSE route**

On connect, parse `Last-Event-ID`, replay rows with `id > cursor`, then poll every second for new rows. Send frames:

```text
id: <event_id>
event: graph_mutation
data: <JSON event>

```

Stop polling when the request aborts.

## Task 4: Validate Against JSON Schema

**Files:**

- Modify: `apps/api/src/mutations/events.test.ts`
- Modify: `apps/api/package.json`

- [ ] **Step 1: Add validator dependency**

Add `ajv` to `devDependencies`.

- [ ] **Step 2: Add schema validation test**

Load `schema/contracts/mutation-event.schema.json` and assert a mapped fixture event validates.

- [ ] **Step 3: Run API checks**

Run: `npm --prefix apps/api test`

Expected: all API tests pass.

Run: `npm --prefix apps/api run typecheck`

Expected: TypeScript passes.

## Task 5: Update Tracking

**Files:**

- Modify: `context/progress-tracker.md`
- Modify: `tracking/alan-graph.md`

- [ ] **Step 1: Record RCG-14 completion**

Add a completed line only after event mapping, REST replay, SSE stream, and schema validation tests exist.

- [ ] **Step 2: Final verification**

Run: `python -m unittest discover -s tests`

Expected: all non-live schema tests pass.

Run: `npm --prefix apps/api test`

Expected: all API tests pass.
