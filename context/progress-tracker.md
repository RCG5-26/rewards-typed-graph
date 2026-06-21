# Progress Tracker — [Project Name]

> Current state of the project. Update after each meaningful milestone or phase change.

**Last updated:** 2026-06-21 by Alan

---

## Current phase

**Phase:** [e.g. Schema lock | MVP build | Benchmark | Polish]  
**Target date:** [YYYY-MM-DD] _(optional)_  
**Active focus:** [one sentence — what the team is trying to finish *now*]

---

## Current goal

[The single outcome that defines "this week" or "this sprint."]

---

## Completed

_Check off or list with date. Keep recent; archive old phases elsewhere if needed._

- [x] PR #2 plan lifecycle alignment — 2026-06-21 — preserved v3.1 lineage/revision semantics in MVP polymorphic storage.
- [x] PR #2 operational schema alignment — 2026-06-21 — added user-scoped graph mutations, re-plan jobs, idempotency records, eval tables, and atomic transfer write path.
- [x] PR #2 v3.1 operational naming alignment — 2026-06-21 — renamed operational columns to v3.1 vocabulary (`clerk_id`, `mutation_txn_id`, `source_plan_id`, `operation_type`, `result_reference`, lease fields).
- [ ] [Unit / milestone] — [YYYY-MM-DD] — [one-line note]
- [ ] [Unit / milestone] — [date] — [note]

---

## In progress

| Item | Owner | Blocked on | Notes |
|---|---|---|---|
| [Task or feature spec ID] | [Name] | [nothing / dependency] | [short status] |

---

## Next up

1. [Next prioritized item]
2. [Next prioritized item]
3. [Next prioritized item]

---

## Open questions

_Unresolved ambiguities. Link to feature spec or decision if applicable._

| # | Question | Owner | Status |
|---|---|---|---|
| 2 | Does ADR 0004 storage-only compromise have all-four lane sign-off? | Alan/Raq | open |
| 1 | [Question] | [Name] | open / resolved → see decisions-log |

---

## Gates / milestones _(optional)_

| Gate | Date | Status | Criteria |
|---|---|---|---|
| [e.g. MVP demo] | [date] | ☐ open / ☑ done | [what must be true] |

---

## Session notes _(optional — scratch pad)_

Brief bullets from recent work sessions. Trim when stale.

- [YYYY-MM-DD]: [note]
- 2026-06-21: PR #2 updated so polymorphic storage keeps v3.1 plan lineage/revision and supersede-on-success semantics.
- 2026-06-21: PR #2 updated with operational tables required for async re-plan, SSE replay, idempotent transfers, and ADR 0002 benchmark storage.
- 2026-06-21: Operational tables now use v3.1 names even under polymorphic storage; ADR 0004 remains the unresolved all-lane sign-off item.

---

## Related

- Feature specs: [`feature-specs/`](feature-specs/)
- Decisions: [`decisions-log.md`](decisions-log.md)
