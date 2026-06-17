# Rewards Agent: Typed-Graph Multi-Agent Coordination

A multi-agent system for personalized credit-card rewards optimization that uses a typed knowledge graph as the coordination substrate. Agents coordinate by committing typed, schema-validated graph mutations, not by passing free-text messages. Benchmarked head-to-head against a single-agent baseline and a free-text multi-agent (CrewAI-style) baseline.

**Demo:** June 29, 10-minute live slot. Gauntlet AI fellowship sprint.

## The one hard constraint

Coordination is state, not messages. Every interaction between agents is a typed mutation to the shared graph, validated against a schema that is locked on Day 1 and additive-only after. No free-text inter-agent messages, ever.

## How this team coordinates

This repo is the source of truth for daily coordination. Linear is an optional backbone for the timeline view.

- **[STATUS.md](STATUS.md)** — the shared team board. Standup grid, blockers, gates, decisions log. Read it daily.
- **[tracking/](tracking/)** — one self-tracking file per person.
- **[docs/](docs/)** — schema spec ([architecture](docs/architecture/schema-v2.md)), [meeting prep + agenda](docs/meetings/), and [ADR decision log](docs/adr/).

## Team and lanes

| Person | Lane | Owns |
|---|---|---|
| Alan (Person A) | Graph / Persistence | Schema, Postgres graph layer, dependency tracking, optimistic concurrency |
| Val (Person B) | Frontend / Demo | Demo shell, graph-mutation sidebar, baseline comparison UI |
| Michael (Person C) | Redemption / Eval | Redemption agent, graph-typed tools, 30-query benchmark, baselines, Layer 4 (ingestion + verifier) |
| Raq (Person D, owner/lead) | Orchestrator / Agents | Orchestrator, wallet agent, earning agent, integration glue, cross-lane unblocking |

## Architecture in brief

Four layers over Postgres (Postgres only, no Neo4j):

1. **Knowledge graph** — world graph (cards, programs, transfer partners; typed, timestamped edges), personal graph (balances, status, goals), plan graph (plan steps with dependency edges back to the state they rely on).
2. **Specialist agents** — orchestrator, wallet, earning, redemption. All mutations validated against schema before commit.
3. **Dependency tracking + graph-typed tools** — plan nodes carry dependency edges with the read version they relied on; when state changes, dependent plan nodes are structurally invalidated and the redemption agent re-plans. Tools return typed subgraphs, not JSON blobs.
4. **Online graph learning under verification (stretch)** — ingestion agent extracts mutations from unstructured updates; verifier validates against schema, existing edges, and ratio transitivity. Hard-cuttable, go/no-go at Day 10.

## Scope (MVP)

Manually-entered wallet, 20 pre-seeded cards, one real external tool (cash-price lookup), fixture-based award availability. Demo-grade proof of concept, not a consumer product.
