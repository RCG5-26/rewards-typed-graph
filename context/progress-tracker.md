# Progress Tracker — Rewards Agent

> **AI working memory.** Read this first each session; update it as the **last step** of any change.
> Authoritative for "where we are," but **defers to the locked docs on any conflict** — `docs/architecture/schema-final.md`, `docs/adr/`, and Linear win. Keep this file lean (current state + recent history only). Older history lives in [`progress-archive.md`](progress-archive.md).

**Last updated:** 2026-06-21

---

## Current state (read first)

- **Phase:** Foundations (sprint ~Day 5 of 14). Schema is locked; application build is starting.
- **Active focus:** stand up the Postgres schema and the single write path so every lane can build against real tables.
- **Demo:** 2026-06-29, 10 minutes live. **Day 7 gate:** end-to-end Layer 1–3 path + live re-plan working on the persona.
- **Repo reality:** docs, the locked schema spec, ADRs, and the Linear board exist. **No application code yet** — there is no `schema/` or `src/` in the repo. The first build step is Person A shipping `schema/schema.sql` + the basis-point utils + the seed fixture.
- **How to run:** not yet runnable (pre-code).

## In flight / next up

Agent orientation only — per-ticket status of record is Linear (project **RCG**).

| Unit | Ticket | Owner | Files (expected) | Done when | Blocked on |
|---|---|---|---|---|---|
| Canonical schema artifact (DDL + shared types) | RCG-7 | Alan | `schema/schema.sql` | DDL runs; types generated | — |
| Seed fixture (persona, 20 cards, routes) | RCG-8 | Alan | `schema/seed.sql` | loads with stable IDs | RCG-7 |
| Node/edge tables | RCG-9 | Alan | `schema/schema.sql` | migrations run clean | RCG-7 |
| Mutation layer + validation | RCG-10 | Alan | TBD | invalid mutations rejected | RCG-9 |
| OCC commit + bounded retries | RCG-11 | Alan | TBD | stale-version commit rejected | RCG-10 |
| Per-user advisory lock + SSE ordering | RCG-59 | Alan | TBD | concurrent per-user writes serialize | RCG-10 |
| Dependency tracking (`state_dependencies` + staleness) | RCG-13 | Alan | TBD | balance change marks steps stale | RCG-9 |
| Orchestrator + agent harness | RCG-15 | Raq | TBD | agents commit via the one write path | RCG-7 |

## Open questions / things an agent should know

- `schema/schema.sql` is named as canonical (ADR 0001) but is **not yet in the repo** — treat `schema-final.md` v3.1 as the spec until the DDL lands.
- Linear owner labels read `Person A/B/C`; the name legend (Alan = A, Val = B, Michael = C, Raq = D/lead) is in the project description.
- Layer 4 (ingestion + verifier) is **cut-by-default** (ADR 0003) — do not build it unless the Day 10 go/no-go flips it on.

## Recently completed (newest first)

- **2026-06-20/21** — Linear board reconciled to ADRs 0002/0003 + the v3.1 closeout: Ruijing removed everywhere; single-agent baseline (RCG-35) → Raq; eval harness (RCG-40) re-homed to the benchmark milestone as core (Raq DRI); RCG-5/6 marked Done; added RCG-52–61 (eval instrumentation sub-tasks, win-threshold gate, closeout infra tickets). `project-overview.md` written, then condensed to the template.
- **2026-06-18** — **Schema locked (v3.1); ADR 0001 Accepted.** Architecture closeout (D019–D027) added the plan-lineage/revision model, `graph_mutations` / `replan_jobs` / `idempotency_records`, per-user advisory locks, hosted-runtime topology, and contract codegen (ADRs 0004–0008). Unified transfers locked (no `TransferPartner` node).
- **2026-06-17** — Repo + coordination scaffold and Linear project **RCG** created (47 tickets RCG-5–51, 4 lane labels, 6 milestones, schema-lock as the blocking issue). ADR 0002 (keep the research apparatus) and ADR 0003 (team = 4, Ruijing out, Layer 4 cut-by-default).

## Pointers (follow; don't duplicate)

- Product: [`project-overview.md`](project-overview.md) · Architecture + invariants: [`architecture-context.md`](architecture-context.md)
- Schema (canonical): [`../docs/architecture/schema-final.md`](../docs/architecture/schema-final.md)
- Decisions: [`../docs/adr/`](../docs/adr/) · [`decisions-log.md`](decisions-log.md)
- Tasks (status of record): Linear project **RCG** · Daily board: [`../STATUS.md`](../STATUS.md)
- Full history: [`progress-archive.md`](progress-archive.md)
