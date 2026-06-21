# 0004 — Runtime Topology

- **Status:** Accepted — June 18, 2026.
- **Owner:** Raq (lead)
- **Index:** [`context/decisions-log.md`](../../context/decisions-log.md) (D013, D023)
- **Related:** [0001 — Schema Lock](0001-schema-lock.md), [`architecture-context.md`](../../context/architecture-context.md) §Hosted runtime

## Context

The sprint needs one deployable demo and a separate eval path. Choices about where Postgres runs, whether the API scales to zero, and what gets deployed affect SSE reliability, replan workers, and benchmark isolation.

## Decision

**Modular monolith deploy shape**
- `apps/web` — Next.js frontend.
- `apps/api` — Hono + TypeScript; long-lived process owning orchestration, graph-write/query, SSE, replan worker, and Python subprocess launcher.
- `agents/` — Python specialist modules invoked as subprocesses (no separate deployable).
- `eval/` — CLI only; never deployed to demo hosting.

**Local development** (`docker compose up`)
| Service | Form |
|---|---|
| `web` | Compose container |
| `api` | Compose container (**must stay running**) |
| PostgreSQL | Compose container (`postgres:16`) |

**Hosted demo**
| Service | Form |
|---|---|
| `web` | Platform service or container |
| `api` | **Long-lived container** — min instances = 1; **no scale-to-zero** |
| PostgreSQL | **Managed database** (Railway, Render, Fly, Neon, Supabase, etc.) — not a co-located app container with ephemeral disk |

**Eval / benchmark**
- Runs local or in CI only.
- Uses `DATABASE_URL_EVAL` pointing at an **ephemeral** database per run.
- Never writes the demo database (ADR [0002](0002-mvp-scope-trim.md)).

**Explicitly out of MVP:** Redis, external job queue, WebSocket server, graph database.

## Consequences

- The API process must embed the replan worker loop; no separate worker service in MVP.
- SSE and subprocess management break if the API tier scales to zero — configure hosting accordingly.
- `DATABASE_URL` in hosted demo targets managed Postgres; local dev uses the compose service name.
- Eval lane documents its own compose or CI job for ephemeral Postgres; not part of demo deploy manifests.
