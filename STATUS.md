# Team Status Board

The shared source of truth for the sprint. Update your own row before standup. Keep it skimmable.

**Live demo:** Mon June 29 (10 min) - **Today:** Jun 23 - **Phase:** Integration sprint - hero path to green
**The one constraint:** coordination is state, not messages. Typed graph mutations only. Schema v3.1 locked for implementation; additive-only after lane sign-off.
**Linear:** optional backbone (milestones + gates). This board is the daily driver. Task ids below map to `RCG-##` in Linear.

**Team:** Alan (A - Graph) - Val (B - Frontend) - Michael (C - Redemption/Eval + Layer 4) - Raq (D - Orchestrator, owner/lead)

---

## Schema status (v3.1)

> Canonical spec: [`docs/architecture/schema-final.md`](docs/architecture/schema-final.md) **v3.1**. Canonical DDL: [`schema/schema.sql`](schema/schema.sql). Supersedes [`schema-v2.md`](docs/architecture/schema-v2.md) (historical). See [decisions log](context/decisions-log.md) D027 and [`architecture-context.md`](context/architecture-context.md).

| | State |
|---|---|
| Schema spec v3.1 authored ([`schema-final.md`](docs/architecture/schema-final.md)) | done |
| Canonical DDL committed ([`schema/schema.sql`](schema/schema.sql)) | done |
| DDL validated on clean PostgreSQL 16 | done |
| Shared types generated (`schema/types`) | done |
| JSON Schema contracts + codegen (Phase A3, RCG-61) | done (PR #2) |
| Dependency-tracking implementation (RCG-13) | not started |
| Seed fixture committed, stable IDs (RCG-8) | done |
| All four lanes signed off on v3.1 | done: Alan, Val, Michael, Raq ([ADR 0001](docs/adr/0001-schema-lock.md)) |
| **Implementation wiring on real contracts** | in progress - RCG-21 graph-writer bridge landed locally; app lanes wire next |

**Architecture locked (v3.1):** plan revision lifecycle via `plans.status` / `plan_steps.status` (no `is_current`, no `plan_steps.is_stale`); durable `replan_jobs` with leases; `graph_mutations` as user-scoped audit/SSE replay only (not a work queue).

Lock date: **2026-06-18** (ADR 0001 Accepted; merged to `main` via PR #6)

---

## Standup grid

Update only your own row. Format: short phrases, not paragraphs.
_Rows reflect repo + Linear evidence; each owner confirms/edits their own line at standup._

| Person | Yesterday | Today | Blocked on |
|---|---|---|---|
| Alan - Graph | Phase A3 + PR #2 operational write path; RCG-8 seed fixture locked with shared-loader default; RCG-9 reconciled to v3.1 table-per-type | RCG-11-14 (OCC, traversal, deps, mutation log) | nothing |
| Val - Frontend | **GPFree landing merged** (PR #13); design system | **Clerk Google-only auth** (`/sign-in`, middleware) + landing redesign (3D card); then demo shell + sidebar on mocks (RCG-27, RCG-24) | generated contracts for real payload wiring |
| Michael - Redemption | Offline scorer green; RCG-21 graph-writer bridge landed locally | RCG-21 branch synced with latest `main`; baseline runners next after hero path verification | eval config / model budget for baselines; live hero proof needs `psql` + test DB |
| Raq - Orchestrator (owner, lead) | Spec 05 merged (PR #15); hero test skeleton | RCG-28/29/32 live Postgres hero path verification | live Postgres gate |

---

## Active blockers

Raq clears these. Add a line when blocked, strike it when cleared.

- **MVP hero live verification** - `hero_flow.py` is wired through RCG-21, but `test_hero_end_to_end` still needs a live PostgreSQL run with `RUN_LIVE_POSTGRES_TESTS=1`; current local env lacks `psql`.
- **Baseline model budget** - Michael/Raq still need eval config and model budget decisions.

---

## Gate tracker

| Gate | Day | Date | Status | Owner |
|---|---|---|---|---|
| Schema v3.1 spec + DDL authored + locked | 1-2 | Jun 18 | done | Alan + Raq |
| RCG-21 redemption graph-writer bridge | - | Jun 23 | done locally | Michael |
| End-to-end demo path working (Layers 1-3 + Hero Moment 1) | 7 | Jun 23 | slipped - recovery Jun 23-25 | Raq |
| **MVP hero test green** | - | **Jun 25** | open | Raq + Michael |
| Layer 4 GO / NO-GO | 10 | Jun 26 | open | Raq (lane: Michael) |
| **Live demo** (10 min) | 13 | Jun 29 | open | all |

Rule: if the Day 7 gate slips, cut scope, do not extend. Week 2 is polish and benchmark, not new features. Hosted platform and demo script must be ready **before the June 29 live demo**; no separate rehearsal date is scheduled.

---

## Phase timeline

**Current: Jun 23** - integration sprint; Jun 25 MVP gate is the line.

| Days | Dates | Focus |
|---|---|---|
| 1-3 | Jun 17-19 | Done: Alan v3.1 spec + DDL + CI; Raq scope/board + schema lock; Val Card API research/design system/wireframes; Michael traversal planning. |
| 3-5 | Jun 19-21 | Done: Phase A3 contracts; design system; specs 02-06; Michael Person C fixture planner/scorer (PR #14). |
| 5-7 | Jun 21-23 | Integration sprint - hero path, orchestrator on `main`, Val landing/auth work on `main`, RCG-21 bridge landed locally. |
| 7-10 | Jun 23-26 | Benchmark runs; baselines; Layer 4 go/no-go at Day 10. |
| 10-14 | Jun 26-29 | Demo polish. Head-to-head contrast UI. |

---

## Decisions log

Append one line per real decision. Historical v2 open items resolved in schema-final v3.1; see [`decisions-log.md`](context/decisions-log.md).

| Date | Decision | Who | Notes |
|---|---|---|---|
| Jun 17 | Coordination is typed mutations only, no free text | team | hard constraint |
| Jun 17 | Schema additive-only after lock; changes go through Raq | team | |
| Jun 18 | schema-final v3.1 + `schema.sql` locked on `main` | Alan + Raq | D027; DDL validated PG 16; ADR 0001 Accepted; PR #6 |
| Jun 18 | Closeout infra: plan-lineage/`replan_jobs`, `graph_mutations`, per-user advisory lock, runtime topology, contracts/codegen | team | ADRs 0004-0008 |
| Jun 20 | Keep the research apparatus (benchmark + both baselines + eval) | team | [ADR 0002](docs/adr/0002-mvp-scope-trim.md) |
| Jun 20 | Team = 4 (Ruijing out); Layer 4 cut-by-default; eval harness = whole-team, **Raq DRI**; single-agent baseline to Raq | team | [ADR 0003](docs/adr/0003-team-four-eval-ownership.md); Linear reconciled |
| Jun 21 | Design system landed (`design-system/`: tokens, fonts, Tailwind preset; components TBD in app) | Val | lifecycle status tokens map 1:1 to `plans.status`/`plan_steps.status`; no hardcoded hex; see [design-context](context/design-context.md) |
| Jun 21 | Feature-spec system + specs 02-06; implement-prompt + source-of-truth map | Raq | `context/feature-specs/` |
| Jun 23 | Clerk auth wired **Google-only**, identity-only (`/sign-in`, `/sign-up`, `middleware.ts`) | Val | [ADR 0006](docs/adr/0006-clerk-identity-only.md); env keys in `.env.local` (`.env.example` committed) |
| Jun 23 | Landing replaced with self-contained 3D-card hero (D029); old `components/gpfree/` cinematic hero + frame assets removed | Val | ported from handoff; carries its own scoped theme (not design-system tokens) - see [design-context](context/design-context.md) |
| Jun 23 | Prettier added as formatter (`npm run format`) + AGENTS.md quality gates (format/lint/simplify/security review) | Val | ESLint already present; `eslint-config-prettier` wired |
| | _Cash-price provider_ | | open |
| | _Hosted platform choice_ | | open |

---

## Risk watch (per lane)

- **Board lags code:** Alan's DDL/types/CI shipped; RCG-9 is reconciled as v3.1 table-per-type in repo. Update Linear status/title at standup if it still says single-table JSONB.
- **Alan - dependency-tracking scope creep:** hold the MVP cut. Plan nodes only, explicit reads only, no transitive. Document the locking strategy for Michael.
- **Val - demo blocked on backend:** build on mocked streaming events; wire real events Days 5-7. Do not wait.
- **Michael - weak baselines:** the free-text baseline must be well-tuned CrewAI, same agents and tools (JSON instead of graph fragments). Baseline quality is a first-class deliverable.
- **Michael / Raq - eval load:** Michael carries redemption + benchmark + CrewAI baseline; Raq carries the eval-harness DRI + single-agent baseline on top of orchestration. Protect the hero + the Day 7 path first.
- **Michael - Layer 4 timeline:** hard go/no-go Day 10. If not converging, cut cleanly. A half-working ingestion agent that corrupts the graph is worse than none.
- **All - Phase A3 contracts:** app lanes may use mocks until JSON Schema + codegen land.

---

## Links

- Schema spec (current): [docs/architecture/schema-final.md](docs/architecture/schema-final.md) **v3.1** - Canonical DDL: [schema/schema.sql](schema/schema.sql)
- Architecture context: [context/architecture-context.md](context/architecture-context.md) - Risk register: [context/risks-and-failure-modes.md](context/risks-and-failure-modes.md)
- Feature specs: [context/feature-specs/](context/feature-specs/) - Workflow + implement prompt: [context/ai-workflow-rules.md](context/ai-workflow-rules.md)
- ADRs: [docs/adr/](docs/adr/) - [0001](docs/adr/0001-schema-lock.md) schema lock - [0002](docs/adr/0002-mvp-scope-trim.md) research apparatus - [0003](docs/adr/0003-team-four-eval-ownership.md) team + Layer 4
- Per-person tracking: [tracking/](tracking/) - Linear project: Rewards Agent - Typed Graph Sprint (RCG)
