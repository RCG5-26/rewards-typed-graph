# Progress Tracker - Rewards Typed Graph (RCG)

> Current state of the project. Update after each meaningful milestone or phase change.

**Last updated:** 2026-06-24 — PR #27: RCG-8 seed + RCG-9 dev Postgres + RCG-21 graph writer

---

## Current phase

**Phase:** MVP build (integration sprint)
**Active focus:** Merge PR #27; live hero gate verification; RCG-21 graph-writer + docker dev DB

---

## Current goal

`test_hero_end_to_end` green by EOD Jun 25; Person C planner/scorer now feeds the DB graph-writer.

---

## Completed

_Check off or list with date. Keep recent; archive old phases elsewhere if needed._

- [x] **RCG-9 dev Postgres** — 2026-06-24 — `docker-compose.yml`, `.env.example`, `scripts/dev-db-setup.sh`; team `DATABASE_URL` (PR #27).
- [x] **RCG-21 redemption graph-writer** — 2026-06-24 — `redemption_graph_writer.py` maps planner → `V31GraphWriteService`; hero flow uses replan job path (PR #27).
- [x] **Person C offline slice (PR #14)** - 2026-06-23 - Tokyo Hyatt fixture, deterministic planner, seeded award tool, 11-case benchmark tests, offline scorer (`python -m benchmark.person_c_scorer --pretty`). Typed fixture path: 11/11 accuracy, 0 strict hallucinations, 2/2 invalidation. Review fixes: query-scoped fallback diagnostics; Chase balance slug lookup for invalidation scoring.
- [x] **RCG-8 demo seed fixture** - 2026-06-23 - `fixtures/demo-seed.json` + `scripts/load_seed.py` lock stable IDs for 5 cards, 3 programs, 240,000 points, Chase-to-Hyatt/United transfer routes, and the Tokyo hero goal.
- [x] PR #13 - GPFree marketing landing (Val) - 2026-06-23 - merged to `main`.
- [x] Spec 05 - Orchestrator + agent harness (RCG-15) - 2026-06-23 - merged to `main` ([PR #15](https://github.com/RCG5-26/rewards-typed-graph/pull/15)); 43 tests, typecheck clean.
- [x] Hero moment test skeleton - 2026-06-22 - `tests/integration/test_hero_moment.py` + `hero_flow.py` seams.
- [x] PR #2 operational schema alignment - 2026-06-21 - user-scoped graph mutations, re-plan jobs, idempotency, eval tables, atomic transfer write path.
- [x] RCG-10 canonical mutation layer - 2026-06-21 - `V31GraphWriteService` for plan, plan-step, state-dependency, `TransferPoints`.
- [x] Phase A3 JSON Schema + codegen (RCG-61) - 2026-06-21 - `schema/contracts/` + generated types in PR #2.
- [x] GPFree landing to design-system conform - 2026-06-22 - Val; tokens + `components/gpfree/`.

---

## In progress

| Item | Owner | Blocked on | Notes |
|---|---|---|---|
| **RCG-28/29/32** hero path | Raq | live Postgres verification | `hero_flow.py` Beats 1-3 now wired through RCG-21 graph-writer |
| **RCG-11-14** graph infrastructure | Alan | - | OCC, traversal, deps, mutation log |
| **RCG-24/27/26** demo UI on mocks | Val | Alan RCG-14 event shape | Parallel to hero |

---

## Next up

1. **RCG-28/29/32** - Raq runs the live Postgres hero path end-to-end and closes remaining orchestration gaps.
2. Spec 02 - real graph-write adapters (Alan).
3. Baseline runners (Michael) - post-hero.

---

## Open questions

| # | Question | Owner | Status |
|---|---|---|---|
| 1 | Hosted platform choice | Raq | open |
| 2 | Eval config / model budget for baselines | Michael + Raq | open |
| 3 | ADR 0004 storage-only compromise sign-off | Alan/Raq | resolved → polymorphic experimental only |
| 4 | Does RCG-9 require canonical single-table JSONB `nodes`/`edges`? | Alan/Raq | resolved → ADR 0001 v3.1 table-per-type; docker-compose dev DB in PR #27 |

---

## Gates / milestones

| Gate | Date | Status | Criteria |
|---|---|---|---|
| Schema v3.1 lock | 2026-06-18 | done | ADR 0001 |
| Person C offline scorer | 2026-06-23 | done | PR #14; 11/11 on fixture cases |
| RCG-21 graph-writer bridge | 2026-06-24 | done locally | Unit tests green after latest `main` merge; live hero test skipped unless Postgres env and `psql` are enabled |
| MVP hero green | 2026-06-25 | open | `test_hero_end_to_end` passes with live Postgres |
| Live demo (10 min) | 2026-06-29 | open | Hosted URL + demo script |

---

## Session notes _(optional — scratch pad)_

- 2026-06-24: PR #27 combines RCG-8 seed, RCG-9 docker dev DB, and RCG-21 graph-writer on latest `main`.
- 2026-06-24: Reconciled RCG-9 with `main`; canonical Postgres remains v3.1 table-per-type.
- 2026-06-23: RCG-21 graph-writer bridge — Person C planner writes through `V31GraphWriteService`.
- 2026-06-23: Merged PR #14 onto `main` — Person C planner/scorer.
- 2026-06-23: Added RCG-8 canonical demo seed fixture and loader.
- 2026-06-23: PR #15 + PR #13 on `main`; hero integration test skeleton in place.
- 2026-06-22: Person C executable slice: `agents/redemption/`, `benchmark/person_c_scorer.py`, 11 eval cases.

**Run Person C tests:** `python -m unittest discover -s tests -v`
**Scorer report:** `python -m benchmark.person_c_scorer --pretty`

---

## Related

- Feature specs: [`feature-specs/`](feature-specs/)
- Decisions: [`decisions-log.md`](decisions-log.md)
- Team board: [`../STATUS.md`](../STATUS.md)
- Person C docs: [`../docs/implementation/person-c-redemption-traversal.md`](../docs/implementation/person-c-redemption-traversal.md)
