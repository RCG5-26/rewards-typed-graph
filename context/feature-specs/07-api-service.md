# 07 — API service (HTTP surface for the demo shell)

- **Status:** Ready
- **Owner:** Raq (RCG-18)
- **Depends on:** RCG-15 (orchestrator, done) · RCG-14/59 (mutation REST+SSE routes, done) · RCG-21 (redemption writer, done) · RCG-8 (seed, done) · RCG-28/29 (hero flow green — in progress)
- **Related flows:** [`orchestration-flow.md`](../../docs/architecture/orchestration-flow.md) (happy path + hero moment); [`design-context.md`](../design-context.md) (API/event contracts)

---

## Goal

Stand up the one HTTP service the Next.js demo shell talks to. Today the backend is **library code, not a service**: `apps/api` has only `test`/`typecheck` scripts, the mutation routes are mounted only inside tests, and there is no `query → plan` route at all. This spec defines the **stable HTTP contract** (so Val can build the shell against it now, on mocks) and the service that serves it against live Postgres + the seed (so the demo runs on real data). This is the critical-path blocker for a real-data demo — target **Fri Jun 26**.

---

## User-visible behavior

- After Google sign-in (Clerk), the app loads the seeded Tokyo persona for that user.
- Typing a query returns a multi-step plan with per-step reasoning; mutations stream into the sidebar as the agents coordinate.
- Triggering a balance change re-plans automatically (Hero Moment 1); the sidebar shows the stale → re-plan sequence and the new revision renders.

---

## Out of scope

- Baseline + head-to-head + benchmark endpoints (eval lane; separate).
- Layer 4 ingestion/verifier endpoints.
- The shell UI itself (RCG-27) and sidebar UI (RCG-24/25) — this spec is the **server contract** they consume.
- Real card/award API integration (fixtures only for the demo).

---

## Design notes

The contract below is **stable regardless of implementation** — Val codes against these shapes immediately and only swaps the base URL when the service ships. Two implementation paths (DRI picks — see Open questions):

- **(A) TS-native:** implement a Postgres-backed `OrchestratorDeps` (`graphWrite`/`snapshotBuilder` over `pg`; redemption step via the planner). Highest fidelity to `apps/api/src/orchestrator`; most new code.
- **(B) Reuse the Python plan-builder (recommended for Fri):** the TS Hono service owns auth + CORS + mounts the **already-built** `/mutations` routes with a real `pg` client; `POST /plans` and `POST /balance-transfer` invoke the existing Python `create_plan_from_query` / `replan_after_balance_transfer` (the same code the hero test exercises) via a thin bridge. The redemption logic is already Python + Postgres, so this reaches real data fastest.

The mutation routes already exist (`createMutationRoutes(client)` → `GET /mutations`, `GET /mutations/stream`; auth via `c.get("userId")`). This spec **mounts** them; it does not rewrite them.

---

## API / events

All routes require auth. Base path `/` (versioning out of scope for the demo). JSON unless noted.

### Auth

Clerk session token from the Next app (`Authorization: Bearer <getToken()>`). Middleware verifies it (`@clerk/backend`), maps the Clerk `sub` → `users.clerk_id` → `user_id`, and sets `c.set("userId", …)`. Missing/invalid → `401`.

### `GET /session`
- **Purpose:** resolve the current user + ensure the persona is seeded (idempotent bootstrap clone on first login).
- **Response 200:** `{ "userId": "uuid", "clerkId": "user_...", "seeded": true }`

### `POST /plans`
- **Body:** `{ "query": "Best way to get to Tokyo in October?" }`
- **Response 202:** `{ "planId": "uuid", "planLineageId": "uuid", "status": "generating" }`
- Generation runs async; the shell opens `/mutations/stream` to watch steps land, then loads `GET /plans/:planId`. (Synchronous `200` with the full plan is an acceptable fallback — see Open questions.)
- **Errors:** 400 (empty query), 401.

### `GET /plans/:planId`
- **Response 200:**
```json
{
  "planId": "uuid",
  "planLineageId": "uuid",
  "revisionNumber": 1,
  "status": "generating | current | stale | superseded | failed",
  "query": "string",
  "summary": "string | null",
  "steps": [
    {
      "order": 1,
      "type": "card_assignment | spend_analysis | redemption_recommendation | transfer_recommendation",
      "summary": "string",
      "reasoning": "string",
      "status": "proposed | current | stale | superseded",
      "dependsOn": ["nodeId"]
    }
  ]
}
```
- **Errors:** 404 (unknown or not owned by `userId`), 401.

### `GET /plans/current?lineageId=<uuid>`
- **Purpose:** fetch the one `current` revision for a lineage (used after a re-plan to render revision 2). Same body as `GET /plans/:planId`.
- **Errors:** 404 (no current revision), 401.

### `POST /balance-transfer`  *(Hero Moment 1 trigger)*
- **Body:** `{ "sourceProgramId": "uuid", "destProgramId": "uuid", "amountPoints": 5000 }`
- **Effect:** `transfer_points` (debit/credit with OCC) → writes the corresponding `graph_mutations` rows → marks the current plan + steps `stale` → enqueues a `replan_jobs` row, all in one transaction; the re-plan promotes revision 2 to `current`.
- **Response 202:** `{ "planLineageId": "uuid", "staledPlanId": "uuid", "replanJobId": "uuid" }`
- The shell watches `/mutations/stream` for the stale → re-plan events, then loads `GET /plans/current?lineageId=`.
- **Errors:** 400 (same source/dest, non-positive amount, no active route), 409 (version conflict / insufficient balance), 401.

