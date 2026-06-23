# RCG-12 Recursive Traversal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add recursive-CTE traversal helpers that return multi-hop reward redemption paths at MVP scale.

**Architecture:** Keep traversal in the schema lane as a read-only helper module until the app graph-query layer exists. The helper executes one parameterized recursive CTE over `user_balances -> transfers_to -> redeems_via -> redemption_options`, returns typed Python results, and never writes graph state.

**Tech Stack:** Python `unittest`, PostgreSQL 16 recursive CTEs, current v3.1 DDL.

---

**Branch:** `rcg-12-recursive-traversal`

### Task 1: Add Query Helper Types

**Files:**
- Create: `schema/queries.py`
- Test: `tests/test_v31_queries.py`

- [x] **Step 1: Write result-shape test**

Create `tests/test_v31_queries.py` with a fake cursor and assert `find_redemption_paths()` returns `RedemptionPath` objects with string UUIDs, integer `hop_count`, integer `effective_ratio_basis_points`, and integer `cpp_basis_points`.

- [x] **Step 2: Run focused test**

Run: `python -m unittest tests.test_v31_queries`

Expected: failure because `schema.queries` does not exist.

- [x] **Step 3: Add dataclass and function shell**

Create:

```python
@dataclass(frozen=True)
class RedemptionPath:
    source_balance_id: str
    source_program_id: str
    destination_program_id: str
    redemption_option_id: str
    hop_count: int
    effective_ratio_basis_points: int
    cpp_basis_points: int
    transfer_time_days: int | None
    description: str | None
```

Add `find_redemption_paths(connection, user_id: str, max_hops: int = 2) -> list[RedemptionPath]`.

- [x] **Step 4: Run focused test again**

Run: `python -m unittest tests.test_v31_queries`

Expected: pass for result mapping.

### Task 2: Implement Recursive CTE

**Files:**
- Modify: `schema/queries.py`
- Test: `tests/test_v31_queries.py`

- [x] **Step 1: Write SQL-shape test**

Assert the executed SQL contains `WITH RECURSIVE`, reads `transfers_to`, joins `redeems_via`, filters `user_balances.user_id = %s`, and does not interpolate `user_id` into SQL text.

- [x] **Step 2: Run focused test**

Run: `python -m unittest tests.test_v31_queries.V31QueryHelperTest.test_find_redemption_paths_uses_parameterized_recursive_cte`

Expected: failure until SQL is implemented.

- [x] **Step 3: Implement SQL**

Use a recursive CTE named `paths` with base rows from the user's positive balances, recursive rows that follow active `transfers_to`, and final rows joined to `redeems_via` and `redemption_options`. Compute effective ratio with integer basis points:

```sql
(paths.effective_ratio_basis_points * route.transfer_ratio_basis_points) / 10000
```

Stop recursion with `paths.hop_count < %s`.

- [x] **Step 4: Run query tests**

Run: `python -m unittest tests.test_v31_queries`

Expected: pass.

### Task 3: Add Live PostgreSQL Contract Test

**Files:**
- Modify: `tests/test_v31_queries.py`

- [x] **Step 1: Add opt-in live test**

Follow the existing `RUN_LIVE_POSTGRES_TESTS=1` pattern from `tests/test_v31_mutations.py`. Seed one user, three programs, two `transfers_to` rows, and one `redeems_via` row.

- [x] **Step 2: Assert multi-hop result**

Assert `find_redemption_paths(..., max_hops=2)` returns a route with `hop_count == 2` and the expected redemption option.

- [x] **Step 3: Run non-live verification**

Run: `python -m unittest discover -s tests`

Expected: all non-live tests pass; live query test is skipped without opt-in.

### Task 4: Update Tracking

**Files:**
- Modify: `context/progress-tracker.md`
- Modify: `tracking/alan-graph.md`

- [x] **Step 1: Record RCG-12 completion**

Move RCG-12 out of `Next` and add a recent completed line mentioning `schema/queries.py` and the recursive CTE.

- [x] **Step 2: Final verification**

Run: `python -m unittest discover -s tests`

Expected: all non-live tests pass.
