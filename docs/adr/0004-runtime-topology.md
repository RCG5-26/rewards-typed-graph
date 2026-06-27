# 0004 - Runtime Topology

- **Status:** Accepted - June 18, 2026.
  - **Amendment (Jun 25):** `apps/web` migration deferred post-Jun-29 demo; web deploys from repo root to avoid build-break risk.
  - **Amendment (Jun 27):** the Jun 29 demo runtime mounts the Python `psql` bridge for plan/replan; the TypeScript orchestrator and async worker are tested target architecture but are not mounted on `main`.
- **Owner:** Raq (lead)
- **Index:** [`context/decisions-log.md`](../../context/decisions-log.md) (D013, D023, D031)
- **Related:** [0001 - Schema Lock](0001-schema-lock.md), [`architecture-context.md`](../../context/architecture-context.md) Hosted runtime, [spec 07 API service](../../context/feature-specs/07-api-service.md)

## Context

The sprint needs one deployable demo and a separate eval path. Choices about where Postgres runs, whether the API scales to zero, and what gets deployed affect SSE reliability, synchronous bridge subprocesses, target replan workers, and benchmark isolation.

## Decision

**Modular monolith deploy shape**

- `apps/web` - Next.js frontend. For the Jun 29 demo, this remains at the repo root and deploys through `Dockerfile.web`; migration to `apps/web` is post-demo.
- `apps/api` - Hono + TypeScript; long-lived process owning HTTP/auth, mutation REST/SSE, and plan routes. For the Jun 29 demo, plan creation and transfer+replan are implemented by `BridgePlanService`, which spawns `apps/api/bridge/hero_bridge.py`.
- `agents/` - Python specialist modules invoked as subprocesses in the target graph-native architecture; no separate deployable.
- `eval` / benchmark CLIs - local or CI only; never deployed to demo hosting.

**Local development** (`docker compose up`)

| Service    | Form                                      |
| ---------- | ----------------------------------------- |
| `web`      | Compose container / repo-root Next.js dev |
| `api`      | Compose container or long-lived dev proc  |
| PostgreSQL | Compose container (`postgres:16`)         |

**Hosted demo**

| Service    | Form                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------- |
| `web`      | Platform service or container                                                                 |
| `api`      | **Long-lived container** - min instances = 1; **no scale-to-zero**                            |
| PostgreSQL | **Managed database** (Railway, Render, Fly, Neon, Supabase, etc.) - not a co-located app disk |

**Eval / benchmark**

- Runs local or in CI only.
- Uses `DATABASE_URL_EVAL` pointing at an **ephemeral** database per run.
- Never writes the demo database (ADR [0002](0002-mvp-scope-trim.md)).

**Explicitly out of MVP:** Redis, external job queue, WebSocket server, graph database.

## Current Demo Runtime Amendment

- `POST /plans` and `POST /balance-transfer` are synchronous `200` routes backed by the Python `psql` bridge.
- `/balance-transfer` runs `transfer_points`, stale marking, `replan_jobs` claim, new revision write, and promotion inline before returning.
- The TypeScript orchestrator and async replan worker remain tested contracts/target architecture, but `apps/api/src/server.ts` does not compose them into the live server on `main`.
- The bridge is the API database access layer for the demo, so it receives `DATABASE_URL` / `PG*`; this is distinct from the target specialist-agent subprocess contract, where agents receive scoped snapshots and no DB credentials.

## Consequences

- The target graph-native API process embeds the replan worker loop; no separate worker service is planned for MVP.
- In the current demo runtime, replans are synchronous inside `/balance-transfer`; do not cite an independent background worker as live until it is mounted. Use "inline bridge replan" for the current path.
- SSE, subprocess management, and the target worker break if the API tier scales to zero; configure hosting accordingly.
- `DATABASE_URL` in hosted demo targets managed Postgres; local dev uses the compose service name.
- Eval lane documents its own compose or CI job for ephemeral Postgres; not part of demo deploy manifests.
