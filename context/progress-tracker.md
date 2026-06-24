# Progress Tracker — Rewards Typed Graph (RCG)

> Current state of the project. Update after each meaningful milestone or phase change.

**Last updated:** 2026-06-23 by Raq — merge PR #14 (Person C scorer) onto `main`

### How to update (all lanes)

This file is **team-wide AI working memory** — milestone narrative, not daily standup.

| You want to… | Who | Update here | Also update |
|---|---|---|---|
| Finish a spec, PR, or gate | Lead (or spec owner if required) | **Completed** — one line: `[owner]` + `RCG-##` + date + files/gotcha | Spec header → `Done`; PR template docs checkbox |
| Start or continue work | Lead | **In progress** table — owner, blocker, short note | Spec header → `In progress` |
| Shift sprint focus | Lead | **Current phase** / **Current goal** / **Active focus** | Standup agreement; sync `STATUS.md` |
| Resolve or raise ambiguity | Anyone → lead | **Open questions** | [`decisions-log.md`](decisions-log.md) if it becomes a decision |

**Daily lane status:** each person → [`tracking/<lane>.md`](../tracking/) (tiny PR) + **Linear**. **Do not** update this file or `STATUS.md` in feature PRs.

When **Completed** grows past ~15 items for the current phase, move older bullets to [`progress-archive.md`](progress-archive.md).

---

## Current phase

