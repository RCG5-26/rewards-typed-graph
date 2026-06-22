# Team Status Board

The shared source of truth for the sprint. Update your own row before standup. Keep it skimmable.

**Live demo:** Mon June 29 (10 min) · **Today:** Day 3, Fri June 19 · **Phase:** Phase A3 — contracts & codegen (spec v3.1 + DDL authored)
**The one constraint:** coordination is state, not messages. Typed graph mutations only. Schema v3.1 locked for implementation; additive-only after lane sign-off.
**Linear:** optional backbone (milestones + gates). This board is the daily driver. Task ids below map to `RCG-##` in Linear.

**Team:** Alan (A · Graph) · Val (B · Frontend) · Michael (C · Redemption/Eval + Layer 4) · Raq (D · Orchestrator, owner/lead)

---

## Schema status (v3.1)

> Canonical spec: [`docs/architecture/schema-final.md`](docs/architecture/schema-final.md) **v3.1**. Canonical DDL: [`schema/schema.sql`](schema/schema.sql). Supersedes [`schema-v2.md`](docs/architecture/schema-v2.md) (historical). See [decisions log](context/decisions-log.md) D027 and [`architecture-context.md`](context/architecture-context.md).

| | State |
|---|---|
| Schema spec v3.1 authored ([`schema-final.md`](docs/architecture/schema-final.md)) | ☑ done |
| Canonical DDL committed ([`schema/schema.sql`](schema/schema.sql)) | ☑ done |
| DDL validated on clean PostgreSQL 16 | ☑ done |
| JSON Schema contracts + codegen (Phase A3) | ☐ not started — **next schema-lane work** |
| Seed fixture committed, stable IDs (RCG-8) | ☐ not started |
| All four lanes signed off on v3.1 (§13) | ☑ Alan ☑ Val ☑ Michael ☑ Raq ([ADR 0001](docs/adr/0001-schema-lock.md)) |
| **Implementation wiring on real contracts** | ☐ gated — app lanes may use mocks until generated types land |

**Architecture locked (v3.1):** plan revision lifecycle via `plans.status` / `plan_steps.status` (no `is_current`, no `plan_steps.is_stale`); durable `replan_jobs` with leases; `graph_mutations` as user-scoped audit/SSE replay only (not a work queue).

