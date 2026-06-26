# 07 — API service (HTTP surface for the demo shell)

- **Status:** Done
- **Owner:** Raq (RCG-18)
- **Depends on:** RCG-15 (orchestrator, done) · RCG-14/59 (mutation REST+SSE routes, done) · RCG-21 (redemption writer, done) · RCG-8 (seed, done) · RCG-28/29 (hero flow green — done)
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
- **(B) Reuse the Python plan-builder (chosen — see §Implementation decision):** the TS Hono service owns auth + CORS + mounts the **already-built** `/mutations` routes with a real `pg` client; `POST /plans` and `POST /balance-transfer` invoke the existing Python `create_plan_from_query` / `replan_after_balance_transfer` (the same code the hero test exercises) via a thin bridge. The redemption logic is already Python + Postgres, so this reaches real data fastest.

The mutation routes already exist (`createMutationRoutes(client)` → `GET /mutations`, `GET /mutations/stream`; auth via `c.get("userId")`). This spec **mounts** them; it does not rewrite them.

### Implementation decision (chosen 2026-06-24)

**Option B**, via a **`psql`-subprocess Python bridge**, behind a typed `PlanService` port:

- **Why a subprocess, not a Python DB driver:** `psycopg` is **not installed**; the verified hero seam (`tests/integration/hero_flow.py` + `test_hero_moment.py`) talks to Postgres through a tiny `psql`-subprocess connection adapter. The bridge reuses that exact proven path — reliability over purity for the one-day demo. Do **not** swap in `psycopg` mid-sprint.
- **`PlanService` port** (`apps/api/src/plans/service.ts`): the Hono plan routes depend on this interface, so they are unit-tested with an in-memory fake (no DB, like the orchestrator + mutation routes). Production impl `BridgePlanService` spawns `apps/api/bridge/hero_bridge.py` (one process per request) and parses a `{ ok, data | error }` JSON envelope.
- **One projection source of truth:** the Python bridge owns _both_ reads and writes and returns the view model below, so the DB→view projection lives in one place. TS only shells out and maps `error.code` → HTTP status.
- **Known debt:** the bridge imports the seam from `tests/integration/`. Post-demo, graduate `hero_flow.py` + `redemption_graph_writer.py` into a non-test package (e.g. `agents/hero/`); the bridge import is the only line to change.

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
- **Response 200 (synchronous — resolved for Jun 25 demo):** the full plan body (same shape as `GET /plans/:planId` below), already `status: "current"`. The bridge builds + commits the plan in-request, so there is no `generating` window to poll.
- The shell still opens `/mutations/stream` to render the per-step writes as they land, but renders the plan from this response directly.
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
      "dependsOn": ["nodeId"],
      "dependencies": [
        {
          "id": "nodeId",
          "kind": "UserBalance",
          "table": "user_balances",
          "slug": "program:chase_ur",
          "label": "Chase Ultimate Rewards",
          "programId": "uuid | null"
        }
      ]
    }
  ],
  "graph": {
    "nodes": [
      {
        "id": "program:chase_ur",
        "kind": "program | redemption | plan",
        "slug": "program:chase_ur",
        "label": "Chase Ultimate Rewards",
        "programId": "uuid | null"
      }
    ],
    "edges": [
      {
        "id": "transfer:chase_ur:hyatt",
        "from": "program:chase_ur",
        "to": "program:hyatt",
        "kind": "transfer | redeem"
      }
    ]
  }
}
```

- `dependsOn` stays as raw dependency ids for backward compatibility. `dependencies` and `graph` are the display/traversal contract so the database-less web tier never resolves persona-cloned UUIDs through seed-only lookup tables.
- **Errors:** 404 (unknown or not owned by `userId`), 401.

### `GET /plans/current?lineageId=<uuid>`

- **Purpose:** fetch the one `current` revision for a lineage (used after a re-plan to render revision 2). Same body as `GET /plans/:planId`.
- **Errors:** 404 (no current revision), 401.

### `POST /balance-transfer` _(Hero Moment 1 trigger)_

- **Body:** `{ "sourceProgramId": "uuid", "destProgramId": "uuid", "amountPoints": 5000, "idempotencyKey": "optional-client-key" }`
- **Program → balance resolution:** the bridge resolves each `programId` to the caller's `user_balances` row (id + current `version`) before mutating, so the client passes stable program ids, not balance ids. Unknown program for the user → `404`.
- **Effect (synchronous — resolved for Jun 25 demo):** in one request the bridge runs the verified `replan_after_balance_transfer` seam: `transfer_points` (debit/credit with OCC) → writes `graph_mutations` rows → marks the current plan + dependent steps `stale` → claims + runs the `replan_jobs` row → promotes revision 2 to `current` and the prior revision to `superseded`. No background worker; the re-plan completes before the response returns.
- **Response 200:** `{ "planLineageId": "uuid", "staledPlanId": "uuid", "replanJobId": "uuid", "currentPlan": { …full plan body, revision 2, status "current"… } }`
- **Idempotency:** optional `idempotencyKey` lets the shell replay a dropped response safely. When omitted, the bridge derives a stable key from the transfer body so network retries with the same payload dedupe.
- The shell watches `/mutations/stream` for the stale → re-plan events for the live effect, but renders revision 2 from `currentPlan` directly.
- **Errors:** 400 (same source/dest, non-positive amount, no active route), 409 (version conflict / insufficient balance), 404 (unknown program for user), 401.

### `POST /demo/reset` _(presenter safety net)_

- **Purpose:** restore the caller's persona to its pristine seeded state between demo run-throughs, so Hero Moment 1 can be re-triggered without a DB rebuild. Idempotent.
- **Effect:** re-clones the seed persona for the caller (balances, and clears the caller's plans / plan_steps / replan_jobs / graph_mutations for the run) so a fresh `POST /plans` + `POST /balance-transfer` reproduces the hero flow.
- **Response 200:** same body as `GET /session` (`{ "userId", "clerkId", "seeded": true }`).
- **Errors:** 401.

### `GET /mutations?after=<cursor>` _(REST — source of truth)_

- **Response 200:** array of mutation events (catch-up since `cursor`; `cursor` = `event_id`). Already implemented.

### `GET /mutations/stream` _(SSE — observability)_

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

> **Mock vs live `mutation_type`:** the `mutation_type` strings in `fixtures/mock-mutation-events.json` are a _narrative_ of the hero flow chosen for UI legibility. The live values emitted by the write service (e.g. `TransferPoints`, `MarkStale`, and the `CreatePlan*` writes) are the source of truth; the canonical set is `mutation-event.schema.json`. UI must key off the schema, not the mock's exact strings, and tolerate types it doesn't recognize.

### CORS

Allow the Next app origin (`CORS_ORIGIN`); allow headers `Authorization`, `Last-Event-ID`, `Content-Type`; expose SSE.

---

## Files / modules (expected touch list)

| Path                                                            | Change                                                                                                                                                     |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/server.ts`                                        | create — Hono app: `pg` pool, Clerk auth middleware (+ `AUTH_DEV_USER_ID` local bypass), CORS, mount mutation + plan routes, `@hono/node-server` `serve()` |
| `apps/api/src/http/auth.ts`                                     | create — `getAuthenticatedUserId(c)` shared helper (401 if unset)                                                                                          |
| `apps/api/src/plans/types.ts`                                   | create — `PlanView` / `PlanStepView` / `SessionView` view-model + input/result types                                                                       |
| `apps/api/src/plans/service.ts`                                 | create — `PlanService` port + `PlanServiceError` (`validation`/`not_found`/`conflict`)                                                                     |
| `apps/api/src/plans/routes.ts`                                  | create — `GET /session`, `POST /plans`, `GET /plans/:id`, `GET /plans/current`, `POST /balance-transfer`, `POST /demo/reset` against `PlanService`         |
| `apps/api/src/plans/bridge-service.ts`                          | create — `BridgePlanService` (option B): spawn `bridge/hero_bridge.py`, parse `{ok,data\|error}`, map `error.code` → `PlanServiceError`                    |
| `apps/api/src/plans/routes.test.ts`                             | create — vitest with in-memory fake `PlanService` (no DB)                                                                                                  |
| `apps/api/bridge/hero_bridge.py`                                | create — `psql`-subprocess CLI; reuses `tests/integration` hero seam; one projection of the `PlanView` for reads + writes                                  |
| `apps/api/package.json`                                         | add `dev` + `start` scripts; deps `@hono/node-server`, `@clerk/backend`; devDep `tsx`                                                                      |
| `.env.example`                                                  | add `DATABASE_URL`, `CLERK_SECRET_KEY`, `API_PORT`, `CORS_ORIGIN`, `AUTH_DEV_USER_ID`                                                                      |
| `fixtures/mock-plan.json`, `fixtures/mock-mutation-events.json` | done — filled samples matching these shapes, so Val builds on realistic mocks today                                                                        |

