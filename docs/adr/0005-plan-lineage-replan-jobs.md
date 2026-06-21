# 0005 — Plan Lineage, Lifecycle, and Replan Jobs

- **Status:** Accepted — June 18, 2026.
- **Owner:** Raq (lead); Alan (schema)
- **Index:** [`context/decisions-log.md`](../../context/decisions-log.md) (D011, D012, D019, D020, D021)
- **Related:** [0001 — Schema Lock](0001-schema-lock.md), [`schema-final.md`](../architecture/schema-final.md) §4–§5.2

## Context

Early drafts used in-place step refresh and a denormalized `plan_steps.is_stale` flag (D005, D010 — superseded). The hero demo requires that a balance transfer invalidates the current plan and produces a **new revision** without ever restoring a stale revision to actionable state. Crash recovery and duplicate workers must not double-promote revisions.

## Decision

**Lineage model**
- Every plan belongs to a stable `plan_lineage_id` (uuid, constant across revisions).
- `revision_number` increments on each re-plan.
- `supersedes_plan_id` links revision chain.
- Partial unique index: **one `status = 'current'` per lineage** — not one current plan per user globally.

**Status lifecycle (source of truth — no parallel booleans)**
- Plan: `generating | current | stale | failed | superseded`
- Step: `proposed | current | stale | superseded`
- Only `plans.status = 'current'` is actionable in the UI.

**Invalidation (same transaction as personal-state mutation)**
1. Current revision → `stale`; dependent steps → `stale`.
2. Insert `replan_jobs` row (`status = pending`, `source_plan_id` = the stale revision).

**Re-plan worker**
1. Claim job with `FOR UPDATE SKIP LOCKED`; set `processing`, lease (`locked_by`, `lease_expires_at`), increment `attempt_count`.
2. Reclaim expired `processing` jobs when `lease_expires_at < now()`.
3. Create new revision with `status = generating`; invoke redemption agent subprocess.
4. **Atomic promotion txn:** new revision → `current`; source → `superseded`; new steps → `current`; job → `completed` with `result_plan_id`.
5. On failure after max attempts: job → `failed`; source stays `stale` — **never** restored to `current`.
6. Worker with expired lease must not promote even if LLM returns late.

**Idempotency on jobs:** `UNIQUE` on job `idempotency_key` (e.g. `{plan_lineage_id}:{mutation_txn_id}`).

## Consequences

- UI reads `GET /plans/:lineage/current` (or equivalent); never infer actionability from step booleans.
- Supersedes D005 (async in-place refresh) and D010 (`is_stale` boolean).
- Graph-write owns enqueue; worker owns claim + promotion; both must respect lease semantics.
- Benchmark baselines still write minimal `plans` / `plan_steps` rows only (ADR 0002 I1).
