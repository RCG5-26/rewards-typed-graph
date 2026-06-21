# Team Status Board

The shared source of truth for the sprint. Update your own row before standup. Keep it skimmable.

**Demo:** Mon June 29 (10 min live) · **Today:** Day 1, Wed June 17 · **Phase:** Schema Lock
**The one constraint:** coordination is state, not messages. Typed graph mutations only. Schema locked Day 1, additive-only after.
**Linear:** optional backbone (milestones + gates). This board is the daily driver. Task ids below map to `RCG-##` in Linear.

**Team:** Alan (A · Graph) · Val (B · Frontend) · Michael (C · Redemption/Eval + Layer 4) · Raq (D · Orchestrator, owner/lead)

---

## Schema lock status (everything waits on this)

> Nobody writes an agent until this is signed off. See [schema checklist](docs/meetings/schema-lock-decision-checklist.md), [Day 1 agenda](docs/meetings/2026-06-17-agenda.md), [schema prep doc](docs/meetings/schema-prepdoc-meeting1.md), [schema spec](docs/architecture/schema-v2.md), and [ADR 0001](docs/adr/0001-schema-lock.md).

| | State |
|---|---|
| Schema spec drafted (Alan, RCG-6) | ☐ not started |
| Nine open decisions closed | ☐ 0 / 9 |
| Canonical schema artifact committed (RCG-7) | ☐ not started |
| Seed fixture committed, stable IDs (RCG-8) | ☐ not started |
| All four lanes signed off | ☐ Alan ☐ Val ☐ Michael ☐ Raq |
| **SCHEMA LOCKED** | ☐ not yet |

Lock date: __________

---

## Standup grid

Update only your own row. Format: short phrases, not paragraphs.

| Person | Yesterday | Today | Blocked on |
|---|---|---|---|
| Alan · Graph | kickoff | Draft schema spec (RCG-6); align PR #2 plan lifecycle with v3.1 lineage/revision semantics | nothing |
| Val · Frontend | kickoff | Set up demo shell scaffold; design sidebar against mock events (RCG-24, RCG-27) | nothing (works on mocks) |
| Michael · Redemption | kickoff | Paper-design redemption traversal (RCG-20); does not wait on lock | nothing |
| Raq · Orchestrator (owner, lead) | kickoff | Review schema; scaffold orchestrator + agent harness (RCG-15) | schema draft from Alan |

---

## Active blockers

Raq clears these. Add a line when blocked, strike it when cleared.

- _none yet_

---

## Gate tracker

| Gate | Day | Date | Status | Owner |
|---|---|---|---|---|
| Schema locked | 1 | Jun 17 | ☐ open | Alan + Raq |
| End-to-end demo path working (Layers 1-3 + Hero Moment 1) | 7 | Jun 23 | ☐ open | Raq |
| Layer 4 GO / NO-GO | 10 | Jun 26 | ☐ open | Raq (lane: Michael) |
| Demo rehearsed, numbers in | 13 | Jun 29 | ☐ open | all |

Rule: if the Day 7 gate slips, cut scope, do not extend. Week 2 is polish and benchmark, not new features.

---

## Phase timeline

| Days | Dates | Focus |
|---|---|---|
| 1-3 | Jun 17-19 | Alan: lock schema + Postgres graph layer (everyone blocked on this). Raq: scaffold orchestrator + harness. Michael: paper-design redemption traversal. Val: sidebar on mock data. |
| 3-5 | Jun 19-21 | Alan: dependency tracking (plan nodes only, no transitive). Raq: ship wallet + earning agents. Michael: redemption agent + award-search tool (fixtures). Val: sidebar building. |
| 5-7 | Jun 21-23 | Full Layer 1-3 integration, end-to-end demo path. Val: wire real streaming events. Michael: connect real cash-price tool, start benchmark fixtures. |
| 7-10 | Jun 23-26 | Benchmark runs across all three architectures. Michael builds + tunes both baselines. Layer 4 go/no-go at Day 10. |
| 10-14 | Jun 26-29 | Demo polish + rehearsal. Head-to-head contrast UI. Adversarial verifier set if Layer 4 landed. |

---

## Decisions log

Append one line per real decision. This is the lightweight ADR. (DECIDE items are the nine open schema choices.)

| Date | Decision | Who | Notes |
|---|---|---|---|
| Jun 17 | Coordination is typed mutations only, no free text | team | hard constraint |
| Jun 17 | Schema additive-only after lock; changes go through Raq | team | |
| Jun 17 | Layer 4 (ingestion + verifier) owned by Michael | team | hard-cuttable at Day 10 |
| | _A1: single-table + JSONB vs table-per-type_ | | open |
| | _B4: ratios as rational vs float_ | | open |
| | _C2: concurrency version vs effective-dating_ | | open |
| | _D2: where observed read-version lives_ | | open |
| | _E4: mutation ownership matrix_ | | open |
| | _Day 10: Layer 4 go or no-go_ | | open |

---

## Risk watch (per lane)

- **Alan — dependency-tracking scope creep:** hold the MVP cut. Plan nodes only, explicit reads only, no transitive. 200-300 lines. Document the locking strategy for Michael.
- **Val — demo blocked on backend:** build on mocked streaming events from Day 3, wire real events Days 5-7. Do not wait.
- **Michael — weak baselines:** the free-text baseline must be well-tuned CrewAI, same agents and tools (JSON instead of graph fragments). Baseline quality is a first-class deliverable.
- **Michael — Layer 4 timeline:** hard go/no-go Day 10. If not converging, cut cleanly. A half-working ingestion agent that corrupts the graph is worse than none.
- **All — schema lock:** no mitigation but discipline on Day 1.

---

## Links

- Schema checklist: [docs/meetings/schema-lock-decision-checklist.md](docs/meetings/schema-lock-decision-checklist.md)
- Day 1 agenda: [docs/meetings/2026-06-17-agenda.md](docs/meetings/2026-06-17-agenda.md)
- Schema prep doc: [docs/meetings/schema-prepdoc-meeting1.md](docs/meetings/schema-prepdoc-meeting1.md)
- Schema spec: [docs/architecture/schema-v2.md](docs/architecture/schema-v2.md)
- Schema lock ADR: [docs/adr/0001-schema-lock.md](docs/adr/0001-schema-lock.md)
- Per-person tracking: [tracking/](tracking/)
- Linear project: Rewards Agent — Typed Graph Sprint (RCG)