_Agent: do not touch files outside this list unless the spec is updated first._

---

## Data & schema

- No schema changes. **Plan + transfer** mutations go through the existing write service (`schema/mutations.py`, via `create_plan_from_query` / `replan_after_balance_transfer`) and are surfaced through the mutation repository (`apps/api/src/mutations/repository.ts`) — covering `plans`, `plan_steps`, `state_dependencies`, `user_balances`, `transfers_to`, `graph_mutations`, `replan_jobs`.
- **Accepted demo-debt (Option B):** persona **bootstrap / seed-clone / `demo/reset`** bookkeeping is written as raw SQL through the `psql`-subprocess seam (each wrapped in one `BEGIN…COMMIT`), not through `graph-write`; and the bridge process is given the Postgres connection vars (`DATABASE_URL` / `PG*`) because under Option B it _is_ the DB-access layer. Non-DB secrets (e.g. `CLERK_SECRET_KEY`) are withheld from the subprocess via an env allowlist (`apps/api/src/plans/bridge-service.ts`). Post-demo, fold these writes into `graph-write` when the seam graduates out of `tests/integration/` (see Implementation decision above).
- Seed: `scripts/load_seed.py fixtures/demo-seed.json`; persona cloned per Clerk user on first `GET /session`.

---

## Acceptance criteria

