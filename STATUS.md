# Team Status Board

**Weekly snapshot** for standup, gates, and blockers. **Raq (lead) syncs this** from [`tracking/`](tracking/) + **Linear** before standup — lane owners do **not** edit this file in feature PRs.

| Where | Who | Cadence |
|---|---|---|
| **Linear** (RCG-##) | Each person | Daily — live task board |
| **`tracking/<lane>.md`** | Each person | Daily — tiny PR, merge same day |
| **`STATUS.md` (this file)** | Lead | Before standup / gates |
| **`context/progress-tracker.md`** | Lead | When a spec or PR lands |

**Live demo:** Mon June 29 (10 min) · **Today:** Jun 23 · **Phase:** **Integration sprint** — hero path to green; everything else is secondary until MVP gate passes
**The one constraint:** coordination is state, not messages. Typed graph mutations only. Schema v3.1 locked for implementation; additive-only after lane sign-off.
**Linear:** live daily board (RCG tickets). This file is the **weekly repo snapshot** for gates and standup.

**Team:** Alan (A · Graph) · Val (B · Frontend) · Michael (C · Redemption/Eval + Layer 4) · Raq (D · Orchestrator, owner/lead)

---

## Integration sprint (Jun 23–25) — **only priority**

**MVP proof (EOD Jun 25):** this command passes on shared Postgres:

```bash
RUN_LIVE_POSTGRES_TESTS=1 PGDATABASE=rewards_test \
  python3 -m unittest tests.integration.test_hero_moment.HeroMomentIntegrationTest.test_hero_end_to_end -v
```

Full plan: [`docs/meetings/sprint-plan-jun25-27.md`](docs/meetings/sprint-plan-jun25-27.md)

| Owner | Deliverable | Due | Done when |
|---|---|---|---|
| **Alan** | RCG-8 seed + loader | **Jun 23 EOD** | `python3 scripts/load_seed.py fixtures/demo-seed.json` loads Tokyo persona |
| **Alan** | Shared `DATABASE_URL` / docker-compose (or hosted PG) | **Jun 23 EOD** | One connection string in team doc |
| **Alan** | RCG-13 staleness on hero path | **Jun 24** | `test_transfer_marks_dependent_plan_stale` passes (already close) |
| **Michael** | RCG-21 redemption graph-writer | **Jun 24** | `create_plan_step` + `record_state_dependency` via write service |
| **Michael** | Rebase/fix PR #14 | **Jun 23** | No blockers on merging or building on top |
| **Raq** | ~~Merge PR #15 (spec 05)~~ ☑ done | **Jun 23** | Orchestrator harness on `main` |
| **Raq** | `hero_flow.create_plan_from_query()` | **Jun 24** | Beat 1: query → plan + deps in Postgres |
| **Raq + Michael** | `hero_flow.replan_after_balance_transfer()` | **Jun 25** | Beat 2–3: stale → revision 2 `current` |
| **Val** | ~~Merge PR #13~~ ☑ done | **Jun 23** | Landing on `main` |
| **Val** | Plan view + stale styling | **Jun 25–26** | Mock stale events OK until SSE lands |

**Paused until hero green:** 30-query benchmark draft, Layer 4, contrast UI, baseline tuning, new DDL.

**Accountability:** Update your **`tracking/<lane>.md`** + **Linear** daily (even if blocked). No update = we assume you are blocked — say so explicitly. The lead syncs this grid before standup.

---

## Schema status (v3.1)

> Canonical spec: [`docs/architecture/schema-final.md`](docs/architecture/schema-final.md) **v3.1**. Canonical DDL: [`schema/schema.sql`](schema/schema.sql). Supersedes [`schema-v2.md`](docs/architecture/schema-v2.md) (historical). See [decisions log](context/decisions-log.md) D027 and [`architecture-context.md`](context/architecture-context.md).

| | State |
|---|---|
| Schema spec v3.1 authored ([`schema-final.md`](docs/architecture/schema-final.md)) | ☑ done |
| Canonical DDL committed ([`schema/schema.sql`](schema/schema.sql)) | ☑ done |
| DDL validated on clean PostgreSQL 16 | ☑ done |
| Shared types generated (`schema/types`) | ☑ done |
| JSON Schema contracts + codegen (Phase A3, RCG-61) | ☑ done (PR #2) |
| Dependency-tracking implementation (RCG-13) | ☐ not started |
| Seed fixture committed, stable IDs (RCG-8) | ☐ not started |
| All four lanes signed off on v3.1 (§13) | ☑ Alan ☑ Val ☑ Michael ☑ Raq ([ADR 0001](docs/adr/0001-schema-lock.md)) |
| **Implementation wiring on real contracts** | ◐ in progress — generated types in PR #2; app lanes wire next |

**Architecture locked (v3.1):** plan revision lifecycle via `plans.status` / `plan_steps.status` (no `is_current`, no `plan_steps.is_stale`); durable `replan_jobs` with leases; `graph_mutations` as user-scoped audit/SSE replay only (not a work queue).

Lock date: **2026-06-18** (ADR 0001 Accepted; merged to `main` via PR #6)

---

## Standup grid

**Lead-maintained** — synced from [`tracking/`](tracking/) + Linear before standup. Format: short phrases, not paragraphs.

| Person | Yesterday | Today | Blocked on |
|---|---|---|---|
| Alan · Graph | _sync from tracking_ | RCG-8 seed + shared PG URL | _none / say what_ |
| Val · Frontend | PR #13 merged (landing on `main`) | Plan view + stale styling on mocks | _none / say what_ |
| Michael · Redemption | _sync from tracking_ | RCG-21 graph-writer → hero Beat 1 | _none / say what_ |
| Raq · Orchestrator (owner, lead) | PR #15 + PR #13 merged; status workflow | Wire `create_plan_from_query` (Beat 1) | Alan seed + Michael RCG-21 |

---

## Active blockers

Raq clears these. Add a line when blocked, strike it when cleared.

- ~~**App lanes → real contract wiring**~~ — PR #2 merged; **hero integration** is the blocker now.
- **Hero path not wired** — needs Alan RCG-8 + Michael RCG-21 + Raq `hero_flow` (see Integration sprint above).
- **Person C DB writes** — planner/scorer offline green; graph-write path (spec 02) needed for RCG-21 persistence.

---

## Gate tracker

| Gate | Day | Date | Status | Owner |
|---|---|---|---|---|
| Schema v3.1 spec + DDL authored + locked | 1–2 | Jun 18 | ☑ done | Alan + Raq |
| End-to-end demo path working (Layers 1-3 + Hero Moment 1) | 7 | Jun 23 | ☐ **slipped** — recovery sprint Jun 23–25 | Raq |
| **MVP hero test green** | — | **Jun 25** | ☐ open | Raq + Michael |
| Layer 4 GO / NO-GO | 10 | Jun 26 | ☐ open | Raq (lane: Michael) |
| **Live demo** (10 min) | 13 | Jun 29 | ☐ open | all |

Rule: if the Day 7 gate slips, cut scope, do not extend. Week 2 is polish and benchmark, not new features. Hosted platform and demo script must be ready **before the June 29 live demo** — no separate rehearsal date is scheduled.

---

## Phase timeline

**Current: Jun 23** — integration sprint; Jun 25 MVP gate is the line in the sand.

| Days | Dates | Focus |
|---|---|---|
| 1-3 | Jun 17-19 | ✅ Alan: v3.1 spec + DDL + CI. Raq: scope/board + schema lock. Val: Card API research, design system, wireframes. Michael: traversal planning. |
| 3-5 | Jun 19-21 | ✅ Phase A3 contracts; design system; specs 02–06. Michael: Person C fixture planner/scorer (PR #14). |
| 5-7 | Jun 21-23 | Integration sprint — hero path, orchestrator on `main`, Val landing on `main`. |
| 7-10 | Jun 23-26 | Benchmark runs; baselines; Layer 4 go/no-go at Day 10. |
| 10-14 | Jun 26-29 | Demo polish. Head-to-head contrast UI. |

---

## Decisions log

Append one line per real decision. (Historical v2 open items resolved in schema-final v3.1 — see [`decisions-log.md`](context/decisions-log.md).)

| Date | Decision | Who | Notes |
|---|---|---|---|
| Jun 17 | Coordination is typed mutations only, no free text | team | hard constraint |
| Jun 17 | Schema additive-only after lock; changes go through Raq | team | |
| Jun 18 | schema-final v3.1 + `schema.sql` locked on `main` | Alan + Raq | D027; DDL validated PG 16; ADR 0001 Accepted; PR #6 |
| Jun 18 | Closeout infra: plan-lineage/`replan_jobs`, `graph_mutations`, per-user advisory lock, runtime topology, contracts/codegen | team | ADRs 0004–0008 |
| Jun 20 | Keep the research apparatus (benchmark + both baselines + eval) | team | [ADR 0002](docs/adr/0002-mvp-scope-trim.md) |
| Jun 20 | Team = 4 (Ruijing out); Layer 4 cut-by-default; eval harness = whole-team, **Raq DRI**; single-agent baseline → Raq | team | [ADR 0003](docs/adr/0003-team-four-eval-ownership.md); Linear reconciled |
| Jun 21 | Design system landed (`design-system/`: tokens, fonts, Tailwind preset; components TBD in app) | Val | lifecycle status tokens map 1:1 to `plans.status`/`plan_steps.status`; no hardcoded hex; see [design-context](context/design-context.md) |
| Jun 21 | Feature-spec system + specs 02–06; implement-prompt + source-of-truth map | Raq | `context/feature-specs/` |
| | _Cash-price provider_ | | open |
| | _Hosted platform choice_ | | open |

---

## Risk watch (per lane)

- **Board lags code:** Alan's DDL/types/CI shipped but several Linear tickets (e.g. RCG-7/9) are still Backlog — reconcile ticket statuses at standup so the board reflects reality.
- **Alan — dependency-tracking scope creep:** hold the MVP cut. Plan nodes only, explicit reads only, no transitive. Document the locking strategy for Michael.
- **Val — demo blocked on backend:** build on mocked streaming events; wire real events Days 5-7. Do not wait.
- **Michael — weak baselines:** the free-text baseline must be well-tuned CrewAI, same agents and tools (JSON instead of graph fragments). Baseline quality is a first-class deliverable.
- **Michael / Raq — eval load:** Michael carries redemption + benchmark + CrewAI baseline; Raq carries the eval-harness DRI + single-agent baseline on top of orchestration. Protect the hero + the Day 7 path first.
- **Michael — Layer 4 timeline:** hard go/no-go Day 10. If not converging, cut cleanly. A half-working ingestion agent that corrupts the graph is worse than none.
- **All — Phase A3 contracts:** app lanes may use mocks until JSON Schema + codegen land.

---

## Links

- Schema spec (current): [docs/architecture/schema-final.md](docs/architecture/schema-final.md) **v3.1** · Canonical DDL: [schema/schema.sql](schema/schema.sql)
- Architecture context: [context/architecture-context.md](context/architecture-context.md) · Risk register: [context/risks-and-failure-modes.md](context/risks-and-failure-modes.md)
- Feature specs: [context/feature-specs/](context/feature-specs/) · Workflow + implement prompt: [context/ai-workflow-rules.md](context/ai-workflow-rules.md)
- ADRs: [docs/adr/](docs/adr/) — [0001](docs/adr/0001-schema-lock.md) schema lock · [0002](docs/adr/0002-mvp-scope-trim.md) research apparatus · [0003](docs/adr/0003-team-four-eval-ownership.md) team + Layer 4
- Per-person tracking: [tracking/](tracking/) · Linear project: Rewards Agent — Typed Graph Sprint (RCG)
