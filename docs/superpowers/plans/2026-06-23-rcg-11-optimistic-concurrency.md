# RCG-11 Optimistic Concurrency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish stale-version rejection and bounded retry for graph writes that carry read-set versions.

**Architecture:** Extend the existing v3.1 Python schema-lane adapter before adding app scaffolding. The commit path validates a hardcoded, user-scoped read set under the per-user advisory lock, rejects mismatched versions without writing, and retries only known OCC conflicts up to three attempts.

**Tech Stack:** Python `unittest`, PostgreSQL 16 SQL in `schema/schema.sql`, existing `schema/mutations.py` service.

---

**Branch:** `rcg-11-optimistic-concurrency`

### Task 1: Add Read-Set Types and Conflict Errors

**Files:**
- Modify: `schema/mutations.py`
- Test: `tests/test_v31_mutations.py`

- [x] **Step 1: Write the failing tests**

Add tests that import `ReadSetEntry`, `ConcurrencyConflictError`, and `MAX_OCC_RETRIES`, then assert:

```python
def test_read_set_rejects_stale_user_balance_before_write(self):
    connection = FakeConnection()
    connection.user_balances = {
        "00000000-0000-0000-0000-000000000040": (
            "UserBalance",
            3,
            "00000000-0000-0000-0000-000000000001",
        )
    }
    service = V31GraphWriteService(connection)

    with self.assertRaises(ConcurrencyConflictError):
        service.validate_read_set(
            user_id="00000000-0000-0000-0000-000000000001",
            read_set=[
                ReadSetEntry(
                    target_table="user_balances",
                    target_node_id="00000000-0000-0000-0000-000000000040",
                    observed_version=2,
                )
            ],
        )

    self.assertFalse(_any_sql(connection, "INSERT INTO graph_mutations"))
```

- [x] **Step 2: Run the focused test**

Run: `python -m unittest tests.test_v31_mutations.V31GraphWriteServiceTest.test_read_set_rejects_stale_user_balance_before_write`

Expected: import or attribute failure.

- [x] **Step 3: Implement minimal types**

Add:

```python
MAX_OCC_RETRIES = 3


@dataclass(frozen=True)
class ReadSetEntry:
    target_table: str
    target_node_id: str
    observed_version: int


class ConcurrencyConflictError(RuntimeError):
    """Raised when an observed read-set version is stale."""
```

- [x] **Step 4: Implement `validate_read_set`**

Use existing `_fetch_target_reference()` and `STATE_DEPENDENCY_TARGET_TABLES`. For every entry: reject unknown tables, negative versions, missing targets, foreign user-scoped targets, and `current_version != observed_version`.

- [x] **Step 5: Run the focused test again**

Run: `python -m unittest tests.test_v31_mutations.V31GraphWriteServiceTest.test_read_set_rejects_stale_user_balance_before_write`

Expected: pass.

### Task 2: Add Bounded Retry Wrapper

**Files:**
- Modify: `schema/mutations.py`
- Test: `tests/test_v31_mutations.py`

- [x] **Step 1: Write retry tests**

Add tests for a function shaped like:

```python
result = service.with_occ_retry(
    lambda: attempt(),
    retryable_errors=("source balance version conflict",),
)
```

Assert it calls the function three times and then raises `ConcurrencyConflictError` when every attempt raises a retryable `RuntimeError`.

- [x] **Step 2: Run the focused retry tests**

Run: `python -m unittest tests.test_v31_mutations.V31GraphWriteServiceTest.test_occ_retry_stops_after_three_attempts`

Expected: failure because `with_occ_retry` does not exist.

- [x] **Step 3: Implement retry wrapper**

Add `with_occ_retry(self, operation, retryable_errors)` to `V31GraphWriteService`. It must catch only configured conflict messages, retry at most `MAX_OCC_RETRIES`, and rethrow non-conflict errors unchanged.

- [x] **Step 4: Run all mutation tests**

Run: `python -m unittest tests.test_v31_mutations`

Expected: pass, with live Postgres tests skipped unless `RUN_LIVE_POSTGRES_TESTS=1`.

### Task 3: Wire Read-Set Validation into TransferPoints

**Files:**
- Modify: `schema/mutations.py`
- Test: `tests/test_v31_mutations.py`

- [x] **Step 1: Extend `TransferPointsRequest`**

Add optional `read_set: tuple[ReadSetEntry, ...] = ()`. Existing callers remain valid.

- [x] **Step 2: Write stale-version transfer test**

Create a fake read set where the source balance current version is `2` and the observed version is `1`. Assert no SQL `SELECT ... FROM transfer_points` is executed.

- [x] **Step 3: Validate read set before SQL function call**

Inside `transfer_points`, call `self.validate_read_set(request.user_id, request.read_set)` before invoking `transfer_points(...)`.

- [x] **Step 4: Run verification**

Run: `python -m unittest discover -s tests`

Expected: all non-live tests pass.

### Task 4: Update Tracking

**Files:**
- Modify: `context/progress-tracker.md`
- Modify: `tracking/alan-graph.md`

- [x] **Step 1: Record completion**

Add a concise completed line for RCG-11 and remove or revise any "Next" entry that still implies RCG-11 is open.

- [x] **Step 2: Run final verification**

Run: `python -m unittest discover -s tests`

Expected: all non-live tests pass.