**Phase:** MVP build (integration sprint)  
**Active focus:** Wire orchestrator to spec 02 write path + hero path (RCG-28/29/32); Michael RCG-21 graph-writer; Person C planner/scorer landed (PR #14); PR #15 + PR #13 on `main`

---

## Current goal

Wire `create_plan_from_query()` and the hero path (RCG-28/29/32) against Alan's real graph-write adapters — `test_hero_end_to_end` green in Postgres before the Jun 25 gate. Person C planner/scorer (PR #14) feeds the RCG-21 graph-writer.

---

## Completed

_Check off or list with date. Keep recent; archive old phases elsewhere if needed._

- [x] **Person C offline slice (PR #14)** — 2026-06-23 — Tokyo Hyatt fixture, deterministic planner, seeded award tool, 11-case benchmark tests, offline scorer (`python -m benchmark.person_c_scorer --pretty`). Typed fixture path: 11/11 accuracy, 0 strict hallucinations, 2/2 invalidation. Review fixes: query-scoped fallback diagnostics; Chase balance slug lookup for invalidation scoring.
- [x] PR #13 — GPFree marketing landing (Val) — 2026-06-23 — merged to `main`; design-system conform, Next.js shell at repo root (migrates to `apps/web` per ADR 0004).
- [x] Spec 05 — Orchestrator + agent harness (RCG-15) — 2026-06-23 — merged to `main` ([PR #15](https://github.com/RCG5-26/rewards-typed-graph/pull/15)); 43 tests, typecheck clean. **Gotcha:** when `finalizeAgentRun(failed)` throws during cleanup, AgentRun may remain `running` — primary agent error is not overwritten. Documented in spec 05 §10.3.
- [x] Hero moment test skeleton — 2026-06-22 — `tests/integration/test_hero_moment.py` + `hero_flow.py` seams; DB-path test for transfer → stale; hardened PGDATABASE guard; `NotImplementedError` fails (not skips) on e2e path.
- [x] Orchestration flow doc — 2026-06-22 — `docs/architecture/orchestration-flow.md` companion to spec 05.
- [x] PR #2 operational schema alignment — 2026-06-21 — added user-scoped graph mutations, re-plan jobs, idempotency records, eval tables, and atomic transfer write path.
- [x] PR #2 v3.1 operational naming alignment — 2026-06-21 — renamed operational columns to v3.1 vocabulary (`clerk_id`, `mutation_txn_id`, `source_plan_id`, `operation_type`, `result_reference`, lease fields).
- [x] PR #2 canonical schema split — 2026-06-21 — restored v3.1 table-per-type as default and moved polymorphic storage to `schema/experimental/polymorphic/`.
- [x] Re-plan promotion lineage guard — 2026-06-21 — `promote_replan_job_success` rejects result plans that do not directly supersede the source plan.
- [x] Re-plan claim attempt cap — 2026-06-21 — `claim_replan_jobs` skips jobs whose attempts reached `max_attempts`.
- [x] Transfer idempotency in-progress guard — 2026-06-21 — `transfer_points` rejects duplicate calls while the matching idempotency key is `in_progress`.
- [x] Transfer idempotency upsert claim — 2026-06-21 — canonical `transfer_points` claims idempotency records with `INSERT ... ON CONFLICT DO UPDATE` before lock-read/replay checks.
- [x] RCG-10 canonical mutation layer — 2026-06-21 — `V31GraphWriteService` validates plan, plan-step, state-dependency, and `TransferPoints` mutations before write SQL.
- [x] v3.1 staleness DDL drift fix — 2026-06-21 — removed `plan_steps.staled_at` and restored the `user_balances` trigger backstop without job enqueue.
- [x] `graph_mutations` contract alignment — 2026-06-21 — restored ADR 0008/main DDL shape and mapped write-path logging into `mutation_type` event rows.
- [x] Live `TransferPoints` service coverage — 2026-06-21 — `V31GraphWriteService.transfer_points` now runs against real Postgres in CI for debit/credit, replay, and re-plan enqueue.
- [x] Mutation adapter SQL hardening — 2026-06-21 — replaced dynamic target-table interpolation with hardcoded reference queries.
- [x] GPFree landing → design-system conform — 2026-06-22 — re-themed the cinematic landing to Malleable UI tokens (light surfaces, iris accent, SF Pro/Fira Code); no hardcoded hex/px/easing; wired `global.css` + dropped `next/font`; split into `components/gpfree/` (cinema engine hook + HeroStage/HowItWorks/SiteFooter).
- [x] Phase A3 JSON Schema + codegen (RCG-61) — 2026-06-21 — landed in PR #2; `schema/contracts/` + generated types exist. App-lane wiring into `apps/api` still pending.

---

## In progress

| Item | Owner | Blocked on | Notes |
|---|---|---|---|
| RCG-28/29/32 — `create_plan_from_query()` + hero path | Raq | Alan seed + Michael RCG-21 | Spec 05 on `main`; `hero_flow.py` Beats 1–3 wired to write path |
| Spec 02 — real graph-write adapters | Alan | — | `OrchestratorGraphWrite` / `AgentCommitFactory` behind Postgres |
| RCG-21 — redemption graph-writer | Michael | Spec 02 interface | Map PR #14 planner output → `create_plan_step` + `record_state_dependency` |
| RCG-11–14 — graph infrastructure | Alan | — | OCC, traversal, deps, mutation log |
| RCG-24/27/26 — demo UI on mocks | Val | Alan RCG-14 event shape | Parallel to hero |

---

## Next up

1. **RCG-21** — Michael maps planner → graph-write (unblocks hero Beat 1)
2. **RCG-28** — wire orchestrator → write path; implement `create_plan_from_query()` (Beat 1)
3. **RCG-29 / RCG-32** — `replan_after_balance_transfer()` + `test_hero_end_to_end` green (Jun 25 gate)
4. Spec 02 — real graph-write adapters (Alan)
5. **RCG-16 / RCG-17** — wallet + earning agents (spec 06)
6. Wire generated mutation types into `apps/api` (replace temporary `SpecialistMutation` union per ADR 0007)
7. Baseline runners (Michael) — post-hero

---

## Open questions

| # | Question | Owner | Status |
|---|---|---|---|
| 1 | Hosted platform choice (Vercel + Railway/Render PG) | Raq | open — see `STATUS.md` |
| 2 | Eval config / model budget for baselines | Michael + Raq | open |
| 3 | Does ADR 0004 storage-only compromise have all-four lane sign-off? | Alan/Raq | resolved → no; polymorphic path is experimental only |

---

## Gates / milestones

| Gate | Date | Status | Criteria |
|---|---|---|---|
| Schema v3.1 lock | 2026-06-18 | ☑ done | ADR 0001; DDL on `main` |
| Person C offline scorer | 2026-06-23 | ☑ done | PR #14; 11/11 on fixture cases |
| End-to-end demo path (Layers 1–3 + Hero Moment 1) | 2026-06-23 | ☐ open | RCG-32; `test_hero_end_to_end` passes |
| MVP hero green | 2026-06-25 | ☐ open | Beat 1–3 in Postgres; revision 2 `current` |
| Layer 4 GO / NO-GO | 2026-06-26 | ☐ open | Raq call; Michael lane |
| Live demo (10 min) | 2026-06-29 | ☐ open | Hosted URL + demo script (RCG-47) |

---

## Session notes _(optional — scratch pad)_

- 2026-06-23: Merged PR #14 onto `main` — Person C planner/scorer + conflict resolution in STATUS/progress-tracker.
- 2026-06-23: PR #15 + PR #13 on `main`; hero integration test skeleton in place.
- 2026-06-22: Person C executable slice: `agents/redemption/`, `benchmark/person_c_scorer.py`, 11 eval cases.

- 2026-06-23: Addressed CodeRabbit review on PR #15 — `failInvocation` persistence fix, hero test PGDATABASE allowlist, removed `NotImplementedError` → skip masking; documented accepted deferrals (idempotency scoping, stale→current guard, JSON Schema contracts).
- 2026-06-22: Spec 05 lifecycle error-handling hardening; 43 Vitest tests; spec marked Done; AI_USAGE entries 006/007 reconciled.
- 2026-06-22: Added hero moment integration skeleton + orchestration-flow architecture doc.
- 2026-06-22: Replaced stale-plan view string coverage with a live PostgreSQL 16 schema-artifact contract test for `stale_plan_steps`.
- 2026-06-21: Completed TDD-covered RCG-10 schema-lane mutation adapter in `schema/mutations.py` for plan, plan-step, state-dependency, and `TransferPoints` writes.
- 2026-06-21: PR #2 operational write path + Phase A3 contracts merged; canonical v3.1 restored.

**Run Person C tests:** `python -m unittest discover -s tests -v`  
**Scorer report:** `python -m benchmark.person_c_scorer --pretty`

---

## Related

- Feature specs: [`feature-specs/`](feature-specs/)
- Decisions: [`decisions-log.md`](decisions-log.md)
- Team board: [`../STATUS.md`](../STATUS.md)
- Person C docs: [`../docs/implementation/person-c-redemption-traversal.md`](../docs/implementation/person-c-redemption-traversal.md)