- [ ] `npm --prefix apps/api run dev` boots the API on `$API_PORT` against the docker-compose Postgres (`scripts/dev-db-setup.sh`).
- [ ] `GET /session` with a valid Clerk token returns `userId` and seeds the persona (idempotent on repeat).
- [ ] `POST /plans {"query": …}` → `200` with `status: "current"` and ≥1 step carrying `reasoning`, `dependsOn`, typed `dependencies`, and a non-empty `graph` projection (synchronous; no poll).
- [ ] `GET /mutations/stream` emits `graph_mutation` events for that plan's writes; `GET /mutations?after=` replays them.
- [ ] `POST /balance-transfer` → `200` with `currentPlan` (revision 2, `current`); the prior revision ends `superseded` (it is `stale` only transiently during the transaction) and `GET /plans/current?lineageId=` returns revision 2.
- [ ] `POST /demo/reset` restores the persona so the hero flow can be re-run; idempotent.
- [ ] `401` without a token; `400` on empty query / bad cursor; `404` on unknown plan / program; `409` on insufficient balance; CORS preflight from the Next origin passes.
- [ ] `npm --prefix apps/api test` is green: plan routes unit-tested via an in-memory fake `PlanService` (status codes + error mapping), no DB required.
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

| #   | Question                                                                    | Blocking?                  | Resolution                                                                                                                                                  |
| --- | --------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Implementation **A (TS-native deps)** vs **B (reuse Python plan-builder)**  | no (contract is identical) | **Resolved 2026-06-24: B**, via `psql`-subprocess bridge — see §Implementation decision                                                                     |
| 2   | `POST /plans` **async (202 + stream)** vs **synchronous (200 + full plan)** | no                         | **Resolved 2026-06-24: synchronous `200` + full plan** for the Jun 25 demo (no `generating` poll window); `/mutations/stream` still drives the live sidebar |
| 3   | Token transport: Bearer vs cookie                                           | no                         | recommend Bearer via Clerk `getToken()`                                                                                                                     |

---

## Completion notes _(fill when done)_

- **Completed:** 2026-06-24; merged to `main` via PR #29 (2026-06-25, `origin/main` @ f53aa36). Status **Done** (RCG-18). _Remaining gate: one browser run-through with a real Clerk bearer token — see below._
- **PR / commit:** PR #29 (`raq/demo-mocks`) → `main` @ f53aa36.
- **Implemented:** `apps/api/src/plans/{types,service,routes,bridge-service}.ts`, `apps/api/src/http/auth.ts`, `apps/api/src/http/clerk-auth.ts`, `apps/api/src/server.ts`, `apps/api/bridge/hero_bridge.py`, plan-route vitest. `npm --prefix apps/api test` (86 unit tests) + `typecheck` green.
- **Live verification (2026-06-25, Docker Postgres 16 + demo seed):**
  - Via the bridge (the exact code the routes call): session → create-plan (rev 1 `current`, 3 steps + deps) → balance-transfer (rev 2 `current`, prior `superseded`, replan job) → current-plan → demo-reset (plans cleared) → re-run — all pass.
  - **Via live HTTP** (`npm --prefix apps/api run dev` with `AUTH_DEV_USER_ID`): `GET /health` ok; `GET /session` → seeded user; `POST /plans` → 200 synchronous full plan (rev 1, 3 steps); `GET /plans/current` → rev 1; `GET /mutations?after=0` → events; `GET /mutations/stream` → real SSE frames (`id:` / `event: graph_mutation` / `data:`).
  - Live hero integration test: `RUN_LIVE_POSTGRES_TESTS=1 python3 -m unittest tests.integration.test_hero_moment` → 2 passed.
  - Operational runbook: [`docs/development/backend-local-setup.md`](../../docs/development/backend-local-setup.md).
- **Deviations from spec:**
  - **Sync over async:** `POST /plans` returns `200` + full plan and `POST /balance-transfer` returns `200` + `currentPlan` (resolved Open question #2) — no `generating`/`202` poll window for the Jun 25 demo.
  - **psql-subprocess bridge, not a Python DB driver:** `psycopg` is absent, so the bridge reuses the hero gate's `psql`-subprocess adapter (see §Implementation decision). Production graph-write graduation tracked in RCG-66.
  - **Test-resident seam import:** `bridge/hero_bridge.py` imports `tests/integration/hero_flow.py`; graduate to a non-test package post-demo (RCG-66).
  - **Not yet verified:** the real Clerk-JWT path end to end — the live runs used the dev bypass (`AUTH_DEV_USER_ID`); no dev Clerk token was available. A browser run-through with a real token is the only remaining gate (RCG-32).
