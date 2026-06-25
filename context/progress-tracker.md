# Progress Tracker — Rewards Typed Graph (RCG)

> Current state of the project. Update after each meaningful milestone or phase change.

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

**Last updated:** 2026-06-25 — repo→Linear→docs reconciliation: API service (RCG-18) + hero path (RCG-28/29) merged to `main` and live-verified

---

## Current phase

**Phase:** MVP build (integration sprint) — backend hero path green; frontend integration next
**Active focus:** Wire the Next.js demo shell to the live API (RCG-27/25/26); browser run-through with a real Clerk token (RCG-32)

---

## Current goal

Backend hero flow is green on `origin/main` (PRs #27/#21/#14/#29/#30). Next: frontend consumes the live API + SSE; one end-to-end browser run-through with real Clerk auth closes the Day-7 gate.

---

## Completed

_Check off or list with date. Keep recent; archive old phases elsewhere if needed._

- [x] PR #2 plan lifecycle alignment — 2026-06-21 — preserved v3.1 lineage/revision semantics in MVP polymorphic storage.
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
- [x] RCG-14 SSE polling hardening — 2026-06-23 — serialized mutation-stream polling and caught poll failures to avoid cursor races/unhandled rejections.
- [x] Mutation replay cursor validation — 2026-06-23 — `GET /mutations` and SSE replay reject invalid cursors before repository queries.
- [x] RCG-14 API manifest merge — 2026-06-24 — preserved `@rewards-agent/api` metadata/tooling while adding Hono/Postgres/AJV dependencies.
- [x] RCG-14/25 spec 03 compliance pass — 2026-06-24 — added stream-boundary coverage for schema-valid SSE payloads and replay frames.
- [x] Mutation routes review follow-up — 2026-06-24 — REST replay events now validate against `mutationEventSchema`; route tests cover missing-user rejection.
- [x] Hono security range hardening — 2026-06-24 — raised API manifest floor to `^4.12.27` for Hono path/static-file advisories.
- [x] RCG-18 API service (spec 07) merged — 2026-06-25 — PR #29 to `main` @ f53aa36; Hono server + Clerk auth + CORS + 6 routes + SSE/REST mount + psql-subprocess hero bridge; 86 vitest + typecheck green; live HTTP + bridge + hero flow verified on Docker Postgres.
- [x] RCG-28/29 hero path green — 2026-06-25 — PR #20 wiring + PR #29 routes; live: create-plan (rev 1, 3 steps) → balance-transfer (rev 2 current, prior superseded, replan job) → current-plan → demo-reset.
- [x] RCG-63 e2e integration test — 2026-06-25 — `tests/integration/test_hero_moment.py` passes live (2 tests, RUN_LIVE_POSTGRES_TESTS=1).
- [x] RCG-52 graph eval instrumentation merged — 2026-06-25 — PR #30 to `main` @ 9a2bc77; `benchmark/graph_instrumentation.py` + eval tests; `unittest discover` 88 passed.
- [x] Canonical backend setup guide — 2026-06-25 — `docs/development/backend-local-setup.md` (frontend-facing: env, startup, contract, hero smoke test, troubleshooting).

---

## In progress

| Item                               | Owner | Blocked on                 | Notes                                                              |
| ---------------------------------- | ----- | -------------------------- | ------------------------------------------------------------------ |
| **RCG-32** Day-7 gate              | Raq   | frontend shell wiring + Clerk browser run | Backend path green & live-verified on `main`; blockers RCG-28/29 Done |
| **RCG-27/25/26** demo UI           | Val   | nothing (API + SSE live)   | Integrate against live API or mocks; see backend-local-setup guide |

---

## Next up

1. **RCG-27/25/26** - Val wires the demo shell + sidebar to the live API/SSE (or mocks); see [`../docs/development/backend-local-setup.md`](../docs/development/backend-local-setup.md).
2. **RCG-32** - one browser run-through of the hero flow with a real Clerk token closes the Day-7 gate.
3. **RCG-66** - graduate the Option B psql-subprocess bridge into a real graph-write boundary (post-demo).
4. Baseline runners + eval harness (Michael/Raq) - post-hero.

---

## Open questions

| #   | Question                                                         | Owner         | Status                                                                   |
| --- | ---------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------ |
| 1   | Hosted platform choice                                           | Raq           | open                                                                     |
| 2   | Eval config / model budget for baselines                         | Michael + Raq | open                                                                     |
| 3   | ADR 0004 storage-only compromise sign-off                        | Alan/Raq      | resolved → polymorphic experimental only                                 |
| 4   | Does RCG-9 require canonical single-table JSONB `nodes`/`edges`? | Alan/Raq      | resolved → ADR 0001 v3.1 table-per-type; docker-compose dev DB in PR #27 |

---

## Gates / milestones

| Gate                       | Date       | Status    | Criteria                                             |
| -------------------------- | ---------- | --------- | ---------------------------------------------------- |
| Schema v3.1 lock           | 2026-06-18 | done      | ADR 0001                                             |
| Person C offline scorer    | 2026-06-23 | done      | PR #14; 11/11 on fixture cases                       |
| RCG-21 graph-writer bridge | 2026-06-24 | done      | Merged PR #27; live hero test green with docker-compose |
| MVP hero green             | 2026-06-25 | done      | `test_hero_moment` passes live; API hero flow verified end-to-end |
| Live demo (10 min)         | 2026-06-29 | open      | Hosted URL + demo script; frontend wired to live API |

---

## Session notes _(optional — scratch pad)_

Brief bullets from recent work sessions. Trim when stale.

- 2026-06-21: Completed TDD-covered RCG-10 schema-lane mutation adapter in `schema/mutations.py` for plan, plan-step, state-dependency, and `TransferPoints` writes.
- 2026-06-21: PR #2 briefly explored polymorphic storage with v3.1 lifecycle-compatible names, then restored v3.1 as canonical when all-lane sign-off was not available.
- 2026-06-21: Canonical path restored to v3.1 table-per-type; polymorphic artifacts preserved only under `schema/experimental/polymorphic/`.
- 2026-06-21: Added direct-successor validation to atomic re-plan promotion and covered invalid lineage in PostgreSQL integration.
- 2026-06-21: Added max-attempt enforcement to re-plan job claiming and covered exhausted jobs in PostgreSQL integration.
- 2026-06-21: Added `in_progress` idempotency handling to canonical and experimental `transfer_points` functions with regression coverage.
- 2026-06-21: Replaced canonical `TransferPoints` idempotency select-then-insert claim with an upsert claim and focused schema-artifact regression.
- 2026-06-21: Aligned canonical DDL with v3.1 status-only plan-step staleness and restored a direct-update `user_balances` staleness trigger backstop.
- 2026-06-21: Restored `docs/` from current `origin/main` and aligned `graph_mutations` DDL/write logging with ADR 0008 for Val sidebar compatibility.
- 2026-06-21: Added a live Postgres integration test for `V31GraphWriteService.transfer_points` and wired it into the schema workflow.
- 2026-06-21: Hardened state-dependency target lookup by removing f-string table interpolation from the v3.1 mutation adapter.
- 2026-06-22: Replaced stale-plan view string coverage with a live PostgreSQL 16 schema-artifact contract test for `stale_plan_steps`.
- 2026-06-23: Added an RCG-14 regression for overlapping SSE polls and guarded the mutation stream poll loop against concurrent cursor updates.
- 2026-06-23: Added route-boundary validation for mutation replay cursors and regression coverage for invalid REST/SSE cursors.
- 2026-06-24: Merged RCG-14 API dependencies into the existing `@rewards-agent/api` manifest instead of replacing the orchestrator package setup.
- 2026-06-24: Verified spec 03 / RCG-14/25 checklist against the mutation API and added route-level SSE payload/replay compliance coverage.
- 2026-06-24: Addressed mutation-route review nits with schema validation on REST replay payloads and unauthenticated REST/SSE route coverage.
- 2026-06-24: Bumped the declared Hono dependency range to `^4.12.27`; production `npm audit --omit=dev` reports no vulnerabilities.
- 2026-06-24: Implemented spec 07 HTTP service (RCG-18) — Hono server with Clerk auth, `PlanService` port, `BridgePlanService` (psql-subprocess bridge to `hero_flow.py`), all six routes, SSE/REST mutation mount; 86 `npm test` unit tests + typecheck green. Remaining gate: live Clerk smoke-test.

---

## Related

- Feature specs: [`feature-specs/`](feature-specs/)
- Decisions: [`decisions-log.md`](decisions-log.md)
- Team board: [`../STATUS.md`](../STATUS.md)
- Person C docs: [`../docs/implementation/person-c-redemption-traversal.md`](../docs/implementation/person-c-redemption-traversal.md)