### `GET /mutations?after=<cursor>`  *(REST — source of truth)*
- **Response 200:** array of mutation events (catch-up since `cursor`; `cursor` = `event_id`). Already implemented.

### `GET /mutations/stream`  *(SSE — observability)*
- **Response:** `text/event-stream`; one frame per `graph_mutations` row, replayed in per-user `graph_write` commit order (the append-only log ordering guaranteed by `pg_advisory_xact_lock(hashtextextended('graph_write:'||user_id, 0))`): `id: <event_id>`, `event: graph_mutation`, `data: <event json>`. Resume via `Last-Event-ID` without reordering. Already implemented.
- **Event shape** (canonical: [`mutation-event.schema.json`](../../schema/contracts/mutation-event.schema.json)):
```json
{
  "event_id": "12345",
  "mutation_txn_id": "uuid",
  "user_id": "uuid",
  "plan_lineage_id": "uuid | null",
  "plan_id": "uuid | null",
  "agent_run_id": "uuid | null",
  "mutation_type": "TransferPoints | CreatePlanStep | …",
  "target_table": "user_balances",
  "target_node_id": "uuid | null",
  "summary": "Transfer 5000 pts AAdvantage → Hyatt",
  "before": { "balance": 12000, "version": 3 },
  "after": { "balance": 7000, "version": 4 },
  "committed_at": "2026-06-20T12:00:00Z"
}
```

### CORS
Allow the Next app origin (`CORS_ORIGIN`); allow headers `Authorization`, `Last-Event-ID`, `Content-Type`; expose SSE.

---

## Files / modules (expected touch list)

| Path | Change |
|---|---|
| `apps/api/src/server.ts` | create — Hono app: `pg` pool, Clerk auth middleware, CORS, mount mutation + plan routes, `@hono/node-server` `serve()` |
| `apps/api/src/auth/clerk.ts` | create — verify Clerk token → `userId`; ensure-seeded (bootstrap clone) |
| `apps/api/src/plans/routes.ts` | create — `POST /plans`, `GET /plans/:id`, `GET /plans/current`, `POST /balance-transfer` |
| `apps/api/src/plans/service.ts` | create — plan-builder bridge (option A TS deps, or option B Python `create_plan_from_query` / `replan_after_balance_transfer`) |
| `apps/api/package.json` | add `dev` + `start` scripts; deps `@hono/node-server`, `pg`, `@clerk/backend` |
| `.env.example` | add `DATABASE_URL`, `CLERK_SECRET_KEY`, `API_PORT`, `CORS_ORIGIN` |
| `fixtures/mock-plan.json`, `fixtures/mock-mutation-events.json` | create — filled samples matching these shapes, so Val builds on realistic mocks today |

_Agent: do not touch files outside this list unless the spec is updated first._

---

## Data & schema

- No schema changes. Reads/writes `plans`, `plan_steps`, `state_dependencies`, `user_balances`, `transfers_to`, `graph_mutations`, `replan_jobs` via the existing write service (`schema/mutations.py`) and mutation repository (`apps/api/src/mutations/repository.ts`).
- Seed: `scripts/load_seed.py fixtures/demo-seed.json`; persona cloned per Clerk user on first `GET /session`.

---

## Acceptance criteria

- [ ] `npm --prefix apps/api run dev` boots the API on `$API_PORT` against the docker-compose Postgres (`scripts/dev-db-setup.sh`).
- [ ] `GET /session` with a valid Clerk token returns `userId` and seeds the persona (idempotent on repeat).
- [ ] `POST /plans {"query": …}` → `202 {planId}`; within a few seconds `GET /plans/:planId` returns `status: "current"` with ≥1 step carrying `reasoning` + `dependsOn`.
- [ ] `GET /mutations/stream` emits `graph_mutation` events for that plan's writes; `GET /mutations?after=` replays them.
- [ ] `POST /balance-transfer` marks the prior plan `stale` and a new `current` revision appears; `GET /plans/current?lineageId=` returns revision 2.
- [ ] `401` without a token; `400` on empty query / bad cursor; `404` on unknown plan; CORS preflight from the Next origin passes.
- [ ] No invariant from `architecture-context.md` violated (typed mutations only; OCC respected).

---

## Verification

```bash
# 1. DB up + seed
bash scripts/dev-db-setup.sh && python3 scripts/load_seed.py fixtures/demo-seed.json
# 2. API up
npm --prefix apps/api run dev
# 3. contract smoke (TOKEN from the Next app / Clerk dev)
curl -s localhost:$API_PORT/session -H "Authorization: Bearer $TOKEN"
curl -s -XPOST localhost:$API_PORT/plans -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"query":"Best way to Tokyo in October?"}'
curl -s localhost:$API_PORT/plans/$PLAN_ID -H "Authorization: Bearer $TOKEN"
curl -N localhost:$API_PORT/mutations/stream -H "Authorization: Bearer $TOKEN"
```

**Manual check:** run the full demo flow end to end in the browser against this service.

---

## Open questions

| # | Question | Blocking? | Resolution |
|---|---|---|---|
| 1 | Implementation **A (TS-native deps)** vs **B (reuse Python plan-builder)** | no (contract is identical) | DRI (Raq) — recommend **B** for Fri |
| 2 | `POST /plans` **async (202 + stream)** vs **synchronous (200 + full plan)** | no | recommend async for the live-sidebar effect; sync acceptable if time-tight |
| 3 | Token transport: Bearer vs cookie | no | recommend Bearer via Clerk `getToken()` |

---

## Completion notes _(fill when done)_

- **Completed:** [YYYY-MM-DD]
- **PR / commit:** [link]
- **Deviations from spec:** [none / describe]
