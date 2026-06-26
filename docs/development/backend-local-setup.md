# Backend local setup (frontend-facing)

How to run the backend locally, authenticate against it, point the Next.js shell at it, and drive the full hero flow. Everything here is derived from code on `origin/main` and was verified on 2026-06-25 (see [Hero-flow smoke test](#hero-flow-smoke-test)).

> Canonical contract: [`context/feature-specs/07-api-service.md`](../../context/feature-specs/07-api-service.md). Event shape: [`schema/contracts/mutation-event.schema.json`](../../schema/contracts/mutation-event.schema.json). This guide is the operational companion — it does not redefine the contract.

---

## Architecture snapshot

What exists on `origin/main` today:

- **Next.js frontend** (repo root, `app/`) — Clerk Google sign-in + landing/hero. Does **not** call the API yet (no API client wired). Per [ADR 0004](../adr/0004-runtime-topology.md) it migrates to `apps/web` before demo deploy.
- **Hono API** (`apps/api`) — the one HTTP service the shell talks to. Auth middleware → CORS → mounts plan routes + mutation routes. Boots with `@hono/node-server`.
- **Clerk auth** (identity-only, [ADR 0006](../adr/0006-clerk-identity-only.md)) — verifies the Bearer token (`@clerk/backend`), maps Clerk `sub` → `users.clerk_id` → `users.id`. A dev bypass (`AUTH_DEV_USER_ID`) skips Clerk outside production.
- **PostgreSQL 16** (docker-compose) — table-per-type graph schema v3.1; OCC via integer `version`.
- **Python plan-builder bridge** (`apps/api/bridge/hero_bridge.py`) — Option B ([spec 07 §Implementation decision](../../context/feature-specs/07-api-service.md)). `POST /plans` and `POST /balance-transfer` spawn this `psql`-subprocess bridge, which runs the verified hero seam (`tests/integration/hero_flow.py`) and returns a `{ ok, data | error }` envelope.
- **Mutation REST + SSE** (`apps/api/src/mutations/routes.ts`) — `GET /mutations` (catch-up) and `GET /mutations/stream` (SSE), user-scoped, ordered by per-user advisory lock ([ADR 0008](../adr/0008-per-user-serialization-sse.md)).

---

## Prerequisites

These are locally verified versions from the June 25 smoke test, not a canonical support matrix.

| Tool    | Version (verified)      | Notes                                                                                                   |
| ------- | ----------------------- | ------------------------------------------------------------------------------------------------------- |
| Node.js | 23.x (used 23.11)       | API uses `tsx`; ESM.                                                                                    |
| npm     | bundled with Node       | Two package roots: repo root (web) and `apps/api`.                                                      |
| Python  | 3.x (used 3.14)         | Runs the bridge + hero/integration tests. No `psycopg` needed — the bridge shells out to `psql`.        |
| Docker  | 20+ (used 29.4)         | Runs local Postgres via `docker-compose.yml`.                                                           |
| `psql`  | 14+ client (used 14.20) | Client only; server is Postgres 16 in Docker. Required by `scripts/dev-db-setup.sh` and the live tests. |

---

## Environment configuration

Copy the template: `cp .env.example .env`. Use placeholders only — never commit real secrets (only `.env.example` is tracked).

| Variable                                                     | Used by              |                            Required? | Example                                                       | Purpose                                                                                                 |
| ------------------------------------------------------------ | -------------------- | -----------------------------------: | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                               | api, scripts, bridge |                                  Yes | `postgresql://rewards:rewards@localhost:5432/rewards_test`    | Postgres connection for the API pool + bridge + seed loader.                                            |
| `PGHOST` / `PGPORT` / `PGUSER` / `PGPASSWORD` / `PGDATABASE` | bridge, live tests   |                           Yes (live) | `localhost` / `5432` / `rewards` / `rewards` / `rewards_test` | libpq fallbacks; the `psql`-subprocess bridge and live integration guards use these.                    |
| `API_PORT`                                                   | api                  |                  No (default `8787`) | `8787`                                                        | Port the Hono API listens on.                                                                           |
| `CORS_ORIGIN`                                                | api                  | No (default `http://localhost:3000`) | `http://localhost:3000`                                       | Browser origin allowed by CORS (the Next dev server).                                                   |
| `AUTH_DEV_USER_ID`                                           | api                  |                        No (dev only) | `00000000-0000-0000-0000-00000000a001`                        | Local-only auth bypass: skip Clerk and act as this seeded user. **Ignored when `NODE_ENV=production`.** |
| `PYTHON_BIN`                                                 | api                  |               No (default `python3`) | `python3`                                                     | Interpreter the bridge runs under.                                                                      |
| `CLERK_SECRET_KEY`                                           | api, web             |                      Yes (real auth) | `sk_test_xxx`                                                 | Verifies the Clerk Bearer token server-side. Withheld from the bridge subprocess.                       |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`                          | web                  |                            Yes (web) | `pk_test_xxx`                                                 | Clerk client SDK.                                                                                       |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` etc.                         | web                  |                                   No | `/sign-in`                                                    | Clerk hosted UI routes.                                                                                 |
| `RUN_LIVE_POSTGRES_TESTS`                                    | tests                |                                   No | `1`                                                           | Opt-in flag to run the live Postgres hero/seed tests.                                                   |

Where each lives:

- **Root `.env`** — `DATABASE_URL`, `PG*`, `API_PORT`, `CORS_ORIGIN`, `AUTH_DEV_USER_ID`, `CLERK_SECRET_KEY`. Sourced by `scripts/dev-db-setup.sh` and the API.
- **`apps/api`** — reads the same vars from the process env (no separate file; export them or run from a shell that sourced root `.env`).
- **Web (`.env.local`)** — `NEXT_PUBLIC_CLERK_*` and `CLERK_SECRET_KEY` for the Next app.

> The frontend does not yet read an API base URL from env. When it wires the API client it should introduce `NEXT_PUBLIC_API_BASE_URL` (e.g. `http://localhost:8787`); this is **not in code yet**.

---

## First-time setup

Run from the repo root.

```bash
# 1. Install dependencies (web at root + api workspace)
npm install
npm --prefix apps/api install

# 2-4. Start Postgres, apply schema v3.1, load the demo persona (one script)
cp .env.example .env
bash scripts/dev-db-setup.sh
#   → docker compose up -d postgres; waits for ready; resets public schema;
#     applies schema/schema.sql; loads fixtures/demo-seed.json --include-demo-persona

# verify the persona loaded
source .env && psql "$DATABASE_URL" -c "SELECT count(*) FROM user_balances;"   # → 3

# 5. Configure Clerk (only needed for real-token auth; skip if using AUTH_DEV_USER_ID)
#    Put NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY + CLERK_SECRET_KEY in .env / .env.local

# 6. Start the API (dev bypass = no Clerk token needed locally)
AUTH_DEV_USER_ID=00000000-0000-0000-0000-00000000a001 npm --prefix apps/api run dev
#   → "API listening on http://localhost:8787"

# 7. Start the frontend (separate terminal)
npm run dev      # Next dev server on http://localhost:3000
```

---

## Daily startup

```bash
docker compose up -d postgres                                   # if not already running
AUTH_DEV_USER_ID=00000000-0000-0000-0000-00000000a001 \
  npm --prefix apps/api run dev                                 # API on :8787
npm run dev                                                     # web on :3000
```

Re-run `bash scripts/dev-db-setup.sh` only when you want a clean schema + seed.

---

## Frontend integration

- **API base URL:** `http://localhost:8787` (`API_PORT`). Introduce `NEXT_PUBLIC_API_BASE_URL` on the web side.
- **Clerk token:** in the Next app call `const token = await getToken()` (Clerk) and send it as `Authorization: Bearer <token>` on every API request.
- **CORS:** the API allows `CORS_ORIGIN` (default `http://localhost:3000`), headers `Authorization`, `Content-Type`, `Last-Event-ID`, methods `GET`/`POST`/`OPTIONS`.
- **Local without Clerk:** start the API with `AUTH_DEV_USER_ID` set and omit the header — the server resolves that seeded user directly (dev only).

### Routes (all require auth; base path `/`)

| Method | Route               | Body / query                                                        | Returns                                                                  |
| ------ | ------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| GET    | `/health`           | —                                                                   | `{ "ok": true }` (no auth)                                               |
| GET    | `/session`          | —                                                                   | `{ userId, clerkId, seeded: true }` — bootstraps persona on first login  |
| POST   | `/plans`            | `{ "query": "..." }`                                                | **synchronous** full plan body, `status: "current"`                      |
| GET    | `/plans/:planId`    | —                                                                   | full plan body                                                           |
| GET    | `/plans/current`    | `?lineageId=<uuid>`                                                 | the one `current` revision for a lineage                                 |
| POST   | `/balance-transfer` | `{ sourceProgramId, destProgramId, amountPoints, idempotencyKey? }` | `{ planLineageId, staledPlanId, replanJobId, currentPlan }` (revision 2) |
| POST   | `/demo/reset`       | —                                                                   | same as `/session`; restores pristine persona                            |
| GET    | `/mutations`        | `?after=<event_id>`                                                 | array of mutation events since cursor                                    |
| GET    | `/mutations/stream` | header `Last-Event-ID`                                              | `text/event-stream`, one frame per mutation                              |

`POST /plans` is **synchronous** (resolved Open question #2 in spec 07): the bridge builds + commits the plan in-request and returns `status: "current"` — there is no `generating` poll window. The shell still opens `/mutations/stream` to animate the per-step writes.

#### Request / response examples (verified live)

```bash
# POST /plans → 200
{ "planId":"…","planLineageId":"d973…","revisionNumber":1,"status":"current",
  "query":"…","summary":"…","steps":[{"order":1,"type":"…","summary":"…",
  "reasoning":"…","status":"current","dependsOn":["…"],
  "dependencies":[{"id":"…","kind":"UserBalance","slug":"program:chase_ur",
  "label":"Chase Ultimate Rewards"}]}, …3 steps],
  "graph":{"nodes":[{"id":"program:chase_ur","kind":"program","label":"Chase Ultimate Rewards"}],
  "edges":[{"id":"transfer:chase_ur:hyatt","from":"program:chase_ur",
  "to":"program:hyatt","kind":"transfer"}]} }

# POST /balance-transfer → 200
{ "planLineageId":"694a…","staledPlanId":"6609…","replanJobId":"1aa5…",
  "currentPlan":{ …full plan body, "revisionNumber":2, "status":"current" } }
```

#### Consuming `/mutations/stream`

```js
const es = new EventSource(`${API_BASE}/mutations/stream`); // + Authorization via fetch-based SSE polyfill
es.addEventListener("graph_mutation", (e) => render(JSON.parse(e.data)));
```

Each SSE frame is `id: <event_id>` / `event: graph_mutation` / `data: <event json>`. Verified frame:

```
id: 45
event: graph_mutation
data: {"event_id":"45","mutation_txn_id":"…","user_id":"…","plan_lineage_id":"d973…",
       "plan_id":"…","mutation_type":"CreatePlan","target_table":"plans",
       "summary":"Created plan","before":null,"after":{…},"committed_at":"2026-06-25T…Z"}
```

- **Resume:** reconnect with `Last-Event-ID: <last event_id>`; the server replays only newer rows in commit order (no reordering).
- **`mutation_type`:** key UI off the canonical schema set (`TransferPoints`, `MarkStale`, `CreatePlan*`, …), not the mock strings, and tolerate unknown types.

### Mock fixtures (backend unavailable)

Build against these when the API is down — they match the live shapes:

- `fixtures/mock-plan.json` — a plan body.
- `fixtures/mock-mutation-events.json` — a narrative mutation stream (illustrative `mutation_type` strings).

---

## Hero-flow smoke test

Verified 2026-06-25 against Docker Postgres 16 + demo seed (via the bridge — the exact code the HTTP routes call, and via live HTTP):

1. **Session** — `GET /session` → `{ userId, clerkId: "clerk_hero_demo", seeded: true }`.
2. **Create Plan** — `POST /plans {"query": "Best way to use points for a 3-night Tokyo hotel in October?"}` → `status: "current"`, `revisionNumber: 1`, 3 steps with `reasoning` + `dependsOn`, plus typed `dependencies` and `graph` metadata for the traversal view.
3. **Load Plan** — `GET /plans/current?lineageId=<lineage>` → revision 1, `current`.
4. **Subscribe** — `GET /mutations/stream` → `graph_mutation` frames for the plan writes (`GET /mutations?after=0` returned 14 events for one plan).
5. **Trigger transfer** — `POST /balance-transfer {sourceProgramId, destProgramId, amountPoints:1000}` → `currentPlan` revision 2, `current`; `staledPlanId` + `replanJobId` returned.
6. **Observe** — prior revision ends `superseded` (transiently `stale` during the txn); the SSE stream shows the stale → re-plan sequence.
7. **Fetch current** — `GET /plans/current?lineageId=<lineage>` → revision 2, `current`.

Revision check after the transfer:

```
 revision_number |   status
-----------------+------------
               1 | superseded
               2 | current
```

> **Not yet verified:** the real Clerk-JWT path end to end (no dev Clerk token was available); the runs above used `AUTH_DEV_USER_ID`. A browser run-through with a real Clerk token is the remaining gate (RCG-32).

---

## Testing

| Command                                                                               | What it covers                                                    | Result (2026-06-25) |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------- |
| `npm --prefix apps/api run typecheck`                                                 | API TypeScript                                                    | clean               |
| `npm --prefix apps/api test`                                                          | API unit tests (routes, mutations, auth — in-memory fakes, no DB) | 86 passed           |
| `python3 -m unittest discover -v`                                                     | Python unit tests (mutations, queries, eval)                      | 88 passed           |
| `RUN_LIVE_POSTGRES_TESTS=1 python3 -m unittest tests.integration.test_hero_moment -v` | Live hero flow on Docker Postgres                                 | 2 passed            |

---

## Reset and cleanup

```bash
# Reset demo data for one user (presenter safety net) — via API:
curl -s -XPOST http://localhost:8787/demo/reset -H "Authorization: Bearer $TOKEN"

# Full schema + seed reset:
bash scripts/dev-db-setup.sh

# Stop the API: Ctrl-C the dev terminal (or: pkill -f "tsx .*src/server.ts")
# Stop Postgres (keep data):   docker compose stop postgres
# Destroy the database volume:  docker compose down -v
```

---

## Troubleshooting

| Symptom                                                                 | Likely cause                                              | Fix                                                                                                                  |
| ----------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| API exits: `missing required environment variable: DATABASE_URL`        | `.env` not sourced into the API process                   | `source .env` (or export vars) before `npm --prefix apps/api run dev`.                                               |
| `psql` / setup: connection refused                                      | Postgres container not up                                 | `docker compose up -d postgres`; wait for healthcheck (`docker compose ps`).                                         |
| Setup refuses: "must be a dedicated test DB" / "host must be localhost" | `DATABASE_URL` points at a non-local or non-`*_test` DB   | Use the local `rewards_test` URL; the reset guard only runs on localhost test DBs.                                   |
| `relation "..." does not exist`                                         | Schema not applied                                        | `bash scripts/dev-db-setup.sh` (applies `schema/schema.sql`).                                                        |
| `GET /session` → 404 / empty                                            | Seed/persona not loaded                                   | Re-run `scripts/dev-db-setup.sh` (loads `--include-demo-persona`); confirm `user_balances` count is 3.               |
| API returns `401`                                                       | No/invalid Clerk token and no dev bypass                  | Provide `Authorization: Bearer <getToken()>`, or set `AUTH_DEV_USER_ID` locally (dev only).                          |
| Browser request blocked by CORS                                         | Origin ≠ `CORS_ORIGIN`                                    | Set `CORS_ORIGIN` to the Next origin (default `http://localhost:3000`).                                              |
| API boot fails: port in use                                             | `API_PORT` (8787) occupied                                | Free the port or set a different `API_PORT` (update the web base URL too).                                           |
| `POST /plans` 500 / bridge error                                        | Python/`psql` not on PATH, or bridge can't reach Postgres | Ensure `python3` + `psql` installed and `PG*`/`DATABASE_URL` exported; check the API log line for the bridge stderr. |
| SSE looks idle                                                          | No new mutations since cursor                             | Trigger a write (`POST /plans` / `/balance-transfer`); the stream only emits on new rows.                            |
| No `current` plan after transfer                                        | Re-plan didn't promote revision 2                         | Check the `/balance-transfer` response `replanJobId`; re-run `POST /demo/reset` then retry the flow.                 |
