# Progress Tracker — [Project Name]

> Current state of the project. Update after each meaningful milestone or phase change.

**Last updated:** 2026-06-23 by Val (merged main — spec 05 + landing)

---

## Current phase

**Phase:** MVP build  
**Active focus:** Spec 05 orchestrator harness shipped; spec 02 graph-write path next (Alan)

---

## Current goal

Ship typed orchestrator loop with in-memory doubles so agent coordination is enforced in TypeScript before real DB adapters land.

---

## Completed

_Check off or list with date. Keep recent; archive old phases elsewhere if needed._

- [x] Spec 05 — Orchestrator + agent harness (RCG-15) — 2026-06-22 — lifecycle error-handling hardening after code review (43 tests, typecheck clean). **Gotcha:** when `finalizeAgentRun(failed)` throws during cleanup, AgentRun may remain `running` — primary agent error is not overwritten. Documented in spec 05 §10.3 (lifecycle cleanup persistence).
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
- [ ] [Unit / milestone] — [YYYY-MM-DD] — [one-line note]
- [ ] [Unit / milestone] — [date] — [note]

---

## In progress

| Item | Owner | Blocked on | Notes |
|---|---|---|---|
| _(none — spec 05 complete)_ | | | |

---

## Next up

1. Spec 02 — real graph-write adapters behind `OrchestratorGraphWrite` / `AgentCommitFactory` (Alan)
2. Phase A3 codegen — replace temporary `SpecialistMutation` union (ADR 0007)
3. Spec 04/06 — Python specialist agents + subprocess launcher

---

## Open questions

_Unresolved ambiguities. Link to feature spec or decision if applicable._

| # | Question | Owner | Status |
|---|---|---|---|
| 2 | Does ADR 0004 storage-only compromise have all-four lane sign-off? | Alan/Raq | resolved → no; polymorphic path is experimental only |
| 1 | [Question] | [Name] | open / resolved → see decisions-log |

---

## Gates / milestones _(optional)_

| Gate | Date | Status | Criteria |
|---|---|---|---|
| [e.g. MVP demo] | [date] | ☐ open / ☑ done | [what must be true] |

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

---

## Related

- Feature specs: [`feature-specs/`](feature-specs/)
- Decisions: [`decisions-log.md`](decisions-log.md)
