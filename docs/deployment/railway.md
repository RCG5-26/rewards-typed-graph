# Railway Deployment — Demo API + PostgreSQL (RCG-60)

Canonical deployment guide for the hosted demo. Platform: **Railway**
(resolves the "Hosted platform choice" open question; ADR
[0004 — Runtime Topology](../adr/0004-runtime-topology.md) listed Railway as an
allowed managed-Postgres option).

> **Status (2026-06-26).** Fully deployed — **three** live services in project
> `rewards-typed-graph-demo` (Railway, production): managed Postgres (schema
> applied, demo persona seeded), the API container, and the **web** service.
>
> **Live API URL:** `https://api-production-d6f4c.up.railway.app`
> **Live Web URL:** `https://dependable-eagerness-production.up.railway.app`
>
> Health, auth-guard, and anonymous gates verified hosted. Web `GET /` returns
> `200` and renders with the Clerk publishable key inlined; `/api/*` BFF routes
> are Clerk-protected (an unauthenticated `curl` gets a `protect-rewrite` 404 —
> expected; they resolve in-browser after sign-in). Token-gated gates (session,
> plan, SSE, transfer+replan, demo-reset) require a real Clerk Bearer token —
> see [Verification](#verification).
>
> **Builder note (important).** Railway _always_ builds with a `Dockerfile` when
> one exists at the repo root, so `"builder": "NIXPACKS"` in `railway.json` is
> ignored. The web service therefore uses its **own** [`Dockerfile.web`](../../Dockerfile.web)
> (Next.js `npm ci` → `next build` → `next start`), and the api is pinned to the
> root `Dockerfile` via [`railway.api.json`](../../railway.api.json). The web
> service start command is `npm run start` (Next reads `$PORT` natively; a literal
> `${PORT}` in a non-shell start command is rejected).

---

## Architecture

Modular monolith (ADR 0004). Three services are deployed for the demo:

| Service                     | Form                                                                                                                | Notes                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API** (`apps/api`)        | Long-lived container from the root [`Dockerfile`](../../Dockerfile)                                                 | Hono + TypeScript under `tsx`; **min instances = 1, no scale-to-zero**                                                                                                        |
| **PostgreSQL**              | Railway managed database                                                                                            | Persistent; not an ephemeral co-located container                                                                                                                             |
| **Web** (`app/`, repo root) | Dockerfile service via [`Dockerfile.web`](../../Dockerfile.web), configured by [`railway.json`](../../railway.json) | Next.js BFF; **database-less** — no `DATABASE_URL`; calls the live API server-side. (Dockerfile, not Nixpacks: Railway forces Dockerfile builds when one is present at root.) |

> **`apps/web` migration deferred post-demo.** ADR 0004 planned migrating the Next.js root to `apps/web`, but the move was deferred to avoid a demo-day build risk. Web deploys from the repo root for the Jun 29 demo.

**Why always-on (no scale-to-zero):** the API process owns the SSE stream
(`/mutations/stream`), the synchronous transfer+replan route, and the Python
hero-bridge subprocess launcher. Scale-to-zero would drop open SSE connections
and interrupt bridge-backed replanning (ADR 0004; ADR
[0008](../adr/0008-per-user-serialization-sse.md)).

**The image** ships Node 22 + `python3` + `postgresql-client`. The hero bridge
(`apps/api/bridge/hero_bridge.py`) runs as a subprocess and talks to Postgres via
`psql` (there is no `psycopg` in this project), importing in-repo `schema.*` and
`tests.integration.*` modules — so the image copies the full repo tree, not just
`apps/api`. No `pip install` is required (stdlib only).

---

## Required variables

Set these on the **Railway API service**. Never commit real values; `.env.example`
holds placeholders only.

| Variable           | Purpose                                                     | Where                                                         |
| ------------------ | ----------------------------------------------------------- | ------------------------------------------------------------- |
| `DATABASE_URL`     | Postgres connection                                         | API service — reference the Railway Postgres service variable |
| `PGSSLMODE`        | `require` when connecting over an **external** Postgres URL | API service (omit if using the internal service URL)          |
| `CLERK_SECRET_KEY` | Server-side Clerk verification (identity-only, ADR 0006)    | API service only — **never** browser-exposed                  |
| `CORS_ORIGIN`      | Exact allowed browser origin                                | API service — exact origin, **no wildcard**                   |
| `API_PORT`         | Port the API binds                                          | API service — `8080`; set Railway target port to `8080`       |
| `NODE_ENV`         | `production` — disables the `AUTH_DEV_USER_ID` dev bypass   | API service                                                   |
| `PYTHON_BIN`       | Python interpreter for the bridge                           | API service — `python3`                                       |

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

# 3. Apply the canonical schema and seed the demo data.
#    The API container also runs this non-destructive bootstrap on startup.
python3 scripts/ensure_schema_seed.py --include-demo-persona

# 4. Set API service variables (Dashboard → Variables, or `railway variables`)
#    DATABASE_URL, PGSSLMODE, CLERK_SECRET_KEY, CORS_ORIGIN, API_PORT=8080,
#    NODE_ENV=production, PYTHON_BIN=python3

# 5. Configure the service: Dockerfile build, target port 8080,
#    health check path /health, restart on failure, min instances = 1.

# 6. Deploy
railway up              # or push to the GitHub-connected branch

# 7. Watch startup
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

Run the non-destructive bootstrap directly:

```bash
# Internal Railway URL (no SSL needed):
python3 scripts/ensure_schema_seed.py --include-demo-persona

# External Railway URL (SSL required):
PGSSLMODE=require python3 scripts/ensure_schema_seed.py --include-demo-persona
```

The bootstrap applies `schema/schema.sql` only when the public schema has no
tables. If the database already has the complete schema, it only reloads the
idempotent seed rows. If it finds a partial schema, it exits with an error
instead of guessing at a migration.

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

The API container runs `scripts/ensure_schema_seed.py --include-demo-persona`
on every start before the Hono server accepts traffic. This is safe to run on
redeploy because seed inserts are idempotent and schema application only happens
for an empty public schema.

---

## Verification

Hosted checks against the live service. Set:

```bash
API_BASE_URL=https://api-production-d6f4c.up.railway.app
CLERK_TOKEN=<real Clerk development Bearer token — from a signed-in session, cannot be generated server-side>
```

> **Liveness vs readiness.** `/health` is a **liveness** probe — it returns
> `{"ok":true}` unconditionally without probing Postgres, Clerk, or the bridge.
> A readiness probe (e.g. `SELECT 1` against the pool) is not yet implemented;
> dependency availability is confirmed by the token-gated gates below.

| Gate                   | Command                                                                                                                                                                 | Expected                                                                      | Status                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------- |
| Liveness               | `curl -i $API_BASE_URL/health`                                                                                                                                          | `200 {"ok":true}` — process alive, not dependency health                      | ✅ verified hosted                      |
| Auth guard — session   | `curl -i $API_BASE_URL/session`                                                                                                                                         | `401`                                                                         | ✅ verified hosted                      |
| Auth guard — mutations | `curl -i $API_BASE_URL/mutations`                                                                                                                                       | `401`                                                                         | ✅ verified hosted                      |
| Root path              | `curl -i $API_BASE_URL/`                                                                                                                                                | `404` — no route at `/`, expected                                             | ✅ verified hosted                      |
| Session                | `curl -i $API_BASE_URL/session -H "Authorization: Bearer $CLERK_TOKEN"`                                                                                                 | `200` + internal user id, clerk id, seeded persona; idempotent on repeat      | ⏳ needs Clerk Bearer                   |
| Create plan            | `curl -i -X POST $API_BASE_URL/plans -H "Authorization: Bearer $CLERK_TOKEN" -H "Content-Type: application/json" -d '{"query":"Best way to get to Tokyo in October?"}'` | revision 1, `status:current`, steps + reasoning + dependsOn                   | ✅ hero flow (local live DB); ⏳ hosted |
| Mutation REST          | `curl -i $API_BASE_URL/mutations -H "Authorization: Bearer $CLERK_TOKEN"`                                                                                               | user-scoped list                                                              | ✅ (route tests); ⏳ hosted             |
| Mutation SSE           | `curl -N $API_BASE_URL/mutations/stream -H "Authorization: Bearer $CLERK_TOKEN"`                                                                                        | `text/event-stream`, `graph_mutation` events with ids; `Last-Event-ID` resume | ✅ (events tests); ⏳ hosted always-on  |
| Transfer + replan      | `POST $API_BASE_URL/balance-transfer` with seeded program ids                                                                                                           | transfer ok; prior plan staled→superseded; revision 2 current; same lineage   | ✅ hero flow (local live DB); ⏳ hosted |
| Current plan           | `curl -i "$API_BASE_URL/plans/current?lineageId=$LINEAGE_ID" -H "Authorization: Bearer $CLERK_TOKEN"`                                                                   | revision 2, current, same lineage                                             | ✅ hero flow (local live DB); ⏳ hosted |
| Demo reset             | `curl -i -X POST $API_BASE_URL/demo/reset -H "Authorization: Bearer $CLERK_TOKEN"`                                                                                      | balances restored; plans/mutations cleared; flow re-runnable                  | ✅ (`do_demo_reset`); ⏳ hosted         |

`✅` = verified locally (container `/health`, route/unit tests, or the live
Postgres hero-flow integration test). `⏳` = requires the hosted service and a
real Clerk token; not yet executed.

---

## Web service — required variables

Set these on the **Railway web service** (not the API service). No `DATABASE_URL`
— the web tier is intentionally database-less (KTD-5; persona authoritative from the API).

| Variable                                          | Purpose                                                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `API_BASE_URL`                                    | Live Hono API URL — **server-only, NOT `NEXT_PUBLIC_*`** (BFF; browser never calls Hono directly). Value: `https://api-production-d6f4c.up.railway.app` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`               | Clerk client SDK                                                                                                                                        |
| `CLERK_SECRET_KEY`                                | Clerk server-side verification — **never `NEXT_PUBLIC_*`**                                                                                              |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL`                   | `/sign-in`                                                                                                                                              |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL`                   | `/sign-up`                                                                                                                                              |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | `/`                                                                                                                                                     |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | `/`                                                                                                                                                     |

After deploying, update the API service's `CORS_ORIGIN` to the exact deployed web origin and redeploy the API.

Add the deployed web origin to **Clerk Dashboard → Allowed Origins** (and the allowed redirect URLs for sign-in/up).

## Frontend handoff (historical — now wired)

- **Hosted API URL:** `https://api-production-d6f4c.up.railway.app`
- **Key correction from earlier docs:** the BFF proxy uses **`API_BASE_URL`** (server-only), not `NEXT_PUBLIC_API_BASE_URL`. The browser never contacts the Hono API directly.
- **Clerk:** browser uses `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`. `CLERK_SECRET_KEY` stays server-side only on both the API and web services.
- **CORS:** not required for the BFF path (Next server → Hono server); only needed if any browser-direct API call exists (none in the current design).

---

## Troubleshooting

| Symptom                                             | Likely cause                      | Fix                                                                                                           |
| --------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `hero bridge failed: python3: not found`            | Python missing in image           | Image installs `python3`; confirm base + apt step                                                             |
| `psql: command not found` (bridge)                  | `postgresql-client` missing       | Image installs it; confirm apt step                                                                           |
| `ModuleNotFoundError: schema` / `tests.integration` | repo tree not fully copied        | Ensure `.dockerignore` does **not** exclude `schema/`, `tests/integration/`, `fixtures/`                      |
| Health check fails but logs show "API listening"    | Railway target port ≠ bind port   | Set target port and `API_PORT` both to `8080`                                                                 |
| `401` with a valid token                            | Clerk origin/key mismatch         | Verify `CLERK_SECRET_KEY` and that the token's instance matches                                               |
| `SSL connection required` / `no encryption`         | External Postgres URL without SSL | Set `PGSSLMODE=require` (or use the internal service URL)                                                     |
| `SELECT count … user_balances` returns 0            | Seed not loaded                   | Run `python3 scripts/ensure_schema_seed.py --include-demo-persona`; the API container also runs it on startup |
| Browser blocked by CORS                             | `CORS_ORIGIN` ≠ web origin        | Set exact deployed web origin, redeploy API                                                                   |
| SSE stream drops / reconnects constantly            | Service scaled to zero            | Set min instances = 1, disable scale-to-zero                                                                  |
| `no current plan to re-plan` on transfer            | No plan created first             | Create a plan before transferring (hero-flow order)                                                           |

> **Smoke-test retry gotcha:** Docker Desktop's port proxy accepts TCP before the
> app binds, so a not-yet-ready service returns _connection reset_ (curl error 56),
> not _refused_. Use `curl --retry N --retry-all-errors` (not just
> `--retry-connrefused`) when probing a freshly started container.
