# Railway Deployment — Demo API + PostgreSQL (RCG-60)

Canonical deployment guide for the hosted demo. Platform: **Railway**
(resolves the "Hosted platform choice" open question; ADR
[0004 — Runtime Topology](../adr/0004-runtime-topology.md) listed Railway as an
allowed managed-Postgres option).

> **Status (2026-06-25).** Fully deployed. Project `rewards-typed-graph-demo`
> (Railway, production environment) has two live services: managed Postgres
> (schema applied, demo persona seeded) and the API container.
>
> **Live API URL:** `https://api-production-d6f4c.up.railway.app`
>
> Health, auth-guard, and anonymous gates verified hosted. Token-gated gates
> (session, plan, SSE, transfer+replan, demo-reset) require a real Clerk Bearer
> token — see [Verification](#verification).

---

## Architecture

Modular monolith (ADR 0004). Only two services are deployed for the demo:

| Service | Form | Notes |
|---|---|---|
| **API** (`apps/api`) | Long-lived container from the root [`Dockerfile`](../../Dockerfile) | Hono + TypeScript under `tsx`; **min instances = 1, no scale-to-zero** |
| **PostgreSQL** | Railway managed database | Persistent; not an ephemeral co-located container |
| Web (`app/`) | _not deployed yet_ | Frontend does not consume the API yet — see [Frontend handoff](#frontend-handoff) |

**Why always-on (no scale-to-zero):** the API process owns the SSE stream
(`/mutations/stream`), the replan worker path, and the Python hero-bridge
subprocess launcher. Scale-to-zero would drop open SSE connections and stall
replanning (ADR 0004; ADR [0008](../adr/0008-per-user-serialization-sse.md)).

**The image** ships Node 22 + `python3` + `postgresql-client`. The hero bridge
(`apps/api/bridge/hero_bridge.py`) runs as a subprocess and talks to Postgres via
`psql` (there is no `psycopg` in this project), importing in-repo `schema.*` and
`tests.integration.*` modules — so the image copies the full repo tree, not just
`apps/api`. No `pip install` is required (stdlib only).

---

## Required variables

Set these on the **Railway API service**. Never commit real values; `.env.example`
holds placeholders only.

| Variable | Purpose | Where |
|---|---|---|
| `DATABASE_URL` | Postgres connection | API service — reference the Railway Postgres service variable |
| `PGSSLMODE` | `require` when connecting over an **external** Postgres URL | API service (omit if using the internal service URL) |
| `CLERK_SECRET_KEY` | Server-side Clerk verification (identity-only, ADR 0006) | API service only — **never** browser-exposed |
| `CORS_ORIGIN` | Exact allowed browser origin | API service — exact origin, **no wildcard** |
| `API_PORT` | Port the API binds | API service — `8080`; set Railway target port to `8080` |
| `NODE_ENV` | `production` — disables the `AUTH_DEV_USER_ID` dev bypass | API service |
| `PYTHON_BIN` | Python interpreter for the bridge | API service — `python3` |

`AUTH_DEV_USER_ID` must **not** be set in production. The server ignores it (and
warns) when `NODE_ENV=production`, so Clerk stays mandatory.

---

## First deployment

Run from the repo root. Railway CLI must be authenticated (`railway whoami`).

```bash
# 1. Create / link a Railway project
railway init            # or: railway link   (to an existing project)

# 2. Provision managed Postgres in the project (Dashboard → New → Database →
#    PostgreSQL, or `railway add`). Note the service's DATABASE_URL.

# 3. Apply the canonical schema (see "Schema and seed" for the SSL variant)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f schema/schema.sql

# 4. Load the world data + demo persona
python3 scripts/load_seed.py fixtures/demo-seed.json --include-demo-persona

# 5. Set API service variables (Dashboard → Variables, or `railway variables`)
#    DATABASE_URL, PGSSLMODE, CLERK_SECRET_KEY, CORS_ORIGIN, API_PORT=8080,
#    NODE_ENV=production, PYTHON_BIN=python3

# 6. Configure the service: Dockerfile build, target port 8080,
#    health check path /health, restart on failure, min instances = 1.

# 7. Deploy
railway up              # or push to the GitHub-connected branch

# 8. Watch startup
railway logs
```

Confirm in the logs: `API listening on http://localhost:8080`, a successful
Postgres connection on first authenticated request, no missing-file/import
errors, and no secrets printed.

---

## Schema and seed

**Do not run `scripts/dev-db-setup.sh` against Railway.** Its safety guard
refuses any host that is not `localhost`/`127.0.0.1`/`::1` and requires a
`*_test` database name, and it runs `docker compose up` + resets the schema. It
is a local-only helper.

Apply the schema and seed directly with `psql` / `load_seed.py`:

```bash
# Internal Railway URL (no SSL needed):
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f schema/schema.sql
python3 scripts/load_seed.py fixtures/demo-seed.json --include-demo-persona

# External Railway URL (SSL required):
PGSSLMODE=require psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f schema/schema.sql
PGSSLMODE=require python3 scripts/load_seed.py fixtures/demo-seed.json --include-demo-persona
```

`--include-demo-persona` loads the fixed demo user, balances, statuses, goals,
and held cards in addition to the shared world data. (At runtime, the app clones
this persona per signed-in Clerk user, so production bootstrap does not depend on
the persona seed — it exists for the demo's deterministic starting state.)

**Verify the seed** (demo persona → 3 balance rows):

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c "SELECT count(*) AS balance_count FROM user_balances;"   # expect 3
```

Also spot-check `users`, `reward_programs`, `transfers_to`, and that re-running
the seed does not duplicate rows (it `ON CONFLICT (id) DO UPDATE`, so it is
idempotent).

---

## Redeploy

```bash
git push                # if GitHub deploys are wired, this triggers a build
# or
railway up              # build + deploy the current tree
```

Schema/seed do **not** re-run on redeploy. Re-apply only when `schema/schema.sql`
changes (additive-only after lock — see ADR 0001) or to reset demo data.

---

## Verification

Hosted checks against the live service. Set:

```bash
API_BASE_URL=https://api-production-d6f4c.up.railway.app
CLERK_TOKEN=<real Clerk development Bearer token — from a signed-in session, cannot be generated server-side>
```

| Gate | Command | Expected | Status |
|---|---|---|---|
| Health | `curl -i $API_BASE_URL/health` | `200 {"ok":true}` | ✅ verified hosted |
| Auth guard — session | `curl -i $API_BASE_URL/session` | `401` | ✅ verified hosted |
| Auth guard — mutations | `curl -i $API_BASE_URL/mutations` | `401` | ✅ verified hosted |
| Root path | `curl -i $API_BASE_URL/` | `404` — no route at `/`, expected | ✅ verified hosted |
| Session | `curl -i $API_BASE_URL/session -H "Authorization: Bearer $CLERK_TOKEN"` | `200` + internal user id, clerk id, seeded persona; idempotent on repeat | ⏳ needs Clerk Bearer |
| Create plan | `curl -i -X POST $API_BASE_URL/plans -H "Authorization: Bearer $CLERK_TOKEN" -H "Content-Type: application/json" -d '{"query":"Best way to get to Tokyo in October?"}'` | revision 1, `status:current`, steps + reasoning + dependsOn | ✅ hero flow (local live DB); ⏳ hosted |
| Mutation REST | `curl -i $API_BASE_URL/mutations -H "Authorization: Bearer $CLERK_TOKEN"` | user-scoped list | ✅ (route tests); ⏳ hosted |
| Mutation SSE | `curl -N $API_BASE_URL/mutations/stream -H "Authorization: Bearer $CLERK_TOKEN"` | `text/event-stream`, `graph_mutation` events with ids; `Last-Event-ID` resume | ✅ (events tests); ⏳ hosted always-on |
| Transfer + replan | `POST $API_BASE_URL/balance-transfer` with seeded program ids | transfer ok; prior plan staled→superseded; revision 2 current; same lineage | ✅ hero flow (local live DB); ⏳ hosted |
| Current plan | `curl -i "$API_BASE_URL/plans/current?lineageId=$LINEAGE_ID" -H "Authorization: Bearer $CLERK_TOKEN"` | revision 2, current, same lineage | ✅ hero flow (local live DB); ⏳ hosted |
| Demo reset | `curl -i -X POST $API_BASE_URL/demo/reset -H "Authorization: Bearer $CLERK_TOKEN"` | balances restored; plans/mutations cleared; flow re-runnable | ✅ (`do_demo_reset`); ⏳ hosted |

`✅` = verified locally (container `/health`, route/unit tests, or the live
Postgres hero-flow integration test). `⏳` = requires the hosted service and a
real Clerk token; not yet executed.

---

## Frontend handoff

- **Hosted API URL:** published as the Railway API service URL after deploy.
- **Frontend env var:** the web app must read `NEXT_PUBLIC_API_BASE_URL` and
  point it at the hosted API URL. **It does not yet** — the root Next.js app
  references no `NEXT_PUBLIC_API_BASE_URL` and makes no API fetch calls.
- **Clerk:** the browser uses `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (+ sign-in/up
  URL vars). `CLERK_SECRET_KEY` stays server-side only — never a
  `NEXT_PUBLIC_*` variable.
- **CORS:** keep the API's `CORS_ORIGIN` set to an exact temporary approved
  origin until the real web origin exists, then update it to the deployed web
  origin and redeploy the API.

**Current blocker:** web deployment and browser verification are blocked until
the frontend consumes `NEXT_PUBLIC_API_BASE_URL` (Val-owned). The backend API
URL will be available for that work as soon as the API is deployed.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `hero bridge failed: python3: not found` | Python missing in image | Image installs `python3`; confirm base + apt step |
| `psql: command not found` (bridge) | `postgresql-client` missing | Image installs it; confirm apt step |
| `ModuleNotFoundError: schema` / `tests.integration` | repo tree not fully copied | Ensure `.dockerignore` does **not** exclude `schema/`, `tests/integration/`, `fixtures/` |
| Health check fails but logs show "API listening" | Railway target port ≠ bind port | Set target port and `API_PORT` both to `8080` |
| `401` with a valid token | Clerk origin/key mismatch | Verify `CLERK_SECRET_KEY` and that the token's instance matches |
| `SSL connection required` / `no encryption` | External Postgres URL without SSL | Set `PGSSLMODE=require` (or use the internal service URL) |
| `SELECT count … user_balances` returns 0 | Seed not loaded | Run `load_seed.py … --include-demo-persona` |
| Browser blocked by CORS | `CORS_ORIGIN` ≠ web origin | Set exact deployed web origin, redeploy API |
| SSE stream drops / reconnects constantly | Service scaled to zero | Set min instances = 1, disable scale-to-zero |
| `no current plan to re-plan` on transfer | No plan created first | Create a plan before transferring (hero-flow order) |

> **Smoke-test retry gotcha:** Docker Desktop's port proxy accepts TCP before the
> app binds, so a not-yet-ready service returns *connection reset* (curl error 56),
> not *refused*. Use `curl --retry N --retry-all-errors` (not just
> `--retry-connrefused`) when probing a freshly started container.
