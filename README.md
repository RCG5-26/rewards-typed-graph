# Rewards Agent: Typed-Graph Multi-Agent Coordination

A multi-agent system for personalized credit-card rewards optimization that uses a typed knowledge graph as the coordination substrate. Agents coordinate by committing typed, schema-validated graph mutations, not by passing free-text messages. Benchmarked head-to-head against a single-agent baseline and a free-text multi-agent (CrewAI-style) baseline.

**Demo:** June 29, 10-minute live slot. Gauntlet AI fellowship sprint.

## The one hard constraint

Coordination is state, not messages. Every interaction between agents is a typed mutation to the shared graph, validated against a schema that is locked on Day 1 and additive-only after. No free-text inter-agent messages, ever.

## How we work here

New to the repo? Read **[AGENTS.md](AGENTS.md)** — it's the working guide for humans and AI agents alike (read order, the build workflow, and update rules). In short:

- **The spec is the unit of work.** Each lane owner writes a spec in [`context/feature-specs/`](context/feature-specs/) from the template, clears its Definition-of-Ready gate, and the lead marks it **Ready**; then it's implemented with the prompt in [`context/ai-workflow-rules.md`](context/ai-workflow-rules.md). One owner per spec.
- **Build against the contracts, never around them.** The locked data model is [`schema-final.md` v3.1](docs/architecture/schema-final.md); the _why_ lives in [`docs/adr/`](docs/adr/). Schema is additive-only.
- **Keep things in sync.** One source of truth per fact; link, don't duplicate; update docs as part of the change (see "Keeping docs in sync" in [`ai-workflow-rules.md`](context/ai-workflow-rules.md)). Tasks are tracked in Linear (**RCG**).

## How this team coordinates

This repo is the source of truth for daily coordination. Linear is an optional backbone for the timeline view.

- **[STATUS.md](STATUS.md)** — the shared team board. Standup grid, blockers, gates, decisions log. Read it daily.
- **[tracking/](tracking/)** — one self-tracking file per person.
- **[docs/](docs/)** — schema spec ([schema-final.md v3.1](docs/architecture/schema-final.md); [schema.sql](schema/schema.sql)), [meeting prep + agenda](docs/meetings/), and [ADR decision log](docs/adr/). Historical: [schema-v2.md](docs/architecture/schema-v2.md).

## Local database setup (RCG-9)

Shared Postgres for hero integration tests and seed loading:

```bash
cp .env.example .env
docker compose up -d postgres          # or: ./scripts/dev-db-setup.sh (starts + loads)
./scripts/dev-db-setup.sh              # reset schema, apply DDL, load demo persona
```

Verify the demo persona loaded:

```bash
source .env
psql "$DATABASE_URL" -c "SELECT count(*) FROM user_balances;"
```

Run the hero gate test (requires seed + schema):

```bash
source .env
export RUN_LIVE_POSTGRES_TESTS=1
python3 -m unittest tests.integration.test_hero_moment -v
```

Reset the database volume: `docker compose down -v`.

## Run the demo locally

The full hero flow (Next.js shell → Hono API → Clerk → Postgres → Python plan bridge) is on `main` and runs locally. The end-to-end setup, environment table, API contract, hero-flow smoke test, and troubleshooting live in one place:

**→ [`docs/development/backend-local-setup.md`](docs/development/backend-local-setup.md)** (frontend-facing backend guide)

Shortest path once the DB is up (above):

```bash
AUTH_DEV_USER_ID=00000000-0000-0000-0000-00000000a001 npm --prefix apps/api run dev   # API on :8787
API_BASE_URL=http://localhost:8787 npm run dev                                         # web on :3000, plans via live API
```

With `API_BASE_URL` (or `NEXT_PUBLIC_API_BASE_URL`) set, the web plan routes
(`/api/plan`, `/api/plan/stream`) call the live orchestrator and stream the real
`graph_mutations`; unset (or if the API is unreachable) they fall back to the
deterministic fixture builder so the shell always runs. See
[`lib/plan/orchestrator-client.ts`](lib/plan/orchestrator-client.ts).

## Deploy the demo (Railway)

The API ships as a container (root [`Dockerfile`](Dockerfile)) alongside managed
Postgres. Setup, required variables, schema/seed, verification, and frontend
handoff live in one place:

**→ [`docs/deployment/railway.md`](docs/deployment/railway.md)** (RCG-60)

## Frontend (interim layout)

The marketing landing (`npm run dev` at repo root) ships here for the integration sprint. Per [ADR 0004](docs/adr/0004-runtime-topology.md) it migrates to `apps/web` before demo deploy.

The agent console is now wired to the live orchestrator: the plan routes call the API over `API_BASE_URL`/`NEXT_PUBLIC_API_BASE_URL` (forwarding the Clerk token), project the real `PlanView` into the console, and stream the persisted `graph_mutations`, with a transparent fallback to the fixture builder when no backend is configured. The baselines/benchmark tabs derive their value and token figures from the live run. Setup (base URL, Clerk token header, route contract, SSE) is in [`docs/development/backend-local-setup.md`](docs/development/backend-local-setup.md) § Frontend integration.

**Known gaps:** typed-graph node-lighting still follows the derived traversal order, not native `prog:<slug>` ids on each mutation row (needs a backend change); the baseline *narratives* and the benchmark accuracy/hallucination rates remain illustrative (no real CrewAI/single-agent run); end-to-end against live Postgres is not yet browser-verified.

## Team and lanes

| Person                     | Lane                  | Owns                                                                                               |
| -------------------------- | --------------------- | -------------------------------------------------------------------------------------------------- |
| Alan (Person A)            | Graph / Persistence   | Schema, Postgres graph layer, dependency tracking, optimistic concurrency                          |
| Val (Person B)             | Frontend / Demo       | Demo shell, graph-mutation sidebar, baseline comparison UI                                         |
| Michael (Person C)         | Redemption / Eval     | Redemption agent, graph-typed tools, 30-query benchmark, baselines, Layer 4 (ingestion + verifier) |
| Raq (Person D, owner/lead) | Orchestrator / Agents | Orchestrator, wallet agent, earning agent, integration glue, cross-lane unblocking                 |

## Architecture in brief

Four layers over Postgres (Postgres only, no Neo4j):

1. **Knowledge graph** — world graph (cards, programs, transfer partners; typed, timestamped edges), personal graph (balances, status, goals), plan graph (plan steps with dependency edges back to the state they rely on).
2. **Specialist agents** — orchestrator, wallet, earning, redemption. All mutations validated against schema before commit.
3. **Dependency tracking + graph-typed tools** — plan nodes carry dependency edges with the read version they relied on; when state changes, dependent plan nodes are structurally invalidated and the redemption agent re-plans. Tools return typed subgraphs, not JSON blobs.
4. **Online graph learning under verification (stretch)** — ingestion agent extracts mutations from unstructured updates; verifier validates against schema, existing edges, and ratio transitivity. Hard-cuttable, go/no-go at Day 10.

## Scope (MVP)

Manually-entered wallet, a locked five-card demo seed across three programs, one real external tool (cash-price lookup), fixture-based award availability. Demo-grade proof of concept, not a consumer product.