Lock date: **2026-06-18** (ADR 0001 Accepted; merged to `main` via PR #6)

---

## Standup grid

Update only your own row. Format: short phrases, not paragraphs.

| Person | Yesterday | Today | Blocked on |
|---|---|---|---|
| Alan · Graph | kickoff | Phase A3: JSON Schema contracts + codegen plan | nothing |
| Val · Frontend | Card API research done; **design system landed** (`design-system/` — tokens, fonts, Tailwind preset; components TBD in app); wireframe flow mapped | Demo shell scaffold + sidebar on mocks against tokens (RCG-27, RCG-24) | real contracts for payload wiring |
| Michael · Redemption | kickoff | Paper-design redemption traversal (RCG-20) | nothing |
| Raq · Orchestrator (owner, lead) | kickoff | Review v3.1; scaffold orchestrator + agent harness on mocks (RCG-15) | generated contracts for real wiring |

---

## Active blockers

Raq clears these. Add a line when blocked, strike it when cleared.

- _none yet_

---

## Gate tracker

| Gate | Day | Date | Status | Owner |
|---|---|---|---|---|
| Schema v3.1 spec + DDL authored | 1 | Jun 17 | ☑ done | Alan + Raq |
| End-to-end demo path working (Layers 1-3 + Hero Moment 1) | 7 | Jun 23 | ☐ open | Raq |
| Layer 4 GO / NO-GO | 10 | Jun 26 | ☐ open | Raq (lane: Michael) |
| **Live demo** (10 min) | 13 | Jun 29 | ☐ open | all |

Rule: if the Day 7 gate slips, cut scope, do not extend. Week 2 is polish and benchmark, not new features. Hosted platform and demo script must be ready **before the June 29 live demo** — no separate rehearsal date is scheduled.

---

## Phase timeline

| Days | Dates | Focus |
|---|---|---|
| 1-3 | Jun 17-19 | Alan: v3.1 spec + DDL done; Phase A3 contracts. Raq: scaffold orchestrator + harness (mocks OK). Michael: paper-design redemption traversal. Val: sidebar on mock data. |
| 3-5 | Jun 19-21 | Alan: dependency tracking (plan nodes only, no transitive). Raq: ship wallet + earning agents. Michael: redemption agent + award-search tool (fixtures). Val: sidebar building. |
| 5-7 | Jun 21-23 | Full Layer 1-3 integration, end-to-end demo path. Val: wire real streaming events. Michael: connect real cash-price tool, start benchmark fixtures. |
| 7-10 | Jun 23-26 | Benchmark runs across all three architectures. Michael builds + tunes both baselines. Layer 4 go/no-go at Day 10. |
| 10-14 | Jun 26-29 | Demo polish. Head-to-head contrast UI. Adversarial verifier set only if Layer 4 landed at Day 10 go/no-go. |

---

## Decisions log

Append one line per real decision. This is the lightweight ADR. (Historical v2 open items resolved in schema-final v3.1 — see [`decisions-log.md`](context/decisions-log.md).)

| Date | Decision | Who | Notes |
|---|---|---|---|
| Jun 17 | Coordination is typed mutations only, no free text | team | hard constraint |
| Jun 17 | Schema additive-only after lock; changes go through Raq | team | |
| Jun 17 | Layer 4 cut-by-default; go/no-go Day 10 | team | [ADR 0003](docs/adr/0003-team-four-eval-ownership.md) |
| Jun 18 | schema-final v3.1 + schema.sql on `main` | Alan + Raq | D027; DDL validated PG 16; PR #6 merged |
| Jun 21 | Design system landed (`design-system/`: tokens, fonts, Tailwind preset; components TBD in app) | Val | lifecycle status tokens map 1:1 to `plans.status`/`plan_steps.status`; no hardcoded hex; see [design-context](context/design-context.md) |
| | _Cash-price provider_ | | open |
| | _Hosted platform choice_ | | open |

---

## Risk watch (per lane)

- **Alan — dependency-tracking scope creep:** hold the MVP cut. Plan nodes only, explicit reads only, no transitive. Document the locking strategy for Michael.
- **Val — demo blocked on backend:** build on mocked streaming events from Day 3, wire real events Days 5-7. Do not wait.
- **Michael — weak baselines:** the free-text baseline must be well-tuned CrewAI, same agents and tools (JSON instead of graph fragments). Baseline quality is a first-class deliverable.
- **Michael — Layer 4 timeline:** hard go/no-go Day 10. If not converging, cut cleanly. A half-working ingestion agent that corrupts the graph is worse than none.
- **All — Phase A3 contracts:** app lanes may use mocks until JSON Schema + codegen land.

---

## Links

- Schema spec (current): [docs/architecture/schema-final.md](docs/architecture/schema-final.md) **v3.1**
- Canonical DDL: [schema/schema.sql](schema/schema.sql)
- Schema v2 (historical): [docs/architecture/schema-v2.md](docs/architecture/schema-v2.md)
- Architecture context: [context/architecture-context.md](context/architecture-context.md)
- Risk register: [context/risks-and-failure-modes.md](context/risks-and-failure-modes.md)
- Schema checklist (historical Day 1): [docs/meetings/schema-lock-decision-checklist.md](docs/meetings/schema-lock-decision-checklist.md)
- ADRs: [docs/adr/](docs/adr/) — [0002](docs/adr/0002-mvp-scope-trim.md) research apparatus; [0003](docs/adr/0003-team-four-eval-ownership.md) team + Layer 4 cut
- Per-person tracking: [tracking/](tracking/)
- Linear project: Rewards Agent — Typed Graph Sprint (RCG)
