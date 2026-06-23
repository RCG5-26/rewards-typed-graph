# RCG-13 Dependency Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish plan-node dependency tracking so stale detection is precise, direct, and non-transitive.

**Architecture:** Build on the existing `state_dependencies` table, `stale_plan_steps` view, and `TransferPoints` path. Replace broad plan-wide step invalidation with a small direct-dependency helper that marks only steps depending on the changed personal node, then marks the parent plan stale and enqueues one replan job.

**Tech Stack:** PostgreSQL 16 DDL/functions, Python `unittest`, existing schema artifact tests.

---

**Branch:** `rcg-13-dependency-tracking`

### Task 1: Cover Precise Stale-Step Behavior

**Files:**
- Modify: `tests/test_v31_mutations.py`

- [ ] **Step 1: Write live precision test**

Extend the live `TransferPoints` fixture with two current steps on the same current plan:

```sql
-- step 1 depends on source user_balance
-- step 2 depends on user_program_statuses or an unrelated balance
```

After `TransferPoints`, assert the parent plan is `stale`, step 1 is `stale`, and step 2 remains `current`.

- [ ] **Step 2: Run live test**

Run: `RUN_LIVE_POSTGRES_TESTS=1 python -m unittest tests.test_v31_mutations.V31GraphWriteServiceLivePostgresTest.test_transfer_points_marks_only_dependent_steps_stale`

Expected: failure with current broad `UPDATE plan_steps ... WHERE plan_id = stale_plan.id`.

### Task 2: Add Direct-Dependency SQL Helper

**Files:**
- Modify: `schema/schema.sql`
- Modify: `tests/test_schema_artifacts.py`

- [ ] **Step 1: Add schema-artifact test**

Assert `schema.sql` contains `CREATE FUNCTION mark_direct_plan_dependents_stale` and does not use a plan-wide `UPDATE plan_steps ... WHERE plan_id = stale_plan.id` inside `transfer_points`.

- [ ] **Step 2: Run schema-artifact test**

Run: `python -m unittest tests.test_schema_artifacts.SchemaArtifactsTest.test_default_schema_sql_marks_direct_dependents_only`

Expected: failure until function exists.

- [ ] **Step 3: Implement helper function**

Create a SQL function accepting `(p_user_id, p_target_table, p_target_node_id, p_reason, p_actor, p_mutation_txn_id)` that:

1. Finds current steps with direct `state_dependencies` to the changed target.
2. Updates only those steps to `status = 'stale'`.
3. Updates distinct parent current plans to `status = 'stale'`.
4. Inserts one `graph_mutations` row for each stale plan and each stale step.
5. Does not follow dependencies whose `target_table = 'plan_steps'`.

- [ ] **Step 4: Run artifact tests**

Run: `python -m unittest tests.test_schema_artifacts`

Expected: pass, with live tests skipped unless opted in.

### Task 3: Wire TransferPoints to the Helper

**Files:**
- Modify: `schema/schema.sql`
- Modify: `tests/test_v31_mutations.py`

- [ ] **Step 1: Replace inline broad invalidation**

Inside `transfer_points`, call `mark_direct_plan_dependents_stale` for the source and destination balance IDs after balance updates and mutation-log inserts.

- [ ] **Step 2: Preserve one replan job per stale source plan**

The helper may return distinct stale plan IDs, or `transfer_points` may select them after helper execution. Insert `replan_jobs` with the existing `(source_plan_id)` conflict guard.

- [ ] **Step 3: Run live precision test**

Run: `RUN_LIVE_POSTGRES_TESTS=1 python -m unittest tests.test_v31_mutations.V31GraphWriteServiceLivePostgresTest.test_transfer_points_marks_only_dependent_steps_stale`

Expected: pass.

### Task 4: Add Negative-Control Non-Transitive Test

**Files:**
- Modify: `tests/test_schema_artifacts.py`

- [ ] **Step 1: Add live test fixture**

Create step A depending on a balance and step B depending on step A. Mutate the balance. Assert step A is stale and step B remains current.

- [ ] **Step 2: Run non-live and live checks**

Run: `python -m unittest discover -s tests`

Expected: non-live tests pass, live tests skipped unless opted in.

### Task 5: Update Tracking

**Files:**
- Modify: `STATUS.md`
- Modify: `context/progress-tracker.md`
- Modify: `tracking/alan-graph.md`

- [ ] **Step 1: Mark RCG-13 complete in repo tracking**

Change dependency-tracking status from not started to complete only after the precision and non-transitive tests exist.

- [ ] **Step 2: Final verification**

Run: `python -m unittest discover -s tests`

Expected: all non-live tests pass.

