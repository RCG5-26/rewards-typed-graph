# Deferred design — atomic OCC + idempotency for orchestrator graph writes

**Status:** Open. Tracks two confirmed code-review findings that are deferred
architectural work, not bugs to patch in place.

- **Finding 1 (Critical):** the orchestrator commit-step / record-dependency /
  record-mutation bridge handlers accept `idempotency_key` and `read_set` but do
  not enforce them before writing. Retries can duplicate rows, and stale
  snapshots are not rejected at the DB boundary.
- **Finding 4 (Major, depends on 1):** the bridge envelope collapses an
  `idempotency_conflict` to `{ code, message }`, dropping the persisted
  `mutationTxnId`. Callers cannot return the original txn id for a replay.

Both are **valid**. Neither is fixed in this pass — see *Why deferred*.

## Why deferred (the architectural constraints)

1. **Per-subprocess connection model.** Every `_psql_exec` / `_psql_rows` call in
   `apps/api/bridge/hero_bridge.py` runs in its own `psql` subprocess — a
   separate connection, separately auto-committed. Read-set validation and the
   subsequent write therefore **cannot execute in one transaction** today. A
   `validate_read_set()` call followed by a write is two independent
   transactions with a TOCTOU gap; `REPEATABLE READ`, an extra version check, or
   an in-memory lock does **not** close it.
2. **Read-set wire format lacks `targetTable`.** The TypeScript→bridge read-set
   is `{ nodeId: version }`. The existing `V31GraphWriteService.validate_read_set`
   needs `(target_table, node_id, observed_version)` to locate a row, so the
   current protocol cannot drive it correctly without a contract change.
3. **No durable idempotency claim for plan steps.** `CreatePlanStepRequest` has
   no idempotency key or unique constraint, so there is no replay path. Adding
   replay metadata to the envelope (Finding 4) before a durable claim exists
   would produce a **misleading** envelope.

A minimal patch cannot satisfy these without a protocol + transaction-boundary +
schema redesign, which is out of scope for a remediation pass and touches frozen
contracts. Hence the focused design below.

## Required design

1. **Typed read-set entry** — `{ targetTable, nodeId, expectedVersion }` carried
   end to end (TS contract → bridge argv/JSON → Python request object), replacing
   the table-less `{ nodeId: version }` map.
2. **Closed allow-list of versioned tables** — reuse / formalize
   `STATE_DEPENDENCY_TARGET_TABLES`; reject any `targetTable` outside it.
3. **Single `orchestrator-commit-batch` bridge command** — accepts the typed
   read-set plus the ordered writes for one logical commit, so validation and all
   writes share one invocation.
4. **One connection + one transaction** — `BEGIN … validate read-set … writes …
   COMMIT` in a single `psql` process (extend `_psql_tx`), giving true atomic OCC
   (stale read aborts the whole batch).
5. **Durable idempotency key + unique DB constraint** — persist the key with the
   committed rows under a `UNIQUE` constraint so a retry collides deterministically
   instead of duplicating.
6. **Request-hash mismatch protection** — store a request hash with the key; a
   replay with the same key but a different hash is a hard error, mirroring
   `_resolve_transfer_idempotency`.
7. **Stored replay results + replay metadata** — on a key hit, return the
   originally persisted `mutationTxnId(s)` and `idempotencyReplayed: true`; widen
   the bridge envelope to carry that (this is the real fix for Finding 4).
8. **Tests** — concurrent-writer (interleaved write aborts the batch), stale-read
   rejection, retry returns the original txn id, rollback leaves no partial rows,
   and duplicate-prevention under the unique constraint. Live-PG gated.

## Current demo guardrails (verified)

The shipped code is suitable only for the controlled, single-user, sequential
demo. Verified against the current tree:

- **Orchestrator mode is explicit / opt-in.** `bootPlanService` fails fast unless
  `PLAN_ENGINE` is set; orchestrator is never an implicit default
  (`apps/api/src/plans/engine-selector.ts`).
- **No automatic write retries.** No retry/backoff in the orchestrator commit
  path (`apps/api/src/agents/commit/*`, `orchestrator.ts`); a failed commit fails
  the run and plan.
- **One user, one logical write at a time.** The orchestrator dispatches
  invocations sequentially (`for (const invocation of decomposed.invocations)`),
  and the demo exercises a single user.
- **Python legacy remains available as rollback.** `PLAN_ENGINE=python-legacy`
  selects the stable bridge engine (`engine-selector.ts`).

## Presentation constraints (do not overclaim)

- Do **not** claim production-grade idempotency.
- Do **not** claim atomic cross-command OCC.
- Optional UI/process-level duplicate-submit protection may be added as a demo
  guardrail only; it does **not** resolve Finding 1.

## Production impact

Blocker for any retry-safety or concurrency claim. Acceptable for the demo only
under the documented single-user, sequential constraints above.
