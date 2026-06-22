# Progress Tracker - Rewards Agent

> **AI working memory.** Read this first each session; update it as the last step of any change.
> Authoritative for "where we are," but defers to the locked docs on any conflict: `docs/architecture/schema-final.md`, `docs/adr/`, and Linear win. Keep this file lean; older history lives in [`progress-archive.md`](progress-archive.md).

**Last updated:** 2026-06-23

---

## Current state (read first)

- **Phase:** Foundations / integration. Schema v3.1 is locked; generated schema artifacts and the operational mutation work from PR #2 are on `main`.
- **Active focus:** wire the Layer 1-3 demo path against real graph-write contracts while keeping app lanes moving on mocks where contracts are still settling.
- **Demo:** 2026-06-29, 10 minutes live. **Day 7 gate:** end-to-end Layer 1-3 path plus live re-plan working on the persona.
- **Repo reality:** there is no full app scaffold yet. Schema/contracts, design-system tokens, and the Person C fixture-backed redemption planner/scorer now exist.
- **How to run Person C slice:** `python -m unittest discover -s tests -v`; optional scorer report: `python -m benchmark.person_c_scorer --pretty`.

## In flight / next up

Agent orientation only - per-ticket status of record is Linear project **RCG**.

| Unit | Ticket | Owner | Files (expected) | Done when | Blocked on |
|---|---|---|---|---|---|
| Seed fixture (persona, 20 cards, routes) | RCG-8 | Alan | `schema/seed.sql` | loads with stable IDs | RCG-7 |
| Dependency tracking (`state_dependencies` + staleness) | RCG-13 | Alan | schema/write path | balance change marks steps stale | RCG-10 |
| Orchestrator + agent harness | RCG-15 | Raq | TBD | agents commit via the one write path | generated contracts for real wiring |
| Demo shell + mutation sidebar | RCG-24/27 | Val | app/design-system paths | shell and sidebar run on mock events, then real SSE | real payload wiring |
| Redemption planner + scorer prototype | RCG-20/21/22/31/34/38 | Michael | `agents/redemption/`, `fixtures/person-c-mvp-seed.json`, `benchmark/`, `tests/` | maps to graph-write contracts and baseline runners | RCG-10/MutationBatch; eval config |

## Open questions / things an agent should know

- `schema/schema.sql` is canonical with `docs/architecture/schema-final.md`; additive-only schema changes need the ADR/sign-off path.
- Linear owner labels read `Person A/B/C`; the name legend is Alan = A, Val = B, Michael = C, Raq = D/lead.
- Layer 4 (ingestion + verifier) is **cut-by-default** (ADR 0003). Build it only if the Day 10 go/no-go flips it on.
- Person C database-backed writes remain blocked until the graph-write/MutationBatch and fragment-merge contracts are ready.

## Recently completed (newest first)

- **2026-06-23** - Person C PR review fixes: branch rebased onto `origin/main`; cash-fallback diagnostics now stay scoped to matching awards; invalidation scoring looks up the Chase balance by slug instead of list position.
- **2026-06-22** - Person C executable slice added: Tokyo Hyatt fixture aligned to schema-final terminology, deterministic redemption planner, seeded award-search graph fragment tool, 11-case benchmark execution tests, and offline scorer (`python -m benchmark.person_c_scorer --pretty`). Typed fixture path scores 11/11 accuracy, 0 strict hallucinations, and 2/2 invalidation.
- **2026-06-21** - PR #2 schema/contract work landed on `main`: v3.1 generated artifacts, operational mutation/write-path coverage, user-scoped `graph_mutations`, `replan_jobs`, idempotency records, eval tables, and PostgreSQL schema tests.
- **2026-06-21** - Val's design-system tokens, fonts, Tailwind preset, and status/design-context docs landed on `main`; components remain app work.
- **2026-06-20/21** - Linear board reconciled to ADRs 0002/0003 and the v3.1 closeout: Ruijing removed, single-agent baseline moved to Raq, eval harness set as Raq DRI, and RCG-52 through RCG-61 added.
- **2026-06-18** - **Schema locked (v3.1); ADR 0001 Accepted.** Architecture closeout added plan lineage/revisions, `graph_mutations`, `replan_jobs`, `idempotency_records`, per-user advisory locks, hosted-runtime topology, and contract codegen ADRs.
- **2026-06-17** - Repo and coordination scaffold plus Linear project **RCG** created. ADR 0002 retained the research apparatus; ADR 0003 locked the four-person team and Layer 4 cut-by-default.

## Pointers (follow; do not duplicate)

- Product: [`project-overview.md`](project-overview.md); architecture and invariants: [`architecture-context.md`](architecture-context.md)
- Schema: [`../docs/architecture/schema-final.md`](../docs/architecture/schema-final.md); DDL: [`../schema/schema.sql`](../schema/schema.sql)
- Decisions: [`../docs/adr/`](../docs/adr/); index: [`decisions-log.md`](decisions-log.md)
- Daily board: [`../STATUS.md`](../STATUS.md); per-person tracking: [`../tracking/`](../tracking/)
